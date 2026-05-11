---
name: comparison-mimir
template-path: ~/Projects/agents/templates/Mimir
template-snapshot: 2026-04-29 (last upstream sync), .git activity 2026-05-10
companion-docs: ../../adr/0001-mvp-option-e.md, ../../references/provider-contract.md, ../../product/AI_SOFTWARE_COMPANY_THESIS.md, ../04-archon/COMPARISON.md
target: borrow-decision record + Codex debate setup for Mimir vs code-oz
status: initial verdict — pending Codex debate
decision: YES, code-oz is ahead **on the discipline axes that define code-oz's category**, with three small selective borrows pending Codex review
prior-borrows: none — Mimir is not in CLAUDE.md's influence library
---

# code-oz vs Mimir

## What Mimir is, in one paragraph

Mimir (`mimirframework/Mimir`, AGPL/proprietary, snapshot 2026-04-29) is a Docker-first **memory-native MCP server** built around a Neo4j knowledge graph and a GPU-accelerated graph-and-embeddings sidecar (`nornicdb/`). The headline product is *persistent agent memory* — the bundled "Claudette" agent prompt (`.agents/claudette-mimir-v3.yaml:1-8`) literally states "your graph memory IS your thinking, not a tool you use." Around the memory core, Mimir wraps a sequential PM → Ecko → Worker → QC orchestration chain (`src/orchestrator/agent-chain.ts:1-75`), a multi-provider LLM client that auto-discovers any OpenAI-compatible `/v1/chat/completions` endpoint (`src/config/LLMConfigLoader.ts:25-119`), an HTTP API + SSE event stream (`src/api/orchestration/sse.ts`), a React web "Studio" portal at `:9042/portal` (`README.md:143-146`), a VS Code extension (`vscode-extension/`), and a LangGraph Python pipeline tier (`pipelines/`). It exposes its memory ops (`discover`, `store`, `link`, `recall`, `task`, `tasks`, `index`) to external agents via MCP (`src/orchestrator/mcp-tools.ts`). Distribution is five Docker Compose flavors (`docker-compose.{arm64,amd64,arm64.hybrid,arm64.nornicdb,ollama}.yml`) selected by a platform-detect entry script (`scripts/start.js`). State lives in Neo4j 5.15 nodes plus a `TaskOutputs` registry (`src/api/orchestration/workflow-executor.ts:42-54`); decisions are parsed from LLM text into graph state.

## What code-oz is, restated for contrast

code-oz is a Bun + TypeScript **repo-native agentic SDLC runtime** with file-based gate signals, schema-validated artifacts, cross-family adversarial review, run-level cumulative budget enforcement, multi-provider abstraction (`IAgentProvider`), worktree-per-run isolation, permission manifests, `NEEDS_INTERVENTION` discipline, and one new authority boundary per milestone (rule 20). Through M16 it has shipped: provider capability contract (M11), company roster (M12), role-cost policy (M13), reviewer panel v1 (M14, first simultaneous-provider surface), debate-policy scheduler v1 (M15, single-opponent), production CLI completion (M16). 3108 tests pass offline. PE-1 added the first HTTP adapter (xAI). Distribution is `bun build --compile` single-file binary plus npm + Homebrew + Scoop.

## Domain boundary

Mimir's center of mass is **persistent cross-conversation memory** for AI agents — the knowledge graph is the product, orchestration is a downstream consequence. It is designed to be deployed (Docker, Neo4j, llama.cpp embedding sidecar, optional GPU, optional Vision-Language model, web portal, OAuth/RBAC for multi-tenant access — `docker-compose.yml:267-275` plus `src/config/passport.ts`) and consumed *by* other agents through MCP. code-oz is a **local-first repo-native CLI** whose unit of work is a single SDLC run on a developer's machine, gated through six phases against schema-validated artifacts, with everything persisted as files (events.jsonl + gate JSONs + Markdown).

Roughly 70 percent of Mimir's surface area — Neo4j graph database, NornicDB GPU engine, embedding sidecar (llama.cpp + bge-m3, 1024-dim), Vision-Language image embeddings, web Studio portal, VS Code extension, OAuth/RBAC multi-tenant auth, LangGraph Python pipeline tier, AWS Lambda executor (`src/orchestrator/lambda-executor.ts`, 40k LOC), five Docker Compose variants — is **out of category** for code-oz. Adopting any of it would betray the architecture lock ("no SQLite v0.1", file-only persistence, single-binary distribution) and the AI-software-company thesis (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`).

