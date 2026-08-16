/** Electron main process for the DeepSeek Harness desktop preview. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, shell } from 'electron'
import {
  HarnessWebProcess,
  resolveDesktopStartupTimeout,
  resolveDesktopWorkingDirectory,
  type HarnessProcessExit,
} from './harness-process.ts'

const APP_NAME = 'DeepSeek Harness'
const APP_ID = 'ai.deepseek.harness.desktop'
const HARNESS_SHUTDOWN_GRACE_MS = 8_000
const APP_ICON = fileURLToPath(new URL('../../assets/icon.png', import.meta.url))
const LOADING_PAGE = fileURLToPath(new URL('../../assets/loading.html', import.meta.url))

let mainWindow: BrowserWindow | undefined
let harness: HarnessWebProcess | undefined
let runtimeUrl: URL | undefined
let shutdownStarted = false
let quitReady = false
let fatalShown = false

app.setName(APP_NAME)
app.setAppUserModelId(APP_ID)
const internalUserData = process.env.DSH_DESKTOP_INTERNAL_USER_DATA_DIR?.trim()
if (internalUserData !== undefined && internalUserData !== '') app.setPath('userData', internalUserData)

const ownsSingleInstance = app.requestSingleInstanceLock()
if (!ownsSingleInstance) {
  app.quit()
} else {
  installApplicationLifecycle()
  void app.whenReady()
    .then(launchDesktop)
    .catch(async (error: unknown) => {
      await showFatal('无法启动 DeepSeek Harness', error)
    })
}

function installApplicationLifecycle(): void {
  app.on('second-instance', () => {
    if (mainWindow === undefined) {
      void ensureWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('activate', () => { void ensureWindow() })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitReady) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    void (harness?.stop() ?? Promise.resolve()).then(() => {
      quitReady = true
      app.quit()
    }, (error: unknown) => {
      console.error(`DeepSeek Harness desktop cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      quitReady = true
      app.exit(1)
    })
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { app.quit() })
  }
}

async function launchDesktop(): Promise<void> {
  if (process.platform === 'darwin') app.dock?.setIcon(APP_ICON)
  await ensureWindow()
  const childEnv = { ...process.env }
  delete childEnv.DSH_DESKTOP_INTERNAL_USER_DATA_DIR
  delete childEnv.DSH_DESKTOP_NODE_EXEC_PATH
  harness = new HarnessWebProcess({
    executable: resolveNodeExecutable(),
    cliPath: resolveHarnessCli(),
    cwd: resolveDesktopWorkingDirectory(process.env, app.isPackaged ? app.getPath('home') : process.cwd()),
    startupTimeoutMs: resolveDesktopStartupTimeout(process.env.DSH_DESKTOP_STARTUP_TIMEOUT_MS),
    shutdownGraceMs: HARNESS_SHUTDOWN_GRACE_MS,
    env: childEnv,
    onOutput(source, line) {
      const output = source === 'stderr' ? console.error : console.log
      output(`[dsh ${source}] ${line}`)
    },
    onUnexpectedExit(exit) {
      void handleUnexpectedExit(exit)
    },
  })
  runtimeUrl = await harness.start()
  await ensureWindow()
  await mainWindow?.loadURL(runtimeUrl.href)
}

async function ensureWindow(): Promise<void> {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    icon: APP_ICON,
    backgroundColor: '#f4f6f8',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: true,
    },
  })
  mainWindow = window
  installNavigationPolicy(window)
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  if (runtimeUrl === undefined) await window.loadFile(LOADING_PAGE)
  else await window.loadURL(runtimeUrl.href)
  if (!window.isDestroyed()) window.show()
}

function installNavigationPolicy(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (isAllowedNavigation(target)) return
    event.preventDefault()
    openExternalUrl(target)
  })
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
}

function isAllowedNavigation(target: string): boolean {
  try {
    const url = new URL(target)
    if (runtimeUrl !== undefined && url.origin === runtimeUrl.origin) return true
    return url.protocol === 'file:' && fileURLToPath(url) === LOADING_PAGE
  } catch {
    return false
  }
}

function openExternalUrl(target: string): void {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  void shell.openExternal(url.href).catch((error: unknown) => {
    console.error('[desktop] failed to open external URL:', error)
  })
}

function resolveHarnessCli(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  }
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

function resolveNodeExecutable(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'runtime', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
  }
  const executable = process.env.DSH_DESKTOP_NODE_EXEC_PATH?.trim()
  if (executable === undefined || executable === '') {
    throw new Error('desktop preview must be started through `pnpm desktop` or the `dsh-desktop` launcher')
  }
  return executable
}

async function handleUnexpectedExit(exit: HarnessProcessExit): Promise<void> {
  if (shutdownStarted) return
  const detail = exit.signal === null ? `退出码：${String(exit.code)}` : `终止信号：${exit.signal}`
  await showFatal('Harness 运行时已停止', new Error(detail))
}

async function showFatal(title: string, error: unknown): Promise<void> {
  if (fatalShown) return
  fatalShown = true
  process.exitCode = 1
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`[desktop] ${title}:`, error)
  const options = {
    type: 'error' as const,
    title: APP_NAME,
    message: title,
    detail,
  }
  if (mainWindow === undefined || mainWindow.isDestroyed()) await dialog.showMessageBox(options)
  else await dialog.showMessageBox(mainWindow, options)
  app.quit()
}
