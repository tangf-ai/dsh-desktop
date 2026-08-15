/** Bounded lifecycle owner for the Electron process started by the Node bin. */
import { spawn, type ChildProcess } from 'node:child_process'

/** How the launcher-owned Electron process terminated. */
export interface DesktopElectronExit {
  /** Exit code, or null when a signal terminated Electron. */
  code: number | null
  /** Terminating signal, or null for an ordinary exit. */
  signal: NodeJS.Signals | null
}

/** Construction values for the process behind `dsh-desktop`. */
export interface DesktopElectronProcessOptions {
  /** Electron executable resolved from the application dependency. */
  executable: string
  /** Application root passed as Electron's first argument. */
  appRoot: string
  /** Additional command-line arguments forwarded to Electron. */
  argv: string[]
  /** Invocation directory inherited by the desktop application. */
  cwd: string
  /** Environment including the original Node executable handoff. */
  env: NodeJS.ProcessEnv
  /** Wait after the first signal before forcing Electron to exit. */
  shutdownGraceMs: number
  /** Wait for an exit edge after SIGKILL before releasing the launcher. */
  forceExitGraceMs: number
  /** Child stdio disposition; production inherits the invoking terminal. */
  stdio?: 'inherit' | 'ignore'
}

/** One-shot Electron child with a bounded signal-to-exit ladder. */
export class DesktopElectronProcess {
  private readonly child: ChildProcess
  private readonly completion = Promise.withResolvers<DesktopElectronExit>()
  private gracefulTimer: ReturnType<typeof setTimeout> | undefined
  private forceTimer: ReturnType<typeof setTimeout> | undefined
  private stopping = false
  private forced = false
  private settled = false

  /** Settles on Electron close, or rejects if SIGKILL produces no exit edge. */
  readonly done = this.completion.promise

  /** @param options - Electron spawn arguments and both shutdown bounds. */
  constructor(private readonly options: DesktopElectronProcessOptions) {
    this.child = spawn(options.executable, [options.appRoot, ...options.argv], {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
    })
    this.child.once('error', (error) => { this.reject(error) })
    this.child.once('close', (code, signal) => { this.resolve({ code, signal }) })
  }

  /**
   * Forward the first terminating signal and force exit after the configured grace.
   * A repeated signal skips directly to the force tier.
   * @param signal - launcher signal received from the invoking shell.
   */
  stop(signal: 'SIGINT' | 'SIGTERM'): void {
    if (this.settled) return
    if (this.stopping) {
      this.forceStop()
      return
    }
    this.stopping = true
    this.send(signal)
    this.gracefulTimer = setTimeout(() => { this.forceStop() }, this.options.shutdownGraceMs).unref()
  }

  private forceStop(): void {
    if (this.settled || this.forced) return
    this.forced = true
    if (this.gracefulTimer !== undefined) clearTimeout(this.gracefulTimer)
    this.gracefulTimer = undefined
    this.send('SIGKILL')
    this.forceTimer = setTimeout(() => {
      this.child.unref()
      this.reject(new Error(`Electron did not exit within ${String(this.options.forceExitGraceMs)} ms after SIGKILL`))
    }, this.options.forceExitGraceMs).unref()
  }

  private send(signal: NodeJS.Signals): void {
    try {
      this.child.kill(signal)
    } catch (_alreadyExited) {
      // Signal delivery races the close event; completion remains authoritative.
    }
  }

  private resolve(exit: DesktopElectronExit): void {
    if (this.settled) return
    this.settled = true
    this.clearTimers()
    this.completion.resolve(exit)
  }

  private reject(error: Error): void {
    if (this.settled) return
    this.settled = true
    this.clearTimers()
    this.completion.reject(error)
  }

  private clearTimers(): void {
    if (this.gracefulTimer !== undefined) clearTimeout(this.gracefulTimer)
    if (this.forceTimer !== undefined) clearTimeout(this.forceTimer)
    this.gracefulTimer = undefined
    this.forceTimer = undefined
  }
}
