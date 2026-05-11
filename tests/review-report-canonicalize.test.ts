// M9 commit 4: REVIEW.md canonicalizer + verdict authority tests.
//
// Covers:
//   - Fingerprint canonicalization: F-NEW placeholders get fresh F-NNN
//     ids; carried ids are preserved; matched-to-prior gets the prior id.
//   - Ping-pong reopen: re-raising a previously-resolved finding under
//     the same fingerprint reopens the original id (not a new id) and
//     resets roundResolved to 'unresolved'.
//   - Canonical verdict rule: any unresolved block → 'block'; else any
//     unresolved fix-first OR personaScore < 6 → 'needs-revision'; else
//     'ready'. The strict M9 commit 1 fix-first lock is enforced.
//   - Carried-over prior findings the persona did NOT mention this
//     round are preserved.
//   - Deterministic id ordering (numeric sort) on output.

import { describe, test, expect } from 'bun:test'
import {
  canonicalizeFindings,
  computeCanonicalVerdict,
  fingerprintFinding,
  F_NEW_PLACEHOLDER,
  type ReviewFinding,
} from '../src/artifacts/review-report.ts'

function f(overrides: Partial<ReviewFinding>): ReviewFinding {
  return Object.freeze({
    id: F_NEW_PLACEHOLDER,
    title: 'Stub finding',
    file: 'src/x.ts',
    line: '1',
    severity: 'nit' as const,
    recommendation: 'do something',
    roundRaised: 1,
    roundResolved: 'unresolved' as const,
    ...overrides,
  })
}

describe('fingerprintFinding — normalization', () => {
  test('lowercases title', () => {
    expect(fingerprintFinding('a.ts', 'Hello World')).toBe(
      fingerprintFinding('a.ts', 'hello world'),
    )
  })

  test('collapses whitespace', () => {
    expect(fingerprintFinding('a.ts', 'a   b\tc')).toBe(
      fingerprintFinding('a.ts', 'a b c'),
    )
  })

  test('drops trailing punctuation', () => {
    expect(fingerprintFinding('a.ts', 'Bug here.')).toBe(
      fingerprintFinding('a.ts', 'Bug here'),
    )
    expect(fingerprintFinding('a.ts', 'Bug here!?')).toBe(
      fingerprintFinding('a.ts', 'Bug here'),
    )
  })

  test('different files produce different fingerprints', () => {
    expect(fingerprintFinding('a.ts', 'x')).not.toBe(fingerprintFinding('b.ts', 'x'))
  })
})

describe('canonicalizeFindings — fresh draft (round 1)', () => {
  test('assigns F-001, F-002 in draft order when prior is empty', () => {
    const result = canonicalizeFindings({
      draftFindings: [
        f({ title: 'First', file: 'a.ts' }),
        f({ title: 'Second', file: 'b.ts' }),
      ],
      priorFindings: [],
      round: 1,
    })
    expect(result.findings.map((x) => x.id)).toEqual(['F-001', 'F-002'])
    expect(result.newIds).toEqual(['F-001', 'F-002'])
    expect(result.reopenedIds).toEqual([])
  })

  test('roundRaised is set to current round on fresh ids', () => {
    const result = canonicalizeFindings({
      draftFindings: [f({ title: 'x', file: 'a.ts', roundRaised: 99 })],
      priorFindings: [],
      round: 2,
    })
    expect(result.findings[0]?.roundRaised).toBe(2)
  })

  test('output is deterministic (sorted by numeric id)', () => {
    // Even if the persona drafts in reverse order, output is sorted.
    const result = canonicalizeFindings({
      draftFindings: [
        f({ id: F_NEW_PLACEHOLDER, title: 'A', file: 'a.ts' }),
        f({ id: F_NEW_PLACEHOLDER, title: 'B', file: 'b.ts' }),
      ],
      priorFindings: [],
      round: 1,
    })
    expect(result.findings.map((x) => x.id)).toEqual(['F-001', 'F-002'])
  })
})

