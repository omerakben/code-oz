// BUILD phase orchestrator (M7).
//
// Implements the orchestrator's authority over computed BUILD_REPORT.md
// fields (per docs/contracts/BUILD.md § "Authoring authority" + Codex M7
// implementation review C1, thread 019ddeea). The persona writes only
// `<build-ready/>` + one fenced diff + ## Title + ## Notes; the
// orchestrator computes patch sha, byte count, manifest, copies the
// validation command from the PLAN task, and serializes canonical
// BUILD_REPORT.md.
//
// M7 deliberate scope (per CLAUDE.md rule 20 — one new authority boundary
// per milestone): worktree isolation + BUILD artifact authority.
//
// NOT in M7: validation command execution (M8 VERIFY), restart-on-fail
// (M8), iterative patch loop (M8), mutation gate (M8), REVIEW (M9),
// requestDebate runtime (M10).

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentDefinition } from '../agents/schema.ts'
import {
  serializeBuildReport,
  parseBuildReport,
  BuildReportLoadError,
  type BuildReportCarryForward,
  type BuildReportData,
} from '../artifacts/build-report.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import { parsePlan, type PlanTask } from '../artifacts/plan.ts'
import { applyAgentPatch } from '../patches/apply-agent-patch.ts'
import { composeBuildPrompt } from '../prompts/index.ts'
import { runScientistPhaseTail } from './scientist.ts'
import { validateScientistSidecars } from './gate-preflight.ts'
import type { InvokeContext } from '../providers/invoke.ts'
import {
  appendEvent,
  type EventLogPaths,
} from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { LockBusyError, withLock } from '../state/lock.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
import { computeManifest } from '../worktree/manifest.ts'
import {
  runPaths as worktreeRunPaths,
  buildDraftsAttemptPath,
  buildPromptSnapshotPath,
} from '../worktree/paths.ts'
import type { ProviderId } from '../providers/types.ts'

// --- public API ----------------------------------------------------

export const BUILD_READY_SIGNAL = '<build-ready/>'

export type BuildStatus = 'complete' | 'intervention'

export interface BuildComplete {
  readonly status: 'complete'
  readonly buildReportPath: string
  readonly patchPath: string
  readonly patchSha256: string
  readonly changedFileCount: number
  readonly worktreePreserved: true
}

export interface BuildIntervention {
  readonly status: 'intervention'
  readonly code: string
  readonly rule: string
  readonly draftPath?: string
}

export type BuildResult = BuildComplete | BuildIntervention

export interface RunBuildOptions {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly cwd: string
  readonly builderAgent: AgentDefinition
  /** Scientist persona — required at BUILD gate per CLAUDE.md rule 15. */
  readonly scientistAgent: AgentDefinition
  /** The PLAN task to implement (T-NNN). Orchestrator parses PLAN.md and
   *  derives validationCommand / risk / files from the task block — the
   *  caller never supplies them (per Codex M7 review block-push #2 + #3:
   *  PLAN binding must be enforced from approved PLAN.md, not caller). */
  readonly taskId: string
  /** Pre-resolved worktree state (worktree must already exist before BUILD). */
  readonly worktree: WorktreeBinding
  /** Wrapper-layer context for invoking Scientist + (in M8+) builder. */
  readonly invokeCtx: InvokeContext
  /**
   * Persona-response shim. M7 simplification — hooking BUILD into the
   * full InvokeContext tool-use dispatch is M8 work. The runner takes the
   * composed prompt and returns the persona's response text.
   */
  readonly invokePersona: (composedPrompt: string) => Promise<string>
  /** Default validation timeout / working directory / exit code when the
   *  PLAN task does not declare them (PLAN.md task grammar today only
   *  carries `Validation:` command text). M8 may extend PLAN.md to
   *  include these fields. */
  readonly validationDefaults?: ValidationDefaults
  readonly attempt?: number
  /**
   * Failure carry-forward block from the prior failed VERIFY attempt
   * (M8 commit 7). When present, it is rendered into BUILD_REPORT.md's
   * `## Failure carry-forward` section and prepended to the BUILD
   * persona prompt as a directive line. The orchestrator constructs
   * this via prepareCarryForward in src/phases/restart-policy.ts;
   * BUILD validates that priorAttempt + 1 === task.attempt and rejects
   * with `restart_state_drift` on mismatch.
   *
   * `undefined` means attempt 1 (no prior failure). `null` is rejected
   * for attempt > 1.
   */
  readonly carryForward?: BuildReportCarryForward
  readonly fsyncDir?: boolean
  readonly now?: () => string
}

