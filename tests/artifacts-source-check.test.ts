import { describe, test, expect } from 'bun:test'
import {
  parseSourceCheck,
  serializeSourceCheck,
  allocateSourceId,
  adaptYamlStyleSourceCheck,
  SOURCE_CHECK_SECTION_KEYS,
} from '../src/artifacts/source-check.ts'
import { SourceCheckLoadError } from '../src/artifacts/errors.ts'

const FILE = '<test-fixture>'

function expectScLoadError(fn: () => unknown): SourceCheckLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(SourceCheckLoadError)
    return err as SourceCheckLoadError
  }
  throw new Error('expected SourceCheckLoadError to be thrown')
}

const VALID = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: Given a surname, the app produces 5 candidate given names.

### SC-SPEC-002: Constraint — runs locally

- Spec: SPEC.md ## Constraints, bullet 1
- Quote: Runs locally on a phone-class device.

## Reference sources

### SC-REF-001: Syllable-scoring pattern

- Path: ~/Projects/agents/templates/agent-skills/x.md
- Lines: 14-42
- Why: matches stress-pattern requirement.

### SC-REF-NONE-001: No reference for gender filter

- Searched: glob agents/templates/**/*name*.md
- Result: no relevant pattern found.
- Why explicit: SPEC question Q-001 is deferred.

## Docs sources

### SC-DOC-001: Bun File API

- Library: bun
- URL: https://bun.com/docs/api/file-io
- Section: Atomic writes
- Why: validates atomic-write idiom.

### SC-DOC-NONE-001: No library used for syllable detection

