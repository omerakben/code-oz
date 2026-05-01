// invokeAgent — the wrapper layer (rule 13 chokepoint).
//
// Single public entrypoint; every provider call in v0.1+ goes through it.
// Adapters never read events.jsonl, write gates, hold the per-run lock, or
// enforce permissions — those are the wrapper's responsibility, in this
// exact order:
//
//   1. buildManifest                — path safety + permissions intersection
//                                     + content load + sha256 + four metrics.
//                                     Throws ProviderError BEFORE any lock,
//                                     so a bad request never perturbs run
//                                     state. (no events written, no gate)
//   2. short-lock pre-call           — readEvents → assertWithinBudget →
//                                     append agent_invoked. If the budget
//                                     check throws, the lock is released by
//                                     the withLock finally; the catch then
//                                     re-locks to write NEEDS_INTERVENTION
//                                     + intervention.
//   3. unlocked stream               — adapter.invoke(prepared); the per-run
//                                     lock MUST NOT be held across a network
//                                     call. tool_call events are counted
//                                     against the streaming hard cap
//                                     (floor(maxToolCallsPerTurn *
//                                     toolCallBudgetMultiplier)); excess
//                                     throws provider_tool_call_cap_exceeded
//                                     mid-stream.
//   4. short-lock post-call          — success path: append agent_completed
//                                     (tokensUsed only when the adapter
//                                     reported it; never post-counted from
//                                     streamed text). failure path:
//                                     writeNeedsInterventionGate +
//                                     append intervention, then re-throw.
//
// Non-ProviderError exceptions propagate untouched — those are bugs (or
// EventLogError / GateLoadError from the state layer), not provider
// failures, and don't write NEEDS_INTERVENTION.

import { ProviderError, providerError } from './errors.ts'
import { buildManifest } from './manifest.ts'
import { assertWithinBudget, detectBudgetSoftWarnings } from './cost.ts'
import {
  appendEvent,
  readEvents,
  type EventLogPaths,
} from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { withLock } from '../state/lock.ts'
import type { CodeOzConfig } from '../config/schema.ts'
import type { ProviderRegistry } from './registry.ts'
import type { RunPaths } from '../state/run.ts'
import type {
  ProviderEvent,
  ProviderId,
  ProviderRequest,
} from './types.ts'

export interface InvokeContext {
  readonly registry: ProviderRegistry
  readonly runPaths: RunPaths
  readonly config: CodeOzConfig
  /**
   * Project root used by buildManifest for path-safety checks. Manifest
   * paths in the request are resolved relative to this root, and symlink
   * escapes are rejected via realpath.
   */
  readonly projectRoot: string
  /** Override clock for deterministic tests. */
  readonly now?: () => string
}

