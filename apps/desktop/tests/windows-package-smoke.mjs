import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows package smoke requires Windows x64, got ${process.platform} ${process.arch}`)
}

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const invocationCwd = resolve(process.env.INIT_CWD ?? process.cwd())
const unpackedRoot = resolve(desktopRoot, 'dist', 'win-unpacked')
const executable = join(unpackedRoot, 'DeepSeek Harness.exe')
const runtimeNode = join(unpackedRoot, 'resources', 'runtime', 'bin', 'node.exe')
const cliPath = join(unpackedRoot, 'resources', 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const installer = await resolveInstaller(process.argv[2])
const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-windows-smoke-'))
const screenshot = resolve(invocationCwd, '.artifacts', 'desktop-windows.png')
let desktop
let runtimeUrl

try {
  await access(executable)
  await access(installer)
  const runtime = JSON.parse(execFileSync(runtimeNode, [
    '-p',
    'JSON.stringify({ version: process.version, platform: process.platform, arch: process.arch })',
  ], { encoding: 'utf8' }))
  assert.equal(runtime.platform, 'win32')
  assert.equal(runtime.arch, 'x64')
  execFileSync(runtimeNode, [cliPath, '--help'], { cwd: invocationCwd, stdio: 'pipe' })
  assert.equal(authenticodeStatus(executable), 'NotSigned')
  assert.equal(authenticodeStatus(installer), 'NotSigned')

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
  assert.equal(await realpath(applicationState.resourcesPath), await realpath(join(unpackedRoot, 'resources')))

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
    executable,
    installer,
    runtime,
    screenshot,
    runtimeUrl,
    applicationState,
    windowState,
  }, null, 2))
} finally {
  if (desktop !== undefined) await desktop.close()
  await rm(home, { recursive: true, force: true })
}

async function resolveInstaller(argument) {
  if (argument !== undefined) return resolve(invocationCwd, argument)
  const version = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8')).version
  return join(desktopRoot, 'release', `DeepSeek-Harness-Setup-${version}-x64.exe`)
}

function authenticodeStatus(path) {
  return execFileSync('pwsh.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Console]::Out.Write((Get-AuthenticodeSignature -LiteralPath $env:DSH_DESKTOP_AUTHENTICODE_PATH).Status)',
  ], {
    encoding: 'utf8',
    env: { ...process.env, DSH_DESKTOP_AUTHENTICODE_PATH: path },
  }).trim()
}
