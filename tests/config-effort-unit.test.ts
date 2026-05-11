// B1a Commit 1 — unit tests for `applyEffort()`.
//
// Coverage matrix:
//   1. balanced (1.0x) returns byte-identical envelope
//   2. each scaled-set field scales correctly at every level
//   3. invariant-set fields are byte-identical at every level
//   4. Math.floor rounding (e.g., 5 * 0.4 = 2)
//   5. min-1 rule when original > 0 (e.g., 1 * 0.4 = 1)
//   6. explicit 0 preserved (e.g., 0 * 6.0 = 0)
//   7. missing byRole row handled (omitted from result if absent)
//   8. missing perPhase row — N/A by schema (perPhase is exhaustive),
//      but empty input perPhase still handled
//   9. empty byRole / perPhase objects handled
//  10. non-budget fields untouched (provider, models, phases, etc.)
//  11. pure function: same input → same output, original not mutated

import { describe, test, expect } from 'bun:test'
import {
  applyEffort,
  EFFORT_LEVELS,
  EFFORT_MULTIPLIERS,
  type EffortLevel,
} from '../src/config/effort.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { CodeOzConfig, GlobalBudget, PhaseBudget, Phase } from '../src/config/schema.ts'

const SCALED_GLOBAL_FIELDS = [
  'maxTurns',
  'maxProviderCalls',
  'maxTokensEstimate',
  'maxWallTimeMinutes',
] as const

const INVARIANT_GLOBAL_FIELDS = [
  'maxReviewRounds',
  'maxToolCallsPerTurn',
  'toolCallBudgetMultiplier',
  'softWarnAtRatio',
] as const

const PHASES: readonly Phase[] = [
  'define',
  'plan',
  'build',
  'verify',
  'review',
  'ship',
  'audit',
]

function cloneViaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('EFFORT_LEVELS / EFFORT_MULTIPLIERS', () => {
  test('exports the four levels in the documented order', () => {
    expect(EFFORT_LEVELS).toEqual(['lite', 'balanced', 'max', 'beast'])
  })

  test('multiplier table matches the design doc', () => {
    expect(EFFORT_MULTIPLIERS.lite).toBe(0.4)
    expect(EFFORT_MULTIPLIERS.balanced).toBe(1.0)
    expect(EFFORT_MULTIPLIERS.max).toBe(2.5)
    expect(EFFORT_MULTIPLIERS.beast).toBe(6.0)
  })

  test('every level in EFFORT_LEVELS has a multiplier', () => {
    for (const level of EFFORT_LEVELS) {
      expect(typeof EFFORT_MULTIPLIERS[level]).toBe('number')
    }
  })
})

describe('applyEffort — balanced returns byte-identical envelope', () => {
  test('balanced is deep-equal to the original', () => {
    const out = applyEffort(DEFAULT_CONFIG, 'balanced')
    expect(out).toEqual(DEFAULT_CONFIG)
  })

  test('balanced preserves every scaled and invariant field of budgets.global', () => {
    const out = applyEffort(DEFAULT_CONFIG, 'balanced')
    for (const field of SCALED_GLOBAL_FIELDS) {
      expect(out.budgets.global[field]).toBe(DEFAULT_CONFIG.budgets.global[field])
    }
    for (const field of INVARIANT_GLOBAL_FIELDS) {
      expect(out.budgets.global[field]).toEqual(
        DEFAULT_CONFIG.budgets.global[field] as never,
      )
    }
  })

  test('balanced preserves every perPhase row byte-identically', () => {
    const out = applyEffort(DEFAULT_CONFIG, 'balanced')
    for (const phase of PHASES) {
      expect(out.budgets.perPhase[phase]).toEqual(DEFAULT_CONFIG.budgets.perPhase[phase])
    }
  })
})

describe('applyEffort — scaled-set: budgets.global', () => {
  for (const level of EFFORT_LEVELS) {
    const multiplier = EFFORT_MULTIPLIERS[level]
    test(`${level} (${multiplier}x): every scaled-set global field scales correctly`, () => {
      const out = applyEffort(DEFAULT_CONFIG, level)
      const before = DEFAULT_CONFIG.budgets.global
      const after = out.budgets.global
      for (const field of SCALED_GLOBAL_FIELDS) {
        const original = before[field]
        const expected = original === 0 ? 0 : Math.max(1, Math.floor(original * multiplier))
        expect(after[field]).toBe(expected)
      }
    })
  }
})

