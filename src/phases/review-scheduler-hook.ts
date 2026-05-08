// M15 commits 4a + 4b — REVIEW phase post-verdict scheduler hook.
//
// Authority slice: build SchedulerInput from the runtime context, call the
// pure decision function, emit `debate_scheduler_evaluated` always, emit
// `debate_scheduler_skipped` for skip decisions. When a fire path executor
// is wired AND decision.fire === true, run the fire path: emit
// `debate_scheduler_fired`, invoke the executor (which calls requestDebate
// + re-runs the reviewer persona under the EXISTING outer .review.lock —
// no new lock acquired, fixing Codex Risk #4 in CODEX_RESPONSE_M15.md),
// then emit either `debate_scheduler_postreview` (success), the broader
// `debate_scheduler_error` (degrade), or surface a NEEDS_INTERVENTION
// caller-actionable signal (operator-actionable error per kickoff §2.7).
//
// Call sites:
//   - src/phases/review.ts: runReviewInner, after review_round_completed
//     is appended and before the verdict branch.
//   - src/phases/review.ts: runReviewPanelBranch, after the panel
//     intervention check passes and before the resolved/needs_revision/
//     blocked branching.
//
// Lock-collision fix (Codex Risk #4): the fire path executor MUST NOT
// re-acquire `.review.lock` (the outer runReview holds it). Production
// executors invoke requestDebate + reviewer persona re-invocation
// directly without nesting into runReview(). Tests use mock executors
// that preserve this invariant.

import { createHash } from 'node:crypto'
import {
  evaluateSchedulerDecision,
  type PanelistVerdictSnapshot,
  type SchedulerDecision,
  type SchedulerInput,
  type SchedulerReviewState,
} from '../policy/debate-scheduler.ts'
import {
  DEFAULT_DEBATE_POLICY,
  type DebatePolicyConfig,
} from '../config/schema.ts'
import {
  generateUlid,
  isKnownPhaseEvent,
  type LoggedEvent,
  type Phase,
  type SchedulerErrorReason,
  type SchedulerReviewVerdict,
} from '../state/schemas.ts'
import { appendEvent, type EventLogPaths } from '../state/events.ts'
import type { AgentDefinition } from '../agents/schema.ts'

/**
 * Caller-supplied snapshot of the REVIEW state at the moment the hook
 * fires. The runtime caller (commit 4a wiring) constructs this from
 * computeCanonicalVerdict (single-mode) or computeCanonicalPanelVerdict
 * (panel-mode) outputs.
 */
export type ReviewSchedulerHookReviewState =
  | {
      readonly mode: 'single'
      readonly score: number
      readonly verdict: 'ready' | 'needs-revision' | 'block'
    }
  | {
      readonly mode: 'panel'
      readonly panelistVerdicts: readonly PanelistVerdictSnapshot[]
    }

/**
 * Input passed to the fire-path executor when decision.fire === true.
 *
 * The executor is responsible for: synthesizing a briefing, calling
 * `requestDebate`, draining its iterator, getting DECISION.md, re-invoking
 * the reviewer persona with the DECISION.md context, and atomically
 * replacing the canonical REVIEW.md. The executor MUST NOT re-acquire
 * `.review.lock` — it runs INSIDE the outer runReview's lock envelope
 * (Codex Risk #4 fix).
 */
export interface SchedulerFirePathInput {
  readonly runId: string
  readonly taskId: string
  readonly attempt: number
  readonly reviewRound: number
  readonly phase: Phase
  readonly decisionId: string
  readonly reviewerAgent: AgentDefinition
  readonly preReviewReportSha256: string
  readonly reviewState: ReviewSchedulerHookReviewState
  readonly buildReportChangedFileCount: number
  readonly now: () => string
}

/**
 * Result returned by the fire-path executor. Discriminated by `status`:
 *   - 'success': debate ran end-to-end + post-debate REVIEW round produced
 *     a new canonical REVIEW.md. Hook emits `debate_scheduler_postreview`.
 *   - 'error_degrade': debate or post-debate REVIEW failed with a non-
 *     operator-actionable error. Hook emits `debate_scheduler_error`. The
 *     gate writes from the original (pre-debate) REVIEW verdict.
 *   - 'intervention': debate or post-debate REVIEW failed with an
 *     operator-actionable error per kickoff §2.7 (auth_missing,
 *     permissions_violation, concurrent_limit_exceeded, topic_collision,
 *     manifest_blocked). Hook emits NO further scheduler event — the
 *     caller writes NEEDS_INTERVENTION.json.
 *
 * `opposingProvider` and `debateTopic` are recorded by the executor (the
 * scheduler does not pre-select; the executor's eligibility check might
 * reject candidates, so the chosen value is authoritative).
 */
