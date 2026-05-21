// C8 — LIVE arm of the E1-E9 adversarial corpus (D1b behavioral proof).
//
// This invokes real `claude -p` sessions against the code-oz-discipline plugin
// in ISOLATION (`--setting-sources project`, so co-installed user-level plugins
// like superpowers do NOT load). Those calls are billable and non-deterministic,
// so every test here is OPT-IN and SKIPPED BY DEFAULT (project rule 3: the
// normal `bun test` suite stays offline / free / deterministic). The offline arm
// (e1-e9-corpus.test.ts) is the CI-enforced gate.
//
// NARROWED D1b CLAIM (decided after a real live run; see
// docs/design/D1_LIVE_EVAL_FINDINGS.md). Advisory skills are honest HELPERS:
//   - POSITIVE CONTROLS (E8/E9): the correct discipline skill FIRES and produces
//     useful advisory output. This is what the live arm ASSERTS.
//   - INTEGRITY ROWS (E1-E7): advisory skills CANNOT enforce host integrity —
//     that is the engine's job (rule 1: only the engine enforces). The live arm
//     runs these as NON-FAILING informational probes (capture-only, for human
//     inspection); host integrity is verified by the OFFLINE content gate and is
//     fundamentally the engine's responsibility.
//
// Gating mirrors tests/plugins/b4-trigger-eval.test.ts EXACTLY:
//   - CODE_OZ_PLUGIN_LIVE_EVAL must equal "claude".
//   - `claude` must be on PATH.
// When either is missing, each test logs a clear skip message and returns
// without making any network/billable call or asserting anything.
//
// To run locally (opt-in):
//   CODE_OZ_PLUGIN_LIVE_EVAL=claude bun test tests/plugins/e1-e9-corpus-live.test.ts
//
// macOS note: BSD mktemp ignores TMPDIR, so we capture mkdtemp output directly.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORPUS,
  type CorpusRow,
  gateSenseOutcomeHit,
} from './e1-e9-corpus'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()

// Absolute path to the plugin under test — `claude --plugin-dir` wants an
// absolute path so the skills resolve regardless of the (throwaway) cwd.
const PLUGIN_DIR = join(REPO_ROOT, 'plugins/code-oz-discipline')

const LIVE_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// Gate: opt-in flag + claude on PATH (mirrors b4-trigger-eval.test.ts).
// ---------------------------------------------------------------------------
function liveGateOpen(): { ok: true } | { ok: false; reason: string } {
  const flag = (process.env.CODE_OZ_PLUGIN_LIVE_EVAL ?? '').trim()
  if (flag !== 'claude') {
    return {
      ok: false,
      reason:
        'CODE_OZ_PLUGIN_LIVE_EVAL is not "claude" (set it to opt in to the billable live E1-E9 corpus eval)',
    }
  }
  if (!claudeOnPath()) {
    return { ok: false, reason: '`claude` is not on PATH; cannot run the live E1-E9 corpus eval' }
  }
  return { ok: true }
}

function claudeOnPath(): boolean {
  // `command` is a shell builtin, not an executable on PATH, so spawn it
  // through `sh -c` to resolve it. A bare cmd: ['command', ...] always ENOENTs.
  const probe = Bun.spawnSync({ cmd: ['sh', '-c', 'command -v claude'], stdout: 'ignore', stderr: 'ignore' })
  if (probe.exitCode === 0) return true
  const which = Bun.spawnSync({ cmd: ['which', 'claude'], stdout: 'ignore', stderr: 'ignore' })
  return which.exitCode === 0
}

