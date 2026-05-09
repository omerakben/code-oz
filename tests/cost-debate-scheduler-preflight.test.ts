// M15 commit 5 — debate-scheduler aggregate budget preflight tests.
//
// Coverage discipline (kickoff §11.6): every cap (maxTokensEstimate,
// maxProviderCalls, maxTurns, maxWallTimeMinutes) has at least one tip
// case. Per-phase, per-role, and global scopes each tested.
//
// The preflight is a pure predicate: same input -> same result; no
// disk I/O; reuses summarizeBudgetUse for cumulative spend reduction
// (rule 1 + rule 19).

import { describe, test, expect } from 'bun:test'
import {
  aggregateDebateSchedulerPreflight,
  type SchedulerPreflightInput,
} from '../src/providers/cost.ts'
import {
  DEFAULT_CONFIG,
  type CodeOzConfig,
} from '../src/config/schema.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'

const RUN = '01J0000000000000000000000A'
const TS_RUN_START = '2026-05-08T00:00:00.000Z'
const NOW = new Date('2026-05-08T00:30:00.000Z') // 30 minutes after run start

function defaultInput(overrides: Partial<SchedulerPreflightInput> = {}): SchedulerPreflightInput {
  return {
    phase: 'review',
    role: 'reviewer',
    opposingMaxTokens: 30_000,
    synthesisMaxTokens: 30_000,
    postReviewMaxTokens: 30_000,
    postReviewProviderCalls: 1,
    ...overrides,
  }
}

function configWithCaps(overrides: {
  perPhaseTokens?: number
  perPhaseProviderCalls?: number
  perPhaseTurns?: number
  globalTokens?: number
  globalProviderCalls?: number
  globalTurns?: number
  globalWallTimeMinutes?: number
  byRoleTokens?: number
  byRoleProviderCalls?: number
}): CodeOzConfig {
  const cfg: CodeOzConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  // mutate review phase budget
  cfg.budgets.perPhase.review = {
    maxTokens: cfg.budgets.perPhase.review.maxTurns,
    maxTurns: overrides.perPhaseTurns ?? 100,
    maxProviderCalls: overrides.perPhaseProviderCalls ?? 1000,
    maxTokensEstimate: overrides.perPhaseTokens ?? 10_000_000,
  } as unknown as typeof cfg.budgets.perPhase.review
  cfg.budgets.global.maxTurns = overrides.globalTurns ?? 1000
  cfg.budgets.global.maxProviderCalls = overrides.globalProviderCalls ?? 10_000
  cfg.budgets.global.maxTokensEstimate = overrides.globalTokens ?? 100_000_000
  cfg.budgets.global.maxWallTimeMinutes = overrides.globalWallTimeMinutes ?? 240
  if (overrides.byRoleTokens !== undefined || overrides.byRoleProviderCalls !== undefined) {
    cfg.budgets.global.byRole = {
      reviewer: {
        ...(overrides.byRoleTokens !== undefined ? { maxTokensEstimate: overrides.byRoleTokens } : {}),
        ...(overrides.byRoleProviderCalls !== undefined
          ? { maxProviderCalls: overrides.byRoleProviderCalls }
          : {}),
      },
    }
  }
  return cfg
}

function runStartedEvent(): LoggedEvent {
  return {
    version: 1,
    type: 'run_started',
    ts: TS_RUN_START,
    runId: RUN,
    profile: 'greenfield',
  }
}

