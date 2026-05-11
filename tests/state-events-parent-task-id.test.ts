// 09-byterover-cli B3 (Codex thread `019e1318`):
// validator accepts optional `parentTaskId` on agent_invoked /
// agent_completed when it matches the canonical T-NNN pattern, and
// rejects malformed values. Field omission is the default and stays
// valid — pre-B3 fixtures never break.

import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-10T12:00:00.000Z'

function agentInvoked(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    type: 'agent_invoked',
    ts: TS,
    runId: RUN,
    phase: 'review',
    agent: 'reviewer-A',
    provider: 'fake',
    manifest: { files: [] },
    filesSent: 0,
    bytesSent: 0,
    tokensEstimate: 100,
    fieldsRemovedByScope: 0,
    ...overrides,
  }
}

function agentCompleted(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    type: 'agent_completed',
    ts: TS,
    runId: RUN,
    phase: 'review',
    agent: 'reviewer-A',
    ...overrides,
  }
}

describe('agent_invoked.parentTaskId — validator', () => {
  test('omitted parentTaskId is valid (back-compat)', () => {
    expect(validateEvent(agentInvoked(), 'events.jsonl')).toBeNull()
  })

  test('accepts T-NNN canonical task id', () => {
    expect(
      validateEvent(agentInvoked({ parentTaskId: 'T-007' }), 'events.jsonl'),
    ).toBeNull()
  })

  test('accepts T-NNNNNN (>= 3 digits)', () => {
    expect(
      validateEvent(agentInvoked({ parentTaskId: 'T-100042' }), 'events.jsonl'),
    ).toBeNull()
  })

  test('rejects 2-digit task id (T-NN)', () => {
    const issue = validateEvent(
      agentInvoked({ parentTaskId: 'T-12' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('agent_invoked.parentTaskId')
  })

  test('rejects empty string', () => {
    const issue = validateEvent(
      agentInvoked({ parentTaskId: '' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('agent_invoked.parentTaskId')
  })

  test('rejects non-T prefix', () => {
    const issue = validateEvent(
      agentInvoked({ parentTaskId: 'P-001' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('agent_invoked.parentTaskId')
  })

  test('rejects numeric value', () => {
    const issue = validateEvent(
      agentInvoked({ parentTaskId: 7 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('agent_invoked.parentTaskId')
  })
})

describe('agent_completed.parentTaskId — validator', () => {
  test('omitted parentTaskId is valid (back-compat)', () => {
    expect(validateEvent(agentCompleted(), 'events.jsonl')).toBeNull()
  })

  test('accepts T-NNN canonical task id', () => {
    expect(
      validateEvent(agentCompleted({ parentTaskId: 'T-042' }), 'events.jsonl'),
    ).toBeNull()
  })

  test('rejects malformed task id', () => {
    const issue = validateEvent(
      agentCompleted({ parentTaskId: 'task-007' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('agent_completed.parentTaskId')
  })
})
