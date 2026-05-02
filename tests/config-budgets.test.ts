import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config/load.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'

async function withConfig<T>(yaml: string, fn: (cwd: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'codeoz-cfg-'))
  try {
    const codeOzDir = join(dir, '.code-oz')
    await Bun.write(join(codeOzDir, 'config.yaml'), yaml)
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('budgets.global extension', () => {
  test('DEFAULT_CONFIG declares maxWallTimeMinutes and softWarnAtRatio', () => {
    expect(DEFAULT_CONFIG.budgets.global.maxWallTimeMinutes).toBe(240)
    expect(DEFAULT_CONFIG.budgets.global.softWarnAtRatio).toBe(0.75)
  })

  test('priceTable is undefined by default', () => {
    expect(DEFAULT_CONFIG.budgets.global.priceTable).toBeUndefined()
  })

  test('loadConfig accepts user override of maxWallTimeMinutes', async () => {
    const yaml = `
budgets:
  global:
    maxWallTimeMinutes: 60
`
    await withConfig(yaml, async (cwd) => {
      const cfg = await loadConfig({ cwd })
      expect(cfg.budgets.global.maxWallTimeMinutes).toBe(60)
    })
  })

  test('loadConfig accepts user override of softWarnAtRatio', async () => {
    const yaml = `
budgets:
  global:
    softWarnAtRatio: 0.9
`
    await withConfig(yaml, async (cwd) => {
      const cfg = await loadConfig({ cwd })
      expect(cfg.budgets.global.softWarnAtRatio).toBe(0.9)
    })
  })

  test('loadConfig throws when softWarnAtRatio outside (0, 1)', async () => {
    const yaml = `
budgets:
  global:
    softWarnAtRatio: 1.5
`
    await withConfig(yaml, async (cwd) => {
      await expect(loadConfig({ cwd })).rejects.toThrow(/softWarnAtRatio/)
    })
  })

  test('loadConfig parses priceTable when present', async () => {
    const yaml = `
budgets:
  global:
    priceTable:
      claude:claude-opus-4-7:
        inputPerMTok: 5
        outputPerMTok: 25
`
    await withConfig(yaml, async (cwd) => {
      const cfg = await loadConfig({ cwd })
      expect(cfg.budgets.global.priceTable).toBeDefined()
      expect(cfg.budgets.global.priceTable!['claude:claude-opus-4-7']).toEqual({
        inputPerMTok: 5,
        outputPerMTok: 25,
      })
    })
  })

  // M13 Codex Risk #3 + Bug #5: priceTable validator must reject non-finite
  // and negative values so cost-math helpers can rely on the invariant.
  // Prior validator only checked typeof === 'number' and accepted NaN,
  // Infinity, -Infinity, and negatives silently.
  test('loadConfig rejects negative priceTable values', async () => {
    const yaml = `
budgets:
  global:
    priceTable:
      claude:claude-opus-4-7:
        inputPerMTok: -5
        outputPerMTok: 25
`
    await withConfig(yaml, async (cwd) => {
      await expect(loadConfig({ cwd })).rejects.toThrow(/finite non-negative/)
    })
  })

  test('loadConfig rejects .inf priceTable values', async () => {
    const yaml = `
budgets:
  global:
    priceTable:
      claude:claude-opus-4-7:
        inputPerMTok: 5
        outputPerMTok: .inf
`
    await withConfig(yaml, async (cwd) => {
      await expect(loadConfig({ cwd })).rejects.toThrow(/finite non-negative/)
    })
  })

  test('loadConfig rejects .nan priceTable values', async () => {
    const yaml = `
budgets:
  global:
    priceTable:
      claude:claude-opus-4-7:
        inputPerMTok: .nan
        outputPerMTok: 25
`
    await withConfig(yaml, async (cwd) => {
      await expect(loadConfig({ cwd })).rejects.toThrow(/finite non-negative/)
    })
  })

  test('loadConfig accepts zero priceTable values (free-tier model)', async () => {
    const yaml = `
budgets:
  global:
    priceTable:
      fake:test-model:
        inputPerMTok: 0
        outputPerMTok: 0
`
    await withConfig(yaml, async (cwd) => {
      const cfg = await loadConfig({ cwd })
      expect(cfg.budgets.global.priceTable!['fake:test-model']).toEqual({
        inputPerMTok: 0,
        outputPerMTok: 0,
      })
    })
  })
})
