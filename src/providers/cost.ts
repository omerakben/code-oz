// Conservative token estimator + cost-budget assertions for the wrapper.
//
// estimateTokens: deliberately rough heuristic — ~4 characters per token
// English upper bound. The bound is "refuse before catastrophic spend," not
// "predict to within 5%." No tokenizer dependency. Adapters can override
// later (M5+) without changing this module's contract.
//
// summarizeBudgetUse + assertWithinBudget: pre-call refusal (rule 10).
// Pairs each `agent_invoked.tokensEstimate` with its matching
// `agent_completed.tokensUsed` (when present) to avoid double-counting; an
// in-flight `agent_invoked` without a paired `agent_completed` falls back to
// the recorded estimate so a crashed turn still counts toward the budget.
//
// estimateCostUSD + actualCostUSD (M13, Codex Q4 lock,
// CODEX_RESPONSE_M13.md, thread 019de672): advisory dollar telemetry.
// Resolves prices via a two-step cascade — operator-configured
// `priceTable["<provider>:<model>"]` first; registry-resolved
// `capabilityOf(provider).costPerMTok` second. Both helpers return
// undefined when neither source has a value (Q3 lock — token-only
// fallback); never enforce, never refuse.

import { providerError } from './errors.ts'
import { isKnownPhaseEvent, type LoggedEvent, type Phase } from '../state/schemas.ts'
import type { CodeOzConfig } from '../config/schema.ts'
import { canonicalRoleFromAgent } from '../agents/role.ts'
import type { PreparedProviderRequest, ProviderFile, ProviderRequest } from './types.ts'

const CHARS_PER_TOKEN_UPPER_BOUND = 4

export interface EstimateInput {
  readonly prompt: string
  readonly files: readonly ProviderFile[]
}

/**
 * Conservative upper-bound estimate of the token cost of a provider call.
 * The estimate is the sum of character counts (prompt + every file's
 * content) divided by the upper-bound chars-per-token ratio, rounded up.
 *
 * Used by the wrapper layer for two purposes:
 *   1. Pre-call cost-budget refusal (provider_budget_exceeded).
 *   2. The tokensEstimate metric on agent_invoked events (rule 13 in
 *      docs/references/file-based-gates.md).
 */
export function estimateTokens(input: EstimateInput): number {
  let chars = input.prompt.length
  for (const f of input.files) {
    chars += f.sizeBytes
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_UPPER_BOUND)
}

export interface BudgetCounts {
  /** Sum of paired tokensUsed (or fallback tokensEstimate) for `phase`. */
  readonly perPhaseTokens: number
  /** Sum of paired tokensUsed (or fallback tokensEstimate) across all phases. */
  readonly globalTokens: number
  /** Count of `phase_entered` events for `phase`. */
  readonly perPhaseTurns: number
  /** Count of `phase_entered` events across all phases. */
  readonly globalTurns: number
  /** Count of `agent_invoked` events for `phase`. */
  readonly perPhaseProviderCalls: number
  /** Count of `agent_invoked` events across all phases. */
  readonly globalProviderCalls: number
  /** Wall-time minutes since `run_started.ts` (null when no run_started yet). */
  readonly wallTimeMinutes: number | null
  /**
   * M13 (Codex Q9 + commit-4 lock): paired tokens (tokensUsed or
   * fallback estimate) keyed by CompanyRole. Populated from
   * `agent_invoked.role` on the invoke side and the
   * `canonicalRoleFromAgent({name: agent})` derivation on the complete
   * side (since Q6 locked agent_completed without a role field). Roles
   * outside `M12_COMPANY_ROLES` and role-less invocations contribute
   * nothing here — they remain accountable to global / per-phase only.
   */
  readonly byRoleTokens: Readonly<Record<string, number>>
  /** Count of `agent_invoked` events with `role` present, keyed by role. */
  readonly byRoleProviderCalls: Readonly<Record<string, number>>
}

/**
 * M6 (rule 19): cumulative spend computed from events. The `now` parameter
 * lets tests inject a deterministic clock; production callers pass `new Date()`.
 */
export function computeWallTimeMinutes(
  events: readonly LoggedEvent[],
  now: Date,
): number | null {
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type === 'run_started') {
      const start = Date.parse(e.ts)
      if (!Number.isFinite(start)) return null
      return Math.max(0, (now.getTime() - start) / 60_000)
    }
  }
  return null
}

