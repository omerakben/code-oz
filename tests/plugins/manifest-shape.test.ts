// Guards the D1a plugin scaffold against version drift and schema completeness.
//
// Version-sync requirement: plugin.json cannot read package.json at runtime
// (it is a static manifest consumed by the Claude Code plugin loader), so this
// test is the enforcement mechanism. Whenever the engine version bumps, the
// plugin.json version MUST be updated in the same commit. Failure here means
// the plugin advertises a version that does not match the installed binary.

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath decodes percent-encoding (e.g. spaces in the repo path),
// which URL.pathname leaves encoded and would break readFile.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

const PLUGIN_JSON_PATH = join(REPO_ROOT, 'plugins/code-oz/.claude-plugin/plugin.json')
const MARKETPLACE_JSON_PATH = join(REPO_ROOT, 'plugins/.claude-plugin/marketplace.json')
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json')

const EXPECTED_COMMANDS = [
  './commands/code-oz-run.md',
  './commands/code-oz-init.md',
  './commands/code-oz-doctor.md',
  './commands/code-oz-resume.md',
]

describe('plugins/code-oz manifest shape', () => {
  test('plugin.json exists and parses as JSON', async () => {
    const raw = await readFile(PLUGIN_JSON_PATH, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  test('plugin.json has required fields with correct values', async () => {
    const raw = await readFile(PLUGIN_JSON_PATH, 'utf8')
    const plugin = JSON.parse(raw) as Record<string, unknown>

    expect(plugin.name).toBe('code-oz')
    expect(typeof plugin.description).toBe('string')
    expect((plugin.description as string).length).toBeGreaterThan(0)
    expect(plugin.hooks).toBe('./hooks/hooks.json')
    expect(Array.isArray(plugin.commands)).toBe(true)
    expect(plugin.commands).toEqual(EXPECTED_COMMANDS)
  })

  test('plugin.json version matches engine package.json version', async () => {
    const [pluginRaw, pkgRaw] = await Promise.all([
      readFile(PLUGIN_JSON_PATH, 'utf8'),
      readFile(PACKAGE_JSON_PATH, 'utf8'),
    ])
    const plugin = JSON.parse(pluginRaw) as { version: string }
    const pkg = JSON.parse(pkgRaw) as { version: string }

    expect(plugin.version).toBe(pkg.version)
  })

  test('marketplace.json exists and parses as JSON', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  test('marketplace.json has a plugins array with exactly two entries (code-oz + code-oz-discipline)', async () => {
    const raw = await readFile(MARKETPLACE_JSON_PATH, 'utf8')
    const market = JSON.parse(raw) as { plugins: Array<Record<string, unknown>> }

    expect(Array.isArray(market.plugins)).toBe(true)
    expect(market.plugins).toHaveLength(2)

    const entry = market.plugins.find((p) => p.name === 'code-oz')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('./code-oz')
  })

  test('marketplace.json code-oz entry version matches plugin.json version', async () => {
    const [marketRaw, pluginRaw] = await Promise.all([
      readFile(MARKETPLACE_JSON_PATH, 'utf8'),
      readFile(PLUGIN_JSON_PATH, 'utf8'),
    ])
    const market = JSON.parse(marketRaw) as { plugins: Array<{ name: string; version: string }> }
    const plugin = JSON.parse(pluginRaw) as { version: string }

    const entry = market.plugins.find((p) => p.name === 'code-oz')
    expect(entry!.version).toBe(plugin.version)
  })
})
