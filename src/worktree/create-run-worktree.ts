// M7 worktree creation (per docs/contracts/WORKTREE.md § "Creation").
//
// Four-step atomic-on-success sequence. Failure at any step destroys
// partial state and returns a structured failure result. The caller
// owns event emission (worktree_created / worktree_failed); this module
// is a pure orchestrator subroutine.
//
// Per Codex M7 implementation review C3 (thread 019ddeea): the worktree
// must survive the BUILD gate so M8's VERIFY can read it. There is no
// cleanup-on-success in M7. The remove module ships the helper but
// nothing calls it on the success path until M8.

import { mkdir, writeFile, access } from 'node:fs/promises'
import { runPaths, type WorktreePaths } from './paths.ts'

export type DirtyTreePolicy = 'clean-base' | 'stash-and-pin'

export interface CreateRunWorktreeOptions {
  readonly cwd: string
  readonly runId: string
  readonly dirtyTreePolicy?: DirtyTreePolicy
}

export interface CreateRunWorktreeOk {
  readonly ok: true
  readonly baseCommitSha: string
  readonly worktreePath: string
  readonly dirtyTreePolicy: DirtyTreePolicy
  readonly paths: WorktreePaths
}

export interface CreateRunWorktreeFailed {
  readonly ok: false
  readonly step: 1 | 2 | 3 | 4
  readonly code: string
  readonly reason: string
}

export type CreateRunWorktreeResult = CreateRunWorktreeOk | CreateRunWorktreeFailed

/**
 * Creates a per-run worktree following the four-step sequence in
 * `docs/contracts/WORKTREE.md`. Returns a frozen result; callers are
 * responsible for emitting `worktree_created` (on ok) or `worktree_failed`
 * (on failure).
 */
export async function createRunWorktree(
  opts: CreateRunWorktreeOptions,
): Promise<CreateRunWorktreeResult> {
  const policy: DirtyTreePolicy = opts.dirtyTreePolicy ?? 'clean-base'
  const paths = runPaths(opts.cwd, opts.runId)

  // Reject if the run path already exists. Step 0 (precondition).
  if (await pathExists(paths.run)) {
    return Object.freeze({
      ok: false as const,
      step: 1,
      code: 'worktree_create_path_exists',
      reason: `run path already exists: ${paths.run}`,
    })
  }

  // Step 1 — capture base commit SHA.
  const baseResult = await captureBaseCommit(opts.cwd, policy)
  if (!baseResult.ok) {
    return Object.freeze({
      ok: false as const,
      step: 1,
      code: baseResult.code,
      reason: baseResult.reason,
    })
  }
  const baseCommitSha = baseResult.sha

  // Step 2 — git worktree add --detach.
  const addResult = await runGit(opts.cwd, [
    'worktree',
    'add',
    '--detach',
    paths.worktree,
    baseCommitSha,
  ])
  if (!addResult.ok) {
    return Object.freeze({
      ok: false as const,
      step: 2,
      code: classifyWorktreeAddError(addResult.stderr),
      reason: trimReason(addResult.stderr),
    })
  }

  // Step 3 — supporting dirs.
  try {
    await mkdir(paths.patches, { recursive: true })
    await mkdir(paths.forensics, { recursive: true })
    await mkdir(paths.buildDrafts, { recursive: true })
  } catch (err) {
    await rollbackWorktree(opts.cwd, paths.worktree)
    return Object.freeze({
      ok: false as const,
      step: 3,
      code: 'worktree_create_supporting_dirs_failed',
      reason: trimReason((err as Error).message),
    })
  }

  // Step 4 — base.txt and README.md.
  try {
    await writeFile(paths.baseFile, baseCommitSha + '\n', { encoding: 'utf8' })
    await writeFile(
      paths.readme,
      buildReadme({ runId: opts.runId, baseCommitSha, policy, worktreePath: paths.worktree }),
      { encoding: 'utf8' },
    )
  } catch (err) {
    await rollbackWorktree(opts.cwd, paths.worktree)
    return Object.freeze({
      ok: false as const,
      step: 4,
      code: 'worktree_create_metadata_write_failed',
      reason: trimReason((err as Error).message),
    })
  }

  return Object.freeze({
    ok: true as const,
    baseCommitSha,
    worktreePath: paths.worktree,
    dirtyTreePolicy: policy,
    paths,
  })
}