/**
 * Walk the event log and produce per-phase + global running totals used by
 * `assertWithinBudget`. Each `agent_invoked` event reserves its
 * `tokensEstimate`; the matching `agent_completed.tokensUsed` (FIFO within
 * a phase) replaces the estimate when present. Unmatched (in-flight)
 * agent_invoked entries keep their estimate as a conservative bound — a
 * crashed turn still counts.
 *
 * Tracks both per-phase and global counters for turns + provider calls so
 * `assertWithinBudget` can enforce both `config.budgets.perPhase[...]` AND
 * `config.budgets.global` limits. A phase that's well within its own
 * sub-budget can still trip the global cap when many phases run.
 */
export function summarizeBudgetUse(
  events: readonly LoggedEvent[],
  phase: Phase,
  now: Date = new Date(),
): BudgetCounts {
  let perPhaseTokens = 0
  let globalTokens = 0
  let perPhaseTurns = 0
  let globalTurns = 0
  let perPhaseProviderCalls = 0
  let globalProviderCalls = 0

  // FIFO per-phase queue of pending tokensEstimate values. agent_completed
  // for the same phase shifts the head and replaces the estimate with
  // tokensUsed (when present) or keeps the estimate (when absent).
  const pendingByPhase = new Map<Phase, number[]>()
  // M13 (commit 4): mirror per-phase FIFO discipline at the role
  // dimension. The wrapper holds a per-run lock across invoke+complete,
  // so the order in which roles enter pendingByRole matches the order
  // in which their completions arrive — the head of the queue is the
  // earliest in-flight call for that role.
  const pendingByRole = new Map<string, number[]>()
  const byRoleTokens: Record<string, number> = {}
  const byRoleProviderCalls: Record<string, number> = {}

  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type === 'phase_entered') {
      globalTurns++
      if (e.phase === phase) perPhaseTurns++
      continue
    }
    if (e.type === 'agent_invoked') {
      const queue = pendingByPhase.get(e.phase) ?? []
      queue.push(e.tokensEstimate)
      pendingByPhase.set(e.phase, queue)
      globalProviderCalls++
      if (e.phase === phase) perPhaseProviderCalls++
      // M13: role pairing — push when role is present (recorded by the
      // wrapper at invoke-time from `req.role`).
      if (typeof e.role === 'string' && e.role.length > 0) {
        const rq = pendingByRole.get(e.role) ?? []
        rq.push(e.tokensEstimate)
        pendingByRole.set(e.role, rq)
        byRoleProviderCalls[e.role] = (byRoleProviderCalls[e.role] ?? 0) + 1
      }
      continue
    }
    if (e.type === 'agent_completed') {
      const queue = pendingByPhase.get(e.phase) ?? []
      const estimate = queue.shift() ?? 0
      const cost = e.tokensUsed ?? estimate
      globalTokens += cost
      if (e.phase === phase) perPhaseTokens += cost
      // M13: role pairing — derive role from agent name via the
      // canonicalizer (Q6 lock kept role off agent_completed). Only
      // contribute to byRoleTokens when there is a matching pending
      // entry from a role-tagged invoke; this keeps the role accumulator
      // symmetric with the invoke side. A completion whose name
      // canonicalizes to a role but whose invoke did NOT tag a role
      // (project-local persona, debate opposing turn, etc.) is correctly
      // excluded from per-role accounting.
      const role = canonicalRoleFromAgent({ name: e.agent })
      if (role !== undefined) {
        const rq = pendingByRole.get(role)
        if (rq !== undefined && rq.length > 0) {
          const rEst = rq.shift()!
          const rCost = e.tokensUsed ?? rEst
          byRoleTokens[role] = (byRoleTokens[role] ?? 0) + rCost
        }
      }
      continue
    }
  }

  // Unmatched agent_invoked entries (no agent_completed yet) — count their
  // recorded estimate so a crashed turn still consumes its reserved budget.
  for (const [phaseKey, queue] of pendingByPhase) {
    for (const est of queue) {
      globalTokens += est
      if (phaseKey === phase) perPhaseTokens += est
    }
  }
  for (const [role, queue] of pendingByRole) {
    for (const est of queue) {
      byRoleTokens[role] = (byRoleTokens[role] ?? 0) + est
    }
  }

  return Object.freeze({
    perPhaseTokens,
    globalTokens,
    perPhaseTurns,
    globalTurns,
    perPhaseProviderCalls,
    globalProviderCalls,
    wallTimeMinutes: computeWallTimeMinutes(events, now),
    byRoleTokens: Object.freeze(byRoleTokens),
    byRoleProviderCalls: Object.freeze(byRoleProviderCalls),
  })
}

