import { describe, test, expect } from 'bun:test'
import {
  parsePlan,
  serializePlan,
  hasMinimumContent,
  allocateTaskId,
  PLAN_SECTION_KEYS,
  TASK_BULLET_KEYS,
  type PlanArtifact,
  type PlanTask,
} from '../src/artifacts/plan.ts'
import { PlanLoadError } from '../src/artifacts/errors.ts'

const FILE = '<test-fixture>'

function expectPlanLoadError(fn: () => unknown): PlanLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(PlanLoadError)
    return err as PlanLoadError
  }
  throw new Error('expected PlanLoadError to be thrown')
}

const VALID = `# PLAN

## Goals

- Decompose the SPEC into atomic tasks.
- Cover every acceptance criterion.

## Tasks

### T-001: Implement syllable scorer

- Files: src/scoring/syllable.ts, tests/scoring-syllable.test.ts
- Validation: bun test tests/scoring-syllable.test.ts
- Risk: Stress-pattern detection on multisyllabic surnames is heuristic.
- Hypotheses: H-001, H-002
- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-001

### T-002: Wire scorer into candidate selector

- Files: src/candidates/select.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: none
- Hypotheses: none
- Sources: SC-SPEC-002, SC-REF-NONE-001

## Sources

- SPEC.md acceptance criteria 1, 3 (covered by T-001, T-002).

## Out of scope

- Surname generation (SPEC explicit non-goal).

## Open questions

- Q-001: gender-neutral suggestions only?
`

