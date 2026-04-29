import { describe, test, expect } from 'bun:test'
import {
  PHASES,
  GREENFIELD_SEQUENCE,
  BROWNFIELD_SEQUENCE,
  CANONICAL_ARTIFACTS,
  generateUlid,
  isUlid,
  isIsoTimestamp,
  isPhase,
  isProfile,
  sequenceFor,
} from '../src/state/schemas.ts'
import { GateLoadError, EventLogError } from '../src/state/errors.ts'

describe('phase + profile enums', () => {
  test('PHASES covers all greenfield + brownfield phases', () => {
    for (const p of GREENFIELD_SEQUENCE) expect(PHASES).toContain(p)
    for (const p of BROWNFIELD_SEQUENCE) expect(PHASES).toContain(p)
  })

  test('isPhase only accepts canonical strings', () => {
    expect(isPhase('define')).toBe(true)
    expect(isPhase('audit')).toBe(true)
    expect(isPhase('DEFINE')).toBe(false)
    expect(isPhase('plan ')).toBe(false)
    expect(isPhase(undefined)).toBe(false)
    expect(isPhase(null)).toBe(false)
    expect(isPhase(7)).toBe(false)
  })

  test('isProfile only accepts canonical strings', () => {
    expect(isProfile('greenfield')).toBe(true)
    expect(isProfile('brownfield')).toBe(true)
    expect(isProfile('hybrid')).toBe(false)
    expect(isProfile('')).toBe(false)
  })

  test('sequenceFor returns the right sequence and is frozen', () => {
    expect(sequenceFor('greenfield')).toBe(GREENFIELD_SEQUENCE)
    expect(sequenceFor('brownfield')).toBe(BROWNFIELD_SEQUENCE)
    expect(Object.isFrozen(GREENFIELD_SEQUENCE)).toBe(true)
    expect(Object.isFrozen(BROWNFIELD_SEQUENCE)).toBe(true)
  })

  test('greenfield sequence starts at define, brownfield at audit', () => {
    expect(GREENFIELD_SEQUENCE[0]).toBe('define')
    expect(BROWNFIELD_SEQUENCE[0]).toBe('audit')
    expect(GREENFIELD_SEQUENCE[GREENFIELD_SEQUENCE.length - 1]).toBe('ship')
    expect(BROWNFIELD_SEQUENCE[BROWNFIELD_SEQUENCE.length - 1]).toBe('ship')
  })
})

describe('CANONICAL_ARTIFACTS', () => {
  test('has an entry for every phase', () => {
    for (const p of PHASES) {
      expect(CANONICAL_ARTIFACTS[p]).toMatch(/^artifacts\/.+\.md$/)
    }
  })

  test('is frozen', () => {
    expect(Object.isFrozen(CANONICAL_ARTIFACTS)).toBe(true)
  })

  test('matches the pinned phase artifact map', () => {
    expect(CANONICAL_ARTIFACTS.define).toBe('artifacts/SPEC.md')
    expect(CANONICAL_ARTIFACTS.audit).toBe('artifacts/AUDIT.md')
    expect(CANONICAL_ARTIFACTS.plan).toBe('artifacts/PLAN.md')
    expect(CANONICAL_ARTIFACTS.build).toBe('artifacts/BUILD_REPORT.md')
    expect(CANONICAL_ARTIFACTS.verify).toBe('artifacts/VERIFY.md')
    expect(CANONICAL_ARTIFACTS.review).toBe('artifacts/REVIEW.md')
    expect(CANONICAL_ARTIFACTS.ship).toBe('artifacts/SHIP.md')
  })
})