/**
 * Pre-call budget refusal. Throws ProviderError(provider_budget_exceeded)
 * on the first cap that the next call would push over (or already has). The
 * actionable suggestion names the exact config key to raise in
 * `.code-oz/config.yaml` so the user can recover without digging through
 * source.
 *
 * Order of checks: per-phase tokens, global tokens, per-phase turns,
 * per-phase provider calls. First breach wins (no aggregation).
 */
export function assertWithinBudget(
  config: CodeOzConfig,
  req: ProviderRequest,
  prepared: PreparedProviderRequest,
  events: readonly LoggedEvent[],
  now: Date = new Date(),
): void {
  const counts = summarizeBudgetUse(events, req.phase, now)
  const perPhase = config.budgets.perPhase[req.phase]
  const global = config.budgets.global
  const next = prepared.metrics.tokensEstimate

  // M13 (commit 4): per-role caps under `budgets.global.byRole.<role>`.
  // Per-role checks fire only when (a) req.role was set by the call site
  // and (b) the operator configured a cap for that role. Order per Codex:
  // per-phase -> per-role -> global, so that the most-specific scope
  // raises the typed error first and names the most actionable config
  // key. Codex Blocker 2: maxTurns is intentionally absent on byRole.
  const role = req.role
  const byRoleRow =
    role !== undefined ? global.byRole?.[role as keyof typeof global.byRole] : undefined

  if (counts.perPhaseTokens + next > perPhase.maxTokensEstimate) {
    throw providerError(
      'provider_budget_exceeded',
      `phase ${req.phase} would exceed maxTokensEstimate`,
      [`raise budgets.perPhase.${req.phase}.maxTokensEstimate in .code-oz/config.yaml`],
      `running=${counts.perPhaseTokens}, next=${next}, cap=${perPhase.maxTokensEstimate}`,
    )
  }
  if (
    role !== undefined &&
    byRoleRow?.maxTokensEstimate !== undefined &&
    (counts.byRoleTokens[role] ?? 0) + next > byRoleRow.maxTokensEstimate
  ) {
    throw providerError(
      'provider_budget_exceeded',
      `role ${role} would exceed maxTokensEstimate`,
      [`raise budgets.global.byRole.${role}.maxTokensEstimate in .code-oz/config.yaml`],
      `running=${counts.byRoleTokens[role] ?? 0}, next=${next}, cap=${byRoleRow.maxTokensEstimate}`,
    )
  }
  if (counts.globalTokens + next > global.maxTokensEstimate) {
    throw providerError(
      'provider_budget_exceeded',
      `global maxTokensEstimate would be exceeded`,
      [`raise budgets.global.maxTokensEstimate in .code-oz/config.yaml`],
      `running=${counts.globalTokens}, next=${next}, cap=${global.maxTokensEstimate}`,
    )
  }
  if (counts.perPhaseTurns > perPhase.maxTurns) {
    throw providerError(
      'provider_budget_exceeded',
      `phase ${req.phase} has exceeded maxTurns`,
      [`raise budgets.perPhase.${req.phase}.maxTurns in .code-oz/config.yaml`],
      `running=${counts.perPhaseTurns}, cap=${perPhase.maxTurns}`,
    )
  }
  if (counts.globalTurns > global.maxTurns) {
    throw providerError(
      'provider_budget_exceeded',
      `global maxTurns has been exceeded`,
      [`raise budgets.global.maxTurns in .code-oz/config.yaml`],
      `running=${counts.globalTurns}, cap=${global.maxTurns}`,
    )
  }
  if (counts.perPhaseProviderCalls + 1 > perPhase.maxProviderCalls) {
    throw providerError(
      'provider_budget_exceeded',
      `phase ${req.phase} would exceed maxProviderCalls`,
      [`raise budgets.perPhase.${req.phase}.maxProviderCalls in .code-oz/config.yaml`],
      `running=${counts.perPhaseProviderCalls}, next=1, cap=${perPhase.maxProviderCalls}`,
    )
  }
  if (
    role !== undefined &&
    byRoleRow?.maxProviderCalls !== undefined &&
    (counts.byRoleProviderCalls[role] ?? 0) + 1 > byRoleRow.maxProviderCalls
  ) {
    throw providerError(
      'provider_budget_exceeded',
      `role ${role} would exceed maxProviderCalls`,
      [`raise budgets.global.byRole.${role}.maxProviderCalls in .code-oz/config.yaml`],
      `running=${counts.byRoleProviderCalls[role] ?? 0}, next=1, cap=${byRoleRow.maxProviderCalls}`,
    )
  }
  if (counts.globalProviderCalls + 1 > global.maxProviderCalls) {
    throw providerError(
      'provider_budget_exceeded',
      `global maxProviderCalls would be exceeded`,
      [`raise budgets.global.maxProviderCalls in .code-oz/config.yaml`],
      `running=${counts.globalProviderCalls}, next=1, cap=${global.maxProviderCalls}`,
    )
  }
  if (
    counts.wallTimeMinutes !== null &&
    counts.wallTimeMinutes > global.maxWallTimeMinutes
  ) {
    throw providerError(
      'provider_budget_exceeded',
      `global maxWallTimeMinutes has been exceeded`,
      [`raise budgets.global.maxWallTimeMinutes in .code-oz/config.yaml`],
      `running=${counts.wallTimeMinutes.toFixed(2)}, cap=${global.maxWallTimeMinutes}`,
    )
  }
}

