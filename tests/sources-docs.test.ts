import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDocsSources, readDocsCache } from '../src/sources/docs-source.ts'

let cacheDir: string

beforeAll(async () => {
  cacheDir = join(await mkdtemp(join(tmpdir(), 'codeoz-docs-')), 'docs')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, 'bun.md'), '# Bun\n## Atomic writes\nuse Bun.write\n')
})

describe('resolveDocsSources', () => {
  test('emits SC-DOC-NNN when cache hit', async () => {
    const out = await resolveDocsSources({
      searches: [
        {
          title: 'Bun atomic write idiom',
          library: 'bun',
          url: 'https://bun.com/docs/api/file-io',
          section: 'Atomic writes',
          why: 'validates atomic-write idiom',
        },
      ],
      cacheDir,
    })
    expect(out.length).toBe(1)
    expect(out[0]!.kind).toBe('DOC')
    if (out[0]!.kind === 'DOC') {
      expect(out[0]!.library).toBe('bun')
      expect(out[0]!.url).toContain('cached at')
    }
  })

  test('emits SC-DOC-NONE when cache miss + fallback rationale', async () => {
    const out = await resolveDocsSources({
      searches: [
        {
          title: 'Missing lib',
          library: 'no-such',
          url: 'https://example.com',
          section: 'X',
          why: 'should fallback',
          fallbackNoneRationale: 'no offline cache; using NONE',
        },
      ],
      cacheDir,
    })
    expect(out.length).toBe(1)
    expect(out[0]!.kind).toBe('DOC-NONE')
  })

  test('throws on cache miss without fallback', async () => {
    await expect(
      resolveDocsSources({
        searches: [
          { title: 'Strict', library: 'no-such', url: 'x', section: 'y', why: 'z' },
        ],
        cacheDir,
      }),
    ).rejects.toThrow(/cache miss/i)
  })

  test('emits explicit no-library blocks alongside searches', async () => {
    const out = await resolveDocsSources({
      searches: [],
      noLibrary: [{ title: 'Hand-written', whyExplicit: 'no API surface to verify' }],
      cacheDir,
    })
    expect(out.length).toBe(1)
    expect(out[0]!.kind).toBe('DOC-NONE')
  })
})

describe('readDocsCache', () => {
  test('reads cached doc text', async () => {
    const text = await readDocsCache(cacheDir, 'bun')
    expect(text).toContain('Atomic writes')
  })

  test('returns null when missing', async () => {
    const text = await readDocsCache(cacheDir, 'absent')
    expect(text).toBeNull()
  })
})
