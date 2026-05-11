import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()
const formulaPath = join(repoRoot, 'docs/homebrew/code-oz.rb.template')
const tapReadmePath = join(repoRoot, 'docs/homebrew/README.md')

function loadFormula(): string {
  if (!existsSync(formulaPath)) {
    throw new Error(`formula template missing at ${formulaPath}`)
  }
  return readFileSync(formulaPath, 'utf8')
}

describe('docs/homebrew/code-oz.rb.template', () => {
  test('exists and is readable', () => {
    expect(() => loadFormula()).not.toThrow()
  })

  test('declares a Ruby class extending Formula', () => {
    const formula = loadFormula()
    expect(formula).toMatch(/^class\s+CodeOz\s+<\s+Formula/m)
  })

  test('licenses as MIT', () => {
    const formula = loadFormula()
    expect(formula).toMatch(/^\s*license\s+"MIT"/m)
  })

  test('does not declare runtime dependencies (binary is self-contained)', () => {
    const formula = loadFormula()
    expect(formula).not.toMatch(/^\s*depends_on\s+["']/m)
  })

  test('ships per-arch URLs for macOS arm + intel', () => {
    const formula = loadFormula()
    expect(formula).toMatch(/on_macos\s+do/)
    expect(formula).toMatch(/on_arm\s+do[\s\S]+?url\s+["']/)
    expect(formula).toMatch(/on_intel\s+do[\s\S]+?url\s+["']/)
  })

  test('ships per-arch URLs for Linux arm + intel', () => {
    const formula = loadFormula()
    expect(formula).toMatch(/on_linux\s+do/)
  })

  test('exposes the binary via bin.install', () => {
    const formula = loadFormula()
    expect(formula).toMatch(/bin\.install\s+["']code-oz["']/)
  })

  test('test block exercises code-oz init (not just --version)', () => {
    const formula = loadFormula()
    expect(formula).toMatch(/test\s+do[\s\S]+?code-oz["'][^]+init/)
  })

  test('uses placeholder tokens that release-bump can substitute', () => {
    const formula = loadFormula()
    // Token shape: __TOKEN__ — visible to grep, replaceable by sed
    // (avoiding {{...}} or ${...} which conflict with Ruby string syntax).
    expect(formula).toMatch(/__VERSION__/)
    expect(formula).toMatch(/__SHA256_DARWIN_ARM64__/)
    expect(formula).toMatch(/__SHA256_DARWIN_X64__/)
    expect(formula).toMatch(/__SHA256_LINUX_ARM64__/)
    expect(formula).toMatch(/__SHA256_LINUX_X64__/)
  })

  test('asset URLs are pinned to the tagged release path', () => {
    const formula = loadFormula()
    expect(formula).toMatch(
      /https:\/\/github\.com\/omerakben\/code-oz\/releases\/download\/v__VERSION__\//,
    )
  })
})

describe('docs/homebrew/README.md', () => {
  test('exists and documents tap-repo setup', () => {
    expect(existsSync(tapReadmePath)).toBe(true)
    const text = readFileSync(tapReadmePath, 'utf8')
    expect(text.toLowerCase()).toContain('homebrew-code-oz')
    expect(text.toLowerCase()).toContain('brew install')
  })

  test('references the manual bump workflow', () => {
    const text = readFileSync(tapReadmePath, 'utf8')
    expect(text.toLowerCase()).toMatch(/sed|bump|substitut/)
    expect(text).toMatch(/v0\.\d+\.\d+/)
  })
})
