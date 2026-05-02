# Codex planning briefing — M13 (Role-cost policy under `budgets.global`)

**Date:** 2026-05-01. **Branch:** `main`. **HEAD:** `0487200` (M13 kickoff
doc commit, one past the PE-1 merge `7dc637b` tagged `v0.13.0-alpha.0`).

This briefing follows the empirical session cycle
(`docs/design/SESSION_CYCLE.md`) and the locked CLAUDE.md rules 1-21.
M13 is a **full-discipline** milestone; the lite-cycle compromise from
M5/M6 does NOT apply — per CLAUDE.md rule 20, M13 introduces exactly one
new authority boundary (per-role budget gating + preflight cost
estimates) and earns its own planning + implementation review rounds.

## Live state at briefing time (verified)

- HEAD: `0487200 docs(m13): kickoff for the next milestone (Role-cost policy)`
- Latest tag: `v0.13.0-alpha.0` at `7dc637b` (PE-1 merge)
- Working tree clean; `main` in sync with `origin/main`
- Tests: 1983 pass / 1 skip / 0 fail offline; `bun run typecheck` clean
- `XAI_API_KEY` present (PE-1 dependency; M13 does not exercise outbound HTTP)

## PE-1 closure status (regression context)

PE-1 closed `2026-05-01` at `v0.13.0-alpha.0`. Two Codex review rounds;
both blockers closed (canonical doc drift, redaction-pattern gap). M11
strict-minimal preserved — no `transport` field added on
`ProviderCapability`. New `xai-api-key` `authSource`, new
`provider_model_missing` error code, `sanitizeFetchError` redaction,
`fetchRunner` test seam. Live xAI verified opt-in. Demand checkpoint
result (`docs/research/XAI_DEMAND_CHECKPOINT_2026-05-01.md`): xAI direct
only — M13 is the locked next milestone.

## M13 scope (locked from `SESSION_M13_KICKOFF.md`)

**Authority boundary:** per-role budget gating + preflight cost
estimates. M11's advisory `costPerMTok` and `rateLimits` fields populate
under existing `budgets.global` (rule 19).

In scope:

- Per-role cost gating: `budgets.global.byRole.<role>` overrides for
  `maxTokensEstimate` / `maxProviderCalls` (and possibly `maxTurns` —
  Codex to confirm), layered on top of existing global caps.
- Preflight estimate refinement: `costEstimateUSD` populated on
  `agent_invoked` (advisory; refined per-call). Does NOT replace
  `tokensEstimate` as the authoritative throttle.
- `costActualUSD` populated on `agent_completed` when `tokensUsed` is
  reported (advisory; mirrors `tokensUsed` shape).
- `NEEDS_INTERVENTION.json` budget-exceeded path gains a per-role
  suggestion: "raise `budgets.global.byRole.<role>.maxTokensEstimate`
  in .code-oz/config.yaml".
- Soft warnings: per-role `budget_warning` events at
  `softWarnAtRatio` (lean: extend existing `budget_warning` event with
  optional `role` discriminator; debate Q8).

Tag candidate: `v0.14.0-alpha.0`.

## Anti-scope-creep boundaries (locked)

Per CLAUDE.md rule 20, M13 introduces *one* new authority. Out of scope:

- **No** parallel-provider surface (M14 reviewer panel).
- **No** retry/backoff policy on `provider_rate_limit` (separate concern).
- **No** `Retry-After` header parsing (deferred per PE-1 review).
- **No** new permission scope or new authority surface beyond role-cost.
- **No** company-roster schema change. M12's `{ provider?, model? }` shape
  stays; per-role budgets go in `budgets.global.byRole`, NOT in
  `company.<role>.budgets`. Reopening the M12 role-table contract is
  rejected (the COMPANY.md fail-closed rule on `company.<role>.budgets`
  is load-bearing for this boundary).
- **No** PE-2 / PE-3 / cloud-route work (demand-gated; survey result
  pinned 2026-05-01).