export type SchedulerFirePathResult =
  | {
      readonly status: 'success'
      readonly opposingProvider: string
      readonly debateTopic: string
      readonly newReviewReportSha256: string
      readonly verdictPost: SchedulerReviewVerdict
      readonly findingsAddedCount: number
      readonly actionableFindingsAddedCount: number
    }
  | {
      readonly status: 'error_degrade'
      readonly opposingProvider: string
      readonly debateTopic: string
      readonly errorReason: SchedulerErrorReason
      readonly underlyingErrorCode?: string
    }
  | {
      readonly status: 'intervention'
      readonly opposingProvider: string
      readonly debateTopic: string
      readonly interventionCode: string
      readonly interventionRule: string
      readonly underlyingErrorCode?: string
    }

/**
 * The fire-path executor seam. Production wires this to a function that
 * synthesizes a briefing + calls requestDebate + re-runs the reviewer
 * persona. Tests inject mock executors. Either way, the executor must
 * not re-acquire `.review.lock` (Codex Risk #4 fix).
 */
export type SchedulerFirePathExecutor = (
  input: SchedulerFirePathInput,
) => Promise<SchedulerFirePathResult>

export interface ReviewSchedulerHookOptions {
  readonly runId: string
  readonly taskId: string
  readonly attempt: number
  readonly reviewRound: number
  /** Phase is always 'review' in v0.1 (single call site, rule 20). The
   *  parameter exists for forward-compat with M16+ multi-call-site policy. */
  readonly phase: Phase
  /** Persona name attributed to the scheduler decision. Single-mode = the
   *  reviewer agent name; panel-mode = the orchestrator agent name. */
  readonly agent: string
  readonly reviewerAgent: AgentDefinition
  /** sha256 of the just-completed REVIEW.md (canonical artifact at decision
   *  time). Used both as the scheduler input identity and as the dedup
   *  fingerprint base. */
  readonly preReviewReportSha256: string
  /** REVIEW state shape from the just-completed verdict computation. */
  readonly reviewState: ReviewSchedulerHookReviewState
  /** Resolved debate-policy config (commit 3). When the user has not set a
   *  `debatePolicy:` block, this is `undefined` and the hook resolves via
   *  `?? DEFAULT_DEBATE_POLICY` (mode='manual', preserves M10 behavior). */
  readonly debatePolicyFromConfig: DebatePolicyConfig | undefined
  /** Count of files in BUILD_REPORT.changedFiles. The projected manifest
   *  size adds the three artifact files (BUILD_REPORT.md + VERIFY.md +
   *  REVIEW.md). */
  readonly buildReportChangedFileCount: number
  /** events.jsonl snapshot read after `review_round_completed` /
   *  `review_panel_completed` was appended for THIS round. Used to compute
   *  history accumulators + concurrency state. */
  readonly events: readonly LoggedEvent[]
  readonly eventPaths: EventLogPaths
  readonly now: () => string
  /** Optional fire-path executor seam (M15 commit 4b). When provided AND
   *  decision.fire === true, the hook runs the fire path: emits
   *  debate_scheduler_fired, invokes the executor, then emits postreview /
   *  scheduler_error / surfaces intervention per the executor's result.
   *  When omitted, fire decisions degrade silently (only `evaluated` is
   *  emitted) — preserved for commit 4a tests and for transitional wiring
   *  while production executor is being plumbed. */
  readonly firePathExecutor?: SchedulerFirePathExecutor
  /** Optional aggregate budget preflight result (M15 commit 5). When
   *  provided, the hook plumbs the {wouldTip, tipReason} into
   *  SchedulerInput.budget so the pure decision function can short-circuit
   *  the trigger evaluation with reason='budget_exhausted' (carrying the
   *  optional budgetTipReason discriminator). When omitted, the preflight
   *  defaults to `{ aggregatePreflightWouldTip: false }` — preserves
   *  commits 4a + 4b transitional behavior. The caller (review.ts wiring)
   *  is responsible for calling aggregateDebateSchedulerPreflight from
   *  src/providers/cost.ts and passing the result here. */
  readonly aggregatePreflightWouldTip?: boolean
  readonly aggregatePreflightTipReason?:
    | 'maxTokensEstimate'
    | 'maxProviderCalls'
    | 'maxTurns'
    | 'maxWallTimeMinutes'
}

export interface ReviewSchedulerHookFireOutcome {
  readonly fired: boolean
  readonly result: SchedulerFirePathResult | null
}

