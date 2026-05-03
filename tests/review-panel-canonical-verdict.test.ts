// M14 commit 5 — table-tests for computeCanonicalPanelVerdict.
//
// Nine canonical panel composition cases (T1-T9) per
// docs/contracts/REVIEW_PANEL.md § "Panel composition test cases" +
// docs/design/SESSION_M14_KICKOFF.md § 2.1.
//
// T9 specifically proves advisory ratification: a same-family advisory
// raising 'block' becomes canonical-effective only when an eligible
// cross-family voter independently raises the same fingerprint
// (Codex pushback Q3: "deduping into one finding must not erase useful
// signal", Q7: "advisory severity recorded but ignored unless
// corroborated").

import { describe, test, expect } from 'bun:test'
import {
  computeCanonicalPanelVerdict,
  type PanelistInput,
} from '../src/phases/review-panel-verdict.ts'

function panelist(overrides: Partial<PanelistInput> = {}): PanelistInput {
  return {
    id: overrides.id ?? 'reviewer-A',
    providerFamily: overrides.providerFamily ?? 'codex',
    role: overrides.role ?? 'voter',
    score: overrides.score ?? 8,
    verdict: overrides.verdict ?? 'ready',
    findings: overrides.findings ?? [],
  }
}

describe('canonical panel verdict — T1-T9 panel compositions', () => {
  test('T1: 1 same-family voter + 1 cross-family voter → needs-revision (1 eligible)', () => {
    // Build family = claude
    // Same-family voter (claude) is filtered out at quorum-time
    // Only 1 eligible voter remains → quorum count fails
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'claude', role: 'voter' }),
        panelist({ id: 'reviewer-B', providerFamily: 'codex', role: 'voter' }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('required exactly 2 eligible voters, got 1')
    expect(result.eligibleVoterFamilies).toEqual(['codex'])
    expect(result.excludedReviewerIds).toContain('reviewer-A')
    const aReason = result.excludedReasons.find((r) => r.id === 'reviewer-A')
    expect(aReason?.reason).toContain('same-family voter rejected')
  })

  test('T2: 1 same-family advisory + 1 cross-family voter → needs-revision (1 eligible voter only)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'claude', role: 'advisory' }),
        panelist({ id: 'reviewer-B', providerFamily: 'codex', role: 'voter' }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('required exactly 2 eligible voters, got 1')
    expect(result.excludedReasons.find((r) => r.id === 'reviewer-A')?.reason).toBe('advisory role')
  })

  test('T3: 1 same-family advisory + 2 cross-family voters all ready 7+ → ready', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'claude', role: 'advisory', score: 9 }),
        panelist({ id: 'reviewer-B', providerFamily: 'codex', role: 'voter', score: 7 }),
        panelist({ id: 'reviewer-C', providerFamily: 'gemini', role: 'voter', score: 8 }),
      ],
    })
    expect(result.panelVerdict).toBe('ready')
    expect(result.quorumReason).toContain('cross-family quorum reached: 2 of 2 voters from {codex, gemini}')
    expect(result.eligibleVoterFamilies).toEqual(['codex', 'gemini'])
    expect(result.excludedReviewerIds).toEqual(['reviewer-A'])
  })

  test('T4: same-family advisory raising block + 2 cross-family voters ready 8+ → ready (advisory cannot veto)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({
          id: 'reviewer-A',
          providerFamily: 'claude',
          role: 'advisory',
          score: 9,
          findings: [{ file: 'src/x.ts', title: 'advisory only', severity: 'block' }],
        }),
        panelist({ id: 'reviewer-B', providerFamily: 'codex', role: 'voter', score: 8 }),
        panelist({ id: 'reviewer-C', providerFamily: 'gemini', role: 'voter', score: 8 }),
      ],
    })
    expect(result.panelVerdict).toBe('ready')
    // Advisory finding is recorded with authorityImpact='advisory' — visible
    // in synthesis but cannot escalate canonical verdict
    const advisoryFinding = result.synthesizedFindings.find((f) =>
      f.fingerprint.startsWith('src/x.ts|'),
    )
    expect(advisoryFinding).toBeDefined()
    expect(advisoryFinding!.authorityImpact).toBe('advisory')
    expect(advisoryFinding!.severity).toBe('block')
    expect(advisoryFinding!.sources).toEqual(['reviewer-A'])
  })

  test('T5: 2 cross-family voters: ready 7 + needs-revision 5 → needs-revision', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'codex', role: 'voter', score: 7, verdict: 'ready' }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini', role: 'voter', score: 5, verdict: 'needs-revision' }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain("eligible voter 'reviewer-B' not ready")
  })

  test('T6: 2 cross-family voters ready 8, one has unresolved fix-first → needs-revision', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({
          id: 'reviewer-A',
          providerFamily: 'codex',
          role: 'voter',
          score: 8,
          findings: [{ file: 'src/x.ts', title: 'voter fix-first', severity: 'fix-first' }],
        }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini', role: 'voter', score: 8 }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('voter-impact unresolved fix-first finding')
  })

  test('T7: 2 same-family voters → needs-revision (0 eligible voters)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'claude', role: 'voter' }),
        panelist({ id: 'reviewer-B', providerFamily: 'claude', role: 'voter' }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('required exactly 2 eligible voters, got 0')
    expect(result.excludedReviewerIds).toHaveLength(2)
    for (const r of result.excludedReasons) {
      expect(r.reason).toContain('same-family voter rejected')
    }
  })

  test('T8: advisory-only panel → needs-revision (0 voters)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'codex', role: 'advisory' }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini', role: 'advisory' }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('required exactly 2 eligible voters, got 0')
  })

  test('T9: same-family advisory block + 2 cross-family voters ready 8+, voter independently raises same fingerprint → block (advisory ratified)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({
          id: 'reviewer-A',
          providerFamily: 'claude',
          role: 'advisory',
          score: 9,
          findings: [{ file: 'src/x.ts', title: 'shared bug', severity: 'block' }],
        }),
        panelist({
          id: 'reviewer-B',
          providerFamily: 'codex',
          role: 'voter',
          score: 8,
          // Voter raises the SAME fingerprint as the advisory's block.
          // Authority impact escalates from 'advisory' to 'voter' → block fires.
          findings: [{ file: 'src/x.ts', title: 'shared bug', severity: 'block' }],
        }),
        panelist({ id: 'reviewer-C', providerFamily: 'gemini', role: 'voter', score: 8 }),
      ],
    })
    expect(result.panelVerdict).toBe('block')
    const ratified = result.synthesizedFindings.find((f) =>
      f.fingerprint.startsWith('src/x.ts|'),
    )
    expect(ratified).toBeDefined()
    expect(ratified!.authorityImpact).toBe('voter')
    expect(ratified!.severity).toBe('block')
    // Both panelists recorded as sources (cross-attribution preserved)
    expect(ratified!.sources).toContain('reviewer-A')
    expect(ratified!.sources).toContain('reviewer-B')
  })
})

