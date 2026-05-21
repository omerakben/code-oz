// C7 — D1b advisory skills acceptance harness (offline, deterministic).
//
// The `code-oz-discipline` plugin ships ADVISORY skills only. They never
// enforce anything, never write canonical artifacts, never claim gate or
// review authority. Every honesty constraint below is load-bearing — these
// skills are the surface a user could mistake for "using code-oz" while
// bypassing the engine.
//
// Locked D1b parameters asserted here (verbatim from
// docs/design/SUPERPOWERS_BORROW_ANALYSIS.md "D1b parameters" +
// DISTRIBUTION_PLAN_FINAL.md §5):
//   - advisory banner (verbatim, every skill)
//   - instruction-priority / lowest-authority (B6) statement
//   - denylist-refusal block (refuse GATE_*/VERIFY.md/REVIEW.md/AUDIT.md/
//     gate-sense passed-approved/cross-family-review claims)
//   - universal-rules.md imported VERBATIM (rule 16 deterministic templating)
//   - engine upsell (`code-oz run`)
//   - NON-coercive description (no superpowers maximalism)
//   - no gate-authority leak in the skill's OWN text (negative — mirrors the
//     b4-acceptance group-3 matcher style)
//   - render integrity: deterministic + committed output equals re-render

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSkill, SKILL_NAMES } from '../../plugins/code-oz-discipline/scripts/render-skills'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()

const PLUGIN_DIR = join(REPO_ROOT, 'plugins/code-oz-discipline')
const SKILLS_DIR = join(PLUGIN_DIR, 'skills')
const UNIVERSAL_RULES_PATH = join(REPO_ROOT, 'src/prompts/universal-rules.md')

// The verbatim advisory banner — every skill must contain this exact string.
const BANNER =
  'Advisory only — not an enforced gate. For enforced gates and a different-model review, run `code-oz run`.'

const NAMES = ['brainstorming', 'source-check', 'red-first'] as const

function skillPath(name: string): string {
  return join(SKILLS_DIR, name, 'SKILL.md')
}

async function readSkill(name: string): Promise<string> {
  return readFile(skillPath(name), 'utf8')
}

// Minimal frontmatter parse: pulls the `name:` and `description:` lines from a
// leading `---` … `---` block. Mirrors the lightweight matcher style of the
// other plugin tests (no YAML dependency).
function parseFrontmatter(text: string): { name?: string; description?: string; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { body: text }
  const fmBlock = m[1] ?? ''
  const body = m[2] ?? ''
  const nameLine = fmBlock.split('\n').find((l) => l.startsWith('name:'))
  const descLine = fmBlock.split('\n').find((l) => l.startsWith('description:'))
  const name = nameLine?.slice('name:'.length).trim()
  const description = descLine?.slice('description:'.length).trim()
  return { name, description, body }
}

// ===========================================================================
// Per-skill content assertions.
// ===========================================================================
describe('C7 — each advisory skill carries the locked honesty surface', () => {
  for (const name of NAMES) {
    describe(`skill: ${name}`, () => {
      test('exists with valid frontmatter; name matches dir; non-empty description', async () => {
        expect(existsSync(skillPath(name))).toBe(true)
        const text = await readSkill(name)
        const { name: fmName, description } = parseFrontmatter(text)
        expect(fmName).toBe(name)
        expect(description).toBeDefined()
        expect((description ?? '').length).toBeGreaterThan(0)
      })

      test('description is NOT coercive (no superpowers maximalism)', async () => {
        const text = await readSkill(name)
        const { description = '' } = parseFrontmatter(text)
        expect(description).not.toMatch(/YOU MUST/)
        expect(description).not.toMatch(/no choice/i)
        expect(description).not.toContain('1%')
        expect(description).not.toMatch(/EXTREMELY/)
        // No all-caps coercion word (a run of 4+ uppercase letters used as a
        // standalone shout). Acronyms inside normal prose are fine; this guards
        // the maximalist all-caps voice ("ALWAYS", "NEVER", "MUST").
        expect(description).not.toMatch(/\b(ALWAYS|NEVER|MUST|REQUIRED)\b/)
      })

      test('contains the advisory banner VERBATIM', async () => {
        const text = await readSkill(name)
        expect(text).toContain(BANNER)
      })

      test('contains the instruction-priority / lowest-authority statement', async () => {
        const text = await readSkill(name)
        // User instructions / CLAUDE.md / engine outrank this advisory skill.
        expect(text).toContain('CLAUDE.md')
        expect(text.toLowerCase()).toContain('user')
        expect(text.toLowerCase()).toMatch(/outrank|take precedence|lowest|override this skill/)
        // It must NOT borrow superpowers' "this skill overrides the system
        // prompt" inversion.
        expect(text.toLowerCase()).not.toMatch(/override (?:the )?(?:default )?system prompt/)
      })

      test('contains the denylist-refusal block', async () => {
        const text = await readSkill(name)
        // Names every denied artifact class.
        expect(text).toContain('GATE_')
        expect(text).toContain('VERIFY.md')
        expect(text).toContain('REVIEW.md')
        expect(text).toContain('AUDIT.md')
        // Instructs REFUSING to emit these (advisory behavior), and attributes
        // gates/review to the engine.
        expect(text.toLowerCase()).toMatch(/refuse/)
        expect(text.toLowerCase()).toContain('engine')
        // Names the gate-sense passed/approved tokens and the cross-family
        // review claim as off-limits.
        expect(text.toLowerCase()).toMatch(/passed/)
        expect(text.toLowerCase()).toMatch(/approved/)
        expect(text.toLowerCase()).toMatch(/cross-family review/)
      })

      test('imports the FULL universal-rules.md VERBATIM', async () => {
        const text = await readSkill(name)
        const universal = await readFile(UNIVERSAL_RULES_PATH, 'utf8')
        // The entire source sheet must be present byte-for-byte.
        expect(text).toContain(universal)
      })

      test('ends with / contains the engine upsell (`code-oz run`)', async () => {
        const text = await readSkill(name)
        expect(text).toContain('code-oz run')
      })
    })
  }
})

