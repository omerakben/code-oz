# code-oz — xAI provider expansion (roadmap-scoped briefing)

**You are gpt-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M11 closed minutes ago (v0.11.0-alpha.0; provider eligibility authority; 1860 offline tests; merged to main locally, not yet pushed to origin). The post-M10 productization sequence has been M12 = Company roster → M13 = Role-cost → M14 = Reviewer panel v1 → M15 = Debate-policy scheduler v1 (locked 2026-04-30 by the product thesis pressure-test).

This is a **roadmap-scoped** briefing, not a milestone-scoped one. Ozzy's friends are asking for xAI access via direct HTTP and via routed providers (Azure AI Foundry, AWS Bedrock, Google Vertex AI, OpenRouter, AI Gateway / LiteLLM / OpenAI-compatible). The pre-existing draft plan lives at `docs/research/XAI_PROVIDER_EXPANSION_PLAN_2026-05-01.md`. The plan is thoughtful but predates M11's ship; some of its specific proposals conflict with M11's just-locked decisions. Ozzy explicitly asked for cross-family debate on roadmap and implementation order before any code lands.

The purpose of this round: **lock the strategic decisions** (where xAI work goes in the milestone sequence; what authority boundaries it spans; how many providers in v0.1; family-resolution discipline under routing). Concrete adapter implementation belongs to a per-milestone planning round each. This round is the architecture-level convergence.

**Ozzy's framing of the demand:** "real needs from many friends ... the demand is more than [Anthropic + OpenAI + Gemini]". This is a market-signal-driven scope expansion, not a tech-debt cleanup. Per CLAUDE.md rule 21 (no parallel-provider surface without measurable risk reduction), the demand is the measurable signal — but the rule also says the simpler workflow beats the complex agent system unless complexity earns its keep. The friction here is between "satisfy real demand fast" and "preserve the empirical authority-boundary discipline that has worked through M2-M11."

Mirror the verdict format from `CODEX_RESPONSE_M11.md`: numbered decisions, `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications` per the DEBATE.md planning-debate verdict enum; "Where I agree", "Where I disagree (with specific alternative)", "Risks the proposing side missed", "Decisions you must lock before code".

---

## What you should already have read

- **`docs/research/XAI_PROVIDER_EXPANSION_PLAN_2026-05-01.md`** — the user's draft plan. Note the dates: it was authored before M11 shipped. The "Phase 1 (M11): capability contract extension" framing assumed M11 was open scope. It is not.
- **`CLAUDE.md`** non-negotiable rules 1-21. Especially:
  - Rule 1 (file-based gates) — every adapter call still goes through the same wrapper + manifest discipline.
  - Rule 2 (cross-family REVIEW) — the load-bearing reason family-resolution under routing matters.
  - Rule 7 (Codex debate at planning convergence) — this round.
  - Rule 13 (privacy by default) — v0.1 adapters use empty-cwd + stdin-piped manifest + `--no-session-persistence` / `--sandbox read-only`. HTTP transport does not get those guards by default; the wrapper-level path-safety + permissions intersection still applies, but the trust boundary changes.
  - Rule 19 (`budgets.global` enforcement) — provider-reported vs estimated tokens flow through the same `assertWithinBudget` chokepoint.
  - Rule 20 (one new authority boundary per milestone) — the discipline this round must respect.
  - Rule 21 (no parallel-provider surface without measurable risk reduction) — friends' demand is the measurable signal but does not waive the boundary discipline.
