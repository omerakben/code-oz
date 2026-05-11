---
template: pi-mono
template-path: ~/Projects/agents/templates/pi-mono
template-status: audited (CLAUDE.md influence library row "pi-mono → Streaming event model + multi-provider abstraction")
session: 2026-05-10
verdict: YES, with selective borrows
borrow-count: 8 (B1-B8)
reject-count: 5 (R1-R5)
split-count: 1 (S1)
---

# Code-Oz vs pi-mono — head-to-head

## What pi-mono is

`pi-mono` is the home of the [pi.dev](https://pi.dev) coding-agent project. Three load-bearing packages plus two UI helpers, all under `@earendil-works/`:

| Package | Role | Size signal |
|---|---|---|
| `pi-ai` | Unified multi-provider LLM client SDK (30+ providers, OpenAI / Anthropic / Google / Bedrock / Vertex / Codex Responses / OpenRouter / Vercel AI Gateway / xAI / Groq / Cerebras / DeepSeek / Mistral / Fireworks / Together / Cloudflare / Xiaomi / etc.) | `types.ts` 21k, `models.generated.ts` 445k, 30+ test files |
| `pi-agent-core` | Generic agent runtime: tool calling, state, harness, compaction, sessions, skills | `agent-loop.ts` 19k, `agent-harness.ts` 23k, `compaction.ts` 848 lines |
| `pi-coding-agent` | Interactive coding-agent CLI built on the above | `main.ts` 24k, `config.ts` 17k |
| `pi-tui` | Differential-rendering terminal UI library | (separate package) |
| `pi-web-ui` | Web components for AI chat | (separate package) |

The product is a coding-agent CLI plus the SDK that powers it. The SDK is shipped as a public library with auto-generated upstream-model metadata, lockstep monorepo versioning, and changelogs per package.

Reading the package manifest, AGENTS.md, `pi-ai/src/types.ts`, `pi-ai/src/api-registry.ts`, `pi-ai/src/env-api-keys.ts`, and the agent harness layout makes the design centre clear: **horizontal generality on the client→model axis**. Every detail (cache retention, thinking budgets, OpenRouter routing, Vercel Gateway routing, AWS credential chains, Bun `/proc/self/environ` env recovery) extends the surface area of the client SDK without adding domain opinions about *what* the agent should do.

## What code-oz is (refresher, for the comparison)

Code-oz is a repo-native agentic SDLC runtime. The provider abstraction (`IAgentProvider`) is a foundational layer; the product is the phase-graph orchestrator that gates `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` (and `AUDIT → ...` for brownfield), enforces cross-family adversarial review at REVIEW, runs a debate runtime as the cross-family-review escalation primitive, enforces cumulative budgets against `events.jsonl`, and ships role-cost policy under `budgets.global`. Provider count is intentionally small (5: Claude, Codex, Gemini, Fake, xAI) because the cross-family rule depends on an audited set of *families*, not maximal coverage.

The two products live on orthogonal axes.

## Surface-by-surface comparison

| Axis | pi-mono | code-oz | Notes |
|---|---|---|---|
| Provider count | 30+ | 5 | Different design intent. Coverage is a feature for pi-mono and a liability for code-oz (rule 2). |
| Auto-generated model registry | `models.generated.ts` (445k, regenerated from upstream) | None — strings hardcoded across config / fixtures / prompts | Code-oz feels this when models retire (Jun 15 2026 retirement window in CLAUDE.md). |
| OpenAI-compat detection | `OpenAICompletionsCompat` (14+ knobs: cache_control format, thinking format, max_tokens field, session affinity, OpenRouter / Vercel routing, ZAI tool stream, strict mode, etc.) | Per-adapter strict allowlist (xAI provider) | Pi-mono auto-detects from baseUrl. Open-set design. |
| Streaming event protocol | `start / text_start / text_delta / text_end / thinking_start / thinking_delta / thinking_end / toolcall_start / toolcall_delta / toolcall_end / done / error` (each carries `partial: AssistantMessage`) | `turn_started / content_chunk / tool_call / tool_result / turn_completed` | Pi-mono carries running partial state on every event; code-oz only emits deltas. |
| Thinking levels + budgets | First-class `ThinkingLevel: minimal\|low\|medium\|high\|xhigh` + per-level `ThinkingBudgets` token caps | Implicit; default Opus + downgrade-warning policy | Code-oz handles thinking via prompt-shape; pi-mono via per-provider `ThinkingLevelMap`. |
| Cache retention | `CacheRetention: 'none' \| 'short' \| 'long'` + optional `sessionId` for affinity headers | None per-request; `ENABLE_PROMPT_CACHING_1H` set globally on Anthropic | Pi-mono lets the caller hint retention; code-oz can't yet. |
| Per-request callbacks | `onPayload(payload, model)` and `onResponse(response, model)` for inspection / replacement / telemetry | None | Pi-mono uses these for diagnostics, redaction, audit. |
| Diagnostic shape | `AssistantMessageDiagnostic[]` on every assistant message; redacted by construction | Free-form `Error.message` projected into `events.jsonl` | Code-oz redacts at the wrapper boundary but lacks a typed diagnostic shape. |
| Cross-provider handoff test | `cross-provider-handoff.test.ts` (16k LOC, every provider × every other-family-provider) | None — Reviewer panel (M14) and Debate runtime (M10) ride the same handoff in production but no explicit round-trip test | Real coverage gap. |
| Lazy provider loading | Subpath exports + `register-builtins.ts` lazy loaders | All providers import-time | Compounds when more providers ship. |
| Bun env recovery | `/proc/self/environ` fallback for `oven-sh/bun#27802` (compiled-binary empty `process.env` on Linux sandboxes) | None | Code-oz ships compiled Bun binaries (W3 tarballs) and will hit this. |
| Phase-graph SDLC orchestration | None (single agent loop) | `DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP` + `AUDIT→...` with file-based gate signals (`state/GATE_<PHASE>_PASSED.json`) and schema validation | Code-oz authority. |
| Cross-family adversarial review | None | Rule 2 + M14 Reviewer panel v1 (first simultaneous-provider surface) | Code-oz authority. |
| Debate runtime | None | M10 `requestDebate()` primitive + M15 debate-policy scheduler v1 | Code-oz authority. |
| Cumulative budget enforcement | None visible | Rule 19 + `budgets.global` (cumulative caps; soft warn at 0.75; hard kill at 1.0; cumulative spend read from `events.jsonl`) | Code-oz authority. |
| Role-cost policy | None | M13 `budgets.global.roles[role]` + `priceTable` for dollar telemetry | Code-oz authority. |
| Persona + universal anti-slop rules | None (single coding-agent prompt) | Rule 16 (`src/prompts/universal-rules.md` imported into every persona) | Code-oz authority. |
| Scientist tail | None | Rule 15 (`HYPOTHESES.md` + `OPEN_QUESTIONS.md` per phase) | Code-oz authority. |
| Six-role roster (M12) | None | Architect / Engineer / Reviewer / Researcher / Scientist / Builder | Code-oz authority. |
| AUDIT phase for brownfield | None | First-class | Code-oz authority. |
| Worktree isolation | Single worktree + parallel-agent git rules in AGENTS.md (manual discipline) | Worktree-per-run (M7), runtime-enforced | Code-oz authority. |
| One-authority-per-milestone discipline | None | Rule 20 | Code-oz authority. |
| Repo-context permission scope | None | Rule 18 (`tool_use.repo_context` sub-scope, audited via `repo_context_searched` events) | Code-oz authority. |
| 3-source verification before code | None | Rule 3 (PLAN cannot pass without `SOURCE_CHECK.md`) | Code-oz authority. |
| Cross-model peer review (Codex debate + review per milestone) | None | Live since v0.1; load-bearing for every milestone | Code-oz authority. |

## Verdict

**YES, with selective borrows.**

Code-oz is ahead on its own axis (SDLC orchestration, evidence gates, debate, cross-family review, budget enforcement, persona discipline). Pi-mono is ahead on a different axis (provider engineering, compat layers, streaming protocol depth, cache hints, lazy registration, Bun-binary defenses). Eight of pi-mono's mechanics absorb cleanly into code-oz without polluting authority boundaries; five do not fit the product; one is split (borrow the test catalog, reject the open-set design).

## Borrow set

### B1 — `responseModel` + `responseId` audit fields on `ProviderResponse`

**Source:** `pi-ai/src/types.ts` `AssistantMessage.responseModel` and `responseId`.

**Code-oz target:** `src/providers/types.ts` `ProviderResponse` adds two optional fields; adapters populate when upstream API exposes them.

**Why:** When a provider routes (OpenRouter `auto` → `anthropic/...`, or Vercel Gateway routing) or when the adapter retries against a different concrete model, the message `model` field reflects the *requested* model. Code-oz's M14 Reviewer panel and post-mortem reproducibility benefit from recording which model actually answered (`responseModel`) and the upstream message id (`responseId`) that lets a developer pull the exact transaction from a provider dashboard. Today the audit trail conflates request and response.

**Cost:** ~10 lines on `ProviderResponse`; ~5 lines per adapter (Claude / Codex / Gemini / xAI). FakeProvider unchanged.

**Rule-20 footprint:** Zero. Record fields, not authority.

**Suggested target:** Opportunistic, alongside the next adapter touch.

### B2 — `cacheRetention` + `sessionId` knobs on `ProviderRequest`

**Source:** `pi-ai/src/types.ts` `StreamOptions.cacheRetention` (`'none' | 'short' | 'long'`, default short) and `sessionId` (drives cache-affinity headers).

**Code-oz target:** `ProviderRequest` adds `cacheRetention?` and reuses `runId` as the cache-affinity session id; wrapper layer maps both to provider-specific headers.

**Why:** REVIEW gate replays the same files across rounds (M14 uses up to 4 rounds); debate runs replay the same arguments across opponents. Both are paradigmatic long-cache workloads. Pi-mono distinguishes "5-minute cache" vs "1-hour cache" at the request level and exposes a provider-agnostic toggle. Code-oz currently sets `ENABLE_PROMPT_CACHING_1H` globally on Anthropic, which is correct for many calls but pessimistic for one-shot calls. Per-request control would let `M14_REVIEWER` declare `long`, `M10_DEBATE` declare `long`, and one-shot DEFINE/AUDIT calls declare `short`.

**Cost:** ~30 lines per adapter. Wrapper sets the field per phase based on a small policy table.

**Rule-20 footprint:** Argues for budget-axis enrichment (extends M13 cost policy), not a new authority surface. Worth a one-line note on the milestone, no new milestone.

**Suggested target:** M13 follow-up commit, or bundled with M16 R3 wrap-up if that ships first.

### B3 — `onPayload` / `onResponse` callbacks on `PreparedProviderRequest`

**Source:** `pi-ai/src/types.ts` `StreamOptions.onPayload` and `onResponse`.

**Code-oz target:** Wrapper-layer hook (not phase-layer) — adapters call the wrapper-supplied hooks before sending and after receiving. Phase code never sees them.

**Why:** Three concrete uses in code-oz today:

1. **Secret redaction.** `XaiProvider` ships a strict allowlist; the rest of the providers do not. A wrapper-side `onPayload` hook is a single chokepoint for redaction across all providers.
2. **Audit enrichment.** `onResponse` exposes upstream response headers — `x-request-id`, `x-anthropic-id`, etc. — which would land on `agent_invoked` events and let post-mortems chase a real provider trace.
3. **Cost telemetry.** Live token-usage headers (Anthropic ships them on `messages` 200) feed `events.jsonl` cost projections without parsing the streamed body twice.

**Cost:** ~20 lines plumbing in the wrapper + adapter pass.

**Rule-20 footprint:** Telemetry seam. Counts toward audit infrastructure, not authority.

**Suggested target:** Pair with B6 (diagnostic shape) — they share the same wrapper boundary.

### B4 — Cross-family-handoff integration test

**Source:** `pi-ai/test/cross-provider-handoff.test.ts` (16k LOC; round-trips serialized assistant messages between provider pairs to catch encoder/decoder asymmetry).

**Code-oz target:** New `tests/integration/cross-family-handoff.test.ts` using FakeProvider scripted as two distinct families; round-trips an assistant message from family A through wrapper serialization, into family B as conversation history, and asserts the bytes survive without semantic drift.

**Why:** Code-oz already runs this in production at every Reviewer panel call (M14) and every debate round (M10) — the BUILD agent's output becomes input context for the REVIEW agent on a different family. There is no explicit test for the round-trip. A future change to artifact projection (events.jsonl rebuild for resume, M11 capability-routed wrapper, M14 panel fan-out) could break the property silently. The test is small, runs offline, and covers a Tier-1 invariant of the product.

**Cost:** ~200 LOC.

**Rule-20 footprint:** Zero. Test, no surface.

**Suggested target:** Standalone PR; safe in any milestone.

### B5 — Bun `/proc/self/environ` env recovery

**Source:** `pi-ai/src/env-api-keys.ts:35-59` `getProcEnv` workaround for `oven-sh/bun#27802` (compiled binaries get an empty `process.env` inside Linux sandboxes).

**Code-oz target:** A small utility in `src/util/env.ts` (or co-located in the wrapper) used by every API-key read.

**Why:** Code-oz ships `bun build --compile` binaries via W3 tarballs (`code-oz-v0.14.0-alpha.0-darwin.tar.gz`). The bug fires for Linux users on Docker / Kubernetes / sandboxed CI where `/proc/self/environ` is the only readable env source. Hitting it in production looks like "all my keys disappeared after install" — a confusing failure that bypasses code-oz's `NEEDS_INTERVENTION.json` discipline because the env isn't even present to read. Steal the 30-line workaround verbatim.

**Cost:** ~30 lines + 1 test.

**Rule-20 footprint:** Zero. Defensive.

**Suggested target:** Bundled with PE-2 (next outbound HTTP integration) when key reading expands.

### B6 — `ProviderDiagnostic` typed shape

**Source:** `pi-ai/src/utils/diagnostics.ts` (referenced in `types.ts` via `AssistantMessageDiagnostic[]`).

**Code-oz target:** `src/providers/diagnostics.ts` introduces `ProviderDiagnostic` with explicit `secret: boolean` flagging on each diagnostic field; the wrapper mints these from adapter errors before projection into `events.jsonl`.

**Why:** Code-oz redacts errors at the wrapper boundary today, but redaction is per-call and not type-checked. A typed diagnostic shape with explicit `secret: boolean` field flags makes redaction a compiler concern, not a wrapper-author discipline. The privacy-by-default rule (rule 13) is currently process-enforced; this would make it type-enforced.

**Cost:** ~50 lines + an adapter pass.

**Rule-20 footprint:** Extends the existing privacy authority. No new surface; tightens an existing one.

**Suggested target:** Pair with B3.

### B7 — Lazy provider registration via subpath exports

**Source:** `pi-ai/src/providers/register-builtins.ts` registers each provider via a lazy loader rather than static imports.

**Code-oz target:** `src/providers/registry.ts` adopts `lazy(() => import('./xai.ts'))` form; cli load-time builds the registry but only resolves the providers actually referenced by the run config.

**Why:** Two compounding wins: (a) compiled binary size (the xAI HTTP client and the OpenAI-compat plumbing are not free), and (b) startup cost on resume (resume reads the run config first; only the providers used in the run need to materialize). Modest today (5 providers, all small) but the value compounds with PE-2+ providers and W3+ distribution.

**Cost:** ~40 lines + one pass through registry call sites.

**Rule-20 footprint:** Zero. Mechanical.

**Suggested target:** Standalone refactor PR.

### B8 — Auto-generated model registry seam

**Source:** `pi-ai/scripts/generate-models.ts` → `pi-ai/src/models.generated.ts` (445k generated file; regenerated from upstream model APIs).

**Code-oz target:** `src/providers/models.generated.ts` (much smaller — only model strings code-oz actually defaults to or fixtures against) generated from a script that pulls from each provider's model API.

**Why:** Today code-oz hardcodes model strings (`claude-opus-4-7`, `gpt-5.5`, `gemini-2.5-pro`) across config defaults, fixtures, prompts, and tests. The CLAUDE.md migration window of Jun 15 2026 (`claude-sonnet-4-20250514` and `claude-opus-4-20250514` retiring) is exactly the kind of change that finds every stale reference the hard way. A generated registry — even a tiny one with `id, family, contextWindow, costPerMTok, retiresAt` — would let M13 cost computations and M11 capability checks ride a single source of truth, and would surface "this model retires in N days" warnings during `code-oz doctor`.

**Cost:** 2-3 days for the script + a one-pass refactor of model-string references. Nontrivial.

**Rule-20 footprint:** Low if scoped strictly as a code-quality refactor. Risks creeping into "add new authority surface (model lifecycle)" if not gated tightly.

**Suggested target:** Post-W3, after PE-2 demand checkpoint. Don't accept this until model retirement actually bites a user.

## Reject set

### R1 — 30-provider matrix

Hard reject. Code-oz is intentionally narrow (5 providers covering 4 distinct families). The cross-family rule depends on a small, audited set of *families*; adding meta-providers (OpenRouter, Vercel AI Gateway) would weaken family identity because both *route* to other providers — a Reviewer routed by OpenRouter to the same family as the BUILD agent silently violates rule 2.

### R2 — `pi-tui` and `pi-web-ui`

Out of scope. Code-oz is a CLI runtime, not a chat product. The `pi-tui` differential renderer is impressive but solves a problem code-oz doesn't have.

### R3 — Lockstep monorepo versioning

Code-oz is single-package. Lockstep is irrelevant.

### R4 — TypeBox tool schemas

Code-oz uses Zod. Switching schema libraries to inherit pi-mono's `Tool<TParameters extends TSchema>` would be churn without payoff — Zod covers the same surface and is already pinned in M11 capability validation.

### R5 — Image-generation API surface

Out of scope.

## Splits

### S1 — Generic OpenAI-compat detection (auto-detect → declared)

Pi-mono auto-detects compat from `baseUrl`. For code-oz, generic auto-detection is dangerous — the cross-family rule depends on an *auditable* family boundary, and "auto-detect compat" silently admits new compatibles into the trust set whenever a baseUrl pattern matches.

**Borrow:** the typed compat *record* (`OpenAICompletionsCompat` with its 14+ knobs) and the *test catalog* (the knobs are real edge cases — `cacheControlFormat: 'anthropic'` for Anthropic-style cache markers via OpenAI-compat URLs, `requiresThinkingAsText` for `<thinking>` delimiter conversion, `requiresReasoningContentOnAssistantMessages` for empty-reasoning replay). Each knob is a real bug pi-mono has shipped against.

**Reject:** the auto-detection. Compat records in code-oz are declared per-provider in source, never auto-detected. New compatibles enter via the same milestone-gated process as new providers.

This converts pi-mono's open-set design into code-oz's closed-set audit surface for the same engineering value.

## Summary table

| Borrow | Where | Cost | Rule-20 | Target |
|---|---|---|---|---|
| B1 | `ProviderResponse.{responseModel,responseId}` | ~10+5×4 LOC | none | opportunistic |
| B2 | `ProviderRequest.{cacheRetention,sessionId}` | ~30/adapter | budget axis | M13 follow-up |
| B3 | `onPayload`/`onResponse` callbacks (wrapper) | ~20 LOC | telemetry | bundled with B6 |
| B4 | `cross-family-handoff.test.ts` | ~200 LOC | none | standalone PR |
| B5 | Bun `/proc/self/environ` env recovery | ~30 LOC | none | bundled with PE-2 |
| B6 | `ProviderDiagnostic` typed shape | ~50 LOC | privacy axis | bundled with B3 |
| B7 | Lazy provider registration | ~40 LOC | none | standalone refactor |
| B8 | Auto-generated model registry seam | 2-3 days | code quality | post-W3 |
| S1 | Declared (not auto-detected) compat records | ~80 LOC | family axis | when 2nd OpenAI-compat provider lands |
| R1-R5 | rejects | n/a | n/a | n/a |

## Open questions for the Codex debate

1. **B2 framing — does per-request cache retention earn a milestone, or is it a M13 follow-up?** The M13 cost policy already ships `priceTable` and per-role caps. Cache retention is the *output-side* lever of the same axis. Argument for M13 follow-up: same authority. Argument for new milestone: the wrapper plumbing touches every adapter and the per-phase policy table is a new surface.
2. **B4 size — is one cross-family round-trip test enough, or should it parametrize over all family pairs?** Pi-mono runs the matrix. Code-oz's family count is 4 (claude / codex / gemini / xai), so the matrix is 4×3=12 directional pairs. FakeProvider can simulate any pair, so cost is mostly fixture lines.
3. **B8 timing — is the model-retirement pain real enough to schedule before PE-2 demand checkpoint?** The Jun 15 2026 retirement is 5 weeks out. If a user upgrades and finds their pinned default unavailable, the failure surface is `code-oz doctor` returning a stack trace — not great. But B8 is 2-3 days of work that must come from somewhere.
4. **S1 — does the closed-set version still earn its keep, given xAI is the only OpenAI-compat provider today?** Borrowing 14 knobs against one provider is overengineering. Argument for now: the catalog is the cheap thing; declaring `XaiProvider`'s compat record explicitly costs ~10 LOC and pre-empts the next OpenAI-compat add. Argument against: YAGNI until provider #2.
5. **Are there code-oz-specific authority surfaces pi-mono *should have* but doesn't? (Reverse-direction borrow check.)** AGENTS.md ships parallel-agent git rules as a *manual* discipline; code-oz's worktree-per-run is *runtime*-enforced. Are there patterns code-oz could *teach* pi-mono (and therefore, by inversion, audit code-oz's own implementation against)?

## References

- `~/Projects/agents/templates/pi-mono/README.md`
- `~/Projects/agents/templates/pi-mono/AGENTS.md`
- `~/Projects/agents/templates/pi-mono/packages/ai/src/types.ts`
- `~/Projects/agents/templates/pi-mono/packages/ai/src/api-registry.ts`
- `~/Projects/agents/templates/pi-mono/packages/ai/src/env-api-keys.ts`
- `~/Projects/agents/templates/pi-mono/packages/ai/test/cross-provider-handoff.test.ts`
- `~/Projects/agents/templates/pi-mono/packages/agent/src/harness/`
- `/Users/ozzy-mac/Projects/code-oz/src/providers/types.ts`
- `/Users/ozzy-mac/Projects/code-oz/src/providers/xai.ts`
- `/Users/ozzy-mac/Projects/code-oz/CLAUDE.md` (rules 2, 13, 19, 20)
