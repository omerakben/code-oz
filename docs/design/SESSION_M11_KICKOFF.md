# M11 Session Kickoff — Provider capability contract

**Date:** 2026-05-01
**Branch:** `feat/m11-provider-capability` (cut from `main` at `c870d06`)
**Tag at completion:** `v0.11.0-alpha.0`
**Authority boundary (rule 20):** provider eligibility
**Codex debate:** [`docs/research/CODEX_BRIEFING_M11.md`](../research/CODEX_BRIEFING_M11.md) → [`docs/research/CODEX_RESPONSE_M11.md`](../research/CODEX_RESPONSE_M11.md), thread `019de44e-e8a7-7441-9d82-d79a0595f591`. Verdict: `accept-with-modifications`.

## What changed after Codex round

Codex's verdict was `accept-with-modifications` overall, with three substantive flips and four red-flag catches that would have shipped as bugs without the round. Synthesis absorbs every Codex modification.

### Decisions absorbed (locks)

| # | Decision | Final lock |
|---|---|---|
| A | Eligibility shape | **list-on-provider.** `eligiblePhases: readonly AgentPhase[]` per `ProviderCapability`. No stored reverse map; reverse lookups are derived. (Risk: a stored hybrid would drift and quietly serve M14 before M14 earns it.) |
| B | Default eligibility | **restrictive.** `claude` / `codex` / `fake` get all `AGENT_PHASES`; `gemini` gets `[]`. Lock semantics: eligibility means "provider may run an agent for this phase," not "the phase runtime exists." |
| C | Capability field set | **strict-minimal.** TS shape carries `authSource`, `eligiblePhases`, optional `costPerMTok`, optional `rateLimits`. **Drop `editSemantics`, `shellSemantics`, `mcpSupport`, `sandboxProfile` from the v0.1 TS shape entirely.** Document them as deferred W3 contract territory in prose. Load-bearing reason: v0.1 `tool_use` runtime is provider-uniform; decorative slots become accidental enforcement hooks. |
| D | Doctor's role | **load-time only.** No `--probe` flag; no capability probe in `health()`. Doctor's M4 contract unchanged. |
| E | `authSource` enum | **mechanism-specific.** Values: `'claude-cli-oauth' \| 'chatgpt-cli-oauth' \| 'gemini-stub' \| 'in-process-fake'`. SKU/subscription names live in prose, never in the TS enum (Max / Plus / Pro are outside the code-oz trust boundary). |
| F | Sandbox profile | **deferred entirely.** Consequent of the strict-minimal C: no `sandboxProfile` field in M11. Document as deferred W3 trait. |
| G | M12 forward-compat hook | **none.** M11 checks `(provider, phase)` only. M12 may map roles to phases later; M11 ships no `eligibleRoles` or role naming. |
| H | Test seam | **constructor `capabilityOverrides` only.** With **structural equality** (deep value comparison) for the adapter-vs-registry capability cross-check, NOT reference equality. Composite objects need structural; `family` was a primitive string. No `FakeProvider({ capability })` second seam. |

### Codex catches that would have shipped as bugs

These were not in the briefing's open-list; they are loader-namespace-correctness issues Codex caught.

1. **Error code namespace.** Briefing proposed `provider_role_not_eligible` as a new `ProviderErrorCode`. The failure is load-time, not runtime; the existing union for load-time failures is `AgentLoadErrorCode` in `src/agents/errors.ts`. The word "role" preempts M12 vocabulary. **Final lock: `loader_provider_phase_not_eligible`** added to `AgentLoadErrorCode`, mirroring the existing `loader_cross_family_violation` precedent.
2. **Loader file name.** Briefing said `src/agents/load.ts`. The actual file is `src/agents/loader.ts`. **Final lock: extend `src/agents/loader.ts`.**
3. **Loader dependency.** Briefing implied loader could call `ProviderRegistry.capabilityOf()`. Loader runs before any registry exists. **Final lock: loader imports pure `capabilityOf()` from `src/providers/capabilities.ts`**, mirroring the existing `familyOf()` import pattern (the load-time/runtime split is already proven in M9).
4. **`actionableSuggestions` does not exist on `AgentLoadIssue`.** Briefing assumed it could attach actionable suggestions to the load-time issue. The `AgentLoadIssue` shape is `{ file, code, rule, detail? }` only. **Final lock: M11 does NOT add `actionableSuggestions` to `AgentLoadIssue`.** The eligibility issue's `rule` and `detail` fields carry the fix hint (e.g., `rule: "agent's provider is not eligible for the agent's phase"`, `detail: "agent file=..., provider=gemini, phase=build, eligible phases for gemini=[]"`). If a future milestone needs structured suggestions on loader issues, it adds the field deliberately — not smuggled through M11.
5. **Cost/rate-limit data freshness.** Concrete dollar/token values rot fast. **Final lock: M11 records cost/rate-limit fields as optional with explicit `unknown` placeholders for any provider whose value is not verified at the milestone date.** Each populated value carries a dated source comment in `src/providers/capabilities.ts` (e.g., `// per CLAUDE.md model reference, 2026-04-30`).

