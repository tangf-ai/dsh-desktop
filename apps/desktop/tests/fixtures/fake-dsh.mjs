import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

process.stderr.write('fake harness diagnostic\n')

const grandchildPidFile = process.env.FAKE_GRANDCHILD_PID_FILE
if (grandchildPidFile !== undefined) {
  const source = `
    const { writeFileSync } = require('node:fs')
    process.on('SIGTERM', () => {})
    writeFileSync(${JSON.stringify(grandchildPidFile)}, String(process.pid))
    setInterval(() => {}, 1_000)
  `
  spawn(process.execPath, ['-e', source], { stdio: 'ignore' })
}

if (process.env.FAKE_EXIT_BEFORE_READY === '1') {
  const startedAt = Date.now()
  const exitWhenGrandchildStarts = setInterval(() => {
    if (grandchildPidFile !== undefined && !existsSync(grandchildPidFile) && Date.now() - startedAt < 1_000) return
    clearInterval(exitWhenGrandchildStarts)
    process.exit(7)
  }, 10)
} else if (process.env.FAKE_NO_READY !== '1') {
  process.stdout.write('dsh web: http://127.0.0.1:')
  setTimeout(() => {
    process.stdout.write('43123\n')
    if (process.env.FAKE_EXIT_AFTER_READY === '1') {
      setTimeout(() => { process.exit(7) }, 30)
    }
  }, 10)
}

process.on('SIGTERM', () => { process.exit(0) })
setInterval(() => {}, 1_000)
