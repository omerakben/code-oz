---
name: codex-briefing-mimir
target: cross-model adversarial review of the code-oz vs Mimir comparison
companion-doc: COMPARISON.md (sibling file)
codex-model: gpt-5.5
codex-effort: xhigh
codex-sandbox: read-only
debate-rule: CLAUDE.md "Cross-model peer review (durable rule)"
---

# Codex briefing — Mimir borrow set debate

## Goal

Adversarially review the Mimir vs code-oz comparison and lock the borrow set before any borrow code is written. Specifically:

1. Decide whether the verdict (YES, code-oz is ahead with three small borrows) is correctly shaped.
2. Decide whether each ranked borrow (B1, B2, B3) is correctly priced (milestone slot, authority cost, scope).
3. Decide whether the negative-borrow list (N1-N6) is correctly *negative* — particularly N1 (knowledge graph) and N5 (agentinator).
4. Surface any Mimir mechanic Claude undersized or missed entirely.
5. Pressure-test the rule-21 framing on B1 (MCP server) — is "named consumer demand" the right gate, or does shipping it speculatively earn its keep?

## Constraints to honor

These are **non-negotiable** project rules. Codex should weigh them as load-bearing constraints, not negotiable preferences:

- **Rule 1**: File-based gate signals only. Never parse LLM text for pass/fail.
- **Rule 13**: Privacy by default. Agents receive explicit file manifests, never silent recursive context.
- **Rule 19**: Run-level cumulative budget enforcement (`budgets.global`).
- **Rule 20**: One new authority boundary per milestone.
- **Rule 21**: No new parallel-provider surface without measurable risk-reduction effect in `events.jsonl` against single-provider baseline.
- **Architecture lock**: No SQLite v0.1, file-only persistence, single-binary distribution (`bun build --compile`).
- **Product thesis** (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`): Repo-native local-first; the repo IS the memory; cross-conversation persistent memory is a different product category.

## What Mimir is (so Codex starts from the same model)

Mimir (`mimirframework/Mimir`) is a Docker-first **memory-native MCP server** built around a Neo4j knowledge graph and a GPU-accelerated graph-and-embeddings sidecar (`nornicdb/`). The headline product is *persistent agent memory* — the bundled "Claudette" agent prompt literally states "your graph memory IS your thinking, not a tool you use." Around the memory core, Mimir wraps:

- A sequential PM → Ecko → Worker → QC orchestration chain (`src/orchestrator/agent-chain.ts:1-75`).
- A multi-provider LLM client that auto-discovers any OpenAI-compatible `/v1/chat/completions` endpoint (`src/config/LLMConfigLoader.ts:25-119`).
- An HTTP API + SSE event stream (`src/api/orchestration/sse.ts`) and a React web "Studio" portal at `:9042/portal`.
- A VS Code extension (`vscode-extension/`).
- A LangGraph Python pipeline tier (`pipelines/`).
- An AWS Lambda distributed executor (`src/orchestrator/lambda-executor.ts`, 40k LOC).
- An MCP server surface that exposes its memory ops (`discover`, `store`, `link`, `recall`, `task`, `tasks`, `index`) to external agents via `@modelcontextprotocol/sdk` (`src/orchestrator/mcp-tools.ts`).
- Distribution via 5 Docker Compose flavors (`docker-compose.{arm64,amd64,arm64.hybrid,arm64.nornicdb,ollama}.yml`) selected by a platform-detect entry script.
- State in Neo4j 5.15 nodes plus a `TaskOutputs` registry; decisions are **parsed from LLM text into graph state** — exactly the rule-1 anti-pattern.

The full audit is in the sibling `COMPARISON.md`.

## The proposed borrow set (verbatim)

**B1 — Read-only MCP-server adapter for code-oz run state.** Exposes `gate_status`, `events_tail`, `artifact_read`, `budget_remaining`, `intervention_pending`, `phase_current` as MCP tools bound to a specific `runId`. Read-only at v0.1. Targets a W4+ "external integration" milestone, gated on a named consumer demand (Claude Code, Cursor, or another MCP client wanting programmatic access).

**B2 — Generalize PE-1 `XaiProvider` into `OpenAICompatProvider`.** Config-driven `(baseUrl, apiKey, model)` dispatch with the same strict request-body allowlist and audited trust boundary. Adding Groq, Together, Fireworks, OpenRouter, Ollama, or llama.cpp becomes a config edit. PE-2 candidate. Small (~200 LOC + tests).

**B3 — Pre-execution rate-limit queue.** Reads `ProviderCapability.rateLimits` (declared in M11) and gates `IAgentProvider.invoke` calls. Closes the gap between declaration and enforcement. Self-contained, fits inside one milestone, no new authority axis.

## The proposed negative-borrow list (verbatim)

- **N1** — Knowledge graph / Neo4j persistent memory. Out of category; violates architecture lock; duplicates ACE M17-M20 Reviewer Memory roadmap intent.
- **N2** — Web Studio + VS Code extension. Out of category.
- **N3** — LangGraph Python pipeline tier. Out of category; adds Python runtime.
- **N4** — AWS Lambda distributed executor. Contradicts local-first thesis.
- **N5** — Agentinator auto-generated personas. Conflicts with rule 16; cost outweighs benefit at code-oz's persona count.
- **N6** — OAuth/RBAC multi-tenancy. Out of category; code-oz is single-user local.

## Five debate prompts (Codex addresses each in order)

### Prompt 1 — Verdict shape

Is "YES, code-oz is ahead with three small borrows" the right verdict? Specifically:

- Does the 15-axis disciplinary lead (C1-C15) hold? Are any of those axes actually *not* a code-oz lead — i.e., does Mimir cover them in a way Claude missed?
- Does the 3-borrow set cover the load-bearing Mimir mechanics, or is one of them a distraction and a different mechanic should take its place?
- Is the verdict shape consistent with prior comparisons (ace, agenticSeek, aris, archon, agent-skills, byterover-cli) where code-oz also came out ahead with selective borrows? If yes, that consistency is suspicious — every template can't be inferior. Is Claude grading on a curve?

### Prompt 2 — B1 (MCP server) pricing

Is "read-only at v0.1, gated on named consumer demand" the right shape for B1, or:

- (a) Should it ship eagerly because exposing run state via MCP is itself the demand-creation move (similar to how Mimir's MCP surface is *what makes* Claudette adopt Mimir as memory)?
- (b) Should it ship as a *write-back* surface from day one because read-only MCP servers tend to bit-rot without a write counterpart?
- (c) Should the consumer-side mirror (code-oz as an MCP *client* surfacing external tools to BUILD/VERIFY phases) earn its keep first because it directly affects gate quality, while server-side is observability-shaped?

If (a), what is the smallest credible v0.1 surface? If (b), what's the safe write-back boundary that does not violate rule 1 (file-based gates)? If (c), what does the client-side phase integration look like?

### Prompt 3 — B2 (OpenAI-compat) timing

Should the `OpenAICompatProvider` generalization land before or after PE-2 brings the second concrete HTTP adapter?

- "Before" risk: the abstraction crystallizes around xAI's quirks (which are mostly OpenAI-compat-pure) and the second adapter (likely Groq or Together) reveals a missing axis.
- "After" risk: PE-2 grows another bespoke adapter, code drift accumulates, the strict-allowlist discipline gets duplicated and slowly diverges.

Codex: pick one and justify. Bonus: identify the specific quirks (Groq's prompt-cache header, Together's `together_extra` field, Fireworks' usage shape, OpenRouter's `route` field, Ollama's lax tool format) that would force a real abstraction divergence.

### Prompt 4 — B3 (rate-limit queue) necessity

Is the rate-limit queue necessary at code-oz's current call rate? Specifically:

- The M11 declaration without enforcement: is this an "honest gap" (documented intent, not yet exercised) or a "production bug" (the rate limits will be exceeded the first time a real run hits the panel + debate flow against a real provider)?
- If "honest gap": defer until PE-2 hits a real rate limit.
- If "production bug": fix in the next inter-milestone commit. What does the smallest credible queue look like — bounded `Promise` queue per `(provider, model)` keyed on `rateLimits.requestsPerMinute` and `rateLimits.tokensPerMinute`?

### Prompt 5 — Missed mechanics + negative-borrow audit

Two questions in one:

- (a) Did Claude miss a Mimir mechanic that earns its keep against code-oz's rules? Particularly look for: (i) memory-shaped mechanics that do NOT require a graph DB (e.g., file-based per-repo memory cache, summary compression, embedding-free recall), (ii) prompt-engineering mechanics inside Claudette / Ecko that could feed `universal-rules.md` or persona authoring, (iii) Lambda executor quirks that hint at a useful concurrency or fan-out primitive *without* the cloud dependency.
- (b) Is N5 (agentinator no-borrow) right? Mimir's `agentinator.ts` auto-generates agent system prompts from role + context. Code-oz's roster is six hand-authored personas today; M12 extension may grow it. Does the auto-generation surface have a category-appropriate version (e.g., a deterministic persona-template-renderer that imports `universal-rules.md`, fills role-specific blanks, and does NOT call an LLM)?

Codex: respond to each prompt in order, label your verdict on each (`accept` / `reject` / `accept-with-modifications`), and call out any rule-violation risks.

## Output format

Codex writes a structured response with:

- A one-line overall verdict (`accept` / `reject` / `accept-with-modifications` / `debate-required`).
- One section per prompt with sub-verdict + concrete recommendation.
- A "missed risks" section (severity tagged: `block-borrow` / `fix-soon` / `nit`).
- A "rule-violation audit" section (which proposed borrow risks which rule, scored 0-3 risk).

Claude captures Codex's response verbatim into `CODEX_RESPONSE.md` and synthesizes the locked borrow set in `SYNTHESIS.md` only after this debate closes.