export interface ReviewSchedulerHookResult {
  readonly decisionId: string
  readonly decision: SchedulerDecision
  readonly inputDigest: string
  /** Fire-path outcome. `fired: false` when decision.fire was false OR
   *  when no executor was wired. `result: null` in those cases. When
   *  `fired: true`, `result` carries the executor's outcome (success /
   *  error_degrade / intervention) — caller acts on intervention by
   *  writing NEEDS_INTERVENTION.json. */
  readonly fireOutcome: ReviewSchedulerHookFireOutcome
}

/**
 * Run the post-verdict scheduler evaluate hook. Always emits
 * `debate_scheduler_evaluated`; emits `debate_scheduler_skipped` when the
 * decision is to skip; does NOT emit `debate_scheduler_fired` (that
 * surface lands in commit 4b together with the post-debate REVIEW round).
 *
 * Returns the decision so commit 4b's wiring can branch on it for the fire
 * path. Commit 4a wiring discards the result after logging.
 */
export async function runReviewSchedulerHook(
  opts: ReviewSchedulerHookOptions,
): Promise<ReviewSchedulerHookResult> {
  const decisionId = generateUlid()
  const policy = opts.debatePolicyFromConfig ?? DEFAULT_DEBATE_POLICY

  const personaPerm = opts.reviewerAgent.permissions.tool_use?.debate
  const personaSnapshot = {
    hasDebatePermission: personaPerm !== undefined,
    // The pure decision function only reads `length === 0` on this list, so
    // ProviderFamily-vs-ProviderId discrimination is not load-bearing here.
    // ProviderFamily and ProviderId share string values in v0.1 (claude /
    // codex / gemini / fake / xai) — the type cast at the call site is safe
    // for the length check. The full M11 eligibility filter lands in
    // commit 4b's fire path where opposingProvider is selected.
    opposingProviders: (personaPerm?.opposingProviders ?? []) as readonly never[],
  }

  // Reduce events for run/task accumulators + concurrency state.
  const debatesFiredThisRun = countFired(opts.events, opts.runId, undefined)
  const debatesFiredThisTask = countFired(opts.events, opts.runId, opts.taskId)
  const priorFingerprintsThisTask = collectPriorFingerprints(opts.events, opts.runId, opts.taskId)
  const debateInFlight = isDebateInFlight(opts.events, opts.runId, opts.phase)

  const currentFingerprint = sha256Hex(
    `${opts.taskId}|${opts.attempt}|${opts.preReviewReportSha256}`,
  )

  // Manifest projected size: changed files manifest + BUILD_REPORT + VERIFY +
  // REVIEW themselves (kickoff §2.11).
  const projectedFileCount = opts.buildReportChangedFileCount + 3
  // M10 DebatePermissions.maxFiles is the persona-declared cap. When the
  // persona has no debate permission, length-zero opposingProviders gates
  // first; we use 0 here so the input is well-formed.
  const personaMaxFiles = personaPerm?.maxFiles ?? 0

  const reviewStateForDecision: SchedulerReviewState =
    opts.reviewState.mode === 'single'
      ? {
          mode: 'single',
          score: opts.reviewState.score,
          verdict: opts.reviewState.verdict,
        }
      : {
          mode: 'panel',
          score: null,
          verdict: 'panel',
          panelistVerdicts: opts.reviewState.panelistVerdicts,
        }

  const input: SchedulerInput = {
    mode: policy.mode,
    review: reviewStateForDecision,
    history: {
      debatesFiredThisRun,
      debatesFiredThisTask,
      priorFingerprintsThisTask,
      currentFingerprint,
    },
    budget: {
      // M15 commit 5: real preflight result is plumbed via opts. When the
      // caller did not run the preflight (e.g., transitional wiring), we
      // default to false — the existing M13 chokepoints (assertWithinBudget)
      // still backstop downstream. The optional tipReason flows through
      // to debate_scheduler_skipped's optional budgetTipReason field.
      aggregatePreflightWouldTip: opts.aggregatePreflightWouldTip ?? false,
      ...(opts.aggregatePreflightTipReason !== undefined
        ? { tipReason: opts.aggregatePreflightTipReason }
        : {}),
    },
    persona: personaSnapshot as SchedulerInput['persona'],
    concurrency: { debateInFlight },
    manifest: {
      projectedFileCount,
      maxFiles: personaMaxFiles,
    },
    policy: {
      maxPerRun: policy.maxPerRun,
      maxPerTask: policy.maxPerTask,
      triggers: {
        reviewScoreGreyZone: { ...policy.triggers.reviewScoreGreyZone },
        panelVoterDisagreement: policy.triggers.panelVoterDisagreement,
        needsRevisionWithHighScore: policy.triggers.needsRevisionWithHighScore,
      },
      cooldown: { dedupByFingerprint: policy.cooldown.dedupByFingerprint },
    },
  }

  const inputDigest = canonicalInputDigest(input)
  const decision = evaluateSchedulerDecision(input)

  // Always emit `evaluated` (rule-21 reproducibility — both fire and skip
  // decisions trace through the same correlation envelope).
  await appendEvent(opts.eventPaths, {
    version: 1,
    type: 'debate_scheduler_evaluated',
    ts: opts.now(),
    runId: opts.runId,
    phase: opts.phase,
    agent: opts.agent,
    attempt: opts.attempt,
    taskId: opts.taskId,
    decisionId,
    reviewRound: opts.reviewRound,
    mode: policy.mode,
    inputDigest,
    preReviewReportSha256: opts.preReviewReportSha256,
    reviewMode: opts.reviewState.mode,
  })

  // Emit `skipped` for skip decisions.
  if (!decision.fire) {
    await appendEvent(opts.eventPaths, {
      version: 1,
      type: 'debate_scheduler_skipped',
      ts: opts.now(),
      runId: opts.runId,
      phase: opts.phase,
      agent: opts.agent,
      attempt: opts.attempt,
      taskId: opts.taskId,
      decisionId,
      reviewRound: opts.reviewRound,
      reason: decision.reason,
      preReviewReportSha256: opts.preReviewReportSha256,
      ...(decision.budgetTipReason !== undefined
        ? { budgetTipReason: decision.budgetTipReason }
        : {}),
    })
    return {
      decisionId,
      decision,
      inputDigest,
      fireOutcome: { fired: false, result: null },
    }
  }

  // decision.fire === true: run the fire path if an executor is wired.
  if (opts.firePathExecutor === undefined) {
    // Transitional path: decision.fire but no executor yet. Caller hasn't
    // wired the production seam (or test isn't exercising fire). Fire
    // decision is logged via `evaluated` only.
    return {
      decisionId,
      decision,
      inputDigest,
      fireOutcome: { fired: false, result: null },
    }
  }

  return runFirePath({
    opts,
    decisionId,
    decision,
    inputDigest,
  })
}

