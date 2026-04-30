import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendEvent,
  readEvents,
  validateEvent,
  type EventLogPaths,
} from '../src/state/events.ts'
import { EventLogError } from '../src/state/errors.ts'
import {
  EVENT_TYPES,
  generateUlid,
  type PhaseEvent,
} from '../src/state/schemas.ts'
import {
  initRun,
  reduceEvents,
  requireGate,
  runPathsFor,
  type RunPaths,
} from '../src/state/run.ts'

const FILE = '<test-fixture>'
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-askme-events-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function makePaths(): RunPaths {
  return runPathsFor(join(tmp, 'state'), join(tmp, 'artifacts'), RUN)
}

describe('EVENT_TYPES — ask-me variants are registered', () => {
  test('ask_me_user_input is in EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('ask_me_user_input')
  })
  test('ask_me_persona_reply is in EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('ask_me_persona_reply')
  })
})

describe('validateEvent — ask_me_user_input', () => {
  function valid(overrides: Partial<Record<string, unknown>> = {}): unknown {
    return {
      version: 1,
      type: 'ask_me_user_input',
      ts: '2026-04-30T12:00:00.000Z',
      runId: RUN,
      phase: 'define',
      turn: 0,
      input: 'Build me a baby naming game.',
      ...overrides,
    }
  }

  test('accepts a valid event', () => {
    expect(validateEvent(valid(), FILE)).toBeNull()
  })

  test('rejects non-canonical phase', () => {
    const issue = validateEvent(valid({ phase: 'bogus' }), FILE)
    expect(issue?.code).toBe('event_invalid_phase')
  })

  test('rejects negative turn', () => {
    const issue = validateEvent(valid({ turn: -1 }), FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('turn')
  })

  test('rejects non-integer turn', () => {
    const issue = validateEvent(valid({ turn: 1.5 }), FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })

  test('rejects empty input', () => {
    const issue = validateEvent(valid({ input: '' }), FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('non-empty string')
  })

  test('rejects missing input', () => {
    const issue = validateEvent(valid({ input: undefined }), FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })
})

describe('validateEvent — ask_me_persona_reply', () => {
  function valid(overrides: Partial<Record<string, unknown>> = {}): unknown {
    return {
      version: 1,
      type: 'ask_me_persona_reply',
      ts: '2026-04-30T12:00:01.000Z',
      runId: RUN,
      phase: 'define',
      turn: 0,
      agent: 'ba',
      response: 'What age range is the game for?',
      ready: false,
      ...overrides,
    }
  }

  test('accepts a valid event with ready=false', () => {
    expect(validateEvent(valid(), FILE)).toBeNull()
  })

  test('accepts a valid event with ready=true', () => {
    expect(validateEvent(valid({ ready: true }), FILE)).toBeNull()
  })

  test('rejects empty response', () => {
    const issue = validateEvent(valid({ response: '' }), FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('non-empty string')
  })

  test('rejects non-boolean ready', () => {
    const issue = validateEvent(valid({ ready: 'yes' }), FILE)
    expect(issue?.code).toBe('event_invalid_value')
    expect(issue?.rule).toContain('boolean')
  })

  test('rejects empty agent', () => {
    const issue = validateEvent(valid({ agent: '' }), FILE)
    expect(issue?.code).toBe('event_invalid_value')
  })
})

describe('reducer — ask-me events are no-ops', () => {
  test('ask_me events do not advance phase or alter state', () => {
    const ts = (n: number) => `2026-04-30T12:00:${String(n).padStart(2, '0')}.000Z`
    const events: PhaseEvent[] = [
      { version: 1, type: 'run_started', ts: ts(0), runId: RUN, profile: 'greenfield' },
      { version: 1, type: 'phase_entered', ts: ts(1), runId: RUN, phase: 'define' },
      {
        version: 1,
        type: 'ask_me_user_input',
        ts: ts(2),
        runId: RUN,
        phase: 'define',
        turn: 0,
        input: 'help',
      },
      {
        version: 1,
        type: 'ask_me_persona_reply',
        ts: ts(3),
        runId: RUN,
        phase: 'define',
        turn: 0,
        agent: 'ba',
        response: 'what?',
        ready: false,
      },
    ]
    const state = reduceEvents(events)
    expect(state).not.toBeNull()
    expect(state!.currentPhase).toBe('define')
    expect(state!.phasesCompleted.length).toBe(0)
  })
})

describe('appendEvent integration — ask_me events round-trip on disk', () => {
  test('append + read back ask_me_user_input + ask_me_persona_reply', async () => {
    const paths: EventLogPaths = {
      file: join(tmp, 'events.jsonl'),
      lockDir: join(tmp, '.lock'),
    }
    const ts = '2026-04-30T12:00:00.000Z'
    await appendEvent(paths, {
      version: 1,
      type: 'ask_me_user_input',
      ts,
      runId: RUN,
      phase: 'define',
      turn: 0,
      input: 'I want a thing',
    })
    await appendEvent(paths, {
      version: 1,
      type: 'ask_me_persona_reply',
      ts,
      runId: RUN,
      phase: 'define',
      turn: 0,
      agent: 'ba',
      response: 'what kind?',
      ready: false,
    })
    const events = await readEvents(paths)
    expect(events.length).toBe(2)
    expect(events[0]!.type).toBe('ask_me_user_input')
    expect(events[1]!.type).toBe('ask_me_persona_reply')
  })

  test('rejects malformed ask_me_user_input on read (validateEvent fires inside readEvents)', async () => {
    const paths: EventLogPaths = {
      file: join(tmp, 'events.jsonl'),
      lockDir: join(tmp, '.lock'),
    }
    const ts = '2026-04-30T12:00:00.000Z'
    // Hand-craft a malformed event (empty input) by appending raw JSON with
    // appendEvent's bypass — we use appendEvent on a valid event first, then
    // patch the file with a bad line.
    await appendEvent(paths, {
      version: 1,
      type: 'ask_me_user_input',
      ts,
      runId: RUN,
      phase: 'define',
      turn: 0,
      input: 'real',
    })
    const fs = await import('node:fs/promises')
    const bad = JSON.stringify({
      version: 1,
      type: 'ask_me_user_input',
      ts,
      runId: RUN,
      phase: 'define',
      turn: 1,
      input: '',
    })
    await fs.appendFile(paths.file, bad + '\n', 'utf8')

    let err: unknown
    try {
      await readEvents(paths)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(EventLogError)
  })
})

describe('requireGate', () => {
  test('appends a gate_required event and rebuilds current.json', async () => {
    const paths = makePaths()
    await initRun({ paths, profile: 'greenfield', runId: RUN })
    const result = await requireGate({
      paths,
      runId: RUN,
      phase: 'define',
      blockedOn: 'user approval via `code-oz approve define`',
    })
    expect(result.appended).toBe(true)
    expect(result.state.currentPhase).toBe('define')
    const events = await readEvents({
      file: paths.eventsFile,
      lockDir: paths.lockDir,
    })
    const gateRequired = events.filter((e) => e.type === 'gate_required')
    expect(gateRequired.length).toBe(1)
  })

  test('idempotent: second call is a no-op', async () => {
    const paths = makePaths()
    await initRun({ paths, profile: 'greenfield', runId: RUN })
    const a = await requireGate({
      paths,
      runId: RUN,
      phase: 'define',
      blockedOn: 'user approval',
    })
    expect(a.appended).toBe(true)
    const b = await requireGate({
      paths,
      runId: RUN,
      phase: 'define',
      blockedOn: 'user approval',
    })
    expect(b.appended).toBe(false)
    const events = await readEvents({
      file: paths.eventsFile,
      lockDir: paths.lockDir,
    })
    const gateRequired = events.filter((e) => e.type === 'gate_required')
    expect(gateRequired.length).toBe(1)
  })

  test('rejects non-canonical phase', async () => {
    const paths = makePaths()
    await initRun({ paths, profile: 'greenfield', runId: RUN })
    let err: unknown
    try {
      await requireGate({
        paths,
        runId: RUN,
        phase: 'bogus' as 'define',
        blockedOn: 'x',
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(EventLogError)
  })

  test('rejects empty blockedOn', async () => {
    const paths = makePaths()
    await initRun({ paths, profile: 'greenfield', runId: RUN })
    let err: unknown
    try {
      await requireGate({ paths, runId: RUN, phase: 'define', blockedOn: '' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(EventLogError)
  })

  test('rejects malformed runId', async () => {
    const paths = makePaths()
    await initRun({ paths, profile: 'greenfield', runId: RUN })
    let err: unknown
    try {
      await requireGate({
        paths,
        runId: 'not-a-ulid',
        phase: 'define',
        blockedOn: 'x',
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(EventLogError)
  })
})
