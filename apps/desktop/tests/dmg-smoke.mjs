import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readlink, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`DMG smoke requires macOS arm64, got ${process.platform} ${process.arch}`)
}

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const invocationCwd = resolve(process.env.INIT_CWD ?? process.cwd())
const dmgPath = await resolveDmg(process.argv[2])
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-dmg-smoke-'))
const mountPoint = join(temporaryRoot, 'mounted')
const home = join(temporaryRoot, 'home')
const screenshot = resolve(invocationCwd, '.artifacts/desktop-dmg.png')
let mounted = false
let desktop
let runtimeUrl

try {
  await mkdir(mountPoint)
  await mkdir(home)
  run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmgPath])
  mounted = true
  assert.equal(await readlink(join(mountPoint, 'Applications')), '/Applications')

  const appName = (await readdir(mountPoint)).find(name => name.endsWith('.app'))
  assert.ok(appName, `DMG ${dmgPath} contains no .app bundle`)
  const appPath = join(mountPoint, appName)
  const executable = join(appPath, 'Contents', 'MacOS', 'DeepSeek Harness')
  const runtimeNode = join(appPath, 'Contents', 'Resources', 'runtime', 'bin', 'node')
  const cliPath = join(appPath, 'Contents', 'Resources', 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const runtime = JSON.parse(execFileSync(runtimeNode, [
    '-p',
    'JSON.stringify({ version: process.version, platform: process.platform, arch: process.arch })',
  ], { encoding: 'utf8' }))
  assert.equal(runtime.platform, 'darwin')
  assert.equal(runtime.arch, 'arm64')
  execFileSync(runtimeNode, [cliPath, '--help'], { cwd: invocationCwd, stdio: 'pipe' })

  const signature = spawnSync('codesign', ['-d', '--verbose=4', appPath], { encoding: 'utf8' })
  const signatureDetail = `${signature.stdout}${signature.stderr}`
  assert.doesNotMatch(signatureDetail, /^Authority=/m, 'app unexpectedly carries a certificate identity')

  desktop = await electron.launch({
    executablePath: executable,
    cwd: invocationCwd,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_DESKTOP_INTERNAL_USER_DATA_DIR: join(home, 'electron'),
      DSH_DESKTOP_CWD: invocationCwd,
      DSH_TELEMETRY_DISABLED: '1',
    },
    timeout: 120_000,
  })
  const page = await desktop.firstWindow()
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 120_000 })
  await page.waitForSelector('[class*=frame]', { timeout: 60_000 })
  await page.waitForTimeout(500)
  runtimeUrl = page.url()

  const applicationState = await desktop.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    name: app.getName(),
    resourcesPath: process.resourcesPath,
  }))
  assert.equal(applicationState.isPackaged, true)
  assert.equal(applicationState.name, 'DeepSeek Harness')
  assert.equal(await realpath(applicationState.resourcesPath), await realpath(join(appPath, 'Contents', 'Resources')))

  const browserWindow = await desktop.browserWindow(page)
  const windowState = await browserWindow.evaluate((window) => {
    const preferences = window.webContents.getLastWebPreferences()
    return {
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
      sandbox: preferences.sandbox,
      webSecurity: preferences.webSecurity,
      url: window.webContents.getURL(),
    }
  })
  assert.deepEqual(windowState, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    url: runtimeUrl,
  })

  await mkdir(dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot, fullPage: false })
  await desktop.close()
  desktop = undefined
  await assert.rejects(fetch(runtimeUrl, { signal: AbortSignal.timeout(2_000) }))

  console.log(JSON.stringify({
    dmg: dmgPath,
    app: basename(appPath),
    runtime,
    signature: signatureDetail.trim() || 'unsigned bundle',
    screenshot,
    runtimeUrl,
    applicationState,
    windowState,
  }, null, 2))
} finally {
  if (desktop !== undefined) await desktop.close()
  if (mounted) detach(mountPoint)
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function resolveDmg(argument) {
  if (argument !== undefined) return resolve(invocationCwd, argument)
  const candidates = (await readdir(join(desktopRoot, 'release')))
    .filter(name => name.endsWith('.dmg'))
    .sort()
  assert.equal(candidates.length, 1, `expected one DMG in ${join(desktopRoot, 'release')}, got ${String(candidates.length)}`)
  return join(desktopRoot, 'release', candidates[0])
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}${result.stdout}`)
}

function detach(path) {
  const result = spawnSync('hdiutil', ['detach', path], { encoding: 'utf8' })
  if (result.status === 0) return
  run('hdiutil', ['detach', '-force', path])
}
