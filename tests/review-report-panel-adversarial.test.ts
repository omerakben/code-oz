// Adversarial parser tests for parseReviewPanelReport (M14 fix-first F4).
//
// Codex M14 R1 finding #4: the parser must reject panel artifacts with
// authority-impact source inconsistency. Round-trip tests prove
// serializer + parser agree on honest data; these tests prove the
// parser rejects malicious or hand-edited artifacts that bypass the
// orchestrator.
//
// Strategy: build a canonical panel REVIEW.md, then mutate just the
// relevant bytes (using string replace on the serialized output) to
// produce a malformed-but-grammatically-valid artifact, and assert
// parseReviewPanelReport throws ReviewReportLoadError with the
// expected issue code.

import { describe, test, expect } from 'bun:test'
import {
  serializeReviewPanelReport,
  parseReviewPanelReport,
  ReviewReportLoadError,
  type ReviewReportPanelData,
  type ReviewPanelist,
  type ReviewSynthesizedFinding,
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

function finding(overrides: Partial<ReviewSynthesizedFinding> = {}): ReviewSynthesizedFinding {
  return Object.freeze({
    id: overrides.id ?? 'F-001',
    title: overrides.title ?? 'A finding',
    file: overrides.file ?? 'src/handler.ts',
    line: overrides.line ?? '42',
    severity: overrides.severity ?? 'fix-first',
    authorityImpact: overrides.authorityImpact ?? 'voter',
    sources: overrides.sources ?? Object.freeze(['reviewer-A']),
    recommendation: overrides.recommendation ?? 'Add explicit null guard',
    roundRaised: overrides.roundRaised ?? 1,
    roundResolved: overrides.roundResolved ?? 'unresolved',
  })
}

function makePanelData(
  overrides: Partial<ReviewReportPanelData> = {},
): ReviewReportPanelData {
  const reviewers: readonly ReviewPanelist[] = overrides.reviewers ?? [
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
    upstreamRefs: overrides.upstreamRefs ?? Object.freeze({
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
    synthesis: overrides.synthesis ?? Object.freeze({
      panelVerdict: 'ready',
      quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
      eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
      excludedReviewerIds: Object.freeze([]),
      excludedReasons: Object.freeze([]),
      uniqueFindingsByReviewer: Object.freeze({ 'reviewer-A': 1, 'reviewer-B': 1 }),
      sharedFindings: 0,
    }),
    roundTimeline: overrides.roundTimeline ?? Object.freeze([
      Object.freeze({
        round: 1,
        timestamp: '2026-05-03T01:23:45Z',
        findingsRaised: 0,
        panelVerdict: 'ready' as const,
      }),
    ]),
    findings: overrides.findings ?? Object.freeze([]),
    score: overrides.score ?? Object.freeze({
      roundCount: 1,
      finalScore: 'panel' as const,
      finalVerdict: 'ready' as const,
      exitReason: 'cross-family quorum reached AND no unresolved voter actionable findings',
    }),
    capStatus: overrides.capStatus ?? Object.freeze({
      cap: 4,
      roundsUsed: 1,
      capExhausted: false,
    }),
  })
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

function tryParse(md: string): unknown {
  try {
    parseReviewPanelReport(md)
    return null
  } catch (err) {
    return err
  }
}

describe('parseReviewPanelReport — F4 authority-impact source consistency', () => {
  test('voter source + advisory authorityImpact → review_artifact_authority_impact_inconsistent', () => {
    // reviewer-A is an eligible voter (codex family, voter role,
    // buildFamily=claude). A finding sourced from reviewer-A but
    // marked authorityImpact='advisory' must be rejected.
    const data = makePanelData({
      findings: Object.freeze([
        finding({
          id: 'F-001',
          severity: 'block',
          authorityImpact: 'advisory', // wrong: source is an eligible voter
          sources: Object.freeze(['reviewer-A']),
          // Unresolved voter-impact block would land us at panelVerdict=block,
          // but since authorityImpact is laundered to advisory, the parser
          // would otherwise let it through as 'ready'.
          roundResolved: 'unresolved',
        }),
      ]),
      synthesis: Object.freeze({
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
        excludedReviewerIds: Object.freeze([]),
        excludedReasons: Object.freeze([]),
        uniqueFindingsByReviewer: Object.freeze({ 'reviewer-A': 1, 'reviewer-B': 0 }),
        sharedFindings: 0,
      }),
    })
    const md = serializeReviewPanelReport(data)
    expectIssueCode(tryParse(md), 'review_artifact_authority_impact_inconsistent')
  })

  test('purely advisory source + voter authorityImpact → review_artifact_authority_impact_inconsistent', () => {
    // reviewer-C is an advisory (same-family); a finding sourced ONLY
    // from reviewer-C must NOT be marked authorityImpact='voter'.
    const reviewers: readonly ReviewPanelist[] = [
      panelist({ id: 'reviewer-A', providerId: 'codex', providerFamily: 'codex' }),
      panelist({
        id: 'reviewer-B',
        providerId: 'gemini',
        providerFamily: 'gemini',
        modelPolicy: 'gemini-2.5-pro',
        score: 7,
      }),
      panelist({
        id: 'reviewer-C',
        providerId: 'claude',
        providerFamily: 'claude', // same as buildFamily → not an eligible voter
        modelPolicy: 'claude-opus-4-7',
        role: 'advisory',
        crossFamilyCheck: 'same-family (advisory only)',
      }),
    ]
    const data = makePanelData({
      reviewers,
      findings: Object.freeze([
        finding({
          id: 'F-001',
          severity: 'fix-first',
          authorityImpact: 'voter', // wrong: advisory-only source
          sources: Object.freeze(['reviewer-C']),
          roundResolved: 1,
        }),
      ]),
      synthesis: Object.freeze({
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
        excludedReviewerIds: Object.freeze(['reviewer-C']),
        excludedReasons: Object.freeze([
          { id: 'reviewer-C', reason: 'same-family advisory has no gate authority' },
        ]),
        uniqueFindingsByReviewer: Object.freeze({
          'reviewer-A': 0,
          'reviewer-B': 0,
          'reviewer-C': 1,
        }),
        sharedFindings: 0,
      }),
    })
    const md = serializeReviewPanelReport(data)
    expectIssueCode(tryParse(md), 'review_artifact_authority_impact_inconsistent')
  })

  test('source id missing from Reviewers section → review_artifact_unknown_source_id', () => {
    const data = makePanelData({
      findings: Object.freeze([
        finding({
          id: 'F-001',
          authorityImpact: 'voter',
          sources: Object.freeze(['reviewer-Z']), // no such reviewer
          roundResolved: 1,
        }),
      ]),
      synthesis: Object.freeze({
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
        excludedReviewerIds: Object.freeze([]),
        excludedReasons: Object.freeze([]),
        uniqueFindingsByReviewer: Object.freeze({ 'reviewer-A': 0, 'reviewer-B': 0 }),
        sharedFindings: 0,
      }),
    })
    const md = serializeReviewPanelReport(data)
    expectIssueCode(tryParse(md), 'review_artifact_unknown_source_id')
  })

  test('mixed-source finding with at least one voter source → must be voter (allows valid case)', () => {
    // Sanity: a finding with sources including ONE voter and ONE advisory
    // must declare authorityImpact='voter'. This is the canonical
    // ratification case — the panel orchestrator builds it correctly.
    const reviewers: readonly ReviewPanelist[] = [
      panelist({ id: 'reviewer-A', providerId: 'codex', providerFamily: 'codex' }),
      panelist({
        id: 'reviewer-B',
        providerId: 'gemini',
        providerFamily: 'gemini',
        modelPolicy: 'gemini-2.5-pro',
        score: 7,
      }),
      panelist({
        id: 'reviewer-C',
        providerId: 'claude',
        providerFamily: 'claude',
        modelPolicy: 'claude-opus-4-7',
        role: 'advisory',
        crossFamilyCheck: 'same-family (advisory only)',
      }),
    ]
    const data = makePanelData({
      reviewers,
      findings: Object.freeze([
        finding({
          id: 'F-001',
          severity: 'fix-first',
          authorityImpact: 'voter',
          sources: Object.freeze(['reviewer-A', 'reviewer-C']), // voter + advisory
          roundResolved: 1,
        }),
      ]),
      synthesis: Object.freeze({
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
        excludedReviewerIds: Object.freeze(['reviewer-C']),
        excludedReasons: Object.freeze([
          { id: 'reviewer-C', reason: 'same-family advisory has no gate authority' },
        ]),
        uniqueFindingsByReviewer: Object.freeze({
          'reviewer-A': 0,
          'reviewer-B': 0,
          'reviewer-C': 0,
        }),
        sharedFindings: 1,
      }),
    })
    const md = serializeReviewPanelReport(data)
    // Should parse successfully (voter source forces authorityImpact='voter').
    expect(() => parseReviewPanelReport(md)).not.toThrow()
  })
})
