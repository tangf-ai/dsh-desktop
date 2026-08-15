#!/usr/bin/env node
/** Node launcher for the published Electron desktop preview package. */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DesktopElectronProcess } from './launcher-process.ts'

const ELECTRON_SHUTDOWN_GRACE_MS = 12_000
const ELECTRON_FORCE_EXIT_GRACE_MS = 2_000
const require = createRequire(import.meta.url)
const electronPath = require('electron') as unknown
if (typeof electronPath !== 'string') {
  throw new Error('dsh-desktop: electron package did not resolve to an executable path')
}

const appRoot = fileURLToPath(new URL('../..', import.meta.url))
const launcherArgs = process.argv.slice(2)
const electronArgs = launcherArgs[0] === '--' ? launcherArgs.slice(1) : launcherArgs
const electron = new DesktopElectronProcess({
  executable: electronPath,
  appRoot,
  argv: electronArgs,
  cwd: process.cwd(),
  env: { ...process.env, DSH_DESKTOP_NODE_EXEC_PATH: process.execPath },
  shutdownGraceMs: ELECTRON_SHUTDOWN_GRACE_MS,
  forceExitGraceMs: ELECTRON_FORCE_EXIT_GRACE_MS,
})
const signalHandlers = {
  SIGINT: (): void => { electron.stop('SIGINT') },
  SIGTERM: (): void => { electron.stop('SIGTERM') },
}
process.on('SIGINT', signalHandlers.SIGINT)
process.on('SIGTERM', signalHandlers.SIGTERM)

try {
  const exit = await electron.done
  process.exitCode = exit.code ?? signalExitCode(exit.signal)
} catch (error: unknown) {
  console.error(`dsh-desktop: failed to run Electron: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  process.off('SIGINT', signalHandlers.SIGINT)
  process.off('SIGTERM', signalHandlers.SIGTERM)
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === 'SIGINT') return 130
  if (signal === 'SIGTERM') return 143
  if (signal === 'SIGKILL') return 137
  return 1
}
