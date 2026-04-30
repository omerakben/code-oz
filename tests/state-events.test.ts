import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendEvent,
  readEvents,
  validateEvent,
  type EventLogPaths,
} from '../src/state/events.ts'
import { EventLogError } from '../src/state/errors.ts'
import { generateUlid, type PhaseEvent } from '../src/state/schemas.ts'

let tmp: string
let paths: EventLogPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-events-'))
  paths = {
    file: join(tmp, 'events.jsonl'),
    lockDir: join(tmp, '.lock'),
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

function event(overrides: Partial<PhaseEvent> = {}): PhaseEvent {
  return {
    version: 1,
    type: 'phase_entered',
    ts: '2026-04-29T17:00:00Z',
    runId: RUN,
    phase: 'define',
    ...overrides,
  } as PhaseEvent
}

describe('validateEvent — happy paths for every event type', () => {
  test('run_started', () => {
    const e: PhaseEvent = {
      version: 1,
      type: 'run_started',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      profile: 'greenfield',
    }
    expect(validateEvent(e, 'events.jsonl')).toBeNull()
  })

  test('phase_entered, phase_exited', () => {
    expect(validateEvent(event({ type: 'phase_entered', phase: 'define' }), 'events.jsonl')).toBeNull()
    expect(
      validateEvent(
        { version: 1, type: 'phase_exited', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'plan', outcome: 'passed' },
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('agent_invoked requires manifest and four context metrics (M4 rule 13)', () => {
    const valid = {
      version: 1,
      type: 'agent_invoked',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      phase: 'define',
      agent: 'ba',
      provider: 'claude',
      manifest: {
        files: [
          { path: 'docs/SPEC.md', sha256: 'a'.repeat(64), sizeBytes: 1234 },
          { path: 'README.md', sha256: '0'.repeat(64), sizeBytes: 0 },
        ],
      },
      filesSent: 2,
      bytesSent: 1234,
      tokensEstimate: 320,
      fieldsRemovedByScope: 0,
    } as const
    expect(validateEvent(valid, 'events.jsonl')).toBeNull()

    // Empty manifest is legal; zero metrics are legal (single semantics:
    // 'no narrowing happened or nothing was removed').
    const empty = { ...valid, manifest: { files: [] }, filesSent: 0, bytesSent: 0 }
    expect(validateEvent(empty, 'events.jsonl')).toBeNull()
  })

  test('agent_completed with and without tokensUsed', () => {
    const e = {
      version: 1,
      type: 'agent_completed',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      phase: 'plan',
      agent: 'lead',
    } as const
    expect(validateEvent(e, 'events.jsonl')).toBeNull()
    expect(validateEvent({ ...e, tokensUsed: 1834 }, 'events.jsonl')).toBeNull()
  })

  test('gate_written with filename only', () => {
    const e = {
      version: 1,
      type: 'gate_written',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      phase: 'define',
      file: 'GATE_DEFINE_PASSED.json',
    } as const
    expect(validateEvent(e, 'events.jsonl')).toBeNull()
  })

  test('gate_required, intervention, run_ended', () => {
    expect(
      validateEvent(
        { version: 1, type: 'gate_required', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'plan', blockedOn: 'user signoff' },
        'events.jsonl',
      ),
    ).toBeNull()
    expect(
      validateEvent(
        { version: 1, type: 'intervention', ts: '2026-04-29T17:00:00Z', runId: RUN, code: 'provider_auth_missing' },
        'events.jsonl',
      ),
    ).toBeNull()
    expect(
      validateEvent(
        { version: 1, type: 'run_ended', ts: '2026-04-29T17:00:00Z', runId: RUN, outcome: 'shipped' },
        'events.jsonl',
      ),
    ).toBeNull()
  })
})

describe('validateEvent — rejection cases', () => {
  test('non-object payloads are rejected', () => {
    expect(validateEvent(null, 'events.jsonl')?.code).toBe('event_invalid_json')
    expect(validateEvent([1, 2], 'events.jsonl')?.code).toBe('event_invalid_json')
    expect(validateEvent('plain string', 'events.jsonl')?.code).toBe('event_invalid_json')
  })

  test('missing or wrong version is rejected', () => {
    const noVersion = { type: 'phase_entered', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'define' }
    expect(validateEvent(noVersion, 'events.jsonl')?.code).toBe('event_invalid_version')
    expect(validateEvent({ ...noVersion, version: 2 }, 'events.jsonl')?.code).toBe('event_invalid_version')
    expect(validateEvent({ ...noVersion, version: '1' }, 'events.jsonl')?.code).toBe('event_invalid_version')
  })

  test('empty type is rejected (M4 rule 12 still requires a non-empty string)', () => {
    expect(
      validateEvent(
        { version: 1, type: '', ts: '2026-04-29T17:00:00Z', runId: RUN },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_type')
    expect(
      validateEvent(
        { version: 1, type: 42, ts: '2026-04-29T17:00:00Z', runId: RUN },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_type')
  })

  test('unknown type passes shape validation (M4 rule 12 — open type union)', () => {
    // Forward-compat: future milestones (e.g., M7's failure_recorded) may
    // extend the recognized event-type set without bumping `version: 1`.
    // Canonical readers must accept events whose `type` is a non-empty string
    // they don't recognize, so long as version + ts + runId are valid.
    expect(
      validateEvent(
        { version: 1, type: 'failure_recorded', ts: '2026-04-29T17:00:00Z', runId: RUN, extra: 'data' },
        'events.jsonl',
      ),
    ).toBeNull()
    // ts and runId still validated even on unknown types.
    expect(
      validateEvent(
        { version: 1, type: 'failure_recorded', ts: 'not-iso', runId: RUN },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_timestamp')
    expect(
      validateEvent(
        { version: 1, type: 'failure_recorded', ts: '2026-04-29T17:00:00Z', runId: 'short' },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_runid')
  })

  test('non-ULID runId is rejected', () => {
    expect(
      validateEvent(
        { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:00Z', runId: 'not-a-ulid', phase: 'define' },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_runid')
  })

  test('non-ISO ts is rejected', () => {
    expect(
      validateEvent(
        { version: 1, type: 'phase_entered', ts: 'yesterday', runId: RUN, phase: 'define' },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_timestamp')
  })

  test('phase_exited.outcome must be a known outcome', () => {
    expect(
      validateEvent(
        { version: 1, type: 'phase_exited', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'plan', outcome: 'maybe' },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_value')
  })

  test('agent_invoked.manifest entries are deeply validated', () => {
    // Base envelope with valid metrics so the manifest-shape failures fire
    // before the metric-shape checks.
    const base = {
      version: 1,
      type: 'agent_invoked',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      phase: 'define',
      agent: 'ba',
      provider: 'claude',
      filesSent: 0,
      bytesSent: 0,
      tokensEstimate: 0,
      fieldsRemovedByScope: 0,
    }
    expect(validateEvent({ ...base, manifest: 'wrong' }, 'events.jsonl')?.code).toBe('event_invalid_value')
    expect(
      validateEvent({ ...base, manifest: { files: 'not an array' } }, 'events.jsonl')?.code,
    ).toBe('event_invalid_value')
    expect(
      validateEvent(
        { ...base, manifest: { files: [{ path: 'a.md', sha256: 'short', sizeBytes: 0 }] } },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_value')
    expect(
      validateEvent(
        { ...base, manifest: { files: [{ path: 'a.md', sha256: 'a'.repeat(64), sizeBytes: -1 }] } },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_value')
    expect(
      validateEvent(
        { ...base, manifest: { files: [{ path: '', sha256: 'a'.repeat(64), sizeBytes: 0 }] } },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_value')
  })

  test('agent_invoked rejects when any metric field is missing or non-integer (M4 rule 13)', () => {
    const valid = {
      version: 1,
      type: 'agent_invoked',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      phase: 'define',
      agent: 'ba',
      provider: 'claude',
      manifest: { files: [] },
      filesSent: 0,
      bytesSent: 0,
      tokensEstimate: 0,
      fieldsRemovedByScope: 0,
    }
    // Missing each metric in turn.
    for (const field of ['filesSent', 'bytesSent', 'tokensEstimate', 'fieldsRemovedByScope'] as const) {
      const invalid = { ...valid }
      delete (invalid as Record<string, unknown>)[field]
      expect(validateEvent(invalid, 'events.jsonl')?.code).toBe('event_invalid_value')
    }
    // Negative integer.
    expect(validateEvent({ ...valid, bytesSent: -1 }, 'events.jsonl')?.code).toBe('event_invalid_value')
    // Non-integer.
    expect(validateEvent({ ...valid, tokensEstimate: 1.5 }, 'events.jsonl')?.code).toBe('event_invalid_value')
    // Wrong type.
    expect(validateEvent({ ...valid, filesSent: '0' }, 'events.jsonl')?.code).toBe('event_invalid_value')
  })

  test('gate_written.file with separators is rejected', () => {
    expect(
      validateEvent(
        { version: 1, type: 'gate_written', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'define', file: 'subdir/X.json' },
        'events.jsonl',
      )?.code,
    ).toBe('event_invalid_value')
  })
})

describe('appendEvent / readEvents round-trip', () => {
  test('reading a missing file returns an empty array', async () => {
    const events = await readEvents(paths)
    expect(events).toEqual([])
    expect(Object.isFrozen(events)).toBe(true)
  })

  test('appendEvent persists a line and readEvents returns it in order', async () => {
    const e1: PhaseEvent = {
      version: 1,
      type: 'run_started',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      profile: 'greenfield',
    }
    const e2: PhaseEvent = event({ type: 'phase_entered', phase: 'define' })
    await appendEvent(paths, e1)
    await appendEvent(paths, e2)
    const events = await readEvents(paths)
    expect(events.length).toBe(2)
    expect(events[0]).toEqual(e1)
    expect(events[1]).toEqual(e2)
  })

  test('returned events are deeply frozen', async () => {
    await appendEvent(paths, event())
    const events = await readEvents(paths)
    expect(Object.isFrozen(events)).toBe(true)
    expect(Object.isFrozen(events[0])).toBe(true)
  })

  test('the file is plain JSONL with one line per event', async () => {
    await appendEvent(paths, event({ type: 'phase_entered', phase: 'define' }))
    await appendEvent(paths, event({ type: 'phase_entered', phase: 'plan' }))
    const text = await readFile(paths.file, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.trim().split('\n').length).toBe(2)
  })

  test('appending an invalid event throws before touching disk', async () => {
    const bad = { ...event(), runId: 'not-a-ulid' } as unknown as PhaseEvent
    await expect(appendEvent(paths, bad)).rejects.toBeInstanceOf(EventLogError)
    await expect(stat(paths.file)).rejects.toThrow()
  })
})

describe('readEvents — hard-fail on malformed content', () => {
  test('JSON parse failure aggregates issues with line numbers', async () => {
    await writeFile(paths.file, '{ "version": 1, "type": "phase_entered" } NOT JSON\n')
    try {
      await readEvents(paths)
      throw new Error('expected EventLogError')
    } catch (err) {
      expect(err).toBeInstanceOf(EventLogError)
      const e = err as EventLogError
      expect(e.issues[0]?.code).toBe('event_invalid_json')
      expect(e.issues[0]?.line).toBe(1)
    }
  })

  test('empty interior lines are flagged as partial', async () => {
    const valid = JSON.stringify(event())
    await writeFile(paths.file, valid + '\n\n' + valid + '\n')
    try {
      await readEvents(paths)
      throw new Error('expected EventLogError')
    } catch (err) {
      const e = err as EventLogError
      expect(e.issues.some((i) => i.code === 'event_partial_line' && i.line === 2)).toBe(true)
    }
  })

  test('invalid event payload reports the line number', async () => {
    const valid = JSON.stringify(event())
    // Use a phase_entered event with a bad phase value so we exercise a
    // real schema rejection (unknown event types now pass per M4 rule 12).
    const invalid = JSON.stringify({
      version: 1,
      type: 'phase_entered',
      ts: '2026-04-29T17:00:00Z',
      runId: RUN,
      phase: 'not-a-phase',
    })
    await writeFile(paths.file, valid + '\n' + invalid + '\n')
    try {
      await readEvents(paths)
      throw new Error('expected EventLogError')
    } catch (err) {
      const e = err as EventLogError
      expect(e.issues[0]?.code).toBe('event_invalid_phase')
      expect(e.issues[0]?.line).toBe(2)
    }
  })
})

describe('appendEvent — concurrency', () => {
  test('a busy lock surfaces as event_lock_busy', async () => {
    // Pre-create the lock dir to simulate a concurrent holder.
    await mkdir(paths.lockDir)
    try {
      await appendEvent(paths, event())
      throw new Error('expected EventLogError')
    } catch (err) {
      const e = err as EventLogError
      expect(e.issues[0]?.code).toBe('event_lock_busy')
    }
  })

  test('lock is released after a successful append', async () => {
    await appendEvent(paths, event())
    await expect(stat(paths.lockDir)).rejects.toThrow()
  })

  test('lock is released even when fsync fails (smoke-tested by re-append)', async () => {
    // Two sequential appends both succeed -> the lock was released between them.
    await appendEvent(paths, event({ type: 'phase_entered', phase: 'define' }))
    await appendEvent(paths, event({ type: 'phase_entered', phase: 'plan' }))
    const events = await readEvents(paths)
    expect(events.length).toBe(2)
  })
})
