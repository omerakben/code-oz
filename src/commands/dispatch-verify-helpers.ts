// Helpers used by `dispatchVerify` in src/commands/run.ts (M16 C7).
//
// Codex C7 pre-design review pinned three load-bearing concerns this
// module addresses:
//
//   1. The dispatcher must NOT hand-emit `verify_restart_initiated`.
//      That event's emission (along with worktree_destroyed +
//      worktree removal) is locked into `scheduleAttemptNPlus1` at
//      src/phases/schedule-attempt.ts. The dispatcher calls that
//      orchestrator after `runVerify` returns a VerifyFailed result.
//   2. After a VERIFY-fail, currentPhase stays at 'verify' (the
//      reducer ignores `verify_restart_initiated`). Without explicit
//      pre-routing in `handleActiveRun`, the next `code-oz run`
//      would loop back into VERIFY. This module exports
//      `shouldRouteToBuildRestart` for the pre-route check.
//   3. preApproveBuildHook validates BUILD artifact shas at approve
//      time, but a hand-edit between approve and run-verify would
//      silently run with edited bytes. `resolveVerifyArtifacts`
//      re-validates: BUILD_REPORT.md sha vs build_completed event,
//      prompt snapshot sha vs event, patch sha vs BUILD_REPORT.md's
//      patch section.
//
// Shared helpers (NEEDS_INTERVENTION read, plan loader, intervention
// formatter) live in dispatch-build-helpers.ts and are imported here.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PlanArtifact } from '../artifacts/plan.ts'
import {
  parseBuildReport,
  BuildReportLoadError,
} from '../artifacts/build-report.ts'
import { isKnownPhaseEvent, type LoggedEvent } from '../state/schemas.ts'
import {
  buildPromptSnapshotPath,
  patchFilePath,
} from '../worktree/paths.ts'

// --- build_completed lookup ---------------------------------------

export interface BuildCompletedRecord {
  readonly attempt: number
  readonly taskId: string
  readonly buildReportSha256: string
  readonly promptSnapshotSha256: string
  readonly ts: string
}

/**
 * Returns the most recent `build_completed` event for `(runId, taskId)`,
 * or `null` when none exists. "Most recent" is last-occurrence in event
 * order (events.jsonl is append-only); equal attempts keep last-wins.
 */
export function findLatestBuildCompleted(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): BuildCompletedRecord | null {
  let latest: BuildCompletedRecord | null = null
  let latestIndex = -1
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'build_completed') continue
    if (e.runId !== runId) continue
    const completed = e as Extract<LoggedEvent, { type: 'build_completed' }>
    if (completed.taskId !== taskId) continue
    if (i > latestIndex) {
      latest = Object.freeze({
        attempt: completed.attempt,
        taskId: completed.taskId,
        buildReportSha256: completed.buildReportSha256,
        promptSnapshotSha256: completed.promptSnapshotSha256,
        ts: completed.ts,
      })
      latestIndex = i
    }
  }
  return latest
}

// --- verify_restart_initiated lookup ------------------------------

export interface VerifyRestartRecord {
  readonly attempt: number
  readonly nextAction: 'restart' | 'intervention'
  readonly nextAttempt?: number
  readonly forensicsPath: string
  readonly ts: string
}

/**
 * Returns the most recent `verify_restart_initiated` event for
 * `(runId, taskId)`, or `null`.
 */
export function findLatestVerifyRestart(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): VerifyRestartRecord | null {
  let latest: VerifyRestartRecord | null = null
  let latestIndex = -1
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'verify_restart_initiated') continue
    if (e.runId !== runId) continue
    const restart = e as Extract<LoggedEvent, { type: 'verify_restart_initiated' }>
    if (restart.taskId !== taskId) continue
    if (i > latestIndex) {
      latest = Object.freeze({
        attempt: restart.attempt,
        nextAction: restart.nextAction,
        ...(restart.nextAttempt !== undefined ? { nextAttempt: restart.nextAttempt } : {}),
        forensicsPath: restart.forensicsPath,
        ts: restart.ts,
      })
      latestIndex = i
    }
  }
  return latest
}

// --- verify_completed lookup --------------------------------------

