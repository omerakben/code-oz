#!/usr/bin/env bun
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildAll,
  targetForHost,
  TARGETS,
  type BuildFs,
  type CommandRunner,
  type Manifest,
  type ManifestRow,
} from './build-binaries.ts'

export interface SmokeOptions {
  bundleDir: string
  installDir: string
  homeDir: string
  projectDir: string
  spawn: typeof Bun.spawn
  pathEnv: string
  timeoutMs?: number
}

export interface SmokeResult {
  ok: boolean
  steps: { name: string; ok: boolean; message: string }[]
  durationMs: number
}

export interface RunSpawnOptions {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly timeoutMs?: number
}

export interface RunSpawnResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly timeoutMs: number | null
  readonly timeoutKillError: string | null
}

export interface SmokeTempDirs {
  readonly bundleParent: string
  readonly installDir: string
  readonly projectDir: string
  readonly homeDir: string
  readonly extractDir: string
  readonly bundleDir: string
  readonly cleanupPaths: string[]
}

export interface SmokeTempDirDeps {
  readonly mkdtemp?: (prefix: string) => Promise<string>
  readonly rm?: (path: string, opts: { recursive?: boolean; force?: boolean }) => Promise<void>
  readonly tmpdir?: () => string
  readonly cleanupPaths?: string[]
}

export interface ValidateHandoffLayoutOptions {
  expectedVersion?: string
}

export async function validateHandoffLayout(
  handoffDir: string,
  opts: ValidateHandoffLayoutOptions = {},
): Promise<{
  ok: boolean
  errors: string[]
  manifest: Manifest | null
}> {
  const errors: string[] = []
  const expectedVersion = opts.expectedVersion ?? (await readPackageVersion(process.cwd()))
  const manifestPath = join(handoffDir, 'manifest.json')
  const manifest = await readManifest(manifestPath, errors)

  if (manifest === null) {
    return { ok: false, errors, manifest: null }
  }

  if (manifest.version !== expectedVersion) {
    errors.push(`manifest version ${manifest.version} does not match package version ${expectedVersion}`)
  }

  for (const target of TARGETS) {
    const rows = manifest.targets.filter(
      (row) =>
        row.os === target.os &&
        row.arch === target.arch &&
        row.bunTarget === target.bunTarget,
    )
    if (rows.length !== 1) {
      errors.push(`manifest must contain exactly one ${target.os}-${target.arch} target row`)
      continue
    }

    const row = rows[0]
    if (row === undefined) {
      errors.push(`manifest missing ${target.os}-${target.arch} target row`)
      continue
    }
    if (row.version !== expectedVersion) {
      errors.push(`${target.os}-${target.arch} version ${row.version} does not match ${expectedVersion}`)
    }

    const binaryPath = join(handoffDir, row.binaryRelativePath)
    const binaryMode = await executableMode(binaryPath)
    if (binaryMode === null) {
      errors.push(`${target.os}-${target.arch} binary missing at ${binaryPath}`)
    } else if ((binaryMode & 0o111) === 0) {
      errors.push(`${target.os}-${target.arch} binary is not executable at ${binaryPath}`)
    }
  }

  const installMode = await executableMode(join(handoffDir, 'install.sh'))
  if (installMode === null) {
    errors.push('dist/handoff/install.sh is missing')
  } else if ((installMode & 0o111) === 0) {
    errors.push('dist/handoff/install.sh is not executable')
  }

  const readmePath = join(handoffDir, 'README.md')
  const readme = await readTextIfPresent(readmePath)
  if (readme === null) {
    errors.push('dist/handoff/README.md is missing')
  } else if (readme.trim().length === 0) {
    errors.push('dist/handoff/README.md is empty')
  }

  return { ok: errors.length === 0, errors, manifest }
}

