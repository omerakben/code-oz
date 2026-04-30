import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { execGrep } from '../src/tools/repo-context/grep.ts'

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
  project = await mkdtemp(join(tmpdir(), 'codeoz-grep-'))
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src/a.ts'), "export const NEEDLE = 'hello'\nconst x = 1\n")
  await writeFile(join(project, 'src/b.ts'), "import { NEEDLE } from './a'\n")
  await writeFile(join(project, 'src/c.ts'), "// no match here\n")
})

describe.if(RG_AVAILABLE)('execGrep — rg integration', () => {
  test('finds matches with path/line/snippet', async () => {
    const result = await execGrep(
      { pattern: 'NEEDLE' },
      {
        maxResults: 50,
        maxBytesPerResult: 16384,
        timeoutMs: 5000,
        projectRoot: project,
        effectiveRoots: [project],
      },
    )
    expect(result.tool).toBe('grep')
    expect(result.matches.length).toBeGreaterThanOrEqual(2)
    const a = result.matches.find((m) => m.path.endsWith('a.ts'))
    expect(a).toBeDefined()
    expect(a!.line).toBeGreaterThanOrEqual(1)
    expect(a!.snippet).toContain('NEEDLE')
  })

  test('honors maxResults cap', async () => {
    const result = await execGrep(
      { pattern: 'NEEDLE' },
      {
        maxResults: 1,
        maxBytesPerResult: 16384,
        timeoutMs: 5000,
        projectRoot: project,
        effectiveRoots: [project],
      },
    )
    expect(result.matches.length).toBe(1)
    expect(result.truncated).toBe(true)
  })

  test('regex flag enables regex matching', async () => {
    const result = await execGrep(
      { pattern: 'NEED.E', regex: true },
      {
        maxResults: 50,
        maxBytesPerResult: 16384,
        timeoutMs: 5000,
        projectRoot: project,
        effectiveRoots: [project],
      },
    )
    expect(result.matches.length).toBeGreaterThan(0)
  })

  test('rejects empty pattern', async () => {
    await expect(
      execGrep(
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
