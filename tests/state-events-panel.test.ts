// M14 commit 4: panel event taxonomy validators.
//
// Six new event types per docs/contracts/REVIEW_PANEL.md § "Event types
// emitted":
//   - review_panel_started
//   - review_panelist_completed
//   - review_panel_disagreement
//   - panel_quorum_rejected_same_family_vote
//   - review_panel_completed (with layer-5 backstop: ready requires exactly 2
//     eligible voter families)
//   - review_panel_baseline_completed (rule-21 ship-gate metric event)
//
// No `panel_cost_warn` event — M13's `budget_warning` is reused for panel
// aggregate cost warnings (per Codex pushback Q6).

import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-03T01:23:45.000Z'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)

describe('review_panel_started — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_panel_started',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'panel-orchestrator',
      attempt: 1,
      taskId: 'T-001',
      panelComposition: [
        { id: 'reviewer-A', providerId: 'codex', providerFamily: 'codex', role: 'voter' },
        { id: 'reviewer-B', providerId: 'gemini', providerFamily: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects panel with < 2 entries', () => {
    const issue = validateEvent(
      valid({ panelComposition: [{ id: 'r-A', providerId: 'codex', providerFamily: 'codex', role: 'voter' }] }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('at least 2 entries')
  })

  test('rejects panel with !== 2 voters (3 voters)', () => {
    const issue = validateEvent(
      valid({
        panelComposition: [
          { id: 'r-A', providerId: 'codex', providerFamily: 'codex', role: 'voter' },
          { id: 'r-B', providerId: 'gemini', providerFamily: 'gemini', role: 'voter' },
          { id: 'r-C', providerId: 'xai', providerFamily: 'xai', role: 'voter' },
        ],
      }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('exactly 2 voter')
  })

  test('rejects panel with 0 voters (advisory only)', () => {
    const issue = validateEvent(
      valid({
        panelComposition: [
          { id: 'r-A', providerId: 'codex', providerFamily: 'codex', role: 'advisory' },
          { id: 'r-B', providerId: 'gemini', providerFamily: 'gemini', role: 'advisory' },
        ],
      }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('exactly 2 voter')
  })

  test('panel of 2 voters + advisory passes', () => {
    expect(
      validateEvent(
        valid({
          panelComposition: [
            { id: 'r-A', providerId: 'codex', providerFamily: 'codex', role: 'voter' },
            { id: 'r-B', providerId: 'gemini', providerFamily: 'gemini', role: 'voter' },
            { id: 'r-C', providerId: 'claude', providerFamily: 'claude', role: 'advisory' },
          ],
        }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects invalid panelist role', () => {
    const issue = validateEvent(
      valid({
        panelComposition: [
          { id: 'r-A', providerId: 'codex', providerFamily: 'codex', role: 'judge' },
          { id: 'r-B', providerId: 'gemini', providerFamily: 'gemini', role: 'voter' },
        ],
      }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('panelComposition[0].role')
  })

  test('rejects panelist missing required field', () => {
    const issue = validateEvent(
      valid({
        panelComposition: [
          { id: 'r-A', providerId: 'codex', role: 'voter' },  // missing providerFamily
          { id: 'r-B', providerId: 'gemini', providerFamily: 'gemini', role: 'voter' },
        ],
      }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('panelComposition[0].providerFamily')
  })

  test('rejects empty buildFamily', () => {
    expect(validateEvent(valid({ buildFamily: '' }), 'events.jsonl')?.rule).toContain(
      'review_panel_started.buildFamily',
    )
  })
})

describe('review_panelist_completed — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_panelist_completed',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'panel-orchestrator',
      attempt: 1,
      taskId: 'T-001',
      round: 1,
      panelistId: 'reviewer-A',
      providerId: 'codex',
      providerFamily: 'codex',
      modelPolicy: 'gpt-5.5',
      role: 'voter',
      score: 8,
      verdict: 'ready',
      manifestHash: SHA64A,
      stagingPath: 'state/review-panel/round-1/panelist-reviewer-A.md',
      stagingSha256: SHA64B,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('rejects round > 4', () => {
    expect(validateEvent(valid({ round: 5 }), 'events.jsonl')?.rule).toContain('round must be an integer in [1, 4]')
  })

  test('rejects score > 10', () => {
    expect(validateEvent(valid({ score: 11 }), 'events.jsonl')?.rule).toContain('score must be an integer in')
  })

  test('rejects invalid verdict', () => {
    expect(
      validateEvent(valid({ verdict: 'maybe' }), 'events.jsonl')?.rule,
    ).toContain('review_panelist_completed.verdict')
  })

  test('rejects malformed manifestHash', () => {
    expect(
      validateEvent(valid({ manifestHash: 'short' }), 'events.jsonl')?.rule,
    ).toContain('review_panelist_completed.manifestHash')
  })

  test('rejects malformed stagingSha256', () => {
    expect(
      validateEvent(valid({ stagingSha256: 'short' }), 'events.jsonl')?.rule,
    ).toContain('review_panelist_completed.stagingSha256')
  })

  test('rejects empty stagingPath', () => {
    expect(validateEvent(valid({ stagingPath: '' }), 'events.jsonl')?.rule).toContain(
      'review_panelist_completed.stagingPath',
    )
  })

  test('advisory role passes', () => {
    expect(validateEvent(valid({ role: 'advisory' }), 'events.jsonl')).toBeNull()
  })
})

describe('review_panel_disagreement — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_panel_disagreement',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'panel-orchestrator',
      attempt: 1,
      taskId: 'T-001',
      round: 1,
      fingerprint: 'src/handler.ts|null check',
      kind: 'severity',
      reviewerIds: ['reviewer-A', 'reviewer-B'],
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('all 4 kinds accepted', () => {
    for (const k of ['severity', 'verdict', 'presence', 'advisory_unratified']) {
      expect(validateEvent(valid({ kind: k }), 'events.jsonl')).toBeNull()
    }
  })

  test('rejects unknown kind', () => {
    expect(validateEvent(valid({ kind: 'flavor' }), 'events.jsonl')?.rule).toContain(
      'review_panel_disagreement.kind',
    )
  })

  test('rejects empty reviewerIds', () => {
    expect(
      validateEvent(valid({ reviewerIds: [] }), 'events.jsonl')?.rule,
    ).toContain('reviewerIds must be a non-empty array')
  })

  test('rejects empty fingerprint', () => {
    expect(validateEvent(valid({ fingerprint: '' }), 'events.jsonl')?.rule).toContain(
      'review_panel_disagreement.fingerprint',
    )
  })
})

describe('panel_quorum_rejected_same_family_vote — validator', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'panel_quorum_rejected_same_family_vote',
      ts: TS,
      runId: RUN,
      panelistId: 'reviewer-A',
      providerId: 'claude',
      providerFamily: 'claude',
      buildFamily: 'claude',
      layer: 'config-load',
      ...overrides,
    }
  }

  test('valid event passes (no phase — config-load layer fires before phase entry)', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('valid event passes with phase set (later layers)', () => {
    expect(validateEvent(valid({ phase: 'review', layer: 'quorum-time' }), 'events.jsonl')).toBeNull()
  })

  test('rejects when providerFamily !== buildFamily (event semantics violated)', () => {
    expect(
      validateEvent(valid({ providerFamily: 'codex' }), 'events.jsonl')?.rule,
    ).toContain('providerFamily === buildFamily')
  })

  test('all 4 layers accepted', () => {
    for (const l of ['config-load', 'runtime-registry', 'artifact-parse', 'quorum-time']) {
      expect(validateEvent(valid({ layer: l }), 'events.jsonl')).toBeNull()
    }
  })

  test('rejects unknown layer', () => {
    expect(
      validateEvent(valid({ layer: 'cosmic-ray' }), 'events.jsonl')?.rule,
    ).toContain('layer')
  })
})

describe('review_panel_completed — validator + layer-5 backstop', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_panel_completed',
      ts: TS,
      runId: RUN,
      phase: 'review',
      agent: 'panel-orchestrator',
      attempt: 1,
      taskId: 'T-001',
      finalRound: 1,
      panelVerdict: 'ready',
      reviewReportSha256: SHA64A,
      eligibleVoterFamilies: ['codex', 'gemini'],
      panelistCount: 2,
      voterCount: 2,
      advisoryCount: 0,
      ...overrides,
    }
  }

  test('valid ready event passes (eligibleVoterFamilies count = 2)', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('LAYER 5: rejects ready with 1 eligible voter family', () => {
    const issue = validateEvent(
      valid({ eligibleVoterFamilies: ['codex'] }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('exactly 2 eligibleVoterFamilies')
    expect(issue?.rule).toContain('layer-5')
  })

  test('LAYER 5: rejects ready with 3 eligible voter families', () => {
    const issue = validateEvent(
      valid({ eligibleVoterFamilies: ['codex', 'gemini', 'xai'] }),
      'events.jsonl',
    )
    expect(issue?.rule).toContain('exactly 2 eligibleVoterFamilies')
  })

  test('LAYER 5: rejects ready with 0 eligible voter families', () => {
    expect(
      validateEvent(valid({ eligibleVoterFamilies: [] }), 'events.jsonl')?.rule,
    ).toContain('exactly 2 eligibleVoterFamilies')
  })

  test('needs-revision with 1 eligible voter family is allowed (not a ready claim)', () => {
    expect(
      validateEvent(
        valid({ panelVerdict: 'needs-revision', eligibleVoterFamilies: ['codex'] }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('block with 0 eligible voter families is allowed', () => {
    expect(
      validateEvent(
        valid({ panelVerdict: 'block', eligibleVoterFamilies: [] }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects invalid panelVerdict', () => {
    expect(validateEvent(valid({ panelVerdict: 'maybe' }), 'events.jsonl')?.rule).toContain(
      'review_panel_completed.panelVerdict',
    )
  })

  test('rejects malformed reviewReportSha256', () => {
    expect(
      validateEvent(valid({ reviewReportSha256: 'short' }), 'events.jsonl')?.rule,
    ).toContain('review_panel_completed.reviewReportSha256')
  })
})

describe('review_panel_baseline_completed — validator (rule-21 metric event)', () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'review_panel_baseline_completed',
      ts: TS,
      runId: RUN,
      fixtureId: 'tests/fixtures/review-panel-baseline',
      singleRunId: 'single-run-001',
      panelRunId: 'panel-run-001',
      singleFindingCount: 2,
      panelFindingCount: 5,
      panelOnlyFindingCount: 3,
      panelOnlyActionableFindingCount: 1,
      disagreementCount: 1,
      sameFamilyVoteRejectionCount: 1,
      manifestEqualityHeld: true,
      singleReviewArtifactHash: SHA64A,
      panelReviewArtifactHash: SHA64B,
      costOverheadRatio: 2.0,
      wallClockOverheadMs: 150,
      ...overrides,
    }
  }

  test('valid event passes', () => {
    expect(validateEvent(valid(), 'events.jsonl')).toBeNull()
  })

  test('valid event with optional expectedFindingRecallDelta passes', () => {
    expect(
      validateEvent(valid({ expectedFindingRecallDelta: 0.4 }), 'events.jsonl'),
    ).toBeNull()
  })

  test('rejects empty fixtureId', () => {
    expect(validateEvent(valid({ fixtureId: '' }), 'events.jsonl')?.rule).toContain('fixtureId')
  })

  test('rejects negative count', () => {
    expect(
      validateEvent(valid({ panelOnlyFindingCount: -1 }), 'events.jsonl')?.rule,
    ).toContain('panelOnlyFindingCount')
  })

  test('rejects non-boolean manifestEqualityHeld', () => {
    expect(
      validateEvent(valid({ manifestEqualityHeld: 'yes' }), 'events.jsonl')?.rule,
    ).toContain('manifestEqualityHeld')
  })

  test('rejects negative costOverheadRatio', () => {
    expect(
      validateEvent(valid({ costOverheadRatio: -0.1 }), 'events.jsonl')?.rule,
    ).toContain('costOverheadRatio')
  })

  test('rejects non-finite wallClockOverheadMs', () => {
    expect(
      validateEvent(valid({ wallClockOverheadMs: Number.POSITIVE_INFINITY }), 'events.jsonl')?.rule,
    ).toContain('wallClockOverheadMs')
  })

  test('rejects malformed singleReviewArtifactHash', () => {
    expect(
      validateEvent(valid({ singleReviewArtifactHash: 'short' }), 'events.jsonl')?.rule,
    ).toContain('singleReviewArtifactHash')
  })

  test('rejects non-finite expectedFindingRecallDelta when present', () => {
    expect(
      validateEvent(valid({ expectedFindingRecallDelta: NaN }), 'events.jsonl')?.rule,
    ).toContain('expectedFindingRecallDelta')
  })
})