describe('applyEffort — scaled-set: budgets.perPhase', () => {
  for (const level of EFFORT_LEVELS) {
    const multiplier = EFFORT_MULTIPLIERS[level]
    test(`${level} (${multiplier}x): every perPhase field scales correctly across all phases`, () => {
      const out = applyEffort(DEFAULT_CONFIG, level)
      for (const phase of PHASES) {
        const before = DEFAULT_CONFIG.budgets.perPhase[phase]
        const after = out.budgets.perPhase[phase]
        const fields: ReadonlyArray<keyof PhaseBudget> = [
          'maxTurns',
          'maxProviderCalls',
          'maxTokensEstimate',
        ]
        for (const field of fields) {
          const original = before[field]
          const expected = original === 0 ? 0 : Math.max(1, Math.floor(original * multiplier))
          expect(after[field]).toBe(expected)
        }
      }
    })
  }
})

describe('applyEffort — scaled-set: budgets.global.byRole', () => {
  for (const level of EFFORT_LEVELS) {
    const multiplier = EFFORT_MULTIPLIERS[level]
    test(`${level} (${multiplier}x): byRole rows scale every present scalable field`, () => {
      const cfg: CodeOzConfig = {
        ...DEFAULT_CONFIG,
        budgets: {
          ...DEFAULT_CONFIG.budgets,
          global: {
            ...DEFAULT_CONFIG.budgets.global,
            byRole: {
              builder: { maxProviderCalls: 20, maxTokensEstimate: 500_000 },
              reviewer: { maxProviderCalls: 10, maxTokensEstimate: 300_000 },
            },
          },
        },
      }
      const out = applyEffort(cfg, level)
      const builder = out.budgets.global.byRole?.builder
      const reviewer = out.budgets.global.byRole?.reviewer
      expect(builder?.maxProviderCalls).toBe(Math.max(1, Math.floor(20 * multiplier)))
      expect(builder?.maxTokensEstimate).toBe(Math.max(1, Math.floor(500_000 * multiplier)))
      expect(reviewer?.maxProviderCalls).toBe(Math.max(1, Math.floor(10 * multiplier)))
      expect(reviewer?.maxTokensEstimate).toBe(Math.max(1, Math.floor(300_000 * multiplier)))
    })
  }
})

describe('applyEffort — invariant-set is byte-identical at every level', () => {
  for (const level of EFFORT_LEVELS) {
    test(`${level}: budgets.global invariant fields are byte-identical`, () => {
      const out = applyEffort(DEFAULT_CONFIG, level)
      const before = DEFAULT_CONFIG.budgets.global
      const after = out.budgets.global
      expect(after.maxReviewRounds).toBe(before.maxReviewRounds)
      expect(after.maxToolCallsPerTurn).toBe(before.maxToolCallsPerTurn)
      expect(after.toolCallBudgetMultiplier).toBe(before.toolCallBudgetMultiplier)
      expect(after.softWarnAtRatio).toBe(before.softWarnAtRatio)
      // priceTable is the same reference (not deep-cloned) — preserves the
      // loader's `Object.freeze` contract; structural equality is sufficient.
      expect(after.priceTable).toEqual(before.priceTable as never)
    })
  }
})

describe('applyEffort — Math.floor rounding', () => {
  test('5 * 0.4 = 2 (floor of 2.0)', () => {
    expect(Math.floor(5 * 0.4)).toBe(2)
    const cfg = makeConfigWithGlobal({ maxTurns: 5 })
    const out = applyEffort(cfg, 'lite')
    expect(out.budgets.global.maxTurns).toBe(2)
  })

  test('7 * 0.4 = 2 (floor of 2.8)', () => {
    const cfg = makeConfigWithGlobal({ maxTurns: 7 })
    const out = applyEffort(cfg, 'lite')
    expect(out.budgets.global.maxTurns).toBe(2)
  })

  test('3 * 2.5 = 7 (floor of 7.5)', () => {
    const cfg = makeConfigWithGlobal({ maxTurns: 3 })
    const out = applyEffort(cfg, 'max')
    expect(out.budgets.global.maxTurns).toBe(7)
  })
})

