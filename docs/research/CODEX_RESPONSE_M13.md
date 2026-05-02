# Codex planning review — M13

**Thread:** `019de672-2602-7981-a16f-3a55023f26b7`
**Model:** `gpt-5.5` at `xhigh` reasoning effort
**Sandbox:** `read-only`, `approval-policy: never`, `cwd: /Users/ozzy-mac/Projects/code-oz`
**Date:** 2026-05-01

## Verdict
accept-with-modifications

## Blockers before code
1. Do not ship Q9 as `agent.name` sniffing. Lock `ProviderRequest.role?: CompanyRole`, append `agent_invoked.role?`, and enforce per-role budgets only when `role` is present.
2. Remove `maxTurns` from the M13 `byRole` shape unless a new role-turn event model is defined. Current `maxTurns` is counted from `phase_entered`, not agent/provider turns.
3. Do not populate provider-level `claude.costPerMTok` with model-level prices. If default USD telemetry is desired, put exact model entries in `budgets.global.priceTable`, with dated official-source comments.

## Scope corrections
- Confirm pinned Q1: `budgets.global.byRole.<role>` is consistent with `CLAUDE.md` rule 19 and `COMPANY.md` forward-compat. Keep the name `byRole`.
- Confirm pinned Q3: missing cost data falls back to token-only enforcement.
- Confirm pinned Q5: per-call wrapper enforcement + existing per-phase + new per-role only. No new dollar hard-cap layer.
- `ByRoleBudget` should be `{ maxProviderCalls?, maxTokensEstimate? }` for M13.
- `costActualUSD` must be documented as cost from reported completion/output tokens only, not full invoice actual. Current Claude and xAI adapters report output/completion tokens, not total tokens.
- Do not round USD telemetry to two decimals before storing. Small calls will lose signal.

## Open-question resolutions
- Q2 (tokens vs USD): Resolution: `tokensEstimate` remains authoritative; USD fields are advisory only. Reasoning: token estimates are local and deterministic; dollar data is model/provider-price metadata that can rot, and no `maxCostUSD` config surface exists today.
- Q4 (priceTable vs capabilityOf): Resolution: `budgets.global.priceTable["<provider>:<model>"]` wins; fall back to `ctx.registry.capabilityOf(provider).costPerMTok` only when no model price exists. Reasoning: `priceTable` is model-specific and operator-owned; registry capability is provider-level fallback and must honor runtime capability overrides.
- Q4-bis (default population): Resolution: no provider-level `costPerMTok` defaults for Claude. If M13 wants out-of-box USD telemetry, populate Claude model prices in `DEFAULT_CONFIG.budgets.global.priceTable`, not `DEFAULT_CAPABILITY_BY_ID.claude.costPerMTok`; omit xAI, Codex, Gemini, and Fake. Reasoning: Anthropic's current official pricing page lists model-level base prices for Opus 4.7, Sonnet 4.6, and Haiku 4.5, but the repo's provider capability shape has no model dimension. Source: https://platform.claude.com/docs/en/about-claude/pricing
- Q6 (event shape): Resolution: extend existing events. Add optional `agent_invoked.role?`, `agent_invoked.costEstimateUSD?`, `agent_completed.costActualUSD?`, and `budget_warning.role?`. Reasoning: this follows the existing open-union event discipline and the M12 `agent_invoked.model?` precedent.
- Q7 (error code): Resolution: reuse `provider_budget_exceeded`. Reasoning: current per-phase/global budget failures already share that code and distinguish the violated dimension in `rule` plus `actionableSuggestions`.
- Q8 (soft warnings): Resolution: extend `budget_warning` with optional `role?: CompanyRole`; global warnings omit `role`. Reasoning: `byRole` lives under `budgets.global`, so this is not a parallel namespace. The duplicate guard becomes `(metric, role ?? "global")`.
- Q9 (role-identity binding): Resolution: use `ProviderRequest.role?: CompanyRole`, not sniffing and not a frontmatter schema field. Reasoning: it is explicit per invocation, preserves project-local persona fallback, avoids touching every persona file, and handles shipped-role overrides correctly. Synthetic debate opponents omit role and still count against global/per-phase budgets.
- Q10 (byRole validation): Resolution: reject non-canonical keys at config load, reusing `loader_company_role_unknown`. Reasoning: M12 already made the six-role roster the authority; `byRole` should validate against the same constant and fail closed.

