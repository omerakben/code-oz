---
name: codex-response-mimir
codex-thread: 019e12f0-d136-70b0-8d9b-f573981f90bb
codex-model: gpt-5.5 (xhigh, read-only)
captured: 2026-05-10
companion-doc: CODEX_BRIEFING.md (sibling)
status: verbatim capture — synthesis in SYNTHESIS.md
---

# Codex response — Mimir borrow set debate

## Overall verdict

`accept-with-modifications`

## Prompt 1 — Verdict shape

**Sub-verdict:** accept-with-modifications.

`code-oz` is ahead only in its category: repo-native SDLC runtime. The core constraints are real: file gates, explicit manifests, cumulative budgets, one authority boundary, and rule-21 measurement are locked in `CLAUDE.md:21-43` and the binary/file-state architecture in `CLAUDE.md:45-52`. Mimir is ahead as a memory-native MCP product: its README defines persistent graph memory over Neo4j + embeddings + MCP at `<templates-root>/Mimir/README.md:16-20`, and its server exposes graph/index/vector/todo tools at `<templates-root>/Mimir/src/index.ts:7-18`.

Recommendation: keep the verdict, but word it like the Archon synthesis: "ahead on the discipline axes that matter to code-oz," not globally ahead. The Archon comparison already made that correction at `docs/comparison/04-archon/COMPARISON.md:148-150`.

## Prompt 2 — B1 MCP server pricing

**Sub-verdict:** accept-with-modifications.

Do not ship write-back. Mimir's actual MCP graph tools are mutable: `memory_node` supports add/update/delete at `<templates-root>/Mimir/src/tools/graph.tools.ts:14-30`, and the main MCP server routes tool calls through mutable graph handlers at `<templates-root>/Mimir/src/index.ts:121-160`. That is the wrong authority shape for code-oz, where gates are atomic files written through `writeGate` and `approveGate`, not tool calls (`src/state/gates.ts:73-91`, `src/state/run.ts:354-430`).

Recommendation: B1 is read-only, demand-gated, and post-SHIP or W4+. Smallest v0.1 surface: `phase_current`, `gate_status`, `events_tail`, `artifact_read`, `budget_remaining`, `intervention_pending`. No `approve_gate`, no artifact mutation, no event append. If write-back ever lands, it must write advisory request files, not gates.

## Prompt 3 — B2 OpenAI-compat timing

**Sub-verdict:** accept-with-modifications.

Land after the second real HTTP adapter, not before. `XaiProvider` is deliberately narrow: first HTTP trust boundary, env key read at invoke time, strict allowlist, and no tool/search fields (`src/providers/xai.ts:1-21`, `src/providers/xai.ts:242-260`). Mimir's loader is much looser: env can override base URL and paths directly (`<templates-root>/Mimir/src/config/LLMConfigLoader.ts:111-120`).

