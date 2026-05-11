# Comparison — byterover-cli (`brv`)

**Date:** 2026-05-10
**Author:** Claude Opus 4.7 (1M context)
**Template:** `~/Projects/agents/templates/byterover-cli/`
**Code-oz version at session start:** v0.17.0-alpha.0 (M16 closed, 3108 tests)
**Format precedent:** `docs/comparison/04-archon/COMPARISON.md` and `docs/comparison/05-agent-skills/comparison.md`
**Influence-library status (CLAUDE.md):** unaudited (not in the seven-template influence library)

---

## 1. What byterover-cli is

ByteRover CLI (`brv`) ships an interactive REPL with a React/Ink TUI that gives AI coding agents persistent, structured memory. Developers curate project knowledge into a "context tree," sync it to ByteRover Cloud, branch/merge it like git, and let other coding agents (Cursor, Claude Code, Windsurf, Cline) read it through MCP. The product is a knowledge layer that other agents plug into.

Engineering footprint (sampled from `CLAUDE.md`, `AGENTS.md`, `package.json`, `src/agent/infra/llm/providers/*`, `src/server/infra/executor/*`):

- **Stack:** oclif v4 + TypeScript ES2022 strict + React/Ink TUI + Vite web UI + Socket.IO + isomorphic-git + Mocha/Chai/Sinon/Nock.
- **Runtime shape:** global daemon hosts Socket.IO transport; `oclif/` and `tui/` are clients that never import from `server/` or `agent/`. ESLint-enforced import boundary.
- **Surface area:** 21 oclif command groups (`vc`, `hub`, `worktree`, `source`, `space`, `review`, `connectors`, `curate`, `model`, `providers`, `swarm`, `query-log`, plus 16 top-level commands). 21 LLM provider modules. 27 agent tool definitions. Web UI with 8 pages and 15 panels. MCP server exposes `brv-query-tool` and `brv-curate-tool`.
- **Domain model:** context tree (markdown files synthesized by a "curate" pipeline) under `.brv/`; runtime signals sidecar (`RuntimeSignalStore`) holds usage/maturity outside markdown frontmatter; query log records recall metrics; HITL `brv review` log scoped per project; `brv dream` runs background consolidation (synthesize, consolidate, prune) under a lock.
- **Search model:** two tiers. `brv search` is pure BM25 (`minisearch`) over the context tree — no LLM, no agent session, no token cost (`server/infra/executor/search-executor.ts`). `brv query` synthesizes an answer with the LLM. The two are deliberately separate primitives.
- **VC model:** isomorphic-git over the `.brv/` context tree with full add/branch/checkout/clone/commit/diff/fetch/log/merge/pull/push/remote/reset/status. Git-like.
- **Worktree model:** `.brv/` is either a real project directory OR a pointer file to a parent project; parent stores registry in `.brv/worktrees/<name>/link.json`. Same pattern as `git worktree`.
- **Multi-provider memory:** `brv swarm` federates queries and writes across pluggable adapters (byterover, gbrain, local-markdown, memory-wiki, obsidian) with RRF-fused search.
- **Discipline rules in CLAUDE.md/AGENTS.md:** strict TDD non-negotiable (5-step RED-GREEN-REFACTOR with explicit step-1 ordering), Outside-In feature development as a foundational principle ("if a plan, project, or milestone ordering violates Outside-In, flag it"), 80% coverage minimum, ES modules with `.js` import extensions, `I` prefix for interfaces, `toJson()`/`fromJson()` capital-J serialization.
- **Public benchmarks:** LoCoMo 96.1% accuracy (1,982 questions, 272 docs), LongMemEval-S 92.8% (500 questions, 23,867 docs). Run on production codebase, not a research prototype.
- **Distribution:** `curl -fsSL https://byterover.dev/install.sh | sh` (bundled, no Node) plus `npm install -g byterover-cli`.
- **License:** Elastic License 2.0 (source-available, not OSI-open).

---

## 2. What code-oz is (relevant axes)

(Restated from `CLAUDE.md` and `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` to make the comparison legible.)

