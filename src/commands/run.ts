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
import { join } from 'node:path'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { appendEvent, readEvents } from '../state/events.ts'
import { isKnownPhaseEvent } from '../state/schemas.ts'
import type { LoggedEvent, Phase, PhaseEvent, Profile } from '../state/schemas.ts'

import {
  bootstrap,
  buildProviderRegistry,
  type ProviderOverride,
} from '../cli/bootstrap.ts'
import { canonicalRoleFromAgent } from '../agents/role.ts'
import { loadConfig } from '../config/load.ts'
import {
  applyEffort,
  EFFORT_LEVELS,
  type EffortLevel,
} from '../config/effort.ts'
import type { Budgets, CodeOzConfig } from '../config/schema.ts'
import {
  initRun,
  loadRun,
  readActiveRun,
  runPathsFor,
  type RunPaths,
} from '../state/run.ts'
import { writeStopGate } from '../state/gates.ts'
import { generateUlid } from '../state/schemas.ts'
import { runDefine, type DefineResult } from '../phases/define.ts'
import { runAudit, type AuditResult } from '../phases/audit.ts'
import { runPlan, type PlanResult } from '../phases/plan.ts'
import { runBuild, type BuildResult, type WorktreeBinding } from '../phases/build.ts'
import { runVerify, type VerifyResult } from '../phases/verify.ts'
import { runReview, type ReviewResult } from '../phases/review.ts'
import { shouldUseReviewPanel } from '../phases/review-panel.ts'
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
  productionPanelistInvoker,
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
import type { FakeProvider } from '../providers/fake.ts'
import {
  printFakeProviderBanner,
  recordFakeProviderWarning,
} from '../cli/fake-provider-warning.ts'
import { applyFirstRunFakeFixture } from '../providers/first-run-fake-fixture.ts'
import {
  clearStaleGateFile,
  detectOpenBuildStarted,
  formatInterventionRefusal,
  hasTaskStartedFor,
  loadPlanArtifact,
  resolveBuildCarryForward,
  tryReadNeedsInterventionGate,
} from './dispatch-build-helpers.ts'
import {
  findLatestBuildCompleted,
  isVerifyCrashWindow,
  resolveVerifyArtifacts,
  shouldRouteToBuildRestart,
} from './dispatch-verify-helpers.ts'
import {
  detectSchedulerFireOneLine,
  readPriorReviewMd,
  resolveNextReviewRound,
  resolveReviewArtifacts,
  shouldRouteReviewToBuildRestart,
} from './dispatch-review-helpers.ts'
import { exitCodeForPhaseResult } from '../cli/exit-codes.ts'

// --- public CLI entrypoint -----------------------------------------

