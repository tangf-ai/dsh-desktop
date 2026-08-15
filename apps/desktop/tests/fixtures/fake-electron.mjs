import { writeFileSync } from 'node:fs'

if (process.env.FAKE_IGNORE_TERMINATION === '1') {
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => {})
  if (process.env.FAKE_READY_FILE !== undefined) writeFileSync(process.env.FAKE_READY_FILE, 'ready')
  setInterval(() => {}, 1_000)
} else {
  setTimeout(() => { process.exit(0) }, 10)
}