- Why explicit: scorer is hand-written; no API surface.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-001
- T-002 -> SC-SPEC-002, SC-REF-NONE-001, SC-DOC-NONE-001
`

describe('parseSourceCheck', () => {
  test('parses a fully valid SOURCE_CHECK.md', () => {
    const sc = parseSourceCheck(VALID, FILE)
    expect(sc.title).toBe('SOURCE_CHECK')
    expect(sc.specSources.length).toBe(2)
    expect(sc.referenceSources.length).toBe(2)
    expect(sc.docsSources.length).toBe(2)
    expect(sc.coverage.length).toBe(2)
  })

  test('discriminates source kinds', () => {
    const sc = parseSourceCheck(VALID, FILE)
    expect(sc.specSources[0]!.kind).toBe('SPEC')
    expect(sc.referenceSources[0]!.kind).toBe('REF')
    expect(sc.referenceSources[1]!.kind).toBe('REF-NONE')
    expect(sc.docsSources[0]!.kind).toBe('DOC')
    expect(sc.docsSources[1]!.kind).toBe('DOC-NONE')
  })

  test('parses field values per kind', () => {
    const sc = parseSourceCheck(VALID, FILE)
    expect(sc.specSources[0]!.spec).toContain('Acceptance criteria')
    expect(sc.specSources[0]!.quote).toContain('Given a surname')
    const ref = sc.referenceSources[0]!
    if (ref.kind === 'REF') {
      expect(ref.path).toContain('agent-skills')
      expect(ref.lines).toBe('14-42')
      expect(ref.why).toContain('stress-pattern')
    }
  })

  test('parses coverage entries', () => {
    const sc = parseSourceCheck(VALID, FILE)
    expect(sc.coverage[0]!.taskId).toBe('T-001')
    expect(sc.coverage[0]!.sourceIds).toEqual(['SC-SPEC-001', 'SC-REF-001', 'SC-DOC-001'])
  })

  test('rejects empty', () => {
    const err = expectScLoadError(() => parseSourceCheck('', FILE))
    expect(err.issues[0]!.code).toBe('source_check_empty')
  })

  test('rejects missing title', () => {
    const err = expectScLoadError(() => parseSourceCheck(VALID.replace('# SOURCE_CHECK\n\n', ''), FILE))
    expect(err.issues[0]!.code).toBe('source_check_missing_title')
  })

  test('rejects malformed source id', () => {
    const bad = VALID.replace('### SC-SPEC-001:', '### SPEC-1:')
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_id_format')).toBe(true)
  })

  test('rejects id_kind mismatch (REF id under Spec sources)', () => {
    const bad = VALID.replace('### SC-SPEC-001:', '### SC-REF-099:').replace(
      '### SC-SPEC-002:',
      '### SC-REF-100:',
    )
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_id_kind_mismatch')).toBe(true)
  })

  test('rejects id collision', () => {
    const bad = VALID.replace('### SC-SPEC-002:', '### SC-SPEC-001:')
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_id_collision')).toBe(true)
  })

  test('rejects missing required field on REF', () => {
    const bad = VALID.replace('- Lines: 14-42\n', '')
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_block_missing_field')).toBe(true)
  })

  test('rejects missing rationale on NONE', () => {
    const bad = VALID.replace(
      '- Why explicit: SPEC question Q-001 is deferred.',
      '- Searched: again',
    )
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    const codes = err.issues.map((i) => i.code)
    expect(codes).toContain('source_check_none_missing_rationale')
  })

  test('rejects coverage citing unknown source id', () => {
    const bad = VALID.replace('SC-DOC-001', 'SC-DOC-999')
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_coverage_unknown_source')).toBe(true)
  })

  test('rejects malformed coverage line', () => {
    const bad = VALID.replace(
      '- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-001',
      '- T-001 SC-SPEC-001',
    )
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_coverage_invalid')).toBe(true)
  })

  test('rejects malformed task id in coverage', () => {
    const bad = VALID.replace('- T-001 -> SC-SPEC-001', '- TASK-1 -> SC-SPEC-001')
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_coverage_invalid')).toBe(true)
  })

  test('rejects empty coverage', () => {
    const bad = VALID.replace(
      /## Coverage\n\n[\s\S]*$/,
      '## Coverage\n\n',
    )
    const err = expectScLoadError(() => parseSourceCheck(bad, FILE))
    expect(err.issues.some((i) => i.code === 'source_check_section_empty')).toBe(true)
  })
})

describe('serializeSourceCheck', () => {
  test('round-trips', () => {
    const sc = parseSourceCheck(VALID, FILE)
    const out = serializeSourceCheck(sc)
    const reparsed = parseSourceCheck(out, FILE)
    expect(reparsed.specSources.length).toBe(sc.specSources.length)
    expect(reparsed.coverage[0]!.sourceIds).toEqual(sc.coverage[0]!.sourceIds)
  })

  test('emits LF only and trailing newline', () => {
    const sc = parseSourceCheck(VALID, FILE)
    const out = serializeSourceCheck(sc)
    expect(out.includes('\r')).toBe(false)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  test('includes ## Open questions only when present', () => {
    const sc = parseSourceCheck(VALID, FILE)
    const out = serializeSourceCheck(sc)
    expect(out.includes('## Open questions')).toBe(false)
  })
})

describe('allocateSourceId', () => {
  test('returns SC-SPEC-001 when none exist', () => {
    expect(allocateSourceId('SPEC', [])).toBe('SC-SPEC-001')
  })

  test('returns next free per-kind id', () => {
    expect(allocateSourceId('REF', ['SC-REF-001', 'SC-REF-002'])).toBe('SC-REF-003')
  })

  test('REF and REF-NONE allocate independently', () => {
    expect(allocateSourceId('REF-NONE', ['SC-REF-001', 'SC-REF-002'])).toBe('SC-REF-NONE-001')
    expect(allocateSourceId('REF', ['SC-REF-NONE-001'])).toBe('SC-REF-001')
  })
})

describe('SOURCE_CHECK_SECTION_KEYS', () => {
  test('canonical order matches contract', () => {
    expect(SOURCE_CHECK_SECTION_KEYS).toEqual([
      'specSources',
      'referenceSources',
      'docsSources',
      'coverage',
      'openQuestions',
    ])
  })
})

// Issue #3 regression: greenfield REF-NONE schema-drift tolerance.
// LLMs (especially on greenfield projects) emit REF-NONE blocks with
// REF-schema fields (Path, Lines) mixed in, and merge the search action and
// result into one Searched bullet. The parser tolerates extra fields and
// synthesizes a Result when the Searched bullet embeds a clear empty-result
// indicator. Without these tolerances the PLAN phase failed 3/3 retries on
// every greenfield project.
describe('parseSourceCheck — REF-NONE greenfield tolerance (issue #3)', () => {
  const baseFor = (refNoneBody: string) => `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: x

