import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { execGlob } from '../src/tools/repo-context/glob.ts'

const RG_AVAILABLE = (() => {
  try {
    const r = spawnSync('rg', ['--version'], { stdio: 'pipe' })
    return r.status === 0
  } catch {
    return false
  }
})()

let project: string

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'codeoz-glob-'))
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src/a.ts'), 'export const a = 1\n')
  await writeFile(join(project, 'src/b.ts'), 'export const b = 2\n')
  await writeFile(join(project, 'src/c.md'), '# c\n')
  await writeFile(join(project, 'README.md'), '# proj\n')
})

describe.if(RG_AVAILABLE)('execGlob — rg integration', () => {
  test('returns matching .ts files relative to project root', async () => {
    const result = await execGlob(
      { pattern: '**/*.ts' },
      {
        maxResults: 50,
        maxBytesPerResult: 16384,
        timeoutMs: 5000,
        projectRoot: project,
        effectiveRoots: [project],
      },
    )
    expect(result.tool).toBe('glob')
    expect(result.paths).toContain('src/a.ts')
    expect(result.paths).toContain('src/b.ts')
    expect(result.paths.some((p) => p.endsWith('.md'))).toBe(false)
  })

  test('honors maxResults cap and reports truncated', async () => {
    const result = await execGlob(
      { pattern: '**/*' },
      {
        maxResults: 1,
        maxBytesPerResult: 16384,
        timeoutMs: 5000,
        projectRoot: project,
        effectiveRoots: [project],
      },
    )
    expect(result.paths.length).toBe(1)
    expect(result.truncated).toBe(true)
  })

  test('rejects empty pattern', async () => {
    await expect(
      execGlob(
        { pattern: '' },
        {
          maxResults: 50,
          maxBytesPerResult: 16384,
          timeoutMs: 5000,
          projectRoot: project,
          effectiveRoots: [project],
        },
      ),
    ).rejects.toThrow()
  })
})

describe.if(!RG_AVAILABLE)('execGlob — rg not installed', () => {
  test('throws tool_unavailable when rg missing', async () => {
    await expect(
      execGlob(
        { pattern: '*' },
        {
          maxResults: 50,
          maxBytesPerResult: 16384,
          timeoutMs: 5000,
          projectRoot: project,
          effectiveRoots: [project],
        },
      ),
    ).rejects.toThrow(/rg|ripgrep|tool_unavailable/i)
  })
})
