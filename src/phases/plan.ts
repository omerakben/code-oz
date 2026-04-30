// PLAN phase orchestrator.
//
// Wires the Lead persona to artifact I/O, the Scientist phase-tail, the
// gate-preflight, and the gate writer. M6 minimum-viable: single-turn
// invocation (no ask-me loop). M7+ may add a multi-turn variant if the
// PLAN phase needs clarifying interaction.
//
// Discipline (mirrors define.ts):
//   - On success: serialize PlanArtifact + SourceCheckArtifact to canonical
//     Markdown, atomically write both, run Scientist tail, run gate-preflight,
//     call requireGate(plan, ...). NEVER a draft on the success path.
//   - On any validation failure: write the unvalidated draft to <name>.draft.md
//     and a NEEDS_INTERVENTION + intervention event. NEVER the canonical artifact.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { invokeAgent, type InvokeContext } from '../providers/invoke.ts'
import { withLock } from '../state/lock.ts'
import {
  appendEvent,
  type EventLogPaths,
} from '../state/events.ts'
import { CANONICAL_ARTIFACTS } from '../state/schemas.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
import {
  writeNeedsInterventionGate,
  type GatePaths,
} from '../state/gates.ts'
import type { AgentDefinition } from '../agents/schema.ts'
import {
  parsePlan,
  serializePlan,
} from '../artifacts/plan.ts'
import {
  parseSourceCheck,
  serializeSourceCheck,
} from '../artifacts/source-check.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import { composePlanPrompt } from '../prompts/index.ts'
import { runScientistPhaseTail } from './scientist.ts'
import { validateScientistSidecars } from './gate-preflight.ts'

// --- public API ----------------------------------------------------

export const PLAN_READY_SIGNAL = '<plan-ready/>'

export type PlanStatus = 'complete' | 'intervention'

export interface PlanComplete {
  readonly status: 'complete'
  readonly planPath: string
  readonly sourceCheckPath: string
  readonly hypothesesPath: string
  readonly openQuestionsPath: string
}

export interface PlanIntervention {
  readonly status: 'intervention'
  readonly code: string
  readonly rule: string
  readonly draftPaths?: readonly string[]
}

export type PlanResult = PlanComplete | PlanIntervention

export interface RunPlanOptions {
  readonly invokeCtx: InvokeContext
  readonly runPaths: RunPaths
  readonly runId: string
  readonly leadAgent: AgentDefinition
  readonly scientistAgent: AgentDefinition
  readonly fsyncDir?: boolean
  readonly now?: () => string
  /**
   * Optional turn-0 user input. Defaults to a stock "produce the plan" prompt
   * when omitted. The Lead persona is configured for single-turn output in
   * v0.1; ask-me-style multi-turn is W2+.
   */
  readonly initialUserInput?: string
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

function planPath(paths: RunPaths): string {
  return join(paths.artifactRoot, CANONICAL_ARTIFACTS.plan) // PLAN.md
}
function planDraftPath(paths: RunPaths): string {
  return join(paths.artifactRoot, 'PLAN.draft.md')
}
function sourceCheckPath(paths: RunPaths): string {
  return join(paths.artifactRoot, 'SOURCE_CHECK.md')
}
function sourceCheckDraftPath(paths: RunPaths): string {
  return join(paths.artifactRoot, 'SOURCE_CHECK.draft.md')
}
function specPath(paths: RunPaths): string {
  return join(paths.artifactRoot, CANONICAL_ARTIFACTS.define) // SPEC.md
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
    await writeNeedsInterventionGate(
      gatePathsFor(args.paths),
      {
        version: 1,
        runId: args.runId,
        phase: 'plan',
        agent: args.agent,
        code: args.code,
        rule: args.rule,
        ...(args.detail !== undefined ? { detail: args.detail } : {}),
        actionableSuggestions: args.actionableSuggestions,
        createdAt: args.now(),
      },
      { skipLock: true },
    )
    await appendEvent(
      eventPathsFor(args.paths),
      {
        version: 1,
        type: 'intervention',
        ts: args.now(),
        runId: args.runId,
        code: args.code,
        phase: 'plan',
      },
      { skipLock: true },
    )
  })
}

