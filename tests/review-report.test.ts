// M9 commit 4: REVIEW.md parser + serializer tests.
//
// Covers: section discovery + canonical order, serialization
// determinism, round-trip equivalence, upstream-refs grammar, round
// timeline grammar (gaps + cap + score range + verdict enum), findings
// grammar (severity + line + path-validation + deleted-file rejected),
// score grammar (round-count alignment, final-score alignment,
// final-verdict alignment), cap-status grammar, fix-first locked rule
// (review_unresolved_blocker raised when ready exit + unresolved
// fix-first finding).

import { describe, test, expect } from 'bun:test'
import {
  parseReviewReport,
  serializeReviewReport,
  REVIEW_REPORT_TITLE,
  ReviewReportLoadError,
  type ReviewReportData,
} from '../src/artifacts/review-report.ts'

const SHA40 = '0123456789abcdef0123456789abcdef01234567'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)
const SHA64C = 'c'.repeat(64)

function validData(overrides: Partial<ReviewReportData> = {}): ReviewReportData {
  return Object.freeze({
    upstreamRefs: Object.freeze({
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256: SHA64A,
      verifyReportPath: '.code-oz/artifacts/VERIFY.md',
      verifyReportSha256: SHA64B,
      taskId: 'T-001',
      attempt: 1,
      baseCommitSha: SHA40,
      patchSha256: SHA64C,
    }),
    reviewer: Object.freeze({
      providerFamily: 'codex',
      providerId: 'codex',
      modelPolicy: '{ primary: gpt-5.5-xhigh, fallback: gpt-5.5 }',
      crossFamilyCheck: 'passed' as const,
      buildFamily: 'claude',
    }),
    roundTimeline: Object.freeze([
      Object.freeze({
        round: 1,
        timestamp: '2026-05-14T18:11:23Z',
        findingsRaised: 1,
        score: 7,
        verdict: 'ready' as const,
      }),
    ]),
    findings: Object.freeze([
      Object.freeze({
        id: 'F-001',
        title: 'Tighten guard for trailing whitespace',
        file: 'src/scoring/syllable.ts',
        line: '42-58',
        severity: 'nit' as const,
        recommendation: 'Trim before checking length.',
        roundRaised: 1,
        roundResolved: 'unresolved' as const,
      }),
    ]),
    score: Object.freeze({
      roundCount: 1,
      finalScore: 7,
      finalVerdict: 'ready' as const,
      exitReason: 'score >= 6 AND verdict = ready',
    }),
    capStatus: Object.freeze({
      cap: 4,
      roundsUsed: 1,
      capExhausted: false,
    }),
    ...overrides,
  })
}

