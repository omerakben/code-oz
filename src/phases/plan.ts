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

import { mkdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

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
import { canonicalRoleFromAgent } from '../agents/role.ts'
import {
  parsePlan,
  serializePlan,
} from '../artifacts/plan.ts'
import {
  parseSourceCheck,
  serializeSourceCheck,
  validatePlanSourceCoverage,
} from '../artifacts/source-check.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import { composePlanPrompt } from '../prompts/index.ts'
import { runScientistPhaseTail } from './scientist.ts'
import { validateScientistSidecars } from './gate-preflight.ts'
import { runRepoContextTool } from '../tools/repo-context/runner.ts'
import { REPO_CONTEXT_TOOL_NAMES } from '../agents/schema.ts'
import type { RepoContextRequest } from '../tools/repo-context/types.ts'
import type { ProviderFileRef, ProviderToolCall } from '../providers/types.ts'
import { extractDebateRequest, type DebateRequestBlock } from '../tools/debate-request-extract.ts'
import { requestDebate } from '../tools/debate-request.ts'
import { ProviderError } from '../providers/errors.ts'

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

// --- tool-call → repo-context request mapper ----------------------

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

// --- debate runtime integration ------------------------------------

interface PlanDebateResult {
  readonly kind: 'ok'
  readonly decisionPath: string
  readonly decisionSha256: string
  readonly callerVerdict: string
  readonly responseVerdict: string
}

interface PlanDebateInterventionResult {
  readonly kind: 'intervention'
  readonly result: PlanIntervention
}

async function runPlanDebate(args: {
  block: DebateRequestBlock
  opts: RunPlanOptions
  now: () => string
}): Promise<PlanDebateResult | PlanDebateInterventionResult> {
  const { block, opts, now } = args

  // Permission clamp: the orchestrator must verify the persona is
  // allowed to debate against this opposingProvider. The load-time
  // check (src/agents/schema.ts) ensures the declared list is cross-
  // family; this runtime check ensures the YAML cannot escalate beyond
  // the declared list.
  const debatePerm = opts.leadAgent.permissions.tool_use?.debate
  if (debatePerm === undefined) {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_debate_permission_missing',
      rule: 'persona has no tool_use.debate scope but emitted <debate-request>',
      actionableSuggestions: [
        'add tool_use.debate to the persona definition',
        'or remove the <debate-request> block from the persona response',
      ],
      now,
    })
    return {
      kind: 'intervention',
      result: {
        status: 'intervention',
        code: 'plan_debate_permission_missing',
        rule: 'persona has no tool_use.debate scope but emitted <debate-request>',
      },
    }
  }
  if (!debatePerm.opposingProviders.includes(block.opposingProvider)) {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_debate_opposing_provider_unauthorized',
      rule: `<debate-request>.opposingProvider '${block.opposingProvider}' is not in persona's tool_use.debate.opposingProviders`,
      detail: `allowed=[${debatePerm.opposingProviders.join(', ')}]`,
      actionableSuggestions: [
        'pick an opposingProvider from the persona\'s declared list',
        'or extend the persona\'s tool_use.debate.opposingProviders before re-running',
      ],
      now,
    })
    return {
      kind: 'intervention',
      result: {
        status: 'intervention',
        code: 'plan_debate_opposing_provider_unauthorized',
        rule: `<debate-request>.opposingProvider not declared in persona permissions`,
      },
    }
  }

  // Drain requestDebate. requestDebate enforces the cross-family
  // invocation-time invariant, topic uniqueness, manifest preview, and
  // DECISION shape; failures throw ProviderError which the orchestrator
  // converts to a NEEDS_INTERVENTION via existing wrapper plumbing.
  const today = now().slice(0, 10)
  let runner
  try {
    runner = requestDebate(opts.invokeCtx, {
      caller: opts.leadAgent,
      phase: 'plan',
      topic: block.topic,
      opposingProvider: block.opposingProvider,
      question: block.question,
      files: block.files,
      runId: opts.runId,
      date: today,
      callerLabel: opts.leadAgent.name,
      targetLabel: block.target,
      cycle: block.cycle,
      status: block.status,
      briefingSections: block.briefingSections,
      projectRoot: opts.invokeCtx.projectRoot,
      resolvedBy: `${opts.leadAgent.name} (PLAN orchestrator)`,
    })
    for await (const _ev of runner) {
      // ProviderEvents already flow through invokeAgent's appendEvent
      // chokepoint; the orchestrator does not need to mirror them.
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const code =
      err instanceof ProviderError && err.issues[0] !== undefined
        ? err.issues[0].code
        : 'plan_debate_runtime_error'
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code,
      rule: `requestDebate failed: ${detail.slice(0, 200)}`,
      detail,
      actionableSuggestions: [
        'inspect the debate artifact directory for partial state',
        'address the underlying error and re-run PLAN',
      ],
      now,
    })
    return {
      kind: 'intervention',
      result: {
        status: 'intervention',
        code,
        rule: `requestDebate failed`,
      },
    }
  }

  const result = runner.result()
  if (result === null) {
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_debate_runtime_error',
      rule: 'requestDebate completed without producing a result',
      actionableSuggestions: ['inspect events.jsonl + .code-oz/state/runs/<runId>/.lock'],
      now,
    })
    return {
      kind: 'intervention',
      result: {
        status: 'intervention',
        code: 'plan_debate_runtime_error',
        rule: 'requestDebate completed without producing a result',
      },
    }
  }

  return {
    kind: 'ok',
    decisionPath: result.decisionPath,
    decisionSha256: result.decisionSha256,
    callerVerdict: result.callerVerdict,
    responseVerdict: result.responseVerdict,
  }
}