export async function runCommand(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args)
  if (parsed.kind === 'error') {
    process.stderr.write(`code-oz run: ${parsed.message}\n`)
    if (parsed.help) process.stderr.write(RUN_HELP + '\n')
    process.exit(2)
  }

  // M16 C11 — explicit `--provider fake` warning banner. LOUD stderr banner fires
  // before anything else: failed preflight or `.code-oz/` missing must
  // still surface the warning so CI logs reflect the override regardless
  // of where the run aborts. The companion `fake_provider_warning_emitted`
  // event fires AFTER runId resolution (per-run scope; the event log
  // belongs to a run) — see the active-run + fresh-run branches below.
  if (parsed.providerOverride === 'fake') {
    printFakeProviderBanner()
  }

  const cwd = process.cwd()
  // M12 (rule 20: role-to-provider routing). Load config BEFORE bootstrap
  // so `config.company` reaches the agent registry. Per Codex Risk #2 in
  // CODEX_RESPONSE_M12.md (thread 019de4bb): the prior order built the
  // registry first and the company:block arrived too late to affect
  // routing.
  //
  // B1a Commit 2 (rule 23) — apply the `--effort` envelope to the loaded
  // config before any consumer sees it. Fresh runs use the parsed value;
  // active-run dispatchers reconstruct from the recorded
  // `effort_envelope_applied` event so the envelope DEFINE saw is the
  // envelope every later phase sees.
  const rawConfig = await loadConfig({ cwd })
  const config = applyEffort(rawConfig, parsed.effort)
  const ctx = await bootstrap({ cwd, config })
  if (parsed.effortAlias !== undefined) {
    process.stderr.write(
      `code-oz run: --effort ${parsed.effortAlias} is deprecated; use --effort ${parsed.effort}.\n`,
    )
  }
  const runtimeProviderOverride =
    parsed.providerOverride ?? (await defaultToFakeIfRequiredProvidersUnavailable(ctx))
  if (runtimeProviderOverride === 'fake' && parsed.providerOverride !== 'fake') {
    printFakeProviderBanner()
  }

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
    const activeRunPaths = runPathsFor(ctx.paths.state, ctx.paths.artifacts, active)
    // B1a Commit 2 (rule 23) — mismatch detection. When `--effort` was
    // supplied AND the recorded envelope's effort differs, exit code 2
    // (CLI usage error) BEFORE any other side effects. Mirror-style:
    // pre-checked here so the dispatcher tree below never has to know
    // about the flag.
    if (parsed.effortFlagPresent) {
      const recorded = await readRecordedEffort(activeRunPaths)
      if (recorded === null) {
        // Codex R0 F5 — legacy active run with no recorded envelope.
        // Accepting --effort here would be silently ignored at replay
        // (applyRecordedEffort returns the unchanged config when no
        // envelope event exists). Reject explicitly so the user sees
        // the mismatch instead of getting a phantom no-op.
        rejectEffortOnLegacyRunToStderr(parsed.effort)
        process.exit(EXIT_USAGE)
      }
      if (recorded !== parsed.effort) {
        rejectEffortMismatchToStderr(recorded)
        process.exit(EXIT_USAGE)
      }
    }
    const disposeInterruptStopGate = installInterruptStopGate(activeRunPaths, active)
    try {
      // M16 C11 — emit the `fake_provider_warning_emitted` event for the
      // active-run branch: appendEvent acquires the per-run lock, so the
      // event lands in the correct events.jsonl. Best-effort: if the
      // append fails (corrupt run dir, lock busy), the banner has already
      // surfaced the warning to stderr — we surface the append error and
      // continue, never blocking a run on the warning event.
      if (runtimeProviderOverride === 'fake') {
        try {
          await recordFakeProviderWarning({
            eventPaths: {
              file: activeRunPaths.eventsFile,
              lockDir: activeRunPaths.lockDir,
            },
            runId: active,
            ...(parsed.fakeScriptPath !== undefined
              ? { fakeScriptPath: parsed.fakeScriptPath }
              : {}),
          })
        } catch (err) {
          process.stderr.write(
            `code-oz run: failed to record fake_provider_warning_emitted: ${(err as Error).message}\n`,
          )
        }
      }
      await handleActiveRun(
        ctx.paths.state,
        ctx.paths.artifacts,
        active,
        runtimeProviderOverride,
        fakeScriptEntries,
        parsed.taskOverride,
      )
    } finally {
      disposeInterruptStopGate()
    }
    return
  }
  if (parsed.resumeRequested) {
    process.stderr.write('code-oz run: no active run to resume. Start one with `code-oz run --request "..."`.\n')
    process.exit(EXIT_USAGE)
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
    providerOverride: runtimeProviderOverride,
  })
  // M16 C2 — apply the fake-replay script (gated in parseRunArgs +
  // pre-loaded above). Applied BEFORE the --request-file BA scripting
  // so authored scripts can override transcript-derived expectations
  // (most-specific match wins; later registrations on the same matcher
  // queue FIFO behind earlier ones).
  applyRuntimeFakeResponses(fakeProvider, fakeScriptEntries, parsed.requestFile)
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
  // B1a Commit 2 (rule 23) — record the effort envelope as the second
  // event (between run_started and phase_entered) per design doc
  // § "Event order lock". originalBudgets = the loader output before
  // applyEffort; effectiveBudgets = the post-applyEffort `config` bound
  // above (the same object every consumer below this line reads).
  // Phase 1.6 prerequisite (1000-star plan, R0-revision-3 closure #3).
  // Read profile from the resolved config so brownfield repos start at
  // their declared profile instead of the prior `greenfield` literal.
  // Pairs with the detector tightening in src/commands/init.ts (untracked
  // files in a git-initialized repo now flag brownfield). M17's C2 will
  // add the AUDIT dispatch branch that consumes this profile; until
  // then the fresh-run path still calls runDefine below, so brownfield
  // runs reach M17's C1 RED test without profile-selection bugs masking
  // the real AUDIT dispatch gap.
  // M17 — persist the operator's brownfield problem statement on the
  // run_started event (rule 1: event-derived). The active-run continuation
  // path (dispatchAudit) recovers it from the log, never from the in-memory
  // --request that a resume does not have. Inline requests carry their text
  // verbatim; file-input requests are a BA transcript fixture, not a single
  // problem statement, so we record a marker naming the source file rather
  // than dumping the transcript; TTY runs have no static request, so the key
  // is omitted (brownfield-without-request stays key-less). This is a
  // BROWNFIELD-only field: greenfield uses the conversational DEFINE/ask-me
  // flow, not a single operator problem statement, so greenfield runs (with
  // or without --request) keep their `run_started` payload byte-for-byte
  // key-less exactly as before M17 — gating on `config.profile` here, not on
  // the input kind, is what preserves greenfield's event shape (Codex C4-prep
  // seam review: greenfield --request must not leak this key).
  const problemStatement: string | undefined =
    config.profile !== 'brownfield'
      ? undefined
      : parsed.input.kind === 'inline'
        ? parsed.input.text
        : parsed.input.kind === 'file'
          ? `(from --request-file ${parsed.input.path})`
          : undefined
  await initRun({
    paths: runPaths,
    profile: config.profile,
    runId,
    effort: parsed.effort,
    originalBudgets: rawConfig.budgets,
    effectiveBudgets: config.budgets,
    ...(problemStatement !== undefined ? { problemStatement } : {}),
  })
  const disposeInterruptStopGate = installInterruptStopGate(runPaths, runId)

  // M17 C2 — brownfield fresh-run routing. `initRun` above already emitted
  // `phase_entered(audit)` for brownfield profiles (initialPhase('brownfield')
  // === 'audit'), so the run is at AUDIT, not DEFINE. Route to `dispatchAudit`
  // instead of `runDefine`, and return BEFORE the DEFINE-only invokeCtx /
  // askMe / runDefine flow + its DefineResult gate-handling below. Greenfield
  // (config.profile !== 'brownfield') is completely untouched: it falls
  // through to the existing runDefine path. The fake-provider companion event
  // is recorded here too for parity with the greenfield branch, so brownfield
  // runs emit `fake_provider_warning_emitted` once per invocation as well.
  if (config.profile === 'brownfield') {
    // M17 C3 — the interrupt-stop gate must stay installed for the DURATION of
    // `dispatchAudit` (real AUDIT work), unlike the C2 placeholder which
    // exited immediately and could dispose early. We close the interactive
    // input source up front (AUDIT is single-shot, not a TTY ask-me loop), but
    // keep the stop gate installed across `runAudit` and dispose it only after
    // dispatchAudit returns (per the C2 Codex seam review).
    await inputSource.close()
    try {
      if (runtimeProviderOverride === 'fake') {
        try {
          await recordFakeProviderWarning({
            eventPaths: { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
            runId,
            ...(parsed.fakeScriptPath !== undefined
              ? { fakeScriptPath: parsed.fakeScriptPath }
              : {}),
          })
        } catch (err) {
          process.stderr.write(
            `code-oz run: failed to record fake_provider_warning_emitted: ${(err as Error).message}\n`,
          )
        }
      }
      // dispatchAudit returns on the (C5b+) success path and calls
      // process.exit on the intervention path; either way the finally disposes
      // the stop gate. The `return` after keeps greenfield untouched below.
      await dispatchAudit(
        ctx.paths.state,
        ctx.paths.artifacts,
        runId,
        runtimeProviderOverride,
        fakeScriptEntries,
      )
    } finally {
      disposeInterruptStopGate()
    }
    return
  }

  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }
  const askMeConfig = config.phases.define.askMe

  const result: DefineResult = await (async () => {
    try {
      // M16 C11 — companion event for the fresh-run branch. Emitted after
      // initRun so the per-run events.jsonl exists. Mirrors the active-run
      // branch above; both surfaces guarantee the banner + event fire once
      // per `code-oz run` invocation.
      if (runtimeProviderOverride === 'fake') {
        try {
          await recordFakeProviderWarning({
            eventPaths: { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
            runId,
            ...(parsed.fakeScriptPath !== undefined
              ? { fakeScriptPath: parsed.fakeScriptPath }
              : {}),
          })
        } catch (err) {
          process.stderr.write(
            `code-oz run: failed to record fake_provider_warning_emitted: ${(err as Error).message}\n`,
          )
        }
      }

      return await runDefine({
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
    } finally {
      disposeInterruptStopGate()
      await inputSource.close()
    }
  })()

  if (result.status === 'complete') {
    process.stdout.write(result.userMessage + '\n')
    process.exit(0)
  } else {
    process.stderr.write(result.userMessage + '\n')
    process.exit(1)
  }
}

async function defaultToFakeIfRequiredProvidersUnavailable(
  ctx: Awaited<ReturnType<typeof bootstrap>>,
): Promise<ProviderOverride | undefined> {
  const required = new Set(ctx.registry.listAll().map((agent) => agent.provider))
  const { registry } = buildProviderRegistry()
  for (const provider of required) {
    const health = await registry.get(provider).health()
    if (health.authStatus !== 'ok') return 'fake'
  }
  return undefined
}

function applyRuntimeFakeResponses(
  fakeProvider: FakeProvider | undefined,
  fakeScriptEntries: readonly FakeScriptEntry[] | undefined,
  requestFile: string | undefined,
): void {
  if (fakeProvider === undefined) return
  if (fakeScriptEntries !== undefined) {
    applyFakeScript(fakeProvider, fakeScriptEntries)
    return
  }
  if (requestFile !== undefined) return
  applyFirstRunFakeFixture(fakeProvider)
}

export async function writeInterruptStopGate(
  runPaths: RunPaths,
  runId: string,
  signal: 'SIGINT' | 'SIGTERM' = 'SIGINT',
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  await writeStopGate(
    {
      runDir: runPaths.runDir,
      lockDir: runPaths.lockDir,
      artifactRoot: runPaths.artifactRoot,
    },
    {
      version: 1,
      runId,
      reason: `${signal} received; operator requested a clean stop`,
      createdAt: now(),
    },
  )
}

export function installInterruptStopGate(runPaths: RunPaths, runId: string): () => void {
  let handled = false
  const handleSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    const exitCode = signal === 'SIGTERM' ? 143 : 130
    if (handled) process.exit(exitCode)
    handled = true
    writeInterruptStopGate(runPaths, runId, signal)
      .catch((err) => {
        process.stderr.write(
          `code-oz run: failed to write STOP.json after ${signal}: ${(err as Error).message}\n`,
        )
      })
      .finally(() => process.exit(exitCode))
  }
  const onSigint = () => handleSignal('SIGINT')
  const onSigterm = () => handleSignal('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  return () => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
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
  readonly requestFile?: string
  /** M16 C6 — explicit task override for `dispatchBuild`. Validated
   *  against PLAN.md's TASK_ID_PATTERN at parse time; the dispatcher
   *  rejects with EXIT_USAGE if the id is not present in PLAN.md. */
  readonly taskOverride?: string
  /** B1a Commit 2 — `--effort` value (rule 23). Default `'balanced'`
   *  when the flag is absent. Active-run reload sites assert the
   *  recorded effort matches; mismatched flag values exit code 2. */
  readonly effort: EffortLevel
  readonly effortAlias?: string
  /** B1a Commit 2 — true when `--effort` was supplied on this CLI
   *  invocation; false when the default applied. Active-run mismatch
   *  detection only fires when the flag was explicit (a `--effort`-less
   *  resume is always permitted). */
  readonly effortFlagPresent: boolean
  readonly resumeRequested: boolean
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
  let effort: EffortLevel | null = null
  let effortAlias: string | undefined
  let resumeRequested = false
  let help = false

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--help' || a === '-h') {
      help = true
      continue
    }
    if (a === '--resume') {
      resumeRequested = true
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
    if (a === '--effort') {
      const value = args[i + 1]
      if (value === undefined) {
        return {
          kind: 'error',
          message: `--effort requires one of: ${EFFORT_LEVELS.join(' | ')}`,
          help: true,
        }
      }
      const parsedEffort = parseEffortLevel(value)
      if (parsedEffort.kind === 'error') return parsedEffort
      effort = parsedEffort.value
      effortAlias = parsedEffort.alias
      i++
      continue
    }
    if (a.startsWith('--effort=')) {
      const value = a.slice('--effort='.length)
      const parsedEffort = parseEffortLevel(value)
      if (parsedEffort.kind === 'error') return parsedEffort
      effort = parsedEffort.value
      effortAlias = parsedEffort.alias
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
  if (resumeRequested && (request !== null || requestFile !== null)) {
    return {
      kind: 'error',
      message: '--resume cannot be combined with --request or --request-file',
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
  const effortFlagPresent = effort !== null
  const resolvedEffort: EffortLevel = effort ?? 'balanced'
  const base = (input: InputMode): ParsedOk => {
    const out: ParsedOk = {
      kind: 'ok',
      input,
      effort: resolvedEffort,
      ...(effortAlias !== undefined ? { effortAlias } : {}),
      effortFlagPresent,
      resumeRequested,
    }
    return Object.freeze({
      ...out,
      ...(providerOverride !== undefined ? { providerOverride } : {}),
      ...(fakeScriptPath !== null ? { fakeScriptPath } : {}),
      ...(input.kind === 'file' ? { requestFile: input.path } : {}),
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

function parseEffortLevel(
  value: string,
): { kind: 'ok'; value: EffortLevel; alias?: string } | ParsedError {
  const aliases: Readonly<Record<string, EffortLevel>> = {
    low: 'lite',
    medium: 'balanced',
    high: 'max',
  }
  if (value in aliases) {
    return { kind: 'ok', value: aliases[value]!, alias: value }
  }
  if ((EFFORT_LEVELS as readonly string[]).includes(value)) {
    return { kind: 'ok', value: value as EffortLevel }
  }
  return {
    kind: 'error',
    message: `--effort must be one of: ${EFFORT_LEVELS.join(' | ')} (got ${JSON.stringify(value)}; see code-oz run --help)`,
    help: true,
  }
}

// B1a Commit 2 (rule 23) — active-run reload helper. Reads the run's
// events.jsonl, finds the latest `effort_envelope_applied` event, and
// replays the RECORDED `effectiveBudgets` directly (NOT re-applies
// `applyEffort` to the currently-loaded config). Per Codex R0 R0-B1
// (thread 019e17f8): editing `.code-oz/config.yaml` mid-run must NOT
// change the active-run envelope; only the recorded snapshot governs.
// Legacy runs (no `effort_envelope_applied` event, e.g., a v0.17 run
// resumed after upgrade) fall back to the currently-loaded config
// unchanged. The mismatch entry-point upstream rejects `--effort` on
// legacy runs so this branch is only reached for legacy resume without
// `--effort`. Read-only; no events appended. Fail-closed on read
// errors (Codex R0 F3): `readEvents` throws on malformed logs and we
// let that surface rather than silently treating it as "no envelope".
async function applyRecordedEffort(
  config: CodeOzConfig,
  runPaths: RunPaths,
): Promise<{ readonly config: CodeOzConfig; readonly recordedEffort: EffortLevel | null }> {
  const events = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  })
  const recorded = findLatestEffortEnvelopeEvent(events)
  if (recorded === null) {
    return Object.freeze({
      config,
      recordedEffort: null,
    })
  }
  // The recorded snapshot is a JSON round-trip of a previously-typed
  // `Budgets` value. The event validator is schema-light (top-level
  // shape only; see `src/state/schemas.ts:1452-1457`) so nested types
  // are not narrowed in the public LoggedEvent union. Cast through
  // `unknown` to express "trust the snapshot we wrote" without losing
  // the surface assertion that we are replacing `config.budgets`.
  return Object.freeze({
    config: { ...config, budgets: recorded.effectiveBudgets as unknown as Budgets },
    recordedEffort: recorded.effort,
  })
}

async function readRecordedEffort(
  runPaths: RunPaths,
): Promise<EffortLevel | null> {
  const events = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  })
  const recorded = findLatestEffortEnvelopeEvent(events)
  return recorded?.effort ?? null
}

interface RecordedEnvelope {
  readonly effort: EffortLevel
  readonly effectiveBudgets: {
    readonly global: Record<string, unknown>
    readonly perPhase: Record<string, unknown>
  }
}

// M17 — recover the operator problem statement from the run_started event
// (rule 1: event-derived; the resume path has no in-memory --request). Returns
// '' when the run_started event omitted it (greenfield / pre-M17 / TTY runs).
async function readRecordedProblemStatement(runPaths: RunPaths): Promise<string> {
  const events = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  })
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'run_started') continue
    return e.problemStatement ?? ''
  }
  return ''
}

function findLatestEffortEnvelopeEvent(
  events: readonly LoggedEvent[],
): RecordedEnvelope | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'effort_envelope_applied') continue
    return {
      effort: e.effort,
      effectiveBudgets: e.effectiveBudgets,
    }
  }
  return null
}