## Risks the proposing side missed
- `byRole.maxTurns` is undefined against the current event model. Counting it as provider calls would duplicate `maxProviderCalls`; counting it as `phase_entered` has no role identity.
- `costActualUSD` is easy to overstate. Existing `tokensUsed` is output/completion-token provenance for current real adapters, so it cannot represent full request cost by itself.
- `priceTable` validation must be hardened before cost math consumes it. Current parsing only checks `typeof === "number"`, not finite or non-negative.
- Debate calls need explicit role policy. Synthesis turns should carry the caller role; synthetic opposing turns should carry no role unless a future milestone creates a real role surface for them.
- Default Claude API prices may not equal actual subscription-first Claude CLI spend. This reinforces USD-as-advisory for M13.
- Runtime cost fallback should use `ProviderRegistry.capabilityOf`, not the pure default `capabilityOf`, so test/W3 capability overrides are respected.

## Bugs or stale assumptions Claude missed (cite file:line)
- `byRole.maxTurns` is stale against live accounting: `BudgetCounts` defines turns separately from provider calls in `src/providers/cost.ts:49`, and the reducer increments turns from `phase_entered`, not from `agent_invoked`, in `src/providers/cost.ts:112`.
- Q9 sniffing does not fail closed. `ProviderRequest` currently has no role field in `src/providers/types.ts:60`, and non-roster definitions pass through unchanged in `src/agents/loader.ts:141`.
- Synthetic debate opponents are real provider calls but intentionally outside `M12_COMPANY_ROLES`: `src/tools/debate-request.ts:681`.
- Provider-level Claude cost defaults conflict with current source comments: `src/providers/capabilities.ts:91` says Claude prices are model-level, while `src/config/schema.ts:72` defines the per-model `priceTable`.
- `priceTable` currently accepts any numeric value without finite/non-negative validation: `src/config/load.ts:413`.
- `costActualUSD` cannot mean full actual with today's adapters: Claude reads `usage.output_tokens` in `src/providers/claude.ts:84`, and xAI reads `usage.completion_tokens` in `src/providers/xai.ts:436`.

## Implementation order changes
1. Config first: add `budgets.global.byRole` with role-key validation and harden `priceTable` number validation.
2. Event schema next: add optional role/cost fields and validators before any writer emits them.
3. Role plumbing before enforcement: add `ProviderRequest.role?: CompanyRole`, update shipped-role invocation sites, and record `agent_invoked.role?`.
4. Cost accounting after role events exist: extend summarization, hard checks, and soft-warning duplicate keys.
5. USD helper after cost accounting: implement `estimateCostUSD` with `priceTable` first, registry capability fallback second, absence = no USD field.
6. Invoke integration last: write estimate/actual fields and role-aware warning events under the existing short-lock pattern.
7. Tests and docs should be interleaved with each behavior, not pushed to one final test commit.

## What to defer
- Dollar hard caps, `maxCostUSD`, or refusing calls on stale dollar data.
- `byRole.maxTurns` until role-turn semantics exist.
- xAI/Grok default prices, Codex subscription pricing, Gemini pricing, Fake pricing.
- Retry/backoff, `Retry-After`, new permission scopes, company-roster schema changes, and any parallel-provider surface.
- Full billing modeling for prompt caching, server-side tools, data residency, batch discounts, or gateway markup.

## Final recommendation
accept-with-modifications. M13 is valid and should proceed after the synthesis locks Q9 to explicit `ProviderRequest.role`, removes `byRole.maxTurns`, and moves any Claude default prices to model-level `priceTable` rather than provider-level `costPerMTok`. `bun run typecheck` is clean. Full `bun test` could not be behaviorally verified in this read-only sandbox because many tests fail on `mkdtemp` with `EPERM`; the attempted run reported 1322 pass / 641 fail from sandbox temp-file denial.

