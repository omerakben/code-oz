---
to: Codex (gpt-5.5, xhigh, sandbox read-only)
from: Claude Opus 4.7 (1M context)
date: 2026-05-10
project: code-oz v0.17.0-alpha.0
template-under-comparison: opencode (~/Projects/agents/templates/opencode)
companion-doc: COMPARISON.md (read first)
expected-output: CODEX_RESPONSE.md with verdict (push / fix-first / debate-required) and answers to debate prompts §3
---

# Codex briefing — opencode comparison (session 11)

## 1. Goal

Pressure-test the verdict in `COMPARISON.md` from a different family. The recommended verdict is **YES — selective borrows**: opencode is a peer of Claude Code, not of code-oz; we keep our SDLC-runtime axis as the differentiator and absorb five sub-milestone borrows (B1–B5) plus three explicit no-borrows (N1–N3). One borrow (B3 MCP consumer) earns its own milestone slot under rule 20.

Your job is not to agree. The cross-model peer review rule is structural — single-family verdicts have blind spots, so I want disagreement to surface where it exists.

## 2. Constraints (project rules that bound any recommendation)

The full rule list is in `/Users/ozzy-mac/Projects/code-oz/CLAUDE.md` lines 19–80. The ones load-bearing for this debate:

- **Rule 1.** File-based gate signals only. Never parse LLM text for pass/fail.
- **Rule 7.** Plain-Markdown artifact contracts (no JSON serialization for inter-phase handoffs).
- **Rule 9.** Permission manifest required for any escape-hatch execution.
- **Rule 10.** Cost budgets are config, not vibes.
- **Rule 13.** Privacy by default — `.code-ozignore`, file manifest per phase, no silent recursive context.
- **Rule 18.** Repo-context retrieval has its own permission scope (`tool_use.repo_context`); search results enter the *next* invocation's `ProviderRequest.files`, never the search invocation's hidden context.
- **Rule 19.** Run-level budget enforcement is mandatory — `assertWithinBudget` reads cumulative spend from `events.jsonl` per call.
- **Rule 20.** One new authority boundary per milestone. M11 = provider capability contract; M12 = roster; M13 = role-cost; M14 = panel; M15 = debate scheduler; M16 = production CLI completion. Bundling multiple authorities under one milestone has historically masked bugs (the empirical M16 C9 incident: 6 sub-surfaces, 8 production bugs survived per-commit review).
- **Rule 21.** No new parallel-provider surface lands without measurable risk reduction in `events.jsonl` against the single-provider baseline.

Memory record on rule 20: count *sub-surfaces touched*, not just authority labels (`feedback_rule20_sharper_application.md`). A milestone that touches 6 sub-surfaces under one authority label is still a 6-surface milestone.

## 3. Debate prompts

These are the questions I want you to answer in `CODEX_RESPONSE.md` §3, in order. Each gets a verdict + reasoning + (where applicable) a counter-proposal.

### Q1. Is the headline verdict (selective borrow, peer-of-Claude-Code framing) correct?

opencode ships 21+ provider integrations, an Effect-typed orchestration layer, ACP session protocol, MCP consumer, plugin lifecycle, multi-language READMEs, 461-line install script, 323 test files. code-oz at v0.17.0-alpha.0 has 4 providers (3 real + 1 fake), 3108 tests, no MCP, no plugins, no chat surface. Is "different products, peer substrates" the right framing, or am I underweighting opencode's substrate maturity to protect code-oz's product axis?

The strongest counter would be: "code-oz should fork opencode's `packages/llm/` rather than maintain a parallel provider abstraction, and re-frame as an SDLC layer on top of opencode." Defend or refute with reference to the trust-boundary discipline locked in `docs/references/provider-contract.md` ("Auth model — subprocess delegation + API-key transmission (v0.1)").

### Q2. B2 wildcard permissions — refinement or new authority?

Memory record `feedback_rule20_sharper_application.md` says count sub-surfaces, not labels. The current permission grammar (intersection of declared roots) is one axis. Does adding wildcard expressions inside that axis count as one sub-surface (refinement) or two (intersection + matcher)?

If two: B2 graduates to its own milestone slot, B3 (MCP) waits longer.

Pressure-test the "last-match-wins" semantics. opencode defaults to `ask`; code-oz defaults to deny. In a deny-default world, last-match-wins lets a permissive late rule override an earlier denial. **First-match-deny** would be safer. Defend or refute.

### Q3. B3 MCP consumer timing — demand-gated or pre-loaded?

The Researcher role is in the rule-17 dossier but has no committed roadmap row. opencode shows the cleanest reference for `Local` / `Remote` MCP servers in the influence library (with OAuth on `Remote`).

Two positions to evaluate:
- **Demand-gated.** Wait for a demand checkpoint that explicitly asks for Sentry / GitHub / web-fetch. Slot B3 then.
- **Pre-loaded.** Lock B3 as the next available milestone slot post-M16, regardless of demand. Argument: MCP is the open-protocol vector for the entire AI tooling ecosystem; not having it is a category-credibility gap.

Which position better serves the project's stated bar (1000+ GitHub stars, beat raw coding agents via Claude+Codex orchestration)? Cite specific risk factors.

