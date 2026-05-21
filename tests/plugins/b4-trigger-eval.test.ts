// C5b — LIVE arm of the B4 acceptance harness (D1a behavioral proof).
//
// This is the ONLY test surface in the project that invokes real `claude -p`
// sessions. Those calls are billable and non-deterministic, so every test here
// is OPT-IN and SKIPPED BY DEFAULT (project rule 3: the normal `bun test` suite
// stays offline / free / deterministic).
//
// Gating (mirrors tests/providers-xai-live.test.ts's early-return-skip idiom):
//   - CODE_OZ_PLUGIN_LIVE_EVAL must equal "claude"   (dedicated flag, NOT the
//     provider flag CODE_OZ_LIVE_PROVIDER_TESTS — these are different surfaces).
//   - `claude` must be on PATH.
// When either is missing, each test logs a clear skip message and returns
// without making any network/billable call or asserting anything.
//
// To run locally (opt-in):
//   CODE_OZ_PLUGIN_LIVE_EVAL=claude bun test tests/plugins/b4-trigger-eval.test.ts
//
// The offline arm (tests/plugins/b4-acceptance.test.ts) is the CI-enforced gate.
// This file is the on-demand behavioral proof that the router card actually
// causes engine-routing in a real host agent, and that explicit commands
// resolve through the wrapper. See plugins/code-oz/EVAL.md.
//
// macOS note: BSD mktemp ignores TMPDIR, so we capture mkdtemp output directly
// (matching tests/plugins/b4-acceptance.test.ts + bootstrap-resolver.test.ts).

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()

// Absolute path to the plugin under test. `claude --plugin-dir` wants an
// absolute path so the SessionStart hook can locate router-card.md regardless
// of the (throwaway) cwd we run in.
const PLUGIN_DIR = join(REPO_ROOT, 'plugins/code-oz')

// Live calls can take a while (a host agent may do several turns + tool use).
const LIVE_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// Gate: opt-in flag + claude on PATH. Returns a reason string when closed so
// each test can log exactly why it skipped (never fails on a default run).
// ---------------------------------------------------------------------------
function liveGateOpen():
  | { ok: true }
  | { ok: false; reason: string } {
  const flag = (process.env.CODE_OZ_PLUGIN_LIVE_EVAL ?? '').trim()
  if (flag !== 'claude') {
    return {
      ok: false,
      reason:
        'CODE_OZ_PLUGIN_LIVE_EVAL is not "claude" (set it to opt in to the billable live B4 eval)',
    }
  }
  if (!claudeOnPath()) {
    return {
      ok: false,
      reason: '`claude` is not on PATH; cannot run the live B4 eval',
    }
  }
  return { ok: true }
}

function claudeOnPath(): boolean {
  const probe = Bun.spawnSync({
    cmd: ['command', '-v', 'claude'],
    // `command` is a shell builtin; spawn through sh so it resolves.
    // Fall back to a direct `which` if the builtin path fails.
    stdout: 'ignore',
    stderr: 'ignore',
  })
  if (probe.exitCode === 0) return true
  const which = Bun.spawnSync({ cmd: ['which', 'claude'], stdout: 'ignore', stderr: 'ignore' })
  return which.exitCode === 0
}

// ---------------------------------------------------------------------------
// Throwaway git repo so the live agent's filesystem actions never touch the
// real repo. Isolation is real: a fresh mkdtemp dir, `git init`, and the agent
// runs with that dir as cwd. We tear it down in afterEach.
// ---------------------------------------------------------------------------
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function makeThrowawayRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'code-oz-b4-live-'))
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
  // A trivial tracked file so the repo looks like a real (greenfield) project,
  // not an empty dir the agent might balk at.
  await writeFile(join(dir, 'README.md'), '# throwaway b4-live fixture\n', 'utf8')
  return dir
}

// ---------------------------------------------------------------------------
// Run a single `claude -p` session against the plugin in an isolated dir and
// return the parsed stream-json events plus the raw text (for failure messages).
//
// --dangerously-skip-permissions is used ONLY because this runs in a throwaway
// git repo for harness isolation — it is NOT the product's proof path. The
// product path is the user confirming `code-oz run` interactively; this flag
// just keeps the eval non-interactive inside the sandbox.
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

