import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap } from '../src/cli/bootstrap.ts'
import { initProject } from '../src/commands/init.ts'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'code-oz-bootstrap-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('bootstrap', () => {
  test('returns the resolved cwd, paths, and registry', async () => {
    await initProject({ cwd })
    const ctx = await bootstrap({ cwd })
    expect(ctx.cwd).toBe(cwd)
    expect(ctx.paths.root).toBe(join(cwd, '.code-oz'))
    expect(ctx.paths.activeRun).toBe(join(cwd, '.code-oz', 'state', 'active.json'))
    expect(Object.isFrozen(ctx)).toBe(true)
  })

  test('registry exposes the five bundled defaults via getByPhase (closes M2 deferred liveness)', async () => {
    await initProject({ cwd })
    const ctx = await bootstrap({ cwd })

    // Each of the v0.1 spine phases has at least one bundled persona.
    const PHASE_TO_AGENT: Record<string, string> = {
      define: 'ba',
      plan: 'lead',
      build: 'builder',
      verify: 'verifier',
      review: 'reviewer',
    }
    for (const [phase, name] of Object.entries(PHASE_TO_AGENT)) {
      const agents = ctx.registry.getByPhase(phase as never)
      expect(agents.length).toBeGreaterThan(0)
      expect(agents.some((a) => a.name === name)).toBe(true)
    }
  })

  test('registry survives when no project-local agents directory has overrides', async () => {
    await initProject({ cwd })
    const ctx = await bootstrap({ cwd })
    // listAll should still include the five bundled defaults.
    const all = ctx.registry.listAll()
    expect(all.length).toBeGreaterThanOrEqual(5)
    const names = all.map((a) => a.name)
    expect(names).toContain('ba')
    expect(names).toContain('lead')
    expect(names).toContain('builder')
    expect(names).toContain('verifier')
    expect(names).toContain('reviewer')
  })
})
