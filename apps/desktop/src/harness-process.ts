/**
 * Lifecycle owner for the isolated `dsh web` process tree used by the Electron
 * desktop preview. The root selects an OS-assigned loopback port and publishes
 * its settled URL through the existing stdout readiness line.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?: \(LAN: [^)]+\))?$/
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
const MAX_STARTUP_TIMEOUT_MS = 10 * 60_000
const TREE_EXIT_POLL_MS = 20
const STDERR_TAIL_CHARS = 12_000

/** How the supervised Harness process terminated. */
export interface HarnessProcessExit {
  /** Exit code, or null when a signal terminated the process. */
  code: number | null
  /** Terminating signal, or null for an ordinary exit. */
  signal: NodeJS.Signals | null
}

/** Construction values for one desktop-owned Harness process. */
export interface HarnessWebProcessOptions {
  /** Node executable used to run the built Harness CLI. */
  executable: string
  /** Built `@deepseek-ai/dsh` CLI entry. */
  cliPath: string
  /** Workspace presented to the Harness launch environment. */
  cwd: string
  /** Maximum wait for the settled `dsh web:` readiness line. */
  startupTimeoutMs: number
  /** Grace for tree exit after each termination tier. */
  shutdownGraceMs: number
  /** Complete child environment. */
  env: NodeJS.ProcessEnv
  /** Optional diagnostic sink for complete stdout and stderr lines. */
  onOutput?: (source: 'stdout' | 'stderr', line: string) => void
  /** Called when a ready child exits without an application-owned stop. */
  onUnexpectedExit?: (exit: HarnessProcessExit) => void
}

/**
 * Parse the exact loopback readiness line emitted after the Web Loader settles.
 * @param line - one complete stdout line.
 * @returns the validated loopback URL, or undefined for unrelated output.
 */
export function parseHarnessReadyUrl(line: string): URL | undefined {
  const match = READY_LINE.exec(line)
  if (match?.[1] === undefined) return undefined
  const url = new URL(match[1])
  const port = Number(url.port)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== ''
    || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return undefined
  }
  return url
}

/**
 * Resolve the workspace used by the desktop-launched Harness.
 * @param env - launcher environment.
 * @param cwd - current process directory.
 * @returns an absolute directory; DSH_DESKTOP_CWD wins, then pnpm's INIT_CWD, then cwd.
 */
export function resolveDesktopWorkingDirectory(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const configured = env.DSH_DESKTOP_CWD?.trim()
  if (configured !== undefined && configured !== '') return resolve(cwd, configured)
  const invokedFrom = env.INIT_CWD?.trim()
  if (invokedFrom !== undefined && invokedFrom !== '') return resolve(invokedFrom)
  return resolve(cwd)
}

/**
 * Parse the optional desktop startup timeout.
 * @param value - DSH_DESKTOP_STARTUP_TIMEOUT_MS.
 * @returns a positive timeout no greater than ten minutes.
 */
export function resolveDesktopStartupTimeout(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_STARTUP_TIMEOUT_MS
  if (!/^\d+$/.test(value)) {
    throw new Error(`DSH_DESKTOP_STARTUP_TIMEOUT_MS must be a positive integer, got ${JSON.stringify(value)}`)
  }
  const timeout = Number(value)
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_STARTUP_TIMEOUT_MS) {
    throw new Error(`DSH_DESKTOP_STARTUP_TIMEOUT_MS must be between 1 and ${String(MAX_STARTUP_TIMEOUT_MS)}, got ${JSON.stringify(value)}`)
  }
  return timeout
}

/** One-shot supervisor for the Web-profile child process. */
export class HarnessWebProcess {
  private child: ChildProcess | undefined
  private closed: Promise<HarnessProcessExit> | undefined
  private ready = false
  private stopping = false
  private stopOperation: Promise<void> | undefined
  private stderrTail = ''

  /** @param options - executable, CLI path, workspace, timing, and lifecycle callbacks. */
  constructor(private readonly options: HarnessWebProcessOptions) {}

