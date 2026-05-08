// M15 commit 2 — pure scheduler decision function tests.
//
// Coverage discipline (kickoff §11.2): every SchedulerSkipReason has at least
// one positive case; every SchedulerFireReason has at least one positive
// case + at least one negative-near-miss case (the boundary that almost
// fires).
//
// The decision function is pure: no I/O, no global state, no LLM. Tests
// build SchedulerInput snapshots and assert the resulting SchedulerDecision
// matches the locked decision-evaluation order from kickoff §5.

import { describe, test, expect } from 'bun:test'
import {
  evaluateSchedulerDecision,
  type SchedulerInput,
  type PanelistVerdictSnapshot,
} from '../src/policy/debate-scheduler.ts'

// Default sentinels that satisfy every gate (used for the "fire" cases by
// adjusting only the trigger surface).
function defaultInput(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    mode: 'auto',
    review: {
      mode: 'single',
      score: 6,
      verdict: 'needs-revision',
    },
    history: {
      debatesFiredThisRun: 0,
      debatesFiredThisTask: 0,
      priorFingerprintsThisTask: new Set<string>(),
      currentFingerprint: 'fp-current-001',
    },
    budget: {
      aggregatePreflightWouldTip: false,
    },
    persona: {
      hasDebatePermission: true,
      opposingProviders: ['gemini', 'claude'],
    },
    concurrency: {
      debateInFlight: false,
    },
    manifest: {
      projectedFileCount: 8,
      maxFiles: 16,
    },
    policy: {
      maxPerRun: 2,
      maxPerTask: 1,
      triggers: {
        reviewScoreGreyZone: { min: 5, max: 7 },
        panelVoterDisagreement: true,
        needsRevisionWithHighScore: true,
      },
      cooldown: { dedupByFingerprint: true },
    },
    ...overrides,
  }
}

// Convenience for panel-mode reviews.
function panelReview(verdicts: readonly PanelistVerdictSnapshot[]): SchedulerInput {
  return defaultInput({
    review: {
      mode: 'panel',
      score: null,
      verdict: 'panel',
      panelistVerdicts: verdicts,
    },
  })
}

// ---------------------------------------------------------------------------
// SchedulerSkipReason — every reason has at least one positive case.
// ---------------------------------------------------------------------------
describe('skip — mode_off', () => {
  test('mode=off skips immediately', () => {
    const d = evaluateSchedulerDecision(defaultInput({ mode: 'off' }))
    expect(d).toEqual({ fire: false, reason: 'mode_off' })
  })
})

describe('skip — mode_manual', () => {
  test('mode=manual skips before any other gate', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        mode: 'manual',
        // Even when every other gate would fire, mode_manual short-circuits.
        review: { mode: 'single', score: 6, verdict: 'needs-revision' },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'mode_manual' })
  })
})

describe('skip — persona_no_debate_permission', () => {
  test('skips when persona has no debate permission', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        persona: { hasDebatePermission: false, opposingProviders: ['gemini'] },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'persona_no_debate_permission' })
  })
})

describe('skip — persona_no_eligible_opponent', () => {
  test('skips when opposingProviders is empty (post-eligibility filter)', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        persona: { hasDebatePermission: true, opposingProviders: [] },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'persona_no_eligible_opponent' })
  })
})

describe('skip — concurrent_limit', () => {
  test('skips when a debate is already in-flight for this phase', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ concurrency: { debateInFlight: true } }),
    )
    expect(d).toEqual({ fire: false, reason: 'concurrent_limit' })
  })
})

describe('skip — max_per_run_exhausted', () => {
  test('skips when run has hit maxPerRun cap', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        history: {
          debatesFiredThisRun: 2,
          debatesFiredThisTask: 0,
          priorFingerprintsThisTask: new Set(),
          currentFingerprint: 'fp-001',
        },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'max_per_run_exhausted' })
  })
})

describe('skip — max_per_task_exhausted', () => {
  test('skips when task has hit maxPerTask cap', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        history: {
          debatesFiredThisRun: 0,
          debatesFiredThisTask: 1,
          priorFingerprintsThisTask: new Set(),
          currentFingerprint: 'fp-001',
        },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'max_per_task_exhausted' })
  })
})