describe('ULID', () => {
  test('generateUlid produces 26-char Crockford strings', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateUlid()
      expect(id.length).toBe(26)
      expect(isUlid(id)).toBe(true)
    }
  })

  test('isUlid rejects forbidden Crockford letters and lowercase', () => {
    expect(isUlid('I'.repeat(26))).toBe(false)
    expect(isUlid('L'.repeat(26))).toBe(false)
    expect(isUlid('O'.repeat(26))).toBe(false)
    expect(isUlid('U'.repeat(26))).toBe(false)
    expect(isUlid('a'.repeat(26))).toBe(false)
    expect(isUlid('Z'.repeat(25))).toBe(false)
    expect(isUlid('Z'.repeat(27))).toBe(false)
    expect(isUlid('')).toBe(false)
    expect(isUlid(null)).toBe(false)
  })

  test('generateUlid encodes the timestamp deterministically', () => {
    // 0 ms timestamp + zero random bytes encodes to all zeros.
    const zeros = new Uint8Array(10)
    expect(generateUlid({ now: 0, random: zeros })).toBe('0'.repeat(26))

    // Fixed timestamp + zero random bytes is reproducible.
    const fixed = generateUlid({ now: 1_000_000_000_000, random: zeros })
    expect(fixed.slice(-16)).toBe('0'.repeat(16))
    expect(fixed.length).toBe(26)
    expect(isUlid(fixed)).toBe(true)
  })

  test('generateUlid is monotonic when now is monotonic and random differs', () => {
    const a = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
    const b = generateUlid({ now: 1_000_000_000_001, random: new Uint8Array(10) })
    expect(a < b).toBe(true)
  })

  test('generateUlid rejects out-of-range timestamps', () => {
    expect(() => generateUlid({ now: -1 })).toThrow(RangeError)
    expect(() => generateUlid({ now: 0xffffffffffff + 1 })).toThrow(RangeError)
    expect(() => generateUlid({ now: 1.5 })).toThrow(RangeError)
  })

  test('generateUlid rejects random buffers of the wrong length', () => {
    expect(() => generateUlid({ random: new Uint8Array(9) })).toThrow(RangeError)
    expect(() => generateUlid({ random: new Uint8Array(11) })).toThrow(RangeError)
  })
})

describe('isIsoTimestamp', () => {
  test('accepts standard ISO 8601 strings', () => {
    expect(isIsoTimestamp('2026-04-29T17:00:00Z')).toBe(true)
    expect(isIsoTimestamp('2026-04-29T17:00:00.123Z')).toBe(true)
    expect(isIsoTimestamp('2026-04-29T17:00:00+02:00')).toBe(true)
    expect(isIsoTimestamp('2026-04-29T17:00:00.000123Z')).toBe(true)
  })

  test('rejects malformed timestamps', () => {
    expect(isIsoTimestamp('2026-04-29 17:00:00Z')).toBe(false)
    expect(isIsoTimestamp('not a date')).toBe(false)
    expect(isIsoTimestamp('2026-13-29T17:00:00Z')).toBe(false)
    expect(isIsoTimestamp(0)).toBe(false)
    expect(isIsoTimestamp(undefined)).toBe(false)
    expect(isIsoTimestamp('2026-04-29T17:00:00')).toBe(false) // no zone suffix
  })
})

describe('GateLoadError + EventLogError', () => {
  test('GateLoadError summarizes a single issue', () => {
    const err = new GateLoadError([
      {
        file: 'state/runs/01/GATE_DEFINE_PASSED.json',
        code: 'gate_invalid_runid',
        rule: 'runId must be a 26-char ULID',
      },
    ])
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('GateLoadError')
    expect(err.message).toContain('GATE_DEFINE_PASSED.json')
    expect(err.message).toContain('runId must be a 26-char ULID')
    expect(Object.isFrozen(err.issues)).toBe(true)
    expect(Object.isFrozen(err.issues[0])).toBe(true)
  })

  test('GateLoadError summarizes multiple issues across files', () => {
    const err = new GateLoadError([
      { file: 'a.json', code: 'gate_invalid_json', rule: 'a' },
      { file: 'b.json', code: 'gate_invalid_phase', rule: 'b' },
    ])
    expect(err.message).toContain('2')
    expect(err.message).toContain('2 file(s)')
    expect(err.issues.length).toBe(2)
  })

  test('GateLoadError refuses an empty issue array', () => {
    expect(() => new GateLoadError([])).toThrow()
  })

  test('EventLogError carries the same shape with optional line numbers', () => {
    const err = new EventLogError([
      {
        file: 'events.jsonl',
        code: 'event_invalid_json',
        rule: 'JSON parse failed',
        line: 42,
      },
    ])
    expect(err.name).toBe('EventLogError')
    expect(err.issues[0]?.line).toBe(42)
    expect(Object.isFrozen(err.issues[0])).toBe(true)
  })

  test('EventLogError refuses an empty issue array', () => {
    expect(() => new EventLogError([])).toThrow()
  })
})
