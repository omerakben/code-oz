import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifest } from '../src/providers/manifest.ts'
import { previewProviderRequest } from '../src/providers/preview.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { ProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-manifest-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function agent(opts: { read: '*' | readonly string[] } = { read: '*' }): AgentDefinition {
  return Object.freeze({
    file: '/tmp/builder.md',
    name: 'builder',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'claude' as const,
    modelPolicy: 'opus-default' as const,
    permissions: {
      read: opts.read,
      write: '*' as const,
      bash: 'deny' as const,
    },
    description: 'builder',
    body: '# stub\n## Overview\nstub',
  })
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'do the thing',
    files: [],
    ...overrides,
  }
}

describe('buildManifest — happy paths', () => {
  test('empty file list yields empty manifest and zero metrics', async () => {
    const prepared = await buildManifest(request(), { projectRoot: tmp })
    expect(prepared.files).toEqual([])
    expect(prepared.manifest.files).toEqual([])
    expect(prepared.metrics).toEqual({
      filesSent: 0,
      bytesSent: 0,
      tokensEstimate: Math.ceil('do the thing'.length / 4),
      fieldsRemovedByScope: 0,
    })
  })

  test('single file: hash, size, and metrics computed correctly', async () => {
    const filePath = join(tmp, 'spec.md')
    await writeFile(filePath, 'hello world\n')
    const prepared = await buildManifest(
      request({ files: [{ path: 'spec.md' }] }),
      { projectRoot: tmp },
    )
    expect(prepared.files.length).toBe(1)
    expect(prepared.files[0]!.path).toBe('spec.md')
    expect(prepared.files[0]!.sizeBytes).toBe(12)
    expect(prepared.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.manifest.files[0]!.sha256).toBe(prepared.files[0]!.sha256)
    expect(prepared.metrics.filesSent).toBe(1)
    expect(prepared.metrics.bytesSent).toBe(12)
    expect(prepared.metrics.tokensEstimate).toBeGreaterThan(0)
  })

  test('multiple files: bytes summed, hashes per-file', async () => {
    await writeFile(join(tmp, 'a.md'), 'aaa')
    await writeFile(join(tmp, 'b.md'), 'bbbb')
    const prepared = await buildManifest(
      request({ files: [{ path: 'a.md' }, { path: 'b.md' }] }),
      { projectRoot: tmp },
    )
    expect(prepared.metrics.filesSent).toBe(2)
    expect(prepared.metrics.bytesSent).toBe(7)
    expect(prepared.files[0]!.sha256).not.toBe(prepared.files[1]!.sha256)
  })

  test('droppedFields is summed into fieldsRemovedByScope', async () => {
    await writeFile(join(tmp, 'a.md'), 'a')
    await writeFile(join(tmp, 'b.md'), 'b')
    const prepared = await buildManifest(
      request({
        files: [
          { path: 'a.md', droppedFields: ['extra1', 'extra2'] },
          { path: 'b.md', droppedFields: ['extra3'] },
        ],
      }),
      { projectRoot: tmp },
    )
    expect(prepared.metrics.fieldsRemovedByScope).toBe(3)
  })

  test('zero droppedFields means zero fieldsRemovedByScope (single semantics)', async () => {
    await writeFile(join(tmp, 'a.md'), 'a')
    const prepared = await buildManifest(
      request({ files: [{ path: 'a.md' }] }),
      { projectRoot: tmp },
    )
    expect(prepared.metrics.fieldsRemovedByScope).toBe(0)
  })
})