describe('serializeReviewReport — deterministic output', () => {
  test('emits canonical sections in canonical order', () => {
    const text = serializeReviewReport(validData())
    expect(text.startsWith(REVIEW_REPORT_TITLE)).toBe(true)
    const headings = text.match(/^## .+$/gm) ?? []
    expect(headings).toEqual([
      '## Upstream refs',
      '## Reviewer',
      '## Round timeline',
      '## Findings',
      '## Score',
      '## Cap status',
    ])
  })

  test('same input produces same bytes (twice)', () => {
    const a = serializeReviewReport(validData())
    const b = serializeReviewReport(validData())
    expect(a).toBe(b)
  })

  test('emits `- None.` when findings is empty', () => {
    const data = validData({
      findings: Object.freeze([]),
      roundTimeline: Object.freeze([
        Object.freeze({
          round: 1,
          timestamp: '2026-05-14T18:11:23Z',
          findingsRaised: 0,
          score: 8,
          verdict: 'ready' as const,
        }),
      ]),
      score: Object.freeze({
        roundCount: 1,
        finalScore: 8,
        finalVerdict: 'ready' as const,
        exitReason: 'score >= 6 AND verdict = ready',
      }),
    })
    const text = serializeReviewReport(data)
    expect(text).toMatch(/## Findings\n\n- None\.\n/)
  })
})

describe('parseReviewReport — round-trip with serializer', () => {
  test('round-trips a minimal one-round-ready report', () => {
    const data = validData()
    const text = serializeReviewReport(data)
    const parsed = parseReviewReport(text)
    expect(parsed).toEqual(data)
  })

  test('round-trips a multi-round needs-revision report', () => {
    const data = validData({
      roundTimeline: Object.freeze([
        Object.freeze({
          round: 1,
          timestamp: '2026-05-14T18:11:23Z',
          findingsRaised: 2,
          score: 4,
          verdict: 'needs-revision' as const,
        }),
        Object.freeze({
          round: 2,
          timestamp: '2026-05-14T18:34:08Z',
          findingsRaised: 1,
          score: 8,
          verdict: 'ready' as const,
        }),
      ]),
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'Stress heuristic ignores hyphens',
          file: 'src/scoring/syllable.ts',
          line: '42-58',
          severity: 'fix-first' as const,
          recommendation: 'Split on hyphen first.',
          roundRaised: 1,
          roundResolved: 2,
        }),
        Object.freeze({
          id: 'F-002',
          title: 'Add Anderson fixture',
          file: 'tests/scoring-syllable.test.ts',
          line: '12-28',
          severity: 'nit' as const,
          recommendation: 'Add three-syllable case.',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
      score: Object.freeze({
        roundCount: 2,
        finalScore: 8,
        finalVerdict: 'ready' as const,
        exitReason: 'score >= 6 AND verdict = ready',
      }),
      capStatus: Object.freeze({
        cap: 4,
        roundsUsed: 2,
        capExhausted: false,
      }),
    })
    const text = serializeReviewReport(data)
    const parsed = parseReviewReport(text)
    expect(parsed).toEqual(data)
  })

  test('round-trips empty findings (None.)', () => {
    const data = validData({
      findings: Object.freeze([]),
      roundTimeline: Object.freeze([
        Object.freeze({
          round: 1,
          timestamp: '2026-05-14T18:11:23Z',
          findingsRaised: 0,
          score: 9,
          verdict: 'ready' as const,
        }),
      ]),
      score: Object.freeze({
        roundCount: 1,
        finalScore: 9,
        finalVerdict: 'ready' as const,
        exitReason: 'score >= 6 AND verdict = ready',
      }),
    })
    const text = serializeReviewReport(data)
    const parsed = parseReviewReport(text)
    expect(parsed).toEqual(data)
  })

  test('round-trips a cap-exhausted report (round 4 needs-revision)', () => {
    const data = validData({
      roundTimeline: Object.freeze(
        [1, 2, 3, 4].map((n) =>
          Object.freeze({
            round: n,
            timestamp: `2026-05-14T18:${String(10 + n).padStart(2, '0')}:00Z`,
            findingsRaised: 1,
            score: 5,
            verdict: 'needs-revision' as const,
          }),
        ),
      ),
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'Bug',
          file: 'src/scoring/syllable.ts',
          line: '42',
          severity: 'fix-first' as const,
          recommendation: 'Fix.',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
      score: Object.freeze({
        roundCount: 4,
        finalScore: 5,
        finalVerdict: 'needs-revision' as const,
        exitReason: 'cap exhausted (round 4 reached without ready)',
      }),
      capStatus: Object.freeze({
        cap: 4,
        roundsUsed: 4,
        capExhausted: true,
      }),
    })
    const text = serializeReviewReport(data)
    const parsed = parseReviewReport(text)
    expect(parsed).toEqual(data)
  })
})

describe('parseReviewReport — top-level errors', () => {
  test('rejects empty content', () => {
    expect(() => parseReviewReport('')).toThrow(ReviewReportLoadError)
  })

  test('rejects missing # REVIEW title', () => {
    expect(() =>
      parseReviewReport('## Upstream refs\n- nope\n', 'REVIEW.md'),
    ).toThrow(/title_missing/)
  })

  test('rejects missing required H2 sections', () => {
    expect(() =>
      parseReviewReport(
        `# REVIEW\n\n## Upstream refs\n\n- BUILD_REPORT.md: x.md (sha256: ${SHA64A})\n`,
      ),
    ).toThrow(ReviewReportLoadError)
  })

  test('rejects unknown H2 sections', () => {
    const data = validData()
    const text = serializeReviewReport(data) + '\n## Surprise\n\n- nope\n'
    try {
      parseReviewReport(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as ReviewReportLoadError
      expect(e.issues.some((i) => i.code === 'review_report_unknown_section')).toBe(true)
    }
  })
})

describe('Upstream refs grammar', () => {
  test('rejects malformed BUILD_REPORT.md ref (missing sha)', () => {
    const data = validData()
    const broken = serializeReviewReport(data).replace(
      `- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${SHA64A})`,
      `- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md`,
    )
    try {
      parseReviewReport(broken)
      throw new Error('expected throw')
    } catch (err) {
      expect((err as ReviewReportLoadError).issues[0]!.code).toBe(
        'review_upstream_refs_grammar',
      )
    }
  })

  test('rejects malformed VERIFY.md ref', () => {
    const data = validData()
    const broken = serializeReviewReport(data).replace(
      `- VERIFY.md: .code-oz/artifacts/VERIFY.md (sha256: ${SHA64B})`,
      `- VERIFY.md: short`,
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_upstream_refs_grammar/)
  })

  test('rejects bad task id format', () => {
    const data = validData({
      upstreamRefs: { ...validData().upstreamRefs, taskId: 'task-1' as unknown as string },
    })
    const text = serializeReviewReport(data)
    expect(() => parseReviewReport(text)).toThrow(/review_upstream_refs_grammar/)
  })

  test('rejects bad base commit sha (not 40 hex)', () => {
    const data = validData()
    const broken = serializeReviewReport(data).replace(SHA40, 'not-hex')
    expect(() => parseReviewReport(broken)).toThrow(/review_upstream_refs_grammar/)
  })
})

describe('Reviewer cross-family grammar', () => {
  test('rejects missing Cross-family check bullet', () => {
    const data = validData()
    const broken = serializeReviewReport(data).replace(
      /- Cross-family check:.*\n/,
      '',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_reviewer_missing/)
  })

  test('rejects same-family pair (cross-family invariant)', () => {
    const data = validData()
    const broken = serializeReviewReport(data).replace(
      'BUILD family: claude',
      'BUILD family: codex',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_cross_family_violation/)
  })

  test('rejects cross-check reviewer family mismatching Provider family', () => {
    const data = validData()
    const broken = serializeReviewReport(data).replace(
      'reviewer family: codex',
      'reviewer family: gemini',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_reviewer_grammar/)
  })

  test('rejects `failed` cross-family check value', () => {
    const data = validData()
    const broken = serializeReviewReport(data).replace(
      /Cross-family check: passed/,
      'Cross-family check: failed',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_reviewer_grammar/)
  })
})

describe('Round timeline grammar', () => {
  test('rejects round numbers with gaps (1, 3)', () => {
    const data = validData({
      roundTimeline: Object.freeze([
        Object.freeze({
          round: 1,
          timestamp: '2026-05-14T18:11:23Z',
          findingsRaised: 0,
          score: 5,
          verdict: 'needs-revision' as const,
        }),
        Object.freeze({
          round: 3,
          timestamp: '2026-05-14T18:34:08Z',
          findingsRaised: 0,
          score: 7,
          verdict: 'ready' as const,
        }),
      ]),
      score: Object.freeze({
        roundCount: 2,
        finalScore: 7,
        finalVerdict: 'ready' as const,
        exitReason: 'score >= 6 AND verdict = ready',
      }),
      capStatus: Object.freeze({ cap: 4, roundsUsed: 2, capExhausted: false }),
    })
    const text = serializeReviewReport(data)
    expect(() => parseReviewReport(text)).toThrow(/review_round_gap/)
  })

  test('rejects round 5 (exceeds CLAUDE.md rule 6 cap)', () => {
    // Build a malformed timeline by hand to exercise the cap check.
    const text = [
      '# REVIEW',
      '',
      '## Upstream refs',
      '',
      `- BUILD_REPORT.md: x.md (sha256: ${SHA64A})`,
      `- VERIFY.md: y.md (sha256: ${SHA64B})`,
      '- Task: T-001',
      '- Attempt: 1',
      `- Base commit: ${SHA40}`,
      `- Patch sha256: ${SHA64C}`,
      '',
      '## Reviewer',
      '',
      '- Provider family: codex',
      '- Provider id: codex',
      '- Model policy: any',
      '- Cross-family check: passed (BUILD family: claude; reviewer family: codex)',
      '',
      '## Round timeline',
      '',
      '- Round 1: 2026-05-14T18:00:00Z | findings raised: 0 | score: 5 | verdict: needs-revision',
      '- Round 2: 2026-05-14T18:00:00Z | findings raised: 0 | score: 5 | verdict: needs-revision',
      '- Round 3: 2026-05-14T18:00:00Z | findings raised: 0 | score: 5 | verdict: needs-revision',
      '- Round 4: 2026-05-14T18:00:00Z | findings raised: 0 | score: 5 | verdict: needs-revision',
      '- Round 5: 2026-05-14T18:00:00Z | findings raised: 0 | score: 5 | verdict: needs-revision',
      '',
      '## Findings',
      '',
      '- None.',
      '',
      '## Score',
      '',
      '- Round count: 5',
      '- Final score: 5',
      '- Final verdict: needs-revision',
      '- Exit reason: cap exhausted',
      '',
      '## Cap status',
      '',
      '- Cap: 4 rounds',
      '- Rounds used: 5',
      '- Cap exhausted: true',
      '',
    ].join('\n')
    expect(() => parseReviewReport(text)).toThrow(/review_round_grammar/)
  })

  test('rejects score outside [0, 10]', () => {
    const broken = serializeReviewReport(validData()).replace('score: 7', 'score: 11')
    expect(() => parseReviewReport(broken)).toThrow(/review_round_grammar/)
  })

  test('rejects unknown verdict value', () => {
    const broken = serializeReviewReport(validData()).replace(
      'verdict: ready',
      'verdict: maybe',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_round_grammar/)
  })

  test('rejects empty Round timeline', () => {
    const broken = serializeReviewReport(validData()).replace(
      /- Round 1:.*\n/,
      '',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_round_timeline_empty/)
  })
})

describe('Findings grammar', () => {
  test('rejects malformed F-NNN heading', () => {
    const broken = serializeReviewReport(validData()).replace(
      '### F-001:',
      '### F-1:',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_finding_grammar/)
  })

  test('rejects unknown severity', () => {
    const broken = serializeReviewReport(validData()).replace(
      '- Severity: nit',
      '- Severity: critical',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_severity_invalid/)
  })

  test('rejects malformed Line range (end < start)', () => {
    const broken = serializeReviewReport(validData()).replace(
      '- Line: 42-58',
      '- Line: 58-42',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_finding_grammar/)
  })

  test('rejects Round resolved < Round raised', () => {
    const broken = serializeReviewReport(
      validData({
        findings: Object.freeze([
          Object.freeze({
            id: 'F-001',
            title: 'x',
            file: 'src/scoring/syllable.ts',
            line: '42',
            severity: 'nit' as const,
            recommendation: 'fix',
            roundRaised: 2,
            roundResolved: 1, // Earlier than raised — invalid.
          }),
        ]),
        roundTimeline: Object.freeze([
          Object.freeze({
            round: 1,
            timestamp: '2026-05-14T18:11:23Z',
            findingsRaised: 0,
            score: 5,
            verdict: 'needs-revision' as const,
          }),
          Object.freeze({
            round: 2,
            timestamp: '2026-05-14T18:34:08Z',
            findingsRaised: 1,
            score: 8,
            verdict: 'ready' as const,
          }),
        ]),
        score: Object.freeze({
          roundCount: 2,
          finalScore: 8,
          finalVerdict: 'ready' as const,
          exitReason: 'score >= 6 AND verdict = ready',
        }),
        capStatus: Object.freeze({ cap: 4, roundsUsed: 2, capExhausted: false }),
      }),
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_finding_grammar/)
  })

  test('rejects path NOT in changed-file manifest (path-validation)', () => {
    const text = serializeReviewReport(validData())
    expect(() =>
      parseReviewReport(text, 'REVIEW.md', { changedFilePaths: ['some/other/file.ts'] }),
    ).toThrow(/review_finding_path_unknown/)
  })

  test('accepts paths IN the changed-file manifest', () => {
    const text = serializeReviewReport(validData())
    const data = parseReviewReport(text, 'REVIEW.md', {
      changedFilePaths: ['src/scoring/syllable.ts'],
    })
    expect(data.findings[0]?.file).toBe('src/scoring/syllable.ts')
  })

  test('rejects duplicate F-NNN ids', () => {
    const data = validData({
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'a',
          file: 'src/scoring/syllable.ts',
          line: '1',
          severity: 'nit' as const,
          recommendation: 'x',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
        Object.freeze({
          id: 'F-001',
          title: 'b',
          file: 'src/scoring/syllable.ts',
          line: '2',
          severity: 'nit' as const,
          recommendation: 'x',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
      roundTimeline: Object.freeze([
        Object.freeze({
          round: 1,
          timestamp: '2026-05-14T18:11:23Z',
          findingsRaised: 2,
          score: 7,
          verdict: 'ready' as const,
        }),
      ]),
    })
    const text = serializeReviewReport(data)
    expect(() => parseReviewReport(text)).toThrow(/review_finding_id_collision/)
  })

  test('rejects Round resolved > REVIEW_ROUND_CAP', () => {
    const broken = serializeReviewReport(
      validData({
        findings: Object.freeze([
          Object.freeze({
            id: 'F-001',
            title: 'x',
            file: 'src/scoring/syllable.ts',
            line: '42',
            severity: 'fix-first' as const,
            recommendation: 'fix',
            roundRaised: 1,
            roundResolved: 5 as unknown as number,
          }),
        ]),
      }),
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_finding_grammar/)
  })
})

describe('Score / Cap status cross-section invariants', () => {
  test('Round count must equal last timeline round', () => {
    const broken = serializeReviewReport(validData()).replace(
      '- Round count: 1',
      '- Round count: 2',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_score_round_count_mismatch/)
  })

  test('Final score must equal last timeline score', () => {
    const broken = serializeReviewReport(validData()).replace(
      '- Final score: 7',
      '- Final score: 8',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_score_final_score_mismatch/)
  })

  test('Final verdict must equal last timeline verdict', () => {
    const broken = serializeReviewReport(validData()).replace(
      '- Final verdict: ready',
      '- Final verdict: needs-revision',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_score_final_verdict_mismatch/)
  })

  test('Cap status.Rounds used must equal Score.Round count', () => {
    const broken = serializeReviewReport(validData()).replace(
      '- Rounds used: 1',
      '- Rounds used: 2',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_cap_status_mismatch/)
  })

  test('Cap status.Cap must be 4 (CLAUDE.md rule 6)', () => {
    const broken = serializeReviewReport(validData()).replace(
      '- Cap: 4 rounds',
      '- Cap: 6 rounds',
    )
    expect(() => parseReviewReport(broken)).toThrow(/review_cap_status_grammar/)
  })
})

describe('fix-first locked rule (M9 commit 1 strict)', () => {
  test('Final verdict: ready with unresolved fix-first → review_unresolved_blocker', () => {
    const data = validData({
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'x',
          file: 'src/scoring/syllable.ts',
          line: '42',
          severity: 'fix-first' as const,
          recommendation: 'fix',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
    })
    const text = serializeReviewReport(data)
    try {
      parseReviewReport(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as ReviewReportLoadError
      expect(e.issues.some((i) => i.code === 'review_unresolved_blocker')).toBe(true)
    }
  })

  test('Final verdict: ready with unresolved block → review_unresolved_blocker', () => {
    const data = validData({
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'x',
          file: 'src/scoring/syllable.ts',
          line: '42',
          severity: 'block' as const,
          recommendation: 'fix',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
    })
    const text = serializeReviewReport(data)
    expect(() => parseReviewReport(text)).toThrow(/review_unresolved_blocker/)
  })

  test('Final verdict: ready with unresolved nit is fine (nits are exempt)', () => {
    const data = validData({
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'x',
          file: 'src/scoring/syllable.ts',
          line: '42',
          severity: 'nit' as const,
          recommendation: 'fix',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
    })
    const text = serializeReviewReport(data)
    expect(() => parseReviewReport(text)).not.toThrow()
  })

  test('Final verdict: needs-revision with unresolved fix-first is fine', () => {
    const data = validData({
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'x',
          file: 'src/scoring/syllable.ts',
          line: '42',
          severity: 'fix-first' as const,
          recommendation: 'fix',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
      roundTimeline: Object.freeze([
        Object.freeze({
          round: 1,
          timestamp: '2026-05-14T18:11:23Z',
          findingsRaised: 1,
          score: 5,
          verdict: 'needs-revision' as const,
        }),
      ]),
      score: Object.freeze({
        roundCount: 1,
        finalScore: 5,
        finalVerdict: 'needs-revision' as const,
        exitReason: 'persona score < 6',
      }),
    })
    const text = serializeReviewReport(data)
    expect(() => parseReviewReport(text)).not.toThrow()
  })
})

describe('B1-lite advisory validation outcome (claude-code template borrow)', () => {
  test('serializer omits the bullet when validationOutcome is absent (back-compat)', () => {
    const text = serializeReviewReport(validData())
    expect(text).not.toMatch(/Validation outcome:/)
  })

  test('round-trips a finding with validationOutcome=confirmed', () => {
    const data = validData({
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'Tighten guard for trailing whitespace',
          file: 'src/scoring/syllable.ts',
          line: '42-58',
          severity: 'nit' as const,
          recommendation: 'Trim before checking length.',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
          validationOutcome: 'confirmed' as const,
        }),
      ]),
    })
    const text = serializeReviewReport(data)
    expect(text).toMatch(/- Validation outcome: confirmed\n/)
    const parsed = parseReviewReport(text)
    expect(parsed.findings[0]?.validationOutcome).toBe('confirmed')
    expect(parsed).toEqual(data)
  })

  test('parser rejects an invalid validationOutcome value', () => {
    const text = serializeReviewReport(validData()).replace(
      /- Round resolved: unresolved\n/,
      '- Round resolved: unresolved\n- Validation outcome: pending\n',
    )
    expect(() => parseReviewReport(text)).toThrow(ReviewReportLoadError)
  })

  test('parser accepts a finding without validationOutcome (no schema break)', () => {
    // The default validData() has no validationOutcome on its finding.
    const text = serializeReviewReport(validData())
    const parsed = parseReviewReport(text)
    expect(parsed.findings[0]?.validationOutcome).toBeUndefined()
  })
})
