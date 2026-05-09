// VERIFY phase orchestration (M8 commit 10 + M8 fix 1).
//
// Ordering (post-Codex review fix-first verdict, finding bp#1):
//
//   1. Read BUILD_REPORT.md, validate task/attempt binding
//   2. Emit verify_started
//   3. Run the validation command via the test-runner seam (commit 3)
//   4. Evaluate the mutation gate (commit 6)
//   5. Compute orchestrator-owned fields (Verdict.Verdict, Mutation.Status, Evidence)
//   6. Compose the persona prompt INCLUDING evidence + mutation + computed verdict
//   7. Invoke the persona for ONLY persona-owned fields:
//        - Rationale (always)
//        - Failure summary + Constraint (only when verdict=fail)
//   8. Parse the persona's small structured response; on parse fail,
//      run ONE repair turn naming the violation
//   9. Merge persona fields into orchestrator-owned fields → VerifyReportData
//  10. Round-trip serialize/parse for grammar lock-in
//  11. Atomic write VERIFY.md
//  12. Run the Scientist phase-tail (rule 15) — BOTH pass and fail branches
//  13. On pass: emit verify_completed
//  14. On fail: write forensics bundle, emit worktree_forensics_preserved
//      then verify_failed, decide restart
//
// Why the reorder: the persona must ground Rationale in concrete
// evidence (exit code, duration, termination reason, mutation status).
// Asking it to author evidence-grounded text BEFORE the runner has
// produced evidence is structurally backwards. Codex review M8 finding
// bp#1.
//
// Cleanup-on-approval per Codex M8 decision 7 reject-with-alternative:
// the worktree is NOT destroyed by runVerify on a pass. The
// `code-oz approve verify` CLI does that step (M8 fix 4).
//
// The runner and revertSeam are dependency-injected so this module is
// fully testable without spawning real subprocesses. The orchestrator's
// only impure operations are atomicWriteFile (VERIFY.md), appendEvent
// (events.jsonl), the forensics bundle writes (on fail), and the
// recordVerifyIntervention helper (M8 fix 2) for durable interventions.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentDefinition } from '../agents/schema.ts'
import type { InvokeContext } from '../providers/invoke.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import {
  parseBuildReport,
  BuildReportLoadError,
  type BuildReportCarryForward,
} from '../artifacts/build-report.ts'
import {
  parseVerifyReport,
  serializeVerifyReport,
  VerifyReportLoadError,
  VERIFY_RATIONALE_MAX_CHARS,
  VERIFY_FAILURE_SUMMARY_MAX_CHARS,
  VERIFY_CONSTRAINT_MAX_CHARS,
  type VerifyReportData,
} from '../artifacts/verify-report.ts'
import { composeVerifyPrompt } from '../prompts/index.ts'
import { runScientistPhaseTail } from './scientist.ts'
import {
  evaluateMutation,
  type ChangedFileEntry,
  type RevertSeam,
  type RunnerSeam,
  type MutationStatusResult,
  type RunnerResultShape,
} from './verify-mutation.ts'
import { decideRestart, prepareCarryForward } from './restart-policy.ts'
import {
  appendEvent,
  type EventLogPaths,
} from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { LockBusyError, withLock } from '../state/lock.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
import { writeVerifyForensicsBundle } from '../worktree/forensics.ts'

export const VERIFY_READY_SIGNAL = '<verify-ready/>'

export interface RunVerifyOptions {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly cwd: string
  readonly verifierAgent: AgentDefinition
  readonly scientistAgent: AgentDefinition
  readonly taskId: string
  /** The BUILD attempt being verified (must match BUILD_REPORT.md.task.attempt). */
  readonly attempt: number
  /** Frozen patch text — used as the attempt-N.patch forensics extra on fail. */
  readonly attemptPatchContent: string
  /** Snapshot of the BUILD persona prompt that produced this attempt. */
  readonly buildPromptSnapshot: string
  /** Wrapper-layer context for invoking the Scientist tail. */
  readonly invokeCtx: InvokeContext
  /**
   * Persona-response shim. Returns the persona's raw draft text. Called up
   * to twice: initial draft + at most one repair (Codex M8 decision 9).
   * The composed prompt includes evidence + mutation + computed-verdict
   * context appended after the static system template, so the persona's
   * Rationale + Failure summary + Constraint can be evidence-grounded.
   */
  readonly invokePersona: (composedPrompt: string) => Promise<string>
  /** Test-runner seam (commit 3). */
  readonly runner: RunnerSeam
  /** Revert seam for mutation gate (commit 6). */
  readonly revertSeam: RevertSeam
  /** Override default test-file suffix (defaults to '.test.ts'). */
  readonly testSuffix?: string
  readonly now?: () => string
}