// --- USD cost telemetry (M13) -------------------------------------

/**
 * Cost-source resolver dependency. The wrapper passes `priceTable` from
 * `config.budgets.global.priceTable` (operator-configured, model-level)
 * and `capabilityOf` bound to the runtime `ProviderRegistry` (so test
 * + W3 capability overrides are honored — Codex Risk #6 lock). Pure;
 * never reads disk.
 */
export interface CostEstimateContext {
  readonly priceTable: ReadonlyMap<string, { inputPerMTok: number; outputPerMTok: number }> | Readonly<Record<string, { inputPerMTok: number; outputPerMTok: number }>> | undefined
  readonly capabilityOf: (provider: string) => { readonly costPerMTok?: { input: number; output: number } } | undefined
}

interface ResolvedRates {
  readonly inputPerMTok: number
  readonly outputPerMTok: number
}

/**
 * Resolve per-MTok rates for a (provider, model) pair via the M13
 * cascade. Used by both `estimateCostUSD` and `actualCostUSD` so the
 * cascade lives in one place.
 */
function resolveRates(
  provider: string,
  model: string | undefined,
  cost: CostEstimateContext,
): ResolvedRates | undefined {
  if (model === undefined || model.length === 0) return undefined
  const key = `${provider}:${model}`
  const tableEntry =
    cost.priceTable === undefined
      ? undefined
      : cost.priceTable instanceof Map
        ? cost.priceTable.get(key)
        : (cost.priceTable as Readonly<Record<string, { inputPerMTok: number; outputPerMTok: number }>>)[key]
  if (tableEntry !== undefined) {
    return Object.freeze({
      inputPerMTok: tableEntry.inputPerMTok,
      outputPerMTok: tableEntry.outputPerMTok,
    })
  }
  const cap = cost.capabilityOf(provider)?.costPerMTok
  if (cap !== undefined) {
    return Object.freeze({ inputPerMTok: cap.input, outputPerMTok: cap.output })
  }
  return undefined
}

/**
 * Pre-call advisory USD estimate. Combines the conservative token
 * estimator (input) with the operator-supplied `req.maxOutputTokens`
 * (output, when set; 0 otherwise — known underestimate documented in
 * the contract). Returns undefined when no price source resolves;
 * callers omit the field rather than emit a placeholder zero.
 */
export function estimateCostUSD(
  req: ProviderRequest,
  prepared: PreparedProviderRequest,
  cost: CostEstimateContext,
): number | undefined {
  const provider = req.agent.provider as string
  const rates = resolveRates(provider, prepared.model, cost)
  if (rates === undefined) return undefined
  const inputTokens = prepared.metrics.tokensEstimate
  const outputTokens = req.maxOutputTokens ?? 0
  return (inputTokens * rates.inputPerMTok + outputTokens * rates.outputPerMTok) / 1_000_000
}

/**
 * Post-call advisory USD actual. Output-tokens-only semantics (Codex
 * scope correction): today's Claude / xAI adapters report
 * `usage.output_tokens` / `usage.completion_tokens`, never full
 * request cost. Operators reading `costActualUSD` as full invoice
 * would understate spend. Documented prominently in COMPANY.md /
 * budgets contract. Returns undefined when no price source resolves.
 */