The 30 percent that overlaps is provider abstraction, agent-role specialization, sequential workflow execution, rate-limiting, MCP-tool exposure, and OpenAI-compatible HTTP adapters. This comparison focuses on the overlap.

## Feature matrix

Legend: **M** = Mimir, **C** = code-oz. `=` overlap; `>` ahead; `<` behind; `n/a` out of category.

| Surface | M | C | Notes |
|---|---|---|---|
| Distribution | 5 Docker Compose variants + platform-detect entry script | `bun build --compile` single binary + npm + Homebrew + Scoop | `=` Both ship. Different shapes — Mimir is server stack, code-oz is local CLI. |
| Persistence | Neo4j 5.15 graph + `TaskOutputs` registry; decisions live in graph nodes | `state/events.jsonl` + `state/GATE_<PHASE>_PASSED.json` + Markdown artifacts; no DB | `n/a` Architecture lock divergence — code-oz refuses persistent DB by deliberate commitment. |
| Memory model | Cross-conversation persistent graph + embeddings + semantic search | Per-run events.jsonl + per-phase Markdown; cross-run memory deferred (Reviewer Memory on ACE M17-M20 roadmap) | `<` for cross-run memory specifically; **but**: code-oz's category does not require it (the repo IS the memory). |
| Embeddings / vector | llama.cpp + bge-m3 (1024-dim) sidecar + optional Vision-Language image-to-text | None | `<` Out of category for code-oz today; relevant only if Reviewer Memory adopts vector retrieval. |
| Provider abstraction | `LLMConfigLoader` reads `LLMConfig` JSON, talks any OpenAI-compatible `/v1/chat/completions` + `/v1/models` endpoint; ENV-driven (`MIMIR_DEFAULT_PROVIDER`, `MIMIR_LLM_API`) | `IAgentProvider` interface with stateless async-iter `invoke`; `family/capability/health()` readonly fields; declared static capabilities (M11) | `=` Both abstract. Mimir's is endpoint-shape (OpenAI-compat); code-oz's is contract-shape (capability + phase eligibility). |
| Provider implementations | OpenAI, GitHub Copilot proxy (`copilot-api:4141`), Ollama, llama.cpp; **no** Anthropic SDK adapter wired in this template | Claude (subprocess), Codex (subprocess), Gemini (stub), Fake, xAI (HTTP, PE-1) | `=` Both multi-provider. Mimir is OpenAI-compat-monoculture; code-oz spans CLI subprocess + HTTP. |
| OpenAI-compat HTTP adapter | First-class — any `/v1` endpoint works config-only | Bespoke `XaiProvider` (PE-1), strict request-body allowlist, audited trust boundary | `<` Mimir is more *general*; code-oz is more *audited*. Generalizing PE-1 into a shared `OpenAICompatProvider` is a borrow candidate (B2). |
| Agent role specialization | PM, Ecko (prompt optimizer), Worker, QC; per-agent model override via `MIMIR_PM_MODEL`, `MIMIR_WORKER_MODEL`, `MIMIR_QC_MODEL` | Six shipped roles (M12 company roster) with per-role model + cost policy under `budgets.global.roles` (M13) | `=` Both have role-keyed models. code-oz adds per-role cost caps and structured eligibility per phase. |
| Phase / lifecycle model | Sequential 4-stage chain: PM (plan) → Ecko (prompt-optimize) → PM (task graph) → Workers → QC | Linear FSM: DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP (greenfield) or AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP (brownfield) | `>` code-oz has a richer lifecycle model with explicit greenfield/brownfield split; Mimir collapses everything to one chain shape. |
| Gate signals | Parsed from LLM text → graph state; PM emits a task graph JSON, executor consumes it | `state/GATE_<PHASE>_PASSED.json` schema-validated by `src/state/gates.ts`; never parse LLM text for pass/fail (rule 1) | `>` code-oz only. Mimir is exactly the anti-pattern rule 1 forbids. |
| Cross-family review | Not present — PM/Ecko/QC are sequential single-provider chain; QC is same family as Worker by default | Mandatory at REVIEW gate (rule 2); panelist quorum 2 with same-family advisory-only authority (M14) | `>` code-oz only. |
| Debate runtime | Not present | `requestDebate()` primitive (M10); auto-trigger scheduler (M15, single-opponent) | `>` code-oz only. |
| 3-source verification | Not present | Rule 3 + `SOURCE_CHECK.md` blocks PLAN gate | `>` code-oz only. |
| Universal anti-slop rules | Not present (Claudette agent has its own rules but no universal import) | Rule 16 + `src/prompts/universal-rules.md` (10 prohibitions + 10 affirmations) imported into every persona | `>` code-oz only. |
| Maestro discipline | Not present | Rule 17 + `docs/research/01-maestro-rule-checker.md` | `>` code-oz only. |
| Scientist tails / hypotheses | Not present | Rule 15 + `docs/contracts/SCIENTIST.md` + `HYPOTHESES.md` / `OPEN_QUESTIONS.md` blocked at gate preflight | `>` code-oz only. |
| Privacy by default | Not present — agents have full graph + repo access by default (`MIMIR_FEATURE_*` flags gate features, not data) | `.code-ozignore`, secret redaction, file-size caps, "files sent to provider" preview, agents receive explicit file manifests, never silent recursive context (rule 13); `tool_use.repo_context` permission scope (rule 18) | `>` code-oz only. |
| Permissions / sandbox | Allowed-tools list per agent + OAuth/RBAC for users; no per-execution permission manifest | Permission manifest required for any `.ts` escape-hatch (rule 9); deny network for repo_context tools | `>` code-oz only. |
| Run-level cumulative budgets | Rate-limit queue per provider (`src/orchestrator/rate-limit-queue.ts`); no run-level token/cost cap | `budgets.global` (`maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`); cumulative `assertWithinBudget`; soft warn at `softWarnAtRatio`; hard kill → `NEEDS_INTERVENTION` (rule 19); per-role caps (M13) | `>` code-oz only. Mimir has rate-limiting (good); does not enforce cumulative budgets (gap). |
| Pre-execution rate limiting | Dedicated rate-limit queue with per-provider RPM/TPM tracking; queues calls before dispatch | M11 capability declares `rateLimits?` but **no enforcement queue** — it is documentation, not gate | `<` Mimir has the queue; code-oz has only the declaration. Borrow candidate (M3). |
| MCP server surface | Mimir IS an MCP server — exposes `discover`, `store`, `link`, `recall`, `task`, `tasks`, `index` to external agents (Claudette, Cursor, Claude Code) via `@modelcontextprotocol/sdk` | Not present — code-oz consumes Claude/Codex/Gemini *as* subprocess providers; nothing consumes code-oz | `<` for the consumer-side surface specifically. Strongest borrow candidate (M1) — exposing read-only run state (gate files, events.jsonl, artifacts) via MCP would let any MCP client introspect a code-oz session. |
| MCP client surface | Mimir is also a client (consumes external MCP tools when configured) | Not present | `n/a` Out of category for v0.1; relevant only if a phase needs in-process tool calls beyond subprocess providers. |
| SSE / real-time progress | First-class — `sendSSEEvent`/`registerSSEClient`, Studio portal streams agent execution visually | `events.jsonl` append-only, tailable; no in-process emitter | `<` Same gap that Archon's `WorkflowEventEmitter` (B3) flagged; not borrowed yet because UI is out of category. Defer until `code-oz watch` demand exists. |
| Web UI / Studio | React portal + Orchestration Studio + file indexer UI | `code-oz doctor run` read-only state inspector (M16) | `n/a` Out of category. Local-first repo-native CLI by deliberate commitment. |
| VS Code extension | Yes (`vscode-extension/`) | None | `n/a` Out of category for v0.1; relevant for v0.3+ only. |
| Auth / multi-tenancy | OAuth + RBAC + JWT (`passport.ts`, `MIMIR_DEV_USER_ADMIN` ENV) | Subprocess delegation to provider CLIs; API-key transmission discipline for HTTP adapters (PE-1) | `n/a` Out of category. code-oz is single-user local. |
| Worktree isolation | `file-isolation.ts` — per-task isolated workspace with file copy and merge | `createRunWorktree` + `loadOrCreateRunWorktree` (M16 idempotent) + `removeRunWorktree` + audit-completeness recovery + lock model | `>` code-oz uses real git worktrees + advisory locks + idempotent recovery; Mimir's file-isolation is copy-and-merge. |
| Brownfield AUDIT artifact | Not present | Brownfield profile + `AUDIT.md` (rule 14) | `>` code-oz only. |
| One new authority per milestone | Not enforced — orchestration code mixes prompt-optimization, task-graph, worker dispatch, QC verification, persistence, and SSE in `workflow-executor.ts` (38k LOC) | Rule 20 + empirical M11/M12/M13/M14/M15/M16 cadence | `>` code-oz only. |
| Risk-reduction-measurable parallel-provider expansion | Not present (no A/B framing visible) | Rule 21 — multi-provider features land only when measurable in events.jsonl against single-provider baseline | `>` code-oz only. |
| Cross-model peer review at every milestone | Not encoded (project velocity is undocumented in CONTRIBUTING.md) | Mandatory durable rule (CLAUDE.md) — Codex debate at planning convergence + Codex review at implementation completion, every milestone | `>` code-oz only. |
| Lambda executor (distributed run) | `src/orchestrator/lambda-executor.ts` (40k LOC) — AWS Lambda dispatch for distributed task execution | None | `n/a` Out of category — contradicts local-first thesis. |

