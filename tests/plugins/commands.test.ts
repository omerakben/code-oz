// C3 — slash command file tests.
//
// Asserts that every command file declared in plugin.json exists, has valid
// YAML frontmatter, includes the locked consent/boundaries header, references
// the resolver, and does not claim gate/review authority.
//
// All assertions are purely file-content reads — no shell execution, fully
// offline, deterministic.

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()

const PLUGIN_JSON_PATH = join(REPO_ROOT, 'plugins/code-oz/.claude-plugin/plugin.json')
const COMMANDS_DIR = join(REPO_ROOT, 'plugins/code-oz/commands')

// Locked consent/boundaries header — must appear verbatim in every command.
const LOCKED_CONSENT_PHRASE = 'This command only invokes the code-oz engine'

// Boundary phrases that must appear in every command.
const BOUNDARY_PHRASE_NO_WRITE = '.code-oz/'
const BOUNDARY_PHRASE_NO_PASSFALL = 'do not decide pass/fail'

// Resolver path — must be referenced in every command.
const RESOLVER_PATH = 'scripts/resolve-code-oz.sh'

// Gate/authority denylist — these must NOT appear in any command file
// in a context where the command itself claims gate or review authority.
const AUTHORITY_DENYLIST = [
  'I approve',
  'mark.*passed',
  'I reviewed',
  'write REVIEW.md',
  'write VERIFY.md',
  'write AUDIT.md',
  'GATE_',
]

// Subcommand mapping — key = filename stem, value = expected subcommand
const COMMAND_SUBCOMMANDS: Record<string, string> = {
  'code-oz-run.md': 'run',
  'code-oz-init.md': 'init',
  'code-oz-doctor.md': 'doctor',
  'code-oz-resume.md': 'resume',
}

// Commands that must contain cost/confirmation notice
const COST_COMMANDS = ['code-oz-run.md', 'code-oz-resume.md']
const COST_PHRASES = ['spawn providers', 'cost money', 'confirm']

// Commands that must NOT be bare-"free" marketed
const DOCTOR_COMMAND = 'code-oz-doctor.md'
const DOCTOR_REQUIRED_PHRASE = 'no provider spend'

// ---------------------------------------------------------------------------
// Helper: parse YAML frontmatter from a markdown file.
// Returns the frontmatter block as a string and the body.
// ---------------------------------------------------------------------------
function parseFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: '', body: content }
  }
  const end = content.indexOf('\n---', 3)
  if (end === -1) {
    return { frontmatter: '', body: content }
  }
  const frontmatter = content.slice(4, end)
  const body = content.slice(end + 4).trimStart()
  return { frontmatter, body }
}

