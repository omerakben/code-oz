import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateScientistSidecars } from '../src/phases/gate-preflight.ts'

let artifactRoot: string

beforeEach(async () => {
  artifactRoot = await mkdtemp(join(tmpdir(), 'codeoz-pf-'))
})

afterEach(async () => {
  await rm(artifactRoot, { recursive: true, force: true })
})

const VALID_HYP = `# HYPOTHESES

## H-001: scorer ranks within 50ms

- Phase: plan
- Status: open
- Falsifier: microbenchmark > 50ms.
- Evidence: SPEC.md AC-1.
- Risk if false: SPEC AC fails.
`

const VALID_OQ = `# OPEN QUESTIONS

## Q-001: device baseline?

- Phase: plan
- Status: open
- Importance: medium
- DueBy: 2026-12-31
- Context: H-001 falsifier.
- Resolution attempts: none yet.
`

async function writeArtifacts(opts: { hyp?: string; oq?: string }): Promise<void> {
  if (opts.hyp !== undefined) await writeFile(join(artifactRoot, 'HYPOTHESES.md'), opts.hyp)
  if (opts.oq !== undefined) await writeFile(join(artifactRoot, 'OPEN_QUESTIONS.md'), opts.oq)
}

describe('validateScientistSidecars — happy path', () => {
  test('returns ok when both sidecars exist and have no blockers', async () => {
    await writeArtifacts({ hyp: VALID_HYP, oq: VALID_OQ })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hypotheses.hypotheses.length).toBe(1)
      expect(result.openQuestions.questions.length).toBe(1)
    }
  })
})

describe('validateScientistSidecars — failures', () => {
  test('returns scientist_sidecar_missing when HYPOTHESES.md absent', async () => {
    await writeArtifacts({ oq: VALID_OQ })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('scientist_sidecar_missing')
  })

  test('returns scientist_sidecar_missing when OPEN_QUESTIONS.md absent', async () => {
    await writeArtifacts({ hyp: VALID_HYP })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('scientist_sidecar_missing')
  })

  test('returns scientist_hypotheses_unparsable on bad HYPOTHESES.md', async () => {
    await writeArtifacts({ hyp: '# HYPOTHESES\n\n## BAD-1: missing\n', oq: VALID_OQ })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('scientist_hypotheses_unparsable')
      expect(result.detail).toBeDefined()
    }
  })

  test('returns scientist_open_questions_unparsable on bad OPEN_QUESTIONS.md', async () => {
    await writeArtifacts({ hyp: VALID_HYP, oq: '# OPEN QUESTIONS\n\n## BAD-X: x\n' })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('scientist_open_questions_unparsable')
  })

  test('returns open_question_blocking when an open question has Importance: blocking', async () => {
    const blockingOq = VALID_OQ.replace('- Importance: medium', '- Importance: blocking')
    await writeArtifacts({ hyp: VALID_HYP, oq: blockingOq })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('open_question_blocking')
      expect(result.detail).toContain('Q-001')
    }
  })

  test('returns open_question_overdue when DueBy < today', async () => {
    const overdueOq = VALID_OQ.replace('- DueBy: 2026-12-31', '- DueBy: 2026-04-29')
    await writeArtifacts({ hyp: VALID_HYP, oq: overdueOq })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('open_question_overdue')
      expect(result.detail).toContain('Q-001')
    }
  })

  test('does not block on a deferred or resolved overdue question', async () => {
    const deferredOq = VALID_OQ.replace('- Status: open', '- Status: deferred').replace(
      '- DueBy: 2026-12-31',
      '- DueBy: 2024-01-01',
    )
    await writeArtifacts({ hyp: VALID_HYP, oq: deferredOq })
    const result = await validateScientistSidecars({
      phase: 'plan',
      artifactRoot,
      today: '2026-04-30',
    })
    expect(result.ok).toBe(true)
  })

  test('throws on malformed today input', async () => {
    await writeArtifacts({ hyp: VALID_HYP, oq: VALID_OQ })
    await expect(
      validateScientistSidecars({ phase: 'plan', artifactRoot, today: 'tomorrow' }),
    ).rejects.toThrow()
  })
})
