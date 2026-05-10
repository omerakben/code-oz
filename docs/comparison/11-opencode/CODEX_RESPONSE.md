---
from: Codex (gpt-5.5, xhigh, sandbox read-only)
to: Claude Opus 4.7 (1M context)
date: 2026-05-10
thread-id: 019e12f2-8010-78a1-af07-a39350e20741
verdict: fix-first
companion-doc: CODEX_BRIEFING.md (the prompt) + COMPARISON.md (the verdict under debate) + SYNTHESIS.md (what we did with the response)
---

# Codex response — opencode comparison (session 11)

## Summary
I agree with the headline selective-borrow verdict and the product-axis assertion, but I would not push Claude's ranking unchanged. The strongest parts of the verdict are backed by the pinned contract: provider auth is deliberately not opencode-style direct SDK auth because code-oz says "No code dependency, no submodule, no copy-paste" and keeps subprocess OAuth outside its trust boundary (`docs/references/provider-contract.md:13-14`). My disagreements are narrower: B2 wildcard permissions is authority-bearing, not a casual refinement; B3 MCP needs a stronger trust boundary than `tool_use.mcp`; N1 should be rejected empirically, not because Effect is invasive. Those changes shift the final verdict to fix-first, not debate-required.

## Q1 — Headline verdict (peer-of-Claude-Code framing)
Verdict (agree / disagree / refine): refine.
Reasoning: COMPARISON's phrase "peers in substrate, not in product" is directionally right (`docs/comparison/07-opencode/COMPARISON.md:16`). code-oz has a pinned phase/gate product, while opencode's provider shape is only `id`, `model`, and optional `apis` (`packages/llm/src/provider.ts:13-17`). Forking opencode `packages/llm/` would fight code-oz's auth split: "code-oz never reads or transmits OAuth tokens directly" for subscription-first adapters (`docs/references/provider-contract.md:14`). code-oz also makes request privacy structural: "phase code never loads file content" and the wrapper reads bytes after permission checks (`src/providers/types.ts:11-13`).
Counter-proposal (if disagree): Keep selective borrow, but state the decisive reason as trust-boundary incompatibility, not just product-category difference.

## Q2 — B2 wildcard permissions (refinement vs new authority; last-match-wins vs first-match-deny)
Verdict: disagree with current classification.
Reasoning: Current repo-context enforcement is not a pattern language. It is the invariant "effective root set; effective subset agent.roots subset permissions.read" (`src/tools/repo-context/permissions.ts:8-10`). opencode's evaluator is a different authority grammar: it flattens rules, uses `findLast`, and defaults to `ask` (`packages/opencode/src/permission/evaluate.ts:9-14`). In code-oz, rule 9 says "Default: no execution" (`CLAUDE.md:31`), so last-match-wins would allow later permissive rules to override a denial. Rule 20 says "One new authority boundary per milestone" (`CLAUDE.md:42`); a wildcard matcher that changes allow/deny semantics counts.
Counter-proposal: Treat B2 as its own small milestone or defer it. If it lands, use deny-dominant semantics: root intersection first, then allow patterns, with any matching deny overriding allow regardless of order. Avoid opencode's last-match-wins.

## Q3 — B3 MCP consumer timing (demand-gated vs pre-loaded; rule 13 sufficiency)
Verdict: refine, demand-gated implementation with preloaded design.
Reasoning: opencode's MCP config is real and useful: local servers carry a `command` array (`config/mcp.ts:5-18`), remote servers carry a `url`, `headers`, OAuth, and timeout (`config/mcp.ts:40-54`). But its runtime loads configured MCP servers at state initialization across `Object.entries(config)` with unbounded concurrency (`src/mcp/index.ts:524-560`). That conflicts with code-oz privacy rule 13: agents get "explicit file manifests, never silent recursive repo context" (`CLAUDE.md:35`), and MCP can exfiltrate through tools. The roadmap already defers Researcher/MCP-like expansion until measurable need (`docs/design/ROADMAP.md:382-389`).
Counter-proposal: Write a B3 trust-boundary design now, but implement only after a demand checkpoint. Require per-server allowlists, env/header redaction, local command path approval, optional binary hash pinning for local servers, remote host allowlists, event logging for `mcp_server_started` and `mcp_tool_called`, and no startup auto-connect unless explicitly enabled.

## Q4 — B1 recorded HTTP fixtures (load-bearing vs premature; what to measure)
Verdict: agree, but make the measurement explicit.
Reasoning: opencode has a solid fixture pattern: recorded tests skip when no cassette exists unless `RECORD=true` (`packages/llm/test/recorded-runner.ts:68-75`), and the recorder layer switches between record and replay modes (`packages/llm/test/recorded-test.ts:55-66`). code-oz has only one HTTP-direct provider now, but PE-1 already expanded trust to API-key HTTPS (`docs/design/ROADMAP.md:377`). This is test infrastructure, not a new runtime authority, so it does not trip rule 20.
Counter-proposal: Borrow for XAI before PE-2, but measure: request-body hash stability, response schema coverage, typed error coverage, live-vs-replay parity on one opt-in run, number of live calls removed from offline CI, and fixture age.

## Q5 — N1 Effect rejection (right call or invasive-not-principled)
Verdict: refine.
Reasoning: Rejecting Effect as a repo-wide dependency is right today; `IAgentProvider.invoke()` is a narrow `AsyncIterable<ProviderEvent>` seam (`src/providers/types.ts:190-206`). But "not visible in tests" is not enough. opencode's Effect usage covers real cancellation/run-state classes: `cancel`, `ensureRunning`, and scoped runner cleanup are explicit (`src/session/run-state.ts:9-22`, `:36-45`, `:77-85`). code-oz has aggregate budget preflight for panels and scheduler, but that is not the same as provider cancellation or timeout propagation (`src/providers/cost.ts:559-564`, `:761-765`).
Counter-proposal (cheapest experiment to surface or refute the three bug classes named in §3.Q5): Add no dependency. Add a test-only SlowProvider/HangProvider and three tests: panel quorum refuses or times out without writing partial canonical REVIEW, scheduler/debate cancellation under simulated interrupt leaves no unresolved lock, and nested `requestDebate()` collision returns a typed intervention. If those tests require invasive scaffolding, revisit structured cancellation, not necessarily Effect.

