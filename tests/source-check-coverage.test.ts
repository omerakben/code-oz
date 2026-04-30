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

describe('validatePlanSourceCoverage (Codex M6 review block-push #4)', () => {
  test('returns no issues when every task has SPEC + REF/-NONE + DOC/-NONE', () => {
    const sc = parseSourceCheck(VALID)
    const issues = validatePlanSourceCoverage({ taskIds: ['T-001'], sourceCheck: sc })
    expect(issues.length).toBe(0)
  })

  test('returns issue when a task is missing from Coverage', () => {
    const sc = parseSourceCheck(VALID)
    const issues = validatePlanSourceCoverage({ taskIds: ['T-001', 'T-002'], sourceCheck: sc })
    expect(issues.some((s) => s.includes('T-002 has no Coverage'))).toBe(true)
  })

  test('returns issue when Coverage cites an unknown task id', () => {
    const sc = parseSourceCheck(VALID)
    const issues = validatePlanSourceCoverage({ taskIds: [], sourceCheck: sc })
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
    const issues = validatePlanSourceCoverage({ taskIds: ['T-001'], sourceCheck: sc })
    expect(issues.some((s) => s.includes('missing a SPEC source'))).toBe(true)
  })

  test('returns issue when a task lacks a REF or REF-NONE source', () => {
    const noRef = VALID.replace(
      '- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001',
      '- T-001 -> SC-SPEC-001, SC-DOC-NONE-001',
    )
    const sc = parseSourceCheck(noRef)
    const issues = validatePlanSourceCoverage({ taskIds: ['T-001'], sourceCheck: sc })
    expect(issues.some((s) => s.includes('missing a REF or REF-NONE source'))).toBe(true)
  })

  test('returns issue when a task lacks a DOC or DOC-NONE source', () => {
    const noDoc = VALID.replace(
      '- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001',
      '- T-001 -> SC-SPEC-001, SC-REF-001',
    )
    const sc = parseSourceCheck(noDoc)
    const issues = validatePlanSourceCoverage({ taskIds: ['T-001'], sourceCheck: sc })
    expect(issues.some((s) => s.includes('missing a DOC or DOC-NONE source'))).toBe(true)
  })
})
