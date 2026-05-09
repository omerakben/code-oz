// M16 C1 — pure projection of events.jsonl + PLAN.md into a per-task
// cursor. Tests cover lifecycle states (not_started / in_progress /
// completed), drift-detection issues (unknown id, index mismatch,
// status regression), and the convenience next-pending helper.

import { describe, test, expect } from 'bun:test'
import {
  projectTaskCursor,
  nextPendingTaskId,
  type TaskCursorEntry,
} from '../src/state/task-cursor.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'
import { generateUlid } from '../src/state/schemas.ts'
import type { PlanArtifact, PlanTask } from '../src/artifacts/plan.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-04-30T12:00:00.000Z'
const SHA64 = 'a'.repeat(64)

function makeTask(id: string, title: string): PlanTask {
  return Object.freeze({
    id,
    title,
    files: Object.freeze([]),
    fileChanges: Object.freeze([]),
    validation: 'bun test',
    risk: 'none',
    hypotheses: Object.freeze([]),
    sources: Object.freeze(['SC-SPEC-001']),
  })
}

function makePlan(taskIds: readonly string[]): PlanArtifact {
  return Object.freeze({
    title: 'PLAN',
    goals: Object.freeze(['ship']),
    tasks: Object.freeze(taskIds.map((id, i) => makeTask(id, `task ${i + 1}`))),
    sources: Object.freeze(['SC-SPEC-001']),
    outOfScope: Object.freeze(['nothing']),
    openQuestions: Object.freeze(['none']),
  })
}

function taskStarted(taskId: string, taskIndex: number, ts = TS): LoggedEvent {
  return Object.freeze({
    version: 1 as const,
    type: 'task_started' as const,
    ts,
    runId: RUN,
    taskId,
    taskIndex,
  })
}

function taskReviewPassed(taskId: string, taskIndex: number, ts = TS): LoggedEvent {
  return Object.freeze({
    version: 1 as const,
    type: 'task_review_passed' as const,
    ts,
    runId: RUN,
    taskId,
    taskIndex,
    finalRound: 1,
    reviewReportSha256: SHA64,
  })
}

function taskCompleted(taskId: string, taskIndex: number, ts = TS): LoggedEvent {
  return Object.freeze({
    version: 1 as const,
    type: 'task_completed' as const,
    ts,
    runId: RUN,
    taskId,
    taskIndex,
    reviewGatePath: `.code-oz/state/runs/${RUN}/GATE_REVIEW_PASSED.json`,
  })
}

describe('projectTaskCursor — empty inputs', () => {
  test('zero events with single-task plan reports not_started', () => {
    const plan = makePlan(['T-001'])
    const { cursor, issues } = projectTaskCursor(plan, [])
    expect(issues).toEqual([])
    expect(cursor.entries.length).toBe(1)
    expect(cursor.entries[0]?.status).toBe('not_started')
    expect(cursor.entries[0]?.reviewPassed).toBe(false)
    expect(cursor.pending?.taskId).toBe('T-001')
    expect(cursor.allCompleted).toBe(false)
  })

  test('zero events with multi-task plan reports all not_started', () => {
    const plan = makePlan(['T-001', 'T-002', 'T-003'])
    const { cursor } = projectTaskCursor(plan, [])
    expect(cursor.entries.map((e) => e.status)).toEqual([
      'not_started',
      'not_started',
      'not_started',
    ])
    expect(cursor.pending?.taskId).toBe('T-001')
    expect(cursor.allCompleted).toBe(false)
  })

  test('zero-task plan returns empty entries and null pending', () => {
    const plan = makePlan([])
    const { cursor } = projectTaskCursor(plan, [])
    expect(cursor.entries).toEqual([])
    expect(cursor.pending).toBeNull()
    expect(cursor.allCompleted).toBe(true)
  })
})

describe('projectTaskCursor — lifecycle transitions', () => {
  test('task_started flips status to in_progress', () => {
    const plan = makePlan(['T-001', 'T-002'])
    const { cursor } = projectTaskCursor(plan, [taskStarted('T-001', 0)])
    expect(cursor.entries[0]?.status).toBe('in_progress')
    expect(cursor.entries[1]?.status).toBe('not_started')
    expect(cursor.pending?.taskId).toBe('T-001') // still pending — not completed
  })

  test('task_review_passed sets reviewPassed but not status (gate not yet written)', () => {
    const plan = makePlan(['T-001'])
    const { cursor } = projectTaskCursor(plan, [
      taskStarted('T-001', 0),
      taskReviewPassed('T-001', 0),
    ])
    expect(cursor.entries[0]?.status).toBe('in_progress')
    expect(cursor.entries[0]?.reviewPassed).toBe(true)
    expect(cursor.pending?.taskId).toBe('T-001')
  })

  test('task_completed flips status to completed', () => {
    const plan = makePlan(['T-001', 'T-002'])
    const { cursor } = projectTaskCursor(plan, [
      taskStarted('T-001', 0),
      taskReviewPassed('T-001', 0),
      taskCompleted('T-001', 0),
    ])
    expect(cursor.entries[0]?.status).toBe('completed')
    expect(cursor.entries[0]?.reviewPassed).toBe(true)
    expect(cursor.pending?.taskId).toBe('T-002') // advances to next task
  })

  test('all tasks completed → pending is null and allCompleted true', () => {
    const plan = makePlan(['T-001', 'T-002'])
    const { cursor } = projectTaskCursor(plan, [
      taskStarted('T-001', 0),
      taskCompleted('T-001', 0),
      taskStarted('T-002', 1),
      taskCompleted('T-002', 1),
    ])
    expect(cursor.entries.every((e) => e.status === 'completed')).toBe(true)
    expect(cursor.pending).toBeNull()
    expect(cursor.allCompleted).toBe(true)
  })

  test('events for later task before earlier task — pending stays at earliest non-completed', () => {
    // Out-of-order completion: T-002 completes while T-001 is in_progress.
    // Pending must stay at T-001 because PLAN order is canonical.
    const plan = makePlan(['T-001', 'T-002'])
    const { cursor } = projectTaskCursor(plan, [
      taskStarted('T-001', 0),
      taskStarted('T-002', 1),
      taskCompleted('T-002', 1),
    ])
    expect(cursor.entries[0]?.status).toBe('in_progress')
    expect(cursor.entries[1]?.status).toBe('completed')
    expect(cursor.pending?.taskId).toBe('T-001')
    expect(cursor.allCompleted).toBe(false)
  })
})