- **Category:** repo-native agentic SDLC runtime. Coordinates role-specialized agents through artifacts, evidence gates, debate, verification, and cross-family review.
- **Stack:** Bun + TypeScript native single-file binary via `bun build --compile`.
- **Phase taxonomy:** `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` (greenfield) and `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP` (brownfield).
- **Authority model:** rule 20 limits each milestone to one new gate or capability domain; rule 21 requires measurable risk-reduction in `events.jsonl` before any new parallel-provider surface lands.
- **Provider model:** `IAgentProvider` with subprocess delegation (Claude / Codex / Gemini reading CLI OAuth tokens) plus first HTTP adapter (xAI, PE-1 closed v0.13.0-alpha.0). Demand-driven expansion.
- **Search model:** rule 18 — `tool_use.repo_context` permission scope; selected paths enter the *next* invocation's `ProviderRequest.files`, never the search invocation's hidden context. Network access denied for repo_context tools.
- **State model:** typed FSM + `state/events.jsonl` event log + schema-validated gate files. Forward-only; no SQLite.
- **Cost model:** rule 19 — `budgets.global` cumulative caps with per-call enforcement; soft warnings at `softWarnAtRatio`, hard kills at 1.0; price table for dollar telemetry.
- **Cross-family review:** rule 2 — REVIEW must be a different provider family than BUILD. Pass file paths, not curated summaries. Hard cap of 4 review rounds (rule 6).
- **Verification model:** rule 3 — 3 sources (spec + reference code + library docs) before any code; PLAN cannot pass without `SOURCE_CHECK.md`.
- **Privacy:** rule 13 — `.code-ozignore`, secret redaction, file-size caps, "files sent to provider" preview per phase. Agents receive explicit file manifests, never silent recursive repo context.
- **Permission model:** rule 9 — permission manifest required for any `.ts` escape hatch; allowed commands / network / file roots / env vars / timeout / secret access; default no execution.
- **Resume model:** rule 12 — `runId`, idempotent gate writes, `code-oz resume`. Terminal death after PLAN must not restart DEFINE.
- **Maestro discipline:** rule 17 — rule-checker role + 9-family bug map + adversarial-review skills + four-layer file-system memory documented in `docs/research/01-maestro-rule-checker.md`.
- **Universal anti-slop:** rule 16 — every persona prompt imports `src/prompts/universal-rules.md` (10 prohibitions + 10 affirmations).
- **Reviewer panel + debate scheduler:** M14 (reviewer panel v1, first simultaneous-provider surface) + M15 (debate-policy scheduler v1, single-opponent only, `requestDebate()` primitive in M10).
- **Distribution (W3+):** npm + Homebrew + Scoop with auto-PATH-patching install script. Single bun-compiled binary.

---

## 3. Side-by-side feature matrix

The matrix is organized by the **functional surface** byterover-cli ships, rated against what code-oz already has or does not have. "Adjacent" means code-oz solves a different problem with a different mechanic, not that the byterover version is missing.