- **`docs/contracts/PROVIDERS.md`** post-M11 — subscription-first auth model; v0.1 limitations explicitly noted; § "Capabilities and eligibility (M11)".
- **`docs/references/provider-contract.md`** § "Capability and eligibility (M11)" — strict-minimal `ProviderCapability` shape; deferred-W3 traits documented in prose; anti-patterns rejected.
- **`src/providers/capabilities.ts`** — the locked v0.1 shape: `authSource | eligiblePhases | costPerMTok? | rateLimits?`. No `transport`, no `editSemantics`, no `shellSemantics`, no `mcpSupport`, no `sandboxProfile`.
- **`src/providers/types.ts`** + **`src/providers/{registry,families}.ts`** + **`src/agents/loader.ts`** — adapter cross-check, family substrate, load-time eligibility.
- **`docs/design/ROADMAP.md`** § "Beyond v0.1" § "Post-M10 productization" — locked sequence M11 → M12 → M13 → M14 → M15 → M16+ (deferred until measurable need).
- **`docs/research/CODEX_RESPONSE_M11.md`** — the Decision C flip (strict-minimal); Decision E (mechanism-not-SKU `authSource`); the rationale for each. The empirical-truth-as-load-bearing-constraint pattern is what should be tested again here.

---

## Where we stand

```
$ git log --oneline -3
1d188a5 docs: bump CLAUDE.md status line to v0.11.0-alpha.0 (M11 closed)
4a81716 Merge feat/m11-provider-capability: M11 Provider capability contract (v0.11.0-alpha.0)
f5763d4 docs(m11): close Codex M11 round-2 nits — DEBATE.md M11 narrowing + stale gemini test fixture

$ git tag -l v0.* | wc -l
12   # v0.1.0-alpha.0 ... v0.11.0-alpha.0

$ git status
On branch main
Your branch is ahead of 'origin/main' by 8 commits.
nothing to commit, working tree clean

$ bun test
1860 pass / 1 skip / 0 fail (offline)
$ bun run typecheck
clean
```

What works:
- DEFINE → PLAN → BUILD → VERIFY → REVIEW spine end-to-end (FakeProvider offline + live Claude+Codex CLI subprocess providers).
- Subscription-first auth: `claude` adapter spawns `claude --print --no-session-persistence`; `codex` adapter spawns `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never`; both pipe manifest content via stdin from empty `mkdtemp()` cwd.
- Cross-family REVIEW (M9) + Debate runtime (M10) + provider eligibility (M11) — three layers of authority over the four-provider registry (`claude | codex | gemini | fake`).
- gemini stub: `invoke()` throws `provider_gemini_not_yet_supported`; M11 added load-time rejection of any persona declaring `provider: gemini` (via `eligiblePhases: []`).
- Manifest discipline: every provider call goes through `src/providers/manifest.ts` for path-safety + permissions intersection.

What's stubbed or deferred:
- gemini real adapter: stub. Lands in W3+.
- HTTP-based adapter (no CLI subprocess): NEVER built. The `IAgentProvider` contract is transport-agnostic, but no adapter has yet exercised the HTTP path.
- Multi-cloud (Azure/Bedrock/Vertex): NEVER built. Each implies a different auth + region + model-catalog discipline.
- API key auth: NEVER built. `provider-contract.md` § Anti-patterns explicitly rejects "Reading or transmitting OAuth tokens" — but it is silent on API keys (which v0.1 currently doesn't accept either).

**Critical empirical truth that may shift under HTTP transport.** M11's Decision C lock — strict-minimal capability shape, no `editSemantics`/`shellSemantics`/`mcpSupport`/`sandboxProfile` TS fields — was load-bearing on the fact that v0.1 `tool_use` runtime is provider-uniform: the wrapper extracts tools from the persona response and applies them in-process or via orchestrator-side patch application or via subprocess test-runner, regardless of which provider produced the response. **HTTP-based adapters break this uniformity** if and only if their tool-use protocol differs (xAI Grok's tool calling, OpenRouter's normalized OpenAI-schema, LiteLLM's gateway passthrough). The Decision C strictness might still hold if the wrapper continues to extract tools from the response text, regardless of HTTP-vs-subprocess transport — but that's the question, not the answer.

---

## What is locked (not up for debate)