export interface ValidationDefaults {
  readonly workingDirectory?: string  // defaults to .code-oz/runs/<runId>/worktree/
  readonly timeoutMs?: number         // defaults to 60000 (1 minute)
  readonly expectedExitCode?: number  // defaults to 0
}

const DEFAULT_VALIDATION_TIMEOUT_MS = 60_000
const MAX_VALIDATION_TIMEOUT_MS = 600_000  // 10 minutes — bounded per Codex finding #4
const DEFAULT_VALIDATION_EXIT_CODE = 0

export interface WorktreeBinding {
  /** Absolute path to the run worktree. */
  readonly worktreePath: string
  readonly baseCommitSha: string
  readonly dirtyAtBase: boolean
}

// --- response parser ----------------------------------------------

export interface BuildResponseParsed {
  readonly ok: true
  readonly patchContent: string
  readonly title: string
  readonly notes: readonly string[]
}

export interface BuildResponseError {
  readonly ok: false
  readonly code: string
  readonly reason: string
}

export type BuildResponseParseResult = BuildResponseParsed | BuildResponseError

/**
 * Extracts the BUILD persona's payload from its response text. Expected
 * shape (per builder.md "Worked example"):
 *
 *   <build-ready/>
 *
 *   ```diff
 *   <unified diff>
 *   ```
 *
 *   ## Title
 *   <one line>
 *
 *   ## Notes
 *   - bullet
 *   - bullet
 *
 * Anything before `<build-ready/>` is ignored (chain-of-thought, repair
 * scratch). Multiple fenced diff blocks are rejected.
 */
export function parseBuildResponse(text: string): BuildResponseParseResult {
  const lines = text.split(/\r?\n/)
  const readyIdx = lines.findIndex((l) => l.trim() === BUILD_READY_SIGNAL)
  if (readyIdx === -1) {
    return errResult('build_persona_protocol_violation', `missing '${BUILD_READY_SIGNAL}' marker`)
  }
  const after = lines.slice(readyIdx + 1)

  // Find first fenced diff block: ```diff ... ```
  let fenceStart = -1
  let fenceEnd = -1
  for (let i = 0; i < after.length; i++) {
    if (after[i]!.trim() === '```diff') {
      fenceStart = i
      break
    }
  }
  if (fenceStart === -1) {
    return errResult('build_persona_protocol_violation', 'no fenced ```diff block after marker')
  }
  for (let i = fenceStart + 1; i < after.length; i++) {
    if (after[i]!.trim() === '```') {
      fenceEnd = i
      break
    }
  }
  if (fenceEnd === -1) {
    return errResult('build_persona_protocol_violation', 'unterminated fenced diff block')
  }
  // Reject multiple fenced diff blocks
  for (let i = fenceEnd + 1; i < after.length; i++) {
    if (after[i]!.trim() === '```diff') {
      return errResult('build_persona_protocol_violation', 'multiple fenced diff blocks (only one allowed)')
    }
  }

  const patchLines = after.slice(fenceStart + 1, fenceEnd)
  const patchContent = patchLines.join('\n') + (patchLines.length > 0 ? '\n' : '')

  // Find ## Title block (after fence)
  const tail = after.slice(fenceEnd + 1)
  const titleHeaderIdx = tail.findIndex((l) => l.trim() === '## Title')
  if (titleHeaderIdx === -1) {
    return errResult('build_persona_protocol_violation', 'missing ## Title section')
  }
  const notesHeaderIdx = tail.findIndex((l, i) => i > titleHeaderIdx && l.trim() === '## Notes')
  if (notesHeaderIdx === -1) {
    return errResult('build_persona_protocol_violation', 'missing ## Notes section')
  }
  const titleLines: string[] = []
  for (let i = titleHeaderIdx + 1; i < notesHeaderIdx; i++) {
    const t = tail[i]!.trim()
    if (t.length > 0) titleLines.push(t)
  }
  if (titleLines.length === 0) {
    return errResult('build_persona_protocol_violation', '## Title section is empty')
  }
  if (titleLines.length > 1) {
    return errResult('build_persona_protocol_violation', '## Title must be a single line')
  }
  const title = titleLines[0]!
  if (title.length > 120) {
    return errResult('build_report_title_invalid', '## Title exceeds 120 characters')
  }

  const notes: string[] = []
  for (let i = notesHeaderIdx + 1; i < tail.length; i++) {
    const line = tail[i]!
    if (line.trim().length === 0) continue
    if (line.trim().startsWith('## ')) break // next section
    if (/^- /.test(line)) {
      const content = line.slice(2).trim()
      if (content.length > 200) {
        return errResult('build_report_notes_too_long', 'Notes bullet exceeds 200 characters')
      }
      notes.push(content)
    }
  }
  if (notes.length === 0) {
    return errResult('build_persona_protocol_violation', '## Notes must contain at least one bullet')
  }

  return Object.freeze({
    ok: true as const,
    patchContent,
    title,
    notes: Object.freeze(notes),
  })
}

