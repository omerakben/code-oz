// `code-oz run` — start a fresh run and execute the DEFINE phase.
//
// v0.1 surface (M5):
//
//   code-oz run --request "build me X"
//     Inline turn-0 user input. Subsequent turns read from TTY stdin
//     (one line per turn). Non-TTY environments without --request-file
//     exit non-zero with actionable text.
//
//   code-oz run --request-file path.md
//     Comment-delimited transcript fixture. All user turns come from the
//     file. Useful for tests, CI, deterministic replays.
//
//   code-oz run
//     Pure TTY mode. Prompts for turn 0 and each subsequent turn.
//
// --request and --request-file are mutually exclusive. --provider is
// reserved for commit 9 (--provider fake runtime override).

import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { readEvents } from '../state/events.ts'
import { isKnownPhaseEvent } from '../state/schemas.ts'

import {
  bootstrap,
  buildProviderRegistry,
  type ProviderOverride,
} from '../cli/bootstrap.ts'
import { loadConfig } from '../config/load.ts'
import {
  initRun,
  loadRun,
  readActiveRun,
  runPathsFor,
} from '../state/run.ts'
import { generateUlid } from '../state/schemas.ts'
import { runDefine, type DefineResult } from '../phases/define.ts'
import { runPlan, type PlanResult } from '../phases/plan.ts'
import type { InvokeContext } from '../providers/invoke.ts'
import {
  applyFakeScript,
  FAKE_SCRIPT_ENV_VAR,
  FakeScriptError,
  loadFakeScript,
  type FakeScriptEntry,
} from '../providers/fake-script.ts'

// --- public CLI entrypoint -----------------------------------------

export async function runCommand(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args)
  if (parsed.kind === 'error') {
    process.stderr.write(`code-oz run: ${parsed.message}\n`)
    if (parsed.help) process.stderr.write(RUN_HELP + '\n')
    process.exit(2)
  }

  const cwd = process.cwd()
  // M12 (rule 20: role-to-provider routing). Load config BEFORE bootstrap
  // so `config.company` reaches the agent registry. Per Codex Risk #2 in
  // CODEX_RESPONSE_M12.md (thread 019de4bb): the prior order built the
  // registry first and the company:block arrived too late to affect
  // routing.
  const config = await loadConfig({ cwd })
  const ctx = await bootstrap({ cwd, config })

  if (!existsSync(ctx.paths.root)) {
    process.stderr.write(
      [
        `code-oz run: \`.code-oz/\` not found in ${cwd}.`,
        'Run `code-oz init` first to scaffold the project.',
        '',
      ].join('\n'),
    )
    process.exit(2)
  }

  // M16 C2 — pre-load the fake-replay script (gated in parseRunArgs).
  // Loaded once per `code-oz run` invocation so resumed runs (handleActiveRun
  // → dispatchPlan) and fresh runs (DEFINE below) apply the same entries.
  let fakeScriptEntries: readonly FakeScriptEntry[] | undefined
  if (parsed.fakeScriptPath !== undefined) {
    try {
      fakeScriptEntries = await loadFakeScript(parsed.fakeScriptPath)
    } catch (err) {
      if (err instanceof FakeScriptError) {
        process.stderr.write(`code-oz run: ${err.message}\n`)
        for (const issue of err.issues) {
          const where = issue.line > 0 ? `${err.path}:${issue.line}` : err.path
          process.stderr.write(
            `  ${where} ${issue.code} — ${issue.rule}${issue.detail ? ` (${issue.detail})` : ''}\n`,
          )
        }
        process.exit(2)
      }
      throw err
    }
  }

  const active = await readActiveRun(ctx.paths.activeRun)
  if (active !== null) {
    await handleActiveRun(
      ctx.paths.state,
      ctx.paths.artifacts,
      active,
      parsed.providerOverride,
      fakeScriptEntries,
    )
    return
  }

  const ba = ctx.registry.getByName('ba')
  if (ba === undefined) {
    process.stderr.write(
      [
        'code-oz run: BA persona (`ba`) is not registered.',
        'The bundled defaults must include `ba`; check src/agents/defaults/ba.md.',
        '',
      ].join('\n'),
    )
    process.exit(2)
  }

  // PREFLIGHT — every CLI/input check that can exit non-zero MUST run before
  // initRun creates state on disk. Per CODEX_REVIEW_M5 finding #3: a failed
  // preflight must NEVER leave an orphan active.json or per-run state dir.
  const inputSource = await buildInputSource(parsed.input)
  const initial =
    inputSource.initial === '__deferred__'
      ? await inputSource.readNext(0)
      : inputSource.initial
  if (initial === null || initial.trim().length === 0) {
    await inputSource.close()
    process.stderr.write('code-oz run: no initial user input provided.\n')
    process.exit(2)
  }

  const { registry: providerRegistry, fakeProvider } = buildProviderRegistry({
    providerOverride: parsed.providerOverride,
  })
  // M16 C2 — apply the fake-replay script (gated in parseRunArgs +
  // pre-loaded above). Applied BEFORE the --request-file BA scripting
  // so authored scripts can override transcript-derived expectations
  // (most-specific match wins; later registrations on the same matcher
  // queue FIFO behind earlier ones).
  if (fakeScriptEntries !== undefined && fakeProvider !== undefined) {
    applyFakeScript(fakeProvider, fakeScriptEntries)
  }
  // When both --provider fake and --request-file are set, pre-script BA
  // replies from the same fixture file so the runner replays deterministically.
  if (
    fakeProvider !== undefined &&
    parsed.input.kind === 'file'
  ) {
    const raw = await readFile(parsed.input.path, 'utf8')
    const baTurns = parseBaTurnsFromTranscript(raw)
    for (const reply of baTurns) {
      fakeProvider.expect({ phase: 'define', agent: 'ba' }).respondWith({
        content: reply,
      })
    }
  }

  // STATE MUTATION begins below. Anything before this point can still abort
  // safely — anything after must follow through to a clean exit.
  const runId = generateUlid()
  const runPaths = runPathsFor(ctx.paths.state, ctx.paths.artifacts, runId)
  await initRun({ paths: runPaths, profile: 'greenfield', runId })

  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }
  const askMeConfig = config.phases.define.askMe

  const result: DefineResult = await runDefine({
    invokeCtx,
    runPaths,
    runId,
    agent: ba,
    config: askMeConfig,
    initialUserInput: initial,
    readNextUserInput: inputSource.readNext,
    onPersonaReply: (turn, text) => {
      process.stdout.write(`\n--- ${ba.name} reply (turn ${turn}) ---\n${text}\n\n`)
    },
    fsyncDir: true,
  })

  await inputSource.close()

  if (result.status === 'complete') {
    process.stdout.write(result.userMessage + '\n')
    process.exit(0)
  } else {
    process.stderr.write(result.userMessage + '\n')
    process.exit(1)
  }
}