  /**
   * Spawn the child and wait until its Loader-settled loopback URL arrives.
   * @returns the OS-assigned local URL.
   * @throws when spawn fails, startup times out, or the child exits before readiness.
   */
  async start(): Promise<URL> {
    if (this.child !== undefined) throw new Error('desktop harness process can start only once')

    const child = spawn(
      this.options.executable,
      [this.options.cliPath, 'web', '--host', '127.0.0.1', '--port', '0'],
      {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // POSIX descendants stay in one signalable group; Windows uses taskkill /T.
        detached: process.platform !== 'win32',
        windowsHide: true,
      },
    )
    this.child = child
    this.closed = new Promise((resolveClose) => {
      child.once('close', (code, signal) => { resolveClose({ code, signal }) })
    })

    observeLines(child.stderr, (line) => {
      this.stderrTail = `${this.stderrTail}${line}\n`.slice(-STDERR_TAIL_CHARS)
      this.options.onOutput?.('stderr', line)
    })

    return await new Promise<URL>((resolveStart, rejectStart) => {
      let settled = false
      const timer = setTimeout(() => {
        void fail(new Error(
          `desktop harness process did not become ready within ${String(this.options.startupTimeoutMs)} ms${this.diagnosticSuffix()}`,
        ))
      }, this.options.startupTimeoutMs)

      const fail = async (error: Error): Promise<void> => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          await this.stop()
          rejectStart(error)
        } catch (stopError: unknown) {
          rejectStart(new Error(`${error.message}\nDesktop cleanup failed: ${errorMessage(stopError)}`, { cause: stopError }))
        }
      }

      observeLines(child.stdout as NodeJS.ReadableStream, (line) => {
        this.options.onOutput?.('stdout', line)
        const url = parseHarnessReadyUrl(line)
        if (settled || url === undefined) return
        settled = true
        this.ready = true
        clearTimeout(timer)
        resolveStart(url)
      })

      child.once('error', (error) => {
        void fail(new Error(`desktop harness process failed to spawn: ${error.message}${this.diagnosticSuffix()}`, { cause: error }))
      })

      void this.closed?.then((exit) => {
        if (!settled) {
          void fail(new Error(`desktop harness process exited before readiness (${formatExit(exit)})${this.diagnosticSuffix()}`))
          return
        }
        if (this.ready && !this.stopping) this.options.onUnexpectedExit?.(exit)
      })
    })
  }

  /**
   * Stop the owned process tree once and wait until it reaches quiescence.
   * @returns when the whole tree and its direct child have exited.
   * @throws when the tree does not exit after graceful and forced tiers.
   */
  async stop(): Promise<void> {
    this.stopping = true
    this.stopOperation ??= this.stopOnce()
    await this.stopOperation
  }

  private async stopOnce(): Promise<void> {
    const child = this.child
    const closed = this.closed
    if (child === undefined || closed === undefined) return
    const pid = child.pid ?? -1

    if (process.platform === 'win32' && pid > 0) {
      taskkillProcessTree(pid)
      if (!await closesWithin(closed, this.options.shutdownGraceMs)) {
        throw new Error(`desktop Harness process tree ${String(pid)} did not close after taskkill`)
      }
      return
    }

    if (pid > 0 && processGroupAlive(pid)) {
      signalPosixTree(child, pid, 'SIGTERM')
      if (!await processGroupExitsWithin(pid, this.options.shutdownGraceMs)) {
        signalPosixTree(child, pid, 'SIGKILL')
        if (!await processGroupExitsWithin(pid, this.options.shutdownGraceMs)) {
          throw new Error(`desktop Harness process group ${String(pid)} survived SIGKILL`)
        }
      }
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      if (!await closesWithin(closed, this.options.shutdownGraceMs)) child.kill('SIGKILL')
    }

    if (!await closesWithin(closed, this.options.shutdownGraceMs)) {
      throw new Error(`desktop Harness process ${String(pid)} did not report close after tree exit`)
    }
  }

  private diagnosticSuffix(): string {
    const tail = this.stderrTail.trim()
    return tail === '' ? '' : `\nHarness diagnostics:\n${tail}`
  }
}

function observeLines(stream: NodeJS.ReadableStream, consume: (line: string) => void): void {
  let buffered = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string | Buffer) => {
    buffered += String(chunk)
    for (let newline = buffered.indexOf('\n'); newline !== -1; newline = buffered.indexOf('\n')) {
      const line = buffered.slice(0, newline).replace(/\r$/, '')
      buffered = buffered.slice(newline + 1)
      consume(line)
    }
  })
  stream.on('end', () => {
    if (buffered !== '') consume(buffered.replace(/\r$/, ''))
  })
}

async function closesWithin(closed: Promise<HarnessProcessExit>, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolveClose) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolveClose(false)
    }, timeoutMs)
    void closed.then(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveClose(true)
    })
  })
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function processGroupExitsWithin(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (processGroupAlive(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise<void>((resolveTick) => { setTimeout(resolveTick, TREE_EXIT_POLL_MS) })
  }
  return true
}

function signalPosixTree(child: ChildProcess, pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch (_alreadyExited) {
      // Signal delivery races process exit; stop remains idempotent.
    }
  }
}

function taskkillProcessTree(pid: number): void {
  const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) {
    throw new Error(`failed to launch taskkill for desktop Harness process tree ${String(pid)}`, { cause: result.error })
  }
  if (result.status !== 0) {
    const detail = `${result.stderr}${result.stdout}`.trim()
    throw new Error(`taskkill failed for desktop Harness process tree ${String(pid)} with status ${String(result.status)}${detail === '' ? '' : `: ${detail}`}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatExit(exit: HarnessProcessExit): string {
  return exit.signal === null ? `code ${String(exit.code)}` : `signal ${exit.signal}`
}