function errResult(code: string, reason: string): BuildResponseError {
  return Object.freeze({ ok: false as const, code, reason })
}

// --- runBuild ------------------------------------------------------

/**
 * Mkdir-as-mutex over the runBuild orchestration (M16 C4). Two concurrent
 * runBuild calls for the same runId would otherwise both load PLAN, both
 * invoke the builder persona, both apply patches against the worktree,
 * and both write build_completed events with divergent shas. The
 * orchestration body is held for the duration of the persona invocation
 * (seconds to minutes); this is a SEPARATE dir from runPaths.lockDir
 * (which serializes appendEvent / writeGate) so concurrent status reads
 * and gate writes for unrelated phases stay unblocked.
 *
 * On `LockBusyError`, the function returns `build_already_in_flight`
 * intervention without writing a gate file — mirrors review.ts:560-572.
 * The lock-busy case has not changed run state, so there is no durable
 * orchestration outcome to record beyond the in-memory result.
 */
export async function runBuild(opts: RunBuildOptions): Promise<BuildResult> {
  const buildLockDir = join(opts.runPaths.runDir, '.build.lock')
  try {
    return await withLock(buildLockDir, () => runBuildInner(opts))
  } catch (err) {
    if (err instanceof LockBusyError) {
      return Object.freeze({
        status: 'intervention' as const,
        code: 'build_already_in_flight',
        rule: `another runBuild is in progress for run ${opts.runId} (lock at ${buildLockDir})`,
      })
    }
    throw err
  }
}

