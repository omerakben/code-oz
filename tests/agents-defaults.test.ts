import { describe, test, expect } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistry, type SourceFile } from '../src/agents/loader.ts'

const DEFAULTS_DIR = fileURLToPath(new URL('../src/agents/defaults/', import.meta.url))

async function loadDefaults(): Promise<readonly SourceFile[]> {
  const entries = await readdir(DEFAULTS_DIR)
  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort()
  return Promise.all(
    mdFiles.map(async (name) => ({
      file: `src/agents/defaults/${name}`,
      content: await readFile(join(DEFAULTS_DIR, name), 'utf8'),
    })),
  )
}

describe('bundled default personas', () => {
  test('directory contains the v0.1 + v0.6 spine personas', async () => {
    const entries = await readdir(DEFAULTS_DIR)
    const mdFiles = entries.filter((f) => f.endsWith('.md')).sort()
    expect(mdFiles).toEqual([
      'ba.md',
      'builder.md',
      'lead.md',
      'reviewer.md',
      'scientist.md',
      'verifier.md',
    ])
  })

  test('all default files pass schema validation', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    expect(reg.listAll()).toHaveLength(6)
  })

  test('each phase from DEFINE through REVIEW has the expected default personas', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    expect(reg.getByPhase('define').map((d) => d.name)).toEqual(['ba'])
    // M6 adds the Scientist phase-tail to PLAN, so plan has both lead + scientist.
    expect(reg.getByPhase('plan').map((d) => d.name).sort()).toEqual(['lead', 'scientist'])
    expect(reg.getByPhase('build').map((d) => d.name)).toEqual(['builder'])
    expect(reg.getByPhase('verify').map((d) => d.name)).toEqual(['verifier'])
    expect(reg.getByPhase('review').map((d) => d.name)).toEqual(['reviewer'])
  })

  test('SHIP and AUDIT phases have no v0.1 default personas', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    expect(reg.getByPhase('ship')).toEqual([])
    expect(reg.getByPhase('audit')).toEqual([])
  })

  test('builder and reviewer are in different provider families (rule 2)', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    const builder = reg.getByName('builder')!
    const reviewer = reg.getByName('reviewer')!
    expect(builder.provider).not.toBe(reviewer.provider)
  })

  test('all defaults declare permissions.bash as deny (no shell escape hatch in v0.1)', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    for (const def of reg.listAll()) {
      expect(def.permissions.bash).toBe('deny')
    }
  })

  test('reviewer is read-only (write permissions narrow to REVIEW.md)', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    const reviewer = reg.getByName('reviewer')!
    expect(reviewer.permissions.write).toEqual(['REVIEW.md'])
  })
})
