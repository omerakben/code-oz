import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
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
import { dirname, join, normalize, sep } from 'node:path'

import {
  buildAll,
  formatTargetTriple,
  manifestForTargets,
  manifestRow,
  renderHandoffReadme,
  sha256OfBuffer,
  targetForHost,
  TARGETS,
  type BuildFs,
  type CommandRunner,
  type Manifest,
} from '../scripts/build-binaries.ts'

const VERSION = '0.16.0-alpha.0'
const BUILT_AT = '2026-05-02T04:30:00.000Z'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('targetForHost', () => {
  test('maps darwin arm64 to the arm64 target row', () => {
    expect(targetForHost({ os: 'darwin', arch: 'arm64' })).toEqual(TARGETS[0])
  })

  test('maps darwin x86_64 to the x64 target row', () => {
    expect(targetForHost({ os: 'darwin', arch: 'x86_64' })).toEqual(TARGETS[1])
  })

  test('maps darwin x64 to the x64 target row', () => {
    expect(targetForHost({ os: 'darwin', arch: 'x64' })).toEqual(TARGETS[1])
  })

  test('returns null for linux x64', () => {
    expect(targetForHost({ os: 'linux', arch: 'x64' })).toBeNull()
  })

  test('returns null for unsupported darwin arch', () => {
    expect(targetForHost({ os: 'darwin', arch: 'ppc' })).toBeNull()
  })
})

