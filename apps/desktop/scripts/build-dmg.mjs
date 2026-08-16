import { access, mkdir, readdir, rm, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  desktopRoot,
  electronBuilderCli,
  manifest,
  releaseRoot,
  repositoryRoot,
  run,
  stageDesktopApplication,
} from './package-desktop.mjs'

const staged = await stageDesktopApplication({ platform: 'darwin', arch: 'arm64' })
const appOutputRoot = join(staged.stagingRoot, 'output', 'mac-arm64')
const appOutput = join(appOutputRoot, 'DeepSeek Harness.app')
const packagedRuntimeRoot = join(appOutput, 'Contents', 'Resources', 'runtime')
const packagedNode = join(packagedRuntimeRoot, 'bin', 'node')
const packagedCli = join(packagedRuntimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const applicationLink = join(appOutputRoot, 'Applications')
const artifact = join(releaseRoot, `DeepSeek-Harness-${manifest.version}-arm64.dmg`)

try {
  await rm(join(desktopRoot, 'dist'), { recursive: true, force: true })
  await mkdir(releaseRoot, { recursive: true })
  for (const name of await readdir(releaseRoot)) {
    if (/^DeepSeek-Harness-.+-arm64\.dmg$/.test(name)) await rm(join(releaseRoot, name), { force: true })
  }
  await run(process.execPath, [
    electronBuilderCli,
    '--projectDir',
    staged.stagingRoot,
    '--config',
    'electron-builder.yml',
    '--mac',
    'dir',
    '--arm64',
  ], staged.stagingRoot)

  await access(appOutput)
  await access(packagedCli)
  await run(packagedNode, [packagedCli, '--help'], repositoryRoot)
  await symlink('/Applications', applicationLink, 'dir')
  try {
    await run('hdiutil', [
      'create',
      '-volname',
      'DeepSeek Harness',
      '-srcfolder',
      appOutputRoot,
      '-ov',
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      artifact,
    ], desktopRoot)
  } finally {
    await unlink(applicationLink)
  }
  await access(artifact)
  console.log(`desktop DMG: ${artifact}`)
} finally {
  await staged.cleanup()
}
