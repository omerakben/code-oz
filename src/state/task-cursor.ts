// M16 — Per-task lifecycle cursor: pure projection over events.jsonl + PLAN.md.
//
// Trigger: Codex R0 Risk #1 (`docs/research/CODEX_RESPONSE_M16.md`). PLAN.md
// supports multiple `T-NNN` tasks; the state machine only knows phases.
// Without a per-task cursor, `dispatchBuild` cannot decide which task
// BUILD attempt N+1 should target, and `approve review` for task T-001
// would advance currentPhase to `ship` while T-002 / T-003 were never
// built.
//
// Authority surface: this module is **pure** — it takes a parsed PLAN
// artifact + an events.jsonl array and returns a `TaskCursor` snapshot.
// It does NOT mutate state, emit events, write files, or read disk.
// Callers (M16 dispatchers, doctor inspector, resume probe) inject the
// pre-loaded inputs.
//
// Per-task lifecycle (state derived from events):
//   not_started  — no `task_started` for this taskId.
//   in_progress  — `task_started` present; no `task_completed`.
//   completed    — `task_completed` present (the durable signal; emitted
//                  ONLY after GATE_REVIEW_PASSED.json gate write succeeds
//                  per rule 1).
// `task_review_passed` is informational — it records the persona-level
// review-ready signal. The cursor treats it as a hint, not as completion;
// `task_completed` is the binding signal.
//
// Cursor pending-task resolution: the first task in PLAN.md declared
// order whose status is not `completed`. Returns `null` when all tasks
// are completed (the run is ready to advance to SHIP — that transition
// is M17's responsibility).
//
// Resume safety: the cursor is a pure function of (plan, events). It
// has no parallel state; recomputing on the same inputs always yields
// the same answer. Reducers are free to call this between every event
// without coherence risk.

import type { PlanArtifact } from '../artifacts/plan.ts'
import { listPlanTaskIds } from '../artifacts/plan.ts'
import type { LoggedEvent } from './schemas.ts'
import { isKnownPhaseEvent } from './schemas.ts'

export type TaskStatus = 'not_started' | 'in_progress' | 'completed'

export interface TaskCursorEntry {
  /** PLAN.md task id (`T-NNN`). */
  readonly taskId: string
  /** 0-based position in PLAN.md tasks declared order. */
  readonly taskIndex: number
  readonly status: TaskStatus
  /** True when the persona emitted `task_review_passed` for this task,
   *  even if `task_completed` has not yet fired (i.e., REVIEW resolved
   *  ready but `approve review` has not landed the gate). Useful for
   *  doctor inspectors and resume-probe logic. */
  readonly reviewPassed: boolean
}

export interface TaskCursor {
  /** Per-task entries in PLAN.md declared order; index === entry.taskIndex. */
  readonly entries: readonly TaskCursorEntry[]
  /** First task whose status is not `completed`, or `null` when all are. */
  readonly pending: TaskCursorEntry | null
  /** True when every task has status === `completed`. */
  readonly allCompleted: boolean
}

export interface TaskCursorIssue {
  readonly code:
    | 'task_cursor_unknown_id'
    | 'task_cursor_index_mismatch'
    | 'task_cursor_status_regression'
  readonly rule: string
  readonly detail?: string
  /** Offending event's `ts` for trace correlation. */
  readonly ts?: string
}

export interface TaskCursorResult {
  readonly cursor: TaskCursor
  /** Non-fatal issues detected during projection. The cursor is still
   *  computed; callers inspect issues to decide whether to surface a
   *  warning, halt with intervention, or proceed. */
  readonly issues: readonly TaskCursorIssue[]
}

/**
 * Project events.jsonl + parsed PLAN.md into a per-task cursor.
 *
 * Inputs are pure data: callers load events via `readEvents` and parse
 * PLAN.md via `parsePlan` before calling. The function is deterministic
 * on the inputs.
 *
 * Issues surface inconsistencies between events and the current PLAN
 * (e.g., a `task_started` carries a taskId that's no longer in PLAN.md).
 * They do NOT mutate the cursor; consumers decide policy.
 */
