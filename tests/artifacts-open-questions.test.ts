import { describe, test, expect } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseOpenQuestions,
  serializeOpenQuestions,
  allocateQuestionId,
  findGateBlockingQuestions,
  writeOpenQuestions,
  adaptYamlStyleOpenQuestions,
  QUESTION_STATUSES,
  QUESTION_IMPORTANCES,
} from '../src/artifacts/open-questions.ts'
import { OpenQuestionsLoadError } from '../src/artifacts/errors.ts'

const FILE = '<test-fixture>'

function expectQLoadError(fn: () => unknown): OpenQuestionsLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(OpenQuestionsLoadError)
    return err as OpenQuestionsLoadError
  }
  throw new Error('expected OpenQuestionsLoadError')
}

const VALID = `# OPEN QUESTIONS

## Q-001: Should the app produce gender-neutral suggestions only?

- Phase: define
- Status: open
- Importance: medium
- DueBy: 2026-05-15
- Context: SPEC.md ## Open questions, bullet 1.
- Resolution attempts: none yet.

## Q-002: What is the device performance baseline?

- Phase: plan
- Status: deferred
- Importance: high
- DueBy: 2026-05-10
- Context: H-002 falsifier requires a benchmark profile.
- Resolution attempts: 2026-04-30 — Lead persona proposed M1 emulator profile.

## Q-003: Is the syllable adapter clean-room reusable?

- Phase: plan
- Status: resolved
- Importance: high
- DueBy: -
- Context: H-003 falsifier needed verification.
- Resolution attempts: 2026-04-30 — static analysis confirmed.
- Resolved: 2026-04-30 — clean-room reuse approved.
`

describe('parseOpenQuestions', () => {
  test('parses three questions of varying status', () => {
    const art = parseOpenQuestions(VALID, FILE)
    expect(art.questions.length).toBe(3)
    expect(art.questions[0]!.status).toBe('open')
    expect(art.questions[1]!.status).toBe('deferred')
    expect(art.questions[2]!.status).toBe('resolved')
  })

  test('parses dueBy as null for `-` sentinel', () => {
    const art = parseOpenQuestions(VALID, FILE)
    expect(art.questions[2]!.dueBy).toBeNull()
    expect(art.questions[0]!.dueBy).toBe('2026-05-15')
  })

  test('parses resolved bullet into structured object', () => {
    const art = parseOpenQuestions(VALID, FILE)
    const r = art.questions[2]!.resolved
    expect(r).not.toBeNull()
    expect(r!.date).toBe('2026-04-30')
    expect(r!.note).toContain('clean-room')
  })

  test('accepts an empty list', () => {
    const art = parseOpenQuestions('# OPEN QUESTIONS\n', FILE)
    expect(art.questions.length).toBe(0)
  })

  test('rejects empty input', () => {
    const err = expectQLoadError(() => parseOpenQuestions('', FILE))
    expect(err.issues[0]!.code).toBe('open_questions_empty')
  })

  test('rejects missing title', () => {
    const err = expectQLoadError(() => parseOpenQuestions('## Q-001: x\n', FILE))
    expect(err.issues[0]!.code).toBe('open_questions_missing_title')
  })

  test('rejects malformed id', () => {
    const bad = VALID.replace('## Q-001:', '## QUESTION-001:')
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_id_format')).toBe(true)
  })

  test('rejects duplicate ids', () => {
    const bad = VALID.replace('## Q-002:', '## Q-001:')
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_id_collision')).toBe(true)
  })

  test('rejects invalid status', () => {
    const bad = VALID.replace('- Status: open', '- Status: pending')
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_invalid_status')).toBe(true)
  })

  test('rejects invalid importance', () => {
    const bad = VALID.replace('- Importance: medium', '- Importance: huge')
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_invalid_importance')).toBe(true)
  })

  test('rejects invalid phase', () => {
    const bad = VALID.replace('- Phase: define', '- Phase: launch')
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_invalid_phase')).toBe(true)
  })

  test('rejects malformed dueBy', () => {
    const bad = VALID.replace('- DueBy: 2026-05-15', '- DueBy: tomorrow')
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_invalid_dueby')).toBe(true)
  })

  test('rejects resolved without Resolved bullet', () => {
    const bad = VALID.replace(
      '- Resolved: 2026-04-30 — clean-room reuse approved.\n',
      '',
    )
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_resolved_missing_resolution')).toBe(true)
  })

  test('rejects missing required bullet', () => {
    const bad = VALID.replace('- Importance: medium\n', '')
    const err = expectQLoadError(() => parseOpenQuestions(bad, FILE))
    expect(err.issues.some((i) => i.code === 'question_missing_section')).toBe(true)
  })
})

