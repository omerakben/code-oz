// M7 worktree inspection — read-only utilities for examining a run's
// worktree state.
//
// Used by:
// - BUILD entry preflight (per docs/contracts/BUILD.md § "BUILD entry
//   preflight"): reads base.txt to confirm the bound base.
// - `code-oz status` (W2) for human inspection.
// - Tests that need to verify worktree state without depending on the
//   creator function.

import { readFile, readdir, access } from 'node:fs/promises'
import { runPaths, type WorktreePaths } from './paths.ts'

export interface InspectionResult {
  readonly runId: string
  readonly paths: WorktreePaths
  readonly worktreeExists: boolean
  /** `null` if base.txt is missing. */
  readonly baseCommitSha: string | null
  /** Patch filenames present (no path prefix). */
  readonly patchFiles: readonly string[]
  /** Forensics directories present (basename = attempt number). */
  readonly forensicsAttempts: readonly string[]
  /** Build-drafts directories present (basename = `<T-NNN>-attempt-<N>`). */
  readonly buildDraftsAttempts: readonly string[]
}

export async function inspectRunWorktree(opts: {
  readonly cwd: string
  readonly runId: string
}): Promise<InspectionResult> {
  const paths = runPaths(opts.cwd, opts.runId)
  const [worktreeExists, baseCommitSha, patchFiles, forensicsAttempts, buildDraftsAttempts] =
    await Promise.all([
      pathExists(paths.worktree),
      readBaseFile(paths.baseFile),
      listDirSorted(paths.patches),
      listDirSorted(paths.forensics),
      listDirSorted(paths.buildDrafts),
    ])
  return Object.freeze({
    runId: opts.runId,
    paths,
    worktreeExists,
    baseCommitSha,
    patchFiles,
    forensicsAttempts,
    buildDraftsAttempts,
  })
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function readBaseFile(p: string): Promise<string | null> {
  try {
    const text = await readFile(p, { encoding: 'utf8' })
    const sha = text.trim()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

async function listDirSorted(p: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(p)
    return Object.freeze([...entries].sort())
  } catch {
    return Object.freeze([])
  }
}