export function projectTaskCursor(
  plan: PlanArtifact,
  events: readonly LoggedEvent[],
): TaskCursorResult {
  const taskIds = listPlanTaskIds(plan)
  const indexById = new Map<string, number>()
  for (let i = 0; i < taskIds.length; i++) {
    indexById.set(taskIds[i] as string, i)
  }

  const issues: TaskCursorIssue[] = []
  // Per-task booleans the projection accumulates from events.
  const started = new Array(taskIds.length).fill(false) as boolean[]
  const reviewPassed = new Array(taskIds.length).fill(false) as boolean[]
  const completed = new Array(taskIds.length).fill(false) as boolean[]

  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (
      e.type !== 'task_started' &&
      e.type !== 'task_review_passed' &&
      e.type !== 'task_completed'
    ) {
      continue
    }

    const expectedIndex = indexById.get(e.taskId)
    if (expectedIndex === undefined) {
      issues.push({
        code: 'task_cursor_unknown_id',
        rule: `${e.type} carries taskId not present in current PLAN.md`,
        detail: `taskId=${e.taskId}`,
        ts: e.ts,
      })
      continue
    }
    if (e.taskIndex !== expectedIndex) {
      // Event recorded a different position than current PLAN. PLAN may
      // have been re-ordered between event emit and now; the projection
      // surfaces the drift but trusts current PLAN order for the cursor
      // (the live PLAN is canonical per rule 7).
      issues.push({
        code: 'task_cursor_index_mismatch',
        rule: `${e.type}.taskIndex does not match current PLAN.md position for taskId`,
        detail: `taskId=${e.taskId}, event.taskIndex=${e.taskIndex}, plan.position=${expectedIndex}`,
        ts: e.ts,
      })
      // fall through — still record the lifecycle bit by current index.
    }

    switch (e.type) {
      case 'task_started':
        started[expectedIndex] = true
        break
      case 'task_review_passed':
        reviewPassed[expectedIndex] = true
        break
      case 'task_completed':
        completed[expectedIndex] = true
        break
    }
  }

  // Sanity: a task_completed without a prior task_started is suspicious
  // (the runtime always emits task_started first). Flag as
  // status_regression — non-fatal; the cursor still reports completed.
  for (let i = 0; i < taskIds.length; i++) {
    if (completed[i] && !started[i]) {
      issues.push({
        code: 'task_cursor_status_regression',
        rule: 'task_completed observed without prior task_started for the same taskId',
        detail: `taskId=${taskIds[i]} (taskIndex=${i})`,
      })
    }
  }

  const entries: TaskCursorEntry[] = []
  for (let i = 0; i < taskIds.length; i++) {
    let status: TaskStatus
    if (completed[i]) status = 'completed'
    else if (started[i]) status = 'in_progress'
    else status = 'not_started'
    entries.push(
      Object.freeze({
        taskId: taskIds[i] as string,
        taskIndex: i,
        status,
        reviewPassed: reviewPassed[i] === true,
      }),
    )
  }

  let pending: TaskCursorEntry | null = null
  for (const entry of entries) {
    if (entry.status !== 'completed') {
      pending = entry
      break
    }
  }

  return Object.freeze({
    cursor: Object.freeze({
      entries: Object.freeze(entries),
      pending,
      allCompleted: pending === null,
    }),
    issues: Object.freeze(issues),
  })
}

/**
 * Convenience: returns the `T-NNN` id of the next pending task, or
 * `null` when every task is completed. Wraps `projectTaskCursor`; for
 * callers that don't need the full cursor.
 */
export function nextPendingTaskId(
  plan: PlanArtifact,
  events: readonly LoggedEvent[],
): string | null {
  const { cursor } = projectTaskCursor(plan, events)
  return cursor.pending === null ? null : cursor.pending.taskId
}

/**
 * M16 C9 — read-only lookup for the latest `review_resolved` event for
 * `(runId, taskId, attempt)`. Returns the event's
 * `{ finalRound, reviewReportSha256, ts }` or `null` when none exists.
 *
 * Codex C9 Mod #10 — the cursor stays a pure projection; this helper
 * does NOT mutate, write, or read disk. `approveReviewTaskGate`
 * consumes it (Mod #1) to source `task_completed` from the canonical
 * ready signal (`review_resolved`), not from `review_round_completed`
 * (which fires for every round outcome including needs-revision).
 *
 * "Latest" is last-occurrence in event order (events.jsonl is
 * append-only). Equal `(runId, taskId, attempt)` keeps last-wins;
 * defensive against the (impossible-by-contract) duplicate emission.
 */
export interface ReviewResolvedRecord {
  readonly finalRound: number
  readonly finalScore: number
  readonly reviewReportSha256: string
  readonly ts: string
}

export function findLatestReviewResolved(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
  attempt: number,
): ReviewResolvedRecord | null {
  let latest: ReviewResolvedRecord | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'review_resolved') continue
    if (e.runId !== runId) continue
    if (e.taskId !== taskId) continue
    if (e.attempt !== attempt) continue
    latest = Object.freeze({
      finalRound: e.finalRound,
      finalScore: e.finalScore,
      reviewReportSha256: e.reviewReportSha256,
      ts: e.ts,
    })
    break
  }
  return latest
}
