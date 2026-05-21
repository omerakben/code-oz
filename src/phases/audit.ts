// AUDIT phase orchestrator (brownfield entry phase).
//
// AUDIT is the brownfield analog of DEFINE: it analyzes an existing repository
// plus the operator's problem statement and produces a canonical AUDIT.md,
// rather than running DEFINE's conversational ask-me loop. The auditor reaches
// the repo through the bounded repo_context dispatch loop (rule 18), mirroring
// runPlan — glob/grep/read at the persona's locked caps; each tool call appends
// a REAL `repo_context_searched` event with actual results.
//
// Locked event sequence:
//   phase_entered(audit)  [emitted by initRun, not here]
//   → resolve the `auditor` persona via the agent registry
//   → agent_invoked(auditor) [emitted by invokeAgent, the rule-13 chokepoint]
//   → repo_context_searched (0+, one per dispatched tool call; the runner
//     emits these with the real query + results; selected-path PROMOTION into
//     a later phase's manifest is deferred to M18 — the results inform the
//     AUDIT.md the auditor writes, they do NOT enter PLAN's manifest)
//   → agent_completed(auditor)
//   → audit_completed (with sha) → gate_required(audit).
//
// When the auditor persona is unresolved (e.g. the bundled
// src/agents/defaults/auditor.md was removed), runAudit records an actionable
// intervention (rule 11: never an opaque stack trace) and returns. No
// `agent_invoked(auditor)` and no `repo_context_searched` event is emitted on
// that path — no search ran, so logging one would be dishonest (rule 18).

import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { invokeAgent, type InvokeContext } from '../providers/invoke.ts'
import { composeAuditPrompt } from '../prompts/index.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import { parseAuditMarkdown } from '../artifacts/audit-parser.ts'
import { AuditLoadError } from '../artifacts/errors.ts'
import { CANONICAL_ARTIFACTS } from '../state/schemas.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
import {
  writeNeedsInterventionGate,
  type GatePaths,
} from '../state/gates.ts'
import { appendEvent, type EventLogPaths } from '../state/events.ts'
import { withLock } from '../state/lock.ts'
import type { AgentRegistry } from '../agents/loader.ts'
import type { AgentDefinition } from '../agents/schema.ts'
import { REPO_CONTEXT_TOOL_NAMES } from '../agents/schema.ts'
import type { ProviderError } from '../providers/errors.ts'
import type { ProviderToolCall } from '../providers/types.ts'
import { runRepoContextTool } from '../tools/repo-context/runner.ts'
import type { RepoContextRequest } from '../tools/repo-context/types.ts'
import { runScientistPhaseTail } from './scientist.ts'
import { validateScientistSidecars } from './gate-preflight.ts'

// The ready signal the auditor emits before its AUDIT.md draft. The persona
// emits this on its own line, THEN the canonical AUDIT.md (frontmatter on line
// 1). `splitAuditResponse` strips the signal before parse/validate/write so the
// frontmatter sits on line 1 where validateAuditMarkdown expects it.
export const AUDIT_READY_SIGNAL = '<audit-ready/>'

// --- public API ----------------------------------------------------

export type AuditStatus = 'complete' | 'intervention'

export interface AuditComplete {
  readonly status: 'complete'
  /** Absolute path to the written AUDIT.md. */
  readonly auditPath: string
  /** A short message the CLI prints on success. */
  readonly userMessage: string
}

export interface AuditIntervention {
  readonly status: 'intervention'
  /** The reason code recorded on NEEDS_INTERVENTION.json. */
  readonly code: string
  readonly rule: string
  readonly actionableSuggestions: readonly string[]
  /** Optional underlying provider error if status came from invokeAgent. */
  readonly providerError?: ProviderError
  /** Message the CLI prints to the user. */
  readonly userMessage: string
}

export type AuditResult = AuditComplete | AuditIntervention

