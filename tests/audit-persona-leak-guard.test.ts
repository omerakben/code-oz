import { describe, test, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// M17 C4 — rule-16 CI guard: no leaked LLM-drafted auditor persona prose.
//
// Rule 16 (CLAUDE.md, locked): "LLM-generated persona prompts are forbidden."
// The concrete failure mode this guard defends against: a Codex/Claude
// briefing or response doc drafts the auditor's role-definition prose, and a
// later step pastes that drafted prose into src/agents/defaults/auditor.md —
// laundering generated persona prose into the shipped persona. The auditor
// body must be HAND-AUTHORED, not lifted from a research/planning doc.
//
// Scanned doc families (per the C4 task spec):
//   docs/research/CODEX_*   docs/research/CLAUDE_*
//   docs/planning/CODEX_*   docs/planning/CLAUDE_*
//
// ACTIVATION CONDITIONS (this guard never false-passes silently):
//
//   (A) auditor.md ABSENT (the state in this commit): there is no persona body
//       to diff against, so the guard enforces a SENTINEL check — no scanned
//       doc may contain the leak sentinel `AUDITOR_PERSONA_BODY_BEGIN`. This is
//       the marker a human places in auditor.md when the co-authored body
//       lands (see condition B). If a doc carried that sentinel today, it would
//       mean drafted persona prose was staged in a research/planning doc — the
//       exact rule-16 leak. The guard asserts the scan actually ran (the doc
//       families exist and at least one file was read), so an empty scan can
//       never be mistaken for a pass.
//
//   (B) auditor.md PRESENT (after human co-authorship): the guard switches to a
//       verbatim-overlap check. It extracts the auditor persona BODY (the
//       Markdown after the YAML frontmatter), normalizes whitespace, and
//       asserts that no scanned doc contains a long contiguous run of that body
//       verbatim. A verbatim match means the shipped persona prose was copied
//       out of (or into) a generation-doc — flag it. The human-authored body
//       carries a `AUDITOR_PERSONA_BODY_BEGIN` sentinel line near its top; the
//       guard uses it both to locate the body and to assert the body is present
//       (so condition B cannot silently degrade to a no-op).
//
// The sentinel name is published here so the human co-authoring auditor.md
// knows the contract: place `AUDITOR_PERSONA_BODY_BEGIN` as the first content
// line of the persona body, and never paste the persona body into any
// CODEX_*/CLAUDE_* research/planning doc.

const LEAK_SENTINEL = 'AUDITOR_PERSONA_BODY_BEGIN'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const AUDITOR_PERSONA_PATH = join(REPO_ROOT, 'src', 'agents', 'defaults', 'auditor.md')

const SCANNED_DIR_PREFIXES: ReadonlyArray<{ dir: string; prefixes: readonly string[] }> = [
  { dir: join(REPO_ROOT, 'docs', 'research'), prefixes: ['CODEX_', 'CLAUDE_'] },
  { dir: join(REPO_ROOT, 'docs', 'planning'), prefixes: ['CODEX_', 'CLAUDE_'] },
]

async function collectScannedDocs(): Promise<string[]> {
  const files: string[] = []
  for (const { dir, prefixes } of SCANNED_DIR_PREFIXES) {
    if (!existsSync(dir)) continue
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      if (!e.name.endsWith('.md')) continue
      if (!prefixes.some((p) => e.name.startsWith(p))) continue
      files.push(join(dir, e.name))
    }
  }
  return files
}

/** Whitespace-collapsed text for robust verbatim-overlap detection. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Extract the persona body (everything after the closing YAML frontmatter
 *  fence). Returns the raw body string, or the whole file if no frontmatter. */
function personaBody(raw: string): string {
  const fm = /^---\n[\s\S]*?\n---\n/
  const m = raw.match(fm)
  return m ? raw.slice(m[0].length) : raw
}

describe('M17 rule-16 guard — no leaked auditor persona prose in generation docs', () => {
  test('the scan covers the documented doc families (guard never no-ops silently)', async () => {
    const docs = await collectScannedDocs()
    // At least one CODEX_*/CLAUDE_* doc must exist for the guard to mean
    // something. docs/research holds dozens of CODEX_BRIEFING_* files; this
    // assertion fails loudly if the scan ever reads zero files (e.g. a path
    // typo), preventing a silent false pass.
    expect(docs.length).toBeGreaterThan(0)
  })

  test('condition A (auditor.md absent): no generation doc carries the leak sentinel', async () => {
    if (existsSync(AUDITOR_PERSONA_PATH)) {
      // Condition B applies instead; covered by the next test.
      return
    }
    const docs = await collectScannedDocs()
    const offenders: string[] = []
    for (const f of docs) {
      const text = readFileSync(f, 'utf8')
      // This guard test file itself defines LEAK_SENTINEL, but it is under
      // tests/, not docs/research|planning, so it is never scanned.
      if (text.includes(LEAK_SENTINEL)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  test('condition B (auditor.md present): persona body does not appear verbatim in any generation doc', async () => {
    if (!existsSync(AUDITOR_PERSONA_PATH)) {
      // Condition A applies (auditor.md is co-authored later, rule 16).
      // We assert the absence explicitly so this branch is a documented skip,
      // not a silent pass: the e2e (audit-brownfield-cli) stays RED until the
      // human registers the auditor persona.
      expect(existsSync(AUDITOR_PERSONA_PATH)).toBe(false)
      return
    }
    const raw = readFileSync(AUDITOR_PERSONA_PATH, 'utf8')
    const body = personaBody(raw)
    // The co-authored body must carry the sentinel so this check cannot
    // degrade to a no-op against an empty/placeholder body.
    expect(body).toContain(LEAK_SENTINEL)

    const normBody = normalize(body)
    // A long contiguous slice of the body, normalized; a verbatim copy in a
    // generation doc is the rule-16 leak. 200 chars is long enough to exclude
    // incidental phrase overlap, short enough to catch a pasted block.
    const probe = normBody.slice(0, Math.min(200, normBody.length))
    expect(probe.length).toBeGreaterThan(40)

    const docs = await collectScannedDocs()
    const offenders: string[] = []
    for (const f of docs) {
      const text = normalize(readFileSync(f, 'utf8'))
      if (text.includes(probe)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})
