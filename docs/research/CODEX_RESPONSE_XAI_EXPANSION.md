# Response — xAI provider expansion (roadmap-scoped)

**Thread:** 019de497-2969-7a80-aeec-520b3517021c
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** docs/research/CODEX_BRIEFING_XAI_EXPANSION.md

## Verdict on the decisions

Overall verdict: feature-with-modifications

A. Verdict: accept-with-modifications. Keep a parallel PE track, but cap active work and do not merge PE work until M11 is pushed or consciously left local. Lock: Track 1 and Track 2 are work branches, not runtime fan-out.

B. Verdict: feature-with-modifications. Flip from optional hybrid to lineage-required for proof roles. For routed providers, REVIEW/Debate must resolve family from a configured model binding before invocation. Response metadata can audit, but cannot be the authority.

C. Verdict: accept-with-modifications. HTTP is a new authority boundary, but substrate-only is too abstract. PE-1 should be the first narrow xAI direct HTTP adapter, with only the minimal shared HTTP helper needed to exercise the boundary. No gateway/base-url/routing abstraction in PE-1.

D. Verdict: reject. Do not add `transport` to `ProviderCapability` in PE-1. The adapter already owns `health()`, and `authSource` plus provider id is enough for doctor behavior. Keep M11's strict-minimal TS shape until a generic caller actually needs transport.

E. Verdict: accept-with-modifications. Use mechanism-specific `authSource` values as adapters land: `xai-api-key`, `openrouter-api-key`, later `openai-compatible-gateway-key`. Do not pre-enum Azure/AWS/GCP until their milestones.

F. Verdict: accept-with-modifications. Fail closed, but use a distinct lineage error such as `loader_provider_lineage_unknown`. Do not overload phase eligibility. If lineage is not statically known at load time, block at the earliest pre-invoke point before provider call.

G. Verdict: accept. Defer `costTelemetryMode` to M13. `tokensUsed?` remains per-call actual usage only; pricing/rate policy stays under `budgets.global`.

H. Verdict: accept. Defer Azure/Bedrock/Vertex to v0.2. Azure is real, but cloud routes are separate auth/region/catalog boundaries. Current AWS and Google public docs I checked do not surface xAI/Grok in their supported-model pages, so those should stay watchlist, not v0.1 scope.

I. Verdict: feature-with-modifications. Flip from PE-1 → PE-2 → PE-3 all in v0.1 to PE-1 committed, PE-2 demand-gated, PE-3 deferred. Concrete alternative: PE-1 xAI direct; survey/check route demand; then OpenRouter if routed retail access is confirmed. Gateway waits for self-hosting/org demand.

## Risks the proposing side missed

A: Parallel tracks are fine, but branch hygiene and merge timing are real. M12 roster and PE provider expansion both touch config/docs authority, so "different files" is not a complete risk argument.

B/F: Optional lineage is the biggest correctness hole. `familyOf(providerId)` is insufficient once `openrouter` can mean xAI, Anthropic, OpenAI, or hidden upstream. The authority needs a resolved provider binding, not just a provider id.

C/D: PE-1 quietly bundles more than HTTP if it adds `transport`, doctor semantics, API-key auth, xAI response mapping, and tool-calling semantics. The minimum PE-1 should explicitly disable xAI built-in tools like web search/code execution unless a future permission scope allows them.

E: API keys change the trust boundary. Lock env var names, redaction, error mapping, and "never log Authorization headers" before code.

G: Tool invocation costs can diverge from token usage. xAI/OpenRouter/LiteLLM may report token usage while billing separately for built-in tools or gateway markup. M13 should own that model.

H: "Cloud route" is not one feature. Azure Foundry, Bedrock, and Vertex each need separate IAM, region, deployment-name, and catalog logic.

I: The friend signal proves xAI demand, not demand for all six routes. Gateway is the least proven v0.1 item.

## Where I disagree

I disagree with adding `transport` to `ProviderCapability`. M11 locked `authSource | eligiblePhases | costPerMTok? | rateLimits?`, and the current loader/registry logic does not need transport. Add docs prose or adapter-local implementation notes first.

I disagree with lineage-when-known fallback for REVIEW/Debate. Unknown lineage must make a routed provider ineligible for proof roles. A warning in `events.jsonl` is post-hoc, while rule 2 is pre-emptive.

I disagree with committing Gateway to v0.1 before route data. OpenRouter has a stronger public signal: it exposes xAI models through a unified API, and its docs state it normalizes request/response schema across models/providers. Gateway is broader and more enterprise-shaped.

## What I would defer

Defer `editSemantics`, `shellSemantics`, `mcpSupport`, and `sandboxProfile` TS fields. HTTP alone does not unlock them. They earn TS slots only when code-oz intentionally exposes provider-native tool behavior that the wrapper cannot normalize into the existing `ProviderToolCall` stream.

Defer Azure, Bedrock, and Vertex provider ids, auth enum values, and capability flags. Azure Foundry currently documents Grok models, but Bedrock and Vertex should be treated as runtime/catalog research until their official supported-model pages clearly carry xAI/Grok.

Defer cost telemetry mode, residency scope, cloud catalog shape, and generic gateway routing until their owning milestones.

## Recommended next step

Lock a narrower roadmap:

1. PE-1: xAI direct HTTP adapter only. Keep `ProviderCapability` unchanged. Add `xai-api-key`, `xai` provider/family, strict redaction, timeout/error mapping, and no built-in xAI server-side tools by default.
2. Demand checkpoint: ask which route friends actually use: xAI API key, OpenRouter, LiteLLM/Portkey gateway, Azure, Bedrock, Vertex.
3. PE-2: OpenRouter only if the demand checkpoint confirms routed retail access matters. Its milestone owns resolved-lineage family proof.
4. PE-3+: Gateway and cloud routes each get their own planning round.

Parallel work tracks do not violate rule 21. Runtime parallel-provider surfaces do. A branch for PE-1 beside M12 is normal development; a gateway that fans out across upstream providers, a reviewer panel, or a multi-opponent debate is a product surface and needs measurable risk reduction.

Sources checked for current platform facts: xAI docs, especially API key/OpenAI-compatible examples and tools docs; OpenRouter xAI catalog and API overview; LiteLLM xAI provider docs; Azure Foundry xAI model listing; AWS Bedrock supported models; Google Model Garden pages.