| Axis | byterover-cli | code-oz | Status |
|---|---|---|---|
| **A1. CLI distribution** | npm + bundled install.sh; oclif v4; `brv` entry. | `bun build --compile` single-file native binary; npm + Homebrew + Scoop planned (W3+). | Adjacent. Both ship a CLI; different mechanics. |
| **A2. Interactive REPL + TUI** | React/Ink TUI with slash commands; `brv` (no args) starts REPL. | One-shot CLI subcommands (`init`, `run`, `doctor`, `resume`). No REPL. | Code-oz lacks. Reject for v0.1 (see §6). |
| **A3. Web UI dashboard** | 8 pages, 15 panels, Vite/React, served by daemon over Socket.IO. | None planned. | Code-oz lacks. Reject for v0.1 (see §6). |
| **A4. Daemon architecture** | Global daemon, agent pool with forked child processes per project, Socket.IO transport. ESLint-enforced import boundary (`oclif/`, `tui/` never import from `server/`). | One-shot subprocess delegation per agent invocation; no daemon. | Adjacent. Code-oz's runs are short-lived; no shared state to host. |
| **A5. Multi-provider LLM** | 21 providers in dedicated modules (Anthropic, OpenAI, Google, Groq, Mistral, xAI, Cerebras, Cohere, DeepInfra, DeepSeek, OpenRouter, Perplexity, TogetherAI, Vercel, Minimax, Moonshot, GLM, GLM-Coding-Plan, OpenAI-Compatible, ByteRover hosted). | `IAgentProvider` interface with subprocess delegation (Claude / Codex / Gemini via CLI OAuth) + HTTP (xAI direct, PE-1). Demand-gated expansion. | Code-oz lacks 17 of byterover's providers. Reject — rule 11 (PE-2+ demand-gated); rule 20 (one boundary per milestone). |
| **A6. Two-tier search** | `brv search` (BM25 minisearch, deterministic, no LLM, no token cost) and `brv query` (LLM-synthesized) are separate primitives. | Rule 18 defines `tool_use.repo_context` as a sub-scope; one tool surface today. | **Borrow candidate B2.** Splitting deterministic-search from LLM-synthesized query reduces token cost and bounds latency. |
| **A7. Git-like VC over knowledge** | `brv vc` runs isomorphic-git over the context tree (add, branch, checkout, clone, commit, diff, fetch, log, merge, pull, push, remote, reset, status). | `state/events.jsonl` event log + schema-validated gate files; forward-only state machine. | Adjacent. Code-oz's state is forward-only by design; branch/merge of run history is a different paradigm. Reject. |
| **A8. Worktree pointer model** | `.brv/` can be a pointer file redirecting to a parent project; parent registry in `.brv/worktrees/<name>/link.json`. Same pattern as `git worktree`. | M7 introduced worktree-isolation for BUILD; ranks `projectRoot` per run. Different problem (build isolation, not subdir reuse). | Adjacent. Different problem. Reject. |
| **A9. Read-only knowledge sources** | `brv source add <path>` links another project's context tree as read-only with write isolation; search results tagged `local` vs `shared` origin. | Single-project run model; no cross-project import surface. | Code-oz lacks. Out of scope; SDLC runtime does not federate knowledge across repos. Reject. |
| **A10. MCP server** | `brv mcp` exposes `brv-query-tool` and `brv-curate-tool` over Model Context Protocol so other agents (Cursor, Claude Code, Windsurf) plug in. | None planned for v0.1. M11 (provider capability contract) leaves room for outbound MCP later. | Code-oz lacks. Defer; the value depends on having stable knowledge to expose, which code-oz does not produce as a primary artifact. Reject for v0.1. |
| **A11. Hub & connectors ecosystem** | npm-style package manager (`brv hub install`, registries, spaces); connectors plug-in agents (e.g., OpenClaude registered as a connector). | Skill files in `agent-skills/` format with permission manifests. No package registry. | Adjacent. Skills cover the prompt-pack role; package registry is premature (rule 20). Reject. |
| **A12. Swarm federation** | `brv swarm query` RRF-fuses search across providers (byterover, gbrain, local-markdown, memory-wiki, obsidian); `swarm curate` auto-routes content. | No analog. Code-oz federates *agents*, not memory backends. | Adjacent. Different problem. Reject. |
| **A13. Background consolidation** | `brv dream [--force] [--undo] [--detach]` runs synthesize/consolidate/prune in the background under `dream-lock-service.ts` + `dream-state-service.ts`. | None planned. | Code-oz lacks. No scale problem yet (events.jsonl is per-run); the lock+state pattern is borrow language for future maintenance commands. **Split candidate S1 (defer borrow).** |
| **A14. Runtime signals sidecar** | File-level usage/maturity in `RuntimeSignalStore` keyed by path segments, not in synthesized markdown frontmatter. Schema-validated. | `events.jsonl` records per-run signals; no per-file maturity index. | Adjacent. Code-oz's events.jsonl is run-scoped; byterover's is file-scoped. Out of scope for v0.1. Reject. |
| **A15. parentTaskId rollup** | `generateSummary` / `propagateStaleness` thread `parentTaskId` through curate, dream, and folder-pack executors so child summary regenerations roll up under one parent task instead of N detached billing rows. | M13 role-cost policy attributes spend per role; reviewer panel + debate scheduler can fan out 3+ provider calls under one orchestrator step. No explicit `parentTaskId` thread today. | **Borrow candidate B3.** M13 follow-up; closes a real billing-attribution gap that grows with M14/M15. |
| **A16. HITL review log + AsyncLocalStorage** | `brv review [--disable | --enable]` is a project-scoped HITL toggle; flag is **snapshotted at task creation and propagated via AsyncLocalStorage** (`resolveReviewDisabled`) so mid-task toggles do not race. | REVIEW gate is a phase boundary; budget kills are checked per-call against `events.jsonl`. No mid-run policy toggle today. | **Borrow candidate B5 (pattern-only).** AsyncLocalStorage snapshot pattern for any policy that could toggle mid-run (e.g., budget priceTable, debate policy, panel reviewer set). |
| **A17. Query log + recall metrics** | `brv query-log view` / `brv query-log summary` records coverage, cache hit rate, top topics; uses summary use-cases. | `events.jsonl` records per-call events but no curated query log. | Adjacent. Code-oz's events.jsonl is the data source; building a summary command on top is a future polish task, not a borrow that earns a milestone slot. Reject for v0.1. |
| **A18. Outside-In as foundational principle** | "Applies to ALL work: planning, reviewing, coding, and auditing. If a plan, project, or milestone ordering violates Outside-In, flag it." Start from consumer, define minimal interface, implement service, extract entities only when shared structure emerges across multiple consumers. | Rule 20 ("one authority per milestone") is a milestone-shape rule, not a code-shape rule. No explicit consumer-first principle in the non-negotiable rules list. | **Borrow candidate B1.** Adds a missing axis to non-negotiables: design starts from a concrete consumer, not from abstractions. Complements rule 20. |
| **A19. Strict TDD non-negotiable (RED first)** | 5-step ordering: write failing test → run to confirm failure for the right reason → minimal implementation → run to confirm pass → refactor. "If you catch yourself writing implementation code without a failing test, STOP and write the test first." | Rule 8: `FakeProvider` runs the full lifecycle offline. No explicit "test-first" mandate in non-negotiables. Tests are pervasive (3108 of them) but discipline is informal. | **Borrow candidate B4.** Adds RED-first ordering to non-negotiables. Cheap; lands as a CLAUDE.md edit. |
| **A20. ESLint-enforced import boundary** | `tui/` must not import from `server/`, `agent/`, or `oclif/`. Boundary is enforced by lint, not docs. | No analog in `eslint.config.*` today. Code-oz's CLI is small enough that violations are rare, but the future shape (oclif-style commands + runtime + agents) will benefit from an enforced boundary. | **Borrow candidate B6 (defer until M17+).** Useful future-proofing; not load-bearing today. |
| **A21. Public benchmarks on production code** | LoCoMo 96.1% / LongMemEval-S 92.8% on the production codebase, not a research prototype. | None published. M14 (reviewer panel) and M15 (debate scheduler) are rule-21 candidates that need risk-reduction metrics in `events.jsonl` against a single-provider baseline. | Adjacent. Code-oz's measurement framework (rule 21) is more rigorous; byterover's is benchmark-driven. Different domains. No borrow, but it's a reminder that rule-21's metrics need to actually be published when reviewer panel + debate scheduler ship. |