export interface VerifyCompleted {
  readonly status: 'completed'
  readonly verifyReportPath: string
  readonly verifyReportSha256: string
  readonly mutationStatus: 'pass' | 'not-applicable'
}

export interface VerifyFailed {
  readonly status: 'failed'
  readonly verifyReportPath: string
  readonly forensicsPath: string
  /** Task whose VERIFY just failed; the scheduler scopes restart events by it. */
  readonly taskId: string
  /** Just-failed attempt N (1..4 for restart, ≥4 → intervention). */
  readonly attempt: number
  readonly nextAction: 'restart' | 'intervention'
  readonly nextAttempt?: number
  readonly carryForward?: BuildReportCarryForward
}

export interface VerifyIntervention {
  readonly status: 'intervention'
  readonly code: string
  readonly rule: string
}

export type VerifyResult = VerifyCompleted | VerifyFailed | VerifyIntervention

const SHA = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

function eventPathsFor(paths: RunPaths): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

function gatePathsFor(paths: RunPaths): GatePaths {
  return {
    runDir: paths.runDir,
    artifactRoot: paths.artifactRoot,
    lockDir: paths.lockDir,
  }
}

interface InterventionContext {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly agent: string
  readonly attempt: number
  readonly taskId: string
  readonly now: () => string
}

/**
 * Durable VERIFY intervention per CLAUDE.md rule 1 (file-based gates) +
 * rule 11 (NEEDS_INTERVENTION.json on cap). Writes the gate file AND
 * appends an `intervention` event so the run state survives restart.
 * Codex review M8 finding bp#2.
 */
async function recordVerifyIntervention(
  ctx: InterventionContext,
  code: string,
  rule: string,
  detail?: string,
): Promise<VerifyIntervention> {
  const eventPaths = eventPathsFor(ctx.runPaths)
  const gatePaths = gatePathsFor(ctx.runPaths)
  await writeNeedsInterventionGate(gatePaths, {
    version: 1,
    runId: ctx.runId,
    phase: 'verify',
    agent: ctx.agent,
    code,
    rule,
    detail,
    actionableSuggestions: actionableSuggestionsFor(code),
    createdAt: ctx.now(),
  })
  await appendEvent(eventPaths, {
    version: 1,
    type: 'intervention',
    ts: ctx.now(),
    runId: ctx.runId,
    phase: 'verify',
    code,
  })
  return Object.freeze({ status: 'intervention' as const, code, rule })
}

function actionableSuggestionsFor(code: string): readonly string[] {
  switch (code) {
    case 'verify_build_report_missing':
      return Object.freeze([
        'Confirm BUILD completed for this attempt and BUILD_REPORT.md was atomically written.',
        'Inspect events.jsonl for build_completed; if absent, BUILD failed prior to writing the report.',
      ])
    case 'verify_build_report_invalid':
      return Object.freeze([
        'BUILD_REPORT.md failed to parse. Inspect the artifact for hand-edits or partial writes.',
      ])
    case 'verify_build_ref_mismatch':
      return Object.freeze([
        'The BUILD attempt being verified does not match the orchestrator-supplied taskId/attempt.',
        'This is a routing bug; do not retry without correcting the orchestrator state.',
      ])
    case 'verify_persona_invoke_failed':
      return Object.freeze(['The verifier persona invocation threw. Inspect provider logs.'])
    case 'verify_persona_missing_ready_signal':
      return Object.freeze([
        `The verifier persona did not emit ${VERIFY_READY_SIGNAL}. Confirm the persona prompt is correct.`,
      ])
    case 'verify_validation_failed':
      return Object.freeze([
        'Persona response failed grammar validation after the repair turn. Inspect VERIFY.draft.md.',
      ])
    case 'verify_runner_failed':
      return Object.freeze([
        'The validation runner threw. Inspect captured logs and the runner seam.',
      ])
    case 'verify_mutation_failed':
      return Object.freeze([
        'The mutation gate threw. Inspect captured logs and the revert seam.',
      ])
    case 'verify_restart_cap_exceeded':
      return Object.freeze([
        'The 4-attempt cap was reached. Inspect each attempt forensics and PLAN task scope.',
        'Manual remediation: fix the root cause and resubmit a corrected PLAN, OR escalate.',
      ])
    case 'verify_scientist_tail_failed':
      return Object.freeze([
        'The Scientist phase-tail produced an intervention. Inspect HYPOTHESES.md and OPEN_QUESTIONS.md drafts.',
      ])
    case 'verify_forensics_failed':
      return Object.freeze([
        'The forensics bundle write failed. The failed worktree state is not durable; manual recovery needed.',
      ])
    default:
      return Object.freeze(['Inspect VERIFY.md, events.jsonl, and the relevant forensics directory.'])
  }
}

