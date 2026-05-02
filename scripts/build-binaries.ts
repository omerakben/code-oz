#!/usr/bin/env bun
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface Target {
  readonly os: string
  readonly arch: string
  readonly bunTarget: string
  readonly binaryRelativePath: string
}

export const TARGETS = [
  { os: 'darwin', arch: 'arm64', bunTarget: 'bun-darwin-arm64', binaryRelativePath: 'darwin-arm64/code-oz' },
  { os: 'darwin', arch: 'x64', bunTarget: 'bun-darwin-x64', binaryRelativePath: 'darwin-x64/code-oz' },
] as const satisfies ReadonlyArray<Target>

export interface ManifestRow {
  readonly os: string
  readonly arch: string
  readonly bunTarget: string
  readonly binaryRelativePath: string
  readonly sha256: string
  readonly sizeBytes: number
  readonly version: string
}

export interface Manifest {
  readonly schemaVersion: 1
  readonly version: string
  readonly builtAt: string
  readonly targets: ManifestRow[]
}

export type CommandRunner = (
  cmd: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export interface BuildFs {
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<{ size: number }>
}

export function targetForHost(uname: { os: string; arch: string }): Target | null {
  const os = uname.os.toLowerCase()
  const arch = normalizeArch(uname.arch)
  if (os !== 'darwin' || arch === null) return null
  return TARGETS.find((target) => target.os === os && target.arch === arch) ?? null
}

export function manifestForTargets(
  version: string,
  builtAt: string,
  rows: ManifestRow[],
): Manifest {
  return {
    schemaVersion: 1,
    version,
    builtAt,
    targets: rows,
  }
}

export function manifestRow(
  target: Target,
  sha256: string,
  sizeBytes: number,
  version: string,
): ManifestRow {
  return {
    os: target.os,
    arch: target.arch,
    bunTarget: target.bunTarget,
    binaryRelativePath: target.binaryRelativePath,
    sha256,
    sizeBytes,
    version,
  }
}

export async function sha256OfBuffer(buf: Uint8Array): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(buf)
  return hasher.digest('hex')
}

export function formatTargetTriple(target: Target): string {
  return `${target.os}-${target.arch}`
}

export async function buildAll(opts: {
  runner: CommandRunner
  version: string
  cwd: string
  mode: 'force' | 'ensure'
  fs: BuildFs
  now: () => Date
}): Promise<{ ok: boolean; manifest: Manifest | null; errors: string[] }> {
  const distRoot = join(opts.cwd, 'dist')
  const handoffRoot = join(distRoot, 'handoff')
  const manifestPath = join(handoffRoot, 'manifest.json')

  if (opts.mode === 'force') {
    for (const target of TARGETS) {
      await opts.fs.rm(join(distRoot, formatTargetTriple(target)), {
        recursive: true,
        force: true,
      })
    }
    await opts.fs.rm(handoffRoot, { recursive: true, force: true })
  }

  await opts.fs.mkdir(handoffRoot, { recursive: true })

  const existingManifest =
    opts.mode === 'ensure'
      ? await readExistingManifest(opts.fs, manifestPath, opts.version)
      : null

  const rows: ManifestRow[] = []
  let rebuiltAny = false

  for (const target of TARGETS) {
    const localBinaryPath = join(distRoot, formatTargetTriple(target), 'code-oz')
    const handoffBinaryPath = join(handoffRoot, target.binaryRelativePath)
    const existingRow = findMatchingRow(existingManifest, target, opts.version)

    if (
      existingRow !== null &&
      (await binaryMatches(opts.fs, localBinaryPath, existingRow)) &&
      (await binaryMatches(opts.fs, handoffBinaryPath, existingRow))
    ) {
      await opts.fs.chmod(localBinaryPath, 0o755)
      await opts.fs.chmod(handoffBinaryPath, 0o755)
      rows.push(existingRow)
      continue
    }

    rebuiltAny = true
    await opts.fs.mkdir(dirname(localBinaryPath), { recursive: true })
    await opts.fs.mkdir(dirname(handoffBinaryPath), { recursive: true })

    const result = await runBuild(opts.runner, target, localBinaryPath)
    if (result.exitCode !== 0) {
      return {
        ok: false,
        manifest: null,
        errors: [formatBuildError(target, result)],
      }
    }

    await opts.fs.copyFile(localBinaryPath, handoffBinaryPath)
    await opts.fs.chmod(localBinaryPath, 0o755)
    await opts.fs.chmod(handoffBinaryPath, 0o755)

    const bytes = await opts.fs.readFile(handoffBinaryPath)
    const fileStat = await opts.fs.stat(handoffBinaryPath)
    rows.push(manifestRow(target, await sha256OfBuffer(bytes), fileStat.size, opts.version))
  }

  const installerError = await copyHandoffInstaller(opts.fs, opts.cwd, handoffRoot)
  if (installerError !== null) {
    return { ok: false, manifest: null, errors: [installerError] }
  }

  if (existingManifest !== null && !rebuiltAny) {
    return { ok: true, manifest: existingManifest, errors: [] }
  }

  const manifest = manifestForTargets(opts.version, opts.now().toISOString(), rows)
  await opts.fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return { ok: true, manifest, errors: [] }
}