async function runClaude(opts: {
  prompt: string
  cwd: string
  maxTurns?: number
}): Promise<LiveRun> {
  const { prompt, cwd, maxTurns = 6 } = opts
  const proc = Bun.spawn({
    cmd: [
      'claude',
      '-p',
      prompt,
      '--plugin-dir',
      PLUGIN_DIR,
      // Harness isolation only — see comment above.
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

// Structured parse: split into lines and JSON.parse each. We do NOT grep the
// raw text for pass/fail — every assertion reads parsed event fields.
function parseStreamJson(raw: string): StreamEvent[] {
  const events: StreamEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      events.push(JSON.parse(trimmed) as StreamEvent)
    } catch {
      // Non-JSON lines (rare; e.g. a stray log line) are ignored — we only
      // ever assert over successfully parsed structured events.
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Structured extractors over parsed events.
// ---------------------------------------------------------------------------

// All assistant text blocks, concatenated. Reads message.content[].text from
// assistant events — structured field access, not a raw-text grep.
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

// Every tool_use block across assistant events, as {name, input}.
function toolUses(
  events: ReadonlyArray<StreamEvent>,
): Array<{ name: string; input: Record<string, unknown> }> {
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

// Concatenate all string values inside a tool_use input (e.g. Bash `command`)
// so we can structurally check what command the agent proposed/ran.
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

// Does any signal — assistant text OR a tool_use command — reference the
// engine-routing surface? This is the robust-but-meaningful B4 routing claim:
// the router card caused the host to point at `code-oz run` / `/code-oz-run` /
// the resolver, rather than just hand-coding the change itself.
function referencesEngineRouting(events: ReadonlyArray<StreamEvent>): boolean {
  const text = assistantText(events).toLowerCase()
  const textHit =
    text.includes('/code-oz-run') ||
    text.includes('code-oz run') ||
    text.includes('code-oz-run')
  if (textHit) return true
  for (const use of toolUses(events)) {
    const cmd = toolUseCommandText(use).toLowerCase()
    if (
      cmd.includes('code-oz run') ||
      cmd.includes('resolve-code-oz.sh run') ||
      cmd.includes('/code-oz-run')
    ) {
      return true
    }
  }
  return false
}

// Did the agent execute the doctor path? Either via the resolver wrapper
// (resolve-code-oz.sh doctor) or a direct `code-oz doctor` invocation, in a
// Bash tool_use. Structured: reads tool_use name + reconstructed command text.
function ranDoctorPath(events: ReadonlyArray<StreamEvent>): boolean {
  for (const use of toolUses(events)) {
    if (use.name !== 'Bash') continue
    const cmd = toolUseCommandText(use).toLowerCase()
    if (cmd.includes('resolve-code-oz.sh') && cmd.includes('doctor')) return true
    if (cmd.includes('code-oz doctor')) return true
  }
  return false
}

// A compact, human-readable digest of what the model did, for failure messages.
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

describe('B4 live trigger eval (opt-in via CODE_OZ_PLUGIN_LIVE_EVAL=claude)', () => {
  const gate = liveGateOpen()

  // -------------------------------------------------------------------------
  // Test 1 — naive-trigger eval (core B4 routing claim).
  // A naive, production-bound task should make the host agent ROUTE to the
  // engine (propose `code-oz run` / reference /code-oz-run / invoke the
  // resolver) rather than hand-coding the change itself.
  // -------------------------------------------------------------------------
  test(
    'naive production-bound prompt routes to the code-oz engine',
    async () => {
      if (!gate.ok) {
        console.log(`skipping live B4 eval (test 1): ${gate.reason}`)
        return
      }
      const repo = await makeThrowawayRepo()
      const run = await runClaude({
        prompt: 'Add a rate-limiter to our production API and ship it.',
        cwd: repo,
      })
      if (!referencesEngineRouting(run.events)) {
        throw new Error(
          'Expected the host agent to ROUTE to the code-oz engine (propose ' +
            '`code-oz run` / `/code-oz-run` / the resolver) for a production-bound ' +
            'task, but found no engine-routing signal.\n  ' +
            evidence(run),
        )
      }
      expect(referencesEngineRouting(run.events)).toBe(true)
    },
    LIVE_TIMEOUT_MS,
  )

  // -------------------------------------------------------------------------
  // Test 2 — explicit-request eval (B7).
  // `/code-oz-doctor` should resolve to the doctor command path: the agent
  // runs resolve-code-oz.sh doctor (or `code-oz doctor`) via Bash.
  // -------------------------------------------------------------------------
  test(
    'explicit /code-oz-doctor resolves and runs the doctor command path',
    async () => {
      if (!gate.ok) {
        console.log(`skipping live B4 eval (test 2): ${gate.reason}`)
        return
      }
      const repo = await makeThrowawayRepo()
      const run = await runClaude({
        prompt: '/code-oz-doctor',
        cwd: repo,
      })
      if (!ranDoctorPath(run.events)) {
        throw new Error(
          'Expected `/code-oz-doctor` to resolve and run the doctor command ' +
            'path (resolve-code-oz.sh doctor or `code-oz doctor` via Bash), but ' +
            'no such tool_use was found.\n  ' +
            evidence(run),
        )
      }
      expect(ranDoctorPath(run.events)).toBe(true)
    },
    LIVE_TIMEOUT_MS,
  )

  // -------------------------------------------------------------------------
  // Test 3 — negative routing.
  // A throwaway / read-only question should NOT route to `code-oz run`
  // (router card: throwaway / questions / read-only -> do not route).
  // -------------------------------------------------------------------------
  test(
    'throwaway read-only question does NOT route to the engine',
    async () => {
      if (!gate.ok) {
        console.log(`skipping live B4 eval (test 3): ${gate.reason}`)
        return
      }
      const repo = await makeThrowawayRepo()
      const run = await runClaude({
        prompt: 'What does this regex do: /foo/ ? Just explain it, do not change anything.',
        cwd: repo,
        maxTurns: 3,
      })
      if (referencesEngineRouting(run.events)) {
        throw new Error(
          'Expected a read-only question NOT to route to the code-oz engine, ' +
            'but found an engine-routing signal (false-positive routing).\n  ' +
            evidence(run),
        )
      }
      expect(referencesEngineRouting(run.events)).toBe(false)
    },
    LIVE_TIMEOUT_MS,
  )
})
