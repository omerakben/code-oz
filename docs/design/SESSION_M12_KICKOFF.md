# M12 — Company roster (shipped roles only) — session kickoff (synthesis)

**Date:** 2026-05-01
**Branch:** `feat/m12-company-roster` (cut from `main` at `3078ac6`, after the xAI expansion docs commit)
**Scope:** ship the AI-software-company metaphor as a `.code-oz/config.yaml` `company:` block + `docs/contracts/COMPANY.md` for the six bundled personas only. Authority boundary (CLAUDE.md rule 20): **role-to-provider routing**.
**Codex debate:** [`docs/research/CODEX_BRIEFING_M12.md`](../research/CODEX_BRIEFING_M12.md) → [`docs/research/CODEX_RESPONSE_M12.md`](../research/CODEX_RESPONSE_M12.md), thread `019de4bb-9623-7340-98d7-dae01f5aa2d0`. Verdict: `accept-with-modifications`.

## Why this exists

M11 (Provider capability contract) closed cleanly two days ago (`v0.11.0-alpha.0`, 1860 offline tests) with a strict-minimal `ProviderCapability` shape and a load-time eligibility check. M11's "Forward-compat" clause names M12: *"M12 (company roster) introduces a config-side `company:` block mapping role → provider+model+budgets+permissions. M12's load-time check reuses `capabilityOf(provider).eligiblePhases.includes(phase)` against the role's chosen phase. No M11 hook required; M12 builds on the existing surface."* That clause + the product-thesis differentiator argument (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`) make M12 the next milestone in the locked post-M10 sequence: M11 (closed) → **M12** → PE-1 → M13 → M14 → M15 → (v0.2 cloud routes).

The Codex round (thread `019de4bb`) returned `accept-with-modifications` with three substantive flips, four risks the briefing missed, and one full-stop disagreement. Each one closes a real correctness, scope, or surface-area hole. Two of the catches are concrete code claims I verified against the repo (bootstrap order + model propagation) before locking.

## What changed after the Codex round

### Decisions absorbed (locks)