/**
 * Mkdir-as-mutex over the runVerify orchestration (M16 C4). Two concurrent
 * runVerify calls for the same runId would otherwise both read
 * BUILD_REPORT.md, both invoke the verifier persona, both run the
 * validation command, and both write verify_completed events with
 * divergent results. The orchestration body is held for the duration of
 * the persona + runner invocation (seconds to minutes); this is a
 * SEPARATE dir from runPaths.lockDir (which serializes appendEvent /
 * writeGate) so concurrent status reads and gate writes for unrelated
 * phases stay unblocked.
 *
 * On `LockBusyError`, the function returns `verify_already_in_flight`
 * intervention without writing a gate file — mirrors review.ts:560-572
 * and the runBuild lock at build.ts. The lock-busy case has not changed
 * run state, so there is no durable orchestration outcome to record.
 */
export async function runVerify(opts: RunVerifyOptions): Promise<VerifyResult> {
  const verifyLockDir = join(opts.runPaths.runDir, '.verify.lock')
  try {
    return await withLock(verifyLockDir, () => runVerifyInner(opts))
  } catch (err) {
    if (err instanceof LockBusyError) {
      return Object.freeze({
        status: 'intervention' as const,
        code: 'verify_already_in_flight',
        rule: `another runVerify is in progress for run ${opts.runId} (lock at ${verifyLockDir})`,
      })
    }
    throw err
  }
}

