import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigLoadError } from '../src/config/load.ts'

// M14 commit 2 — config-time validation of `company.reviewer.panel`.
// Layer 1 of the 5-layer defense-in-depth defined in
// docs/contracts/REVIEW_PANEL.md § "Five-layer defense-in-depth".
//
// Authoritative cross-family check (layer 2) lives in
// src/agents/loader.ts and runs after company:block overrides. Tests
// for layer 2 live in tests/loader-review-panel-cross-family.test.ts.

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-panel-cfg-'))
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

describe('reviewer.panel — happy paths', () => {
  test('absent panel leaves reviewer.panel undefined (single-reviewer back-compat)', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    provider: codex
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company?.reviewer?.panel).toBeUndefined()
    expect(cfg.company?.reviewer?.provider).toBe('codex')
  })

  test('valid 2-voter cross-family panel parses', async () => {
    // M16 C8: panel voters must be review-eligible per
    // capabilityOf(provider).eligiblePhases. `gemini` is a stub
    // (eligiblePhases=[]) so the canonical second voter family is `xai`.
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter }
      - { provider: xai, role: voter }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company?.reviewer?.panel).toEqual([
      { provider: 'codex', role: 'voter' },
      { provider: 'xai', role: 'voter' },
    ])
  })

  test('valid 2-voter panel + same-family advisory parses', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter }
      - { provider: xai, role: voter }
      - { provider: claude, role: advisory }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company?.reviewer?.panel).toHaveLength(3)
    expect(cfg.company?.reviewer?.panel?.[2]).toEqual({
      provider: 'claude',
      role: 'advisory',
    })
  })

  test('panelist with model field is preserved', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter, model: gpt-5.5 }
      - { provider: xai, role: voter, model: grok-3 }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company?.reviewer?.panel?.[0]).toEqual({
      provider: 'codex',
      role: 'voter',
      model: 'gpt-5.5',
    })
    expect(cfg.company?.reviewer?.panel?.[1]?.model).toBe('grok-3')
  })

  test('panel coexists with reviewer.provider/model (panel takes precedence at runtime)', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    provider: codex
    panel:
      - { provider: codex, role: voter }
      - { provider: xai, role: voter }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company?.reviewer?.provider).toBe('codex')
    expect(cfg.company?.reviewer?.panel).toHaveLength(2)
  })

  test('explicit builder provider is used for cross-family check (not defaultProvider)', async () => {
    // defaultProvider=claude but company.builder.provider=codex
    // → build family is codex; panel voters must be NOT codex
    await writeConfig(`
defaultProvider: claude
company:
  builder:
    provider: codex
  reviewer:
    panel:
      - { provider: claude, role: voter }
      - { provider: xai, role: voter }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company?.reviewer?.panel).toHaveLength(2)
  })
})

describe('reviewer.panel — voter count rejection', () => {
  test('0 voters (advisory only) → panel_voter_count_invalid', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: advisory }
      - { provider: gemini, role: advisory }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(err!.issues.some((i) => i.code === 'panel_voter_count_invalid')).toBe(true)
    expect(err!.issues.find((i) => i.code === 'panel_voter_count_invalid')!.detail).toContain('0 voters')
  })

  test('1 voter → panel_voter_count_invalid', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(err!.issues.find((i) => i.code === 'panel_voter_count_invalid')!.detail).toContain('1 voter')
  })

  test('3 voters → panel_voter_count_invalid (no configurable quorum in v1)', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter }
      - { provider: gemini, role: voter }
      - { provider: xai, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(err!.issues.find((i) => i.code === 'panel_voter_count_invalid')!.detail).toContain('3 voters')
  })

  test('empty panel array → panel_voter_count_invalid', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel: []
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(err!.issues.some((i) => i.code === 'panel_voter_count_invalid')).toBe(true)
  })
})

describe('reviewer.panel — same-family voter rejection (config-load layer 1)', () => {
  test('same-family voter (vs defaultProvider) → panel_voter_same_family_as_build', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: claude, role: voter }
      - { provider: gemini, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    const panelIssue = err!.issues.find((i) => i.code === 'panel_voter_same_family_as_build')
    expect(panelIssue).toBeDefined()
    expect(panelIssue!.detail).toContain("provider='claude'")
    expect(panelIssue!.detail).toContain("build family 'claude'")
  })

  test('both voters same-family → two errors', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: claude, role: voter }
      - { provider: claude, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.filter((i) => i.code === 'panel_voter_same_family_as_build').length,
    ).toBe(2)
  })

  test('same-family advisory entries pass (no gate authority)', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter }
      - { provider: xai, role: voter }
      - { provider: claude, role: advisory }
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.company?.reviewer?.panel).toHaveLength(3)
    expect(cfg.company?.reviewer?.panel?.[2]?.provider).toBe('claude')
  })

  test('same-family voter detected against explicit company.builder.provider', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  builder:
    provider: codex
  reviewer:
    panel:
      - { provider: codex, role: voter }
      - { provider: gemini, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    const panelIssue = err!.issues.find((i) => i.code === 'panel_voter_same_family_as_build')
    expect(panelIssue).toBeDefined()
    expect(panelIssue!.detail).toContain("build family 'codex'")
  })
})

describe('reviewer.panel — `panel` field rejection on non-reviewer roles', () => {
  test('panel on builder role → config_invalid_value with helpful detail', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  builder:
    panel:
      - { provider: codex, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    const issue = err!.issues.find(
      (i) => i.code === 'config_invalid_value' && i.detail?.includes("'panel'"),
    )
    expect(issue).toBeDefined()
    expect(issue!.detail).toContain('valid only on company.reviewer')
  })

  test('panel on lead role rejected', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  lead:
    panel:
      - { provider: codex, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.some(
        (i) => i.code === 'config_invalid_value' && i.detail?.includes("'panel'"),
      ),
    ).toBe(true)
  })
})

describe('reviewer.panel — shape rejection', () => {
  test('panel as object (not array) → config_invalid_shape', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      provider: codex
      role: voter
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.some(
        (i) => i.code === 'config_invalid_shape' && i.rule.includes('panel must be an array'),
      ),
    ).toBe(true)
  })

  test('panelist as string (not mapping) → config_invalid_shape', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - codex
      - { provider: gemini, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.some(
        (i) => i.code === 'config_invalid_shape' && i.rule.includes('panel[0]'),
      ),
    ).toBe(true)
  })

  test('panelist with invalid provider → config_invalid_value', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: openai, role: voter }
      - { provider: gemini, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.some(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('panel[0].provider'),
      ),
    ).toBe(true)
  })

  test('panelist with invalid role → config_invalid_value', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: judge }
      - { provider: gemini, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.some(
        (i) => i.code === 'config_invalid_value' && i.rule.includes('panel[0].role'),
      ),
    ).toBe(true)
  })

  test('panelist with empty model string → config_invalid_value', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter, model: "" }
      - { provider: gemini, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.some(
        (i) =>
          i.code === 'config_invalid_value' && i.rule.includes('panel[0].model'),
      ),
    ).toBe(true)
  })

  test('panelist with unsupported field → config_invalid_value', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: codex, role: voter, weight: 0.5 }
      - { provider: gemini, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      err!.issues.some(
        (i) => i.code === 'config_invalid_value' && i.detail?.includes("'weight'"),
      ),
    ).toBe(true)
  })

  test('multiple validation errors in one panel surface together', async () => {
    await writeConfig(`
defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: openai, role: judge }
      - { provider: claude, role: voter }
`)
    let err: ConfigLoadError | undefined
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e as ConfigLoadError
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    // both invalid provider AND invalid role on panel[0], plus same-family voter on panel[1],
    // plus voter count invalid (only 1 valid voter survives)
    expect(err!.issues.length).toBeGreaterThanOrEqual(3)
  })
})
