import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigLoadError } from '../src/config/load.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-config-'))
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

describe('loadConfig — happy paths', () => {
  test('missing config file returns DEFAULT_CONFIG', async () => {
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  test('empty / comments-only YAML returns DEFAULT_CONFIG', async () => {
    await writeConfig('# nothing here\n')
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  test('partial config merges over defaults', async () => {
    await writeConfig(`
defaultProvider: codex
budgets:
  global:
    maxTurns: 250
    maxToolCallsPerTurn: 25
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.defaultProvider).toBe('codex')
    expect(cfg.budgets.global.maxTurns).toBe(250)
    expect(cfg.budgets.global.maxToolCallsPerTurn).toBe(25)
    // Defaults survive for unspecified keys.
    expect(cfg.budgets.global.maxProviderCalls).toBe(DEFAULT_CONFIG.budgets.global.maxProviderCalls)
    expect(cfg.budgets.global.maxReviewRounds).toBe(DEFAULT_CONFIG.budgets.global.maxReviewRounds)
    expect(cfg.budgets.global.toolCallBudgetMultiplier).toBe(
      DEFAULT_CONFIG.budgets.global.toolCallBudgetMultiplier,
    )
    expect(cfg.budgets.perPhase.define).toEqual(DEFAULT_CONFIG.budgets.perPhase.define)
    expect(cfg.permissions).toEqual(DEFAULT_CONFIG.permissions)
  })

  test('full override replaces every key', async () => {
    await writeConfig(`
version: '0.4.0-test'
profile: brownfield
defaultProvider: fake
models:
  primary: claude-haiku-4-5
  reviewer: gpt-5.5-mini
budgets:
  global:
    maxTurns: 5
    maxProviderCalls: 3
    maxTokensEstimate: 1000
    maxReviewRounds: 1
    maxToolCallsPerTurn: 2
    toolCallBudgetMultiplier: 2
  perPhase:
    define: { maxTurns: 2, maxProviderCalls: 1, maxTokensEstimate: 100 }
    plan: { maxTurns: 2, maxProviderCalls: 1, maxTokensEstimate: 100 }
    build: { maxTurns: 2, maxProviderCalls: 1, maxTokensEstimate: 100 }
    verify: { maxTurns: 2, maxProviderCalls: 1, maxTokensEstimate: 100 }
    review: { maxTurns: 2, maxProviderCalls: 1, maxTokensEstimate: 100 }
    ship: { maxTurns: 2, maxProviderCalls: 1, maxTokensEstimate: 100 }
    audit: { maxTurns: 2, maxProviderCalls: 1, maxTokensEstimate: 100 }
permissions:
  allowEscapeHatch: true
  requireApprovalForBuild: false
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.version).toBe('0.4.0-test')
    expect(cfg.profile).toBe('brownfield')
    expect(cfg.defaultProvider).toBe('fake')
    expect(cfg.models.primary).toBe('claude-haiku-4-5')
    expect(cfg.budgets.global.maxToolCallsPerTurn).toBe(2)
    expect(cfg.budgets.global.toolCallBudgetMultiplier).toBe(2)
    expect(cfg.budgets.perPhase.build.maxTurns).toBe(2)
    expect(cfg.permissions.allowEscapeHatch).toBe(true)
  })

  test('configPath override bypasses cwd resolution', async () => {
    const path = join(tmp, 'somewhere-else.yaml')
    await writeFile(path, 'profile: brownfield\n', 'utf8')
    const cfg = await loadConfig({ configPath: path })
    expect(cfg.profile).toBe('brownfield')
  })

  test('preset absent preserves DEFAULT_CONFIG budget and permission behavior', async () => {
    await writeConfig('profile: greenfield\n')
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.preset).toBeUndefined()
    expect(cfg.permissions).toEqual(DEFAULT_CONFIG.permissions)
    expect(cfg.budgets.global.softWarnAtRatio).toBe(
      DEFAULT_CONFIG.budgets.global.softWarnAtRatio,
    )
  })

  test('preset auto resolves permissive budget and permission fields', async () => {
    await writeConfig('preset: auto\n')
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.preset).toBe('auto')
    expect(cfg.permissions.allowEscapeHatch).toBe(true)
    expect(cfg.permissions.requireApprovalForBuild).toBe(false)
    expect(cfg.budgets.global.softWarnAtRatio).toBe(0.9)
    expect(cfg.budgets.global.maxReviewRounds).toBe(
      DEFAULT_CONFIG.budgets.global.maxReviewRounds,
    )
  })

  test('preset paranoid resolves strict budget and permission fields', async () => {
    await writeConfig('preset: paranoid\n')
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.preset).toBe('paranoid')
    expect(cfg.permissions.allowEscapeHatch).toBe(false)
    expect(cfg.permissions.requireApprovalForBuild).toBe(true)
    expect(cfg.budgets.global.softWarnAtRatio).toBe(0.5)
    expect(cfg.budgets.global.maxProviderCalls).toBe(
      DEFAULT_CONFIG.budgets.global.maxProviderCalls,
    )
  })

  test('preset interactive resolves to current default budget and permission fields', async () => {
    await writeConfig('preset: interactive\n')
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.preset).toBe('interactive')
    expect(cfg.permissions).toEqual(DEFAULT_CONFIG.permissions)
    expect(cfg.budgets.global.softWarnAtRatio).toBe(
      DEFAULT_CONFIG.budgets.global.softWarnAtRatio,
    )
  })

  test('explicit user values override preset values', async () => {
    await writeConfig(`
preset: auto
permissions:
  allowEscapeHatch: false
budgets:
  global:
    softWarnAtRatio: 0.6
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.preset).toBe('auto')
    expect(cfg.permissions.allowEscapeHatch).toBe(false)
    // Partial override preserves preset values for non-overridden keys.
    expect(cfg.permissions.requireApprovalForBuild).toBe(false)
    expect(cfg.budgets.global.softWarnAtRatio).toBe(0.6)
  })
})

describe('loadConfig — rejection cases', () => {
  test('malformed YAML produces config_invalid_yaml', async () => {
    await writeConfig(': : :\n')
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigLoadError)
      const e = err as ConfigLoadError
      expect(e.issues[0]?.code).toBe('config_invalid_yaml')
    }
  })

  test('top-level array is rejected', async () => {
    await writeConfig('- one\n- two\n')
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      expect(e.issues[0]?.code).toBe('config_invalid_shape')
    }
  })

  test('wrong-typed values aggregate into the issue array', async () => {
    await writeConfig(`
defaultProvider: not_a_provider
budgets:
  global:
    maxTurns: -5
    maxToolCallsPerTurn: 1.5
    toolCallBudgetMultiplier: -0.5
permissions:
  allowEscapeHatch: maybe
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      const codes = e.issues.map((i) => i.code)
      expect(codes).toContain('config_invalid_value')
      // Every flagged issue should reference a path in its rule.
      const rules = e.issues.map((i) => i.rule)
      expect(rules.some((r) => r.includes('defaultProvider'))).toBe(true)
      expect(rules.some((r) => r.includes('maxTurns'))).toBe(true)
      expect(rules.some((r) => r.includes('maxToolCallsPerTurn'))).toBe(true)
      expect(rules.some((r) => r.includes('toolCallBudgetMultiplier'))).toBe(true)
      expect(rules.some((r) => r.includes('allowEscapeHatch'))).toBe(true)
    }
  })

  test('unknown preset name raises config_invalid_value', async () => {
    await writeConfig('preset: relaxed\n')
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigLoadError)
      const e = err as ConfigLoadError
      expect(
        e.issues.some(
          (issue) =>
            issue.code === 'config_invalid_value' &&
            issue.rule === 'preset must be one of: auto | paranoid | interactive',
        ),
      ).toBe(true)
    }
  })

  test('unknown phase under perPhase is silently ignored (only canonical phases are accepted)', async () => {
    await writeConfig(`
budgets:
  perPhase:
    define: { maxTurns: 7 }
    something_else: { maxTurns: 999 }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.budgets.perPhase.define.maxTurns).toBe(7)
    // No 'something_else' key on the typed shape.
    expect(Object.keys(cfg.budgets.perPhase).sort()).toEqual([
      'audit',
      'build',
      'define',
      'plan',
      'review',
      'ship',
      'verify',
    ])
  })
})
