import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRunWorktree,
  runGit,
} from '../src/worktree/create-run-worktree.ts'
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

async function withTempRepo<T>(
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeoz-wt-'))
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

describe('createRunWorktree — happy path', () => {
  test('returns ok with baseCommitSha and worktreePath', async () => {
    await withTempRepo(async (cwd) => {
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.baseCommitSha).toMatch(/^[0-9a-f]{40}$/)
      expect(result.worktreePath).toBe(runPaths(cwd, RUN_ID).worktree)
      expect(result.dirtyTreePolicy).toBe('clean-base')
    })
  })

  test('creates worktree, patches/, forensics/, build-drafts/ dirs', async () => {
    await withTempRepo(async (cwd) => {
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const p = result.paths
      expect(await pathExists(p.worktree)).toBe(true)
      expect(await pathExists(p.patches)).toBe(true)
      expect(await pathExists(p.forensics)).toBe(true)
      expect(await pathExists(p.buildDrafts)).toBe(true)
    })
  })

  test('writes base.txt with sha and trailing newline', async () => {
    await withTempRepo(async (cwd) => {
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const text = await readFile(result.paths.baseFile, { encoding: 'utf8' })
      expect(text).toBe(result.baseCommitSha + '\n')
    })
  })

  test('writes README.md with run pointer', async () => {
    await withTempRepo(async (cwd) => {
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const text = await readFile(result.paths.readme, { encoding: 'utf8' })
      expect(text).toContain(RUN_ID)
      expect(text).toContain(result.baseCommitSha)
      expect(text).toContain('clean-base')
      expect(text).toContain('WORKTREE.md')
    })
  })

  test('worktree contains the host repo HEAD content', async () => {
    await withTempRepo(async (cwd) => {
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const readme = await readFile(join(result.worktreePath, 'README.md'), { encoding: 'utf8' })
      expect(readme).toBe('# fixture\n')
    })
  })

  test('does NOT create worktree under host worktree (path layout)', async () => {
    await withTempRepo(async (cwd) => {
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.worktreePath).toContain('.code-oz/runs')
      expect(result.worktreePath).not.toContain('.code-oz/state')
    })
  })
})

describe('createRunWorktree — dirty-tree policy', () => {
  test('clean-base default: HEAD-bound, ignores host unstaged changes', async () => {
    await withTempRepo(async (cwd) => {
      // Add an unstaged change to the host
      await writeFile(join(cwd, 'README.md'), '# fixture\n# unstaged-change\n', { encoding: 'utf8' })
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const readme = await readFile(join(result.worktreePath, 'README.md'), { encoding: 'utf8' })
      // Worktree must show the committed (HEAD) version, not the host's
      // unstaged variant.
      expect(readme).toBe('# fixture\n')
    })
  })

  test('stash-and-pin: pins host stash without modifying host', async () => {
    await withTempRepo(async (cwd) => {
      // Add an unstaged change to the host
      await writeFile(join(cwd, 'README.md'), '# fixture\n# stashed-change\n', { encoding: 'utf8' })
      const result = await createRunWorktree({
        cwd,
        runId: RUN_ID,
        dirtyTreePolicy: 'stash-and-pin',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Worktree's README should reflect the stash content (host's unstaged
      // changes captured into the synthetic stash commit).
      const readme = await readFile(join(result.worktreePath, 'README.md'), { encoding: 'utf8' })
      expect(readme).toContain('stashed-change')
      // Host worktree still has the unstaged change (not popped).
      const hostReadme = await readFile(join(cwd, 'README.md'), { encoding: 'utf8' })
      expect(hostReadme).toContain('stashed-change')
    })
  })

  test('stash-and-pin with no host changes falls back to HEAD', async () => {
    await withTempRepo(async (cwd) => {
      const result = await createRunWorktree({
        cwd,
        runId: RUN_ID,
        dirtyTreePolicy: 'stash-and-pin',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // base SHA matches host HEAD (no stash because nothing to stash).
      const head = await runGit(cwd, ['rev-parse', 'HEAD'])
      expect(head.ok).toBe(true)
      if (!head.ok) return
      expect(result.baseCommitSha).toBe(head.stdout.trim())
    })
  })
})

describe('createRunWorktree — failure paths', () => {
  test('fails with worktree_create_path_exists when run dir already exists', async () => {
    await withTempRepo(async (cwd) => {
      const p = runPaths(cwd, RUN_ID)
      await mkdir(p.run, { recursive: true })
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.step).toBe(1)
      expect(result.code).toBe('worktree_create_path_exists')
    })
  })

  test('fails with worktree_create_not_a_repo when cwd is not a git repo', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'codeoz-nogit-'))
    try {
      const result = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.step).toBe(1) // rev-parse HEAD fails
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