---

## 4. Where code-oz already exceeds byterover-cli (no borrow needed)

These are **structural authorities** byterover does not have, listed once for the influence library:

1. **Phase gates with file-based signals** (rule 1, rule 7). byterover has no SDLC concept; `brv curate` is a single pipeline with a HITL review log, not a multi-phase artifact contract.
2. **Cross-family REVIEW** (rule 2). byterover's `brv review` is HITL by a *human*, not adversarial review by a *different model family*.
3. **3-source verification before code** (rule 3). byterover has no analog; the curate pipeline does not require source citations.
4. **Brownfield AUDIT phase** (rule 14). byterover does not distinguish brownfield from greenfield work.
5. **Scientist epistemic sidecars at gates** (rule 15). byterover has no `HYPOTHESES.md` / `OPEN_QUESTIONS.md` discipline.
6. **Universal anti-slop rules in every persona prompt** (rule 16). byterover's system prompts are XML-section contributors but do not import a universal rule sheet.
7. **One authority boundary per milestone** (rule 20). byterover ships large surfaces (web UI, swarm, hub) without that constraint; the codebase shows 31 server modules, 23 agent infra modules, 23 TUI feature modules, 15 webui panels — high authority density.
8. **No new parallel-provider surface without measurable risk reduction** (rule 21). byterover ships swarm federation without publishing per-provider risk-reduction data; `brv swarm` is a feature, not a measured surface.
9. **Demand-driven provider expansion** (rule 11, PE-1 / PE-2+). byterover ships 21 providers as a feature claim; code-oz expanded to xAI HTTP only after demand signal (Codex debate thread `019de497`).
10. **File-manifest context, no silent recursive repo context** (rule 13, rule 18). byterover's "agentic map" is permissive; code-oz's repo_context is permission-gated and audited via `repo_context_searched` events.
11. **Cumulative budget enforcement with cumulative `events.jsonl` accounting** (rule 19). byterover has compression strategies (oldest-removal, middle-removal, escalated, reactive-overflow) but no per-call cumulative budget kill.
12. **Resume + idempotent gate writes** (rule 12). byterover's daemon makes resume implicit but does not formalize idempotent state writes; `brv curate` rejects overlapping runs rather than resuming them.

