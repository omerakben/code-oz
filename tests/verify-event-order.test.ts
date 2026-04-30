import { describe, test, expect } from 'bun:test'
import {
  CANONICAL_VERIFY_FAILURE_EVENT_ORDER,
  validateVerifyFailureEventOrder,
} from '../src/phases/verify-event-order.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'

const RUN = '01HX0000000000000000000000'
const RUN_OTHER = '01HX0000000000000000000001'
const TASK = 'T-001'
const TASK_OTHER = 'T-002'
const SHA64 = 'a'.repeat(64)
const ATTEMPT = 1

function ev(over: Record<string, unknown>): LoggedEvent {
  return {
    version: 1,
    ts: '2026-04-30T19:00:00Z',
    runId: RUN,
    ...over,
  } as LoggedEvent
}

function forensicsPreserved(): LoggedEvent {
  return ev({
    type: 'worktree_forensics_preserved',
    phase: 'verify',
    forensicsPath: '.code-oz/runs/01HX/forensics/1/',
    entries: ['diff.patch', 'VERIFY.md'],
  })
}

function verifyFailed(attempt = ATTEMPT, runId = RUN, taskId = TASK): LoggedEvent {
  return ev({
    type: 'verify_failed',
    runId,
    phase: 'verify',
    agent: 'verifier',
    attempt,
    taskId,
    verifyReportSha256: SHA64,
    terminationReason: 'exit',
    exitCode: 1,
    failureSummary: 's',
  })
}

function worktreeDestroyed(): LoggedEvent {
  return ev({
    type: 'worktree_destroyed',
    phase: 'verify',
    worktreePath: '.code-oz/runs/01HX/worktree/',
  })
}

function verifyRestart(attempt = ATTEMPT, runId = RUN, taskId = TASK): LoggedEvent {
  return ev({
    type: 'verify_restart_initiated',
    runId,
    phase: 'verify',
    taskId,
    attempt,
    nextAction: 'restart',
    nextAttempt: attempt + 1,
    forensicsPath: '.code-oz/runs/01HX/forensics/1/',
  })
}

describe('CANONICAL_VERIFY_FAILURE_EVENT_ORDER constant', () => {
  test('exposes exactly four event types', () => {
    expect(CANONICAL_VERIFY_FAILURE_EVENT_ORDER).toHaveLength(4)
  })

  test('locks the canonical sequence per Codex M8 decision 8', () => {
    expect(CANONICAL_VERIFY_FAILURE_EVENT_ORDER).toEqual([
      'worktree_forensics_preserved',
      'verify_failed',
      'worktree_destroyed',
      'verify_restart_initiated',
    ])
  })
})

describe('validateVerifyFailureEventOrder — happy paths', () => {
  test('canonical 4-event sequence validates', () => {
    const events = [
      forensicsPreserved(),
      verifyFailed(),
      worktreeDestroyed(),
      verifyRestart(),
    ]
    expect(validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })).toBeNull()
  })

  test('tolerates unrelated events between the four', () => {
    const budgetWarn: LoggedEvent = ev({
      type: 'budget_warning',
      phase: 'verify',
      budgetField: 'maxTurns',
      ratio: 0.8,
    })
    const events = [
      forensicsPreserved(),
      budgetWarn,
      verifyFailed(),
      budgetWarn,
      worktreeDestroyed(),
      verifyRestart(),
    ]
    expect(validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })).toBeNull()
  })
})

describe('validateVerifyFailureEventOrder — rejection paths', () => {
  test('verify_restart_initiated before worktree_destroyed → out_of_order', () => {
    const events = [
      forensicsPreserved(),
      verifyFailed(),
      verifyRestart(), // BEFORE worktree_destroyed — Codex M8 decision 8 violation
      worktreeDestroyed(),
    ]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_out_of_order')
  })

  test('verify_failed before worktree_forensics_preserved → out_of_order', () => {
    const events = [
      verifyFailed(),
      forensicsPreserved(),
      worktreeDestroyed(),
      verifyRestart(),
    ]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_out_of_order')
  })

  test('missing worktree_destroyed → missing', () => {
    const events = [forensicsPreserved(), verifyFailed(), verifyRestart()]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_missing')
    expect(issue?.rule).toContain('worktree_destroyed')
  })

  test('missing verify_failed → missing', () => {
    const events = [forensicsPreserved(), worktreeDestroyed(), verifyRestart()]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_missing')
  })

  test('duplicate verify_failed for same attempt → duplicate', () => {
    const events = [
      forensicsPreserved(),
      verifyFailed(),
      verifyFailed(),
      worktreeDestroyed(),
      verifyRestart(),
    ]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_duplicate')
  })

  test('duplicate verify_restart_initiated → duplicate', () => {
    const events = [
      forensicsPreserved(),
      verifyFailed(),
      worktreeDestroyed(),
      verifyRestart(),
      verifyRestart(),
    ]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_duplicate')
  })
})

describe('validateVerifyFailureEventOrder — scope filtering', () => {
  test('events from different runId are filtered out (treated as missing)', () => {
    const events = [
      forensicsPreserved(),
      verifyFailed(ATTEMPT, RUN_OTHER, TASK),
      worktreeDestroyed(),
      verifyRestart(ATTEMPT, RUN_OTHER, TASK),
    ]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_missing')
  })

  test('events from different taskId are filtered out for verify_* (worktree_* events are run-scoped)', () => {
    // The two worktree_* events have no taskId field; they pass through.
    // The two verify_* events for TASK_OTHER are filtered out, so canonical
    // four for TASK is missing those two.
    const events = [
      forensicsPreserved(),
      verifyFailed(ATTEMPT, RUN, TASK_OTHER),
      worktreeDestroyed(),
      verifyRestart(ATTEMPT, RUN, TASK_OTHER),
    ]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_missing')
  })

  test('events for a different attempt: verify_* filtered out → missing', () => {
    const events = [
      forensicsPreserved(),
      verifyFailed(2, RUN, TASK), // wrong attempt
      worktreeDestroyed(),
      verifyRestart(2, RUN, TASK),
    ]
    const issue = validateVerifyFailureEventOrder({ events, runId: RUN, taskId: TASK, attempt: ATTEMPT })
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('verify_event_order_missing')
  })
})