// ---------------------------------------------------------------------------
// Internal: fire-path orchestration (commit 4b)
// ---------------------------------------------------------------------------

interface FirePathContext {
  readonly opts: ReviewSchedulerHookOptions
  readonly decisionId: string
  readonly decision: SchedulerDecision & { readonly fire: true }
  readonly inputDigest: string
}

async function runFirePath(ctx: FirePathContext): Promise<ReviewSchedulerHookResult> {
  const { opts, decisionId, decision, inputDigest } = ctx
  const executor = opts.firePathExecutor!

  // Invoke the executor first. The executor chooses opposingProvider +
  // debateTopic (it has access to the registry + persona M11 eligibility).
  // We then emit `debate_scheduler_fired` with the chosen values BEFORE
  // emitting any subsequent event so the trace ordering is deterministic
  // (Codex Risk #3 — fired must precede postreview / scheduler_error).
  let result: SchedulerFirePathResult
  try {
    result = await executor({
      runId: opts.runId,
      taskId: opts.taskId,
      attempt: opts.attempt,
      reviewRound: opts.reviewRound,
      phase: opts.phase,
      decisionId,
      reviewerAgent: opts.reviewerAgent,
      preReviewReportSha256: opts.preReviewReportSha256,
      reviewState: opts.reviewState,
      buildReportChangedFileCount: opts.buildReportChangedFileCount,
      now: opts.now,
    })
  } catch (err) {
    // Executor itself threw — coerce to scheduler_error (other) and degrade.
    // The executor SHOULD return a structured result; throwing is the safety
    // net for unexpected programmer errors.
    await appendEvent(opts.eventPaths, {
      version: 1,
      type: 'debate_scheduler_error',
      ts: opts.now(),
      runId: opts.runId,
      phase: opts.phase,
      agent: opts.agent,
      attempt: opts.attempt,
      taskId: opts.taskId,
      decisionId,
      reviewRound: opts.reviewRound,
      reason: 'other',
      underlyingErrorCode: err instanceof Error ? err.message : String(err),
    })
    return {
      decisionId,
      decision,
      inputDigest,
      fireOutcome: {
        fired: true,
        result: {
          status: 'error_degrade',
          opposingProvider: 'unknown',
          debateTopic: 'unknown',
          errorReason: 'other',
          underlyingErrorCode: err instanceof Error ? err.message : String(err),
        },
      },
    }
  }

  // Emit `fired` BEFORE postreview / scheduler_error / intervention. The
  // fired event records the scheduler's decision to fire + the chosen
  // opposingProvider + debateTopic. Subsequent events join via decisionId.
  await appendEvent(opts.eventPaths, {
    version: 1,
    type: 'debate_scheduler_fired',
    ts: opts.now(),
    runId: opts.runId,
    phase: opts.phase,
    agent: opts.agent,
    attempt: opts.attempt,
    taskId: opts.taskId,
    decisionId,
    reviewRound: opts.reviewRound,
    reason: decision.reason,
    opposingProvider: result.opposingProvider,
    debateTopic: result.debateTopic,
    preReviewReportSha256: opts.preReviewReportSha256,
  })

  if (result.status === 'success') {
    // Emit postreview with verdict pre/post + finding deltas.
    await appendEvent(opts.eventPaths, {
      version: 1,
      type: 'debate_scheduler_postreview',
      ts: opts.now(),
      runId: opts.runId,
      phase: opts.phase,
      agent: opts.agent,
      attempt: opts.attempt,
      taskId: opts.taskId,
      decisionId,
      reviewRound: opts.reviewRound,
      preReviewReportSha256: opts.preReviewReportSha256,
      postReviewReportSha256: result.newReviewReportSha256,
      verdictPre: verdictPreFromReviewState(opts.reviewState),
      verdictPost: result.verdictPost,
      findingsAddedCount: result.findingsAddedCount,
      actionableFindingsAddedCount: result.actionableFindingsAddedCount,
    })
  } else if (result.status === 'error_degrade') {
    await appendEvent(opts.eventPaths, {
      version: 1,
      type: 'debate_scheduler_error',
      ts: opts.now(),
      runId: opts.runId,
      phase: opts.phase,
      agent: opts.agent,
      attempt: opts.attempt,
      taskId: opts.taskId,
      decisionId,
      reviewRound: opts.reviewRound,
      reason: result.errorReason,
      ...(result.underlyingErrorCode !== undefined
        ? { underlyingErrorCode: result.underlyingErrorCode }
        : {}),
    })
  } else {
    // result.status === 'intervention': hook emits NO further scheduler
    // event — the caller writes NEEDS_INTERVENTION.json from the
    // returned interventionCode + interventionRule. Per kickoff §2.7,
    // operator-actionable errors halt the run.
  }

  return {
    decisionId,
    decision,
    inputDigest,
    fireOutcome: { fired: true, result },
  }
}