The takeaway: byterover-cli is more product-mature on the **runtime engineering** side (daemon, REPL, web UI, MCP, 21 providers, benchmarks) but has none of code-oz's **discipline mechanics**. They are complementary, not competing.

---

## 5. Borrow candidates with rule-20 sub-surface accounting

Each borrow is priced before sequence. The agent-skills round (round 5) flagged that not pricing borrows in rule-20 sub-surfaces is the failure mode that lets bundled milestones hide bugs (memory pin: `feedback_rule20_sharper_application.md`).

| ID | Borrow | Rule-20 sub-surfaces | Rule-21 surface? | Lands at |
|---|---|---|---|---|
| **B1** | Outside-In as a non-negotiable rule (consumer-first) | 0 (CLAUDE.md edit, no new authority) | No | next docs commit |
| **B2** | Two-tier search: deterministic `code-oz search` (BM25) adjacent to LLM-synthesized `code-oz consult` | 2 (new CLI subcommand authority + new repo-index storage authority) | No (both single-provider) | M18 candidate |
| **B3** | `parentTaskId` rollup in role-cost policy | 1 (M13 role-cost policy schema extension; small) | No (telemetry-only) | M13 follow-up commit |
| **B4** | Strict TDD step-1 ordering (RED-first) as non-negotiable | 0 (CLAUDE.md edit) | No | next docs commit |
| **B5** | AsyncLocalStorage snapshot pattern for policy-at-task-creation | 0 (pattern only — applied opportunistically when a new policy ships) | No | applied per surface as needed |
| **B6** | ESLint-enforced import boundary between CLI and runtime | 1 (eslint config + boundary rule + CI gate; small) | No | M17+ when CLI surface grows past three subcommands |
| **S1** | `brv dream`-style background consolidation lock+state pattern (defer until events.jsonl scale problem) | 1 if it ever lands; 0 today | No | not v0.1; revisit when events.jsonl growth is a real concern |

### B1 — Outside-In as a non-negotiable rule

**What:** add a non-negotiable rule (rule 22) to `CLAUDE.md`: "Outside-In feature design. Every new code path starts from a concrete consumer (CLI subcommand, agent skill, or persona prompt). Define the minimal interface the consumer requires; implement the service to fulfill it; extract entities only when structure is shared across consumers. Reviewing or planning that defines entities, types, or store interfaces before any consumer exists is Inside-Out and must be flagged."

**Why it earns its place in code-oz:** rule 20 limits authority *count*; Outside-In limits authority *shape*. M16's eight-bug pattern (memory pin: `feedback_rule20_sharper_application.md`) was sub-surface bundling — the bugs survived per-commit review because they sat behind interfaces that had no concrete consumer until the e2e test ran. Outside-In flags the symptom upstream.

**Why borrow vs derive:** byterover's framing ("applies to ALL work — if a plan or milestone ordering violates Outside-In, flag it") is sharper than anything in code-oz's current rule set. The phrasing earns its place.

**Cost:** zero. CLAUDE.md edit (~10 lines added).

### B2 — Two-tier search

**What:** introduce `code-oz search <query>` as a deterministic BM25 retrieval over the project (allowed `tool_use.repo_context` files only) that returns scored results with paths, *no LLM, no agent session, no token cost*. `code-oz consult <question>` (existing rule 18 surface, currently the only way to run repo_context) remains the LLM-synthesized path and continues to bill against the global budget.

**Why it earns its place in code-oz:**