/**
 * Returns the most recent `verify_completed` event for `(runId, taskId)`
 * with its attempt, or `null`. Used by the dispatcher to detect the
 * crash-window between `verify_completed` and `gate_required(verify)`.
 */
export function findLatestVerifyCompleted(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): { readonly attempt: number; readonly ts: string } | null {
  let latest: { attempt: number; ts: string } | null = null
  let latestIndex = -1
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'verify_completed') continue
    if (e.runId !== runId) continue
    const completed = e as Extract<LoggedEvent, { type: 'verify_completed' }>
    if (completed.taskId !== taskId) continue
    if (i > latestIndex) {
      latest = { attempt: completed.attempt, ts: completed.ts }
      latestIndex = i
    }
  }
  return latest === null ? null : Object.freeze(latest)
}

// --- gate_required lookup -----------------------------------------

/**
 * Returns true when a `gate_required` event for the given phase exists
 * in the run's history (any attempt, any task — gate_required carries
 * `phase` only). `runVerify` emits `gate_required(verify)` after a
 * passing VERIFY; absence of this event after a `verify_completed`
 * indicates a crash window.
 */
export function hasGateRequired(
  events: readonly LoggedEvent[],
  runId: string,
  phase: 'build' | 'verify' | 'review',
): boolean {
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'gate_required') continue
    if (e.runId !== runId) continue
    if (e.phase === phase) return true
  }
  return false
}

// --- routing pre-check --------------------------------------------

/**
 * True when the cursor's pending task has a `verify_restart_initiated`
 * with `nextAction='restart'` that has NOT been picked up by a
 * subsequent `build_started` for `nextAttempt`. `handleActiveRun` uses
 * this to route to `dispatchBuild` instead of `dispatchVerify` when the
 * BUILD/VERIFY restart loop is waiting on the next BUILD attempt.
 *
 * Returns false when there is no pending task, no restart signal, the
 * latest restart is `intervention`, or the next BUILD attempt has
 * already started (the loop has moved past the restart point).
 */
export function shouldRouteToBuildRestart(
  events: readonly LoggedEvent[],
  plan: PlanArtifact,
  runId: string,
): boolean {
  // Walk PLAN.md tasks in declared order; find the first non-completed
  // task that has a pending restart signal. We look at the first
  // pending task only — the cursor is single-pointer, and the restart
  // signal must apply to the NEXT BUILD attempt, not a later one.
  const completedTaskIds = new Set<string>()
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'task_completed') continue
    if (e.runId !== runId) continue
    completedTaskIds.add(e.taskId)
  }
  let pending: { taskId: string } | null = null
  for (const t of plan.tasks) {
    if (!completedTaskIds.has(t.id)) {
      pending = { taskId: t.id }
      break
    }
  }
  if (pending === null) return false

  const restart = findLatestVerifyRestart(events, runId, pending.taskId)
  if (restart === null) return false
  if (restart.nextAction !== 'restart') return false
  if (restart.nextAttempt === undefined) return false

  // Has the next BUILD attempt already started?
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'build_started') continue
    if (e.runId !== runId) continue
    const started = e as Extract<LoggedEvent, { type: 'build_started' }>
    if (started.taskId !== pending.taskId) continue
    if (started.attempt >= restart.nextAttempt) return false
  }
  return true
}

// --- artifact resolution + sha re-validation ----------------------

const SHA = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex')

export interface VerifyArtifactBytes {
  readonly buildReportText: string
  readonly buildReportSha256: string
  readonly patchText: string
  readonly patchSha256: string
  readonly promptText: string
  readonly promptSha256: string
  readonly attempt: number
  readonly taskId: string
}

export type ResolveVerifyArtifactsResult =
  | { readonly kind: 'ok'; readonly artifacts: VerifyArtifactBytes }
  | { readonly kind: 'drift'; readonly reason: string }

export interface ResolveVerifyArtifactsInput {
  readonly events: readonly LoggedEvent[]
  readonly runId: string
  readonly taskId: string
  readonly cwd: string
  readonly artifactRoot: string
}