---

# Claude synthesis (2026-05-01)

Codex's verdict is `accept-with-modifications` with three blockers, all of
which I accept. Two of Codex's findings flip Claude leans (Q9 binding,
Q4-bis defaults); one shrinks the surface (`byRole.maxTurns` removed).
Six bug-catches with file:line are valid against current code. Per the
no-tech-debt memory, every blocker and every accepted modification is
either landed in the locked commit order or explicitly deferred with a
named milestone.

## Locked decisions

### Pinned answers (confirmed by Codex; no change)

- **Q1** — `budgets.global.byRole.<role>` (parallel namespace under
  `budgets.global`).
- **Q3** — Token-only enforcement when cost data unavailable;
  `costEstimateUSD` absent on `agent_invoked` for that call.
- **Q5** — Per-call (existing wrapper) + per-phase (existing
  `budgets.perPhase`) + per-role (new). No new layer.

### Open-question resolutions (locked)

- **Q2** — `tokensEstimate` authoritative; USD advisory only in M13.
  M14+ may flip on measurable demand.
- **Q4** — `budgets.global.priceTable["<provider>:<model>"]` wins;
  fall back to `ctx.registry.capabilityOf(provider).costPerMTok` only
  when no model price exists. **Note: registry, not pure
  `capabilityOf`** — runtime overrides honored.
- **Q4-bis (FLIPPED)** — Populate Claude model prices in
  `DEFAULT_CONFIG.budgets.global.priceTable` (per-model, dated source
  comment per CLAUDE.md model reference), NOT in
  `DEFAULT_CAPABILITY_BY_ID.claude.costPerMTok`. The capability shape
  has no model dimension; provider-level pricing on Opus 4.7
  ($5/$25) vs Haiku 4.5 ($1/$5) is a category error. xAI / Codex /
  Gemini / Fake stay omitted (rotting-data discipline).
- **Q6** — Extend existing events with optional fields:
  `agent_invoked.role?`, `agent_invoked.costEstimateUSD?`,
  `agent_completed.costActualUSD?`, `budget_warning.role?`. Mirror
  M12 `agent_invoked.model?` pattern.
- **Q7** — Reuse `provider_budget_exceeded`. Rule string + actionable
  suggestion disambiguates the dimension.
- **Q8** — Extend `budget_warning` with optional `role?: CompanyRole`.
  Duplicate guard becomes `(metric, role ?? "global")`.
- **Q9 (FLIPPED)** — Use `ProviderRequest.role?: CompanyRole`, NOT
  `agent.name` sniffing. Per-role gating fires only when `role`
  present; absent `role` falls back to existing global + per-phase.
  Synthetic debate opponents omit `role` (they are real provider
  calls outside `M12_COMPANY_ROLES` per
  `src/tools/debate-request.ts:681`). Project-local personas similarly
  omit `role` and continue to work under global + per-phase only.
- **Q10** — Reject non-canonical `byRole` keys at config-load with
  `loader_company_role_unknown`. Symmetric with M12 `mergeCompany`
  fail-closed.

### Scope refinements (locked)

- `ByRoleBudget` shape: `{ maxProviderCalls?, maxTokensEstimate? }`.
  **`maxTurns` removed** — per Codex's blocker 2, current `maxTurns`
  counts `phase_entered`, not provider calls or agent invocations,
  so the role dimension is undefined for it.
- `costActualUSD` documented as **cost-from-output-tokens-only**, not
  full request cost. Today's Claude adapter reads
  `usage.output_tokens` (`src/providers/claude.ts:84`); xAI reads
  `usage.completion_tokens` (`src/providers/xai.ts:436`). Neither is
  full invoice. The contract names what it actually computes.
- `costEstimateUSD` and `costActualUSD` stored as plain numbers (no
  two-decimal rounding before storage — small calls would lose
  signal). Display layers may format.
- `priceTable` value validation hardened: reject non-finite,
  non-negative, NaN. The current `src/config/load.ts:413` only
  checks `typeof === "number"`.
