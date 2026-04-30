import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config/load.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'

async function withConfig<T>(yaml: string, fn: (cwd: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'codeoz-cfg-sci-'))
  try {
    const codeOzDir = join(dir, '.code-oz')
    await Bun.write(join(codeOzDir, 'config.yaml'), yaml)
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('phases.scientist (Codex M6 review block-next-milestone #6)', () => {
  test('default retroSeedDefine is false', () => {
    expect(DEFAULT_CONFIG.phases.scientist.retroSeedDefine).toBe(false)
  })

  test('loadConfig accepts user override', async () => {
    const yaml = `
phases:
  scientist:
    retroSeedDefine: true
`
    await withConfig(yaml, async (cwd) => {
      const cfg = await loadConfig({ cwd })
      expect(cfg.phases.scientist.retroSeedDefine).toBe(true)
    })
  })

  test('loadConfig throws on non-boolean retroSeedDefine', async () => {
    const yaml = `
phases:
  scientist:
    retroSeedDefine: "yes"
`
    await withConfig(yaml, async (cwd) => {
      await expect(loadConfig({ cwd })).rejects.toThrow(/retroSeedDefine/)
    })
  })
})