## What Mimir has that code-oz lacks

**M1. MCP server surface for run state** (`src/orchestrator/mcp-tools.ts`). Mimir exposes its core operations (`discover`, `store`, `link`, `recall`, `task`, `tasks`, `index`) as MCP tools so external agents (Claudette in Windsurf, Claude Code, Cursor) can introspect and mutate the memory graph without re-implementing Neo4j queries. The mechanic is generalizable: anything an external tool needs to know about a code-oz run — current phase, gate-file states, recent events, latest artifact contents, run budgets, pending interventions — can be exposed as a *read-only* MCP server bound to a specific `runId`. This is the **strongest borrow candidate** because it:
- Aligns with code-oz's local-first thesis (the MCP server runs locally, on the same machine as the binary).
- Honors rule 1 (file-based gates) — the MCP tools read gate files; they do not write them.
- Has clean acceptance criteria (read-only at v0.1, write-back deferred until a real consumer demand exists).
- Earns its keep against rule 21 only when a concrete consumer is named (Claude Code wants to query `code-oz doctor run` programmatically; Cursor wants to surface phase state in its sidebar).
- Naturally targets a future W4+ "external integration" milestone.

**M2. Generalized OpenAI-compatible HTTP adapter.** Mimir's `LLMConfigLoader` (`src/config/LLMConfigLoader.ts:25-119`) treats every provider as a `{ baseUrl, defaultModel, models[], headers? }` triple and dispatches to OpenAI-compatible endpoints. Adding Groq, Together, Fireworks, OpenRouter, Ollama, or llama.cpp is a config edit, not code. code-oz today has bespoke `XaiProvider` (PE-1) with a strict request-body allowlist and audited trust boundary. Borrowing the *shape* (config-driven endpoint dispatch) without losing the *discipline* (strict allowlist + boundary audit) means refactoring `XaiProvider` into a generic `OpenAICompatProvider` keyed on `(baseUrl, apiKey, model)` with the same strict allowlist applied uniformly. PE-2 candidate.

