# xAI provider expansion — session kickoff (synthesis)

**Date:** 2026-05-01
**Branch:** none (no code in this session — roadmap + planning only)
**Scope:** how `code-oz` adds xAI as an individual provider AND via routed providers (Azure AI Foundry, AWS Bedrock, Google Vertex AI, OpenRouter, AI Gateway / LiteLLM).
**Codex debate:** [`docs/research/CODEX_BRIEFING_XAI_EXPANSION.md`](../research/CODEX_BRIEFING_XAI_EXPANSION.md) → [`docs/research/CODEX_RESPONSE_XAI_EXPANSION.md`](../research/CODEX_RESPONSE_XAI_EXPANSION.md), thread `019de497-2969-7a80-aeec-520b3517021c`. Verdict: `feature-with-modifications`.
**Pre-existing draft plan:** [`docs/research/XAI_PROVIDER_EXPANSION_PLAN_2026-05-01.md`](../research/XAI_PROVIDER_EXPANSION_PLAN_2026-05-01.md). Useful starting point; several specific proposals conflict with M11 locks and are revised here per Codex's pressure.

## Why this exists

Friends are asking for xAI Grok access via direct API and via routed providers. The demand is real and time-sensitive. The locked post-M10 sequence (M12 = Company roster → M13 = Role-cost → M14 = Reviewer panel → M15 = Debate-policy scheduler) is also real and locked from the product thesis pressure-test. After the Codex round, Ozzy decided to resolve the conflict serially with strategic insertion: M12 ships first because it is the product-thesis differentiator (without Company roster, `code-oz` is "another agentic runtime"), then PE-1 (xAI direct HTTP adapter) inserts between M12 and M13. PE-1 earns the slot because friend demand is the measurable signal the locked-sequence "M16+ deferred until measurable need" criterion was designed for, and shipping M12 first means PE-1's xAI provider lands into a `company:` block on day one. PE-2+ (OpenRouter, Gateway) and multi-cloud routes (Azure / Bedrock / Vertex) remain demand-gated insertion points between later milestones; v0.2 if no demand surfaces.

## What changed after Codex round

Codex pressure-tested nine decisions A-I + three meta-questions. Three substantive flips, two `accept-with-modifications`, and one outright reject — each one closes a real correctness, scope, or trust-boundary hole the briefing's leans had.

### Decisions absorbed (locks)

