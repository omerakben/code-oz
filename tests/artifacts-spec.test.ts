import { describe, test, expect } from 'bun:test'
import {
  parseSpec,
  serializeSpec,
  hasMinimumContent,
  SPEC_OPEN_QUESTIONS_NONE,
  SPEC_SECTION_KEYS,
  type SpecArtifact,
} from '../src/artifacts/spec.ts'
import { SpecLoadError } from '../src/artifacts/errors.ts'

const FILE = '<test-fixture>'

function expectSpecLoadError(fn: () => unknown): SpecLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(SpecLoadError)
    return err as SpecLoadError
  }
  throw new Error('expected SpecLoadError to be thrown')
}

const VALID = `# SPEC

## Goals

- Help a parent name their newborn.
- Suggest names balanced across given-name and surname pairings.

## Users

- New parents with a fixed surname who want suggestions.

## Constraints

- Runs locally on a phone-class device.
- No internet access required after install.

## Acceptance criteria

- Given a surname, the app produces 5 candidate given names.
- Each candidate is scored against the surname.

## Open questions

- Does the parent want gender-neutral suggestions only?

## Explicit non-goals

- Not building a name registry.
- Not generating surnames.
`

describe('parseSpec', () => {
  test('parses a fully valid SPEC.md with multiple bullets per section', () => {
    const spec = parseSpec(VALID, FILE)
    expect(spec.title).toBe('SPEC')
    expect(spec.goals.length).toBe(2)
    expect(spec.users.length).toBe(1)
    expect(spec.constraints.length).toBe(2)
    expect(spec.acceptance.length).toBe(2)
    expect(spec.openQuestions.length).toBe(1)
    expect(spec.nonGoals.length).toBe(2)
    expect(spec.goals[0]).toBe('Help a parent name their newborn.')
    expect(spec.nonGoals[1]).toBe('Not generating surnames.')
  })

  test('strips a leading UTF-8 BOM', () => {
    const raw = '﻿' + VALID
    const spec = parseSpec(raw, FILE)
    expect(spec.title).toBe('SPEC')
  })

  test('accepts CRLF line endings', () => {
    const raw = VALID.replace(/\n/g, '\r\n')
    const spec = parseSpec(raw, FILE)
    expect(spec.goals.length).toBe(2)
  })

  test('accepts the canonical open-questions empty bullet', () => {
    const raw = VALID.replace(
      '- Does the parent want gender-neutral suggestions only?',
      SPEC_OPEN_QUESTIONS_NONE,
    )
    const spec = parseSpec(raw, FILE)
    expect(spec.openQuestions[0]).toBe('None known at define time.')
  })

  test('returns frozen artifact and frozen section arrays', () => {
    const spec = parseSpec(VALID, FILE)
    expect(Object.isFrozen(spec)).toBe(true)
    expect(Object.isFrozen(spec.goals)).toBe(true)
  })

  test('rejects empty input', () => {
    const err = expectSpecLoadError(() => parseSpec('   \n\n', FILE))
    expect(err.issues[0]!.code).toBe('spec_empty')
  })

  test('rejects missing title', () => {
    const raw = VALID.replace('# SPEC\n\n', '')
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues[0]!.code).toBe('spec_missing_title')
  })

  test('rejects wrong title text', () => {
    const raw = VALID.replace('# SPEC', '# Specification')
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues[0]!.code).toBe('spec_missing_title')
  })

  test('rejects content before the title', () => {
    const raw = 'preamble\n\n' + VALID
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_unexpected_content')).toBe(true)
  })

  test('rejects content between title and first section', () => {
    const raw = VALID.replace(
      '# SPEC\n\n## Goals',
      '# SPEC\n\nsome paragraph\n\n## Goals',
    )
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_unexpected_content')).toBe(true)
  })

  test('rejects out-of-order sections', () => {
    // Hand-craft an out-of-order document (Users before Goals).
    const ooo = `# SPEC

## Users

- A user.

## Goals

- A goal.

## Constraints

- A constraint.

## Acceptance criteria

- A criterion.

## Open questions

- ${SPEC_OPEN_QUESTIONS_NONE.slice(2)}

## Explicit non-goals

- A non-goal.
`
    const err = expectSpecLoadError(() => parseSpec(ooo, FILE))
    expect(err.issues.some((i) => i.code === 'spec_section_out_of_order')).toBe(true)
  })

  test('rejects missing required section', () => {
    const raw = VALID.replace(/## Explicit non-goals[\s\S]*$/, '')
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_missing_section')).toBe(true)
  })

  test('rejects duplicate section', () => {
    const raw = VALID + '\n## Goals\n\n- another\n'
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_section_duplicated')).toBe(true)
  })

  test('rejects unknown section heading', () => {
    const raw = VALID.replace('## Users', '## Stakeholders')
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    const codes = err.issues.map((i) => i.code)
    expect(codes).toContain('spec_section_unknown')
    expect(codes).toContain('spec_missing_section') // Users is now missing
  })

  test('rejects empty section (no bullets)', () => {
    const raw = VALID.replace(
      '## Users\n\n- New parents with a fixed surname who want suggestions.\n\n',
      '## Users\n\n',
    )
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_section_empty')).toBe(true)
  })

  test('rejects empty bullet (no content after dash)', () => {
    const raw = VALID.replace(
      '- Help a parent name their newborn.',
      '- ',
    )
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_invalid_bullet')).toBe(true)
  })

  test('rejects paragraph content inside a section', () => {
    const raw = VALID.replace(
      '## Constraints\n\n- Runs locally on a phone-class device.',
      '## Constraints\n\nThis section explains constraints.\n\n- Runs locally on a phone-class device.',
    )
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_unexpected_content')).toBe(true)
  })

  test('rejects code fences inside a section', () => {
    const raw = VALID.replace(
      '## Constraints\n\n- Runs locally on a phone-class device.',
      '## Constraints\n\n```ts\nfoo()\n```\n\n- Runs locally on a phone-class device.',
    )
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_unexpected_content')).toBe(true)
  })

  test('rejects sub-headings inside a section', () => {
    const raw = VALID.replace(
      '## Constraints\n\n- Runs',
      '## Constraints\n\n### Subheading\n\n- Runs',
    )
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_unexpected_content')).toBe(true)
  })

  test('rejects a second H1 heading', () => {
    const raw = VALID + '\n# Another\n'
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    expect(err.issues.some((i) => i.code === 'spec_unexpected_content')).toBe(true)
  })

  test('reports line numbers on issues', () => {
    const raw = VALID.replace(
      '## Constraints\n\n- Runs locally on a phone-class device.',
      '## Constraints\n\n```ts\nfoo()\n```\n\n- Runs locally on a phone-class device.',
    )
    const err = expectSpecLoadError(() => parseSpec(raw, FILE))
    const fence = err.issues.find((i) => i.detail === '```ts')
    expect(fence).toBeDefined()
    expect(fence!.line).toBeGreaterThan(0)
  })
})