- Rule 19 (cumulative budget enforcement) treats every provider call as a cost. Today the only way to "look something up in the project" is through an LLM call (consult/repo_context). A deterministic search primitive gives the orchestrator a zero-cost option for "before I spend tokens, do these files even exist / contain this string?"
- Rule 18 keeps repo_context audited; B2 extends the audit to a no-LLM path, which makes the audit cheaper to enable broadly.
- The orchestrator can use `code-oz search` as a first-pass filter and only escalate to `code-oz consult` when the BM25 hit list is ambiguous. That is a structural cost reduction that compounds across debate and reviewer-panel surfaces.

**Why borrow vs derive:** byterover's `search-executor.ts` is 42 lines, builds on `minisearch`, and the architectural decision to *keep the two surfaces separate* is the load-bearing insight. Code-oz could build it from scratch but would likely conflate it with consult.

**Cost:** rule-20 sub-surfaces = 2.

1. New CLI subcommand authority: `code-oz search` is a third top-level subcommand alongside `init` and `run`.
2. New repo-index storage authority: the BM25 index needs to live somewhere (`.code-oz/index/<sha>.json` or in-memory rebuild on each invocation). The choice between persisted vs ephemeral is itself a design decision.

**Sequencing:** earliest M18 (post-SHIP completion) candidate. Not v0.17. The rule-20 cost is real and the milestone slot should be priced against SHIP completion, doubt-driven pre-BUILD checkpoint (per agent-skills round), and other M17/M18 contenders.

### B3 — parentTaskId rollup in role-cost policy

**What:** extend M13's role-cost telemetry so that when a role spawns child provider calls (debate runtime, reviewer panel, repo_context search), each child call records the *parent* task ID. The cost-rollup view then shows "M14 reviewer panel run #5: $0.42 across 3 reviewer calls" instead of "3 disconnected reviewer calls totaling $0.42."

**Why it earns its place in code-oz:** M14 (reviewer panel v1) and M15 (debate scheduler v1) are the *first surfaces* in code-oz where one orchestrator step fans out to multiple provider calls. M13 priced spend per role but did not anticipate fan-out. This is the same gap byterover hit when curate spawned summary regenerations and saw "N detached billing rows" as a real pain. byterover's fix is mechanical; code-oz's analog is one schema field on `RoleCostEvent` plus a small orchestrator change.

**Why borrow vs derive:** byterover's pattern is well-articulated in `CLAUDE.md` as a *requirement* on executors ("MUST thread the operation's `taskId` through"). The MUST framing is the borrow.

**Cost:** rule-20 sub-surfaces = 1. M13 role-cost schema extension. Telemetry-only, no behavioral change, no new authority boundary.

**Sequencing:** M13 follow-up. Single commit, lands before M17.

### B4 — Strict TDD step-1 ordering as non-negotiable

**What:** add a non-negotiable rule (rule 23) to `CLAUDE.md`: "Strict TDD ordering. For any behavior change, the failing test is written first, run to confirm it fails for the right reason, then minimal implementation lands, then tests run again to confirm green, then refactor. If implementation lands without a prior failing test, STOP and write the test first."

**Why it earns its place in code-oz:** the agent-skills round 2 SYNTHESIS (commit 3 in the agent-skills landing plan) already added "validation must prove new behavior" to the PLAN/builder personas. B4 is the upstream non-negotiable that PLAN/builder language operationalizes. It is one rule in `CLAUDE.md`, not 50 lines of persona prose.

**Why borrow vs derive:** byterover's 5-step framing ("Step 1 — write failing tests FIRST" with explicit "If you catch yourself…") is unusually crisp.

**Cost:** zero. CLAUDE.md edit (~6 lines added).

### B5 — AsyncLocalStorage snapshot pattern for policy-at-task-creation

**What:** an architectural pattern, not a one-shot borrow. When a future surface in code-oz introduces a policy flag that *could* toggle mid-run (debate-policy mode, panel reviewer set, budget priceTable), snapshot the policy at task creation and propagate via AsyncLocalStorage instead of reading the live config on each call. byterover does this for `resolveReviewDisabled` so mid-task `brv review --disable` toggles do not race.

**Why it earns its place in code-oz:** rule 19 (cumulative budget enforcement) reads `events.jsonl` per-call. If a future feature lets a user `code-oz config set budget.priceTable …` mid-run, the half-already-spent run could see two different price tables. AsyncLocalStorage snapshot at run start prevents the race without a lock.

