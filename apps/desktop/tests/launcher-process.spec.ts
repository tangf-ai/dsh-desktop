import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { DesktopElectronProcess } from '../src/launcher-process.ts'

const FAKE_ELECTRON = fileURLToPath(new URL('./fixtures/fake-electron.mjs', import.meta.url))

describe('desktop Electron launcher process', () => {
  it('reports an ordinary Electron exit', async () => {
    const electron = makeProcess()
    await expect(electron.done).resolves.toEqual({ code: 0, signal: null })
  })

  it.runIf(process.platform !== 'win32')('forces an Electron child that ignores graceful termination', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-launcher-'))
    const readyFile = join(tempDir, 'ready')
    const electron = makeProcess({
      env: { ...process.env, FAKE_IGNORE_TERMINATION: '1', FAKE_READY_FILE: readyFile },
      shutdownGraceMs: 100,
    })

    try {
      await vi.waitFor(async () => { expect(await readFile(readyFile, 'utf8').catch(() => '')).toBe('ready') })
      const startedAt = Date.now()
      electron.stop('SIGTERM')

      await expect(electron.done).resolves.toEqual({ code: null, signal: 'SIGKILL' })
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(75)
    } finally {
      electron.stop('SIGTERM')
      electron.stop('SIGTERM')
      await electron.done.catch(() => {})
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

function makeProcess(overrides: Partial<ConstructorParameters<typeof DesktopElectronProcess>[0]> = {}): DesktopElectronProcess {
  return new DesktopElectronProcess({
    executable: process.execPath,
    appRoot: FAKE_ELECTRON,
    argv: [],
    cwd: process.cwd(),
    env: { ...process.env },
    shutdownGraceMs: 1_000,
    forceExitGraceMs: 1_000,
    stdio: 'ignore',
    ...overrides,
  })
}