// --- helpers -------------------------------------------------------

interface InputSourceTTY {
  readonly kind: 'tty'
}
interface InputSourceInline {
  readonly kind: 'inline'
  readonly text: string
}
interface InputSourceFile {
  readonly kind: 'file'
  readonly path: string
}
type InputMode = InputSourceTTY | InputSourceInline | InputSourceFile

interface ParsedOk {
  readonly kind: 'ok'
  readonly input: InputMode
  readonly providerOverride?: ProviderOverride
  /** M16 C2 — path to a JSONL fake-replay fixture. Gated by both
   *  `providerOverride === 'fake'` and the FAKE_SCRIPT_ENV_VAR env var. */
  readonly fakeScriptPath?: string
}
interface ParsedError {
  readonly kind: 'error'
  readonly message: string
  readonly help: boolean
}

/**
 * Parse `code-oz run` CLI arguments. Test-only export — production
 * code paths consume this through runCommand. Tests inject `env` to
 * exercise the FAKE_SCRIPT_ENV_VAR gate without polluting the
 * runner's process.env.
 */
export function parseRunArgs(
  args: string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ParsedOk | ParsedError {
  let request: string | null = null
  let requestFile: string | null = null
  let providerOverride: ProviderOverride | undefined
  let fakeScriptPath: string | null = null
  let help = false

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--help' || a === '-h') {
      help = true
      continue
    }
    if (a === '--request') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--request requires a value', help: true }
      }
      request = value
      i++
      continue
    }
    if (a.startsWith('--request=')) {
      request = a.slice('--request='.length)
      continue
    }
    if (a === '--request-file') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--request-file requires a path', help: true }
      }
      requestFile = value
      i++
      continue
    }
    if (a.startsWith('--request-file=')) {
      requestFile = a.slice('--request-file='.length)
      continue
    }
    if (a === '--provider') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--provider requires a value', help: true }
      }
      const result = parseProviderOverride(value)
      if (result.kind === 'error') return result
      providerOverride = result.value
      i++
      continue
    }
    if (a.startsWith('--provider=')) {
      const value = a.slice('--provider='.length)
      const result = parseProviderOverride(value)
      if (result.kind === 'error') return result
      providerOverride = result.value
      continue
    }
    if (a === '--fake-script') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--fake-script requires a path', help: true }
      }
      fakeScriptPath = value
      i++
      continue
    }
    if (a.startsWith('--fake-script=')) {
      fakeScriptPath = a.slice('--fake-script='.length)
      continue
    }
    return { kind: 'error', message: `unknown argument: ${a}`, help: true }
  }

  if (help) {
    process.stdout.write(RUN_HELP + '\n')
    process.exit(0)
  }

  if (request !== null && requestFile !== null) {
    return {
      kind: 'error',
      message: '--request and --request-file are mutually exclusive',
      help: false,
    }
  }
  // M16 C2 — gate `--fake-script` behind both `--provider fake` AND the
  // env var `CODE_OZ_TEST_FAKE_SCRIPT_OK=1`. Two gates because:
  //   1. The script only makes sense when routing through the shared
  //      FakeProvider (with --provider fake).
  //   2. `--provider fake` IS a real production CLI flag; without the
  //      env var, a user could accidentally script fake artifacts onto
  //      a real project. The env-var gate makes "I know this is a test
  //      seam" explicit (Codex R0 Risk #9 — fake-provider contamination).
  if (fakeScriptPath !== null) {
    if (fakeScriptPath.length === 0) {
      return { kind: 'error', message: '--fake-script path must be non-empty', help: false }
    }
    if (providerOverride !== 'fake') {
      return {
        kind: 'error',
        message:
          '--fake-script requires --provider fake (the script applies expectations to the shared FakeProvider only)',
        help: false,
      }
    }
    const envValue = env[FAKE_SCRIPT_ENV_VAR]
    if (envValue !== '1' && envValue !== 'true') {
      return {
        kind: 'error',
        message: `--fake-script is a test-only seam; set ${FAKE_SCRIPT_ENV_VAR}=1 to enable`,
        help: false,
      }
    }
  }
  const base = (input: InputMode): ParsedOk => {
    const out: ParsedOk = { kind: 'ok', input }
    return Object.freeze({
      ...out,
      ...(providerOverride !== undefined ? { providerOverride } : {}),
      ...(fakeScriptPath !== null ? { fakeScriptPath } : {}),
    })
  }

  if (request !== null) {
    if (request.trim().length === 0) {
      return { kind: 'error', message: '--request must be non-empty', help: false }
    }
    return base({ kind: 'inline', text: request })
  }
  if (requestFile !== null) {
    return base({ kind: 'file', path: requestFile })
  }
  return base({ kind: 'tty' })
}

