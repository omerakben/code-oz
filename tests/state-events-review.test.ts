// M9 commit 3: review_* event types + validators.
//
// REVIEW.md § "Event types emitted" pinned 4 lifecycle events. The
// validators here are append-time guards — every line written by
// runReview (M9 commit 7+) goes through validateEvent before
// fsync. Future schema bumps would increment `version: 1`; M9 stays
// on v1 (open-type-union rule per validation rule 12).
//
// Per CODEX_RESPONSE_M9.md decision 4 (authority overlap rule):
// review_blocked is NOT emitted when VERIFY's 4-attempt cap exhausts
// during a REVIEW round — that path is VERIFY-owned. The validator
// does not enforce that semantic (it's an orchestrator concern), but
// the reason enum is restricted to {'block', 'cap_exhausted'} which
// has no value for the verify-cap path.

import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-04-30T12:00:00.000Z'

const SHA40 = '0123456789abcdef0123456789abcdef01234567'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)
const SHA64C = 'c'.repeat(64)
const SHA64D = 'd'.repeat(64)

describe('review_started — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_started',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      baseCommitSha: SHA40,
      patchSha256: SHA64A,
      buildReportSha256: SHA64B,
      verifyReportSha256: SHA64C,
      buildFamily: 'claude',
      reviewerFamily: 'codex',
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects same-family pair (cross-family invariant)', () => {
    const issue = validateEvent(valid({ buildFamily: 'codex', reviewerFamily: 'codex' }), 'events.jsonl')
    expect(issue?.rule).toContain('cross-family invariant')
  })

  test('rejects malformed baseCommitSha (not 40 hex)', () => {
    const issue = validateEvent(valid({ baseCommitSha: 'not-hex' }), 'events.jsonl')
    expect(issue?.rule).toContain('review_started.baseCommitSha')
  })

  test('rejects malformed patchSha256 (not 64 hex)', () => {
    const issue = validateEvent(valid({ patchSha256: 'too-short' }), 'events.jsonl')
    expect(issue?.rule).toContain('review_started.patchSha256')
  })

  test('rejects missing buildReportSha256', () => {
    const evt = valid()
    delete evt.buildReportSha256
    const issue = validateEvent(evt, 'events.jsonl')
    expect(issue?.rule).toContain('review_started.buildReportSha256')
  })

  test('rejects missing verifyReportSha256 (REVIEW reads VERIFY.md too)', () => {
    const evt = valid()
    delete evt.verifyReportSha256
    const issue = validateEvent(evt, 'events.jsonl')
    expect(issue?.rule).toContain('review_started.verifyReportSha256')
  })

  test('rejects malformed taskId', () => {
    const issue = validateEvent(valid({ taskId: 'task-1' }), 'events.jsonl')
    expect(issue?.rule).toContain('review_started.taskId')
  })

  test('rejects empty buildFamily / reviewerFamily', () => {
    expect(validateEvent(valid({ buildFamily: '' }), 'events.jsonl')?.rule).toContain(
      'review_started.buildFamily',
    )
    expect(validateEvent(valid({ reviewerFamily: '' }), 'events.jsonl')?.rule).toContain(
      'review_started.reviewerFamily',
    )
  })

  test('rejects non-positive attempt', () => {
    expect(validateEvent(valid({ attempt: 0 }), 'events.jsonl')?.rule).toContain(
      'review_started.attempt',
    )
    expect(validateEvent(valid({ attempt: -1 }), 'events.jsonl')?.rule).toContain(
      'review_started.attempt',
    )
  })
})