describe('parsePlan', () => {
  test('parses a fully valid PLAN.md with two tasks', () => {
    const plan = parsePlan(VALID, FILE)
    expect(plan.title).toBe('PLAN')
    expect(plan.goals.length).toBe(2)
    expect(plan.tasks.length).toBe(2)
    expect(plan.sources.length).toBe(1)
    expect(plan.outOfScope.length).toBe(1)
    expect(plan.openQuestions.length).toBe(1)
  })

  test('parses task fields correctly', () => {
    const plan = parsePlan(VALID, FILE)
    const t1 = plan.tasks[0]!
    expect(t1.id).toBe('T-001')
    expect(t1.title).toBe('Implement syllable scorer')
    expect(t1.files).toEqual(['src/scoring/syllable.ts', 'tests/scoring-syllable.test.ts'])
    expect(t1.validation).toBe('bun test tests/scoring-syllable.test.ts')
    expect(t1.risk).toBe('Stress-pattern detection on multisyllabic surnames is heuristic.')
    expect(t1.hypotheses).toEqual(['H-001', 'H-002'])
    expect(t1.sources).toEqual(['SC-SPEC-001', 'SC-REF-001', 'SC-DOC-001'])
  })

  test('treats `Hypotheses: none` as an empty list', () => {
    const plan = parsePlan(VALID, FILE)
    const t2 = plan.tasks[1]!
    expect(t2.hypotheses).toEqual([])
  })

  test('returns a frozen artifact', () => {
    const plan = parsePlan(VALID, FILE)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.tasks)).toBe(true)
    expect(Object.isFrozen(plan.tasks[0])).toBe(true)
  })

  test('rejects empty input', () => {
    const err = expectPlanLoadError(() => parsePlan('   \n\n', FILE))
    expect(err.issues[0]!.code).toBe('plan_empty')
  })

  test('rejects missing title', () => {
    const err = expectPlanLoadError(() => parsePlan(VALID.replace('# PLAN\n\n', ''), FILE))
    expect(err.issues[0]!.code).toBe('plan_missing_title')
  })

  test('rejects out-of-order sections', () => {
    const ooo = VALID.replace(
      '## Goals\n\n- Decompose the SPEC into atomic tasks.\n- Cover every acceptance criterion.',
      '## Sources\n\n- foo',
    ).replace(
      '## Sources\n\n- SPEC.md acceptance criteria 1, 3 (covered by T-001, T-002).',
      '## Goals\n\n- Decompose the SPEC.',
    )
    const err = expectPlanLoadError(() => parsePlan(ooo, FILE))
    expect(err.issues.some((i) => i.code === 'plan_section_out_of_order')).toBe(true)
  })

  test('rejects missing required section', () => {
    const err = expectPlanLoadError(() =>
      parsePlan(VALID.replace(/## Open questions[\s\S]*$/, ''), FILE),
    )
    expect(err.issues.some((i) => i.code === 'plan_missing_section')).toBe(true)
  })

  test('rejects empty Tasks section', () => {
    const empty = VALID.replace(
      /## Tasks[\s\S]*?(?=## Sources)/,
      '## Tasks\n\n',
    )
    const err = expectPlanLoadError(() => parsePlan(empty, FILE))
    expect(err.issues.some((i) => i.code === 'plan_section_empty')).toBe(true)
  })

  test('rejects task with malformed id', () => {
    const bad = VALID.replace('### T-001:', '### TASK-001:')
    const err = expectPlanLoadError(() => parsePlan(bad, FILE))
    expect(err.issues.some((i) => i.code === 'plan_task_id_format')).toBe(true)
  })

  test('rejects duplicate task ids', () => {
    const dup = VALID.replace('### T-002:', '### T-001:')
    const err = expectPlanLoadError(() => parsePlan(dup, FILE))
    expect(err.issues.some((i) => i.code === 'plan_task_id_collision')).toBe(true)
  })

  test('rejects task missing a required bullet', () => {
    const missing = VALID.replace(
      '- Risk: Stress-pattern detection on multisyllabic surnames is heuristic.\n',
      '',
    )
    const err = expectPlanLoadError(() => parsePlan(missing, FILE))
    expect(err.issues.some((i) => i.code === 'plan_task_missing_block')).toBe(true)
  })

  test('rejects task bullet out of canonical order', () => {
    const swapped = VALID.replace(
      '- Files: src/scoring/syllable.ts, tests/scoring-syllable.test.ts\n- Validation: bun test tests/scoring-syllable.test.ts\n- Risk: Stress-pattern detection on multisyllabic surnames is heuristic.\n- Hypotheses: H-001, H-002\n- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-001',
      '- Files: src/scoring/syllable.ts\n- Risk: r\n- Validation: bun test x\n- Hypotheses: H-001\n- Sources: SC-SPEC-001',
    )
    const err = expectPlanLoadError(() => parsePlan(swapped, FILE))
    expect(err.issues.some((i) => i.code === 'plan_task_malformed')).toBe(true)
  })

  test('rejects unknown task bullet key', () => {
    const bad = VALID.replace('- Risk: Stress-pattern', '- RiskFoo: Stress-pattern')
    const err = expectPlanLoadError(() => parsePlan(bad, FILE))
    const codes = err.issues.map((i) => i.code)
    expect(codes).toContain('plan_task_malformed')
  })

  test('rejects empty task bullet value', () => {
    const bad = VALID.replace(
      '- Risk: Stress-pattern detection on multisyllabic surnames is heuristic.',
      '- Risk:',
    )
    const err = expectPlanLoadError(() => parsePlan(bad, FILE))
    expect(err.issues.some((i) => i.code === 'plan_task_malformed')).toBe(true)
  })

  test('rejects H3 outside ## Tasks', () => {
    const bad = VALID.replace(
      '## Sources\n\n- SPEC.md',
      '## Sources\n\n### Subhead\n\n- SPEC.md',
    )
    const err = expectPlanLoadError(() => parsePlan(bad, FILE))
    expect(err.issues.some((i) => i.code === 'plan_unexpected_content')).toBe(true)
  })

  test('rejects code fences', () => {
    const bad = VALID.replace(
      '## Sources\n\n- SPEC.md',
      '## Sources\n\n```ts\nfoo\n```\n\n- SPEC.md',
    )
    const err = expectPlanLoadError(() => parsePlan(bad, FILE))
    expect(err.issues.some((i) => i.code === 'plan_unexpected_content')).toBe(true)
  })

  test('rejects bullet inside Tasks but outside any task block', () => {
    const bad = VALID.replace('### T-001:', '- stray bullet\n\n### T-001:')
    const err = expectPlanLoadError(() => parsePlan(bad, FILE))
    expect(err.issues.some((i) => i.code === 'plan_unexpected_content')).toBe(true)
  })
})