- **No** Researcher phase-tail, parallel builder candidates,
  multi-opponent debate (M16+, gated on measurable need per rule 21).

If any of these surface mid-implementation, push to a deferred bucket;
do not bundle.

## Pinned answers (no debate; cite the contract that pins them)

These three of the kickoff's eight open questions are pinned by existing
contracts. Codex should confirm rather than re-debate. Per the
`feedback_contract_first_reading.md` memory: pinned answers go in this
locked list, not the decision list.

- **Q1 — Where does `byRole` live in config?**
  **Pinned: `budgets.global.byRole.<role>`** (parallel namespace under
  the existing `budgets.global`). Authority: COMPANY.md line 178
  forward-compat row — *"per-role spend caps under `budgets.global`.
  Reads role identity from `M12_COMPANY_ROLES`; the `company:` row
  supplies the `(provider, model)` pair the price table keys against.
  No M12 schema change."* Plus rule 19 lock that cumulative caps live
  under `budgets.global` (single namespace).

- **Q3 — Failure mode when `costPerMTok` is unset for a (provider,
  model)?**
  **Pinned: token-only fallback.** Authority: M11 contract line 416 in
  `provider-contract.md` — *"When verified data is unavailable, the
  field is omitted; this contract does not pretend to know current
  vendor pricing without a source."* Plus the kickoff's counter-counter:
  refusal would block working v0.1 configurations because M11 default
  capabilities deliberately omit cost data. `assertWithinBudget` falls
  back to existing token enforcement; `costEstimateUSD` is absent on
  `agent_invoked` for that call.

