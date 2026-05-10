---
name: comparison-codegraph
template-path: ~/Projects/agents/templates/codegraph
template-version: 0.7.2 (Node 18-24, snapshot 2026-05-08; @colbymchenry/codegraph)
companion-docs: ../../contracts/REPO_CONTEXT.md, ../../design/ROADMAP.md (W3 section), IMPLEMENTATION_PLAN.md (this folder)
target: borrow-decision record + shipped contract for Codegraph vs code-oz
status: shipped (4 review rounds R0+R1+R2+R3 → R4 push, 2026-05-10)
review-rounds: R0 accept-with-modifications (019e12ed) → R1 fix-first (019e1326) → R2 fix-first (019e1330) → R3 fix-first (019e141b) → R4 push
decision: YES, code-oz is ahead **on category**, with two shipped borrows (B1 contract cleanup + B2 three-case eval harness) and one reclassified deferred-with-trigger (B5); shipped contract lives in `src/agents/schema.ts`, `src/tools/repo-context/permissions.ts`, `docs/contracts/REPO_CONTEXT.md § "Reservation and reopen-the-slot signal"`, and `tests/evaluation/repo-context/`
prior-borrows: none — codegraph not in CLAUDE.md influence library
---

> **Document status — synthesis complete and shipped.** This document
> reflects the post-implementation state after four Codex review
> rounds. The original pre-implementation framing is preserved as
> context but the borrow ranking, decision section, and references
> all describe what shipped. See `IMPLEMENTATION_PLAN.md § Outcome`
> and `CODEX_RESPONSE.md § Postscript` for the round-by-round
> evolution.

# code-oz vs Codegraph

## What codegraph is, in one paragraph

