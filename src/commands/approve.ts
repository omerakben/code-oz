// `code-oz approve [PHASE]` — approve the current phase of the active run.
//
// Behavior:
// - With no PHASE: read state/active.json + the run's current.json, infer the
//   currentPhase, prompt the user to confirm, then write the gate.
// - With PHASE: bypass inference, but still validate that PHASE matches the
//   run's currentPhase. Skipping or backwards-approval is rejected.
//
// In both cases:
// - Path safety on the artifact is enforced by gates.ts.
// - Idempotency is handled by run.ts's approveGate (same content -> no-op,
//   different content -> gate_idempotency_violation).
// - The full transaction (gate write + 3 events + current.json rebuild)
//   runs under a single per-run lock acquisition.
//
// Layering: this command imports from src/cli/bootstrap.ts (registry liveness)
// and src/state/run.ts (orchestration). It does not touch events.ts or
// gates.ts directly.

import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { bootstrap } from '../cli/bootstrap.ts'
import {
  approveGate,
  loadRun,
  readActiveRun,
  runPathsFor,
} from '../state/run.ts'
import {
  CANONICAL_ARTIFACTS,
  isKnownPhaseEvent,
  isPhase,
  PHASES,
  type GateFile,
  type Phase,
} from '../state/schemas.ts'
import { GateLoadError } from '../state/errors.ts'
import { _validateArtifactSyncPath } from '../state/gates.ts'
import { appendEvent, readEvents } from '../state/events.ts'
import { parseSpec } from '../artifacts/spec.ts'
import { parseVerifyReport, VerifyReportLoadError } from '../artifacts/verify-report.ts'
import { SpecLoadError } from '../artifacts/errors.ts'
import { removeRunWorktree } from '../worktree/remove-run-worktree.ts'

export interface RunApproveOptions {
  readonly cwd?: string
  readonly phase?: string
  readonly artifact?: string
  readonly notes?: string
  readonly approvedBy?: string
  /**
   * Confirmation hook. Called only when no phase argument is provided
   * (auto-detected). Tests inject a deterministic confirm function;
   * the default uses readline against stdin.
   */
  readonly confirm?: (message: string) => Promise<boolean>
  /** Override Date.now() for deterministic gate timestamps in tests. */
  readonly now?: () => string
}

export interface RunApproveResult {
  readonly approved: boolean
  readonly phase: Phase
  readonly runId: string
  readonly nextPhase: Phase | null
  readonly gateExisted: boolean
}

/**
 * Programmatic entry point for the approve flow. The CLI command wraps this.
 */