**M3. Pre-execution rate-limit queue** (`src/orchestrator/rate-limit-queue.ts`). Mimir tracks per-provider RPM/TPM and queues calls before dispatch. code-oz's M11 capability declares `rateLimits?` but treats it as documentation — there is no enforcement queue. Adding a small `RateLimitQueue` that reads `ProviderCapability.rateLimits` and gates `IAgentProvider.invoke` calls would close a real production-readiness gap, especially as more HTTP adapters land (PE-2+). Small, self-contained, fits inside one milestone.

**M4. Per-agent model override via ENV.** Mimir uses `MIMIR_PM_MODEL`, `MIMIR_WORKER_MODEL`, `MIMIR_QC_MODEL`. code-oz already has per-role models in `.code-oz/config.yaml` (M12-M13). **No-borrow** — equivalent shape, code-oz's is config-file-shaped which is correct for the local-first thesis.

**M5. SSE event stream + Studio portal.** `sse.ts` emits real-time orchestration events to a React UI. Adjacent to the Archon `WorkflowEventEmitter` (B3) borrow candidate, which is currently deferred until `code-oz watch` demand exists. **No-borrow today** — track the same demand signal as Archon B3.

**M6. Vision-Language image embeddings.** Out of category for code-oz today. **No-borrow.**

