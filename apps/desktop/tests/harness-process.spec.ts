import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HarnessWebProcess,
  parseHarnessReadyUrl,
  resolveDesktopStartupTimeout,
  resolveDesktopWorkingDirectory,
} from '../src/harness-process.ts'

const FAKE_DSH = fileURLToPath(new URL('./fixtures/fake-dsh.mjs', import.meta.url))
const running: HarnessWebProcess[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(async (process) => { await process.stop() }))
})

describe('desktop Harness process', () => {
  it('accepts only the settled loopback readiness line', () => {
    expect(parseHarnessReadyUrl('dsh web: http://127.0.0.1:43123')?.href).toBe('http://127.0.0.1:43123/')
    expect(parseHarnessReadyUrl('dsh web: http://127.0.0.1:43123 (LAN: http://10.0.0.4:43123)')?.port).toBe('43123')
    expect(parseHarnessReadyUrl('dsh web: http://localhost:43123')).toBeUndefined()
    expect(parseHarnessReadyUrl('dsh web: https://127.0.0.1:43123')).toBeUndefined()
    expect(parseHarnessReadyUrl('dsh web: http://127.0.0.1:0')).toBeUndefined()
    expect(parseHarnessReadyUrl('unrelated output')).toBeUndefined()
  })

  it('resolves desktop workspace precedence', () => {
    expect(resolveDesktopWorkingDirectory({ DSH_DESKTOP_CWD: './workspace', INIT_CWD: '/ignored' }, '/base'))
      .toBe(resolve('/base/workspace'))
    expect(resolveDesktopWorkingDirectory({ INIT_CWD: '/invoked' }, '/base')).toBe(resolve('/invoked'))
    expect(resolveDesktopWorkingDirectory({}, '/base')).toBe(resolve('/base'))
  })

  it('validates the configurable startup timeout', () => {
    expect(resolveDesktopStartupTimeout(undefined)).toBe(60_000)
    expect(resolveDesktopStartupTimeout('1500')).toBe(1_500)
    expect(() => resolveDesktopStartupTimeout('0')).toThrow(/between 1/)
    expect(() => resolveDesktopStartupTimeout('slow')).toThrow(/positive integer/)
  })

  it('waits for a split readiness line and stops the child', async () => {
    const output: string[] = []
    const process = makeProcess({
      onOutput: (source, line) => { output.push(`${source}:${line}`) },
    })
    running.push(process)

    await expect(process.start()).resolves.toMatchObject({ href: 'http://127.0.0.1:43123/' })
    expect(output).toContain('stderr:fake harness diagnostic')
    await process.stop()
  })

  it('reports a ready child that exits unexpectedly', async () => {
    const exited = vi.fn()
    const process = makeProcess({
      env: { ...processEnv(), FAKE_EXIT_AFTER_READY: '1' },
      onUnexpectedExit: exited,
    })
    running.push(process)

    await process.start()
    await vi.waitFor(() => { expect(exited).toHaveBeenCalledWith({ code: 7, signal: null }) })
  })

  it('stops descendants that outlive the direct CLI process', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-tree-'))
    const pidFile = join(tempDir, 'grandchild.pid')
    let grandchildPid: number | undefined
    const harness = makeProcess({
      env: { ...processEnv(), FAKE_GRANDCHILD_PID_FILE: pidFile },
    })
    running.push(harness)

    try {
      await harness.start()
      await vi.waitFor(async () => {
        const value = await readFile(pidFile, 'utf8').catch(() => '')
        expect(value).toMatch(/^\d+$/)
        grandchildPid = Number(value)
      })
      await harness.stop()
      await vi.waitFor(() => { expect(isProcessAlive(grandchildPid)).toBe(false) })
    } finally {
      if (grandchildPid !== undefined && isProcessAlive(grandchildPid)) process.kill(grandchildPid, 'SIGKILL')
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('cleans descendants when the CLI exits before readiness', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-startup-tree-'))
    const pidFile = join(tempDir, 'grandchild.pid')
    let grandchildPid: number | undefined
    const harness = makeProcess({
      env: {
        ...processEnv(),
        FAKE_EXIT_BEFORE_READY: '1',
        FAKE_GRANDCHILD_PID_FILE: pidFile,
      },
    })
    running.push(harness)

    try {
      await expect(harness.start()).rejects.toThrow(/exited before readiness/)
      const value = await readFile(pidFile, 'utf8')
      grandchildPid = Number(value)
      await vi.waitFor(() => { expect(isProcessAlive(grandchildPid)).toBe(false) })
    } finally {
      if (grandchildPid !== undefined && isProcessAlive(grandchildPid)) process.kill(grandchildPid, 'SIGKILL')
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')('fails loud when a vanished CLI root prevents tree verification', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-unverified-tree-'))
    const pidFile = join(tempDir, 'grandchild.pid')
    let grandchildPid: number | undefined
    const harness = makeProcess({
      env: {
        ...processEnv(),
        FAKE_EXIT_BEFORE_READY: '1',
        FAKE_GRANDCHILD_PID_FILE: pidFile,
      },
    })

    try {
      await expect(harness.start()).rejects.toThrow(/Desktop cleanup failed: taskkill failed/)
      grandchildPid = Number(await readFile(pidFile, 'utf8'))
    } finally {
      if (grandchildPid !== undefined && isProcessAlive(grandchildPid)) process.kill(grandchildPid, 'SIGKILL')
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('times out and includes bounded child diagnostics', async () => {
    const process = makeProcess({
      startupTimeoutMs: 500,
      env: { ...processEnv(), FAKE_NO_READY: '1' },
    })
    running.push(process)

    await expect(process.start()).rejects.toThrow(/fake harness diagnostic/)
  })
})

function makeProcess(overrides: Partial<ConstructorParameters<typeof HarnessWebProcess>[0]> = {}): HarnessWebProcess {
  return new HarnessWebProcess({
    executable: process.execPath,
    cliPath: FAKE_DSH,
    cwd: process.cwd(),
    startupTimeoutMs: 3_000,
    shutdownGraceMs: 1_000,
    env: processEnv(),
    ...overrides,
  })
}

function processEnv(): NodeJS.ProcessEnv {
  return { ...process.env }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
