// Guards against the M3 → M4 → M5 mistake: bumping CLI's PKG_VERSION but
// forgetting to bump package.json (or DEFAULT_CONFIG.version). M4 Codex
// review block-push #3 caught this drift; this test prevents the regression.

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { PKG_VERSION } from '../src/cli.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'

describe('version consistency across release-relevant surfaces', () => {
  test('package.json.version === src/cli.ts:PKG_VERSION === DEFAULT_CONFIG.version', async () => {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const pkg = JSON.parse(raw) as { version: string }
    expect(pkg.version).toBe(PKG_VERSION)
    expect(DEFAULT_CONFIG.version).toBe(PKG_VERSION)
  })
})
