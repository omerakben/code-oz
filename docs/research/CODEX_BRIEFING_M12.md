# M12 — Company roster (shipped roles only)

**Date:** 2026-05-01
**Status:** implementation
**Caller:** Claude (Opus 4.7, 1M context)
**Target:** gpt-5.5 xhigh, sandbox: read-only
**Cycle:** plan (planning convergence per CLAUDE.md rule 7)

## What you are reading

This is the planning-convergence briefing for milestone M12 — Company roster (shipped roles only). M11 (Provider capability contract) closed cleanly two days ago (`v0.11.0-alpha.0`, 1860 offline tests, 4 implementation commits + 2 review-closure commits + merge to main). M12 is the next milestone in the locked post-M10 sequence (`docs/design/ROADMAP.md` § "Beyond v0.1" § "Post-M10 productization", revised 2026-05-01 to insert PE-1 between M12 and M13).

M12's product significance is bigger than its code surface. Per `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` and the 2026-04-30 Codex thesis pressure-test (`docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`, thread `019de031`), `code-oz`'s product metaphor is "AI software company." M12 is where that metaphor lands in code: the `.code-oz/config.yaml` `company:` block + a new `docs/contracts/COMPANY.md`. Without M12, `code-oz` is "another agentic runtime"; with M12, the user can declare "Claude Opus is the BA, GPT-5.5 is the Reviewer, and so on" the same way a hiring manager fills seats on a real team.

The authority boundary (CLAUDE.md rule 20) is **role-to-provider routing**. M11 just closed provider eligibility; M12 closes role-to-provider routing. That is the *only* new authority M12 ships.

