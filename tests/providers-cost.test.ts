// Focused unit tests for the budget summarizer + assertion. The
// providers-invoke.test.ts suite covers the wrapper-level integration
// (NEEDS_INTERVENTION + intervention on breach); these tests cover the
// counting math directly so the global-vs-per-phase distinction stays
// explicit.

import { describe, test, expect } from 'bun:test'

import { summarizeBudgetUse, assertWithinBudget } from '../src/providers/cost.ts'
import { ProviderError } from '../src/providers/errors.ts'
import {
  DEFAULT_CONFIG,
  type CodeOzConfig,
} from '../src/config/schema.ts'
import type {
  PreparedProviderRequest,
  ProviderRequest,
} from '../src/providers/types.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'

function agent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/x.md',
    name: 'x',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'fake' as const,
    modelPolicy: 'any' as const,
    permissions: {
      read: '*' as const,
      write: '*' as const,
      bash: 'deny' as const,
    },
    description: 'x',
    body: '# stub\n## Overview\nstub',
  })
}

function req(): ProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'do',
    files: [],
  }
}

function prepared(tokensEstimate: number): PreparedProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'do',
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate, fieldsRemovedByScope: 0 },
  }
}

describe('summarizeBudgetUse — counter accuracy', () => {
  test('global counters track every phase, not just req.phase', () => {
    const events: LoggedEvent[] = [
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'define' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:01:00Z', runId: RUN, phase: 'plan' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:02:00Z', runId: RUN, phase: 'build' },
      {
        version: 1,
        type: 'agent_invoked',
        ts: '2026-04-29T17:03:00Z',
        runId: RUN,
        phase: 'define',
        agent: 'ba',
        provider: 'fake',
        manifest: { files: [] },
        filesSent: 0,
        bytesSent: 0,
        tokensEstimate: 100,
        fieldsRemovedByScope: 0,
      },
      {
        version: 1,
        type: 'agent_invoked',
        ts: '2026-04-29T17:04:00Z',
        runId: RUN,
        phase: 'plan',
        agent: 'lead',
        provider: 'fake',
        manifest: { files: [] },
        filesSent: 0,
        bytesSent: 0,
        tokensEstimate: 200,
        fieldsRemovedByScope: 0,
      },
      {
        version: 1,
        type: 'agent_invoked',
        ts: '2026-04-29T17:05:00Z',
        runId: RUN,
        phase: 'build',
        agent: 'builder',
        provider: 'fake',
        manifest: { files: [] },
        filesSent: 0,
        bytesSent: 0,
        tokensEstimate: 50,
        fieldsRemovedByScope: 0,
      },
    ]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.perPhaseTurns).toBe(1) // only build's phase_entered
    expect(counts.globalTurns).toBe(3) // define + plan + build
    expect(counts.perPhaseProviderCalls).toBe(1) // only build's agent_invoked
    expect(counts.globalProviderCalls).toBe(3) // ba + lead + builder
    expect(counts.perPhaseTokens).toBe(50) // build's in-flight estimate
    expect(counts.globalTokens).toBe(350) // 100 + 200 + 50
  })

  test('agent_completed.tokensUsed replaces the earlier agent_invoked.tokensEstimate (FIFO per phase)', () => {
    const events: LoggedEvent[] = [
      {
        version: 1,
        type: 'agent_invoked',
        ts: '2026-04-29T17:00:00Z',
        runId: RUN,
        phase: 'build',
        agent: 'a',
        provider: 'fake',
        manifest: { files: [] },
        filesSent: 0,
        bytesSent: 0,
        tokensEstimate: 1000, // estimate
        fieldsRemovedByScope: 0,
      },
      {
        version: 1,
        type: 'agent_completed',
        ts: '2026-04-29T17:01:00Z',
        runId: RUN,
        phase: 'build',
        agent: 'a',
        tokensUsed: 250, // actual; should replace the 1000 estimate
      },
    ]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.perPhaseTokens).toBe(250) // not 1000
    expect(counts.globalTokens).toBe(250)
  })

  test('unmatched (in-flight) agent_invoked falls back to estimate', () => {
    const events: LoggedEvent[] = [
      {
        version: 1,
        type: 'agent_invoked',
        ts: '2026-04-29T17:00:00Z',
        runId: RUN,
        phase: 'build',
        agent: 'a',
        provider: 'fake',
        manifest: { files: [] },
        filesSent: 0,
        bytesSent: 0,
        tokensEstimate: 500, // never paired
        fieldsRemovedByScope: 0,
      },
    ]
    const counts = summarizeBudgetUse(events, 'build')
    expect(counts.perPhaseTokens).toBe(500) // crashed turn still counts
    expect(counts.globalTokens).toBe(500)
  })
})