## Reference sources

### SC-REF-NONE-001: Greenfield — no prior implementation

${refNoneBody}

## Docs sources

### SC-DOC-NONE-001: no library

- Why explicit: hand-written.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

  test('(a) clean REF-NONE block with three required fields parses cleanly', () => {
    const sc = parseSourceCheck(
      baseFor(
        `- Searched: glob **/*.ts
- Result: 0 files
- Why explicit: greenfield project; structure introduced from scratch`,
      ),
      FILE,
    )
    const ref = sc.referenceSources[0]!
    expect(ref.kind).toBe('REF-NONE')
    if (ref.kind === 'REF-NONE') {
      expect(ref.searched).toBe('glob **/*.ts')
      expect(ref.result).toBe('0 files')
      expect(ref.whyExplicit).toContain('greenfield')
    }
  })

  test('(b) REF-NONE block with extra Path/Lines fields parses (extras ignored)', () => {
    const sc = parseSourceCheck(
      baseFor(
        `- Searched: glob **/*.ts
- Path: N/A
- Lines: N/A
- Result: 0 files
- Why explicit: greenfield project; nothing to reference`,
      ),
      FILE,
    )
    const ref = sc.referenceSources[0]!
    expect(ref.kind).toBe('REF-NONE')
    if (ref.kind === 'REF-NONE') {
      expect(ref.searched).toBe('glob **/*.ts')
      expect(ref.result).toBe('0 files')
      // Round-trip: serializer drops the extras — canonical form has 3 bullets only.
      const out = serializeSourceCheck(sc)
      expect(out).not.toContain('- Path: N/A')
      expect(out).not.toContain('- Lines: N/A')
    }
  })

  const synthesisCases: ReadonlyArray<{ searched: string; matchToken: string }> = [
    { searched: 'glob **/*.ts (no files)', matchToken: 'no files' },
    { searched: 'ls -la (only . and ..)', matchToken: 'only . and ..' },
    { searched: 'find src -type f (empty)', matchToken: 'empty' },
    { searched: 'glob ** returned 0 results', matchToken: 'returned 0' },
    { searched: 'grep "auth" src/ — no matching files', matchToken: 'no matching files' },
    { searched: 'tree . shows empty repository', matchToken: 'empty repository' },
    // Bare (unparenthesized) forms added in PR #4 review pass.
    { searched: 'glob **/*.ts found 0 files', matchToken: '0 files (bare)' },
    { searched: 'ls -la shows only . and .. entries', matchToken: 'only . and .. (bare)' },
    { searched: 'grep "auth" src/ no matching pattern', matchToken: 'no matching pattern' },
  ]

  for (const { searched, matchToken } of synthesisCases) {
    test(`(c) Searched embedding "${matchToken}" but missing Result auto-synthesizes`, () => {
      const sc = parseSourceCheck(
        baseFor(
          `- Searched: ${searched}
- Why explicit: greenfield project; nothing to reference`,
        ),
        FILE,
      )
      const ref = sc.referenceSources[0]!
      expect(ref.kind).toBe('REF-NONE')
      if (ref.kind === 'REF-NONE') {
        expect(ref.result.length).toBeGreaterThan(0)
        expect(ref.result).toContain('auto-extracted')
      }
    })
  }

  test('(c2) extra Path/Lines + missing Result with embedded indicator still synthesizes', () => {
    // The exact pattern observed in the wild on greenfield runs (issue #3).
    const sc = parseSourceCheck(
      baseFor(
        `- Searched: glob ** (no files)
- Path: N/A
- Lines: N/A
- Why explicit: greenfield project; structure introduced from scratch per SPEC`,
      ),
      FILE,
    )
    const ref = sc.referenceSources[0]!
    expect(ref.kind).toBe('REF-NONE')
    if (ref.kind === 'REF-NONE') {
      expect(ref.searched).toContain('(no files)')
      expect(ref.result).toContain('auto-extracted')
    }
  })

  test('(d) REF-NONE block with no Searched and no Result still fails', () => {
    const err = expectScLoadError(() =>
      parseSourceCheck(
        baseFor(`- Why explicit: greenfield project; nothing to reference`),
        FILE,
      ),
    )
    const codes = err.issues.map((i) => i.code)
    // Both Searched and Result are missing — the synthesis cannot fire without
    // a Searched value to extract from, so the strict missing-field error
    // must still surface.
    expect(codes).toContain('source_check_block_missing_field')
  })

  test('(d2) REF-NONE block with neutral Searched but missing Result still fails (no embedded pattern to synthesize from)', () => {
    const err = expectScLoadError(() =>
      parseSourceCheck(
        baseFor(
          `- Searched: ran some queries but did not record outcome
- Why explicit: greenfield project; nothing to reference`,
        ),
        FILE,
      ),
    )
    const codes = err.issues.map((i) => i.code)
    expect(codes).toContain('source_check_block_missing_field')
  })

  test('synthesized Result round-trips through serializer cleanly', () => {
    const sc = parseSourceCheck(
      baseFor(
        `- Searched: glob ** (no files)
- Why explicit: greenfield project; nothing to reference`,
      ),
      FILE,
    )
    const out = serializeSourceCheck(sc)
    // The serialized form contains a real Result bullet now.
    expect(out).toContain('- Result:')
    expect(out).toContain('auto-extracted')
    // And reparsing the canonical form succeeds with the same Result.
    const reparsed = parseSourceCheck(out, FILE)
    const ref = reparsed.referenceSources[0]!
    expect(ref.kind).toBe('REF-NONE')
    if (ref.kind === 'REF-NONE') {
      expect(ref.result).toContain('auto-extracted')
    }
  })
})

