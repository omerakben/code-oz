// M10 commit 2: debate_* event types + correlation metadata + validators.
//
// DEBATE.md § "Event types" pinned exactly two lifecycle events
// (debate_started, debate_resolved). The validators here are append-time
// guards — every line written by requestDebate (commit 7) goes through
// validateEvent before fsync.
//
// Per CODEX_RESPONSE_M10.md risk #4 (warning events are contract drift):
// M10 ships ONLY two event types. The optional debateTopic + debateTurn
// correlation fields on agent_invoked / agent_completed are M10
// forward-compat for M14+ panel territory (D3 lock).

import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-01T12:00:00.000Z'

const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)
const SHA64C = 'c'.repeat(64)

describe('debate_started — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_started',
      ts: TS,
      runId: RUN,
      phase: 'plan',
      agent: 'lead',
      topic: 'plan-source-priority',
      debateDirPath: '/abs/path/.code-oz/artifacts/debates/plan-source-priority',
      briefingSha256: SHA64A,
      manifestPreviewSha256: SHA64B,
      callerFamily: 'claude',
      opposingProvider: 'codex',
      opposingFamily: 'codex',
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects same-family pair (cross-family invariant — CLAUDE.md rule 2)', () => {
    const issue = validateEvent(
      valid({ callerFamily: 'codex', opposingFamily: 'codex' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('cross-family invariant')
  })

  test('rejects malformed briefingSha256 (not 64 hex)', () => {
    const issue = validateEvent(valid({ briefingSha256: 'too-short' }), 'events.jsonl')
    expect(issue?.rule).toContain('debate_started.briefingSha256')
  })

  test('rejects malformed manifestPreviewSha256 (D9 lock — sha bound to event)', () => {
    const issue = validateEvent(
      valid({ manifestPreviewSha256: 'not-hex' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('debate_started.manifestPreviewSha256')
  })

  test('rejects missing manifestPreviewSha256 (preview is mandatory per rule 13)', () => {
    const evt = valid()
    delete evt.manifestPreviewSha256
    const issue = validateEvent(evt, 'events.jsonl')
    expect(issue?.rule).toContain('debate_started.manifestPreviewSha256')
  })

  test('rejects empty agent', () => {
    expect(validateEvent(valid({ agent: '' }), 'events.jsonl')?.rule).toContain(
      'debate_started.agent',
    )
  })

  test('rejects empty debateDirPath', () => {
    expect(
      validateEvent(valid({ debateDirPath: '' }), 'events.jsonl')?.rule,
    ).toContain('debate_started.debateDirPath')
  })

  test('rejects empty callerFamily / opposingFamily', () => {
    expect(validateEvent(valid({ callerFamily: '' }), 'events.jsonl')?.rule).toContain(
      'debate_started.callerFamily',
    )
    expect(validateEvent(valid({ opposingFamily: '' }), 'events.jsonl')?.rule).toContain(
      'debate_started.opposingFamily',
    )
  })

  test('rejects empty opposingProvider', () => {
    expect(
      validateEvent(valid({ opposingProvider: '' }), 'events.jsonl')?.rule,
    ).toContain('debate_started.opposingProvider')
  })
})

describe('debate_started — topic slug grammar', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_started',
      ts: TS,
      runId: RUN,
      phase: 'plan',
      agent: 'lead',
      topic: 'plan-source-priority',
      debateDirPath: '/x/.code-oz/artifacts/debates/plan-source-priority',
      briefingSha256: SHA64A,
      manifestPreviewSha256: SHA64B,
      callerFamily: 'claude',
      opposingProvider: 'codex',
      opposingFamily: 'codex',
      ...overrides,
    }
  }

  test('rejects empty topic', () => {
    expect(validateEvent(valid({ topic: '' }), 'events.jsonl')?.rule).toContain(
      'debate_started.topic',
    )
  })

  test('rejects topic with uppercase', () => {
    expect(
      validateEvent(valid({ topic: 'Plan-Source-Priority' }), 'events.jsonl')?.rule,
    ).toContain('lowercase-kebab-case')
  })

  test('rejects topic with underscores', () => {
    expect(
      validateEvent(valid({ topic: 'plan_source_priority' }), 'events.jsonl')?.rule,
    ).toContain('lowercase-kebab-case')
  })

  test('rejects topic with spaces', () => {
    expect(
      validateEvent(valid({ topic: 'plan source priority' }), 'events.jsonl')?.rule,
    ).toContain('lowercase-kebab-case')
  })

  test('rejects topic > 48 characters', () => {
    const long = 'plan-' + 'x'.repeat(50)
    expect(validateEvent(valid({ topic: long }), 'events.jsonl')?.rule).toContain(
      '≤ 48 characters',
    )
  })

  test('accepts topic at boundary (48 chars exactly)', () => {
    const at = 'plan-' + 'a-'.repeat(20) + 'b' // length: 5 + 40 + 1 = 46... fix:
    const exactly48 = 'plan-' + 'a'.repeat(43) // 4 + 1 + 43 = 48
    expect(validateEvent(valid({ topic: exactly48 }), 'events.jsonl')).toBeNull()
    expect(at.length).toBeLessThanOrEqual(48)
  })

  test('accepts simple slugs', () => {
    expect(validateEvent(valid({ topic: 'meta-provenance' }), 'events.jsonl')).toBeNull()
    expect(validateEvent(valid({ topic: 'pre-m7-rules' }), 'events.jsonl')).toBeNull()
  })
})