async function runBuildInner(opts: RunBuildOptions): Promise<BuildResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const attempt = opts.attempt ?? 1
  const eventPaths = eventPathsFor(opts.runPaths)

  // Restart-state drift guard (M8 commit 7): when the orchestrator passes
  // a carry-forward block, the failed prior attempt must be exactly one
  // less than the new attempt number. Drift means the orchestrator
  // miscounted attempts (or routed a non-VERIFY-fail through the restart
  // path) — produces intervention rather than silently running the wrong
  // attempt. Symmetric: attempt > 1 with no carryForward is also drift.
  if (attempt === 1 && opts.carryForward !== undefined) {
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: opts.taskId,
      code: 'restart_state_drift',
      reason: 'attempt 1 must not have carryForward',
      now,
    })
    return interventionResult('restart_state_drift', 'attempt 1 must not have carryForward')
  }
  if (attempt > 1 && opts.carryForward === undefined) {
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: opts.taskId,
      code: 'restart_state_drift',
      reason: `attempt ${attempt} requires carryForward from the prior failed attempt`,
      now,
    })
    return interventionResult(
      'restart_state_drift',
      `attempt ${attempt} requires carryForward from the prior failed attempt`,
    )
  }
  if (
    opts.carryForward !== undefined &&
    opts.carryForward.priorAttempt + 1 !== attempt
  ) {
    const reason = `carryForward.priorAttempt=${opts.carryForward.priorAttempt} + 1 !== attempt=${attempt}`
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: opts.taskId,
      code: 'restart_state_drift',
      reason,
      now,
    })
    return interventionResult('restart_state_drift', reason)
  }

  // BUILD entry preflight: parse PLAN.md, look up task, compute planSha.
  // Caller may NOT supply task data (per Codex M7 review block-push #2 + #3).
  const planLoad = await loadPlanAndSelectTask({
    artifactRoot: opts.runPaths.artifactRoot,
    taskId: opts.taskId,
  })
  if (!planLoad.ok) {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      code: planLoad.code,
      rule: planLoad.reason,
      now,
    })
    return interventionResult(planLoad.code, planLoad.reason)
  }
  const { task, planSha } = planLoad

  // Drift check on PLAN-referenced files (Codex C2).
  const driftCheck = await checkPlanBaseDrift({
    worktreePath: opts.worktree.worktreePath,
    referencedFiles: task.files,
  })
  if (!driftCheck.ok) {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      code: driftCheck.code,
      rule: driftCheck.reason,
      now,
    })
    return interventionResult(driftCheck.code, driftCheck.reason)
  }

  // Build the validation-command record from PLAN's task.validation +
  // orchestrator defaults (Codex M2: command text comes from PLAN; the
  // other fields are orchestrator-owned).
  const validationCommand = buildValidationCommand({
    planValidationCommand: task.validation,
    worktreePath: opts.worktree.worktreePath,
    defaults: opts.validationDefaults,
  })

  // Emit build_started.
  await appendEvent(eventPaths, {
    version: 1,
    type: 'build_started',
    ts: now(),
    runId: opts.runId,
    phase: 'build',
    agent: opts.builderAgent.name,
    attempt,
    baseCommitSha: opts.worktree.baseCommitSha,
    taskId: task.id,
  })

  // Compose prompt + invoke persona.
  const availableTools =
    opts.builderAgent.permissions.tool_use?.repo_context?.tools !== undefined
      ? [...opts.builderAgent.permissions.tool_use.repo_context.tools]
      : []
  const composedPrompt = await composeBuildPrompt({
    agentBody: opts.builderAgent.body,
    readySignal: BUILD_READY_SIGNAL,
    availableTools,
  })

  // Persist the composed prompt to disk BEFORE persona invocation so VERIFY
  // forensics + the M16 C8 dispatcher + the C12 e2e binary can read the
  // exact bytes the persona saw, even on resume after a crash. Atomic write
  // first, sha second (computed from the canonical bytes the validator will
  // bind into build_completed.promptSnapshotSha256). The contract is "future
  // consumers read this file by path; they MUST NOT re-compose" — see
  // src/worktree/paths.ts buildPromptSnapshotPath docstring.
  const promptSnapshotPath = buildPromptSnapshotPath(opts.cwd, opts.runId, attempt)
  try {
    await atomicWriteFile(promptSnapshotPath, composedPrompt)
  } catch (err) {
    // Atomic-write failure (EACCES, ENOSPC, parent dir missing). build_started
    // is already on the log; closing it via recordBuildFailure prevents the
    // run from sitting half-open. Persona is NOT invoked on this path.
    const reason = (err as Error).message.slice(0, 200)
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: 'build_prompt_snapshot_write_failed',
      reason,
      now,
    })
    return interventionResult('build_prompt_snapshot_write_failed', reason)
  }
  const promptSnapshotSha = createHash('sha256').update(composedPrompt, 'utf8').digest('hex')

  let responseText: string
  try {
    responseText = await opts.invokePersona(composedPrompt)
  } catch (err) {
    const reason = (err as Error).message.slice(0, 200)
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: 'build_persona_invoke_failed',
      reason,
      now,
    })
    return interventionResult('build_persona_invoke_failed', reason)
  }

  // Parse persona response.
  const parsed = parseBuildResponse(responseText)
  if (!parsed.ok) {
    const draftPath = await preserveBuildDraft({
      cwd: opts.cwd,
      runId: opts.runId,
      taskId: task.id,
      attempt,
      content: responseText,
      filename: 'response.draft.md',
    })
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: parsed.code,
      reason: parsed.reason,
      now,
    })
    return Object.freeze({
      status: 'intervention' as const,
      code: parsed.code,
      rule: parsed.reason,
      draftPath,
    })
  }

  // Apply patch.
  const apply = await applyAgentPatch({
    cwd: opts.cwd,
    runId: opts.runId,
    taskId: task.id,
    attempt,
    patchContent: parsed.patchContent,
  })
  if (!apply.ok) {
    // Write the response draft for human inspection
    await preserveBuildDraft({
      cwd: opts.cwd,
      runId: opts.runId,
      taskId: task.id,
      attempt,
      content: responseText,
      filename: 'response.draft.md',
    })
    if (apply.patchPath !== undefined) {
      // Patch file already on disk (apply --check failure preserves it).
      // Emit worktree_patch_failed so the audit trail captures the cause.
      await appendEvent(eventPaths, {
        version: 1,
        type: 'worktree_patch_failed',
        ts: now(),
        runId: opts.runId,
        phase: 'build',
        code: apply.code,
        attempt,
        taskId: task.id,
        reason: apply.reason,
      })
    }
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: apply.code,
      reason: apply.reason,
      now,
    })
    return interventionResult(apply.code, apply.reason)
  }

  // Patch applied. Emit events.
  await appendEvent(eventPaths, {
    version: 1,
    type: 'worktree_patch_applied',
    ts: now(),
    runId: opts.runId,
    phase: 'build',
    patchSha256: apply.patchSha256,
    patchPath: apply.patchPath,
    attempt,
    taskId: task.id,
  })
  await appendEvent(eventPaths, {
    version: 1,
    type: 'build_patch_applied',
    ts: now(),
    runId: opts.runId,
    phase: 'build',
    agent: opts.builderAgent.name,
    patchSha256: apply.patchSha256,
    attempt,
    taskId: task.id,
  })

  // Compute manifest.
  const manifest = await computeManifest({
    worktreePath: opts.worktree.worktreePath,
    baseCommitSha: opts.worktree.baseCommitSha,
  })
  if (!manifest.ok) {
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: manifest.code,
      reason: manifest.reason,
      now,
    })
    return interventionResult(manifest.code, manifest.reason)
  }

  // Build BUILD_REPORT.md. The persona's Title and Notes are the only
  // fields the persona authored; everything else is orchestrator-computed
  // (per Codex C1).
  const reportData: BuildReportData = Object.freeze({
    task: {
      taskId: task.id,
      title: parsed.title,
      planSha,
      attempt,
    },
    base: {
      worktreePath: opts.worktree.worktreePath,
      baseCommitSha: opts.worktree.baseCommitSha,
      dirtyAtBase: opts.worktree.dirtyAtBase,
    },
    patch: {
      patchPath: apply.patchPath,
      patchSha256: apply.patchSha256,
      patchBytes: apply.patchBytes,
    },
    changedFiles: manifest.entries,
    validationCommand: validationCommand,
    failureCarryForward: opts.carryForward ?? null,
    notes: ensureRiskNote(parsed.notes, task.risk),
  })

  const buildReportText = serializeBuildReport(reportData)

  // Round-trip validation: parse what we just serialized to catch any
  // schema mismatch BEFORE writing canonical bytes.
  try {
    parseBuildReport(buildReportText)
  } catch (err) {
    const reason =
      err instanceof BuildReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ')
        : (err as Error).message
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: 'build_report_validation_failed',
      reason: reason.slice(0, 200),
      now,
    })
    return interventionResult('build_report_validation_failed', reason.slice(0, 200))
  }

  // Atomic write.
  const reportPath = join(opts.runPaths.artifactRoot, 'BUILD_REPORT.md')
  await atomicWriteFile(reportPath, buildReportText)

  // Scientist phase-tail (per CLAUDE.md rule 15 + Codex M7 review block-push #1).
  // Runs against BUILD_REPORT.md as the primary artifact; reads prior
  // HYPOTHESES.md / OPEN_QUESTIONS.md (set by PLAN tail), emits updates
  // for BUILD's claims (e.g., "this patch handles X correctly").
  const tail = await runScientistPhaseTail({
    invokeCtx: opts.invokeCtx,
    runPaths: opts.runPaths,
    runId: opts.runId,
    agent: opts.scientistAgent,
    phase: 'build',
    primaryArtifactPath: reportPath,
    fsyncDir: opts.fsyncDir ?? false,
    now,
  })
  if (tail.status === 'intervention') {
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: tail.code,
      reason: tail.rule,
      now,
    })
    return interventionResult(tail.code, tail.rule)
  }

  // Gate-preflight: validate Scientist sidecars before requireGate (per
  // CLAUDE.md rule 15). Mirrors plan.ts's preflight pattern.
  const sidecarCheck = await validateScientistSidecars({
    artifactRoot: opts.runPaths.artifactRoot,
    phase: 'build',
  })
  if (!sidecarCheck.ok) {
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: sidecarCheck.code,
      reason: sidecarCheck.rule,
      now,
    })
    return interventionResult(sidecarCheck.code, sidecarCheck.rule)
  }

  // Sanity: assert worktree still exists at BUILD completion (per Codex
  // C3 — M7 stops before VERIFY; cleanup must NOT fire here).
  const worktreeStillExists = await pathExists(opts.worktree.worktreePath)
  if (!worktreeStillExists) {
    // This indicates a bug in BUILD-lite (no caller should remove the
    // worktree during M7's BUILD path). Surface as intervention.
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: task.id,
      code: 'build_worktree_destroyed_prematurely',
      reason: 'worktree absent at build_completed; M7 must preserve through VERIFY (M8+)',
      now,
    })
    return interventionResult(
      'build_worktree_destroyed_prematurely',
      'worktree absent at BUILD completion',
    )
  }

  // Emit build_completed + write the gate file.
  const buildReportSha = createHash('sha256').update(buildReportText, 'utf8').digest('hex')
  await appendEvent(eventPaths, {
    version: 1,
    type: 'build_completed',
    ts: now(),
    runId: opts.runId,
    phase: 'build',
    agent: opts.builderAgent.name,
    attempt,
    taskId: task.id,
    changedFileCount: manifest.entries.length,
    buildReportSha256: buildReportSha,
    promptSnapshotSha256: promptSnapshotSha,
  })

  // M9 substrate (CODEX_RESPONSE_M9.md decision 5 + commit 13 bp#4):
  // record the BUILD adapter's RESOLVED provider id + family + model
  // durably so REVIEW's invocation-time check can compare BUILD family
  // to reviewer adapter family without re-deriving either. The family
  // comes from the runtime ProviderRegistry (which validates
  // adapter.family vs familyOf(adapter.id) at construction), not from
  // the static familyOf() — so a misregistered adapter that would
  // launder cross-family is rejected at registry construction, and
  // the recorded family is the one REVIEW will compare against.
  await appendEvent(eventPaths, {
    version: 1,
    type: 'build_provider_recorded',
    ts: now(),
    runId: opts.runId,
    phase: 'build',
    attempt,
    taskId: task.id,
    provider: opts.builderAgent.provider,
    family: opts.invokeCtx.registry.familyOf(opts.builderAgent.provider as ProviderId),
    ...(opts.builderAgent.model !== undefined ? { model: opts.builderAgent.model } : {}),
  })

  await requireGate({
    paths: opts.runPaths,
    runId: opts.runId,
    phase: 'build',
    blockedOn: 'code-oz approve build',
    now,
  })

  return Object.freeze({
    status: 'complete' as const,
    buildReportPath: reportPath,
    patchPath: apply.patchPath,
    patchSha256: apply.patchSha256,
    changedFileCount: manifest.entries.length,
    worktreePreserved: true as const,
  })
}