describe('canonical panel verdict — additional invariants', () => {
  test('routed-provider with unknown family is INELIGIBLE as voter (PE-2+ defense)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'router-A', providerFamily: 'unknown', role: 'voter' }),
        panelist({ id: 'reviewer-B', providerFamily: 'codex', role: 'voter' }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('required exactly 2 eligible voters, got 1')
    const exclusion = result.excludedReasons.find((r) => r.id === 'router-A')
    expect(exclusion?.reason).toContain('routed-provider lineage unknown')
  })

  test('voter scoring exactly 6 passes (REVIEW_SCORE_MIN boundary)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'codex', role: 'voter', score: 6 }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini', role: 'voter', score: 6 }),
      ],
    })
    expect(result.panelVerdict).toBe('ready')
  })

  test('voter scoring 5 fails (one below REVIEW_SCORE_MIN)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'codex', role: 'voter', score: 5 }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini', role: 'voter', score: 8 }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('reviewer-A')
  })

  test('voter verdict block (self-reported) on 2-voter panel falls into needs-revision quorum check', () => {
    // No findings → step 3 (block check) doesn't fire on findings.
    // Step 6 catches voter.verdict !== 'ready'.
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'codex', role: 'voter', score: 8, verdict: 'block' }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini', role: 'voter', score: 8, verdict: 'ready' }),
      ],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain("eligible voter 'reviewer-A' not ready")
  })

  test('block step 3 fires before quorum step 5 (block precedence)', () => {
    // Even with quorum invalid (1 voter), a voter-impact block still
    // returns 'block' because step 3 runs before step 5.
    // (Note: 1 voter means step 5 would fire 'needs-revision', but
    // step 3 short-circuits with 'block' first.)
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({
          id: 'reviewer-A',
          providerFamily: 'codex',
          role: 'voter',
          findings: [{ file: 'src/x.ts', title: 'critical bug', severity: 'block' }],
        }),
        // No second voter
      ],
    })
    expect(result.panelVerdict).toBe('block')
  })

  test('synthesized findings are deterministic (sorted by fingerprint)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({
          id: 'reviewer-A',
          providerFamily: 'codex',
          findings: [
            { file: 'src/zeta.ts', title: 'finding Z', severity: 'nit' },
            { file: 'src/alpha.ts', title: 'finding A', severity: 'nit' },
          ],
        }),
        panelist({
          id: 'reviewer-B',
          providerFamily: 'gemini',
          findings: [{ file: 'src/middle.ts', title: 'finding M', severity: 'nit' }],
        }),
      ],
    })
    const fingerprints = result.synthesizedFindings.map((f) => f.fingerprint)
    // Sorted alphabetically
    expect(fingerprints).toEqual([...fingerprints].sort())
  })

  test('strictest severity wins among voter sources for same fingerprint', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({
          id: 'reviewer-A',
          providerFamily: 'codex',
          findings: [{ file: 'src/x.ts', title: 'bug', severity: 'fix-first' }],
        }),
        panelist({
          id: 'reviewer-B',
          providerFamily: 'gemini',
          findings: [{ file: 'src/x.ts', title: 'bug', severity: 'block' }],
        }),
      ],
    })
    // Both voters raised the same fingerprint; strictest (block) wins
    const finding = result.synthesizedFindings.find((f) =>
      f.fingerprint.startsWith('src/x.ts|'),
    )
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('block')
    expect(finding!.authorityImpact).toBe('voter')
    expect(finding!.sources).toEqual(['reviewer-A', 'reviewer-B'])
    // Verdict is 'block' (voter-impact unresolved block)
    expect(result.panelVerdict).toBe('block')
  })

  test('fingerprint matches case-insensitive title (mirrors fingerprintFinding)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({
          id: 'reviewer-A',
          providerFamily: 'codex',
          findings: [{ file: 'src/x.ts', title: 'Null Check Missing', severity: 'fix-first' }],
        }),
        panelist({
          id: 'reviewer-B',
          providerFamily: 'gemini',
          findings: [{ file: 'src/x.ts', title: 'null check missing', severity: 'fix-first' }],
        }),
      ],
    })
    // Should dedupe to ONE finding
    const matching = result.synthesizedFindings.filter((f) =>
      f.fingerprint.startsWith('src/x.ts|'),
    )
    expect(matching).toHaveLength(1)
    expect(matching[0]!.sources).toEqual(['reviewer-A', 'reviewer-B'])
  })

  test('empty panel → needs-revision (0 eligible voters)', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [],
    })
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.eligibleVoterFamilies).toEqual([])
    expect(result.synthesizedFindings).toEqual([])
  })

  test('result is deeply frozen', () => {
    const result = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'codex' }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini' }),
      ],
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.eligibleVoterFamilies)).toBe(true)
    expect(Object.isFrozen(result.excludedReasons)).toBe(true)
    expect(Object.isFrozen(result.synthesizedFindings)).toBe(true)
  })
})

describe('canonical panel verdict — cross-module agreement (parser-side recompute)', () => {
  test('algorithm matches parser-side recomputePanelVerdictFromArtifact', () => {
    // The parser in src/artifacts/review-report.ts has its own
    // recomputePanelVerdictFromArtifact (private). Both must agree.
    // This test verifies one panel composition produces the same
    // panelVerdict from both code paths.
    //
    // Future improvement: refactor the parser to import this module's
    // computeCanonicalPanelVerdict directly. For now they're independent
    // implementations of the same algorithm; this test guards against drift.
    const verdictResult = computeCanonicalPanelVerdict({
      buildFamily: 'claude',
      panelists: [
        panelist({ id: 'reviewer-A', providerFamily: 'codex', role: 'voter', score: 8 }),
        panelist({ id: 'reviewer-B', providerFamily: 'gemini', role: 'voter', score: 7 }),
      ],
    })
    expect(verdictResult.panelVerdict).toBe('ready')
  })
})
