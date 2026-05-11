// 09-byterover-cli B3 (Codex thread `019e1318`):
// summarizeByParentTask rolls up paired tokens + provider-call counts
// keyed by parentTaskId, ignores events without parentTaskId, and
// follows the same FIFO-by-phase pairing as summarizeBudgetUse so
// crashed (unmatched) invocations still attribute their estimate.

import { describe, test, expect } from 'bun:test'
import { summarizeByParentTask } from '../src/providers/cost.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'

const TS = '2026-05-10T12:00:00.000Z'
const RUN = '01HXXXX0YYYY1ZZZZ22222'

function invoked(opts: {
  phase: 'review' | 'build'
  agent: string
  tokensEstimate: number
  parentTaskId?: string
}): LoggedEvent {
  return {
    version: 1,
    type: 'agent_invoked',
    ts: TS,
    runId: RUN,
    phase: opts.phase,
    agent: opts.agent,
    provider: 'fake',
    manifest: { files: [] },
    filesSent: 0,
    bytesSent: 0,
    tokensEstimate: opts.tokensEstimate,
    fieldsRemovedByScope: 0,
    ...(opts.parentTaskId !== undefined ? { parentTaskId: opts.parentTaskId } : {}),
  } as LoggedEvent
}

function completed(opts: {
  phase: 'review' | 'build'
  agent: string
  tokensUsed?: number
  parentTaskId?: string
}): LoggedEvent {
  return {
    version: 1,
    type: 'agent_completed',
    ts: TS,
    runId: RUN,
    phase: opts.phase,
    agent: opts.agent,
    ...(opts.tokensUsed !== undefined ? { tokensUsed: opts.tokensUsed } : {}),
    ...(opts.parentTaskId !== undefined ? { parentTaskId: opts.parentTaskId } : {}),
  } as LoggedEvent
}

describe('summarizeByParentTask', () => {
  test('returns empty rollup when no parentTaskId is recorded', () => {
    const events: LoggedEvent[] = [
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 100 }),
      completed({ phase: 'review', agent: 'reviewer-A', tokensUsed: 95 }),
    ]
    const r = summarizeByParentTask(events)
    expect(Object.keys(r.byParentTaskId)).toHaveLength(0)
  })

  test('rolls up two paired calls under one parentTaskId', () => {
    const events: LoggedEvent[] = [
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 100, parentTaskId: 'T-007' }),
      invoked({ phase: 'review', agent: 'reviewer-B', tokensEstimate: 100, parentTaskId: 'T-007' }),
      completed({ phase: 'review', agent: 'reviewer-A', tokensUsed: 90, parentTaskId: 'T-007' }),
      completed({ phase: 'review', agent: 'reviewer-B', tokensUsed: 110, parentTaskId: 'T-007' }),
    ]
    const r = summarizeByParentTask(events)
    expect(r.byParentTaskId['T-007']).toEqual({
      tokens: 200,
      providerCalls: 2,
    })
  })

  test('separates rollups across two distinct parent operations', () => {
    const events: LoggedEvent[] = [
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 50, parentTaskId: 'T-001' }),
      completed({ phase: 'review', agent: 'reviewer-A', tokensUsed: 50, parentTaskId: 'T-001' }),
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 200, parentTaskId: 'T-002' }),
      completed({ phase: 'review', agent: 'reviewer-A', tokensUsed: 175, parentTaskId: 'T-002' }),
    ]
    const r = summarizeByParentTask(events)
    expect(r.byParentTaskId['T-001']?.tokens).toBe(50)
    expect(r.byParentTaskId['T-002']?.tokens).toBe(175)
    expect(r.byParentTaskId['T-001']?.providerCalls).toBe(1)
    expect(r.byParentTaskId['T-002']?.providerCalls).toBe(1)
  })

  test('falls back to estimate when agent_completed omits tokensUsed', () => {
    const events: LoggedEvent[] = [
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 333, parentTaskId: 'T-011' }),
      completed({ phase: 'review', agent: 'reviewer-A', parentTaskId: 'T-011' }),
    ]
    const r = summarizeByParentTask(events)
    expect(r.byParentTaskId['T-011']?.tokens).toBe(333)
  })

  test('counts unmatched (crashed) invocation as estimate fallback', () => {
    const events: LoggedEvent[] = [
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 500, parentTaskId: 'T-099' }),
      // no agent_completed — turn crashed
    ]
    const r = summarizeByParentTask(events)
    expect(r.byParentTaskId['T-099']).toEqual({
      tokens: 500,
      providerCalls: 1,
    })
  })

  test('ignores events with no parentTaskId, even mixed with parented events', () => {
    const events: LoggedEvent[] = [
      invoked({ phase: 'review', agent: 'unparented', tokensEstimate: 1000 }),
      completed({ phase: 'review', agent: 'unparented', tokensUsed: 1000 }),
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 100, parentTaskId: 'T-005' }),
      completed({ phase: 'review', agent: 'reviewer-A', tokensUsed: 100, parentTaskId: 'T-005' }),
    ]
    const r = summarizeByParentTask(events)
    expect(Object.keys(r.byParentTaskId)).toEqual(['T-005'])
    expect(r.byParentTaskId['T-005']?.tokens).toBe(100)
  })

  test('unparented completions do not consume later parented queue entries', () => {
    const events: LoggedEvent[] = [
      invoked({ phase: 'review', agent: 'unparented', tokensEstimate: 1000 }),
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 100, parentTaskId: 'T-005' }),
      completed({ phase: 'review', agent: 'unparented', tokensUsed: 1000 }),
      completed({ phase: 'review', agent: 'reviewer-A', tokensUsed: 100, parentTaskId: 'T-005' }),
    ]
    const r = summarizeByParentTask(events)
    expect(r.byParentTaskId['T-005']).toEqual({
      tokens: 100,
      providerCalls: 1,
    })
  })

  test('per-phase FIFO pairing isolates same-parentTaskId across phases', () => {
    // Same parentTaskId shouldn't leak across phases (FIFO is per phase
    // in summarizeBudgetUse; we mirror to keep semantics consistent).
    const events: LoggedEvent[] = [
      invoked({ phase: 'build', agent: 'builder', tokensEstimate: 700, parentTaskId: 'T-050' }),
      invoked({ phase: 'review', agent: 'reviewer-A', tokensEstimate: 100, parentTaskId: 'T-050' }),
      completed({ phase: 'review', agent: 'reviewer-A', tokensUsed: 100, parentTaskId: 'T-050' }),
      completed({ phase: 'build', agent: 'builder', tokensUsed: 650, parentTaskId: 'T-050' }),
    ]
    const r = summarizeByParentTask(events)
    expect(r.byParentTaskId['T-050']).toEqual({
      tokens: 750, // 100 (review) + 650 (build)
      providerCalls: 2,
    })
  })
})