// --- helpers -------------------------------------------------------

function eventPathsFor(paths: RunPaths): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

async function loadPlanAndSelectTask(args: {
  readonly artifactRoot: string
  readonly taskId: string
}): Promise<
  | { ok: true; task: PlanTask; planSha: string }
  | { ok: false; code: string; reason: string }
> {
  if (!/^T-\d{3,}$/.test(args.taskId)) {
    return {
      ok: false,
      code: 'build_task_id_invalid',
      reason: `taskId must match /^T-\\d{3,}$/; got ${args.taskId}`,
    }
  }
  const planPath = join(args.artifactRoot, 'PLAN.md')
  let planText: string
  try {
    planText = await readFile(planPath, 'utf8')
  } catch {
    return {
      ok: false,
      code: 'build_plan_missing',
      reason: `cannot read PLAN.md at ${planPath}; PLAN must be approved before BUILD`,
    }
  }
  const planSha = createHash('sha256').update(planText, 'utf8').digest('hex')
  let plan
  try {
    plan = parsePlan(planText, planPath)
  } catch (err) {
    const reason = (err as Error).message.slice(0, 200)
    return { ok: false, code: 'build_plan_unparsable', reason }
  }
  const task = plan.tasks.find((t) => t.id === args.taskId)
  if (task === undefined) {
    return {
      ok: false,
      code: 'build_task_id_unknown',
      reason: `T-NNN ${args.taskId} not found in PLAN.md (tasks: ${plan.tasks.map((t) => t.id).join(', ')})`,
    }
  }
  return { ok: true, task, planSha }
}

