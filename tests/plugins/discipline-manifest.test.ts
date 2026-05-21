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

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

const DISCIPLINE_PLUGIN_JSON_PATH = join(
  REPO_ROOT,
  'plugins/code-oz-discipline/.claude-plugin/plugin.json',
)
const CODE_OZ_PLUGIN_JSON_PATH = join(REPO_ROOT, 'plugins/code-oz/.claude-plugin/plugin.json')
const MARKETPLACE_JSON_PATH = join(REPO_ROOT, 'plugins/.claude-plugin/marketplace.json')

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

  test('marketplace.json has a code-oz entry with source ./code-oz', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as { plugins: Array<Record<string, unknown>> }

    const entry = market.plugins.find((p) => p.name === 'code-oz')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('./code-oz')
  })

  test('marketplace.json has a code-oz-discipline entry with source ./code-oz-discipline', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as { plugins: Array<Record<string, unknown>> }

    const entry = market.plugins.find((p) => p.name === 'code-oz-discipline')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('./code-oz-discipline')
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
})