export interface RunAuditOptions {
  readonly invokeCtx: InvokeContext
  readonly runPaths: RunPaths
  readonly runId: string
  /**
   * Agent registry the phase resolves the `auditor` persona from. Passed in
   * (rather than read from a global) so unit tests can drive an empty
   * registry — the C3 failure endpoint.
   */
  readonly agentRegistry: AgentRegistry
  /**
   * The Scientist persona. AUDIT is a primary-artifact phase, so it runs the
   * Scientist phase-tail (rule 15) after writing AUDIT.md to produce
   * HYPOTHESES.md + OPEN_QUESTIONS.md — mirroring PLAN/BUILD/VERIFY/REVIEW.
   * Passed in (rather than re-resolved from `agentRegistry`) so the caller
   * (dispatchAudit) fails fast with one actionable message when either the
   * auditor or the scientist persona is missing, matching PLAN's dispatcher.
   */
  readonly scientistAgent: AgentDefinition
  /** The operator's brownfield problem statement (from `code-oz run --request`). */
  readonly problemStatement: string
  readonly now?: () => string
  /** When false, skips dir-fsync after artifact rename (test ergonomics). */
  readonly fsyncDir?: boolean
}

// --- helpers -------------------------------------------------------

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

function auditPath(paths: RunPaths): string {
  return join(paths.artifactRoot, CANONICAL_ARTIFACTS.audit) // AUDIT.md
}

// --- response splitter ---------------------------------------------

/**
 * Strip the AUDIT ready signal from the auditor's reply, returning the
 * canonical AUDIT.md text that follows it. Mirrors `splitPlanResponse`
 * (src/phases/plan.ts:231-250) but is simpler: AUDIT is a SINGLE document, so
 * there is no second-marker split. Returns `null` when the signal is absent or
 * nothing follows it — the caller treats that as a protocol violation (the
 * raw text is never silently parsed, mirroring PLAN's `plan_no_ready_token`).
 */
export function splitAuditResponse(response: string): string | null {
  const lines = response.split(/\r?\n/)
  let readyIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === AUDIT_READY_SIGNAL) {
      readyIdx = i
      break
    }
  }
  if (readyIdx === -1) return null
  const after = lines.slice(readyIdx + 1).join('\n').trim()
  if (after.length === 0) return null
  return after
}

async function recordIntervention(args: {
  paths: RunPaths
  runId: string
  agent: string
  code: string
  rule: string
  detail?: string
  actionableSuggestions: readonly string[]
  now: () => string
}): Promise<void> {
  await withLock(args.paths.lockDir, async () => {
    const eventLine = await appendEvent(
      eventPathsFor(args.paths),
      {
        version: 1,
        type: 'intervention',
        ts: args.now(),
        runId: args.runId,
        code: args.code,
        phase: 'audit',
      },
      { skipLock: true },
    )
    await writeNeedsInterventionGate(
      gatePathsFor(args.paths),
      {
        version: 1,
        runId: args.runId,
        phase: 'audit',
        agent: args.agent,
        code: args.code,
        rule: args.rule,
        ...(args.detail !== undefined ? { detail: args.detail } : {}),
        actionableSuggestions: args.actionableSuggestions,
        eventPointer: `events.jsonl:line=${eventLine}`,
        createdAt: args.now(),
      },
      { skipLock: true },
    )
  })
}

// --- tool-call → repo-context request mapper ----------------------
//
// Mirrors `parseRepoContextToolCall` in src/phases/plan.ts. The auditor reaches
// the repo through the SAME bounded glob/grep/read sub-scope PLAN uses; the
// orchestrator maps each `tool_call` event into a typed RepoContextRequest the
// runner can execute. Malformed inputs return null and the loop skips them.
function parseRepoContextToolCall(call: ProviderToolCall): RepoContextRequest | null {
  if (call.input === null || typeof call.input !== 'object') return null
  const input = call.input as Record<string, unknown>
  switch (call.name) {
    case 'glob': {
      if (typeof input.pattern !== 'string') return null
      const roots =
        Array.isArray(input.roots) && input.roots.every((r) => typeof r === 'string')
          ? (input.roots as string[])
          : undefined
      return { tool: 'glob', args: { pattern: input.pattern, roots } }
    }
    case 'grep': {
      if (typeof input.pattern !== 'string') return null
      const roots =
        Array.isArray(input.roots) && input.roots.every((r) => typeof r === 'string')
          ? (input.roots as string[])
          : undefined
      return {
        tool: 'grep',
        args: {
          pattern: input.pattern,
          roots,
          ...(typeof input.regex === 'boolean' ? { regex: input.regex } : {}),
          ...(typeof input.ignoreCase === 'boolean' ? { ignoreCase: input.ignoreCase } : {}),
        },
      }
    }
    case 'read': {
      if (typeof input.path !== 'string') return null
      let lineRange: [number, number] | undefined
      if (
        Array.isArray(input.lineRange) &&
        input.lineRange.length === 2 &&
        Number.isInteger(input.lineRange[0]) &&
        Number.isInteger(input.lineRange[1])
      ) {
        lineRange = [input.lineRange[0] as number, input.lineRange[1] as number]
      }
      return {
        tool: 'read',
        args: { path: input.path, ...(lineRange !== undefined ? { lineRange } : {}) },
      }
    }
    default:
      return null
  }
}

