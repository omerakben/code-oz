import { describe, test, expect } from 'bun:test'
import {
  parseVerifyPersonaResponse,
  VERIFY_READY_SIGNAL,
} from '../src/phases/verify.ts'

describe('parseVerifyPersonaResponse — pass branch', () => {
  test('happy path: marker + Rationale only', () => {
    const text = `${VERIFY_READY_SIGNAL}\n\n## Rationale\nvalidation exited 0 in 100ms; mutation not applicable.\n`
    const r = parseVerifyPersonaResponse(text, 'pass')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.rationale).toBe('validation exited 0 in 100ms; mutation not applicable.')
  })

  test('rejects missing ready marker', () => {
    const r = parseVerifyPersonaResponse('## Rationale\nfoo\n', 'pass')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('marker')
  })

  test('rejects missing Rationale', () => {
    const r = parseVerifyPersonaResponse(`${VERIFY_READY_SIGNAL}\n`, 'pass')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('Rationale')
  })

  test('rejects multi-line Rationale', () => {
    const text = `${VERIFY_READY_SIGNAL}\n\n## Rationale\nline one\nline two\n`
    const r = parseVerifyPersonaResponse(text, 'pass')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('single line')
  })

  test('rejects > 200-char Rationale', () => {
    const long = 'x'.repeat(201)
    const text = `${VERIFY_READY_SIGNAL}\n\n## Rationale\n${long}\n`
    const r = parseVerifyPersonaResponse(text, 'pass')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('200')
  })

  test('accepts exactly 200-char Rationale (boundary)', () => {
    const exact = 'x'.repeat(200)
    const text = `${VERIFY_READY_SIGNAL}\n\n## Rationale\n${exact}\n`
    expect(parseVerifyPersonaResponse(text, 'pass').ok).toBe(true)
  })

  test('extra unknown sections are ignored on pass', () => {
    const text = `${VERIFY_READY_SIGNAL}\n\n## Rationale\nok.\n\n## ExtraJunk\nnope\n`
    const r = parseVerifyPersonaResponse(text, 'pass')
    expect(r.ok).toBe(true)
  })
})

describe('parseVerifyPersonaResponse — fail branch', () => {
  function failResponse(over: { rationale?: string; failureSummary?: string; constraint?: string } = {}): string {
    const r = over.rationale ?? 'exit 1 != expected 0; tests failed.'
    const fs = over.failureSummary ?? 'expected stress on syllable 2; got stress on syllable 1.'
    const c = over.constraint ?? 'prefer last-syllable stress for two-syllable surnames.'
    return `${VERIFY_READY_SIGNAL}\n\n## Rationale\n${r}\n\n## Failure summary\n${fs}\n\n## Constraint\n${c}\n`
  }

  test('happy path: all three sections', () => {
    const r = parseVerifyPersonaResponse(failResponse(), 'fail')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.failureSummary).toContain('syllable 2')
      expect(r.value.constraint).toContain('last-syllable stress')
    }
  })

  test('rejects missing Failure summary on fail', () => {
    const text = `${VERIFY_READY_SIGNAL}\n\n## Rationale\nok.\n\n## Constraint\nfix it.\n`
    const r = parseVerifyPersonaResponse(text, 'fail')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('Failure summary')
  })

  test('rejects missing Constraint on fail', () => {
    const text = `${VERIFY_READY_SIGNAL}\n\n## Rationale\nok.\n\n## Failure summary\nbad.\n`
    const r = parseVerifyPersonaResponse(text, 'fail')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('Constraint')
  })

  test('rejects > 200-char Failure summary', () => {
    const r = parseVerifyPersonaResponse(failResponse({ failureSummary: 'x'.repeat(201) }), 'fail')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('Failure summary')
  })

  test('rejects > 200-char Constraint', () => {
    const r = parseVerifyPersonaResponse(failResponse({ constraint: 'y'.repeat(201) }), 'fail')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violation).toContain('Constraint')
  })
})
