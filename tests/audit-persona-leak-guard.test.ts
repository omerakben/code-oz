import { describe, test, expect } from 'bun:test'
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
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
//       Markdown after the YAML frontmatter), STRIPS the provenance sentinel and
//       any marker lines so the probes are drawn from real persona PROSE (not
//       from the freshly-added sentinel), normalizes whitespace, and asserts
//       that no scanned doc contains a long contiguous run of that prose
//       verbatim. The probe is NOT a single first-slice: it is a set of
//       non-overlapping windows spanning the WHOLE normalized prose, so a
//       verbatim paste of any LATER part of the body is caught too. A verbatim
//       match means the shipped persona prose was copied out of (or into) a
//       generation-doc — flag it. The human-authored body still carries a
//       `AUDITOR_PERSONA_BODY_BEGIN` sentinel line near its top; the guard uses
//       it to assert the body is present (so condition B cannot silently
//       degrade to a no-op) but never lets it leak into a probe.
//
//       WHY strip the sentinel before probing (Codex C4 fix-first finding): the
//       sentinel sits at the TOP of the body, inside any first-slice probe. A
//       future auditor.md copied verbatim from a CODEX_*/CLAUDE_* doc, then
//       given a freshly-added sentinel, would PASS a naive first-slice check —
//       the scanned doc lacks the new sentinel, so `doc.includes(probe)` is
//       false. The sentinel poisons the probe. Stripping it (and probing
//       multiple slices) closes both the sentinel-poison and first-slice-only
//       evasion gaps.
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

/** Drop the provenance sentinel and any marker-only lines from the body so the
 *  probes are drawn from real persona PROSE. The sentinel lives at the TOP of
 *  the body; if left in, it sits inside a first-slice probe and a doc that
 *  lacks the freshly-added sentinel would never match (sentinel-poisoned probe,
 *  Codex C4 finding). A "marker line" is a line whose content (whitespace
 *  collapsed) is the sentinel, or is the sentinel preceded/followed only by
 *  Markdown comment / punctuation scaffolding (e.g. `<!-- AUDITOR_PERSONA_BODY_BEGIN -->`). */
function strippedProse(body: string): string {
  return body
    .split('\n')
    .filter((line) => !line.includes(LEAK_SENTINEL))
    .join('\n')
}

/** Build a set of non-overlapping normalized windows spanning the WHOLE prose,
 *  so a verbatim paste of ANY part of the body (not just its head) is caught.
 *  Window length is calibrated long enough to exclude incidental phrase overlap
 *  with design sketches yet short enough to catch a pasted LLM draft block. */
const PROBE_WINDOW = 200

function probeWindows(normProse: string): string[] {
  const probes: string[] = []
  for (let i = 0; i < normProse.length; i += PROBE_WINDOW) {
    const slice = normProse.slice(i, i + PROBE_WINDOW)
    // Only keep windows long enough to be discriminating; a short trailing
    // remainder cannot reliably distinguish a paste from incidental overlap.
    if (slice.length >= 120) probes.push(slice)
  }
  // Guarantee at least one probe even for a short body (degenerate case).
  if (probes.length === 0 && normProse.length >= 40) probes.push(normProse)
  return probes
}

/** Core condition-B check, factored out so a temporary in-test fixture can
 *  exercise the strengthened logic without creating the real auditor.md.
 *  Returns the list of docs that contain ANY probe window verbatim. */