Current official docs confirm real divergence: Together has parameter and response-shape differences, including ignored OpenAI fields and Together-specific usage/reasoning shapes (Together docs lines 213-225: https://docs.together.ai/docs/inference/openai-compatibility). Fireworks adds extra request/response fields and differs on context overflow behavior (Fireworks docs lines 370-373 and 878-880: https://docs.fireworks.ai/api-reference/post-chatcompletions). OpenRouter has `models`, `route`, and `provider` routing fields (OpenRouter docs lines 150-155: https://openrouter.ai/docs/api/reference/overview). Groq prompt caching changes usage/rate-limit interpretation (Groq docs lines 232 and 1337-1365: https://console.groq.com/docs/prompt-caching). Ollama uses OpenAI shape locally but requires an unused API key in SDK setup (Ollama docs lines 43-48: https://ollama.com/blog/openai-compatibility).

Recommendation: PE-2 should implement the second adapter first, then extract `OpenAICompatProvider` from two passing adapters.

## Prompt 4 — B3 rate-limit queue

**Sub-verdict:** accept-with-modifications.

This is an honest gap, not a production bug today. `ProviderCapability.rateLimits` is explicitly advisory in code-oz (`src/providers/capabilities.ts:51-76`, `docs/references/provider-contract.md:441-443`), while cumulative budget enforcement already happens under `budgets.global` (`docs/references/provider-contract.md:191-208`). Mimir's queue is useful but not directly shaped for code-oz: it is singleton keyed, request-per-hour based, FIFO, and in-memory (`<templates-root>/Mimir/src/orchestrator/rate-limit-queue.ts:21-26`, `:89-102`, `:190-223`).

Recommendation: defer until PE-2 or first real 429. Implement as a bounded per-`(provider, model)` FIFO wrapper around `IAgentProvider.invoke`, with timeout/cancel behavior and `events.jsonl` telemetry. Do not copy Mimir's hour-window singleton as-is.

## Prompt 5 — Missed mechanics + negative borrow audit

**Sub-verdict:** accept-with-modifications.

**Missed mechanic 1**: Claude blurred Mimir's prompt aliases with MCP implementation. Claudette teaches `discover/store/link/recall` as cognitive aliases (`<templates-root>/Mimir/.agents/claudette-mimir-v3.yaml:67-77`), but the MCP server exposes `memory_node`, `memory_edge`, `index_folder`, vector search, and todo tools (`<templates-root>/Mimir/README.md:451-474`). Fix the synthesis before writing B1.

**Missed mechanic 2**: memory hygiene without graph DB. Claudette's useful pattern is duplicate-checking, `evolved_from`, `contradicts`, and storing decisions only at durable points (`<templates-root>/Mimir/.agents/claudette-mimir-v3.yaml:28-51`). Borrow that as a file-based Reviewer Memory rubric later, not Neo4j.

**Missed mechanic 3**: Ecko is a checklist, not a new agent. Ecko's value is structured gap/deliverable analysis (`<templates-root>/Mimir/docs/agents/v2/00-ecko-preamble.md:11-18`, `:77-122`). Convert to deterministic DEFINE/PLAN review checklist only if it tightens existing prompts. Do not add a Prompter authority now.

N5 is right as stated for LLM-generated personas. Mimir's Agentinator calls an LLM to generate preambles (`<templates-root>/Mimir/src/api/orchestration/agentinator.ts:124-147`), while code-oz already injects universal rules into every persona prompt (`src/prompts/index.ts:47-52`, `src/prompts/index.ts:142-170`). A deterministic template renderer is acceptable later; LLM persona generation is not.

## Missed risks

`block-borrow`: B1 write-back would create a second gate authority. Code-oz gate writes are centralized in `writeGate`/`approveGate` (`src/state/gates.ts:73-91`, `src/state/run.ts:378-430`).

`block-borrow`: B2 copied as arbitrary base URL + arbitrary body fields would bypass the PE-1 trust boundary (`src/providers/xai.ts:11-23`, `docs/references/provider-contract.md:386-388`).

`fix-soon`: Correct the MCP tool-name evidence before `SYNTHESIS.md`; actual tools are `memory_node` etc., not `discover/store` (`<templates-root>/Mimir/src/tools/graph.tools.ts:1-15`).

`fix-soon`: Any rate queue must emit queue/wait/drop telemetry into `events.jsonl`; otherwise it creates invisible runtime state beside rule-19 budget state (`docs/references/provider-contract.md:191-208`).

`nit`: Mimir's Lambda executor has useful typed fan-in and timeout ideas, but the cloud/distributed executor remains no-borrow. The reusable parts are `LambdaInput.tasks` and sandbox timeout patterns (`<templates-root>/Mimir/src/orchestrator/lambda-executor.ts:233-263`, `:684-704`).

## Rule-violation audit

| Item | Risk score | Rule risk |
|---|---:|---|
| B1 read-only MCP server | 1 | Rule 13 exposure risk, rule 20 new integration boundary. Rule 1 risk is 0 only while read-only. |
| B1 write-back variant | 3 | Rule 1 and rule 20 violation unless it never writes gates or canonical artifacts. |
| B2 OpenAICompatProvider | 2 | Rule 13 secret/body leakage and rule 20 HTTP trust-boundary expansion. Safe only with PE-1 allowlist discipline. |
| B3 rate-limit queue | 1 | Rule 19 risk if it tracks invisible state outside `events.jsonl`; rule 20 low if implemented as provider wrapper only. |
| N1 Neo4j graph memory | 3 | Architecture lock and product-thesis violation; Mimir persists everything in Neo4j (`<templates-root>/Mimir/README.md:966-976`). |
| N2 Studio / VS Code extension | 2 | Rule 20 UI/platform authority drift; Mimir's web/MCP product surface is not code-oz's local CLI surface. |
| N3 LangGraph Python tier | 3 | Violates Bun+TS single-binary architecture (`CLAUDE.md:45-52`, `package.json:11-18`). |
| N4 Lambda distributed executor | 3 | Violates local-first thesis and adds sandbox/distributed execution authority (`<templates-root>/Mimir/src/orchestrator/lambda-executor.ts:1-16`). |
| N5 Agentinator LLM persona generation | 3 | Rule 16 risk unless universal rules are mechanically injected and tested (`src/prompts/index.ts:47-52`). |
| N6 OAuth/RBAC multi-tenancy | 2 | New auth boundary and hosted/server product drift; Mimir wires local/OAuth auth behind env flags (`<templates-root>/Mimir/src/config/passport.ts:12-15`, `:63-82`). |