| # | Decision | Final lock |
|---|---|---|
| A | Roadmap insertion strategy | **Serial with strategic insertion (Ozzy's call after the Codex round).** Codex's `accept-with-modifications` was for parallel work branches; Ozzy chose serial-with-insertion instead because M12 (Company roster) is the product-thesis differentiator and PE-1 lands richer once xAI can be slotted into a `company:` block on day one. Final sequence: M11 (closed) → M12 → PE-1 → M13 → M14 → M15 → (v0.2 cloud routes). PE-2+ are demand-gated insertion points between later milestones, not parallel branches. The branch-hygiene risk Codex flagged is preserved as a single-active-feature-branch discipline. |
| B | Family resolution under routing | **Lineage-required for proof roles (stronger than my hybrid lean).** For routed providers, REVIEW/Debate must resolve family from a *configured model binding* before invocation. Response metadata audits but does NOT authorize. `familyOf(providerId)` alone is insufficient once `openrouter` can mean any upstream. The authority requires a resolved provider binding. |
| C | HTTP transport authority | **Substrate-only is too abstract.** PE-1 ships the first narrow xAI direct HTTP adapter with only the minimal shared HTTP helper to exercise the boundary. NO gateway / base-url / routing abstraction in PE-1. Substrate emerges from the adapter, not the other way around. |
| D | `ProviderCapability` extension | **Reject `transport` field.** M11's strict-minimal shape stays unchanged. The adapter already owns `health()`; `authSource` + provider id is enough for doctor behavior. Decision C of M11 is invoked again: don't add fields without measurable need. |
| E | `authSource` enum granularity | **Per-mechanism, per-adapter as they land.** `xai-api-key` lands in PE-1; `openrouter-api-key` lands in PE-2 (if PE-2 commits); `openai-compatible-gateway-key` lands in PE-3 (if PE-3 commits). Do NOT pre-enum Azure / AWS / GCP until their milestones. |
| F | Cross-family REVIEW + Debate when lineage is hidden | **Fail closed with distinct error code.** New `loader_provider_lineage_unknown` (or pre-invoke equivalent), NOT a phase-eligibility overload. Block at the earliest pre-invoke point if not statically known at load time. Audit-only fail-open is rejected — rule 2 is pre-emptive, not post-hoc. |
| G | Cost telemetry shape | **Defer entirely to M13.** No new field in PE-N. `tokensUsed?` on `agent_completed` remains per-call actual usage only; pricing/rate policy stays under `budgets.global`. |
| H | Multi-cloud (Azure / Bedrock / Vertex) scope | **Defer all three to v0.2.** Each is its own auth + region + catalog discipline. Codex fact-check: AWS Bedrock and Google Vertex public supported-model pages do not currently surface xAI/Grok — watchlist, not v0.1 scope. Azure Foundry does carry Grok models but its v0.1 inclusion is still a separate milestone, not part of PE-1. |
| I | v0.1 fast-cut prioritization | **PE-1 committed; PE-2 demand-gated; PE-3 deferred.** The friend signal proves xAI demand, not demand for all six routes. Gateway is the least proven v0.1 item. New pattern: **demand checkpoint** between PE-1 ship and PE-2 commit. |

### Risks Codex raised that the briefing missed

1. **API keys change the trust boundary in a way the M11 contract did not yet anticipate.** PROVIDERS.md § "Subscription-first auth model" says "code-oz never reads or transmits OAuth tokens directly." It does not yet say the same about API keys, because no v0.1 adapter has needed to. PE-1 reads and transmits an xAI API key — first time `code-oz` does this. **Locks BEFORE code:**
   - Env var names (e.g., `XAI_API_KEY`, not a generic `API_KEY`).
   - Redaction discipline: API key MUST NOT appear in `events.jsonl`, `NEEDS_INTERVENTION.json`, doctor output, error messages, or any artifact.
   - "Never log Authorization headers" rule — explicit in the adapter's HTTP request/response logging.
   - Request/response logging at the wrapper layer must redact `Authorization`, `x-api-key`, and any provider-specific auth header.
   - Error-mapping for HTTP 401/403/429/5xx into the existing `ProviderError` codes.
2. **xAI built-in server-side tools must be explicitly disabled by default.** xAI Grok supports built-in web search and code execution. `code-oz` does not yet have a permission scope for these provider-native tools (the M6 `tool_use.repo_context` is in-process; the M7 `tool_use.write` is patch-application; neither covers "the upstream provider runs its own server-side tool"). PE-1 adapter MUST send the request with these tools explicitly disabled until a future permission scope authorizes them. Same trust-boundary discipline as the wrapper's manifest authority.
3. **Tool invocation costs can diverge from token usage.** xAI / OpenRouter / LiteLLM may report token usage while billing separately for built-in tools or gateway markup. M13's role-cost policy will need to model this; PE-N records what the upstream API returns, no more no less.
4. **"Cloud route" is not one feature.** Azure Foundry, Bedrock, and Vertex each have separate IAM, region, deployment-name, and catalog logic. v0.2 will land them as separate milestones, not as one bundled "cloud routes" milestone.

### Decisions you must lock before any code (per Codex)

1. PE-1 scope is xAI direct HTTP adapter only. No transport field. No gateway abstraction. No multi-provider fan-out.
2. API key trust boundary: env var names + redaction + Authorization-header logging discipline locked in `provider-contract.md` Anti-patterns BEFORE PE-1 commit 1.
3. Built-in xAI tools (web search, code execution) explicitly disabled in adapter's request shape.
4. Family-resolution for routed providers: lineage required for REVIEW/Debate proof roles, with `loader_provider_lineage_unknown` (or pre-invoke equivalent) as the typed error.
5. Demand checkpoint pattern: after PE-1 ships, survey friends on which specific route they need before committing to PE-2 (OpenRouter) vs deferring.

## Locked roadmap (post-Codex + Ozzy's adoption decision)

### v0.1 milestone sequence (serial with strategic insertion)

```
M11 (closed) ── M12 ── PE-1 ── (demand checkpoint) ── M13 ── M14 ── M15 ── (v0.2 cloud routes)
                next   xAI direct                     PE-2+ insertion checkpoints
                                                      between later milestones
```

**Why M12 ships before PE-1, not after, not parallel:**
- M12 (Company roster) is the product-thesis differentiator. Without it, `code-oz` is "another agentic runtime"; with it, the "AI software company" metaphor lands. This is the most load-bearing v0.1 surface.
- PE-1's xAI provider is more useful once M12 has shipped: xAI immediately drops into a `company:` block role binding on day one. If PE-1 shipped first, the M12 planning round would need to retro-fit xAI into the role table.
- M13 / M14 / M15 each become richer with xAI already-registered: M13 has more cost data to gate against, M14 has more cross-family options for the panel, M15 has more scheduler variety.

**Why not parallel work branches (Codex's lean):**
- M12 and PE-1 both touch config + docs authority surfaces (`docs/contracts/PROVIDERS.md`, `docs/contracts/COMPANY.md`, `.code-oz/config.yaml` schemas, `src/providers/capabilities.ts`). Serial merging avoids rebase + retest churn on shared surfaces.
- Single-active-feature-branch discipline is simpler than parallel-track branch hygiene at this stage of the project.
- The 8 unpushed local commits from M11 (4 implementation + 2 review-closure + merge + status-bump) are independent of M12 and PE-1; push when Ozzy approves; do not block M12 on the push.

**Demand-gated insertion checkpoints (between later milestones):**
- After PE-1 ships (and before M13 starts): survey friends on which route they actually use (xAI API key direct / OpenRouter / LiteLLM gateway / Azure Foundry / Bedrock / Vertex). Result decides whether PE-2 inserts here or M13 starts.
- After M13 ships (and before M14): same checkpoint if PE-2 did not commit earlier.
- After M14 ships (and before M15): same checkpoint.
- If no demand signal at any checkpoint, PE-track parks; M-track continues uninterrupted; cloud routes defer to v0.2.

### PE-1: xAI direct HTTP adapter (committed)

**Authority boundary:** outbound HTTP from `code-oz` itself (first time the runtime makes outbound HTTP not via a CLI subprocess). Trust-boundary expansion: API key handling. New provider/family/authSource value.

**What ships:**
- `src/providers/xai.ts` — new `IAgentProvider` adapter. HTTP-based; reads xAI API key from env (var name to be locked in commit 1's contract update); makes outbound HTTPS requests to xAI's chat-completions endpoint; maps responses into the existing `ProviderEvent` stream.
- `src/providers/capabilities.ts` — adds `xai-api-key` to `AUTH_SOURCES` enum + `xai` entry to `DEFAULT_CAPABILITY_BY_ID` with `authSource: 'xai-api-key'`, `eligiblePhases: <full AGENT_PHASES>` (or restricted by review consensus). NO `transport` field added. NO other capability fields added.
- `src/providers/types.ts` — adds `'xai'` to `PROVIDER_IDS` + `PROVIDER_FAMILIES` (mirrors M9 1:1 v0.1 mapping).
- `src/providers/families.ts` — adds `xai: 'xai'` to `DEFAULT_FAMILY_BY_ID`.
- `src/cli/bootstrap.ts` — registers `XaiProvider` alongside Claude/Codex/Gemini/Fake.
- `docs/contracts/PROVIDERS.md` — extends the v0.1 capability table with the `xai` row.
- `docs/references/provider-contract.md`:
  - § Auth model gains an "API-key auth" subsection: env var name, redaction discipline, "never log Authorization headers" rule, request/response logging redaction list.
  - § Anti-patterns gains an entry rejecting "Logging Authorization headers, x-api-key headers, or any provider-specific auth header in any artifact."
  - § "Capability and eligibility (M11)" gains a note: HTTP-based adapters do not require new capability fields in v0.1; the trust-boundary expansion is documented in § Auth model, not encoded in `ProviderCapability`.
- Tests: full coverage for the adapter, redaction, error mapping, built-in-tools-disabled-by-default, eligibility rejection of impossible (provider, phase) combinations.
- Built-in xAI server-side tools (web search, code execution) explicitly disabled in the adapter's request shape; documented in adapter source as a permission-scope-pending decision.

**What does NOT ship in PE-1:**
- No HTTP-substrate library separate from the adapter.
- No `transport` field on `ProviderCapability`.
- No OpenRouter, no Gateway, no cloud routes.
- No new permission scope for upstream provider-native tools (deferred until measurable need).
- No lineage-resolution machinery (PE-1 is direct, not routed).

**Codex review at planning convergence (rule 7):** PE-1 milestone runs its own planning-debate Codex round before commit 1. This roadmap-scoped round does not preempt that.

**Codex review at implementation completion (rule 8):** PE-1 runs its own implementation-review Codex round before tag.

### Demand checkpoint (between PE-1 ship and PE-2 commit)

After PE-1 tags as `v0.12.0-alpha.0` (or whatever the milestone tag is — naming TBD; see "Open follow-ups" below), Ozzy surveys friends:

> Which route are you actually using to access xAI?
> - xAI API key directly
> - OpenRouter
> - LiteLLM / Portkey gateway
> - Azure AI Foundry
> - AWS Bedrock
> - Google Vertex AI

The survey result determines:
- If routed retail access (OpenRouter) is confirmed → commit PE-2 (OpenRouter adapter + lineage-resolution discipline).
- If gateway (LiteLLM) is confirmed → commit PE-3 (Gateway adapter), but understand Codex's note that Gateway is the least-proven v0.1 item.
- If cloud (Azure / Bedrock / Vertex) is confirmed → defer to v0.2, schedule a separate planning round per cloud.
- If only direct API key → PE-track parks at PE-1; M12-M15 work continues uninterrupted.

This is the demand-gated discipline. New pattern parallel to CLAUDE.md rule 21's measurable-risk-reduction pattern: **measurable-demand-evidence** for milestone insertion. Without survey signal, no PE-2 commit.

### PE-2: OpenRouter adapter (demand-gated)

**Owner of the lineage-resolution authority.** Per Codex Decision B + F locks: routed providers require resolved-lineage proof for REVIEW/Debate roles. PE-2's milestone planning round resolves:
- Where the configured model binding lives (persona frontmatter? `.code-oz/config.yaml` route table?).
- The shape of the lineage hint flowing through `agent_invoked` events.
- The exact error code grammar (`loader_provider_lineage_unknown` or a pre-invoke variant).
- How the registry's structural-equality cross-check (M11 commit 3) handles per-call lineage resolution.

PE-2 scope and shape are NOT pre-locked in this kickoff — they will be designed in the PE-2 planning Codex round if/when PE-2 commits.

### PE-3+: Gateway, cloud routes (deferred each its own planning round)

Each gets its own milestone, planning round, implementation review, and tag. No batch milestone for "cloud routes" — Azure / Bedrock / Vertex each separately. Each commits only when there is measurable demand and the previous PE milestone has shipped cleanly.

## Pre-PE-1 contract additions (lock BEFORE PE-1 commit 1)

These are documentation-only changes that lock the trust-boundary discipline before any code. They land as a single docs commit that PE-1 commit 1 builds on.

1. **`docs/references/provider-contract.md` § "Auth model — subprocess delegation (v0.1)" → rename + extend to "Auth model — subprocess delegation + API-key transmission (v0.1)".** Add subsection "API-key transmission for HTTP adapters" covering:
   - Env var naming convention (`<PROVIDER>_API_KEY`, e.g., `XAI_API_KEY`).
   - Redaction discipline: API keys must not appear in any artifact (`events.jsonl`, gate files, `NEEDS_INTERVENTION.json`, doctor output, error messages, request/response logs).
   - "Never log Authorization headers" rule + the redaction list.
   - HTTP error mapping (401 → `provider_auth_missing`; 403 → `provider_permissions_violation`; 429 → `provider_rate_limit`; 5xx → `provider_io_error`).
2. **`docs/references/provider-contract.md` § "Anti-patterns rejected by this spec".** Add three entries:
   - Logging Authorization headers, x-api-key headers, or any provider-specific auth header in any artifact.
   - Embedding API keys in `ProviderRequest` / `PreparedProviderRequest` / persona prompts (auth always at the adapter layer, never in the request DTO).
   - Enabling provider-native server-side tools (e.g., xAI built-in web search, code execution) without an explicit `tool_use` permission scope authorizing them. v0.1 adapters disable by default.
3. **`docs/contracts/PROVIDERS.md` § "Subscription-first auth model" → rename + extend to cover API-key auth for HTTP adapters.** Document the policy: prefer subscription-first via upstream CLI when available; HTTP API key is acceptable when no CLI option exists; cloud-IAM auth is v0.2+ scope.

These three doc edits are the pre-PE-1 lock. PE-1's planning Codex round will pressure-test them.

## Open follow-ups (parking lot, not pre-PE-1 scope)

- **PE-1 tag naming.** Under the serial-with-insertion sequence, M12 closes as `v0.12.0-alpha.0` and PE-1 (inserted between M12 and M13) is the next milestone tag. Likely answer: PE-1 takes `v0.13.0-alpha.0` and M13 (Role-cost) shifts to `v0.14.0-alpha.0`, etc. Lock in PE-1 planning round; the alternate (PE-1 takes `v0.12.1-alpha.0` to keep M-numbering aligned with M-tags) is also defensible.
- **Demand checkpoint mechanism.** Survey form? Quick conversational ask? Document the result somewhere durable (e.g., `docs/research/XAI_DEMAND_CHECKPOINT_<date>.md`).
- **xAI built-in tools permission scope.** When future demand emerges for xAI web search or code execution, design a permission scope (`tool_use.upstream_native_tools`?). Out of scope for PE-1 entirely.
- **OpenRouter lineage shape.** PE-2 planning round (if PE-2 commits).
- **Gateway adapter shape.** PE-3 planning round (if PE-3 commits).
- **Cloud routes.** v0.2 planning rounds (each its own, when committed).

Carried-over from M11:
- M10 n#1 (deferred): line-anchored `<debate-request>` tag detection in `src/tools/debate-request-extract.ts`. Wait for a real persona response to trip the quoted-YAML edge case.
- M9 audit M1 + M2 (deferred): duplicate parsing helpers across `src/artifacts/*.ts`. DRY-at-3x not yet triggered.
- M11 deferred-by-design: `costPerMTok` and `rateLimits` data values omitted on every default; populated when M13 lands the role-cost policy.

## ROADMAP.md edit (landed in this commit)

ROADMAP.md § "Beyond v0.1 (post-MVP queue, ordered)" § "Post-M10 productization" was updated in the same commit as this kickoff doc to record the M12 → PE-1 → M13 → M14 → M15 sequence with the load-bearing reason, and a new subsection "Provider expansion track (PE-N, demand-gated insertion points)" was added naming PE-1 as committed and PE-2+ as demand-gated.

Still pending (not in this commit): a status update to `docs/research/XAI_PROVIDER_EXPANSION_PLAN_2026-05-01.md` noting the plan has been pressure-tested and the locked PE-1-as-insertion sequence (not parallel tracks) supersedes its "Phase 1 (M11) / Phase 2 (M12)" framing. Land in PE-1's planning round, not now.

## What earns the M12 → PE-1 → M13 insertion (the load-bearing argument)

Per CLAUDE.md rule 21, every parallel-provider surface needs a load-bearing measurable risk-reduction effect. PE-1 is not a parallel-provider surface — it is a single new direct adapter — but the *insertion itself* (interrupting the locked M12-M15 sequence to slot PE-1 between M12 and M13) needs justification. The test case:

> *Does inserting PE-1 between M12 and M13 violate "one phase per milestone" or "locked sequence" disciplines?*
>
> No. The locked sequence was M12 → M13 → M14 → M15. PE-1 is a new milestone inserted at a sequence boundary, not a phase added inside an existing milestone. CLAUDE.md rule 20 is preserved: PE-1 has its own single authority boundary (outbound HTTP from `code-oz` itself, plus the API-key trust-boundary expansion). CLAUDE.md rule 21 is preserved: PE-1 is one new direct adapter, not a fan-out surface.
>
> The justification for inserting PE-1 *here* (vs. parking until v0.2) is friend demand — the measurable signal the locked-sequence "M16+ deferred until measurable need" criterion was designed for. PE-1 commits because demand is real; PE-2 commits only after a post-PE-1 checkpoint confirms which route friends actually use; PE-3+ defer until per-route demand is similarly evidenced.

The insertion-with-checkpoints discipline is a new pattern parallel to rule 21's measurable-risk-reduction: **measurable-demand-evidence** earns insertion slots. The "measurable signal earns the slot" pattern generalizes from runtime parallelism to milestone insertion.
