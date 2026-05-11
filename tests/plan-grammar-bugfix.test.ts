// Tests for the optional `Bugfix:` task bullet in PLAN.md (locked grammar
// extension per docs/contracts/PLAN.md § "Task block grammar").
//
// Closes Codex PR #15 P2 fix-soon: the plan-schema validation was too rigid
// for bug-fix tasks that reuse a pre-existing failing test as their
// reproduction. Forcing the test path into `Files:` would attach a misleading
// `(modified)` change-kind annotation to an untouched file. The optional
// `Bugfix:` bullet provides an explicit declarative signal instead.
//
// Discipline:
//   - `Bugfix:` is OPTIONAL. Absent task blocks parse exactly as before.
//   - When present, it must be the last bullet in the block (canonical order).
//   - The value is a single existing test path (no commas, non-empty).
//   - The parsed PlanTask gains an optional `bugfix?: { existingTest: string }`
//     field; the serializer emits the line only when set.

import { describe, test, expect } from 'bun:test'
import {
  parsePlan,
  serializePlan,
  ALL_TASK_BULLET_KEYS,
  OPTIONAL_TASK_BULLET_KEYS,
  TASK_BULLET_KEYS,
  type PlanTaskBugfix,
} from '../src/artifacts/plan.ts'
import { PlanLoadError } from '../src/artifacts/errors.ts'

const FILE = '<test-fixture>'

function makePlan(taskBlock: string): string {
  return `# PLAN

## Goals

- Decompose the SPEC into atomic tasks.

## Tasks

${taskBlock}

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

describe('PLAN.md Bugfix bullet: surface', () => {
  test('OPTIONAL_TASK_BULLET_KEYS exposes the locked optional tail', () => {
    expect(OPTIONAL_TASK_BULLET_KEYS).toEqual(['Bugfix'])
  })

  test('ALL_TASK_BULLET_KEYS unions required and optional in canonical order', () => {
    expect(ALL_TASK_BULLET_KEYS).toEqual([
      ...TASK_BULLET_KEYS,
      ...OPTIONAL_TASK_BULLET_KEYS,
    ])
  })
})

describe('PLAN.md Bugfix bullet: parsing', () => {
  test('parses a bug-fix task with the optional Bugfix line', () => {
    const plan = parsePlan(
      makePlan(`### T-001: Fix off-by-one in date roller

- Files: src/dates/roll.ts (modified)
- Validation: bun test tests/date-roll.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001
- Bugfix: tests/date-roll.test.ts`),
      FILE,
    )
    const t = plan.tasks[0]!
    const bug: PlanTaskBugfix | undefined = t.bugfix
    expect(bug).toEqual({ existingTest: 'tests/date-roll.test.ts' })
    expect(t.files).toEqual(['src/dates/roll.ts'])
  })

  test('leaves bugfix undefined when the bullet is absent', () => {
    const plan = parsePlan(
      makePlan(`### T-001: Add scorer

- Files: src/scoring.ts (added)
- Validation: bun test tests/scoring.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001`),
      FILE,
    )
    expect(plan.tasks[0]!.bugfix).toBeUndefined()
  })

  test('tolerates whitespace around the path', () => {
    const plan = parsePlan(
      makePlan(`### T-001: Fix bug

- Files: src/a.ts (modified)
- Validation: bun test tests/a.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001
- Bugfix:   tests/a.test.ts   `),
      FILE,
    )
    expect(plan.tasks[0]!.bugfix?.existingTest).toBe('tests/a.test.ts')
  })
})

describe('PLAN.md Bugfix bullet: validation', () => {
  test('rejects Bugfix with an empty value', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(
        makePlan(`### T-001: Fix bug

- Files: src/a.ts (modified)
- Validation: bun test tests/a.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001
- Bugfix: `),
        FILE,
      ),
    )
    expect(
      err.issues.some(
        (i) =>
          i.code === 'plan_task_malformed' &&
          (i.rule.includes('Bugfix') || i.rule.includes('must have a value')),
      ),
    ).toBe(true)
  })

  test('rejects Bugfix with multiple comma-separated paths', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(
        makePlan(`### T-001: Fix bug

- Files: src/a.ts (modified)
- Validation: bun test tests/a.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001
- Bugfix: tests/a.test.ts, tests/b.test.ts`),
        FILE,
      ),
    )
    expect(
      err.issues.some(
        (i) => i.code === 'plan_task_malformed' && i.rule.includes('Bugfix'),
      ),
    ).toBe(true)
  })

  test('rejects Bugfix that appears before a required bullet (order)', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(
        makePlan(`### T-001: Fix bug

- Files: src/a.ts (modified)
- Validation: bun test tests/a.test.ts
- Risk: none
- Hypotheses: none
- Bugfix: tests/a.test.ts
- Sources: SC-SPEC-001`),
        FILE,
      ),
    )
    expect(
      err.issues.some(
        (i) =>
          i.code === 'plan_task_malformed' &&
          i.rule.includes('canonical order'),
      ),
    ).toBe(true)
  })

  test('rejects duplicate Bugfix bullets', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(
        makePlan(`### T-001: Fix bug

- Files: src/a.ts (modified)
- Validation: bun test tests/a.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001
- Bugfix: tests/a.test.ts
- Bugfix: tests/b.test.ts`),
        FILE,
      ),
    )
    expect(
      err.issues.some(
        (i) =>
          i.code === 'plan_task_malformed' &&
          i.rule.includes('appears more than once'),
      ),
    ).toBe(true)
  })
})

describe('PLAN.md Bugfix bullet: serialization', () => {
  test('emits the Bugfix line when bugfix is set, and only then', () => {
    const original = makePlan(`### T-001: Fix bug

- Files: src/a.ts (modified)
- Validation: bun test tests/a.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001
- Bugfix: tests/a.test.ts`)
    const plan = parsePlan(original, FILE)
    const out = serializePlan(plan)
    expect(out).toContain('- Bugfix: tests/a.test.ts')

    // Round-trip preserves the bullet
    const plan2 = parsePlan(out, FILE)
    expect(plan2.tasks[0]!.bugfix?.existingTest).toBe('tests/a.test.ts')
  })

  test('omits the Bugfix line when bugfix is unset', () => {
    const plan = parsePlan(
      makePlan(`### T-001: Add scorer

- Files: src/scoring.ts (added)
- Validation: bun test tests/scoring.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-001`),
      FILE,
    )
    const out = serializePlan(plan)
    expect(out).not.toContain('Bugfix:')
  })
})
