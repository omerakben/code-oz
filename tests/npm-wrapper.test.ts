import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WRAPPER_PATH = join(process.cwd(), 'npm-wrapper/index.cjs')
const PACKAGE_VERSION = (() => {
  const pkg = JSON.parse(
    require('node:fs').readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as { version: string }
  return pkg.version
})()

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('npm-wrapper/index.js', () => {
  test('exists at the .cjs path bin will point to', () => {
    expect(existsSync(WRAPPER_PATH)).toBe(true)
  })

  test('cache hit: reuses cached binary without downloading', async () => {
    const fx = await createWrapperFixture()
    const cachedBinary = join(fx.cacheDir, PACKAGE_VERSION, 'code-oz')
    await mkdir(join(fx.cacheDir, PACKAGE_VERSION), { recursive: true })
    await writeFile(cachedBinary, '#!/bin/sh\necho cache-hit-binary "$@"\n')
    await chmod(cachedBinary, 0o755)

    const result = await runWrapper(fx, {
      CODE_OZ_NPM_BASE_URL: 'file:///nonexistent-store-cache-hit-should-skip',
    }, ['--echo-args', 'hello'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('cache-hit-binary --echo-args hello')
  })

  test('cache miss: downloads + verifies + extracts + execs', async () => {
    const fx = await createWrapperFixture()
    const release = await createReleaseStore({
      version: `v${PACKAGE_VERSION}`,
      os: detectHostOs(),
      arch: detectHostArch(),
      binaryText: '#!/bin/sh\necho first-run-installed "$@"\n',
    })

    const result = await runWrapper(fx, {
      CODE_OZ_NPM_BASE_URL: `file://${release.dir}`,
    }, ['from-npm'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('first-run-installed from-npm')
    expect(existsSync(join(fx.cacheDir, PACKAGE_VERSION, 'code-oz'))).toBe(true)
  })

  test('second invocation reuses cached binary even when source URL is gone', async () => {
    const fx = await createWrapperFixture()
    const release = await createReleaseStore({
      version: `v${PACKAGE_VERSION}`,
      os: detectHostOs(),
      arch: detectHostArch(),
      binaryText: '#!/bin/sh\necho cached "$@"\n',
    })

    const first = await runWrapper(fx, {
      CODE_OZ_NPM_BASE_URL: `file://${release.dir}`,
    }, ['initial'])
    expect(first.exitCode).toBe(0)

    // Wipe the release store; the cache must still serve subsequent calls.
    await rm(release.dir, { recursive: true, force: true })

    const second = await runWrapper(fx, {
      CODE_OZ_NPM_BASE_URL: 'file:///gone',
    }, ['second'])
    expect(second.exitCode).toBe(0)
    expect(second.stdout).toContain('cached second')
  })

  test('fails closed on SHA mismatch', async () => {
    const fx = await createWrapperFixture()
    const release = await createReleaseStore({
      version: `v${PACKAGE_VERSION}`,
      os: detectHostOs(),
      arch: detectHostArch(),
      binaryText: '#!/bin/sh\necho original\n',
    })
    await writeFile(join(release.dir, release.assetName), Buffer.from('tampered'))

    const result = await runWrapper(fx, {
      CODE_OZ_NPM_BASE_URL: `file://${release.dir}`,
    }, [])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toLowerCase()).toContain('checksum')
    expect(existsSync(join(fx.cacheDir, PACKAGE_VERSION, 'code-oz'))).toBe(false)
  })

  test('fails closed when checksum entry is missing', async () => {
    const fx = await createWrapperFixture()
    const release = await createReleaseStore({
      version: `v${PACKAGE_VERSION}`,
      os: detectHostOs(),
      arch: detectHostArch(),
      binaryText: '#!/bin/sh\necho any\n',
    })
    await writeFile(join(release.dir, 'checksums.txt'), '0  unrelated.tar.gz\n')

    const result = await runWrapper(fx, {
      CODE_OZ_NPM_BASE_URL: `file://${release.dir}`,
    }, [])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toLowerCase()).toContain('checksum entry')
    expect(existsSync(join(fx.cacheDir, PACKAGE_VERSION, 'code-oz'))).toBe(false)
  })

  test('fails closed when download fails (no release store)', async () => {
    const fx = await createWrapperFixture()
    const result = await runWrapper(fx, {
      CODE_OZ_NPM_BASE_URL: `file:///nope-${Date.now()}`,
    }, [])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toLowerCase()).toContain('download')
    expect(existsSync(join(fx.cacheDir, PACKAGE_VERSION, 'code-oz'))).toBe(false)
  })
})

interface WrapperFixture {
  readonly cacheDir: string
  readonly homeDir: string
}

async function createWrapperFixture(): Promise<WrapperFixture> {
  const root = await mkdtemp(join(tmpdir(), 'npm-wrapper-test-'))
  tempDirs.push(root)
  const cacheDir = join(root, 'cache')
  const homeDir = join(root, 'home')
  await mkdir(cacheDir, { recursive: true })
  await mkdir(homeDir, { recursive: true })
  return { cacheDir, homeDir }
}

interface ReleaseStore {
  readonly dir: string
  readonly assetName: string
  readonly assetSha256: string
}

async function createReleaseStore(opts: {
  version: string
  os: string
  arch: string
  binaryText: string
}): Promise<ReleaseStore> {
  const versionNum = opts.version.startsWith('v') ? opts.version.slice(1) : opts.version
  const stageName = `code-oz-v${versionNum}-${opts.os}-${opts.arch}`
  const assetName = `${stageName}.tar.gz`
  const releaseDir = await mkdtemp(join(tmpdir(), 'wrapper-release-'))
  tempDirs.push(releaseDir)
  const stageDir = join(releaseDir, stageName)
  await mkdir(stageDir, { recursive: true })
  await writeFile(join(stageDir, 'code-oz'), opts.binaryText)
  await chmod(join(stageDir, 'code-oz'), 0o755)
  await runCommand(['tar', '-C', releaseDir, '-czf', join(releaseDir, assetName), stageName])
  const bytes = new Uint8Array(await readFile(join(releaseDir, assetName)))
  const assetSha256 = createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(releaseDir, 'checksums.txt'), `${assetSha256}  ${assetName}\n`)
  await rm(stageDir, { recursive: true, force: true })
  return { dir: releaseDir, assetName, assetSha256 }
}

async function runWrapper(
  fx: WrapperFixture,
  env: Record<string, string>,
  args: readonly string[],
): Promise<CommandResult> {
  return runCommand(
    ['node', WRAPPER_PATH, ...args],
    process.cwd(),
    {
      ...process.env,
      HOME: fx.homeDir,
      CODE_OZ_NPM_CACHE_DIR: fx.cacheDir,
      ...env,
    },
  )
}

async function runCommand(
  args: string[],
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  const proc = Bun.spawn(args, {
    cwd,
    env,
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

function detectHostOs(): string {
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'linux') return 'linux'
  throw new Error(`unsupported test platform: ${process.platform}`)
}

function detectHostArch(): string {
  if (process.arch === 'arm64') return 'arm64'
  if (process.arch === 'x64') return 'x64'
  throw new Error(`unsupported test arch: ${process.arch}`)
}

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}
