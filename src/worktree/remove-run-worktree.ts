// M7 worktree removal (per docs/contracts/WORKTREE.md § "Removal").
//
// Two paths, both gated on VERIFY (M8+):
//
//   - Cleanup-on-success: VERIFY-pass triggers. Worktree dir removed;
//     forensics/ stays empty; patches/ retained.
//   - Preserve-on-failure: VERIFY-fail triggers. forensics/<N>/ written
//     FIRST, then worktree dir removed. patches/<T-NNN>-attempt-<N>.patch
//     retained.
//
// In M7, neither path fires automatically — BUILD-pass alone never
// removes the worktree (per Codex M7 implementation review C3, thread
// 019ddeea). This module ships the helpers; M8 wires them.

import { runGit } from './create-run-worktree.ts'
import { runPaths } from './paths.ts'

export interface RemoveRunWorktreeOptions {
  readonly cwd: string
  readonly runId: string
}

export interface RemoveRunWorktreeOk {
  readonly ok: true
  readonly worktreePath: string
}

export interface RemoveRunWorktreeFailed {
  readonly ok: false
  readonly code: string
  readonly reason: string
}

export type RemoveRunWorktreeResult = RemoveRunWorktreeOk | RemoveRunWorktreeFailed

/**
 * Removes the per-run worktree directory via `git worktree remove --force`.
 * The run directory itself (patches/, forensics/, base.txt, README.md) is
 * preserved; only the `worktree/` subdir is destroyed. Cleanup of the run
 * directory belongs to `code-oz prune` (W2).
 *
 * Caller is responsible for emitting `worktree_destroyed` on ok.
 */
export async function removeRunWorktree(
  opts: RemoveRunWorktreeOptions,
): Promise<RemoveRunWorktreeResult> {
  const paths = runPaths(opts.cwd, opts.runId)
  const result = await runGit(opts.cwd, ['worktree', 'remove', '--force', paths.worktree])
  if (!result.ok) {
    return Object.freeze({
      ok: false as const,
      code: 'worktree_remove_failed',
      reason: result.stderr.trim().slice(0, 200) || 'git worktree remove returned non-zero',
    })
  }
  return Object.freeze({
    ok: true as const,
    worktreePath: paths.worktree,
  })
}