describe('serializePlan', () => {
  test('round-trips a parsed PLAN', () => {
    const plan = parsePlan(VALID, FILE)
    const out = serializePlan(plan)
    const reparsed = parsePlan(out, FILE)
    expect(reparsed.tasks.length).toBe(plan.tasks.length)
    expect(reparsed.tasks[0]!.id).toBe(plan.tasks[0]!.id)
    expect(reparsed.tasks[0]!.files).toEqual(plan.tasks[0]!.files)
    expect(reparsed.tasks[1]!.hypotheses).toEqual([])
  })

  test('emits canonical bullet order in tasks', () => {
    const plan = parsePlan(VALID, FILE)
    const out = serializePlan(plan)
    const t1 = out.indexOf('### T-001:')
    const filesIdx = out.indexOf('- Files:', t1)
    const validationIdx = out.indexOf('- Validation:', t1)
    const riskIdx = out.indexOf('- Risk:', t1)
    const hypIdx = out.indexOf('- Hypotheses:', t1)
    const srcIdx = out.indexOf('- Sources:', t1)
    expect(filesIdx).toBeLessThan(validationIdx)
    expect(validationIdx).toBeLessThan(riskIdx)
    expect(riskIdx).toBeLessThan(hypIdx)
    expect(hypIdx).toBeLessThan(srcIdx)
  })

  test('serializes empty hypotheses as `Hypotheses: none`', () => {
    const plan = parsePlan(VALID, FILE)
    const out = serializePlan(plan)
    expect(out).toContain('- Hypotheses: none')
  })

  test('emits LF only and ends with one newline', () => {
    const plan = parsePlan(VALID, FILE)
    const out = serializePlan(plan)
    expect(out.includes('\r')).toBe(false)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })
})

describe('allocateTaskId', () => {
  test('returns T-001 when no tasks exist', () => {
    expect(allocateTaskId([])).toBe('T-001')
  })

  test('returns next free id, padding to three digits', () => {
    const tasks: PlanTask[] = [
      { id: 'T-001', title: 't', files: ['x'], validation: 'v', risk: 'r', hypotheses: [], sources: ['s'] },
      { id: 'T-002', title: 't', files: ['x'], validation: 'v', risk: 'r', hypotheses: [], sources: ['s'] },
    ]
    expect(allocateTaskId(tasks)).toBe('T-003')
  })

  test('handles wide id values', () => {
    const tasks: PlanTask[] = [
      { id: 'T-099', title: 't', files: ['x'], validation: 'v', risk: 'r', hypotheses: [], sources: ['s'] },
    ]
    expect(allocateTaskId(tasks)).toBe('T-100')
  })
})

describe('hasMinimumContent', () => {
  test('true when every section has content', () => {
    const plan = parsePlan(VALID, FILE)
    expect(hasMinimumContent(plan)).toBe(true)
  })

  test('false when tasks are empty', () => {
    const plan: PlanArtifact = {
      title: 'PLAN',
      goals: ['G'],
      tasks: [],
      sources: ['S'],
      outOfScope: ['O'],
      openQuestions: ['Q'],
    }
    expect(hasMinimumContent(plan)).toBe(false)
  })
})

describe('PLAN_SECTION_KEYS', () => {
  test('canonical order matches contract', () => {
    expect(PLAN_SECTION_KEYS).toEqual(['goals', 'tasks', 'sources', 'outOfScope', 'openQuestions'])
  })
})

describe('TASK_BULLET_KEYS', () => {
  test('canonical order matches contract', () => {
    expect(TASK_BULLET_KEYS).toEqual(['Files', 'Validation', 'Risk', 'Hypotheses', 'Sources'])
  })
})