describe('skip — dedup_fingerprint_already_debated', () => {
  test('skips when current fingerprint is in priorFingerprintsThisTask', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        history: {
          debatesFiredThisRun: 0,
          debatesFiredThisTask: 0,
          priorFingerprintsThisTask: new Set(['fp-current-001']),
          currentFingerprint: 'fp-current-001',
        },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'dedup_fingerprint_already_debated' })
  })

  test('does NOT skip when dedupByFingerprint is disabled', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        history: {
          debatesFiredThisRun: 0,
          debatesFiredThisTask: 0,
          priorFingerprintsThisTask: new Set(['fp-current-001']),
          currentFingerprint: 'fp-current-001',
        },
        policy: {
          maxPerRun: 2,
          maxPerTask: 1,
          triggers: {
            reviewScoreGreyZone: { min: 5, max: 7 },
            panelVoterDisagreement: true,
            needsRevisionWithHighScore: true,
          },
          cooldown: { dedupByFingerprint: false },
        },
      }),
    )
    expect(d.fire).toBe(true)
  })
})

describe('skip — budget_exhausted', () => {
  test('skips when aggregate preflight would tip', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        budget: { aggregatePreflightWouldTip: true, tipReason: 'maxTokensEstimate' },
      }),
    )
    expect(d).toEqual({
      fire: false,
      reason: 'budget_exhausted',
      budgetTipReason: 'maxTokensEstimate',
    })
  })

  test('omits budgetTipReason when not provided', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        budget: { aggregatePreflightWouldTip: true },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'budget_exhausted' })
  })
})

describe('skip — manifest_size_exceeds_maxFiles', () => {
  test('skips when projectedFileCount > maxFiles', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ manifest: { projectedFileCount: 17, maxFiles: 16 } }),
    )
    expect(d).toEqual({ fire: false, reason: 'manifest_size_exceeds_maxFiles' })
  })

  test('does NOT skip when projectedFileCount equals maxFiles', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ manifest: { projectedFileCount: 16, maxFiles: 16 } }),
    )
    expect(d.fire).toBe(true)
  })
})

describe('skip — no_trigger_matched', () => {
  test('skips with no_trigger_matched on a clean ready verdict', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        review: { mode: 'single', score: 9, verdict: 'ready' },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })

  test('skips with no_trigger_matched in panel mode when voters agree', () => {
    const d = evaluateSchedulerDecision(
      panelReview([
        { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-B', verdict: 'ready', authorityImpact: 'voter' },
      ]),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })
})

// ---------------------------------------------------------------------------
// SchedulerFireReason — every reason has positive + negative-near-miss cases.
// ---------------------------------------------------------------------------
describe('fire — score_in_grey_zone', () => {
  test('fires on score=6, verdict=needs-revision (mid grey)', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ review: { mode: 'single', score: 6, verdict: 'needs-revision' } }),
    )
    expect(d).toEqual({ fire: true, reason: 'score_in_grey_zone' })
  })

  test('fires at lower bound (score=5)', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ review: { mode: 'single', score: 5, verdict: 'needs-revision' } }),
    )
    expect(d).toEqual({ fire: true, reason: 'score_in_grey_zone' })
  })

  test('fires at upper bound (score=7)', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ review: { mode: 'single', score: 7, verdict: 'ready' } }),
    )
    expect(d).toEqual({ fire: true, reason: 'score_in_grey_zone' })
  })

  test('does NOT fire just below grey zone (score=4)', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ review: { mode: 'single', score: 4, verdict: 'block' } }),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })

  test('does NOT fire just above grey zone (score=8, ready)', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ review: { mode: 'single', score: 8, verdict: 'ready' } }),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })

  test('panel mode does NOT fire score_in_grey_zone (Codex Risk #1)', () => {
    const d = evaluateSchedulerDecision(
      panelReview([
        { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-B', verdict: 'ready', authorityImpact: 'voter' },
      ]),
    )
    // Even though grey-zone is enabled, panel mode never matches it.
    expect(d.fire).toBe(false)
    if (!d.fire) expect(d.reason).toBe('no_trigger_matched')
  })
})

describe('fire — needs_revision_with_high_score', () => {
  test('fires on score=8 + verdict=needs-revision', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ review: { mode: 'single', score: 8, verdict: 'needs-revision' } }),
    )
    expect(d).toEqual({ fire: true, reason: 'needs_revision_with_high_score' })
  })

  test('does NOT fire on score=8 + verdict=ready', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({ review: { mode: 'single', score: 8, verdict: 'ready' } }),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })

  test('does NOT fire when needsRevisionWithHighScore disabled', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        review: { mode: 'single', score: 8, verdict: 'needs-revision' },
        policy: {
          maxPerRun: 2,
          maxPerTask: 1,
          triggers: {
            reviewScoreGreyZone: { min: 5, max: 7 },
            panelVoterDisagreement: true,
            needsRevisionWithHighScore: false,
          },
          cooldown: { dedupByFingerprint: true },
        },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })
})