**M7. Knowledge graph / Neo4j persistent memory.** **No-borrow.** This is Mimir's headline product surface. Adopting it would:
- Violate the architecture lock ("no SQLite v0.1", file-only persistence).
- Add a database operational dependency (Docker, GPU optional) that breaks single-binary distribution.
- Conflict with rule 21 (no parallel-provider surface without measurable risk reduction) — cross-run memory needs A/B evidence before adoption.
- Duplicate the *intent* of the M17-M20 ACE Reviewer Memory roadmap, which already plans semantic memory in a category-appropriate way (file-based, per-repo, scoped to REVIEW lessons).

**M8. LangGraph Python pipeline tier** (`pipelines/`). **No-borrow.** Out of category — adds a Python runtime. code-oz is Bun + TypeScript single-binary by deliberate commitment.

**M9. Web Studio portal + VS Code extension.** **No-borrow.** Out of category.

**M10. AWS Lambda distributed executor** (`src/orchestrator/lambda-executor.ts`, 40k LOC). **No-borrow.** Contradicts local-first thesis directly.

**M11. Agentinator (auto-generates agent system prompts from role + context).** **No-borrow.** Conflicts with rule 16 (universal anti-slop rules import) — code-oz personas are hand-authored with explicit `universal-rules.md` import, and any auto-generation surface would have to prove it preserves the universal rules. Cost outweighs the benefit; code-oz has a roster of six shipped roles, not an open-ended persona-generation problem.

## What code-oz has that Mimir lacks