describe('debate_resolved — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_resolved',
      ts: TS,
      runId: RUN,
      phase: 'plan',
      agent: 'lead',
      topic: 'plan-source-priority',
      debateDirPath: '/x/.code-oz/artifacts/debates/plan-source-priority',
      decisionSha256: SHA64C,
      callerVerdict: 'accept-with-modifications',
      responseVerdict: 'accept',
      rationaleSummary: 'Caller accepted opposing critique on docs precedence; modified PLAN to cite Anthropic first.',
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects malformed decisionSha256', () => {
    const issue = validateEvent(valid({ decisionSha256: 'too-short' }), 'events.jsonl')
    expect(issue?.rule).toContain('debate_resolved.decisionSha256')
  })

  test('rejects callerVerdict outside enum', () => {
    const issue = validateEvent(
      valid({ callerVerdict: 'maybe' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('debate_resolved.callerVerdict')
  })

  test('rejects responseVerdict outside enum (push is review-debate, not planning)', () => {
    const issue = validateEvent(valid({ responseVerdict: 'push' }), 'events.jsonl')
    expect(issue?.rule).toContain('debate_resolved.responseVerdict')
  })

  test('caller and response verdicts may agree (D5 lock — agreement is normal)', () => {
    expect(
      validateEvent(
        valid({ callerVerdict: 'accept', responseVerdict: 'accept' }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('caller and response verdicts may disagree (rule 9: data, not authority)', () => {
    expect(
      validateEvent(
        valid({ callerVerdict: 'reject', responseVerdict: 'accept' }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects empty rationaleSummary', () => {
    expect(
      validateEvent(valid({ rationaleSummary: '' }), 'events.jsonl')?.rule,
    ).toContain('rationaleSummary must not be empty')
  })

  test('rejects rationaleSummary > 200 chars', () => {
    const long = 'x'.repeat(201)
    expect(
      validateEvent(valid({ rationaleSummary: long }), 'events.jsonl')?.rule,
    ).toContain('≤ 200 characters')
  })

  test('accepts rationaleSummary at 200 char boundary', () => {
    const at = 'y'.repeat(200)
    expect(validateEvent(valid({ rationaleSummary: at }), 'events.jsonl')).toBeNull()
  })

  test('rejects non-string rationaleSummary', () => {
    expect(
      validateEvent(valid({ rationaleSummary: 42 }), 'events.jsonl')?.rule,
    ).toContain('rationaleSummary must be a string')
  })

  test('rejects malformed topic', () => {
    expect(
      validateEvent(valid({ topic: 'INVALID_TOPIC' }), 'events.jsonl')?.rule,
    ).toContain('lowercase-kebab-case')
  })
})

describe('agent_invoked / agent_completed — debate correlation forward-compat', () => {
  // Per D3 lock: M10 emits optional debateTopic + debateTurn on
  // agent_invoked/completed when the call is inside a debate. M9 readers
  // ignore unknown fields; the validator enforces both-present-or-both-absent.

  function validInvoked(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'agent_invoked',
      ts: TS,
      runId: RUN,
      phase: 'plan',
      agent: 'lead',
      provider: 'claude',
      manifest: { files: [] },
      filesSent: 0,
      bytesSent: 0,
      tokensEstimate: 100,
      fieldsRemovedByScope: 0,
      ...overrides,
    }
  }

  function validCompleted(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'agent_completed',
      ts: TS,
      runId: RUN,
      phase: 'plan',
      agent: 'lead',
      ...overrides,
    }
  }

  test('agent_invoked without correlation fields is valid (M9 backward-compat)', () => {
    expect(validateEvent(validInvoked(), 'events.jsonl')).toBeNull()
  })

  test('agent_invoked with both correlation fields is valid (debate context)', () => {
    expect(
      validateEvent(
        validInvoked({ debateTopic: 'plan-source-priority', debateTurn: 'opposing' }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('agent_invoked with only debateTopic is rejected (both-or-neither rule)', () => {
    expect(
      validateEvent(
        validInvoked({ debateTopic: 'plan-source-priority' }),
        'events.jsonl',
      )?.rule,
    ).toContain('both be present or both absent')
  })

  test('agent_invoked with only debateTurn is rejected (both-or-neither rule)', () => {
    expect(
      validateEvent(validInvoked({ debateTurn: 'opposing' }), 'events.jsonl')?.rule,
    ).toContain('both be present or both absent')
  })

  test('agent_invoked with debateTurn outside enum is rejected', () => {
    expect(
      validateEvent(
        validInvoked({ debateTopic: 'plan-x', debateTurn: 'preamble' }),
        'events.jsonl',
      )?.rule,
    ).toContain('agent_invoked.debateTurn')
  })

  test('agent_invoked with malformed debateTopic is rejected', () => {
    expect(
      validateEvent(
        validInvoked({ debateTopic: 'NOT_KEBAB', debateTurn: 'opposing' }),
        'events.jsonl',
      )?.rule,
    ).toContain('lowercase-kebab-case')
  })

  test('agent_completed correlation fields work the same way', () => {
    expect(
      validateEvent(
        validCompleted({ debateTopic: 'plan-x', debateTurn: 'synthesis' }),
        'events.jsonl',
      ),
    ).toBeNull()
    expect(
      validateEvent(validCompleted({ debateTopic: 'plan-x' }), 'events.jsonl')?.rule,
    ).toContain('both be present or both absent')
  })

  test('all three debateTurn values are accepted (opposing | synthesis | continuation)', () => {
    for (const turn of ['opposing', 'synthesis', 'continuation'] as const) {
      expect(
        validateEvent(
          validInvoked({ debateTopic: 'plan-x', debateTurn: turn }),
          'events.jsonl',
        ),
      ).toBeNull()
    }
  })
})
