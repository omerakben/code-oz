// M9 commit 10 — REVIEW remediation coordinator tests.
//
// Pure unit tests for decideReviewRemediation + the runReview cap-exhaust
// integration that emits review_blocked(reason='cap_exhausted') on round 4
// needs-revision.

import { describe, test, expect } from 'bun:test'
import {
  decideReviewRemediation,
  synthesizeRemediationDirective,
  REVIEW_ROUND_CAP,
  BUILD_ATTEMPT_CAP,
} from '../src/phases/review-remediation.ts'
import type { ReviewFinding } from '../src/artifacts/review-report.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'
import { generateUlid } from '../src/state/schemas.ts'

const RUN_ID = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TASK_ID = 'T-001'
const REVIEW_SHA = 'a'.repeat(64)

function reviewRoundCompleted(round: number, attempt: number = round): LoggedEvent {
  return Object.freeze({
    version: 1,
    type: 'review_round_completed',
    ts: '2026-04-30T12:00:00.000Z',
    runId: RUN_ID,
    phase: 'review',
    agent: 'reviewer',
    attempt,
    taskId: TASK_ID,
    round,
    score: 4,
    verdict: 'needs-revision',
    findingsRaised: 1,
    findingsResolved: 0,
    reviewReportSha256: 'a'.repeat(64),
  })
}

function buildCompleted(attempt: number): LoggedEvent {
  return Object.freeze({
    version: 1,
    type: 'build_completed',
    ts: '2026-04-30T12:00:00.000Z',
    runId: RUN_ID,
    phase: 'build',
    agent: 'builder',
    attempt,
    taskId: TASK_ID,
    changedFileCount: 1,
    buildReportSha256: 'b'.repeat(64),
    promptSnapshotSha256: 'c'.repeat(64),
  })
}

function unresolvedFinding(opts: {
  readonly id: string
  readonly severity?: 'block' | 'fix-first' | 'nit' | 'fyi'
  readonly title?: string
  readonly recommendation?: string
  readonly roundRaised?: number
}): ReviewFinding {
  return Object.freeze({
    id: opts.id,
    title: opts.title ?? 'a finding',
    file: 'src/foo.ts',
    line: '1',
    severity: opts.severity ?? 'fix-first',
    recommendation: opts.recommendation ?? 'fix it',
    roundRaised: opts.roundRaised ?? 1,
    roundResolved: 'unresolved',
  })
}


describe('decideReviewRemediation — continue path', () => {
  test('round 1 needs-revision after attempt 1 → continue with nextBuildAttempt=2, nextReviewRound=2', () => {
    const decision = decideReviewRemediation({
      events: [buildCompleted(1), reviewRoundCompleted(1, 1)],
      runId: RUN_ID,
      taskId: TASK_ID,
      priorRound: 1,
      priorAttempt: 1,
      priorFindings: [
        unresolvedFinding({ id: 'F-001', severity: 'fix-first' }),
      ],
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorValidationCommand: 'bun test tests/foo.test.ts',
      reopenedIds: [],
    })
    expect(decision.action).toBe('continue')
    if (decision.action !== 'continue') return
    expect(decision.nextBuildAttempt).toBe(2)
    expect(decision.nextReviewRound).toBe(2)
    expect(decision.carryForward.source).toBe('review-needs-revision')
    expect(decision.carryForward.priorAttempt).toBe(1)
    expect(decision.carryForward.priorForensicsPath).toBe('.code-oz/artifacts/REVIEW.md')
    expect(decision.carryForward.priorVerdict).toContain('needs-revision (round 1, sha ' + REVIEW_SHA + ')')
    // Constraint should mention F-001 (the unresolved blocker)
    expect(decision.carryForward.constraint).toContain('F-001')
    expect(decision.carryForward.priorFailureSummary).toContain('F-001')
  })

  test('round 3 needs-revision after attempt 3 → continue with nextBuildAttempt=4, nextReviewRound=4', () => {
    const decision = decideReviewRemediation({
      events: [
        buildCompleted(1),
        reviewRoundCompleted(1, 1),
        buildCompleted(2),
        reviewRoundCompleted(2, 2),
        buildCompleted(3),
        reviewRoundCompleted(3, 3),
      ],
      runId: RUN_ID,
      taskId: TASK_ID,
      priorRound: 3,
      priorAttempt: 3,
      priorFindings: [
        unresolvedFinding({ id: 'F-002', severity: 'fix-first' }),
      ],
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorValidationCommand: 'bun test tests/foo.test.ts',
      reopenedIds: [],
    })
    expect(decision.action).toBe('continue')
    if (decision.action !== 'continue') return
    expect(decision.nextBuildAttempt).toBe(4)
    expect(decision.nextReviewRound).toBe(4)
  })
})