// --- issue #8: YAML-style SOURCE_CHECK tolerance (section level) ---

const YAML_SC_BULLET_SECTIONS = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: Given a surname, the app produces 5 candidate given names.

## Reference sources

### SC-REF-NONE-001: no reference found

- Searched: glob src/**/scoring.ts
- Result: no matching files (auto-extracted from Searched)
- Why explicit: greenfield repo with no prior scoring module.

## Docs sources

### SC-DOC-001: bun test docs

- Library: bun
- URL: https://bun.sh/docs/test
- Section: pattern matching
- Why: bun-native test harness.

coverage:
  - T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001

open_questions:
  - none yet.
`

describe('adaptYamlStyleSourceCheck (issue #8)', () => {
  test('returns input unchanged when no YAML markers are present', () => {
    expect(adaptYamlStyleSourceCheck(VALID)).toBe(VALID)
  })

  test('returns input unchanged for empty / pre-title content', () => {
    expect(adaptYamlStyleSourceCheck('')).toBe('')
    expect(adaptYamlStyleSourceCheck('# SOURCE_CHECK\n')).toBe('# SOURCE_CHECK\n')
  })

  test('rewrites top-level YAML keys to canonical H2 headings (Coverage + Open questions)', () => {
    const out = adaptYamlStyleSourceCheck(YAML_SC_BULLET_SECTIONS)
    expect(out).toContain('## Coverage')
    expect(out).toContain('## Open questions')
  })

  test('preserves canonical source sections verbatim', () => {
    const out = adaptYamlStyleSourceCheck(YAML_SC_BULLET_SECTIONS)
    expect(out).toContain('### SC-SPEC-001:')
    expect(out).toContain('### SC-REF-NONE-001:')
    expect(out).toContain('### SC-DOC-001:')
    expect(out).toContain('- Spec: SPEC.md')
    expect(out).toContain('- Library: bun')
  })

  test('preserves bullet content from indented Coverage YAML list', () => {
    const out = adaptYamlStyleSourceCheck(YAML_SC_BULLET_SECTIONS)
    expect(out).toContain('- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001')
  })

  test('rewrites YAML source-section keys to canonical H2 (heading-only)', () => {
    // When the persona uses YAML for the source SECTIONS too, the adapter
    // emits the canonical heading so the strict parser can run. The body
    // must already be canonical H3 blocks (the persona prompt forbids
    // nested YAML); if it isn't, the strict parser will reject it.
    const yamlSections = `# SOURCE_CHECK

