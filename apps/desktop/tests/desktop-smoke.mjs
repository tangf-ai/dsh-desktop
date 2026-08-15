import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const invocationCwd = resolve(process.env.INIT_CWD ?? process.cwd())
const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
const screenshot = resolve(invocationCwd, '.artifacts/desktop-preview.png')
let desktop
let runtimeUrl

try {
  desktop = await electron.launch({
    executablePath: electronPath,
    args: [appRoot],
    cwd: invocationCwd,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_DESKTOP_INTERNAL_USER_DATA_DIR: join(home, 'electron'),
      DSH_DESKTOP_NODE_EXEC_PATH: process.execPath,
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

  const pageState = await page.evaluate(() => ({
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    },
    frameCount: document.querySelectorAll('[class*=frame]').length,
  }))
  assert.equal(pageState.title, 'DeepSeek Harness')
  assert.equal(pageState.frameCount, 1)
  assert.equal(pageState.document.scrollWidth, pageState.document.clientWidth)
  assert.equal(pageState.document.scrollHeight, pageState.document.clientHeight)

  await mkdir(dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot, fullPage: false })
  await desktop.close()
  desktop = undefined
  await assert.rejects(fetch(runtimeUrl, { signal: AbortSignal.timeout(2_000) }))
  console.log(JSON.stringify({ screenshot, runtimeUrl, pageState, windowState }, null, 2))
} finally {
  if (desktop !== undefined) await desktop.close()
  await rm(home, { recursive: true, force: true })
}
