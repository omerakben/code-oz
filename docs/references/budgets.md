# Budgets

User-facing spec for `.code-oz/config.yaml budgets` — the cap layers
that gate provider calls, the cost telemetry on `agent_invoked` /
`agent_completed`, and the soft warnings that fire short of a hard kill.

The canonical contract is pinned in `docs/references/provider-contract.md`
("Cost-budget pre-call check" + "Tool-call cap streaming enforcement").
This doc is the readable surface; conflicts resolve to provider-contract.

## Cap layers (M13 cascade)

Three cap layers, ordered most-specific → least-specific. The first one
that the next call would push over is the layer that throws
`provider_budget_exceeded`. Every error names the exact config key in
`actionableSuggestions`.

```
per-call (the wrapper, every call)
  ↓
per-phase (budgets.perPhase.<phase>)
  ↓
per-role  (budgets.global.byRole.<role>)   ← M13
  ↓
global    (budgets.global)
```

The order means: a per-role cap fires before a global cap when both
would breach, because the per-role suggestion is more actionable.
M14+ may flip the authoritative metric on measurable demand.

## `budgets.global` (rule 19, single namespace)

Every cumulative cap lives under `budgets.global`. Rule 19 forbids
parallel namespaces; `byRole` and `priceTable` both nest here.

```yaml
budgets:
  global:
    maxTurns: 100                # phase_entered events, run-wide
    maxProviderCalls: 50         # agent_invoked events, run-wide
    maxTokensEstimate: 2_000_000 # paired tokensUsed, fallback to estimate
    maxReviewRounds: 4           # CLAUDE.md rule 6
    maxToolCallsPerTurn: 10      # streaming counter inside one turn
    toolCallBudgetMultiplier: 1.5  # hard ceiling = floor(soft * mult)
    maxWallTimeMinutes: 240      # since run_started.ts
    softWarnAtRatio: 0.75        # emit budget_warning at 75% of cap
    priceTable:
      claude:claude-opus-4-7:
        inputPerMTok: 5
        outputPerMTok: 25
    byRole:
      builder:
        maxProviderCalls: 25
        maxTokensEstimate: 800_000
```

### `budgets.global.byRole` (M13)

Per-role overrides keyed by `M12_COMPANY_ROLES`
(`ba | lead | builder | verifier | reviewer | scientist`). Each row
carries `maxProviderCalls?` and `maxTokensEstimate?` — both optional.

`maxTurns` is **intentionally absent** on `byRole` (Codex Blocker 2 lock):
the existing `maxTurns` reducer counts `phase_entered`, not agent calls,
so the role dimension has no event-model meaning. If a future milestone
adds role-turn semantics, `maxTurns` may join `byRole`; until then it is
rejected at config-load with `config_invalid_value`.

Validation:
- Non-canonical role keys reject with `loader_company_role_unknown`
  (symmetric with M12 `mergeCompany` fail-closed).
- Unsupported row keys (`maxTurns`, `permissions`, etc.) reject with
  `config_invalid_value`.
- Negative or non-integer values reject with `config_invalid_value`.
- Empty rows are accepted and inherit global caps (no override).

When a call's resolved role has a `byRole` row, the per-role cap fires
between per-phase and global checks. When the row is absent (or the
call has no role — see "Role-identity binding" below), only per-phase
+ global enforce.

### `budgets.global.priceTable` (M6, extended in M13)

Operator-configured per-model rates for advisory dollar telemetry.
Keyed by `<provider>:<model>` (e.g., `claude:claude-opus-4-7`). Values
are non-negative finite numbers (NaN, Infinity, negative all reject).

Default `priceTable` populates Claude shipped models per
`platform.claude.com/docs/en/about-claude/pricing` (lookup 2026-05-01):

| Model | inputPerMTok | outputPerMTok |
|---|---|---|
| `claude-opus-4-7` | $5 | $25 |
| `claude-sonnet-4-6` | $3 | $15 |
| `claude-haiku-4-5-20251001` | $1 | $5 |

Other providers (xAI Grok, Codex, Gemini, Fake) stay omitted from the
default per the rotting-data discipline (Codex Q4-bis lock). Operators
who want USD telemetry for those providers add rows to their own
`priceTable`.

## Role-identity binding (Codex Q9 lock)

`ProviderRequest.role` is set explicitly at the invocation site via
`canonicalRoleFromAgent` (`src/agents/role.ts`). The bundled-role call
sites are:

