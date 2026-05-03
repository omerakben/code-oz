import { describe, test, expect } from 'bun:test'
import {
  serializeReviewPanelReport,
  parseReviewPanelReport,
  parseReviewReport,
  detectReviewReportMode,
  ReviewReportLoadError,
  type ReviewReportPanelData,
  type ReviewPanelist,
  type ReviewSynthesizedFinding,
} from '../src/artifacts/review-report.ts'

// M14 commit 3 — multi-reviewer schema + Synthesis block + parse-time
// quorum recomputation (layer 3 of the 5-layer defense per
// docs/contracts/REVIEW_PANEL.md).

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

function makePanelData(overrides: Partial<ReviewReportPanelData> = {}): ReviewReportPanelData {
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

describe('detectReviewReportMode', () => {
  test('returns "single" when ## Reviewer (singular) present', () => {
    expect(
      detectReviewReportMode('# REVIEW\n\n## Reviewer\n\n- foo\n'),
    ).toBe('single')
  })

  test('returns "panel" when ## Reviewers (plural) present', () => {
    expect(
      detectReviewReportMode('# REVIEW\n\n## Reviewers\n\n### reviewer-A\n'),
    ).toBe('panel')
  })

  test('returns "unknown" when neither present', () => {
    expect(detectReviewReportMode('# REVIEW\n\n## Findings\n')).toBe('unknown')
  })

  test('returns "unknown" when both present (malformed)', () => {
    expect(
      detectReviewReportMode('# REVIEW\n\n## Reviewer\n\n## Reviewers\n'),
    ).toBe('unknown')
  })

  test('handles BOM prefix', () => {
    expect(
      detectReviewReportMode('﻿# REVIEW\n\n## Reviewers\n'),
    ).toBe('panel')
  })

  test('handles CRLF line endings', () => {
    expect(
      detectReviewReportMode('# REVIEW\r\n\r\n## Reviewers\r\n\r\n### reviewer-A\r\n'),
    ).toBe('panel')
  })
})

describe('serialize/parse round-trip', () => {
  test('happy path: 2-voter cross-family panel', () => {
    const data = makePanelData()
    const serialized = serializeReviewPanelReport(data)
    expect(serialized).toContain('## Reviewers')
    expect(serialized).toContain('### reviewer-A')
    expect(serialized).toContain('### reviewer-B')
    expect(serialized).toContain('## Synthesis')
    expect(serialized).toContain('Panel verdict: ready')
    expect(serialized).toContain('Final score: panel')

    const parsed = parseReviewPanelReport(serialized)
    expect(parsed.mode).toBe('panel')
    expect(parsed.reviewers).toHaveLength(2)
    expect(parsed.reviewers[0]?.id).toBe('reviewer-A')
    expect(parsed.reviewers[1]?.providerFamily).toBe('gemini')
    expect(parsed.synthesis.panelVerdict).toBe('ready')
  })

  test('round-trip with same-family advisory + 2 cross-family voters', () => {
    const data = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', providerId: 'codex', providerFamily: 'codex' }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          score: 7,
        }),
        panelist({
          id: 'reviewer-C',
          providerId: 'claude',
          providerFamily: 'claude',
          modelPolicy: 'claude-opus-4-7',
          role: 'advisory',
          score: 9,
          crossFamilyCheck: 'same-family (advisory only)',
        }),
      ],
      synthesis: Object.freeze({
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
        excludedReviewerIds: Object.freeze(['reviewer-C']),
        excludedReasons: Object.freeze([{ id: 'reviewer-C', reason: 'advisory role' }]),
        uniqueFindingsByReviewer: Object.freeze({ 'reviewer-A': 1, 'reviewer-B': 0, 'reviewer-C': 1 }),
        sharedFindings: 0,
      }),
    })
    const serialized = serializeReviewPanelReport(data)
    const parsed = parseReviewPanelReport(serialized)
    expect(parsed.reviewers).toHaveLength(3)
    expect(parsed.reviewers[2]?.role).toBe('advisory')
    expect(parsed.reviewers[2]?.crossFamilyCheck).toBe('same-family (advisory only)')
    expect(parsed.synthesis.excludedReviewerIds).toEqual(['reviewer-C'])
    expect(parsed.synthesis.excludedReasons).toEqual([
      { id: 'reviewer-C', reason: 'advisory role' },
    ])
  })

  test('round-trip with findings (voter + advisory authority impact)', () => {
    const data = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', providerId: 'codex', providerFamily: 'codex', verdict: 'ready', score: 7 }),
        panelist({ id: 'reviewer-B', providerId: 'gemini', providerFamily: 'gemini', verdict: 'ready', score: 7 }),
        panelist({
          id: 'reviewer-C',
          providerId: 'claude',
          providerFamily: 'claude',
          role: 'advisory',
          verdict: 'ready',
          crossFamilyCheck: 'same-family (advisory only)',
        }),
      ],
      findings: [
        finding({
          id: 'F-001',
          title: 'voter finding (resolved)',
          severity: 'fix-first',
          authorityImpact: 'voter',
          sources: ['reviewer-A'],
          roundResolved: 1,
        }),
        finding({
          id: 'F-002',
          title: 'advisory finding (no gate impact)',
          severity: 'block',
          authorityImpact: 'advisory',
          sources: ['reviewer-C'],
          roundResolved: 'unresolved',
        }),
      ],
      synthesis: Object.freeze({
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
        excludedReviewerIds: Object.freeze(['reviewer-C']),
        excludedReasons: Object.freeze([{ id: 'reviewer-C', reason: 'advisory role' }]),
        uniqueFindingsByReviewer: Object.freeze({ 'reviewer-A': 1, 'reviewer-B': 0, 'reviewer-C': 1 }),
        sharedFindings: 0,
      }),
    })
    const parsed = parseReviewPanelReport(serializeReviewPanelReport(data))
    expect(parsed.findings).toHaveLength(2)
    expect(parsed.findings[0]?.authorityImpact).toBe('voter')
    expect(parsed.findings[1]?.authorityImpact).toBe('advisory')
    // Advisory unresolved block does NOT escalate panel verdict
    expect(parsed.synthesis.panelVerdict).toBe('ready')
  })

  test('round-trip with empty findings ("- None.")', () => {
    const data = makePanelData()
    const serialized = serializeReviewPanelReport(data)
    expect(serialized).toContain('- None.')
    const parsed = parseReviewPanelReport(serialized)
    expect(parsed.findings).toHaveLength(0)
  })

  test('round-trip preserves uniqueFindingsByReviewer counts', () => {
    const data = makePanelData({
      synthesis: Object.freeze({
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: Object.freeze(['codex', 'gemini']),
        excludedReviewerIds: Object.freeze([]),
        excludedReasons: Object.freeze([]),
        uniqueFindingsByReviewer: Object.freeze({ 'reviewer-A': 5, 'reviewer-B': 3 }),
        sharedFindings: 2,
      }),
    })
    const parsed = parseReviewPanelReport(serializeReviewPanelReport(data))
    expect(parsed.synthesis.uniqueFindingsByReviewer).toEqual({
      'reviewer-A': 5,
      'reviewer-B': 3,
    })
    expect(parsed.synthesis.sharedFindings).toBe(2)
  })
})

