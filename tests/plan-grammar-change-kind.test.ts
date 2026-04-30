// Tests for the M8 PLAN.md `Files:` change-kind grammar extension.
//
// Locked grammar (per docs/contracts/PLAN.md § "Files entry grammar"):
//
//   - Each entry is `<path>` (bare) or `<path> (modified|added|deleted)`.
//   - Bare entries default to `change: 'modified'` for backward compatibility.
//   - Parenthetical values outside the locked enum fail with
//     `plan_task_malformed`.
//   - Serializer always emits the annotated form on canonical output.
//
// This file covers the parser/serializer surface only. BUILD preflight
// `plan_change_kind_drift` enforcement and mutation-gate applicability
// inference live in their own commits (M8 commits 6, 7).

import { describe, test, expect } from 'bun:test'
import {
  parsePlan,
  serializePlan,
  FILE_CHANGE_KINDS,
  DEFAULT_FILE_CHANGE_KIND,
  type FileChangeKind,
} from '../src/artifacts/plan.ts'
import { PlanLoadError } from '../src/artifacts/errors.ts'

const FILE = '<test-fixture>'

function makePlan(filesBullet: string): string {
  return `# PLAN

## Goals

- Decompose the SPEC into atomic tasks.

## Tasks

### T-001: Implement syllable scorer

- Files: ${filesBullet}
- Validation: bun test tests/scoring-syllable.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001

## Sources

- SPEC.md acceptance criterion 1.

## Out of scope

- None.

## Open questions

- None known at plan time.
`
}

function expectPlanLoadError(fn: () => unknown): PlanLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(PlanLoadError)
    return err as PlanLoadError
  }
  throw new Error('expected PlanLoadError to be thrown')
}

describe('PLAN.md Files change-kind: parsing', () => {
  test('exposes the locked enum', () => {
    expect(FILE_CHANGE_KINDS).toEqual(['modified', 'added', 'deleted'])
    expect(DEFAULT_FILE_CHANGE_KIND).toBe('modified')
  })

  test('parses fully annotated entries', () => {
    const plan = parsePlan(
      makePlan('src/scoring/syllable.ts (added), tests/scoring-syllable.test.ts (added)'),
      FILE,
    )
    const t = plan.tasks[0]!
    expect(t.fileChanges).toEqual([
      { path: 'src/scoring/syllable.ts', change: 'added' },
      { path: 'tests/scoring-syllable.test.ts', change: 'added' },
    ])
    expect(t.files).toEqual(['src/scoring/syllable.ts', 'tests/scoring-syllable.test.ts'])
  })

  test('parses every kind in the locked enum', () => {
    const plan = parsePlan(
      makePlan('src/a.ts (added), src/b.ts (modified), src/c.ts (deleted)'),
      FILE,
    )
    expect(plan.tasks[0]!.fileChanges.map((f) => f.change)).toEqual([
      'added',
      'modified',
      'deleted',
    ])
  })

  test('defaults bare entries to `modified` (backward compat)', () => {
    const plan = parsePlan(
      makePlan('src/scoring/syllable.ts, tests/scoring-syllable.test.ts'),
      FILE,
    )
    const t = plan.tasks[0]!
    expect(t.fileChanges).toEqual([
      { path: 'src/scoring/syllable.ts', change: 'modified' },
      { path: 'tests/scoring-syllable.test.ts', change: 'modified' },
    ])
  })

  test('handles mixed annotated and bare entries', () => {
    const plan = parsePlan(
      makePlan('src/a.ts (added), src/b.ts, tests/c.test.ts (added)'),
      FILE,
    )
    expect(plan.tasks[0]!.fileChanges).toEqual([
      { path: 'src/a.ts', change: 'added' },
      { path: 'src/b.ts', change: 'modified' },
      { path: 'tests/c.test.ts', change: 'added' },
    ])
  })

  test('keeps `task.files` as the path-only back-compat projection', () => {
    const plan = parsePlan(
      makePlan('src/a.ts (added), src/b.ts (modified), src/c.ts (deleted)'),
      FILE,
    )
    const t = plan.tasks[0]!
    expect(t.files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect(t.files).toEqual(t.fileChanges.map((f) => f.path))
  })

  test('tolerates extra whitespace inside the parenthetical', () => {
    const plan = parsePlan(
      makePlan('src/a.ts ( added ), src/b.ts(modified)'),
      FILE,
    )
    expect(plan.tasks[0]!.fileChanges).toEqual([
      { path: 'src/a.ts', change: 'added' },
      { path: 'src/b.ts', change: 'modified' },
    ])
  })

  test('returns frozen PlanTaskFile entries', () => {
    const plan = parsePlan(makePlan('src/a.ts (added)'), FILE)
    const t = plan.tasks[0]!
    expect(Object.isFrozen(t.fileChanges)).toBe(true)
    expect(Object.isFrozen(t.fileChanges[0])).toBe(true)
  })
})

describe('PLAN.md Files change-kind: validation', () => {
  test('rejects unknown change kind', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(makePlan('src/a.ts (refactored)'), FILE),
    )
    expect(err.issues.some((i) => i.rule.includes('Files entry change kind must be one of'))).toBe(
      true,
    )
  })

  test('rejects empty parenthetical', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(makePlan('src/a.ts ()'), FILE),
    )
    expect(err.issues.some((i) => i.code === 'plan_task_malformed')).toBe(true)
  })

  test('rejects misspelled kind', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(makePlan('src/a.ts (modifyed)'), FILE),
    )
    expect(err.issues.some((i) => i.rule.includes('Files entry change kind'))).toBe(true)
  })

  test('rejects multiple invalid kinds in one bullet', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(makePlan('src/a.ts (foo), src/b.ts (bar)'), FILE),
    )
    const ruleHits = err.issues.filter((i) => i.rule.includes('Files entry change kind'))
    expect(ruleHits.length).toBe(2)
  })

  test('reports the correct line number for the offending bullet', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(makePlan('src/a.ts (bogus)'), FILE),
    )
    const offending = err.issues.find((i) => i.rule.includes('Files entry change kind'))
    expect(offending?.line).toBeGreaterThan(0)
    expect(offending?.taskId).toBe('T-001')
  })
})

