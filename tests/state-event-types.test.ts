import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendEvent,
  readEvents,
  validateEvent,
} from '../src/state/events.ts'
import { EVENT_TYPES, type PhaseEvent } from '../src/state/schemas.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'
const PHASE = 'plan'
const TS = '2026-04-30T10:00:00.000Z'

async function withRunDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'codeoz-evt-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const REPO_CONTEXT_EVENT: PhaseEvent = {
  version: 1,
  type: 'repo_context_searched',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  agent: 'lead',
  tool: 'glob',
  query: '**/*.ts',
  roots: ['.'],
  resultPaths: ['src/a.ts', 'src/b.ts'],
  selectedPaths: ['src/a.ts'],
  resultBytes: 4096,
  resultTokensEstimate: 1024,
}

const SCIENCE_EVENT: PhaseEvent = {
  version: 1,
  type: 'science_emitted',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  hypothesesCount: 2,
  openQuestionsCount: 1,
}

const HYP_ADDED: PhaseEvent = {
  version: 1,
  type: 'hypothesis_added',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  id: 'H-001',
  status: 'open',
  falsifier: 'A test that observes a half-write.',
}

const HYP_UPDATED: PhaseEvent = {
  version: 1,
  type: 'hypothesis_updated',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  id: 'H-001',
  prevStatus: 'open',
  nextStatus: 'confirmed',
  changedFields: ['status'],
}

const Q_ADDED: PhaseEvent = {
  version: 1,
  type: 'question_added',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  id: 'Q-001',
  status: 'open',
  importance: 'medium',
  dueBy: '2026-05-15',
}

const Q_RESOLVED: PhaseEvent = {
  version: 1,
  type: 'question_resolved',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  id: 'Q-002',
  resolvedAt: '2026-04-30',
  resolution: 'clean-room reuse approved',
}

const Q_DEFERRED: PhaseEvent = {
  version: 1,
  type: 'question_deferred',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  id: 'Q-003',
  deferredAt: '2026-04-30',
}

const BUDGET_WARN: PhaseEvent = {
  version: 1,
  type: 'budget_warning',
  ts: TS,
  runId: RUN_ID,
  metric: 'maxTokensEstimate',
  ratio: 0.78,
  current: 78000,
  limit: 100000,
}

describe('EVENT_TYPES', () => {
  test('includes the M6 additions', () => {
    expect(EVENT_TYPES).toContain('repo_context_searched')
    expect(EVENT_TYPES).toContain('science_emitted')
    expect(EVENT_TYPES).toContain('hypothesis_added')
    expect(EVENT_TYPES).toContain('hypothesis_updated')
    expect(EVENT_TYPES).toContain('question_added')
    expect(EVENT_TYPES).toContain('question_resolved')
    expect(EVENT_TYPES).toContain('question_deferred')
    expect(EVENT_TYPES).toContain('budget_warning')
  })
})

describe('validateEvent — happy path', () => {
  test('accepts repo_context_searched', () => {
    expect(validateEvent(REPO_CONTEXT_EVENT, 'events.jsonl')).toBeNull()
  })
  test('accepts science_emitted', () => {
    expect(validateEvent(SCIENCE_EVENT, 'events.jsonl')).toBeNull()
  })
  test('accepts hypothesis_added', () => {
    expect(validateEvent(HYP_ADDED, 'events.jsonl')).toBeNull()
  })
  test('accepts hypothesis_updated', () => {
    expect(validateEvent(HYP_UPDATED, 'events.jsonl')).toBeNull()
  })
  test('accepts question_added with null dueBy', () => {
    expect(validateEvent({ ...Q_ADDED, dueBy: null }, 'events.jsonl')).toBeNull()
  })
  test('accepts question_resolved', () => {
    expect(validateEvent(Q_RESOLVED, 'events.jsonl')).toBeNull()
  })
  test('accepts question_deferred', () => {
    expect(validateEvent(Q_DEFERRED, 'events.jsonl')).toBeNull()
  })
  test('accepts budget_warning', () => {
    expect(validateEvent(BUDGET_WARN, 'events.jsonl')).toBeNull()
  })
})

describe('validateEvent — rejections', () => {
  test('rejects repo_context_searched with bad tool', () => {
    const issue = validateEvent({ ...REPO_CONTEXT_EVENT, tool: 'web' as 'glob' }, 'events.jsonl')
    expect(issue).not.toBeNull()
  })

  test('rejects repo_context_searched with non-array roots', () => {
    const issue = validateEvent(
      { ...REPO_CONTEXT_EVENT, roots: '.' as unknown as readonly string[] },
      'events.jsonl',
    )
    expect(issue).not.toBeNull()
  })

  test('rejects repo_context_searched with negative bytes', () => {
    const issue = validateEvent({ ...REPO_CONTEXT_EVENT, resultBytes: -1 }, 'events.jsonl')
    expect(issue).not.toBeNull()
  })

  test('rejects hypothesis_added with malformed id', () => {
    const issue = validateEvent({ ...HYP_ADDED, id: 'HYP-1' }, 'events.jsonl')
    expect(issue).not.toBeNull()
  })

  test('rejects hypothesis_added with bad status', () => {
    const issue = validateEvent(
      { ...HYP_ADDED, status: 'pending' as 'open' },
      'events.jsonl',
    )
    expect(issue).not.toBeNull()
  })

  test('rejects question_added with bad importance', () => {
    const issue = validateEvent(
      { ...Q_ADDED, importance: 'huge' as 'low' },
      'events.jsonl',
    )
    expect(issue).not.toBeNull()
  })

  test('rejects question_added with malformed dueBy', () => {
    const issue = validateEvent({ ...Q_ADDED, dueBy: 'tomorrow' }, 'events.jsonl')
    expect(issue).not.toBeNull()
  })

  test('rejects budget_warning with ratio > 1', () => {
    const issue = validateEvent({ ...BUDGET_WARN, ratio: 1.5 }, 'events.jsonl')
    expect(issue).not.toBeNull()
  })

  test('rejects budget_warning with bad metric', () => {
    const issue = validateEvent(
      { ...BUDGET_WARN, metric: 'maxFoo' as 'maxTurns' },
      'events.jsonl',
    )
    expect(issue).not.toBeNull()
  })
})

describe('appendEvent + readEvents round-trip', () => {
  test('round-trips all M6 events through events.jsonl', async () => {
    await withRunDir(async (dir) => {
      const paths = {
        file: join(dir, 'events.jsonl'),
        lockDir: join(dir, '.lock'),
      }
      const events: PhaseEvent[] = [
        REPO_CONTEXT_EVENT,
        SCIENCE_EVENT,
        HYP_ADDED,
        HYP_UPDATED,
        Q_ADDED,
        Q_RESOLVED,
        Q_DEFERRED,
        BUDGET_WARN,
      ]
      for (const e of events) {
        await appendEvent(paths, e)
      }
      const read = await readEvents(paths)
      expect(read.length).toBe(events.length)
      expect(read.map((e) => e.type)).toEqual(events.map((e) => e.type))
    })
  })
})