async function runVerifyInner(opts: RunVerifyOptions): Promise<VerifyResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const eventPaths = eventPathsFor(opts.runPaths)
  const interventionCtx: InterventionContext = {
    runPaths: opts.runPaths,
    runId: opts.runId,
    agent: opts.verifierAgent.name,
    attempt: opts.attempt,
    taskId: opts.taskId,
    now,
  }

  // 1. Read BUILD_REPORT.md
  const buildReportPath = join(opts.runPaths.artifactRoot, 'BUILD_REPORT.md')
  let buildReportText: string
  try {
    buildReportText = await readFile(buildReportPath, 'utf8')
  } catch (err) {
    return recordVerifyIntervention(
      interventionCtx,
      'verify_build_report_missing',
      `BUILD_REPORT.md not readable: ${(err as Error).message.slice(0, 200)}`,
    )
  }
  const buildReportSha256 = SHA(buildReportText)

  let buildReport: ReturnType<typeof parseBuildReport>
  try {
    buildReport = parseBuildReport(buildReportText)
  } catch (err) {
    const reason =
      err instanceof BuildReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
    return recordVerifyIntervention(interventionCtx, 'verify_build_report_invalid', reason)
  }

  // BUILD ref binding check.
  if (buildReport.task.taskId !== opts.taskId) {
    return recordVerifyIntervention(
      interventionCtx,
      'verify_build_ref_mismatch',
      `BUILD_REPORT.md taskId=${buildReport.task.taskId} != opts.taskId=${opts.taskId}`,
    )
  }
  if (buildReport.task.attempt !== opts.attempt) {
    return recordVerifyIntervention(
      interventionCtx,
      'verify_build_ref_mismatch',
      `BUILD_REPORT.md attempt=${buildReport.task.attempt} != opts.attempt=${opts.attempt}`,
    )
  }

  // 2. Emit verify_started.
  await appendEvent(eventPaths, {
    version: 1,
    type: 'verify_started',
    ts: now(),
    runId: opts.runId,
    phase: 'verify',
    agent: opts.verifierAgent.name,
    attempt: opts.attempt,
    taskId: opts.taskId,
    baseCommitSha: buildReport.base.baseCommitSha,
    patchSha256: buildReport.patch.patchSha256,
    buildReportSha256,
  })

  // 3. Run the validation command. Errors produce durable intervention.
  const stdoutLogPath = join(opts.runPaths.runDir, 'forensics', String(opts.attempt), 'stdout.log')
  const stderrLogPath = join(opts.runPaths.runDir, 'forensics', String(opts.attempt), 'stderr.log')
  const cwd = resolveWorktreeCwd(opts.cwd, buildReport.validationCommand.workingDirectory, opts.runId)

  let runnerResult: RunnerResultShape
  try {
    runnerResult = await opts.runner({
      command: buildReport.validationCommand.command,
      cwd,
      timeoutMs: buildReport.validationCommand.timeoutMs,
      stdoutLogPath,
      stderrLogPath,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })
  } catch (err) {
    return recordVerifyIntervention(
      interventionCtx,
      'verify_runner_failed',
      `runner threw: ${(err as Error).message.slice(0, 200)}`,
    )
  }

  // 4. Evaluate the mutation gate.
  const changedFiles: readonly ChangedFileEntry[] = buildReport.changedFiles.map((f) => ({
    path: f.path,
    sha256: f.sha256,
    change: f.change,
  }))
  let mutationResult: MutationStatusResult
  try {
    mutationResult = await evaluateMutation({
      changedFiles,
      baseCommitSha: buildReport.base.baseCommitSha,
      command: buildReport.validationCommand.command,
      cwd,
      timeoutMs: buildReport.validationCommand.timeoutMs,
      expectedExitCode: buildReport.validationCommand.expectedExitCode,
      stdoutLogPath: join(opts.runPaths.runDir, 'forensics', String(opts.attempt), 'mutation-stdout.log'),
      stderrLogPath: join(opts.runPaths.runDir, 'forensics', String(opts.attempt), 'mutation-stderr.log'),
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
      testSuffix: opts.testSuffix,
      runner: opts.runner,
      revertSeam: opts.revertSeam,
    })
  } catch (err) {
    return recordVerifyIntervention(
      interventionCtx,
      'verify_mutation_failed',
      `mutation evaluation threw: ${(err as Error).message.slice(0, 200)}`,
    )
  }

  // 5. Compute orchestrator-owned binary verdict.
  const exitMatchesExpected =
    runnerResult.terminationReason === 'exit' &&
    runnerResult.exitCode === buildReport.validationCommand.expectedExitCode
  const mutationOk =
    mutationResult.status === 'pass' || mutationResult.status === 'not-applicable'
  const computedVerdict: 'pass' | 'fail' = exitMatchesExpected && mutationOk ? 'pass' : 'fail'

  // 6 + 7 + 8. Compose persona prompt with evidence + mutation + computed
  // verdict context, invoke for persona-owned fields, parse, repair-once.
  const systemPrompt = await composeVerifyPrompt({
    agentBody: opts.verifierAgent.body,
    readySignal: VERIFY_READY_SIGNAL,
    availableTools: collectToolNames(opts.verifierAgent),
  })
  const evidenceContext = renderEvidenceContext({
    taskId: opts.taskId,
    attempt: opts.attempt,
    validationCommand: buildReport.validationCommand,
    runnerResult,
    mutationResult,
    computedVerdict,
    stdoutLogPath,
    stderrLogPath,
  })

  const personaResponse = await invokeWithRepair({
    invokePersona: opts.invokePersona,
    systemPrompt,
    evidenceContext,
    expectedVerdict: computedVerdict,
  })
  if (!personaResponse.ok) {
    // Persist both rejected drafts so the operator can inspect the
    // exact failure (Codex review M8-fix fix-soon #1). Drafts are
    // written before recordVerifyIntervention so the actionable
    // suggestion's pointer at VERIFY.draft.md actually resolves.
    await persistRejectedDrafts({
      artifactRoot: opts.runPaths.artifactRoot,
      drafts: personaResponse.drafts ?? [],
    })
    return recordVerifyIntervention(interventionCtx, personaResponse.code, personaResponse.reason)
  }

  // 9. Merge persona fields with orchestrator fields.
  const verifyData: VerifyReportData = {
    buildRef: {
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256,
      taskId: opts.taskId,
      attempt: opts.attempt,
      baseCommitSha: buildReport.base.baseCommitSha,
      patchSha256: buildReport.patch.patchSha256,
    },
    validationCommand: {
      command: buildReport.validationCommand.command,
      workingDirectory: buildReport.validationCommand.workingDirectory,
      timeoutMs: buildReport.validationCommand.timeoutMs,
      expectedExitCode: buildReport.validationCommand.expectedExitCode,
    },
    evidence: {
      exitCode: runnerResult.exitCode,
      durationMs: runnerResult.durationMs,
      stdoutBytes: runnerResult.stdoutBytes ?? 0,
      stderrBytes: runnerResult.stderrBytes ?? 0,
      stdoutLog: stdoutLogPath,
      stderrLog: stderrLogPath,
    },
    verdict: { verdict: computedVerdict, rationale: personaResponse.value.rationale },
    // Mutation.Notes is orchestrator-owned per Codex review fix-soon #1: the
    // computed mutationResult.notes is used verbatim. The persona's narrative
    // about mutation lives only in Rationale.
    mutation: { status: mutationResult.status, notes: mutationResult.notes },
    failureConstraint:
      computedVerdict === 'pass'
        ? null
        : {
            attempt: opts.attempt,
            forensicsPath: forensicsAttemptPathHelper(opts.runPaths.runDir, opts.attempt),
            validationCommand: buildReport.validationCommand.command,
            verdict: `fail (exit code ${runnerResult.exitCode ?? 'null'}, duration ${runnerResult.durationMs} ms)`,
            failureSummary: personaResponse.value.failureSummary as string,
            constraint: personaResponse.value.constraint as string,
          },
  }

  // 10. Round-trip lock-in.
  const verifyText = serializeVerifyReport(verifyData)
  let canonical: VerifyReportData
  try {
    canonical = parseVerifyReport(verifyText)
  } catch (err) {
    const reason =
      err instanceof VerifyReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
    return recordVerifyIntervention(interventionCtx, 'verify_validation_failed', reason)
  }

  // 11. Atomic write VERIFY.md.
  const verifyReportPath = join(opts.runPaths.artifactRoot, 'VERIFY.md')
  await atomicWriteFile(verifyReportPath, verifyText)
  const verifyReportSha256 = SHA(verifyText)

  // 12. Scientist phase-tail (rule 15) — runs on BOTH branches per Codex
  // review bp#5. Fail-side may seed new questions; pass-side updates
  // hypotheses with verified-state annotations (W2 scope).
  const tail = await runScientistPhaseTail({
    invokeCtx: opts.invokeCtx,
    runPaths: opts.runPaths,
    runId: opts.runId,
    agent: opts.scientistAgent,
    phase: 'verify',
    primaryArtifactPath: verifyReportPath,
    now,
  })
  if (tail.status === 'intervention') {
    return recordVerifyIntervention(interventionCtx, 'verify_scientist_tail_failed', tail.rule)
  }

  // 13. PASS branch.
  if (canonical.verdict.verdict === 'pass') {
    await appendEvent(eventPaths, {
      version: 1,
      type: 'verify_completed',
      ts: now(),
      runId: opts.runId,
      phase: 'verify',
      agent: opts.verifierAgent.name,
      attempt: opts.attempt,
      taskId: opts.taskId,
      verifyReportSha256,
      mutationStatus: canonical.mutation.status as 'pass' | 'not-applicable',
    })
    // gate_required(verify) signals to runApprove that VERIFY.md was
    // written by THIS run and is ready for `code-oz approve verify`.
    // Without this event, approve refuses (CODEX_REVIEW_M5 round 2
    // finding B + Codex review M8-fix bp#1). Mirrors runPlan + runBuild.
    await requireGate({
      paths: opts.runPaths,
      runId: opts.runId,
      phase: 'verify',
      blockedOn: 'code-oz approve verify',
      now,
    })
    return Object.freeze({
      status: 'completed' as const,
      verifyReportPath,
      verifyReportSha256,
      mutationStatus: canonical.mutation.status as 'pass' | 'not-applicable',
    })
  }

  // 14. FAIL branch. Forensics first; verify_failed second; restart decision third.
  const fc = canonical.failureConstraint
  if (!fc) {
    return recordVerifyIntervention(
      interventionCtx,
      'verify_failure_constraint_grammar',
      'fail verdict requires populated failureConstraint',
    )
  }

  const forensicsResult = await writeVerifyForensicsBundle({
    cwd: opts.cwd,
    runId: opts.runId,
    attempt: opts.attempt,
    baseCommitSha: buildReport.base.baseCommitSha,
    // stdout/stderr are already on disk at stdoutLogPath/stderrLogPath
    // (the runner streamed them there). Pass empty markers; the writer
    // (M8 fix 2) preserves existing log files instead of clobbering.
    stdout: '',
    stderr: '',
    buildReportContent: buildReportText,
    manifestText: changedFilesManifestText(buildReport.changedFiles),
    promptConstraints: fc.constraint,
    verifyReportContent: verifyText,
    attemptPatchContent: opts.attemptPatchContent,
    buildPromptSnapshot: opts.buildPromptSnapshot,
    preserveExistingStdoutStderr: true,
  })
  if (!forensicsResult.ok) {
    return recordVerifyIntervention(
      interventionCtx,
      'verify_forensics_failed',
      `forensics bundle write failed: ${forensicsResult.reason}`,
    )
  }

  await appendEvent(eventPaths, {
    version: 1,
    type: 'worktree_forensics_preserved',
    ts: now(),
    runId: opts.runId,
    phase: 'verify',
    attempt: opts.attempt,
    forensicsPath: forensicsResult.forensicsPath,
    entries: forensicsResult.entries,
  })
  await appendEvent(eventPaths, {
    version: 1,
    type: 'verify_failed',
    ts: now(),
    runId: opts.runId,
    phase: 'verify',
    agent: opts.verifierAgent.name,
    attempt: opts.attempt,
    taskId: opts.taskId,
    verifyReportSha256,
    terminationReason: runnerResult.terminationReason,
    exitCode: runnerResult.exitCode,
    failureSummary: fc.failureSummary,
  })

  const restartDecision = decideRestart({
    verifiedFailedAttempt: {
      attempt: opts.attempt,
      forensicsPath: forensicsResult.forensicsPath,
      validationCommand: fc.validationCommand,
      verdict: fc.verdict,
      failureSummary: fc.failureSummary,
      constraint: fc.constraint,
    },
  })
  if (restartDecision.action === 'restart') {
    return Object.freeze({
      status: 'failed' as const,
      verifyReportPath,
      forensicsPath: forensicsResult.forensicsPath,
      taskId: opts.taskId,
      attempt: opts.attempt,
      nextAction: 'restart' as const,
      nextAttempt: restartDecision.nextAttempt,
      carryForward: prepareCarryForward({
        attempt: opts.attempt,
        forensicsPath: forensicsResult.forensicsPath,
        validationCommand: fc.validationCommand,
        verdict: fc.verdict,
        failureSummary: fc.failureSummary,
        constraint: fc.constraint,
      }),
    })
  }
  // intervention path (4-attempt cap reached): durable.
  await recordVerifyIntervention(
    interventionCtx,
    'verify_restart_cap_exceeded',
    restartDecision.reason,
  )
  return Object.freeze({
    status: 'failed' as const,
    verifyReportPath,
    forensicsPath: forensicsResult.forensicsPath,
    taskId: opts.taskId,
    attempt: opts.attempt,
    nextAction: 'intervention' as const,
  })
}