These come from CLAUDE.md, the M11 contract docs, and the locked post-M10 roadmap.

1. **`ProviderCapability` v0.1 TS shape stays strict-minimal.** Adding `editSemantics`/`shellSemantics`/`mcpSupport`/`sandboxProfile` is a Decision C reversal that requires a load-bearing reason. HTTP transport may or may not be that reason — see Decision D below. The defaults table in `src/providers/capabilities.ts` and the canonical contract in `docs/references/provider-contract.md` are the authority.
2. **Subscription-first auth principle.** `code-oz` should never assume it must read OAuth tokens or hold API keys it manages itself when there is a CLI option. For xAI: today there is no first-party CLI with subscription-OAuth like Claude Code or Codex CLI. The HTTP adapter is the only realistic path. The principle generalizes to "delegate auth to the upstream tool whenever possible; when no such tool exists, document the trust-boundary expansion explicitly."
3. **Cross-family REVIEW (rule 2) is non-negotiable.** Whatever family-resolution discipline lands for routed providers, it must close the cross-family invariant correctly. Failing open (admitting a cross-family-unknown reviewer) is not acceptable for `verdict: ready`.
4. **Cost/rate-limit are advisory in v0.1.** Enforcement is M13's role-cost policy under `budgets.global` (rule 19). New providers may report cost data via response metadata (provider_reported) or require estimation; this round lands shape, not enforcement.
5. **Privacy by default (rule 13) generalizes.** HTTP adapters still need explicit file manifests; the wrapper's path-safety + permissions intersection + symlink-escape rejection apply. The empty-cwd guard is subprocess-specific; HTTP adapters get a different shape (no upstream-CLI context-leak surface to guard against, but new outbound-HTTP-by-the-runtime trust boundary).
6. **Rule 20 (one authority boundary per milestone) holds.** xAI work cannot bundle "HTTP transport authority + lineage-resolution authority + multi-cloud auth authority + new capability shape" into one milestone. It needs to span multiple, each closing one boundary cleanly.
7. **Rule 21 (parallelism earns its keep) holds.** Adding multiple HTTP/routed providers does not by itself ship a new parallel-provider surface (e.g., reviewer panels, parallel builders); those remain M14+ scope. But care: if a routed adapter's normal path opens up a "fan-out call to multiple upstream providers" pattern, that crosses rule 21.
8. **Locked post-M10 sequence still has weight.** M12 = Company roster, M13 = Role-cost, M14 = Reviewer panel v1, M15 = Debate-policy scheduler v1. These were locked 2026-04-30 from the product thesis pressure-test (`019de031`). Reshuffling requires a load-bearing reason that this debate must surface explicitly, not assume.
9. **`registry.familyOf()` is the cross-family authority.** Whatever family-resolution discipline lands, it threads through this method. Adapters cannot bypass; persona-declared `provider` fields cannot be compared directly.
10. **CLAUDE.md rule 7 + rule 8 apply per milestone.** Each new milestone in the xAI work sequence runs its own planning-convergence Codex debate before code, then implementation review before tag. This roadmap-scoped round does not preempt those.
11. **Push posture.** The 8 local commits on `main` from M11 are not yet on `origin/main`. That push is pending Ozzy's explicit approval per CLAUDE.md rule 5. xAI work does not unblock or block the push — they are independent.

---

## What is up for debate

Nine decisions. Numbered for your reply.

### Decision A — Roadmap insertion strategy

**My lean: parallel "Provider expansion" track (PE-N) alongside the locked M12-M15 sequence.** Both demand-driven (PE-N closes friends' need) and authority-driven (M12-M15 closes the company's role coordination) work continues. Either track can pause if the other surfaces a blocker.

Three paths considered:

- (a) **Parallel PE track + keep M12-M15 sequence** (lean). PE-1 (xAI direct + HTTP transport authority) is independent of M12 (Company roster) — they touch different surfaces (PE on `src/providers/*`; M12 on `.code-oz/config.yaml` + `docs/contracts/COMPANY.md`). M12-M15 advance per their locked dependencies; PE-N runs its own planning + review cycle per milestone.
- (b) **Reshuffle: insert PE work between M11 and M12.** xAI work becomes M12; Company roster becomes M13+. Argument for: provider expansion is more demand-urgent than role coordination if friends are blocked on Grok access today. Argument against: violates the "locked 2026-04-30" sequence without a thesis-debate-level reason.
- (c) **Queue behind M15.** M12-M15 ship first; xAI work starts at M16. Argument for: maximum discipline. Argument against: 4-5 milestones of waiting on a real demand.

**Pressure-test:** is path (a)'s "two tracks running at once" actually a parallel-development surface that violates rule 21 (no parallel-provider surface without measurable risk reduction)? Or is it just two work streams on different files, which is normal git practice? Where is the line?

### Decision B — Family resolution under routing

**My lean: hybrid — id-as-default, lineage-when-adapter-declares-known.** Direct adapters (`xai`, `claude`, `codex`) have static family = id (the M9 discipline). Gateway adapters (`openrouter`, `gateway-openai`) have static family = the gateway's id (e.g., `family: 'openrouter'`) UNLESS the adapter exposes a per-call lineage field that the registry can resolve at call time. When lineage is unknown (gateway hides upstream), `familyOf` returns the gateway's family; cross-family REVIEW comparisons against direct providers (e.g., builder=claude, reviewer-via-openrouter-of-xai-grok) succeed if `openrouter ≠ claude` (which it does). Cross-family REVIEW against a SAME-ROUTED-LINEAGE pairing (builder=openrouter-of-claude, reviewer=openrouter-of-claude) fails open — the families are equal at the registry level, no laundering possible.

Three paths considered:

- (a) **Hybrid: id-as-default, lineage-when-known** (lean). Preserves M9's single-source-of-truth `familyOf()` for direct providers; adds optional per-call lineage hint for routed providers. Cross-family checks resolve as `(call.family, registry.familyOf(other))` where `call.family` falls back to `registry.familyOf(call.provider)` when lineage is unknown.
- (b) **Strict-id (current M9 discipline unchanged).** Routed providers always use their gateway id as family. `openrouter` always family `openrouter`, regardless of upstream model. Argument: simplest. Risk: a builder=claude vs reviewer=openrouter-of-claude pair would *pass* cross-family check structurally, but BE same-family operationally. False assurance.
- (c) **Lineage-only (per the plan's "family should reflect model lineage").** Family always derives from model lineage; gateway adapters require lineage in their response envelope. Argument: most rigorous. Risk: requires every gateway to expose lineage (some don't); requires per-call family resolution which breaks the registry's compile-time cross-check pattern.

**Pressure-test:** does (a)'s "lineage-when-known" create an attractive nuisance? An adapter that *could* declare lineage but doesn't (e.g., a buggy or older OpenRouter version) silently downgrades the cross-family proof. Should the adapter be required to declare lineage explicitly, with absent-lineage = adapter-not-installable (fail-closed), or absent-lineage = fall-back-to-id (fail-open)?

### Decision C — HTTP transport as a new authority boundary

**My lean: HTTP transport substrate is its own milestone (PE-1).** No concrete provider in PE-1; it ships only the substrate that future HTTP adapters depend on. Authority boundary closed: outbound HTTP from `code-oz` itself (vs CLI subprocess), trust-boundary documentation update, request/response logging discipline, network failure typed errors, basic doctor probe (HTTP reachability vs CLI presence).

Three paths considered:

