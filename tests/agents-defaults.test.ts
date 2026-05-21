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
  test('directory contains the v0.1 + v0.6 + v0.17 spine personas', async () => {
    const entries = await readdir(DEFAULTS_DIR)
    const mdFiles = entries.filter((f) => f.endsWith('.md')).sort()
    expect(mdFiles).toEqual([
      'auditor.md',
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
    expect(reg.listAll()).toHaveLength(7)
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

  test('SHIP has no default persona; AUDIT has the auditor', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    expect(reg.getByPhase('ship')).toEqual([])
    const auditPersonas = reg.getByPhase('audit')
    expect(auditPersonas).toHaveLength(1)
    expect(auditPersonas[0]?.name).toBe('auditor')
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
    // M9 commit 6 standardizes the path to match verifier.md's canonical
    // .code-oz/artifacts/VERIFY.md convention; the M2 stub used a bare
    // filename. The intent (reviewer can ONLY write REVIEW.md) is unchanged.
    expect(reviewer.permissions.write).toEqual(['.code-oz/artifacts/REVIEW.md'])
  })

  test('reviewer declares cross-family permissions (provider: codex, tool_use.review_request)', async () => {
    const sources = await loadDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    const reviewer = reg.getByName('reviewer')!
    expect(reviewer.provider).toBe('codex') // cross-family with default builder (claude)
    expect(reviewer.permissions.tool_use?.review_request).toBeDefined()
    expect(reviewer.permissions.tool_use?.review_request?.tools).toEqual(['request-review'])
    expect(reviewer.permissions.tool_use?.review_request?.maxRounds).toBeLessThanOrEqual(4)
    expect(reviewer.permissions.tool_use?.review_request?.network).toBe('provider-only')
    // tool_use.repo_context for reading changed files from the worktree.
    expect(reviewer.permissions.tool_use?.repo_context?.tools).toEqual([
      'glob',
      'grep',
      'read',
    ])
  })
})