// --- persona response parsing + repair turn ------------------------

interface PersonaParsedFields {
  readonly rationale: string
  readonly failureSummary?: string
  readonly constraint?: string
}

type ParsePersonaResponseResult =
  | { readonly ok: true; readonly value: PersonaParsedFields }
  | { readonly ok: false; readonly violation: string }

/**
 * Parses the small structured response the persona authors:
 *
 *   <verify-ready/>
 *
 *   ## Rationale
 *   <single line>
 *
 *   (on fail only)
 *   ## Failure summary
 *   <single line>
 *
 *   ## Constraint
 *   <single line>
 *
 * On parse fail returns a named violation that the repair turn can
 * include in the repair prompt to steer the persona.
 */
export function parseVerifyPersonaResponse(
  text: string,
  expectedVerdict: 'pass' | 'fail',
): ParsePersonaResponseResult {
  const lines = text.split(/\r?\n/)
  const readyIdx = lines.findIndex((l) => l.trim() === VERIFY_READY_SIGNAL)
  if (readyIdx === -1) {
    return { ok: false, violation: `missing ${VERIFY_READY_SIGNAL} marker` }
  }
  const body = lines.slice(readyIdx + 1).join('\n')
  const sections = parseSimpleSections(body)
  const rationale = sections.get('Rationale')
  if (!rationale) {
    return { ok: false, violation: '## Rationale section missing or empty' }
  }
  if (rationale.length > VERIFY_RATIONALE_MAX_CHARS) {
    return {
      ok: false,
      violation: `## Rationale exceeds ${VERIFY_RATIONALE_MAX_CHARS} characters (got ${rationale.length})`,
    }
  }
  if (rationale.includes('\n')) {
    return { ok: false, violation: '## Rationale must be a single line' }
  }
  if (expectedVerdict === 'fail') {
    const failureSummary = sections.get('Failure summary')
    const constraint = sections.get('Constraint')
    if (!failureSummary) {
      return { ok: false, violation: '## Failure summary section missing or empty (verdict=fail)' }
    }
    if (!constraint) {
      return { ok: false, violation: '## Constraint section missing or empty (verdict=fail)' }
    }
    if (failureSummary.length > VERIFY_FAILURE_SUMMARY_MAX_CHARS) {
      return {
        ok: false,
        violation: `## Failure summary exceeds ${VERIFY_FAILURE_SUMMARY_MAX_CHARS} characters`,
      }
    }
    if (constraint.length > VERIFY_CONSTRAINT_MAX_CHARS) {
      return {
        ok: false,
        violation: `## Constraint exceeds ${VERIFY_CONSTRAINT_MAX_CHARS} characters`,
      }
    }
    if (failureSummary.includes('\n') || constraint.includes('\n')) {
      return { ok: false, violation: 'Failure summary and Constraint must each be a single line' }
    }
    return { ok: true, value: { rationale, failureSummary, constraint } }
  }
  return { ok: true, value: { rationale } }
}

