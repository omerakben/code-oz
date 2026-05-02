// M13 Commit 2: event-schema validators for role + cost fields.
//
// Codex Q6 + Q8 + Q9 locks (CODEX_RESPONSE_M13.md, thread 019de672):
// extend agent_invoked / agent_completed / budget_warning with optional
// role + cost fields; defensive validators mirror M12 agent_invoked.model.

import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { M12_COMPANY_ROLES } from '../src/config/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FILE = '/tmp/events.jsonl'

const baseInvoked = {
  version: 1,
  type: 'agent_invoked',
  ts: '2026-05-01T12:00:00Z',
  runId: RUN,
  phase: 'build',
  agent: 'builder',
  provider: 'claude',
  manifest: { files: [] },
  filesSent: 0,
  bytesSent: 0,
  tokensEstimate: 1000,
  fieldsRemovedByScope: 0,
} as const

const baseCompleted = {
  version: 1,
  type: 'agent_completed',
  ts: '2026-05-01T12:00:01Z',
  runId: RUN,
  phase: 'build',
  agent: 'builder',
} as const

const baseWarning = {
  version: 1,
  type: 'budget_warning',
  ts: '2026-05-01T12:00:00Z',
  runId: RUN,
  metric: 'maxTokensEstimate',
  ratio: 0.8,
  current: 800,
  limit: 1000,
} as const

describe('agent_invoked.role validator', () => {
  test('absent role passes (back-compat)', () => {
    expect(validateEvent(baseInvoked, FILE)).toBeNull()
  })

  test('every canonical role passes', () => {
    for (const role of M12_COMPANY_ROLES) {
      expect(validateEvent({ ...baseInvoked, role }, FILE)).toBeNull()
    }
  })

  test('non-canonical role is rejected', () => {
    const issue = validateEvent({ ...baseInvoked, role: 'agile-coach' }, FILE)
    expect(issue).toMatchObject({
      code: 'event_invalid_value',
      rule: expect.stringContaining('agent_invoked.role'),
    })
  })

  test('numeric role is rejected', () => {
    const issue = validateEvent({ ...baseInvoked, role: 7 }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('empty-string role is rejected', () => {
    const issue = validateEvent({ ...baseInvoked, role: '' }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })
})

describe('agent_invoked.costEstimateUSD validator', () => {
  test('absent passes', () => {
    expect(validateEvent(baseInvoked, FILE)).toBeNull()
  })

  test('zero passes (free-tier model)', () => {
    expect(validateEvent({ ...baseInvoked, costEstimateUSD: 0 }, FILE)).toBeNull()
  })

  test('finite positive passes', () => {
    expect(validateEvent({ ...baseInvoked, costEstimateUSD: 1.234567 }, FILE)).toBeNull()
  })

  test('negative is rejected', () => {
    const issue = validateEvent({ ...baseInvoked, costEstimateUSD: -0.01 }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('finite non-negative')
  })

  test('NaN is rejected', () => {
    const issue = validateEvent({ ...baseInvoked, costEstimateUSD: NaN }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('Infinity is rejected', () => {
    const issue = validateEvent({ ...baseInvoked, costEstimateUSD: Infinity }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('non-number is rejected', () => {
    const issue = validateEvent({ ...baseInvoked, costEstimateUSD: '1.5' }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })
})

describe('agent_completed.costActualUSD validator', () => {
  test('absent passes', () => {
    expect(validateEvent(baseCompleted, FILE)).toBeNull()
  })

  test('finite non-negative passes', () => {
    expect(validateEvent({ ...baseCompleted, costActualUSD: 0.5 }, FILE)).toBeNull()
  })

  test('NaN is rejected', () => {
    const issue = validateEvent({ ...baseCompleted, costActualUSD: NaN }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('Infinity is rejected', () => {
    const issue = validateEvent({ ...baseCompleted, costActualUSD: -Infinity }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('negative is rejected', () => {
    const issue = validateEvent({ ...baseCompleted, costActualUSD: -1 }, FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })
})

describe('budget_warning.role validator', () => {
  test('absent role passes (existing global warnings)', () => {
    expect(validateEvent(baseWarning, FILE)).toBeNull()
  })

  test('canonical role with maxProviderCalls metric passes', () => {
    const ev = { ...baseWarning, metric: 'maxProviderCalls', role: 'builder' }
    expect(validateEvent(ev, FILE)).toBeNull()
  })

  test('canonical role with maxTokensEstimate metric passes', () => {
    expect(validateEvent({ ...baseWarning, role: 'reviewer' }, FILE)).toBeNull()
  })

  test('canonical role with maxTurns metric is rejected (no per-role dimension)', () => {
    const ev = { ...baseWarning, metric: 'maxTurns', role: 'builder' }
    const issue = validateEvent(ev, FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('per-role dimension')
  })

  test('canonical role with maxWallTimeMinutes is rejected (no per-role dimension)', () => {
    const ev = { ...baseWarning, metric: 'maxWallTimeMinutes', role: 'builder' }
    const issue = validateEvent(ev, FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('per-role dimension')
  })

  test('non-canonical role is rejected', () => {
    const ev = { ...baseWarning, role: 'agile-coach' }
    const issue = validateEvent(ev, FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('budget_warning.role')
  })
})