describe('decideReviewRemediation — REVIEW cap exhausted', () => {
  test('round 4 needs-revision → review_cap_exhausted (no continue)', () => {
    const decision = decideReviewRemediation({
      events: [
        buildCompleted(1),
        reviewRoundCompleted(1, 1),
        buildCompleted(2),
        reviewRoundCompleted(2, 2),
        buildCompleted(3),
        reviewRoundCompleted(3, 3),
        buildCompleted(4),
        reviewRoundCompleted(4, 4),
      ],
      runId: RUN_ID,
      taskId: TASK_ID,
      priorRound: 4,
      priorAttempt: 4,
      priorFindings: [
        unresolvedFinding({ id: 'F-001', severity: 'fix-first', roundRaised: 1 }),
      ],
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorValidationCommand: 'bun test tests/foo.test.ts',
      reopenedIds: [],
    })
    expect(decision.action).toBe('review_cap_exhausted')
    if (decision.action !== 'review_cap_exhausted') return
    expect(decision.reason).toContain('REVIEW round cap reached (4/4)')
  })

  test('cap_exhausted message names reopened ids when ping-pong is detected', () => {
    const decision = decideReviewRemediation({
      events: [
        buildCompleted(1),
        reviewRoundCompleted(1, 1),
        buildCompleted(2),
        reviewRoundCompleted(2, 2),
        buildCompleted(3),
        reviewRoundCompleted(3, 3),
        buildCompleted(4),
        reviewRoundCompleted(4, 4),
      ],
      runId: RUN_ID,
      taskId: TASK_ID,
      priorRound: 4,
      priorAttempt: 4,
      priorFindings: [
        // F-001 was raised round 1, resolved round 2, then reopened in round 4.
        unresolvedFinding({ id: 'F-001', severity: 'fix-first', roundRaised: 1 }),
        unresolvedFinding({ id: 'F-002', severity: 'block', roundRaised: 2 }),
      ],
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorValidationCommand: 'bun test tests/foo.test.ts',
      reopenedIds: ['F-001'],
    })
    expect(decision.action).toBe('review_cap_exhausted')
    if (decision.action !== 'review_cap_exhausted') return
    expect(decision.reopenedIds).toContain('F-001')
    expect(decision.reopenedIds).toContain('F-002')
    expect(decision.reason).toContain('F-001')
    expect(decision.reason).toContain('reopened:')
  })

  test('cap_exhausted with no reopened ids omits the reopened suffix', () => {
    const decision = decideReviewRemediation({
      events: [
        buildCompleted(1),
        reviewRoundCompleted(1, 1),
        buildCompleted(2),
        reviewRoundCompleted(2, 2),
        buildCompleted(3),
        reviewRoundCompleted(3, 3),
        buildCompleted(4),
        reviewRoundCompleted(4, 4),
      ],
      runId: RUN_ID,
      taskId: TASK_ID,
      priorRound: 4,
      priorAttempt: 4,
      // Findings were raised + remained unresolved in round 4 (not reopened).
      priorFindings: [
        unresolvedFinding({ id: 'F-001', severity: 'fix-first', roundRaised: 4 }),
      ],
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorValidationCommand: 'bun test tests/foo.test.ts',
      reopenedIds: [],
    })
    expect(decision.action).toBe('review_cap_exhausted')
    if (decision.action !== 'review_cap_exhausted') return
    expect(decision.reopenedIds).toEqual([])
    expect(decision.reason).not.toContain('reopened:')
  })
})