describe('fire — panel_voter_disagreement', () => {
  test('fires when two voters return distinct verdicts', () => {
    const d = evaluateSchedulerDecision(
      panelReview([
        { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-B', verdict: 'needs-revision', authorityImpact: 'voter' },
      ]),
    )
    expect(d).toEqual({ fire: true, reason: 'panel_voter_disagreement' })
  })

  test('does NOT fire when voters agree but advisory dissents (Codex Q5)', () => {
    const d = evaluateSchedulerDecision(
      panelReview([
        { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-B', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-C', verdict: 'block', authorityImpact: 'advisory' },
      ]),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })

  test('does NOT fire when only advisory voters disagree (Codex Q5)', () => {
    const d = evaluateSchedulerDecision(
      panelReview([
        { id: 'r-A', verdict: 'ready', authorityImpact: 'advisory' },
        { id: 'r-B', verdict: 'block', authorityImpact: 'advisory' },
      ]),
    )
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })

  test('does NOT fire when panelVoterDisagreement disabled', () => {
    const d = evaluateSchedulerDecision({
      ...panelReview([
        { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-B', verdict: 'needs-revision', authorityImpact: 'voter' },
      ]),
      policy: {
        maxPerRun: 2,
        maxPerTask: 1,
        triggers: {
          reviewScoreGreyZone: { min: 5, max: 7 },
          panelVoterDisagreement: false,
          needsRevisionWithHighScore: true,
        },
        cooldown: { dedupByFingerprint: true },
      },
    })
    expect(d).toEqual({ fire: false, reason: 'no_trigger_matched' })
  })

  test('fires with three voters when at least two disagree', () => {
    const d = evaluateSchedulerDecision(
      panelReview([
        { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-B', verdict: 'ready', authorityImpact: 'voter' },
        { id: 'r-C', verdict: 'block', authorityImpact: 'voter' },
      ]),
    )
    expect(d).toEqual({ fire: true, reason: 'panel_voter_disagreement' })
  })
})

// ---------------------------------------------------------------------------
// Decision-evaluation ordering — short-circuit semantics.
// ---------------------------------------------------------------------------
describe('decision evaluation ordering', () => {
  test('mode_off short-circuits before persona check', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        mode: 'off',
        persona: { hasDebatePermission: false, opposingProviders: [] },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'mode_off' })
  })

  test('persona check short-circuits before concurrency', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        persona: { hasDebatePermission: false, opposingProviders: ['gemini'] },
        concurrency: { debateInFlight: true },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'persona_no_debate_permission' })
  })

  test('concurrency short-circuits before history caps', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        concurrency: { debateInFlight: true },
        history: {
          debatesFiredThisRun: 99,
          debatesFiredThisTask: 99,
          priorFingerprintsThisTask: new Set(),
          currentFingerprint: 'fp-001',
        },
      }),
    )
    expect(d).toEqual({ fire: false, reason: 'concurrent_limit' })
  })

  test('budget short-circuits before manifest', () => {
    const d = evaluateSchedulerDecision(
      defaultInput({
        budget: { aggregatePreflightWouldTip: true, tipReason: 'maxProviderCalls' },
        manifest: { projectedFileCount: 999, maxFiles: 16 },
      }),
    )
    expect(d).toEqual({
      fire: false,
      reason: 'budget_exhausted',
      budgetTipReason: 'maxProviderCalls',
    })
  })
})

// ---------------------------------------------------------------------------
// Pure function determinism
// ---------------------------------------------------------------------------
describe('pure function determinism', () => {
  test('same input -> same decision (no internal state)', () => {
    const input = defaultInput({
      review: { mode: 'single', score: 6, verdict: 'needs-revision' },
    })
    const d1 = evaluateSchedulerDecision(input)
    const d2 = evaluateSchedulerDecision(input)
    const d3 = evaluateSchedulerDecision(input)
    expect(d1).toEqual(d2)
    expect(d2).toEqual(d3)
  })

  test('mutating the original input set does NOT affect prior decisions', () => {
    const sharedSet = new Set<string>(['fp-prior-A'])
    const input = defaultInput({
      history: {
        debatesFiredThisRun: 0,
        debatesFiredThisTask: 0,
        priorFingerprintsThisTask: sharedSet,
        currentFingerprint: 'fp-current',
      },
    })
    const d1 = evaluateSchedulerDecision(input)
    sharedSet.add('fp-current')  // post-decision mutation
    // d1 was computed before mutation; it should still reflect "no dedup match."
    expect(d1.fire).toBe(true)
  })
})
