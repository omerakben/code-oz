// Guards the D1b advisory plugin scaffold against version drift and schema completeness.
//
// Rule-20 separation: code-oz-discipline must have NO commands and NO hooks keys.
// Advisory plugin is skills-only; wrapper content lives in the code-oz plugin only.
//
// Version-sync requirement: both sibling plugins version-lock to the engine version.
// When the engine bumps, both plugin.json files must be updated in the same commit.

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath decodes percent-encoding (e.g. spaces in the repo path),
// which URL.pathname leaves encoded and would break readFile.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

const DISCIPLINE_PLUGIN_JSON_PATH = join(
  REPO_ROOT,
  'plugins/code-oz-discipline/.claude-plugin/plugin.json',
)
const CODE_OZ_PLUGIN_JSON_PATH = join(REPO_ROOT, 'plugins/code-oz/.claude-plugin/plugin.json')
// Repo-root manifest: `claude plugin marketplace add <owner/repo>` only finds
// `.claude-plugin/marketplace.json` at the cloned repo's root.
const MARKETPLACE_JSON_PATH = join(REPO_ROOT, '.claude-plugin/marketplace.json')

describe('plugins/code-oz-discipline manifest shape', () => {
  test('plugin.json exists and parses as JSON', async () => {
    const raw = await readFile(DISCIPLINE_PLUGIN_JSON_PATH, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  test('plugin.json has required fields with correct values', async () => {
    const raw = await readFile(DISCIPLINE_PLUGIN_JSON_PATH, 'utf8')
    const plugin = JSON.parse(raw) as Record<string, unknown>

    expect(plugin.name).toBe('code-oz-discipline')
    expect(typeof plugin.description).toBe('string')
    expect((plugin.description as string).length).toBeGreaterThan(0)
    expect(plugin.skills).toBe('./skills')
  })

  test('plugin.json has NO commands key (advisory-only, rule-20 separation)', async () => {
    const raw = await readFile(DISCIPLINE_PLUGIN_JSON_PATH, 'utf8')
    const plugin = JSON.parse(raw) as Record<string, unknown>

    expect(Object.prototype.hasOwnProperty.call(plugin, 'commands')).toBe(false)
  })

  test('plugin.json has NO hooks key (advisory-only, rule-20 separation)', async () => {
    const raw = await readFile(DISCIPLINE_PLUGIN_JSON_PATH, 'utf8')
    const plugin = JSON.parse(raw) as Record<string, unknown>

    expect(Object.prototype.hasOwnProperty.call(plugin, 'hooks')).toBe(false)
  })

  test('plugin.json version matches code-oz plugin version (both version-locked to engine)', async () => {
    const [disciplineRaw, codeOzRaw] = await Promise.all([
      readFile(DISCIPLINE_PLUGIN_JSON_PATH, 'utf8'),
      readFile(CODE_OZ_PLUGIN_JSON_PATH, 'utf8'),
    ])
    const discipline = JSON.parse(disciplineRaw) as { version: string }
    const codeOz = JSON.parse(codeOzRaw) as { version: string }

    expect(discipline.version).toBe(codeOz.version)
  })
})

describe('marketplace.json with both sibling plugins', () => {
  test('marketplace.json has exactly two plugin entries', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as { plugins: Array<Record<string, unknown>> }

    expect(Array.isArray(market.plugins)).toBe(true)
    expect(market.plugins).toHaveLength(2)
  })

  test('marketplace.json has a code-oz entry with source ./plugins/code-oz', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as { plugins: Array<Record<string, unknown>> }

    const entry = market.plugins.find((p) => p.name === 'code-oz')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('./plugins/code-oz')
  })

  test('marketplace.json has a code-oz-discipline entry with source ./plugins/code-oz-discipline', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as { plugins: Array<Record<string, unknown>> }

    const entry = market.plugins.find((p) => p.name === 'code-oz-discipline')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('./plugins/code-oz-discipline')
  })

  test('both marketplace entries share the same version', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as { plugins: Array<{ name: string; version: string }> }

    const codeOzEntry = market.plugins.find((p) => p.name === 'code-oz')
    const disciplineEntry = market.plugins.find((p) => p.name === 'code-oz-discipline')

    expect(codeOzEntry).toBeDefined()
    expect(disciplineEntry).toBeDefined()
    expect(codeOzEntry!.version).toBe(disciplineEntry!.version)
  })

  test('both marketplace entry versions match the code-oz plugin.json version', async () => {
    const [marketRaw, codeOzRaw] = await Promise.all([
      readFile(MARKETPLACE_JSON_PATH, 'utf8'),
      readFile(CODE_OZ_PLUGIN_JSON_PATH, 'utf8'),
    ])
    const market = JSON.parse(marketRaw) as { plugins: Array<{ name: string; version: string }> }
    const codeOz = JSON.parse(codeOzRaw) as { version: string }

    const codeOzEntry = market.plugins.find((p) => p.name === 'code-oz')
    const disciplineEntry = market.plugins.find((p) => p.name === 'code-oz-discipline')

    expect(codeOzEntry!.version).toBe(codeOz.version)
    expect(disciplineEntry!.version).toBe(codeOz.version)
  })

  // Installability guard: every `source` path must resolve (relative to the
  // marketplace root = repo root) to a real plugin directory whose plugin.json
  // name matches the entry. A manifest that points at a non-existent or
  // mismatched directory passes schema checks but fails at `plugin install`.
  test('every marketplace source resolves to a real plugin dir with a matching plugin.json', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as {
      plugins: Array<{ name: string; source: string }>
    }

    for (const entry of market.plugins) {
      // sources are repo-relative, must descend (no `..` traversal).
      expect(entry.source.startsWith('./')).toBe(true)
      expect(entry.source.includes('..')).toBe(false)

      const pluginJsonPath = join(REPO_ROOT, entry.source, '.claude-plugin/plugin.json')
      const pluginRaw = await readFile(pluginJsonPath, 'utf8')
      const plugin = JSON.parse(pluginRaw) as { name: string }
      expect(plugin.name).toBe(entry.name)
    }
  })
})
