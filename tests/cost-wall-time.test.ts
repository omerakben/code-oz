import { describe, test, expect } from 'bun:test'
import {
  assertWithinBudget,
  computeWallTimeMinutes,
  detectBudgetSoftWarnings,
  summarizeBudgetUse,
} from '../src/providers/cost.ts'
import type { LoggedEvent, PhaseEvent } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { PreparedProviderRequest, ProviderRequest } from '../src/providers/types.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'

const STUB_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/lead.md',
  name: 'lead',
  type: 'agent',
  phase: 'plan',
  provider: 'claude',
  modelPolicy: 'opus-default',
  permissions: Object.freeze({
    read: '*' as const,
    write: '*' as const,
    bash: 'deny' as const,
  }),
  description: 'stub for tests',
  body: '# Lead',
})

const PROVIDER_REQ: ProviderRequest = {
  runId: RUN_ID,
  phase: 'plan',
  agent: STUB_AGENT,
  files: [],
  prompt: 'hello',
}

const PREPARED: PreparedProviderRequest = {
  agent: STUB_AGENT,
  phase: 'plan',
  runId: RUN_ID,
  prompt: 'hello',
  files: [],
  manifest: { files: [] },
  metrics: {
    filesSent: 0,
    bytesSent: 0,
    tokensEstimate: 100,
    fieldsRemovedByScope: 0,
  },
}

function runStarted(ts: string): PhaseEvent {
  return {
    version: 1,
    type: 'run_started',
    ts,
    runId: RUN_ID,
    profile: 'greenfield',
  }
}


describe('computeWallTimeMinutes', () => {
  test('returns null when no run_started present', () => {
    const events: LoggedEvent[] = []
    expect(computeWallTimeMinutes(events, new Date('2026-04-30T10:00:00Z'))).toBeNull()
  })

  test('returns 30 minutes when run_started 30 minutes ago', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const now = new Date('2026-04-30T10:30:00Z')
    expect(computeWallTimeMinutes(events, now)).toBe(30)
  })

  test('returns 0 when wall-time would be negative (clock skew)', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const now = new Date('2026-04-30T09:55:00Z')
    expect(computeWallTimeMinutes(events, now)).toBe(0)
  })
})

describe('summarizeBudgetUse — wallTimeMinutes', () => {
  test('reports wall-time in BudgetCounts', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const counts = summarizeBudgetUse(events, 'plan', new Date('2026-04-30T10:45:00Z'))
    expect(counts.wallTimeMinutes).toBe(45)
  })
})

describe('assertWithinBudget — wall-time hard cap', () => {
  test('throws when wall-time exceeds maxWallTimeMinutes', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const now = new Date('2026-04-30T15:00:00Z') // 300 minutes
    const cfg = {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: { ...DEFAULT_CONFIG.budgets.global, maxWallTimeMinutes: 60 },
      },
    }
    expect(() => assertWithinBudget(cfg, PROVIDER_REQ, PREPARED, events, now)).toThrow(
      ProviderError,
    )
  })

  test('does not throw when wall-time is within cap', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const now = new Date('2026-04-30T10:30:00Z')
    expect(() => assertWithinBudget(DEFAULT_CONFIG, PROVIDER_REQ, PREPARED, events, now)).not.toThrow()
  })
})

describe('detectBudgetSoftWarnings', () => {
  test('emits no warnings when below softWarnAtRatio', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const warnings = detectBudgetSoftWarnings(
      DEFAULT_CONFIG,
      PROVIDER_REQ,
      PREPARED,
      events,
      new Date('2026-04-30T10:30:00Z'),
    )
    expect(warnings.length).toBe(0)
  })

  test('emits maxWallTimeMinutes warning when ratio crosses 0.75', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const cfg = {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: { ...DEFAULT_CONFIG.budgets.global, maxWallTimeMinutes: 100 },
      },
    }
    const now = new Date('2026-04-30T11:20:00Z') // 80 minutes
    const warnings = detectBudgetSoftWarnings(cfg, PROVIDER_REQ, PREPARED, events, now)
    const wall = warnings.find((w) => w.metric === 'maxWallTimeMinutes')
    expect(wall).toBeDefined()
    expect(wall!.ratio).toBeGreaterThanOrEqual(0.75)
    expect(wall!.ratio).toBeLessThan(1.0)
  })

  test('emits maxTokensEstimate warning when call would push past 0.75', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const cfg = {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: { ...DEFAULT_CONFIG.budgets.global, maxTokensEstimate: 1000 },
      },
    }
    const prepared = { ...PREPARED, metrics: { ...PREPARED.metrics, tokensEstimate: 800 } }
    const warnings = detectBudgetSoftWarnings(cfg, PROVIDER_REQ, prepared, events, new Date('2026-04-30T10:01:00Z'))
    const tokens = warnings.find((w) => w.metric === 'maxTokensEstimate')
    expect(tokens).toBeDefined()
    expect(tokens!.current).toBe(800)
  })

  test('does not re-emit a warning if a budget_warning for the same metric exists', () => {
    const events: LoggedEvent[] = [
      runStarted('2026-04-30T10:00:00Z'),
      {
        version: 1,
        type: 'budget_warning',
        ts: '2026-04-30T10:30:00Z',
        runId: RUN_ID,
        metric: 'maxWallTimeMinutes',
        ratio: 0.78,
        current: 78,
        limit: 100,
      } as PhaseEvent,
    ]
    const cfg = {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: { ...DEFAULT_CONFIG.budgets.global, maxWallTimeMinutes: 100 },
      },
    }
    const warnings = detectBudgetSoftWarnings(
      cfg,
      PROVIDER_REQ,
      PREPARED,
      events,
      new Date('2026-04-30T11:25:00Z'),
    )
    expect(warnings.find((w) => w.metric === 'maxWallTimeMinutes')).toBeUndefined()
  })

  test('does not emit a warning when ratio is already 1.0 (hard cap territory)', () => {
    const events: LoggedEvent[] = [runStarted('2026-04-30T10:00:00Z')]
    const cfg = {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: { ...DEFAULT_CONFIG.budgets.global, maxWallTimeMinutes: 100 },
      },
    }
    const now = new Date('2026-04-30T11:50:00Z') // 110 minutes — over cap
    const warnings = detectBudgetSoftWarnings(cfg, PROVIDER_REQ, PREPARED, events, now)
    expect(warnings.find((w) => w.metric === 'maxWallTimeMinutes')).toBeUndefined()
  })
})
