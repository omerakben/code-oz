import { describe, test, expect } from 'bun:test'
import {
  parseSourceCheck,
  serializeSourceCheck,
  allocateSourceId,
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