function buildValidationCommand(args: {
  readonly planValidationCommand: string
  readonly worktreePath: string
  readonly defaults?: ValidationDefaults
}): {
  readonly command: string
  readonly workingDirectory: string
  readonly timeoutMs: number
  readonly expectedExitCode: number
} {
  const requested = args.defaults?.timeoutMs ?? DEFAULT_VALIDATION_TIMEOUT_MS
  const timeoutMs = Math.min(MAX_VALIDATION_TIMEOUT_MS, Math.max(1, requested))
  return Object.freeze({
    command: args.planValidationCommand,
    workingDirectory: args.defaults?.workingDirectory ?? args.worktreePath,
    timeoutMs,
    expectedExitCode: args.defaults?.expectedExitCode ?? DEFAULT_VALIDATION_EXIT_CODE,
  })
}

async function checkPlanBaseDrift(args: {
  readonly worktreePath: string
  readonly referencedFiles: readonly string[]
}): Promise<{ ok: true } | { ok: false; code: string; reason: string }> {
  // For each referenced file, allow it if either:
  //   - the file exists in the worktree at base (pre-patch state, modified case), OR
  //   - the file does not exist in the worktree (added case — patch will create it).
  // Reject if drift makes both conditions impossible (e.g., directory clash).
  // M7 simplification: we only fail if the *directory* of a referenced file
  // is occupied by a file. Full drift detection (HEAD moved between PLAN
  // and BUILD entry) is detected upstream via PLAN.md sha pin.
  for (const f of args.referencedFiles) {
    const abs = join(args.worktreePath, f)
    const dirAbs = abs.substring(0, abs.lastIndexOf('/'))
    if (dirAbs.length > 0 && (await isFileNotDir(dirAbs))) {
      return {
        ok: false,
        code: 'build_plan_base_drift',
        reason: `parent path ${dirAbs} is a file, not a directory; PLAN task ${f} cannot be applied`,
      }
    }
  }
  return { ok: true }
}