export async function runApprove(opts: RunApproveOptions = {}): Promise<RunApproveResult> {
  const ctx = await bootstrap({ cwd: opts.cwd })

  const runId = await readActiveRun(ctx.paths.activeRun)
  if (runId === null) {
    throw new Error(
      'no active run found. Initialize a run first (M5 will provide `code-oz run`; for now use `initRun()` from src/state/run.ts in your code).',
    )
  }

  const runPaths = runPathsFor(ctx.paths.state, ctx.paths.artifacts, runId)
  const loaded = await loadRun(runPaths)
  if (loaded === null) {
    throw new Error(`active run '${runId}' has no events; cannot approve.`)
  }

  // Resolve target phase: explicit arg or current phase from state.
  let targetPhase: Phase
  if (opts.phase !== undefined && opts.phase.length > 0) {
    const candidate = opts.phase.toLowerCase()
    if (!isPhase(candidate)) {
      throw new Error(
        `unknown phase '${opts.phase}'. Valid phases: ${PHASES.join(', ')}`,
      )
    }
    if (candidate !== loaded.state.currentPhase) {
      throw new Error(
        `current phase is '${loaded.state.currentPhase}', not '${candidate}'. Cannot approve a different phase. ` +
          'Use `code-oz approve` (no argument) to approve the current phase.',
      )
    }
    targetPhase = candidate
  } else {
    targetPhase = loaded.state.currentPhase
    const confirm = opts.confirm ?? defaultConfirm
    const ok = await confirm(
      `Approve phase '${targetPhase}' for run '${runId}'? [y/N] `,
    )
    if (!ok) {
      return Object.freeze({
        approved: false,
        phase: targetPhase,
        runId,
        nextPhase: null,
        gateExisted: false,
      })
    }
  }

  // Resolve agent for this phase from the registry. The registry
  // keepalive — which is the entire reason bootstrap exists in this
  // commit — depends on this lookup actually using the registry value.
  const agentsForPhase = ctx.registry.getByPhase(targetPhase)
  if (agentsForPhase.length === 0) {
    throw new Error(
      `no agent registered for phase '${targetPhase}'. Add an agent file to .code-oz/agents/ or rely on the bundled defaults.`,
    )
  }
  const agent = agentsForPhase[0]!

  const artifactPath = opts.artifact ?? CANONICAL_ARTIFACTS[targetPhase]

  // Per CODEX_REVIEW_M5 round 2 finding A: run the same sync path-safety
  // checks gates.ts uses BEFORE we touch the filesystem. Without this, a
  // malicious --artifact value (e.g., `../../etc/passwd`) would be read by
  // parseSpec before approveGate's later realpath/symlink check rejected
  // it. Sync check + later realpath check is the same defense-in-depth
  // pattern the wrapper already uses for manifest paths.
  const syncPathIssue = _validateArtifactSyncPath(artifactPath, runPaths.runDir)
  if (syncPathIssue !== null) {
    throw new GateLoadError([syncPathIssue])
  }

  // Per CODEX_REVIEW_M5 round 2 finding B: refuse to approve a stale
  // canonical artifact left over from a previous successful DEFINE run.
  // The current run must have written a `gate_required` event for the
  // target phase before approval is meaningful — otherwise we'd be binding
  // arbitrary artifact bytes (the prior run's SPEC.md) into the new run's
  // gate. requireGate() in src/state/run.ts is the only emitter; M5
  // DEFINE calls it after writing SPEC.md atomically, so its presence is
  // a load-bearing signal that "the artifact on disk belongs to this run."
  const events = await readEvents({
    file: runPaths.eventsFile,
    lockDir: runPaths.lockDir,
  })
  const hasGateRequired = events.some((e) => {
    if (!isKnownPhaseEvent(e)) return false
    if (e.type !== 'gate_required') return false
    return e.phase === targetPhase
  })
  if (!hasGateRequired) {
    throw new Error(
      [
        `cannot approve ${targetPhase}: this run has no \`gate_required\` event for ${targetPhase}.`,
        'A successful phase must signal it is awaiting approval (via runDefine -> requireGate)',
        'before `code-oz approve` will bind an artifact into a gate. Re-run the phase or',
        'inspect .code-oz/state/runs/<runId>/events.jsonl for context.',
      ].join('\n'),
    )
  }

  // Per CODEX_REVIEW_M5 round 1 finding #2: validate the canonical
  // artifact's structure BEFORE binding it into the gate. SPEC.md is
  // intentionally user-editable between DEFINE write and approval; if the
  // user breaks the structure during review, refuse to approve rather
  // than sha256-bind an invalid artifact. The gate writer would otherwise
  // hash the broken file and PLAN would consume it.
  if (targetPhase === 'define') {
    const fullArtifactPath = join(ctx.paths.artifacts, artifactPath)
    let raw: string
    try {
      raw = await readFile(fullArtifactPath, 'utf8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `cannot approve define: ${fullArtifactPath} does not exist. Run \`code-oz run\` first.`,
        )
      }
      throw err
    }
    try {
      parseSpec(raw, fullArtifactPath)
    } catch (err: unknown) {
      if (err instanceof SpecLoadError) {
        const summary = err.issues
          .map((i) => `  - [${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
          .join('\n')
        throw new Error(
          [
            `cannot approve define: ${fullArtifactPath} is not a valid SPEC.md.`,
            summary,
            'Edit the file to satisfy the SPEC contract before approving.',
          ].join('\n'),
        )
      }
      throw err
    }
  }

  // VERIFY-specific approval (Codex M8 decision 7 + fix 4): validate
  // VERIFY.md, confirm verdict=pass, remove the worktree, emit
  // worktree_destroyed BEFORE approveGate writes GATE_VERIFY_PASSED.json.
  // Worktree removal failure produces an error (and does NOT write the
  // gate); the user can re-attempt approval after manual cleanup.
  if (targetPhase === 'verify') {
    await preApproveVerifyHook({
      cwd: opts.cwd ?? process.cwd(),
      runId,
      runPaths,
      verifyPath: join(ctx.paths.artifacts, artifactPath),
      now: opts.now ?? (() => new Date().toISOString()),
    })
  }

  const now = opts.now ?? (() => new Date().toISOString())
  const gate: GateFile = {
    version: 1,
    runId,
    phase: targetPhase,
    artifact: artifactPath,
    agent: agent.name,
    agentProvider: agent.provider,
    approvedBy: opts.approvedBy ?? 'user',
    approvedAt: now(),
    ...(opts.notes ? { notes: opts.notes } : {}),
  }

  const result = await approveGate({
    paths: runPaths,
    gate,
    profile: loaded.state.profile,
    now,
  })

  return Object.freeze({
    approved: true,
    phase: targetPhase,
    runId,
    nextPhase: result.nextPhase,
    gateExisted: result.gateExisted,
  })
}

/**
 * VERIFY-specific pre-approval hook (M8 fix 4 + Codex decision 7):
 *   1. Read VERIFY.md from disk
 *   2. Parse it; reject malformed
 *   3. Confirm verdict=pass; reject otherwise (a failed VERIFY does not
 *      get approved — the orchestrator schedules attempt N+1)
 *   4. Remove the run worktree via git worktree remove
 *   5. Emit worktree_destroyed BEFORE approveGate writes the gate file
 *
 * Worktree removal failure throws; the gate file is NOT written. The
 * user can fix the worktree and retry. Exported for direct testing.
 */
export interface PreApproveVerifyHookInput {
  readonly cwd: string
  readonly runId: string
  readonly runPaths: { readonly eventsFile: string; readonly lockDir: string }
  readonly verifyPath: string
  readonly now: () => string
}

export async function preApproveVerifyHook(input: PreApproveVerifyHookInput): Promise<void> {
  let verifyText: string
  try {
    verifyText = await readFile(input.verifyPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `cannot approve verify: ${input.verifyPath} does not exist. Run VERIFY first.`,
      )
    }
    throw err
  }
  let verifyData: ReturnType<typeof parseVerifyReport>
  try {
    verifyData = parseVerifyReport(verifyText, input.verifyPath)
  } catch (err) {
    if (err instanceof VerifyReportLoadError) {
      const summary = err.issues
        .map((i) => `  - [${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
        .join('\n')
      throw new Error(
        [
          `cannot approve verify: ${input.verifyPath} is not a valid VERIFY.md.`,
          summary,
          'Re-run VERIFY or repair the artifact before approving.',
        ].join('\n'),
      )
    }
    throw err
  }
  if (verifyData.verdict.verdict !== 'pass') {
    throw new Error(
      [
        `cannot approve verify: VERIFY.md verdict is '${verifyData.verdict.verdict}'.`,
        'A failed VERIFY does not get approved; the orchestrator schedules attempt N+1 instead.',
      ].join('\n'),
    )
  }
  const removed = await removeRunWorktree({ cwd: input.cwd, runId: input.runId })
  if (!removed.ok) {
    // Idempotency: if the worktree is already gone (manual cleanup, or no
    // worktree was ever created — e.g., FSM regression test), treat as
    // success and skip the worktree_destroyed event (we have nothing to
    // record). Other failure modes (dirty worktree, permission denied)
    // throw and the gate is not written.
    const reason = removed.reason
    const alreadyGone =
      reason.includes('is not a working tree') ||
      reason.includes('not a git repository') ||
      reason.includes('No such file or directory')
    if (!alreadyGone) {
      throw new Error(
        `cannot approve verify: worktree removal failed (${removed.code}): ${reason}. Inspect manually and retry.`,
      )
    }
    return
  }
  await appendEvent(
    { file: input.runPaths.eventsFile, lockDir: input.runPaths.lockDir },
    {
      version: 1,
      type: 'worktree_destroyed',
      ts: input.now(),
      runId: input.runId,
      phase: 'verify',
      worktreePath: removed.worktreePath,
    },
  )
}

async function defaultConfirm(message: string): Promise<boolean> {
  if (!stdin.isTTY) {
    // Non-interactive environments must pass an explicit phase argument.
    throw new Error(
      'auto-detect requires a TTY. Pass an explicit PHASE (e.g., `code-oz approve PLAN`) or run interactively.',
    )
  }
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await rl.question(message)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

export async function approveCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
      artifact: { type: 'string' },
      notes: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  })

  if (values.help) {
    printHelp()
    return
  }

  try {
    const result = await runApprove({
      phase: positionals[0],
      artifact: values.artifact,
      notes: values.notes,
    })

    if (!result.approved) {
      stdout.write('code-oz: approval declined\n')
      return
    }

    if (result.gateExisted) {
      stdout.write(
        `code-oz: phase '${result.phase}' was already approved (idempotent recovery, no event duplication).\n`,
      )
    } else {
      stdout.write(`code-oz: approved phase '${result.phase}' for run ${result.runId}\n`)
      if (result.nextPhase !== null) {
        stdout.write(`code-oz: next phase: '${result.nextPhase}'\n`)
      } else {
        stdout.write('code-oz: run completed (terminal phase reached)\n')
      }
    }
  } catch (err: unknown) {
    if (err instanceof GateLoadError) {
      const issue = err.issues[0]!
      throw new Error(`${issue.rule}${issue.detail ? ` (${issue.detail})` : ''}`)
    }
    throw err
  }
}

function printHelp(): void {
  stdout.write(`code-oz approve — approve the current phase of the active run

Usage: code-oz approve [PHASE] [options]

Without PHASE the active run's currentPhase is approved (interactive
confirmation required). With PHASE, the argument must match the run's
currentPhase — skipping ahead or backwards is rejected.

Options:
  --artifact <path>  Override the artifact path. Default: the canonical
                     per-phase artifact (e.g., artifacts/SPEC.md for define).
                     Subject to path-safety rules (relative, normalized,
                     no '..' segments, no symlink escape from artifacts/).
  --notes <string>   Notes recorded on the gate file's 'notes' field.
  -h, --help         Show this help

Idempotency: re-running the same approve with identical content is a
no-op. Re-running with different content for an already-approved phase
fails with gate_idempotency_violation — start a new runId to redo a phase.
`)
}