**Why borrow vs derive:** the pattern is well-known but byterover's phrasing ("snapshotted at task creation and propagated via AsyncLocalStorage so mid-task toggles do not race") is the language to lift into our future-surface ADRs.

**Cost:** zero today (no surface uses it). When a future surface needs it, the cost is one rule-20 sub-surface (the policy-snapshot service). Track as a pattern in influence library, not a milestone slot.

### B6 — ESLint-enforced import boundary between CLI and runtime

**What:** as code-oz grows past three CLI subcommands, add an ESLint rule that forbids `src/cli/**` from importing `src/agents/**` or `src/runtime/**` directly; CLI talks to runtime through a typed adapter (today: just the FSM transition primitives).

**Why it earns its place in code-oz:** the M16 production CLI completion just landed (memory: `m16_progress.md`, 34 commits, 12 production bugs). The CLI surface will grow. byterover's lint-enforced boundary is the cheapest way to keep the CLI from becoming a load-bearing knower of runtime internals.

**Why borrow vs derive:** the *enforced* part (CI lint, not docs) is the load-bearing piece.

**Cost:** rule-20 sub-surfaces = 1. ESLint config change + CI gate + a small refactor if the current code already crosses the boundary.

**Sequencing:** M17+ when CLI grows past `init`/`run`/`doctor`/`resume`. Not load-bearing today.

---

## 6. Reject list (with reasons)

These are the byterover surfaces explicitly *not* borrowed. Documenting the rejection up-front prevents re-litigation in future sessions.

| ID | Reject | Reason |
|---|---|---|
| **R1** | 17 additional dedicated LLM provider modules | Rule 11 (PE-2+ demand-gated). Rule 20 (one authority per milestone). PE-1 took two review rounds for one provider; PE-2 has no demand signal. |
| **R2** | Hub/connectors npm-style package manager | Skills system already serves the prompt-pack role (`agent-skills/` format with permission manifests, see CLAUDE.md influence library row 1). Adding a registry is rule-20 expensive (anatomy + loader + permissions + verification audit) for benefit code-oz does not need yet. |
| **R3** | REPL + React/Ink TUI | Code-oz is intentionally one-shot CLI; REPL is a separate UX authority that costs at least three rule-20 sub-surfaces (REPL loop, slash command registry, streaming-cancel UX). No demand signal. |
| **R4** | Web UI dashboard (Vite + React + 8 pages + 15 panels) | Out of scope for v0.1. The W3+ distribution plan (Homebrew/Scoop/npm) is the surface that needs work, not an in-product UI. |
| **R5** | Git-like VC over the context tree (isomorphic-git on `.brv/`) | code-oz's `state/events.jsonl` is forward-only by design (rule 19 reads cumulatively per-call). Branch/merge of run history is a different paradigm; introducing it would invalidate budget enforcement assumptions. |
| **R6** | Daemon + Socket.IO architecture | Code-oz runs are bounded and short-lived; a daemon adds lifecycle authority (start/stop/health/restart) without the multi-client benefit byterover gets from REPL+TUI+webui+MCP. Reject. |
| **R7** | Swarm federation across memory backends (`brv swarm`) | Code-oz federates *agents* (cross-family REVIEW, reviewer panel, debate scheduler), not memory backends. Different problem space; rule 21 already governs the federation we do have. |
| **R8** | `brv source add` cross-project knowledge linking | Single-project run model is intentional. Cross-project import is out of category. |
| **R9** | `brv worktree` pointer model | Different problem from M7 worktree-isolation (build sandbox vs. subdir reuse). Reject; the namespace overlap is incidental. |
| **R10** | Outbound MCP server exposing code-oz tools | Code-oz does not produce stable knowledge as a primary artifact; the value of an MCP surface depends on having something to expose. Defer until SHIP completion (M17 candidate per agent-skills round) clarifies the artifact set. |

---

## 7. Verdict

**Verdict: YES, code-oz exceeds byterover-cli on the dimensions that matter for the SDLC runtime category, with three small borrows that close real gaps.**

byterover-cli is a more product-mature **memory layer** — daemon, REPL, web UI, MCP, 21 providers, public benchmarks. Code-oz operates in a different category (SDLC runtime) and structurally exceeds byterover on the discipline mechanics that define the category: phase gates, cross-family review, 3-source verification, AUDIT, Scientist sidecars, universal anti-slop, one-authority-per-milestone, demand-driven expansion, file-manifest context, cumulative budget enforcement, idempotent resume.