interface InvokeWithRepairInput {
  readonly invokePersona: (composedPrompt: string) => Promise<string>
  readonly systemPrompt: string
  readonly evidenceContext: string
  readonly expectedVerdict: 'pass' | 'fail'
}

type InvokeWithRepairResult =
  | { readonly ok: true; readonly value: PersonaParsedFields }
  | {
      readonly ok: false
      readonly code: string
      readonly reason: string
      /** Both rejected drafts (initial + repair attempt) for forensic inspection. */
      readonly drafts?: readonly string[]
    }

/**
 * Single-repair-turn invocation per Codex M8 decision 9: initial draft +
 * at most one repair = two total drafts. After the repair fails, return
 * a durable intervention code.
 */
async function invokeWithRepair(input: InvokeWithRepairInput): Promise<InvokeWithRepairResult> {
  const initialPrompt = `${input.systemPrompt}\n\n## Run-specific context\n\n${input.evidenceContext}`
  let draft1: string
  try {
    draft1 = await input.invokePersona(initialPrompt)
  } catch (err) {
    return {
      ok: false,
      code: 'verify_persona_invoke_failed',
      reason: (err as Error).message.slice(0, 200),
    }
  }
  const parse1 = parseVerifyPersonaResponse(draft1, input.expectedVerdict)
  if (parse1.ok) return { ok: true, value: parse1.value }

  // Repair turn
  const repairPrompt =
    initialPrompt +
    '\n\n## Prior draft was rejected\n\n' +
    `Violation: ${parse1.violation}\n\n` +
    'Re-emit your response correcting exactly this violation. Do not change other fields. ' +
    `Begin again with ${VERIFY_READY_SIGNAL} on its own line.\n`
  let draft2: string
  try {
    draft2 = await input.invokePersona(repairPrompt)
  } catch (err) {
    return {
      ok: false,
      code: 'verify_persona_invoke_failed',
      reason: `repair turn threw: ${(err as Error).message.slice(0, 200)}`,
      drafts: [draft1],
    }
  }
  const parse2 = parseVerifyPersonaResponse(draft2, input.expectedVerdict)
  if (parse2.ok) return { ok: true, value: parse2.value }
  return {
    ok: false,
    code: 'verify_validation_failed',
    reason: `persona response failed both initial draft and repair: ${parse2.violation}`,
    drafts: [draft1, draft2],
  }
}

