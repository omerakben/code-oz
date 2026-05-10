import { describe, test, expect } from 'bun:test'
import {
  parseSpec,
  serializeSpec,
  hasMinimumContent,
  lintSpecQuality,
  adaptYamlStyleSpec,
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

// --- issue #7: YAML-style SPEC tolerance ---------------------------

const YAML_SPEC = `# SPEC

goals:
  - Help a parent name their newborn.
  - Suggest names balanced across given-name and surname pairings.

users:
  - New parents with a fixed surname.

constraints:
  - Runs locally on a phone-class device.

acceptance_criteria:
  - Given a surname, the app produces 5 candidate given names.

open_questions:
  - Does the parent want gender-neutral suggestions only?

explicit_non_goals:
  - Not building a name registry.
`

describe('adaptYamlStyleSpec (issue #7)', () => {
  test('returns input unchanged when no YAML markers are present', () => {
    expect(adaptYamlStyleSpec(VALID)).toBe(VALID)
  })

  test('returns input unchanged for empty / pre-title content', () => {
    expect(adaptYamlStyleSpec('')).toBe('')
    expect(adaptYamlStyleSpec('# SPEC\n')).toBe('# SPEC\n')
  })

  test('rewrites YAML keys to canonical H2 headings', () => {
    const out = adaptYamlStyleSpec(YAML_SPEC)
    expect(out).toContain('## Goals')
    expect(out).toContain('## Users')
    expect(out).toContain('## Constraints')
    expect(out).toContain('## Acceptance criteria')
    expect(out).toContain('## Open questions')
    expect(out).toContain('## Explicit non-goals')
  })

  test('strips YAML key markers after rewrite', () => {
    const out = adaptYamlStyleSpec(YAML_SPEC)
    // Top-level YAML keys are replaced with H2 sections; only `# SPEC` remains
    // as a non-bullet column-0 line.
    const columnZeroLines = out.split('\n').filter((l) => l.length > 0 && !/^[ \t]/.test(l))
    for (const line of columnZeroLines) {
      expect(line.startsWith('# ') || line.startsWith('## ') || line.startsWith('- ')).toBe(true)
    }
  })

  test('preserves bullet content from indented YAML lists', () => {
    const out = adaptYamlStyleSpec(YAML_SPEC)
    expect(out).toContain('- Help a parent name their newborn.')
    expect(out).toContain('- Suggest names balanced across given-name and surname pairings.')
    expect(out).toContain('- Given a surname, the app produces 5 candidate given names.')
  })

  test('normalises snake_case / camelCase / kebab-case key aliases', () => {
    const variants = `# SPEC

Goals:
  - g

users:
  - u

CONSTRAINTS:
  - c

acceptanceCriteria:
  - a

open-questions:
  - q

nonGoals:
  - ng
`
    const out = adaptYamlStyleSpec(variants)
    expect(out).toContain('## Goals')
    expect(out).toContain('## Users')
    expect(out).toContain('## Constraints')
    expect(out).toContain('## Acceptance criteria')
    expect(out).toContain('## Open questions')
    expect(out).toContain('## Explicit non-goals')
  })

  test('accepts inline flow-list values (`goals: [a, b]`)', () => {
    const flow = `# SPEC

goals: [first goal, second goal]

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const out = adaptYamlStyleSpec(flow)
    expect(out).toContain('- first goal')
    expect(out).toContain('- second goal')
  })

  test('handles mixed format (one canonical section, one YAML key)', () => {
    const mixed = `# SPEC

## Goals

- Canonical bullet stays.

users:
  - YAML user gets rewritten.

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(mixed)
    expect(spec.goals).toEqual(['Canonical bullet stays.'])
    expect(spec.users).toEqual(['YAML user gets rewritten.'])
  })
})

describe('parseSpec — issue #7 YAML tolerance', () => {
  test('parses pure-YAML input end-to-end', () => {
    const spec = parseSpec(YAML_SPEC)
    expect(spec.title).toBe('SPEC')
    expect(spec.goals.length).toBe(2)
    expect(spec.users.length).toBe(1)
    expect(spec.constraints.length).toBe(1)
    expect(spec.acceptance.length).toBe(1)
    expect(spec.openQuestions.length).toBe(1)
    expect(spec.nonGoals.length).toBe(1)
    expect(spec.acceptance[0]).toContain('5 candidate given names')
  })

  test('round-trips YAML through serialize → reparse to canonical', () => {
    const spec = parseSpec(YAML_SPEC)
    const serialized = serializeSpec(spec)
    expect(serialized).toContain('## Goals')
    expect(serialized).not.toMatch(/^goals:/m)
    const reparsed = parseSpec(serialized)
    expect(reparsed.goals).toEqual(spec.goals)
    expect(reparsed.acceptance).toEqual(spec.acceptance)
    expect(reparsed.nonGoals).toEqual(spec.nonGoals)
  })

  test('still rejects YAML missing a section (tolerance does not invent sections)', () => {
    const incomplete = `# SPEC

goals:
  - g

users:
  - u

constraints:
  - c

acceptance:
  - a

open_questions:
  - q
`
    // Missing explicit_non_goals — strict parser must still surface this.
    const err = expectSpecLoadError(() => parseSpec(incomplete))
    expect(err.issues.some((i) => i.code === 'spec_missing_section')).toBe(true)
  })

  test('still rejects unknown YAML keys via strict parser passthrough', () => {
    const unknown = `# SPEC

mystery_field:
  - x

goals:
  - g

users:
  - u

constraints:
  - c

acceptance:
  - a

open_questions:
  - q

non_goals:
  - ng
`
    // Unknown YAML keys remain as column-0 `mystery_field:` lines and reach
    // the strict parser's content guards.
    expect(() => parseSpec(unknown)).toThrow()
  })

  test('accepts YAML with empty open_questions sentinel', () => {
    const withSentinel = `# SPEC

goals:
  - g

users:
  - u

constraints:
  - c

acceptance:
  - a

open_questions:
  - ${SPEC_OPEN_QUESTIONS_NONE.slice(2)}

non_goals:
  - ng
`
    const spec = parseSpec(withSentinel)
    expect(spec.openQuestions).toEqual([SPEC_OPEN_QUESTIONS_NONE.slice(2)])
  })
})

describe('adaptYamlStyleSpec — Codex review block-push regressions', () => {
  test('flow list with quoted comma keeps the scalar intact', () => {
    // Naive split-on-comma would turn one quoted scalar into two bullets.
    // Quote-aware splitter must preserve `"a, b"` as a single bullet.
    const yaml = `# SPEC

goals: ["first goal, with comma", "second goal"]

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(yaml)
    expect(spec.goals).toEqual(['first goal, with comma', 'second goal'])
  })

  test('flow list with single-quoted comma keeps the scalar intact', () => {
    const yaml = `# SPEC

goals: ['a, b', c]

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(yaml)
    expect(spec.goals).toEqual(['a, b', 'c'])
  })

  test('flow list with trailing comma drops empty trailing item', () => {
    const yaml = `# SPEC

goals: [a, b, c, ]

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(yaml)
    expect(spec.goals).toEqual(['a', 'b', 'c'])
  })

  test('YAML continuation line is folded onto previous bullet, not dropped', () => {
    // A folded multi-line scalar (`- First line\n    continuation`) must
    // preserve the continuation text. Silently dropping it would corrupt
    // author intent — the very class of bug issue #7 is fixing.
    const yaml = `# SPEC

goals:
  - First goal line one
    continuation of first goal

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(yaml)
    expect(spec.goals).toEqual(['First goal line one continuation of first goal'])
  })

  test('"non goals" key (probe match without map entry) now resolves correctly', () => {
    const yaml = `# SPEC

goals:
  - g

users:
  - u

constraints:
  - c

acceptance:
  - a

open_questions:
  - q

non goals:
  - ng
`
    const spec = parseSpec(yaml)
    expect(spec.nonGoals).toEqual(['ng'])
  })

  test('BOM followed by canonical # SPEC + YAML sections parses correctly', () => {
    // The adapter runs before BOM stripping. Verify a BOM at the start
    // does not break either path: canonical heading detection or YAML key
    // probe.
    const BOM = '﻿'
    const yaml = `${BOM}# SPEC

goals:
  - g

users:
  - u

constraints:
  - c

acceptance:
  - a

open_questions:
  - q

non_goals:
  - ng
`
    const spec = parseSpec(yaml)
    expect(spec.title).toBe('SPEC')
    expect(spec.goals).toEqual(['g'])
  })
})

describe('adaptYamlStyleSpec — Codex round-2 regressions', () => {
  test('escaped double quote in flow scalar does not corrupt comma split', () => {
    // `["say \"yes, now\"", second]` previously toggled quote state on the
    // escaped `"` and split at the inner comma, yielding 3 bullets. The
    // backslash-escape path now preserves quote state, leaving the scalar
    // intact (Codex round-2 block-push finding).
    const yaml = `# SPEC

goals: ["say \\"yes, now\\"", "second"]

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(yaml)
    expect(spec.goals.length).toBe(2)
    // The escaped quote stays in the bullet text (we rewrite shape, not
    // semantics — leaving \" verbatim is acceptable).
    expect(spec.goals[0]).toContain('yes, now')
    expect(spec.goals[1]).toBe('second')
  })

  test('escaped single quote in flow scalar does not corrupt comma split', () => {
    const yaml = `# SPEC

goals: ['don\\'t, please', 'second']

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(yaml)
    expect(spec.goals.length).toBe(2)
    expect(spec.goals[0]).toContain('don')
    expect(spec.goals[0]).toContain('please')
    expect(spec.goals[1]).toBe('second')
  })

  test('nested YAML map under a section key is rejected, not flattened', () => {
    // `goals:\n  - first\n    nested:\n      - sub1` previously folded
    // `nested:` and `- sub1` into the prior bullet. The adapter now aborts
    // the rewrite of this YAML block and lets the strict parser reject the
    // nested structure (Codex round-2 block-push finding).
    const yaml = `# SPEC

goals:
  - first
    nested:
      - sub1

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    expect(() => parseSpec(yaml)).toThrow()
  })

  test('nested list (deeper indent bullet) is rejected, not folded', () => {
    const yaml = `# SPEC

goals:
  - first
    - nested-item-deeper-indent

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    expect(() => parseSpec(yaml)).toThrow()
  })

  test('explicitnongoals (concatenated, no separator) probe matches and resolves', () => {
    // Probe was previously `(?:explicit[ _-])?non[ _-]?goals` — required a
    // separator after `explicit`, so `explicitnongoals:` skipped the
    // adapter even though the map accepted it. The optional separator now
    // closes the asymmetry (Codex round-2 fix-soon).
    const yaml = `# SPEC

goals:
  - g

users:
  - u

constraints:
  - c

acceptance:
  - a

open_questions:
  - q

explicitnongoals:
  - ng
`
    const spec = parseSpec(yaml)
    expect(spec.nonGoals).toEqual(['ng'])
  })

  test('round-trip: YAML flow list with comma scalar serialize → reparse stable', () => {
    // Codex round-2 fix-soon: confirm a goal containing a comma round-trips
    // through serialize → reparse without splitting.
    const yaml = `# SPEC

goals: ["a, b", c]

users:
  - U

constraints:
  - C

acceptance:
  - A

open_questions:
  - Q

non_goals:
  - NG
`
    const spec = parseSpec(yaml)
    expect(spec.goals).toEqual(['a, b', 'c'])
    const serialized = serializeSpec(spec)
    expect(serialized).toContain('- a, b')
    const reparsed = parseSpec(serialized)
    expect(reparsed.goals).toEqual(['a, b', 'c'])
  })
})

const LINT_BASE_SPEC: SpecArtifact = Object.freeze({
  title: 'SPEC',
  goals: Object.freeze([
    'Measure name selection outcomes.',
    'Capture parent preference details.',
  ]),
  users: Object.freeze(['Parents comparing newborn name choices.']),
  constraints: Object.freeze(['Runs offline after installation.']),
  acceptance: Object.freeze(['Given a surname, the app returns ranked candidates.']),
  openQuestions: Object.freeze(['Does the parent prefer gender-neutral names?']),
  nonGoals: Object.freeze(['Not generating surnames.']),
})

const VAGUE_TERMS_FOR_TEST = [
  'fast', 'quick', 'slow', 'good', 'bad', 'poor',
  'user-friendly', 'easy', 'simple', 'secure', 'safe',
  'scalable', 'flexible', 'performant', 'efficient',
] as const

function specForLint(overrides: Partial<Omit<SpecArtifact, 'title'>> = {}): SpecArtifact {
  return Object.freeze({
    ...LINT_BASE_SPEC,
    ...overrides,
  })
}

describe('lintSpecQuality', () => {
  test('healthy SPEC produces 0 issues', () => {
    expect(lintSpecQuality(LINT_BASE_SPEC)).toEqual([])
  })

  test('each pinned vague term triggers in acceptance', () => {
    for (const term of VAGUE_TERMS_FOR_TEST) {
      const issues = lintSpecQuality(specForLint({
        acceptance: [`The workflow is ${term} for parents.`],
      }))
      expect(issues).toContainEqual({
        code: 'spec_vague_language',
        section: 'acceptance',
        bulletIndex: 0,
        term,
      })
    }
  })

  test('lead-ins still trigger vague-language warnings', () => {
    for (const phrase of ['should be fast', 'must be fast', 'needs to be fast']) {
      const issues = lintSpecQuality(specForLint({
        acceptance: [`The workflow ${phrase} for parents.`],
      }))
      expect(issues).toContainEqual({
        code: 'spec_vague_language',
        section: 'acceptance',
        bulletIndex: 0,
        term: 'fast',
      })
    }
  })

  test('explicit metric in the same bullet suppresses a vague-language match', () => {
    const issues = lintSpecQuality(specForLint({
      acceptance: ['The workflow should be fast under <200ms.'],
    }))
    expect(issues.some((issue) => issue.code === 'spec_vague_language')).toBe(false)
  })

  test('named control in the same bullet suppresses a vague-language match', () => {
    const issues = lintSpecQuality(specForLint({
      acceptance: ['The login flow must be secure with OAuth.'],
    }))
    expect(issues.some((issue) => issue.code === 'spec_vague_language')).toBe(false)
  })

  test('Goals with 2+ bullets do not trigger goals underspecified', () => {
    const issues = lintSpecQuality(specForLint({
      goals: ['Deliver ranked names.', 'Record parent choices.'],
    }))
    expect(issues.some((issue) => issue.code === 'spec_goals_underspecified')).toBe(false)
  })

  test('QH2: Goals with 2 bullets but combined <15 words does NOT warn (AND condition)', () => {
    const text = VALID.replace(
      [
        '## Goals',
        '',
        '- Help a parent name their newborn.',
        '- Suggest names balanced across given-name and surname pairings.',
      ].join('\n'),
      [
        '## Goals',
        '',
        '- Go.',
        '- Do.',
      ].join('\n'),
    )
    const issues = lintSpecQuality(parseSpec(text))
    const goalsUnder = issues.filter((i) => i.code === 'spec_goals_underspecified')
    expect(goalsUnder.length).toBe(0)
  })

  test('Goals with 1 bullet and at least 15 words do not trigger goals underspecified', () => {
    const issues = lintSpecQuality(specForLint({
      goals: [
        'Deliver a measurable onboarding workflow that records parent preferences and produces ranked name candidates before approval.',
      ],
    }))
    expect(issues.some((issue) => issue.code === 'spec_goals_underspecified')).toBe(false)
  })

  test('Goals with 1 bullet and fewer than 15 words trigger goals underspecified', () => {
    const issues = lintSpecQuality(specForLint({
      goals: ['Deliver ranked names.'],
    }))
    expect(issues).toContainEqual({
      code: 'spec_goals_underspecified',
      section: 'goals',
      bulletIndex: 0,
    })
  })

  test('issue objects expose only diagnostic fields', () => {
    const vagueIssue = lintSpecQuality(specForLint({
      acceptance: ['The workflow should be fast for parents.'],
    })).find((issue) => issue.code === 'spec_vague_language')
    const goalsIssue = lintSpecQuality(specForLint({
      goals: ['Deliver ranked names.'],
    })).find((issue) => issue.code === 'spec_goals_underspecified')
    expect(Object.keys(vagueIssue!)).toEqual(['code', 'section', 'bulletIndex', 'term'])
    expect(Object.keys(goalsIssue!)).toEqual(['code', 'section', 'bulletIndex'])
  })

  test('returned issue array is frozen', () => {
    const issues = lintSpecQuality(specForLint({
      acceptance: ['The workflow should be fast for parents.'],
    }))
    expect(Object.isFrozen(issues)).toBe(true)
  })
})