Codegraph (`@colbymchenry/codegraph`, MIT, v0.7.2) is a **local-first code-intelligence indexer for Claude Code**. It is a Node.js library + CLI + MCP server that builds a semantic knowledge graph from any codebase using tree-sitter WASM grammars and stores it in a per-project `.codegraph/` SQLite database (FTS5 enabled). The graph carries 22 `NodeKind`s (file, module, class, function, method, route, component, ...) and 12 `EdgeKind`s (calls, imports, extends, implements, references, ...), all extracted deterministically from AST — no LLM summaries. Eight MCP tools (`codegraph_explore`, `codegraph_context`, `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, `codegraph_node`) let Claude Code's Explore agents query the graph instead of running grep/glob/read across files. Reported benchmark: **94 percent fewer tool calls and 77 percent faster exploration** across six real-world codebases (VS Code, Excalidraw, Claude Code Python+Rust/Java, Alamofire, Swift Compiler). Architecture: `ExtractionOrchestrator` runs tree-sitter WASM in a worker-thread pool with periodic recycling (V8 WASM heap never shrinks); `ReferenceResolver` post-processes unresolved refs through framework-aware patterns (React hooks, Go stdlib, Python built-ins, Pascal unit prefixes — 13 web frameworks emit `route` nodes); `FileWatcher` debounces fs events for incremental sync; CLI ships `init`, `index`, `sync`, `status`, `query`, `context`, `serve --mcp`, plus an interactive installer that writes `~/.claude.json`, `~/.claude/settings.json`, and `~/.claude/CLAUDE.md`. Distribution is `npx @colbymchenry/codegraph` (interactive) plus `npm i -g`. There is no permission model — the MCP server reads any path it can OS-access; there is no audit log of what was returned to the caller.

## What code-oz is, restated for contrast

code-oz is a Bun + TypeScript **repo-native agentic SDLC runtime** with file-based gate signals, schema-validated artifacts, cross-family adversarial review, run-level cumulative budget enforcement, multi-provider abstraction, worktree-per-run isolation, permission manifests, `NEEDS_INTERVENTION` discipline, and one new authority boundary per milestone (rule 20). Through M16 it has shipped: provider capability contract (M11), company roster (M12), role-cost policy (M13), reviewer panel v1 (M14, first simultaneous-provider surface), debate-policy scheduler v1 (M15, single-opponent), production CLI completion (M16). 3108 tests pass offline. PE-1 added the first HTTP adapter (xAI). The relevant subsystem for this comparison is **REPO_CONTEXT (rule 18)** — a `tool_use.repo_context` permission sub-scope that exposes `glob`, `grep`, `read` (all delegating to `rg`) and reserves `symbol` for W3. Defaults: `maxResults=50`, `maxBytesPerResult=16384`, `maxFilesForNextManifest=20`, `timeoutMs=5000`, `network='none'`. Search results never enter the search invocation's hidden context; selected paths flow through the **next** `ProviderRequest.files` manifest. Every search is audited through a `repo_context_searched` event in `events.jsonl`.

## Domain boundary

Codegraph and code-oz are in **different categories**. Codegraph is a *code-intelligence indexer for chat-based AI coding tools* (specifically Claude Code's Explore agents). It has no concept of phases, gates, reviewers, runs, budgets, debates, artifacts, providers, profiles, or worktrees. Its unit of work is "answer a question about a codebase" via deterministic graph queries. code-oz's unit of work is "deliver one SDLC cycle from intent to ship" through six phase gates with cross-family adversarial review. Roughly 90 percent of codegraph's surface area is structurally orthogonal to code-oz: the SQLite schema, tree-sitter integration, framework-aware reference resolution, FTS5 search, file watcher, and 8-tool MCP surface all serve a different problem. The 10 percent that overlaps is **exactly one slot**: code-oz's reserved `symbol` tool inside `tool_use.repo_context` (REPO_CONTEXT.md:74-77). This comparison focuses on that overlap and on two narrow process patterns that transcend category.

## Feature matrix (overlap surfaces only)

Legend: **G** = codegraph, **C** = code-oz. `=` overlap; `>` ahead; `<` behind; `n/a` out of category.

| Surface | G | C | Notes |
|---|---|---|---|
| Codebase context for AI agents | 8 MCP tools backed by SQLite + tree-sitter graph | 3 in-process tools (`glob`, `grep`, `read`) backed by `rg` | `=` Same product job, different mechanics. codegraph indexes once and queries; code-oz greps live every call. |
| Symbol-aware queries | `codegraph_search`, `_callers`, `_callees`, `_impact`, `_node` (deterministic AST traversal) | `'symbol'` tool **RESERVED and not permissionable in v0.x** — config-load rejection at `src/agents/schema.ts` (`schema_invalid_permissions` with `RESERVED_REPO_CONTEXT_TOOLS`); runtime defense at `src/tools/repo-context/permissions.ts` (`tool_unavailable`). Type-union member kept for backward-compat; reopen gated on the 4-condition AND telemetry signal in REPO_CONTEXT.md § "Reservation and reopen-the-slot signal" | `<` Concrete category gap by design. code-oz's reserved slot is the schema lever that lets the comparison's borrow decisions land without authority creep (rule 20). |
| Permission scope on context tools | None — MCP server runs in client process, OS-level access only | `tool_use.repo_context` with `tools[]`, `roots[]`, `maxResults`, `maxBytesPerResult`, `maxFilesForNextManifest`, `timeoutMs`, `network='none'` (REPO_CONTEXT.md:13-29) | `>` code-oz only. Rule 18 makes context retrieval a permission sub-scope, not a tool-invocation default. |
| Audit trail of returned context | None — what the LLM saw is not logged | `repo_context_searched` event with `tool`, `query`, `roots`, `resultPaths`, `selectedPaths`, `resultBytes`, `resultTokensEstimate` (REPO_CONTEXT.md:87-105) | `>` code-oz only. The "manifest is the only source of truth for what bytes a provider call sent" invariant (file-based-gates.md:168) is preserved. |
| Privacy default | Whatever the OS exposes; no `.gitignore` carve-out by default beyond what tree-sitter ignores | `.code-ozignore` + secret redaction + file-size caps + "files sent to provider" preview + explicit file manifests (rule 13); `roots` intersected with `permissions.read` at request time | `>` code-oz only. |
| Result-byte cap | None visible — `codegraph_explore` enforces 35k char output limit per call but no per-tool byte cap | `maxBytesPerResult=16384` (Codex push-back math: 20×16KB÷4 ≈ 81,920 tokens, fits in PLAN's 300k phase cap) (REPO_CONTEXT.md:46) | `>` code-oz only. |
| Network access on context tools | Local-first by design but no enforcement primitive | `network='none'` is a fixed-at-request constant in v0.1 (REPO_CONTEXT.md:33) | `>` code-oz only — codegraph happens to be local; code-oz is local-by-contract. |
| Indexing model | Pre-index once, then incremental sync via `FileWatcher` + content hashes | No index — every search re-runs `rg` | `<` code-oz pays the search cost on every call; codegraph pays it once. For a single SDLC cycle (~10–30 invocations across phases) the cumulative `rg` cost is small; for repeated runs over the same repo, an index would amortize. |
| Sync mechanism | `fs.watch` debounced + SHA-256 content hash + incremental reindex | Stateless — `rg` always reads current state | `=` Different shapes for different problems. code-oz doesn't need a watcher because every run sees fresh state. |
| Tree-sitter parsing | 18 languages, lazy-loaded WASM grammars, worker-thread pool with `WORKER_RECYCLE_INTERVAL=250` to bound V8 WASM heap growth | None — code-oz does not parse code | `n/a` Not the orchestrator's job. Could be the `symbol` tool's job in W3. |
| Framework-aware reference resolution | 13 frameworks emit `route` nodes; React hooks, Go stdlib, Python built-ins, Pascal unit prefixes filtered as O(1) Sets | None | `n/a` Out of orchestrator scope. Maybe interesting for a future `route-aware` audit persona but speculative. |
| Storage | SQLite (`.codegraph/`) with 4 tables, 14 indexes, FTS5 virtual table with INSERT/UPDATE/DELETE triggers | Files only — `events.jsonl`, gate JSONs, Markdown artifacts; no SQLite v0.1 (architecture lock) | `n/a` Architectural choice. code-oz's lock survives this comparison; the FTS5 trigger pattern is interesting in isolation but doesn't earn its keep against the file-only invariant. |
| MCP tool surface | 8 tools exposed via stdio MCP transport | None — code-oz exposes nothing as MCP; consumes nothing as MCP (M16: zero MCP imports in src/) | `n/a` Different role. code-oz is the orchestrator, not the indexer. |
| MCP server consumption | n/a (codegraph IS an MCP server) | Not implemented — no MCP client in the spine | `<` Architectural decision pending. M11 capability contract is provider-shaped, not tool-shaped. Consuming external MCP servers (codegraph included) would require a new authority boundary (rule 20). |
| Evaluation harness for tool quality | `docs/SEARCH_QUALITY_LOOP.md` — 7-test battery, 13 verified languages, 46 language-specific issue/fix entries; `__tests__/evaluation/runner.ts`; `npm run eval` | None for repo_context — `glob`/`grep`/`read` have unit tests but no quality-feedback loop measuring "does the LLM get useful context" | `<` code-oz could borrow the **methodology** (not the language matrix). See B2. |
| Distribution / install UX | `npx @colbymchenry/codegraph` interactive; writes `~/.claude.json`, `~/.claude/settings.json`, `~/.claude/CLAUDE.md`; `preuninstall` hook | `bun build --compile` single binary; npm + Homebrew + Scoop with auto-PATH-patch (W3+); no global config writes | `=` Different shapes; both legitimate. codegraph's installer touching three global files is too aggressive for a CLI tool's pattern but defensible for an MCP-server-as-product. code-oz's binary-first model is correct for the orchestrator role. |
| Provenance / determinism | "Deterministic extraction from AST, not AI-generated summaries" (CLAUDE.md:13) | Same property different scope: artifacts are LLM-authored but gates are file-based and never parse LLM text for authority (rule 1) | `=` Both commit to non-LLM signals being load-bearing in their domain. |
| Worker-thread WASM recycling | `WORKER_RECYCLE_INTERVAL=250` extracts before recycle; bounds V8 WASM heap growth | n/a | `n/a` code-oz has no WASM. Not load-bearing. |
| Worker-thread pool | Yes (extraction parallelism) | None — provider invocations are serial within a phase; reviewer panel parallelism (M14) is async-iter not worker-pool | `n/a` Different concurrency model. |

## What codegraph has that code-oz lacks (numbered)

**G1. A complete `symbol` backend.** Codegraph's `codegraph_search`, `_callers`, `_callees`, `_impact`, `_node` are the deterministic answers code-oz's `symbol` slot points at. The gap is concrete: REPO_CONTEXT.md reserved the schema in M6; M16 closed without picking the backend. Codegraph offers a third option (tree-sitter + SQLite, no LSP daemon, framework-aware) and a fourth (consume codegraph itself as an external MCP server) beyond the original LSP plan and an explicit reservation. This is the single architecturally consequential overlap and the only borrow that touches authority. **Borrow candidate B1 — escalated to a four-way decision; Codex debate target.** Resolved post-debate as Option D-reserved (see § "Decision (post-Codex, locked 2026-05-10)" below and the shipped contract in `docs/contracts/REPO_CONTEXT.md` § "Reservation and reopen-the-slot signal").

**G2. A tool-quality evaluation harness.** `docs/SEARCH_QUALITY_LOOP.md` documents a 7-test battery (explore, search, callers/callees, impact, edge extraction, node extraction, real-world LLM prompts) across 13 languages with a diagnosis table for 46 language-specific issues and fixes. `__tests__/evaluation/runner.ts` is a `npm run eval` runner. The methodology — "measure whether the tool's output actually helps the agent answer the question" — applies directly to code-oz's `glob`/`grep`/`read`. Today code-oz tests that the tools execute correctly and respect caps; it does not measure whether `maxBytesPerResult=16384` actually leaves room for useful context, or whether 20 selected files is the right `maxFilesForNextManifest`. The empirical work that justified those numbers (Codex push-back during M6) lives in design docs, not in a regression-suite-shaped harness. **Borrow candidate B2 — methodology only, not the language matrix; lands as a v0.2 W3 polish item.**

**G3. Worker-thread WASM recycling pattern.** `WORKER_RECYCLE_INTERVAL=250` solves a real V8 limitation (WASM linear memory never shrinks) by recycling worker threads on a fixed interval. Cited here for completeness; **no-borrow** because code-oz has no WASM in the spine. The only path where this becomes load-bearing is if B1 is decided as "build the symbol tool natively with tree-sitter+SQLite," in which case the recycling pattern comes along for free as an implementation detail.

**G4. Pre-indexed, incremental, watcher-driven freshness model.** `FileWatcher` + SHA-256 content hashing + incremental reindex keeps the graph current with zero config. **No-borrow today**: code-oz runs are stateless — every `code-oz run` sees the current filesystem state, and every `rg` invocation reads what's there now. There is no "stale index" failure mode for code-oz to solve. If B1 lands as a native symbol index, this model lands with it. If B1 lands as MCP consumption, codegraph's watcher solves it for us.

**G5. Framework-aware route detection.** 13 web frameworks emit `route` nodes linking URL patterns to handlers. Compelling for a "trace this endpoint to its handler" persona but speculative — code-oz personas today work at the file/symbol level, not the URL level. **No-borrow today**; revisit if a routing-aware audit role enters the company roster.

**G6. SQLite + FTS5 + triggers as a search-and-storage substrate.** Codegraph's schema (`nodes`, `edges`, `files`, `unresolved_refs`, `nodes_fts`) with INSERT/UPDATE/DELETE triggers keeping FTS in sync is a clean pattern. **No-borrow** — directly conflicts with the architecture lock "files only — no SQLite v0.1." The lock is a discipline commitment (every read is grep-able from disk; no schema migrations to manage; durable across upgrades); breaking it for FTS5 search inside `events.jsonl` would not earn its keep at v0.1 or v0.2 scale.

**G7. Interactive installer that configures Claude Code globally.** `npx @colbymchenry/codegraph` writes `~/.claude.json`, `~/.claude/settings.json`, and `~/.claude/CLAUDE.md`. **Anti-borrow** — code-oz's distribution philosophy is local single-binary first; touching the user's global Claude config from an installer is exactly the kind of aggressive surface code-oz refuses. Cited here so the contrast is on record.

## What code-oz has that codegraph lacks (the disciplines that justify the category)

**C1. Permission scope on context retrieval (rule 18).** `tool_use.repo_context` is its own permission sub-scope; agents cannot search paths outside `permissions.read`; `network='none'` is a fixed constant; selected paths flow through the next manifest, never the search invocation's hidden context. Codegraph has no equivalent — its MCP server walks the OS-visible filesystem and returns whatever it finds.

**C2. Audit trail (`repo_context_searched` event).** Every search emits a typed event capturing `tool`, `query`, `roots`, `resultPaths`, `selectedPaths`, `resultBytes`, `resultTokensEstimate`. Codegraph has no audit log of what its MCP tools returned.

**C3. Privacy by default (rule 13).** `.code-ozignore`, secret redaction, file-size caps, "files sent to provider" preview, explicit file manifests. Codegraph indexes whatever it can OS-read; there is no privacy primitive on top.

**C4. Phase-shaped context budgets.** `maxBytesPerResult=16384` was set against the 300k phase cap by Codex push-back during M6. Codegraph's caps are tool-shaped (35k char limit per `codegraph_explore` call) without reference to a downstream invocation budget.

**C5. The five hard authorities codegraph cannot encode.** File-based gate signals (rule 1), cross-family review (rule 2), 3-source verification (rule 3), universal anti-slop rules (rule 16), maestro discipline (rule 17). Codegraph is in a different category and does not need any of these; the point is that adopting it as a substrate without a wrapping permission scope would erode them by accident.

**C6. Cross-model peer review at every milestone.** Pinned in CLAUDE.md ("Cross-model peer review (durable rule)"). Codegraph's repo has no equivalent process commitment visible — it is a single-author solo project.

**C7. Run-level cumulative budget enforcement (rule 19).** `budgets.global` reads `events.jsonl` cumulative spend; soft warn at `softWarnAtRatio`; hard kill writes `NEEDS_INTERVENTION`. Codegraph has no concept of run, budget, or intervention.

## Borrow ranking (post-Codex, locked 2026-05-10)

| ID | Borrow | Where it lands | Cost | Risk | Final verdict |
|---|---|---|---|---|---|
| **B1** | `symbol` tool slot governance — Option D-reserved (explicit reservation marker + telemetry-gated reopen) | Shipped: `RESERVED_REPO_CONTEXT_TOOLS` constant + `validateRepoContext` config-load rejection (`schema_invalid_permissions`) in `src/agents/schema.ts` + `intersectPermissions` runtime guard (`tool_unavailable`) in `src/tools/repo-context/permissions.ts` + JSDoc on `RepoContextToolName` + `REPO_CONTEXT.md § Reservation` section | Low — one constant + one validator branch + one runtime guard + doc paragraph | Low — reverse via single-line revert if telemetry reopens | **Shipped** — closes contract debt Codex named in Q8 |
| **B2** | Tool-quality evaluation harness — three deterministic cases only (discovery, usage, budget pressure) | v0.2 W3 polish; new `__tests__/evaluation/repo_context/` directory; `bun run eval:repo_context` | Low — pure addition; no contract change; no LLM-judged path in default CI | Low — measurement, not behavior; bound at three fixtures | **Borrow** at minimum shape per Codex Q4 |
| **B3** | Optional `--with-symbol-graph` install path that delegates to codegraph as an external MCP server | Conditional: only if telemetry reopens B1 as Option C | Medium — MCP-client surface; rule-20 authority cost | Medium — wrapping is mandatory (Codex Q5); cost-of-wrapping is itself evidence C is not the right default | **No-borrow today; wrapping spec recorded** for future reopen path |
| **B4** | Worker-thread WASM recycling pattern | Only if B1 ever lands as Option B (native tree-sitter) | n/a today | n/a today | **No-borrow** |
| **B5** | Framework-aware route detection (13 web frameworks → `route` nodes) | If a routing/API-surface audit persona enters the company roster (W4 candidate) | Medium | Low | **Deferred-with-trigger** — reclassified up from no-borrow per Codex Q6 |
| **B6** | SQLite + FTS5 + triggers substrate | Conflicts with "files only — no SQLite v0.1" architecture lock; could be reconsidered at v0.3+ as a read-only derived index for operator UX, never as a gate dependency | High (lock break) | High | **No-borrow** — discipline commitment holds |
| **B7** | Interactive installer that writes global Claude config | Conflicts with distribution philosophy (local single-binary first) | High (philosophy break) | High | **Anti-borrow** — explicitly rejected |

## The real question Codex must answer

Three of the seven candidates collapse onto one decision: **what is code-oz's W3+ `symbol` tool backend?** The four options:

- **Option A — Native LSP integration** (current ROADMAP line). Pros: standardized, multi-language, no AST library churn. Cons: requires running an LSP daemon per project per language; LSP startup latency (~1–10s) cuts into PLAN-phase budgets; LSP server availability is uneven across languages (TypeScript and Python are great; Pascal, Liquid, Svelte are poor).

- **Option B — Native tree-sitter + SQLite** (codegraph's architecture, rebuilt). Pros: deterministic, zero daemons, 18-language coverage out of the box, 35k char output cap is a known-good budget. Cons: breaks the "files only — no SQLite v0.1" architecture lock; introduces a new authority boundary that must be accounted for under rule 20; ongoing tree-sitter grammar maintenance.

- **Option C — Consume codegraph as an external MCP server** (with a wrapping repo_context scope so audit/permission discipline is preserved). Pros: codegraph already exists and is maintained; immediate W3+ delivery; off-the-shelf 18-language coverage. Cons: adds an external runtime dependency (Node.js + the codegraph package); requires new MCP-client surface in the spine (rule 20: new authority boundary); must wrap codegraph's tool returns in `repo_context_searched` events to preserve rule 18; cross-process coordination overhead.

- **Option D — Defer indefinitely; close the schema slot.** Argument: M6's `glob`/`grep`/`read` with `rg` already deliver `81,920 tokens` of context per invocation; PLAN/BUILD personas working on small surfaces never need symbol-aware traversal; the empirical fixture data from M6 onward has not surfaced a single case where `rg` was insufficient. Drop the `symbol` slot, simplify the type union, save the milestone budget for company-roster growth (M17+ Researcher phase-tail, parallel builder candidates) where it has measurable risk-reduction effect (rule 21).

The four options carry different milestone costs, different rule-20 implications, and different distribution implications. Picking one without Codex pressure-test risks the same failure mode rule 21 was created to prevent.

## Decision (post-Codex, locked 2026-05-10)

Codex returned `accept-with-modifications` with one consequential catch in Q8: the `symbol` slot's "reserved but unsupported" status is **already contract debt**, not harmless optionality. The locked verdicts:

- **Category verdict**: YES, code-oz is ahead **on category** — codegraph is a code-intelligence indexer for chat-tool agents, not an SDLC orchestrator.
- **B1 (symbol backend) — Option D-reserved**: not "defer indefinitely" but "explicit reservation marker + telemetry-gated reopen condition." Shipped contract: `RESERVED_REPO_CONTEXT_TOOLS` constant + `validateRepoContext` rejects `'symbol'` at config-load with `schema_invalid_permissions`; `intersectPermissions` rejects at runtime with `tool_unavailable`; `RepoContextToolName` JSDoc + `REPO_CONTEXT.md § Reservation` document the contract and the 4-condition AND telemetry signal for the reopen condition.
- **B2 (eval harness) — Borrow at minimum shape**: three deterministic evals (discovery, usage, budget pressure), recall@k + bytes + tool-call counts, no LLM-judged path in default CI. v0.2 W3 polish.
- **B3 (MCP-consume) — No-borrow today; wrapping spec recorded** if telemetry ever reopens B1 as Option C.
- **B5 (framework-aware route detection) — Deferred-with-trigger** (reclassified up from no-borrow): land if a routing/API-surface audit persona enters the company roster.
- **B4, B6, B7 — Not borrowed.**

The four-condition AND telemetry signal that would reopen B1 is locked in CODEX_RESPONSE.md "Reopen-the-slot telemetry signal" section: simultaneous high search churn + manifest-cap saturation + ≥200k phase result-tokens + a VERIFY/REVIEW failure attributable to missed semantic context. Any one alone is noise; all four together on three runs across two repos is signal.

Full Codex Q&A and the lead-author synthesis are in this folder's `CODEX_RESPONSE.md`.

## References

- **codegraph repo**: `~/Projects/agents/templates/codegraph/` (v0.7.2)
- **codegraph CLAUDE.md**: `templates/codegraph/CLAUDE.md`
- **codegraph search-quality methodology**: `templates/codegraph/docs/SEARCH_QUALITY_LOOP.md`
- **code-oz REPO_CONTEXT contract**: `docs/contracts/REPO_CONTEXT.md`
- **code-oz repo_context implementation**: `src/tools/repo-context/{glob,grep,read,runner,permissions,errors,types}.ts`
- **code-oz doctor ripgrep probe**: `src/commands/doctor.ts:379-434`
- **code-oz W3 reopen-trigger entry**: `docs/design/ROADMAP.md` W3 § "Deferred-with-trigger items" (replaced the prior "Optional `symbol` LSP integration" line in commit 366dd9e)
- **Rule 18 (`tool_use.repo_context` scope)**, **Rule 13 (privacy by default)**, **Rule 19 (budget enforcement)**, **Rule 20 (one new authority per milestone)**, **Rule 21 (no new parallel surface without measurable risk reduction)** — `CLAUDE.md`
