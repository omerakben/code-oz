import { describe, test, expect } from 'bun:test'
import { loadBundledDefaults } from '../src/agents/bundled-defaults.ts'
import { buildRegistry } from '../src/agents/loader.ts'

describe('loadBundledDefaults', () => {
  test('reads all 6 default personas via Bun asset imports', async () => {
    const sources = await loadBundledDefaults()
    expect(sources).toHaveLength(6)
    expect(sources.map((s) => s.file).sort()).toEqual([
      'src/agents/defaults/ba.md',
      'src/agents/defaults/builder.md',
      'src/agents/defaults/lead.md',
      'src/agents/defaults/reviewer.md',
      'src/agents/defaults/scientist.md',
      'src/agents/defaults/verifier.md',
    ])
  })

  test('every loaded source has non-empty markdown content', async () => {
    const sources = await loadBundledDefaults()
    for (const s of sources) {
      expect(s.content.length).toBeGreaterThan(0)
      expect(s.content).toContain('---')
    }
  })

  test('asset-loaded defaults form a complete v0.1 + v0.6 spine registry', async () => {
    const sources = await loadBundledDefaults()
    const reg = buildRegistry({ defaults: sources, overrides: [] })
    expect(reg.listAll()).toHaveLength(6)
    expect(reg.getByName('ba')?.phase).toBe('define')
    expect(reg.getByName('lead')?.phase).toBe('plan')
    expect(reg.getByName('builder')?.phase).toBe('build')
    expect(reg.getByName('verifier')?.phase).toBe('verify')
    expect(reg.getByName('reviewer')?.phase).toBe('review')
    expect(reg.getByName('scientist')?.phase).toBe('plan')
  })
})
