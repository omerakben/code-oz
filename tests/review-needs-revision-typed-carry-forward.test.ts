// M9 commit 9: serializeReviewCarryForward — REVIEW round-N
// needs-revision → BUILD attempt N+1 carry-forward shape.
//
// This helper is the M9 substrate that commit 10's review-remediation
// coordinator consumes. It maps a REVIEW exit (review report path + sha
// + summary + constraint + prior round + prior attempt) into the typed
// BuildReportCarryForward that BUILD's existing `attempt > 1` machinery
// already accepts.
//
// The round-trip property is the load-bearing claim: a carry-forward
// produced by serializeReviewCarryForward must be (a) consumable as a
// valid BUILD_REPORT.md.failureCarryForward block, and (b) round-trip
// through serializeBuildReport / parseBuildReport without mutating the
// Source field.

import { describe, test, expect } from 'bun:test'
import {
  parseBuildReport,
  serializeBuildReport,
  type BuildReportCarryForward,
  type BuildReportData,
} from '../src/artifacts/build-report.ts'
import { serializeReviewCarryForward } from '../src/artifacts/review-report.ts'

const PLAN_SHA = 'a'.repeat(64)
const BASE_SHA = 'b'.repeat(40)
const PATCH_SHA = 'c'.repeat(64)
const ENTRY_SHA = 'd'.repeat(64)
const REVIEW_SHA = 'e'.repeat(64)

function dataWithCarryForward(cf: BuildReportCarryForward): BuildReportData {
  return {
    task: {
      taskId: 'T-001',
      title: 'BUILD attempt N+1 driven by REVIEW remediation',
      planSha: PLAN_SHA,
      attempt: cf.priorAttempt + 1,
    },
    base: {
      worktreePath: '.code-oz/runs/01HX/worktree/',
      baseCommitSha: BASE_SHA,
      dirtyAtBase: false,
    },
    patch: {
      patchPath: `.code-oz/runs/01HX/patches/attempt-${cf.priorAttempt + 1}.patch`,
      patchSha256: PATCH_SHA,
      patchBytes: 256,
    },
    changedFiles: [{ path: 'src/foo.ts', sha256: ENTRY_SHA, change: 'modified' }],
    validationCommand: {
      command: 'bun test tests/foo.test.ts',
      workingDirectory: '.code-oz/runs/<runId>/worktree/',
      timeoutMs: 60_000,
      expectedExitCode: 0,
    },
    failureCarryForward: cf,
    notes: ['Risk: noted in plan.'],
  }
}

describe('serializeReviewCarryForward — REVIEW needs-revision → BUILD attempt N+1', () => {
  test('produces a Source: review-needs-revision carry-forward', () => {
    const cf = serializeReviewCarryForward({
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorRound: 1,
      summary: 'reviewer flagged unexplained side-effect in topN.',
      constraint: 'document the side-effect or remove it before re-review.',
      priorAttempt: 1,
      priorValidationCommand: 'bun test tests/foo.test.ts',
    })
    expect(cf.source).toBe('review-needs-revision')
    expect(cf.priorAttempt).toBe(1)
    expect(cf.priorForensicsPath).toBe('.code-oz/artifacts/REVIEW.md')
    expect(cf.priorVerdict).toContain('needs-revision (round 1, sha ' + REVIEW_SHA + ')')
    expect(cf.priorFailureSummary).toBe(
      'reviewer flagged unexplained side-effect in topN.',
    )
    expect(cf.constraint).toBe(
      'document the side-effect or remove it before re-review.',
    )
  })

  test('round-trips through serializeBuildReport / parseBuildReport without mutation', () => {
    const cf = serializeReviewCarryForward({
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorRound: 2,
      summary: 'reviewer asked for stricter null-check on edge case',
      constraint: 'add explicit null-check at top of helper, with test',
      priorAttempt: 2,
      priorValidationCommand: 'bun test tests/foo.test.ts',
    })
    const text = serializeBuildReport(dataWithCarryForward(cf))
    expect(text).toContain('- Source: review-needs-revision')
    expect(text).toContain('- Prior attempt: 2')
    expect(text).toContain('- Prior forensics: .code-oz/artifacts/REVIEW.md')
    expect(text).toContain('- Prior verdict: needs-revision (round 2, sha ' + REVIEW_SHA + ')')

    const round = parseBuildReport(text)
    expect(round.failureCarryForward).not.toBeNull()
    expect(round.failureCarryForward).toEqual(cf)
    expect(round.task.attempt).toBe(3)
  })

  test('rejects priorRound out of [1, 4]', () => {
    expect(() =>
      serializeReviewCarryForward({
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        reviewReportSha256: REVIEW_SHA,
        priorRound: 0,
        summary: 's',
        constraint: 'c',
        priorAttempt: 1,
        priorValidationCommand: 'bun t',
      }),
    ).toThrow(/priorRound must be in \[1, 4\]/)
    expect(() =>
      serializeReviewCarryForward({
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        reviewReportSha256: REVIEW_SHA,
        priorRound: 5,
        summary: 's',
        constraint: 'c',
        priorAttempt: 1,
        priorValidationCommand: 'bun t',
      }),
    ).toThrow(/priorRound must be in \[1, 4\]/)
  })

  test('rejects priorAttempt < 1', () => {
    expect(() =>
      serializeReviewCarryForward({
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        reviewReportSha256: REVIEW_SHA,
        priorRound: 1,
        summary: 's',
        constraint: 'c',
        priorAttempt: 0,
        priorValidationCommand: 'bun t',
      }),
    ).toThrow(/priorAttempt must be ≥ 1/)
  })

  test('rejects summary > 200 characters', () => {
    expect(() =>
      serializeReviewCarryForward({
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        reviewReportSha256: REVIEW_SHA,
        priorRound: 1,
        summary: 'x'.repeat(201),
        constraint: 'c',
        priorAttempt: 1,
        priorValidationCommand: 'bun t',
      }),
    ).toThrow(/summary exceeds 200 characters/)
  })

  test('rejects constraint > 200 characters', () => {
    expect(() =>
      serializeReviewCarryForward({
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        reviewReportSha256: REVIEW_SHA,
        priorRound: 1,
        summary: 's',
        constraint: 'y'.repeat(201),
        priorAttempt: 1,
        priorValidationCommand: 'bun t',
      }),
    ).toThrow(/constraint exceeds 200 characters/)
  })

  test('rejects malformed reviewReportSha256', () => {
    expect(() =>
      serializeReviewCarryForward({
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        reviewReportSha256: 'not-hex',
        priorRound: 1,
        summary: 's',
        constraint: 'c',
        priorAttempt: 1,
        priorValidationCommand: 'bun t',
      }),
    ).toThrow(/reviewReportSha256 must be 64-char lower-case hex/)
  })

  test('200-char caps survive round-trip at the boundary', () => {
    const cf = serializeReviewCarryForward({
      reviewReportPath: '.code-oz/artifacts/REVIEW.md',
      reviewReportSha256: REVIEW_SHA,
      priorRound: 1,
      summary: 'x'.repeat(200),
      constraint: 'y'.repeat(200),
      priorAttempt: 1,
      priorValidationCommand: 'bun t',
    })
    const round = parseBuildReport(serializeBuildReport(dataWithCarryForward(cf)))
    expect(round.failureCarryForward?.priorFailureSummary.length).toBe(200)
    expect(round.failureCarryForward?.constraint.length).toBe(200)
  })
})