(Distilling the disciplinary axes that justify code-oz's category. Most of these are repeated from prior comparisons; the list is the load-bearing reason code-oz exists as a separate product.)

C1. **File-based gate signals only** (rule 1). `state/GATE_<PHASE>_PASSED.json` schema-validated by `src/state/gates.ts`. Never parse LLM text for pass/fail. Mimir's PM emits a task graph JSON parsed from LLM output and consumed by the executor — exactly the anti-pattern rule 1 forbids.

C2. **Cross-family review at REVIEW gate** (rule 2). REVIEW agent must be a different provider family than BUILD; M14 panel quorum is two cross-family voters. Mimir's QC is the same family as Worker by default and there is no cross-family enforcement.

C3. **3-source verification before code** (rule 3). PLAN cannot pass without `SOURCE_CHECK.md` (spec + reference code + library docs). Mimir has no equivalent.

C4. **Run-level cumulative budget enforcement** (rule 19). `budgets.global` with cumulative `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`. Mimir has rate-limiting but no run-level cumulative cap.

C5. **Universal anti-slop rules** (rule 16). `src/prompts/universal-rules.md` imported by every persona. Mimir's Claudette has its own rules but no universal import discipline.

C6. **Maestro discipline** (rule 17). Rule-checker role + 9-family bug map + adversarial-review skills + four-layer FS memory.

C7. **Scientist tails** (rule 15). `HYPOTHESES.md` + `OPEN_QUESTIONS.md` blocked at gate preflight.

C8. **Permission manifest for any `.ts` escape hatch** (rule 9). Allowed commands, network, file roots, env vars, timeout, secret access. Default: no execution.

C9. **Privacy by default** (rule 13). `.code-ozignore`, secret redaction, file-size caps, "files sent to provider" preview, explicit file manifests, never silent recursive context. Mimir agents have full graph + repo access by default.

C10. **Brownfield AUDIT artifact** (rule 14). Greenfield/brownfield distinction. Mimir treats every task as a fresh decomposition.

C11. **One new authority boundary per milestone** (rule 20). Mimir's `workflow-executor.ts` (38k LOC) bundles prompt-optimization, task-graph generation, worker dispatch, QC verification, persistence, and SSE in one file — exactly the bundling rule 20 forbids.

C12. **Risk-reduction-measurable parallel-provider expansion** (rule 21). Mimir has parallel worker execution (`MIMIR_PARALLEL_EXECUTION` flag) but no A/B evidence requirement.

C13. **Cross-model peer review at every milestone** (durable workflow rule). Codex debate at planning convergence + Codex review at implementation completion, every milestone. Empirically validated 2026-04-29 (Codex flipped MVP from Option C to Option E) and many times since (M16: 12 production bugs caught and closed across 3 review rounds).

C14. **Worktree isolation with idempotent recovery and advisory locks** (M16). Mimir's `file-isolation.ts` is copy-and-merge; code-oz uses real git worktrees with audit-completeness recovery and lock-on-fail intervention.

C15. **Greenfield/brownfield phase split.** code-oz's lifecycle is asymmetric — brownfield starts at AUDIT, not DEFINE. Mimir collapses every task to one chain shape.

## Decision: YES, with three small selective borrows

code-oz is ahead of Mimir on **15 disciplinary axes** (C1-C15) that define the SDLC-runtime category. Mimir is ahead on **3 mechanics** that are useful regardless of category (M1 MCP server surface, M2 generalized OpenAI-compat adapter, M3 pre-execution rate-limit queue) and **5 surfaces** that are out of category for code-oz (M5 SSE/portal, M6 vision embeddings, M7 knowledge graph, M8 LangGraph Python tier, M9-M10 web/Lambda).

The verdict mirrors the Archon comparison shape: most of the template is out of category by deliberate product commitment, the discipline gaps are why code-oz exists as a separate product, and there is a small, well-bounded borrow set worth absorbing.

**Ranked borrow set** (pre-Codex):

1. **B1 — Read-only MCP-server adapter for code-oz run state.** Exposes `gate_status`, `events_tail`, `artifact_read`, `budget_remaining`, `intervention_pending`, `phase_current` as MCP tools bound to a specific `runId`. Read-only at v0.1. Targets a W4+ "external integration" milestone, gated on a named consumer demand (Claude Code, Cursor, or another MCP client wanting programmatic access). Strongest candidate.

2. **B2 — Generalize PE-1 `XaiProvider` into `OpenAICompatProvider`.** Config-driven `(baseUrl, apiKey, model)` dispatch with the same strict request-body allowlist and audited trust boundary. Adding Groq, Together, Fireworks, OpenRouter, Ollama, or llama.cpp becomes a config edit. PE-2 candidate. Small (~200 LOC + tests).

3. **B3 — Pre-execution rate-limit queue.** Reads `ProviderCapability.rateLimits` (declared in M11) and gates `IAgentProvider.invoke` calls. Closes the gap between declaration and enforcement. Self-contained, fits inside one milestone, no new authority axis. Best candidate for an inter-milestone refactor commit.

**Negative borrows** (explicit no-go):

- **N1 — Knowledge graph / Neo4j persistent memory.** Out of category; violates architecture lock; duplicates ACE M17-M20 Reviewer Memory roadmap intent.
- **N2 — Web Studio + VS Code extension.** Out of category; local-first CLI by commitment.
- **N3 — LangGraph Python pipeline tier.** Out of category; adds Python runtime.
- **N4 — AWS Lambda distributed executor.** Contradicts local-first thesis.
- **N5 — Agentinator auto-generated personas.** Conflicts with rule 16; cost outweighs benefit at code-oz's persona count.
- **N6 — OAuth/RBAC multi-tenancy.** Out of category; code-oz is single-user local.

## Open questions for Codex

1. Is the MCP-server-surface borrow (B1) the right shape, or does the *consumer* side (code-oz becoming an MCP *client* to surface tools to BUILD/VERIFY phases) earn the keep first?
2. Is the OpenAI-compat generalization (B2) safe to land before PE-2, or should it wait until a second HTTP adapter is needed and prove the abstraction against two concrete provider quirks?
3. Is the rate-limit-queue borrow (B3) necessary at code-oz's current call rate, or is it premature optimization — the M11 declaration without enforcement is closer to "honest gap" than "production bug"?
4. Did the analysis miss a Mimir mechanic that earns its keep against code-oz's discipline rules — particularly something memory-shaped that does NOT require a graph DB?
5. Are any of the negative borrows wrong — particularly the agentinator (auto-persona generation) given code-oz's roster will grow in M12+ extension?

These five questions go to Codex unmodified. Synthesis follows.
