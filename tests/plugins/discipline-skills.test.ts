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
// Pinned disclaimer sentences (Fix 2) — load-bearing "what this is not" prose.
//
// If any of these sentences is removed or contradicted in a source edit and
// re-render, the committed SKILL.md changes and these assertions fail. Pinning
// the exact phrase here means a source edit cannot silently delete the
// disclaimer and stay green.
// ===========================================================================
describe('C7 — load-bearing disclaimer sentences are pinned verbatim', () => {
  test('source-check: does not emit SOURCE_CHECK.md / does not satisfy enforced PLAN source-check', async () => {
    const text = await readSkill('source-check')
    // Pin the exact "What this is not" opening sentence from source-check.md.
    expect(text).toContain(
      'This skill advises the 3-source habit. It does **not** emit a `SOURCE_CHECK.md`\nfile and it does **not** satisfy the engine\'s enforced PLAN source-check.',
    )
  })

  test('red-first: does not run tests / does not verify anything passed / never claims suite is green', async () => {
    const text = await readSkill('red-first')
    // Pin the exact "What this is not" sentence from red-first.md.
    expect(text).toContain(
      'This skill advises the ordering. It does not run your tests, it does not verify\nthat anything passed, and it never claims a test suite is green on your behalf —',
    )
  })

  test('brainstorming: does not approve a design / does not satisfy a phase gate', async () => {
    const text = await readSkill('brainstorming')
    // Pin the exact closing "what this is not" sentence from brainstorming.md.
    expect(text).toContain(
      'This is exploration. It does not approve a design, satisfy a phase gate, or\nstand in for the engine\'s DEFINE phase.',
    )
  })
})