- Synthetic debate-opponent calls (the `requestDebate()` runtime)
  carry no `role`; the debate caller's synthesis turn carries the
  caller's role. Documented in commit-3 changes.

## Locked commit order (Codex's order with one merge)

I merged Codex's seven steps into seven commits matching his ordering.
Tests and docs interleave per Codex's point 7.

1. **`feat(config): add budgets.global.byRole + harden priceTable validation`**
   - `src/config/schema.ts`: add `ByRoleBudget` interface
     (`{ maxProviderCalls?, maxTokensEstimate? }`); extend
     `GlobalBudget` with `byRole?: Readonly<Partial<Record<CompanyRole, ByRoleBudget>>>`.
   - `src/config/load.ts`: add `mergeByRole` validator (reuses
     `loader_company_role_unknown`; rejects non-canonical roles, empty
     values, unsupported keys); harden `priceTable` numeric validation
     (`Number.isFinite`, `>= 0`).
   - Tests: byRole validation (canonical pass, non-canonical reject,
     unsupported-key reject); priceTable validation (NaN reject,
     negative reject, infinite reject).

2. **`feat(state): extend agent_invoked / agent_completed / budget_warning with role + cost fields`**
   - `src/state/schemas.ts`: add optional `role?: CompanyRole`,
     `costEstimateUSD?: number` to `agent_invoked`;
     `costActualUSD?: number` to `agent_completed`;
     `role?: CompanyRole` to `budget_warning`.
   - `src/state/events.ts`: validators for each new field (mirror
     M12 `agent_invoked.model?` pattern — non-blank string for role,
     non-negative finite number for cost).
   - Tests: per-field validator coverage; backward-compat (omitted
     fields still parse).

3. **`feat(providers): add ProviderRequest.role + thread role through invocation sites`**
   - `src/providers/types.ts`: add `role?: CompanyRole` to
     `ProviderRequest`.
   - Update every shipped-role invocation site to pass `role` from
     the resolved persona's role identity (canonicalized via M12
     `M12_COMPANY_ROLES`). Project-local personas + synthetic debate
     opponents omit `role`.
   - `src/providers/invoke.ts`: thread `req.role` into
     `agent_invoked` event when present.
   - Tests: role propagation through invocation sites; debate
     opponents have no role; project-local personas have no role.

4. **`feat(providers): per-role budget summarization + assertion`**
   - `src/providers/cost.ts`: extend `BudgetCounts` with `byRole`
     subtotals (per-role tokens, provider calls); `summarizeBudgetUse`
     walks `agent_invoked.role` and tallies. `assertWithinBudget` adds
     per-role checks (per-phase tokens → per-role tokens → global
     tokens; per-phase calls → per-role calls → global calls); rule
     string includes role name and actionable suggestion names the
     `byRole.<role>` config key. `detectBudgetSoftWarnings` extended
     with `(metric, role ?? "global")` duplicate guard.
   - Tests: per-role enforcement (cap-exceeded path); per-role soft
     warning at 75%; no-regression on existing global / per-phase
     paths; project-local personas bypass per-role check.

5. **`feat(providers): estimateCostUSD helper + capabilities cleanup`**
   - `src/providers/cost.ts`: new helper
     `estimateCostUSD(prepared, ctx) → number | undefined` that
     resolves cost from `priceTable` (registry-aware), falls back to
     `ctx.registry.capabilityOf(provider).costPerMTok`, returns
     undefined when neither is set. Helper is pure; signature accepts
     overrides for tests.
   - `src/providers/capabilities.ts`: documentation pass — capability
     shape is provider-level (`authSource`, `eligiblePhases`); model
     pricing lives in `priceTable`. Confirm xAI / Codex / Gemini /
     Fake have no `costPerMTok`. Claude row stays without
     `costPerMTok` (was never populated).
   - `src/config/schema.ts` `DEFAULT_CONFIG.budgets.global.priceTable`:
     populate Claude model entries (`claude:claude-opus-4-7` =
     `{ inputPerMTok: 5, outputPerMTok: 25 }`,
     `claude:claude-sonnet-4-6` = `{ inputPerMTok: 3, outputPerMTok: 15 }`,
     `claude:claude-haiku-4-5-20251001` = `{ inputPerMTok: 1, outputPerMTok: 5 }`).
     Each entry carries a dated source comment
     (`// per platform.claude.com pricing, 2026-05-01`).
   - Tests: `estimateCostUSD` cascade (priceTable hit, capabilityOf
     fallback, both unset → undefined); registry override honored
     in fallback path.