function parseProviderOverride(value: string): { kind: 'ok'; value: ProviderOverride } | ParsedError {
  if (value === 'fake') return { kind: 'ok', value: 'fake' }
  return {
    kind: 'error',
    message: `--provider only accepts 'fake' in v0.1 (got ${JSON.stringify(value)})`,
    help: false,
  }
}

interface InputSource {
  readonly initial: string
  readNext(turn: number): Promise<string | null>
  close(): Promise<void>
}

async function buildInputSource(mode: InputMode): Promise<InputSource> {
  switch (mode.kind) {
    case 'inline':
      return inlineSource(mode.text)
    case 'file':
      return fileSource(mode.path)
    case 'tty':
      return ttySource()
  }
}

function inlineSource(text: string): InputSource {
  if (input.isTTY) {
    const rl = readline.createInterface({ input, output, terminal: true })
    return {
      initial: text,
      readNext: (turn: number) => promptTty(rl, turn),
      close: async () => rl.close(),
    }
  }
  return {
    initial: text,
    readNext: async () => null,
    close: async () => undefined,
  }
}

async function fileSource(path: string): Promise<InputSource> {
  const exists = existsSync(path)
  if (!exists || !statSync(path).isFile()) {
    process.stderr.write(`code-oz run: --request-file path does not exist: ${path}\n`)
    process.exit(2)
  }
  const raw = await readFile(path, 'utf8')
  const turns = parseUserTurnsFromTranscript(raw)
  if (turns.length === 0) {
    process.stderr.write(
      `code-oz run: --request-file ${path} contains no <!-- turn:user --> blocks\n`,
    )
    process.exit(2)
  }
  let cursor = 1
  return {
    initial: turns[0]!,
    readNext: async () => {
      if (cursor >= turns.length) return null
      return turns[cursor++] ?? null
    },
    close: async () => undefined,
  }
}