export async function* invokeAgent(
  ctx: InvokeContext,
  req: ProviderRequest,
): AsyncIterable<ProviderEvent> {
  const now = ctx.now ?? (() => new Date().toISOString())
  const eventPaths: EventLogPaths = {
    file: ctx.runPaths.eventsFile,
    lockDir: ctx.runPaths.lockDir,
  }
  const gatePaths: GatePaths = {
    runDir: ctx.runPaths.runDir,
    artifactRoot: ctx.runPaths.artifactRoot,
    lockDir: ctx.runPaths.lockDir,
  }

  // 1. Build manifest — path safety, permissions intersection, content load,
  // metrics. Throws ProviderError outside any lock so a bad request never
  // perturbs run state.
  const prepared = await buildManifest(req, { projectRoot: ctx.projectRoot })

  // 2. Short-lock pre-call: read events, assert budget, append agent_invoked.
  // A ProviderError from the budget check is caught after lock release and
  // turned into NEEDS_INTERVENTION + intervention.
  try {
    await withLock(ctx.runPaths.lockDir, async () => {
      const events = await readEvents(eventPaths)
      const nowDate = new Date(now())
      assertWithinBudget(ctx.config, req, prepared, events, nowDate)
      const warnings = detectBudgetSoftWarnings(ctx.config, req, prepared, events, nowDate)
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'agent_invoked',
          ts: now(),
          runId: req.runId,
          phase: req.phase,
          agent: req.agent.name,
          provider: req.agent.provider,
          // M12 (Codex Risk #3): record the resolved model so
          // events.jsonl carries durable provenance for cost/audit
          // tooling. `prepared.model` is `req.model ?? req.agent.model`.
          ...(prepared.model !== undefined ? { model: prepared.model } : {}),
          manifest: prepared.manifest,
          filesSent: prepared.metrics.filesSent,
          bytesSent: prepared.metrics.bytesSent,
          tokensEstimate: prepared.metrics.tokensEstimate,
          fieldsRemovedByScope: prepared.metrics.fieldsRemovedByScope,
        },
        { skipLock: true },
      )
      for (const w of warnings) {
        await appendEvent(
          eventPaths,
          {
            version: 1,
            type: 'budget_warning',
            ts: now(),
            runId: req.runId,
            metric: w.metric,
            ratio: w.ratio,
            current: w.metric === 'maxWallTimeMinutes' ? Math.floor(w.current) : w.current,
            limit: w.limit,
          },
          { skipLock: true },
        )
      }
    })
  } catch (err) {
    if (err instanceof ProviderError) {
      await recordIntervention(err, req, gatePaths, eventPaths, now)
    }
    throw err
  }

  // 3. Unlocked adapter stream + tool_call cap. Per-run lock is released
  // for the duration of the network call (rule: never hold a lock across
  // I/O that can take seconds).
  const adapter = ctx.registry.get(req.agent.provider as ProviderId)
  const cap = Math.floor(
    ctx.config.budgets.global.maxToolCallsPerTurn *
      (ctx.config.budgets.global.toolCallBudgetMultiplier ?? 1.5),
  )
  let toolCalls = 0
  let tokensUsed: number | undefined

  try {
    for await (const ev of adapter.invoke(prepared)) {
      if (ev.type === 'tool_call') {
        toolCalls++
        if (toolCalls > cap) {
          throw providerError(
            'provider_tool_call_cap_exceeded',
            'provider emitted more tool_call events than the configured cap',
            [
              'raise budgets.global.maxToolCallsPerTurn in .code-oz/config.yaml',
              'or raise budgets.global.toolCallBudgetMultiplier',
            ],
            `cap=${cap}, toolCalls=${toolCalls}, agent=${req.agent.name}, phase=${req.phase}`,
          )
        }
      }
      if (ev.type === 'turn_completed') {
        // Empty content from a "successful" turn_completed is malformed —
        // adapters that have nothing to say must surface that as a typed
        // ProviderError, not as a zero-byte success that bubbles into phase
        // logic and then gets rejected by downstream event validators (which
        // would crash the run instead of writing NEEDS_INTERVENTION).
        //
        // Tool-only turns are legitimate: stopReason 'tool_use' (and
        // stopReason 'end_turn' alongside non-empty toolCalls) are the
        // contract for "the model finished by handing off to a tool, not
        // by writing prose." M7 BUILD/REVIEW orchestration will use this
        // shape; M5 DEFINE never does (text-only). Allow empty content
        // when either signal is present.
        const isToolUse = ev.response.stopReason === 'tool_use'
        const hasToolCalls =
          ev.response.toolCalls !== undefined && ev.response.toolCalls.length > 0
        if (ev.response.content.length === 0 && !isToolUse && !hasToolCalls) {
          throw providerError(
            'provider_malformed_response',
            'provider returned an empty turn_completed.response.content with no tool_use signal',
            [
              'check the upstream CLI output (claude / codex) for hidden errors',
              'rerun with --provider fake to bisect adapter vs. orchestrator behavior',
              'inspect events.jsonl for the preceding agent_invoked event',
            ],
            `agent=${req.agent.name}, phase=${req.phase}, model=${ev.response.model}, stopReason=${ev.response.stopReason}`,
          )
        }
        // Adapter-reported only — never post-count streamed text.
        tokensUsed = ev.response.tokensUsed
      }
      yield ev
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      await recordIntervention(err, req, gatePaths, eventPaths, now)
    }
    throw err
  }

  // 4. Short-lock post-call success: append agent_completed. tokensUsed is
  // omitted entirely when the adapter didn't report it (M3 schema accepts
  // the absence; the budget summarizer falls back to the recorded estimate).
  await withLock(ctx.runPaths.lockDir, async () => {
    await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'agent_completed',
        ts: now(),
        runId: req.runId,
        phase: req.phase,
        agent: req.agent.name,
        ...(tokensUsed !== undefined ? { tokensUsed } : {}),
      },
      { skipLock: true },
    )
  })
}

/**
 * Failure-path bookkeeping: write NEEDS_INTERVENTION.json + append the
 * intervention event under one short lock. Used by both the pre-call
 * (budget) and stream (adapter / tool-call cap) error paths.
 *
 * Multi-issue ProviderErrors collapse to the first issue for the gate and
 * event — additional issues live on the thrown ProviderError that the
 * wrapper re-throws for the caller's full context.
 */
async function recordIntervention(
  err: ProviderError,
  req: ProviderRequest,
  gatePaths: GatePaths,
  eventPaths: EventLogPaths,
  now: () => string,
): Promise<void> {
  const issue = err.issues[0]!
  await withLock(gatePaths.lockDir, async () => {
    await writeNeedsInterventionGate(
      gatePaths,
      {
        version: 1,
        runId: req.runId,
        phase: req.phase,
        agent: req.agent.name,
        code: issue.code,
        rule: issue.rule,
        ...(issue.detail !== undefined ? { detail: issue.detail } : {}),
        actionableSuggestions: issue.actionableSuggestions,
        createdAt: now(),
      },
      { skipLock: true },
    )
    await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'intervention',
        ts: now(),
        runId: req.runId,
        code: issue.code,
        phase: req.phase,
      },
      { skipLock: true },
    )
  })
}