const realFs: BuildFs = {
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

function normalizeArch(arch: string): 'arm64' | 'x64' | null {
  const normalized = arch.toLowerCase()
  if (normalized === 'arm64') return 'arm64'
  if (normalized === 'x64' || normalized === 'x86_64') return 'x64'
  return null
}

async function readExistingManifest(
  fs: BuildFs,
  manifestPath: string,
  version: string,
): Promise<Manifest | null> {
  if (!(await fs.exists(manifestPath))) return null
  const parsed = JSON.parse(await fs.readTextFile(manifestPath)) as unknown
  if (!isManifest(parsed)) return null
  if (parsed.version !== version) return null
  if (parsed.targets.some((row) => row.version !== version)) return null
  return parsed
}

function findMatchingRow(
  manifest: Manifest | null,
  target: Target,
  version: string,
): ManifestRow | null {
  if (manifest === null) return null
  return (
    manifest.targets.find(
      (row) =>
        row.os === target.os &&
        row.arch === target.arch &&
        row.bunTarget === target.bunTarget &&
        row.binaryRelativePath === target.binaryRelativePath &&
        row.version === version,
    ) ?? null
  )
}

async function binaryMatches(
  fs: BuildFs,
  path: string,
  row: ManifestRow,
): Promise<boolean> {
  if (!(await fs.exists(path))) return false
  const fileStat = await fs.stat(path)
  if (fileStat.size !== row.sizeBytes) return false
  const bytes = await fs.readFile(path)
  return (await sha256OfBuffer(bytes)) === row.sha256
}

async function copyHandoffInstaller(
  fs: BuildFs,
  cwd: string,
  handoffRoot: string,
): Promise<string | null> {
  const srcInstallPath = join(cwd, 'scripts/install.sh')
  const handoffInstallPath = join(handoffRoot, 'install.sh')
  if (!(await fs.exists(srcInstallPath))) {
    return 'build-binaries: missing scripts/install.sh; cannot write dist/handoff/install.sh'
  }
  try {
    await fs.copyFile(srcInstallPath, handoffInstallPath)
    await fs.chmod(handoffInstallPath, 0o755)
    return null
  } catch (err) {
    return `build-binaries: failed to copy scripts/install.sh to dist/handoff/install.sh: ${formatUnknownError(err)}`
  }
}

async function runBuild(
  runner: CommandRunner,
  target: Target,
  outfile: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    return await runner('bun', [
      'build',
      '--compile',
      `--target=${target.bunTarget}`,
      'src/cli.ts',
      '--outfile',
      outfile,
    ])
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    }
  }
}

function formatBuildError(
  target: Target,
  result: { exitCode: number; stdout: string; stderr: string },
): string {
  const triple = formatTargetTriple(target)
  const tail = lastLines(result.stderr || result.stdout, 30)
  const base = `${triple} build failed with exit code ${result.exitCode}`
  if (isToolchainFailure(target, result.stderr)) {
    return `TOOLCHAIN_FAIL: ${base}\n${tail}`
  }
  return `${base}\n${tail}`
}

function isToolchainFailure(target: Target, stderr: string): boolean {
  const lower = stderr.toLowerCase()
  return (
    lower.includes('failed to download') ||
    lower.includes('could not download') ||
    (lower.includes('download') && lower.includes(target.bunTarget.toLowerCase()))
  )
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/).slice(-count).join('\n').trim()
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Manifest>
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.version === 'string' &&
    typeof candidate.builtAt === 'string' &&
    Array.isArray(candidate.targets) &&
    candidate.targets.every(isManifestRow)
  )
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

function createRealRunner(cwd: string): CommandRunner {
  return async (cmd, args) => {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    return {
      exitCode: typeof exitCode === 'number' ? exitCode : 1,
      stdout,
      stderr,
    }
  }
}

async function readPackageVersion(cwd: string, fs: BuildFs): Promise<string> {
  const pkg = JSON.parse(await fs.readTextFile(join(cwd, 'package.json'))) as {
    version?: unknown
  }
  if (typeof pkg.version !== 'string') {
    throw new Error('package.json version must be a string')
  }
  return pkg.version
}

function parseMode(argv: string[]): 'force' | 'ensure' {
  let mode: 'force' | 'ensure' = 'ensure'
  for (const arg of argv) {
    if (arg === '--force') {
      mode = 'force'
    } else if (arg === '--ensure') {
      mode = 'ensure'
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  return mode
}

function printManifest(manifest: Manifest): void {
  process.stdout.write(`code-oz binaries ready: ${manifest.version}\n`)
  for (const row of manifest.targets) {
    process.stdout.write(
      `- ${row.os}-${row.arch} dist/handoff/${row.binaryRelativePath} ${row.sha256} ${row.sizeBytes} bytes\n`,
    )
  }
  process.stdout.write('manifest: dist/handoff/manifest.json\n')
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
  try {
    const cwd = process.cwd()
    const mode = parseMode(process.argv.slice(2))
    const version = await readPackageVersion(cwd, realFs)
    const result = await buildAll({
      runner: createRealRunner(cwd),
      version,
      cwd,
      mode,
      fs: realFs,
      now: () => new Date(),
    })
    if (!result.ok || result.manifest === null) {
      const message = result.errors.join('\n')
      process.stderr.write(`${message}\n`)
      process.exit(message.includes('TOOLCHAIN_FAIL:') ? 2 : 1)
    }
    printManifest(result.manifest)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`build-binaries: ${message}\n`)
    process.exit(1)
  }
}
