# Provider expansion plan: xAI direct + unified routing providers (2026-05-01)

## Clarified scope

This plan reflects two separate goals:

1. **xAI as a first-class direct provider** in `code-oz` (same class as Claude/Codex/Gemini adapters).
2. **Unified routing providers for *all* model families**, not xAI-only:
   - Azure AI Foundry
   - AWS Bedrock
   - Google Vertex AI
   - OpenRouter
   - AI Gateway (LiteLLM / OpenAI-compatible)

The second goal means developers may intentionally choose a unified provider layer (for example Azure AI Foundry) and avoid direct OpenAI/Gemini adapters while still using those models through the unified surface.

## Why this matches code-oz architecture

- `code-oz` already has an adapter seam (`IAgentProvider`) and provider family enforcement in REVIEW.
- M11 is explicitly the Provider capability contract milestone.
- Product thesis says provider-neutral routing should be capability-aware, not naive interchangeability.

So the right move is:
- **M11:** normalize capability/lineage/routing contract.
- **M12+:** add adapters in a deliberate rollout.

## Design principle: separate "transport provider" from "model family"

For unified providers, these are different things:

- **Transport provider**: azure-foundry, aws-bedrock, gcp-vertex, openrouter, gateway-openai.
- **Model family**: openai, gemini, claude, xai, meta, mistral, etc.

`code-oz` must track both on every invocation.

### Required runtime metadata per invocation

- `providerId` (transport): e.g., `azure-foundry`
- `modelRef`: exact model/deployment identifier used
- `resolvedFamily`: e.g., `xai`, `openai`, `gemini`, `claude`
- `lineageConfidence`: `declared | inferred | unknown`
- `regionOrResidency`: provider-specific region/deployment metadata when available

Without this, cross-family REVIEW can be wrong when routing through unified providers.

## What to build

## Phase 1 (M11): provider capability contract v1

No large adapter fan-out yet. First lock contract extensions.

### Add contract primitives

- `ProviderTransport`:
  - `native_cli`
  - `native_http`
  - `openai_compatible`
  - `cloud_catalog`
- `ProviderCapabilities`:
  - `chat`
  - `toolUse`
  - `streaming`
  - `jsonSchema`
  - `vision`
  - `maxContextKnown`
  - `supportsRepoContextToolUse`
  - `costTelemetryMode` (`provider_reported | estimated | unknown`)
- `AuthMode`:
  - `local_cli_oauth`
  - `api_key`
  - `cloud_iam`
  - `gateway_key`
- `LineagePolicy`:
  - `strict_required` (REVIEW-eligible)
  - `best_effort` (BUILD/DEFINE/PLAN allowed)

### New policy rules

1. **REVIEW role requires `resolvedFamily != buildFamily` with non-unknown lineage.**
2. If unified provider cannot prove lineage, mark `resolvedFamily: unknown` and block REVIEW assignment (fail closed).
3. BUILD/PLAN may run with `unknown` lineage if config explicitly allows it.

## Phase 2 (M12): adapter rollout sequence

### Track A — direct family adapter
1. **xAI direct adapter** (`provider id: xai`) via xAI API.

### Track B — unified provider adapters (multi-family)
2. **Azure AI Foundry adapter** (`provider id: azure-foundry`)
3. **AWS Bedrock adapter** (`provider id: aws-bedrock`)
4. **Google Vertex adapter** (`provider id: gcp-vertex`)
5. **OpenRouter adapter** (`provider id: openrouter`)
6. **OpenAI-compatible Gateway adapter** (`provider id: gateway-openai`, LiteLLM class)

This order prioritizes your specific requirement: unified-provider-first workflows should be first-class, not afterthought.

## Adapter requirements by provider

### xAI direct

- API-key auth.
- Native HTTP mapping to provider events.
- Tool-call event mapping must feed existing budget counters.

### Azure AI Foundry

- Azure auth + deployment targeting.
- Model resolution through Foundry deployment/model identifiers.
- Emit `resolvedFamily` from deployment/model metadata when possible.

### AWS Bedrock

- IAM-based auth.
- Region-aware model availability preflight.
- Emit family from model ID namespace/provider prefix.

### Google Vertex

- Project/location auth + routing.
- Model Garden/deployment-aware model resolution.
- Emit family from publisher/model lineage metadata.

### OpenRouter

- API-key auth.
- OpenAI-compatible transport.
- Preserve upstream provider/model metadata for lineage resolution.

### AI Gateway (LiteLLM/OpenAI-compatible)

- Configurable base URL + key.
- Strict compatibility mode default.
- Optional passthrough metadata mode for lineage when gateway supports it.
- If gateway hides lineage, set `resolvedFamily=unknown`.

## Developer UX target (your Azure example)

A developer should be able to configure:

- `provider: azure-foundry`
- `model: <azure-model-or-deployment-ref>`

and run all phases through Azure as the transport provider, while `code-oz` still knows whether the actual model family is xAI/OpenAI/Gemini/etc for REVIEW invariants.

In short: **transport can be unified; family checks stay model-lineage-aware**.

## Risk register (updated for unified-provider goal)

1. **False cross-family pass** when transport differs but model family is same.
2. **Lineage opacity** in generic gateways.
3. **Regional/catalog drift** in cloud providers.
4. **Capability mismatch** (tool calling/JSON schema/vision differences across routes).
5. **Cost telemetry inconsistency** across direct vs routed providers.

Mitigations:
- Mandatory invocation metadata (`providerId`, `modelRef`, `resolvedFamily`, `lineageConfidence`).
- REVIEW fail-closed on unknown lineage.
- `doctor providers --json` adds region/catalog/lineage diagnostics.
- Capability checks at load time and pre-invoke time.

## Suggested implementation PR sequence

1. `docs/contracts: provider-capability-contract-v1 (transport + family lineage)`
2. `feat(state): persist invocation lineage metadata and validation`
3. `feat(providers): add xai direct adapter`
4. `feat(providers): add azure-foundry adapter`
5. `feat(providers): add aws-bedrock adapter`
6. `feat(providers): add gcp-vertex adapter`
7. `feat(providers): add openrouter adapter`
8. `feat(providers): add gateway-openai adapter (LiteLLM-compatible)`
9. `feat(doctor): unified-provider diagnostics for auth/region/catalog/lineage`
10. `test(e2e): cross-family enforcement across direct and unified transports`

## Immediate product guidance

Given your clarified ask, the product direction should be:

- **Yes** to xAI direct as a peer first-class provider.
- **Yes** to unified-provider mode as a first-class deployment style for all families.
- Make REVIEW invariants depend on actual model family lineage, not on transport provider name.

That gives flexibility for developers who want one control plane (Azure/Bedrock/Vertex/OpenRouter/Gateway) without weakening governance.

## Sources (external)

- xAI docs: https://docs.x.ai/docs
- Azure AI Foundry models: https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models
- AWS Bedrock model support: https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
- Vertex Model Garden overview: https://cloud.google.com/vertex-ai/generative-ai/docs/model-garden/explore-models
- OpenRouter catalog/docs: https://openrouter.ai/x-ai and https://openrouter.ai/docs/api-reference/overview
- LiteLLM docs: https://docs.litellm.ai/