// --- response splitter ---------------------------------------------

export function splitPlanResponse(
  response: string,
): { planText: string; sourceCheckText: string } | null {
  const lines = response.split(/\r?\n/)
  let readyIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === PLAN_READY_SIGNAL) {
      readyIdx = i
      break
    }
  }
  if (readyIdx === -1) return null
  const after = lines.slice(readyIdx + 1).join('\n').trim()
  if (after.length === 0) return null
  const scIdx = after.search(/^# SOURCE_CHECK\b/m)
  if (scIdx === -1) return null
  const planText = after.slice(0, scIdx).trim()
  const sourceCheckText = after.slice(scIdx).trim()
  return { planText, sourceCheckText }
}

// --- runPlan -------------------------------------------------------

export async function runPlan(opts: RunPlanOptions): Promise<PlanResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  // 1. Load SPEC.md
  let specText: string
  try {
    specText = await readFile(specPath(opts.runPaths), 'utf8')
  } catch {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_spec_missing',
      rule: 'PLAN cannot run without an approved SPEC.md',
      actionableSuggestions: [
        'rerun DEFINE and approve before re-attempting PLAN',
      ],
      now,
    })
    return {
      status: 'intervention',
      code: 'plan_spec_missing',
      rule: 'PLAN cannot run without an approved SPEC.md',
    }
  }

  // 2. Compose prompt
  const availableTools =
    opts.leadAgent.permissions.tool_use?.repo_context?.tools !== undefined
      ? [...opts.leadAgent.permissions.tool_use.repo_context.tools]
      : []
  const userTurn = opts.initialUserInput ?? 'Read the SPEC.md and produce PLAN.md + SOURCE_CHECK.md per the locked schemas.'
  const prompt = await composePlanPrompt({
    agentBody: opts.leadAgent.body,
    history: [
      { role: 'user', text: `${userTurn}\n\nSPEC.md:\n\n${specText.trim()}` },
    ],
    readySignal: PLAN_READY_SIGNAL,
    availableTools,
  })

  // 3. Invoke Lead persona
  let responseText = ''
  let stopReason = 'end' as string
  try {
    for await (const event of invokeAgent(opts.invokeCtx, {
      runId: opts.runId,
      phase: 'plan',
      agent: opts.leadAgent,
      // SPEC.md content is inlined into the prompt; no files manifest entry
      // is needed in M6. Future M7+ multi-turn variant may add tool-result
      // files here as the persona promotes them.
      files: [],
      prompt,
    })) {
      if (event.type === 'content_chunk') responseText += event.text
      else if (event.type === 'turn_completed') {
        stopReason = event.response.stopReason
        if (responseText.length === 0) responseText = event.response.content
      }
    }
  } catch (err) {
    // wrapper already wrote NEEDS_INTERVENTION on ProviderError
    return {
      status: 'intervention',
      code: 'plan_provider_error',
      rule: `Lead persona invocation failed: ${(err as Error).message}`,
    }
  }

  if (stopReason === 'max_tokens') {
    if (responseText.length > 0) {
      await atomicWriteFile(planDraftPath(opts.runPaths), responseText, { fsyncDir: opts.fsyncDir })
    }
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_truncated',
      rule: 'Lead response was truncated by the model',
      actionableSuggestions: ['raise budgets.perPhase.plan.maxTokensEstimate or split the SPEC into smaller acceptance criteria'],
      now,
    })
    return {
      status: 'intervention',
      code: 'plan_truncated',
      rule: 'Lead response was truncated by the model',
      draftPaths: [planDraftPath(opts.runPaths)],
    }
  }

  // 4. Split + parse
  const split = splitPlanResponse(responseText)
  if (split === null) {
    if (responseText.length > 0) {
      await atomicWriteFile(planDraftPath(opts.runPaths), responseText, { fsyncDir: opts.fsyncDir })
    }
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_no_ready_token',
      rule: `Lead response missing ${PLAN_READY_SIGNAL} or # SOURCE_CHECK marker`,
      actionableSuggestions: ['inspect PLAN.draft.md and rerun PLAN with explicit instructions'],
      now,
    })
    return {
      status: 'intervention',
      code: 'plan_no_ready_token',
      rule: `Lead response missing ${PLAN_READY_SIGNAL} or # SOURCE_CHECK marker`,
      draftPaths: [planDraftPath(opts.runPaths)],
    }
  }

  let planArt
  try {
    planArt = parsePlan(split.planText, planPath(opts.runPaths))
  } catch (err) {
    await atomicWriteFile(planDraftPath(opts.runPaths), split.planText, { fsyncDir: opts.fsyncDir })
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_validation_failed',
      rule: 'PLAN.md draft failed schema validation',
      detail: (err as Error).message,
      actionableSuggestions: [`inspect PLAN.draft.md and fix the schema violation, or rerun PLAN`],
      now,
    })
    return {
      status: 'intervention',
      code: 'plan_validation_failed',
      rule: 'PLAN.md draft failed schema validation',
      draftPaths: [planDraftPath(opts.runPaths)],
    }
  }

  let sourceCheckArt
  try {
    sourceCheckArt = parseSourceCheck(split.sourceCheckText, sourceCheckPath(opts.runPaths))
  } catch (err) {
    await atomicWriteFile(sourceCheckDraftPath(opts.runPaths), split.sourceCheckText, { fsyncDir: opts.fsyncDir })
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'source_check_validation_failed',
      rule: 'SOURCE_CHECK.md draft failed schema validation',
      detail: (err as Error).message,
      actionableSuggestions: ['inspect SOURCE_CHECK.draft.md and fix the schema violation, or rerun PLAN'],
      now,
    })
    return {
      status: 'intervention',
      code: 'source_check_validation_failed',
      rule: 'SOURCE_CHECK.md draft failed schema validation',
      draftPaths: [sourceCheckDraftPath(opts.runPaths)],
    }
  }

  // 5. Atomic write canonical artifacts
  await atomicWriteFile(planPath(opts.runPaths), serializePlan(planArt), { fsyncDir: opts.fsyncDir })
  await atomicWriteFile(sourceCheckPath(opts.runPaths), serializeSourceCheck(sourceCheckArt), {
    fsyncDir: opts.fsyncDir,
  })

  // 6. Scientist phase-tail
  const scientistResult = await runScientistPhaseTail({
    invokeCtx: opts.invokeCtx,
    runPaths: opts.runPaths,
    runId: opts.runId,
    agent: opts.scientistAgent,
    phase: 'plan',
    primaryArtifactPath: planPath(opts.runPaths),
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
      actionableSuggestions: ['inspect Scientist drafts (HYPOTHESES.draft.md, OPEN_QUESTIONS.draft.md) and rerun PLAN'],
      now,
    })
    return {
      status: 'intervention',
      code: scientistResult.code,
      rule: scientistResult.rule,
    }
  }

  // 7. Gate-preflight
  const preflight = await validateScientistSidecars({
    phase: 'plan',
    artifactRoot: opts.runPaths.artifactRoot,
    today: now().slice(0, 10),
  })
  if (!preflight.ok) {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: preflight.code,
      rule: preflight.rule,
      detail: preflight.detail,
      actionableSuggestions: preflight.actionableSuggestions,
      now,
    })
    return {
      status: 'intervention',
      code: preflight.code,
      rule: preflight.rule,
    }
  }

  // 8. Gate signal — gate_required for the operator to run `code-oz approve plan`
  await requireGate({
    paths: opts.runPaths,
    runId: opts.runId,
    phase: 'plan',
    blockedOn: 'user signoff',
    now,
  })

  return {
    status: 'complete',
    planPath: planPath(opts.runPaths),
    sourceCheckPath: sourceCheckPath(opts.runPaths),
    hypothesesPath: scientistResult.hypothesesPath,
    openQuestionsPath: scientistResult.openQuestionsPath,
  }
}