export async function runSmoke(opts: SmokeOptions): Promise<SmokeResult> {
  const start = performance.now()
  const steps: SmokeResult['steps'] = []
  const pathEnv = opts.pathEnv || '/usr/bin:/bin'
  const layout = await validateHandoffLayout(opts.bundleDir)

  if (!layout.ok || layout.manifest === null) {
    steps.push({ name: 'layout', ok: false, message: layout.errors.join('; ') })
    return finish(false, steps, start)
  }
  steps.push({ name: 'layout', ok: true, message: 'handoff layout is valid' })

  const version = layout.manifest.version
  const binaryPath = join(opts.installDir, 'code-oz')
  const install = await runSpawn(opts.spawn, ['sh', join(opts.bundleDir, 'install.sh')], {
    cwd: opts.bundleDir,
    env: {
      ...process.env,
      CODE_OZ_INSTALL_DIR: opts.installDir,
      HOME: opts.homeDir,
      PATH: pathEnv,
    },
    timeoutMs: opts.timeoutMs,
  })

  if (install.exitCode !== 0) {
    steps.push({ name: 'install', ok: false, message: commandFailure(install) })
    return finish(false, steps, start)
  }
  steps.push({ name: 'install', ok: true, message: 'installed into temp bin dir' })

  const binaryEnv = {
    ...process.env,
    HOME: opts.homeDir,
    PATH: `${opts.installDir}:${pathEnv}`,
  }
  const versionResult = await runSpawn(opts.spawn, [binaryPath, '--version'], {
    cwd: opts.projectDir,
    env: binaryEnv,
    timeoutMs: opts.timeoutMs,
  })
  if (versionResult.exitCode !== 0 || !versionResult.stdout.includes(version)) {
    steps.push({
      name: 'version',
      ok: false,
      message:
        versionResult.exitCode === 0
          ? `expected version output to contain ${version}; got ${versionResult.stdout.trim()}`
          : commandFailure(versionResult),
    })
    return finish(false, steps, start)
  }
  steps.push({ name: 'version', ok: true, message: `reported ${version}` })

  const help = await runSpawn(opts.spawn, [binaryPath, '--help'], {
    cwd: opts.projectDir,
    env: binaryEnv,
    timeoutMs: opts.timeoutMs,
  })
  if (help.exitCode !== 0) {
    steps.push({ name: 'help', ok: false, message: commandFailure(help) })
    return finish(false, steps, start)
  }
  steps.push({ name: 'help', ok: true, message: 'help command exited 0' })

  const init = await runSpawn(opts.spawn, [binaryPath, 'init'], {
    cwd: opts.projectDir,
    env: binaryEnv,
    timeoutMs: opts.timeoutMs,
  })
  if (init.exitCode !== 0) {
    steps.push({ name: 'init', ok: false, message: commandFailure(init) })
    return finish(false, steps, start)
  }

  if (!(await isDirectory(join(opts.projectDir, '.code-oz')))) {
    steps.push({ name: 'init', ok: false, message: 'init exited 0 but .code-oz/ was not created' })
    return finish(false, steps, start)
  }
  steps.push({ name: 'init', ok: true, message: 'created .code-oz/' })

  return finish(true, steps, start)
}

async function readManifest(path: string, errors: string[]): Promise<Manifest | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (err) {
    errors.push(`manifest.json missing or invalid JSON: ${formatUnknownError(err)}`)
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    errors.push('manifest.json must contain an object')
    return null
  }

  const manifest = parsed as Partial<Manifest>
  if (manifest.schemaVersion !== 1) {
    errors.push('manifest schemaVersion must be 1')
  }
  if (typeof manifest.version !== 'string') {
    errors.push('manifest version must be a string')
  }
  if (typeof manifest.builtAt !== 'string') {
    errors.push('manifest builtAt must be a string')
  }
  if (!Array.isArray(manifest.targets)) {
    errors.push('manifest targets must be an array')
  } else {
    manifest.targets.forEach((row, index) => {
      if (!isManifestRow(row)) {
        errors.push(`manifest targets[${index}] must include os, arch, bunTarget, binaryRelativePath, sha256, sizeBytes, and version`)
      }
    })
  }

  return errors.length === 0 ? (manifest as Manifest) : null
}

function isManifestRow(value: unknown): value is ManifestRow {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ManifestRow>
  return (
    typeof candidate.os === 'string' &&
    typeof candidate.arch === 'string' &&
    typeof candidate.bunTarget === 'string' &&
    typeof candidate.binaryRelativePath === 'string' &&
    typeof candidate.sha256 === 'string' &&
    typeof candidate.sizeBytes === 'number' &&
    typeof candidate.version === 'string'
  )
}