function ttySource(): InputSource {
  if (!input.isTTY) {
    process.stderr.write(
      [
        'code-oz run: stdin is not a TTY. Provide --request "..." or --request-file path.md.',
        '',
      ].join('\n'),
    )
    process.exit(2)
  }
  const rl = readline.createInterface({ input, output, terminal: true })
  return {
    initial: '__deferred__',
    readNext: (turn: number) => promptTty(rl, turn),
    close: async () => rl.close(),
  } as InputSource
}

async function promptTty(
  rl: readline.Interface,
  turn: number,
): Promise<string | null> {
  const label = turn === 0 ? 'Describe what you want to build' : 'Your reply'
  const answer = await rl.question(`${label}: `)
  const trimmed = answer.trim()
  if (trimmed.length === 0) return null
  return trimmed
}

// --- transcript fixture parsing -----------------------------------

const USER_TURN_RE = /<!--\s*turn:user\s*-->([\s\S]*?)<!--\s*\/turn\s*-->/g
const BA_TURN_RE = /<!--\s*turn:ba\s*-->([\s\S]*?)<!--\s*\/turn\s*-->/g

/**
 * Extract user turns from a comment-delimited transcript fixture. Returns
 * the trimmed body of each <!-- turn:user --> ... <!-- /turn --> block in
 * file order. Other content (frontmatter, ba turn blocks, prose between
 * blocks) is ignored.
 */
export function parseUserTurnsFromTranscript(raw: string): readonly string[] {
  const turns: string[] = []
  for (const match of raw.matchAll(USER_TURN_RE)) {
    const body = (match[1] ?? '').trim()
    if (body.length > 0) turns.push(body)
  }
  return Object.freeze(turns)
}

/**
 * Extract BA persona replies from a comment-delimited transcript fixture.
 * Used by `--provider fake` + `--request-file` to pre-script FakeProvider
 * expectations so the runner replays the conversation deterministically.
 */
export function parseBaTurnsFromTranscript(raw: string): readonly string[] {
  const turns: string[] = []
  for (const match of raw.matchAll(BA_TURN_RE)) {
    const body = (match[1] ?? '').trim()
    if (body.length > 0) turns.push(body)
  }
  return Object.freeze(turns)
}

// --- active-run handling (Codex disagreement #6) ------------------

