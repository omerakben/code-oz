# M13 — Role-cost policy under `budgets.global` — session kickoff

**Date written:** 2026-05-01 (end of PE-1 session, before close)
**Branch on next session start:** `main` (or fresh `feat/m13-role-cost-policy`)

## State at start

- **HEAD:** `7dc637b Merge feat/pe1-xai-http-adapter: PE-1 xAI direct HTTP adapter (v0.13.0-alpha.0)` on `main`
- **Tag:** `v0.13.0-alpha.0` is the latest alpha; pushed to `origin/main` and to a `gh release` with full notes
- **Tests:** 1983 pass / 1 skip / 0 fail offline; `bun run typecheck` clean
- **Origin:** `main` and tag pushed cleanly 2026-05-01 under Ozzy's explicit PE-1-scoped push grant (memory `pe1_autonomy_grant.md`)
- **Working tree:** clean

## Boot prerequisite — demand checkpoint (do this BEFORE M13 planning round)

Per `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md` § "Demand-checkpoint discipline" + `docs/research/CODEX_RESPONSE_PE1.md` Q7 lock, PE-1 ships first; **before** committing to M13 vs. PE-2, Ozzy surveys friends on which xAI route they actually use:

> Which route are you actually using to access xAI?
> - xAI API key directly (already shipped as PE-1)
> - OpenRouter
> - LiteLLM / Portkey gateway
> - Azure AI Foundry
> - AWS Bedrock
> - Google Vertex AI

The result determines:

- **If only xAI direct API key →** PE-track parks at PE-1; **proceed with M13 (this kickoff)**.
- **If routed retail (OpenRouter) →** insert PE-2 instead, write `SESSION_PE2_KICKOFF.md`, defer this M13 kickoff.
- **If gateway (LiteLLM) →** insert PE-3 instead (Codex flagged it as the least-proven v0.1 item; weigh carefully).
- **If cloud (Azure / Bedrock / Vertex) →** defer to v0.2 milestones; **proceed with M13**.

Document the result at `docs/research/XAI_DEMAND_CHECKPOINT_<YYYY-MM-DD>.md`. No keys / account names / screenshots in the file. Light-weight discipline; the doc is a few paragraphs.

If Ozzy is comfortable with M13 as the next step without a survey (the default per the locked sequence), skip the checkpoint and proceed.

## What M13 is

**Authority boundary (CLAUDE.md rule 20):** per-role budget gating + preflight cost estimates. M11's advisory `costPerMTok` and `rateLimits` fields populate here under the existing `budgets.global` namespace (rule 19). Must precede any simultaneous-provider surface (M14 reviewer panel) so the cost story is solid before parallelism lands.

**Scope per `docs/design/ROADMAP.md` § "Post-M10 productization":**

- Per-role cost gating: `budgets.global.byRole.<role>` overrides for `maxTokensEstimate` / `maxProviderCalls` etc., layered on top of the existing global caps
- Preflight estimate refinement: M11's advisory `costPerMTok` data populates the conservative token estimator (`src/providers/cost.ts`) so dollar-aware refusals are possible
- New `agent_invoked` event metric: `costEstimateUSD` (advisory, refined per-call) — does NOT replace `tokensEstimate`
- New `agent_completed` event metric: `costActualUSD` (when `tokensUsed` is reported) — does NOT replace `tokensUsed`
- `NEEDS_INTERVENTION.json` budget-exceeded path gains a per-role suggestion: "raise `budgets.global.byRole.<role>.maxTokensEstimate` in .code-oz/config.yaml"
- `code-oz doctor providers` does NOT change. Cost telemetry is per-run; doctor is per-process.

## What M13 is NOT (locked anti-scope-creep)