async function runCli(): Promise<number> {
  const cwd = process.cwd()
  const version = await readPackageVersion(cwd)
  const build = await buildAll({
    runner: createCommandRunner(cwd),
    version,
    cwd,
    mode: 'ensure',
    fs: realBuildFs,
    now: () => new Date(),
  })

  if (!build.ok || build.manifest === null) {
    process.stderr.write(`smoke: build prerequisite failed\n${build.errors.join('\n')}\n`)
    return 1
  }

  const hostTarget = targetForHost({
    os: process.platform === 'darwin' ? 'darwin' : process.platform,
    arch: process.arch,
  })
  if (hostTarget === null) {
    process.stderr.write('smoke can only run on darwin-{arm64,x64} or linux-{x64,arm64} hosts; Windows ships in v0.20.1 (W3a deferred per docs/design/CODEX_SYNTHESIS_W3A.md).\n')
    return 2
  }

  const hostRow = build.manifest.targets.find(
    (row) =>
      row.os === hostTarget.os &&
      row.arch === hostTarget.arch &&
      row.bunTarget === hostTarget.bunTarget,
  )
  if (hostRow === undefined) {
    process.stderr.write(`smoke: manifest missing host target ${hostTarget.os}-${hostTarget.arch}\n`)
    return 1
  }

  const layout = await validateHandoffLayout(join(cwd, 'dist/handoff'), { expectedVersion: version })
  if (!layout.ok) {
    process.stderr.write(`smoke: handoff layout failed\n${layout.errors.join('\n')}\n`)
    return 1
  }

  const cleanupPaths: string[] = []

  try {
    const { bundleDir, installDir, projectDir, homeDir, extractDir } = await createSmokeTempDirs({
      cleanupPaths,
    })
    await cp(join(cwd, 'dist/handoff'), bundleDir, { recursive: true })
    const smoke = await runSmoke({
      bundleDir,
      installDir,
      homeDir,
      projectDir,
      spawn: Bun.spawn,
      pathEnv: '/usr/bin:/bin',
    })

    if (!smoke.ok) {
      printSmokeSummary(smoke, version, hostRow, installDir)
      return 1
    }

    const tarball = await validateHandoffTarball({
      cwd,
      version,
      extractDir,
      spawn: Bun.spawn,
    })
    if (!tarball.ok) {
      process.stderr.write(`smoke: tarball validation failed\n${tarball.errors.join('\n')}\n`)
      return 1
    }

    printSmokeSummary(smoke, version, hostRow, installDir)
    process.stdout.write(`tarball: ${tarball.tarballPath}\n`)
    return 0
  } finally {
    const cleanupErrors = await cleanupSmokeTempDirs(cleanupPaths)
    if (cleanupErrors.length > 0) {
      throw new Error(`tempdir cleanup failed: ${cleanupErrors.join('; ')}`)
    }
  }
}

export async function createSmokeTempDirs(deps: SmokeTempDirDeps = {}): Promise<SmokeTempDirs> {
  const mkdtempFn = deps.mkdtemp ?? mkdtemp
  const rmFn = deps.rm ?? rm
  const tmpdirFn = deps.tmpdir ?? tmpdir
  const cleanupPaths = deps.cleanupPaths ?? []
  const initialCleanupLength = cleanupPaths.length

  try {
    const bundleParent = await mkdtempFn(join(tmpdirFn(), 'code-oz-smoke-bundle-'))
    cleanupPaths.push(bundleParent)
    const installDir = await mkdtempFn(join(tmpdirFn(), 'code-oz-smoke-bin-'))
    cleanupPaths.push(installDir)
    const projectDir = await mkdtempFn(join(tmpdirFn(), 'code-oz-smoke-project-'))
    cleanupPaths.push(projectDir)
    const homeDir = await mkdtempFn(join(tmpdirFn(), 'code-oz-smoke-home-'))
    cleanupPaths.push(homeDir)
    const extractDir = await mkdtempFn(join(tmpdirFn(), 'code-oz-smoke-extract-'))
    cleanupPaths.push(extractDir)
    return {
      bundleParent,
      installDir,
      projectDir,
      homeDir,
      extractDir,
      bundleDir: join(bundleParent, 'handoff'),
      cleanupPaths,
    }
  } catch (err) {
    const createdPaths = cleanupPaths.slice(initialCleanupLength)
    const cleanupErrors = await cleanupSmokeTempDirs(createdPaths, rmFn)
    cleanupPaths.splice(initialCleanupLength)
    if (cleanupErrors.length > 0) {
      throw new Error(`${formatUnknownError(err)}; tempdir cleanup failed: ${cleanupErrors.join('; ')}`)
    }
    throw err
  }
}

async function validateHandoffTarball(opts: {
  cwd: string
  version: string
  extractDir: string
  spawn: typeof Bun.spawn
}): Promise<{ ok: true; tarballPath: string } | { ok: false; errors: string[] }> {
  const rootName = `code-oz-v${opts.version}-handoff`
  const tarballPath = join(opts.cwd, 'dist', `${rootName}.tar.gz`)
  try {
    await access(tarballPath)
  } catch {
    return { ok: false, errors: [`missing ${tarballPath}`] }
  }

  const extract = await runSpawn(opts.spawn, ['tar', '-xzf', tarballPath, '-C', opts.extractDir], {
    cwd: opts.cwd,
    env: { ...process.env, PATH: process.env.PATH ?? '/usr/bin:/bin' },
  })
  if (extract.exitCode !== 0) {
    return { ok: false, errors: [commandFailure(extract)] }
  }

  const layout = await validateHandoffLayout(join(opts.extractDir, rootName), {
    expectedVersion: opts.version,
  })
  if (!layout.ok) {
    return { ok: false, errors: layout.errors }
  }

  return { ok: true, tarballPath }
}

