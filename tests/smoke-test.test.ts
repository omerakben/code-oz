import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderHandoffReadme } from '../scripts/build-binaries.ts'
import { createSmokeTempDirs, runSmoke, runSpawn } from '../scripts/smoke-test.ts'

const VERSION = '0.21.2-alpha.0'
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('runSmoke', () => {
  test('returns ok for install, version, help, and init success', async () => {
    const fixture = await createSmokeFixture()
    const spawn = createMockSpawn({ projectDir: fixture.projectDir })

    const result = await runSmoke({
      bundleDir: fixture.bundleDir,
      installDir: fixture.installDir,
      homeDir: fixture.homeDir,
      projectDir: fixture.projectDir,
      spawn,
      pathEnv: '/usr/bin:/bin',
    })

    expect(result.ok).toBe(true)
    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['layout', true],
      ['install', true],
      ['version', true],
      ['help', true],
      ['init', true],
    ])
  })

  test('returns install failure when install.sh exits non-zero', async () => {
    const fixture = await createSmokeFixture()
    const spawn = createMockSpawn({ installExitCode: 1, installStderr: 'copy failed' })

    const result = await runSmoke({
      bundleDir: fixture.bundleDir,
      installDir: fixture.installDir,
      homeDir: fixture.homeDir,
      projectDir: fixture.projectDir,
      spawn,
      pathEnv: '/usr/bin:/bin',
    })

    expect(result.ok).toBe(false)
    expect(result.steps[result.steps.length - 1]?.name).toBe('install')
    expect(result.steps[result.steps.length - 1]?.message).toContain('copy failed')
  })

  test('returns version failure when code-oz --version exits non-zero', async () => {
    const fixture = await createSmokeFixture()
    const spawn = createMockSpawn({ versionExitCode: 1, versionStderr: 'bad binary' })

    const result = await runSmoke({
      bundleDir: fixture.bundleDir,
      installDir: fixture.installDir,
      homeDir: fixture.homeDir,
      projectDir: fixture.projectDir,
      spawn,
      pathEnv: '/usr/bin:/bin',
    })

    expect(result.ok).toBe(false)
    expect(result.steps[result.steps.length - 1]?.name).toBe('version')
    expect(result.steps[result.steps.length - 1]?.message).toContain('bad binary')
  })

  test('returns init failure when code-oz init exits non-zero', async () => {
    const fixture = await createSmokeFixture()
    const spawn = createMockSpawn({ initExitCode: 1, initStderr: 'init failed' })

    const result = await runSmoke({
      bundleDir: fixture.bundleDir,
      installDir: fixture.installDir,
      homeDir: fixture.homeDir,
      projectDir: fixture.projectDir,
      spawn,
      pathEnv: '/usr/bin:/bin',
    })

    expect(result.ok).toBe(false)
    expect(result.steps[result.steps.length - 1]?.name).toBe('init')
    expect(result.steps[result.steps.length - 1]?.message).toContain('init failed')
  })

  test('bounds a hung subprocess with a timeout result', async () => {
    let killed = false
    const spawn = (() => mockHangingProc(() => {
      killed = true
    })) as unknown as typeof Bun.spawn
    const start = performance.now()

    const result = await runSpawn(spawn, ['/tmp/code-oz', '--version'], {
      cwd: '/tmp/project',
      env: {},
      timeoutMs: 50,
    })

    expect(performance.now() - start).toBeLessThan(150)
    expect(killed).toBe(true)
    expect(result.timedOut).toBe(true)
    expect(result.timeoutMs).toBe(50)
  })

  test('returns a timeout step message when the version command hangs', async () => {
    const fixture = await createSmokeFixture()
    const spawn = createMockSpawn({ versionHangs: true })

    const result = await runSmoke({
      bundleDir: fixture.bundleDir,
      installDir: fixture.installDir,
      homeDir: fixture.homeDir,
      projectDir: fixture.projectDir,
      spawn,
      pathEnv: '/usr/bin:/bin',
      timeoutMs: 50,
    })

    expect(result.ok).toBe(false)
    expect(result.steps[result.steps.length - 1]?.name).toBe('version')
    expect(result.steps[result.steps.length - 1]?.message).toContain('timed out after 50ms')
  })
})

describe('createSmokeTempDirs', () => {
  test('cleans created tempdirs when creation fails midway', async () => {
    const created = [
      '/tmp/code-oz-smoke-bundle-1',
      '/tmp/code-oz-smoke-bin-2',
    ]
    const cleaned: string[] = []
    let calls = 0

    await expect(
      createSmokeTempDirs({
        tmpdir: () => '/tmp',
        mkdtemp: async () => {
          calls += 1
          if (calls <= created.length) return created[calls - 1]!
          throw new Error('mkdtemp denied')
        },
        rm: async (path) => {
          cleaned.push(path)
        },
      }),
    ).rejects.toThrow('mkdtemp denied')

    expect(cleaned).toEqual(created)
  })
})