async function captureBaseCommit(
  cwd: string,
  policy: DirtyTreePolicy,
): Promise<{ ok: true; sha: string } | { ok: false; code: string; reason: string }> {
  if (policy === 'stash-and-pin') {
    // git stash create returns sha (or empty if nothing to stash). When
    // empty, fall back to HEAD.
    const stashResult = await runGit(cwd, ['stash', 'create'])
    if (!stashResult.ok) {
      return { ok: false, code: 'worktree_stash_create_failed', reason: trimReason(stashResult.stderr) }
    }
    const stashSha = stashResult.stdout.trim()
    if (stashSha.length > 0) {
      if (!/^[0-9a-f]{40}$/.test(stashSha)) {
        return {
          ok: false,
          code: 'worktree_base_sha_invalid',
          reason: `git stash create returned non-sha output: ${stashSha}`,
        }
      }
      return { ok: true, sha: stashSha }
    }
    // Empty stash → no working-tree changes; fall through to HEAD.
  }

  const headResult = await runGit(cwd, ['rev-parse', 'HEAD'])
  if (!headResult.ok) {
    // Distinguish "git repo with zero commits yet" from "broken HEAD on a
    // non-empty repo". The empty-repo case has an actionable remedy
    // (`git commit --allow-empty`); the broken-HEAD case requires manual
    // investigation. Discriminator: `git rev-list --all --count` returns
    // `0` only when the repo has zero commits anywhere.
    const commitCount = await runGit(cwd, ['rev-list', '--all', '--count'])
    if (commitCount.ok && commitCount.stdout.trim() === '0') {
      return {
        ok: false,
        code: 'worktree_empty_repo',
        reason: 'git repository has no commits yet',
      }
    }
    return { ok: false, code: 'worktree_base_head_unknown', reason: trimReason(headResult.stderr) }
  }
  const sha = headResult.stdout.trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    return {
      ok: false,
      code: 'worktree_base_sha_invalid',
      reason: `git rev-parse HEAD returned non-sha output: ${sha}`,
    }
  }
  return { ok: true, sha }
}

function classifyWorktreeAddError(stderr: string): string {
  if (/already exists/i.test(stderr)) return 'worktree_create_path_exists'
  if (/not a valid object/i.test(stderr) || /unknown revision/i.test(stderr)) {
    return 'worktree_create_base_unknown'
  }
  if (/not a git repository/i.test(stderr)) return 'worktree_create_not_a_repo'
  return 'worktree_add_failed'
}

async function rollbackWorktree(cwd: string, worktreePath: string): Promise<void> {
  // Best-effort cleanup. Errors here are not surfaced; the original step
  // failure is what matters.
  await runGit(cwd, ['worktree', 'remove', '--force', worktreePath]).catch(() => null)
}

interface RunGitOk {
  readonly ok: true
  readonly stdout: string
  readonly stderr: string
}

interface RunGitErr {
  readonly ok: false
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
}

export async function runGit(cwd: string, args: readonly string[]): Promise<RunGitOk | RunGitErr> {
  try {
    const proc = Bun.spawn(['git', '-C', cwd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return { ok: false, stdout, stderr, exitCode }
    }
    return { ok: true, stdout, stderr }
  } catch (err) {
    return { ok: false, stdout: '', stderr: (err as Error).message, exitCode: null }
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

function trimReason(s: string): string {
  return s.trim().slice(0, 200)
}

function buildReadme(args: {
  runId: string
  baseCommitSha: string
  policy: DirtyTreePolicy
  worktreePath: string
}): string {
  return `# code-oz run ${args.runId}

This directory holds the per-run worktree, patches, forensics, and
build-drafts for run \`${args.runId}\`. State (events.jsonl, gate files,
current.json) lives at .code-oz/state/runs/${args.runId}/, NOT here.

- Base commit: ${args.baseCommitSha}
- Dirty-tree policy: ${args.policy}
- Worktree: ${args.worktreePath}

In M7 (BUILD-lite), the worktree survives the BUILD gate. Cleanup-on-
success requires VERIFY-pass (M8+); manual cleanup via \`code-oz prune\`
in W2.

See docs/contracts/WORKTREE.md for the full contract.
`
}