describe('canonicalizeFindings — carrying ids across rounds', () => {
  test('preserves carried id when persona reuses it', () => {
    const prior = f({
      id: 'F-001',
      title: 'Bug A',
      file: 'a.ts',
      roundRaised: 1,
      roundResolved: 'unresolved',
    })
    const result = canonicalizeFindings({
      draftFindings: [
        f({
          id: 'F-001',
          title: 'Bug A',
          file: 'a.ts',
          roundRaised: 1,
          roundResolved: 2, // Now resolved.
        }),
      ],
      priorFindings: [prior],
      round: 2,
    })
    expect(result.findings[0]?.id).toBe('F-001')
    expect(result.findings[0]?.roundResolved).toBe(2)
    expect(result.newIds).toEqual([])
    expect(result.reopenedIds).toEqual([])
  })

  test('roundRaised is preserved from prior even if draft says otherwise', () => {
    const prior = f({
      id: 'F-001',
      title: 'Bug A',
      file: 'a.ts',
      roundRaised: 1,
      roundResolved: 'unresolved',
    })
    const result = canonicalizeFindings({
      draftFindings: [
        f({
          id: 'F-001',
          title: 'Bug A',
          file: 'a.ts',
          roundRaised: 99, // ignored
          roundResolved: 2,
        }),
      ],
      priorFindings: [prior],
      round: 2,
    })
    expect(result.findings[0]?.roundRaised).toBe(1)
  })

  test('carries forward prior findings the persona did NOT mention', () => {
    const prior1 = f({
      id: 'F-001',
      title: 'Bug A',
      file: 'a.ts',
      roundRaised: 1,
      roundResolved: 'unresolved',
    })
    const prior2 = f({
      id: 'F-002',
      title: 'Bug B',
      file: 'b.ts',
      roundRaised: 1,
      roundResolved: 'unresolved',
    })
    const result = canonicalizeFindings({
      draftFindings: [
        f({ id: 'F-001', title: 'Bug A', file: 'a.ts', roundRaised: 1, roundResolved: 2 }),
      ],
      priorFindings: [prior1, prior2],
      round: 2,
    })
    expect(result.findings.map((x) => x.id)).toEqual(['F-001', 'F-002'])
    expect(result.findings[1]).toEqual(prior2) // F-002 unchanged
  })

  test('next mint counter advances past max prior id', () => {
    const result = canonicalizeFindings({
      draftFindings: [
        f({ id: F_NEW_PLACEHOLDER, title: 'New finding', file: 'x.ts' }),
      ],
      priorFindings: [
        f({
          id: 'F-007',
          title: 'Old',
          file: 'a.ts',
          roundRaised: 1,
          roundResolved: 'unresolved',
        }),
      ],
      round: 2,
    })
    const newOne = result.findings.find((x) => x.title === 'New finding')
    expect(newOne?.id).toBe('F-008')
  })
})

describe('canonicalizeFindings — fingerprint match without reopen', () => {
  test('F-NEW with fingerprint matching unresolved prior reuses prior id', () => {
    // Persona forgets the id but re-raises the same finding.
    const prior = f({
      id: 'F-003',
      title: 'Hyphen edge case',
      file: 'src/scoring/syllable.ts',
      roundRaised: 1,
      roundResolved: 'unresolved',
    })
    const result = canonicalizeFindings({
      draftFindings: [
        f({
          id: F_NEW_PLACEHOLDER,
          title: 'hyphen edge case', // Fingerprint matches (case-insensitive).
          file: 'src/scoring/syllable.ts',
        }),
      ],
      priorFindings: [prior],
      round: 2,
    })
    expect(result.findings[0]?.id).toBe('F-003')
    expect(result.newIds).toEqual([])
    expect(result.reopenedIds).toEqual([]) // Was unresolved → not a reopen.
  })
})

