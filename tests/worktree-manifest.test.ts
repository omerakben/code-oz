import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { computeManifest, parseNameStatusZ, renderManifestBullets } from '../src/worktree/manifest.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`manifest tests require git >= 2.40`)
  }
})

async function withCommittedRepo<T>(
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeoz-mf-'))
  try {
    await runGit(cwd, ['init', '-q', '-b', 'main'])
    await runGit(cwd, ['config', 'user.email', 'test@example.com'])
    await runGit(cwd, ['config', 'user.name', 'Test'])
    await runGit(cwd, ['config', 'commit.gpgsign', 'false'])
    await mkdir(join(cwd, 'src'), { recursive: true })
    await writeFile(join(cwd, 'src/a.ts'), 'export const a = 1\n', { encoding: 'utf8' })
    await writeFile(join(cwd, 'src/b.ts'), 'export const b = 2\n', { encoding: 'utf8' })
    await runGit(cwd, ['add', '.'])
    await runGit(cwd, ['commit', '-q', '-m', 'init'])
    return await fn(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

describe('parseNameStatusZ', () => {
  test('parses a single added file', () => {
    const recs = parseNameStatusZ('A\0src/new.ts\0')
    expect(recs).toHaveLength(1)
    expect(recs[0]).toEqual({ kind: 'A', path: 'src/new.ts', oldPath: '', newPath: '' })
  })

  test('parses modified + deleted', () => {
    const recs = parseNameStatusZ('M\0src/a.ts\0D\0src/b.ts\0')
    expect(recs).toHaveLength(2)
    expect(recs[0]?.kind).toBe('M')
    expect(recs[1]?.kind).toBe('D')
  })

  test('parses a rename (R<score>)', () => {
    const recs = parseNameStatusZ('R100\0old.ts\0new.ts\0')
    expect(recs).toHaveLength(1)
    expect(recs[0]?.kind).toBe('R')
    expect(recs[0]?.oldPath).toBe('old.ts')
    expect(recs[0]?.newPath).toBe('new.ts')
  })

  test('returns empty for empty input', () => {
    expect(parseNameStatusZ('')).toEqual([])
  })

  test('skips unknown status codes (T, C, etc.)', () => {
    const recs = parseNameStatusZ('T\0changed.ts\0M\0kept.ts\0')
    // 'T' is unknown; we skip 1 token. Then 'changed.ts' has no status code,
    // is treated as another (unrecognized) status, and we skip again until
    // M\0kept.ts matches.
    const kinds = recs.map((r) => r.kind)
    expect(kinds).toContain('M')
  })
})

describe('renderManifestBullets', () => {
  test('formats locked grammar', () => {
    const out = renderManifestBullets([
      { path: 'src/a.ts', sha256: 'a'.repeat(64), change: 'modified' },
      { path: 'src/new.ts', sha256: 'b'.repeat(64), change: 'added' },
    ])
    expect(out).toBe(
      `- src/a.ts | sha256: ${'a'.repeat(64)} | change: modified\n` +
        `- src/new.ts | sha256: ${'b'.repeat(64)} | change: added`,
    )
  })

  test('returns empty string for empty entries', () => {
    expect(renderManifestBullets([])).toBe('')
  })
})

describe('computeManifest — added file', () => {
  test('reports change=added with sha256 of post-patch content', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      // Add a new file in the worktree (simulating patch apply --index).
      // Real patch-apply uses `git apply --index` which also stages the
      // change; here we do it manually via `git add` so the diff sees it.
      await writeFile(
        join(created.worktreePath, 'src/c.ts'),
        'export const c = 3\n',
        { encoding: 'utf8' },
      )
      await runGit(created.worktreePath, ['add', 'src/c.ts'])

      const result = await computeManifest({
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const found = result.entries.find((e) => e.path === 'src/c.ts')
      expect(found).toBeDefined()
      expect(found?.change).toBe('added')
      expect(found?.sha256).toMatch(/^[0-9a-f]{64}$/)
    })
  })
})

describe('computeManifest — modified file', () => {
  test('reports change=modified with sha256 of post-patch content', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      await writeFile(
        join(created.worktreePath, 'src/a.ts'),
        'export const a = 999\n',
        { encoding: 'utf8' },
      )

      const result = await computeManifest({
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const found = result.entries.find((e) => e.path === 'src/a.ts')
      expect(found?.change).toBe('modified')
    })
  })
})

describe('computeManifest — deleted file', () => {
  test('reports change=deleted with sha256 of pre-patch content', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      // Delete src/b.ts in the worktree
      await rm(join(created.worktreePath, 'src/b.ts'))

      const result = await computeManifest({
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const found = result.entries.find((e) => e.path === 'src/b.ts')
      expect(found?.change).toBe('deleted')
      expect(found?.sha256).toMatch(/^[0-9a-f]{64}$/)
    })
  })
})

describe('computeManifest — empty diff', () => {
  test('reports zero entries when worktree matches base', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const result = await computeManifest({
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.entries).toEqual([])
    })
  })
})

describe('computeManifest — sorted output', () => {
  test('entries sorted alphabetically by path', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      // Write multiple files and stage (simulating patch apply --index)
      await writeFile(join(created.worktreePath, 'src/zzz.ts'), 'export {}\n')
      await writeFile(join(created.worktreePath, 'src/aaa.ts'), 'export {}\n')
      await writeFile(join(created.worktreePath, 'src/mmm.ts'), 'export {}\n')
      await runGit(created.worktreePath, ['add', '.'])

      const result = await computeManifest({
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const paths = result.entries.map((e) => e.path)
      const sorted = [...paths].sort()
      expect(paths).toEqual(sorted)
    })
  })
})