function leakOffenders(personaRaw: string, docPaths: string[]): string[] {
  const body = personaBody(personaRaw)
  const prose = strippedProse(body)
  const normProse = normalize(prose)
  const probes = probeWindows(normProse)
  const offenders = new Set<string>()
  for (const f of docPaths) {
    const text = normalize(readFileSync(f, 'utf8'))
    if (probes.some((p) => text.includes(p))) offenders.add(f)
  }
  return [...offenders]
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
    // degrade to a no-op against an empty/placeholder body. The sentinel is
    // a REQUIRED provenance marker (rule 16); it is stripped only when
    // BUILDING probes, never as a relaxation of this presence requirement.
    expect(body).toContain(LEAK_SENTINEL)

    // Probes are drawn from the sentinel-stripped prose and span the whole
    // body; assert we actually have something to probe.
    const probes = probeWindows(normalize(strippedProse(body)))
    expect(probes.length).toBeGreaterThan(0)

    const docs = await collectScannedDocs()
    expect(leakOffenders(raw, docs)).toEqual([])
  })

  // --- Strengthened-logic coverage via temporary in-test fixtures ----------
  // These exercise condition-B's verbatim-detection logic WITHOUT creating the
  // real src/agents/defaults/auditor.md (which must stay absent until the human
  // co-authors it — rule 16, and the audit-brownfield-cli e2e stays RED on it).

  test('strengthened guard FLAGS a body pasted verbatim from a generation doc', () => {
    // A realistic auditor-like body: a long verbatim slice of the auditor-body
    // SKETCH that already lives in CODEX_BRIEFING_M17.md. This is the exact
    // paste-the-draft failure rule 16 forbids.
    const briefing = join(REPO_ROOT, 'docs', 'research', 'CODEX_BRIEFING_M17.md')
    const sketch = normalize(readFileSync(briefing, 'utf8'))
    // Take a ~1000-char contiguous run from deep inside the briefing body so we
    // are testing a LATER slice (not the head) — the first-slice-only evasion.
    const pasted = sketch.slice(800, 1800)
    expect(pasted.length).toBeGreaterThan(600)

    const tmp = mkdtempSync(join(tmpdir(), 'leak-guard-'))
    try {
      const fixtureDoc = join(tmp, 'CODEX_FIXTURE.md')
      writeFileSync(fixtureDoc, readFileSync(briefing, 'utf8'), 'utf8')
      // Build a persona body whose PROSE is the pasted run, with a freshly
      // added sentinel at the top. Under the OLD first-slice logic the sentinel
      // would poison the probe and this would PASS; the strengthened guard must
      // FLAG it because it probes the stripped prose across the whole body.
      const leakedPersona = `---\nname: auditor\n---\n${LEAK_SENTINEL}\n\n${pasted}\n`
      const offenders = leakOffenders(leakedPersona, [fixtureDoc])
      expect(offenders).toContain(fixtureDoc)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('strengthened guard PASSES a clean hand-authored body (no verbatim run)', () => {
    const briefing = join(REPO_ROOT, 'docs', 'research', 'CODEX_BRIEFING_M17.md')
    const tmp = mkdtempSync(join(tmpdir(), 'leak-guard-'))
    try {
      const fixtureDoc = join(tmp, 'CODEX_FIXTURE.md')
      writeFileSync(fixtureDoc, readFileSync(briefing, 'utf8'), 'utf8')
      // A body that shares CONCEPTUAL overlap (same role words) but no long
      // verbatim run with the briefing. Sentinel present at the top.
      const cleanPersona = [
        '---',
        'name: auditor',
        '---',
        LEAK_SENTINEL,
        '',
        '# Auditor',
        '',
        'I read a repository and an operator complaint. I write down where the',
        'trouble seems to sit, how someone could trigger it again, and which',
        'guarantees a later change must keep intact. I never edit a file and I',
        'never hand over a fix; that belongs to a different step entirely. When',
        'I cannot open something I claimed to inspect, I say so plainly and leave',
        'an open question rather than guess a line number.',
      ].join('\n')
      const offenders = leakOffenders(cleanPersona, [fixtureDoc])
      expect(offenders).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('sentinel no longer poisons the probe (stripped before probing)', () => {
    // Two bodies with IDENTICAL prose; one has the sentinel, one does not.
    // They must produce the SAME probe set, proving the sentinel is excluded.
    const prose = 'The auditor grounds every claim in file content read from the repository before writing it down here in prose form for the record.'
    const withSentinel = `---\nname: auditor\n---\n${LEAK_SENTINEL}\n${prose}\n`
    const withoutSentinel = `---\nname: auditor\n---\n${prose}\n`

    const probesA = probeWindows(normalize(strippedProse(personaBody(withSentinel))))
    const probesB = probeWindows(normalize(strippedProse(personaBody(withoutSentinel))))
    expect(probesA).toEqual(probesB)
    // And no probe contains the sentinel.
    expect(probesA.some((p) => p.includes(LEAK_SENTINEL))).toBe(false)
  })
})
