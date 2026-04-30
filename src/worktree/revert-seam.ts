// Production RevertSeam for VERIFY's mutation gate (M8 fix 3).
//
// Implements the seam interface declared in src/phases/verify-mutation.ts.
// Backed by `git checkout <baseCommitSha> -- <path>` for files that
// existed at base, plus fs.unlink/fs.writeFile for added/deleted files.
//
// The seam runs in three phases per call:
//
//   1. snapshot(paths): capture each path's current state (bytes or
//      "not present"). Returned as an opaque token for restore.
//   2. revert(files, baseCommitSha): for each file, make the worktree
//      look like base contents:
//        - change='added':    file didn't exist at base → fs.unlink
//        - change='modified': file existed at base → git checkout
//        - change='deleted':  file existed at base → git checkout (re-creates)
//      The orchestrator passes only behavior files; test files are NOT
//      reverted (Codex M8 decision 11 lock).
//   3. restore(snapshot): undo the revert by replaying the snapshot.
//
// Limitations (v0.1):
//   - Operates on individual files, not directories. The mutation gate's
//     manifest-based input never lists directories, so this is fine.
//   - No support for symbolic links or executable-bit changes — VERIFY
//     v0.1 assumes patches are content-only (BUILD's patch grammar
//     rejects symlinks, mode 120000).
//   - No locking. Callers must serialize calls per-worktree.
//
// Codex review M8 finding bp#4 demanded a real seam so the mutation
// gate is exercisable end-to-end. The build-phase test harness
// produces a real worktree; this seam is what makes mutation gate
// integration tests meaningful.

import { unlink, writeFile, readFile, access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ChangedFileEntry, RevertSeam } from '../phases/verify-mutation.ts'
import { runGit } from './create-run-worktree.ts'

interface FileSnapshotEntry {
  readonly path: string
  /** null = file did not exist when snapshotted. */
  readonly content: string | null
}

interface RevertSeamSnapshot {
  readonly token: 'git-revert-seam'
  readonly worktreePath: string
  readonly entries: readonly FileSnapshotEntry[]
}

export interface CreateGitRevertSeamOptions {
  /** Absolute path to the worktree the revert operates on. */
  readonly worktreePath: string
}

/**
 * Builds a production RevertSeam bound to a specific worktree. Mutation
 * gate calls snapshot/revert/restore in order; this implementation
 * uses git checkout for content reverts and direct fs ops for added /
 * deleted file handling.
 */
export function createGitRevertSeam(opts: CreateGitRevertSeamOptions): RevertSeam {
  const wt = opts.worktreePath

  return {
    async snapshot(paths: readonly string[]): Promise<RevertSeamSnapshot> {
      const entries: FileSnapshotEntry[] = []
      for (const rel of paths) {
        const abs = join(wt, rel)
        let content: string | null = null
        try {
          await access(abs)
          content = await readFile(abs, 'utf8')
        } catch {
          content = null
        }
        entries.push({ path: rel, content })
      }
      return Object.freeze({
        token: 'git-revert-seam' as const,
        worktreePath: wt,
        entries: Object.freeze(entries),
      })
    },

    async revert(files: readonly ChangedFileEntry[], baseCommitSha: string): Promise<void> {
      for (const f of files) {
        const abs = join(wt, f.path)
        if (f.change === 'added') {
          // File did not exist at base; remove it from the worktree.
          try {
            await unlink(abs)
          } catch {
            // Already missing — fine.
          }
          continue
        }
        // 'modified' or 'deleted': base had a version; restore it via git.
        const result = await runGit(wt, ['checkout', baseCommitSha, '--', f.path])
        if (!result.ok) {
          throw new Error(
            `git checkout ${baseCommitSha} -- ${f.path} failed (exit ${result.exitCode}): ${result.stderr.trim().slice(0, 200)}`,
          )
        }
      }
    },

    async restore(snapshotIn: unknown): Promise<void> {
      if (!isOurSnapshot(snapshotIn)) {
        throw new Error('createGitRevertSeam.restore received an opaque snapshot from a different seam')
      }
      const snapshot = snapshotIn
      for (const entry of snapshot.entries) {
        const abs = join(snapshot.worktreePath, entry.path)
        if (entry.content === null) {
          // File did not exist when snapshotted — remove the post-revert artifact.
          try {
            await unlink(abs)
          } catch {
            // Already missing — fine.
          }
          continue
        }
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, entry.content, 'utf8')
      }
    },
  }
}

function isOurSnapshot(s: unknown): s is RevertSeamSnapshot {
  return (
    typeof s === 'object' &&
    s !== null &&
    (s as { token?: unknown }).token === 'git-revert-seam'
  )
}
