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
  approveReviewTaskGate,
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
  type LoggedEvent,
  type Phase,
  type PhaseEvent,
} from '../state/schemas.ts'
import { GateLoadError } from '../state/errors.ts'
import { _validateArtifactSyncPath } from '../state/gates.ts'
import { appendEvent, readEvents } from '../state/events.ts'
import { parseSpec } from '../artifacts/spec.ts'
import { parsePlan, type PlanArtifact } from '../artifacts/plan.ts'
import { parseBuildReport, BuildReportLoadError } from '../artifacts/build-report.ts'
import { parseVerifyReport, VerifyReportLoadError } from '../artifacts/verify-report.ts'
import {
  parseReviewReport,
  parseReviewPanelReport,
  detectReviewReportMode,
  ReviewReportLoadError,
} from '../artifacts/review-report.ts'
import { SpecLoadError } from '../artifacts/errors.ts'
import { validateAuditMarkdown } from '../artifacts/audit-schema.ts'
import { validateScientistSidecars } from '../phases/gate-preflight.ts'
import { createHash } from 'node:crypto'
import { removeRunWorktree } from '../worktree/remove-run-worktree.ts'
import {
  runPaths as worktreeRunPaths,
  buildPromptSnapshotPath,
} from '../worktree/paths.ts'
import { access } from 'node:fs/promises'

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
      'no active run found. Start a run first with `code-oz run`, then approve the current phase.',
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

  // BUILD-specific approval (M16 C5): validate BUILD_REPORT.md, confirm the
  // matching build_completed event exists, cross-check both the report sha
  // and the BUILD prompt snapshot sha. Refuse stale-attempt approvals
  // (operator reverted BUILD_REPORT.md to attempt N-1 after attempt N ran)
  // by binding the artifact's task.attempt to the latest build_completed
  // event for the (runId, taskId). Mirrors preApproveReviewHook's sha+event
  // contract — preApproveVerifyHook does NOT do event lookup, so it is the
  // wrong precedent for sha-bound post-edit detection.
  if (targetPhase === 'build') {
    await preApproveBuildHook({
      cwd: opts.cwd ?? process.cwd(),
      runId,
      runPaths,
      buildReportPath: join(ctx.paths.artifacts, artifactPath),
    })
  }

  // AUDIT-specific approval (M17 C6): validate AUDIT.md structurally, run the
  // Scientist sidecar preflight (rule 15), then confirm the on-disk AUDIT.md
  // sha matches the latest `audit_completed` event sha. Mirrors
  // preApproveBuildHook's sha+event contract (post-edit detection) — AUDIT is
  // single-shot, so there is no attempt/taskId discriminator. No
  // audit-specific gate primitive (rule 1): the dispatcher still calls the
  // generic approveGate below after the hook resolves.
  if (targetPhase === 'audit') {
    await preApproveAuditHook({
      runId,
      runPaths,
      artifactRoot: ctx.paths.artifacts,
      auditReportPath: join(ctx.paths.artifacts, artifactPath),
    })
  }

  // VERIFY-specific approval: validate VERIFY.md and confirm verdict=pass
  // BEFORE approveGate writes GATE_VERIFY_PASSED.json. Worktree removal moved
  // to REVIEW-approve (preApproveReviewHook) per CODEX_RESPONSE_M9.md
  // decision 5 + risk #1: REVIEW needs the worktree alive to read
  // changed files, so cleanup-on-VERIFY-approve would leave nothing
  // for REVIEW to read.
  if (targetPhase === 'verify') {
    await preApproveVerifyHook({
      verifyPath: join(ctx.paths.artifacts, artifactPath),
    })
  }

  // REVIEW-specific approval: validate REVIEW.md + verdict=ready, confirm the
  // matching review_resolved event exists, then remove the worktree.
  // The hook fails the gate write on artifact validation failure or
  // removal failure; the user can repair the artifact / fs state and
  // retry. Idempotent when the worktree was already destroyed.
  let reviewHookResult: PreApproveReviewHookResult | undefined
  if (targetPhase === 'review') {
    reviewHookResult = await preApproveReviewHook({
      cwd: opts.cwd ?? process.cwd(),
      runId,
      runPaths,
      reviewPath: join(ctx.paths.artifacts, artifactPath),
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

  // M16 C9: REVIEW-phase approval routes through approveReviewTaskGate
  // so the gate-write transaction is atomic with the task-loop event
  // emission. Mod #2: do NOT emit `phase_entered(ship)` until every
  // PLAN task has a matching `task_completed`. The cursor decides.
  if (targetPhase === 'review' && reviewHookResult !== undefined) {
    const planArtifact = await loadPlanForReviewApprove(ctx.paths.artifacts)
    const reviewResult = await approveReviewTaskGate({
      paths: runPaths,
      gate,
      profile: loaded.state.profile,
      plan: planArtifact,
      upstreamAttempt: reviewHookResult.upstreamRefs.attempt,
      upstreamTaskId: reviewHookResult.upstreamRefs.taskId,
      now,
    })

    return Object.freeze({
      approved: true,
      phase: targetPhase,
      runId,
      nextPhase: reviewResult.nextPhase,
      gateExisted: reviewResult.gateExisted,
    })
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
 * M16 C9 — load PLAN.md from the canonical artifact path for the
 * REVIEW-approve transaction. Re-uses the same loader the dispatcher
 * uses (kept thin so the import surface stays small). Throws on
 * malformed PLAN.md so the operator gets a specific failure rather
 * than a silent miscount.
 */
async function loadPlanForReviewApprove(artifactRoot: string): Promise<PlanArtifact> {
  const planPath = join(artifactRoot, 'PLAN.md')
  let raw: string
  try {
    raw = await readFile(planPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `cannot approve review: PLAN.md is required to compute the task cursor but ${planPath} does not exist.`,
      )
    }
    throw err
  }
  return parsePlan(raw, planPath)
}

/**
 * VERIFY-specific pre-approval hook:
 *   1. Read VERIFY.md from disk
 *   2. Parse it; reject malformed
 *   3. Confirm verdict=pass; reject otherwise (a failed VERIFY does not
 *      get approved — the orchestrator schedules attempt N+1)
 *
 * Worktree removal moved to preApproveReviewHook because REVIEW needs the
 * worktree alive to read changed files. SHIP cleanup beyond REVIEW is W4.
 *
 * Exported for direct testing.
 */
export interface PreApproveVerifyHookInput {
  readonly verifyPath: string
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
}

/**
 * BUILD-specific pre-approval hook (M16 C5):
 *
 *   1. Read BUILD_REPORT.md from disk; reject malformed (mirrors
 *      preApproveReviewHook's contract for REVIEW.md).
 *   2. Find the latest `build_completed` event for the (runId, taskId)
 *      pair from the parsed artifact. Refuse if none exists.
 *   3. Refuse with `build_attempt_stale` when BUILD_REPORT.md's
 *      task.attempt does not equal the latest event's attempt — this
 *      catches the operator-reverted-the-report case where attempt N+1
 *      ran but the on-disk report is from attempt N.
 *   4. Refuse with `build_report_post_edit` when sha256(BUILD_REPORT.md)
 *      does not match `build_completed.buildReportSha256` — same
 *      structural shape as preApproveReviewHook line 520.
 *   5. Refuse with `build_prompt_snapshot_missing` when the prompt
 *      snapshot file at
 *      `.code-oz/runs/<runId>/build-attempt-<N>.prompt.txt` is absent.
 *   6. Refuse with `build_prompt_post_edit` when sha256(prompt) does
 *      not match `build_completed.promptSnapshotSha256`.
 *
 * Exported for direct testing.
 */
export interface PreApproveBuildHookInput {
  readonly cwd: string
  readonly runId: string
  readonly runPaths: { readonly eventsFile: string; readonly lockDir: string }
  /** Absolute path to .code-oz/artifacts/BUILD_REPORT.md; passed by runApprove
   *  via canonical-artifacts mapping. */
  readonly buildReportPath: string
}

export async function preApproveBuildHook(input: PreApproveBuildHookInput): Promise<void> {
  // 1. Read + parse BUILD_REPORT.md.
  let buildReportText: string
  try {
    buildReportText = await readFile(input.buildReportPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `cannot approve build: ${input.buildReportPath} does not exist. Run BUILD first.`,
      )
    }
    throw err
  }
  let reportData: ReturnType<typeof parseBuildReport>
  try {
    reportData = parseBuildReport(buildReportText)
  } catch (err) {
    if (err instanceof BuildReportLoadError) {
      const summary = err.issues
        .map((i) => `  - [${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
        .join('\n')
      throw new Error(
        [
          `cannot approve build: ${input.buildReportPath} is not a valid BUILD_REPORT.md.`,
          summary,
          'Re-run BUILD or repair the artifact before approving.',
        ].join('\n'),
      )
    }
    throw err
  }
  const taskId = reportData.task.taskId
  const reportAttempt = reportData.task.attempt

  // 2 + 3. Find the latest build_completed for (runId, taskId) and assert
  //         attempt parity with the on-disk report.
  const events = await readEvents({
    file: input.runPaths.eventsFile,
    lockDir: input.runPaths.lockDir,
  })
  const latest = findLatestBuildCompletedFor(events, input.runId, taskId)
  if (latest === null) {
    throw new Error(
      [
        `cannot approve build: events.jsonl has no build_completed event for taskId=${taskId}.`,
        'BUILD must complete and emit build_completed before approval.',
      ].join('\n'),
    )
  }
  if (latest.attempt !== reportAttempt) {
    throw new Error(
      [
        `cannot approve build: BUILD_REPORT.md task.attempt is ${reportAttempt}, but the latest build_completed event for taskId=${taskId} is attempt=${latest.attempt}.`,
        'A stale BUILD_REPORT.md cannot be approved. Re-run BUILD to produce a fresh report or restore the canonical attempt-N report.',
      ].join('\n'),
    )
  }

  // 4. Cross-check BUILD_REPORT.md sha against the event.
  const buildReportSha = sha256Of(buildReportText)
  if (latest.buildReportSha256 !== buildReportSha) {
    throw new Error(
      [
        `cannot approve build: BUILD_REPORT.md sha256 (${buildReportSha}) does not match the build_completed event sha (${latest.buildReportSha256}).`,
        'The artifact on disk diverged from what BUILD emitted. Re-run BUILD or restore the canonical artifact.',
      ].join('\n'),
    )
  }

  // 5 + 6. Cross-check the prompt snapshot.
  const promptPath = buildPromptSnapshotPath(input.cwd, input.runId, latest.attempt)
  let promptText: string
  try {
    promptText = await readFile(promptPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        [
          `cannot approve build: BUILD prompt snapshot ${promptPath} does not exist.`,
          'BUILD must persist the composed prompt at <runId>/build-attempt-<N>.prompt.txt before approval.',
        ].join('\n'),
      )
    }
    throw err
  }
  const promptSha = sha256Of(promptText)
  if (latest.promptSnapshotSha256 !== promptSha) {
    throw new Error(
      [
        `cannot approve build: BUILD prompt snapshot sha256 (${promptSha}) does not match the build_completed event sha (${latest.promptSnapshotSha256}).`,
        'The persisted prompt diverged from what BUILD emitted. Re-run BUILD or restore the canonical snapshot.',
      ].join('\n'),
    )
  }
}

type BuildCompletedEventShape = Extract<PhaseEvent, { readonly type: 'build_completed' }>

function findLatestBuildCompletedFor(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): BuildCompletedEventShape | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (
      isKnownPhaseEvent(e) &&
      e.type === 'build_completed' &&
      e.runId === runId &&
      e.taskId === taskId
    ) {
      return e
    }
  }
  return null
}

/**
 * AUDIT-specific pre-approval hook (M17 C6). Mirrors preApproveBuildHook's
 * event+sha contract, adapted to the single-shot brownfield AUDIT phase:
 *
 *   1. Read AUDIT.md from disk; reject ENOENT with an actionable message.
 *   2. Run `validateAuditMarkdown`; reject malformed with the schema's
 *      issue list (mirrors preApproveBuildHook's BUILD_REPORT.md handling).
 *   3. Run `validateScientistSidecars` (rule 15): HYPOTHESES.md +
 *      OPEN_QUESTIONS.md must exist, parse, and carry no blocking/overdue
 *      open questions. Reject on failure with the preflight's actionable
 *      suggestions.
 *   4. Find the latest `audit_completed` event for the runId. Refuse if
 *      none exists (AUDIT must complete and emit audit_completed first).
 *   5. Refuse when sha256(AUDIT.md) does not match
 *      `audit_completed.auditReportSha256` — same structural shape as
 *      preApproveBuildHook's :500-503 post-edit detection.
 *
 * On success it returns/continues so `runApprove` calls the GENERIC
 * approveGate (rule 1: no audit-specific gate-write primitive). Exported for
 * direct testing — the brownfield e2e cannot reach approve until the auditor
 * persona is registered, so C6's RED coverage is fixture-based.
 */
export interface PreApproveAuditHookInput {
  readonly runId: string
  readonly runPaths: { readonly eventsFile: string; readonly lockDir: string }
  /** `.code-oz/artifacts/` — where AUDIT.md + the Scientist sidecars live. */
  readonly artifactRoot: string
  /** Absolute path to .code-oz/artifacts/AUDIT.md; passed by runApprove via
   *  the canonical-artifacts mapping. */
  readonly auditReportPath: string
  /** ISO YYYY-MM-DD for the sidecar overdue check; defaults to today (UTC). */
  readonly today?: string
}

export async function preApproveAuditHook(input: PreApproveAuditHookInput): Promise<void> {
  // 1. Read AUDIT.md.
  let auditText: string
  try {
    auditText = await readFile(input.auditReportPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `cannot approve audit: ${input.auditReportPath} does not exist. Run AUDIT first.`,
      )
    }
    throw err
  }

  // 2. Structural validation (validateAuditMarkdown returns ok+issues; it
  //    never throws on a malformed artifact).
  const validation = validateAuditMarkdown(auditText, { file: input.auditReportPath })
  if (!validation.ok) {
    const summary = validation.issues
      .map((i) => `  - [${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
      .join('\n')
    throw new Error(
      [
        `cannot approve audit: ${input.auditReportPath} is not a valid AUDIT.md.`,
        summary,
        'Re-run AUDIT or repair the artifact before approving.',
      ].join('\n'),
    )
  }

  // 3. Scientist sidecars (rule 15). The phase-tail writes HYPOTHESES.md +
  //    OPEN_QUESTIONS.md after AUDIT.md; the gate cannot pass with missing,
  //    unparsable, blocking, or overdue sidecars.
  const sidecarCheck = await validateScientistSidecars({
    artifactRoot: input.artifactRoot,
    phase: 'audit',
    ...(input.today !== undefined ? { today: input.today } : {}),
  })
  if (!sidecarCheck.ok) {
    throw new Error(
      [
        `cannot approve audit: Scientist sidecar preflight failed (${sidecarCheck.code}).`,
        sidecarCheck.rule + (sidecarCheck.detail ? `: ${sidecarCheck.detail}` : ''),
        ...sidecarCheck.actionableSuggestions.map((s) => `  - ${s}`),
      ].join('\n'),
    )
  }

  // 4. Find the latest audit_completed for the run.
  const events = await readEvents({
    file: input.runPaths.eventsFile,
    lockDir: input.runPaths.lockDir,
  })
  const latest = findLatestAuditCompletedFor(events, input.runId)
  if (latest === null) {
    throw new Error(
      [
        `cannot approve audit: events.jsonl has no audit_completed event for run ${input.runId}.`,
        'AUDIT must complete and emit audit_completed before approval.',
      ].join('\n'),
    )
  }

  // 5. Cross-check AUDIT.md sha against the event (post-edit detection).
  const auditReportSha = sha256Of(auditText)
  if (latest.auditReportSha256 !== auditReportSha) {
    throw new Error(
      [
        `cannot approve audit: AUDIT.md sha256 (${auditReportSha}) does not match the audit_completed event sha (${latest.auditReportSha256}).`,
        'The artifact on disk diverged from what AUDIT emitted. Re-run AUDIT or restore the canonical artifact.',
      ].join('\n'),
    )
  }
}

type AuditCompletedEventShape = Extract<PhaseEvent, { readonly type: 'audit_completed' }>

function findLatestAuditCompletedFor(
  events: readonly LoggedEvent[],
  runId: string,
): AuditCompletedEventShape | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (isKnownPhaseEvent(e) && e.type === 'audit_completed' && e.runId === runId) {
      return e
    }
  }
  return null
}

/**
 * REVIEW-specific pre-approval hook:
 *
 *   1. Read REVIEW.md from disk; reject malformed (mirrors
 *      preApproveVerifyHook's contract for VERIFY.md).
 *   2. Reject `Score.Final verdict !== 'ready'`. A `block` or
 *      `needs-revision` REVIEW.md must NOT be approvable; that path
 *      already has its own terminal interventions, and approving it
 *      would write a misleading GATE_REVIEW_PASSED.json.
 *   3. Verify a `review_resolved` event for the same (taskId, attempt)
 *      with matching `reviewReportSha256`. The event is what runReview
 *      emits when it lands a canonical 'ready' exit; missing or
 *      sha-mismatched event means the artifact on disk did not come
 *      from this run's REVIEW orchestrator (rule 1: artifact-based
 *      gate signals are load-bearing — REVIEW.md must agree with the
 *      events.jsonl record).
 *   4. Remove the run worktree via `git worktree remove --force`.
 *   5. Emit `worktree_destroyed` (phase: review) before approveGate
 *      writes GATE_REVIEW_PASSED.json.
 *
 * Idempotent when the worktree is already gone (manual cleanup or a
 * resume scenario): no event is emitted, no error is thrown — but
 * artifact validation still runs first, so a corrupted REVIEW.md still
 * blocks the gate even when the worktree is already destroyed.
 *
 * Real removal failures (dirty fs, permission) throw and block gate
 * write. Exported for direct testing.
 *
 * M16 C9: returns the validated `upstreamRefs` (taskId, attempt) +
 * the REVIEW.md sha so `runApprove` can pass them to the new
 * `approveReviewTaskGate` primitive without re-parsing the artifact.
 * The primitive uses the refs to assert the matching `review_resolved`
 * event AND to source `task_completed` from the canonical task
 * coordinates.
 */
export interface PreApproveReviewHookInput {
  readonly cwd: string
  readonly runId: string
  readonly runPaths: { readonly eventsFile: string; readonly lockDir: string }
  /** Absolute path to .code-oz/artifacts/REVIEW.md; passed by runApprove
   *  via canonical-artifacts mapping. */
  readonly reviewPath: string
  readonly now: () => string
}

export interface PreApproveReviewHookResult {
  readonly upstreamRefs: { readonly taskId: string; readonly attempt: number }
  readonly reviewReportSha256: string
}

export async function preApproveReviewHook(
  input: PreApproveReviewHookInput,
): Promise<PreApproveReviewHookResult> {
  // 1. Validate REVIEW.md (mirror preApproveVerifyHook).
  let reviewText: string
  try {
    reviewText = await readFile(input.reviewPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `cannot approve review: ${input.reviewPath} does not exist. Run REVIEW first.`,
      )
    }
    throw err
  }

  // Codex M14 R1 finding #2: dispatch to the mode-correct parser. Single
  // mode uses parseReviewReport; panel mode uses parseReviewPanelReport.
  // Panel artifacts carry `## Reviewers` (plural) instead of `## Reviewer`,
  // so the single-mode parser would reject them as malformed even when
  // the panel artifact is canonical.
  const mode = detectReviewReportMode(reviewText)
  if (mode === 'unknown') {
    throw new Error(
      [
        `cannot approve review: ${input.reviewPath} contains neither '## Reviewer' nor '## Reviewers' (or both).`,
        'The REVIEW.md grammar must declare exactly one of single-reviewer or panel mode.',
        'Re-run REVIEW or repair the artifact before approving.',
      ].join('\n'),
    )
  }

  // Common upstream-ref shape (same on single + panel data).
  let upstreamRefs: { readonly taskId: string; readonly attempt: number }
  let finalVerdict: string
  if (mode === 'panel') {
    let panelData: ReturnType<typeof parseReviewPanelReport>
    try {
      panelData = parseReviewPanelReport(reviewText, input.reviewPath)
    } catch (err) {
      if (err instanceof ReviewReportLoadError) {
        const summary = err.issues
          .map((i) => `  - [${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
          .join('\n')
        throw new Error(
          [
            `cannot approve review: ${input.reviewPath} is not a valid panel REVIEW.md.`,
            summary,
            'Re-run REVIEW or repair the artifact before approving.',
          ].join('\n'),
        )
      }
      throw err
    }
    upstreamRefs = panelData.upstreamRefs
    finalVerdict = panelData.score.finalVerdict
  } else {
    let reviewData: ReturnType<typeof parseReviewReport>
    try {
      reviewData = parseReviewReport(reviewText, input.reviewPath)
    } catch (err) {
      if (err instanceof ReviewReportLoadError) {
        const summary = err.issues
          .map((i) => `  - [${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
          .join('\n')
        throw new Error(
          [
            `cannot approve review: ${input.reviewPath} is not a valid REVIEW.md.`,
            summary,
            'Re-run REVIEW or repair the artifact before approving.',
          ].join('\n'),
        )
      }
      throw err
    }
    upstreamRefs = reviewData.upstreamRefs
    finalVerdict = reviewData.score.finalVerdict
  }
  if (finalVerdict !== 'ready') {
    throw new Error(
      [
        `cannot approve review: REVIEW.md Final verdict is '${finalVerdict}'.`,
        'Only verdict=ready REVIEW.md can be approved (CLAUDE.md non-negotiable rule 6).',
      ].join('\n'),
    )
  }

  // 2. Cross-check against events.jsonl. Both single-reviewer runReview
  //    and panel-mode runReview emit `review_resolved` on a ready exit
  //    (panel emission added in F1, finding #1 closure), so this check
  //    is mode-agnostic. The sha must match the canonical artifact.
  const reviewSha256 = sha256Of(reviewText)
  const events = await readEvents({
    file: input.runPaths.eventsFile,
    lockDir: input.runPaths.lockDir,
  })
  const resolved = findReviewResolvedFor(
    events,
    input.runId,
    upstreamRefs.taskId,
    upstreamRefs.attempt,
  )
  if (resolved === null) {
    // Panel-mode fallback: per F2 contract, accept review_panel_completed
    // with panelVerdict='ready' as the ready-event substitute when no
    // review_resolved is present. F1 typically emits both; this branch
    // covers operator-driven approvals on artifacts produced by older
    // panel runs that pre-date the F1 review_resolved emission.
    if (mode === 'panel') {
      const panelCompleted = findReviewPanelCompletedFor(
        events,
        input.runId,
        upstreamRefs.taskId,
        upstreamRefs.attempt,
      )
      if (panelCompleted === null) {
        throw new Error(
          [
            `cannot approve review: no review_resolved or review_panel_completed event for taskId=${upstreamRefs.taskId} attempt=${upstreamRefs.attempt}.`,
            'Panel-mode REVIEW must reach a canonical ready exit before approval.',
          ].join('\n'),
        )
      }
      if (panelCompleted.panelVerdict !== 'ready') {
        throw new Error(
          [
            `cannot approve review: review_panel_completed event has panelVerdict='${panelCompleted.panelVerdict}'.`,
            'Only panelVerdict=ready panel REVIEW.md can be approved.',
          ].join('\n'),
        )
      }
      if (panelCompleted.reviewReportSha256 !== reviewSha256) {
        throw new Error(
          [
            `cannot approve review: panel REVIEW.md sha256 (${reviewSha256}) does not match the review_panel_completed event sha (${panelCompleted.reviewReportSha256}).`,
            'The artifact on disk diverged from what runReviewPanel emitted. Re-run REVIEW or restore the canonical artifact.',
          ].join('\n'),
        )
      }
    } else {
      throw new Error(
        [
          `cannot approve review: no review_resolved event for taskId=${upstreamRefs.taskId} attempt=${upstreamRefs.attempt}.`,
          'REVIEW must reach a canonical ready exit (and emit review_resolved) before approval.',
        ].join('\n'),
      )
    }
  } else if (resolved.reviewReportSha256 !== reviewSha256) {
    throw new Error(
      [
        `cannot approve review: REVIEW.md sha256 (${reviewSha256}) does not match the review_resolved event sha (${resolved.reviewReportSha256}).`,
        'The artifact on disk diverged from what REVIEW emitted. Re-run REVIEW or restore the canonical artifact.',
      ].join('\n'),
    )
  }

  // 3. Resolve the attempt for the worktree_destroyed event from the
  //    validated REVIEW.md upstream refs (the artifact is now the
  //    source of truth; build_provider_recorded is still validated as
  //    a defense-in-depth check below).
  const attempt = upstreamRefs.attempt
  const buildProviderEvent = events
    .filter((e) =>
      isBuildProviderRecordedEventFor(
        e,
        upstreamRefs.taskId,
        attempt,
      ),
    )
    .reverse()
    .at(0)
  if (buildProviderEvent === undefined) {
    throw new Error(
      [
        `cannot approve review: events.jsonl has no build_provider_recorded for taskId=${upstreamRefs.taskId} attempt=${attempt}.`,
        'BUILD must complete and emit build_provider_recorded before REVIEW can be approved.',
      ].join('\n'),
    )
  }

  // 4. Worktree removal (idempotent on missing).
  const worktreeDir = worktreeRunPaths(input.cwd, input.runId).worktree
  let worktreeExists = true
  try {
    await access(worktreeDir)
  } catch {
    worktreeExists = false
  }

  const result: PreApproveReviewHookResult = Object.freeze({
    upstreamRefs: Object.freeze({
      taskId: upstreamRefs.taskId,
      attempt: upstreamRefs.attempt,
    }),
    reviewReportSha256: reviewSha256,
  })

  if (!worktreeExists) {
    return result
  }
  const removed = await removeRunWorktree({ cwd: input.cwd, runId: input.runId })
  if (!removed.ok) {
    const reason = removed.reason
    const alreadyGone =
      reason.includes('is not a working tree') ||
      reason.includes('not a git repository') ||
      reason.includes('No such file or directory')
    if (!alreadyGone) {
      throw new Error(
        `cannot approve review: worktree removal failed (${removed.code}): ${reason}. Inspect manually and retry.`,
      )
    }
    // Race: directory existed at pre-check but was gone by removal call.
    // Idempotent return.
    return result
  }

  await appendEvent(
    { file: input.runPaths.eventsFile, lockDir: input.runPaths.lockDir },
    {
      version: 1,
      type: 'worktree_destroyed',
      ts: input.now(),
      runId: input.runId,
      phase: 'review',
      attempt,
      worktreePath: removed.worktreePath,
    },
  )

  return result
}

function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

type ResolvedReviewEventShape = Extract<PhaseEvent, { readonly type: 'review_resolved' }>

function findReviewResolvedFor(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
  attempt: number,
): ResolvedReviewEventShape | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (isReviewResolvedEventFor(e, runId, taskId, attempt)) return e
  }
  return null
}

function isReviewResolvedEventFor(
  event: LoggedEvent,
  runId: string,
  taskId: string,
  attempt: number,
): event is ResolvedReviewEventShape {
  return (
    isKnownPhaseEvent(event) &&
    event.type === 'review_resolved' &&
    event.runId === runId &&
    event.taskId === taskId &&
    event.attempt === attempt &&
    typeof event.reviewReportSha256 === 'string'
  )
}

function isBuildProviderRecordedEventFor(
  event: LoggedEvent,
  taskId: string,
  attempt: number,
): event is Extract<PhaseEvent, { readonly type: 'build_provider_recorded' }> {
  return (
    isKnownPhaseEvent(event) &&
    event.type === 'build_provider_recorded' &&
    event.taskId === taskId &&
    event.attempt === attempt
  )
}

type PanelCompletedEventShape = Extract<
  PhaseEvent,
  { readonly type: 'review_panel_completed' }
>

function findReviewPanelCompletedFor(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
  attempt: number,
): PanelCompletedEventShape | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (
      isKnownPhaseEvent(e) &&
      e.type === 'review_panel_completed' &&
      e.runId === runId &&
      e.taskId === taskId &&
      e.attempt === attempt
    ) {
      return e
    }
  }
  return null
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