describe('decideReviewRemediation — BUILD cap during REVIEW remediation', () => {
  test('4 build_completed events but only 1 review_round_completed → build_cap_blocked', () => {
    const decision = decideReviewRemediation({
      // 4 BUILD attempts ran (e.g., VERIFY-failed restarts), then attempt 4
      // produced a clean BUILD that ran REVIEW round 1 with a needs-revision
      // exit. The remediation coordinator must not advance to attempt 5.
      events: [
        buildCompleted(1),
        buildCompleted(2),
        buildCompleted(3),
        buildCompleted(4),
        reviewRoundCompleted(1, 4),
      ],
      runId: RUN_ID,
      taskId: TASK_ID,
      priorRound: 1,
      priorAttempt: 4,
      priorFindings: [
        unresolvedFinding({ id: 'F-001', severity: 'fix-first' }),
      ],
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorValidationCommand: 'bun test tests/foo.test.ts',
      reopenedIds: [],
    })
    expect(decision.action).toBe('build_cap_blocked')
    if (decision.action !== 'build_cap_blocked') return
    expect(decision.buildAttemptsUsed).toBe(4)
    expect(decision.reason).toContain('BUILD attempt cap reached (4/4)')
    // Authority overlap message includes "while addressing REVIEW round 1"
    expect(decision.reason).toContain('while addressing REVIEW round 1')
    expect(decision.reason).toContain('VERIFY-owned')
  })
})

describe('synthesizeRemediationDirective', () => {
  test('blocking findings produce summary + constraint listing ids and recommendations', () => {
    const out = synthesizeRemediationDirective([
      unresolvedFinding({
        id: 'F-001',
        severity: 'block',
        recommendation: 'must remove the side-effect',
      }),
      unresolvedFinding({
        id: 'F-002',
        severity: 'fix-first',
        recommendation: 'add a test for the edge case',
      }),
    ])
    expect(out.summary).toContain('2 unresolved finding(s): F-001, F-002')
    expect(out.constraint).toContain('F-001')
    expect(out.constraint).toContain('must remove the side-effect')
    expect(out.constraint).toContain('F-002')
    expect(out.constraint).toContain('add a test')
  })

  test('no blockers but score < 6 → fallback summary + constraint', () => {
    const out = synthesizeRemediationDirective([
      // Only nit-severity findings; persona's score must have been < 6.
      Object.freeze({
        id: 'F-001',
        title: 'tiny doc nit',
        file: 'src/foo.ts',
        line: '5',
        severity: 'nit' as const,
        recommendation: 'tighten wording',
        roundRaised: 1,
        roundResolved: 'unresolved' as const,
      }),
    ])
    expect(out.summary).toContain('persona score < 6')
    expect(out.constraint).toContain('address feedback noted in REVIEW.md')
  })

  test('clips summary and constraint to 200 characters', () => {
    const longRec = 'x'.repeat(500)
    const out = synthesizeRemediationDirective([
      unresolvedFinding({
        id: 'F-001',
        severity: 'fix-first',
        recommendation: longRec,
      }),
    ])
    expect(out.summary.length).toBeLessThanOrEqual(200)
    expect(out.constraint.length).toBeLessThanOrEqual(200)
  })
})

describe('exposed cap constants', () => {
  test('REVIEW_ROUND_CAP === 4', () => {
    expect(REVIEW_ROUND_CAP).toBe(4)
  })
  test('BUILD_ATTEMPT_CAP === 4', () => {
    expect(BUILD_ATTEMPT_CAP).toBe(4)
  })
})