// ===========================================================================
// Negative — the skill never leaks gate authority in its OWN text.
//
// Two complementary guards (both must pass):
//
// Guard A — SELF_AUTHORITY_PATTERNS (verb-level first-person claims):
//   Catches imperative / first-person verbs that produce gate-shaped output.
//   Engine attributions and refusal prose are exempt via SELF_AUTHORITY_EXEMPT.
//
// Guard B — GATE_SENSE_OUTCOME_DENYLIST (outcome-level claims):
//   Catches ANY line that combines a gate-domain word with an outcome word,
//   signalling the skill itself completed a gate-sense action. A line is exempt
//   only when it explicitly attributes the action to the engine (contains
//   `\bthe engine\b` or `\bcode-oz\b` as the actor) OR contains an explicit
//   refusal/disclaimer token (does not / do not / never / refuse / cannot /
//   not an enforced / advisory only). The loose "instead" / stray-"never"
//   loophole in the old ALLOWED_CONTEXT is deliberately removed.
// ===========================================================================
describe('C7 — advisory skills claim no gate/review authority in their own text', () => {
  // Guard A: verb-level first-person authority patterns (kept from before).
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

  // Guard A exemption: the line is a prohibition, refusal, or engine attribution.
  // Tightened from the old regex: no longer exempts on "instead" alone or a
  // stray "never" that does not negate the claim. Requires that the negation or
  // attribution actually governs the authority verb.
  const SELF_AUTHORITY_EXEMPT =
    /do not|don't|not write|no gate|cannot|can't|only the engine|the engine|refuse|advisory only/i

  // Guard B: gate-sense OUTCOME denylist.
  //
  // A line is flagged when it satisfies EITHER of two sub-tests:
  //
  //   B1 — predicate-outcome: the line contains a gate-domain keyword AND an
  //        outcome word used as a predicate (not as an adjective modifying a
  //        noun). "approved" as an adjective in "the approved artifact
  //        contracts" does NOT match; "is approved" / "approved and" / "the
  //        gate passed" DO match.
  //
  //   B2 — surrogate-gate: the line contains a phrase that equates the skill
  //        itself to a gate result ("counts as your source-check gate",
  //        "engine-equivalent gate result", etc.) — even without a canonical
  //        outcome word.
  //
  // A line is exempt from Guard B when it:
  //   (a) attributes the action to the engine (\bthe engine\b or \bcode-oz\b
  //       performing the gate/review), OR
  //   (b) contains an explicit refusal or disclaimer token.
  //
  // "instead" and a stray "never" unrelated to the outcome are NOT exempt —
  // they were the bypass vector in the old matcher.
  const GATE_DOMAIN_RE =
    /\b(?:gate|design|review|source[\s-]?check|audit|verify|build)\b/i

  // "approved" matches only in predicate form (is/was/are/been/get/gets/got
  // approved, or "approved and", "approved —"). Attributive use ("the approved
  // artifact contracts") does NOT match because "approved" there is followed
  // directly by a noun phrase, not a predicate complement.
  const PREDICATE_OUTCOME_RE =
    /\b(?:passed|(?:is|was|are|been|gets?|got)\s+approved|approved\s+(?:and|—|,)|satisfied|completed?|is done|ready for build|ready to ship)\b/i

  // Surrogate-gate phrases: the skill positions itself as equivalent to a
  // gate result, even without using a canonical outcome word.
  //   - "counts as your source-check gate"
  //   - "Treat this as the engine-equivalent gate result"
  const SURROGATE_GATE_RE =
    /(?:counts\s+as|treat\s+this\s+as)\s+(?:your\s+|the\s+)?(?:source[\s-]?check\s+gate|gate|engine[\s-]?equivalent)/i

  // "the engine" only exempts when the engine is the ACTOR (followed by a
  // space/EOL — i.e. "the engine writes", "the engine enforces"). "engine-"
  // (hyphenated, as in "engine-equivalent") is NOT an engine-attribution and
  // does not get the exemption.
  const GATE_SENSE_OUTCOME_EXEMPT =
    /\bthe engine\s|\bcode-oz\b|does not|do not|never\s+(?:claims?|satisf|approv|pass|complet|declar)|refuse|cannot|not an enforced|advisory only/i

  function gateSenseOutcomeHit(line: string): boolean {
    const exempt = GATE_SENSE_OUTCOME_EXEMPT.test(line)
    if (exempt) return false
    // B1: predicate-outcome + gate-domain
    if (GATE_DOMAIN_RE.test(line) && PREDICATE_OUTCOME_RE.test(line)) return true
    // B2: surrogate-gate phrase
    if (SURROGATE_GATE_RE.test(line)) return true
    return false
  }

  for (const name of NAMES) {
    test(`${name}: no line claims gate/review authority (Guard A — verb patterns)`, async () => {
      const text = await readSkill(name)
      const offenders: Array<{ line: string; pattern: string }> = []
      for (const line of text.split('\n')) {
        for (const re of SELF_AUTHORITY_PATTERNS) {
          if (re.test(line) && !SELF_AUTHORITY_EXEMPT.test(line)) {
            offenders.push({ line: line.trim(), pattern: re.source })
          }
        }
      }
      expect(offenders).toEqual([])
    })

    test(`${name}: no line asserts a gate-sense outcome (Guard B — outcome denylist)`, async () => {
      const text = await readSkill(name)
      const offenders: Array<string> = []
      for (const line of text.split('\n')) {
        if (gateSenseOutcomeHit(line)) {
          offenders.push(line.trim())
        }
      }
      expect(offenders).toEqual([])
    })
  }

  // ---------------------------------------------------------------------------
  // Control assertions for Guard A.
  // ---------------------------------------------------------------------------
  test('Guard A control: self-authority sentence IS flagged; refusal/attribution is not', () => {
    const selfClaim = 'I approve this phase and mark it passed.'
    const refusal = 'Refuse to write REVIEW.md — the engine owns review.'
    const attribution = 'The engine writes GATE_* and performs cross-family review.'
    const hitA = (line: string) =>
      SELF_AUTHORITY_PATTERNS.some((re) => re.test(line)) && !SELF_AUTHORITY_EXEMPT.test(line)
    expect(hitA(selfClaim)).toBe(true)
    expect(hitA(refusal)).toBe(false)
    expect(hitA(attribution)).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Control assertions for Guard B — the adversarial bypass cases.
  // Every CATCH line must return true; every ALLOW line must return false.
  // These serve as regression proof: if the guard weakens, these fail.
  // ---------------------------------------------------------------------------
  test('Guard B control: CATCHES gate-sense outcome claims', () => {
    const catches = [
      'Once you have all three sources, the gate passed and BUILD may proceed.',
      'After this conversation, your design is approved and ready for BUILD.',
      'This counts as your source-check gate.',
      'Treat this as the engine-equivalent gate result.',
      'the design is approved and the DEFINE gate passed',
    ]
    for (const line of catches) {
      expect(gateSenseOutcomeHit(line)).toBe(true)
    }
  })

  test('Guard B control: ALLOWS engine attributions and refusal/disclaimer statements', () => {
    const allows = [
      'The engine writes GATE_* and performs cross-family review.',
      'This skill does not satisfy the engine\'s enforced PLAN source-check.',
      'it does not run your tests, it does not verify that anything passed',
      'Do not declare that anything "passed" or was "approved" in a gate sense.',
      'Advisory only — not an enforced gate.',
    ]
    for (const line of allows) {
      expect(gateSenseOutcomeHit(line)).toBe(false)
    }
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
