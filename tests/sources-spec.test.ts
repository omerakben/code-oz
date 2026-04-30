import { describe, test, expect } from 'bun:test'
import { resolveSpecSources } from '../src/sources/spec-source.ts'

const VALID_SPEC = `# SPEC

## Goals

- Help a parent name their newborn.

## Users

- New parents.

## Constraints

- Runs locally.
- No internet access required.

## Acceptance criteria

- Given a surname, the app produces 5 candidate given names.
- Each candidate is scored against the surname.

## Open questions

- None known at define time.

## Explicit non-goals

- Not building a name registry.
`

describe('resolveSpecSources', () => {
  test('emits one SC-SPEC block per acceptance criterion', () => {
    const out = resolveSpecSources({ specText: VALID_SPEC })
    const acceptanceBlocks = out.filter((s) => s.spec.includes('Acceptance criteria'))
    expect(acceptanceBlocks.length).toBe(2)
  })

  test('emits SC-SPEC-001 starting id', () => {
    const out = resolveSpecSources({ specText: VALID_SPEC })
    expect(out[0]!.id).toBe('SC-SPEC-001')
  })

  test('emits constraints after acceptance', () => {
    const out = resolveSpecSources({ specText: VALID_SPEC })
    const constraintIdx = out.findIndex((s) => s.spec.includes('Constraints'))
    const acceptanceIdx = out.findIndex((s) => s.spec.includes('Acceptance criteria'))
    expect(acceptanceIdx).toBeLessThan(constraintIdx)
  })

  test('preserves the SPEC bullet text in quote', () => {
    const out = resolveSpecSources({ specText: VALID_SPEC })
    const a1 = out[0]!
    expect(a1.quote).toContain('5 candidate given names')
  })

  test('every block has discriminator kind: SPEC', () => {
    const out = resolveSpecSources({ specText: VALID_SPEC })
    expect(out.every((s) => s.kind === 'SPEC')).toBe(true)
  })
})