describe('PLAN.md Files change-kind: serialization', () => {
  test('always emits explicit annotation, even for bare-parsed entries', () => {
    const plan = parsePlan(makePlan('src/a.ts, src/b.ts'), FILE)
    const out = serializePlan(plan)
    expect(out).toContain('- Files: src/a.ts (modified), src/b.ts (modified)')
  })

  test('preserves explicit annotations on round-trip', () => {
    const original = makePlan('src/a.ts (added), src/b.ts (modified), src/c.ts (deleted)')
    const plan1 = parsePlan(original, FILE)
    const out = serializePlan(plan1)
    const plan2 = parsePlan(out, FILE)
    expect(plan2.tasks[0]!.fileChanges).toEqual(plan1.tasks[0]!.fileChanges)
  })

  test('emits the entries in source order', () => {
    const plan = parsePlan(
      makePlan('src/c.ts (deleted), src/a.ts (added), src/b.ts (modified)'),
      FILE,
    )
    const out = serializePlan(plan)
    expect(out).toContain('- Files: src/c.ts (deleted), src/a.ts (added), src/b.ts (modified)')
  })

  test('round-trip preserves files projection', () => {
    const original = makePlan('src/a.ts (added), src/b.ts (modified)')
    const plan1 = parsePlan(original, FILE)
    const plan2 = parsePlan(serializePlan(plan1), FILE)
    expect(plan2.tasks[0]!.files).toEqual(plan1.tasks[0]!.files)
  })
})

describe('PLAN.md Files change-kind: type surface', () => {
  test('FileChangeKind enum members are assignable to FileChangeKind type', () => {
    const a: FileChangeKind = 'added'
    const m: FileChangeKind = 'modified'
    const d: FileChangeKind = 'deleted'
    expect([a, m, d]).toEqual(['added', 'modified', 'deleted'])
  })

  test('FILE_CHANGE_KINDS is exposed as a frozen tuple of three', () => {
    expect(FILE_CHANGE_KINDS.length).toBe(3)
    expect(new Set<string>(FILE_CHANGE_KINDS).size).toBe(3)
  })
})
