import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigLoadError } from '../src/config/load.ts'
import { DEFAULT_CONFIG, M12_COMPANY_ROLES } from '../src/config/schema.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-company-'))
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

describe('mergeCompany — happy paths', () => {
  test('missing config file leaves company undefined', async () => {
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company).toBeUndefined()
  })

  test('config without a company: block leaves company undefined', async () => {
    await writeConfig(`
profile: greenfield
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company).toBeUndefined()
  })

  test('company: null leaves company undefined', async () => {
    await writeConfig(`
company:
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company).toBeUndefined()
  })

  test('company with a single provider override loads', async () => {
    await writeConfig(`
company:
  ba:
    provider: codex
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company).toBeDefined()
    expect(cfg.company!.ba?.provider).toBe('codex')
    expect(cfg.company!.ba?.model).toBeUndefined()
  })

  test('company with model only override loads', async () => {
    await writeConfig(`
company:
  builder:
    model: claude-opus-4-7
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company!.builder?.model).toBe('claude-opus-4-7')
    expect(cfg.company!.builder?.provider).toBeUndefined()
  })

  test('company with both provider and model loads', async () => {
    await writeConfig(`
company:
  reviewer:
    provider: gemini
    model: gemini-2.0
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company!.reviewer).toEqual({
      provider: 'gemini',
      model: 'gemini-2.0',
    })
  })

  test('all six roster keys are accepted', async () => {
    await writeConfig(`
company:
  ba: { provider: claude }
  lead: { provider: codex }
  builder: { provider: claude, model: claude-opus-4-7 }
  verifier: { provider: claude }
  reviewer: { provider: codex, model: gpt-5.5 }
  scientist: { provider: claude }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(Object.keys(cfg.company!).sort()).toEqual([...M12_COMPANY_ROLES].sort())
  })

  test('rest of CodeOzConfig is unchanged when only company is set', async () => {
    await writeConfig(`
company:
  builder: { provider: codex }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.profile).toBe(DEFAULT_CONFIG.profile)
    expect(cfg.defaultProvider).toBe(DEFAULT_CONFIG.defaultProvider)
    expect(cfg.budgets.global.maxTurns).toBe(DEFAULT_CONFIG.budgets.global.maxTurns)
  })

  test('empty company: {} resolves to undefined', async () => {
    await writeConfig(`
company: {}
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company).toBeUndefined()
  })
})

describe('mergeCompany — rejection cases', () => {
  test('company is rejected when set to a YAML array', async () => {
    await writeConfig(`
company:
  - ba
  - builder
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigLoadError)
      const e = err as ConfigLoadError
      expect(e.issues.some((i) => i.code === 'config_invalid_shape')).toBe(true)
      expect(e.issues.some((i) => i.rule.includes('company must be a mapping'))).toBe(true)
    }
  })

  test('company is rejected when set to a scalar', async () => {
    await writeConfig(`
company: "codex"
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      expect(e.issues.some((i) => i.code === 'config_invalid_shape')).toBe(true)
    }
  })

  test('unknown role keys are rejected with loader_company_role_unknown', async () => {
    await writeConfig(`
company:
  agile-coach:
    provider: codex
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      const issue = e.issues.find((i) => i.code === 'loader_company_role_unknown')
      expect(issue).toBeDefined()
      expect(issue!.detail).toContain("'agile-coach'")
      expect(issue!.rule).toContain('ba')
      expect(issue!.rule).toContain('scientist')
    }
  })

  test('unsupported row keys (permissions, budgets, bash) are rejected', async () => {
    await writeConfig(`
company:
  builder:
    provider: claude
    permissions: { read: '*' }
    budgets:
      maxTurns: 99
    bash: deny
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      const codes = e.issues.map((i) => i.code)
      // All three unsupported keys should surface.
      const details = e.issues.filter((i) => i.code === 'config_invalid_value').map((i) => i.detail ?? '')
      expect(details.some((d) => d.includes('permissions'))).toBe(true)
      expect(details.some((d) => d.includes('budgets'))).toBe(true)
      expect(details.some((d) => d.includes('bash'))).toBe(true)
      expect(codes).toContain('config_invalid_value')
    }
  })

  test('row that is not a mapping is rejected', async () => {
    await writeConfig(`
company:
  builder: "codex"
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      expect(e.issues.some((i) => i.code === 'config_invalid_shape')).toBe(true)
      expect(e.issues.some((i) => i.rule.includes('company.builder must be a mapping'))).toBe(true)
    }
  })

  test('row that is a YAML array is rejected', async () => {
    await writeConfig(`
company:
  builder:
    - claude
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      expect(e.issues.some((i) => i.code === 'config_invalid_shape')).toBe(true)
    }
  })

  test('invalid provider value is rejected with config_invalid_value', async () => {
    await writeConfig(`
company:
  ba:
    provider: not_a_provider
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      const issue = e.issues.find(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('company.ba.provider'),
      )
      expect(issue).toBeDefined()
      expect(issue!.detail).toContain('not_a_provider')
    }
  })

  test('non-string model is rejected', async () => {
    await writeConfig(`
company:
  builder:
    model: 42
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      const issue = e.issues.find(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('company.builder.model'),
      )
      expect(issue).toBeDefined()
    }
  })

  test('empty-string model is rejected', async () => {
    await writeConfig(`
company:
  builder:
    model: ""
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      const issue = e.issues.find(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('non-empty string'),
      )
      expect(issue).toBeDefined()
    }
  })

  test('multiple errors aggregate into a single ConfigLoadError', async () => {
    await writeConfig(`
company:
  agile-coach:
    provider: claude
  builder:
    provider: not_a_provider
    permissions: { read: '*' }
  reviewer:
    model: ""
`)
    try {
      await loadConfig({ cwd: tmp })
      throw new Error('expected ConfigLoadError')
    } catch (err) {
      const e = err as ConfigLoadError
      // At minimum: one role-unknown, one bad provider, one unsupported field, one bad model.
      expect(e.issues.length).toBeGreaterThanOrEqual(4)
      expect(e.issues.some((i) => i.code === 'loader_company_role_unknown')).toBe(true)
      expect(e.issues.some((i) => i.code === 'config_invalid_value')).toBe(true)
    }
  })
})

describe('mergeCompany — shared enum with persona schema', () => {
  test('every AgentProvider value is accepted', async () => {
    // Spot-check that AGENT_PROVIDERS extension (e.g., PE-1's xai) flows in
    // automatically. The four v0.1 providers all validate without a
    // company-schema migration.
    await writeConfig(`
company:
  ba: { provider: claude }
  lead: { provider: codex }
  builder: { provider: gemini }
  verifier: { provider: fake }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company!.ba?.provider).toBe('claude')
    expect(cfg.company!.lead?.provider).toBe('codex')
    expect(cfg.company!.builder?.provider).toBe('gemini')
    expect(cfg.company!.verifier?.provider).toBe('fake')
  })
})