// ===========================================================================
// Negative — the skill never leaks gate authority in its OWN text.
// Mirrors tests/plugins/b4-acceptance.test.ts groups 2-3 matcher style:
// FORBID the skill performing gate/review; ALLOW instructing to REFUSE them
// and attributing them to the engine.
// ===========================================================================
describe('C7 — advisory skills claim no gate/review authority in their own text', () => {
  // First-person / imperative claims that the SKILL itself produces gate-shaped
  // output or performs review. Engine attributions ("the engine writes GATE_*")
  // and prohibition/refusal prose ("refuse to write REVIEW.md") are allowed and
  // must NOT match.
  const SELF_AUTHORITY_PATTERNS: ReadonlyArray<RegExp> = [
    /\bI approve\b/i,
    /\bI reviewed\b/i,
    /\bI performed cross-family review\b/i,
    /\bI ran cross-family review\b/i,
    /mark[^.\n]*passed\b/i,
    /\bwrite\s+REVIEW\.md/i,
    /\bwrite\s+VERIFY\.md/i,
    /\bwrite\s+AUDIT\.md/i,
    /\bemit\s+(?:a\s+)?GATE_/i,
    /\bwrite\s+(?:a\s+)?GATE_/i,
    /\bdecide\s+the\s+gate\b/i,
    /\bconfirm\s+it\s+passed\b/i,
    /\bdeclare\s+the\s+gate\b/i,
    /\bpass\s+the\s+gate\b/i,
  ]

  // A line is exempt when it is a prohibition / refusal / engine attribution.
  const ALLOWED_CONTEXT =
    /do not|don't|never|not write|no gate|cannot|can't|only the engine|the engine|refuse|advisory only|instead/i

  for (const name of NAMES) {
    test(`${name}: no line claims gate/review authority for the skill`, async () => {
      const text = await readSkill(name)
      const offenders: Array<{ line: string; pattern: string }> = []
      for (const line of text.split('\n')) {
        for (const re of SELF_AUTHORITY_PATTERNS) {
          if (re.test(line) && !ALLOWED_CONTEXT.test(line)) {
            offenders.push({ line: line.trim(), pattern: re.source })
          }
        }
      }
      expect(offenders).toEqual([])
    })
  }

  test('control: a self-authority sentence IS flagged but refusal/attribution is not', () => {
    const selfClaim = 'I approve this phase and mark it passed.'
    const refusal = 'Refuse to write REVIEW.md — the engine owns review.'
    const attribution = 'The engine writes GATE_* and performs cross-family review.'
    const hit = (line: string) =>
      SELF_AUTHORITY_PATTERNS.some((re) => re.test(line)) && !ALLOWED_CONTEXT.test(line)
    expect(hit(selfClaim)).toBe(true)
    expect(hit(refusal)).toBe(false)
    expect(hit(attribution)).toBe(false)
  })
})

// ===========================================================================
// Render integrity — rule-16 deterministic templating enforced mechanically.
// ===========================================================================
describe('C7 — render integrity (deterministic + committed in sync)', () => {
  test('renderer exposes the three skill names', () => {
    expect([...SKILL_NAMES].sort()).toEqual([...NAMES].sort())
  })

  for (const name of NAMES) {
    test(`${name}: renderer is deterministic (two renders byte-identical)`, async () => {
      const a = await renderSkill(name)
      const b = await renderSkill(name)
      expect(a).toBe(b)
    })

    test(`${name}: committed SKILL.md equals the renderer output (no drift)`, async () => {
      const rendered = await renderSkill(name)
      const committed = await readSkill(name)
      expect(committed).toBe(rendered)
    })
  }
})