function printSmokeSummary(
  smoke: SmokeResult,
  version: string,
  hostRow: ManifestRow,
  installDir: string,
): void {
  process.stdout.write(`code-oz smoke ${smoke.ok ? 'ok' : 'failed'}\n`)
  process.stdout.write(`version: ${version}\n`)
  process.stdout.write(`target: ${hostRow.os}-${hostRow.arch}\n`)
  process.stdout.write(`sha256: ${hostRow.sha256}\n`)
  process.stdout.write(`installDir: ${installDir}\n`)
  process.stdout.write(`durationMs: ${Math.round(smoke.durationMs)}\n`)
  for (const step of smoke.steps) {
    process.stdout.write(`- ${step.name}: ${step.ok ? 'ok' : 'fail'} - ${step.message}\n`)
  }
}

export async function runSpawn(
  spawn: typeof Bun.spawn,
  args: string[],
  opts: RunSpawnOptions,
): Promise<RunSpawnResult> {
  const timeoutMs = opts.timeoutMs ?? 30000
  const proc = spawn(args, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  let timeoutKillError: string | null = null
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch (err) {
      timeoutKillError = formatUnknownError(err)
    }
  }, timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const normalizedExitCode = typeof exitCode === 'number' ? exitCode : 1
    return {
      exitCode: timedOut && normalizedExitCode === 0 ? 1 : normalizedExitCode,
      stdout,
      stderr,
      timedOut,
      timeoutMs: timedOut ? timeoutMs : null,
      timeoutKillError,
    }
  } finally {
    clearTimeout(timer)
  }
}

function createCommandRunner(cwd: string): CommandRunner {
  return async (cmd, args) => {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return {
      exitCode: typeof exitCode === 'number' ? exitCode : 1,
      stdout,
      stderr,
    }
  }
}

const realBuildFs: BuildFs = {
  mkdir: async (path, opts) => {
    await mkdir(path, opts)
  },
  rm,
  readFile: async (path) => new Uint8Array(await readFile(path)),
  readTextFile: async (path) => readFile(path, 'utf8'),
  writeFile: async (path, data) => {
    await writeFile(path, data)
  },
  copyFile,
  chmod,
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch (err) {
      if (isNodeErrorCode(err, 'ENOENT')) return false
      throw err
    }
  },
  stat: async (path) => stat(path),
}

async function readPackageVersion(cwd: string): Promise<string> {
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof pkg.version !== 'string') {
    throw new Error('package.json version must be a string')
  }
  return pkg.version
}

async function executableMode(path: string): Promise<number | null> {
  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile()) return null
    return fileStat.mode
  } catch (err) {
    if (isNodeErrorCode(err, 'ENOENT')) return null
    throw err
  }
}

async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if (isNodeErrorCode(err, 'ENOENT')) return null
    throw err
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (err) {
    if (isNodeErrorCode(err, 'ENOENT')) return false
    throw err
  }
}

function finish(ok: boolean, steps: SmokeResult['steps'], start: number): SmokeResult {
  return { ok, steps, durationMs: performance.now() - start }
}

async function cleanupSmokeTempDirs(
  paths: readonly string[],
  rmFn: (path: string, opts: { recursive?: boolean; force?: boolean }) => Promise<void> = rm,
): Promise<string[]> {
  const errors: string[] = []
  for (const path of paths) {
    try {
      await rmFn(path, { recursive: true, force: true })
    } catch (err) {
      errors.push(`${path}: ${formatUnknownError(err)}`)
    }
  }
  return errors
}

function commandFailure(result: RunSpawnResult): string {
  if (result.timedOut) {
    const output = lastLines(result.stderr || result.stdout, 20)
    const killMessage =
      result.timeoutKillError === null ? '' : `; kill failed: ${result.timeoutKillError}`
    return output.length > 0
      ? `timed out after ${result.timeoutMs}ms${killMessage}: ${output}`
      : `timed out after ${result.timeoutMs}ms${killMessage}`
  }
  const output = lastLines(result.stderr || result.stdout, 20)
  return output.length > 0 ? `exit ${result.exitCode}: ${output}` : `exit ${result.exitCode}`
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/).slice(-count).join('\n').trim()
}

function isNodeErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  )
}

function formatUnknownError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

if (import.meta.main) {
  runCli()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`smoke: ${formatUnknownError(err)}\n`)
      process.exit(1)
    })
}