- **Q5 — Per-call vs per-phase vs per-role gating granularity?**
  **Pinned: per-call (existing wrapper) + per-phase (existing
  `budgets.perPhase`) + per-role (M13's new surface).** No new
  per-something layer beyond role. Authority: M13 scope from kickoff.

## Open questions Codex must pressure-test (lean + reasoning + counter)

### Q2 — What metric is authoritative: `tokensEstimate` vs `costEstimateUSD`?

**Lean:** `tokensEstimate` stays the primary throttle; `costEstimateUSD`
is advisory telemetry only in M13. M14+ may flip the authoritative
metric on demand.

**Reasoning:** Token data is verified per-call from the conservative
estimator (`src/providers/cost.ts` `estimateTokens` — 4 chars/token
upper bound). Dollar data depends on `priceTable` or `costPerMTok` which
both rot fast (M11 lock); enforcing on dollars at v0.1 means a stale
price table can refuse working calls or fail to refuse expensive ones.

**Counter:** USD is what users actually budget (operators reason in
dollars, not tokens). Tokens are a proxy for the real concern.

**Counter-counter:** Token data is verified; dollar data rots fast
(M11 no-rotting-data discipline). Layering enforcement on rotting data
would land enforcement and authority-creep simultaneously — a rule-20
violation. M13 ships the surface; M14+ flips the authority when
measurable demand surfaces.

### Q4 — Which authority feeds `costEstimateUSD`: `priceTable` or `capabilityOf(provider).costPerMTok`?

**Briefing-expanded.** `priceTable` already exists from M6
(`src/config/schema.ts:77`, telemetry-only, keyed `<provider>:<model>`).
M11's `costPerMTok` is per-provider (no model dimension). Not
equivalent — M13 must resolve which feeds `costEstimateUSD`.

**Lean:** `priceTable` takes precedence (per-model, operator-specific);
fall back to `capabilityOf(provider).costPerMTok` when the table is
unset for the resolved `(provider, model)` pair. M12 company-config
cascade pattern.

**Counter:** Two authorities mean consumer code consults both in order;
one might silently become the dead-letter. Pick one.

**Counter-counter:** They answer different questions — `priceTable`
= "what does the operator's vendor charge?"; `capabilityOf` = "what
does the public catalog say?". Operator answer wins when present.

### Q4-bis — Populate `costPerMTok` defaults?

**Lean:** Claude only (Opus 4.7 = $5/$25, Sonnet 4.6 = $3/$15, Haiku
4.5 = $1/$5) per CLAUDE.md model reference table, dated 2026-04-30
source comment. Skip xAI (Grok pricing rotates), Codex (subscription
not API), Gemini (stub), Fake (test).

**Counter:** Pin xAI public Grok prices with a 2026-05-01 snapshot.

**Counter-counter:** Grok pricing rotates faster than Claude's; M11
omission discipline says omit when unverifiable.

### Q6 — Event log shape: extend existing events vs new event types?

**Lean:** extend `agent_invoked` with optional `costEstimateUSD?` and
`agent_completed` with optional `costActualUSD?`. Mirror M12
`agent_invoked.model` pattern — optional field, defensive validator,
no schema-version bump (rule 12 open-type-union).

**Counter:** Separate events (`cost_estimated`, `cost_recorded`) make
telemetry independently consumable by downstream tools.

**Counter-counter:** Filter `agent_invoked` on
`costEstimateUSD !== undefined` for the same effect. Don't design for
hypothetical future tools.

### Q7 — `NEEDS_INTERVENTION` shape: new error code or reuse `provider_budget_exceeded`?

**Lean:** reuse `provider_budget_exceeded`. Rule string disambiguates
the dimension (mirrors per-phase vs global rule strings at
`src/providers/cost.ts:177-208`).

**Counter:** Typed-error granularity helps machine triage.

**Counter-counter:** No downstream consumer earns the typed-code
authority yet; defer to the milestone that introduces the consumer.

### Q8 — Soft warnings: per-role `budget_warning` events at `softWarnAtRatio`?

**Lean:** yes. Extend existing `budget_warning` event with optional
`role?` discriminator. Existing "max one warning per metric per run"
guard becomes "max one per `(metric, role)` per run". When `role`
absent, the warning is for the global cap (back-compat).

**Reasoning:** `detectBudgetSoftWarnings`
(`src/providers/cost.ts:259-294`) already emits per-metric warnings;
adding the role dimension is a single-field extension to the existing
event shape. Consumers that ignore unknown fields keep working
(rule 12 open-type-union).

**Counter:** Rule 19 says cumulative caps live under `budgets.global`;
per-role events would re-fragment the namespace.

**Counter-counter:** `byRole` *is* under `budgets.global` (Q1 lock).
Per-role warnings are warnings on a per-role *cap under*
`budgets.global`, not a separate namespace. The naming is consistent.

### Q9 — Role-identity binding (briefing-added; kickoff did not name)

**Risk the kickoff omits.** `assertWithinBudget` sees `req.phase` and
`req.agent.name`, not `CompanyRole`. Three binding options:

- (a) **Sniff from `agent.name`** — bundled personas are named exactly
  after roles (`ba.md`, …, `scientist.md`). Project-local personas
  outside `M12_COMPANY_ROLES` silently bypass per-role gating
  (global + per-phase still enforce).
- (b) **Add `role: CompanyRole` to `AgentDefinition` schema.** Strong
  invariant; touches every persona file; M16+ custom-role work would
  refactor.
- (c) **Pass `role?: CompanyRole` through `ProviderRequest`.** Explicit
  per-call; every phase invocation site threads the value.

**Lean:** (a) sniff from `agent.name`, run through the same
canonicalizer M12 uses in `mergeCompany`. Project-local personas are
already an M12 deferral; their global+per-phase enforcement is
sufficient.

**Counter:** Sniffing is convention-based, not contract-based. A typo
silently bypasses per-role gating — the failure mode M12 fail-closed
rule was designed to prevent.

**Counter-counter:** The canonicalizer fails closed on non-canonical
names; sniffing-via-canonicalizer keeps the M12 invariant.

### Q10 — `byRole` validation: reject keys outside `M12_COMPANY_ROLES`?

**Lean:** yes; `mergeByRole` rejects with `loader_company_role_unknown`
(reuse M12 error code). Symmetric with `mergeCompany` fail-closed.

**Counter:** `byRole` is a budgets surface, not a roster surface;
reusing the M12 error code overloads its meaning.

**Counter-counter:** The code names the *role*, not the *roster*. M12
already uses it defensively in `applyCompanyOverrides`.

## Proposed implementation order (~7 commits)

Tentative — Codex's planning round pins:

1. **`src/config/schema.ts` + `src/config/load.ts`**: add
   `budgets.global.byRole?: Readonly<Partial<Record<CompanyRole, ByRoleBudget>>>`
   shape + validation. `ByRoleBudget` lean shape:
   `{ maxTurns?, maxProviderCalls?, maxTokensEstimate? }` (all optional;
   absent = inherit from `budgets.global`). `mergeByRole` rejects
   non-canonical role keys (Q10).
2. **`src/providers/cost.ts`**: extend `BudgetCounts` with per-role
   counters; `summarizeBudgetUse` walks `agent_invoked.role` (Q9
   binding) and tallies per-role tokens / turns / calls;
   `assertWithinBudget` adds per-role checks layered between per-phase
   and global (or wherever Codex pins). New helper
   `estimateCostUSD(prepared, priceTable, capabilityOf)` resolves
   `costEstimateUSD` per Q4 cascade.
3. **`src/state/schemas.ts` + `src/state/events.ts`**: extend
   `agent_invoked` with optional `costEstimateUSD?: number` and `role?:
   CompanyRole`; extend `agent_completed` with optional
   `costActualUSD?: number`; extend `budget_warning` with optional
   `role?: CompanyRole`. Defensive validators mirror the M12
   `agent_invoked.model` pattern.
4. **`src/providers/invoke.ts`**: thread role identity into
   `agent_invoked` event; populate `costEstimateUSD` from new helper;
   populate `costActualUSD` on `agent_completed` when `tokensUsed`
   reported. Per-role check fits inside the existing pre-call short
   lock.
5. **`src/providers/capabilities.ts`**: populate `costPerMTok` for
   Claude only (Opus 4.7 / Sonnet 4.6 / Haiku 4.5; dated 2026-04-30
   source comment). xAI / Codex / Gemini / Fake stay omitted.
6. **Tests**: per-role enforcement (cap-exceeded path); USD cost
   surface (estimate + actual); fallback when cost data absent (Q3);
   role-identity binding (Q9 — bundled persona vs project-local
   bypass); `byRole` validation (Q10 — non-canonical key rejection);
   regression on existing `budgets.global` consumers (1983 tests must
   still pass).
7. **Docs + closure**: `docs/contracts/COMPANY.md` cross-references
   the new `byRole` location (no role-table change); new
   `docs/references/budgets.md` (or extension of existing) gains the
   per-role section + cascade diagram. Version bump
   `v0.13.0-alpha.0` → `v0.14.0-alpha.0` in `package.json` +
   `DEFAULT_CONFIG.version` + tag annotation.

## Risks Codex must pressure-test

- **Backward-compat on existing `budgets.global` consumers**: 1983
  tests + production config. `byRole` is optional; default-on-absence
  resolves to existing behavior.
- **M12 invariants under per-role overrides**: cross-family REVIEW,
  capability eligibility, debate-opposing-family. M13 adds a
  per-role *budget* layer; the M12 *routing* layer is untouched. But
  the role-identity binding (Q9) must respect M12's resolved-provider
  lookup — if a project routes `builder` to `codex`, the per-role
  budget is for `builder` regardless of which provider ran it.
- **Event-schema migration discipline**: optional fields, no version
  bump (rule 12 open-type-union; M12 `agent_invoked.model` precedent).
  But adding multiple optional fields at once needs the validators
  rigorously updated.
- **Dollar-data rotting risk** for any populated `costPerMTok`. The
  M11 omission discipline carries every populated value with a dated
  source comment; M13 must not weaken this. Codex should confirm the
  Claude-only population scope (Q4-bis) is correct and dated.
- **Order of checks in `assertWithinBudget`**: existing order is
  per-phase tokens → global tokens → per-phase turns → global turns
  → per-phase calls → global calls → wall-time. Where does per-role
  slot in? Lean: between per-phase and global for each metric.
- **Concurrency**: the wrapper's pre-call short lock already serializes
  `assertWithinBudget` + `appendEvent('agent_invoked')`. Per-role
  counters are computed from event log inside the same lock; no race.
  Codex should confirm.
- **USD math precision**: floats vs cents. Lean: store `costEstimateUSD`
  / `costActualUSD` as numbers with two decimals; never use float
  comparison for budget enforcement (Q2 keeps tokens authoritative).
- **The role-identity binding decision (Q9)** is the highest-risk
  call. Codex should pressure-test all three options.

## Concrete questions Codex must answer

1. Confirm Q1 lean (`budgets.global.byRole.<role>`) is consistent with
   M12 forward-compat and rule 19. Does the location name need to be
   `byRole`, or is there a better identifier (`perRole`, `roles`)?
2. Q2 + Q4: is `costEstimateUSD` advisory in M13 (lean), or should it
   gate at v0.1 when populated? If gating, what's the math?
3. Q4 cascade: `priceTable` first, fall back to
   `capabilityOf(provider).costPerMTok`? Or single-authority?
4. Q4-bis: confirm Claude-only population for `costPerMTok` defaults.
   Should xAI's Grok prices be pinned with a dated snapshot, or
   omitted per M11 omission discipline?
5. Q6: extend `agent_invoked` / `agent_completed` (lean) or new event
   types (`cost_estimated`, `cost_recorded`)?
6. Q7: reuse `provider_budget_exceeded` (lean) or add typed code
   `provider_role_budget_exceeded`?
7. Q8: extend `budget_warning` with `role?` discriminator (lean) or
   emit `role_budget_warning`?
8. Q9 role-identity binding: sniff from `agent.name` (lean), require
   `agent.role` schema field, or pass through `ProviderRequest`?
   What's the project-local-persona fallback?
9. Q10: reject non-canonical `byRole` keys at config-load
   (lean: yes, reuse `loader_company_role_unknown`)?
10. Order of checks in `assertWithinBudget`: where does per-role slot
    in?
11. Implementation-order changes: are the 7 commits correctly
    ordered? Should commit 1 (`byRole` schema) precede commit 2
    (`cost.ts` consumers), or is there a better order?
12. Bugs / stale assumptions Claude missed (cite file:line)?

## Response shape (locked, same as PE-1)

```markdown
# Codex planning review — M13

## Verdict
accept | accept-with-modifications | reject | debate-required

## Blockers before code

## Scope corrections

## Open-question resolutions
- Q2 (tokens vs USD): Resolution + Reasoning
- Q4 (priceTable vs capabilityOf): Resolution + Reasoning
- Q4-bis (default population): Resolution + Reasoning
- Q6 (event shape): Resolution + Reasoning
- Q7 (error code): Resolution + Reasoning
- Q8 (soft warnings): Resolution + Reasoning
- Q9 (role-identity binding): Resolution + Reasoning
- Q10 (byRole validation): Resolution + Reasoning

## Risks the proposing side missed

## Bugs or stale assumptions Claude missed (cite file:line)

## Implementation order changes

## What to defer

## Final recommendation
```

## Cycle pointer

Per `docs/design/SESSION_CYCLE.md`. Next steps after Codex response:
synthesize, present to Ozzy for approval, do not start coding until
Ozzy approves the synthesis and the locked commit order. M13 push
grant has NOT been issued (PE-1's grant was scope-limited per memory
`pe1_autonomy_grant.md`). Default no-push policy applies.