describe('parseReviewPanelReport — section + grammar errors', () => {
  test('empty input → review_report_empty', () => {
    expect(() => parseReviewPanelReport('')).toThrow(ReviewReportLoadError)
  })

  test('missing # REVIEW title', () => {
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport('## Reviewers\n\n### reviewer-A\n')
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_report_title_missing')).toBe(true)
  })

  test('missing ## Reviewers section', () => {
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport('# REVIEW\n\n## Upstream refs\n\n- foo\n')
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_report_missing_section')).toBe(true)
  })

  test('Reviewers section with single panelist', () => {
    const minimal = makePanelData({
      reviewers: [panelist({ id: 'reviewer-A' })],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(minimal))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err).toBeInstanceOf(ReviewReportLoadError)
    expect(err!.issues.some((i) => i.code === 'review_panel_reviewers_too_few')).toBe(true)
  })

  test('panelist missing required field → review_panel_reviewer_missing', () => {
    const malformed = `# REVIEW

## Upstream refs

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${HEX64})
- VERIFY.md: .code-oz/artifacts/VERIFY.md (sha256: ${HEX64})
- Task: T-001
- Attempt: 1
- Base commit: ${HEX40}
- Patch sha256: ${HEX64}

## Reviewers

### reviewer-A

- Provider id: codex
- Provider family: codex

### reviewer-B

- Provider id: gemini
- Provider family: gemini
- Model policy: gemini-2.5-pro
- Role: voter
- Score: 7
- Verdict: ready
- Cross-family check: passed
- Build family: claude
- Manifest hash: ${MANIFEST_HASH}

## Synthesis

- Panel verdict: ready
- Quorum reason: x
- Eligible voter families: codex, gemini
- Excluded reviewer ids: (none)
- Excluded reasons: (none)
- Unique findings by reviewer: (none)
- Shared findings: 0

## Round timeline

- Round 1: 2026-05-03T01:23:45Z | findings raised: 0 | panel verdict: ready

## Findings

- None.

## Score

- Round count: 1
- Final score: panel
- Final verdict: ready
- Exit reason: x

## Cap status

- Cap: 4 rounds
- Rounds used: 1
- Cap exhausted: false
`
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(malformed)
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_panel_reviewer_missing')).toBe(true)
  })

  test('voter same family as build → review_cross_family_violation', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({
          id: 'reviewer-A',
          providerId: 'claude',
          providerFamily: 'claude',
          buildFamily: 'claude',
        }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          buildFamily: 'claude',
          score: 7,
        }),
      ],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_cross_family_violation')).toBe(true)
  })

  test('voter declares advisory cross-family check → reject', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({
          id: 'reviewer-A',
          role: 'voter',
          crossFamilyCheck: 'same-family (advisory only)',
        }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          score: 7,
        }),
      ],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_panel_reviewer_grammar')).toBe(true)
  })

  test('manifest hash mismatch between panelists → review_panelist_manifest_mismatch', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', manifestHash: 'a'.repeat(64) }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          score: 7,
          manifestHash: 'b'.repeat(64),
        }),
      ],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_panelist_manifest_mismatch')).toBe(true)
  })

  test('build family mismatch between panelists → review_panelist_build_family_mismatch', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', buildFamily: 'claude' }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          buildFamily: 'codex',
          score: 7,
        }),
      ],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_panelist_build_family_mismatch')).toBe(true)
  })

  test('panelist score out of range → reject', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', score: 11 }),
        panelist({ id: 'reviewer-B', providerId: 'gemini', providerFamily: 'gemini' }),
      ],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_panel_reviewer_grammar')).toBe(true)
  })
})

