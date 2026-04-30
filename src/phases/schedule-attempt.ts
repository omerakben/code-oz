// Schedule-attempt-N+1 orchestrator (M8 fix 4).
//
// Per Codex review M8 finding bp#8 (block-next-milestone follow-up):
// runVerify() emits worktree_forensics_preserved + verify_failed on a
// fail, and returns a VerifyFailed with carryForward populated. The
// REMAINING two canonical fail events (worktree_destroyed,
// verify_restart_initiated) fire from this orchestrator, which:
//
//   1. Removes the failed worktree (git worktree remove)
//   2. Emits worktree_destroyed
//   3. Emits verify_restart_initiated with nextAction='restart' +
//      nextAttempt OR nextAction='intervention'
//
// Locked event order per Codex M8 decision 8:
//
//   worktree_forensics_preserved → verify_failed (runVerify)
//   → worktree_destroyed → verify_restart_initiated (this module)
//
// The next BUILD attempt is NOT scheduled by this function — that's
// the run-loop's job in M9+. This module handles only the two fail
// events that finalize the attempt N teardown so the run state is
// consistent before attempt N+1 begins.

import type { VerifyFailed } from './verify.ts'
import { appendEvent, type EventLogPaths } from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { type RunPaths } from '../state/run.ts'
import { removeRunWorktree } from '../worktree/remove-run-worktree.ts'

export interface ScheduleAttemptOptions {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly cwd: string
  /** The verifier agent name — recorded on intervention gates. */
  readonly verifierAgent: string
  /** The verify result that triggered this scheduling decision. */
  readonly verifyFailed: VerifyFailed
  readonly now?: () => string
}

export interface ScheduleAttemptOk {
  readonly ok: true
  readonly nextAction: 'restart' | 'intervention'
  readonly nextAttempt?: number
}

export interface ScheduleAttemptErr {
  readonly ok: false
  readonly code: string
  readonly reason: string
}

export type ScheduleAttemptResult = ScheduleAttemptOk | ScheduleAttemptErr

function eventPathsFor(paths: RunPaths): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

function gatePathsFor(paths: RunPaths): GatePaths {
  return {
    runDir: paths.runDir,
    artifactRoot: paths.artifactRoot,
    lockDir: paths.lockDir,
  }
}

/**
 * Finalizes attempt N's teardown after a VERIFY-fail by emitting the
 * remaining two canonical events. Should be called by the run-loop
 * AFTER runVerify returns a VerifyFailed result, BEFORE scheduling
 * attempt N+1's BUILD.
 *
 * On removal failure: writes a NEEDS_INTERVENTION.json (worktree
 * cleanup is the orchestrator's responsibility per CLAUDE.md rule 1).
 */
export async function scheduleAttemptNPlus1(
  opts: ScheduleAttemptOptions,
): Promise<ScheduleAttemptResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const eventPaths = eventPathsFor(opts.runPaths)

  const removed = await removeRunWorktree({ cwd: opts.cwd, runId: opts.runId })
  if (!removed.ok) {
    // Worktree cleanup failed; produce intervention rather than emitting
    // a misleading worktree_destroyed event.
    await writeNeedsInterventionGate(gatePathsFor(opts.runPaths), {
      version: 1,
      runId: opts.runId,
      phase: 'verify',
      agent: opts.verifierAgent,
      code: 'verify_worktree_cleanup_failed',
      rule: `failed to remove worktree after VERIFY-fail: ${removed.reason}`,
      actionableSuggestions: [
        'Inspect the failed worktree at .code-oz/runs/<runId>/worktree/.',
        'Run `git worktree list` and `git worktree remove --force <path>` manually.',
        'Re-run scheduling once the worktree is gone.',
      ],
      createdAt: now(),
    })
    await appendEvent(eventPaths, {
      version: 1,
      type: 'intervention',
      ts: now(),
      runId: opts.runId,
      phase: 'verify',
      code: 'verify_worktree_cleanup_failed',
    })
    return Object.freeze({
      ok: false as const,
      code: 'verify_worktree_cleanup_failed',
      reason: removed.reason,
    })
  }

  // Emit worktree_destroyed scoped to the just-failed attempt.
  await appendEvent(eventPaths, {
    version: 1,
    type: 'worktree_destroyed',
    ts: now(),
    runId: opts.runId,
    phase: 'verify',
    attempt: opts.verifyFailed.attempt,
    worktreePath: removed.worktreePath,
  })

  // Emit verify_restart_initiated.
  if (opts.verifyFailed.nextAction === 'restart') {
    await appendEvent(eventPaths, {
      version: 1,
      type: 'verify_restart_initiated',
      ts: now(),
      runId: opts.runId,
      phase: 'verify',
      taskId: opts.verifyFailed.taskId,
      attempt: opts.verifyFailed.attempt,
      nextAction: 'restart' as const,
      nextAttempt: opts.verifyFailed.nextAttempt as number,
      forensicsPath: opts.verifyFailed.forensicsPath,
    })
    return Object.freeze({
      ok: true as const,
      nextAction: 'restart' as const,
      nextAttempt: opts.verifyFailed.nextAttempt,
    })
  }

  // intervention path: cap reached. The cap-exhaustion intervention
  // gate was already written by runVerify; here we only emit the
  // restart_initiated event with action=intervention so the event log
  // records the canonical sequence.
  await appendEvent(eventPaths, {
    version: 1,
    type: 'verify_restart_initiated',
    ts: now(),
    runId: opts.runId,
    phase: 'verify',
    taskId: opts.verifyFailed.taskId,
    attempt: opts.verifyFailed.attempt,
    nextAction: 'intervention' as const,
    forensicsPath: opts.verifyFailed.forensicsPath,
  })
  return Object.freeze({
    ok: true as const,
    nextAction: 'intervention' as const,
  })
}
