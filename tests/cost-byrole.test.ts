// M13 Commit 4: per-role budget summarization + assertion + soft warnings.
//
// Codex Q9 + Q8 locks (CODEX_RESPONSE_M13.md): per-role gating fires
// only when (a) ProviderRequest.role is set and (b) the operator
// configured a cap under budgets.global.byRole.<role>. Order:
// per-phase -> per-role -> global. Soft warnings dedupe by
// (metric, role ?? "global"). Codex Blocker 2: maxTurns intentionally
// absent on byRole.

import { describe, test, expect } from 'bun:test'
import {
  summarizeBudgetUse,
  assertWithinBudget,
  detectBudgetSoftWarnings,
} from '../src/providers/cost.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { generateUlid, type LoggedEvent } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG, type CodeOzConfig } from '../src/config/schema.ts'
import type { PreparedProviderRequest, ProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    file: '/tmp/builder.md',
    name: 'builder',
    type: 'agent',
    phase: 'build',
    provider: 'fake',
    modelPolicy: 'any',
    permissions: { read: '*', write: '*', bash: 'deny' },
    description: 'stub',
    body: 'stub',
    ...overrides,
  } as AgentDefinition
}

function req(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'go',
    files: [],
    ...overrides,
  }
}

function prepared(tokensEstimate: number): PreparedProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'go',
    files: [],
    manifest: { files: [] },
    metrics: {
      filesSent: 0,
      bytesSent: 0,
      tokensEstimate,
      fieldsRemovedByScope: 0,
    },
  } as PreparedProviderRequest
}

function configWithByRole(byRole: NonNullable<CodeOzConfig['budgets']['global']['byRole']>): CodeOzConfig {
  return {
    ...DEFAULT_CONFIG,
    budgets: {
      ...DEFAULT_CONFIG.budgets,
      global: {
        ...DEFAULT_CONFIG.budgets.global,
        byRole,
      },
    },
  }
}

function invokedEvent(role: string | undefined, tokens: number, agentName = 'builder'): LoggedEvent {
  return {
    version: 1,
    type: 'agent_invoked',
    ts: '2026-05-01T12:00:00Z',
    runId: RUN,
    phase: 'build',
    agent: agentName,
    provider: 'fake',
    manifest: { files: [] },
    filesSent: 0,
    bytesSent: 0,
    tokensEstimate: tokens,
    fieldsRemovedByScope: 0,
    ...(role !== undefined ? { role } : {}),
  } as LoggedEvent
}

function completedEvent(tokens: number, agentName = 'builder'): LoggedEvent {
  return {
    version: 1,
    type: 'agent_completed',
    ts: '2026-05-01T12:00:01Z',
    runId: RUN,
    phase: 'build',
    agent: agentName,
    tokensUsed: tokens,
  } as LoggedEvent
}

describe('summarizeBudgetUse — byRole accumulators', () => {
  test('byRole counters are empty when no events have role', () => {
    const events: LoggedEvent[] = [invokedEvent(undefined, 100), completedEvent(50)]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.byRoleTokens).toEqual({})
    expect(counts.byRoleProviderCalls).toEqual({})
  })

  test('byRoleProviderCalls increments for role-tagged invocations', () => {
    const events: LoggedEvent[] = [
      invokedEvent('builder', 100),
      completedEvent(50),
      invokedEvent('reviewer', 200),
      completedEvent(150, 'reviewer'),
      invokedEvent('builder', 300),
      completedEvent(200),
    ]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.byRoleProviderCalls['builder']).toBe(2)
    expect(counts.byRoleProviderCalls['reviewer']).toBe(1)
  })

  test('byRoleTokens uses tokensUsed when available', () => {
    const events: LoggedEvent[] = [
      invokedEvent('builder', 100),
      completedEvent(50),
    ]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.byRoleTokens['builder']).toBe(50)
  })

  test('byRoleTokens falls back to estimate when completion omits tokensUsed', () => {
    const events: LoggedEvent[] = [
      invokedEvent('builder', 100),
      {
        version: 1,
        type: 'agent_completed',
        ts: '2026-05-01T12:00:01Z',
        runId: RUN,
        phase: 'build',
        agent: 'builder',
      } as LoggedEvent,
    ]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.byRoleTokens['builder']).toBe(100)
  })

  test('byRoleTokens counts in-flight (unmatched) invokes at estimate', () => {
    const events: LoggedEvent[] = [invokedEvent('builder', 250)]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.byRoleTokens['builder']).toBe(250)
  })

  test('FIFO pairing per role across phases', () => {
    const events: LoggedEvent[] = [
      invokedEvent('builder', 100),
      invokedEvent('builder', 200),
      completedEvent(50),  // pairs with first invoke (100 -> 50)
      completedEvent(180), // pairs with second invoke (200 -> 180)
    ]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.byRoleTokens['builder']).toBe(50 + 180)
  })
})