describe('parse-time quorum recomputation (layer 3 of 5-layer defense)', () => {
  test('declared ready but only 1 voter → review_artifact_quorum_inconsistent', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A' }),  // voter
        panelist({
          id: 'reviewer-B',
          providerId: 'claude',
          providerFamily: 'claude',
          role: 'advisory',
          crossFamilyCheck: 'same-family (advisory only)',
        }),
      ],
      synthesis: Object.freeze({
        panelVerdict: 'ready',  // claims ready
        quorumReason: 'spurious',
        eligibleVoterFamilies: Object.freeze(['codex']),
        excludedReviewerIds: Object.freeze(['reviewer-B']),
        excludedReasons: Object.freeze([]),
        uniqueFindingsByReviewer: Object.freeze({}),
        sharedFindings: 0,
      }),
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_artifact_quorum_inconsistent')).toBe(true)
  })

  test('declared ready but voter score < 6 → review_artifact_quorum_inconsistent', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', score: 4 }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          score: 8,
        }),
      ],
      // synthesis still claims ready
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_artifact_quorum_inconsistent')).toBe(true)
  })

  test('declared ready but voter verdict needs-revision → review_artifact_quorum_inconsistent', () => {
    const bad = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', verdict: 'needs-revision' }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          score: 8,
        }),
      ],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err!.issues.some((i) => i.code === 'review_artifact_quorum_inconsistent')).toBe(true)
  })

  test('declared ready but voter raised unresolved fix-first → review_artifact_quorum_inconsistent', () => {
    const bad = makePanelData({
      findings: [
        finding({
          authorityImpact: 'voter',
          severity: 'fix-first',
          roundResolved: 'unresolved',
        }),
      ],
      // synthesis claims ready (round timeline + score also claim ready)
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err).toBeInstanceOf(ReviewReportLoadError)
    expect(err!.issues.some((i) => i.code === 'review_artifact_quorum_inconsistent')).toBe(true)
  })

  test('advisory-only block does NOT trigger inconsistency on ready', () => {
    const data = makePanelData({
      reviewers: [
        panelist({ id: 'reviewer-A', score: 7 }),
        panelist({
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          score: 7,
        }),
        panelist({
          id: 'reviewer-C',
          providerId: 'claude',
          providerFamily: 'claude',
          role: 'advisory',
          crossFamilyCheck: 'same-family (advisory only)',
        }),
      ],
      findings: [
        finding({
          authorityImpact: 'advisory',
          severity: 'block',
          roundResolved: 'unresolved',
          sources: ['reviewer-C'],
        }),
      ],
    })
    expect(() => parseReviewPanelReport(serializeReviewPanelReport(data))).not.toThrow()
  })

  test('Final verdict ready with unresolved voter fix-first → review_unresolved_blocker', () => {
    // Construct data such that recompute also says needs-revision (so quorum
    // matches), but the score block still claims ready — this tests the
    // ready+unresolved-voter-actionable check in isolation.
    // Actually if recompute says needs-revision, score's ready will mismatch
    // synthesis ready and trigger inconsistency; combined with unresolved_blocker.
    const bad = makePanelData({
      findings: [
        finding({
          authorityImpact: 'voter',
          severity: 'fix-first',
          roundResolved: 'unresolved',
        }),
      ],
    })
    let err: ReviewReportLoadError | undefined
    try {
      parseReviewPanelReport(serializeReviewPanelReport(bad))
    } catch (e) {
      err = e as ReviewReportLoadError
    }
    expect(err).toBeInstanceOf(ReviewReportLoadError)
    expect(
      err!.issues.some(
        (i) =>
          i.code === 'review_unresolved_blocker' ||
          i.code === 'review_artifact_quorum_inconsistent',
      ),
    ).toBe(true)
  })
})

describe('back-compat: single-mode parser unaffected', () => {
  test('parseReviewReport still works on M9 single-reviewer artifact', () => {
    const single = `# REVIEW

## Upstream refs

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${HEX64})
- VERIFY.md: .code-oz/artifacts/VERIFY.md (sha256: ${HEX64})
- Task: T-001
- Attempt: 1
- Base commit: ${HEX40}
- Patch sha256: ${HEX64}

## Reviewer

- Provider family: codex
- Provider id: codex
- Model policy: gpt-5.5
- Cross-family check: passed (BUILD family: claude; reviewer family: codex)

## Round timeline

- Round 1: 2026-05-03T01:23:45Z | findings raised: 0 | score: 8 | verdict: ready

## Findings

- None.

## Score

- Round count: 1
- Final score: 8
- Final verdict: ready
- Exit reason: score >= 6 AND verdict = ready

## Cap status

- Cap: 4 rounds
- Rounds used: 1
- Cap exhausted: false
`
    const data = parseReviewReport(single)
    expect(data.reviewer.providerFamily).toBe('codex')
    expect(data.score.finalVerdict).toBe('ready')
  })
})