async function isFileNotDir(p: string): Promise<boolean> {
  try {
    const stat = await Bun.file(p).stat()
    return stat.isFile()
  } catch {
    return false
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function ensureRiskNote(
  personaNotes: readonly string[],
  riskNote: string,
): readonly string[] {
  const trimmedRisk = riskNote.trim()
  if (trimmedRisk.length === 0) return personaNotes
  if (personaNotes.some((n) => n.trim() === trimmedRisk)) return personaNotes
  // Persona forgot to copy the risk note verbatim; orchestrator prepends.
  return Object.freeze([trimmedRisk, ...personaNotes])
}

async function preserveBuildDraft(args: {
  readonly cwd: string
  readonly runId: string
  readonly taskId: string
  readonly attempt: number
  readonly content: string
  readonly filename: string
}): Promise<string> {
  const dir = buildDraftsAttemptPath(args.cwd, args.runId, args.taskId, args.attempt)
  await mkdir(dir, { recursive: true })
  const path = join(dir, args.filename)
  await writeFile(path, args.content, { encoding: 'utf8' })
  return path
}

async function recordIntervention(args: {
  readonly paths: RunPaths
  readonly runId: string
  readonly agent: string
  readonly code: string
  readonly rule: string
  readonly suggestions?: readonly string[]
  readonly eventPointer?: string
  readonly now: () => string
}): Promise<void> {
  const gatePaths: GatePaths = {
    runDir: args.paths.runDir,
    artifactRoot: args.paths.artifactRoot,
    lockDir: args.paths.lockDir,
  }
  const eventPaths: EventLogPaths = {
    file: args.paths.eventsFile,
    lockDir: args.paths.lockDir,
  }
  await withLock(args.paths.lockDir, async () => {
    const interventionLine = await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'intervention',
        ts: args.now(),
        runId: args.runId,
        code: args.code,
        phase: 'build',
      },
      { skipLock: true },
    )
    await writeNeedsInterventionGate(
      gatePaths,
      {
        version: 1,
        runId: args.runId,
        phase: 'build',
        code: args.code,
        rule: args.rule,
        agent: args.agent,
        actionableSuggestions: args.suggestions ?? buildInterventionSuggestions(args.code),
        eventPointer: args.eventPointer ?? `events.jsonl:line=${interventionLine}`,
        createdAt: args.now(),
      },
      { skipLock: true },
    )
  })
}