describe('projectTaskCursor — drift detection', () => {
  test('event with taskId not in PLAN raises unknown_id issue', () => {
    const plan = makePlan(['T-001', 'T-002'])
    const { cursor, issues } = projectTaskCursor(plan, [taskStarted('T-099', 0)])
    expect(issues.length).toBe(1)
    expect(issues[0]?.code).toBe('task_cursor_unknown_id')
    expect(issues[0]?.detail).toContain('T-099')
    // Cursor still computed — non-fatal projection.
    expect(cursor.entries[0]?.status).toBe('not_started')
  })

  test('event with taskIndex mismatch raises index_mismatch issue but trusts current PLAN', () => {
    // Event was emitted with taskIndex=0; PLAN has been re-ordered so
    // T-001 is now at index 1. Cursor reports against current PLAN.
    const plan = makePlan(['T-002', 'T-001'])
    const { cursor, issues } = projectTaskCursor(plan, [taskStarted('T-001', 0)])
    expect(issues.length).toBe(1)
    expect(issues[0]?.code).toBe('task_cursor_index_mismatch')
    expect(issues[0]?.detail).toContain('event.taskIndex=0')
    expect(issues[0]?.detail).toContain('plan.position=1')
    // T-001 (now at PLAN position 1) is in_progress.
    expect(cursor.entries[1]?.taskId).toBe('T-001')
    expect(cursor.entries[1]?.status).toBe('in_progress')
  })

  test('task_completed without prior task_started raises status_regression issue', () => {
    // Suspicious — runtime should always emit task_started first. Non-fatal.
    const plan = makePlan(['T-001'])
    const { cursor, issues } = projectTaskCursor(plan, [taskCompleted('T-001', 0)])
    expect(issues.length).toBe(1)
    expect(issues[0]?.code).toBe('task_cursor_status_regression')
    // Cursor still reports completed.
    expect(cursor.entries[0]?.status).toBe('completed')
  })
})

describe('projectTaskCursor — non-task events ignored', () => {
  test('unrelated events (run_started, build_started, review_resolved) do not affect cursor', () => {
    const plan = makePlan(['T-001'])
    const events: readonly LoggedEvent[] = Object.freeze([
      Object.freeze({
        version: 1 as const,
        type: 'run_started' as const,
        ts: TS,
        runId: RUN,
        profile: 'greenfield' as const,
      }),
      Object.freeze({
        version: 1 as const,
        type: 'phase_entered' as const,
        ts: TS,
        runId: RUN,
        phase: 'build' as const,
      }),
      taskStarted('T-001', 0),
    ])
    const { cursor, issues } = projectTaskCursor(plan, events)
    expect(issues).toEqual([])
    expect(cursor.entries[0]?.status).toBe('in_progress')
  })
})

describe('nextPendingTaskId — convenience wrapper', () => {
  test('returns first pending task id', () => {
    const plan = makePlan(['T-001', 'T-002'])
    expect(nextPendingTaskId(plan, [])).toBe('T-001')
  })

  test('skips completed tasks', () => {
    const plan = makePlan(['T-001', 'T-002', 'T-003'])
    const events = [taskStarted('T-001', 0), taskCompleted('T-001', 0)]
    expect(nextPendingTaskId(plan, events)).toBe('T-002')
  })

  test('returns null when all tasks completed', () => {
    const plan = makePlan(['T-001'])
    const events = [taskStarted('T-001', 0), taskCompleted('T-001', 0)]
    expect(nextPendingTaskId(plan, events)).toBeNull()
  })

  test('returns null on empty plan', () => {
    const plan = makePlan([])
    expect(nextPendingTaskId(plan, [])).toBeNull()
  })
})

describe('projectTaskCursor — frozen result invariant', () => {
  test('cursor + entries + issues are all frozen', () => {
    const plan = makePlan(['T-001'])
    const result = projectTaskCursor(plan, [taskStarted('T-001', 0)])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.cursor)).toBe(true)
    expect(Object.isFrozen(result.cursor.entries)).toBe(true)
    expect(Object.isFrozen(result.cursor.entries[0])).toBe(true)
    expect(Object.isFrozen(result.issues)).toBe(true)
  })

  test('TaskCursorEntry shape exposes all required fields', () => {
    const plan = makePlan(['T-001'])
    const { cursor } = projectTaskCursor(plan, [])
    const entry: TaskCursorEntry = cursor.entries[0] as TaskCursorEntry
    expect(typeof entry.taskId).toBe('string')
    expect(typeof entry.taskIndex).toBe('number')
    expect(['not_started', 'in_progress', 'completed']).toContain(entry.status)
    expect(typeof entry.reviewPassed).toBe('boolean')
  })
})
