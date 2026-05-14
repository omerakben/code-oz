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
  { os: 'linux', arch: 'x64', bunTarget: 'bun-linux-x64', binaryRelativePath: 'linux-x64/code-oz' },
  { os: 'linux', arch: 'arm64', bunTarget: 'bun-linux-arm64', binaryRelativePath: 'linux-arm64/code-oz' },
] as const satisfies ReadonlyArray<Target>

const HANDOFF_README_TEMPLATE = `# code-oz <version>

A multi-target binary distribution of code-oz for macOS and Linux (arm64 + x64).

## Install

\`\`\`sh
sh ./install.sh
\`\`\`

The script:
- Detects your OS (\`uname -s\`) and CPU architecture (\`uname -m\`).
- Verifies the binary SHA256 against \`manifest.json\` using \`sha256sum\` (Linux primary), \`shasum -a 256\` (macOS primary), or \`openssl dgst -sha256\` (fallback). Refuses to install when none of these tools is available.
- Copies the matching binary to \`~/.local/bin/code-oz\`.
- Strips the macOS quarantine attribute on darwin only.
- Prints a \`PATH\` hint if \`~/.local/bin\` is not on your \`$PATH\`.

It does NOT modify your shell startup files. If you need to add \`~/.local/bin\` to your \`PATH\`, add this line to the rc file you actually use (\`~/.zshrc\` or \`~/.bashrc\`):

\`\`\`sh
export PATH="$HOME/.local/bin:$PATH"
\`\`\`

## Verify

\`\`\`sh
code-oz --version
\`\`\`

Should print: \`<version>\`.

## Custom install location

Set \`CODE_OZ_INSTALL_DIR\` before running install.sh:

\`\`\`sh
CODE_OZ_INSTALL_DIR="$HOME/bin" sh ./install.sh
\`\`\`

## Manifest

\`manifest.json\` records the schemaVersion, version, builtAt timestamp, and per-target sha256 + size. The installer reads it explicitly - no derivation from filenames.

## Bundle contents

\`\`\`text
.
|-- install.sh
|-- manifest.json
|-- README.md
|-- darwin-arm64/
|   \`-- code-oz
|-- darwin-x64/
|   \`-- code-oz
|-- linux-arm64/
|   \`-- code-oz
\`-- linux-x64/
    \`-- code-oz
\`\`\`

## Status

This is a W3a alpha distribution. The official curl|sh, npm, and Homebrew channels for the release tag land alongside this bundle on the GitHub release. Windows + Scoop is deferred to v0.20.1.
`

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

export interface BuildResult {
  readonly ok: boolean
  readonly manifest: Manifest | null
  readonly errors: string[]
  readonly tarballPath: string | null
  readonly manifestParseError: string | null
}

interface ExistingManifestRead {
  readonly manifest: Manifest | null
  readonly parseError: string | null
}

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
  if (arch === null) return null
  if (os !== 'darwin' && os !== 'linux') return null
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

export function renderHandoffReadme(version: string): string {
  return HANDOFF_README_TEMPLATE.replaceAll('<version>', version)
}

export async function buildAll(opts: {
  runner: CommandRunner
  version: string
  cwd: string
  mode: 'force' | 'ensure'
  fs: BuildFs
  now: () => Date
  /**
   * Optional target filter. Defaults to all TARGETS (production behavior:
   * build all 4 binaries — darwin-arm64, darwin-x64, linux-x64, linux-arm64).
   * Tests pass a subset (e.g. darwin-only) to keep fixtures bounded.
   * Locked W3a: must be a subset of TARGETS; unknown bunTargets reject.
   */
  targets?: ReadonlyArray<Target>
}): Promise<BuildResult> {
  const targets = opts.targets ?? TARGETS
  const distRoot = join(opts.cwd, 'dist')
  const handoffRoot = join(distRoot, 'handoff')
  const manifestPath = join(handoffRoot, 'manifest.json')

  if (opts.mode === 'force') {
    for (const target of targets) {
      await opts.fs.rm(join(distRoot, formatTargetTriple(target)), {
        recursive: true,
        force: true,
      })
    }
    await opts.fs.rm(handoffRoot, { recursive: true, force: true })
  }

  await opts.fs.mkdir(handoffRoot, { recursive: true })

  const existingManifestRead =
    opts.mode === 'ensure'
      ? await readExistingManifest(opts.fs, manifestPath, opts.version)
      : { manifest: null, parseError: null }
  const existingManifest = existingManifestRead.manifest
  const manifestParseError = existingManifestRead.parseError

  const rows: ManifestRow[] = []
  let rebuiltAny = false

  for (const target of targets) {
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
      const cleanupError = await removePartialHandoff(opts.fs, handoffRoot)
      const errors = [formatBuildError(target, result)]
      if (cleanupError !== null) errors.push(cleanupError)
      return {
        ok: false,
        manifest: null,
        errors,
        tarballPath: null,
        manifestParseError,
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
    return { ok: false, manifest: null, errors: [installerError], tarballPath: null, manifestParseError }
  }

  const readmeError = await writeHandoffReadme(opts.fs, handoffRoot, opts.version)
  if (readmeError !== null) {
    return { ok: false, manifest: null, errors: [readmeError], tarballPath: null, manifestParseError }
  }

  const manifest =
    existingManifest !== null && !rebuiltAny
      ? existingManifest
      : manifestForTargets(opts.version, opts.now().toISOString(), rows)

  if (existingManifest === null || rebuiltAny) {
    await opts.fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  }

  const tarball = await createHandoffTarball({
    fs: opts.fs,
    runner: opts.runner,
    distRoot,
    handoffRoot,
    version: opts.version,
    manifest,
  })
  if (!tarball.ok) {
    return { ok: false, manifest: null, errors: tarball.errors, tarballPath: null, manifestParseError }
  }

  return { ok: true, manifest, errors: [], tarballPath: tarball.tarballPath, manifestParseError }
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
): Promise<ExistingManifestRead> {
  if (!(await fs.exists(manifestPath))) return { manifest: null, parseError: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readTextFile(manifestPath)) as unknown
  } catch (err) {
    return {
      manifest: null,
      parseError: `manifest.json invalid JSON: ${formatUnknownError(err)}`,
    }
  }
  if (!isManifest(parsed)) return { manifest: null, parseError: null }
  if (parsed.version !== version) return { manifest: null, parseError: null }
  if (parsed.targets.some((row) => row.version !== version)) {
    return { manifest: null, parseError: null }
  }
  return { manifest: parsed, parseError: null }
}