describe('manifest helpers', () => {
  test('manifestForTargets returns the locked flat schema', () => {
    const rows = [
      manifestRow(TARGETS[0], 'a'.repeat(64), 11, VERSION),
      manifestRow(TARGETS[1], 'b'.repeat(64), 22, VERSION),
    ]

    const manifest = manifestForTargets(VERSION, BUILT_AT, rows)

    expect(manifest).toEqual({
      schemaVersion: 1,
      version: VERSION,
      builtAt: BUILT_AT,
      targets: [
        {
          os: 'darwin',
          arch: 'arm64',
          bunTarget: 'bun-darwin-arm64',
          binaryRelativePath: 'darwin-arm64/code-oz',
          sha256: 'a'.repeat(64),
          sizeBytes: 11,
          version: VERSION,
        },
        {
          os: 'darwin',
          arch: 'x64',
          bunTarget: 'bun-darwin-x64',
          binaryRelativePath: 'darwin-x64/code-oz',
          sha256: 'b'.repeat(64),
          sizeBytes: 22,
          version: VERSION,
        },
      ],
    })
    expect(Object.keys(manifest)).toEqual(['schemaVersion', 'version', 'builtAt', 'targets'])
    expect('targets' in manifest.targets[0]!).toBe(false)
  })

  test('manifestRow includes every required target field', () => {
    const row = manifestRow(TARGETS[0], 'c'.repeat(64), 33, VERSION)

    expect(Object.keys(row).sort()).toEqual([
      'arch',
      'binaryRelativePath',
      'bunTarget',
      'os',
      'sha256',
      'sizeBytes',
      'version',
    ])
    expect(row).toEqual({
      os: 'darwin',
      arch: 'arm64',
      bunTarget: 'bun-darwin-arm64',
      binaryRelativePath: 'darwin-arm64/code-oz',
      sha256: 'c'.repeat(64),
      sizeBytes: 33,
      version: VERSION,
    })
  })

  test('sha256OfBuffer returns lowercase hex for an empty buffer', async () => {
    await expect(sha256OfBuffer(new Uint8Array())).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('formatTargetTriple returns os-arch', () => {
    expect(TARGETS.map(formatTargetTriple)).toEqual(['darwin-arm64', 'darwin-x64'])
  })
})

describe('buildAll', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'code-oz-build-binaries-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('returns failure and does not write a manifest when the runner fails', async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'compile error',
    })

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd: tmp,
      mode: 'force',
      fs: nodeFs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(false)
    expect(result.manifest).toBeNull()
    expect(result.errors).toEqual([
      'darwin-arm64 build failed with exit code 1\ncompile error',
    ])
    expect(existsSync(join(tmp, 'dist/handoff/manifest.json'))).toBe(false)
  })

  test('classifies darwin-x64 runtime download failure as a toolchain failure', async () => {
    const fs = new MemoryFs()
    const cwd = '/tmp/code-oz-toolchain-fail'
    const runner: CommandRunner = async (_cmd, args) => {
      const targetArg = args.find((arg) => arg.startsWith('--target='))
      const outfileIndex = args.indexOf('--outfile')
      const outfile = args[outfileIndex + 1]
      if (targetArg === '--target=bun-darwin-arm64' && outfile !== undefined) {
        await fs.writeFile(outfile, bytes('arm64-binary'))
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          "Failed to extract executable for 'bun-darwin-x64-v1.3.9'. The download may be incomplete.",
      }
    }

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd,
      mode: 'force',
      fs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(false)
    expect(result.manifest).toBeNull()
    expect(result.errors).toEqual([
      "TOOLCHAIN_FAIL: darwin-x64 build failed with exit code 1\nFailed to extract executable for 'bun-darwin-x64-v1.3.9'. The download may be incomplete.",
    ])
    expect(await fs.exists(join(cwd, 'dist/handoff/manifest.json'))).toBe(false)
  })

  test('fails closed when scripts/install.sh is missing after successful builds', async () => {
    const fs = new MemoryFs()
    const cwd = '/tmp/code-oz-missing-installer'
    const runner = runnerWritingOutputs(
      fs,
      new Map([
        ['bun-darwin-arm64', bytes('arm64-binary')],
        ['bun-darwin-x64', bytes('x64-binary')],
      ]),
    )

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd,
      mode: 'force',
      fs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(false)
    expect(result.manifest).toBeNull()
    expect(result.errors).toEqual([
      'build-binaries: missing scripts/install.sh; cannot write dist/handoff/install.sh',
    ])
    expect(await fs.exists(join(cwd, 'dist/handoff/manifest.json'))).toBe(false)
  })

  test('writes a manifest for successful mock builds', async () => {
    const fs = new MemoryFs()
    const cwd = '/tmp/code-oz-success'
    await writeInstallScript(fs, cwd)
    const bytesByTarget = new Map([
      ['bun-darwin-arm64', bytes('arm64-binary')],
      ['bun-darwin-x64', bytes('x64-binary')],
    ])
    const runner = runnerWritingOutputs(fs, bytesByTarget)

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd,
      mode: 'force',
      fs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    const manifest = result.manifest
    if (manifest === null) throw new Error('expected manifest')
    expect(manifest).toEqual({
      schemaVersion: 1,
      version: VERSION,
      builtAt: BUILT_AT,
      targets: [
        {
          os: 'darwin',
          arch: 'arm64',
          bunTarget: 'bun-darwin-arm64',
          binaryRelativePath: 'darwin-arm64/code-oz',
          sha256: '51d1d871a4bc014947044a092cb82c2526122e2341770cbeb07b441d3ccd8ba3',
          sizeBytes: 12,
          version: VERSION,
        },
        {
          os: 'darwin',
          arch: 'x64',
          bunTarget: 'bun-darwin-x64',
          binaryRelativePath: 'darwin-x64/code-oz',
          sha256: 'dc33f3462e71eb0bc3a5c48fc85d47b5ea09d83dcf54d6bf63a02a10fb22bbad',
          sizeBytes: 10,
          version: VERSION,
        },
      ],
    })

    const manifestText = await fs.readTextFile(join(cwd, 'dist/handoff/manifest.json'))
    expect(JSON.parse(manifestText) as Manifest).toEqual(manifest)
    expect(await fs.readTextFile(join(cwd, 'dist/handoff/darwin-arm64/code-oz'))).toBe(
      'arm64-binary',
    )
    expect(await fs.readTextFile(join(cwd, 'dist/handoff/darwin-x64/code-oz'))).toBe(
      'x64-binary',
    )
    expect(await fs.readTextFile(join(cwd, 'dist/handoff/README.md'))).toBe(
      renderHandoffReadme(VERSION),
    )
    expect(result.tarballPath).toBe(join(cwd, 'dist/code-oz-v0.16.0-alpha.0-darwin.tar.gz'))
  })

  test('stages the Darwin tarball root and invokes tar with the expected args', async () => {
    const fs = new MemoryFs()
    const cwd = '/tmp/code-oz-tarball'
    await writeInstallScript(fs, cwd)
    const tarCalls: string[][] = []
    const runner = runnerWritingOutputs(
      fs,
      new Map([
        ['bun-darwin-arm64', bytes('arm64-binary')],
        ['bun-darwin-x64', bytes('x64-binary')],
      ]),
      [],
      tarCalls,
    )

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd,
      mode: 'force',
      fs,
      now: () => new Date(BUILT_AT),
    })

    const root = join(cwd, 'dist/code-oz-v0.16.0-alpha.0-darwin')
    expect(result.ok).toBe(true)
    expect(result.tarballPath).toBe(join(cwd, 'dist/code-oz-v0.16.0-alpha.0-darwin.tar.gz'))
    expect(tarCalls).toEqual([
      [
        '-czf',
        join(cwd, 'dist/code-oz-v0.16.0-alpha.0-darwin.tar.gz'),
        '-C',
        join(cwd, 'dist'),
        'code-oz-v0.16.0-alpha.0-darwin',
      ],
    ])
    expect(await fs.readTextFile(join(root, 'install.sh'))).toBe('#!/bin/sh\necho installer\n')
    expect(await fs.readTextFile(join(root, 'README.md'))).toBe(renderHandoffReadme(VERSION))
    expect(await fs.readTextFile(join(root, 'manifest.json'))).toBe(
      await fs.readTextFile(join(cwd, 'dist/handoff/manifest.json')),
    )
    expect(await fs.readTextFile(join(root, 'darwin-arm64/code-oz'))).toBe('arm64-binary')
    expect(await fs.readTextFile(join(root, 'darwin-x64/code-oz'))).toBe('x64-binary')
  })

  test('--ensure rebuilds a target when manifest sha256 does not match bytes', async () => {
    const fs = new MemoryFs()
    const cwd = '/tmp/code-oz-ensure'
    await writeInstallScript(fs, cwd)
    const armLocal = join(cwd, 'dist/darwin-arm64/code-oz')
    const armHandoff = join(cwd, 'dist/handoff/darwin-arm64/code-oz')
    const x64Local = join(cwd, 'dist/darwin-x64/code-oz')
    const x64Handoff = join(cwd, 'dist/handoff/darwin-x64/code-oz')
    await fs.writeFile(armLocal, bytes('old-arm64'))
    await fs.writeFile(armHandoff, bytes('old-arm64'))
    await fs.writeFile(x64Local, bytes('stable-x64'))
    await fs.writeFile(x64Handoff, bytes('stable-x64'))
    await fs.writeFile(
      join(cwd, 'dist/handoff/manifest.json'),
      JSON.stringify(
        manifestForTargets(VERSION, '2026-05-02T04:00:00.000Z', [
          manifestRow(
            TARGETS[0],
            '6d5a62dfbccf06cf4ccb4cc119bd44b737d687533fb65d79a3ffd264c3e73df4',
            9,
            VERSION,
          ),
          manifestRow(
            TARGETS[1],
            'e3d58ce2eeab5858570c2278f7335df207890b2f8401bec79f462cdafa91bda7',
            10,
            VERSION,
          ),
        ]),
      ),
    )

    const builtTargets: string[] = []
    const runner = runnerWritingOutputs(
      fs,
      new Map([['bun-darwin-arm64', bytes('new-arm64')]]),
      builtTargets,
    )

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd,
      mode: 'ensure',
      fs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(true)
    expect(builtTargets).toEqual(['bun-darwin-arm64'])
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      version: VERSION,
      builtAt: BUILT_AT,
      targets: [
        {
          os: 'darwin',
          arch: 'arm64',
          bunTarget: 'bun-darwin-arm64',
          binaryRelativePath: 'darwin-arm64/code-oz',
          sha256: '6d5a62dfbccf06cf4ccb4cc119bd44b737d687533fb65d79a3ffd264c3e73df4',
          sizeBytes: 9,
          version: VERSION,
        },
        {
          os: 'darwin',
          arch: 'x64',
          bunTarget: 'bun-darwin-x64',
          binaryRelativePath: 'darwin-x64/code-oz',
          sha256: 'e3d58ce2eeab5858570c2278f7335df207890b2f8401bec79f462cdafa91bda7',
          sizeBytes: 10,
          version: VERSION,
        },
      ],
    })
    expect(await fs.readTextFile(armHandoff)).toBe('new-arm64')
    expect(await fs.readTextFile(x64Handoff)).toBe('stable-x64')
  })

  test('--ensure rebuilds when manifest JSON is malformed', async () => {
    const fs = new MemoryFs()
    const cwd = '/tmp/code-oz-bad-manifest'
    await writeInstallScript(fs, cwd)
    await fs.writeFile(join(cwd, 'dist/handoff/manifest.json'), '{ bad json')
    const builtTargets: string[] = []
    const runner = runnerWritingOutputs(
      fs,
      new Map([
        ['bun-darwin-arm64', bytes('arm64-rebuilt')],
        ['bun-darwin-x64', bytes('x64-rebuilt')],
      ]),
      builtTargets,
    )

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd,
      mode: 'ensure',
      fs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.manifestParseError).toContain('manifest.json invalid JSON')
    expect(builtTargets).toEqual(['bun-darwin-arm64', 'bun-darwin-x64'])
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      version: VERSION,
      builtAt: BUILT_AT,
      targets: [
        {
          os: 'darwin',
          arch: 'arm64',
          bunTarget: 'bun-darwin-arm64',
          binaryRelativePath: 'darwin-arm64/code-oz',
          sha256: '16f2185b17626142a3f701d4d6263ae8c0939c7afd08c4a80450a54194dc4844',
          sizeBytes: 13,
          version: VERSION,
        },
        {
          os: 'darwin',
          arch: 'x64',
          bunTarget: 'bun-darwin-x64',
          binaryRelativePath: 'darwin-x64/code-oz',
          sha256: '47b82de1afae8fa34cc625c04b5411ebdd52ab659fad87f094328108465da60c',
          sizeBytes: 11,
          version: VERSION,
        },
      ],
    })
    expect(JSON.parse(await fs.readTextFile(join(cwd, 'dist/handoff/manifest.json')))).toEqual(
      result.manifest,
    )
  })

  test('removes partial handoff when the second target build fails', async () => {
    await mkdir(join(tmp, 'scripts'), { recursive: true })
    await writeFile(join(tmp, 'scripts/install.sh'), '#!/bin/sh\necho installer\n')
    const runner: CommandRunner = async (_cmd, args) => {
      const targetArg = args.find((arg) => arg.startsWith('--target='))
      const outfileIndex = args.indexOf('--outfile')
      const outfile = args[outfileIndex + 1]
      if (targetArg === '--target=bun-darwin-arm64' && outfile !== undefined) {
        await mkdir(dirname(outfile), { recursive: true })
        await writeFile(outfile, bytes('arm64-partial'))
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return { exitCode: 1, stdout: '', stderr: 'x64 compile failed' }
    }

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd: tmp,
      mode: 'force',
      fs: nodeFs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(false)
    expect(result.manifest).toBeNull()
    expect(result.errors).toEqual([
      'darwin-x64 build failed with exit code 1\nx64 compile failed',
    ])
    expect(existsSync(join(tmp, 'dist/darwin-arm64/code-oz'))).toBe(true)
    expect(existsSync(join(tmp, 'dist/handoff'))).toBe(false)
  })

  test('copies scripts/install.sh into handoff with executable bit', async () => {
    const installSource = await readFile(join(process.cwd(), 'scripts/install.sh'))
    await mkdir(join(tmp, 'scripts'), { recursive: true })
    await writeFile(join(tmp, 'scripts/install.sh'), installSource)

    const bytesByTarget = new Map([
      ['bun-darwin-arm64', bytes('arm64-binary')],
      ['bun-darwin-x64', bytes('x64-binary')],
    ])
    const runner: CommandRunner = async (_cmd, args) => {
      if (_cmd === 'tar') return { exitCode: 0, stdout: '', stderr: '' }
      const targetArg = args.find((arg) => arg.startsWith('--target='))
      const outfileIndex = args.indexOf('--outfile')
      const target = targetArg?.slice('--target='.length)
      const outfile = args[outfileIndex + 1]
      const binary = target === undefined ? undefined : bytesByTarget.get(target)
      if (outfile === undefined || binary === undefined) {
        throw new Error('mock runner received malformed build args')
      }
      await mkdir(dirname(outfile), { recursive: true })
      await writeFile(outfile, binary)
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const result = await buildAll({
      runner,
      version: VERSION,
      cwd: tmp,
      mode: 'force',
      fs: nodeFs,
      now: () => new Date(BUILT_AT),
    })

    expect(result.ok).toBe(true)
    const handoffInstallPath = join(tmp, 'dist/handoff/install.sh')
    expect(await readFile(handoffInstallPath, 'utf8')).toBe(installSource.toString())
    expect((await stat(handoffInstallPath)).mode & 0o111).not.toBe(0)
  })
})