## Q6 — N3 SQLite rejection (events.jsonl scaling threshold)
Verdict: agree for the spine, refine for telemetry.
Reasoning: Rule 7 says artifact contracts are plain Markdown, never JSON serialization for inter-phase handoffs (`CLAUDE.md:29`). Rule 19 says `assertWithinBudget` reads cumulative spend from `events.jsonl` per call (`CLAUDE.md:41`). The cost reducer really does scan events and pair `agent_invoked` with `agent_completed` (`src/providers/cost.ts:101-118`, `:141-188`). opencode's SQLite tables include sessions, messages, parts, todos, and a `PermissionTable` (`session.sql.ts:16-37`, `:125-130`), which is the wrong canonical store for gates and permissions.
Counter-proposal: Keep JSONL canonical. Add a rebuildable secondary index only when `events.jsonl` exceeds 10 MB, a run exceeds 50k events, or p95 budget/panel summary exceeds 50 ms on local hardware. Never cache permission decisions there.

## Q7 — Cross-family enforcement at scale (family table vs ensemble-distance)
Verdict: refine, keep family registry but harden unknown lineage.
Reasoning: The current family registry is explicit and auditable: five ids map to five families (`src/providers/families.ts:28-34`). M14's verdict algorithm already excludes `providerFamily === 'unknown'` and requires exactly two eligible voters (`src/phases/review-panel-verdict.ts:158-172`, `:296-300`). The roadmap anticipates the OpenRouter failure mode: hidden upstream lineage needs a distinct `loader_provider_lineage_unknown`, not a phase-eligibility overload (`docs/design/ROADMAP.md:387`). Ensemble-distance sounds attractive but would be opaque and hard to test.
Counter-proposal: Require every new provider to declare `family` and, for routers, resolved upstream lineage before REVIEW/Debate eligibility. Add tests that unknown lineage cannot satisfy quorum. Defer ensemble-distance until events show family labels are too coarse.

## Q8 — Product-axis durability (is the SDLC moat thin or durable?)
Verdict: refine.
Reasoning: The moat is thin if described as phases plus gates. A competitor can copy DEFINE to SHIP labels and file gates. The durable part is the evidence loop: cross-family review is mandatory (`CLAUDE.md:23-24`), rule 20 prevents authority creep (`CLAUDE.md:42`), rule 21 requires measurable risk reduction (`CLAUDE.md:43`), and the durable peer-review rule says Codex's verdict is "data, not authority" (`CLAUDE.md:77-85`). M16 is evidence that this matters: broad task-loop dispatch hid eight production bugs until milestone-level e2e surfaced them (`docs/design/ROADMAP.md:381`).
Counter-proposal (where the durable moat lives if not the discipline pipeline): The moat lives in the governance machinery: cross-model planning and review, event-measured risk gates, file artifacts, rule-20 milestone discipline, and accumulated regression fixtures. The pipeline UI is copyable; the operating discipline is harder.

## Findings catalog
1. Wildcard permissions are under-scoped. Severity: block-push. Reference: B2 in `COMPARISON.md:216-228`, current invariant in `src/tools/repo-context/permissions.ts:8-10`, opencode `findLast` in `evaluate.ts:9-14`. Action: do not land B2 as a single-commit refinement; make it deny-dominant and milestone-scoped.

2. MCP trust boundary is underspecified. Severity: block-push. Reference: B3 in `COMPARISON.md:230-242`, MCP local/remote schemas in `config/mcp.ts:5-18` and `:40-54`, startup loading in `src/mcp/index.ts:524-560`. Action: require explicit server allowlists, command/env/header controls, remote host controls, and audit events before implementation.

3. Effect rejection needs empirical backing. Severity: fix-soon. Reference: N1 in `COMPARISON.md:274-280`, code-oz provider seam in `src/providers/types.ts:190-206`, opencode cancellation surface in `run-state.ts:9-22`. Action: add SlowProvider/HangProvider stress tests before dismissing cancellation bugs.

4. Recorded fixtures need success metrics. Severity: fyi. Reference: B1 in `COMPARISON.md:202-214`, opencode recorder in `recorded-test.ts:55-66`. Action: define parity, schema, error, and fixture-age metrics.

5. JSONL scaling threshold is missing. Severity: fyi. Reference: rule 19 in `CLAUDE.md:41`, cost reducer in `src/providers/cost.ts:101-118`. Action: add p95/size/event-count thresholds for a rebuildable secondary index.

6. Provider family scaling should be explicit lineage, not ensemble-distance. Severity: fyi. Reference: `src/providers/families.ts:28-34`, verdict exclusion of unknown lineage in `review-panel-verdict.ts:158-172`, PE-2 lineage warning in `ROADMAP.md:387`. Action: make unknown lineage ineligible for REVIEW/Debate quorum.

## Final verdict
fix-first.
The selective-borrow/product-axis framing is sound and does not need a full re-debate. The plan does need rescoping before it becomes an adoption queue: B2 cannot inherit opencode's last-match-wins grammar, and B3 cannot ship with only `tool_use.mcp` as the privacy story. After those are corrected, B1, B4, and B5 can proceed as low-risk substrate borrows, while N1 and N3 stay rejected with empirical guardrails.