// --- runAudit ------------------------------------------------------

export async function runAudit(opts: RunAuditOptions): Promise<AuditResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  // phase_entered(audit) is emitted by initRun (initialPhase('brownfield')
  // === 'audit') before the dispatcher reaches here. The auditor reaches the
  // repo through the bounded repo_context dispatch loop below (rule 18); the
  // runner emits a REAL `repo_context_searched` event per tool call with
  // actual results. Selected-path PROMOTION into a later phase's manifest
  // stays deferred to M18 — the searched results inform the AUDIT.md the
  // auditor writes, they do NOT enter PLAN's manifest.

  // Resolve the AUDIT persona. The auditor lands in C4
  // (src/agents/defaults/auditor.md is human-co-authored); until then this
  // returns undefined and AUDIT pauses with an actionable intervention
  // (rule 11) rather than emitting agent_invoked(auditor) or crashing.
  const auditor = opts.agentRegistry.getByName('auditor')
  if (auditor === undefined) {
    const code = 'auditor_persona_not_registered'
    const rule =
      'AUDIT requires the bundled `auditor` persona; brownfield runs cannot analyze the repo without it'
    const actionableSuggestions = [
      'reinitialize the project (`code-oz init --force`) to restore .code-oz/agents/',
      'or restore src/agents/defaults/auditor.md if it was removed',
      'AUDIT is the brownfield entry phase; greenfield runs use DEFINE (`ba`) instead',
    ]
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: 'auditor',
      code,
      rule,
      actionableSuggestions,
      now,
    })
    return Object.freeze({
      status: 'intervention',
      code,
      rule,
      actionableSuggestions,
      userMessage: [
        'AUDIT phase could not start: the `auditor` persona is not registered.',
        ...actionableSuggestions.map((s) => `  - ${s}`),
      ].join('\n'),
    })
  }

  // --- happy path: bounded repo_context dispatch loop --------------
  //
  // A11 R1 block-push fix: the auditor reaches the repo through the SAME
  // bounded glob/grep/read dispatch/continuation loop runPlan uses
  // (src/phases/plan.ts § "Tool-use dispatch loop"). The prior single-shot
  // drain advertised repo_context tools but never ran them and emitted a
  // synthetic empty `repo_context_searched` marker — a live auditor (isolated
  // cwd, only the prompt) audited blind. Now: invoke → collect content +
  // tool_calls → if no tool_calls, that turn's text is the final AUDIT draft,
  // break → else dispatch each repo_context tool_call via runRepoContextTool
  // (which appends the REAL `repo_context_searched` event with actual
  // results), append the tool history, recompose the AUDIT prompt with the
  // continuation, and loop again. Bounded by MAX_TOOL_DISPATCH_TURNS — the
  // same cap value runPlan uses — so a tool-looping auditor cannot run
  // unbounded. invokeAgent appends agent_invoked / agent_completed itself
  // (rule 13 chokepoint).
  //
  // The auditor's roots bind to the run's project root (opts.invokeCtx
  // .projectRoot), exactly as PLAN binds repo_context — the project under
  // audit / the run worktree. Selected-path PROMOTION stays deferred to M18:
  // the results inform the AUDIT.md the auditor writes, they do NOT enter a
  // later phase's manifest.
  //
  // C5b's parser (parseAuditMarkdown) validates the final draft; C6 writes the
  // canonical AUDIT.md, emits `audit_completed` (with sha) BEFORE
  // `gate_required(audit)` — mirroring build.ts:800-812 — and the approve-time
  // preApproveAuditHook re-binds the on-disk sha to this event.

  // Tools the auditor may call (repo_context sub-scope, rule 18). Empty when
  // the persona declares none — matches runPlan's derivation.
  const availableTools =
    auditor.permissions.tool_use?.repo_context?.tools !== undefined
      ? [...auditor.permissions.tool_use.repo_context.tools]
      : []

  const baseUserTurn =
    `Operator problem statement:\n\n${opts.problemStatement}\n\n` +
    'Analyze the existing repository and produce AUDIT.md per the locked schema.'

  // Bounded tool-dispatch loop. Mirrors runPlan's MAX_TOOL_DISPATCH_TURNS = 5.
  const MAX_TOOL_DISPATCH_TURNS = 5
  let auditText = ''
  let toolHistoryBlock = ''
  let toolDispatchTurn = 0
  let providerErr: Error | null = null
  const target = auditPath(opts.runPaths)

  try {
    while (toolDispatchTurn < MAX_TOOL_DISPATCH_TURNS) {
      // Recompose the AUDIT prompt each turn (like PLAN recomposes via
      // composePlanPrompt) so the accumulated tool history reaches the
      // persona. The system prompt is universal-rules-first (rule 16,
      // guaranteed by composeAuditPromptPure); the operator request + tool
      // history ride in the user turn.
      const auditPrompt = await composeAuditPrompt({
        agentBody: auditor.body,
        readySignal: AUDIT_READY_SIGNAL,
        availableTools,
      })
      const userTurn =
        baseUserTurn +
        (toolHistoryBlock.length > 0 ? `\n\n## Tool history\n${toolHistoryBlock}` : '')

      let turnText = ''
      const toolCalls: ProviderToolCall[] = []
      for await (const event of invokeAgent(opts.invokeCtx, {
        runId: opts.runId,
        phase: 'audit',
        agent: auditor,
        files: [],
        prompt: `${auditPrompt}\n\n## Operator request\n\n${userTurn}`,
        // No `role`: `auditor` is outside M12_COMPANY_ROLES, so per-role
        // budget gating does not apply (canonicalRoleFromAgent would return
        // undefined). Adding the auditor to the role roster is a separate
        // authority change (rule 20); the invocation still counts against
        // global + per-phase budgets (rule 19).
      })) {
        if (event.type === 'content_chunk') turnText += event.text
        else if (event.type === 'tool_call') toolCalls.push(event.call)
        else if (event.type === 'turn_completed' && turnText.length === 0) {
          turnText = event.response.content
        }
      }

      if (toolCalls.length === 0) {
        // Persona produced final output (or an empty response); break the
        // dispatch loop. This is the no-tool-call path the full-cycle e2e
        // exercises — the fake auditor returns the AUDIT.md directly on turn 1.
        auditText = turnText
        break
      }

      // Dispatch each repo-context tool call. Tools outside the registered set
      // are skipped (mirrors runPlan). runRepoContextTool appends the REAL
      // `repo_context_searched` event with the actual query + results.
      for (const call of toolCalls) {
        if (!(REPO_CONTEXT_TOOL_NAMES as readonly string[]).includes(call.name)) {
          toolHistoryBlock += `\n- ${call.name}: tool not in repo_context scope; skipped.`
          continue
        }
        const request = parseRepoContextToolCall(call)
        if (request === null) {
          toolHistoryBlock += `\n- ${call.name}: malformed input; skipped.`
          continue
        }
        const outcome = await runRepoContextTool(
          {
            agentName: auditor.name,
            agentPermissions: auditor.permissions,
            phase: 'audit',
            runId: opts.runId,
            projectRoot: opts.invokeCtx.projectRoot,
            eventPaths: eventPathsFor(opts.runPaths),
            now,
          },
          request,
        )
        const summary =
          outcome.status === 'ok'
            ? JSON.stringify(outcome.result).slice(0, 1024)
            : `error: ${outcome.error.message}`
        toolHistoryBlock += `\n- ${call.name}(${JSON.stringify(call.input).slice(0, 256)}) -> ${summary}`
      }
      toolDispatchTurn++
    }
  } catch (err) {
    providerErr = err as Error
  }

  if (providerErr !== null) {
    const code = 'audit_provider_error'
    const rule = `auditor invocation failed: ${providerErr.message}`
    const actionableSuggestions = [
      'inspect events.jsonl for the underlying provider error',
      'address the underlying error and re-run AUDIT',
    ]
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: 'auditor',
      code,
      rule,
      detail: providerErr.message,
      actionableSuggestions,
      now,
    })
    return Object.freeze({
      status: 'intervention',
      code,
      rule,
      actionableSuggestions,
      userMessage: 'AUDIT phase failed: the auditor invocation errored.',
    })
  }

  if (toolDispatchTurn >= MAX_TOOL_DISPATCH_TURNS && auditText === '') {
    const code = 'audit_tool_loop_exhausted'
    const rule = `auditor exceeded ${MAX_TOOL_DISPATCH_TURNS} tool-dispatch turns without producing a final AUDIT.md`
    const actionableSuggestions = [
      'narrow the operator problem statement or simplify the auditor persona body',
      'or raise MAX_TOOL_DISPATCH_TURNS in src/phases/audit.ts',
    ]
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: 'auditor',
      code,
      rule,
      actionableSuggestions,
      now,
    })
    return Object.freeze({
      status: 'intervention',
      code,
      rule,
      actionableSuggestions,
      userMessage: `AUDIT phase did not converge: the auditor exceeded ${MAX_TOOL_DISPATCH_TURNS} tool-dispatch turns.`,
    })
  }

  // Strip the AUDIT ready signal before validate/write. The persona emits
  // `<audit-ready/>` on its own line, THEN the canonical AUDIT.md (frontmatter
  // on line 1); feeding the raw reply to validateAuditMarkdown would push the
  // frontmatter off line 1 and fail `audit_missing_frontmatter`. Mirrors PLAN's
  // splitPlanResponse. AUDIT requires the signal: when it is absent (or nothing
  // follows it) the reply violated the output protocol — route it through the
  // same `audit_validation_failed` intervention (rule 11) rather than silently
  // parsing the raw text.
  const auditDoc = splitAuditResponse(auditText)
  if (auditDoc === null) {
    const code = 'audit_validation_failed'
    const rule = `auditor reply missing the ${AUDIT_READY_SIGNAL} ready signal (or no document followed it)`
    const actionableSuggestions = [
      `the auditor must emit ${AUDIT_READY_SIGNAL} on its own line, then the canonical AUDIT.md (target: ${target})`,
      're-run AUDIT once the auditor produces a protocol-faithful reply',
    ]
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: 'auditor',
      code,
      rule,
      detail: `expected the reply to begin (after any preamble) with a line containing only ${AUDIT_READY_SIGNAL}`,
      actionableSuggestions,
      now,
    })
    return Object.freeze({
      status: 'intervention',
      code,
      rule,
      actionableSuggestions,
      userMessage: `AUDIT phase produced a reply missing the ${AUDIT_READY_SIGNAL} ready signal.`,
    })
  }

  // C5b validation: the stripped draft must satisfy the locked AUDIT.md schema
  // before it becomes the canonical artifact (rule 11: a malformed draft never
  // reaches a gate). parseAuditMarkdown throws AuditLoadError with the issue
  // list when invalid.
  try {
    parseAuditMarkdown(auditDoc, { file: target, expectedRunId: opts.runId })
  } catch (err) {
    const code = 'audit_validation_failed'
    const rule = 'AUDIT.md draft did not satisfy the locked schema'
    const detail =
      err instanceof AuditLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ')
        : (err as Error).message
    const actionableSuggestions = [
      `inspect the auditor draft and fix the schema issues, or re-run AUDIT (target: ${target})`,
      'the bundled `auditor` persona that produces a schema-valid AUDIT.md is human-co-authored (rule 16) and lands later',
    ]
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: 'auditor',
      code,
      rule,
      detail,
      actionableSuggestions,
      now,
    })
    return Object.freeze({
      status: 'intervention',
      code,
      rule,
      actionableSuggestions,
      userMessage: 'AUDIT phase produced an invalid AUDIT.md draft (schema validation failed).',
    })
  }

  // Write the canonical AUDIT.md atomically, then emit `audit_completed`
  // (carrying the artifact sha256) BEFORE `gate_required(audit)`. Mirrors
  // build.ts:800-812: the sha is computed over the exact bytes written so the
  // approve-time preApproveAuditHook can re-bind the on-disk artifact to this
  // event. No audit-specific gate primitive (rule 1): requireGate is the
  // generic phase-approval signal every phase uses.
  await atomicWriteFile(target, auditDoc, { fsyncDir: opts.fsyncDir })
  const auditReportSha256 = createHash('sha256').update(auditDoc, 'utf8').digest('hex')
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'audit_completed',
    ts: now(),
    runId: opts.runId,
    phase: 'audit',
    auditReportSha256,
  })

  // Scientist phase-tail (rule 15). AUDIT is a primary-artifact phase, so it
  // produces HYPOTHESES.md + OPEN_QUESTIONS.md from AUDIT.md before the gate is
  // required — mirroring runPlan (src/phases/plan.ts:864-914): write canonical
  // artifact → tail → gate-preflight → requireGate. The sidecars MUST exist
  // before `gate_required(audit)` so `approve audit`'s validateScientistSidecars
  // can pass.
  const scientistResult = await runScientistPhaseTail({
    invokeCtx: opts.invokeCtx,
    runPaths: opts.runPaths,
    runId: opts.runId,
    agent: opts.scientistAgent,
    phase: 'audit',
    primaryArtifactPath: target,
    fsyncDir: opts.fsyncDir,
    now,
  })
  if (scientistResult.status === 'intervention') {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.scientistAgent.name,
      code: scientistResult.code,
      rule: scientistResult.rule,
      actionableSuggestions: [
        'inspect Scientist drafts (HYPOTHESES.draft.md, OPEN_QUESTIONS.draft.md) and rerun AUDIT',
      ],
      now,
    })
    return Object.freeze({
      status: 'intervention',
      code: scientistResult.code,
      rule: scientistResult.rule,
      actionableSuggestions: [
        'inspect Scientist drafts (HYPOTHESES.draft.md, OPEN_QUESTIONS.draft.md) and rerun AUDIT',
      ],
      userMessage: 'AUDIT phase Scientist tail did not produce valid sidecars.',
    })
  }

  // Gate-preflight: the sidecars must be present, parsable, non-blocking, and
  // free of overdue open questions before the gate is required (rule 15).
  // Mirrors runPlan's preflight call.
  const preflight = await validateScientistSidecars({
    phase: 'audit',
    artifactRoot: opts.runPaths.artifactRoot,
    today: now().slice(0, 10),
  })
  if (!preflight.ok) {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: 'auditor',
      code: preflight.code,
      rule: preflight.rule,
      ...(preflight.detail !== undefined ? { detail: preflight.detail } : {}),
      actionableSuggestions: preflight.actionableSuggestions,
      now,
    })
    return Object.freeze({
      status: 'intervention',
      code: preflight.code,
      rule: preflight.rule,
      actionableSuggestions: preflight.actionableSuggestions,
      userMessage: 'AUDIT phase Scientist sidecar preflight failed.',
    })
  }

  await requireGate({
    paths: opts.runPaths,
    runId: opts.runId,
    phase: 'audit',
    blockedOn: 'user approval via `code-oz approve audit`',
    now,
  })

  return Object.freeze({
    status: 'complete',
    auditPath: target,
    userMessage: [
      `AUDIT phase complete. Review ${target}, then run:`,
      '  code-oz approve audit',
    ].join('\n'),
  })
}