function verdictPreFromReviewState(s: ReviewSchedulerHookReviewState): SchedulerReviewVerdict {
  if (s.mode === 'panel') return 'panel'
  return s.verdict
}

// ---------------------------------------------------------------------------
// Internal: events.jsonl reducers
// ---------------------------------------------------------------------------

/** Count `debate_scheduler_fired` events for the runId; if taskId is
 *  provided, restrict to that task. */
function countFired(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string | undefined,
): number {
  let n = 0
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'debate_scheduler_fired') continue
    if (e.runId !== runId) continue
    if (taskId !== undefined && e.taskId !== taskId) continue
    n++
  }
  return n
}

/** Collect prior firing fingerprints for the (runId, taskId). The fingerprint
 *  is recomputed from the event's preReviewReportSha256 + attempt to match
 *  the current decision's fingerprint computation. */
function collectPriorFingerprints(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): ReadonlySet<string> {
  const set = new Set<string>()
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'debate_scheduler_fired') continue
    if (e.runId !== runId) continue
    if (e.taskId !== taskId) continue
    set.add(sha256Hex(`${taskId}|${e.attempt}|${e.preReviewReportSha256}`))
  }
  return set
}

/** Detect an in-flight debate for (runId, phase): debate_started without a
 *  matching debate_resolved. */
function isDebateInFlight(
  events: readonly LoggedEvent[],
  runId: string,
  phase: Phase,
): boolean {
  let pending = 0
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.runId !== runId) continue
    if (e.type === 'debate_started' && e.phase === phase) pending++
    else if (e.type === 'debate_resolved' && e.phase === phase) pending--
  }
  return pending > 0
}

// ---------------------------------------------------------------------------
// Internal: hashing
// ---------------------------------------------------------------------------

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/** Canonicalize SchedulerInput to deterministic JSON and sha256 it. The
 *  caller-side replacer sorts object keys at every level and converts Set
 *  to a sorted array — both shapes appear in SchedulerInput. */
function canonicalInputDigest(input: SchedulerInput): string {
  return sha256Hex(canonicalJson(input))
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, canonicalReplacer)
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) {
    const arr = [...value]
    arr.sort()
    return arr
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k]
    }
    return sorted
  }
  return value
}
