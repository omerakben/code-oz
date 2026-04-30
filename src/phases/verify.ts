// VERIFY phase orchestration (M8 commit 10).
//
// Wires the nine M8 modules into one phase function:
//   - reads BUILD_REPORT.md (commit 5's parser at the BUILD side)
//   - composes the VERIFY prompt (commit 9's composer)
//   - invokes the verifier persona (test seam)
//   - parses the persona's draft VERIFY.md (commit 5)
//   - runs the validation command via the test-runner seam (commit 3)
//   - evaluates the mutation gate (commit 6)
//   - computes orchestrator-owned fields (Verdict.Verdict, Mutation.Status, Evidence)
//   - merges with persona fields and re-parses for grammar lock-in (round-trip)
//   - atomically writes VERIFY.md
//   - emits the canonical event sequence (commit 4 + commit 8 ordering)
//   - on fail: writes the forensics bundle (commit 8 helper) + decides restart (commit 7)
//
// Cleanup-on-approval per Codex M8 decision 7 reject-with-alternative:
// the worktree is NOT destroyed by runVerify on a pass — the user
// invokes `code-oz approve verify` to validate VERIFY.md + Scientist
// sidecars, remove the worktree, emit worktree_destroyed, and write
// the gate file. runVerify ends after writing VERIFY.md and the
// Scientist tail.
//
// The runner and revertSeam are dependency-injected so this module is
// fully testable without spawning real subprocesses or touching real
// filesystems. The orchestrator's only impure operations are
// atomicWriteFile (VERIFY.md), appendEvent (events.jsonl), and the
// forensics bundle writes (on fail).

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
  type VerifyReportData,
} from '../artifacts/verify-report.ts'
import { composeVerifyPrompt } from '../prompts/index.ts'
import { runScientistPhaseTail } from './scientist.ts'
import {
  evaluateMutation,
  type ChangedFileEntry,
  type RevertSeam,
  type RunnerSeam,
} from './verify-mutation.ts'
import { decideRestart, prepareCarryForward } from './restart-policy.ts'
import {
  appendEvent,
  type EventLogPaths,
} from '../state/events.ts'
import { type RunPaths } from '../state/run.ts'
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
  /** Persona-response shim. Returns the persona's raw draft text. */
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

function intervention(code: string, rule: string): VerifyIntervention {
  return Object.freeze({ status: 'intervention' as const, code, rule })
}

