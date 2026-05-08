// M15 commit 1: debate-policy scheduler event taxonomy validators.
//
// Six new event types per docs/contracts/DEBATE_POLICY.md (commit 7) and
// docs/design/SESSION_M15_IMPL_KICKOFF.md §4:
//   - debate_scheduler_evaluated   (always emitted; SchedulerInput digest)
//   - debate_scheduler_fired       (fire path; opposingProvider + debateTopic)
//   - debate_scheduler_skipped     (skip path; reason + optional budgetTipReason)
//   - debate_scheduler_error       (degraded-error path; reason)
//   - debate_scheduler_postreview  (post-debate REVIEW round; pre/post sha + verdicts + finding deltas)
//   - debate_policy_baseline_completed (rule-21 ship-gate metric event)
//
// All five decision events share the trace envelope: phase + agent + attempt
// + taskId + decisionId (ULID) + reviewRound (1..4). Correlation across the
// disjoint trace flows through `decisionId`.

import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const DECISION = generateUlid({
  now: 1_000_000_001_000,
  random: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
})
const TS = '2026-05-08T03:30:00.000Z'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)
const SHA64C = 'c'.repeat(64)

// ---------------------------------------------------------------------------
// debate_scheduler_evaluated
// ---------------------------------------------------------------------------
describe('debate_scheduler_evaluated — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_scheduler_evaluated',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      decisionId: DECISION,
      reviewRound: 1,
      mode: 'auto',
      inputDigest: SHA64A,
      preReviewReportSha256: SHA64B,
      reviewMode: 'single',
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('valid panel-mode evaluation passes', () => {
    expect(validateEvent(valid({ reviewMode: 'panel' }), 'events.jsonl')).toBeNull()
  })

  test('rejects non-ULID decisionId', () => {
    const issue = validateEvent(valid({ decisionId: 'not-a-ulid' }), 'events.jsonl')
    expect(issue?.rule).toContain('decisionId must be a 26-char Crockford ULID')
  })

  test('rejects reviewRound = 0', () => {
    const issue = validateEvent(valid({ reviewRound: 0 }), 'events.jsonl')
    expect(issue?.rule).toContain('reviewRound')
  })

  test('rejects reviewRound = 5 (over cap)', () => {
    const issue = validateEvent(valid({ reviewRound: 5 }), 'events.jsonl')
    expect(issue?.rule).toContain('reviewRound')
  })

  test('rejects invalid mode', () => {
    const issue = validateEvent(valid({ mode: 'turbo' }), 'events.jsonl')
    expect(issue?.rule).toContain('mode')
  })

  test('rejects malformed inputDigest', () => {
    const issue = validateEvent(valid({ inputDigest: 'short' }), 'events.jsonl')
    expect(issue?.rule).toContain('inputDigest')
  })

  test('rejects malformed preReviewReportSha256', () => {
    const issue = validateEvent(
      valid({ preReviewReportSha256: 'NOT_HEX' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('preReviewReportSha256')
  })

  test('rejects unknown reviewMode', () => {
    const issue = validateEvent(valid({ reviewMode: 'pair' }), 'events.jsonl')
    expect(issue?.rule).toContain('reviewMode')
  })

  test('rejects malformed taskId', () => {
    const issue = validateEvent(valid({ taskId: 'task-1' }), 'events.jsonl')
    expect(issue?.rule).toContain('taskId')
  })
})

// ---------------------------------------------------------------------------
// debate_scheduler_fired
// ---------------------------------------------------------------------------
describe('debate_scheduler_fired — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_scheduler_fired',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-002',
      decisionId: DECISION,
      reviewRound: 2,
      reason: 'score_in_grey_zone',
      opposingProvider: 'gemini',
      debateTopic: 'review-grey-zone-pivot-001',
      preReviewReportSha256: SHA64A,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('all three fire reasons round-trip', () => {
    for (const reason of [
      'score_in_grey_zone',
      'panel_voter_disagreement',
      'needs_revision_with_high_score',
    ] as const) {
      expect(validateEvent(valid({ reason }), 'events.jsonl')).toBeNull()
    }
  })

  test('rejects unknown fire reason', () => {
    const issue = validateEvent(
      valid({ reason: 'verdict_confidence_low' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('reason')
  })

  test('rejects empty opposingProvider', () => {
    const issue = validateEvent(valid({ opposingProvider: '' }), 'events.jsonl')
    expect(issue?.rule).toContain('opposingProvider')
  })

  test('rejects empty debateTopic', () => {
    const issue = validateEvent(valid({ debateTopic: '' }), 'events.jsonl')
    expect(issue?.rule).toContain('debateTopic')
  })

  test('rejects malformed preReviewReportSha256', () => {
    const issue = validateEvent(
      valid({ preReviewReportSha256: 'X'.repeat(64) }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('preReviewReportSha256')
  })
})

// ---------------------------------------------------------------------------
// debate_scheduler_skipped
// ---------------------------------------------------------------------------
describe('debate_scheduler_skipped — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_scheduler_skipped',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-003',
      decisionId: DECISION,
      reviewRound: 1,
      reason: 'mode_manual',
      preReviewReportSha256: SHA64C,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('every skip reason round-trips', () => {
    const reasons = [
      'mode_off',
      'mode_manual',
      'no_trigger_matched',
      'max_per_run_exhausted',
      'max_per_task_exhausted',
      'budget_exhausted',
      'persona_no_debate_permission',
      'persona_no_eligible_opponent',
      'concurrent_limit',
      'manifest_size_exceeds_maxFiles',
      'dedup_fingerprint_already_debated',
    ] as const
    for (const reason of reasons) {
      expect(validateEvent(valid({ reason }), 'events.jsonl')).toBeNull()
    }
  })

  test('rejects unknown skip reason', () => {
    const issue = validateEvent(valid({ reason: 'persona_busy' }), 'events.jsonl')
    expect(issue?.rule).toContain('reason')
  })

  test('budgetTipReason allowed only on budget_exhausted', () => {
    const wrong = validateEvent(
      valid({ reason: 'mode_manual', budgetTipReason: 'maxTurns' }),
      'events.jsonl',
    )
    expect(wrong?.rule).toContain('budget_exhausted')
    const right = validateEvent(
      valid({ reason: 'budget_exhausted', budgetTipReason: 'maxTurns' }),
      'events.jsonl',
    )
    expect(right).toBeNull()
  })

  test('rejects unknown budgetTipReason', () => {
    const issue = validateEvent(
      valid({ reason: 'budget_exhausted', budgetTipReason: 'maxBytesEstimate' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('budgetTipReason')
  })
})

// ---------------------------------------------------------------------------
// debate_scheduler_error
// ---------------------------------------------------------------------------
describe('debate_scheduler_error — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_scheduler_error',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-004',
      decisionId: DECISION,
      reviewRound: 3,
      reason: 'transient_io',
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('every error reason round-trips', () => {
    for (const reason of [
      'artifact_invalid',
      'transient_io',
      'resume_after_fire_no_start',
      'other',
    ] as const) {
      expect(validateEvent(valid({ reason }), 'events.jsonl')).toBeNull()
    }
  })

  test('rejects unknown error reason', () => {
    const issue = validateEvent(valid({ reason: 'auth_missing' }), 'events.jsonl')
    expect(issue?.rule).toContain('reason')
  })

  test('valid with underlyingErrorCode passes', () => {
    expect(
      validateEvent(
        valid({ underlyingErrorCode: 'ETIMEDOUT' }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects empty underlyingErrorCode', () => {
    const issue = validateEvent(valid({ underlyingErrorCode: '' }), 'events.jsonl')
    expect(issue?.rule).toContain('underlyingErrorCode')
  })
})

// ---------------------------------------------------------------------------
// debate_scheduler_postreview
// ---------------------------------------------------------------------------
describe('debate_scheduler_postreview — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_scheduler_postreview',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-005',
      decisionId: DECISION,
      reviewRound: 2,
      preReviewReportSha256: SHA64A,
      postReviewReportSha256: SHA64B,
      verdictPre: 'needs-revision',
      verdictPost: 'ready',
      findingsAddedCount: 2,
      actionableFindingsAddedCount: 1,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('panel verdict literal accepted on both sides', () => {
    expect(
      validateEvent(
        valid({ verdictPre: 'panel', verdictPost: 'panel' }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects unknown verdictPre', () => {
    const issue = validateEvent(valid({ verdictPre: 'maybe' }), 'events.jsonl')
    expect(issue?.rule).toContain('verdictPre')
  })

  test('rejects actionable count exceeding total', () => {
    const issue = validateEvent(
      valid({ findingsAddedCount: 1, actionableFindingsAddedCount: 2 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('actionableFindingsAddedCount must not exceed')
  })

  test('zero added findings is valid (no-signal-fire)', () => {
    expect(
      validateEvent(
        valid({ findingsAddedCount: 0, actionableFindingsAddedCount: 0 }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects negative findingsAddedCount', () => {
    const issue = validateEvent(
      valid({ findingsAddedCount: -1 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('findingsAddedCount')
  })
})

// ---------------------------------------------------------------------------
// debate_policy_baseline_completed
// ---------------------------------------------------------------------------
describe('debate_policy_baseline_completed — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'debate_policy_baseline_completed',
      ts: TS,
      runId: RUN,
      fixtureSet: 'tests/fixtures/debate-scheduler-baseline',
      correctiveDeltaRate: 0.5,
      antiCorrectiveCount: 0,
      newActionableFindingRate: 0.4,
      noSignalFireRate: 0.1,
      perTriggerBreakdown: [
        {
          reason: 'score_in_grey_zone',
          fired: 4,
          correctiveCount: 2,
          newActionableCount: 2,
        },
        {
          reason: 'panel_voter_disagreement',
          fired: 2,
          correctiveCount: 1,
          newActionableCount: 1,
        },
      ],
      costOverheadAvgTokens: 1200,
      latencyOverheadAvgMs: 4500,
      passedRuleTwentyOne: true,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects ratio > 1', () => {
    const issue = validateEvent(
      valid({ correctiveDeltaRate: 1.5 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('correctiveDeltaRate')
  })

  test('rejects negative ratio', () => {
    const issue = validateEvent(
      valid({ noSignalFireRate: -0.01 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('noSignalFireRate')
  })

  test('rejects non-boolean passedRuleTwentyOne', () => {
    const issue = validateEvent(
      valid({ passedRuleTwentyOne: 1 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('passedRuleTwentyOne')
  })

  test('rejects perTriggerBreakdown row with unknown reason', () => {
    const issue = validateEvent(
      valid({
        perTriggerBreakdown: [
          { reason: 'verdict_confidence', fired: 0, correctiveCount: 0, newActionableCount: 0 },
        ],
      }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('reason')
  })

  test('rejects perTriggerBreakdown not-an-array', () => {
    const issue = validateEvent(
      valid({ perTriggerBreakdown: 'invalid' }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('perTriggerBreakdown')
  })

  test('rejects negative antiCorrectiveCount', () => {
    const issue = validateEvent(
      valid({ antiCorrectiveCount: -1 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('antiCorrectiveCount')
  })

  test('rejects missing costOverheadAvgTokens', () => {
    const e = valid()
    delete (e as Record<string, unknown>).costOverheadAvgTokens
    const issue = validateEvent(e, 'events.jsonl')
    expect(issue?.rule).toContain('costOverheadAvgTokens')
  })

  test('rule-21 fail = false is a valid event payload', () => {
    expect(
      validateEvent(
        valid({
          passedRuleTwentyOne: false,
          correctiveDeltaRate: 0.05,
          newActionableFindingRate: 0.10,
        }),
        'events.jsonl',
      ),
    ).toBeNull()
  })
})