describe('canonicalizeFindings — ping-pong reopen', () => {
  test('F-NEW matching prior-resolved finding reopens the original id', () => {
    const priorResolved = f({
      id: 'F-001',
      title: 'Hyphen edge case',
      file: 'src/scoring/syllable.ts',
      roundRaised: 1,
      roundResolved: 2, // Resolved in round 2.
    })
    const result = canonicalizeFindings({
      draftFindings: [
        f({
          id: F_NEW_PLACEHOLDER,
          title: 'Hyphen edge case', // Fingerprint matches.
          file: 'src/scoring/syllable.ts',
          severity: 'fix-first',
        }),
      ],
      priorFindings: [priorResolved],
      round: 3,
    })
    expect(result.findings[0]?.id).toBe('F-001')
    expect(result.findings[0]?.roundResolved).toBe('unresolved')
    expect(result.reopenedIds).toEqual(['F-001'])
    expect(result.newIds).toEqual([])
  })

  test('reopened finding keeps the original roundRaised', () => {
    const priorResolved = f({
      id: 'F-001',
      title: 'Bug',
      file: 'a.ts',
      roundRaised: 1, // raised in round 1
      roundResolved: 2,
    })
    const result = canonicalizeFindings({
      draftFindings: [f({ id: F_NEW_PLACEHOLDER, title: 'Bug', file: 'a.ts' })],
      priorFindings: [priorResolved],
      round: 3,
    })
    expect(result.findings[0]?.roundRaised).toBe(1) // not reset to 3
  })

  test('ping-pong distinguished from re-statement of unresolved finding', () => {
    // Two prior findings with the same fingerprint would collide; we
    // pin the test to a single fingerprint case: prior unresolved →
    // reuse id (not a reopen); prior resolved → reopen.
    const priorResolved = f({
      id: 'F-001',
      title: 'Same bug',
      file: 'a.ts',
      roundRaised: 1,
      roundResolved: 2,
    })
    const sameRound = canonicalizeFindings({
      draftFindings: [f({ id: F_NEW_PLACEHOLDER, title: 'Same bug', file: 'a.ts' })],
      priorFindings: [priorResolved],
      round: 3,
    })
    expect(sameRound.reopenedIds).toEqual(['F-001'])

    const priorUnresolved = f({
      id: 'F-002',
      title: 'Other bug',
      file: 'b.ts',
      roundRaised: 1,
      roundResolved: 'unresolved',
    })
    const restated = canonicalizeFindings({
      draftFindings: [f({ id: F_NEW_PLACEHOLDER, title: 'Other bug', file: 'b.ts' })],
      priorFindings: [priorUnresolved],
      round: 2,
    })
    expect(restated.reopenedIds).toEqual([])
  })
})