// ---------------------------------------------------------------------------
// Helper: check if denylist phrase appears in content (regex or literal).
// Returns the matched phrase or null.
// ---------------------------------------------------------------------------
function findDenylisted(content: string, patterns: string[]): string | null {
  for (const pat of patterns) {
    try {
      const re = new RegExp(pat, 'i')
      if (re.test(content)) return pat
    } catch {
      if (content.includes(pat)) return pat
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Load plugin.json once
// ---------------------------------------------------------------------------
async function loadPluginJson(): Promise<{ commands: string[] }> {
  const raw = await readFile(PLUGIN_JSON_PATH, 'utf8')
  return JSON.parse(raw) as { commands: string[] }
}

describe('plugins/code-oz commands', () => {
  test('plugin.json declares exactly four command paths', async () => {
    const plugin = await loadPluginJson()
    expect(Array.isArray(plugin.commands)).toBe(true)
    expect(plugin.commands).toHaveLength(4)
    const expectedFiles = Object.keys(COMMAND_SUBCOMMANDS).map(
      (f) => `./commands/${f}`,
    )
    for (const expected of expectedFiles) {
      expect(plugin.commands).toContain(expected)
    }
  })

  // Run per-file assertions for each declared command
  for (const filename of Object.keys(COMMAND_SUBCOMMANDS)) {
    const subcommand = COMMAND_SUBCOMMANDS[filename]
    const filePath = join(COMMANDS_DIR, filename)

    describe(`${filename}`, () => {
      test('file exists at declared path', () => {
        expect(existsSync(filePath)).toBe(true)
      })

      test('has YAML frontmatter with non-empty description', async () => {
        const content = await readFile(filePath, 'utf8')
        const { frontmatter } = parseFrontmatter(content)
        expect(frontmatter.length).toBeGreaterThan(0)
        // description field present and non-empty
        expect(frontmatter).toMatch(/description\s*:/)
        const descMatch = frontmatter.match(/description\s*:\s*(.+)/)
        expect(descMatch).not.toBeNull()
        expect(descMatch![1].trim().length).toBeGreaterThan(0)
      })

      test('frontmatter includes allowed-tools: Bash', async () => {
        const content = await readFile(filePath, 'utf8')
        const { frontmatter } = parseFrontmatter(content)
        expect(frontmatter).toMatch(/allowed-tools/)
        expect(frontmatter).toMatch(/Bash/)
      })

      test('body contains locked consent/boundaries header', async () => {
        const content = await readFile(filePath, 'utf8')
        expect(content).toContain(LOCKED_CONSENT_PHRASE)
      })

      test('body references the resolver script path', async () => {
        const content = await readFile(filePath, 'utf8')
        expect(content).toContain(RESOLVER_PATH)
      })

      test(`body references the correct subcommand: ${subcommand}`, async () => {
        const content = await readFile(filePath, 'utf8')
        // The subcommand should appear after the resolver path reference
        // e.g. "resolve-code-oz.sh run" or "resolve-code-oz.sh doctor"
        const resolverLine = content
          .split('\n')
          .find((line) => line.includes(RESOLVER_PATH))
        expect(resolverLine).toBeDefined()
        expect(resolverLine).toContain(subcommand)
      })

      test('body contains boundary: never write .code-oz/', async () => {
        const content = await readFile(filePath, 'utf8')
        expect(content).toContain(BOUNDARY_PHRASE_NO_WRITE)
      })

      test('body contains boundary: do not decide pass/fail', async () => {
        const content = await readFile(filePath, 'utf8')
        expect(content).toContain(BOUNDARY_PHRASE_NO_PASSFALL)
      })

      test('does not claim gate/review authority (denylist)', async () => {
        const content = await readFile(filePath, 'utf8')
        const matched = findDenylisted(content, AUTHORITY_DENYLIST)
        if (matched !== null && matched !== 'GATE_') {
          expect(matched).toBeNull()
        }
        // More specific: GATE_ must not appear unless it's in a "do not write GATE_" instruction
        const gateLines = content
          .split('\n')
          .filter((line) => line.includes('GATE_'))
        for (const line of gateLines) {
          // Allowed: lines that say "do not", "never", "no GATE_", "not write GATE_"
          const allowed = /do not|never|not write|no gate|cannot write/i.test(line)
          expect(allowed).toBe(true)
        }
        // Disallowed: claiming to approve or mark passed
        expect(content).not.toMatch(/\bI approve\b/i)
        expect(content).not.toMatch(/mark[^.]*passed/i)
        expect(content).not.toMatch(/\bI reviewed\b/i)
        expect(content).not.toMatch(/write REVIEW\.md/i)
        expect(content).not.toMatch(/write VERIFY\.md/i)
        expect(content).not.toMatch(/write AUDIT\.md/i)
      })
    })
  }

  describe('code-oz-doctor.md specific', () => {
    const filePath = join(COMMANDS_DIR, DOCTOR_COMMAND)

    test('contains "no provider spend" qualifier', async () => {
      const content = await readFile(filePath, 'utf8')
      expect(content).toContain(DOCTOR_REQUIRED_PHRASE)
    })

    test('does not use standalone marketing "free" without spend qualifier nearby', async () => {
      const content = await readFile(filePath, 'utf8')
      // Find every occurrence of word "free"
      const lines = content.split('\n')
      for (const line of lines) {
        if (/\bfree\b/i.test(line)) {
          // The line must also contain "no provider spend" or be within 2 lines of it
          // Simple check: the whole file must contain "no provider spend"
          // and the bare "free" line must not be a marketing claim
          const isQualified =
            line.includes('no provider spend') ||
            line.includes('cost') ||
            line.includes('spend') ||
            // "free" in compound words like "freely" is ok
            /\bfreely\b/i.test(line)
          expect(isQualified).toBe(true)
        }
      }
    })
  })

  describe('run and resume cost/confirmation notice', () => {
    for (const filename of COST_COMMANDS) {
      test(`${filename} contains cost/confirmation notice`, async () => {
        const content = await readFile(join(COMMANDS_DIR, filename), 'utf8')
        const hasCostNotice = COST_PHRASES.some((phrase) => content.includes(phrase))
        expect(hasCostNotice).toBe(true)
      })
    }
  })
})