// B1a Commit 2 — mismatch detection on active-run reload. When
// `--effort` was supplied AND a recorded envelope exists AND the values
// differ, exit with code 2 (CLI usage error, never NEEDS_INTERVENTION).
// The caller passes a `writeStderr`-shaped function and an `exit` cb so
// `dispatchBuild` / `dispatchVerify` / `dispatchReview` (which return
// structured `DispatchResult` objects) can surface the same rejection
// without process-exiting from inside a dispatcher.
function rejectEffortMismatchToStderr(
  recorded: EffortLevel,
): void {
  process.stderr.write(
    `code-oz run: this run was started with --effort ${recorded}; pass the same value or omit the flag\n`,
  )
}

// Codex R0 F5 — legacy active run (pre-B1a or no `effort_envelope_applied`
// event in the log) rejects explicit `--effort`. Without this guard the
// flag would be silently no-op'd at replay time.
function rejectEffortOnLegacyRunToStderr(
  passed: EffortLevel,
): void {
  process.stderr.write(
    `code-oz run: this active run pre-dates the --effort flag (no envelope recorded); passing --effort ${passed} would be ignored at replay. Resume without --effort to keep the legacy envelope, or start a fresh run.\n`,
  )
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
  // M16 C9: a `gate_required(phase)` event signals "awaiting approval"
  // ONLY when no later `gate_written(phase)` event has satisfied it.
  // Pre-C9 single-task runs never re-emitted gate_required(review) after
  // approval, so the check was effectively last-event-wins anyway. With
  // C9's task-loop dispatch, the run can re-enter the review branch on
  // a fresh task while gate_required(review) from the prior task lingers
  // in the log; the check must respect the gate_written signal that
  // closed the prior require.
  let gateRequiredForPhase = false
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type === 'gate_required' && e.phase === phase) {
      gateRequiredForPhase = true
      continue
    }
    if (e.type === 'gate_written' && e.phase === phase) {
      gateRequiredForPhase = false
    }
  }

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
    // M17 C7a: pass the event-derived profile (rule 1) from the loaded run
    // state. loaded.state.profile comes from the run_started event, so editing
    // .code-oz/config.yaml between AUDIT approval and PLAN cannot flip it.
    await dispatchPlan(
      stateDir,
      artifactRoot,
      activeRunId,
      loaded.state.profile,
      providerOverride,
      fakeScriptEntries,
    )
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
      // M16 C9 follow-on (5) — Bug 7 (verify-restart sibling): emit
      // phase_entered(build) before dispatchBuild. The verify-restart
      // signal does NOT change currentPhase via the reducer (run.ts
      // line 124), and dispatchBuild never emits the transition itself.
      // Without this emission, currentPhase stays at 'verify' and the
      // operator's `code-oz approve build` for attempt N+1 would fail
      // at approve.ts:117. Idempotent: skips when currentPhase is
      // already 'build' (benign resume of an already-routed BUILD).
      await emitPhaseEnteredBuildIfNeeded({
        runPaths,
        events,
        runId: activeRunId,
        currentPhase: phase,
      })
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
  if (phase === 'review') {
    // Codex M16 C8 Mod #9 — `--task` is BUILD-only.
    if (taskOverride !== undefined) {
      process.stderr.write(
        `code-oz run: --task ${taskOverride} only applies to the BUILD phase (current phase: review).\n`,
      )
      process.exit(EXIT_USAGE)
    }
    // Codex M16 C9 Mod #7 — review-remediation → BUILD pre-route.
    // C8 emits `review_remediation_recorded` on every needs-revision
    // exit with action='continue'. Without this pre-route, the next
    // `code-oz run` would loop back into dispatchReview when BUILD
    // attempt N+1 is what should run. Mirrors C7's verify_restart
    // pre-route. Both bypass `currentPhase` for per-task / per-attempt
    // routing per M16 L1 (multi-task semantics live in event
    // projection, not the state machine).
    let reviewPlan: PlanArtifact | null = null
    try {
      reviewPlan = await loadPlanArtifact(artifactRoot)
    } catch {
      // dispatchReview will surface PLAN.md errors; stay on review.
    }
    if (
      reviewPlan !== null &&
      shouldRouteReviewToBuildRestart(events, reviewPlan, activeRunId)
    ) {
      // M16 C9 follow-on (5) — Bug 7: emit phase_entered(build) before
      // dispatchBuild. review_remediation_recorded does NOT change
      // currentPhase via the reducer, and dispatchBuild never emits the
      // transition itself. Without this emission, currentPhase stays at
      // 'review' and the operator's `code-oz approve build` for attempt
      // N+1 fails at approve.ts:117 with `current phase is 'review',
      // not 'build'`. Symmetric to the verify-restart pre-route emission
      // above; both close the attempt-boundary half of the same bug
      // class that 5d21d9be closed at the task boundary.
      await emitPhaseEnteredBuildIfNeeded({
        runPaths,
        events,
        runId: activeRunId,
        currentPhase: phase,
      })
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
    // M16 C9 Mod #2 — task-loop dispatch: when an earlier task's
    // approve-review landed but `currentPhase` is still `review`
    // (because allCompleted=false → no phase_entered(ship)), the next
    // pending task's BUILD must run. Detect via cursor: if cursor.pending
    // exists AND has status === 'not_started' (no task_started yet),
    // route to dispatchBuild for the next task. Distinct from the
    // review-remediation case above which routes for BUILD attempt N+1
    // of the SAME task.
    if (reviewPlan !== null) {
      const cursorResult = projectTaskCursor(reviewPlan, events)
      const pending = cursorResult.cursor.pending
      if (pending !== null && pending.status === 'not_started') {
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
    }
    const result = await dispatchReview({
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

  // M17 C2 — AUDIT active-run branch. A run legitimately at
  // `currentPhase: 'audit'` (brownfield runs start here because
  // `initialPhase('brownfield') === 'audit'`) routes to `dispatchAudit`
  // instead of falling through to the terminal "in progress at phase
  // <X>" fallback below. Placed mirroring the `plan` branch's shape.
  // `--task` is BUILD-only, same as plan/verify/review.
  if (phase === 'audit') {
    if (taskOverride !== undefined) {
      process.stderr.write(
        `code-oz run: --task ${taskOverride} only applies to the BUILD phase (current phase: audit).\n`,
      )
      process.exit(EXIT_USAGE)
    }
    await dispatchAudit(stateDir, artifactRoot, activeRunId, providerOverride, fakeScriptEntries)
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

/**
 * Production CLI dispatch for the AUDIT phase (brownfield entry phase).
 *
 * M17 C3. Mirrors `dispatchPlan`'s bootstrap shape: load config, re-apply the
 * recorded effort envelope (rule 23), bootstrap the agent registry, build the
 * provider registry, then call `runAudit({...})`.
 *
 * AUDIT is the brownfield analog of DEFINE: an analysis of the existing repo +
 * the operator's problem statement that produces AUDIT.md. `runAudit` resolves
 * the `auditor` persona from the agent registry, then runs the bounded
 * repo_context dispatch loop (rule 18) so the auditor reads the repo via
 * glob/grep/read — each tool call appends a REAL `repo_context_searched` event
 * with actual results. Selected-path promotion into a later phase's manifest is
 * deferred to M18. When the auditor persona is unresolved, `runAudit` returns
 * an actionable `auditor_persona_not_registered` intervention (rule 11) WITHOUT
 * emitting `agent_invoked(auditor)` or any `repo_context_searched` event.
 *
 * The operator's brownfield problem statement is recovered from the
 * `run_started` event (event-derived, rule 1) and handed to `runAudit`.
 */
async function dispatchAudit(
  stateDir: string,
  artifactRoot: string,
  activeRunId: string,
  providerOverride?: ProviderOverride,
  fakeScriptEntries?: readonly FakeScriptEntry[],
): Promise<void> {
  const cwd = process.cwd()
  const runPaths = runPathsFor(stateDir, artifactRoot, activeRunId)
  // M12: load config BEFORE bootstrap so company:block routing applies to the
  // agent registry. B1a Commit 2 (rule 23): re-apply the recorded effort
  // envelope so AUDIT sees the same envelope the run was started with.
  const rawConfig = await loadConfig({ cwd })
  const { config } = await applyRecordedEffort(rawConfig, runPaths)
  const ctx = await bootstrap({ cwd, config })

  // AUDIT is a primary-artifact phase: it runs the Scientist phase-tail
  // (rule 15) after writing AUDIT.md. Resolve the scientist persona up front
  // and fail fast with one actionable message when the auditor or scientist
  // persona is missing — mirroring dispatchPlan's lead+scientist check.
  // (runAudit re-checks the auditor itself for its persona-missing
  // intervention; the auditor is resolved inside runAudit from agentRegistry.)
  const scientist = ctx.registry.getByName('scientist')
  if (scientist === undefined) {
    process.stderr.write(
      [
        'code-oz run: AUDIT requires the bundled `scientist` persona (Scientist phase-tail, rule 15).',
        '  Reinitialize the project (`code-oz init --force`) or restore .code-oz/agents/.',
        '',
      ].join('\n'),
    )
    process.exit(EXIT_INTERVENTION)
  }

  // Carry --provider fake (or other override) + the fake-replay script
  // entries through to AUDIT, the same way dispatchPlan/dispatchBuild do.
  const { registry: providerRegistry, fakeProvider } = buildProviderRegistry({ providerOverride })
  applyRuntimeFakeResponses(fakeProvider, fakeScriptEntries, undefined)
  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }

  // M17 — recover the operator problem statement from the run_started event
  // (rule 1: event-derived). This is what makes the active-run continuation
  // (resume) path work: the request is read from events.jsonl, not from an
  // in-memory --request that a resumed dispatch never had. Explicit at the
  // writer (initRun records it on run_started) requires explicit at the
  // reader — we consume it from the event, never re-derive it.
  const problemStatement = await readRecordedProblemStatement(runPaths)
  const result: AuditResult = await runAudit({
    invokeCtx,
    runPaths,
    runId: activeRunId,
    agentRegistry: ctx.registry,
    scientistAgent: scientist,
    problemStatement,
  })

  if (result.status === 'intervention') {
    process.stderr.write(
      [
        `code-oz run: AUDIT paused (${result.code}).`,
        `  ${result.rule}`,
        ...result.actionableSuggestions.map((s) => `  - ${s}`),
        '',
      ].join('\n'),
    )
    process.exit(EXIT_INTERVENTION)
  }

  // C5b/C6 will reach this success branch once AUDIT.md production + the gate
  // land. Unreached in C3.
  process.stdout.write(
    [
      'AUDIT phase complete. Review:',
      `  ${result.auditPath}`,
      'Then run: code-oz approve audit',
      '',
    ].join('\n'),
  )
}

async function dispatchPlan(
  stateDir: string,
  artifactRoot: string,
  activeRunId: string,
  profile: Profile,
  providerOverride?: ProviderOverride,
  fakeScriptEntries?: readonly FakeScriptEntry[],
): Promise<void> {
  const cwd = process.cwd()
  const runPaths = runPathsFor(stateDir, artifactRoot, activeRunId)
  // M12: same flip as runCommand. Load config BEFORE bootstrap so the
  // resumed PLAN dispatch sees company:block routing on the registry.
  // Per Codex Risk #2 in CODEX_RESPONSE_M12.md (thread 019de4bb).
  // B1a Commit 2 (rule 23): re-apply the recorded effort envelope so
  // PLAN sees the same envelope DEFINE saw.
  const rawConfig = await loadConfig({ cwd })
  const { config } = await applyRecordedEffort(rawConfig, runPaths)
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
  applyRuntimeFakeResponses(fakeProvider, fakeScriptEntries, undefined)
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
    profile,
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

  // B1a Commit 2 (rule 23): reconstruct the effort envelope from the
  // recorded `effort_envelope_applied` event before bootstrap and
  // before any consumer reads `config.budgets`.
  const rawConfig = await loadConfig({ cwd })
  const { config } = await applyRecordedEffort(rawConfig, runPaths)
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

  // M16 C9 follow-on (Bug 2 + Bug 6) — boundary-aware gate-file cleanup.
  // When the upcoming BUILD attempt's (taskId, attempt) does not match
  // the underlying artifact behind `GATE_BUILD_PASSED.json`, the recorded
  // artifactSha256 will mismatch the BUILD_REPORT.md the new attempt is
  // about to overwrite. Bug 2 (c262efd) closed the cross-task case;
  // Bug 6 (this commit) closes the within-task cross-attempt case
  // (review-needs-revision restart, verify-fail restart). Passing
  // `currentAttempt` enables attempt-aware supersedence — without it
  // the helper would still short-circuit on a prior `build_started`
  // for the same task. The deletion is recorded as a
  // `gate_file_cleared` event for audit. Idempotent on every non-
  // boundary path.
  const buildGateClearance = await clearStaleGateFile({
    runDir: runPaths.runDir,
    phase: 'build',
    events,
    currentTaskId: taskId,
    currentAttempt: attempt,
  })
  if (buildGateClearance.cleared) {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_file_cleared',
        ts: now(),
        runId: opts.runId,
        phase: 'build',
        priorTaskId: buildGateClearance.priorTaskId!,
        currentTaskId: taskId,
        gateFile: 'GATE_BUILD_PASSED.json',
        priorArtifactSha256: buildGateClearance.priorArtifactSha256!,
      },
    )
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
  applyRuntimeFakeResponses(fakeProvider, opts.fakeScriptEntries, undefined)

  // Emit task_started exactly once per task. The prior shape gated on
  // `attempt === 1`, but a crash AFTER `task_started` and BEFORE
  // `build_started` would re-enter dispatchBuild on the next run with
  // attempt still === 1 (the BUILD never succeeded), causing a second
  // `task_started` to be appended.
  //
  // R1 finding 5 (fix-soon): emission is now keyed on event presence —
  // skip if any prior `task_started` for `(runId, taskId)` exists. The
  // attempt-1 guard remains as a fast path because attempt > 1 always
  // implies a prior successful BUILD for attempt 1, and the BUILD path
  // emitted `task_started` before that first BUILD ran.
  if (!hasTaskStartedFor(events, opts.runId, taskId)) {
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
  const now = opts.now ?? (() => new Date().toISOString())
  const runPaths = runPathsFor(opts.stateDir, opts.artifactRoot, opts.runId)

  // 1. NEEDS_INTERVENTION refusal.
  const intervention = await tryReadNeedsInterventionGate(runPaths)
  if (intervention !== null) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: formatInterventionRefusal(intervention, opts.runId),
    })
  }

  // B1a Commit 2 (rule 23): reconstruct the effort envelope before
  // bootstrap and any consumer reads.
  const rawConfig = await loadConfig({ cwd })
  const { config } = await applyRecordedEffort(rawConfig, runPaths)
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
  //
  // R1 finding 1 (block-push): the check is now (taskId, attempt)-scoped
  // via `isVerifyCrashWindow`. The prior any-task / any-attempt presence
  // check let a stale `gate_required(verify)` from a prior task or
  // earlier attempt mask a real crash for the current attempt. The
  // attempt anchor is the latest `build_completed` for this task — the
  // upcoming VERIFY (or its just-crashed predecessor) operates against
  // that BUILD attempt.
  const crashAttempt = findLatestBuildCompleted(events, opts.runId, taskId)?.attempt ?? 1
  if (isVerifyCrashWindow(events, opts.runId, taskId, crashAttempt)) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: VERIFY attempt ${crashAttempt} for ${taskId} emitted verify_completed but no gate_required(verify).\n  A prior process likely crashed between event emissions.\n  Inspect .code-oz/state/runs/${opts.runId}/events.jsonl and resolve the partial state before re-running.\n`,
    })
  }

  // M16 C9 follow-on (Bug 2 + Bug 6) — boundary-aware gate-file cleanup
  // for `GATE_VERIFY_PASSED.json`. Mirrors dispatchBuild's attempt-aware
  // semantics: the upcoming VERIFY runs against the latest BUILD
  // attempt for this task, so the helper short-circuits only when a
  // `verify_started` event already exists for that exact (taskId,
  // attempt). The verify-fail restart path overwrites VERIFY.md a2,
  // and approve-verify a1's stale gate file would otherwise mismatch
  // (Bug 6 mirror). When no `build_completed` exists yet, we still
  // pass attempt=1 so the helper proceeds with the standard task-
  // boundary check via started-event scan.
  const verifyBuildLatest = findLatestBuildCompleted(events, opts.runId, taskId)
  const verifyAttempt = verifyBuildLatest?.attempt ?? 1
  const verifyGateClearance = await clearStaleGateFile({
    runDir: runPaths.runDir,
    phase: 'verify',
    events,
    currentTaskId: taskId,
    currentAttempt: verifyAttempt,
  })
  if (verifyGateClearance.cleared) {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_file_cleared',
        ts: now(),
        runId: opts.runId,
        phase: 'verify',
        priorTaskId: verifyGateClearance.priorTaskId!,
        currentTaskId: taskId,
        gateFile: 'GATE_VERIFY_PASSED.json',
        priorArtifactSha256: verifyGateClearance.priorArtifactSha256!,
      },
    )
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
  applyRuntimeFakeResponses(fakeProvider, opts.fakeScriptEntries, undefined)

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

// --- REVIEW dispatch (M16 C8) -------------------------------------

export interface DispatchReviewOptions {
  readonly stateDir: string
  readonly artifactRoot: string
  readonly runId: string
  readonly providerOverride?: ProviderOverride
  readonly fakeScriptEntries?: readonly FakeScriptEntry[]
  readonly cwd?: string
  readonly now?: () => string
}

/**
 * Production CLI dispatch for the REVIEW phase. Mirrors `dispatchVerify`
 * but operates on the just-passed VERIFY artifact (no attempt
 * derivation; the attempt comes from the latest `build_completed`
 * event for the cursor's pending task — REVIEW reads the same attempt
 * BUILD/VERIFY agreed on).
 *
 * Codex M16 C8 pre-design review pinned the following invariants
 * (5 block-push + 4 fix-soon + 1 nit, all closed inline):
 *
 *   1. `nextReviewRound` is persisted via a new
 *      `review_remediation_recorded` event — emitted on every
 *      `needs_revision` REVIEW return so resumed dispatches resolve
 *      round N+1 from durable state, not derivation. (Mod #1)
 *   2. The dispatcher does NOT acquire `.review.lock`. `runReview`
 *      self-locks at src/phases/review.ts:560-572 (mirroring
 *      runBuild/runVerify). (Mod #2)
 *   3. `resolveReviewArtifacts` re-validates BUILD_REPORT.md /
 *      VERIFY.md shas against the latest build_completed /
 *      verify_completed events — closes the approve-verify →
 *      run-review hand-edit window. (Mod #3)
 *   4. `needs_revision` exits with EXIT_INTERVENTION (NOT EXIT_OK):
 *      the review-debate loop's expected non-gate-ready outcome.
 *      `exitCodeForPhaseResult` is the single mapping authority. (Mod #4)
 *   5. `productionPanelistInvoker` is wired whenever `panel.length
 *      >= 2`; without it, panel mode raises `review_panel_invoker_missing`
 *      intervention at src/phases/review.ts:2475-2481. (Mod #5)
 *   6. `runReview` owns panel-vs-single branching via
 *      `shouldUseReviewPanel` (src/phases/review-panel.ts:202-206);
 *      cross-family enforcement stays inside runReview. (Mod #6)
 *   7. Panel-mode capability gating is a panelist eligibility check
 *      added to the config loader (src/config/load.ts mergeReviewerPanel),
 *      not a branch-selection check. (Mod #7)
 *   8. Scheduler one-liner reads from the events.jsonl delta (events
 *      appended by runReview); no new replay event added; no field
 *      added to ReviewResult. (Mod #8)
 *   9. `handleActiveRun` REVIEW branch rejects `--task` (BUILD-only)
 *      with EXIT_USAGE before dispatch. (Mod #9)
 *  10. `--provider fake` aliases preserve provider id family per
 *      src/cli/bootstrap.ts:176-194 + src/providers/fake.ts:92-95;
 *      tests configure distinct ids. (Mod #10)
 */
export async function dispatchReview(
  opts: DispatchReviewOptions,
): Promise<DispatchResult> {
  const cwd = opts.cwd ?? process.cwd()
  const now = opts.now ?? (() => new Date().toISOString())
  const runPaths = runPathsFor(opts.stateDir, opts.artifactRoot, opts.runId)

  // 1. NEEDS_INTERVENTION refusal at the very top (mirror C6/C7).
  const intervention = await tryReadNeedsInterventionGate(runPaths)
  if (intervention !== null) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: formatInterventionRefusal(intervention, opts.runId),
    })
  }

  // B1a Commit 2 (rule 23): reconstruct the effort envelope before
  // bootstrap and any consumer reads.
  const rawConfig = await loadConfig({ cwd })
  const { config } = await applyRecordedEffort(rawConfig, runPaths)
  const ctx = await bootstrap({ cwd, config })
  const reviewer = ctx.registry.getByName('reviewer')
  const scientist = ctx.registry.getByName('scientist')
  if (reviewer === undefined || scientist === undefined) {
    return Object.freeze({
      exitCode: EXIT_USAGE as 2,
      stderr:
        'code-oz run: REVIEW requires the bundled `reviewer` and `scientist` personas.\n  Reinitialize the project (`code-oz init --force`) or restore .code-oz/agents/.\n',
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
      stderr: `code-oz run: REVIEW requires PLAN.md but the file could not be loaded.\n  ${detail}\n`,
    })
  }

  // Resolve task: REVIEW uses the cursor's pending task; --task is
  // BUILD-only and was rejected upstream by handleActiveRun.
  const cursorResult = projectTaskCursor(plan, events)
  if (cursorResult.cursor.pending === null) {
    return Object.freeze({
      exitCode: EXIT_USAGE as 2,
      stderr:
        'code-oz run: PLAN.md has no pending tasks; the run should have advanced past REVIEW.\n  Inspect .code-oz/state/runs/<runId>/ for state drift.\n',
    })
  }
  const taskId = cursorResult.cursor.pending.taskId
  const taskIndex = cursorResult.cursor.pending.taskIndex

  // M16 C9 follow-on (Bug 2) — task-boundary gate-file cleanup. Mirrors
  // dispatchBuild/dispatchVerify for `GATE_REVIEW_PASSED.json`. Deletes
  // the prior task's review gate so the operator's eventual `code-oz
  // approve review` does not throw `gate_artifact_sha256_mismatch`
  // against the freshly-overwritten REVIEW.md.
  const reviewGateClearance = await clearStaleGateFile({
    runDir: runPaths.runDir,
    phase: 'review',
    events,
    currentTaskId: taskId,
  })
  if (reviewGateClearance.cleared) {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_file_cleared',
        ts: now(),
        runId: opts.runId,
        phase: 'review',
        priorTaskId: reviewGateClearance.priorTaskId!,
        currentTaskId: taskId,
        gateFile: 'GATE_REVIEW_PASSED.json',
        priorArtifactSha256: reviewGateClearance.priorArtifactSha256!,
      },
    )
  }

  // Codex Mod #3 — re-validate BUILD/VERIFY artifact shas + bytes.
  const artifacts = await resolveReviewArtifacts({
    events,
    runId: opts.runId,
    taskId,
    artifactRoot: opts.artifactRoot,
  })
  if (artifacts.kind === 'drift') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: REVIEW pre-flight failed — ${artifacts.reason}.\n  Inspect .code-oz/state/runs/${opts.runId}/ before retrying. The next code-oz run will re-attempt only after the drift is resolved.\n`,
    })
  }
  const attempt = artifacts.artifacts.attempt

  // Codex Mod #1 — resolve the round number from persisted remediation.
  // Walks back to the predecessor `review_remediation_recorded` event
  // (the one whose `attempt + 1` equals the current artifact attempt —
  // i.e., the remediation that fired the BUILD restart producing these
  // artifacts) and returns its `nextReviewRound`. Returns 1 when no
  // predecessor exists (first round). M16 C9 follow-on 6 (Bug 9) fixed
  // a contract drift where strict attempt equality dropped the cross-
  // boundary predecessor and silently re-dispatched round 1.
  const round = resolveNextReviewRound(events, opts.runId, taskId, attempt)

  // Read prior REVIEW.md when round > 1 (the canonical artifact at
  // <artifactRoot>/REVIEW.md, NOT a draft).
  const priorReviewMd = round > 1 ? await readPriorReviewMd(opts.artifactRoot) : null
  if (round > 1 && priorReviewMd === null) {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: REVIEW round ${round} requires the prior REVIEW.md but the file is missing.\n  Expected at ${join(opts.artifactRoot, 'REVIEW.md')}.\n  Inspect .code-oz/state/runs/${opts.runId}/ for state drift.\n`,
    })
  }

  // Worktree (idempotent — should already exist from BUILD/VERIFY).
  const worktreeResult = await loadOrCreateRunWorktree({
    cwd,
    runId: opts.runId,
    runPaths,
    phase: 'review',
    agent: reviewer.name,
  })
  if (worktreeResult.status === 'intervention') {
    return Object.freeze({
      exitCode: EXIT_INTERVENTION as 1,
      stderr: `code-oz run: REVIEW worktree setup failed (${worktreeResult.code}).\n  ${worktreeResult.rule}${worktreeResult.detail !== undefined ? `\n  ${worktreeResult.detail}` : ''}\n`,
    })
  }

  // Provider registry + fake-script.
  const { registry: providerRegistry, fakeProvider } = buildProviderRegistry({
    providerOverride: opts.providerOverride,
  })
  applyRuntimeFakeResponses(fakeProvider, opts.fakeScriptEntries, undefined)

  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }
  const role = canonicalRoleFromAgent(reviewer)
  const invokePersona = productionInvokePersona(invokeCtx, reviewer, {
    phase: 'review',
    runId: opts.runId,
    ...(role !== undefined ? { role } : {}),
  })

  // Codex Mod #6 — runReview owns panel-vs-single. Wire panelistInvoker
  // whenever the company config declares panel mode (panel.length >= 2);
  // shouldUseReviewPanel inside runReview owns the branch decision.
  let panelistInvoker: ReturnType<typeof productionPanelistInvoker> | undefined
  if (shouldUseReviewPanel(config.company)) {
    panelistInvoker = productionPanelistInvoker({
      registry: providerRegistry,
      invokeCtx,
      agents: new Map(),
      defaultAgent: reviewer,
      runId: opts.runId,
      // The composed prompt for panel mode is supplied by the
      // dispatcher; v0.1 reuses the single-mode review prompt
      // composition path. The orchestrator feeds the persona's
      // composed-prompt closure separately for panel vs single,
      // but at the dispatch level the composed prompt for each
      // panelist is simply the reviewer prompt body (manifest equality
      // is enforced inside runReviewPanel).
      composePrompt: async () => '',
    })
  }

  // Read events again right before the call so the post-runReview
  // delta diff (Codex Mod #8) has a sharp pre-cut.
  const eventsBefore = events.length

  const result: ReviewResult = await runReview({
    runPaths,
    runId: opts.runId,
    cwd,
    reviewerAgent: reviewer,
    scientistAgent: scientist,
    taskId,
    invokeCtx,
    invokePersona,
    ...(panelistInvoker !== undefined ? { panelistInvoker } : {}),
    round,
    priorReviewMd,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  // Codex Mod #8 — post-runReview event delta: read events.jsonl again
  // and inspect ONLY the new entries for scheduler fire/postreview events
  // matching this (runId, taskId, attempt, round). If matched, emit a
  // one-liner to stdout. No new replay event is created.
  const eventsAfter = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  })
  const newEvents = eventsAfter.slice(eventsBefore)
  const fireSummary = detectSchedulerFireOneLine(newEvents, {
    runId: opts.runId,
    taskId,
    attempt,
    reviewRound: round,
  })
  let schedulerLine: string | undefined
  if (fireSummary !== null) {
    schedulerLine = `[scheduler] grey-zone fire → debate vs ${fireSummary.opposingProvider} → ${fireSummary.verdict} (${fireSummary.actionableFindingsAddedCount} actionable added)`
  }

  // Codex Mod #1 — persist the remediation decision when REVIEW returns
  // needs_revision with action='continue'. The event carries
  // nextReviewRound resolved by review-remediation.ts so the next
  // `code-oz run` resolves round N+1 without re-deriving it.
  if (
    result.status === 'needs_revision' &&
    result.remediation.action === 'continue'
  ) {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'review_remediation_recorded',
        ts: now(),
        runId: opts.runId,
        phase: 'review',
        agent: reviewer.name,
        attempt,
        taskId,
        reviewRound: round,
        nextReviewRound: result.remediation.nextReviewRound,
        decisionId: generateUlid(),
        reviewMdSha256: result.reviewReportSha256,
        remediationIntent: 'continue',
        refsTo: {
          type: 'review_round_completed',
          reviewReportSha256: result.reviewReportSha256,
        },
      },
    )
  }

  // M16 C9 follow-on (7) — Bug 10: emit `task_review_passed` when REVIEW
  // resolved with verdict='ready'. The schema (src/state/schemas.ts) and
  // cursor projection (src/state/task-cursor.ts) were both wired for this
  // event since C1, but no call site emitted it — the C12 e2e
  // (cli-multi-task-cycle.test.ts:438) caught the gap by asserting
  // `taskReviewPassed.length === 3` and observing 0.
  //
  // Semantic A (pre-approval signal): the event fires AFTER
  // `runReview` returns `status === 'resolved'` and BEFORE the operator
  // runs `code-oz approve review`. The gap between this event and
  // `task_completed` (emitted by `approveReviewTaskGate`) is the
  // "review-ready, awaiting operator approve" window surfaced via
  // `TaskCursorEntry.reviewPassed`. If we instead emitted from
  // `approveReviewTaskGate` (Semantic B), `reviewPassed` would always
  // co-occur with `status === 'completed'` and the cursor's
  // `reviewPassed` boolean would be redundant with `status` — the
  // cursor's projection logic only justifies the event under
  // Semantic A.
  //
  // Why the dispatcher and not `runReview`: the schema requires
  // `taskIndex`, which is dispatcher authority (cursor projection lives
  // here). `RunReviewOptions` does not carry taskIndex; plumbing it
  // through would touch ~5 test helpers in tests/review-* without
  // changing semantics. The dispatcher already reads the cursor pending
  // entry for `taskId`/`taskIndex`; the emit is co-located.
  //
  // Idempotency: a re-dispatch of REVIEW for an already-resolved
  // (taskId, finalRound) — possible under resume after operator drift —
  // would re-run `runReview` and re-receive `status === 'resolved'`.
  // Match the C9 idempotency pattern in `approveReviewTaskGate`: skip
  // emit when an existing `task_review_passed` for
  // `(runId, taskId, finalRound)` is found.
  if (result.status === 'resolved') {
    const eventsForIdem = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const alreadyEmitted = eventsForIdem.some((e) => {
      if (!isKnownPhaseEvent(e)) return false
      if (e.type !== 'task_review_passed') return false
      return (
        e.runId === opts.runId &&
        e.taskId === taskId &&
        e.finalRound === result.round
      )
    })
    if (!alreadyEmitted) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'task_review_passed',
          ts: now(),
          runId: opts.runId,
          taskId,
          taskIndex,
          finalRound: result.round,
          reviewReportSha256: result.reviewReportSha256,
        },
      )
    }
  }

  const exitCode = exitCodeForPhaseResult(result)
  const baseOut = (msg: string): string => (schedulerLine !== undefined ? `${schedulerLine}\n${msg}` : msg)
  const baseErr = (msg: string): string => (schedulerLine !== undefined ? `${schedulerLine}\n${msg}` : msg)

  if (result.status === 'resolved') {
    return Object.freeze({
      exitCode: exitCode as 0,
      stdout: baseOut(
        [
          `REVIEW phase complete (round ${result.round}, score ${result.score}, task ${taskId}).`,
          `  Review: ${result.reviewReportPath}`,
          '  Then run: code-oz approve review',
          '',
        ].join('\n'),
      ),
    })
  }
  if (result.status === 'needs_revision') {
    const remediation = result.remediation
    let guidance: string
    if (remediation.action === 'continue') {
      guidance = [
        `REVIEW round ${result.round} returned needs-revision (score ${result.score}, task ${taskId}).`,
        `  Carry-forward prepared for BUILD attempt ${remediation.nextBuildAttempt} → REVIEW round ${remediation.nextReviewRound}.`,
        `  Review: ${result.reviewReportPath}`,
        '  Re-run `code-oz run` to dispatch the next BUILD attempt.',
        '',
      ].join('\n')
    } else if (remediation.action === 'review_cap_exhausted') {
      guidance = [
        `REVIEW round ${result.round} returned needs-revision and the 4-round cap is exhausted (task ${taskId}).`,
        `  Reason: ${remediation.reason}`,
        `  Review: ${result.reviewReportPath}`,
        '  NEEDS_INTERVENTION.json was written; manual resolution required.',
        '',
      ].join('\n')
    } else {
      guidance = [
        `REVIEW round ${result.round} returned needs-revision but the BUILD attempt cap is exhausted (task ${taskId}).`,
        `  Reason: ${remediation.reason}`,
        `  Review: ${result.reviewReportPath}`,
        '  Inspect .code-oz/state/runs/<runId>/ for VERIFY-owned intervention.',
        '',
      ].join('\n')
    }
    return Object.freeze({
      exitCode: exitCode as 1,
      stderr: baseErr(guidance),
    })
  }
  if (result.status === 'blocked') {
    return Object.freeze({
      exitCode: exitCode as 1,
      stderr: baseErr(
        [
          `REVIEW round ${result.round} blocked (verdict=${result.verdict}, score ${result.score}, task ${taskId}).`,
          `  Review: ${result.reviewReportPath}`,
          '  NEEDS_INTERVENTION.json was written; manual resolution required.',
          '',
        ].join('\n'),
      ),
    })
  }
  // result.status === 'intervention'
  return Object.freeze({
    exitCode: exitCode as 1,
    stderr: baseErr(
      [
        `code-oz run: REVIEW paused (${result.code}).`,
        `  ${result.rule}`,
        ...(result.draftPath !== undefined ? [`  Draft: ${result.draftPath}`] : []),
        '  Inspect .code-oz/state/runs/<runId>/ and resolve before re-running.',
        '',
      ].join('\n'),
    ),
  })
}