describe('assertWithinBudget — per-role enforcement', () => {
  test('per-role token cap fires when exceeded', () => {
    const cfg = configWithByRole({ builder: { maxTokensEstimate: 500 } })
    const events: LoggedEvent[] = [
      invokedEvent('builder', 200),
      completedEvent(200),
    ]
    expect(() =>
      assertWithinBudget(cfg, req({ role: 'builder' }), prepared(400), events),
    ).toThrow(/role builder would exceed maxTokensEstimate/)
  })

  test('per-role token cap names byRole.<role>.maxTokensEstimate suggestion', () => {
    const cfg = configWithByRole({ reviewer: { maxTokensEstimate: 100 } })
    try {
      assertWithinBudget(cfg, req({ role: 'reviewer' }), prepared(150), [])
      throw new Error('expected ProviderError')
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError)
      expect((e as ProviderError).issues[0]?.actionableSuggestions).toContain(
        'raise budgets.global.byRole.reviewer.maxTokensEstimate in .code-oz/config.yaml',
      )
    }
  })

  test('per-role calls cap fires when exceeded', () => {
    const cfg = configWithByRole({ builder: { maxProviderCalls: 2 } })
    const events: LoggedEvent[] = [
      invokedEvent('builder', 10),
      completedEvent(10),
      invokedEvent('builder', 10),
      completedEvent(10),
    ]
    expect(() =>
      assertWithinBudget(cfg, req({ role: 'builder' }), prepared(10), events),
    ).toThrow(/role builder would exceed maxProviderCalls/)
  })

  test('per-role check skipped when req.role is undefined', () => {
    const cfg = configWithByRole({ builder: { maxTokensEstimate: 50 } })
    const events: LoggedEvent[] = []
    // Even with a tight per-role cap, a roleless invocation passes
    // (only global + per-phase enforce). prepared(40) fits both.
    expect(() => assertWithinBudget(cfg, req(), prepared(40), events)).not.toThrow()
  })

  test('per-role check skipped when byRole row is absent for this role', () => {
    const cfg = configWithByRole({ reviewer: { maxTokensEstimate: 50 } })
    // Builder has no byRole row; the call passes (only global +
    // per-phase enforce).
    expect(() =>
      assertWithinBudget(cfg, req({ role: 'builder' }), prepared(40), []),
    ).not.toThrow()
  })

  test('per-role cap fires before global cap (most specific first)', () => {
    // Per-role cap is tighter than global; the per-role check should
    // own the failure since it is most actionable.
    const cfg = configWithByRole({ builder: { maxTokensEstimate: 100 } })
    try {
      assertWithinBudget(cfg, req({ role: 'builder' }), prepared(200), [])
      throw new Error('expected ProviderError')
    } catch (e) {
      expect((e as ProviderError).issues[0]?.rule).toContain('role builder')
    }
  })
})

