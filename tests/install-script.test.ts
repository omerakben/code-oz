import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const VERSION = '0.17.0-alpha.0'
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('scripts/install.sh', () => {
  test('passes POSIX and bash syntax validation', async () => {
    await expect(runCommand(['sh', '-n', 'scripts/install.sh'], process.cwd())).resolves.toMatchObject({
      exitCode: 0,
    })
    await expect(runCommand(['bash', '-n', 'scripts/install.sh'], process.cwd())).resolves.toMatchObject({
      exitCode: 0,
    })
  })

  test('reads manifest target fields and installs the referenced binary', async () => {
    const bundle = await createBundle({
      binaryRelativePath: 'custom/darwin-arm64/code-oz-from-manifest',
      binaryText: '#!/bin/sh\necho hello-from-manifest\n',
    })
    await mkdir(join(bundle.root, 'darwin-arm64'), { recursive: true })
    await writeFile(join(bundle.root, 'darwin-arm64/code-oz'), 'decoy\n')

    const result = await runInstall(bundle)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
    expect(await readFile(join(bundle.installDir, 'code-oz'), 'utf8')).toBe(
      '#!/bin/sh\necho hello-from-manifest\n',
    )
    expect((await stat(join(bundle.installDir, 'code-oz'))).mode & 0o111).not.toBe(0)
  })

  test('fails closed on sha256 mismatch', async () => {
    const bundle = await createBundle({ manifestSha256: '0'.repeat(64) })

    const result = await runInstall(bundle)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('sha256 mismatch')
    expect(existsSync(join(bundle.installDir, 'code-oz'))).toBe(false)
  })

  test('fails closed on size mismatch', async () => {
    const bundle = await createBundle({ sizeBytes: 999 })

    const result = await runInstall(bundle)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('size mismatch')
    expect(existsSync(join(bundle.installDir, 'code-oz'))).toBe(false)
  })

  test('fails closed when no manifest target matches the host', async () => {
    const bundle = await createBundle({
      targets: [
        {
          os: 'linux',
          arch: 'ppc',
          bunTarget: 'bun-linux-ppc',
          binaryRelativePath: 'linux-ppc/code-oz',
          sha256: '1'.repeat(64),
          sizeBytes: 1,
          version: VERSION,
        },
      ],
    })

    const result = await runInstall(bundle)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('no matching target row')
  })

  test('is idempotent across repeated installs', async () => {
    const bundle = await createBundle({ binaryText: '#!/bin/sh\necho repeat\n' })

    const first = await runInstall(bundle)
    const firstBytes = await readFile(join(bundle.installDir, 'code-oz'))
    const second = await runInstall(bundle)
    const secondBytes = await readFile(join(bundle.installDir, 'code-oz'))

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(Buffer.compare(firstBytes, secondBytes)).toBe(0)
    expect(second.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
  })

  test('prints PATH hint only when install dir is absent from PATH', async () => {
    const missingPathBundle = await createBundle()
    const missingPath = await runInstall(missingPathBundle, {
      PATH: `${missingPathBundle.toolsDir}:/usr/bin:/bin`,
    })

    const presentPathBundle = await createBundle()
    const presentPath = await runInstall(presentPathBundle, {
      PATH: `${presentPathBundle.installDir}:${presentPathBundle.toolsDir}:/usr/bin:/bin`,
    })

    expect(missingPath.exitCode).toBe(0)
    expect(missingPath.stdout).toContain('PATH hint')
    expect(missingPath.stdout).toContain(`export PATH="${missingPathBundle.installDir}:$PATH"`)
    expect(presentPath.exitCode).toBe(0)
    expect(presentPath.stdout).not.toContain('PATH hint')
  })

  test('does not create or modify shell rc files', async () => {
    const bundle = await createBundle()
    const zshrc = join(bundle.homeDir, '.zshrc')
    const bashrc = join(bundle.homeDir, '.bashrc')
    await writeFile(zshrc, 'zshrc-before\n')
    await writeFile(bashrc, 'bashrc-before\n')
    const beforeZsh = await stat(zshrc)
    const beforeBash = await stat(bashrc)

    const result = await runInstall(bundle)

    expect(result.exitCode).toBe(0)
    expect(await readFile(zshrc, 'utf8')).toBe('zshrc-before\n')
    expect(await readFile(bashrc, 'utf8')).toBe('bashrc-before\n')
    expect((await stat(zshrc)).mtimeMs).toBe(beforeZsh.mtimeMs)
    expect((await stat(bashrc)).mtimeMs).toBe(beforeBash.mtimeMs)

    const emptyHomeBundle = await createBundle()
    const emptyHomeResult = await runInstall(emptyHomeBundle)
    expect(emptyHomeResult.exitCode).toBe(0)
    expect(existsSync(join(emptyHomeBundle.homeDir, '.zshrc'))).toBe(false)
    expect(existsSync(join(emptyHomeBundle.homeDir, '.bashrc'))).toBe(false)
  })
})

describe('scripts/install.sh — SHA256 tool chain (W3a)', () => {
  test('fails closed when no SHA256 tool is available', async () => {
    const bundle = await createBundle()
    const result = await runInstall(bundle, { CODE_OZ_SHA_TOOL: 'none' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('no SHA256 tool found')
    expect(result.stderr).toContain('sha256sum')
    expect(result.stderr).toContain('shasum')
    expect(result.stderr).toContain('openssl')
    expect(existsSync(join(bundle.installDir, 'code-oz'))).toBe(false)
  })

  test('rejects invalid SHA tool override', async () => {
    const bundle = await createBundle()
    const result = await runInstall(bundle, { CODE_OZ_SHA_TOOL: 'md5sum' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('invalid CODE_OZ_SHA_TOOL')
    expect(existsSync(join(bundle.installDir, 'code-oz'))).toBe(false)
  })

  test('verifies SHA via sha256sum (Linux primary tool)', async () => {
    const binaryText = '#!/bin/sh\necho hello-sha256sum\n'
    const bundle = await createBundle({ binaryText })
    await writeFakeSha256sum(bundle.toolsDir, sha256(binaryText))
    const result = await runInstall(bundle, { CODE_OZ_SHA_TOOL: 'sha256sum' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
  })

  test('verifies SHA via shasum (macOS primary tool)', async () => {
    const binaryText = '#!/bin/sh\necho hello-shasum\n'
    const bundle = await createBundle({ binaryText })
    const result = await runInstall(bundle, { CODE_OZ_SHA_TOOL: 'shasum' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
  })

  test('verifies SHA via openssl (cross-platform fallback)', async () => {
    const binaryText = '#!/bin/sh\necho hello-openssl\n'
    const bundle = await createBundle({ binaryText })
    await writeFakeOpenssl(bundle.toolsDir, sha256(binaryText))
    const result = await runInstall(bundle, { CODE_OZ_SHA_TOOL: 'openssl' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
  })

  test('fails on SHA mismatch under sha256sum branch', async () => {
    const bundle = await createBundle({ manifestSha256: '0'.repeat(64) })
    await writeFakeSha256sum(bundle.toolsDir, sha256('#!/bin/sh\necho hello\n'))
    const result = await runInstall(bundle, { CODE_OZ_SHA_TOOL: 'sha256sum' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('sha256 mismatch')
    expect(existsSync(join(bundle.installDir, 'code-oz'))).toBe(false)
  })
})

describe('scripts/install.sh — Linux detection (W3a)', () => {
  test('installs on linux-x64 with x86_64 uname', async () => {
    const binaryText = '#!/bin/sh\necho linux-x64\n'
    const bundle = await createBundle({
      binaryRelativePath: 'linux-x64/code-oz',
      binaryText,
      targets: [
        {
          os: 'linux',
          arch: 'x64',
          bunTarget: 'bun-linux-x64',
          binaryRelativePath: 'linux-x64/code-oz',
          sha256: sha256(binaryText),
          sizeBytes: Buffer.byteLength(binaryText),
          version: VERSION,
        },
      ],
    })
    const result = await runInstall(bundle, {
      OS_OVERRIDE: 'linux',
      ARCH_OVERRIDE: 'x86_64',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
    expect(await readFile(join(bundle.installDir, 'code-oz'), 'utf8')).toBe(binaryText)
  })

  test('installs on linux-arm64 with aarch64 alias', async () => {
    const binaryText = '#!/bin/sh\necho linux-arm64\n'
    const bundle = await createBundle({
      binaryRelativePath: 'linux-arm64/code-oz',
      binaryText,
      targets: [
        {
          os: 'linux',
          arch: 'arm64',
          bunTarget: 'bun-linux-arm64',
          binaryRelativePath: 'linux-arm64/code-oz',
          sha256: sha256(binaryText),
          sizeBytes: Buffer.byteLength(binaryText),
          version: VERSION,
        },
      ],
    })
    const result = await runInstall(bundle, {
      OS_OVERRIDE: 'linux',
      ARCH_OVERRIDE: 'aarch64',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
  })

  test('does not invoke xattr on linux installs', async () => {
    const binaryText = '#!/bin/sh\necho linux-no-xattr\n'
    const bundle = await createBundle({
      binaryRelativePath: 'linux-x64/code-oz',
      binaryText,
      targets: [
        {
          os: 'linux',
          arch: 'x64',
          bunTarget: 'bun-linux-x64',
          binaryRelativePath: 'linux-x64/code-oz',
          sha256: sha256(binaryText),
          sizeBytes: Buffer.byteLength(binaryText),
          version: VERSION,
        },
      ],
    })
    const xattrLog = join(bundle.toolsDir, 'xattr.log')
    await writeFakeXattr(bundle.toolsDir, xattrLog)
    const result = await runInstall(bundle, {
      OS_OVERRIDE: 'linux',
      ARCH_OVERRIDE: 'x86_64',
    })

    expect(result.exitCode).toBe(0)
    expect(existsSync(xattrLog)).toBe(false)
  })

  test('fails closed on unsupported OS', async () => {
    const bundle = await createBundle()
    const result = await runInstall(bundle, {
      OS_OVERRIDE: 'freebsd',
      ARCH_OVERRIDE: 'x86_64',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('unsupported OS')
    expect(result.stderr.toLowerCase()).toContain('darwin')
    expect(result.stderr.toLowerCase()).toContain('linux')
  })
})

describe('scripts/install.sh — CLI flags (W3a)', () => {
  test('--help prints usage and exits 0', async () => {
    const bundle = await createBundle()
    const result = await runInstall(bundle, {}, ['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toLowerCase()).toContain('usage')
    expect(result.stdout).toContain('--version')
  })

  test('--version flag is accepted in bundle-local mode', async () => {
    const bundle = await createBundle()
    const result = await runInstall(bundle, {}, ['--version', 'v0.20.0-alpha.0'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`code-oz installed at ${bundle.installDir}/code-oz`)
  })

  test('unknown flag fails closed', async () => {
    const bundle = await createBundle()
    const result = await runInstall(bundle, {}, ['--nope'])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('unknown argument')
  })
})

async function createBundle(opts: {
  binaryRelativePath?: string
  binaryText?: string
  manifestSha256?: string
  sizeBytes?: number
  targets?: ManifestTarget[]
} = {}): Promise<InstallBundle> {
  const root = await mkdtemp(join(tmpdir(), 'install-test-'))
  tempDirs.push(root)
  const installDir = join(root, 'bin')
  const homeDir = join(root, 'home')
  const toolsDir = join(root, 'tools')
  await mkdir(homeDir, { recursive: true })
  await mkdir(toolsDir, { recursive: true })
  await copyFile(join(process.cwd(), 'scripts/install.sh'), join(root, 'install.sh'))

  const binaryRelativePath = opts.binaryRelativePath ?? 'darwin-arm64/code-oz'
  const binaryText = opts.binaryText ?? '#!/bin/sh\necho hello\n'
  const binaryPath = join(root, binaryRelativePath)
  await mkdir(dirname(binaryPath), { recursive: true })
  await writeFile(binaryPath, binaryText)

  const actualSha256 = sha256(binaryText)
  const targets =
    opts.targets ??
    targetRows({
      binaryRelativePath,
      sha256: opts.manifestSha256 ?? actualSha256,
      sizeBytes: opts.sizeBytes ?? Buffer.byteLength(binaryText),
    })
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        version: VERSION,
        builtAt: '2026-05-02T05:00:00.000Z',
        targets,
      },
      null,
      2,
    ),
  )
  await writeFakeShasum(toolsDir, actualSha256)
  return { root, installDir, homeDir, toolsDir }
}

function targetRows(opts: {
  binaryRelativePath: string
  sha256: string
  sizeBytes: number
}): ManifestTarget[] {
  return [
    {
      os: 'darwin',
      arch: 'arm64',
      bunTarget: 'bun-darwin-arm64',
      binaryRelativePath: opts.binaryRelativePath,
      sha256: opts.sha256,
      sizeBytes: opts.sizeBytes,
      version: VERSION,
    },
    {
      os: 'darwin',
      arch: 'x64',
      bunTarget: 'bun-darwin-x64',
      binaryRelativePath: 'darwin-x64/code-oz',
      sha256: '2'.repeat(64),
      sizeBytes: 2,
      version: VERSION,
    },
  ]
}

async function writeFakeShasum(toolsDir: string, sha: string): Promise<void> {
  const path = join(toolsDir, 'shasum')
  await writeFile(path, `#!/bin/sh\necho "${sha}  $3"\n`)
  await chmod(path, 0o755)
}

async function writeFakeSha256sum(toolsDir: string, sha: string): Promise<void> {
  const path = join(toolsDir, 'sha256sum')
  await writeFile(path, `#!/bin/sh\necho "${sha}  $1"\n`)
  await chmod(path, 0o755)
}

async function writeFakeOpenssl(toolsDir: string, sha: string): Promise<void> {
  const path = join(toolsDir, 'openssl')
  await writeFile(
    path,
    `#!/bin/sh\nif [ "$1" = "dgst" ] && [ "$2" = "-sha256" ]; then\n  echo "SHA2-256(\${3})= ${sha}"\nelse\n  exit 1\nfi\n`,
  )
  await chmod(path, 0o755)
}

async function writeFakeXattr(toolsDir: string, logPath: string): Promise<void> {
  const path = join(toolsDir, 'xattr')
  await writeFile(path, `#!/bin/sh\necho "$@" >> "${logPath}"\n`)
  await chmod(path, 0o755)
}

async function runInstall(
  bundle: InstallBundle,
  env: Record<string, string> = {},
  args: readonly string[] = [],
): Promise<CommandResult> {
  return runCommand(['sh', './install.sh', ...args], bundle.root, {
    ...process.env,
    HOME: bundle.homeDir,
    CODE_OZ_INSTALL_DIR: bundle.installDir,
    PATH: `${bundle.toolsDir}:/usr/bin:/bin`,
    OS_OVERRIDE: 'darwin',
    ARCH_OVERRIDE: 'arm64',
    ...env,
  })
}

async function runCommand(
  args: string[],
  cwd: string,
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

interface InstallBundle {
  readonly root: string
  readonly installDir: string
  readonly homeDir: string
  readonly toolsDir: string
}

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

interface ManifestTarget {
  readonly os: string
  readonly arch: string
  readonly bunTarget: string
  readonly binaryRelativePath: string
  readonly sha256: string
  readonly sizeBytes: number
  readonly version: string
}