describe('buildManifest — permissions intersection', () => {
  test('read=* allows any file', async () => {
    await writeFile(join(tmp, 'anything.txt'), 'x')
    const prepared = await buildManifest(
      request({
        agent: agent({ read: '*' }),
        files: [{ path: 'anything.txt' }],
      }),
      { projectRoot: tmp },
    )
    expect(prepared.files.length).toBe(1)
  })

  test('read array allows matching glob and rejects others', async () => {
    await writeFile(join(tmp, 'docs.md'), 'ok')
    await writeFile(join(tmp, 'forbidden.txt'), 'no')
    // Allowed: pattern matches.
    const ok = await buildManifest(
      request({
        agent: agent({ read: ['*.md'] }),
        files: [{ path: 'docs.md' }],
      }),
      { projectRoot: tmp },
    )
    expect(ok.files[0]!.path).toBe('docs.md')

    // Rejected: file outside pattern.
    try {
      await buildManifest(
        request({
          agent: agent({ read: ['*.md'] }),
          files: [{ path: 'forbidden.txt' }],
        }),
        { projectRoot: tmp },
      )
      throw new Error('expected ProviderError')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_permissions_violation')
    }
  })

  test('read with `**` glob matches deep paths', async () => {
    await mkdir(join(tmp, 'deep', 'nested'), { recursive: true })
    await writeFile(join(tmp, 'deep', 'nested', 'x.md'), 'x')
    const prepared = await buildManifest(
      request({
        agent: agent({ read: ['./deep/**'] }),
        files: [{ path: 'deep/nested/x.md' }],
      }),
      { projectRoot: tmp },
    )
    expect(prepared.files[0]!.path).toBe('deep/nested/x.md')
  })
})

describe('buildManifest — path safety', () => {
  test('rejects `..` segments before normalization', async () => {
    try {
      await buildManifest(
        request({ files: [{ path: 'docs/../secret.md' }] }),
        { projectRoot: tmp },
      )
      throw new Error('expected ProviderError')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_permissions_violation')
      expect(e.issues[0]?.rule).toMatch(/`\.\.` segment/)
    }
  })

  test('rejects backslash separators', async () => {
    try {
      await buildManifest(
        request({ files: [{ path: 'docs\\file.md' }] }),
        { projectRoot: tmp },
      )
      throw new Error('expected ProviderError')
    } catch (err) {
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_permissions_violation')
      expect(e.issues[0]?.rule).toMatch(/forward slashes/)
    }
  })

  test('rejects empty path', async () => {
    try {
      await buildManifest(
        request({ files: [{ path: '' }] }),
        { projectRoot: tmp },
      )
      throw new Error('expected ProviderError')
    } catch (err) {
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_permissions_violation')
    }
  })

  test('rejects non-existent file with provider_io_error', async () => {
    try {
      await buildManifest(
        request({ files: [{ path: 'does-not-exist.md' }] }),
        { projectRoot: tmp },
      )
      throw new Error('expected ProviderError')
    } catch (err) {
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_io_error')
      expect(e.issues[0]?.rule).toMatch(/does not exist/)
    }
  })

  test('rejects symlink that escapes the project root', async () => {
    // outside is a sibling tmpdir; inside our project root we symlink to it.
    const outside = await mkdtemp(join(tmpdir(), 'code-oz-outside-'))
    try {
      const target = join(outside, 'leaked.md')
      await writeFile(target, 'secret')
      const linkPath = join(tmp, 'leaked-link.md')
      await symlink(target, linkPath)
      try {
        await buildManifest(
          request({ files: [{ path: 'leaked-link.md' }] }),
          { projectRoot: tmp },
        )
        throw new Error('expected ProviderError')
      } catch (err) {
        const e = err as ProviderError
        expect(e.issues[0]?.code).toBe('provider_permissions_violation')
        expect(e.issues[0]?.rule).toMatch(/symlinks/)
      }
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('previewProviderRequest', () => {
  test('returns the same prepared payload as buildManifest', async () => {
    await writeFile(join(tmp, 'x.md'), 'hi')
    const preview = await previewProviderRequest(
      request({ files: [{ path: 'x.md' }] }),
      { projectRoot: tmp },
    )
    expect(preview.prepared.files.length).toBe(1)
    expect(preview.prepared.metrics.filesSent).toBe(1)
    expect(preview.prepared.metrics.bytesSent).toBe(2)
  })

  test('surfaces the same ProviderError for permission violations', async () => {
    await writeFile(join(tmp, 'x.txt'), 'no')
    try {
      await previewProviderRequest(
        request({
          agent: agent({ read: ['*.md'] }),
          files: [{ path: 'x.txt' }],
        }),
        { projectRoot: tmp },
      )
      throw new Error('expected ProviderError')
    } catch (err) {
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_permissions_violation')
    }
  })
})
