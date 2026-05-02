// M13 Commit 1: budgets.global.byRole config surface + validation.
//
// Codex Q1 + Q10 locks: byRole lives under budgets.global; non-canonical
// role keys are rejected with `loader_company_role_unknown` (symmetric
// with M12 mergeCompany). Codex Blocker 2 lock: maxTurns is intentionally
// absent — current reducer counts phase_entered, not agent calls.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigLoadError } from '../src/config/load.ts'
import { DEFAULT_CONFIG, M12_COMPANY_ROLES } from '../src/config/schema.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-byrole-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function writeConfig(yaml: string): Promise<string> {
  const dir = join(tmp, '.code-oz')
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'config.yaml')
  await writeFile(path, yaml, 'utf8')
  return path
}

describe('budgets.global.byRole — defaults', () => {
  test('DEFAULT_CONFIG.budgets.global.byRole is undefined', () => {
    expect(DEFAULT_CONFIG.budgets.global.byRole).toBeUndefined()
  })

  test('config without budgets:byRole leaves byRole undefined', async () => {
    await writeConfig(`
profile: greenfield
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.global.byRole).toBeUndefined()
  })

  test('budgets.global.byRole: null leaves byRole undefined', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.global.byRole).toBeUndefined()
  })
})

describe('budgets.global.byRole — happy paths', () => {
  test('single role with maxProviderCalls only loads', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      builder:
        maxProviderCalls: 5
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.global.byRole).toBeDefined()
    expect(cfg.budgets.global.byRole!.builder).toEqual({ maxProviderCalls: 5 })
  })

  test('single role with maxTokensEstimate only loads', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      reviewer:
        maxTokensEstimate: 100000
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.global.byRole!.reviewer).toEqual({ maxTokensEstimate: 100_000 })
  })

  test('role with both fields loads', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      lead:
        maxProviderCalls: 8
        maxTokensEstimate: 200000
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.global.byRole!.lead).toEqual({
      maxProviderCalls: 8,
      maxTokensEstimate: 200_000,
    })
  })

  test('all six canonical roles load', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      ba:
        maxProviderCalls: 3
      lead:
        maxTokensEstimate: 150000
      builder:
        maxProviderCalls: 10
      verifier:
        maxProviderCalls: 5
      reviewer:
        maxTokensEstimate: 200000
      scientist:
        maxTokensEstimate: 50000
`)
    const cfg = await loadConfig({ cwd: tmp })
    for (const role of M12_COMPANY_ROLES) {
      expect(cfg.budgets.global.byRole![role]).toBeDefined()
    }
  })

  test('zero values are accepted (an effective shutoff)', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      builder:
        maxProviderCalls: 0
        maxTokensEstimate: 0
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.global.byRole!.builder).toEqual({
      maxProviderCalls: 0,
      maxTokensEstimate: 0,
    })
  })

  test('empty row is accepted (inherits global)', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      verifier: {}
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.global.byRole!.verifier).toEqual({})
  })
})

describe('budgets.global.byRole — rejection cases', () => {
  test('non-canonical role key is rejected with loader_company_role_unknown', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      agile-coach:
        maxProviderCalls: 5
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'loader_company_role_unknown',
      )
      expect(issue).toBeDefined()
      expect(issue!.rule).toContain('byRole')
      expect(issue!.detail).toContain("'agile-coach'")
    }
  })

  test('maxTurns key is rejected (intentionally absent per Codex Blocker 2)', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      builder:
        maxTurns: 10
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'config_invalid_value' && i.detail?.includes("'maxTurns'"),
      )
      expect(issue).toBeDefined()
    }
  })

  test('permissions key on row is rejected', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      builder:
        permissions:
          tool_use:
            write: true
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'config_invalid_value' && i.detail?.includes("'permissions'"),
      )
      expect(issue).toBeDefined()
    }
  })

  test('row scalar is rejected with config_invalid_shape', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      builder: 5
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'config_invalid_shape' && i.rule.includes('byRole.builder'),
      )
      expect(issue).toBeDefined()
    }
  })

  test('byRole array is rejected with config_invalid_shape', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      - builder
      - reviewer
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'config_invalid_shape' && i.rule.includes('byRole must be a mapping'),
      )
      expect(issue).toBeDefined()
    }
  })

  test('negative maxProviderCalls is rejected', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      builder:
        maxProviderCalls: -1
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('maxProviderCalls'),
      )
      expect(issue).toBeDefined()
    }
  })

  test('non-integer maxProviderCalls is rejected', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      builder:
        maxProviderCalls: 1.5
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('maxProviderCalls'),
      )
      expect(issue).toBeDefined()
    }
  })

  test('negative maxTokensEstimate is rejected', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      reviewer:
        maxTokensEstimate: -100
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issue = (e as ConfigLoadError).issues.find(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('maxTokensEstimate'),
      )
      expect(issue).toBeDefined()
    }
  })

  test('multiple violations across roles are aggregated', async () => {
    await writeConfig(`
budgets:
  global:
    byRole:
      orchestrator:
        maxProviderCalls: 5
      builder:
        maxTokensEstimate: -1
      not-a-role:
        maxProviderCalls: 2
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError)
      const issues = (e as ConfigLoadError).issues
      // orchestrator + not-a-role both unknown roles; builder has negative tokens
      expect(
        issues.filter((i) => i.code === 'loader_company_role_unknown').length,
      ).toBe(2)
      expect(
        issues.some(
          (i) => i.code === 'config_invalid_value' && i.rule.includes('maxTokensEstimate'),
        ),
      ).toBe(true)
    }
  })
})
