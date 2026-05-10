---
name: codex-briefing-06-codegraph
target: pressure-test code-oz's borrow decisions against codegraph
companion: COMPARISON.md (this folder), docs/contracts/REPO_CONTEXT.md, docs/design/ROADMAP.md (W3 section), CLAUDE.md (rules 13, 18, 19, 20, 21)
status: dispatched
mode: debate (single-opponent, planning-convergence pressure-test)
---

# Codex briefing — code-oz vs codegraph

## Your role

You are the cross-family reviewer for this template comparison. code-oz's lead author has drafted a `COMPARISON.md` proposing one major architectural decision (B1 — the W3+ `symbol` tool backend) and one process borrow (B2 — tool-quality evaluation harness), with five other patterns explicitly rejected (B3 conditional, B4–B7 no-borrow).

I have two failure modes I want you to push on:

1. **Authority creep at v0.2.** code-oz has rule 20 ("one new authority boundary per milestone") and rule 21 ("no new parallel surface without a measurable risk-reduction effect"). Either of those rules would, if applied strictly, push B1 toward Option D (defer indefinitely). I want you to test whether that's right or whether I'm under-investing in semantic context.

2. **Category drift.** codegraph is a code-intelligence indexer for chat agents, not an SDLC orchestrator. 90 percent of its surface is orthogonal. The risk is that I imported codegraph's framing ("tools for AI agents to explore code") and let it set the question, instead of asking the question SDLC orchestration actually needs.

## What code-oz is, restated for you

Bun + TypeScript repo-native agentic SDLC runtime, six-phase gate-driven (DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP), file-based gate signals only, cross-family reviewer panel (M14, quorum 2), debate-policy scheduler (M15, single-opponent), production CLI (M16, 3108 tests). Through M16, REPO_CONTEXT (rule 18) is fully implemented for `glob`/`grep`/`read` (delegating to `rg`). Defaults: `maxResults=50`, `maxBytesPerResult=16KB`, `maxFilesForNextManifest=20`, `timeoutMs=5000`, `network='none'`. The `symbol` tool is reserved in the type union but unimplemented (`runner.ts` errors `"unsupported tool 'symbol'"`). W3 ROADMAP defers it as "Optional LSP integration."

## What codegraph is, restated for you

Local Node.js + tree-sitter WASM + SQLite (`.codegraph/`) code-intelligence indexer for Claude Code's Explore agents. Eight MCP tools (`codegraph_explore`, `_context`, `_search`, `_callers`, `_callees`, `_impact`, `_files`, `_node`). Reported benchmark: 94 percent fewer tool calls and 77 percent faster exploration across six real codebases. Worker-thread WASM pool with periodic recycling. Framework-aware reference resolution (13 frameworks emit `route` nodes). FileWatcher + SHA-256 content hashing for incremental sync. No permission model, no audit log, no run/budget concept. Distribution: `npx @colbymchenry/codegraph` interactive installer that writes `~/.claude.json`, `~/.claude/settings.json`, `~/.claude/CLAUDE.md`. v0.7.2, MIT, single-author solo project.

## My provisional decisions

| ID | Borrow | Verdict |
|---|---|---|
| B1 | `symbol` tool backend | **Defer to debate** — provisional lean: Option D (defer indefinitely) |
| B2 | Tool-quality evaluation harness (methodology only) | Borrow as v0.2 W3 polish |
| B3 | Consume codegraph as external MCP server | Conditional on B1 = Option C |
| B4 | Worker-thread WASM recycling | No-borrow today |
| B5 | Framework-aware route detection | No-borrow today |
| B6 | SQLite + FTS5 + triggers substrate | No-borrow (architecture-lock conflict) |
| B7 | Interactive installer that writes global config | Anti-borrow (philosophy conflict) |

## The B1 four-way decision

The W3+ `symbol` tool backend has four options on the table. The current ROADMAP line is "Optional `symbol` LSP integration for repo-context tools (deferred from M6)." I want you to tell me whether that line is still right after this comparison.

**Option A — Native LSP integration.**
- Pros: standardized; multi-language; no AST library churn; uses existing ecosystem (TS, Python LSPs are mature).
- Cons: LSP daemon per project per language; ~1–10s startup latency cuts into PLAN-phase budgets; LSP availability uneven across languages (Pascal, Liquid, Svelte are poor); requires LSP-client surface in code-oz spine.

