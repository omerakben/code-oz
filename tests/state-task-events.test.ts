// M16 C1 — validator coverage for task_started / task_review_passed /
// task_completed event types.
//
// These three events form the per-task lifecycle cursor (Codex R0
// Risk #1, docs/research/CODEX_RESPONSE_M16.md). Each event MUST
// validate against the schema's strict per-type rules before
// appending — same contract as M9's review_* event validators.

import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-04-30T12:00:00.000Z'
const SHA64 = 'a'.repeat(64)

describe('task_started — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'task_started',
      ts: TS,
      runId: RUN,
      taskId: 'T-001',
      taskIndex: 0,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('valid event with multi-digit taskIndex passes', () => {
    expect(validateEvent(valid({ taskId: 'T-042', taskIndex: 41 }), 'events.jsonl')).toBeNull()
  })

  test('rejects taskId without T- prefix', () => {
    const issue = validateEvent(valid({ taskId: '001' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('task_started.taskId')
  })

  test('rejects taskId with too few digits', () => {
    const issue = validateEvent(valid({ taskId: 'T-1' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects negative taskIndex', () => {
    const issue = validateEvent(valid({ taskIndex: -1 }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('task_started.taskIndex')
  })

  test('rejects non-integer taskIndex', () => {
    const issue = validateEvent(valid({ taskIndex: 0.5 }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })
})

describe('task_review_passed — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'task_review_passed',
      ts: TS,
      runId: RUN,
      taskId: 'T-001',
      taskIndex: 0,
      finalRound: 1,
      reviewReportSha256: SHA64,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('finalRound at upper cap (4) passes', () => {
    expect(validateEvent(valid({ finalRound: 4 }), 'events.jsonl')).toBeNull()
  })

  test('rejects taskId not matching pattern', () => {
    const issue = validateEvent(valid({ taskId: 'T_001' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects finalRound below 1', () => {
    const issue = validateEvent(valid({ finalRound: 0 }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('finalRound')
  })

  test('rejects finalRound above 4 (REVIEW_ROUND_CAP)', () => {
    const issue = validateEvent(valid({ finalRound: 5 }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects reviewReportSha256 not 64-hex', () => {
    const issue = validateEvent(
      valid({ reviewReportSha256: 'a'.repeat(63) }),
      'events.jsonl',
    )
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('reviewReportSha256')
  })

  test('rejects reviewReportSha256 with uppercase hex', () => {
    const issue = validateEvent(
      valid({ reviewReportSha256: 'A'.repeat(64) }),
      'events.jsonl',
    )
    expect(issue?.code).toBe('event_invalid_value')
  })
})

describe('task_completed — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'task_completed',
      ts: TS,
      runId: RUN,
      taskId: 'T-001',
      taskIndex: 0,
      reviewGatePath:
        '.code-oz/state/runs/01HQ7ZX0000000000000000000/GATE_REVIEW_PASSED.json',
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects empty reviewGatePath', () => {
    const issue = validateEvent(valid({ reviewGatePath: '' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('reviewGatePath')
  })

  test('rejects missing reviewGatePath', () => {
    const issue = validateEvent(valid({ reviewGatePath: undefined }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects taskId mismatching pattern', () => {
    const issue = validateEvent(valid({ taskId: 'task-001' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects negative taskIndex', () => {
    const issue = validateEvent(valid({ taskIndex: -1 }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })
})

// --- M16 C9 follow-on Bug 2: gate_file_cleared validator -----------

describe('gate_file_cleared — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'gate_file_cleared',
      ts: TS,
      runId: RUN,
      phase: 'build',
      priorTaskId: 'T-001',
      currentTaskId: 'T-002',
      gateFile: 'GATE_BUILD_PASSED.json',
      priorArtifactSha256: SHA64,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('valid event for verify phase passes', () => {
    expect(
      validateEvent(
        valid({ phase: 'verify', gateFile: 'GATE_VERIFY_PASSED.json' }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('valid event for review phase passes', () => {
    expect(
      validateEvent(
        valid({ phase: 'review', gateFile: 'GATE_REVIEW_PASSED.json' }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects non-canonical phase', () => {
    const issue = validateEvent(valid({ phase: 'banana' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_phase')
  })

  test('rejects priorTaskId without T- prefix', () => {
    const issue = validateEvent(valid({ priorTaskId: '001' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('priorTaskId')
  })

  test('rejects currentTaskId without T- prefix', () => {
    const issue = validateEvent(valid({ currentTaskId: 'task-002' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('currentTaskId')
  })

  test('rejects empty gateFile', () => {
    const issue = validateEvent(valid({ gateFile: '' }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('gateFile')
  })

  test('rejects missing gateFile', () => {
    const issue = validateEvent(valid({ gateFile: undefined }), 'events.jsonl')
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects priorArtifactSha256 with wrong length', () => {
    const issue = validateEvent(
      valid({ priorArtifactSha256: 'a'.repeat(63) }),
      'events.jsonl',
    )
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('priorArtifactSha256')
  })

  test('rejects priorArtifactSha256 with uppercase hex', () => {
    const issue = validateEvent(
      valid({ priorArtifactSha256: 'A'.repeat(64) }),
      'events.jsonl',
    )
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects priorArtifactSha256 with non-hex characters', () => {
    const issue = validateEvent(
      valid({ priorArtifactSha256: 'g'.repeat(64) }),
      'events.jsonl',
    )
    expect(issue?.code).toBe('event_invalid_value')
  })
})
