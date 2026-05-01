# xAI provider expansion plan (2026-05-01)

## Purpose

Plan and research how `code-oz` should add xAI as:

1. An individual provider adapter.
2. A routed provider via multi-provider surfaces:
   - Azure AI Foundry
   - AWS Bedrock
   - Google Vertex AI
   - OpenRouter
   - AI Gateway (LiteLLM / OpenAI-compatible)

This note is intentionally architecture-first and contract-first so it can slot into M11 (Provider capability contract) without violating CLAUDE.md rule 20 (one authority boundary per milestone).

## Snapshot of current repo posture

- The runtime already has the right seam: `IAgentProvider` + registry/family discipline and REVIEW cross-family checks.
- The roadmap already says M11 is the provider capability contract milestone.
- The product thesis already positions provider-neutral, capability-aware routing as core.

Implication: this xAI expansion is a **great fit for M11+M12**, not a side quest.

## External availability snapshot (validated 2026-05-01)

### Direct xAI
- xAI has official docs and API quickstart/tool-calling docs (`docs.x.ai`).
- xAI markets current Grok family (including newer variants) with tool-calling support.

### Via Azure AI Foundry
- Microsoft Learn model catalog currently lists xAI Grok entries in Foundry Models sold by Azure.
- Availability and pricing are region/deployment dependent.

### Via AWS Bedrock
- Bedrock publishes a dynamic supported-model table by provider/region.
- xAI presence must be treated as dynamic (check at runtime / doctor), not hard-coded assumptions.

### Via Google Vertex AI
- Vertex Model Garden is the source of truth for third-party model availability.
- Whether xAI is present should be checked from Model Garden APIs/console at integration time.

### Via OpenRouter
- OpenRouter publishes xAI model catalog and OpenAI-compatible API surface.
- Good candidate for the first routed xAI adapter because of broad OpenAI-schema normalization.

### Via AI Gateway (LiteLLM / OpenAI-compatible)
- LiteLLM supports xAI and acts as an OpenAI-format gateway/proxy.
- This is the generic abstraction path for enterprise bring-your-own-routing.

## What to build (recommended)

## Phase 1 (M11): capability contract extension only (no broad role rollout)

Add capability-first metadata to provider registry and contracts:

- `ProviderTransport`: `native_cli | native_http | openai_compatible | cloud_catalog`.
- `ProviderCapabilities` (minimum):
  - `chat`
  - `toolUse`
  - `streaming`
  - `jsonSchema`
  - `vision`
  - `maxContextKnown`
  - `supportsRepoContextToolUse`
  - `costTelemetryMode` (`provider_reported | estimated | unknown`)
- `AuthMode`: `local_cli_oauth | api_key | cloud_iam | gateway_key`.
- `ResidencyScope`: `provider_default | region_pinned | gateway_defined`.
- `Family`: keep as-is, but add sub-source identifiers (`xai-direct`, `xai-openrouter`, etc.) while mapping all xAI-origin calls to family `xai`.

Why first: prevents accidental equivalence claims between “xAI direct” vs “xAI via OpenRouter” vs “xAI via Bedrock/Azure/Vertex”.

## Phase 2 (M12): add concrete adapters in this order

1. **xAI direct HTTP adapter** (`provider id: xai`) 
2. **OpenRouter adapter** (`provider id: openrouter`) with xAI model selection
3. **OpenAI-compatible gateway adapter** (`provider id: gateway-openai`) for LiteLLM/Portkey/etc.
4. **Cloud-hosted xAI sources** (Azure/Bedrock/Vertex) as separate provider ids:
   - `azure-foundry`
   - `aws-bedrock`
   - `gcp-vertex`

Reasoning: fastest value + lowest contract ambiguity first, then cloud surfaces with heavier auth/region complexity.

## Adapter design notes

### 1) xAI direct adapter

- Auth: API key env var.
- Transport: native HTTP.
- Core endpoints: chat/completions or responses surface (depending on xAI doc track selected).
- Must map tool-calling events into existing `tool_call` event accounting for budget enforcement.

### 2) OpenRouter adapter

- Auth: OpenRouter API key.
- Transport: OpenAI-compatible chat schema (with OpenRouter-specific headers optional).
- Must preserve model provenance in events (selected model + upstream provider if available in response metadata).

### 3) Gateway OpenAI-compatible adapter (LiteLLM + generic)

- Auth: gateway key.
- Base URL configurable.
- Must support strict compatibility mode + provider-extension passthrough mode (off by default).
- Add doctor checks for health endpoint and model list fetch when configured.

### 4) Cloud routes (Azure, Bedrock, Vertex)

Treat each as its own provider because auth + region + catalog semantics differ.

- Azure Foundry: subscription/resource + deployment/model constraints.
- Bedrock: IAM + region/model availability checks.
- Vertex: project/location + Model Garden availability/deployment mode.

Do not pretend these are identical under one adapter; share helper layers where possible.

## Cross-family / reviewer implications

To preserve rule 2 correctly:

- Family should reflect model lineage, not transport alone.
- If reviewer uses `openrouter` with an xAI model, family should resolve to `xai` for cross-family checks.
- If model lineage is unknown (gateway hides origin), mark family `unknown` and fail closed for REVIEW roles requiring hard cross-family proof.

## Risk register

1. **False cross-family assurance** through gateways that hide upstream model lineage.
2. **Capability drift** across surfaces (tool-use/JSON schema may differ by route even for “same” model name).
3. **Region mismatch** for Azure/Bedrock/Vertex leading to runtime failures.
4. **Cost ambiguity** when token accounting differs between upstream and gateway.
5. **Over-scoping M11** (violates authority-boundary discipline).

Mitigations:
- Required lineage metadata in provider response envelopes.
- Capability checks at load-time and pre-invoke time.
- `doctor providers --json` extended with catalog/region/status detail.
- Conservative cost estimator fallback when upstream metrics absent.

## Suggested PR sequence

1. `docs/contracts: provider-capability-matrix-v1`
2. `feat(providers): add xai direct adapter`
3. `feat(providers): add openrouter adapter`
4. `feat(providers): add openai-compatible gateway adapter`
5. `feat(providers): add azure-foundry adapter`
6. `feat(providers): add aws-bedrock adapter`
7. `feat(providers): add gcp-vertex adapter`
8. `feat(doctor): provider capability + region/model diagnostics`
9. `test(e2e): matrix tests for lineage + cross-family enforcement`

## Concrete guidance for your immediate decision

If the goal is “answer friend demand quickly without destabilizing the core”:

- Commit now to **xAI direct + OpenRouter + Gateway(OpenAI-compatible)** as near-term.
- Put **Azure/Bedrock/Vertex** behind capability flags until doctor/capability/lineage checks are complete.
- Keep Anthropic/OpenAI/Gemini baseline unchanged while expanding the matrix.

This gives fast market coverage while respecting the repo's governance model.

## Sources (external)

- xAI docs: https://docs.x.ai/docs
- Azure AI Foundry models: https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models
- AWS Bedrock model support: https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
- Vertex Model Garden overview: https://cloud.google.com/vertex-ai/generative-ai/docs/model-garden/explore-models
- OpenRouter xAI catalog: https://openrouter.ai/x-ai
- OpenRouter API reference: https://openrouter.ai/docs/api-reference/overview
- LiteLLM docs: https://docs.litellm.ai/