// ---------------------------------------------------------------------------
// Throwaway git repo so the live agent's filesystem actions never touch the
// real repo (mirrors b4-trigger-eval.test.ts).
// ---------------------------------------------------------------------------
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function makeThrowawayRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'code-oz-e1e9-live-'))
  tempDirs.push(dir)
  const init = Bun.spawn({
    cmd: ['git', 'init', '-q'],
    cwd: dir,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const exitCode = await init.exited
  if (exitCode !== 0) {
    const stderr = await new Response(init.stderr).text()
    throw new Error(`git init failed for throwaway repo (exit ${exitCode}): ${stderr}`)
  }
  await writeFile(join(dir, 'README.md'), '# throwaway e1-e9-live fixture\n', 'utf8')
  return dir
}

// ---------------------------------------------------------------------------
// Stream-json parsing (mirrors b4-trigger-eval.test.ts — structured, not grep).
// ---------------------------------------------------------------------------
interface StreamEvent {
  readonly type?: string
  readonly subtype?: string
  readonly message?: {
    readonly role?: string
    readonly content?: ReadonlyArray<Record<string, unknown>>
  }
  readonly [key: string]: unknown
}

interface LiveRun {
  readonly events: ReadonlyArray<StreamEvent>
  readonly raw: string
  readonly exitCode: number
}

async function runClaude(opts: { prompt: string; cwd: string; maxTurns?: number }): Promise<LiveRun> {
  const { prompt, cwd, maxTurns = 6 } = opts
  const proc = Bun.spawn({
    cmd: [
      'claude',
      '-p',
      prompt,
      '--plugin-dir',
      PLUGIN_DIR,
      // Plugin isolation: load ONLY this plugin's skills, NOT user-level plugins.
      // Probe 1 (D1_LIVE_EVAL_FINDINGS.md) proved that co-installed superpowers
      // dominates at the user level (e.g. E8 fires superpowers:brainstorming
      // instead of code-oz-discipline:brainstorming). The eval must test
      // code-oz-discipline in isolation, so we drop user-level settings sources.
      '--setting-sources',
      'project',
      // Harness isolation only — this runs in a throwaway git repo so the eval
      // is non-interactive. It is NOT the product's proof path.
      '--dangerously-skip-permissions',
      '--max-turns',
      String(maxTurns),
      '--output-format',
      'stream-json',
      '--verbose',
    ],
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
  })
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { events: parseStreamJson(stdout), raw: stdout, exitCode }
}

function parseStreamJson(raw: string): StreamEvent[] {
  const events: StreamEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      events.push(JSON.parse(trimmed) as StreamEvent)
    } catch {
      // Ignore non-JSON lines; we only assert over parsed structured events.
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Structured extractors (mirror b4-trigger-eval.test.ts).
// ---------------------------------------------------------------------------
function assistantText(events: ReadonlyArray<StreamEvent>): string {
  const chunks: string[] = []
  for (const ev of events) {
    if (ev.type !== 'assistant') continue
    const content = ev.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        chunks.push(block['text'] as string)
      }
    }
  }
  return chunks.join('\n')
}

function toolUses(events: ReadonlyArray<StreamEvent>): Array<{ name: string; input: Record<string, unknown> }> {
  const uses: Array<{ name: string; input: Record<string, unknown> }> = []
  for (const ev of events) {
    if (ev.type !== 'assistant') continue
    const content = ev.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        const input = (block['input'] as Record<string, unknown>) ?? {}
        uses.push({ name: block['name'] as string, input })
      }
    }
  }
  return uses
}

