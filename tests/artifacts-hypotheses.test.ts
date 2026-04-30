import { describe, test, expect } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseHypotheses,
  serializeHypotheses,
  allocateHypothesisId,
  writeHypotheses,
  HYPOTHESIS_STATUSES,
  type Hypothesis,
} from '../src/artifacts/hypotheses.ts'
import { HypothesesLoadError } from '../src/artifacts/errors.ts'

const FILE = '<test-fixture>'

function expectHLoadError(fn: () => unknown): HypothesesLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(HypothesesLoadError)
    return err as HypothesesLoadError
  }
  throw new Error('expected HypothesesLoadError')
}

const VALID = `# HYPOTHESES

## H-001: Bun.write supports atomic semantics

- Phase: define
- Status: confirmed
- Falsifier: A test that observes a half-written file after a crash mid-write.
- Evidence: docs/references/spec-contract.md atomic write discipline.
- Risk if false: gate writes lose durability under crash.

## H-002: Syllable scorer ranks 5 candidates within 50ms

- Phase: plan
- Status: open
- Falsifier: Microbenchmark on M1 emulator profile shows >50ms median for 5 candidates.
- Evidence: SPEC.md acceptance criterion 1; SPEC constraint phone-class device.
- Risk if false: SPEC AC-1 fails; PLAN T-001 needs rework.
`

describe('parseHypotheses', () => {
  test('parses two hypotheses with all fields', () => {
    const art = parseHypotheses(VALID, FILE)
    expect(art.title).toBe('HYPOTHESES')
    expect(art.hypotheses.length).toBe(2)
    expect(art.hypotheses[0]!.id).toBe('H-001')
    expect(art.hypotheses[0]!.phase).toBe('define')
    expect(art.hypotheses[0]!.status).toBe('confirmed')
    expect(art.hypotheses[1]!.status).toBe('open')
    expect(art.hypotheses[1]!.falsifier).toContain('Microbenchmark')
  })

  test('accepts an empty list of hypotheses', () => {
    const art = parseHypotheses(`# HYPOTHESES\n`, FILE)
    expect(art.hypotheses.length).toBe(0)
  })

  test('returns a frozen artifact', () => {
    const art = parseHypotheses(VALID, FILE)
    expect(Object.isFrozen(art)).toBe(true)
    expect(Object.isFrozen(art.hypotheses)).toBe(true)
    expect(Object.isFrozen(art.hypotheses[0])).toBe(true)
  })

  test('rejects empty input', () => {
    const err = expectHLoadError(() => parseHypotheses('', FILE))
    expect(err.issues[0]!.code).toBe('hypotheses_empty')
  })

  test('rejects missing title', () => {
    const err = expectHLoadError(() => parseHypotheses('## H-001: x\n', FILE))
    expect(err.issues[0]!.code).toBe('hypotheses_missing_title')
  })

  test('rejects malformed id', () => {
    const bad = VALID.replace('## H-001:', '## HYP-1:')
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_id_format')).toBe(true)
  })

  test('rejects duplicate ids', () => {
    const bad = VALID.replace('## H-002:', '## H-001:')
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_id_collision')).toBe(true)
  })

  test('rejects invalid status', () => {
    const bad = VALID.replace('- Status: open', '- Status: inflight')
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_invalid_status')).toBe(true)
  })

  test('rejects invalid phase', () => {
    const bad = VALID.replace('- Phase: define', '- Phase: launch')
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_invalid_phase')).toBe(true)
  })

  test('rejects missing falsifier', () => {
    const bad = VALID.replace(
      '- Falsifier: A test that observes a half-written file after a crash mid-write.\n',
      '',
    )
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_no_falsifier')).toBe(true)
  })

  test('rejects empty falsifier value', () => {
    const bad = VALID.replace(
      '- Falsifier: A test that observes a half-written file after a crash mid-write.',
      '- Falsifier:',
    )
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_no_falsifier')).toBe(true)
  })

  test('rejects bullets outside any hypothesis block', () => {
    const bad = '# HYPOTHESES\n\n- stray bullet\n'
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_unexpected_content')).toBe(true)
  })

  test('rejects code fences', () => {
    const bad = '# HYPOTHESES\n\n```ts\n```\n'
    const err = expectHLoadError(() => parseHypotheses(bad, FILE))
    expect(err.issues.some((i) => i.code === 'hypothesis_unexpected_content')).toBe(true)
  })
})

describe('serializeHypotheses', () => {
  test('round-trips', () => {
    const art = parseHypotheses(VALID, FILE)
    const out = serializeHypotheses(art)
    const reparsed = parseHypotheses(out, FILE)
    expect(reparsed.hypotheses.length).toBe(art.hypotheses.length)
    expect(reparsed.hypotheses[0]!.falsifier).toBe(art.hypotheses[0]!.falsifier)
  })

  test('emits LF only with trailing newline', () => {
    const art = parseHypotheses(VALID, FILE)
    const out = serializeHypotheses(art)
    expect(out.includes('\r')).toBe(false)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  test('emits canonical bullet order', () => {
    const art = parseHypotheses(VALID, FILE)
    const out = serializeHypotheses(art)
    const phaseIdx = out.indexOf('- Phase:')
    const statusIdx = out.indexOf('- Status:')
    const falsIdx = out.indexOf('- Falsifier:')
    const evIdx = out.indexOf('- Evidence:')
    const riskIdx = out.indexOf('- Risk if false:')
    expect(phaseIdx).toBeLessThan(statusIdx)
    expect(statusIdx).toBeLessThan(falsIdx)
    expect(falsIdx).toBeLessThan(evIdx)
    expect(evIdx).toBeLessThan(riskIdx)
  })
})

describe('allocateHypothesisId', () => {
  test('returns H-001 when none exist', () => {
    expect(allocateHypothesisId([])).toBe('H-001')
  })

  test('returns next free id', () => {
    const arr: Hypothesis[] = [
      {
        id: 'H-001',
        title: 't',
        phase: 'plan',
        status: 'open',
        falsifier: 'f',
        evidence: 'e',
        riskIfFalse: 'r',
      },
    ]
    expect(allocateHypothesisId(arr)).toBe('H-002')
  })
})

describe('writeHypotheses', () => {
  test('writes a parsed-back-equal file atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codeoz-hyp-'))
    try {
      const target = join(dir, 'HYPOTHESES.md')
      const art = parseHypotheses(VALID, FILE)
      await writeHypotheses(target, art, { fsyncDir: false })
      const onDisk = await readFile(target, 'utf8')
      const reparsed = parseHypotheses(onDisk, target)
      expect(reparsed.hypotheses.length).toBe(art.hypotheses.length)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('HYPOTHESIS_STATUSES', () => {
  test('matches contract', () => {
    expect(HYPOTHESIS_STATUSES).toEqual(['open', 'confirmed', 'rejected', 'obsolete'])
  })
})
