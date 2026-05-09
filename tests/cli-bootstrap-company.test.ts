// M12 commit 4: bootstrap-before-loadConfig wiring fix.
//
// Before M12, `runCommand()` called `bootstrap()` (which built the agent
// registry) BEFORE `loadConfig()`. The company:block arrived too late to
// affect routing. M12 flips the order: `loadConfig` runs first and
// `bootstrap({ cwd, config })` threads `config.company` through
// `loadRegistry` into `applyCompanyOverrides`. Per Codex Risk #2 in
// CODEX_RESPONSE_M12.md (thread 019de4bb).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap } from '../src/cli/bootstrap.ts'
import { loadConfig } from '../src/config/load.ts'
import { initProject } from '../src/commands/init.ts'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'code-oz-bootstrap-company-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

async function writeConfig(yaml: string): Promise<void> {
  const dir = join(cwd, '.code-oz')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'config.yaml'), yaml, 'utf8')
}

describe('bootstrap with company config — provider override propagates to registry', () => {
  test('company.ba.provider flows through to registry.getByName(ba).provider', async () => {
    await initProject({ cwd })
    await writeConfig(`
company:
  ba:
    provider: codex
`)
    const config = await loadConfig({ cwd })
    const ctx = await bootstrap({ cwd, config })
    expect(ctx.registry.getByName('ba')?.provider).toBe('codex')
  })

  test('company.builder.model flows through to registry.getByName(builder).model', async () => {
    await initProject({ cwd })
    await writeConfig(`
company:
  builder:
    model: sonnet
`)
    const config = await loadConfig({ cwd })
    const ctx = await bootstrap({ cwd, config })
    const builder = ctx.registry.getByName('builder')!
    expect(builder.provider).toBe('claude') // unchanged
    expect(builder.model).toBe('sonnet')
  })

  test('both provider and model override propagate together', async () => {
    await initProject({ cwd })
    await writeConfig(`
company:
  ba:
    provider: codex
    model: gpt-5.5
`)
    const config = await loadConfig({ cwd })
    const ctx = await bootstrap({ cwd, config })
    const ba = ctx.registry.getByName('ba')!
    expect(ba.provider).toBe('codex')
    expect(ba.model).toBe('gpt-5.5')
  })

  test('a non-overridden role keeps its frontmatter values', async () => {
    await initProject({ cwd })
    await writeConfig(`
company:
  ba:
    provider: codex
`)
    const config = await loadConfig({ cwd })
    const ctx = await bootstrap({ cwd, config })
    // ba is overridden to codex; reviewer stays at its bundled codex.
    expect(ctx.registry.getByName('ba')?.provider).toBe('codex')
    expect(ctx.registry.getByName('reviewer')?.provider).toBe('codex')
    // builder stays at bundled claude.
    expect(ctx.registry.getByName('builder')?.provider).toBe('claude')
  })
})

describe('bootstrap without company config — identity routing', () => {
  test('bootstrap with no `config` opt is identity (matches pre-M12 behavior)', async () => {
    await initProject({ cwd })
    const ctx = await bootstrap({ cwd })
    // Bundled defaults: ba/builder/lead/verifier/scientist=claude;
    // reviewer=codex.
    expect(ctx.registry.getByName('ba')?.provider).toBe('claude')
    expect(ctx.registry.getByName('builder')?.provider).toBe('claude')
    expect(ctx.registry.getByName('reviewer')?.provider).toBe('codex')
  })

  test('bootstrap with config but no company:block is identity', async () => {
    await initProject({ cwd })
    await writeConfig(`
profile: greenfield
`)
    const config = await loadConfig({ cwd })
    const ctx = await bootstrap({ cwd, config })
    expect(ctx.registry.getByName('ba')?.provider).toBe('claude')
    expect(ctx.registry.getByName('reviewer')?.provider).toBe('codex')
  })
})

describe('bootstrap with company config — load-time validation surfaces', () => {
  test('override that triggers cross-family violation fails at bootstrap', async () => {
    await initProject({ cwd })
    // Override reviewer to claude. Builder stays at claude (bundled).
    // Either the cross-family REVIEW check OR the M15 reviewer-debate
    // opposingProviders re-check fires first; both signal the same
    // operator-actionable condition (reviewer must stay cross-family
    // from BUILD, AND reviewer's opposingProviders must not include
    // its own resolved family). M15 added the second check via
    // tool_use.debate=['claude'] on the bundled reviewer.
    await writeConfig(`
company:
  reviewer:
    provider: claude
`)
    const config = await loadConfig({ cwd })
    await expect(bootstrap({ cwd, config })).rejects.toThrow(
      /cross.family|REVIEW agent provider family must differ|opposingProviders' must not include/i,
    )
  })

  test('override that triggers eligibility violation fails at bootstrap', async () => {
    await initProject({ cwd })
    // Override ba to gemini. gemini.eligiblePhases is [] → eligibility fails.
    await writeConfig(`
company:
  ba:
    provider: gemini
`)
    const config = await loadConfig({ cwd })
    await expect(bootstrap({ cwd, config })).rejects.toThrow(
      /not eligible|provider_phase_not_eligible/i,
    )
  })
})

describe('bootstrap order — pre-M12 footgun reproduced and closed', () => {
  test('config is loaded BEFORE bootstrap so company config reaches the registry', async () => {
    // This is the canonical M12 wiring fix. The order of operations is:
    //   1. loadConfig  (parses YAML, runs mergeCompany)
    //   2. bootstrap({ cwd, config })  (loadRegistry receives company)
    //   3. registry.getByName(...) sees the resolved provider
    //
    // Pre-M12: bootstrap() ran without `config`, so step 2 didn't have
    // company. Step 3 returned the frontmatter provider regardless of
    // user-supplied YAML. This test would have failed against pre-M12 code.
    await initProject({ cwd })
    await writeConfig(`
company:
  ba:
    provider: codex
`)
    const config = await loadConfig({ cwd })
    const ctxBefore = await bootstrap({ cwd })          // simulates pre-M12: no config
    const ctxAfter = await bootstrap({ cwd, config })   // M12 wiring
    expect(ctxBefore.registry.getByName('ba')?.provider).toBe('claude')
    expect(ctxAfter.registry.getByName('ba')?.provider).toBe('codex')
  })
})