describe('canonicalizeFindings — B1-lite validationOutcome round-trip', () => {
  // Regression for the Codex P2 round-trip drop: the canonicalizer rebuilt
  // each output object explicitly and silently dropped the optional
  // `validationOutcome` advisory metadata field. A parse → canonicalize →
  // serialize → parse cycle stripped the field even when the persona
  // populated it.

  test('preserves validationOutcome on a fresh F-NEW draft', () => {
    const result = canonicalizeFindings({
      draftFindings: [
        f({
          title: 'has outcome',
          file: 'a.ts',
          validationOutcome: 'confirmed',
        }),
      ],
      priorFindings: [],
      round: 1,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.validationOutcome).toBe('confirmed')
  })

  test('preserves validationOutcome when the id carries across rounds', () => {
    const result = canonicalizeFindings({
      draftFindings: [
        f({
          id: 'F-001',
          title: 'x',
          file: 'a.ts',
          roundRaised: 1,
          roundResolved: 2,
          validationOutcome: 'disagreed',
        }),
      ],
      priorFindings: [
        f({
          id: 'F-001',
          title: 'x',
          file: 'a.ts',
          roundRaised: 1,
          roundResolved: 'unresolved',
        }),
      ],
      round: 2,
    })
    expect(result.findings[0]?.validationOutcome).toBe('disagreed')
  })

  test('omits validationOutcome when draft did not set it', () => {
    const result = canonicalizeFindings({
      draftFindings: [f({ title: 'no outcome', file: 'a.ts' })],
      priorFindings: [],
      round: 1,
    })
    // Field is absent (not undefined), preserving byte-for-byte
    // determinism with pre-B1-lite serialized REVIEW.md files.
    expect('validationOutcome' in result.findings[0]!).toBe(false)
  })
})

describe('canonicalizeFindings — error paths', () => {
  test('rejects duplicate ids in draft (after canonicalization)', () => {
    expect(() =>
      canonicalizeFindings({
        draftFindings: [
          f({ id: 'F-001', title: 'a', file: 'a.ts' }),
          f({ id: 'F-001', title: 'b', file: 'b.ts' }),
        ],
        priorFindings: [
          f({
            id: 'F-001',
            title: 'a',
            file: 'a.ts',
            roundRaised: 1,
            roundResolved: 'unresolved',
          }),
        ],
        round: 2,
      }),
    ).toThrow(/duplicate id/)
  })
})

describe('computeCanonicalVerdict — orchestrator-owned authority (decision 3)', () => {
  test('unresolved block → block (priority 1)', () => {
    const findings = [
      f({
        id: 'F-001',
        severity: 'block',
        roundResolved: 'unresolved',
        roundRaised: 1,
      }),
    ]
    expect(computeCanonicalVerdict(findings, 8)).toBe('block')
  })

  test('resolved block does not trigger block verdict', () => {
    const findings = [
      f({
        id: 'F-001',
        severity: 'block',
        roundResolved: 2,
        roundRaised: 1,
      }),
    ]
    expect(computeCanonicalVerdict(findings, 8)).toBe('ready')
  })

  test('unresolved fix-first → needs-revision (priority 2)', () => {
    const findings = [
      f({
        id: 'F-001',
        severity: 'fix-first',
        roundResolved: 'unresolved',
        roundRaised: 1,
      }),
    ]
    expect(computeCanonicalVerdict(findings, 9)).toBe('needs-revision')
  })

  test('resolved fix-first does NOT trigger needs-revision', () => {
    const findings = [
      f({
        id: 'F-001',
        severity: 'fix-first',
        roundResolved: 2,
        roundRaised: 1,
      }),
    ]
    expect(computeCanonicalVerdict(findings, 8)).toBe('ready')
  })

  test('score < 6 → needs-revision regardless of findings state', () => {
    expect(computeCanonicalVerdict([], 5)).toBe('needs-revision')
    expect(computeCanonicalVerdict([], 0)).toBe('needs-revision')
  })

  test('score = 6 with no unresolved blockers → ready (boundary)', () => {
    expect(computeCanonicalVerdict([], 6)).toBe('ready')
  })

  test('score = 10 + unresolved nit → ready (nits do not block)', () => {
    const findings = [
      f({ id: 'F-001', severity: 'nit', roundResolved: 'unresolved', roundRaised: 1 }),
      f({ id: 'F-002', severity: 'fyi', roundResolved: 'unresolved', roundRaised: 1 }),
    ]
    expect(computeCanonicalVerdict(findings, 10)).toBe('ready')
  })

  test('block takes priority over fix-first when both unresolved', () => {
    const findings = [
      f({
        id: 'F-001',
        severity: 'fix-first',
        roundResolved: 'unresolved',
        roundRaised: 1,
      }),
      f({
        id: 'F-002',
        severity: 'block',
        roundResolved: 'unresolved',
        roundRaised: 1,
      }),
    ]
    expect(computeCanonicalVerdict(findings, 9)).toBe('block')
  })
})
