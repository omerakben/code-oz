// M15 commit 4a — REVIEW phase post-verdict scheduler evaluate hook.
//
// Authority slice: build SchedulerInput from the runtime context, call the
// pure decision function, emit `debate_scheduler_evaluated` always, emit
// `debate_scheduler_skipped` for skip decisions. NO fire path yet — that
// lands in commit 4b along with the .review.lock factoring (Codex Risk #4
// in CODEX_RESPONSE_M15.md).
//
// Call sites (commits 4a + 4b):
//   - src/phases/review.ts: runReviewInner, after review_round_completed
//     is appended and before the verdict branch.
//   - src/phases/review.ts: runReviewPanelBranch, after the panel
//     intervention check passes and before the resolved/needs_revision/
//     blocked branching.
//
// The hook is intentionally a pure-ish helper (one I/O dependency: appendEvent
// for the two events). It does not own the lock, does not own the verdict
// branch, and does not act on `decision.fire === true` — commit 4b will.

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
}

export interface ReviewSchedulerHookResult {
  readonly decisionId: string
  readonly decision: SchedulerDecision
  readonly inputDigest: string
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
      // Commit 5 wires the real aggregateDebateSchedulerPreflight result.
      // Commit 4a defaults to false so the hook never spuriously skips on
      // budget; the existing M13 chokepoints still backstop downstream.
      aggregatePreflightWouldTip: false,
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

  // Emit `skipped` for skip decisions; commit 4b adds the `fired` emission.
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
  }
  // decision.fire === true: commit 4a logs `evaluated` only and returns.
  // The runtime caller (commits 4a + 4b) decides what to do with the
  // returned decision; commit 4a discards it.

  return { decisionId, decision, inputDigest }
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