| # | Decision | Final lock |
|---|---|---|
| A | Role identifier | **Persona `name` IS the technical key, BUT the accepted M12 keys are restricted to a six-name roster constant.** New constant `M12_COMPANY_ROLES = ['ba', 'lead', 'builder', 'verifier', 'reviewer', 'scientist'] as const` lives alongside the company-config schema. Project-local custom personas are NOT routable as company roles in v0.1; M12 is "shipped roles only" by definition. Codex's flip on Decision A: without the roster constant, M12 quietly becomes "custom role routing" — an M16+ feature. |
| B | `company:` block fields | **`{ provider?: AgentProvider, model?: string }` only, with fail-closed rejection of unsupported field keys.** Drops budgets and permissions from the ROADMAP M12 row's wording per the M11 empirical-reality discipline. Codex add: any unknown key under a company row (e.g., `company.builder.permissions`, `company.builder.budgets`) MUST raise a typed config error. Silent drop gives users false authority. |
| C | Override semantics | **Config-wins.** When persona frontmatter and company:block both declare a value, the company:block wins. Resolved (provider, model) is what `enforceProviderPhaseEligibility`, `enforceCrossFamilyReview`, and the runtime invoke path see. Persona-wins is a non-starter for the rule-20 authority test. |
| D | Override application point | **Add a separate pure `applyCompanyOverrides` between bundled-vs-override merge and the cross-family + eligibility checks. Do NOT fold into the existing bundled-vs-override merge.** Codex catch: the two surfaces have different authority and different error messages; folding them together loses the distinction. **New scope addition (Codex risk #2): the CLI bootstrap order also needs fixing — today `runCommand()` in `src/commands/run.ts:56` calls `bootstrap()` (which loads the registry at `src/cli/bootstrap.ts:54`) BEFORE `loadConfig()` at `src/commands/run.ts:80`. M12 must flip this order or the company:block arrives too late to affect the registry.** Verified in repo. |
| E | Roster scope | **Six rows only.** Debate-opponent stays governed by `tool_use.debate.opposingProviders` per persona (M11's authority); Orchestrator is the runtime and has no provider/model binding. COMPANY.md prose explains both, but the YAML must not create decorative rows. |
| F | Backward compat for `defaultProvider` and `models.{primary, reviewer}` | **Coexist silently, no deprecation machinery.** But Codex's catch sticks: do NOT claim them as active fallbacks unless M12 wires and tests that path. `defaultProvider` is effectively legacy while persona frontmatter `provider` remains required; `models.{primary, reviewer}` falls through only if the runtime actually consults them. False fallback documentation is not acceptable. |
| G | Error code introductions | **Keep one new code: `loader_company_role_unknown`. Definition refined per Codex: triggers when `company:` declares a key NOT in the locked six-role `M12_COMPANY_ROLES` constant.** Reuses M11's `loader_provider_phase_not_eligible` and M9's `loader_cross_family_violation` against the *resolved* provider, with `detail` strings naming both the persona's frontmatter provider and the resolved value. Additional missed failures Codex named (close all of them): unsupported company row fields (config validation issue, not loader); invalid row shape (config validation); empty/non-string model (config validation); resolved debate same-family after a provider override (loader). |
| H | Commit sequence | **Six commits with tests interleaved per commit (no test-only final commit, per Codex's M11 catch). Commit 4 splits into bootstrap-wiring + model-propagation per Codex's catch.** Final sequence in the "Implementation plan" section below. |

### Risks Codex raised that the briefing missed

Each one becomes a lock or a test before the corresponding commit lands.

1. **Shipped-role boundary.** Without the six-name roster constant, project-local personas (e.g., a user-added `agile-coach.md`) become routable roles. **Lock:** `M12_COMPANY_ROLES` constant + a test where `company.agile-coach: { provider: 'codex' }` raises `loader_company_role_unknown` even when `agile-coach.md` loads as a valid persona.
2. **Bootstrap order.** `runCommand()` builds the registry before loading config. **Lock:** flip the order — load config first, pass `config.company` into `bootstrap()` (or have bootstrap own config loading), with a test proving `company.ba.provider: 'codex'` causes `ctx.registry.getByName('ba').provider === 'codex'`.
3. **Model override propagation.** `src/providers/manifest.ts:127` copies `req.model` only; phase calls generally omit `req.model`; so `agent.model` is dropped during prepare. **Lock:** default request → `req.model ?? req.agent.model` in the provider invoke path, with tests proving (a) adapter args include the resolved model, (b) `agent_invoked.model` event records the resolved model.
4. **Debate cross-family after override.** Schema validation in `src/agents/schema.ts` checks `tool_use.debate.opposingProviders` against the *frontmatter* provider, not the resolved company provider. Example failure: `lead.provider: codex` (overridden from `claude`) with frontmatter-declared `opposingProviders: ['codex']` should fail at load time, not first debate call. **Lock:** add a post-override debate-family check in the loader after `applyCompanyOverrides`, raising `schema_invalid_permissions` (existing code) or a new typed error if the policy decision differs.
5. **Unsupported field silence.** If `company.builder.permissions` or `company.builder.budgets` is silently ignored, the user gets false authority. **Lock:** config schema's `mergeCompany` rejects any unknown row-key with a typed config issue (`config_invalid_value` or new code), with tests asserting rejection.
6. **Override cascade.** Project-local persona overrides and company overrides can both touch provider/model. **Lock:** precedence test — bundled frontmatter < project-local persona override < company row. The existing bundled-vs-override merge produces an `AgentDefinition`; `applyCompanyOverrides` runs on that result; M12 tests cover all three layers.
7. **Test seam leakage.** M11's `capabilityOverrides` belongs to `ProviderRegistry`, not the loader (loader uses pure `capabilityOf()`). M12 loader tests use *real* defaults like `gemini` for ineligibility; do NOT inject capability overrides into loader tests because they have no effect.

### Codex's full-stop disagreements (acknowledged)

- "Loaded personas are [list]" was wrong as the role-authority statement — replaced with the six-name roster constant. (Locked in Decision A.)
- `tool_use.debate.opposingProviders` semantics survive a company:block override, but the eligibility/family check must re-run against the resolved provider. (Locked in risk #4.)
- `defaultProvider` / `models.{primary, reviewer}` documentation cannot claim "active fallback" without proof. (Locked in Decision F.)

## Locked roadmap (post-Codex)

### What ships in M12

1. **`docs/contracts/COMPANY.md`** — new contract pinning the company-roster surface. Sections (mirroring DEBATE.md / PROVIDERS.md / REPO_CONTEXT.md style):
   - Why this exists (the AI software company metaphor; why this is the product-thesis differentiator)
   - Authority boundary (role-to-provider routing; the only new authority M12 introduces)
   - The shape (TypeScript `CompanyConfig` interface + the locked `M12_COMPANY_ROLES` constant)
   - Default behavior (no `company:` block = identity; persona frontmatter wins by absence)
   - Override semantics (config-wins on `provider` and `model`; resolved values feed eligibility, cross-family, and runtime invocation)
   - Validation rules (config validation rejects unknown row keys + invalid shape + empty/non-string model + invalid provider; loader validation rejects unknown role keys + resolved-provider phase-ineligibility + resolved-debate same-family + resolved cross-family review violation)
   - Anti-patterns rejected by this M12 spec (per the list below)
   - Forward-compat (M13 adds per-role budgets under `budgets.global`; M14 adds reviewer panels; PE-1 adds `xai` to the shared provider enum without a company-schema migration)
   - See also (PROVIDERS.md, provider-contract.md, DEBATE.md, REPO_CONTEXT.md)

2. **`src/config/schema.ts`** extends `CodeOzConfig` with `company?: CompanyConfig`:
   ```ts
   export const M12_COMPANY_ROLES = ['ba', 'lead', 'builder', 'verifier', 'reviewer', 'scientist'] as const
   export type CompanyRole = (typeof M12_COMPANY_ROLES)[number]

   export interface CompanyRoleOverride {
     readonly provider?: AgentProvider
     readonly model?: string
   }

   export type CompanyConfig = Readonly<Partial<Record<CompanyRole, CompanyRoleOverride>>>
   ```
   `DEFAULT_CONFIG.company` is undefined.

3. **`src/config/load.ts`** gains `mergeCompany(raw, file, issues): CompanyConfig | undefined`:
   - missing/null → undefined (no override)
   - non-object or array → typed issue
   - keys not in `M12_COMPANY_ROLES` → typed issue (rejects `company.agile-coach`)
   - row shape: must be a mapping; unknown row-key (e.g., `permissions`, `budgets`, `bash`) → typed issue
   - `provider` validates against the shared `AGENT_PROVIDERS` enum (so PE-1's `xai` lands without a company-schema migration once `AGENT_PROVIDERS` extends)
   - `model` must be a non-empty string when present

4. **`src/agents/loader.ts`** gains `applyCompanyOverrides(definitions, company): readonly AgentDefinition[]` — pure function, called between schema validation and `enforceCrossFamilyReview`. For each definition, find the matching role row (key = `definition.name`); if present, return a new frozen definition with `provider` / `model` replaced; else return the original. The output array feeds both existing enforcement passes (cross-family, eligibility) and a new debate-family post-override check (Codex risk #4).

5. **`src/cli/bootstrap.ts`** + **`src/commands/run.ts`** — flip the order. Either (a) `bootstrap()` accepts `config: CodeOzConfig` and `runCommand()` loads config first, or (b) `bootstrap()` itself loads config before invoking `loadRegistry`. Either way, `loadRegistry` receives `company` in its options and forwards to `applyCompanyOverrides`.

6. **`src/providers/manifest.ts`** (or `invoke.ts`, whichever owns the prepare step) — default the request → `req.model ?? req.agent.model` so the company-overridden `model` reaches the adapter. Test asserts adapter receives the resolved model AND `agent_invoked.model` event records it.

7. **One new error code: `loader_company_role_unknown`.** Reuses `loader_provider_phase_not_eligible` (M11), `loader_cross_family_violation` (M9), and config-validation codes for the rest. AgentLoadIssue stays without `actionableSuggestions` per the M11 lock.

### What does NOT ship in M12

- No per-role budgets (M13).
- No per-role permissions overrides (deferred indefinitely; permissions stay persona-shaped).
- No reviewer panels (M14).
- No debate-opponent scheduling policy or row (M15).
- No "Orchestrator" company row (the orchestrator is the runtime, not an employee).
- No deprecation of `defaultProvider` or `models.{primary, reviewer}` (silent coexistence per Decision F).
- No xAI enum addition (PE-1 owns that). M12 uses the shared `AGENT_PROVIDERS` enum so PE-1 extends it cleanly.
- No reverse `phase → ProviderId[]` map (M11 anti-pattern).
- No structural changes to `AgentLoadIssue` (no `actionableSuggestions`).

## Implementation plan

Six commits, tests interleaved per commit. No test-only final commit (Codex's M11 catch). Each commit references the response file path in its body per CLAUDE.md rule 7.

| # | Commit | Surface | Tests interleaved |
|---|---|---|---|
| 1 | `docs(m12): pin company roster contract surface` | `docs/contracts/COMPANY.md` (new) | none — docs-only |
| 2 | `feat(m12): config schema + loader for company:block` | `src/config/schema.ts` (extend `CodeOzConfig`, add `M12_COMPANY_ROLES`, `CompanyRoleOverride`, `CompanyConfig`); `src/config/load.ts` (`mergeCompany` with fail-closed unsupported-key rejection); | `tests/config-load-company.test.ts` — schema + load coverage including unknown-role rejection, unknown row-field rejection, invalid provider, empty model, missing-config-no-error |
| 3 | `feat(m12): apply company overrides at agent load + post-override checks` | `src/agents/loader.ts` (`applyCompanyOverrides`; insert in `buildRegistry` between bundled-vs-override merge and `enforceCrossFamilyReview`; add post-override debate-family check; add `loader_company_role_unknown` error code) | `tests/agent-loader-company.test.ts` — override semantics, resolved-provider triggers cross-family violation, resolved-provider triggers eligibility violation, resolved-debate triggers same-family violation, override-cascade precedence (bundled < project-local < company), unknown-role rejected even when project-local persona of that name loads |
| 4 | `feat(m12): bootstrap loads config before registry` | `src/cli/bootstrap.ts` accepts `config` in opts (or loads it itself); `src/commands/run.ts:56` and `:500` swap order | `tests/cli-bootstrap-company.test.ts` — `company.ba.provider: 'codex'` causes `ctx.registry.getByName('ba').provider === 'codex'`; `company.builder.model: 'sonnet'` causes resolved `AgentDefinition.model === 'sonnet'` |
| 5 | `feat(m12): model propagation through provider invoke` | `src/providers/manifest.ts` (or `invoke.ts`) — default `req.model ?? req.agent.model`; `src/state/events.ts` (if model needs surfacing in `agent_invoked` event) | `tests/provider-invoke-model-propagation.test.ts` — adapter args include resolved model when phase omits `req.model`; `agent_invoked.model` records resolved value |
| 6 | `docs(m12): close M12 + status bump to v0.12.0-alpha.0` | `docs/design/ROADMAP.md` M12 row "Closed 2026-MM-DD" annotation; `CLAUDE.md` status line bump to `v0.12.0-alpha.0`; `src/config/schema.ts` `DEFAULT_CONFIG.version` bump (it's still on `0.10.0-alpha.0` — M11 missed this; lands here) | none — docs-only |

**Codex implementation review (CLAUDE.md rule 8):** runs after commit 6, before tagging. Verdict drives one of: tag (`push`), one round of closure commits (`fix-first`), or pause (`debate-required`). Closure-round commits are commit 7+ if needed; they never fold into the original six.

**M11 lesson empirically validated:** when the authority boundary is small, the review loop converges faster. M12's authority is "config-side override map keyed by 6 names, applied before existing checks" — comparable scope to M11's "load-time eligibility check on a static capability table." Expect 1–2 review rounds, not the M9/M10 three-round pattern. (M11 needed two rounds.)

## Pre-commit-1 locks (not pre-PE-1 style; just session discipline)

These are not separate commits — they're session-level locks I have to honor while authoring commits 1–6:

1. **Read commit 4 + commit 5 surface code BEFORE drafting commit 1's COMPANY.md.** The contract claims "config wins, resolved values flow through to the adapter" — I have to know exactly where `req.model` originates and where the adapter consumes it before COMPANY.md pins prose around them. Codex already verified the bug surface (manifest.ts:127); I read it during synthesis. Re-read on commit 1.
2. **`AGENT_PROVIDERS` is the shared enum.** M12's `mergeCompany` validates `provider` against the same enum the persona schema uses. Do not duplicate. Do not pre-add `xai`.
3. **`AgentLoadIssue` shape unchanged.** No `actionableSuggestions` field; `rule` + `detail` carry the fix hint. Same as M11.
4. **No emoji in code or commit messages.** No `Co-Authored-By: Claude` footers unless asked.
5. **Tests interleaved per commit.** Codex's M11 catch.

## Open follow-ups (parking lot, not M12 scope)

- **`DEFAULT_CONFIG.version` is still `0.10.0-alpha.0`** even though M11 closed at `v0.11.0-alpha.0`. M11 missed this. M12 commit 6 bumps it (to `0.12.0-alpha.0` after M12 closes). If Codex's M12 review notes this earlier, I'll fold the bump into an earlier commit; otherwise commit 6 owns it.
- **PE-1 readiness.** PE-1 will add `'xai'` to `AGENT_PROVIDERS` and add an `xai-api-key` `authSource`. M12 must NOT pre-add either. Verified: `mergeCompany`'s `provider` validator uses the shared enum, so PE-1's enum extension automatically extends M12's accepted values.

Carried-over from prior milestones:
- M10 n#1 (deferred): line-anchored `<debate-request>` tag detection in `src/tools/debate-request-extract.ts`. Wait for a real persona response to trip the quoted-YAML edge case.
- M9 audit M1 + M2 (deferred): duplicate parsing helpers across `src/artifacts/*.ts`. DRY-at-3x not yet triggered.
- M11 deferred-by-design: `costPerMTok` and `rateLimits` data values omitted on every default; populated when M13 lands the role-cost policy.
- 9 unpushed local commits on main (M11 work + status bump + xAI roadmap doc commit `3078ac6`). Push pending Ozzy's explicit approval per CLAUDE.md rule 5; not a blocker for M12 work.
- xAI/PE-1 contract additions (env var redaction, Authorization-header logging, built-in-tools-disabled) are PE-1's commit-1 docs lock, not M12's.

## What earns M12 going first (the load-bearing argument)

Per the locked sequence revision (2026-05-01), M12 ships before PE-1 because:
- M12 (Company roster) is the product-thesis differentiator. Without it, `code-oz` is "another agentic runtime"; with it, the "AI software company" metaphor lands as code.
- PE-1's xAI provider is more useful once M12 has shipped: xAI immediately drops into a `company:` block role binding on day one. If PE-1 shipped first, the M12 planning round would need to retro-fit xAI into the role table.
- M13 / M14 / M15 each become richer with M12 as scaffolding: M13's role-cost policy reads from the `company:` table; M14's reviewer panel adds a panel-shape that respects the company:block; M15's debate-policy scheduler routes through company-resolved providers.

The Codex round confirmed this ordering with `accept-with-modifications` — no flip on the sequencing decision; only on the implementation surface details. Sequencing is locked.