| Phase / tool | Caller | Role bound |
|---|---|---|
| DEFINE ask-me | `src/phases/ask-me.ts` | `ba` |
| PLAN | `src/phases/plan.ts` | `lead` |
| Scientist phase-tail | `src/phases/scientist.ts` | `scientist` |
| `requestReview` | `src/tools/review-request.ts` | `reviewer` |
| `requestDebate` synthesis turn | `src/tools/debate-request.ts` | caller's role |
| `requestDebate` opposing turn | `src/tools/debate-request.ts` | **(none)** |

Synthetic debate-opponent agents (whose names are intentionally outside
`M12_COMPANY_ROLES`) and project-local personas pass no `role`; the
canonicalizer fails closed on every name outside the roster. Those
calls still count against global + per-phase budgets.

## Cost telemetry (M13)

Two optional advisory fields land on the wrapper-emitted events when
a price source resolves. **Tokens stay authoritative** — neither field
gates calls in M13 (Codex Q2 lock).

- `agent_invoked.costEstimateUSD?` — pre-call upper-bound dollar
  estimate. Combines input from the conservative token estimator
  (`prepared.metrics.tokensEstimate`) with output from
  `req.maxOutputTokens ?? 0`. The output-side default is a known
  underestimate when `maxOutputTokens` is unset; advisory only.
- `agent_completed.costActualUSD?` — post-call dollar actual.
  **Output-tokens-only semantics** (Codex scope correction): today's
  Claude adapter reads `usage.output_tokens` and the xAI adapter reads
  `usage.completion_tokens`. Neither is full request cost. Operators
  reading this field as full invoice will understate spend.

Both fields are absent on the event when no price source resolves
(token-only fallback). Adding a price source — either operator-
configured `priceTable` or registry-resolved `capabilityOf.costPerMTok`
— populates them retroactively from that point forward.

The price cascade (Codex Q4 lock) is:

1. `priceTable["<provider>:<model>"]` (operator-specific, model-level)
2. `ProviderRegistry.capabilityOf(provider).costPerMTok` (per-provider
   fallback; honors test/W3 capability overrides — Codex Risk #6)

When neither resolves, the field is omitted on the event. The wrapper
never emits a placeholder zero.

## Soft warnings

`detectBudgetSoftWarnings` emits `budget_warning` events at
`softWarnAtRatio` (default 0.75 = 75% of cap). Hard kills still fire
at 1.0.

Per-metric, per-(role-or-global) deduplication: at most one warning
per `(metric, role ?? "global")` per run. Warning fields:

```ts
{
  metric: 'maxTurns' | 'maxProviderCalls' | 'maxTokensEstimate' | 'maxWallTimeMinutes'
  ratio: number      // current / cap, in [softWarnAtRatio, 1)
  current: number    // post-this-call cumulative spend
  limit: number      // cap (global or per-role)
  role?: string      // M13: present when warning is for byRole.<role>
}
```

`maxTurns` and `maxWallTimeMinutes` are global-only metrics — the
event validator rejects a warning that pairs them with a role, since
Codex Blocker 2 locked these out of the per-role dimension.

## NEEDS_INTERVENTION on cap exhaustion

Every hard kill produces a typed `ProviderError(provider_budget_exceeded)`
with:

- `rule` — names the violated dimension
  (e.g., `"role builder would exceed maxTokensEstimate"`).
- `actionableSuggestions` — names the exact config key to raise
  (e.g., `"raise budgets.global.byRole.builder.maxTokensEstimate in .code-oz/config.yaml"`).
- `detail` — current vs. next vs. cap numbers for triage.

The wrapper turns this into `NEEDS_INTERVENTION.json` + an
`intervention` event under one short post-call lock. Adapters never
write either (`docs/references/provider-contract.md` rule 1).

## What this contract does not ship (deferred)

- Dollar hard caps (`maxCostUSD`) — M14+ with measurable demand
  (rule 21).
- `byRole.maxTurns` — until role-turn event semantics exist.
- xAI / Codex / Gemini / Fake price defaults — rotting-data discipline.
- Retry / backoff / `Retry-After` parsing — separate concern.
- Full billing modeling (prompt caching, server-side tools, batch
  discounts, gateway markup) — post-v0.1.

## See also

- [`docs/contracts/COMPANY.md`](../contracts/COMPANY.md) — `M12_COMPANY_ROLES`, role-to-provider routing
- [`docs/references/provider-contract.md`](./provider-contract.md) — `ProviderError` codes, NEEDS_INTERVENTION discipline, cost-budget pre-call check
- [`docs/contracts/PROVIDERS.md`](../contracts/PROVIDERS.md) — provider adapters and capabilities
- [`docs/research/CODEX_RESPONSE_M13.md`](../research/CODEX_RESPONSE_M13.md) — M13 planning round + locked decisions
