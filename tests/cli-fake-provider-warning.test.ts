// `--provider fake` warning surface tests (M16 C11).
//
// Coverage:
//   - Banner content + line count + divider.
//   - `recordFakeProviderWarning` appends a schema-valid event with the
//     expected fields (alias, family, optional fakeScriptPath).
//   - Validator rejects malformed payloads.
//   - Banner stream-injection seam — captures bytes into a buffer.
//   - End-to-end through the in-process `runCommand` is exercised by the
//     CLI e2e (M16 C12); this file pins the unit-level invariants.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FAKE_PROVIDER_BANNER_DIVIDER,
  FAKE_PROVIDER_BANNER_LINES,
  printFakeProviderBanner,
  recordFakeProviderWarning,
} from '../src/cli/fake-provider-warning.ts'
import {
  appendEvent,
  readEvents,
  validateEvent,
  type EventLogPaths,
} from '../src/state/events.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_TS = '2026-05-09T13:00:00.000Z'

let tmp: string
let eventPaths: EventLogPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-c11-'))
  await mkdir(tmp, { recursive: true })
  eventPaths = {
    file: join(tmp, 'events.jsonl'),
    lockDir: join(tmp, '.lock'),
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Banner content
// ---------------------------------------------------------------------------
describe('printFakeProviderBanner — content and shape', () => {
  test('banner contains the LOUD divider on first and last line', () => {
    expect(FAKE_PROVIDER_BANNER_LINES[0]).toBe(FAKE_PROVIDER_BANNER_DIVIDER)
    expect(FAKE_PROVIDER_BANNER_LINES[FAKE_PROVIDER_BANNER_LINES.length - 1]).toBe(
      FAKE_PROVIDER_BANNER_DIVIDER,
    )
  })

  test('banner mentions --provider fake + production safety', () => {
    const txt = FAKE_PROVIDER_BANNER_LINES.join('\n')
    expect(txt).toContain('--provider fake')
    expect(txt).toContain('TEST-ONLY')
    expect(txt).toContain('production')
  })

  test('writes every line to the injected stream', () => {
    const captured: string[] = []
    const stream = {
      write: (chunk: string) => {
        captured.push(chunk)
        return true
      },
    }
    printFakeProviderBanner(stream)
    expect(captured).toHaveLength(FAKE_PROVIDER_BANNER_LINES.length)
    expect(captured[0]).toBe(FAKE_PROVIDER_BANNER_DIVIDER + '\n')
    expect(captured[1]).toContain('WARNING: --provider fake is active')
  })
})

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------
describe('recordFakeProviderWarning — event emission', () => {
  test('appends one fake_provider_warning_emitted event', async () => {
    await recordFakeProviderWarning({
      eventPaths,
      runId: RUN,
      now: () => FIXED_TS,
    })
    const events = await readEvents(eventPaths)
    expect(events).toHaveLength(1)
    const e = events[0]!
    expect(isKnownPhaseEvent(e)).toBe(true)
    if (!isKnownPhaseEvent(e) || e.type !== 'fake_provider_warning_emitted') {
      throw new Error('expected fake_provider_warning_emitted')
    }
    expect(e.runId).toBe(RUN)
    expect(e.providerAlias).toBe('fake')
    expect(e.providerFamily).toBe('fake')
    expect(e.ts).toBe(FIXED_TS)
    expect(e.fakeScriptPath).toBeUndefined()
  })

  test('carries fakeScriptPath when provided', async () => {
    await recordFakeProviderWarning({
      eventPaths,
      runId: RUN,
      fakeScriptPath: '/tmp/fixture.jsonl',
      now: () => FIXED_TS,
    })
    const events = await readEvents(eventPaths)
    if (!isKnownPhaseEvent(events[0]!) || events[0]!.type !== 'fake_provider_warning_emitted') {
      throw new Error('expected fake_provider_warning_emitted')
    }
    expect(events[0]!.fakeScriptPath).toBe('/tmp/fixture.jsonl')
  })

  test('two consecutive emissions both validate (banner is the once-per-invocation guard)', async () => {
    // The helper itself is not idempotent — `runCommand` enforces the
    // once-per-invocation guard via the parsed.providerOverride === 'fake'
    // branch. This test pins that the helper does not silently swallow
    // duplicates: both events land, both validate.
    await recordFakeProviderWarning({ eventPaths, runId: RUN, now: () => FIXED_TS })
    await recordFakeProviderWarning({ eventPaths, runId: RUN, now: () => FIXED_TS })
    const events = await readEvents(eventPaths)
    expect(events).toHaveLength(2)
    for (const e of events) {
      expect(e.type).toBe('fake_provider_warning_emitted')
    }
  })
})

// ---------------------------------------------------------------------------
// Validator rejection paths
// ---------------------------------------------------------------------------
describe('validateEvent — fake_provider_warning_emitted', () => {
  function make(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      type: 'fake_provider_warning_emitted',
      ts: FIXED_TS,
      runId: RUN,
      providerAlias: 'fake',
      providerFamily: 'fake',
      ...overrides,
    }
  }

  test('valid happy-path returns null', () => {
    const issue = validateEvent(make(), eventPaths.file)
    expect(issue).toBeNull()
  })

  test('valid with fakeScriptPath returns null', () => {
    const issue = validateEvent(make({ fakeScriptPath: '/tmp/x.jsonl' }), eventPaths.file)
    expect(issue).toBeNull()
  })

  test('rejects providerAlias != "fake"', () => {
    const issue = validateEvent(make({ providerAlias: 'claude' }), eventPaths.file)
    expect(issue).not.toBeNull()
    expect(issue!.code).toBe('event_invalid_value')
    expect(issue!.rule).toContain('providerAlias')
  })

  test('rejects providerFamily != "fake"', () => {
    const issue = validateEvent(make({ providerFamily: 'codex' }), eventPaths.file)
    expect(issue).not.toBeNull()
    expect(issue!.rule).toContain('providerFamily')
  })

  test('rejects empty fakeScriptPath when present', () => {
    const issue = validateEvent(make({ fakeScriptPath: '' }), eventPaths.file)
    expect(issue).not.toBeNull()
    expect(issue!.rule).toContain('fakeScriptPath')
  })

  test('rejects malformed runId', () => {
    const issue = validateEvent(make({ runId: 'not-a-ulid' }), eventPaths.file)
    expect(issue).not.toBeNull()
    expect(issue!.code).toBe('event_invalid_runid')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: emit + read = same fields
// ---------------------------------------------------------------------------
describe('round-trip', () => {
  test('emitted event survives read via readEvents', async () => {
    await recordFakeProviderWarning({
      eventPaths,
      runId: RUN,
      fakeScriptPath: '/tmp/fixture.jsonl',
      now: () => FIXED_TS,
    })
    const events = await readEvents(eventPaths)
    const raw = events[0] as Record<string, unknown>
    expect(raw.runId).toBe(RUN)
    expect(raw.providerAlias).toBe('fake')
    expect(raw.providerFamily).toBe('fake')
    expect(raw.fakeScriptPath).toBe('/tmp/fixture.jsonl')
    expect(raw.ts).toBe(FIXED_TS)
  })

  test('event omits fakeScriptPath field when absent (not stored as null)', async () => {
    await recordFakeProviderWarning({
      eventPaths,
      runId: RUN,
      now: () => FIXED_TS,
    })
    const events = await readEvents(eventPaths)
    const raw = events[0] as Record<string, unknown>
    expect('fakeScriptPath' in raw).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Negative path: appendEvent with malformed payload throws
// ---------------------------------------------------------------------------
describe('appendEvent — rejects malformed warning payloads', () => {
  test('rejects providerAlias != fake at append time', async () => {
    let threw = false
    try {
      await appendEvent(eventPaths, {
        version: 1,
        type: 'fake_provider_warning_emitted',
        ts: FIXED_TS,
        runId: RUN,
        // Cast via unknown to deliberately violate the union member type
        // for `providerAlias`; the runtime validator should reject before
        // appendEvent touches disk.
        providerAlias: 'claude',
        providerFamily: 'fake',
      } as unknown as never)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
