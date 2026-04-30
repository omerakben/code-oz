import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveReferenceSources } from '../src/sources/reference-source.ts'

const RG_AVAILABLE = (() => {
  try {
    const r = spawnSync('rg', ['--version'], { stdio: 'pipe' })
    return r.status === 0
  } catch {
    return false
  }
})()

let project: string

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'codeoz-refsrc-'))
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src/scorer.ts'), 'export function score(){return 0}\n')
})

describe.if(RG_AVAILABLE)('resolveReferenceSources', () => {
  test('emits SC-REF-NNN when glob matches', async () => {
    const out = await resolveReferenceSources({
      searches: [
        { title: 'Scorer impl', globPattern: '**/scorer.ts', whyOnFound: 'matches scoring requirement' },
      ],
      projectRoot: project,
    })
    expect(out.length).toBe(1)
    expect(out[0]!.kind).toBe('REF')
    if (out[0]!.kind === 'REF') {
      expect(out[0]!.path).toContain('scorer.ts')
      expect(out[0]!.why).toContain('scoring requirement')
    }
  })

  test('emits SC-REF-NONE when glob fails and rationale is set', async () => {
    const out = await resolveReferenceSources({
      searches: [
        {
          title: 'Missing pattern',
          globPattern: 'src/never-there-*.zzz',
          noneRationale: 'no template available; will design from scratch',
        },
      ],
      projectRoot: project,
    })
    expect(out.length).toBe(1)
    expect(out[0]!.kind).toBe('REF-NONE')
    if (out[0]!.kind === 'REF-NONE') {
      expect(out[0]!.whyExplicit).toContain('design from scratch')
    }
  })

  test('skips searches with no rationale and no match', async () => {
    const out = await resolveReferenceSources({
      searches: [
        { title: 'Skipped', globPattern: 'src/never-*.zzz' },
      ],
      projectRoot: project,
    })
    expect(out.length).toBe(0)
  })

  test('uses grepPattern when no globPattern matches', async () => {
    const out = await resolveReferenceSources({
      searches: [{ title: 'Score function', grepPattern: 'export function score' }],
      projectRoot: project,
    })
    expect(out.length).toBe(1)
    expect(out[0]!.kind).toBe('REF')
  })

  test('throws when neither glob nor grep pattern provided', async () => {
    await expect(
      resolveReferenceSources({ searches: [{ title: 'Bad' }], projectRoot: project }),
    ).rejects.toThrow()
  })
})