export async function runVerify(opts: RunVerifyOptions): Promise<VerifyResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const eventPaths = eventPathsFor(opts.runPaths)

  // 1. Read BUILD_REPORT.md
  const buildReportPath = join(opts.runPaths.artifactRoot, 'BUILD_REPORT.md')
  let buildReportText: string
  try {
    buildReportText = await readFile(buildReportPath, 'utf8')
  } catch (err) {
    return intervention(
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
    return intervention('verify_build_report_invalid', reason)
  }

  // BUILD ref binding check: incoming opts.attempt + opts.taskId must
  // match the BUILD report. Drift is a routing bug, not a VERIFY-fail
  // (Codex M8 decision 6 modification).
  if (buildReport.task.taskId !== opts.taskId) {
    return intervention(
      'verify_build_ref_mismatch',
      `BUILD_REPORT.md taskId=${buildReport.task.taskId} != opts.taskId=${opts.taskId}`,
    )
  }
  if (buildReport.task.attempt !== opts.attempt) {
    return intervention(
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

  // 3. Compose the VERIFY prompt and invoke the persona.
  const availableTools = collectToolNames(opts.verifierAgent)
  const composedPrompt = await composeVerifyPrompt({
    agentBody: opts.verifierAgent.body,
    readySignal: VERIFY_READY_SIGNAL,
    availableTools,
  })

  let personaDraftText: string
  try {
    personaDraftText = await opts.invokePersona(composedPrompt)
  } catch (err) {
    return intervention('verify_persona_invoke_failed', (err as Error).message.slice(0, 200))
  }
  const personaDraft = extractPostReadyBlock(personaDraftText)
  if (personaDraft === null) {
    return intervention(
      'verify_persona_missing_ready_signal',
      `persona response did not contain ${VERIFY_READY_SIGNAL}`,
    )
  }

  let personaParsed: VerifyReportData
  try {
    personaParsed = parseVerifyReport(personaDraft, 'VERIFY.draft.md')
  } catch (err) {
    const reason =
      err instanceof VerifyReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
    return intervention('verify_validation_failed', reason)
  }

  // 4. Run the validation command via the test-runner seam.
  const stdoutLogPath = join(opts.runPaths.runDir, 'forensics', String(opts.attempt), 'stdout.log')
  const stderrLogPath = join(opts.runPaths.runDir, 'forensics', String(opts.attempt), 'stderr.log')

  const runnerResult = await opts.runner({
    command: buildReport.validationCommand.command,
    cwd: resolveWorktreeCwd(opts.cwd, buildReport.validationCommand.workingDirectory, opts.runId),
    timeoutMs: buildReport.validationCommand.timeoutMs,
    stdoutLogPath,
    stderrLogPath,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
  })

  // 5. Evaluate the mutation gate.
  const changedFiles: readonly ChangedFileEntry[] = buildReport.changedFiles.map((f) => ({
    path: f.path,
    sha256: f.sha256,
    change: f.change,
  }))
  const mutationResult = await evaluateMutation({
    changedFiles,
    baseCommitSha: buildReport.base.baseCommitSha,
    command: buildReport.validationCommand.command,
    cwd: resolveWorktreeCwd(opts.cwd, buildReport.validationCommand.workingDirectory, opts.runId),
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

  // 6. Compute orchestrator-owned fields and merge with persona fields.
  const exitMatchesExpected =
    runnerResult.terminationReason === 'exit' &&
    runnerResult.exitCode === buildReport.validationCommand.expectedExitCode
  const mutationOk =
    mutationResult.status === 'pass' || mutationResult.status === 'not-applicable'
  const verdict: 'pass' | 'fail' = exitMatchesExpected && mutationOk ? 'pass' : 'fail'

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
    verdict: { verdict, rationale: personaParsed.verdict.rationale },
    mutation: { status: mutationResult.status, notes: personaParsed.mutation.notes },
    failureConstraint:
      verdict === 'pass'
        ? null
        : personaParsed.failureConstraint
        ? {
            attempt: opts.attempt,
            forensicsPath: forensicsAttemptPathHelper(opts.runPaths.runDir, opts.attempt),
            validationCommand: buildReport.validationCommand.command,
            verdict: `fail (exit code ${runnerResult.exitCode ?? 'null'}, duration ${runnerResult.durationMs} ms)`,
            failureSummary: personaParsed.failureConstraint.failureSummary,
            constraint: personaParsed.failureConstraint.constraint,
          }
        : null,
  }

  // 7. Round-trip lock-in: serialize, parse — catches any drift between
  // our merged data and the canonical schema before atomic write.
  const verifyText = serializeVerifyReport(verifyData)
  let canonical: VerifyReportData
  try {
    canonical = parseVerifyReport(verifyText)
  } catch (err) {
    const reason =
      err instanceof VerifyReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
    return intervention('verify_validation_failed', reason)
  }
  const verifyReportPath = join(opts.runPaths.artifactRoot, 'VERIFY.md')
  await atomicWriteFile(verifyReportPath, verifyText)
  const verifyReportSha256 = SHA(verifyText)

  // 8. Branch on verdict.
  if (canonical.verdict.verdict === 'pass') {
    // Scientist tail (rule 15) runs before gate-passed signaling.
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
      return intervention(tail.code, tail.rule)
    }
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
    return Object.freeze({
      status: 'completed' as const,
      verifyReportPath,
      verifyReportSha256,
      mutationStatus: canonical.mutation.status as 'pass' | 'not-applicable',
    })
  }

  // 9. FAIL path. Forensics bundle FIRST (Codex M8 decision 8 ordering),
  // then verify_failed event. Worktree destruction is approve-verify's
  // job, not runVerify's; this commit lands the failure-event sequence
  // up to verify_failed. The remaining ordering (worktree_destroyed,
  // verify_restart_initiated) is wired into the orchestrator that
  // schedules attempt N+1 — landing in a Pre-M9 commit.
  const fc = canonical.failureConstraint
  if (!fc) {
    // Cross-field validation should have caught this; defensive guard.
    return intervention(
      'verify_failure_constraint_grammar',
      'fail verdict requires populated failureConstraint',
    )
  }

  const forensicsResult = await writeVerifyForensicsBundle({
    cwd: opts.cwd,
    runId: opts.runId,
    attempt: opts.attempt,
    baseCommitSha: buildReport.base.baseCommitSha,
    stdout: '', // streamed earlier; logs already on disk at stdoutLogPath
    stderr: '',
    buildReportContent: buildReportText,
    manifestText: changedFilesManifestText(buildReport.changedFiles),
    promptConstraints: fc.constraint,
    verifyReportContent: verifyText,
    attemptPatchContent: opts.attemptPatchContent,
    buildPromptSnapshot: opts.buildPromptSnapshot,
  })
  if (!forensicsResult.ok) {
    return intervention(
      forensicsResult.code,
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

  // 10. Decide restart — produce VerifiedFailedAttempt and call
  // decideRestart. The orchestrator uses the result to schedule
  // attempt N+1's BUILD (with carryForward) or escalate.
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
  // intervention path (4-attempt cap reached)
  return Object.freeze({
    status: 'failed' as const,
    verifyReportPath,
    forensicsPath: forensicsResult.forensicsPath,
    nextAction: 'intervention' as const,
  })
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

function extractPostReadyBlock(text: string): string | null {
  const lines = text.split(/\r?\n/)
  const idx = lines.findIndex((l) => l.trim() === VERIFY_READY_SIGNAL)
  if (idx === -1) return null
  return lines.slice(idx + 1).join('\n').trim()
}

function resolveWorktreeCwd(cwd: string, declared: string, runId: string): string {
  // The declared workingDirectory in BUILD_REPORT.md is the templated
  // form `.code-oz/runs/<runId>/worktree/`. Resolve to absolute path
  // under cwd. If the declaration is already concrete, use as-is.
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
