// v0.20.3 finding #1 — BUILD worktree reset between attempts.
//
// Codex debate `019e28d9-bd57-71e0-b1a2-262cae205234` locked the contract:
// every BUILD attempt > 1 starts from the run's immutable base commit
// before the builder sees files, derives file refs, or applies a patch.
// This primitive is the BUILD-entry worktree-normalization authority.
//
// One callable: `resetWorktreeToBase({ worktreePath, baseCommitSha })`.
// Two git invocations:
//   1. `git reset --hard <baseCommitSha>`  — discard tracked-modified +
//      staged-but-uncommitted changes; move HEAD back to baseSha.
//   2. `git clean -fdx`                    — remove untracked + ignored
//      files (the only way to clear attempt-N output files that never
//      reached `git apply --index`).
// Both run at `worktreePath`. The caller passes the already-bound base
// SHA from `WorktreeBinding.baseCommitSha`; this primitive does NOT
// read or write `.code-oz/runs/<runId>/base.txt`.

import { runGit } from './create-run-worktree.ts'

export interface ResetWorktreeOptions {
  readonly worktreePath: string
  readonly baseCommitSha: string
}

export interface ResetWorktreeOk {
  readonly ok: true
  readonly durationMs: number
}

export interface ResetWorktreeFailed {
  readonly ok: false
  readonly code: 'worktree_reset_failed'
  readonly reason: string
}

export type ResetWorktreeResult = ResetWorktreeOk | ResetWorktreeFailed

/**
 * Resets the per-run worktree to the immutable base commit, then removes
 * untracked + ignored files. The post-condition is `git status --porcelain`
 * empty AND HEAD pointing at `baseCommitSha`. Failure to satisfy either
 * step returns a structured failure with the failing git command name
 * and a bounded stderr excerpt.
 */
export async function resetWorktreeToBase(
  opts: ResetWorktreeOptions,
): Promise<ResetWorktreeResult> {
  const t0 = Date.now()
  const resetResult = await runGit(opts.worktreePath, [
    'reset',
    '--hard',
    opts.baseCommitSha,
  ])
  if (!resetResult.ok) {
    return Object.freeze({
      ok: false as const,
      code: 'worktree_reset_failed' as const,
      reason: `git reset --hard ${opts.baseCommitSha} failed: ${trimReason(resetResult.stderr)}`,
    })
  }
  const cleanResult = await runGit(opts.worktreePath, ['clean', '-fdx'])
  if (!cleanResult.ok) {
    return Object.freeze({
      ok: false as const,
      code: 'worktree_reset_failed' as const,
      reason: `git clean -fdx failed: ${trimReason(cleanResult.stderr)}`,
    })
  }
  return Object.freeze({
    ok: true as const,
    durationMs: Date.now() - t0,
  })
}

function trimReason(stderr: string): string {
  // Bounded stderr — never let unbounded git output pollute the intervention
  // payload. 800 chars is generous for git error messages.
  const trimmed = stderr.trim()
  if (trimmed.length <= 800) return trimmed
  return trimmed.slice(0, 800) + '… (truncated)'
}