async function removePartialHandoff(fs: BuildFs, handoffRoot: string): Promise<string | null> {
  try {
    await fs.rm(handoffRoot, { recursive: true, force: true })
    return null
  } catch (err) {
    return `build-binaries: failed to remove partial dist/handoff after build failure: ${formatUnknownError(err)}`
  }
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

async function writeHandoffReadme(
  fs: BuildFs,
  handoffRoot: string,
  version: string,
): Promise<string | null> {
  try {
    await fs.writeFile(join(handoffRoot, 'README.md'), renderHandoffReadme(version))
    return null
  } catch (err) {
    return `build-binaries: failed to write dist/handoff/README.md: ${formatUnknownError(err)}`
  }
}

async function createHandoffTarball(opts: {
  fs: BuildFs
  runner: CommandRunner
  distRoot: string
  handoffRoot: string
  version: string
  manifest: Manifest
}): Promise<{ ok: true; tarballPath: string } | { ok: false; errors: string[] }> {
  const rootName = `code-oz-v${opts.version}-handoff`
  const stagingRoot = join(opts.distRoot, rootName)
  const tarballPath = join(opts.distRoot, `${rootName}.tar.gz`)

  try {
    await opts.fs.rm(stagingRoot, { recursive: true, force: true })
    await opts.fs.rm(tarballPath, { force: true })
    await opts.fs.mkdir(stagingRoot, { recursive: true })
    await opts.fs.copyFile(join(opts.handoffRoot, 'install.sh'), join(stagingRoot, 'install.sh'))
    await opts.fs.copyFile(join(opts.handoffRoot, 'manifest.json'), join(stagingRoot, 'manifest.json'))
    await opts.fs.copyFile(join(opts.handoffRoot, 'README.md'), join(stagingRoot, 'README.md'))
    await opts.fs.chmod(join(stagingRoot, 'install.sh'), 0o755)

    for (const row of opts.manifest.targets) {
      const stagedBinary = join(stagingRoot, row.binaryRelativePath)
      await opts.fs.mkdir(dirname(stagedBinary), { recursive: true })
      await opts.fs.copyFile(join(opts.handoffRoot, row.binaryRelativePath), stagedBinary)
      await opts.fs.chmod(stagedBinary, 0o755)
    }
  } catch (err) {
    return {
      ok: false,
      errors: [`build-binaries: failed to stage Darwin tarball layout: ${formatUnknownError(err)}`],
    }
  }

  let result: { exitCode: number; stdout: string; stderr: string }
  try {
    result = await opts.runner('tar', ['-czf', tarballPath, '-C', opts.distRoot, rootName])
  } catch (err) {
    return {
      ok: false,
      errors: [`build-binaries: failed to run tar: ${formatUnknownError(err)}`],
    }
  }

  if (result.exitCode !== 0) {
    return {
      ok: false,
      errors: [formatTarError(result)],
    }
  }

  return { ok: true, tarballPath }
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

function formatTarError(result: { exitCode: number; stdout: string; stderr: string }): string {
  const tail = lastLines(result.stderr || result.stdout, 30)
  return `build-binaries: tarball creation failed with exit code ${result.exitCode}\n${tail}`
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
  process.stdout.write(`tarball: ${manifestTarballPath(manifest.version)}\n`)
}

function manifestTarballPath(version: string): string {
  return `dist/code-oz-v${version}-handoff.tar.gz`
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