### What stays locked from the briefing (unchanged by Codex)

The 14 locked bullets in the briefing's "What is locked" section all stand, with one renaming clarification:

- Lock #10 in the briefing referenced `provider_role_not_eligible`. After Codex, this is `loader_provider_phase_not_eligible` (loader namespace, no "role" vocabulary).
- All other locks (capabilities live in `src/providers/capabilities.ts`; canonical TS shape in `provider-contract.md`; thin user-facing summary in `PROVIDERS.md`; `IAgentProvider` gains static `capability` field; registry adapter cross-check; subscription-first auth preserved; `health()` unchanged; advisory cost/rate-limits; cross-family REVIEW + Debate untouched; FakeProvider test compatibility; universal rules sheet unchanged; no company roster) stand.

## Final commit sequence (4 commits, revised from briefing's 7)

Codex flipped the test discipline: tests interleave per commit, not as a final test-only commit. Codex also bundled what the briefing called commits 3 + 4 into one anti-laundering unit. Result is 4 commits.

### Commit 1 — Pin contracts

Files:
- `docs/references/provider-contract.md` — extend with strict-minimal `ProviderCapability` TypeScript shape, § "Capability and eligibility" section explaining the load-time rejection seam, deferred-W3-traits prose for `editSemantics`/`shellSemantics`/`mcpSupport`/`sandboxProfile`. Reference thread `019de44e`.
- `docs/contracts/PROVIDERS.md` — extend with thin user-facing § "Provider capabilities" table (provider, family, authSource enum value, eligiblePhases summary, advisory cost/rate-limit footnote with dated source).
- `docs/research/CODEX_BRIEFING_M11.md` (already on disk) and `docs/research/CODEX_RESPONSE_M11.md` (already on disk) bundled into commit body.

No code changes. No tests (pure docs).

Acceptance: `docs/references/provider-contract.md` carries the canonical TS shape; `docs/contracts/PROVIDERS.md` reads cleanly to a non-implementer.

### Commit 2 — Defaults module + tests

Files:
- `src/providers/capabilities.ts` (new) — pure `DEFAULT_CAPABILITY_BY_ID: Readonly<Record<ProviderId, ProviderCapability>>` + `capabilityOf(id): ProviderCapability` function. Mirrors `families.ts` exactly: frozen object, throws on unknown ids, no I/O, no test seams. Each populated cost/rate-limit value carries a dated source comment.
- `tests/provider-capabilities.test.ts` (new) — every provider has a declared capability; `gemini` has `eligiblePhases: []`; `claude`/`codex`/`fake` have full `AGENT_PHASES`; `capabilityOf('unknown')` throws; frozen object cannot be mutated; cost/rate-limit fields are either `unknown` placeholder or dated.

Acceptance: `bun test tests/provider-capabilities.test.ts` passes; `bun run typecheck` clean.

### Commit 3 — Adapter capability + registry capability authority (bundled)

Files:
- `src/providers/types.ts` — add `readonly capability: ProviderCapability` to `IAgentProvider`.
- `src/providers/{claude,codex,gemini,fake}.ts` — each adapter declares `readonly capability = capabilityOf(this.id)` (single source of truth stays in `capabilities.ts`).
- `src/providers/registry.ts` — add `capabilityOverrides?: Readonly<Partial<Record<ProviderId, ProviderCapability>>>` to `ProviderRegistryOptions`; add `capabilityOf(id): ProviderCapability` instance method seeded from `DEFAULT_CAPABILITY_BY_ID` then layered with overrides; extend the constructor's adapter validation with a parallel cross-check: `adapter.capability` must match the registry-resolved capability under **structural equality** (deep value comparison via existing helper or new `equalsCapability`), with the same anti-laundering error message pattern as the family check.
- `tests/providers-registry.test.ts` — extend with capability defaults, registry overrides, adapter-cross-check rejection of misregistered capability (structural inequality), `FakeProvider`'s declared capability matching registry default.

