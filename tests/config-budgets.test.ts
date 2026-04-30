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
})
