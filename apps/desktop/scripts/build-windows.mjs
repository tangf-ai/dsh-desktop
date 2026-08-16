import { access, cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  desktopRoot,
  manifest,
  releaseRoot,
  repositoryRoot,
  run,
  stageDesktopApplication,
} from './package-desktop.mjs'

const staged = await stageDesktopApplication({ platform: 'win32', arch: 'x64' })
const unpackedOutput = join(staged.stagingRoot, 'output', 'win-unpacked')
const unpackedArtifact = join(desktopRoot, 'dist', 'win-unpacked')
const executable = join(unpackedArtifact, 'DeepSeek Harness.exe')
const packagedRuntimeRoot = join(unpackedArtifact, 'resources', 'runtime')
const packagedNode = join(packagedRuntimeRoot, 'bin', 'node.exe')
const packagedCli = join(packagedRuntimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const installerName = `DeepSeek-Harness-Setup-${manifest.version}-x64.exe`
const stagedInstaller = join(staged.stagingRoot, 'output', installerName)
const installer = join(releaseRoot, installerName)

try {
  await rm(join(desktopRoot, 'dist'), { recursive: true, force: true })
  await mkdir(releaseRoot, { recursive: true })
  for (const name of await readdir(releaseRoot)) {
    if (/^DeepSeek-Harness-Setup-.+-x64\.exe$/.test(name)) await rm(join(releaseRoot, name), { force: true })
  }
  await run(join(desktopRoot, 'node_modules', '.bin', 'electron-builder.cmd'), [
    '--projectDir',
    staged.stagingRoot,
    '--config',
    'electron-builder.yml',
    '--win',
    'dir',
    'nsis',
    '--x64',
  ], staged.stagingRoot)

  await access(stagedInstaller)
  await mkdir(join(desktopRoot, 'dist'), { recursive: true })
  await cp(unpackedOutput, unpackedArtifact, { recursive: true })
  await cp(stagedInstaller, installer)
  await access(executable)
  await access(packagedCli)
  await run(packagedNode, [packagedCli, '--help'], repositoryRoot)
  console.log(`desktop Windows installer: ${installer}`)
} finally {
  await staged.cleanup()
}