describe('applyEffort — min-1 rule when original > 0', () => {
  test('1 * 0.4 = 1 (would be 0 without min-1)', () => {
    const cfg = makeConfigWithGlobal({ maxTurns: 1 })
    const out = applyEffort(cfg, 'lite')
    expect(out.budgets.global.maxTurns).toBe(1)
  })

  test('2 * 0.4 = 1 (floor of 0.8 then min-1)', () => {
    const cfg = makeConfigWithGlobal({ maxTurns: 2 })
    const out = applyEffort(cfg, 'lite')
    expect(out.budgets.global.maxTurns).toBe(1)
  })

  test('byRole min-1 applies to scalable rows', () => {
    const cfg = makeConfigWithByRole({ builder: { maxProviderCalls: 1, maxTokensEstimate: 1 } })
    const out = applyEffort(cfg, 'lite')
    expect(out.budgets.global.byRole?.builder?.maxProviderCalls).toBe(1)
    expect(out.budgets.global.byRole?.builder?.maxTokensEstimate).toBe(1)
  })

  test('perPhase min-1 applies to scalable fields', () => {
    const cfg = makeConfigWithPerPhase('build', { maxTurns: 1, maxProviderCalls: 2, maxTokensEstimate: 1 })
    const out = applyEffort(cfg, 'lite')
    expect(out.budgets.perPhase.build.maxTurns).toBe(1)
    expect(out.budgets.perPhase.build.maxProviderCalls).toBe(1)
    expect(out.budgets.perPhase.build.maxTokensEstimate).toBe(1)
  })
})

describe('applyEffort — explicit 0 preserved', () => {
  test('0 * 6.0 = 0 in budgets.global', () => {
    const cfg = makeConfigWithGlobal({
      maxTurns: 0,
      maxProviderCalls: 0,
      maxTokensEstimate: 0,
      maxWallTimeMinutes: 0,
    })
    const out = applyEffort(cfg, 'beast')
    expect(out.budgets.global.maxTurns).toBe(0)
    expect(out.budgets.global.maxProviderCalls).toBe(0)
    expect(out.budgets.global.maxTokensEstimate).toBe(0)
    expect(out.budgets.global.maxWallTimeMinutes).toBe(0)
  })

  test('0 * 0.4 = 0 in byRole', () => {
    const cfg = makeConfigWithByRole({ builder: { maxProviderCalls: 0, maxTokensEstimate: 0 } })
    const out = applyEffort(cfg, 'lite')
    expect(out.budgets.global.byRole?.builder?.maxProviderCalls).toBe(0)
    expect(out.budgets.global.byRole?.builder?.maxTokensEstimate).toBe(0)
  })

  test('0 * 2.5 = 0 in perPhase', () => {
    const cfg = makeConfigWithPerPhase('ship', { maxTurns: 0, maxProviderCalls: 0, maxTokensEstimate: 0 })
    const out = applyEffort(cfg, 'max')
    expect(out.budgets.perPhase.ship.maxTurns).toBe(0)
    expect(out.budgets.perPhase.ship.maxProviderCalls).toBe(0)
    expect(out.budgets.perPhase.ship.maxTokensEstimate).toBe(0)
  })
})

describe('applyEffort — missing / empty optional rows', () => {
  test('byRole undefined: result has no byRole field', () => {
    expect(DEFAULT_CONFIG.budgets.global.byRole).toBeUndefined()
    const out = applyEffort(DEFAULT_CONFIG, 'beast')
    expect(out.budgets.global.byRole).toBeUndefined()
  })

  test('byRole present but empty: result byRole is an empty object', () => {
    const cfg = makeConfigWithByRole({})
    const out = applyEffort(cfg, 'beast')
    expect(out.budgets.global.byRole).toBeDefined()
    expect(Object.keys(out.budgets.global.byRole ?? {})).toHaveLength(0)
  })

  test('byRole row with only one field: only that field is scaled, the other stays absent', () => {
    const cfg = makeConfigWithByRole({ reviewer: { maxProviderCalls: 10 } })
    const out = applyEffort(cfg, 'max')
    const row = out.budgets.global.byRole?.reviewer
    expect(row?.maxProviderCalls).toBe(Math.floor(10 * 2.5))
    expect(row?.maxTokensEstimate).toBeUndefined()
  })

  test('perPhase row with explicit zeros stays at zero (boundary already covered) and other phases scale normally', () => {
    const cfg = makeConfigWithPerPhase('ship', { maxTurns: 0, maxProviderCalls: 0, maxTokensEstimate: 0 })
    const out = applyEffort(cfg, 'beast')
    expect(out.budgets.perPhase.ship.maxTurns).toBe(0)
    // build (untouched in cfg) still scales from defaults.
    const buildOriginal = DEFAULT_CONFIG.budgets.perPhase.build
    expect(out.budgets.perPhase.build.maxTurns).toBe(Math.floor(buildOriginal.maxTurns * 6.0))
  })
})