describe('review_round_completed — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_round_completed',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      round: 1,
      score: 7,
      verdict: 'ready',
      findingsRaised: 0,
      findingsResolved: 0,
      reviewReportSha256: 'a'.repeat(64),
      ...overrides,
    }
  }

  test('valid round 1 ready event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('valid round 4 needs-revision event passes', () => {
    expect(
      validateEvent(valid({ round: 4, score: 5, verdict: 'needs-revision' }), 'events.jsonl'),
    ).toBeNull()
  })

  test('rejects round = 0', () => {
    expect(validateEvent(valid({ round: 0 }), 'events.jsonl')?.rule).toContain(
      'review_round_completed.round must be an integer in [1, 4]',
    )
  })

  test('rejects round = 5 (CLAUDE.md rule 6 cap)', () => {
    expect(validateEvent(valid({ round: 5 }), 'events.jsonl')?.rule).toContain(
      'review_round_completed.round',
    )
  })

  test('rejects non-integer round', () => {
    expect(validateEvent(valid({ round: 1.5 }), 'events.jsonl')?.rule).toContain(
      'review_round_completed.round',
    )
  })

  test('rejects score < 0', () => {
    expect(validateEvent(valid({ score: -1 }), 'events.jsonl')?.rule).toContain(
      'review_round_completed.score',
    )
  })

  test('rejects score > 10', () => {
    expect(validateEvent(valid({ score: 11 }), 'events.jsonl')?.rule).toContain(
      'review_round_completed.score',
    )
  })

  test('rejects unknown verdict', () => {
    expect(validateEvent(valid({ verdict: 'sorta-ready' }), 'events.jsonl')?.rule).toContain(
      'review_round_completed.verdict',
    )
  })

  test('accepts each of the three valid verdicts', () => {
    for (const v of ['ready', 'needs-revision', 'block']) {
      expect(validateEvent(valid({ verdict: v }), 'events.jsonl')).toBeNull()
    }
  })

  test('rejects negative findingsRaised', () => {
    expect(validateEvent(valid({ findingsRaised: -1 }), 'events.jsonl')?.rule).toContain(
      'findingsRaised',
    )
  })

  test('rejects non-integer findingsResolved', () => {
    expect(validateEvent(valid({ findingsResolved: 1.5 }), 'events.jsonl')?.rule).toContain(
      'findingsResolved',
    )
  })

  test('findingsResolved may exceed findingsRaised (prior-round resolutions)', () => {
    expect(
      validateEvent(valid({ findingsRaised: 0, findingsResolved: 3 }), 'events.jsonl'),
    ).toBeNull()
  })

  test('M9 commit 13 fs#2: rejects missing reviewReportSha256', () => {
    const ev = valid()
    delete (ev as Record<string, unknown>).reviewReportSha256
    const issue = validateEvent(ev, 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('review_round_completed.reviewReportSha256')
  })

  test('M9 commit 13 fs#2: rejects malformed reviewReportSha256', () => {
    expect(
      validateEvent(valid({ reviewReportSha256: 'not-hex' }), 'events.jsonl')?.rule,
    ).toContain('review_round_completed.reviewReportSha256')
  })
})

describe('review_resolved — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_resolved',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      finalRound: 1,
      finalScore: 7,
      reviewReportSha256: SHA64D,
      ...overrides,
    }
  }

  test('valid event passes (round 1 ready exit)', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects finalScore = 5 (rule 6 exit requires score ≥ 6)', () => {
    expect(validateEvent(valid({ finalScore: 5 }), 'events.jsonl')?.rule).toContain(
      'finalScore must be an integer in [6, 10]',
    )
  })

  test('accepts finalScore at the boundary (6)', () => {
    expect(validateEvent(valid({ finalScore: 6 }), 'events.jsonl')).toBeNull()
  })

  test('accepts finalScore at the ceiling (10)', () => {
    expect(validateEvent(valid({ finalScore: 10 }), 'events.jsonl')).toBeNull()
  })

  test('rejects finalScore > 10', () => {
    expect(validateEvent(valid({ finalScore: 11 }), 'events.jsonl')?.rule).toContain(
      'review_resolved.finalScore',
    )
  })

  test('rejects finalRound = 0', () => {
    expect(validateEvent(valid({ finalRound: 0 }), 'events.jsonl')?.rule).toContain(
      'review_resolved.finalRound',
    )
  })

  test('rejects finalRound = 5', () => {
    expect(validateEvent(valid({ finalRound: 5 }), 'events.jsonl')?.rule).toContain(
      'review_resolved.finalRound',
    )
  })

  test('rejects malformed reviewReportSha256', () => {
    expect(validateEvent(valid({ reviewReportSha256: 'short' }), 'events.jsonl')?.rule).toContain(
      'review_resolved.reviewReportSha256',
    )
  })
})

