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

import { appendEvent, readEvents } from '../state/events.ts'
import { isKnownPhaseEvent } from '../state/schemas.ts'

import {
  bootstrap,
  buildProviderRegistry,
  type ProviderOverride,
} from '../cli/bootstrap.ts'
import { canonicalRoleFromAgent } from '../agents/role.ts'
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
import { runBuild, type BuildResult, type WorktreeBinding } from '../phases/build.ts'
import { runVerify, type VerifyResult } from '../phases/verify.ts'
import { scheduleAttemptNPlus1 } from '../phases/schedule-attempt.ts'
import { deriveNextAttempt } from '../phases/restart-policy.ts'
import { TASK_ID_PATTERN, type PlanArtifact } from '../artifacts/plan.ts'
import { projectTaskCursor } from '../state/task-cursor.ts'
import { loadOrCreateRunWorktree } from '../worktree/load-or-create-run-worktree.ts'
import {
  EXIT_INTERVENTION,
  EXIT_OK,
  EXIT_USAGE,
} from '../cli/exit-codes.ts'
import {
  productionInvokePersona,
  productionRevertSeam,
  productionRunner,
} from '../cli/production-seams.ts'
import type { InvokeContext } from '../providers/invoke.ts'
import {
  applyFakeScript,
  FAKE_SCRIPT_ENV_VAR,
  FakeScriptError,
  loadFakeScript,
  type FakeScriptEntry,
} from '../providers/fake-script.ts'
import {
  detectOpenBuildStarted,
  formatInterventionRefusal,
  loadPlanArtifact,
  resolveBuildCarryForward,
  tryReadNeedsInterventionGate,
} from './dispatch-build-helpers.ts'
import {
  findLatestVerifyCompleted,
  hasGateRequired,
  resolveVerifyArtifacts,
  shouldRouteToBuildRestart,
} from './dispatch-verify-helpers.ts'

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
      parsed.taskOverride,
    )
    return
  }

  // --task only makes sense once a run is active and BUILD is the next
  // dispatched phase. Reject the flag pre-init so operators get a clear
  // message instead of a silent no-op when starting a fresh run.
  if (parsed.taskOverride !== undefined) {
    process.stderr.write(
      `code-oz run: --task ${parsed.taskOverride} requires an active run at the BUILD phase. Start a run with \`code-oz run\` first, then use --task on the BUILD invocation.\n`,
    )
    process.exit(EXIT_USAGE)
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
  /** M16 C6 — explicit task override for `dispatchBuild`. Validated
   *  against PLAN.md's TASK_ID_PATTERN at parse time; the dispatcher
   *  rejects with EXIT_USAGE if the id is not present in PLAN.md. */
  readonly taskOverride?: string
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
  let taskOverride: string | null = null
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
    if (a === '--task') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--task requires a T-NNN id', help: true }
      }
      taskOverride = value
      i++
      continue
    }
    if (a.startsWith('--task=')) {
      taskOverride = a.slice('--task='.length)
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
  // M16 C6 — validate --task at parse time so the failure is uniform
  // and the dispatcher receives a value matching PLAN.md's id grammar.
  if (taskOverride !== null) {
    if (!TASK_ID_PATTERN.test(taskOverride)) {
      return {
        kind: 'error',
        message: `--task must be a PLAN task id matching ${TASK_ID_PATTERN.source} (got ${JSON.stringify(taskOverride)})`,
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
      ...(taskOverride !== null ? { taskOverride } : {}),
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
  taskOverride?: string,
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
    if (taskOverride !== undefined) {
      process.stderr.write(
        `code-oz run: --task ${taskOverride} only applies to the BUILD phase (current phase: plan).\n`,
      )
      process.exit(EXIT_USAGE)
    }
    await dispatchPlan(stateDir, artifactRoot, activeRunId, providerOverride, fakeScriptEntries)
    return
  }
  if (phase === 'build') {
    const result = await dispatchBuild({
      stateDir,
      artifactRoot,
      runId: activeRunId,
      providerOverride,
      fakeScriptEntries,
      taskOverride,
    })
    if (result.stdout !== undefined && result.stdout.length > 0) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr !== undefined && result.stderr.length > 0) {
      process.stderr.write(result.stderr)
    }
    process.exit(result.exitCode)
  }
  if (phase === 'verify') {
    if (taskOverride !== undefined) {
      process.stderr.write(
        `code-oz run: --task ${taskOverride} only applies to the BUILD phase (current phase: verify).\n`,
      )
      process.exit(EXIT_USAGE)
    }
    // Codex M16 C7 Mod #2 — verify_restart_initiated does not change
    // currentPhase via the reducer. When the BUILD/VERIFY restart loop
    // is mid-step (latest restart signal = 'restart' for the cursor's
    // pending task), route back to dispatchBuild for attempt N+1
    // instead of looping into dispatchVerify.
    let plan: PlanArtifact | null = null
    try {
      plan = await loadPlanArtifact(artifactRoot)
    } catch {
      // dispatchVerify will surface the parse error with operator
      // guidance; stay on the verify path.
    }
    if (plan !== null && shouldRouteToBuildRestart(events, plan, activeRunId)) {
      const result = await dispatchBuild({
        stateDir,
        artifactRoot,
        runId: activeRunId,
        providerOverride,
        fakeScriptEntries,
      })
      if (result.stdout !== undefined && result.stdout.length > 0) {
        process.stdout.write(result.stdout)
      }
      if (result.stderr !== undefined && result.stderr.length > 0) {
        process.stderr.write(result.stderr)
      }
      process.exit(result.exitCode)
    }
    const result = await dispatchVerify({
      stateDir,
      artifactRoot,
      runId: activeRunId,
      providerOverride,
      fakeScriptEntries,
    })
    if (result.stdout !== undefined && result.stdout.length > 0) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr !== undefined && result.stderr.length > 0) {
      process.stderr.write(result.stderr)
    }
    process.exit(result.exitCode)
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

// --- BUILD dispatch (M16 C6) --------------------------------------

export interface DispatchBuildOptions {
  readonly stateDir: string
  readonly artifactRoot: string
  readonly runId: string
  readonly providerOverride?: ProviderOverride
  readonly fakeScriptEntries?: readonly FakeScriptEntry[]
  readonly taskOverride?: string
  readonly cwd?: string
  readonly now?: () => string
}

export interface DispatchResult {
  readonly exitCode: 0 | 1 | 2
  readonly stdout?: string
  readonly stderr?: string
}

/**
 * Production CLI dispatch for the BUILD phase. Mirrors `dispatchPlan`'s
 * shape (lines 598-669) but returns a structured result so tests can
 * assert against exit codes + stdout/stderr without spawning. The
 * `handleActiveRun` caller routes the result onto `process.exit` +
 * stdout/stderr writes.
 *
 * Codex M16 C6 pre-design review pinned the following invariants
 * (`docs/design/SESSION_M16_C6_C13_LOOP_PLAN.md` § C6 + the inline
 * brief sent before implementation):
 *
 *   1. NEEDS_INTERVENTION refusal happens BEFORE bootstrap and persona
 *      lookup so an unresolved run does not consume provider quota.
 *   2. Attempt counter via `deriveNextAttempt` (max + 1, scoped to
 *      runId+taskId), never raw count of build_completed events.
 *   3. Open `build_started` without a terminal pair → refuse.
 *   4. Carry-forward resolver gates attempt > 1: drift on missing
 *      restart signal, awaiting-approve when build_completed exists
 *      without a restart signal, present when verify_restart_initiated
 *      + parseable VERIFY.md align.
 *   5. `task_started` emitted EXACTLY once per task (attempt 1 only).
 *   6. Worktree wrapper result mapped explicitly onto `WorktreeBinding`
 *      with `dirtyAtBase: false` (clean-base policy guarantees it).
 *   7. `currentPhase === 'build'` with a prior `build_completed` and no
 *      restart signal → operator runs `code-oz approve build`; never
 *      silently produces attempt N+1.
 *   8. `role` field on the persona request comes from
 *      `canonicalRoleFromAgent(builder)`.
 */
export async function dispatchBuild(
  opts: DispatchBuildOptions,
): Promise<DispatchResult> {
  const cwd = opts.cwd ?? process.cwd()
  const now = opts.now ?? (() => new Date().toISOString())
  const runPaths = runPathsFor(opts.stateDir, opts.artifactRoot, opts.runId)

  // 1. NEEDS_INTERVENTION refusal at the very top — before any config
  //    or persona lookup. Codex Mod #3.
  const intervention = await tryReadNeedsInterventionGate(runPaths)
  if (intervention !== null) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: formatInterventionRefusal(intervention, opts.runId),
    })
  }

  const config = await loadConfig({ cwd })
  const ctx = await bootstrap({ cwd, config })
  const builder = ctx.registry.getByName('builder')
  const scientist = ctx.registry.getByName('scientist')
  if (builder === undefined || scientist === undefined) {
    return Object.freeze({
      exitCode: EXIT_USAGE as 2,
      stderr:
        'code-oz run: BUILD requires the bundled `builder` and `scientist` personas.\n  Reinitialize the project (`code-oz init --force`) or restore .code-oz/agents/.\n',
    })
  }

  // Read events + parse PLAN.md.
  const events = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  })
  let plan
  try {
    plan = await loadPlanArtifact(runPaths.artifactRoot)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: BUILD requires PLAN.md but the file could not be loaded.\n  ${detail}\n`,
    })
  }

  // Resolve task: --task override OR cursor.pending.
  const cursorResult = projectTaskCursor(plan, events)
  let taskId: string
  let taskIndex: number
  if (opts.taskOverride !== undefined) {
    const entry = cursorResult.cursor.entries.find(
      (e) => e.taskId === opts.taskOverride,
    )
    if (entry === undefined) {
      const available = cursorResult.cursor.entries
        .map((e) => e.taskId)
        .join(', ')
      return Object.freeze({
        exitCode: EXIT_USAGE as 2,
        stderr: `code-oz run: --task ${opts.taskOverride} not found in PLAN.md.\n  Tasks: ${available || '(none parsed)'}\n`,
      })
    }
    if (entry.status === 'completed') {
      return Object.freeze({
        exitCode: EXIT_USAGE as 2,
        stderr: `code-oz run: --task ${opts.taskOverride} is already completed; pick a pending task.\n`,
      })
    }
    taskId = entry.taskId
    taskIndex = entry.taskIndex
  } else {
    if (cursorResult.cursor.pending === null) {
      return Object.freeze({
        exitCode: EXIT_USAGE as 2,
        stderr:
          'code-oz run: PLAN.md has no pending tasks; the run should have advanced past BUILD.\n  Inspect .code-oz/state/runs/<runId>/ for state drift.\n',
      })
    }
    taskId = cursorResult.cursor.pending.taskId
    taskIndex = cursorResult.cursor.pending.taskIndex
  }

  // Derive next attempt (Codex Mod #1 — max + 1, not raw count).
  const attempt = deriveNextAttempt({
    events,
    runId: opts.runId,
    taskId,
  })

  // Detect open build_started without a terminal pair (Codex Mod #1
  // continuation — half-finished crash).
  const openInFlight = detectOpenBuildStarted(events, opts.runId, taskId)
  if (openInFlight !== null) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: BUILD attempt ${openInFlight.attempt} for ${taskId} has an open build_started without a build_completed/build_failed pair.\n  A prior process likely crashed mid-attempt.\n  Inspect .code-oz/state/runs/${opts.runId}/events.jsonl and resolve the partial state before re-running.\n`,
    })
  }

  // Carry-forward resolver (Codex Mod #4 + #7).
  const cfResult = await resolveBuildCarryForward({
    events,
    runId: opts.runId,
    taskId,
    attempt,
    artifactRoot: opts.artifactRoot,
  })
  if (cfResult.kind === 'awaiting-approve') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: BUILD attempt ${cfResult.priorAttempt} for ${taskId} completed but no approval / restart signal was found.\n  Run \`code-oz approve build\` after reviewing BUILD_REPORT.md, or inspect .code-oz/state/runs/${opts.runId}/ for drift.\n`,
    })
  }
  if (cfResult.kind === 'drift') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: BUILD restart drift — ${cfResult.reason}.\n  Inspect .code-oz/state/runs/${opts.runId}/ before retrying.\n`,
    })
  }

  // Worktree (idempotent on existing dir per C4).
  const worktreeResult = await loadOrCreateRunWorktree({
    cwd,
    runId: opts.runId,
    runPaths,
    phase: 'build',
    agent: builder.name,
  })
  if (worktreeResult.status === 'intervention') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: BUILD worktree setup failed (${worktreeResult.code}).\n  ${worktreeResult.rule}${worktreeResult.detail !== undefined ? `\n  ${worktreeResult.detail}` : ''}\n`,
    })
  }
  // Codex Mod #6 — explicit WorktreeBinding mapping. clean-base policy
  // (the wrapper's default) guarantees `dirtyAtBase: false`.
  const worktree: WorktreeBinding = Object.freeze({
    worktreePath: worktreeResult.worktreePath,
    baseCommitSha: worktreeResult.baseCommitSha,
    dirtyAtBase: false,
  })

  // Provider registry + fake-script application.
  const { registry: providerRegistry, fakeProvider } = buildProviderRegistry({
    providerOverride: opts.providerOverride,
  })
  if (opts.fakeScriptEntries !== undefined && fakeProvider !== undefined) {
    applyFakeScript(fakeProvider, opts.fakeScriptEntries)
  }

  // Emit task_started exactly once per task — attempt 1 only (Codex
  // Mod #5 + schema comment at src/state/schemas.ts:251).
  if (attempt === 1) {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_started',
        ts: now(),
        runId: opts.runId,
        taskId,
        taskIndex,
      },
    )
  }

  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }

  // Codex Mod #8 — canonicalRoleFromAgent for the role field.
  const role = canonicalRoleFromAgent(builder)
  const invokePersona = productionInvokePersona(invokeCtx, builder, {
    phase: 'build',
    runId: opts.runId,
    ...(role !== undefined ? { role } : {}),
  })

  const result: BuildResult = await runBuild({
    runPaths,
    runId: opts.runId,
    cwd,
    builderAgent: builder,
    scientistAgent: scientist,
    taskId,
    worktree,
    invokeCtx,
    invokePersona,
    attempt,
    ...(cfResult.kind === 'present' ? { carryForward: cfResult.cf } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  if (result.status === 'complete') {
    return Object.freeze({
      exitCode: EXIT_OK as 0,
      stdout: [
        `BUILD phase complete (attempt ${attempt}, task ${taskId}).`,
        `  Review: ${result.buildReportPath}`,
        `  Patch: ${result.patchPath}`,
        '  Then run: code-oz approve build',
        '',
      ].join('\n'),
    })
  }
  return Object.freeze({
    exitCode: EXIT_INTERVENTION as 1,
    stderr: [
      `code-oz run: BUILD paused (${result.code}).`,
      `  ${result.rule}`,
      ...(result.draftPath !== undefined ? [`  Draft: ${result.draftPath}`] : []),
      '  Inspect .code-oz/state/runs/<runId>/ and resolve before re-running.',
      '',
    ].join('\n'),
  })
}

// --- VERIFY dispatch (M16 C7) -------------------------------------

export interface DispatchVerifyOptions {
  readonly stateDir: string
  readonly artifactRoot: string
  readonly runId: string
  readonly providerOverride?: ProviderOverride
  readonly fakeScriptEntries?: readonly FakeScriptEntry[]
  readonly cwd?: string
  readonly now?: () => string
}

/**
 * Production CLI dispatch for the VERIFY phase. Mirrors `dispatchBuild`
 * but operates on the just-completed BUILD attempt N (no attempt
 * derivation; the attempt comes from the latest `build_completed`
 * event for the cursor's pending task).
 *
 * Codex M16 C7 pre-design review pinned the following invariants:
 *
 *   1. `runVerify` does NOT emit `verify_restart_initiated`. The
 *      finalization (worktree removal + worktree_destroyed +
 *      verify_restart_initiated) is `scheduleAttemptNPlus1`'s job.
 *      dispatchVerify calls it on `result.status === 'failed'`.
 *   2. After a VERIFY-fail, currentPhase stays at `verify`. The
 *      handleActiveRun pre-route to `dispatchBuild` (when
 *      `shouldRouteToBuildRestart` is true) closes the loop.
 *   3. preApproveBuildHook validates BUILD artifact shas at approve
 *      time, but operator hand-edits between approve-build and
 *      run-verify would silently run with edited bytes.
 *      `resolveVerifyArtifacts` re-validates BUILD_REPORT.md /
 *      patch / prompt shas before invoking runVerify.
 *   4. Missing patch / prompt / build_completed → drift refusal,
 *      not reconstruction.
 *   5. `--task` is BUILD-only — handleActiveRun rejects it for
 *      VERIFY before dispatch.
 *   6. `verify_completed` exists but `gate_required(verify)` does
 *      not is the crash-window state; refuse as drift rather than
 *      re-running runVerify.
 */
export async function dispatchVerify(
  opts: DispatchVerifyOptions,
): Promise<DispatchResult> {
  const cwd = opts.cwd ?? process.cwd()
  const runPaths = runPathsFor(opts.stateDir, opts.artifactRoot, opts.runId)

  // 1. NEEDS_INTERVENTION refusal.
  const intervention = await tryReadNeedsInterventionGate(runPaths)
  if (intervention !== null) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: formatInterventionRefusal(intervention, opts.runId),
    })
  }

  const config = await loadConfig({ cwd })
  const ctx = await bootstrap({ cwd, config })
  const verifier = ctx.registry.getByName('verifier')
  const scientist = ctx.registry.getByName('scientist')
  if (verifier === undefined || scientist === undefined) {
    return Object.freeze({
      exitCode: EXIT_USAGE as 2,
      stderr:
        'code-oz run: VERIFY requires the bundled `verifier` and `scientist` personas.\n  Reinitialize the project (`code-oz init --force`) or restore .code-oz/agents/.\n',
    })
  }

  const events = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  })
  let plan: PlanArtifact
  try {
    plan = await loadPlanArtifact(runPaths.artifactRoot)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: VERIFY requires PLAN.md but the file could not be loaded.\n  ${detail}\n`,
    })
  }

  // Resolve task: VERIFY uses the cursor's pending task; --task is
  // BUILD-only and was rejected upstream by handleActiveRun.
  const cursorResult = projectTaskCursor(plan, events)
  if (cursorResult.cursor.pending === null) {
    return Object.freeze({
      exitCode: EXIT_USAGE as 2,
      stderr:
        'code-oz run: PLAN.md has no pending tasks; the run should have advanced past VERIFY.\n  Inspect .code-oz/state/runs/<runId>/ for state drift.\n',
    })
  }
  const taskId = cursorResult.cursor.pending.taskId

  // Codex Mod #6 — crash window: verify_completed without gate_required.
  // runVerify emits verify_completed BEFORE gate_required(verify) on
  // success; if a crash landed between those two emissions, currentPhase
  // is still 'verify' and gate_required(verify) is missing. Refuse as
  // drift — re-running runVerify against the same patch would
  // double-emit verify_completed.
  const verifyDone = findLatestVerifyCompleted(events, opts.runId, taskId)
  if (verifyDone !== null && !hasGateRequired(events, opts.runId, 'verify')) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: VERIFY attempt ${verifyDone.attempt} for ${taskId} emitted verify_completed but no gate_required(verify).\n  A prior process likely crashed between event emissions.\n  Inspect .code-oz/state/runs/${opts.runId}/events.jsonl and resolve the partial state before re-running.\n`,
    })
  }

  // Codex Mod #3 + #4 — re-validate BUILD artifact shas + bytes.
  const artifacts = await resolveVerifyArtifacts({
    events,
    runId: opts.runId,
    taskId,
    cwd,
    artifactRoot: opts.artifactRoot,
  })
  if (artifacts.kind === 'drift') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: VERIFY pre-flight failed — ${artifacts.reason}.\n  Inspect .code-oz/state/runs/${opts.runId}/ before retrying. The next code-oz run will re-attempt only after the drift is resolved.\n`,
    })
  }

  // Worktree (idempotent — should already exist from BUILD).
  const worktreeResult = await loadOrCreateRunWorktree({
    cwd,
    runId: opts.runId,
    runPaths,
    phase: 'verify',
    agent: verifier.name,
  })
  if (worktreeResult.status === 'intervention') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: VERIFY worktree setup failed (${worktreeResult.code}).\n  ${worktreeResult.rule}${worktreeResult.detail !== undefined ? `\n  ${worktreeResult.detail}` : ''}\n`,
    })
  }

  const { registry: providerRegistry, fakeProvider } = buildProviderRegistry({
    providerOverride: opts.providerOverride,
  })
  if (opts.fakeScriptEntries !== undefined && fakeProvider !== undefined) {
    applyFakeScript(fakeProvider, opts.fakeScriptEntries)
  }

  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }
  const role = canonicalRoleFromAgent(verifier)
  const invokePersona = productionInvokePersona(invokeCtx, verifier, {
    phase: 'verify',
    runId: opts.runId,
    ...(role !== undefined ? { role } : {}),
  })

  const result: VerifyResult = await runVerify({
    runPaths,
    runId: opts.runId,
    cwd,
    verifierAgent: verifier,
    scientistAgent: scientist,
    taskId,
    attempt: artifacts.artifacts.attempt,
    attemptPatchContent: artifacts.artifacts.patchText,
    buildPromptSnapshot: artifacts.artifacts.promptText,
    invokeCtx,
    invokePersona,
    runner: productionRunner(),
    revertSeam: productionRevertSeam(worktreeResult.worktreePath),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  if (result.status === 'completed') {
    return Object.freeze({
      exitCode: EXIT_OK as 0,
      stdout: [
        `VERIFY phase complete (attempt ${artifacts.artifacts.attempt}, task ${taskId}).`,
        `  Review: ${result.verifyReportPath}`,
        '  Then run: code-oz approve verify',
        '',
      ].join('\n'),
    })
  }
  if (result.status === 'intervention') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: [
        `code-oz run: VERIFY paused (${result.code}).`,
        `  ${result.rule}`,
        '  Inspect .code-oz/state/runs/<runId>/ and resolve before re-running.',
        '',
      ].join('\n'),
    })
  }

  // result.status === 'failed' — finalize via scheduleAttemptNPlus1.
  // This emits worktree_destroyed + verify_restart_initiated and
  // removes the failed worktree. The next `code-oz run` will be
  // routed to dispatchBuild for attempt N+1 by the
  // shouldRouteToBuildRestart pre-check in handleActiveRun.
  const scheduled = await scheduleAttemptNPlus1({
    runPaths,
    runId: opts.runId,
    cwd,
    verifierAgent: verifier.name,
    verifyFailed: result,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  if (!scheduled.ok) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: [
        `code-oz run: VERIFY failed and post-fail teardown could not finish (${scheduled.code}).`,
        `  ${scheduled.reason}`,
        '  Inspect .code-oz/state/runs/<runId>/ and the failed worktree manually.',
        '',
      ].join('\n'),
    })
  }

  if (scheduled.nextAction === 'restart') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: [
        `VERIFY attempt ${result.attempt} for ${taskId} failed.`,
        `  Forensics: ${result.forensicsPath}`,
        `  Carry-forward prepared for attempt ${scheduled.nextAttempt ?? result.nextAttempt ?? '?'}.`,
        '  Re-run `code-oz run` to dispatch the next BUILD attempt.',
        '',
      ].join('\n'),
    })
  }
  // intervention path: 4-attempt cap reached.
  return Object.freeze({
    exitCode: EXIT_INTERVENTION as 1,
    stderr: [
      `VERIFY attempt ${result.attempt} for ${taskId} failed and the 4-attempt cap was reached.`,
      `  Forensics: ${result.forensicsPath}`,
      '  NEEDS_INTERVENTION.json was written; manual resolution required before continuing.',
      '',
    ].join('\n'),
  })
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
  --task <T-NNN>           Override the BUILD task selection. Defaults to the first
                           pending task in PLAN.md. Validated against PLAN.md's
                           TASK_ID_PATTERN; only applies to the BUILD phase.
  -h, --help               Show this help.

--request and --request-file are mutually exclusive.

Without flags, code-oz run reads turn 0 (and each subsequent turn) from a TTY.
Non-TTY environments must use --request or --request-file.
`.trim()