async function createSmokeFixture(): Promise<SmokeFixture> {
  const root = await mkdtemp(join(tmpdir(), 'code-oz-smoke-test-'))
  tempDirs.push(root)
  const bundleDir = join(root, 'bundle')
  const installDir = join(root, 'bin')
  const homeDir = join(root, 'home')
  const projectDir = join(root, 'project')
  // W3a commit 1: fixture covers all 4 TARGETS so validateHandoffLayout
  // (which iterates TARGETS) accepts the bundle.
  for (const triple of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']) {
    await mkdir(join(bundleDir, triple), { recursive: true })
    await writeFile(join(bundleDir, `${triple}/code-oz`), `#!/bin/sh\necho ${triple}\n`)
    await chmod(join(bundleDir, `${triple}/code-oz`), 0o755)
  }
  await mkdir(installDir, { recursive: true })
  await mkdir(homeDir, { recursive: true })
  await mkdir(projectDir, { recursive: true })
  await writeFile(join(bundleDir, 'install.sh'), '#!/bin/sh\necho install\n')
  await chmod(join(bundleDir, 'install.sh'), 0o755)
  await writeFile(join(bundleDir, 'README.md'), renderHandoffReadme(VERSION))
  await writeFile(
    join(bundleDir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        version: VERSION,
        builtAt: '2026-05-02T05:00:00.000Z',
        targets: [
          {
            os: 'darwin',
            arch: 'arm64',
            bunTarget: 'bun-darwin-arm64',
            binaryRelativePath: 'darwin-arm64/code-oz',
            sha256: 'a'.repeat(64),
            sizeBytes: 19,
            version: VERSION,
          },
          {
            os: 'darwin',
            arch: 'x64',
            bunTarget: 'bun-darwin-x64',
            binaryRelativePath: 'darwin-x64/code-oz',
            sha256: 'b'.repeat(64),
            sizeBytes: 19,
            version: VERSION,
          },
          {
            os: 'linux',
            arch: 'x64',
            bunTarget: 'bun-linux-x64',
            binaryRelativePath: 'linux-x64/code-oz',
            sha256: 'c'.repeat(64),
            sizeBytes: 19,
            version: VERSION,
          },
          {
            os: 'linux',
            arch: 'arm64',
            bunTarget: 'bun-linux-arm64',
            binaryRelativePath: 'linux-arm64/code-oz',
            sha256: 'd'.repeat(64),
            sizeBytes: 19,
            version: VERSION,
          },
        ],
      },
      null,
      2,
    ),
  )
  return { bundleDir, installDir, homeDir, projectDir }
}

function createMockSpawn(opts: {
  projectDir?: string
  installExitCode?: number
  installStderr?: string
  versionExitCode?: number
  versionStderr?: string
  versionHangs?: boolean
  initExitCode?: number
  initStderr?: string
} = {}): typeof Bun.spawn {
  return ((args: string[], options?: { cwd?: string }) => {
    if (args[0] === 'sh') {
      return mockProc('', opts.installStderr ?? '', opts.installExitCode ?? 0)
    }

    if (args[1] === '--version') {
      if (opts.versionHangs === true) return mockHangingProc(() => {})
      return mockProc(
        opts.versionExitCode === undefined ? `${VERSION}\n` : '',
        opts.versionStderr ?? '',
        opts.versionExitCode ?? 0,
      )
    }

    if (args[1] === '--help') {
      return mockProc('Usage: code-oz <command> [options]\n', '', 0)
    }

    if (args[1] === 'init') {
      const exitCode = opts.initExitCode ?? 0
      if (exitCode === 0) {
        mkdirSync(join(options?.cwd ?? opts.projectDir ?? '', '.code-oz'), { recursive: true })
      }
      return mockProc('', opts.initStderr ?? '', exitCode)
    }

    return mockProc('', `unexpected command: ${args.join(' ')}`, 1)
  }) as unknown as typeof Bun.spawn
}

function mockProc(stdout: string, stderr: string, exitCode: number): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    exited: Promise.resolve(exitCode),
  } as ReturnType<typeof Bun.spawn>
}

function mockHangingProc(onKill: () => void): ReturnType<typeof Bun.spawn> {
  let resolveExit: ((exitCode: number) => void) | undefined
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve
  })

  return {
    stdout: new Response('').body,
    stderr: new Response('').body,
    exited,
    kill: () => {
      onKill()
      resolveExit?.(143)
    },
  } as unknown as ReturnType<typeof Bun.spawn>
}

interface SmokeFixture {
  readonly bundleDir: string
  readonly installDir: string
  readonly homeDir: string
  readonly projectDir: string
}