describe('assertWithinBudget — global cap enforcement (M4 review block-push fix)', () => {
  function tinyConfig(overrides: Partial<CodeOzConfig['budgets']['global']>): CodeOzConfig {
    return {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: {
          ...DEFAULT_CONFIG.budgets.global,
          ...overrides,
        },
      },
    }
  }

  test('per-phase tokens fit but global tokens would breach → provider_budget_exceeded (global)', () => {
    const config = tinyConfig({ maxTokensEstimate: 100 })
    // History: an agent_completed in 'define' burned 80 global tokens.
    const events: LoggedEvent[] = [
      {
        version: 1,
        type: 'agent_invoked',
        ts: '2026-04-29T17:00:00Z',
        runId: RUN,
        phase: 'define',
        agent: 'ba',
        provider: 'fake',
        manifest: { files: [] },
        filesSent: 0,
        bytesSent: 0,
        tokensEstimate: 80,
        fieldsRemovedByScope: 0,
      },
      {
        version: 1,
        type: 'agent_completed',
        ts: '2026-04-29T17:01:00Z',
        runId: RUN,
        phase: 'define',
        agent: 'ba',
        tokensUsed: 80,
      },
    ]
    let caught: ProviderError | null = null
    try {
      assertWithinBudget(config, req(), prepared(50), events)
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_budget_exceeded')
    expect(caught?.issues[0]?.rule).toContain('global maxTokensEstimate')
  })

  test('per-phase turns fit but global turns would breach → provider_budget_exceeded (global)', () => {
    const config = tinyConfig({ maxTurns: 2 })
    // Three phase_entered events across different phases — global cap exceeded.
    const events: LoggedEvent[] = [
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'define' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:01:00Z', runId: RUN, phase: 'plan' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:02:00Z', runId: RUN, phase: 'build' },
    ]
    let caught: ProviderError | null = null
    try {
      assertWithinBudget(config, req(), prepared(0), events)
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_budget_exceeded')
    expect(caught?.issues[0]?.rule).toContain('global maxTurns')
  })

  test('per-phase provider calls fit but global provider calls would breach', () => {
    const config = tinyConfig({ maxProviderCalls: 2 })
    const inv = (phase: 'define' | 'plan' | 'build', agent: string): LoggedEvent => ({
      version: 1,
      type: 'agent_invoked',
      ts: `2026-04-29T17:00:0${agent}Z`,
      runId: RUN,
      phase,
      agent,
      provider: 'fake',
      manifest: { files: [] },
      filesSent: 0,
      bytesSent: 0,
      tokensEstimate: 0,
      fieldsRemovedByScope: 0,
    })
    const events: LoggedEvent[] = [inv('define', '1'), inv('plan', '2')]
    // Next call would push global to 3 > cap=2.
    let caught: ProviderError | null = null
    try {
      assertWithinBudget(config, req(), prepared(0), events)
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_budget_exceeded')
    expect(caught?.issues[0]?.rule).toContain('global maxProviderCalls')
  })

  test('all caps satisfied → no throw', () => {
    expect(() => assertWithinBudget(DEFAULT_CONFIG, req(), prepared(10), [])).not.toThrow()
  })
})