- (a) **PE-1 substrate-only; PE-2 = first concrete HTTP provider** (lean). Two milestones. Substrate clean; provider clean.
- (b) **PE-1 = xAI direct adapter (substrate + provider bundled).** One milestone. Forces substrate + adapter to land together. Argument: faster to demonstrable working state. Risk: if xAI's specific quirks (rate limits, response shape, tool calling) leak into the substrate, future HTTP adapters inherit them.
- (c) **No substrate milestone — let each provider build its own HTTP path.** Argument: simplest; some shared utilities only, no new "authority boundary" per se. Risk: drift across adapters; the wrapper layer can't enforce uniform request/response logging/timeouts/typed errors.

**Pressure-test:** is "HTTP transport" really an authority boundary in the rule-20 sense, or is it more like "a tooling utility shared by future adapters"? The rule-20 test is "introduces a new gate or capability domain." HTTP-from-the-runtime IS a new capability domain (the runtime's first outbound-HTTP capability). The trust boundary expands. Argument FOR rule-20 boundary: the M11 capability contract explicitly defers `editSemantics`/`shellSemantics` because v0.1 runtime is provider-uniform; HTTP introduces the divergence those fields would have captured. Argument AGAINST: a substrate milestone with no concrete adapter is just plumbing; the boundary closes only when an adapter exercises it.

### Decision D — Capability shape extension, post-Decision-C-flip

**My lean: add only `transport: 'cli-subprocess' | 'http'` in PE-1.** No `editSemantics`/`shellSemantics`/`mcpSupport`/`sandboxProfile` until measurable divergence appears. The `transport` field is load-bearing for PE-1 because doctor probes differ (CLI presence vs HTTP reachability) and privacy-guard expectations differ (empty-cwd vs network egress).

Three paths considered:

- (a) **`transport` only, defer the four W3 fields** (lean). Strict-minimal discipline preserved. PE-1 doctor uses `transport` to dispatch the right probe.
- (b) **`transport` + `costTelemetryMode: 'provider_reported' | 'estimated' | 'unknown'`.** The plan proposes `costTelemetryMode`. M11's `costPerMTok` is omitted by default but typed; mode is ortho. Argument FOR: clarity for M13 consumption. Argument AGAINST: not load-bearing for PE-1; M13 can derive mode from presence/absence of cost data.
- (c) **`transport` + `editSemantics`/`shellSemantics`.** HTTP adapters with native tool-use protocols (xAI Grok's tool_calling, OpenAI-compat function-calling) DO diverge from the wrapper's response-text-extraction pattern in some configurations. Argument: anticipate the divergence and ship the slot. Risk: same Decision C bloat that Codex flipped against in M11 — if PE-1 doesn't yet exercise tool-call divergence, the slot is decorative.

**Pressure-test:** when does `transport` itself become decorative? If every future provider has `transport: 'http'`, the field carries no information. The field's purpose is the v0.1 split (subprocess CLI vs outbound HTTP); after PE-N when only HTTP providers ship, the field could collapse. But v0.1 has both, so the field has work to do.

### Decision E — `authSource` enum extension granularity

**My lean: per-mechanism specificity, mirroring M11's lock.** Add values like `'xai-api-key'`, `'openrouter-api-key'`, `'gateway-openai-key'`, `'azure-foundry-iam'`, `'aws-bedrock-iam'`, `'gcp-vertex-iam'`. Each is operationally distinct (env var name, header format, refresh discipline differ). Generic categories like `'http-api-key'` lose information that doctor probes need.

Two paths considered:

- (a) **Per-mechanism** (lean). 6+ new enum values across PE-1...PE-N. Each adapter declares its own. doctor probes per-value.
- (b) **Generic categories**: `'http-api-key' | 'cloud-iam' | 'gateway-key'`. 3 new values. doctor probes per-category with hooks for adapter-specific detail. Argument: cleaner enum; less SKU-style proliferation. Argument against: M11's exact lock was "mechanism-specific, not SKU-specific" — `'xai-api-key'` is a mechanism (it names what the adapter does to authenticate), not a SKU (xAI Plus/Pro tiers are not encoded). So per-mechanism specificity is the consistent posture.

**Pressure-test:** which is more honest about the trust boundary? `'xai-api-key'` says "code-oz is reading and transmitting an xAI API key" — a clear trust-boundary statement. `'http-api-key'` says "code-oz uses some HTTP API key for some provider" — less clear. The doctor-probe argument also favors specificity.

### Decision F — Cross-family REVIEW + Debate when lineage is hidden

**My lean: fail closed.** When a routed adapter cannot declare upstream lineage and is configured as a REVIEW reviewer (or Debate opposing party), the load-time check rejects the configuration with `loader_provider_lineage_unknown` (or extend `loader_provider_phase_not_eligible` with the lineage subcase). Cross-family proof requires resolvable lineage; opacity = ineligibility for those roles.

Two paths considered:

- (a) **Fail closed at load time** (lean). The persona's `provider: openrouter` for a REVIEW phase, where the OpenRouter adapter cannot declare lineage, fails before bootstrap returns. The friend's reaction: "but I want OpenRouter for review!" — answer: configure OpenRouter with a model selector that pins lineage, or use a different reviewer. The discipline is the same as M11's `gemini-as-builder` rejection: configuration error caught early.
- (b) **Fail open with audit warning.** Allow the run; emit a `cross_family_lineage_unverified` event to `events.jsonl`; record the unresolved lineage as forensics. Argument: more flexible. Risk: rule 2's load-bearing reason ("structurally cannot catch the bugs cross-family review catches") is exactly what gets eroded.

**Pressure-test:** is "fail open with audit" actually rule-2-compatible? The audit catches the issue post-hoc; rule 2 is about catching it pre-emptively. The same logic that makes load-time eligibility better than runtime CLI-spawn (M11 bp#1) makes load-time lineage-required better than audit-only.

### Decision G — Cost telemetry shape

**My lean: defer to M13.** M11 left `costPerMTok` and `rateLimits` typed but omitted on every default. PE-1 ships `transport` (Decision D) but does NOT add cost-mode fields. Concrete dollar/token data is M13's contract — that's the role-cost policy milestone. PE-N adapters that have provider-reported cost data record it on `agent_completed.tokensUsed` per the existing M4 contract; that's already the path.

Two paths considered:

- (a) **Defer to M13** (lean). Cost-mode is M13 surface. PE-N doesn't add a new field.
- (b) **Add `costTelemetryMode` now**. Argument: PE-N adapters need to know whether to estimate or trust. But the `tokensUsed?` optional field on `agent_completed` already encodes this — present means provider-reported, absent means estimated. The mode field is redundant.

**Pressure-test:** is the existing `tokensUsed?` optional really sufficient, or does it conflate "provider reports it" with "we got it this call but might not next call"? If a provider reports tokens 90% of the time and falls back to estimation 10%, `tokensUsed?` is per-call accurate but doesn't tell M13 "this provider's cost telemetry is mostly trustworthy." That might warrant a mode field — but that's a M13 design question, not a PE-N field.

### Decision H — Multi-cloud (Azure / Bedrock / Vertex) scope

**My lean: defer entirely to v0.2.** Each cloud-route is a separate auth + region + catalog discipline. Each implies a substantial trust-boundary expansion (cloud IAM tokens; region pinning; deployment names that differ from model names). v0.1's simplicity (subscription-first plus narrow HTTP for direct + OpenRouter + Gateway) is what makes the architecture comprehensible. Adding three cloud-route adapters in v0.1 dilutes the "this works because the surface is small" argument.

Three paths considered:

- (a) **Defer all three to v0.2** (lean). v0.1 ships PE-1 (HTTP substrate + xAI direct), PE-2 (OpenRouter), PE-3 (LiteLLM gateway). Cloud routes are post-MVP.
- (b) **Pick one (Azure Foundry) as v0.1 proof-of-concept.** Argument: shows enterprise viability. Risk: each cloud's auth is enough work to be its own milestone; one is not "the proof," it's "one milestone."
- (c) **All three behind capability flags, as the plan suggests.** Argument: optimistic. Risk: capability flags become a long-tail of half-baked adapters with unique error modes. Maintenance debt.

**Pressure-test:** is "defer to v0.2" too conservative if friends specifically asked for Azure/Bedrock? The honest answer is "what specifically did they ask for?" — without that signal, deferring to v0.2 is the discipline-preserving move. The plan's own risk register lists "region mismatch for Azure/Bedrock/Vertex leading to runtime failures" as a top concern; v0.2 lets that concern be solved properly.

### Decision I — v0.1 fast-cut prioritization

**My lean: PE-1 = HTTP substrate + xAI direct (one milestone). PE-2 = OpenRouter (forces lineage debate). PE-3 = Gateway (LiteLLM/OpenAI-compatible).** v0.1 ships all three. Cloud routes (Decision H) are v0.2.

Three paths considered:

- (a) **PE-1 + PE-2 + PE-3 in v0.1** (lean). Three milestones, three new authority closures, three Codex debate cycles. Each ships demonstrable working state.
- (b) **Just PE-1 in v0.1.** Friends get xAI direct only. Argument: tightest scope. Risk: doesn't address the OpenRouter/Gateway demand which the plan suggests is broad.
- (c) **PE-1 + PE-2 only (skip Gateway in v0.1).** Argument: OpenRouter covers the broad model coverage; LiteLLM gateway is enterprise-flavor. Argument against: gateway is what unlocks self-hosting orgs.

**Pressure-test:** which of these three (xAI direct, OpenRouter, Gateway) is the *actual* friend ask, vs which is the plan's interpretation of "broad coverage"? Ozzy's framing was specific: "xAI as an individual provider and as multi-providers via Azure AI Foundry, AWS Bedrock, Google Vertex AI, OpenRouter, and AI Gateway." The friend signal is specifically xAI; the multi-provider routes are how to access it. So the v0.1 cut should optimize for "xAI access via the most-likely-friend-uses path." Without survey data, the safest cut is xAI direct (works for everyone with an xAI key) + OpenRouter (works for everyone with an OpenRouter account, broad model coverage). Gateway is more enterprise; cloud routes are most enterprise.

---

## The recommended path

A milestone sequence absorbing the locked decisions. Pre-debate; expect Codex pressure on Decisions A-I to reorder or compress.

**v0.1 work tracks (parallel):**

- **Track 1: Company roster sequence (M12-M15, locked).** Continues as planned. Per the locked roadmap. No xAI dependency.
- **Track 2: Provider expansion (PE-1 → PE-3).**
  - **PE-1: HTTP transport substrate + xAI direct adapter.** New authority: HTTP transport (`code-oz`'s first outbound-HTTP capability). New `transport` field on `ProviderCapability`. New `xai-api-key` `authSource` value. New `xai` provider id + family. Doctor probes HTTP reachability. Privacy-guard discipline for HTTP documented in `provider-contract.md` § Auth model. Cost telemetry: `tokensUsed?` only, no new field.
  - **PE-2: OpenRouter adapter + family-resolution discipline.** New authority: family-resolution under routing (Decision B). `openrouter` provider id, family `openrouter` by default; lineage hint optional per-call. Cross-family REVIEW + Debate consume the resolved family. Fail-closed for unresolved lineage in REVIEW/Debate roles.
  - **PE-3: Gateway adapter (LiteLLM / OpenAI-compatible).** New authority: configurable base URL + bring-your-own gateway. Authority surface: gateway-key auth, gateway health probe, model-list discovery contract.

**v0.2 work track (deferred):**

- **PE-4 / PE-5 / PE-6: Azure Foundry / AWS Bedrock / Google Vertex AI.** Each its own milestone. Cloud-IAM auth, region pinning, deployment-vs-model naming, residency scope. Per CLAUDE.md rule 20, each is its own boundary; do not bundle.

**v0.1 sequencing (Track 1 + Track 2 parallel, but each milestone serial within its track):**

```
M11 (closed) → M12 ── M13 ── M14 ── M15 ── (v0.2)
                   ╲╱
                   ╳╳   <- the parallel cross-pollination
                   ╱╲
PE-1 ── PE-2 ── PE-3 ── (v0.2: PE-4...PE-6)
```

Each milestone in either track runs its own planning-convergence Codex debate (rule 7) and implementation review (rule 8) per the existing discipline.

---

## Decision prompts (for your reply)

For each decision A-I, tell me:

1. Verdict: `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications`. (DEBATE.md planning enum.)
2. Where I disagree (with specific alternative) — name the path you'd flip to and the load-bearing reason.
3. Risks the proposing side missed — especially around rule 20 scope, rule 21 parallelism, M9 family discipline, M11 strict-minimal, or trust-boundary expansion.
4. Decisions you must lock before any code (PE-1 onward).

Then, **the meta-questions:**

- Is the proposed sequence (PE-1 → PE-2 → PE-3 in v0.1, multi-cloud in v0.2) demand-aligned given Ozzy's framing? Or is the friend signal under-specified and the safer move is PE-1-only-in-v0.1 with PE-2/PE-3 deferred to "after demand evidence"?
- Does parallel-track development (Track 1 + Track 2) violate rule 21? If yes, name the load-bearing reason. If no, distinguish "parallel work tracks" (just multiple PRs/branches active) from "parallel-provider surfaces" (e.g., reviewer panels).
- Does M11's Decision C lock survive the introduction of HTTP transport? The empirical truth that Decision C rested on (v0.1 runtime is provider-uniform) shifts when HTTP enters. Does that unlock the deferred-W3 fields? Or stay deferred until measurable runtime divergence appears in PE-N?

---

## What I want from you

1. **Pressure-test the parallel-track call.** Track-1 + Track-2 might be too much in flight. Or it might be the right risk-managed split. Where am I being optimistic?

2. **Family resolution under routing is the hardest decision.** Decision B determines whether cross-family REVIEW correctness survives the addition of routed providers. Push back on the hybrid lean if you see a simpler-and-correct alternative.

3. **Authority-boundary discipline.** PE-1 (HTTP substrate + xAI direct) might be two boundaries bundled. PE-2 (OpenRouter + lineage discipline) might be two boundaries bundled. M11 was empirically validated as one-boundary-per-milestone; xAI work needs the same discipline. Where is each PE-N over-bundling?

4. **The plan's specific proposals.** `XAI_PROVIDER_EXPANSION_PLAN_2026-05-01.md` proposes `ProviderTransport`, broader `ProviderCapabilities` (8 traits), `AuthMode`, `ResidencyScope`, `Family` with sub-source identifiers. Per Decision C/D/E/F: how much of the plan is correct, how much conflicts with M11 locks, and what's the minimum that earns PE-1 inclusion?

5. **The demand-signal honesty.** Ozzy's friends asked for xAI via various routes. We don't know which routes are most-asked. Do you push for "ship xAI direct only, wait for survey data on OpenRouter/Gateway," or do you accept the plan's broad-coverage thesis on its face? CLAUDE.md rule 21 ("simpler workflows beat complex agent systems unless complexity earns its keep") is the relevant rule.

Per CLAUDE.md rule 9: your verdict is data, not authority. I'll synthesize into `docs/research/SESSION_XAI_EXPANSION_KICKOFF.md`, lock the absorbed decisions, keep the disputed-but-deferrable ones in an open list, and edit `docs/design/ROADMAP.md` § Beyond v0.1 with the agreed sequence. No code in this session.

Thread id will be appended after the call. Sandbox: read-only.