describe('detectBudgetSoftWarnings — per-role warnings', () => {
  test('per-role token warning fires at softWarnAtRatio', () => {
    const cfg = configWithByRole({ builder: { maxTokensEstimate: 1000 } })
    const events: LoggedEvent[] = [invokedEvent('builder', 700)]
    const warnings = detectBudgetSoftWarnings(
      cfg,
      req({ role: 'builder' }),
      prepared(100),
      events,
    )
    const roleWarning = warnings.find((w) => w.role === 'builder' && w.metric === 'maxTokensEstimate')
    expect(roleWarning).toBeDefined()
    expect(roleWarning!.current).toBe(800) // 700 in-flight + 100 next
    expect(roleWarning!.limit).toBe(1000)
    expect(roleWarning!.ratio).toBe(0.8)
  })

  test('per-role calls warning fires at softWarnAtRatio', () => {
    const cfg = configWithByRole({ builder: { maxProviderCalls: 4 } })
    const events: LoggedEvent[] = [
      invokedEvent('builder', 10),
      completedEvent(10),
      invokedEvent('builder', 10),
      completedEvent(10),
    ]
    // 2 prior + 1 next = 3, ratio = 0.75 = softWarnAtRatio.
    const warnings = detectBudgetSoftWarnings(
      cfg,
      req({ role: 'builder' }),
      prepared(10),
      events,
    )
    const roleWarning = warnings.find((w) => w.role === 'builder' && w.metric === 'maxProviderCalls')
    expect(roleWarning).toBeDefined()
    expect(roleWarning!.current).toBe(3)
    expect(roleWarning!.limit).toBe(4)
  })

  test('per-role and global warnings dedupe independently', () => {
    const cfg = configWithByRole({ builder: { maxTokensEstimate: 1000 } })
    const events: LoggedEvent[] = [
      invokedEvent('builder', 700),
      // Prior global warning already emitted: should not re-emit.
      {
        version: 1,
        type: 'budget_warning',
        ts: '2026-05-01T11:00:00Z',
        runId: RUN,
        metric: 'maxTokensEstimate',
        ratio: 0.8,
        current: 800,
        limit: 1000,
      } as LoggedEvent,
    ]
    const warnings = detectBudgetSoftWarnings(
      cfg,
      req({ role: 'builder' }),
      prepared(100),
      events,
    )
    // Global suppressed (alreadyWarned), per-role still emits.
    const roleWarning = warnings.find((w) => w.role === 'builder')
    expect(roleWarning).toBeDefined()
    const globalWarning = warnings.find((w) => w.role === undefined && w.metric === 'maxTokensEstimate')
    expect(globalWarning).toBeUndefined()
  })

  test('per-role warning suppressed once recorded for that role', () => {
    const cfg = configWithByRole({ builder: { maxTokensEstimate: 1000 } })
    const events: LoggedEvent[] = [
      invokedEvent('builder', 700),
      {
        version: 1,
        type: 'budget_warning',
        ts: '2026-05-01T11:00:00Z',
        runId: RUN,
        metric: 'maxTokensEstimate',
        ratio: 0.8,
        current: 800,
        limit: 1000,
        role: 'builder',
      } as LoggedEvent,
    ]
    const warnings = detectBudgetSoftWarnings(
      cfg,
      req({ role: 'builder' }),
      prepared(100),
      events,
    )
    const roleWarning = warnings.find((w) => w.role === 'builder')
    expect(roleWarning).toBeUndefined()
  })

  test('no per-role warning when byRole row is absent for this role', () => {
    const cfg = configWithByRole({ reviewer: { maxTokensEstimate: 1000 } })
    const warnings = detectBudgetSoftWarnings(
      cfg,
      req({ role: 'builder' }),
      prepared(100),
      [],
    )
    const roleWarning = warnings.find((w) => w.role !== undefined)
    expect(roleWarning).toBeUndefined()
  })
})