// --- runPlan -------------------------------------------------------

export async function runPlan(opts: RunPlanOptions): Promise<PlanResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  // 1. Load SPEC.md (verify exists before invoking provider)
  const specAbs = specPath(opts.runPaths)
  try {
    await readFile(specAbs, 'utf8')
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

  // 2. Compose prompt — SPEC.md flows through ProviderRequest.files (not
  //    inlined) so the wrapper's manifest is the audit-trail source of truth
  //    for what bytes the provider received. Per CLAUDE.md rule 13 + Codex
  //    M6 review block-push #1.
  const availableTools =
    opts.leadAgent.permissions.tool_use?.repo_context?.tools !== undefined
      ? [...opts.leadAgent.permissions.tool_use.repo_context.tools]
      : []
  const baseUserTurn = opts.initialUserInput ?? 'Read the attached SPEC.md and produce PLAN.md + SOURCE_CHECK.md per the locked schemas.'
  const specRel = relative(opts.invokeCtx.projectRoot, specAbs)

  // 3. Invoke Lead persona — SPEC.md attached via manifest. Tool-use
  //    dispatch loop: per Codex M6 review block-push #2, when the persona
  //    issues repo-context tool_calls the orchestrator runs them, appends
  //    the results to a tool-history block in the next prompt, and re-
  //    invokes. Bounded by MAX_TOOL_DISPATCH_TURNS so a misbehaving
  //    persona cannot loop forever.
  //
  //    The dispatch loop is wrapped in a debate-rounds outer loop. When
  //    the persona emits a `<debate-request>` block (per CODEX_RESPONSE_M10
  //    D1 + D12 locks), the orchestrator pauses, runs requestDebate,
  //    discards trailing pre-decision PLAN prose (D1: terminal directive),
  //    and re-invokes the persona with DECISION.md as continuation context.
  //    Capped at MAX_DEBATE_ROUNDS = 1 for v0.1 (rule 21: prove value
  //    before scaling parallel-provider surface).
  const MAX_TOOL_DISPATCH_TURNS = 5
  const MAX_DEBATE_ROUNDS = 1
  let responseText = ''
  let stopReason = 'end' as string
  let userTurn = baseUserTurn
  let extraFiles: readonly ProviderFileRef[] = []
  let debateRound = 0
  let debateContext: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let toolHistoryBlock = ''
    let toolDispatchTurn = 0
    let providerErr: Error | null = null
    let turnTextLocal = ''
    let stopLocal = 'end' as string
    try {
      while (toolDispatchTurn < MAX_TOOL_DISPATCH_TURNS) {
        const continuationBlock =
          debateContext !== null
            ? `\n\n## Continuation context\n${debateContext}`
            : ''
        const turnHistory = [
          {
            role: 'user' as const,
            text:
              `${userTurn}\n\n` +
              `The provider has been given SPEC.md as an attached file at \`${specRel}\` (see the manifest). ` +
              `Refer to that attachment instead of expecting inline content.` +
              continuationBlock +
              (toolHistoryBlock.length > 0
                ? `\n\n## Tool history\n${toolHistoryBlock}`
                : ''),
          },
        ]
        const turnPrompt = await composePlanPrompt({
          agentBody: opts.leadAgent.body,
          history: turnHistory,
          readySignal: PLAN_READY_SIGNAL,
          availableTools,
        })

        let turnText = ''
        const toolCalls: ProviderToolCall[] = []
        let turnStop = 'end' as string
        const filesForTurn: ProviderFileRef[] = [{ path: specRel }, ...extraFiles]
        for await (const event of invokeAgent(opts.invokeCtx, {
          runId: opts.runId,
          phase: 'plan',
          agent: opts.leadAgent,
          files: filesForTurn,
          prompt: turnPrompt,
          // M13 (Codex Q9): bundled-role identity for per-role gating.
          // Lead is the canonical PLAN persona; absent on project-local
          // overrides outside `M12_COMPANY_ROLES`.
          ...(canonicalRoleFromAgent(opts.leadAgent) !== undefined
            ? { role: canonicalRoleFromAgent(opts.leadAgent) }
            : {}),
        })) {
          if (event.type === 'content_chunk') turnText += event.text
          else if (event.type === 'tool_call') toolCalls.push(event.call)
          else if (event.type === 'turn_completed') {
            turnStop = event.response.stopReason
            if (turnText.length === 0) turnText = event.response.content
          }
        }

        if (toolCalls.length === 0) {
          // Persona produced final output (or an empty response); break dispatch loop.
          turnTextLocal = turnText
          stopLocal = turnStop
          break
        }

        // Dispatch each repo-context tool call. Tools outside the registered
        // set are ignored (the cap on tool_calls per turn is enforced by the
        // wrapper layer).
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
              agentName: opts.leadAgent.name,
              agentPermissions: opts.leadAgent.permissions,
              phase: 'plan',
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
      return {
        status: 'intervention',
        code: 'plan_provider_error',
        rule: `Lead persona invocation failed: ${providerErr.message}`,
      }
    }
    if (toolDispatchTurn >= MAX_TOOL_DISPATCH_TURNS && turnTextLocal === '') {
      await recordIntervention({
        paths: opts.runPaths,
        runId: opts.runId,
        agent: opts.leadAgent.name,
        code: 'plan_tool_loop_exhausted',
        rule: `Lead persona exceeded ${MAX_TOOL_DISPATCH_TURNS} tool-dispatch turns without producing a final response`,
        actionableSuggestions: [
          'narrow the SPEC scope or simplify the agent persona body',
          `or raise MAX_TOOL_DISPATCH_TURNS in src/phases/plan.ts`,
        ],
        now,
      })
      return {
        status: 'intervention',
        code: 'plan_tool_loop_exhausted',
        rule: `Lead persona exceeded ${MAX_TOOL_DISPATCH_TURNS} tool-dispatch turns`,
      }
    }

    // Debate-extraction step. After the dispatch loop produces final
    // text, look for `<debate-request>` (D1: terminal directive). If the
    // persona did not request debate, fall through to the existing parse
    // path. If it did, run the debate and re-enter the dispatch loop with
    // continuation context.
    const extract = extractDebateRequest(turnTextLocal)
    if (extract.kind === 'none') {
      responseText = turnTextLocal
      stopReason = stopLocal
      break
    }
    if (extract.kind === 'multiple') {
      if (turnTextLocal.length > 0) {
        await atomicWriteFile(planDraftPath(opts.runPaths), turnTextLocal, { fsyncDir: opts.fsyncDir })
      }
      await recordIntervention({
        paths: opts.runPaths,
        runId: opts.runId,
        agent: opts.leadAgent.name,
        code: 'plan_multiple_debate_requests',
        rule: 'Lead emitted more than one <debate-request> block (D2 lock: fail-fast)',
        detail: `block count=${extract.count}`,
        actionableSuggestions: [
          'rewrite the persona response to issue exactly one terminal <debate-request>',
          'merge debate prompts or pick the highest-risk question',
        ],
        now,
      })
      return {
        status: 'intervention',
        code: 'plan_multiple_debate_requests',
        rule: 'Lead emitted more than one <debate-request> block',
        draftPaths: [planDraftPath(opts.runPaths)],
      }
    }
    if (extract.kind === 'parse-error') {
      if (turnTextLocal.length > 0) {
        await atomicWriteFile(planDraftPath(opts.runPaths), turnTextLocal, { fsyncDir: opts.fsyncDir })
      }
      await recordIntervention({
        paths: opts.runPaths,
        runId: opts.runId,
        agent: opts.leadAgent.name,
        code: 'plan_debate_request_invalid',
        rule: '<debate-request> block failed schema validation',
        detail: extract.detail,
        actionableSuggestions: [
          'inspect PLAN.draft.md to see the persona output',
          'fix the YAML body or remove the <debate-request> block',
        ],
        now,
      })
      return {
        status: 'intervention',
        code: 'plan_debate_request_invalid',
        rule: '<debate-request> block failed schema validation',
        draftPaths: [planDraftPath(opts.runPaths)],
      }
    }

    // extract.kind === 'one' — persist trailing prose first (D1 forensics
    // are needed even on permission/runtime rejection paths; Codex
    // CODEX_REVIEW_M10.md fs#3), then check round cap, then run debate.
    if (extract.block.trailingDraft.length > 0) {
      const discardedDir = join(opts.runPaths.runDir, 'discarded-drafts')
      await mkdir(discardedDir, { recursive: true })
      const discardedPath = join(
        discardedDir,
        `plan-${extract.block.topic}.draft.md`,
      )
      await atomicWriteFile(discardedPath, extract.block.trailingDraft, {
        fsyncDir: opts.fsyncDir,
      })
    }

    if (debateRound >= MAX_DEBATE_ROUNDS) {
      await recordIntervention({
        paths: opts.runPaths,
        runId: opts.runId,
        agent: opts.leadAgent.name,
        code: 'plan_debate_round_exceeded',
        rule: `Lead requested more than ${MAX_DEBATE_ROUNDS} debate(s) per PLAN invocation`,
        actionableSuggestions: [
          `merge follow-up questions into the first debate or finalize PLAN with the existing DECISION.md`,
          `MAX_DEBATE_ROUNDS is ${MAX_DEBATE_ROUNDS} for v0.1; raising it is a roadmap decision`,
        ],
        now,
      })
      return {
        status: 'intervention',
        code: 'plan_debate_round_exceeded',
        rule: `Lead requested more than ${MAX_DEBATE_ROUNDS} debate(s) per PLAN invocation`,
      }
    }

    const debateOutcome = await runPlanDebate({
      block: extract.block,
      opts,
      now,
    })
    if (debateOutcome.kind === 'intervention') {
      return debateOutcome.result
    }

    // Set up continuation: DECISION.md added to manifest; new userTurn
    // prompts the persona to author final PLAN+SOURCE_CHECK with the
    // decision in hand. Reset dispatch state for the next round.
    const decisionRel = relative(opts.invokeCtx.projectRoot, debateOutcome.decisionPath)
    extraFiles = [{ path: decisionRel }]
    userTurn =
      `Continue PLAN authoring after the cross-family debate resolved (topic: ${extract.block.topic}). ` +
      `DECISION.md is attached at \`${decisionRel}\`. ` +
      `Re-author PLAN.md + SOURCE_CHECK.md per the locked schemas, integrating the decision. ` +
      `The orchestrator discarded any pre-decision PLAN content the prior turn emitted. ` +
      `Do NOT emit another <debate-request> in this turn — at most one debate per PLAN invocation in v0.1.`
    debateContext =
      `DECISION.md sha256=${debateOutcome.decisionSha256}; ` +
      `caller verdict=${debateOutcome.callerVerdict}, opposing verdict=${debateOutcome.responseVerdict}.`
    debateRound++
    // Continue the outer loop — the dispatch loop will re-enter with the
    // updated user turn + continuation block.
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

  // 5. Cross-check PLAN tasks vs SOURCE_CHECK coverage (rule 3, Codex M6
  //    review block-push #4). Every T-NNN must have a Coverage row with
  //    ≥ 1 SPEC + ≥ 1 REF/REF-NONE + ≥ 1 DOC/DOC-NONE source.
  const coverageIssues = validatePlanSourceCoverage({
    tasks: planArt.tasks.map((t) => ({ id: t.id, sources: t.sources })),
    sourceCheck: sourceCheckArt,
  })
  if (coverageIssues.length > 0) {
    await atomicWriteFile(planDraftPath(opts.runPaths), split.planText, { fsyncDir: opts.fsyncDir })
    await atomicWriteFile(sourceCheckDraftPath(opts.runPaths), split.sourceCheckText, {
      fsyncDir: opts.fsyncDir,
    })
    await recordIntervention({
      paths: opts.runPaths,
      runId: opts.runId,
      agent: opts.leadAgent.name,
      code: 'plan_source_coverage_failed',
      rule: '3-source verification incomplete (rule 3)',
      detail: coverageIssues.join('; '),
      actionableSuggestions: [
        'every PLAN task must cite at least one SC-SPEC + one SC-REF/-NONE + one SC-DOC/-NONE source',
        'inspect PLAN.draft.md and SOURCE_CHECK.draft.md and rerun PLAN',
      ],
      now,
    })
    return {
      status: 'intervention',
      code: 'plan_source_coverage_failed',
      rule: '3-source verification incomplete (rule 3)',
      draftPaths: [planDraftPath(opts.runPaths), sourceCheckDraftPath(opts.runPaths)],
    }
  }

  // 6. Atomic write canonical artifacts
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