async function recordBuildFailure(args: {
  readonly paths: RunPaths
  readonly runId: string
  readonly agent: string
  readonly attempt: number
  readonly taskId: string
  readonly code: string
  readonly reason: string
  readonly now: () => string
}): Promise<void> {
  const eventPaths: EventLogPaths = {
    file: args.paths.eventsFile,
    lockDir: args.paths.lockDir,
  }
  // Emit build_failed BEFORE intervention, so audit reads see the
  // structured failure cause first.
  const failureLine = await appendEvent(eventPaths, {
    version: 1,
    type: 'build_failed',
    ts: args.now(),
    runId: args.runId,
    phase: 'build',
    agent: args.agent,
    attempt: args.attempt,
    taskId: args.taskId,
    code: args.code,
    reason: args.reason,
  })
  await recordIntervention({
    paths: args.paths,
    runId: args.runId,
    agent: args.agent,
    code: args.code,
    rule: args.reason,
    suggestions: buildInterventionSuggestions(args.code),
    eventPointer: `events.jsonl:line=${failureLine}`,
    now: args.now,
  })
}

function buildInterventionSuggestions(code: string): readonly string[] {
  switch (code) {
    case 'build_plan_missing':
    case 'build_task_id_unknown':
      return Object.freeze([
        'open .code-oz/artifacts/PLAN.md and confirm the task exists',
        'rerun code-oz approve plan after correcting PLAN.md',
      ])
    case 'restart_state_drift':
      return Object.freeze([
        'run code-oz doctor run to inspect the active task cursor',
        'rerun code-oz run without editing .code-oz state files by hand',
      ])
    case 'build_patch_apply_failed':
      return Object.freeze([
        'open .code-oz/artifacts/BUILD_REPORT.md and inspect the failed patch',
        'rerun code-oz run so BUILD can produce a corrected patch',
      ])
    default:
      return Object.freeze([
        'run code-oz doctor run to inspect the active run state',
        'rerun code-oz run after fixing the cause shown in NEEDS_INTERVENTION.json',
      ])
  }
}

function interventionResult(code: string, rule: string): BuildIntervention {
  return Object.freeze({
    status: 'intervention' as const,
    code,
    rule,
  })
}

// Re-export helper for tests / call sites that want the worktree paths
// without importing the worktree module directly.
export { worktreeRunPaths }