const nodeFs: BuildFs = {
  mkdir: async (path, opts) => {
    await mkdir(path, opts)
  },
  rm,
  readFile: async (path) => new Uint8Array(await readFile(path)),
  readTextFile: async (path) => readFile(path, 'utf8'),
  writeFile: async (path, data) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  },
  copyFile: async (from, to) => {
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
  },
  chmod,
  exists: async (path) => existsSync(path),
  stat: async (path) => stat(path),
}

class MemoryFs implements BuildFs {
  readonly files = new Map<string, Uint8Array>()

  async mkdir(_path: string, _opts?: { recursive?: boolean }): Promise<void> {}

  async rm(path: string, _opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const key = fileKey(path)
    for (const existing of [...this.files.keys()]) {
      if (existing === key || existing.startsWith(`${key}${sep}`)) {
        this.files.delete(existing)
      }
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const stored = this.files.get(fileKey(path))
    if (stored === undefined) throw enoent(path)
    return new Uint8Array(stored)
  }

  async readTextFile(path: string): Promise<string> {
    return decoder.decode(await this.readFile(path))
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    this.files.set(fileKey(path), typeof data === 'string' ? bytes(data) : new Uint8Array(data))
  }

  async copyFile(from: string, to: string): Promise<void> {
    await this.writeFile(to, await this.readFile(from))
  }

  async chmod(_path: string, _mode: number): Promise<void> {}

  async exists(path: string): Promise<boolean> {
    return this.files.has(fileKey(path))
  }

  async stat(path: string): Promise<{ size: number }> {
    const stored = this.files.get(fileKey(path))
    if (stored === undefined) throw enoent(path)
    return { size: stored.byteLength }
  }
}

function runnerWritingOutputs(
  fs: MemoryFs,
  bytesByTarget: Map<string, Uint8Array>,
  builtTargets: string[] = [],
  tarCalls: string[][] = [],
): CommandRunner {
  return async (cmd, args) => {
    if (cmd === 'tar') {
      tarCalls.push(args)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    expect(cmd).toBe('bun')
    expect(args.slice(0, 2)).toEqual(['build', '--compile'])
    const targetArg = args.find((arg) => arg.startsWith('--target='))
    const outfileIndex = args.indexOf('--outfile')
    if (targetArg === undefined || outfileIndex < 0) {
      throw new Error('mock runner received malformed build args')
    }
    const target = targetArg.slice('--target='.length)
    const outfile = args[outfileIndex + 1]
    const binary = bytesByTarget.get(target)
    if (outfile === undefined || binary === undefined) {
      throw new Error(`mock runner has no output for ${target}`)
    }
    builtTargets.push(target)
    await fs.writeFile(outfile, binary)
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value)
}

async function writeInstallScript(fs: MemoryFs, cwd: string): Promise<void> {
  await fs.writeFile(join(cwd, 'scripts/install.sh'), '#!/bin/sh\necho installer\n')
}

function fileKey(path: string): string {
  return normalize(path)
}

function enoent(path: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException
  err.code = 'ENOENT'
  return err
}
