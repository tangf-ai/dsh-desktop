import { execFileSync, spawn } from 'node:child_process'
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const repositoryRoot = resolve(desktopRoot, '../..')
export const releaseRoot = join(desktopRoot, 'release')
export const manifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'))

/**
 * Assemble the self-contained desktop application input for one native host.
 * @param {{ platform: 'darwin' | 'win32', arch: 'arm64' | 'x64' }} target - Required host platform and architecture.
 * @returns {Promise<{
 *   appRoot: string,
 *   cleanup: () => Promise<void>,
 *   cliPath: string,
 *   nodeExecutable: string,
 *   stagingRoot: string,
 * }>} The staged application, runtime, and cleanup operation.
 */
export async function stageDesktopApplication(target) {
  if (process.platform !== target.platform || process.arch !== target.arch) {
    throw new Error(`desktop package builds require ${target.platform} ${target.arch}, got ${process.platform} ${process.arch}`)
  }

  const sourceNode = resolveBundledNode()
  const nodeRuntime = JSON.parse(execFileSync(sourceNode, [
    '-p',
    'JSON.stringify({ version: process.version, platform: process.platform, arch: process.arch })',
  ], { encoding: 'utf8' }))
  validateNodeRuntime(nodeRuntime, target)
  if (target.platform === 'darwin') validateMacNode(sourceNode)

  const stagingRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-builder-'))
  const appRoot = join(stagingRoot, 'app')
  const runtimeRoot = join(stagingRoot, 'runtime')
  const legalRoot = join(stagingRoot, 'legal')
  const pnpmWorkspaceStatePath = join(repositoryRoot, 'node_modules', '.pnpm-workspace-state-v1.json')

  try {
    await mkdir(appRoot, { recursive: true })
    await cp(join(desktopRoot, 'lib', 'types'), join(appRoot, 'lib', 'types'), { recursive: true })
    await cp(join(desktopRoot, 'assets'), join(appRoot, 'assets'), { recursive: true })
    await cp(join(desktopRoot, 'electron-builder.yml'), join(stagingRoot, 'electron-builder.yml'))
    await symlink(
      join(desktopRoot, 'node_modules', 'electron', 'dist'),
      join(stagingRoot, 'electron-dist'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
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
      await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
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

    const packagedNode = join(runtimeRoot, 'bin', target.platform === 'win32' ? 'node.exe' : 'node')
    await mkdir(dirname(packagedNode), { recursive: true })
    await cp(sourceNode, packagedNode)
    if (target.platform !== 'win32') await chmod(packagedNode, 0o755)
    await cp(await resolveNodeLicense(sourceNode), join(runtimeRoot, 'NODE_LICENSE'))
    await mkdir(legalRoot, { recursive: true })
    await cp(join(repositoryRoot, 'LICENSE'), join(legalRoot, 'LICENSE'))
    await cp(join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), join(legalRoot, 'THIRD_PARTY_NOTICES.md'))

    const cliPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await access(cliPath)
    await run(packagedNode, [cliPath, '--help'], repositoryRoot)
    return {
      appRoot,
      async cleanup() { await rm(stagingRoot, { recursive: true, force: true }) },
      cliPath,
      nodeExecutable: packagedNode,
      stagingRoot,
    }
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

/**
 * Run one packaging subprocess and reject on every non-zero termination.
 * @param {string} command - Executable name or path.
 * @param {string[]} args - Command arguments.
 * @param {string} cwd - Working directory.
 * @param {NodeJS.ProcessEnv} [env] - Child environment.
 * @returns {Promise<void>} When the subprocess exits successfully.
 */
export async function run(command, args, cwd, env = process.env) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} exited with ${signal ?? `code ${String(code)}`}`))
    })
  })
}

function resolveBundledNode() {
  const configured = process.env.DSH_DESKTOP_BUNDLED_NODE?.trim()
  return resolve(configured === undefined || configured === '' ? process.execPath : configured)
}

function validateNodeRuntime(runtime, target) {
  const match = /^v(\d+)\.(\d+)\./.exec(runtime.version)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  const supported = (major === 22 && minor >= 19) || major >= 24
  if (runtime.platform !== target.platform || runtime.arch !== target.arch || !supported) {
    throw new Error(`bundled Node must be ${target.platform} ${target.arch} and satisfy ^22.19 || >=24, got ${JSON.stringify(runtime)}`)
  }
}

function validateMacNode(executable) {
  const output = execFileSync('otool', ['-L', executable], { encoding: 'utf8' })
  const dependencies = output.split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean)
  const external = dependencies.filter(path => !path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/'))
  if (external.length > 0) {
    throw new Error(`bundled Node has non-system dynamic dependencies: ${external.join(', ')}`)
  }
}

async function resolveNodeLicense(executable) {
  const candidates = [
    resolve(dirname(executable), '..', 'LICENSE'),
    resolve(dirname(executable), 'LICENSE'),
  ]
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`bundled Node license was not found beside ${executable}`)
}

async function makeRuntimePortable(root) {
  const linkedPackageRoot = join(root, 'linked-packages')
  const replacements = [
    { source: join(repositoryRoot, 'vendor', 'cosmokit'), target: join(linkedPackageRoot, 'cosmokit') },
    { source: join(repositoryRoot, 'vendor', 'schemastery'), target: join(linkedPackageRoot, 'schemastery') },
  ]
  const replacementsBySource = new Map(replacements.map(replacement => [pathKey(replacement.source), replacement]))
  const omittedTargets = new Set([
    desktopRoot,
    join(repositoryRoot, 'native', 'landlock-run', 'packages', 'linux-arm64'),
    join(repositoryRoot, 'native', 'landlock-run', 'packages', 'linux-x64'),
  ].map(pathKey))
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
      if (omittedTargets.has(pathKey(originalTarget))) {
        await unlink(path)
        continue
      }
      const replacement = replacementsBySource.get(pathKey(originalTarget))
      const target = replacement?.target ?? originalTarget
      if (replacement !== undefined) {
        await unlink(path)
        await symlink(relative(dirname(path), target), path, process.platform === 'win32' ? 'junction' : 'dir')
      }
      const targetFromRoot = relative(root, target)
      if (targetFromRoot === '..' || targetFromRoot.startsWith(`..${sep}`) || isAbsolute(targetFromRoot)) {
        throw new Error(`desktop runtime symlink escapes its bundle: ${path} -> ${target}`)
      }
      await access(target)
    }
  }
}

function pathKey(path) {
  const normalized = resolve(path).replace(/^\\\\\?\\/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