If pre-loaded: how do we satisfy rule 13 (privacy by default) when MCP servers, by definition, make outbound calls? My COMPARISON.md sketch says `tool_use.mcp` denies network by default and requires explicit per-server allowlist. Is that sufficient, or does MCP need an entirely separate trust boundary (signed manifests, hash-pinned binaries)?

### Q4. B1 recorded HTTP fixtures — load-bearing or premature?

PE-1 closed with one live integration test gated behind two env flags. PE-2+ is unscheduled. Two positions:
- **Borrow now.** opencode's `recorded-*.ts` pattern is ~50 LOC; cost is one hour for XAI; it becomes the reference for PE-2+.
- **Stay live-only.** Recorded fixtures rot when no one re-records. Better to spend the hour on a live-test budget gate (`CODE_OZ_LIVE_PROVIDER_TESTS=xai` already exists) and trust the third-party provider for shape.

Rule 21's lens: "no parallel-provider surface lands without measurable risk reduction." Recorded fixtures aren't a parallel-provider surface but they are a measurable-risk question. What would we measure to decide this is worth doing?

### Q5. N1 Effect rejection — right call?

I rejected adopting opencode's Effect-typed async architecture as too invasive. The argument was: "the bug class it would close is not visible in our 3108-test surface." But the FakeProvider exercises the happy path of a deterministic scripted provider; it does not exercise:
- Timeout cascades when a slow provider holds up a panel quorum.
- Cancellation under user `^C` mid-debate.
- Fiber leaks when a `requestDebate()` recursion escapes its scope.

Pressure-test: am I rejecting Effect because it's invasive, or because it's actually unnecessary? If the answer is "invasive," that's not a principled rejection. What's the cheapest experiment that would surface (or refute) one of the three bug classes above?

### Q6. N3 SQLite rejection — right call?

Rule 7 says plain-Markdown artifact contracts. opencode persists session state and the permission cache in SQLite via Drizzle. I rejected SQLite for the spine but flagged "a future telemetry layer might use SQLite for query convenience."

Pressure-test: is `events.jsonl` actually queryable enough for the panel/debate observability surface? The M14 / M15 telemetry events grow by N events per panel run; at v1 with multiple concurrent runs, JSONL scans become a bottleneck. Where is the threshold? When do we cross from "JSONL is fine" to "we need a secondary index"?

### Q7. Cross-family enforcement at scale

opencode has no concept of provider families. code-oz's M14 panel hard-codes the family classification (Anthropic / OpenAI / Google / xAI / Cohere). If we ever borrow opencode's 21-provider integration breadth, does our family table scale? What's the failure mode when a new provider lands in an under-represented family and the panel can't form quorum?

Is there a simpler model — provider-diversity score, ensemble-distance metric — that scales without requiring us to maintain a family classification table?

### Q8. The product-axis assertion itself

I assert that code-oz's differentiator is the SDLC-runtime axis: phases, gates, panel review, debate, role-cost, brownfield AUDIT, Scientist tails. Pressure-test that.

If a competitor (Anthropic itself, or an open-source clone) added file-based gates and cross-family panel review on top of opencode's substrate, would code-oz still have a differentiator? Or is the discipline pipeline a thin moat that any substrate can replicate in a milestone?

If thin: where is the durable moat? Is it the cross-model peer review rule itself (which produces this very document)? The Maestro discipline (rule 17)? The Scientist tails? The AUDIT-then-PLAN brownfield path?

## 4. Acceptance criteria for your response

A useful response answers each of Q1–Q8 with:

- A one-line verdict (agree / disagree / refine).
- 3–8 lines of reasoning citing specific files, rules, or numbers.
- Where you disagree, a concrete counter-proposal (what to do instead, what to measure, where to slot it).

Then a final-section verdict: **`push`** (proceed with borrows as ranked), **`fix-first`** (one or more borrows need re-ranking or rescoping before they can be locked), or **`debate-required`** (the framing itself is wrong and we should re-debate before any borrow lands).

## 5. Materials Codex should read

- `/Users/ozzy-mac/Projects/code-oz/docs/comparison/07-opencode/COMPARISON.md` (the verdict under debate)
- `/Users/ozzy-mac/Projects/code-oz/CLAUDE.md` (project rules, especially rules 1–21)
- `/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md` (milestone history M0–M16)
- `/Users/ozzy-mac/Projects/code-oz/docs/references/provider-contract.md` (auth/trust-boundary lock)
- `/Users/ozzy-mac/Projects/code-oz/src/providers/types.ts` (`IAgentProvider` interface)
- `/Users/ozzy-mac/Projects/code-oz/src/phases/review-panel.ts` (cross-family panel implementation)
- `/Users/ozzy-mac/Projects/agents/templates/opencode/packages/llm/src/provider.ts` (opencode provider abstraction)
- `/Users/ozzy-mac/Projects/agents/templates/opencode/packages/opencode/src/permission/evaluate.ts` (opencode permission grammar)
- `/Users/ozzy-mac/Projects/agents/templates/opencode/packages/opencode/src/config/mcp.ts` (opencode MCP schemas)
- `/Users/ozzy-mac/Projects/agents/templates/opencode/install` (opencode install script)

You have read-only sandbox access. Quote files when defending claims; vague reference doesn't count.