describe('review_blocked — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_blocked',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      reason: 'block',
      finalRound: 1,
      reviewReportSha256: SHA64D,
      ...overrides,
    }
  }

  test('valid block event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('valid cap_exhausted event passes (round 4)', () => {
    expect(
      validateEvent(valid({ reason: 'cap_exhausted', finalRound: 4 }), 'events.jsonl'),
    ).toBeNull()
  })

  test('rejects unknown reason', () => {
    expect(validateEvent(valid({ reason: 'verify_cap_during_review' }), 'events.jsonl')?.rule)
      .toContain('review_blocked.reason')
  })

  test('rejects unknown reason: needs-revision', () => {
    // needs-revision is a verdict, not a block reason; exit on round-4
    // needs-revision → reason='cap_exhausted', not 'needs-revision'.
    expect(validateEvent(valid({ reason: 'needs-revision' }), 'events.jsonl')?.rule).toContain(
      'review_blocked.reason',
    )
  })

  test('rejects finalRound = 0', () => {
    expect(validateEvent(valid({ finalRound: 0 }), 'events.jsonl')?.rule).toContain(
      'review_blocked.finalRound',
    )
  })

  test('rejects malformed reviewReportSha256', () => {
    expect(validateEvent(valid({ reviewReportSha256: 'nope' }), 'events.jsonl')?.rule).toContain(
      'review_blocked.reviewReportSha256',
    )
  })

  test('rejects missing reviewReportSha256 (REVIEW.md is always written, even on block)', () => {
    const evt = valid()
    delete evt.reviewReportSha256
    expect(validateEvent(evt, 'events.jsonl')?.rule).toContain(
      'review_blocked.reviewReportSha256',
    )
  })
})

describe('review_* events — envelope checks', () => {
  test('all four event types are listed in EVENT_TYPES (known set)', async () => {
    const { EVENT_TYPES } = await import('../src/state/schemas.ts')
    for (const t of ['review_started', 'review_round_completed', 'review_resolved', 'review_blocked']) {
      expect(EVENT_TYPES).toContain(t as (typeof EVENT_TYPES)[number])
    }
  })

  test('rejects review_started missing phase', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'review_started',
        ts: TS,
        runId: RUN,
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        baseCommitSha: SHA40,
        patchSha256: SHA64A,
        buildReportSha256: SHA64B,
        verifyReportSha256: SHA64C,
        buildFamily: 'claude',
        reviewerFamily: 'codex',
      },
      'events.jsonl',
    )
    expect(issue?.code).toBe('event_invalid_phase')
  })
})

// M16 C8: review_remediation_recorded — emitted by dispatchReview on
// `needs_revision` REVIEW returns. Persists `nextReviewRound` so resumed
// dispatches resolve round N+1 without re-deriving it.
describe('review_remediation_recorded — validator', () => {
  const DECISION_ID = generateUlid({ now: 1_000_000_006_000, random: new Uint8Array(10) })

  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_remediation_recorded',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      reviewRound: 1,
      nextReviewRound: 2,
      decisionId: DECISION_ID,
      reviewMdSha256: SHA64D,
      remediationIntent: 'continue',
      refsTo: { type: 'review_round_completed', reviewReportSha256: SHA64D },
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects nextReviewRound <= reviewRound', () => {
    const issue = validateEvent(
      valid({ reviewRound: 2, nextReviewRound: 2 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('nextReviewRound')
  })

  test('rejects nextReviewRound > REVIEW_ROUND_CAP (4)', () => {
    const issue = validateEvent(
      valid({ reviewRound: 4, nextReviewRound: 5 }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('nextReviewRound')
  })

  test('rejects malformed decisionId (not a ULID)', () => {
    const issue = validateEvent(valid({ decisionId: 'short' }), 'events.jsonl')
    expect(issue?.rule).toContain('decisionId must be a 26-char Crockford ULID')
  })

  test('rejects malformed reviewMdSha256 (not 64 hex)', () => {
    const issue = validateEvent(valid({ reviewMdSha256: 'too-short' }), 'events.jsonl')
    expect(issue?.rule).toContain('reviewMdSha256')
  })

  test('rejects unsupported remediationIntent', () => {
    const issue = validateEvent(valid({ remediationIntent: 'bogus' }), 'events.jsonl')
    expect(issue?.rule).toContain('remediationIntent')
  })

  test('rejects missing refsTo.reviewReportSha256', () => {
    const issue = validateEvent(
      valid({ refsTo: { type: 'review_round_completed' } }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('refsTo.reviewReportSha256')
  })

  test("rejects refsTo.type !== 'review_round_completed'", () => {
    const issue = validateEvent(
      valid({ refsTo: { type: 'review_resolved', reviewReportSha256: SHA64D } }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('review_round_completed')
  })

  test('accepts other intent values (review_cap_exhausted / build_cap_blocked) for forward compat', () => {
    expect(validateEvent(valid({ remediationIntent: 'review_cap_exhausted' }), 'events.jsonl')).toBeNull()
    expect(validateEvent(valid({ remediationIntent: 'build_cap_blocked' }), 'events.jsonl')).toBeNull()
  })

  test('rejects missing taskId', () => {
    const evt = valid()
    delete evt.taskId
    const issue = validateEvent(evt, 'events.jsonl')
    expect(issue?.rule).toContain('taskId')
  })
})
