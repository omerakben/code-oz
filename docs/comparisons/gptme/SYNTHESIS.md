# Synthesis — gptme vs code-oz

**Date:** 2026-05-10
**Authors:** Claude Opus 4.7 (1M ctx) — code-oz session; reviewed by Codex (gpt-5.5 xhigh, sandbox: read-only)
**Threads:**
- Round 1: `019e12ed-4038-7fe2-8800-5520e5f2048a` (verdict `fix-first`)
- Round 2: `019e1319-2169-7ab0-8ca7-036d6252fe60` (verdict `Option A — RATIFY-ONLY`, "proceed with Option A")

**Source documents:**
- `docs/comparisons/gptme/COMPARISON.md` — structural review and final decision matrix
- `docs/comparisons/gptme/CODEX_BRIEFING.md` — round-1 briefing
- `docs/comparisons/gptme/CODEX_RESPONSE.md` — round-1 verdict
- `~/Projects/agents/templates/gptme/` — gptme v0.31.x sources

This document is the single source-of-truth post-debate synthesis for the gptme template comparison. The PR that lands it ratifies the comparison record only and reserves future-milestone slots in `docs/design/ROADMAP.md`. **No source or test code is touched in this PR.**

---

## TL;DR

code-oz exceeds gptme in the repo-native agentic SDLC domain: file-based gates, cross-family REVIEW, debate runtime, scientist tails, scoped repo-context, and authority discipline (Rules 20 and 21) are structural properties gptme does not have. gptme exceeds code-oz in the general-purpose chat-first agent CLI domain: cross-tool agent-file ingestion, autocompact decision engine, generalized hook lifecycle, persistent-agent template (Bob), MCP/ACP surfaces, and a release-quality eval harness. The two products are not competing — they sit in adjacent categories. Two narrowed borrows (B1, B3) and two new defer entries (B2 demoted, D3 added) survived the round-1 Codex review; round-2 ratified Option A — land the comparison record + roadmap slot reservations only, no implementation in this PR.

---

## Final aligned decision matrix