spec_sources:

### SC-SPEC-001: AC 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: Given a surname, the app produces 5 candidate given names.

reference_sources:

### SC-REF-NONE-001: no reference

- Searched: glob src/**/scoring.ts
- Result: no matching files (auto-extracted from Searched)
- Why explicit: greenfield.

docs_sources:

### SC-DOC-001: bun test

- Library: bun
- URL: https://bun.sh/docs/test
- Section: pattern matching
- Why: bun harness.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001
`
    const out = adaptYamlStyleSourceCheck(yamlSections)
    expect(out).toContain('## Spec sources')
    expect(out).toContain('## Reference sources')
    expect(out).toContain('## Docs sources')
  })

  test('normalises snake_case / camelCase / kebab-case key aliases', () => {
    // Use an input where the source sections already have headings + blocks,
    // and only the bullet sections (Coverage + Open questions) drift to YAML
    // with alias keys.
    const variants = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: t

- Spec: SPEC.md AC-1
- Quote: q

## Reference sources

### SC-REF-NONE-001: t

- Searched: glob src/**/x.ts
- Result: no matching files
- Why explicit: greenfield.

## Docs sources

### SC-DOC-001: t

- Library: bun
- URL: https://bun.sh/docs/test
- Section: s
- Why: w

COVERAGE:
  - T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001

openQuestions:
  - q
`
    const out = adaptYamlStyleSourceCheck(variants)
    expect(out).toContain('## Coverage')
    expect(out).toContain('## Open questions')
  })
})