describe('serializeOpenQuestions', () => {
  test('round-trips', () => {
    const art = parseOpenQuestions(VALID, FILE)
    const out = serializeOpenQuestions(art)
    const reparsed = parseOpenQuestions(out, FILE)
    expect(reparsed.questions.length).toBe(art.questions.length)
    expect(reparsed.questions[2]!.resolved!.note).toBe(art.questions[2]!.resolved!.note)
  })

  test('emits `-` for null dueBy', () => {
    const art = parseOpenQuestions(VALID, FILE)
    const out = serializeOpenQuestions(art)
    expect(out).toContain('- DueBy: -')
  })
})

describe('findGateBlockingQuestions', () => {
  test('returns blocking + open', () => {
    const bad = VALID.replace('- Importance: medium', '- Importance: blocking')
    const art = parseOpenQuestions(bad, FILE)
    const blocked = findGateBlockingQuestions(art, '2026-04-29')
    expect(blocked.length).toBe(1)
    expect(blocked[0]!.id).toBe('Q-001')
  })

  test('returns overdue + open (today after dueBy)', () => {
    const art = parseOpenQuestions(VALID, FILE)
    // Q-001 dueBy: 2026-05-15. Q-002 deferred (not blocking). Q-003 resolved.
    const blocked = findGateBlockingQuestions(art, '2026-06-01')
    expect(blocked.length).toBe(1)
    expect(blocked[0]!.id).toBe('Q-001')
  })

  test('does not return resolved or deferred even with overdue dueBy', () => {
    const art = parseOpenQuestions(VALID, FILE)
    const blocked = findGateBlockingQuestions(art, '2026-09-01')
    // Q-001 still open + overdue; Q-002 deferred; Q-003 resolved.
    expect(blocked.map((q) => q.id)).toEqual(['Q-001'])
  })

  test('throws on malformed today', () => {
    const art = parseOpenQuestions(VALID, FILE)
    expect(() => findGateBlockingQuestions(art, 'today')).toThrow()
  })
})

describe('allocateQuestionId', () => {
  test('returns Q-001 when none exist', () => {
    expect(allocateQuestionId([])).toBe('Q-001')
  })

  test('returns next free id', () => {
    const art = parseOpenQuestions(VALID, FILE)
    expect(allocateQuestionId(art.questions)).toBe('Q-004')
  })
})