Three borrows earn their place at low cost:

- **B1** (Outside-In as non-negotiable) and **B4** (RED-first TDD as non-negotiable) — both zero rule-20 cost, both CLAUDE.md edits, both close phrasing gaps in the rules list rather than introducing new authority.
- **B3** (parentTaskId rollup) — one rule-20 sub-surface, M13 follow-up commit, closes a real billing-attribution gap that grows with M14/M15.

Three borrows are valuable but should not land at v0.17:

- **B2** (two-tier search) — earliest M18 candidate; competes with SHIP completion and doubt-driven pre-BUILD checkpoint for the M17/M18 slot.
- **B5** (AsyncLocalStorage snapshot pattern) — track as influence-library pattern; apply when a surface needs it.
- **B6** (ESLint-enforced import boundary) — track for M17+ when CLI grows past four subcommands.

Ten surfaces are rejected with reasons (R1-R10) to prevent re-litigation.

---

## 8. Open questions for the Codex debate (next document)

1. **Is the verdict honest?** Code-oz and byterover-cli are in adjacent categories. Is "code-oz exceeds on SDLC runtime authorities" a fair claim, or does it understate the engineering byterover ships that code-oz will eventually need (daemon, web UI, MCP)?
2. **Is B2 (two-tier search) M18-priced correctly?** It introduces two rule-20 sub-surfaces (CLI subcommand + index storage). Is the cost-reduction story (orchestrator gets a zero-token first-pass before consult) compelling enough to compete with SHIP completion or doubt-driven pre-BUILD checkpoint for the M17/M18 slot?
3. **Is B3 (parentTaskId rollup) actually a M13 follow-up?** The reviewer panel + debate scheduler are *already* shipped (M14/M15). The detached-row problem may already exist in `events.jsonl` from M14/M15 runs. If so, B3 is a *bug fix* sized as a M13 follow-up, not a feature; should it ship sooner than the next docs commit cycle?
4. **B1 and B4 — is the borrow language correct?** Outside-In and RED-first TDD are well-known principles. Adding them to non-negotiables risks rule-list bloat. Is the right framing (a) two new top-level rules, (b) one consolidated "design and verification discipline" rule, or (c) keep them in skills/persona prompts and not the non-negotiable list at all?
5. **R10 (no outbound MCP) — is this the right call?** Code-oz exposing its events stream / artifact set as an MCP server might be the cheapest way to validate the "AI software company" thesis: other agents could *consume* code-oz's gate signals as evidence. Is the rejection too quick?
6. **Are there byterover surfaces this comparison missed?** Specifically: the `RuntimeSignalStore` pattern (file-level usage/maturity outside markdown frontmatter) — is there a code-oz analog where this would matter (e.g., per-file cost attribution for repo_context lookups)?
7. **Is the rule-20 sub-surface accounting sharp enough?** B2 is priced at 2 sub-surfaces (CLI subcommand + index storage). Is that actually 3 if you count the BM25 indexer service itself as separate from the storage? The agent-skills round 2 lesson was that under-counting hides bugs.
8. **Distribution: borrow `curl | sh` install or not?** byterover ships a bundled installer; code-oz's W3+ plan is npm + Homebrew + Scoop. Is `curl | sh` worth one rule-20 sub-surface (release tarball + install script + signature verification) for the friction reduction it gives non-Node users?

---

## 9. Cross-references

- Influence library: `CLAUDE.md` § "Influence library" (7 audited templates; byterover-cli is unaudited at session start).
- Comparison method: `docs/comparison/README.md` (numbered-folder layout; one project per session).
- Most recent prior session: `docs/comparison/05-agent-skills/synthesis.md` (round 2 closed with 4-commit landing plan).
- Memory pin most relevant to this round: `feedback_rule20_sharper_application.md` (M16 sub-surface bundling proved bundling hides bugs; this comparison prices each borrow before sequencing).
- Related rule-21 round: `docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md` (thread `019de031`) — pinned the post-M10 sequence and rule-21 metric requirement.
- Codex briefing (next file): `docs/comparison/09-byterover-cli/CODEX_BRIEFING.md`.