I want you to pressure-test eight decisions A-H. Three of them are scope-cuts I am leaning toward (drop fields from the ROADMAP M12 row's wording per the M11 empirical-reality discipline); three are implementation surfaces; two are vocabulary / surface-area locks that downstream milestones (M13/M14/M15) will inherit.

## What you should already have read

Brief reads, in order. Anything labeled "skim" you can confirm by section header without deep reading.

1. `docs/design/ROADMAP.md` § "Beyond v0.1 (post-MVP queue, ordered)" § "Post-M10 productization" — the M11→M12→PE-1→M13→M14→M15 sequence, revised 2026-05-01.
2. `docs/contracts/PROVIDERS.md` § "Capabilities and eligibility (M11)" — the v0.1 default eligibility table (claude/codex eligible for all phases; gemini empty list; fake all phases).
3. `docs/references/provider-contract.md` § "Capability and eligibility (M11)" — full TypeScript shape; especially § "Forward-compat" line 372 ("M12 introduces a config-side `company:` block mapping role → provider+model+budgets+permissions. M12's load-time check reuses `capabilityOf(provider).eligiblePhases.includes(phase)` against the role's chosen phase. No M11 hook required; M12 builds on the existing surface.") and § "Anti-patterns rejected by this M11 spec" lines 382–386 (don't store reverse `phase → ProviderId[]` map; "role" vocabulary is M12's, not M11's).
4. `docs/contracts/DEBATE.md` — debate-opponent runtime (M10) routes through `tool_use.debate.opposingProviders` declared per persona; M11 walks that list in `enforceProviderPhaseEligibility`. Skim only: the question "does M12 override debate-opponent providers" is decision E.
5. `src/agents/loader.ts` (290 lines) — current load order: `validateOne` (per source file) → `enforceCrossFamilyReview(definitions)` → `enforceProviderPhaseEligibility(definitions)` → `makeRegistry`. M12 needs to insert override application before `enforceCrossFamilyReview`.
6. `src/config/schema.ts` (~165 lines) — current `CodeOzConfig` shape: `version | profile | defaultProvider | models.{primary, reviewer} | budgets.{global, perPhase} | permissions.{allowEscapeHatch, requireApprovalForBuild} | phases.{define.askMe, scientist}`. No `company:` block today.
7. `src/config/load.ts` — hand-rolled validation pattern (no zod). Issues array with `{ file, code, rule, detail? }`; merge defaults under override; M12's `mergeCompany` mirrors `mergeBudgets`/`mergePermissions`.
8. `src/agents/defaults/{ba,lead,builder,verifier,reviewer,scientist}.md` — six bundled personas (skim the frontmatter only): five declare `provider: claude` (ba/lead/builder/verifier/scientist), one declares `provider: codex` (reviewer). All declare a phase; reviewer is the cross-family seam (rule 2).
9. `docs/research/CODEX_BRIEFING_M11.md` and `docs/research/CODEX_RESPONSE_M11.md` (thread `019de44e`) — M11's empirical "Decision C" lesson: when v0.1 reality contradicts the ROADMAP row's lean, follow reality. M11's row originally named 8 capability traits; we shipped 4. Same pattern applies to M12.

## Where we stand

- **Branch:** `feat/m12-company-roster` (just cut from main).
- **Local main:** 9 commits ahead of `origin/main` and not yet pushed. M11's 4 implementation commits + 2 review-closure commits + merge + status bump + this session's roadmap-recordkeeping commit (`3078ac6`, lands the xAI expansion docs + adopts serial-with-insertion ordering). User's choice on push timing per CLAUDE.md rule 5.
- **Tests:** 1860 pass / 1 skip / 0 fail offline as of `v0.11.0-alpha.0`. M11 did not introduce flakiness.
- **Personas:** six bundled defaults at `src/agents/defaults/{ba,lead,builder,verifier,reviewer,scientist}.md`. Each declares `name`, `phase`, `provider`, `modelPolicy`, `permissions`, `description`, body. The persona `name` is the unique identifier — `name` is regex-validated `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
- **Loader:** runs `validateOne` per source → `enforceCrossFamilyReview` → `enforceProviderPhaseEligibility` (M11) → `makeRegistry`. Both enforce* functions take `readonly AgentDefinition[]` and use the pure `familyOf()` / `capabilityOf()` lookups (no registry dependency at load time).
- **Config:** today loads `.code-oz/config.yaml` against `DEFAULT_CONFIG` via deep-merge; missing file returns defaults. No `company:` block exists or is parsed.
- **Eligibility check shape (M11 just shipped):** `enforceProviderPhaseEligibility` walks every loaded persona, asserts `capabilityOf(persona.provider).eligiblePhases.includes(persona.phase)`, plus walks every persona's `tool_use.debate.opposingProviders` and asserts each declared opposing provider is eligible for the persona's phase. Failures aggregate into `AgentLoadError` issues. AgentLoadIssue does **not** carry `actionableSuggestions` — `rule` + `detail` carry the fix hint. Do not regress that.
- **Debate runtime (M10):** `requestDebate({ phase, topic, files, question, opposingProvider })` builds a runtime `AgentDefinition` from the caller's persona with `provider: opposingProvider, phase: callerPhase`, copying the opposingProvider out of the persona's `tool_use.debate.opposingProviders` permission list. M11 closed the synthetic-opponent eligibility bypass.

## What is locked (not up for debate)

These are pinned in CLAUDE.md (the project's non-negotiable rules), the ROADMAP.md M12 row, the M11 forward-compat clause, or the user's explicit instructions for this milestone. Do not relitigate.

1. **Authority boundary: role-to-provider routing only.** Per CLAUDE.md rule 20, M12 introduces exactly one new authority. M13 is role-cost; M14 is reviewer panel; M15 is debate-policy scheduler. M12 does not bundle any of those.
2. **No new roles beyond the six shipped personas.** Researcher, parallel builder candidates, multi-opponent debate are M16+ and only when measurable need is evidenced. Do not propose them in scope.
3. **No panel surface (M14) and no role-cost gating (M13).** If a Codex pressure-test argues "you should add a `costCeiling` to each company:block row," the answer is "M13."
4. **Load-time check reuses M11's `capabilityOf(provider).eligiblePhases.includes(phase)`.** The M11 forward-compat clause locks this. No M12-side eligibility-check extension to `loader.ts`. M12's only job is *resolving* the effective `provider` (and possibly `model`) for each persona before the M11 check runs.
5. **No reverse `phase → ProviderId[]` map.** M11 anti-pattern (line 382). Derive on demand if M14 ever needs it.
6. **`AgentLoadIssue` shape stays.** No `actionableSuggestions` field; `rule` + `detail` carry the fix hint. Same as M11.
7. **One authority per milestone (rule 20).** M12 may not introduce a second new gate or capability domain.
8. **Tests interleave per commit.** Codex's M11 catch — no test-only final commit. Every implementation commit ships its tests with it.
9. **Offline test discipline.** `bun test` must remain offline + deterministic. M12 introduces no live-provider tests.
10. **No emoji in code or commit messages.** No `Co-Authored-By: Claude` footers unless the user asks.
11. **Markdown is canonical.** Inter-phase artifact contracts stay in `.md`; `events.jsonl` is audit-only. M12's `docs/contracts/COMPANY.md` is the user-facing surface; YAML is the wire format.
12. **Cross-family REVIEW (rule 2) preserved.** When the company:block overrides reviewer's provider, `enforceCrossFamilyReview` must use the *resolved* provider (after override), not the persona's frontmatter provider.
13. **Subscription-first auth model preserved (PROVIDERS.md).** M12 does not change auth.

## What is up for debate

Eight decisions for you to pressure-test. Some have a leaning recommendation; others are alternatives I have not yet picked between. Where I have a lean, I name it; argue against it if you see a real reason.

### Decision A — Role identifier: persona `name` (lean) vs new `role` key

The ROADMAP M12 row says "mapping role → provider+model+budgets+permissions." Today the persona file declares `name` (unique, regex-validated, lowercase-kebab). The company:block needs a key for each row.

**Lean (A1):** the persona's `name` IS the role identifier. M12 introduces no new layer; `company:` is a `Record<personaName, RoleOverride>`. The COMPANY.md prose names the social contract ("BA / Lead / Builder / Verifier / Reviewer / Scientist") but the technical key matches the persona's `name` field. If two personas share a role name (same `phase`, different identity), they collide today on `name`-uniqueness already; M12 does not need to disambiguate.

**Alternative (A2):** introduce a new `role: <enum>` field in the persona frontmatter and key the company:block on that enum. The role enum is fixed at six values for v0.1. Lets future versions decouple "Builder" the role from "alice-builder" the persona name.

The cost of A2 is a new persona-frontmatter field (schema change, validator change, all 6 personas need editing, plus migration prose). The benefit is forward-compat for an M16+ "multiple personas per role" feature that may never come. M11's empirical-reality discipline argues against pre-paying for hypothetical future surfaces (Codex Decision C catch).

Pressure-test prompt: is A1 painting M12 into a corner where M13/M14 cannot grow without renaming? Or is A2 over-engineering for a ghost requirement?

### Decision B — `company:` block fields in v0.1: provider+model only (lean) vs full provider+model+budgets+permissions

The ROADMAP M12 row wording is "providers, models, budgets, and permissions." But the M11 empirical-reality discipline (Decision C) is to ship the strict-minimal surface that v0.1 reality needs and defer the rest until measurable need.

**Lean (B1):** v0.1 ships `{ provider?: AgentProvider, model?: string }` per row. Both optional; absence means "use the persona's frontmatter value." Budgets stay under `budgets.global` + `budgets.perPhase` (no per-role budget block in v0.1). Permissions stay in persona frontmatter (no per-role permission override).

**Alternative (B2):** v0.1 ships the full ROADMAP wording: provider, model, budgets, permissions. Each optional; absence means inherit. Per-role budgets land as `company.<role>.budgets: PhaseBudget` (overrides `budgets.perPhase[role.phase]` for that one role). Per-role permissions land as `company.<role>.permissions: AgentPermissions` (overrides persona frontmatter).

B2 cost: bigger surface, more validation code, more failure modes (e.g., a role's permission override grants `bash` against the wrapper's deny default — what then?), more milestone-scope risk. M13 is then forced to re-shape role-cost rules around an existing per-role budget block instead of designing it cleanly. M14 (reviewer panel) cannot reuse a per-role permission override because panel permission semantics are panel-shaped, not role-shaped.

B1 cost: the COMPANY.md prose has to clearly say "v0.1 ships provider + model only; budgets and permissions defer to M13 and stay persona-side respectively." Future-Ozzy reading the doc has to know to look elsewhere for the rest.

Pressure-test prompt: does dropping budgets/permissions from M12 break a use case the AI-software-company metaphor needs? My read: no — the metaphor's load-bearing surface is "which model plays which role," not "which role has which budget." Budgets are M13's job. Permissions are persona-shape, not role-shape (a Builder persona's `tool_use.write` is what makes it a Builder, not a config switch).

### Decision C — Override semantics: config-wins (lean) vs persona-wins

When both the persona's frontmatter and the company:block declare a value (e.g., persona says `provider: claude`, company:block says `provider: codex`), which wins?

**Lean (C1):** config-wins. The company:block is the user's runtime authority for "who plays which role"; the persona frontmatter is the persona's identity (phase, prompt, permissions, default provider/model). When both declare the same field, config wins. Ridges of validation:
- Resolved (provider, phase) is the input to M11's `capabilityOf().eligiblePhases.includes()` check.
- Resolved provider is the input to `enforceCrossFamilyReview`.
- Resolved provider is the input to debate-opponent eligibility (M11's walk over `tool_use.debate.opposingProviders` — but those are declared per persona, not per role; see decision E).

**Alternative (C2):** persona-wins. The company:block is *advisory*; persona frontmatter is canonical. C2 makes the company:block "the AI-software-company metaphor doc-as-code" rather than runtime authority — useful for documentation, useless for routing.

C2 fails the rule-20 test: M12's authority boundary is role-to-provider routing. If the company:block can't actually route (i.e., persona frontmatter still wins), then M12 hasn't shipped the authority. C2 is a non-starter for that reason.

Pressure-test prompt: is C1 surfacing the right validation ergonomics? Specifically — what happens when a user's company.yaml says `reviewer.provider: claude` but the bundled reviewer persona's frontmatter says `provider: codex` and the bundled builder is on `claude`? Resolved-reviewer (claude) shares a family with build (claude) → `enforceCrossFamilyReview` rejects at load time. Good. The user gets `loader_cross_family_violation` with `detail` naming the resolved providers. That's the right teeth.

### Decision D — Override application point in the load chain

Where in `buildRegistry` does the company:block override get applied?

**Lean (D1):** insert the override application between schema validation (`validateOne` per source) and the cross-family + eligibility checks. Specifically:

```
buildRegistry(opts):
  for source in defaults: validateOne → AgentDefinition
  for source in overrides: validateOne → AgentDefinition (current bundled-vs-override merge stays)
  ────────────── NEW ──────────────
  applyCompanyOverrides(definitions, opts.company) → effective AgentDefinition[]
  ────────────── /NEW ─────────────
  enforceCrossFamilyReview(effective)
  enforceProviderPhaseEligibility(effective)
  makeRegistry(effective)
```

Composition matters: cross-family + eligibility see the *resolved* provider, not the persona's frontmatter. That makes M11's check correctly reject misconfigurations introduced by the company:block. No need to extend M11's check.

`applyCompanyOverrides` is a pure function: `(definitions, company) -> AgentDefinition[]`. For each definition, find a matching role row (key = `definition.name`); if present, return a new definition with `provider` and/or `model` replaced; else return the original. Frozen output array.

**Alternative (D2):** apply overrides at runtime inside the orchestrator, not at load time. `AgentRegistry` exposes `getResolved(name, company)` that overlays the override per call. Loader stays unchanged.

D2 is a non-starter: the load-time eligibility check (M11 lock #4 above) needs to see the *resolved* provider, not the persona's frontmatter. D2 keeps the persona-side provider in the registry and only resolves at runtime — which means a misconfigured company.yaml fails at the first runtime call (intervention), not at agent-load time. That regresses M11's pre-emptive discipline (rule 2).

Pressure-test prompt: is the "load order matters" risk worth an explicit test? Yes — the M12 commit that adds `applyCompanyOverrides` should ship a test asserting that an override that introduces a same-family review collision fails at load time with `loader_cross_family_violation`, AND a test asserting that an override that introduces a phase-ineligibility fails at load time with `loader_provider_phase_not_eligible`. Both cite the *resolved* provider in their `detail` string.

### Decision E — Roster scope: 6 personas only (lean) vs 6 + debate-opponent + orchestrator

The user's current ROADMAP M12 row wording (just edited 2026-05-01) names the roster as "BA + Lead + Builder + Verifier + Reviewer + Scientist + Debate opponent + Orchestrator." Eight names. But:
- Debate opponent is constructed at runtime by `requestDebate()`, NOT a persona file. Its provider is already declared per-persona in `tool_use.debate.opposingProviders` (M11 walks that list at load time).
- Orchestrator is the runtime, NOT a persona. It does not invoke a provider; the orchestrator runs in-process, makes provider calls on personas' behalf, and writes artifacts.

**Lean (E1):** v0.1 ships company:block rows for the six persona names only (ba/lead/builder/verifier/reviewer/scientist). Debate opponent is not a row because debate-opponent provider is already controlled per-persona via `tool_use.debate.opposingProviders` — that's the rule-20 authority for routing debate calls. Adding a separate company:block row for debate-opponent would create two competing authorities. Orchestrator is not a row because it has no provider/model to bind.

**Alternative (E2):** ship eight rows exactly as the ROADMAP says. Debate-opponent row controls *the global default* for debate-opponent provider when a persona doesn't specify; persona-side `tool_use.debate.opposingProviders` overrides. Orchestrator row is metadata-only (currently no fields land in v0.1; reserved namespace).

E2 risks: (i) two authorities for debate-opponent provider — persona-side `opposingProviders` and config-side `company.debate-opponent.provider` — creating a precedence question that has no clean answer; (ii) reserved-namespace `orchestrator` row is a "decorative slot" that becomes "accidental enforcement hook" exactly the way M11 Decision C warned against.

Pressure-test prompt: does the AI-software-company metaphor need an "Orchestrator" row to land properly in COMPANY.md prose? My read: the metaphor lands in prose without a config row. COMPANY.md can describe the orchestrator as "the company itself — it has no provider because it is the company, not an employee." That's stronger metaphor than a reserved-namespace row.

### Decision F — Backward compat: `defaultProvider` and `models.{primary, reviewer}` deprecation policy

Today's config has `defaultProvider: 'claude' | 'codex' | 'gemini' | 'fake'` and `models.{primary, reviewer}`. Once the company:block lands, are these deprecated?

**Lean (F1):** they coexist. `defaultProvider` becomes the fallback when neither company:block nor persona frontmatter declares a provider — but persona frontmatter always declares one, so `defaultProvider` is effectively legacy. `models.{primary, reviewer}` remains the fallback model when neither company:block nor persona frontmatter declares a model. No deprecation warning, no breaking change. Future milestone (W3+ or v0.2) can deprecate.

**Alternative (F2):** mark them deprecated in CLAUDE.md and emit a deprecation warning on config load when both `models.{primary, reviewer}` and `company:` are present. Messages migrate users. v0.2 removes.

F2 cost: emit-deprecation-warning machinery (where? events.jsonl? doctor output? stderr?), localized error vs warning ergonomics, M11 anti-pattern resonance ("don't add fields without measurable need" — symmetric: don't add deprecation channels without measurable need).

Pressure-test prompt: are `defaultProvider` and `models.{primary, reviewer}` actually conflicting with `company:` once M12 lands? If yes, F2 might be needed. If they cleanly coexist (lean F1), defer deprecation.

### Decision G — Error code introductions and naming

What error codes does M12 introduce, and what do they cover?

**Lean (G1):** introduce one new code: `loader_company_role_unknown`. Triggers when the company:block names a role key that does not match any loaded persona's `name`. Detail: `company:block declares role '<key>' but no loaded persona has that name; loaded personas are [<list>]`. All other failures (eligibility, cross-family) reuse M11's existing codes — `loader_provider_phase_not_eligible`, `loader_cross_family_violation` — against the *resolved* provider, with `detail` naming both the persona's frontmatter provider and the resolved provider so the user can trace the override.

**Alternative (G2):** also introduce `loader_company_provider_invalid` for the case where `company.<role>.provider` is not a member of `AGENT_PROVIDERS`. (Today, this would already fail validation at the company:block parser level with a generic schema error.)

G2 is probably already covered by the existing schema-validation pattern (`enumOrDefault` in `src/config/load.ts`). If `company.<role>.provider` validates as `AgentProvider`, no new code is needed.

Pressure-test prompt: are there other failure modes I'm missing? E.g., a role row with neither `provider` nor `model` — is that an error or a no-op? My read: a no-op (silent default to persona frontmatter). But if the company:block exists and a role row is empty, that may be a config bug that M12 should warn on. Open.

### Decision H — Commit sequence (interleaved tests per commit)

Codex's M11 round-1 catch: no test-only final commit. Every implementation commit ships its tests with it. M11 closed in 4 implementation commits + 2 review-closure commits. Proposed M12 sequence (5 commits):

| # | Commit | Surface | Tests interleaved |
|---|---|---|---|
| 1 | docs(m12): pin company roster contract surface | `docs/contracts/COMPANY.md` (new); CLAUDE.md status-line update; ROADMAP M12 row close-marker (deferred to commit 5) | none — docs-only |
| 2 | feat(m12): config schema + loader for `company:` block | `src/config/schema.ts` (extend `CodeOzConfig` with `company?: CompanyConfig`); `src/config/load.ts` (`mergeCompany`); `tests/config-load-company.test.ts` | yes — config schema + load coverage |
| 3 | feat(m12): apply company overrides at agent load | `src/agents/loader.ts` (`applyCompanyOverrides`); insert before cross-family + eligibility checks; `tests/agent-loader-company.test.ts` | yes — override semantics + cross-family + eligibility coverage |
| 4 | feat(m12): runtime consumes resolved provider/model | wherever the orchestrator reads `definition.provider` and `definition.model` for invocation (provider registry lookup, model selection); `tests/agent-runtime-company.test.ts` | yes — runtime resolution coverage |
| 5 | docs(m12): close M12 in ROADMAP + status bump | `docs/design/ROADMAP.md` M12 row "Closed YYYY-MM-DD" annotation; `CLAUDE.md` status line bump to `v0.12.0-alpha.0` | none — docs-only |

**Pressure-test prompts:**
- Should commit 4 split into "registry resolution" + "model selection" if the surfaces diverge?
- Is commit 1 too early for COMPANY.md to land before any code? (M11 commit 1 was docs-only and that worked.)
- Is there a commit 6 (Codex review closure) needed? My read: depends on Codex review verdict. If `push`, no commit 6. If `fix-first`, one closure commit per round, mirroring M11's pattern.
- Should the version number bump happen in commit 5 or via a tag-only operation? M11 bumped in a separate post-merge commit; that worked.

## The recommended path

If you accept the leans above (A1, B1, C1, D1, E1, F1, G1, H), M12 ships as:

1. **`docs/contracts/COMPANY.md`** lands as a new contract with sections: Why this exists (the AI software company metaphor), Authority boundary (role-to-provider routing), The shape (the TypeScript `CompanyConfig` interface), Default behavior (no `company:` block = identity = persona frontmatter wins), Override semantics (config-wins on provider + model), Validation rules (resolved provider triggers M11 + cross-family checks at load time), Anti-patterns rejected by this M12 spec (no role-cost; no panel; no permission overrides; no per-role budgets; no debate-opponent row; no orchestrator row), See also.
2. **`src/config/schema.ts`** extends `CodeOzConfig` with `company?: CompanyConfig`. `CompanyConfig` is `Record<personaName, RoleOverride>` where `RoleOverride = { provider?: AgentProvider, model?: string }`. Nothing more in v0.1. `DEFAULT_CONFIG.company` is undefined (absence is the default).
3. **`src/config/load.ts`** gains `mergeCompany(raw, file, issues): CompanyConfig | undefined`. Handles missing/null (no override), invalid shape (issue), unknown keys (just pass through — name validation happens in the loader against loaded personas), invalid `provider` enum (issue via `enumOrDefault`).
4. **`src/agents/loader.ts`** gains `applyCompanyOverrides(definitions, company)` — pure function called between schema validation and `enforceCrossFamilyReview`. For each definition, find a matching role row by `name`; if present, return a new frozen definition with `provider` / `model` replaced; else return the original. Cross-family + eligibility checks then see the resolved providers.
5. **The orchestrator** consumes `definition.provider` and `definition.model` at invocation time as it does today. M12 does not change the orchestrator's authoritative path — the resolved provider is already in the AgentDefinition handed to it by the registry.
6. **One new error code:** `loader_company_role_unknown` for "company:block names a role with no loaded persona." Reuses `loader_provider_phase_not_eligible` and `loader_cross_family_violation` for resolved-provider violations, with `detail` strings that name both the persona's frontmatter and the resolved value.
7. **Five commits, tests interleaved per the H table above.**
8. **No code changes outside `src/agents/loader.ts`, `src/config/{schema,load}.ts`, the new `docs/contracts/COMPANY.md`, status updates to CLAUDE.md and ROADMAP.md, and the test files.** The orchestrator change in commit 4 is, ideally, *zero net code* — the loader already produces resolved AgentDefinitions; commit 4 is only there to surface tests proving the runtime path consumes resolved values.

If the runtime path turns out to need code changes for commit 4 (e.g., it currently re-reads frontmatter values at invocation time, bypassing the registry), that surfaces as commit 4's work. I have not yet run that trace; commit 4's scope is open until I read the runtime.

## Decision prompts (for your reply)

1. Decision A — `name` as role identifier (lean A1) vs new `role` field (A2). Which? Why?
2. Decision B — strict-minimal `{ provider?, model? }` per row (lean B1) vs full ROADMAP wording (B2). Which? Why? Especially: what does the AI-software-company metaphor need that B1 doesn't ship?
3. Decision C — config-wins on overrides (lean C1) vs persona-wins (C2). Which? Why?
4. Decision D — apply overrides at load time before eligibility checks (lean D1) vs at runtime via `getResolved` (D2). Which? Why? Specifically: should the override application be a *new* function on the loader, or fold into the existing bundled-vs-override merge step?
5. Decision E — six rows only (lean E1) vs eight rows including debate-opponent + orchestrator (E2). Which? Why? Especially: is the AI-software-company metaphor better served by an explicit Orchestrator row or by COMPANY.md prose framing?
6. Decision F — `defaultProvider` and `models.{primary, reviewer}` coexist silently (lean F1) vs deprecate (F2). Which? Why?
7. Decision G — one new code `loader_company_role_unknown` plus reuse M11/M9 codes against resolved providers (lean G1). Are there failure modes I missed?
8. Decision H — five commits with tests interleaved per the table. Sequencing right? Anything misplaced? Should commit 4 split?

Risks the proposing side may have missed (please name them explicitly in your response, separately from the decision answers above):
- Override-loop / override-cascade interactions if both bundled defaults and project-local overrides have entries for the same persona.
- Test-fixture leakage: M11 introduced `capabilityOverrides` for tests; does M12's company-override seam interact with it in tests?
- COMPANY.md anti-pattern list completeness — what should be on it that I haven't named?
- `tool_use.debate.opposingProviders` interaction with company:block — if the user overrides a persona's provider via company:block, does the persona's `opposingProviders` list still make sense at load time? (My read: yes — opposingProviders is the persona's *capability* to debate against those families, not a binding to a specific provider id. Override of `provider` doesn't affect `opposingProviders` semantics.)
- Future-PE-1 readiness: PE-1 inserts a new `xai` provider after M12. M12's company:block schema must accept `xai` once it lands without a schema change. Today the `provider` enum is `'claude' | 'codex' | 'gemini' | 'fake'`. M12 should NOT pre-add `xai`; that's PE-1's job. But should M12's design allow PE-1 to add `xai` to the enum without an M12-side migration? My read: yes, and the design naturally supports it because the enum is shared (`AGENT_PROVIDERS` from `src/agents/schema.ts` and the validator's `PROVIDERS` from `src/config/load.ts`). PE-1 extends both atoms; M12 doesn't touch either.

## What I want from you

A response in the locked DEBATE.md format:

```markdown
## Verdict on the decisions

Overall verdict: <accept | accept-with-modifications | reject | feature-with-modifications>

A. Verdict: <enum>. <one-paragraph reason; concrete alternative if not accept>
B. Verdict: <enum>. <reason>
C. Verdict: <enum>. <reason>
D. Verdict: <enum>. <reason>
E. Verdict: <enum>. <reason>
F. Verdict: <enum>. <reason>
G. Verdict: <enum>. <reason>
H. Verdict: <enum>. <reason>

## Risks the proposing side missed

<numbered list of distinct risks; each names the surface, the failure mode, and the lock or test that closes it>

## Where I disagree

<any decisions you reject or substantively modify; with the alternative and the reasoning>

## What I would defer

<things in the lean that should be M13+ rather than M12; with the milestone target>

## Recommended next step

<one paragraph: what M12 should ship vs defer; concrete locks for the SESSION_M12_KICKOFF.md synthesis>
```

The first non-empty line under `## Verdict on the decisions` MUST be `Overall verdict: <enum>` per `docs/contracts/DEBATE.md` D10 lock. The verdict enum for planning debates is `accept | accept-with-modifications | reject | feature-with-modifications`. Per-decision verdicts may follow on subsequent lines without parser interference.

Sandbox: read-only. You may read any file in the repo for context but should not need to write or execute. If a question requires reading something I haven't named, name it in your response and read it from the repo.

Thread id: please cite the thread id verbatim in the response, per CLAUDE.md rule 7 + DEBATE.md format.
