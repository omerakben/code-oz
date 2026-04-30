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
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentDefinition } from '../agents/schema.ts'
import {
  serializeBuildReport,
  parseBuildReport,
  BuildReportLoadError,
  type BuildReportData,
} from '../artifacts/build-report.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import { applyAgentPatch } from '../patches/apply-agent-patch.ts'
import { composeBuildPrompt } from '../prompts/index.ts'
import {
  appendEvent,
  type EventLogPaths,
} from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { withLock } from '../state/lock.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
import { computeManifest } from '../worktree/manifest.ts'
import { runPaths as worktreeRunPaths, buildDraftsAttemptPath } from '../worktree/paths.ts'

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
  /** The selected PLAN task to implement (one BUILD attempt = one task). */
  readonly task: PlanTaskBinding
  /** Pre-resolved worktree state (worktree must already exist before BUILD). */
  readonly worktree: WorktreeBinding
  /** sha256 of the PLAN.md content at BUILD entry (preflight pin). */
  readonly planSha: string
  /**
   * Persona-response provider. The orchestrator does not invoke providers
   * directly here; the runner takes the composed prompt and returns the
   * persona's response text. This lets the e2e test inject a FakeProvider
   * response without round-tripping the InvokeContext for M7.
   */
  readonly invokePersona: (composedPrompt: string) => Promise<string>
  readonly attempt?: number
  readonly fsyncDir?: boolean
  readonly now?: () => string
}

export interface PlanTaskBinding {
  readonly taskId: string // T-NNN
  /** Validation command bullets, copied verbatim from PLAN task block (Codex M2). */
  readonly validationCommand: {
    readonly command: string
    readonly workingDirectory: string
    readonly timeoutMs: number
    readonly expectedExitCode: number
  }
  /** Risk note from PLAN task — required in BUILD_REPORT.md § Notes. */
  readonly riskNote: string
  /** Files the PLAN task says it touches (for drift check). */
  readonly referencedFiles: readonly string[]
}

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

export async function runBuild(opts: RunBuildOptions): Promise<BuildResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const attempt = opts.attempt ?? 1
  const eventPaths = eventPathsFor(opts.runPaths)

  // BUILD entry preflight: drift check (per BUILD.md § "BUILD entry preflight").
  // If the PLAN task references a file absent from the bound base AND not
  // declared as `added`, abort with build_plan_base_drift. We treat the
  // referenced file list as authoritative for drift.
  const driftCheck = await checkPlanBaseDrift({
    worktreePath: opts.worktree.worktreePath,
    referencedFiles: opts.task.referencedFiles,
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
    taskId: opts.task.taskId,
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
      taskId: opts.task.taskId,
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
      taskId: opts.task.taskId,
      attempt,
      content: responseText,
      filename: 'response.draft.md',
    })
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: opts.task.taskId,
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
    taskId: opts.task.taskId,
    attempt,
    patchContent: parsed.patchContent,
  })
  if (!apply.ok) {
    // Write the response draft for human inspection
    await preserveBuildDraft({
      cwd: opts.cwd,
      runId: opts.runId,
      taskId: opts.task.taskId,
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
        taskId: opts.task.taskId,
        reason: apply.reason,
      })
    }
    await recordBuildFailure({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.builderAgent.name,
      attempt,
      taskId: opts.task.taskId,
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
    taskId: opts.task.taskId,
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
    taskId: opts.task.taskId,
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
      taskId: opts.task.taskId,
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
      taskId: opts.task.taskId,
      title: parsed.title,
      planSha: opts.planSha,
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
    validationCommand: opts.task.validationCommand,
    failureCarryForward: null, // M7: always attempt 1 with no prior carry-forward
    notes: ensureRiskNote(parsed.notes, opts.task.riskNote),
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
      taskId: opts.task.taskId,
      code: 'build_report_validation_failed',
      reason: reason.slice(0, 200),
      now,
    })
    return interventionResult('build_report_validation_failed', reason.slice(0, 200))
  }

  // Atomic write.
  const reportPath = join(opts.runPaths.artifactRoot, 'BUILD_REPORT.md')
  await atomicWriteFile(reportPath, buildReportText)

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
      taskId: opts.task.taskId,
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
    taskId: opts.task.taskId,
    changedFileCount: manifest.entries.length,
    buildReportSha256: buildReportSha,
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
    await writeNeedsInterventionGate(
      gatePaths,
      {
        version: 1,
        runId: args.runId,
        phase: 'build',
        code: args.code,
        rule: args.rule,
        agent: args.agent,
        actionableSuggestions: [],
        createdAt: args.now(),
      },
      { skipLock: true },
    )
    await appendEvent(
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
  await appendEvent(eventPaths, {
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
    now: args.now,
  })
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