Acceptance: `bun test tests/providers-registry.test.ts tests/provider-capabilities.test.ts` passes; `bun run typecheck` clean. M9/M10 e2e tests still pass.

### Commit 4 — Loader eligibility check + tests

Files:
- `src/agents/errors.ts` — add `loader_provider_phase_not_eligible` to `AgentLoadErrorCode` union.
- `src/agents/loader.ts` — extend with `enforceProviderPhaseEligibility(definitions): void` step that for each loaded agent imports pure `capabilityOf` from `src/providers/capabilities.ts` and asserts `capabilityOf(agent.provider).eligiblePhases.includes(agent.phase)`. The check also walks any persona's `tool_use.debate.opposingProviders` and asserts each is eligible for the persona's phase, closing the M10 synthetic-debate-opponent bypass per Codex CODEX_REVIEW_M11.md bp#1 (thread `019de46d-b8c9-7f13-8257-81b572121306`). Failures aggregate into the existing `AgentLoadError` issues array. Runs before bootstrap returns.
- `tests/agent-loader-eligibility.test.ts` (new) — gemini-as-builder fails with `loader_provider_phase_not_eligible` and an actionable `rule` + `detail` payload; v0.1 default personas (ba/lead/scientist/builder/verifier/reviewer) all pass; the issue is collected alongside other load-time issues (multi-issue aggregation works).
- `tests/agents-loader.test.ts` (existing) — extend assertions to confirm the new check runs in the load chain without breaking existing chain.

Acceptance: full test suite ≥ 1761 + ~30-50 new tests passing; `bun run typecheck` clean.

## Open follow-ups (parking lot, not M11 scope)

Each of these is a future-milestone hook, not a deferred M11 deliverable.

- **M12 — Company roster:** `.code-oz/config.yaml` `company:` block mapping role → provider+model+budgets+permissions. M12's load-time check reuses `capabilityOf(providerId).eligiblePhases` (the existing surface). No M11 hook required.
- **M13 — Role-cost policy:** consumes `costPerMTok` and `rateLimits` advisory fields populated in M11 under existing `budgets.global` namespace. No new namespace.
- **W3 — HTTP-adapter divergence:** when opencode-style OAuth+PKCE adapters land for Codex (and equivalent for Claude), they will declare divergent capability records. The deferred traits (`editSemantics`, `shellSemantics`, `mcpSupport`, `sandboxProfile`) gain TS field shape at that milestone, not in M11.
- **Real Gemini support (W3+):** when Gemini's adapter ships, `capabilityOf('gemini')` flips from `eligiblePhases: []` to the appropriate list. The eligibility check stays unchanged.

## Carried-over deferred items (not M11)

- **M10 n#1 (deferred 2026-05-01):** `extractDebateRequest` line-anchored tag detection in `src/tools/debate-request-extract.ts`. Wait for a real persona response to trip it.
- **M9 audit M1 + M2 (deferred 2026-05-01):** duplicate parsing helpers across `src/artifacts/*.ts`. DRY-at-3x not yet triggered. If commit 1's contract docs introduce a third parsing helper (they should not), revisit.

## Verification checklist before tag

- [ ] All four commits land in order on `feat/m11-provider-capability`.
- [ ] `bun test` passes ≥ 1761 + new tests; `bun run typecheck` clean.
- [ ] M9 e2e tests still pass (cross-family REVIEW unchanged).
- [ ] M10 e2e tests still pass (Debate runtime unchanged).
- [ ] No new parallel-provider surface (rule 21).
- [ ] No new persona-side frontmatter field (rule 20: M11 ships only the eligibility authority boundary).
- [ ] Codex implementation review (rule 8): block-push and block-next-milestone severity findings closed before tag.
- [ ] Tag `v0.11.0-alpha.0`. Update `CLAUDE.md` status line and the auto-memory `m11_progress.md`.

## Why this milestone earns its tag (synthesis answer to the thinness question)

Codex's verdict on the thinness meta-question: **scoped, not too thin.** M11 earns its tag because it creates the provider eligibility authority and moves `gemini`-as-builder failure from runtime CLI spawn (slow feedback) to load-time rejection (fast feedback) without adding any new parallel-provider surface. Per Codex: "the only reason rule 20 should bend would be if eligibility could not be exercised without a roster, and that is false: current personas already declare `provider` and `phase`."

Bundling M12's company roster forward would violate rule 20 and bring no measurable risk reduction, only authority creep.
