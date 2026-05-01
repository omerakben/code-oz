# code-oz — M11 Codex briefing (Provider capability contract)

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M10 has shipped (`v0.10.0-alpha.0`, 1761 offline tests pass at session close, `feat/m10-debate` → `main` merged and pushed; three Codex review rounds closed `push` after fix-first cycles, with round 2 catching two bugs that round 1's fix introduced — the same loop discipline empirically validated for M9). The thesis pressure-test debate (`docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`, thread `019de031`) and the M7-M10 shape thesis (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`, thread `019ddea0`) locked the post-M10 sequence: **M11 = Provider capability contract; M12 = Company roster (shipped roles only); M13 = Role-cost policy under `budgets.global`; M14 = Reviewer panel v1 (first simultaneous-provider surface); M15 = Debate-policy scheduler v1.** CLAUDE.md rule 20 ("one new authority boundary per milestone") is in force.

ROADMAP § Beyond v0.1 names the M11 boundary: **provider eligibility.** Add capability/auth/cost traits per provider (edit semantics, shell semantics, OAuth source, MCP support, sandbox profile, rate limits, cost-per-1M-tokens, role eligibility). Load-time rejection of impossible role assignments. No new roles. Lands as `docs/contracts/PROVIDERS.md` extension.

The contract surface M11 plugs into is fully pinned by M2-M10:

- `docs/contracts/PROVIDERS.md` (M4-shipped, ~110 lines) — thin user-facing summary; subscription-first auth model; v0.1 limitations (no streaming UX through code-oz; no `tool_call` event surfacing for Codex; no `tokensUsed` provenance from Codex); per-adapter privacy guards; `code-oz doctor providers` exit policy.
- `docs/references/provider-contract.md` (~298 lines) — canonical contract: `IAgentProvider`, request DTO split (`ProviderRequest` paths-only / `PreparedProviderRequest` content+manifest+metrics), streaming events, `ProviderFamily` cross-family enforcement, `ProviderError` code list, `NEEDS_INTERVENTION → intervention` discipline, cost-budget pre-call check, tool-call cap streaming enforcement, doctor contract, lock boundaries, validation rules, anti-patterns rejected.
- `src/providers/types.ts` (175 lines) — `ProviderId = 'claude' | 'codex' | 'gemini' | 'fake'`; `ProviderFamily` (same enum in v0.1); `IAgentProvider { id, family, invoke, health }`; `ProviderHealth { provider, authStatus, modelDefaultAvailable, latencyMs?, lastError? }`. Stateless adapter contract.
- `src/providers/families.ts` (52 lines) — pure `DEFAULT_FAMILY_BY_ID` lookup + `familyOf()` function; single source of truth for cross-family REVIEW (the load-time loader and the runtime registry both read this). The pattern M11 mirrors for capabilities.
- `src/providers/registry.ts` (130 lines) — `ProviderRegistry` with `familyOf()` authority + adapter-family validation (rejects misregistered adapters that would launder cross-family) + `familyOverrides` test/W3 seam.
- `src/agents/schema.ts` (1122 lines) — `AgentDefinition` carries `provider: AgentProvider` (mirrors `ProviderId`); `phase: AgentPhase` (`define | plan | build | verify | review | ship | audit`); `modelPolicy: 'opus-default' | 'strict-opus' | 'any'`; optional `model: string`; `permissions.tool_use` umbrella with five sub-scopes (`repo_context` M6, `write` M7, `execute` M8, `review_request` M9, `debate` M10) — each schema-validated load-time with bounded numeric caps. M11 adds NO new persona-side field; eligibility lives on the registry side (see Decision A).
- `src/agents/defaults/{ba,lead,scientist,builder,verifier,reviewer}.md` — six personas. ba (define, claude), lead (plan, claude, debate-enabled), scientist (plan, claude), builder (build, claude, write+repo_context), verifier (verify, claude, execute+repo_context), reviewer (review, codex, review_request+repo_context). Cross-family guarantee: builder=claude / reviewer=codex.
- `CLAUDE.md` rules:
  - Rule 2 (cross-family REVIEW) — uses `registry.familyOf()`, NOT direct ProviderId comparison. M11's eligibility check uses the same shared-source-of-truth pattern.
  - Rule 8 (FakeProvider runs lifecycle offline) — M11 capability tests must use FakeProvider; new capability shape must support FakeProvider's eligibility declaration.
  - Rule 9 (permission manifest required) — M11 capabilities are advisory metadata + load-time eligibility, NOT runtime execution authorization (that lives in `permissions.tool_use` sub-scopes already).
  - Rule 13 (privacy by default) — capabilities never trigger network calls; `health()` remains side-effect-free per `provider-contract.md` rule 10.
  - Rule 19 (`budgets.global` enforcement) — M11 cost-per-1M-tokens is **advisory** in v0.1; enforcement lives in M13 under the existing `budgets.global` namespace. M11 adds no new budget axis.
  - Rule 20 (one new authority boundary per milestone) — M11's authority is **provider eligibility**. Strictly one boundary. No company roster (M12), no role-cost gating (M13), no panels (M14), no scheduler (M15).
  - Rule 21 (no new parallel-provider surface without measurable risk reduction) — M11 ships zero new parallel surface. Capability metadata is sequential.

**M11 is now Provider capability contract implementation only.** Acceptance per ROADMAP § Beyond v0.1:

> Add capability/auth/cost traits per provider. Load-time rejection of impossible role assignments. No new roles. Lands as `docs/contracts/PROVIDERS.md` extension.

You are not debating *what* the existing `IAgentProvider` interface looks like (provider-contract.md pins that). You are not debating *whether* M11 introduces new persona-side frontmatter (rule 20 forbids — "no new roles"). You are debating **how to thread the capability contract through the existing M10 substrate without inventing new authority surface area** — eight implementation decisions where my leans need pressure. Push back hard where the leans are wrong; sanity-check rather than rubber-stamp where they hold.

Mirror the verdict format from `CODEX_RESPONSE_M10.md`: numbered decisions, `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications` per the DEBATE.md verdict enum; "Where I agree", "Where I disagree (with specific alternative)", "Risks the proposing side missed", "Decisions you must lock before code".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1-21. Especially 2, 8, 9, 13, 19, 20, 21 (above).
- **`docs/contracts/PROVIDERS.md`** — current user-facing summary; the file M11 extends.
- **`docs/references/provider-contract.md`** — current canonical contract; the file M11 extends with the capability TypeScript shape.
- **`src/providers/types.ts`**, **`src/providers/families.ts`**, **`src/providers/registry.ts`** — current runtime shape. Especially `families.ts` as the pattern M11 mirrors.
- **`src/agents/schema.ts`** — current persona-side declaration of `provider`/`phase`/`modelPolicy`/`permissions`. Especially the `validateAgent` chain that calls `validateEnum('provider', AGENT_PROVIDERS, ...)` — the loader hook M11 extends.
- **`docs/design/ROADMAP.md` § Beyond v0.1 § Post-M10 productization** — locked sequence. M11 is the listed scope.
- **`docs/research/HANDOFF_M11.md`** — kickoff guide; lists likely-locks and likely-debatables (this briefing absorbs them with explicit citations).

You do not need to re-read every M2-M10 source file. Glance at:

- **`src/agents/load.ts`** — load-time validation chain. M11's eligibility check fits here as a new `validateEligibility()` step after persona schema is freshness-validated.
- **`src/providers/cost.ts`** (`assertWithinBudget`, `summarizeBudgetUse`) — already handles cumulative spend; M11 cost-per-1M-tokens is advisory metadata it can read for soft-warn telemetry but does not enforce.
- **`src/providers/{claude,codex,gemini,fake}.ts`** — adapter classes. Each already declares `family: ProviderFamily`. M11 expects each to declare `capability: ProviderCapability` analogously.

---

## Where we stand

```
$ git log --oneline -3
c870d06 docs(research): HANDOFF_M11 — kickoff guide for next session
118a9ab docs(research): CODEX_REVIEW_M10 closure tracker — round 3 push verdict
b3e1744 fix(debate): close Codex M10 round-2 review findings

$ bun test
1761 pass / 1 skip / 0 fail (offline)
$ bun run typecheck
clean

$ git tag -l v0.* | wc -l
11   # v0.1.0-alpha.0 ... v0.10.0-alpha.0

$ git branch --show-current
feat/m11-provider-capability  # branched from main this session
```

What works:
- DEFINE → PLAN → BUILD → VERIFY → REVIEW spine end-to-end (offline FakeProvider + live Claude+Codex providers).
- Cross-family REVIEW (M9 loop discipline) and Debate runtime (M10 `requestDebate` primitive) both consume `registry.familyOf()` as the single source of truth.
- `tool_use` umbrella with five sub-scopes; each load-time-validated with bounded numeric caps.
- Subscription-first auth (Claude Max / ChatGPT Plus|Pro), no API key storage, adapter privacy guards (empty-temp-cwd; stdin-piped manifest content; `--no-session-persistence` for Claude; `--sandbox read-only --ephemeral` for Codex).

What's stubbed or deferred:
- `gemini` provider: stub. `invoke()` throws `provider_gemini_not_yet_supported`; `health()` returns `authStatus: 'unsupported'`. Real Gemini lands W3+.
- SHIP phase: stub.
- AUDIT phase (brownfield): stub but with `AUDIT.md` artifact contract pinned.
- Per-role budget gating: M13 (advisory metadata only in M11).
- Reviewer panel: M14.
- Debate-policy scheduler: M15.
- Multi-language LanguagePack abstraction: W3.

**Critical empirical fact for M11 framing.** Today's runtime is provider-uniform for `tool_use` sub-scopes: the wrapper extracts tools from the persona response and applies them in-process (or via orchestrator-side patch application for `write`, or via subprocess for `execute`), regardless of which provider produced the response. So "edit semantics", "shell semantics", "MCP support", "sandbox profile" are NOT divergent runtime semantics in v0.1. They become divergent in W3+ when HTTP adapters land (opencode-style OAuth+PKCE for Codex; equivalent for Claude). M11 records the trait shape so divergence has a home — the eligibility check is the v0.1 teeth (e.g., `gemini`-as-builder fails at load time today rather than at runtime CLI spawn).

---

## What is locked (not up for debate)

These come from CLAUDE.md, ROADMAP § Beyond v0.1, the M7-M10 shape thesis, the product thesis pressure-test, the M9/M10 substrate patterns, and `docs/contracts/PROVIDERS.md` + `docs/references/provider-contract.md`.

1. **Capability data lives in `src/providers/capabilities.ts` paralleling `src/providers/families.ts`** — pure `DEFAULT_CAPABILITY_BY_ID: Readonly<Record<ProviderId, ProviderCapability>>` lookup + `capabilityOf(id)` function. Single source of truth shared by load-time loader (which runs before any registry exists) and runtime registry (which seeds from defaults + accepts overrides). Same architectural pattern as M9's family substrate.
2. **Canonical TypeScript shape ships in `docs/references/provider-contract.md`** (extension), thin user-facing summary in `docs/contracts/PROVIDERS.md` (extension). Mirrors how `REPO_CONTEXT.md`, `BUILD.md`, `DEBATE.md` ship inline TS shapes against the references-dir canonical doc.
3. **`ProviderRegistry` gains `capabilityOf(id): ProviderCapability` instance method** + optional `capabilityOverrides?: Readonly<Partial<Record<ProviderId, ProviderCapability>>>` constructor field paralleling `familyOverrides`. Test seam + W3+ seam (when HTTP adapters land with divergent capability records).
4. **`IAgentProvider` gains a `capability: ProviderCapability` readonly field** paralleling existing `family: ProviderFamily`. Adapter classes declare their capability statically. Registry validates `adapter.capability === capabilityOf(adapter.id)` (or its override) at registration time, mirroring the existing family cross-check that prevents misregistered-adapter laundering.
5. **M11 introduces NO new persona-side frontmatter field.** Personas continue to declare `provider`, `phase`, `modelPolicy`, optional `model`, `permissions`. The "role" the eligibility check anchors on in v0.1 is `phase: AgentPhase` (the existing field). M12 may introduce a `role:` field; M11 does not preempt that decision.
6. **Subscription-first auth is preserved.** OAuth source declaration is metadata: `authSource: 'claude-max-cli' | 'chatgpt-plus-cli' | 'chatgpt-pro-cli' | 'stub' | 'in-process'` (or similar bounded enum — final shape per Decision E). code-oz never reads or transmits OAuth tokens. M11's authSource field reflects what `claude login` / `codex login` set up.
7. **`health()` does not gain a runtime capability probe.** Capabilities are statically declared. `health()` remains scoped to auth + model availability per `provider-contract.md` rule 10 (side-effect-free; doctor runs outside any active run).
8. **Cost-per-1M-tokens is advisory metadata in M11.** Recorded on `ProviderCapability` for telemetry; M13 enforces under existing `budgets.global` namespace. Rule 19 stays clean (no parallel namespace).
9. **Rate limits are advisory metadata in M11.** Same logic: M13 may consume; M11 records the shape (e.g., `rateLimits: { requestsPerMinute?: number; tokensPerMinute?: number; outputTokensPerMinute?: number }`).
10. **Failure shape on impossibility:** new `ProviderErrorCode` value `provider_role_not_eligible` (alphabetical-cluster fit alongside `provider_permissions_violation`); reported as `AgentLoadError` issue at load time with `actionableSuggestions` naming the offending persona file + the provider's declared eligibility list.
11. **Cross-family REVIEW + cross-family Debate are unchanged.** They already use `registry.familyOf()`. M11 adds an orthogonal eligibility axis; family axis stays as-is.
12. **All tests offline via FakeProvider.** The FakeProvider's `capability: ProviderCapability` declaration must support test-overridable shape (via `capabilityOverrides` constructor). Existing M9/M10 e2e tests must still pass.
13. **Universal rules sheet (rule 16) unchanged.** Capability contract is structural plumbing, not persona prompt content.
14. **No company roster.** Rule 20 forbids bundling. M12 lands the `company:` block in `.code-oz/config.yaml` mapping role → provider/model/budgets. M11 does NOT introduce config-side mapping.

---

## What is up for debate

Eight decisions. Numbered for your reply.

### Decision A — Eligibility shape: list-on-provider vs map-keyed-by-role

**My lean: list-on-provider.** Each `ProviderCapability` carries `eligiblePhases: readonly AgentPhase[]`. Load-time check: `for each loaded agent: assert(agent.provider's eligiblePhases includes agent.phase)`.

Two paths considered:

- (a) **`eligiblePhases: AgentPhase[]` per provider** (lean): forward-keyed. Easy to author per provider ("claude is eligible for define, plan, build, verify"). Easy to extend for M12 (M12's `company:` block reads `role → provider`; eligibility check still asks "is this provider eligible for this role-mapped phase?"). Reads naturally as "what can this provider do."
- (b) **`phaseEligibility: Record<AgentPhase, ProviderId[]>` map keyed by phase**: reverse-keyed. Reads naturally as "for this phase, which providers qualify." Slightly cheaper for M14 reviewer-panel quorum lookup (which providers can review?). But M14 is two milestones away and could cache its own derived map.

**Pressure-test:** is there a third hybrid (carry both, derived) worth the redundancy? Or do you push for (b) on M14 forward-compat grounds even though that violates "build for the next milestone, not the next-plus-three"?

### Decision B — Default eligibility for v0.1: additive vs restrictive

**My lean: restrictive, declared honestly.** `claude` eligible for `define, plan, build, verify, review, ship, audit` (everything except dependent-on-Gemini-only roles, which don't exist). `codex` eligible for `define, plan, build, verify, review, ship, audit`. `gemini` eligible for **none** (stub provider). `fake` eligible for `define, plan, build, verify, review, ship, audit` (test-runtime supports all).

Two paths considered:

- (a) **Restrictive** (lean): declares gemini ineligible for all phases (matches stub reality); v0.1 personas still pass because they all use claude/codex/fake. The check has teeth from day one: a future config naming `gemini` as the BUILD provider fails at load time before the run starts (today: fails at `provider_gemini_not_yet_supported` runtime spawn — slower feedback loop).
- (b) **Additive** (every provider eligible for every phase by default): v0.1 is no-op until M12 starts using the eligibility surface meaningfully. Less churn now; less teeth.

**Pressure-test:** is "fail at load time vs runtime CLI spawn" a real win, or theater? The stub error message (`provider_gemini_not_yet_supported`) is already actionable. Does load-time rejection earn its scope cost?

### Decision C — `ProviderCapability` field set: minimal vs complete

**My lean: minimal-with-forward-compat-slots.** v0.1 ships:

```ts
interface ProviderCapability {
  readonly authSource: AuthSource              // bounded enum, see Decision E
  readonly eligiblePhases: readonly AgentPhase[]
  readonly costPerMTok?: { input: number; output: number }   // optional advisory
  readonly rateLimits?: ProviderRateLimits     // optional advisory
  readonly editSemantics: 'none' | 'apply-patch'   // forward-compat slot
  readonly shellSemantics: 'none' | 'argv-only'    // forward-compat slot
  readonly mcpSupport: 'none' | 'host'              // forward-compat slot
  readonly sandboxProfile: 'none' | 'cwd-isolated' | 'cli-sandbox'   // forward-compat slot
}
```

Two paths considered:

- (a) **Minimal-with-forward-compat-slots** (lean): records all eight ROADMAP-named traits as enums. v0.1 declarations are uniform across claude/codex/fake (`apply-patch` / `argv-only` / `none` / `cli-sandbox`-or-`cwd-isolated`); divergence comes in W3+ HTTP adapters. Honest about v0.1 reality (the runtime is uniform); honest about the trait having a home.
- (b) **Strict-minimal**: only ship `authSource` + `eligiblePhases` + optional `costPerMTok` + optional `rateLimits` in M11. Defer `editSemantics`/`shellSemantics`/`mcpSupport`/`sandboxProfile` to W3+. ROADMAP names them but they're not load-bearing for v0.1 eligibility.
- (c) **Complete**: ship the four forward-compat slots as **declared but enforced**. Personas must request `tool_use.write` only from providers whose `editSemantics ≠ 'none'`. Adds load-time teeth at the cost of more validation surface.

**Pressure-test:** the empirical truth (v0.1 runtime is provider-uniform) makes (a)'s slots feel decorative. Does (b)'s strict-minimal actually serve M11's "load-time rejection of impossible role assignments" boundary better, since the only real impossibilities in v0.1 are gemini-stub and authSource mismatches? Or does (a) earn its slot cost by giving W3 a place to land without contract churn?

### Decision D — Doctor's role: load-time only vs preflight probe

**My lean: load-time only in M11.** `code-oz doctor providers` keeps its M4 contract unchanged: `health()` is auth-and-availability only, no capability probe. Eligibility is statically declared and checked at agent-load time.

Two paths considered:

- (a) **Load-time only** (lean): capability is a static fact; no runtime probe. Doctor's exit policy unchanged. Eligibility error surfaces via `AgentLoadError` at run start.
- (b) **Preflight probe**: doctor (or run-preflight) calls a new `IAgentProvider.probe(): Promise<ProbedCapability>` to verify the declared capability matches the upstream CLI's actual reality (e.g., `claude --version` reports a model that supports the declared `editSemantics`). Adds runtime-divergence detection at the cost of new I/O during preflight.
- (c) **Hybrid: declared-static + opt-in `--probe` flag on doctor**: declare-and-check by default; offer escape-hatch probe for diagnostic purposes only.

**Pressure-test:** v0.1 runtime is provider-uniform (no real divergence to probe), so (b) is theater. (c) is API surface for an empirical question that doesn't exist yet. (a) is the rule-20-tight choice. Does (c) earn its scope by giving the W3 HTTP-adapter milestone a probe seat?

### Decision E — `authSource` enum granularity

**My lean: subscription-first specificity.** `authSource: 'claude-max-cli' | 'chatgpt-plus-or-pro-cli' | 'gemini-cli-stub' | 'in-process-fake'`. Mirrors the auth-source rows in `PROVIDERS.md`'s table. Codex's "Plus or Pro" is bundled because the subscription tier is opaque to code-oz (the upstream CLI handles it).

Three paths considered:

- (a) **Subscription-first specificity** (lean): names the actual subscription product. Documents the user's auth path. Forward-compat for W3+ HTTP adapters: add `claude-anthropic-api-oauth-pkce`, `codex-chatgpt-backend-oauth-pkce`, etc.
- (b) **Generic categories**: `'cli-subprocess' | 'http-oauth' | 'stub' | 'fake'`. Less specific; less coupling to product names that may rebrand.
- (c) **Mirrored to `ProviderId`**: `'claude-cli' | 'codex-cli' | 'gemini-stub' | 'fake'`. Coupled to current adapter implementation choice; loses subscription information.

**Pressure-test:** product names rebrand (Claude Max could become Claude Pro tomorrow). Is (a)'s clarity worth the rename risk? Or does (b)'s generic enum better honor the "code-oz never knows what platform-specific storage backend" spec rule? The reference doc already abstracts this (`provider-contract.md` § Auth model: "code-oz spawns the CLIs and lets them handle their own token storage / refresh / expiry").

### Decision F — Sandbox profile: per-provider only, or per-phase override seat

**My lean: per-provider only in M11.** `sandboxProfile` is a fact of the upstream CLI (`codex exec --sandbox read-only` is fixed when the adapter spawns). Per-phase differentiation isn't requested by any v0.1 caller. M14 reviewer-panel may eventually want phase-level granularity (same provider, different sandbox per role), but that's M14+ scope.

Two paths considered:

- (a) **Per-provider only** (lean): `ProviderCapability.sandboxProfile` is a single value. Rule 21: no parallelism without measurable need; same logic for granularity.
- (b) **Per-phase override seat**: `ProviderCapability.sandboxProfile` is `{ default: SandboxProfile; perPhase?: Partial<Record<AgentPhase, SandboxProfile>> }`. Forward-compat for the (hypothetical) M14+ case where a reviewer panelist needs a tighter sandbox than the same provider's builder.

**Pressure-test:** does (a) violate rule 20 by foreclosing M14's option, or does it correctly defer until M14 has a measured need? CLAUDE.md rule 21 reads as the baseline; new granularity earns its keep against measured single-axis pain.

### Decision G — Forward-compat hook for M12 company roster

**My lean: M11 ships eligibility check anchored on `phase`. M12's company roster (when it lands) introduces a config-side `company:` block mapping role → provider+model+budgets+permissions; M12's load-time check reads `(role.providerId, agent.phase)` and runs the same `eligiblePhases.includes(agent.phase)` check.** No M11 hook needed; M12 builds on the existing surface.

Two paths considered:

- (a) **No hook in M11; M12 reads the same surface** (lean): rule-20 clean. M11 ships only what M11's authority requires. M12 reuses the eligibility lookup function (`isProviderEligibleForPhase(providerId, phase, registry)`).
- (b) **M11 ships a `roleEligibility` shape that M12 consumes**: e.g., declare `eligibleRoles: readonly RoleName[]` on each `ProviderCapability` even though no roles exist yet. M12 lands the role names and the check uses them.

**Pressure-test:** (a) is rule-20 clean but defers a name-decision to M12. (b) preempts the name-decision and risks bundling M12's authority. Should M11 stay narrow even if it costs M12 some refactor?

### Decision H — Test seams beyond `capabilityOverrides`

**My lean: `capabilityOverrides` constructor field on `ProviderRegistry` (mirrors `familyOverrides`) is sufficient.** Tests pass a partial map; runtime defaults from `DEFAULT_CAPABILITY_BY_ID`. FakeProvider declares its own static `capability` matching the registry default; tests that need divergent FakeProvider capability override at the registry layer.

Two paths considered:

- (a) **Constructor override only** (lean): one seam, mirrors `familyOverrides`, parallel pattern. Test ergonomics already validated by M9.
- (b) **Constructor override + per-test FakeProvider builder**: e.g., `new FakeProvider({ capability: { eligiblePhases: ['build'] } })`. More ergonomic for narrow phase-eligibility tests but adds a second seam for the same data.

**Pressure-test:** does (b)'s ergonomic win earn the second seam, or does it dilute the "one source of truth per concern" pattern? M9 stuck with constructor-only and it worked; the parallel argument applies to capabilities.

---

## The recommended path

A 7-commit M11 sequence absorbing the locked decisions. Pre-debate; expect Codex pressure on Decisions A-H to reorder or compress.

1. **Pin contracts.** Extend `docs/references/provider-contract.md` with the canonical `ProviderCapability` TypeScript shape (per Decision C lean: minimal-with-forward-compat-slots) + a § "Capability and eligibility" section explaining the load-time rejection seam. Extend `docs/contracts/PROVIDERS.md` with a thin user-facing per-provider table (name, family, authSource, eligiblePhases, advisory cost/rate-limit summary). Cite this briefing's thread id in a "## M11 update" comment.

2. **Defaults module.** Add `src/providers/capabilities.ts` paralleling `families.ts`: pure `DEFAULT_CAPABILITY_BY_ID: Readonly<Record<ProviderId, ProviderCapability>>` + `capabilityOf(id): ProviderCapability` function. Frozen, declarative, no I/O, no test seams.

3. **Adapter capability fields.** Add `readonly capability: ProviderCapability` to `IAgentProvider` (`src/providers/types.ts`); each adapter class (`claude.ts`, `codex.ts`, `gemini.ts`, `fake.ts`) declares its capability statically by reading from `capabilityOf(this.id)` (so adapter source doesn't duplicate the data — single source of truth stays in `capabilities.ts`). Existing `family` field stays untouched.

4. **Registry capability authority.** Extend `ProviderRegistry`: optional `capabilityOverrides` constructor field; new `capabilityOf(id)` instance method seeded from `DEFAULT_CAPABILITY_BY_ID` then layered with overrides. Existing constructor adapter validation gains a parallel cross-check: `adapter.capability` must equal `capabilityOf(adapter.id)` (with overrides applied) — same anti-laundering pattern as the family check.

5. **Loader eligibility check.** Extend `src/agents/load.ts` (or add `src/agents/eligibility.ts` consumed by load.ts) with `validateEligibility(loadedAgents, registry): AgentLoadIssue[]` — for each agent, asserts `registry.capabilityOf(agent.provider).eligiblePhases.includes(agent.phase)`. Failures surface as `AgentLoadIssue { code: 'provider_role_not_eligible', rule, detail, file }` aggregated into the existing `AgentLoadError`. Run before bootstrap returns.

6. **Provider error code addition.** Add `provider_role_not_eligible` to the `ProviderErrorCode` union in the canonical reference doc and any TS union site (none currently in `src/providers/types.ts` — error codes are string literals on `ProviderErrorIssue.code`). Audit the actionableSuggestions on the load-time issue: name the offending persona's file path, the provider's declared eligibility list, and a fix hint ("change `provider:` in <file> to one of: <list>").

7. **Tests.** Expand `tests/providers-registry.test.ts` (or add `tests/provider-capabilities.test.ts`) with capability defaults, registry overrides, adapter-cross-check rejection of misregistered capability, eligibility rejection at load time (gemini-as-builder), eligibility pass for v0.1 default personas. Expand `tests/doctor.test.ts` to confirm doctor's contract is unchanged (no probe; same exit policy). FakeProvider tests confirm constructor seams. Acceptance: `bun test` ≥ 1761 + ~30-50 new tests, `bun run typecheck` clean.

Tag at sequence end: `v0.11.0-alpha.0`.

NOT in M11: company roster (M12), per-role budget gating (M13), reviewer panel (M14), debate-policy scheduler (M15), Researcher phase-tail (M16+), HTTP-adapter capability divergence (W3+), `--probe` doctor flag (deferred per Decision D unless flipped).

---

## Decision prompts (for your reply)

For each numbered decision A-H, tell me:

1. Verdict: `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications`. (Per CLAUDE.md rule 7 verdict enum, planning-debate side.)
2. Where I disagree (with specific alternative) — name the path you'd flip to and the load-bearing reason.
3. Risks the proposing side missed — especially around rule 20 scope, rule 21 parallelism, or M12-M15 forward-compat foreclosure.
4. Decisions you must lock before code — anything you think is currently up-for-debate but should be pinned in the synthesis doc before commit 1 lands.

Then, an overall verdict on the **7-commit recommended path** (same enum). Especially: is the sequence correctly minimal, or should commit 7 (tests) interleave earlier? Is commit 4 (registry capability authority) correctly separable from commit 3 (adapter capability fields), or should they bundle?

Then, **the meta-question**: is M11 too thin? The empirical truth (v0.1 runtime is provider-uniform; only stub-gemini and authSource have real eligibility teeth) makes M11 feel like metadata recording + thin load-time check. Per rule 20, that's correct — one authority boundary per milestone. Per rule 21, no parallelism gets bundled in. But does the milestone earn its tag? Or should something M12-adjacent (e.g., the company roster scaffold) move forward to make M11 less thin? If you flip toward bundling, name the load-bearing reason rule 20 should bend.

---

## What I want from you

1. **Pressure-test the leans.** Where my reasoning is rationalization or motivated by familiarity rather than load-bearing logic, name it. Especially: am I correctly treating "provider-uniform v0.1 runtime" as load-bearing (Decision C), or am I excusing forward-compat slot bloat?

2. **Catch foreclosure of M12-M15.** Per the M7-M10 shape lesson, the worst failure mode of pre-implementation thinking is bundling N+1's authority into N. Is anything in the recommended path quietly preempting M12's company roster, M13's role-cost gating, M14's panel, or M15's scheduler?

3. **Catch hidden parallelism.** Rule 21: no new parallel-provider surface without measurable risk reduction. M11 should ship zero new parallel surface. If anything in the recommended path is sneaking parallelism in (e.g., via a probe that runs against multiple providers concurrently), flag it.

4. **Catch substrate drift.** M11 extends `provider-contract.md` and `PROVIDERS.md`. The M9 review pattern (`registry.familyOf` as single source of truth + adapter cross-check + family substrate file) is the model M11 mirrors. Anything in the recommended path that drifts from this pattern?

5. **The verdict matrix.** Decisions A-H. Then the recommended-path overall. Then the thinness meta-question.

Per CLAUDE.md rule 9: your verdict is data, not authority. I'll synthesize into `docs/research/SESSION_M11_KICKOFF.md` (or `docs/design/SESSION_M11_KICKOFF.md` per the historic `SESSION_M*_KICKOFF.md` pattern), lock the absorbed decisions, keep the disputed-but-deferrable ones in an open-list, and start commits.

Thread id will be appended after the call. Sandbox: read-only.
