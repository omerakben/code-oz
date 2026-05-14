// Unit tests for src/worktree/reset.ts (v0.20.3 finding #1).
//
// Codex debate `019e28d9-bd57-71e0-b1a2-262cae205234` locked the primitive's
// contract: every BUILD attempt > 1 must start from the run's immutable base
// commit before the builder sees files, derives file refs, or applies a
// patch. The primitive owns one boundary: `git reset --hard <baseSha>`
// followed by `git clean -fdx`. No reads or writes of `base.txt`; the
// caller passes the already-bound `baseCommitSha`.

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'
import { resetWorktreeToBase } from '../src/worktree/reset.ts'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(
      `worktree tests require git >= 2.40 on PATH; doctor reports: ${JSON.stringify(probe)}`,
    )
  }
})

let tmp: string
let repoRoot: string
let baseSha: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-worktree-reset-'))
  repoRoot = join(tmp, 'project')
  await mkdir(repoRoot, { recursive: true })
  await runGit(repoRoot, ['init', '-q', '-b', 'main'])
  await runGit(repoRoot, ['config', 'user.email', 'test@example.com'])
  await runGit(repoRoot, ['config', 'user.name', 'Test'])
  await runGit(repoRoot, ['config', 'commit.gpgsign', 'false'])
  // Base commit: a single file at root.
  await writeFile(join(repoRoot, 'base.txt'), 'base content\n', { encoding: 'utf8' })
  await runGit(repoRoot, ['add', 'base.txt'])
  await runGit(repoRoot, ['commit', '-q', '-m', 'base'])
  const headProbe = await runGit(repoRoot, ['rev-parse', 'HEAD'])
  if (!headProbe.ok) throw new Error('failed to capture base sha for test setup')
  baseSha = headProbe.stdout.trim()
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('resetWorktreeToBase — happy path clears every dirtiness class', () => {
  test('clears tracked-modified, staged-added, untracked, and ignored files; returns ok with durationMs', async () => {
    // (a) Modify a tracked file.
    await writeFile(join(repoRoot, 'base.txt'), 'attempt-1 mutation\n', { encoding: 'utf8' })
    // (b) Stage a new file (additions from attempt 1's patch).
    await writeFile(join(repoRoot, 'attempt-1-added.ts'), 'export const x = 1\n', {
      encoding: 'utf8',
    })
    await runGit(repoRoot, ['add', 'attempt-1-added.ts'])
    // (c) Untracked file (a stray file attempt 1 wrote but never staged).
    await writeFile(join(repoRoot, 'stray.txt'), 'never committed\n', { encoding: 'utf8' })
    // (d) Ignored file (matches a .gitignore rule).
    await writeFile(join(repoRoot, '.gitignore'), 'ignored.log\n', { encoding: 'utf8' })
    await runGit(repoRoot, ['add', '.gitignore'])
    await runGit(repoRoot, ['commit', '-q', '-m', 'add gitignore'])
    // Capture the post-gitignore sha so we can verify the reset returns
    // the worktree to THIS state (the most recent commit) when invoked
    // with that sha. For the original baseSha test we use the original.
    await writeFile(join(repoRoot, 'ignored.log'), 'attempt-1 log spam\n', {
      encoding: 'utf8',
    })

    const before = Date.now()
    const result = await resetWorktreeToBase({
      worktreePath: repoRoot,
      baseCommitSha: baseSha,
    })
    const after = Date.now()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // durationMs is non-negative and within sane bounds.
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.durationMs).toBeLessThanOrEqual(after - before + 50)

    // Tracked file restored to base content.
    expect(await readFile(join(repoRoot, 'base.txt'), 'utf8')).toBe('base content\n')
    // Staged-added file removed.
    expect(existsSync(join(repoRoot, 'attempt-1-added.ts'))).toBe(false)
    // Untracked file removed.
    expect(existsSync(join(repoRoot, 'stray.txt'))).toBe(false)
    // Ignored file removed (clean -fdx removes ignored entries too).
    expect(existsSync(join(repoRoot, 'ignored.log'))).toBe(false)
    // .gitignore (which was committed at the post-base commit) is removed
    // because reset --hard <baseSha> moves HEAD back to baseSha, and the
    // gitignore was committed AFTER baseSha. clean -fdx then removes any
    // residual.
    expect(existsSync(join(repoRoot, '.gitignore'))).toBe(false)

    // HEAD points at baseSha.
    const headProbe = await runGit(repoRoot, ['rev-parse', 'HEAD'])
    expect(headProbe.ok).toBe(true)
    if (!headProbe.ok) return
    expect(headProbe.stdout.trim()).toBe(baseSha)

    // Working tree is clean (no diff vs HEAD, no untracked).
    const status = await runGit(repoRoot, ['status', '--porcelain'])
    expect(status.ok).toBe(true)
    if (!status.ok) return
    expect(status.stdout).toBe('')
  })

  test('a no-op call on an already-clean worktree at baseSha still returns ok', async () => {
    // No mutations. Worktree is already at baseSha with no changes.
    const result = await resetWorktreeToBase({
      worktreePath: repoRoot,
      baseCommitSha: baseSha,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    // base.txt still present + unchanged.
    expect(await readFile(join(repoRoot, 'base.txt'), 'utf8')).toBe('base content\n')
  })
})

describe('resetWorktreeToBase — failure path', () => {
  test('returns worktree_reset_failed when baseSha does not exist in repo', async () => {
    const result = await resetWorktreeToBase({
      worktreePath: repoRoot,
      baseCommitSha: '0000000000000000000000000000000000000000',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('worktree_reset_failed')
    // Reason should name which git command failed (reset --hard, since clean
    // never runs when reset fails). Bounded stderr so the operator can read it.
    expect(result.reason).toContain('git reset --hard')
    expect(result.reason.length).toBeLessThan(2000)
  })

  test('returns worktree_reset_failed when worktreePath is not a git repository', async () => {
    const nonRepo = join(tmp, 'not-a-repo')
    await mkdir(nonRepo, { recursive: true })
    const result = await resetWorktreeToBase({
      worktreePath: nonRepo,
      baseCommitSha: baseSha,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('worktree_reset_failed')
    expect(result.reason).toContain('git reset --hard')
  })
})
