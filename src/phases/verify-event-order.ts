// Canonical event-emission order for a VERIFY-fail attempt (M8 commit 8).
//
// Per docs/contracts/VERIFY.md § "Event types emitted" + Codex M8
// decision 8 (accept-with-modifications): the orchestrator emits these
// four events in a strict sequence. Schema/validator (commit 4) check
// each event in isolation; this module is the runtime check that the
// SEQUENCE is well-formed for a given (runId, taskId, attempt) triple.
//
// Locked sequence:
//
//   1. worktree_forensics_preserved   ← VERIFY.md + bundle written
//   2. verify_failed                   ← persona-authored fail verdict
//   3. worktree_destroyed              ← failed worktree removed
//   4. verify_restart_initiated        ← N+1 scheduled (or intervention)
//
// Why this order matters: a crash before verify_failed must leave no
// durable restart signal without evidence (Codex decision 8 risk). If
// verify_restart_initiated fires before worktree_destroyed, an external
// observer of events.jsonl could conclude the run is in restart mode
// while the failing worktree is still active — corrupting any cleanup
// or status tooling that reads events as the source of truth.

import type { LoggedEvent } from '../state/schemas.ts'

export const CANONICAL_VERIFY_FAILURE_EVENT_ORDER = [
  'worktree_forensics_preserved',
  'verify_failed',
  'worktree_destroyed',
  'verify_restart_initiated',
] as const

export type VerifyFailureEventType = (typeof CANONICAL_VERIFY_FAILURE_EVENT_ORDER)[number]

export interface VerifyFailureEventOrderIssue {
  readonly code:
    | 'verify_event_order_missing'
    | 'verify_event_order_out_of_order'
    | 'verify_event_order_duplicate'
    | 'verify_event_order_unexpected'
  readonly rule: string
  readonly detail?: string
}

export interface ValidateVerifyFailureEventOrderInput {
  /** Events to scan, typically the events.jsonl tail or a slice. */
  readonly events: readonly LoggedEvent[]
  readonly runId: string
  readonly taskId: string
  readonly attempt: number
}

/**
 * Scans an event slice and verifies that the four VERIFY-failure events
 * appear in canonical order, exactly once each, scoped to the
 * (runId, taskId, attempt) triple. Returns an issue on the first
 * violation found, or null when the sequence is valid.
 *
 * Other events (e.g., budget_warning, agent_invoked from the failed
 * VERIFY persona invocation) are tolerated between the canonical four —
 * the function checks ordering of the four events relative to each
 * other, not strict adjacency.
 */
export function validateVerifyFailureEventOrder(
  input: ValidateVerifyFailureEventOrderInput,
): VerifyFailureEventOrderIssue | null {
  // Filter to events scoped to this attempt. The four canonical events
  // have asymmetric scope:
  //   - worktree_forensics_preserved + worktree_destroyed: run-scoped
  //     (no taskId / attempt field on the schema). We accept all that
  //     match runId.
  //   - verify_failed + verify_restart_initiated: scoped to (runId,
  //     taskId, attempt). We filter on all three.
  const scoped = input.events.filter((e) => {
    if (e.runId !== input.runId) return false
    if (!(CANONICAL_VERIFY_FAILURE_EVENT_ORDER as readonly string[]).includes(e.type)) return false
    if (e.type === 'verify_failed' || e.type === 'verify_restart_initiated') {
      const ev = e as LoggedEvent & { taskId?: string; attempt?: number }
      if (ev.taskId !== input.taskId) return false
      if (ev.attempt !== input.attempt) return false
    }
    return true
  })

  // Check duplicates of the verify_* events (which carry attempt).
  // worktree_* events may appear multiple times in a run (different
  // attempts share the same runId), but verify_failed + verify_restart_initiated
  // for the same attempt must be unique.
  const verifyFailedCount = scoped.filter((e) => e.type === 'verify_failed').length
  const verifyRestartCount = scoped.filter((e) => e.type === 'verify_restart_initiated').length
  if (verifyFailedCount > 1) {
    return Object.freeze({
      code: 'verify_event_order_duplicate',
      rule: 'verify_failed must appear exactly once per (runId, taskId, attempt)',
      detail: `count=${verifyFailedCount}`,
    })
  }
  if (verifyRestartCount > 1) {
    return Object.freeze({
      code: 'verify_event_order_duplicate',
      rule: 'verify_restart_initiated must appear exactly once per (runId, taskId, attempt)',
      detail: `count=${verifyRestartCount}`,
    })
  }

  // For ordering, find the position of each event type's first
  // occurrence and check they're monotonically increasing per the
  // canonical order.
  const firstIndex = new Map<string, number>()
  for (let i = 0; i < scoped.length; i++) {
    const t = scoped[i]!.type
    if (!firstIndex.has(t)) firstIndex.set(t, i)
  }

  // Each canonical event must be present.
  for (const expected of CANONICAL_VERIFY_FAILURE_EVENT_ORDER) {
    if (!firstIndex.has(expected)) {
      return Object.freeze({
        code: 'verify_event_order_missing',
        rule: `${expected} not found in scoped events for (runId, taskId, attempt)`,
      })
    }
  }

  // Order check.
  let prev = -1
  for (const expected of CANONICAL_VERIFY_FAILURE_EVENT_ORDER) {
    const idx = firstIndex.get(expected) as number
    if (idx <= prev) {
      return Object.freeze({
        code: 'verify_event_order_out_of_order',
        rule: `${expected} appears before its canonical position`,
        detail: `position=${idx}, prior canonical position=${prev}`,
      })
    }
    prev = idx
  }

  return null
}