6. **`feat(providers): wire costEstimateUSD + costActualUSD into invoke`**
   - `src/providers/invoke.ts`: pre-call short lock writes
     `costEstimateUSD` (when helper returns a value) onto
     `agent_invoked`; post-call short lock writes `costActualUSD`
     (when `tokensUsed` reported AND helper returns a value) onto
     `agent_completed`. Soft-warning emit also includes `role` when
     present.
   - Tests: estimate-USD recorded on invoke; actual-USD recorded on
     complete when both signals present; missing-cost-data path emits
     no USD fields (token-only enforcement still works); per-role
     soft-warning event carries role.

7. **`docs(m13): cross-reference byRole + version bump`**
   - `docs/contracts/COMPANY.md`: cross-reference `budgets.global.byRole`
     as the per-role budget location; M13 surface confirmed; no
     role-table schema change.
   - `docs/references/budgets.md` (or extension of existing): new
     "Per-role budgets" section with cascade diagram (per-call →
     per-phase → per-role → global) and worked example. Document
     `costActualUSD` semantics (output-tokens-only, not full invoice).
   - `package.json` + `DEFAULT_CONFIG.version`: bump
     `0.13.0-alpha.0` → `0.14.0-alpha.0`.
   - Tag annotation prepared for `v0.14.0-alpha.0` (push pending
     Ozzy's explicit approval).

## What stays deferred (named, not bundled)

- **Dollar hard caps / `maxCostUSD`**: deferred until M14+ with
  measurable demand evidence (rule 21).
- **`byRole.maxTurns`**: deferred until role-turn event semantics
  exist. Today's `maxTurns` counts `phase_entered`; no role
  identity.
- **xAI / Codex / Gemini / Fake price defaults**: deferred per M11
  rotting-data discipline.
- **Retry/backoff, `Retry-After` parsing, new permission scopes,
  company-roster schema changes, parallel-provider surfaces**:
  Anti-scope-creep boundaries hold.
- **Full billing modeling** (prompt caching, server-side tools, data
  residency, batch discounts, gateway markup): post-v0.1.

## Risk-mitigation steps before implementation

- The Codex sandbox could not run `bun test` (mkdtemp EPERM, sandbox
  limitation). Typecheck is clean. Before commit 1 lands, I will
  verify the full 1983-test baseline outside any sandbox.
- The `agent.name → role` canonicalizer behavior in commit 3 needs a
  per-test fixture confirming bundled-role personas pass and
  non-canonical names omit `role`. Will add explicit fixture coverage.
- The `costActualUSD` "output-tokens-only" semantics are surprising;
  the doc commit (commit 7) must spell out the limitation
  prominently — operators reading the field as full invoice would
  understate spend.

## Test deltas expected

- Baseline: 1983 pass / 1 skip / 0 fail.
- Per Codex's commit ordering, each commit lands its own behavior
  + tests. Estimate: 60-100 new tests across the 7 commits. Final
  target: ~2050-2080 pass.
- No regression on the existing 1983 baseline is the rule.

## Awaiting Ozzy approval

Per CLAUDE.md rule 7 + SESSION_CYCLE.md phase 2.6, no code lands
until Ozzy approves this synthesis and the locked 7-commit order. M13
push grant has NOT been issued; PE-1's grant was scope-limited per
memory `pe1_autonomy_grant.md`. Default no-push policy applies.

If you (Ozzy) want to redirect any of the open-question resolutions
(particularly Q4-bis's "no provider-level Claude defaults" or Q9's
"explicit `ProviderRequest.role`"), say so before approving and I'll
re-synthesize. If Codex's synthesis is good as-is, say "approved" and
I'll start commit 1.