describe('parseSourceCheck — issue #8 YAML tolerance', () => {
  test('parses YAML-style Coverage + Open questions end-to-end', () => {
    const sc = parseSourceCheck(YAML_SC_BULLET_SECTIONS)
    expect(sc.title).toBe('SOURCE_CHECK')
    expect(sc.specSources.length).toBe(1)
    expect(sc.referenceSources.length).toBe(1)
    expect(sc.docsSources.length).toBe(1)
    expect(sc.coverage.length).toBe(1)
    expect(sc.coverage[0]!.taskId).toBe('T-001')
    expect(sc.openQuestions).toEqual(['none yet.'])
  })

  test('round-trips YAML-style sections through serialize → reparse to canonical', () => {
    const sc = parseSourceCheck(YAML_SC_BULLET_SECTIONS)
    const serialized = serializeSourceCheck(sc)
    expect(serialized).toContain('## Coverage')
    expect(serialized).not.toMatch(/^coverage:/m)
    expect(serialized).not.toMatch(/^open_questions:/m)
    const reparsed = parseSourceCheck(serialized)
    expect(reparsed.coverage.length).toBe(sc.coverage.length)
    expect(reparsed.openQuestions).toEqual(sc.openQuestions)
  })

  test('flow list with quoted comma in Coverage keeps the scalar intact', () => {
    // Quote-aware splitter regression on Coverage's flow list.
    const yaml = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: t

- Spec: SPEC.md AC-1
- Quote: "Given a surname, the app produces 5 names."

## Reference sources

### SC-REF-NONE-001: t

- Searched: glob src/**/x.ts
- Result: no matching files
- Why explicit: greenfield.

## Docs sources

### SC-DOC-001: t

- Library: bun
- URL: https://bun.sh/docs/test
- Section: s
- Why: w

coverage: ["T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001"]
`
    const sc = parseSourceCheck(yaml)
    expect(sc.coverage.length).toBe(1)
    expect(sc.coverage[0]!.taskId).toBe('T-001')
  })

  test('YAML continuation line in Open questions is folded, not dropped', () => {
    const yaml = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: t

- Spec: SPEC.md AC-1
- Quote: q

## Reference sources

### SC-REF-NONE-001: t

- Searched: glob src/**/x.ts
- Result: no matching files
- Why explicit: greenfield.

## Docs sources

### SC-DOC-001: t

- Library: bun
- URL: https://bun.sh/docs/test
- Section: s
- Why: w

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001

open_questions:
  - First question line one
    continuation of first question
`
    const sc = parseSourceCheck(yaml)
    expect(sc.openQuestions).toEqual(['First question line one continuation of first question'])
  })

  test('escaped double quote in flow scalar does not corrupt comma split', () => {
    // PR #10 round-2 block-push regression mirrored to SOURCE_CHECK. The
    // Coverage flow scalar exercises quoted-comma split (commas embedded in
    // quoted scalars must not split top-level entries). The Open questions
    // flow scalar exercises escape handling — `\"` inside a quoted scalar
    // must not toggle quote state, so the inner comma stays inside the
    // scalar and the two top-level entries split correctly.
    const yaml = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: t

- Spec: SPEC.md AC-1
- Quote: q

## Reference sources

### SC-REF-NONE-001: t

- Searched: glob src/**/x.ts
- Result: no matching files
- Why explicit: greenfield.

## Docs sources

### SC-DOC-001: t

- Library: bun
- URL: https://bun.sh/docs/test
- Section: s
- Why: w

coverage: ["T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001", "T-002 -> SC-SPEC-001"]
open_questions: ["why does \\"a, b\\" not parse", "second"]
`
    const sc = parseSourceCheck(yaml)
    expect(sc.coverage.length).toBe(2)
    expect(sc.coverage[0]!.taskId).toBe('T-001')
    expect(sc.coverage[1]!.taskId).toBe('T-002')
    expect(sc.openQuestions.length).toBe(2)
    expect(sc.openQuestions[0]).toContain('a, b')
    expect(sc.openQuestions[1]).toBe('second')
  })

  test('nested YAML map under Coverage key is rejected, not flattened', () => {
    // PR #10 round-2 block-push regression mirrored to SOURCE_CHECK.
    const yaml = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: t

- Spec: SPEC.md AC-1
- Quote: q

## Reference sources

### SC-REF-NONE-001: t

- Searched: glob src/**/x.ts
- Result: no matching files
- Why explicit: greenfield.

## Docs sources

### SC-DOC-001: t

- Library: bun
- URL: https://bun.sh/docs/test
- Section: s
- Why: w

coverage:
  - T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001
    nested:
      - x
`
    expect(() => parseSourceCheck(yaml)).toThrow()
  })

  test('still rejects nested YAML source blocks (defense layer 1: persona prompt)', () => {
    // Nested `- id: SC-NNN` form is intentionally NOT rewritten by the
    // section-level adapter. The strict parser correctly rejects it.
    const nestedYaml = `# SOURCE_CHECK

## Spec sources

- id: SC-SPEC-001
  title: AC 1
  spec: SPEC.md AC-1
  quote: q

## Reference sources

### SC-REF-NONE-001: t

- Searched: glob ** (no files)
- Result: no matching files
- Why explicit: greenfield.

## Docs sources

### SC-DOC-001: t

- Library: bun
- URL: https://bun.sh/docs/test
- Section: s
- Why: w

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-001
`
    expect(() => parseSourceCheck(nestedYaml)).toThrow()
  })
})