async function handleActiveRun(
  stateDir: string,
  artifactRoot: string,
  activeRunId: string,
  providerOverride?: ProviderOverride,
  fakeScriptEntries?: readonly FakeScriptEntry[],
): Promise<void> {
  const runPaths = runPathsFor(stateDir, artifactRoot, activeRunId)

  const loaded = await loadRun(runPaths).catch(() => null)
  if (loaded === null) {
    process.stderr.write(
      [
        `code-oz run: an active run pointer exists (${activeRunId}) but the run state cannot be loaded.`,
        'Inspect `.code-oz/state/runs/<runId>/` and either delete `state/active.json` to start fresh, or restore the run state.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  const phase = loaded.state.currentPhase

  // Per CODEX_REVIEW_M5 finding #2: do NOT use bare SPEC.md existence as
  // the "awaiting approval" signal. The canonical artifact at
  // <artifactRoot>/SPEC.md is shared across runs, so a leftover SPEC.md from
  // a prior run would falsely advertise the current run as approval-ready.
  // The current run's `gate_required` event for the same phase IS the signal.
  const events = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  }).catch(() => [])
  const gateRequiredForPhase = events.some((e) => {
    if (!isKnownPhaseEvent(e)) return false
    if (e.type !== 'gate_required') return false
    return e.phase === phase
  })

  if (phase === 'define') {
    if (gateRequiredForPhase) {
      process.stderr.write(
        [
          'code-oz run: an active run is awaiting DEFINE approval.',
          '  Review .code-oz/artifacts/SPEC.md and run `code-oz approve define`.',
          '',
        ].join('\n'),
      )
      process.exit(1)
    }
    process.stderr.write(
      [
        `code-oz run: an active DEFINE run is in progress (${activeRunId}) without a gate_required event.`,
        '  Mid-DEFINE resume is not implemented in v0.1.',
        `  To start over, manually delete .code-oz/state/active.json and .code-oz/state/runs/${activeRunId}/.`,
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  if (gateRequiredForPhase) {
    process.stderr.write(
      [
        `code-oz run: an active run is awaiting ${phase} approval (${activeRunId}).`,
        `  Use \`code-oz approve ${phase}\` after reviewing the artifact.`,
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  // Phase advanced past DEFINE: dispatch to the right runner.
  if (phase === 'plan') {
    await dispatchPlan(stateDir, artifactRoot, activeRunId, providerOverride, fakeScriptEntries)
    return
  }

  process.stderr.write(
    [
      `code-oz run: an active run is in progress at phase ${phase} (${activeRunId}).`,
      '  Wait for the in-progress phase to complete, or inspect .code-oz/state/runs/.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

async function dispatchPlan(
  stateDir: string,
  artifactRoot: string,
  activeRunId: string,
  providerOverride?: ProviderOverride,
  fakeScriptEntries?: readonly FakeScriptEntry[],
): Promise<void> {
  const cwd = process.cwd()
  // M12: same flip as runCommand. Load config BEFORE bootstrap so the
  // resumed PLAN dispatch sees company:block routing on the registry.
  // Per Codex Risk #2 in CODEX_RESPONSE_M12.md (thread 019de4bb).
  const config = await loadConfig({ cwd })
  const ctx = await bootstrap({ cwd, config })
  const lead = ctx.registry.getByName('lead')
  const scientist = ctx.registry.getByName('scientist')
  if (lead === undefined || scientist === undefined) {
    process.stderr.write(
      [
        'code-oz run: PLAN requires the bundled `lead` and `scientist` personas.',
        '  Reinitialize the project (`code-oz init --force`) or restore .code-oz/agents/.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  // Carry --provider fake (or other override) through DEFINE -> approve -> PLAN.
  // Per Codex M6 review block-next-milestone #7.
  const { registry: providerRegistry, fakeProvider } = buildProviderRegistry({ providerOverride })
  // M16 C2 — apply the fake-replay script entries on resumed dispatches
  // too, so the same scripted responses cover DEFINE → PLAN → BUILD → ...
  // across spawned-process boundaries (each `code-oz run` invocation
  // re-loads the script from disk and registers its expectations).
  if (fakeScriptEntries !== undefined && fakeProvider !== undefined) {
    applyFakeScript(fakeProvider, fakeScriptEntries)
  }
  const runPaths = runPathsFor(stateDir, artifactRoot, activeRunId)
  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }
  const result: PlanResult = await runPlan({
    invokeCtx,
    runPaths,
    runId: activeRunId,
    leadAgent: lead,
    scientistAgent: scientist,
  })
  if (result.status === 'intervention') {
    process.stderr.write(
      [
        `code-oz run: PLAN paused (${result.code}).`,
        `  ${result.rule}`,
        '  Inspect .code-oz/state/runs/<runId>/ and the listed draft files, then resolve.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  process.stdout.write(
    [
      'PLAN phase complete. Review:',
      `  ${result.planPath}`,
      `  ${result.sourceCheckPath}`,
      `  ${result.hypothesesPath}`,
      `  ${result.openQuestionsPath}`,
      'Then run: code-oz approve plan',
      '',
    ].join('\n'),
  )
}

const RUN_HELP = `
Usage: code-oz run [options]

Options:
  --request "<text>"       Use <text> as the initial user request (turn 0).
  --request-file <path>    Read user turns from a comment-delimited transcript fixture.
                           File must contain <!-- turn:user -->...<!-- /turn --> blocks.
  --provider <id>          Runtime provider override. v0.1 accepts only 'fake':
                           every ProviderId routes to a single shared FakeProvider
                           instance. Useful for offline tests and CI replays.
  --fake-script <path>     Test-only: load a JSONL fake-replay fixture and pre-script
                           FakeProvider expectations across the full DEFINE→REVIEW
                           cycle. Each line: {"matcher": {phase, agent}, "response": {content}}.
                           Requires --provider fake AND CODE_OZ_TEST_FAKE_SCRIPT_OK=1.
                           See src/providers/fake-script.ts for the loader contract.
  -h, --help               Show this help.

--request and --request-file are mutually exclusive.

Without flags, code-oz run reads turn 0 (and each subsequent turn) from a TTY.
Non-TTY environments must use --request or --request-file.
`.trim()