describe('applyEffort — non-budget fields untouched', () => {
  for (const level of EFFORT_LEVELS) {
    test(`${level}: provider / models / phases / version / profile pass through byte-identically`, () => {
      const out = applyEffort(DEFAULT_CONFIG, level)
      expect(out.version).toBe(DEFAULT_CONFIG.version)
      expect(out.profile).toBe(DEFAULT_CONFIG.profile)
      expect(out.defaultProvider).toBe(DEFAULT_CONFIG.defaultProvider)
      expect(out.models).toEqual(DEFAULT_CONFIG.models)
      expect(out.permissions).toEqual(DEFAULT_CONFIG.permissions)
      expect(out.phases).toEqual(DEFAULT_CONFIG.phases)
      expect(out.company).toEqual(DEFAULT_CONFIG.company as never)
      expect(out.debatePolicy).toEqual(DEFAULT_CONFIG.debatePolicy as never)
    })
  }
})

describe('applyEffort — pure function: deterministic and non-mutating', () => {
  test('same input twice returns deep-equal output', () => {
    const a = applyEffort(DEFAULT_CONFIG, 'max')
    const b = applyEffort(DEFAULT_CONFIG, 'max')
    expect(a).toEqual(b)
  })

  test('original input is not mutated — applyEffort does not touch the source config', () => {
    const snapshotBefore = cloneViaJson(DEFAULT_CONFIG)
    applyEffort(DEFAULT_CONFIG, 'beast')
    applyEffort(DEFAULT_CONFIG, 'lite')
    applyEffort(DEFAULT_CONFIG, 'balanced')
    const snapshotAfter = cloneViaJson(DEFAULT_CONFIG)
    expect(snapshotAfter).toEqual(snapshotBefore)
  })

  test('the returned config is a new object (top-level identity)', () => {
    const out = applyEffort(DEFAULT_CONFIG, 'max')
    expect(out).not.toBe(DEFAULT_CONFIG)
    expect(out.budgets).not.toBe(DEFAULT_CONFIG.budgets)
    expect(out.budgets.global).not.toBe(DEFAULT_CONFIG.budgets.global)
    expect(out.budgets.perPhase).not.toBe(DEFAULT_CONFIG.budgets.perPhase)
  })

  test('mutating the returned config does not affect the source', () => {
    const out = applyEffort(DEFAULT_CONFIG, 'max')
    const sourceMaxTurns = DEFAULT_CONFIG.budgets.global.maxTurns
    out.budgets.global.maxTurns = 9999
    expect(DEFAULT_CONFIG.budgets.global.maxTurns).toBe(sourceMaxTurns)
  })
})

// --- helpers ----------------------------------------------------------------

function makeConfigWithGlobal(globalOverrides: Partial<GlobalBudget>): CodeOzConfig {
  return {
    ...DEFAULT_CONFIG,
    budgets: {
      ...DEFAULT_CONFIG.budgets,
      global: { ...DEFAULT_CONFIG.budgets.global, ...globalOverrides },
    },
  }
}

function makeConfigWithByRole(
  byRole: NonNullable<GlobalBudget['byRole']>,
): CodeOzConfig {
  return {
    ...DEFAULT_CONFIG,
    budgets: {
      ...DEFAULT_CONFIG.budgets,
      global: { ...DEFAULT_CONFIG.budgets.global, byRole },
    },
  }
}

function makeConfigWithPerPhase(phase: Phase, row: PhaseBudget): CodeOzConfig {
  return {
    ...DEFAULT_CONFIG,
    budgets: {
      ...DEFAULT_CONFIG.budgets,
      perPhase: { ...DEFAULT_CONFIG.budgets.perPhase, [phase]: row },
    },
  }
}

// Avoid 'EffortLevel'-import-not-used lint complaint.
const _level: EffortLevel = 'balanced'
void _level
