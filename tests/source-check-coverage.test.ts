import { describe, test, expect } from 'bun:test'
import {
  parseSourceCheck,
  validatePlanSourceCoverage,
} from '../src/artifacts/source-check.ts'

const VALID = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: x

## Reference sources

### SC-REF-001: pattern

- Path: src/x.ts
- Lines: 1-10
- Why: matches.

## Docs sources

### SC-DOC-NONE-001: no library

- Why explicit: hand-written.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001
`

const T1 = { id: 'T-001', sources: ['SC-SPEC-001', 'SC-REF-001', 'SC-DOC-NONE-001'] }

describe('validatePlanSourceCoverage (Codex M6 review block-push #4)', () => {
  test('returns no issues when every task has SPEC + REF/-NONE + DOC/-NONE and PLAN matches Coverage', () => {
    const sc = parseSourceCheck(VALID)
    const issues = validatePlanSourceCoverage({ tasks: [T1], sourceCheck: sc })
    expect(issues.length).toBe(0)
  })

  test('returns issue when a task is missing from Coverage', () => {
    const sc = parseSourceCheck(VALID)
    const issues = validatePlanSourceCoverage({
      tasks: [T1, { id: 'T-002', sources: ['SC-SPEC-001'] }],
      sourceCheck: sc,
    })
    expect(issues.some((s) => s.includes('T-002 has no Coverage'))).toBe(true)
  })

  test('returns issue when Coverage cites an unknown task id', () => {
    const sc = parseSourceCheck(VALID)
    const issues = validatePlanSourceCoverage({ tasks: [], sourceCheck: sc })
    expect(issues.some((s) => s.includes('unknown task T-001'))).toBe(true)
  })

  test('returns issue when a task lacks a SPEC source', () => {
    const noSpec = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: x

- Spec: a
- Quote: b

## Reference sources

### SC-REF-001: x

- Path: a
- Lines: 1-2
- Why: c

## Docs sources

### SC-DOC-NONE-001: x

- Why explicit: hand-written.

## Coverage

- T-001 -> SC-REF-001, SC-DOC-NONE-001
`
    const sc = parseSourceCheck(noSpec)
    const issues = validatePlanSourceCoverage({
      tasks: [{ id: 'T-001', sources: ['SC-REF-001', 'SC-DOC-NONE-001'] }],
      sourceCheck: sc,
    })
    expect(issues.some((s) => s.includes('missing a SPEC or AUDIT source'))).toBe(true)
  })

  test('returns issue when a task lacks a REF or REF-NONE source', () => {
    const noRef = VALID.replace(
      '- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001',
      '- T-001 -> SC-SPEC-001, SC-DOC-NONE-001',
    )
    const sc = parseSourceCheck(noRef)
    const issues = validatePlanSourceCoverage({
      tasks: [{ id: 'T-001', sources: ['SC-SPEC-001', 'SC-DOC-NONE-001'] }],
      sourceCheck: sc,
    })
    expect(issues.some((s) => s.includes('missing a REF or REF-NONE source'))).toBe(true)
  })

  test('returns issue when a task lacks a DOC or DOC-NONE source', () => {
    const noDoc = VALID.replace(
      '- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001',
      '- T-001 -> SC-SPEC-001, SC-REF-001',
    )
    const sc = parseSourceCheck(noDoc)
    const issues = validatePlanSourceCoverage({
      tasks: [{ id: 'T-001', sources: ['SC-SPEC-001', 'SC-REF-001'] }],
      sourceCheck: sc,
    })
    expect(issues.some((s) => s.includes('missing a DOC or DOC-NONE source'))).toBe(true)
  })

  test('returns issue when PLAN cites a Sources id that is not declared in SOURCE_CHECK (Codex M6 re-review)', () => {
    const sc = parseSourceCheck(VALID)
    const issues = validatePlanSourceCoverage({
      tasks: [{ id: 'T-001', sources: ['SC-SPEC-999', 'SC-REF-001', 'SC-DOC-NONE-001'] }],
      sourceCheck: sc,
    })
    expect(issues.some((s) => s.includes('SC-SPEC-999') && s.includes('no `### SC-SPEC-999'))).toBe(
      true,
    )
  })

  test('returns issue when PLAN Sources and Coverage row disagree (Codex M6 re-review)', () => {
    const sc = parseSourceCheck(VALID)
    // PLAN cites SC-SPEC-999 but Coverage row has SC-SPEC-001 — PLAN says one
    // thing, Coverage says another.
    const issues = validatePlanSourceCoverage({
      tasks: [{ id: 'T-001', sources: ['SC-SPEC-001', 'SC-REF-001'] }],
      sourceCheck: sc,
    })
    expect(
      issues.some((s) =>
        s.includes('Coverage cites SC-DOC-NONE-001') && s.includes("Sources: bullet does not"),
      ),
    ).toBe(true)
  })
})
