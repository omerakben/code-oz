// Path helpers for the M7 worktree subsystem (per docs/contracts/WORKTREE.md).
//
// Two parallel run trees share the same <runId> but never write to each other:
//   .code-oz/runs/<runId>/        — worktree, patches, forensics, base.txt, README.md (this file)
//   .code-oz/state/runs/<runId>/  — events.jsonl, gate files, current.json (state subsystem)
//
// All helpers return absolute paths (resolved against cwd). Every helper
// validates `runId` matches the 26-char Crockford ULID regex before
// joining. A corrupted active.json or any caller passing an untrusted
// runId would otherwise trigger path-traversal in `git worktree remove
// --force` or other downstream fs operations. Defense-in-depth: callers
// should still validate at the command-layer entry point, but the
// helpers refuse anything that doesn't match the locked ULID format.

import { join } from 'node:path'
import { paths } from '../paths.ts'

const RUN_ID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/

function assertValidRunId(runId: string): void {
  if (!RUN_ID_REGEX.test(runId)) {
    throw new Error(
      `invalid runId: ${JSON.stringify(runId)} (must be a 26-char Crockford ULID)`,
    )
  }
}

export interface WorktreePaths {
  /** `.code-oz/runs/<runId>/` — the run directory root. */
  readonly run: string
  /** `.code-oz/runs/<runId>/worktree/` — the detached git worktree. */
  readonly worktree: string
  /** `.code-oz/runs/<runId>/patches/` — one patch per BUILD attempt. */
  readonly patches: string
  /** `.code-oz/runs/<runId>/forensics/` — populated only on VERIFY-fail (M8+). */
  readonly forensics: string
  /** `.code-oz/runs/<runId>/build-drafts/` — preserved BUILD-fail drafts (per Codex M7 review C1; reject of decision 11). */
  readonly buildDrafts: string
  /** `.code-oz/runs/<runId>/base.txt` — immutable base commit SHA, one line. */
  readonly baseFile: string
  /** `.code-oz/runs/<runId>/README.md` — human-readable run pointer. */
  readonly readme: string
}

export function runPaths(cwd: string, runId: string): WorktreePaths {
  assertValidRunId(runId)
  const run = join(paths(cwd).runs, runId)
  return Object.freeze({
    run,
    worktree: join(run, 'worktree'),
    patches: join(run, 'patches'),
    forensics: join(run, 'forensics'),
    buildDrafts: join(run, 'build-drafts'),
    baseFile: join(run, 'base.txt'),
    readme: join(run, 'README.md'),
  })
}

/**
 * Patch filename for a given task and attempt. Path is absolute.
 *
 * Layout: `.code-oz/runs/<runId>/patches/<T-NNN>-attempt-<N>.patch`.
 */
export function patchFilePath(
  cwd: string,
  runId: string,
  taskId: string,
  attempt: number,
): string {
  assertValidRunId(runId)
  if (!/^T-\d{3,}$/.test(taskId)) {
    throw new Error(`invalid taskId: ${taskId} (must match /^T-\\d{3,}$/)`)
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`invalid attempt: ${attempt} (must be a positive integer)`)
  }
  return join(runPaths(cwd, runId).patches, `${taskId}-attempt-${attempt}.patch`)
}

/**
 * Forensics directory for a failed VERIFY attempt N (M8+). Path is absolute.
 *
 * Layout: `.code-oz/runs/<runId>/forensics/<N>/`.
 */
export function forensicsAttemptPath(cwd: string, runId: string, attempt: number): string {
  assertValidRunId(runId)
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`invalid attempt: ${attempt} (must be a positive integer)`)
  }
  return join(runPaths(cwd, runId).forensics, String(attempt))
}

/**
 * Build-drafts directory for a failed BUILD attempt (per Codex M7 review,
 * reject of decision 11). Path is absolute.
 *
 * Layout: `.code-oz/runs/<runId>/build-drafts/<T-NNN>-attempt-<N>/`.
 */
export function buildDraftsAttemptPath(
  cwd: string,
  runId: string,
  taskId: string,
  attempt: number,
): string {
  assertValidRunId(runId)
  if (!/^T-\d{3,}$/.test(taskId)) {
    throw new Error(`invalid taskId: ${taskId} (must match /^T-\\d{3,}$/)`)
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`invalid attempt: ${attempt} (must be a positive integer)`)
  }
  return join(runPaths(cwd, runId).buildDrafts, `${taskId}-attempt-${attempt}`)
}