async function persistRejectedDrafts(input: {
  readonly artifactRoot: string
  readonly drafts: readonly string[]
}): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir(input.artifactRoot, { recursive: true })
  if (input.drafts[0] !== undefined) {
    await writeFile(join(input.artifactRoot, 'VERIFY.draft.md'), input.drafts[0], 'utf8')
  }
  if (input.drafts[1] !== undefined) {
    await writeFile(join(input.artifactRoot, 'VERIFY.draft.repair.md'), input.drafts[1], 'utf8')
  }
}

function parseSimpleSections(body: string): Map<string, string> {
  const lines = body.split('\n')
  const map = new Map<string, string>()
  let curHeader: string | null = null
  let curBuf: string[] = []
  const flush = () => {
    if (curHeader === null) return
    const value = curBuf.join('\n').trim()
    if (value.length > 0) map.set(curHeader, value)
    curBuf = []
  }
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      flush()
      curHeader = m[1] as string
      continue
    }
    if (curHeader !== null) curBuf.push(line)
  }
  flush()
  return map
}

interface EvidenceContextInput {
  readonly taskId: string
  readonly attempt: number
  readonly validationCommand: {
    readonly command: string
    readonly workingDirectory: string
    readonly timeoutMs: number
    readonly expectedExitCode: number
  }
  readonly runnerResult: RunnerResultShape
  readonly mutationResult: MutationStatusResult
  readonly computedVerdict: 'pass' | 'fail'
  readonly stdoutLogPath: string
  readonly stderrLogPath: string
}

