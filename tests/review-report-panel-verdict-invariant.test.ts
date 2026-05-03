// Adversarial parser tests for parseReviewPanelReport (M14 fix-first F5).
//
// Codex M14 R1 finding #5: the parser must reject panel artifacts where
// Synthesis.Panel verdict, Score.Final verdict, and the last Round
// timeline entry's panel verdict do not all agree. Pre-F5, the parser
// compared recomputed verdict only against Synthesis.Panel verdict and
// Score.Final verdict only against the last timeline entry — leaving
// the synthesis ↔ timeline edge unchecked.

import { describe, test, expect } from 'bun:test'
import {
  serializeReviewPanelReport,
  parseReviewPanelReport,
  ReviewReportLoadError,
  type ReviewReportPanelData,
  type ReviewPanelist,
} from '../src/artifacts/review-report.ts'

const HEX64 = '0'.repeat(64)
const HEX40 = '0'.repeat(40)
const MANIFEST_HASH = 'a'.repeat(64)

function panelist(overrides: Partial<ReviewPanelist> = {}): ReviewPanelist {
  return Object.freeze({
    id: overrides.id ?? 'reviewer-A',
    providerId: overrides.providerId ?? 'codex',
    providerFamily: overrides.providerFamily ?? 'codex',
    modelPolicy: overrides.modelPolicy ?? 'gpt-5.5',
    role: overrides.role ?? 'voter',
    score: overrides.score ?? 8,
    verdict: overrides.verdict ?? 'ready',
    crossFamilyCheck: overrides.crossFamilyCheck ?? 'passed',
    buildFamily: overrides.buildFamily ?? 'claude',
    manifestHash: overrides.manifestHash ?? MANIFEST_HASH,
  })
}

function makePanelData(): ReviewReportPanelData {
  const reviewers: readonly ReviewPanelist[] = [
    panelist({ id: 'reviewer-A', providerId: 'codex', providerFamily: 'codex' }),
    panelist({
      id: 'reviewer-B',
      providerId: 'gemini',
      providerFamily: 'gemini',
      modelPolicy: 'gemini-2.5-pro',
      score: 7,
    }),
  ]
  return Object.freeze({
    mode: 'panel' as const,
    upstreamRefs: Object.freeze({
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256: HEX64,
      verifyReportPath: '.code-oz/artifacts/VERIFY.md',
      verifyReportSha256: HEX64,
      taskId: 'T-001',
      attempt: 1,
      baseCommitSha: HEX40,
      patchSha256: HEX64,
    }),
    reviewers,
    synthesis: Object.freeze({
      panelVerdict: 'ready' as const,
      quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
      eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
      excludedReviewerIds: Object.freeze([]),
      excludedReasons: Object.freeze([]),
      uniqueFindingsByReviewer: Object.freeze({ 'reviewer-A': 1, 'reviewer-B': 1 }),
      sharedFindings: 0,
    }),
    roundTimeline: Object.freeze([
      Object.freeze({
        round: 1,
        timestamp: '2026-05-03T01:23:45Z',
        findingsRaised: 0,
        panelVerdict: 'ready' as const,
      }),
    ]),
    findings: Object.freeze([]),
    score: Object.freeze({
      roundCount: 1,
      finalScore: 'panel' as const,
      finalVerdict: 'ready' as const,
      exitReason: 'cross-family quorum reached AND no unresolved voter actionable findings',
    }),
    capStatus: Object.freeze({
      cap: 4,
      roundsUsed: 1,
      capExhausted: false,
    }),
  })
}

function tryParse(md: string): unknown {
  try {
    parseReviewPanelReport(md)
    return null
  } catch (err) {
    return err
  }
}

function expectIssueCode(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(ReviewReportLoadError)
  if (!(err instanceof ReviewReportLoadError)) return
  const codes = err.issues.map((i) => i.code)
  if (!codes.includes(code)) {
    throw new Error(
      `expected issue code '${code}' in load issues, got: ${codes.join(', ')}`,
    )
  }
}

describe('parseReviewPanelReport — F5 cross-section verdict invariant', () => {
  test('synthesis verdict diverges from timeline last entry → review_artifact_verdict_field_inconsistent', () => {
    // Build a canonical artifact, then string-replace the timeline
    // entry's verdict to disagree with synthesis. The orchestrator
    // never produces this state but a hand-edited or buggy non-Codex
    // serializer could.
    const data = makePanelData()
    const md = serializeReviewPanelReport(data)
    // Round timeline bullet shape:
    //   - Round 1 (...) — findings raised: 0; panel verdict: ready
    // Replace timeline panel verdict only — synthesis stays 'ready'.
    const mutated = md.replace(
      /(- Round 1[^\n]*panel verdict: )ready/,
      '$1needs-revision',
    )
    expect(mutated).not.toBe(md)
    expectIssueCode(tryParse(mutated), 'review_artifact_verdict_field_inconsistent')
  })

  test('canonical panel artifact passes F5 cleanly', () => {
    const data = makePanelData()
    const md = serializeReviewPanelReport(data)
    expect(() => parseReviewPanelReport(md)).not.toThrow()
  })

  test('score finalVerdict diverges from timeline → existing review_score_final_verdict_mismatch (regression)', () => {
    // F5 generalizes the existing single-axis check. Make sure we did
    // not regress the timeline-vs-score invariant when adding the
    // synthesis-vs-timeline invariant.
    const data = makePanelData()
    const md = serializeReviewPanelReport(data)
    const mutated = md.replace(
      /(- Final verdict: )ready/,
      '$1needs-revision',
    )
    expect(mutated).not.toBe(md)
    const err = tryParse(mutated)
    expect(err).toBeInstanceOf(ReviewReportLoadError)
    if (!(err instanceof ReviewReportLoadError)) return
    const codes = err.issues.map((i) => i.code)
    // At least one of the two related checks must fire (score-vs-timeline
    // or synthesis-vs-recomputed).
    expect(
      codes.includes('review_score_final_verdict_mismatch') ||
        codes.includes('review_artifact_quorum_inconsistent'),
    ).toBe(true)
  })

  test('synthesis verdict diverges from score (transitivity check)', () => {
    // If synthesis disagrees with score, by transitivity it must also
    // disagree with timeline (since score must agree with timeline by
    // the existing invariant). Confirm at least one of the verdict
    // invariants fires.
    const data = makePanelData()
    const md = serializeReviewPanelReport(data)
    // Mutate ONLY the Synthesis section's panel verdict line.
    const mutated = md.replace(
      /(## Synthesis[\s\S]*?- Panel verdict: )ready/,
      '$1needs-revision',
    )
    expect(mutated).not.toBe(md)
    const err = tryParse(mutated)
    expect(err).toBeInstanceOf(ReviewReportLoadError)
    if (!(err instanceof ReviewReportLoadError)) return
    const codes = err.issues.map((i) => i.code)
    expect(
      codes.includes('review_artifact_verdict_field_inconsistent') ||
        codes.includes('review_artifact_quorum_inconsistent'),
    ).toBe(true)
  })
})