export function actualCostUSD(
  provider: string,
  model: string | undefined,
  cost: CostEstimateContext,
  tokensUsed: number,
): number | undefined {
  const rates = resolveRates(provider, model, cost)
  if (rates === undefined) return undefined
  return (tokensUsed * rates.outputPerMTok) / 1_000_000
}

// --- soft warnings -------------------------------------------------

export type SoftBudgetMetric =
  | 'maxTurns'
  | 'maxProviderCalls'
  | 'maxTokensEstimate'
  | 'maxWallTimeMinutes'

export interface SoftBudgetWarning {
  readonly metric: SoftBudgetMetric
  readonly ratio: number     // current / cap, in [softWarnAtRatio, 1.0)
  readonly current: number   // current cumulative spend (post-this-call)
  readonly limit: number     // cap (global or per-role)
  /**
   * M13 (Codex Q8 lock): optional CompanyRole. Present when the warning
   * is for a per-role cap under `budgets.global.byRole.<role>`; absent
   * when the warning is for the existing global cap. Only meaningful
   * for `maxProviderCalls` and `maxTokensEstimate` (Codex Blocker 2:
   * `maxTurns` and `maxWallTimeMinutes` have no per-role dimension).
   */
  readonly role?: string
}

/**
 * M6 (rule 19): detect metrics that the next call would push into the soft
 * warning band [softWarnAtRatio, 1.0). Returns at most one warning per metric
 * per run — if a `budget_warning` for the same metric already exists in the
 * event log, this skips it (no re-emit storm).
 */
export function detectBudgetSoftWarnings(
  config: CodeOzConfig,
  req: ProviderRequest,
  prepared: PreparedProviderRequest,
  events: readonly LoggedEvent[],
  now: Date = new Date(),
): readonly SoftBudgetWarning[] {
  const counts = summarizeBudgetUse(events, req.phase, now)
  const global = config.budgets.global
  const ratio = global.softWarnAtRatio
  const out: SoftBudgetWarning[] = []
  // M13 (Codex Q8 lock): duplicate-emit guard becomes
  // `(metric, role ?? "global")` so per-role warnings deduplicate
  // independently from global warnings.
  const alreadyWarned = new Set<string>()
  const guardKey = (metric: SoftBudgetMetric, role?: string): string =>
    `${metric}|${role ?? 'global'}`
  for (const e of events) {
    if (isKnownPhaseEvent(e) && e.type === 'budget_warning') {
      alreadyWarned.add(guardKey(e.metric as SoftBudgetMetric, e.role))
    }
  }
  const consider = (
    metric: SoftBudgetMetric,
    nextValue: number,
    cap: number,
    role?: string,
  ): void => {
    if (cap <= 0 || alreadyWarned.has(guardKey(metric, role))) return
    const r = nextValue / cap
    if (r >= ratio && r < 1) {
      out.push(
        Object.freeze({
          metric,
          ratio: r,
          current: nextValue,
          limit: cap,
          ...(role !== undefined ? { role } : {}),
        }),
      )
    }
  }
  // Global warnings (existing).
  consider('maxTokensEstimate', counts.globalTokens + prepared.metrics.tokensEstimate, global.maxTokensEstimate)
  consider('maxTurns', counts.globalTurns, global.maxTurns)
  consider('maxProviderCalls', counts.globalProviderCalls + 1, global.maxProviderCalls)
  if (counts.wallTimeMinutes !== null) {
    consider('maxWallTimeMinutes', counts.wallTimeMinutes, global.maxWallTimeMinutes)
  }
  // M13: per-role warnings. Fire only for the active role (req.role)
  // and only when the operator configured a cap for it. The two
  // metrics that have a per-role dimension are maxTokensEstimate and
  // maxProviderCalls (Codex Blocker 2 lock).
  const role = req.role
  const byRoleRow =
    role !== undefined ? global.byRole?.[role as keyof typeof global.byRole] : undefined
  if (role !== undefined && byRoleRow !== undefined) {
    if (byRoleRow.maxTokensEstimate !== undefined) {
      consider(
        'maxTokensEstimate',
        (counts.byRoleTokens[role] ?? 0) + prepared.metrics.tokensEstimate,
        byRoleRow.maxTokensEstimate,
        role,
      )
    }
    if (byRoleRow.maxProviderCalls !== undefined) {
      consider(
        'maxProviderCalls',
        (counts.byRoleProviderCalls[role] ?? 0) + 1,
        byRoleRow.maxProviderCalls,
        role,
      )
    }
  }
  return Object.freeze(out)
}