describe('writeOpenQuestions', () => {
  test('writes atomically and round-trips', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codeoz-q-'))
    try {
      const target = join(dir, 'OPEN_QUESTIONS.md')
      const art = parseOpenQuestions(VALID, FILE)
      await writeOpenQuestions(target, art, { fsyncDir: false })
      const onDisk = await readFile(target, 'utf8')
      const reparsed = parseOpenQuestions(onDisk, target)
      expect(reparsed.questions.length).toBe(art.questions.length)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('QUESTION_STATUSES + QUESTION_IMPORTANCES', () => {
  test('match contract', () => {
    expect(QUESTION_STATUSES).toEqual(['open', 'resolved', 'deferred'])
    expect(QUESTION_IMPORTANCES).toEqual(['low', 'medium', 'high', 'blocking'])
  })
})

// Issue #5: YAML-style tolerance regression tests.

const YAML_OQ = `# OPEN QUESTIONS

- id: Q-001
  question: Should the app produce gender-neutral suggestions only?
  status: proposed
  importance: medium
  phase_introduced: define
  due_by: 2026-05-15
  context: SPEC.md ## Open questions, bullet 1.

- id: Q-002
  question: What is the device performance baseline for the 50ms acceptance criterion?
  status: open
  importance: high
  phase_introduced: plan
`

describe('adaptYamlStyleOpenQuestions (issue #5)', () => {
  test('returns input unchanged when no YAML markers are present', () => {
    expect(adaptYamlStyleOpenQuestions(VALID)).toBe(VALID)
  })

  test('rewrites YAML blocks to canonical H2 blocks', () => {
    const out = adaptYamlStyleOpenQuestions(YAML_OQ)
    expect(out).toContain('## Q-001:')
    expect(out).toContain('## Q-002:')
    expect(out).toContain('- Phase: define')
    expect(out).toContain('- Importance: medium')
    expect(out).toContain('- Resolution attempts: none yet.')
    expect(out).not.toContain('- id: Q-')
    expect(out).not.toContain('phase_introduced:')
    expect(out).not.toContain('due_by:')
  })

  test('maps status: proposed to open', () => {
    const out = adaptYamlStyleOpenQuestions(YAML_OQ)
    const q1 = out.slice(out.indexOf('## Q-001:'), out.indexOf('## Q-002:'))
    expect(q1).toContain('- Status: open')
  })

  test('defaults DueBy to `-` when missing', () => {
    const out = adaptYamlStyleOpenQuestions(YAML_OQ)
    const q2 = out.slice(out.indexOf('## Q-002:'))
    expect(q2).toContain('- DueBy: -')
  })

  test('synthesizes Resolution attempts when missing', () => {
    const out = adaptYamlStyleOpenQuestions(YAML_OQ)
    const q1 = out.slice(out.indexOf('## Q-001:'), out.indexOf('## Q-002:'))
    expect(q1).toContain('- Resolution attempts: none yet.')
  })

  test('handles mixed format (canonical + YAML blocks)', () => {
    const mixed = `# OPEN QUESTIONS

## Q-001: canonical question survives intact

- Phase: plan
- Status: open
- Importance: medium
- DueBy: 2026-05-15
- Context: existing.
- Resolution attempts: none yet.

- id: Q-002
  question: yaml question gets rewritten.
  status: proposed
  importance: high
  phase_introduced: plan
`
    const art = parseOpenQuestions(mixed)
    expect(art.questions.length).toBe(2)
    expect(art.questions[0]!.question).toContain('canonical')
    expect(art.questions[1]!.question).toContain('yaml')
    expect(art.questions[1]!.status).toBe('open') // proposed mapped
    expect(art.questions[1]!.dueBy).toBeNull() // synthesized as `-`
  })
})

describe('parseOpenQuestions — issue #5 YAML tolerance', () => {
  test('parses pure-YAML input end-to-end', () => {
    const art = parseOpenQuestions(YAML_OQ)
    expect(art.questions.length).toBe(2)
    expect(art.questions[0]!.id).toBe('Q-001')
    expect(art.questions[0]!.status).toBe('open') // proposed → open
    expect(art.questions[0]!.phase).toBe('define')
    expect(art.questions[0]!.importance).toBe('medium')
    expect(art.questions[0]!.dueBy).toBe('2026-05-15')
    expect(art.questions[1]!.dueBy).toBeNull() // missing → `-` → null
    expect(art.questions[1]!.resolutionAttempts).toBe('none yet.')
  })

  test('round-trips YAML through serialize → reparse to canonical', () => {
    const art = parseOpenQuestions(YAML_OQ)
    const serialized = serializeOpenQuestions(art)
    expect(serialized).toContain('## Q-001:')
    expect(serialized).not.toContain('- id: Q-')
    const reparsed = parseOpenQuestions(serialized)
    expect(reparsed.questions.length).toBe(art.questions.length)
    expect(reparsed.questions[0]!.question).toBe(art.questions[0]!.question)
    expect(reparsed.questions[0]!.context).toBe(art.questions[0]!.context)
  })
})