/**
 * Read BUILD artifacts (BUILD_REPORT.md, prompt snapshot, patch) and
 * re-validate every sha against the latest `build_completed` event AND
 * BUILD_REPORT.md's own patch section. On any mismatch, missing file,
 * or absent `build_completed`, returns `kind: 'drift'` with a specific
 * reason — the dispatcher refuses with EXIT_INTERVENTION before
 * invoking runVerify.
 *
 * Codex C7 Mod #3 — preApproveBuildHook validates these at approve
 * time, but operator hand-edits between approve and run-verify would
 * silently run with edited bytes; this re-validation closes that
 * window.
 */
export async function resolveVerifyArtifacts(
  input: ResolveVerifyArtifactsInput,
): Promise<ResolveVerifyArtifactsResult> {
  const completed = findLatestBuildCompleted(input.events, input.runId, input.taskId)
  if (completed === null) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `no build_completed event for (runId=${input.runId}, taskId=${input.taskId})`,
    })
  }
  const attempt = completed.attempt

  // 1. BUILD_REPORT.md
  const buildReportPath = join(input.artifactRoot, 'BUILD_REPORT.md')
  let buildReportText: string
  try {
    buildReportText = await readFile(buildReportPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `BUILD_REPORT.md not found at ${buildReportPath}`,
      })
    }
    throw err
  }
  const buildReportSha256 = SHA(buildReportText)
  if (buildReportSha256 !== completed.buildReportSha256) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `BUILD_REPORT.md sha ${buildReportSha256.slice(0, 8)}… does not match build_completed.buildReportSha256 ${completed.buildReportSha256.slice(0, 8)}… (post-edit detected)`,
    })
  }

  // Parse BUILD_REPORT.md to get the expected patchSha256. The
  // immutable-binding triple (baseCommitSha, patchSha256,
  // buildReportSha256) is the trust anchor; if BUILD_REPORT's sha
  // matched the event, BUILD_REPORT's patchSha256 is the canonical
  // value to compare against.
  let buildReport: ReturnType<typeof parseBuildReport>
  try {
    buildReport = parseBuildReport(buildReportText)
  } catch (err) {
    const reason =
      err instanceof BuildReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
    return Object.freeze({
      kind: 'drift' as const,
      reason: `BUILD_REPORT.md is malformed: ${reason}`,
    })
  }
  if (buildReport.task.taskId !== input.taskId) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `BUILD_REPORT.md taskId='${buildReport.task.taskId}' does not match dispatched taskId='${input.taskId}'`,
    })
  }
  if (buildReport.task.attempt !== attempt) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `BUILD_REPORT.md attempt=${buildReport.task.attempt} does not match build_completed.attempt=${attempt}`,
    })
  }

  // 2. Patch
  const patchPath = patchFilePath(input.cwd, input.runId, input.taskId, attempt)
  let patchText: string
  try {
    patchText = await readFile(patchPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `patch file not found at ${patchPath}`,
      })
    }
    throw err
  }
  const patchSha256 = SHA(patchText)
  if (patchSha256 !== buildReport.patch.patchSha256) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `patch sha ${patchSha256.slice(0, 8)}… does not match BUILD_REPORT.md patch.patchSha256 ${buildReport.patch.patchSha256.slice(0, 8)}…`,
    })
  }

  // 3. Prompt snapshot
  const promptPath = buildPromptSnapshotPath(input.cwd, input.runId, attempt)
  let promptText: string
  try {
    promptText = await readFile(promptPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `BUILD prompt snapshot not found at ${promptPath}`,
      })
    }
    throw err
  }
  const promptSha256 = SHA(promptText)
  if (promptSha256 !== completed.promptSnapshotSha256) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `prompt snapshot sha ${promptSha256.slice(0, 8)}… does not match build_completed.promptSnapshotSha256 ${completed.promptSnapshotSha256.slice(0, 8)}… (post-edit detected)`,
    })
  }

  return Object.freeze({
    kind: 'ok' as const,
    artifacts: Object.freeze({
      buildReportText,
      buildReportSha256,
      patchText,
      patchSha256,
      promptText,
      promptSha256,
      attempt,
      taskId: input.taskId,
    }),
  })
}
