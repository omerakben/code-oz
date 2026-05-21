// AUDIT phase orchestrator (brownfield entry phase).
//
// AUDIT is the brownfield analog of DEFINE, but SINGLE-SHOT: it analyzes an
// existing repository plus the operator's problem statement and produces a
// canonical AUDIT.md, rather than running DEFINE's conversational ask-me loop.
//
// Commit map (M17):
//   - C3 (this commit) — phase skeleton + locked event sequence:
//       phase_entered(audit)  [emitted by initRun, not here]
//       → repo_context_searched (honest selectedPaths: [] per rule 18;
//         selected-path promotion is deferred to M18)
//       → resolve the `auditor` persona via the agent registry.
//     C3's failure point: the auditor persona does not exist yet
//     (src/agents/defaults/auditor.md lands in C4), so getByName('auditor')
//     returns undefined. When undefined, record an actionable intervention
//     (rule 11: never an opaque stack trace) and return. No
//     `agent_invoked(auditor)` event is emitted on this path.
//   - C5b — AUDIT.md artifact production + structural validation.
//   - C6 — `audit_completed` event (with sha) + the approve hook + gate.
//
// The (currently-unreached) happy path is structured below so C4 can wire the
// auditor invocation and C5b/C6 can add artifact production + the gate without
// churning the surrounding code. AUDIT.md production, the Scientist phase tail,
// and the `audit_completed` event are deliberately NOT added in C3.

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
import type { ProviderError } from '../providers/errors.ts'

// The ready signal the auditor emits before its AUDIT.md draft. Parsing /
// validation of the draft lands in C5b; C4 only wires the invocation, so this
// constant is consumed by composeAuditPrompt today and by the C5b parser later.
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

/**
 * Emit the AUDIT phase's repo-context marker. Per rule 18, selected-path
 * promotion into the next invocation is deferred to M18, so this is an honest
 * "no paths selected" record (`selectedPaths: []`). C3 emits a single marker
 * event rather than running the repo_context tool runner; agentic search +
 * promotion land in M18.
 */
async function emitRepoContextMarker(args: {
  paths: RunPaths
  runId: string
  agent: string
  now: () => string
}): Promise<void> {
  await appendEvent(eventPathsFor(args.paths), {
    version: 1,
    type: 'repo_context_searched',
    ts: args.now(),
    runId: args.runId,
    phase: 'audit',
    agent: args.agent,
    tool: 'glob',
    query: '**/*',
    roots: Object.freeze(['.']),
    resultPaths: Object.freeze<string[]>([]),
    // Rule 18: promotion deferred to M18 — no path enters the next
    // invocation's context, so selectedPaths is empty.
    selectedPaths: Object.freeze<string[]>([]),
    resultBytes: 0,
    resultTokensEstimate: 0,
  })
}

// --- runAudit ------------------------------------------------------

export async function runAudit(opts: RunAuditOptions): Promise<AuditResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  // phase_entered(audit) is emitted by initRun (initialPhase('brownfield')
  // === 'audit') before the dispatcher reaches here. AUDIT records its
  // repo-context intent next; selected-path promotion is M18 (rule 18).
  await emitRepoContextMarker({
    paths: opts.runPaths,
    runId: opts.runId,
    agent: 'auditor',
    now,
  })

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

  // --- happy path (C4 wires invocation; C5b validates; C6 gate) ----
  //
  // C4 wires the single-shot auditor invocation through invokeAgent (the
  // existing rule-13 chokepoint), draining its ProviderEvents the same way
  // runPlan does — invokeAgent appends agent_invoked / agent_completed itself.
  // C5b's parser (parseAuditMarkdown) validates the draft; C6 (this commit)
  // writes the canonical AUDIT.md, emits `audit_completed` (with sha) BEFORE
  // `gate_required(audit)` — mirroring build.ts:800-812 — and the approve-time
  // preApproveAuditHook re-binds the on-disk sha to this event.
  //
  // This path is only reached once a project registers an `auditor` persona;
  // the bundled persona is human-co-authored (rule 16) and lands later, so
  // the e2e (tests/e2e/audit-brownfield-cli.test.ts) stays RED on the
  // agent_invoked(auditor) anchor until then. With no real auditor, the
  // drained draft never satisfies parseAuditMarkdown, so this path routes the
  // invalid draft through recordIntervention (rule 11) rather than writing a
  // malformed gate artifact — the emission below is structurally correct and
  // only fires once a persona produces a schema-valid AUDIT.md.

  // Tools the auditor may call (repo_context sub-scope, rule 18). Empty when
  // the persona declares none — matches runPlan's derivation.
  const availableTools =
    auditor.permissions.tool_use?.repo_context?.tools !== undefined
      ? [...auditor.permissions.tool_use.repo_context.tools]
      : []

  // Compose the AUDIT prompt: universal-rules-first (rule 16, guaranteed by
  // composeAuditPromptPure) + the auditor body + the operator's brownfield
  // problem statement carried in the user turn. The problem statement is
  // plumbed in via run_started (C4-prep) and surfaced to the persona here.
  const auditPrompt = await composeAuditPrompt({
    agentBody: auditor.body,
    readySignal: AUDIT_READY_SIGNAL,
    availableTools,
  })
  const userTurn =
    `Operator problem statement:\n\n${opts.problemStatement}\n\n` +
    'Analyze the existing repository and produce AUDIT.md per the locked schema.'

  // Drain the single-shot invocation. invokeAgent appends agent_invoked /
  // agent_completed automatically (rule 13 chokepoint); we collect the
  // streamed text for C5b's parser without acting on it yet.
  let auditText = ''
  for await (const event of invokeAgent(opts.invokeCtx, {
    runId: opts.runId,
    phase: 'audit',
    agent: auditor,
    files: [],
    prompt: `${auditPrompt}\n\n## Operator request\n\n${userTurn}`,
    // No `role`: `auditor` is outside M12_COMPANY_ROLES, so per-role budget
    // gating does not apply (canonicalRoleFromAgent would return undefined).
    // Adding the auditor to the role roster is a separate authority change
    // (rule 20); the invocation still counts against global + per-phase
    // budgets (rule 19).
  })) {
    if (event.type === 'content_chunk') auditText += event.text
    else if (event.type === 'turn_completed' && auditText.length === 0) {
      auditText = event.response.content
    }
  }
  const target = auditPath(opts.runPaths)

  // C5b validation: the drained draft must satisfy the locked AUDIT.md schema
  // before it becomes the canonical artifact (rule 11: a malformed draft never
  // reaches a gate). parseAuditMarkdown throws AuditLoadError with the issue
  // list when invalid. Without a registered auditor the draft is always
  // invalid, so this is the reached endpoint today.
  try {
    parseAuditMarkdown(auditText, { file: target, expectedRunId: opts.runId })
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
  await atomicWriteFile(target, auditText, { fsyncDir: opts.fsyncDir })
  const auditReportSha256 = createHash('sha256').update(auditText, 'utf8').digest('hex')
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'audit_completed',
    ts: now(),
    runId: opts.runId,
    phase: 'audit',
    auditReportSha256,
  })
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