- **No** parallel-provider surface (that's M14 reviewer panel)
- **No** retry/backoff policy on `provider_rate_limit` (separate concern; can land later)
- **No** `Retry-After` header parsing (deferred per Codex Q "What to defer" in PE-1 review)
- **No** new permission scope or new authority surface (only role-cost data flow)
- **No** company-roster schema change (M12's `{ provider?, model? }` shape stays; budget overrides go in `budgets.global.byRole`, not in `company.<role>.budgets`)
- **No** PE-2 / PE-3 / cloud-route work (demand-gated)
- **No** Researcher phase-tail, parallel builder candidates, multi-opponent debate (M16+)

## Open questions M13's planning round must answer

The Codex briefing should propose leans on each, with reasoning + counter-argument:

1. **Where does `byRole` live in config?** Lean: `budgets.global.byRole.<role>` (a parallel namespace under the existing `budgets.global`). Counter: `company.<role>.budgets` (closer to role definition). Counter-counter: `company:` block is already shaped for routing only (M12 lock); adding budgets would reopen the role-table contract.

2. **What metric is authoritative?** Lean: `tokensEstimate` stays the primary throttle; `costEstimateUSD` is advisory telemetry only. Counter: USD is what users actually budget; tokens are the proxy. Counter-counter: token data is verified; dollar data rots fast (Codex M11 lock on per-provider cost-omission).

3. **What's the failure mode when `costPerMTok` is unset for a provider/model?** Lean: estimator returns undefined; budget check ignores the dollar dimension and falls back to token-only enforcement. Counter: refuse the call until the user sets a cost. Counter-counter: refusal would block working configurations because v0.1 defaults explicitly omit cost data (M11).

4. **Should M13 populate `costPerMTok` for the four bundled providers?** Lean: only for providers with stable public pricing; xai's per-Grok-variant pricing rotates fast. Counter: pin a snapshot with a dated-source comment. Counter-counter: M11's no-rotting-data discipline already chose omission.

5. **Per-call vs per-phase vs per-role gating?** Lean: per-call is the wrapper's job (already exists); per-phase exists today; per-role is M13's new surface. No new per-something layer beyond role.

6. **Event log shape:** new fields on `agent_invoked` / `agent_completed`, or new dedicated event types (`cost_estimated`, `cost_recorded`)? Lean: extend existing events; new event types proliferate the schema and miss the existing per-call lock pattern. Counter: separate events make cost telemetry independently consumable.

7. **`NEEDS_INTERVENTION` shape:** new error code (`provider_role_budget_exceeded`) or reuse existing `provider_budget_exceeded`? Lean: reuse existing; rule string disambiguates the dimension. Counter: typed-error granularity helps machine triage.

8. **Soft warnings:** does M13 fire `budget_warning` events at e.g. 75% of role caps? Lean: yes, mirror the existing `softWarnAtRatio` pattern under `budgets.global`. Counter: rule-19 says cumulative caps live under `budgets.global`; per-role events would re-fragment the namespace.

## Implementation plan sketch (~5-7 commits, locked at planning round)

Tentative order — Codex round will pin:

1. `src/config/schema.ts` + `src/config/load.ts` add `budgets.global.byRole` shape + validation
2. `src/providers/cost.ts` consumes `byRole` overrides + populates `costEstimateUSD`
3. Wrapper layer (`src/providers/invoke.ts`) gains the per-role budget check (parallel to existing global / per-phase checks)
4. Event schema extensions: `agent_invoked.costEstimateUSD?` + `agent_completed.costActualUSD?` (both optional; backward-compat)
5. Tests: per-role enforcement, USD cost surface, fallback when cost data absent
6. Docs: `docs/contracts/COMPANY.md` cross-references the new `byRole` location; `docs/references/budgets.md` (or equivalent) gains the per-role section
7. Closure: version bump to `v0.14.0-alpha.0`

## Cross-model peer review (durable rule)

CLAUDE.md rules 7+8 stand. Both Codex rounds (planning + implementation review) run. Verdict is data, not authority — Codex finds things Claude misses (PE-1 examples: canonical doc drift in pinned spec, the redaction-pattern gap that env-clearing papered over).

## What earns Ozzy's intervention

Stop and ask only for:

- Destructive git operations
- Push / tag / release / PR (M13's push grant has not been issued; the PE-1 grant was scope-limited per memory entry `pe1_autonomy_grant.md`)
- Production dependency additions
- Scope conflict with CLAUDE.md
- A Codex `debate-required` verdict
- Schema decisions that affect the M12 `company:` block surface

## Loose threads from PE-1 (carry into M13 if they surface)

- **Demand checkpoint** is the boot prerequisite above. Without survey signal, M13 commits per default sequence; with signal flipping to PE-2, defer M13.
- **`/v1/responses` migration** (xAI deprecation hint) — separate planning round when needed; not M13 scope.
- **Streaming + cancellation contract** — separate work; not M13 scope.
- **`tool_use.upstream_native_tools` permission scope** — defer until measurable demand.
- **Single-source the five provider-list enumerations** — F8 in `REFACTOR_AUDIT_2026-05-01.md`; the new drift regression test (`tests/provider-enum-drift.test.ts`) is the offline guard until refactor lands.
- **Race-on-non-atomic-config-write** — flagged by Codex in the inter-milestone refactor session; writer-side atomic-save discipline; not M13 scope unless config schema changes here re-trigger it.

## First commands to run

```bash
cd /Users/ozzy-mac/Projects/code-oz
git status --short --branch
git log --oneline --decorate -5
git tag --list 'v0.*' --sort=-v:refname | head -5
bun test 2>&1 | tail -5
bun run typecheck 2>&1 | tail -3
```

If state matches "1983 pass, typecheck clean, HEAD at `7dc637b`, tag `v0.13.0-alpha.0`," boot M13 per the cycle:

```
Read CLAUDE.md and docs/design/SESSION_CYCLE.md, then docs/design/SESSION_M13_KICKOFF.md
in full. Boot M13 per the cycle: prerequisites → demand checkpoint conversation
(or skip if Ozzy chooses default sequence) → CODEX_BRIEFING_M13.md → invoke Codex
(gpt-5.5 / xhigh / read-only / never / cwd=/Users/ozzy-mac/Projects/code-oz) →
CODEX_RESPONSE_M13.md with synthesis → present to me for approval. Do not start
coding until I approve the synthesis.
```

## Cycle pointer

Per `docs/design/SESSION_CYCLE.md`. M13 follows the **full discipline** (one new authority boundary milestone). No lite-cycle compromise.