// ---------------------------------------------------------------------------
// Happy path: no tip
// ---------------------------------------------------------------------------
describe('aggregateDebateSchedulerPreflight — clean path', () => {
  test('default budgets + zero spend = no tip', () => {
    const result = aggregateDebateSchedulerPreflight(
      DEFAULT_CONFIG,
      defaultInput(),
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(false)
    expect(result.tipReason).toBeUndefined()
    expect(result.projectedExtraTokens).toBe(90_000)
    expect(result.projectedExtraCalls).toBe(3) // 2 debate + 1 post-review
  })

  test('panel post-review counts each panelist as a provider call', () => {
    const result = aggregateDebateSchedulerPreflight(
      DEFAULT_CONFIG,
      defaultInput({ postReviewProviderCalls: 2 }),
      [runStartedEvent()],
      NOW,
    )
    expect(result.projectedExtraCalls).toBe(4) // 2 debate + 2 panelists
  })
})

// ---------------------------------------------------------------------------
// Per-phase token tip
// ---------------------------------------------------------------------------
describe('aggregateDebateSchedulerPreflight — token tips', () => {
  test('tips on per-phase maxTokensEstimate', () => {
    const cfg = configWithCaps({ perPhaseTokens: 50_000 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(), // 90_000 projected > 50_000 cap
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxTokensEstimate')
  })

  test('tips on global maxTokensEstimate', () => {
    const cfg = configWithCaps({ globalTokens: 50_000 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(),
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxTokensEstimate')
  })

  test('tips on byRole maxTokensEstimate', () => {
    const cfg = configWithCaps({ byRoleTokens: 50_000 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(),
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxTokensEstimate')
  })

  test('byRole skipped when role is undefined', () => {
    const cfg = configWithCaps({ byRoleTokens: 50_000 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput({ role: undefined }),
      [runStartedEvent()],
      NOW,
    )
    // Per-phase + global tokens are large enough; byRole is skipped because
    // role is undefined.
    expect(result.wouldTip).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Provider-call tips
// ---------------------------------------------------------------------------
describe('aggregateDebateSchedulerPreflight — provider-call tips', () => {
  test('tips on per-phase maxProviderCalls', () => {
    const cfg = configWithCaps({ perPhaseProviderCalls: 2 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(), // 3 projected calls > 2 cap
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxProviderCalls')
  })

  test('tips on global maxProviderCalls', () => {
    const cfg = configWithCaps({ globalProviderCalls: 2 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(),
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxProviderCalls')
  })

  test('tips on byRole maxProviderCalls', () => {
    const cfg = configWithCaps({ byRoleProviderCalls: 2 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(),
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxProviderCalls')
  })
})

// ---------------------------------------------------------------------------
// Turn + wall-time (already-tipped checks)
// ---------------------------------------------------------------------------
describe('aggregateDebateSchedulerPreflight — turn/wall-time tips', () => {
  test('tips on per-phase maxTurns when already exceeded', () => {
    const cfg = configWithCaps({ perPhaseTurns: 1 })
    const events: readonly LoggedEvent[] = [
      runStartedEvent(),
      { version: 1, type: 'phase_entered', ts: TS_RUN_START, runId: RUN, phase: 'review' },
      { version: 1, type: 'phase_entered', ts: TS_RUN_START, runId: RUN, phase: 'review' },
    ]
    const result = aggregateDebateSchedulerPreflight(cfg, defaultInput(), events, NOW)
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxTurns')
  })

  test('tips on global maxTurns when already exceeded', () => {
    const cfg = configWithCaps({ globalTurns: 1 })
    const events: readonly LoggedEvent[] = [
      runStartedEvent(),
      { version: 1, type: 'phase_entered', ts: TS_RUN_START, runId: RUN, phase: 'plan' },
      { version: 1, type: 'phase_entered', ts: TS_RUN_START, runId: RUN, phase: 'review' },
    ]
    const result = aggregateDebateSchedulerPreflight(cfg, defaultInput(), events, NOW)
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxTurns')
  })

  test('tips on global maxWallTimeMinutes when already exceeded', () => {
    const cfg = configWithCaps({ globalWallTimeMinutes: 5 }) // run_started 30min ago > 5
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(),
      [runStartedEvent()],
      NOW,
    )
    expect(result.wouldTip).toBe(true)
    expect(result.tipReason).toBe('maxWallTimeMinutes')
  })

  test('does not tip on wall-time when no run_started event', () => {
    const cfg = configWithCaps({ globalWallTimeMinutes: 5 })
    const result = aggregateDebateSchedulerPreflight(cfg, defaultInput(), [], NOW)
    // wallTimeMinutes is null without run_started; cap not enforceable.
    expect(result.wouldTip).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Skip-ordering: most upstream cap wins
// ---------------------------------------------------------------------------
describe('aggregateDebateSchedulerPreflight — first-breach-wins ordering', () => {
  test('per-phase tokens beats global tokens beats turns', () => {
    const cfg = configWithCaps({
      perPhaseTokens: 50_000,
      globalTokens: 40_000,
      perPhaseTurns: 1,
    })
    const events: readonly LoggedEvent[] = [
      runStartedEvent(),
      { version: 1, type: 'phase_entered', ts: TS_RUN_START, runId: RUN, phase: 'review' },
      { version: 1, type: 'phase_entered', ts: TS_RUN_START, runId: RUN, phase: 'review' },
    ]
    const result = aggregateDebateSchedulerPreflight(cfg, defaultInput(), events, NOW)
    // All three would tip; per-phase tokens reports first.
    expect(result.tipReason).toBe('maxTokensEstimate')
  })

  test('tokens beats provider-calls beats wall-time', () => {
    const cfg = configWithCaps({
      globalTokens: 50_000,
      globalProviderCalls: 1,
      globalWallTimeMinutes: 5,
    })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput(),
      [runStartedEvent()],
      NOW,
    )
    expect(result.tipReason).toBe('maxTokensEstimate')
  })
})

// ---------------------------------------------------------------------------
// Pure-function determinism
// ---------------------------------------------------------------------------
describe('aggregateDebateSchedulerPreflight — pure determinism', () => {
  test('same inputs -> same result', () => {
    const cfg = configWithCaps({ perPhaseTokens: 50_000 })
    const events = [runStartedEvent()]
    const r1 = aggregateDebateSchedulerPreflight(cfg, defaultInput(), events, NOW)
    const r2 = aggregateDebateSchedulerPreflight(cfg, defaultInput(), events, NOW)
    expect(r1).toEqual(r2)
  })

  test('projectedExtraTokens reports input sum regardless of tip', () => {
    const cfg = configWithCaps({ perPhaseTokens: 50_000 })
    const result = aggregateDebateSchedulerPreflight(
      cfg,
      defaultInput({
        opposingMaxTokens: 10_000,
        synthesisMaxTokens: 20_000,
        postReviewMaxTokens: 30_000,
      }),
      [runStartedEvent()],
      NOW,
    )
    expect(result.projectedExtraTokens).toBe(60_000)
  })
})
