import { execFileSync, spawn } from 'node:child_process'
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(desktopRoot, '../..')
const releaseRoot = join(desktopRoot, 'release')
const manifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'))

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`desktop DMG builds require macOS arm64, got ${process.platform} ${process.arch}`)
}

const nodeExecutable = resolveBundledNode()
const nodeRuntime = JSON.parse(execFileSync(nodeExecutable, [
  '-p',
  'JSON.stringify({ version: process.version, platform: process.platform, arch: process.arch })',
], { encoding: 'utf8' }))
validateNodeRuntime(nodeRuntime)
validatePortableNode(nodeExecutable)

const stagingRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-builder-'))
const appRoot = join(stagingRoot, 'app')
const runtimeRoot = join(stagingRoot, 'runtime')
const legalRoot = join(stagingRoot, 'legal')
const pnpmWorkspaceStatePath = join(repositoryRoot, 'node_modules', '.pnpm-workspace-state-v1.json')

await rm(join(desktopRoot, 'dist'), { recursive: true, force: true })
await rm(releaseRoot, { recursive: true, force: true })

try {
  await mkdir(appRoot, { recursive: true })
  await cp(join(desktopRoot, 'lib', 'types'), join(appRoot, 'lib', 'types'), { recursive: true })
  await cp(join(desktopRoot, 'assets'), join(appRoot, 'assets'), { recursive: true })
  await cp(join(desktopRoot, 'electron-builder.yml'), join(stagingRoot, 'electron-builder.yml'))
  await symlink(join(desktopRoot, 'node_modules', 'electron', 'dist'), join(stagingRoot, 'electron-dist'), 'dir')
  await writeFile(join(stagingRoot, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-desktop-builder',
    version: manifest.version,
    private: true,
    devDependencies: {
      electron: manifest.devDependencies.electron,
    },
  }, null, 2)}\n`)
  await writeFile(join(appRoot, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-desktop-app',
    description: manifest.description,
    version: manifest.version,
    author: 'DeepSeek AI',
    license: manifest.license,
    type: 'module',
    main: 'lib/types/main.js',
  }, null, 2)}\n`)

  const pnpmWorkspaceState = await readFile(pnpmWorkspaceStatePath)
  try {
    await run('pnpm', [
      '--filter',
      '@deepseek-ai/dsh-desktop',
      'deploy',
      '--prod',
      '--legacy',
      runtimeRoot,
    ], repositoryRoot, { ...process.env, pnpm_config_verify_deps_before_run: 'false' })
  } finally {
    await writeFile(pnpmWorkspaceStatePath, pnpmWorkspaceState)
  }
  await makeRuntimePortable(runtimeRoot)

  await mkdir(join(runtimeRoot, 'bin'), { recursive: true })
  await cp(nodeExecutable, join(runtimeRoot, 'bin', 'node'))
  await chmod(join(runtimeRoot, 'bin', 'node'), 0o755)
  await cp(resolve(dirname(nodeExecutable), '..', 'LICENSE'), join(runtimeRoot, 'NODE_LICENSE'))
  await mkdir(legalRoot, { recursive: true })
  await cp(join(repositoryRoot, 'LICENSE'), join(legalRoot, 'LICENSE'))
  await cp(join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), join(legalRoot, 'THIRD_PARTY_NOTICES.md'))

  const cliPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  await access(cliPath)
  await run(join(runtimeRoot, 'bin', 'node'), [cliPath, '--help'], repositoryRoot)
  await run(join(desktopRoot, 'node_modules', '.bin', 'electron-builder'), [
    '--projectDir',
    stagingRoot,
    '--config',
    'electron-builder.yml',
    '--mac',
    'dir',
    '--arm64',
  ], stagingRoot)

  const appOutputRoot = join(stagingRoot, 'output', 'mac-arm64')
  const appOutput = join(appOutputRoot, 'DeepSeek Harness.app')
  const packagedRuntimeRoot = join(appOutput, 'Contents', 'Resources', 'runtime')
  const packagedNode = join(packagedRuntimeRoot, 'bin', 'node')
  const packagedCli = join(packagedRuntimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const applicationLink = join(appOutputRoot, 'Applications')
  const artifact = join(releaseRoot, `DeepSeek-Harness-${manifest.version}-arm64.dmg`)
  await access(appOutput)
  await access(packagedCli)
  await run(packagedNode, [packagedCli, '--help'], repositoryRoot)
  await mkdir(releaseRoot, { recursive: true })
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
  await rm(stagingRoot, { recursive: true, force: true })
}

function resolveBundledNode() {
  const configured = process.env.DSH_DESKTOP_BUNDLED_NODE?.trim()
  return resolve(configured === undefined || configured === '' ? process.execPath : configured)
}

function validateNodeRuntime(runtime) {
  const match = /^v(\d+)\.(\d+)\./.exec(runtime.version)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  const supported = (major === 22 && minor >= 19) || major >= 24
  if (runtime.platform !== 'darwin' || runtime.arch !== 'arm64' || !supported) {
    throw new Error(`bundled Node must be macOS arm64 and satisfy ^22.19 || >=24, got ${JSON.stringify(runtime)}`)
  }
}

function validatePortableNode(executable) {
  const output = execFileSync('otool', ['-L', executable], { encoding: 'utf8' })
  const dependencies = output.split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean)
  const external = dependencies.filter(path => !path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/'))
  if (external.length > 0) {
    throw new Error(`bundled Node has non-system dynamic dependencies: ${external.join(', ')}`)
  }
}

async function makeRuntimePortable(root) {
  const linkedPackageRoot = join(root, 'linked-packages')
  const replacements = [
    { source: join(repositoryRoot, 'vendor', 'cosmokit'), target: join(linkedPackageRoot, 'cosmokit') },
    { source: join(repositoryRoot, 'vendor', 'schemastery'), target: join(linkedPackageRoot, 'schemastery') },
  ]
  const omittedTargets = new Set([
    desktopRoot,
    join(repositoryRoot, 'native', 'landlock-run', 'packages', 'linux-arm64'),
    join(repositoryRoot, 'native', 'landlock-run', 'packages', 'linux-x64'),
  ])
  const excludedRoots = new Set(['.artifacts', 'apps', 'node_modules'])
  for (const replacement of replacements) {
    await cp(replacement.source, replacement.target, {
      recursive: true,
      filter(source) {
        const path = relative(replacement.source, source)
        return path === '' || !excludedRoots.has(path.split(sep)[0])
      },
    })
  }

  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
        continue
      }
      if (!entry.isSymbolicLink()) continue

      const originalTarget = resolve(dirname(path), await readlink(path))
      if (omittedTargets.has(originalTarget)) {
        await unlink(path)
        continue
      }
      const replacement = replacements.find(candidate => candidate.source === originalTarget)
      const target = replacement?.target ?? originalTarget
      if (replacement !== undefined) {
        await unlink(path)
        await symlink(relative(dirname(path), target), path, 'dir')
      }
      const targetFromRoot = relative(root, target)
      if (targetFromRoot === '..' || targetFromRoot.startsWith(`..${sep}`) || isAbsolute(targetFromRoot)) {
        throw new Error(`desktop runtime symlink escapes its bundle: ${path} -> ${target}`)
      }
      await access(target)
    }
  }
}

async function run(command, args, cwd, env = process.env) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} exited with ${signal ?? `code ${String(code)}`}`))
    })
  })
}