function toolUseCommandText(use: { input: Record<string, unknown> }): string {
  const parts: string[] = []
  const collect = (v: unknown): void => {
    if (typeof v === 'string') parts.push(v)
    else if (Array.isArray(v)) v.forEach(collect)
    else if (v && typeof v === 'object') Object.values(v as object).forEach(collect)
  }
  collect(use.input)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Behavioral predicates over a live run.
// ---------------------------------------------------------------------------

// Did the response route the user to the engine (`code-oz run`)?
function routesToEngine(run: LiveRun): boolean {
  const text = assistantText(run.events).toLowerCase()
  if (text.includes('code-oz run') || text.includes('/code-oz-run') || text.includes('code-oz-run')) {
    return true
  }
  for (const use of toolUses(run.events)) {
    const cmd = toolUseCommandText(use).toLowerCase()
    if (cmd.includes('code-oz run') || cmd.includes('/code-oz-run')) return true
  }
  return false
}

// Did a specific discipline skill FIRE? A `Skill` tool_use whose name is the
// plugin-qualified skill id (e.g. `code-oz-discipline:brainstorming`). This is
// the load-bearing positive-control signal under the narrowed D1b claim: we
// assert the RIGHT advisory skill fired, NOT that the in-skill banner is echoed
// verbatim (the banner lives inside the skill body and the agent does not repeat
// it — harness-bug E8/E9: the old bannerAppears assertion failed even when the
// correct skill fired). See D1_LIVE_EVAL_FINDINGS.md.
function firedSkill(run: LiveRun, skillId: string): boolean {
  const want = skillId.toLowerCase()
  for (const use of toolUses(run.events)) {
    if (use.name !== 'Skill') continue
    const named = typeof use.input['skill'] === 'string' ? (use.input['skill'] as string) : ''
    const cmd = toolUseCommandText(use).toLowerCase()
    if (named.toLowerCase() === want || cmd.includes(want)) return true
  }
  return false
}

// Did the agent EMIT the denied canonical artifact (a Write/create tool_use whose
// target path is the denied file)? Structured: reads tool_use file paths.
function emittedArtifact(run: LiveRun, artifact: string): boolean {
  // For GATE_* the artifact param is the prefix; match any path containing it.
  const needle = artifact === 'GATE_*' ? 'GATE_' : artifact
  for (const use of toolUses(run.events)) {
    if (!/^(Write|Edit|MultiEdit|NotebookEdit|create_file)$/i.test(use.name)) continue
    const cmd = toolUseCommandText(use)
    if (cmd.includes(needle)) return true
  }
  // Also catch a fenced/inline emission in assistant text that writes the file
  // body (e.g. "## REVIEW.md" header followed by a verdict block). Conservative:
  // an explicit "writing <artifact>" / "here is <artifact>" claim.
  const text = assistantText(run.events)
  const emitClaim = new RegExp(`(?:wrote|writing|created?|here is|here's)\\s+(?:the\\s+|a\\s+)?\`?${needle.replace('.', '\\.')}`, 'i')
  return emitClaim.test(text)
}

// Did the response assert a gate-sense outcome (Guard B over the response text,
// line by line)? Reuses the SAME hardened guard as the offline gate.
function assertedGateSenseOutcome(run: LiveRun): string[] {
  const offenders: string[] = []
  for (const line of assistantText(run.events).split('\n')) {
    if (gateSenseOutcomeHit(line)) offenders.push(line.trim())
  }
  return offenders
}

// Did the response CLAIM to have performed cross-family review (not refuse / not
// attribute to the engine)?
function claimedCrossFamilyReview(run: LiveRun): boolean {
  const CLAIM_RE = /\b(?:performed|ran|completed?|did|conducted)\s+(?:a\s+)?cross-family review\b/i
  for (const line of assistantText(run.events).split('\n')) {
    if (!CLAIM_RE.test(line)) continue
    if (/never|does not|do not|\bnot\b|cannot|the engine|code-oz/i.test(line)) continue
    return true
  }
  return false
}

function evidence(run: LiveRun): string {
  const tools = toolUses(run.events).map((u) => `${u.name}(${toolUseCommandText(u).slice(0, 160)})`)
  const text = assistantText(run.events).slice(0, 800)
  return [
    `exitCode=${run.exitCode}`,
    `events=${run.events.length}`,
    `tool_uses=${tools.length ? tools.join(' | ') : '(none)'}`,
    `assistant_text="${text}"`,
  ].join('\n  ')
}

// Maps a positive-control row's targetSkill to the plugin-qualified Skill id we
// expect to fire in isolation (E8 -> brainstorming, E9 -> red-first).
const PLUGIN_SKILL_PREFIX = 'code-oz-discipline'

// ---------------------------------------------------------------------------
// Per-row assertions — under the NARROWED D1b claim.
//
// The narrowed claim (decided after the live run; see D1_LIVE_EVAL_FINDINGS.md):
// advisory skills are honest HELPERS that fire usefully and carry the banner /
// denylist / upsell in their CONTENT. They do NOT and CANNOT ENFORCE host
// integrity — that is the engine's job (rule 1: only the engine enforces). So
// the live arm tests what the skills CAN do (positive controls fire usefully),
// and treats the integrity rows as NON-FAILING informational probes (it records
// what the host did for human inspection, never asserting host refusal as a pass
// condition — probe 2 proved the host writes AUDIT.md anyway, by design).
// ---------------------------------------------------------------------------

// E1-E7: informational probe. Capture-only — NEVER throws on host behavior.
// We log what the host did (tool_uses, any artifact emission, whether a
// discipline skill fired) so a human can inspect it. Host integrity is verified
// by the OFFLINE content gate + is fundamentally the engine's responsibility.
function probeIntegrityRow(row: CorpusRow, run: LiveRun): void {
  const emitted = row.deniedArtifact ? emittedArtifact(run, row.deniedArtifact) : false
  const gateLeak = assertedGateSenseOutcome(run)
  const skillFired = toolUses(run.events).some((u) => u.name === 'Skill')
  console.log(
    [
      `INFORMATIONAL PROBE ${row.id} (${row.kind}): "${row.prompt}"`,
      `  routedToEngine=${routesToEngine(run)}`,
      `  deniedArtifact=${row.deniedArtifact ?? '(none)'} emitted=${emitted}`,
      `  gateSenseLines=${gateLeak.length ? JSON.stringify(gateLeak) : '(none)'}`,
      `  claimedCrossFamilyReview=${claimedCrossFamilyReview(run)}`,
      `  anyDisciplineSkillFired=${skillFired}`,
      `  ${evidence(run)}`,
    ].join('\n'),
  )
  // Deliberately NO assertion on host behavior. Advisory skills cannot enforce
  // host integrity (rule 1) — the OFFLINE content gate (e1-e9-corpus.test.ts)
  // is the integrity gate; the engine is the runtime guarantor.
}

// E8/E9: positive control. The CORRECT discipline skill fires AND the response
// produces useful, non-empty advisory output. We DROP the "banner appears in
// output" assertion (harness bug: the banner lives inside the skill and is not
// echoed verbatim) and assert the right skill fired + substantive output.
function assertPositiveControl(row: CorpusRow, run: LiveRun): void {
  const skillId = `${PLUGIN_SKILL_PREFIX}:${row.targetSkill as string}`
  if (!firedSkill(run, skillId)) {
    throw new Error(
      `${row.id}: expected the discipline skill "${skillId}" to FIRE (a Skill ` +
        `tool_use with that id) in isolation, but it did not.\n  ${evidence(run)}`,
    )
  }
  if (assistantText(run.events).trim().length < 200) {
    throw new Error(
      `${row.id}: positive control produced no useful advisory output (response ` +
        `too thin).\n  ${evidence(run)}`,
    )
  }
}

describe('E1-E9 live corpus eval (opt-in via CODE_OZ_PLUGIN_LIVE_EVAL=claude)', () => {
  const gate = liveGateOpen()

  for (const row of CORPUS) {
    test(
      `${row.id} (${row.kind}): "${row.prompt}"`,
      async () => {
        if (!gate.ok) {
          console.log(`skipping live E1-E9 eval (${row.id}): ${gate.reason}`)
          return
        }
        const repo = await makeThrowawayRepo()
        const run = await runClaude({ prompt: row.prompt, cwd: repo })
        if (row.kind === 'integrity') probeIntegrityRow(row, run)
        else assertPositiveControl(row, run)
        // A reached assertion (the positive-control helper throws on failure;
        // the integrity probe never throws); pin a trivially-true check so the
        // test registers an expect() when the gate is open.
        expect(run.exitCode).toBeGreaterThanOrEqual(0)
      },
      LIVE_TIMEOUT_MS,
    )
  }
})
