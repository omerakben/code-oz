import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { removeRunWorktree } from '../src/worktree/remove-run-worktree.ts'
import { inspectRunWorktree } from '../src/worktree/inspect-run-worktree.ts'
import { runPaths } from '../src/worktree/paths.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(
      `worktree tests require git >= 2.40 on PATH; doctor reports: ${JSON.stringify(probe)}`,
    )
  }
})

async function withFreshRun<T>(
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeoz-rm-'))
  try {
    await runGit(cwd, ['init', '-q', '-b', 'main'])
    await runGit(cwd, ['config', 'user.email', 'test@example.com'])
    await runGit(cwd, ['config', 'user.name', 'Test'])
    await runGit(cwd, ['config', 'commit.gpgsign', 'false'])
    await writeFile(join(cwd, 'README.md'), '# fixture\n', { encoding: 'utf8' })
    await runGit(cwd, ['add', 'README.md'])
    await runGit(cwd, ['commit', '-q', '-m', 'init'])
    return await fn(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

describe('removeRunWorktree', () => {
  test('removes worktree dir; preserves run dir, patches/, base.txt, README', async () => {
    await withFreshRun(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const result = await removeRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const p = runPaths(cwd, RUN_ID)
      // Worktree dir is gone
      expect(await pathExists(p.worktree)).toBe(false)
      // Run dir survives
      expect(await pathExists(p.run)).toBe(true)
      // Sibling dirs survive
      expect(await pathExists(p.patches)).toBe(true)
      expect(await pathExists(p.forensics)).toBe(true)
      expect(await pathExists(p.buildDrafts)).toBe(true)
      // Base.txt + README.md survive
      expect(await pathExists(p.baseFile)).toBe(true)
      expect(await pathExists(p.readme)).toBe(true)
    })
  })

  test('returns failure code when worktree was never created', async () => {
    await withFreshRun(async (cwd) => {
      const result = await removeRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('worktree_remove_failed')
    })
  })

  test('git no longer lists the removed worktree', async () => {
    await withFreshRun(async (cwd) => {
      await createRunWorktree({ cwd, runId: RUN_ID })
      await removeRunWorktree({ cwd, runId: RUN_ID })
      const list = await runGit(cwd, ['worktree', 'list'])
      expect(list.ok).toBe(true)
      if (!list.ok) return
      expect(list.stdout).not.toContain(RUN_ID)
    })
  })
})

describe('inspectRunWorktree', () => {
  test('reports state of a freshly-created run', async () => {
    await withFreshRun(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const insp = await inspectRunWorktree({ cwd, runId: RUN_ID })
      expect(insp.runId).toBe(RUN_ID)
      expect(insp.worktreeExists).toBe(true)
      expect(insp.baseCommitSha).toBe(created.baseCommitSha)
      expect(insp.patchFiles).toEqual([])
      expect(insp.forensicsAttempts).toEqual([])
      expect(insp.buildDraftsAttempts).toEqual([])
    })
  })

  test('reports baseCommitSha=null when run does not exist', async () => {
    await withFreshRun(async (cwd) => {
      // M9 commit 21 (security audit MEDIUM-2): runPaths now requires
      // a valid 26-char Crockford ULID. The pre-M9 fixture used the
      // string "nonexistent"; replaced with a well-formed ULID for a
      // run that simply was never created on disk. The semantic is
      // unchanged — we're testing that inspect handles a missing run.
      const NEVER_CREATED = '00X3AAA4000000000000000001'
      const insp = await inspectRunWorktree({ cwd, runId: NEVER_CREATED })
      expect(insp.worktreeExists).toBe(false)
      expect(insp.baseCommitSha).toBeNull()
      expect(insp.patchFiles).toEqual([])
    })
  })

  test('M9 commit 21 bp#sec: runPaths rejects path-traversal runId', async () => {
    // Security regression: pre-M9 commit 21, runPaths would happily
    // join an attacker-controlled runId like "../../etc" into the path
    // because it never validated format. Now the helper enforces the
    // ULID regex and throws.
    const { runPaths: worktreePathsFor } = await import(
      '../src/worktree/paths.ts'
    )
    expect(() => worktreePathsFor('/tmp/dummy', '../../../etc')).toThrow(
      /invalid runId/,
    )
    expect(() => worktreePathsFor('/tmp/dummy', '')).toThrow(/invalid runId/)
    expect(() => worktreePathsFor('/tmp/dummy', 'short')).toThrow(/invalid runId/)
    expect(() => worktreePathsFor('/tmp/dummy', 'lower-case-must-fail-here')).toThrow(
      /invalid runId/,
    )
    // Valid Crockford ULID still works.
    const valid = '01HX1ABCDE2FGHJK3MNPQRSTV4'
    expect(() => worktreePathsFor('/tmp/dummy', valid)).not.toThrow()
  })

  test('reports worktreeExists=false after removeRunWorktree', async () => {
    await withFreshRun(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      await removeRunWorktree({ cwd, runId: RUN_ID })

      const insp = await inspectRunWorktree({ cwd, runId: RUN_ID })
      expect(insp.worktreeExists).toBe(false)
      // Base.txt still readable, so baseCommitSha is still reported
      expect(insp.baseCommitSha).toBe(created.baseCommitSha)
    })
  })
})
