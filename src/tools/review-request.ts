// requestReview — the only cross-provider primitive in v0.1 (per the M2/M4
// synthesis: broader consult() ships in v0.3 if there's evidence the narrow
// primitive is insufficient).
//
// The contract:
//   - Caller passes the build agent's ProviderId EXPLICITLY. Never inferred
//     from the event log — `events.jsonl` can carry multiple agent_invoked
//     entries (recovery, retries, multi-builder phases in M5+) and inference
//     would be ambiguous. REVIEW orchestration (M5+) supplies the value
//     directly from the build agent's frontmatter.
//   - The cross-family check uses `ctx.registry.familyOf()`, never a direct
//     ProviderId comparison. Future adapters that share a family (e.g., a
//     hypothetical `claude-cli` + `anthropic-api` both family='claude')
//     stay correctly rejected as same-family without any code change here.
//   - When the family check passes, the call delegates to invokeAgent —
//     the same wrapper used by every other provider call. Reviewer agents
//     get the same manifest discipline, budget enforcement, NEEDS_INTERVENTION
//     plumbing, and audit-trail event sequence as build agents.

import { providerError } from '../providers/errors.ts'
import { invokeAgent, type InvokeContext } from '../providers/invoke.ts'
import type {
  ProviderEvent,
  ProviderFileRef,
  ProviderId,
  ProviderRequest,
} from '../providers/types.ts'
import type { AgentDefinition } from '../agents/schema.ts'

export interface ReviewRequest {
  /** The provider that produced the artifact under review. Passed explicitly
   * by REVIEW orchestration; never inferred from the event log. */
  readonly buildProvider: ProviderId
  /** The reviewer agent (must be loaded into the agent registry). */
  readonly reviewer: AgentDefinition
  /** Paths-only file manifest the reviewer should consult. */
  readonly files: readonly ProviderFileRef[]
  /** The question/prompt for the reviewer. */
  readonly question: string
  /** The run ID — must match the active run's runId. */
  readonly runId: string
}

/**
 * Cross-family REVIEW invocation. Throws a typed
 * provider_permissions_violation BEFORE any invocation when the reviewer's
 * provider shares a family with `buildProvider`. Otherwise delegates to
 * invokeAgent with phase='review'.
 *
 * The thrown ProviderError is NOT caught here and turned into
 * NEEDS_INTERVENTION — that would write a gate file for what is really a
 * REVIEW-orchestration bug (passing the wrong reviewer). The orchestrator
 * (M5+ REVIEW phase logic) catches this and surfaces it as an orchestration
 * error, not a provider failure.
 */
export async function* requestReview(
  ctx: InvokeContext,
  req: ReviewRequest,
): AsyncIterable<ProviderEvent> {
  const reviewerId = req.reviewer.provider as ProviderId
  const buildFamily = ctx.registry.familyOf(req.buildProvider)
  const reviewerFamily = ctx.registry.familyOf(reviewerId)

  if (buildFamily === reviewerFamily) {
    throw providerError(
      'provider_permissions_violation',
      'REVIEW provider must differ from BUILD provider family',
      [
        `pick a reviewer agent whose provider is in a different family than ${buildFamily}`,
        `loaded reviewer agent ${req.reviewer.name} declares provider=${reviewerId} (family=${reviewerFamily})`,
      ],
      `buildProvider=${req.buildProvider} (family=${buildFamily}), reviewer.provider=${reviewerId} (family=${reviewerFamily})`,
    )
  }

  const providerRequest: ProviderRequest = {
    agent: req.reviewer,
    phase: 'review',
    runId: req.runId,
    prompt: req.question,
    files: req.files,
  }

  yield* invokeAgent(ctx, providerRequest)
}