**Option B — Native tree-sitter + SQLite (rebuild codegraph's architecture).**
- Pros: deterministic; zero daemons; 18-language coverage; tree-sitter is well-maintained.
- Cons: **breaks the "files only — no SQLite v0.1" architecture lock**; tree-sitter grammar maintenance burden; new authority boundary under rule 20; new ~5k-LOC subsystem to test/maintain.

**Option C — Consume codegraph as external MCP server.**
- Pros: off-the-shelf today; 18 languages out of the box; codegraph maintained externally; minimal new code in code-oz.
- Cons: adds Node.js + codegraph runtime dependency; requires new MCP-client surface (rule 20: new authority boundary); must wrap codegraph returns in `repo_context_searched` events to preserve rule 18 audit trail; cross-process coordination overhead; codegraph is a single-author solo project (bus-factor 1); semver/breakage risk.

**Option D — Defer indefinitely; close the schema slot.**
- Argument: M6's `glob`/`grep`/`read` with `rg` already deliver `~82k tokens` of context per invocation. PLAN/BUILD personas work on small surfaces; M6 onward has not surfaced one case where `rg` was insufficient. Empirically, the slot has earned no demand. Drop the `symbol` member from the union, simplify error types, save the milestone budget for company-roster growth (Researcher phase-tail, parallel builder candidates) where rule 21 says risk-reduction effect must be measurable.
- Cons: closes a future option; if PLAN-phase context demand grows past `rg`'s reach, we have to reopen the slot.

## My questions

I want a numbered response. Use the same numbering and conventions you used in 04-archon.

**1. Category drift check.** Is the framing in COMPARISON.md right — codegraph is a category-different tool with one overlap surface (`symbol` slot) — or am I under-counting overlap by treating MCP-tool-surface, FTS5 substrate, and incremental-sync model as orthogonal? Specifically: is there a case where code-oz **personas** (not the orchestrator) would benefit from semantic graph traversal that code-oz isn't currently extracting?

**2. The B1 verdict.** Pick one of A/B/C/D for the W3+ symbol tool backend. State your second choice as a hedge and the trigger condition that would flip you. If you pick D, name the empirical signal in `events.jsonl` that would reopen the question.

**3. Rule 20 vs rule 21 framing for B1.** Both rules push toward "no, defer." Are they redundant here, or does one of them fail to apply? If rule 21 ("no new parallel surface without measurable risk-reduction effect") is the load-bearing one, then the symbol tool isn't a "parallel surface" — it's a richer instance of an existing surface (`tool_use.repo_context`). Does that change the calculus?

**4. The B2 borrow.** I'm proposing to borrow codegraph's evaluation methodology (`docs/SEARCH_QUALITY_LOOP.md` pattern) as a `bun run eval:repo_context` harness. The risk is that I add a measurement framework that itself bit-rots — the harness becomes infrastructure debt, not signal. Push back if that's a real failure mode. If you accept B2, what's the smallest viable shape — one test, three tests, the full 7-test battery? What does it actually measure (LLM-perceived usefulness? token efficiency? recall on synthetic queries)?

**5. The B3 conditional.** If B1 = Option C (MCP-consume), the privacy invariant (rule 18 audit trail via `repo_context_searched` events) requires wrapping every codegraph tool return through code-oz's permission scope. Does that wrapping break any of codegraph's affordances in practice (e.g., `codegraph_explore`'s 35k char output already exceeds `maxBytesPerResult=16KB` × 1 result; would code-oz force-truncate)? Is the wrapping worth doing, or is it an attempt to have the cake and eat it too?

**6. The five rejections (B4–B7).** Anything you would un-reject? Specifically: B5 (framework-aware route detection — could land if a routing-audit persona enters the company roster) and B6 (FTS5+triggers substrate — could become useful for `events.jsonl` audit search at v0.3+ scale). Both feel like "no today, maybe later" — am I right to keep them on the no-borrow list, or should one of them be a "deferred-with-trigger" entry?

**7. Authority boundary count.** If B1 = Option B or C, that's a new authority (semantic graph or external MCP). If we land it, it consumes the milestone's rule-20 budget. What's the highest-value milestone we'd be displacing — Researcher phase-tail? Parallel builder candidates? Multi-opponent debate? Is the symbol tool's value worth that displacement?

**8. Anything I missed.** What's the strongest argument against my COMPARISON.md framing that I haven't anticipated? What would a hostile reviewer push hardest on?

## Constraints on your answer

- Pick verdicts. "It depends" is acceptable only if you state the dependency variable and where it would be measured.
- For each numbered question, end with a one-line "verdict" so I can lift it directly into a synthesis row.
- If you accept-with-modifications, state the exact modification.
- Length: 800–1500 words. Tighter is better.
- Use the locked verdict vocabulary: `push` / `fix-first` / `debate-required` / `accept` / `accept-with-modifications`. End your response with one of those at the top level.

## Reading order

1. `docs/comparison/06-codegraph/COMPARISON.md` (this folder)
2. `docs/contracts/REPO_CONTEXT.md` (rule 18 spec)
3. `CLAUDE.md` rules 13, 18, 19, 20, 21
4. `~/Projects/agents/templates/codegraph/CLAUDE.md` and `templates/codegraph/docs/SEARCH_QUALITY_LOOP.md` (1500+ lines of language-specific diagnosis; you don't need to read all of it — skim the methodology section and the diagnostics table format)
5. `templates/codegraph/src/mcp/tools.ts` if you want the exact tool I/O shapes