/**
 * M16 C9 follow-on (5) — Bug 7: emit `phase_entered(build)` on the
 * attempt-boundary BUILD pre-routes (verify-restart + review-remediation)
 * before invoking `dispatchBuild`. Without this emission, `currentPhase`
 * stays at `verify` (verify-restart path) or `review` (review-remediation
 * path), and the operator's subsequent `code-oz approve build` for the
 * new attempt fails at `src/commands/approve.ts:117` with `current phase
 * is '<phase>', not 'build'`.
 *
 * This is the symmetric attempt-boundary counterpart to
 * `approveReviewTaskGate`'s task-boundary `phase_entered(build)` emission
 * (5d21d9be — M16 C9 follow-on 2). Both close the same bug class:
 * `dispatchBuild` never emits `phase_entered(build)` itself; the upstream
 * caller is authoritative for the transition.
 *
 * Idempotency: when `currentPhase` is already `build`, skip the emit.
 * Mirrors the dedup pattern used in `approveReviewTaskGate` — the
 * idempotent re-invocation case is "the prior call already emitted the
 * transition, this re-call must not duplicate". A duplicate
 * `phase_entered(build)` is benign for the reducer (it just re-sets
 * currentPhase to 'build'), but the audit trail should not record the
 * same boundary twice. The reducer over `loaded.state.currentPhase`
 * already collapses redundant emissions for state purposes; we still
 * skip to keep the event log minimal.
 *
 * Test-only export: `tests/cli-task-loop.test.ts` exercises this helper
 * directly so the regression coverage does not require spawning the CLI
 * binary. Production callers are the two pre-routes in `handleActiveRun`
 * (verify-restart, review-remediation).
 */