describe('serializeSpec', () => {
  test('round-trips a parsed SPEC into canonical form', () => {
    const spec = parseSpec(VALID, FILE)
    const out = serializeSpec(spec)
    // Re-parse: must succeed and produce the same artifact.
    const reparsed = parseSpec(out, FILE)
    expect(reparsed).toEqual(spec)
  })

  test('produces a canonical golden snapshot', () => {
    const spec: SpecArtifact = Object.freeze({
      title: 'SPEC',
      goals: Object.freeze(['G1', 'G2']),
      users: Object.freeze(['U1']),
      constraints: Object.freeze(['C1']),
      acceptance: Object.freeze(['A1']),
      openQuestions: Object.freeze(['None known at define time.']),
      nonGoals: Object.freeze(['NG1', 'NG2']),
    })
    const out = serializeSpec(spec)
    const expected = [
      '# SPEC',
      '',
      '## Goals',
      '',
      '- G1',
      '- G2',
      '',
      '## Users',
      '',
      '- U1',
      '',
      '## Constraints',
      '',
      '- C1',
      '',
      '## Acceptance criteria',
      '',
      '- A1',
      '',
      '## Open questions',
      '',
      '- None known at define time.',
      '',
      '## Explicit non-goals',
      '',
      '- NG1',
      '- NG2',
      '',
    ].join('\n')
    expect(out).toBe(expected)
  })

  test('emits LF line endings only', () => {
    const spec = parseSpec(VALID, FILE)
    const out = serializeSpec(spec)
    expect(out.includes('\r')).toBe(false)
  })

  test('ends with exactly one newline', () => {
    const spec = parseSpec(VALID, FILE)
    const out = serializeSpec(spec)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  test('emits sections in canonical order even if input was constructed in another order', () => {
    // SpecArtifact is a frozen object with named keys, but the serializer
    // uses SPEC_SECTION_KEYS to drive iteration — so order is guaranteed.
    const spec: SpecArtifact = Object.freeze({
      title: 'SPEC',
      // these fields can be assigned in any order but the serializer reads
      // them via SPEC_SECTION_KEYS in canonical order.
      nonGoals: Object.freeze(['NG']),
      openQuestions: Object.freeze(['OQ']),
      acceptance: Object.freeze(['A']),
      constraints: Object.freeze(['C']),
      users: Object.freeze(['U']),
      goals: Object.freeze(['G']),
    })
    const out = serializeSpec(spec)
    expect(out.indexOf('## Goals')).toBeLessThan(out.indexOf('## Users'))
    expect(out.indexOf('## Users')).toBeLessThan(out.indexOf('## Constraints'))
    expect(out.indexOf('## Acceptance criteria')).toBeLessThan(out.indexOf('## Open questions'))
    expect(out.indexOf('## Open questions')).toBeLessThan(out.indexOf('## Explicit non-goals'))
  })
})

describe('hasMinimumContent', () => {
  test('true when every section has ≥ 1 bullet', () => {
    const spec = parseSpec(VALID, FILE)
    expect(hasMinimumContent(spec)).toBe(true)
  })

  test('false when any section is empty', () => {
    const spec: SpecArtifact = {
      title: 'SPEC',
      goals: [],
      users: ['U'],
      constraints: ['C'],
      acceptance: ['A'],
      openQuestions: ['Q'],
      nonGoals: ['NG'],
    }
    expect(hasMinimumContent(spec)).toBe(false)
  })
})

describe('SPEC_SECTION_KEYS', () => {
  test('canonical order matches the contract', () => {
    expect(SPEC_SECTION_KEYS).toEqual([
      'goals',
      'users',
      'constraints',
      'acceptance',
      'openQuestions',
      'nonGoals',
    ])
  })
})