function renderEvidenceContext(input: EvidenceContextInput): string {
  const lines: string[] = []
  lines.push(`### Task being verified`)
  lines.push(`- Task: ${input.taskId}`)
  lines.push(`- Attempt: ${input.attempt}`)
  lines.push('')
  lines.push(`### Validation command`)
  lines.push(`- Command: ${input.validationCommand.command}`)
  lines.push(`- Expected exit code: ${input.validationCommand.expectedExitCode}`)
  lines.push(`- Timeout: ${input.validationCommand.timeoutMs} ms`)
  lines.push('')
  lines.push(`### Captured evidence`)
  lines.push(`- Termination reason: ${input.runnerResult.terminationReason}`)
  lines.push(`- Exit code: ${input.runnerResult.exitCode === null ? 'null' : input.runnerResult.exitCode}`)
  lines.push(`- Duration: ${input.runnerResult.durationMs} ms`)
  if (input.runnerResult.stdoutBytes !== undefined) lines.push(`- Stdout bytes: ${input.runnerResult.stdoutBytes}`)
  if (input.runnerResult.stderrBytes !== undefined) lines.push(`- Stderr bytes: ${input.runnerResult.stderrBytes}`)
  lines.push(`- Stdout log: ${input.stdoutLogPath}`)
  lines.push(`- Stderr log: ${input.stderrLogPath}`)
  lines.push('')
  lines.push(`### Mutation gate`)
  lines.push(`- Status: ${input.mutationResult.status}`)
  lines.push(`- Notes: ${input.mutationResult.notes}`)
  lines.push('')
  lines.push(`### Computed verdict`)
  lines.push(`- Verdict: ${input.computedVerdict} (orchestrator-computed; do not override)`)
  lines.push('')
  lines.push(`### What you must author`)
  if (input.computedVerdict === 'pass') {
    lines.push('- `## Rationale` — single line, ≤ 200 chars, evidence-grounded.')
    lines.push('')
    lines.push('Emit only the `<verify-ready/>` marker followed by `## Rationale`. Do not author Verdict, Mutation, or Failure constraint sections.')
  } else {
    lines.push('- `## Rationale` — single line, ≤ 200 chars, evidence-grounded.')
    lines.push('- `## Failure summary` — single line, ≤ 200 chars, descriptive (what went wrong).')
    lines.push('- `## Constraint` — single line, ≤ 200 chars, directive (rule for attempt N+1).')
    lines.push('')
    lines.push(`Emit only the \`${VERIFY_READY_SIGNAL}\` marker followed by these three sections. Do not author Verdict, Mutation, or BUILD ref sections.`)
  }
  return lines.join('\n')
}

// --- helpers --------------------------------------------------------

function collectToolNames(agent: AgentDefinition): readonly string[] {
  const names: string[] = []
  const tu = agent.permissions.tool_use
  if (!tu) return names
  if (tu.repo_context) for (const t of tu.repo_context.tools) names.push(t)
  if (tu.execute) for (const t of tu.execute.tools) names.push(t)
  if (tu.write) for (const t of tu.write.tools) names.push(t)
  return Object.freeze(names)
}

function resolveWorktreeCwd(cwd: string, declared: string, runId: string): string {
  if (declared.includes('<runId>')) {
    return join(cwd, declared.replace('<runId>', runId))
  }
  return declared
}

function changedFilesManifestText(
  files: readonly { readonly path: string; readonly sha256: string; readonly change: string }[],
): string {
  return files.map((f) => `${f.path} | sha256: ${f.sha256} | change: ${f.change}`).join('\n')
}

function forensicsAttemptPathHelper(runDir: string, attempt: number): string {
  return join(runDir, 'forensics', String(attempt))
}