export interface EmitPhaseEnteredBuildIfNeededInput {
  readonly runPaths: RunPaths
  readonly events: readonly LoggedEvent[]
  readonly runId: string
  readonly currentPhase: Phase
  readonly now?: () => string
}

export interface EmitPhaseEnteredBuildIfNeededResult {
  /** True when a `phase_entered(build)` event was appended; false when
   *  the helper short-circuited because `currentPhase` was already
   *  `build` (idempotent re-call). */
  readonly emitted: boolean
}

export async function emitPhaseEnteredBuildIfNeeded(
  input: EmitPhaseEnteredBuildIfNeededInput,
): Promise<EmitPhaseEnteredBuildIfNeededResult> {
  if (input.currentPhase === 'build') {
    // Idempotent re-call: the prior pre-route invocation already emitted
    // the boundary, OR a defensive resume of an in-flight BUILD. Either
    // way, currentPhase is already where dispatchBuild expects it; do
    // not re-emit.
    return Object.freeze({ emitted: false })
  }
  const ts = input.now !== undefined ? input.now() : new Date().toISOString()
  const ev: PhaseEvent = {
    version: 1,
    type: 'phase_entered',
    ts,
    runId: input.runId,
    phase: 'build',
  }
  await appendEvent(
    { file: input.runPaths.eventsFile, lockDir: input.runPaths.lockDir },
    ev,
  )
  return Object.freeze({ emitted: true })
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
  --effort <level>         Scale the run's budget envelope. One of:
                             lite     0.4x  (smaller scope; tighter caps)
                             balanced 1.0x  (default; equivalent to no flag)
                             max      2.5x  (larger scope; broader caps)
                             beast    6.0x  (full headroom; longest runs)
                           Scales budget envelope only; does not change phase
                           behavior or audit strictness (rule 23). Active runs
                           reconstruct the recorded envelope from events.jsonl;
                           passing a different value than the run was started
                           with exits with code 2.
  -h, --help               Show this help.

--request and --request-file are mutually exclusive.

Without flags, code-oz run reads turn 0 (and each subsequent turn) from a TTY.
Non-TTY environments must use --request or --request-file.
`.trim()