| Item | Status | Reason (one sentence) | Target slot | Measurement plan (if borrow) |
|---|---|---|---|---|
| **B1 — Compaction-opportunity probe** | borrow-deferred-to-own-milestone | Deterministic context projection + compaction-opportunity probe is useful telemetry, but it requires a separate milestone authority because gptme's full engine performs LLM resume summarization and view-branch swaps that violate code-oz's "files in `ProviderRequest.files` are explicit, never silently mutated" discipline. | M18 candidate | Extend the existing `tokensEstimate` field on `ProviderContextMetrics` (`src/providers/manifest.ts:111`) with `context_projection_tokens`, `compaction_opportunity_savings_ratio`, `compaction_skipped_savings_ratio`. Rule-21 ship gate: observed `compaction_opportunity_savings_ratio` distribution > 0.10 across runs before any compaction-action authority is added. |
| **B3 — AGENT_FILES discovery + AUDIT/DEFINE opt-in** | borrow-deferred-to-own-milestone | Cross-tool agent-instruction-file discovery is worth doing, but it requires its own milestone authority because the AUDIT runtime does not yet exist (`src/phases/audit.ts` is absent) and the trust-boundary discipline (no parent/home walk, explicit per-file opt-in) is itself a contract surface. | M17 candidate | Telemetry events `agent_files_discovered`, `agent_files_accepted`, `agent_files_rejected`, `agent_instruction_conflicts`. Rule-21 ship gate: `agent_files_accepted / agent_files_discovered` rate observable; intake-question-count delta vs. baseline (no AGENT_FILES) on a brownfield corpus. |
| **B2 — Worktree topology refusal diagnostics** | defer | gptme's restore primitive (`git reset --hard` + optional `git clean -fd`) is incompatible with code-oz's per-run isolated worktrees and user-change preservation discipline; the worktree IS the checkpoint. Only the topology-classification idea has lift-value. | M19+ candidate | Rule-21 ship gate: count of resumes where audit-completeness recovery would have benefited from `kind`-classification refusal vs. count where current recovery is sufficient. |
| **D1 — Generalized hook lifecycle (16+ types)** | defer | Rule 20 — extension authority. gptme's hook surface is wider than the briefing claimed (transforms, confirmations, elicitation, cwd, cache-invalidation per `gptme/hooks/types.py:61,68,100,103`), and code-oz has exactly one production hook today (`review-scheduler-hook.ts` from M15). Revisit when ≥3 features want to subscribe to the same lifecycle event. | post-v0.2 | (n/a — defer) |
| **D2 — Subagent batch + planner pattern** | defer | Rule 21 — parallel-agent execution surface. gptme's subagent API includes executor/planner modes, parallel/sequential subtasks, subprocess mode, ACP mode, profiles, model routing, and optional isolated worktrees (`gptme/tools/subagent/api.py:32,80,95`); pinned to measurable need before adoption. | post-v0.2 | (n/a — defer) |
| **D3 (new) — Release/run-quality eval harness** | defer | Codex-flagged gap the briefer missed: gptme's `docs/evals.rst` has model leaderboards, CSV/JSON export, Docker guidance, and SWE-bench compatibility; code-oz's offline tests validate orchestration but not live run quality across model/release combos. | M20+ candidate | Rule-21 ship gate: a release-cadence quality regression slips through unit tests, motivating a separate run-quality evaluation surface. |
| **R1 — Lessons keyword/tool auto-injection** | reject | Rule 16 — universal anti-slop rules + per-persona prompts are deterministic; auto-injection by conversation keywords undermines that contract (`gptme/lessons/matcher.py:89,123`, `gptme/lessons/auto_include.py:145`). | (n/a) | (n/a) |
| **R2 — Plugin entry-points (Python packages)** | reject | Rule 20 — extension-surface authority creep. gptme plugins provide tools/hooks/commands/providers/init functions via Python entry-points (`gptme/plugins/plugin.py:21`, `gptme/plugins/entrypoints.py:25`). | (n/a) | (n/a) |
| **R3 — Persistent-agent journal/people/projects (Bob)** | reject | Category mismatch — code-oz is repo-native SDLC runtime, not a personal-assistant runtime (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md:18,28`). | (n/a) | (n/a) |
| **R4 — Architect/editor split prompt template** | reject | Already structurally present as the PLAN→BUILD phase split with separate persona prompts and gate signals; lifting gptme's template adds nothing. | (n/a) | (n/a) |
| **R5 — Web UI / REST / Tauri / ACP** | reject | CLI-only is a deliberate distribution lock; ACP would put code-oz inside Zed/JetBrains as a coding-agent peer — a different product surface. | (n/a) | (n/a) |

---

## Why we are not implementing borrows in this PR

The original briefing recommended three "borrow now" items (B1, B2, B3). After the Codex round-1 fix-first verdict, two narrowed borrows survived (B1, B3) and one was demoted to defer (B2). The round-2 verdict on the implementation question — should this PR land the borrows or only the comparison record — was Option A — RATIFY-ONLY. The reasoning is direct:

- **Rule 20 (one new authority per milestone).** B1 and B3 are independent authority boundaries. B1 is "telemetry + projection of context size on a per-invocation basis"; B3 is "cross-tool agent-instruction-file intake at AUDIT/DEFINE entry". Bundling them into one PR concedes Rule 20 and repeats the failure mode that surfaced in M16 C9 (six sub-surfaces under one label, eight production bugs survived per-commit review). Each borrow lands in its own milestone, with its own pre-design Codex round, its own implementation, and its own review.

- **B3 has no AUDIT runtime to extend.** `src/phases/audit.ts` does not exist in the worktree (verified). Greenfield DEFINE has its own intake surface (`src/phases/define.ts`, `src/phases/ask-me.ts`), but the brownfield AUDIT runtime that B3 would extend is itself a future milestone. Implementing B3 against a non-existent phase is impossible; implementing it against DEFINE alone defeats the purpose.

- **B1 needs a contract before extending.** The existing `ProviderContextMetrics` already emits `tokensEstimate` (`src/providers/manifest.ts:111`, with `filesSent` and `bytesSent` adjacent at lines 109–110 and the metrics struct frozen at 112–117). Extending it with new fields (`context_projection_tokens`, `compaction_opportunity_savings_ratio`, `compaction_skipped_savings_ratio`) requires a contract decision: where the compaction "what could be removed" projection runs, what its determinism guarantees are, and how downstream consumers (REVIEW preflight, debate-policy scheduler) read the new fields. That contract is itself a milestone.

- **No source or test code is touched in this PR.** The four files this PR touches are `docs/comparisons/gptme/COMPARISON.md`, `docs/comparisons/gptme/CODEX_BRIEFING.md`, `docs/comparisons/gptme/CODEX_RESPONSE.md`, this file (`SYNTHESIS.md`), and `docs/design/ROADMAP.md`. No `src/**`, no `tests/**`, no telemetry schema (`src/state/schemas.ts:438` discriminated union of `PhaseEvent` is untouched), no event-emission code (`src/state/events.ts:170` neighborhood is untouched). The borrows are reserved as future-milestone slots, not landed.

---

## What the next milestones look like

**M17 candidate — AGENT_FILES intake authority (B3-narrowed).** Lands the discovery list (`AGENTS.md`, `CLAUDE.md`, `COPILOT.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md` per `gptme/prompts/__init__.py:23`) at AUDIT and DEFINE phase entry. Discovery only — no parent/home walk (gptme walks home → workspace per `gptme/prompts/workspace.py:121,215,233`; code-oz refuses), no automatic prompt injection. Files become a confirm UI that accepts or rejects per file. New telemetry events (`agent_files_discovered`, `agent_files_accepted`, `agent_files_rejected`, `agent_instruction_conflicts`) extend `PhaseEvent`. Trigger: lands when brownfield AUDIT runtime ships (W4) or when greenfield DEFINE intake earns the authority. Hard precondition: not before `src/phases/audit.ts` exists.

**M18 candidate — Compaction-opportunity probe authority (B1-narrowed).** Telemetry-only context projection that reports compaction opportunity without mutating provider invocations. No LLM resume summarization (gptme's `gptme/tools/autocompact/hook.py:164`), no view-branch swap (`gptme/tools/autocompact/hook.py:128`), no automatic provider-context mutation. The discipline rule "no phase artifact may exceed N tokens at gate write" lands first as a separate gate-preflight check (`src/phases/gate-preflight.ts` extension); the probe extends the existing `ProviderContextMetrics` (`src/providers/manifest.ts:111` neighborhood) with `context_projection_tokens`, `compaction_opportunity_savings_ratio`, `compaction_skipped_savings_ratio`. Trigger: M14 Reviewer-panel + M15 debate-scheduler accumulate large enough contexts to make the > 0.10 floor measurable.

**Parallel deferred slots — M19+ (B2) and M20+ (D3).** B2's worktree topology refusal diagnostics waits on actual operator-intervention evidence in the resume corpus. D3's release/run-quality eval harness waits on a release-cadence quality regression that slips through unit tests. Both are reserved with measurement triggers in `ROADMAP.md`; neither is committed.

---

## Codex alignment statement

Round-2 verdict (thread `019e1319-2169-7ab0-8ca7-036d6252fe60`):

> Final verdict: proceed with Option A.

Round-1 verdict (thread `019e12ed-4038-7fe2-8800-5520e5f2048a`) was `fix-first` on the original "borrow B1/B2/B3 now" recommendation; round-2 is `Option A — RATIFY-ONLY` on the question "should this PR land the borrows or only the comparison record." Both rounds align: borrows are valid future work; this PR ratifies findings only.

---

## Standards for closure

This PR closes when:

1. **No further architectural improvements found.** The COMPARISON.md decision matrix, CODEX_RESPONSE.md verdict, and this synthesis converge on the same classifications. Round-2 ratified. No round 3 required for the comparison record.
2. **Rule 20 respected.** No new authority lands in this PR. B1 and B3 are reserved as separate milestone slots in `docs/design/ROADMAP.md`. B2 and D3 are reserved as deferred slots with measurement triggers.
3. **Rule 21 measurement plans documented for future milestones.** Each borrow's measurement plan is recorded in the decision matrix above and in the `ROADMAP.md` slot reservation. Implementation cannot land without telemetry first.
4. **No source or test code touched.** Only `docs/comparisons/gptme/*` and `docs/design/ROADMAP.md` are modified. No `src/**`, no `tests/**`, no schema changes.

When the maestro's round-3 Codex code-review on this PR returns `push`, the PR ships and the slots are reserved. The next milestone (M17 candidate or otherwise) opens its own briefing → debate → implementation → review cycle.
