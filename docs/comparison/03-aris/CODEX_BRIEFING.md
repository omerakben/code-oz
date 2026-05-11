# Codex briefing — code-oz vs ARIS borrow audit (v0.17)

**Audience:** Codex (gpt-5.5 xhigh, sandbox: read-only)
**Author:** Claude Opus 4.7 (xhigh)
**Date:** 2026-05-10
**Companion docs:** `docs/comparison/03-aris/COMPARISON.md` (full analysis), `docs/comparison/01-ace/COMPARISON.md` (prior round, M17 Reviewer Memory proposal), `CLAUDE.md` (rules 1–21 in particular)
**Mode:** structured peer review under the project's cross-model peer-review rule (CLAUDE.md "Cross-model peer review (durable rule)").

You are the cross-family reviewer. Your role is *adversarial*, not *advisory*. Push back wherever the comparison reasoning is weak, the borrow set is over-claimed, or the milestone shape understates authority cost. We disagree productively; we do not converge to a soft "looks fine."

---

## What this briefing is

A per-template head-to-head comparison between **code-oz** (v0.17.0-alpha.0, the repo-native agentic SDLC runtime under `~/Projects/code-oz`) and **ARIS** (Auto-claude-code-research-in-sleep, the ML research harness under `~/Projects/agents/templates/Auto-claude-code-research-in-sleep`).

The comparison's verdict is **YES, with selective borrows** — code-oz is structurally ahead on the SDLC dimension, but four ARIS mechanics still earn absorption at v0.17. Your job is to pressure-test the verdict, the borrow set, and the milestone shape.

---

## Locked context (do not re-debate these)

These are project-level rules, already adopted, with empirical validation. Treat them as constraints, not options.

- **Rule 1**: file-based gate signals only; never parse LLM text for pass/fail.
- **Rule 2**: cross-family review at REVIEW gate; pass file paths, not summaries.
- **Rule 7**: Markdown artifact contracts only; no JSON serialization for inter-phase handoffs.
- **Rule 13**: privacy by default; explicit file manifests; no silent recursive context.
- **Rule 16**: universal anti-slop rules ship inside every persona prompt.
- **Rule 17**: maestro 4-layer FS memory is authoritative; documented in `docs/research/01-maestro-rule-checker.md`.
- **Rule 19**: run-level budget enforcement under `budgets.global` is mandatory, not advisory; cumulative spend read from `events.jsonl`.
- **Rule 20**: one new authority boundary per milestone.
- **Rule 21**: no new parallel-provider surface without measurable risk-reduction effect against the single-provider baseline.

The 4 ARIS patterns code-oz already borrowed (cross-family review, Reviewer Memory direction, 4-round cap, plain-Markdown artifacts) are also locked. The audit at §3 of `COMPARISON.md` confirms they are still load-bearing at v0.17.

The M17 milestone is already shaped by the ACE comparison (`docs/comparison/01-ace/COMPARISON.md`): bullet format + delta operations + bullet usage log under a single new "Reviewer Memory v1" authority boundary.

---

## The borrow set

Four candidates, ranked from lowest authority cost to highest:

**B1 — Effort-as-workflow-modifier.** `code-oz run --effort {lite|balanced|max|beast}` scales `budgets.global` proportionally (0.4x / 1x / 2.5x / 5–8x) at run start. Cost: one CLI flag, one config wrapper. Authority: zero new boundary.

**B2 — Zero-context fresh-reviewer mode for the M14 panel.** Opt-in panel sub-mode where one slot sees only the BUILD patch + raw VERIFY evidence — no prior REVIEW.md, HYPOTHESES.md, debate transcripts, or executor summaries. Cost: one panel-config field + path-filter in `review-fire-path.ts`. Authority: extends M14 panel surface; claimed as no new boundary.

**B3 — Anti-repetition entry types under Reviewer Memory v1.** `failed-plans/` and `failed-builds/` entry types in the M17 bullet schema. PLAN reads them on retry; BUILD reads them on restart. Cost: two entry types + one read-hook in `src/phases/plan.ts`. Authority: under existing M17 boundary.

**B4 — `/meta-optimize` skill candidate (deferred to v0.2+).** Log-driven outer-loop optimizer that reads `state/events.jsonl` and proposes patches to universal rules / personas / budgets / restart thresholds / debate thresholds. Cross-model reviewed, user-approved, reversible. Cost: own milestone. Authority: introduces a new "harness self-modification" boundary. Defer until >50 production runs accumulated.

The full mapping (sections A through J of `COMPARISON.md`) covers ten ARIS mechanics; six of those are explicitly *not* recommended (MCP fanout, nightmare difficulty, Pipeline Status convention, watchdog, Output Versioning Protocol, bilingual docs).

---

## Your assignment

Produce a structured response with five sections. Be terse, specific, and adversarial.

### Section 1 — Verdict on the verdict (200 words max)

Do you concur with **YES, with selective borrows**? If you would shift to YES-ahead-no-borrows or NO-credible-gap, say which and why. The bar is: name a specific ARIS mechanic that either (a) is already covered better than the comparison gives credit for, or (b) is missing from the comparison and would change the recommendation.

### Section 2 — Per-borrow review

For each of B1, B2, B3, B4, give:

- **Authority cost**: agree / disagree with the comparison's claim. If disagree, what *new* authority axis does the borrow introduce?
- **Rule 21 risk**: agree / disagree that the borrow either bypasses rule 21 (B1, B3 — no new parallel-provider surface) or is gated by it (B2, B4). If disagree, what *measurable risk-reduction effect* would the borrow need to demonstrate?
- **Milestone fit**: agree / disagree with the proposed slot (pre-M17 polish for B1; M17 for B3; M17 or M14.1 for B2; M19+ for B4). If disagree, what slot fits and why?
- **One concrete bug class** the borrow would introduce or paper over. If you cannot name one in 30 seconds, the borrow is fine.

### Section 3 — The five contested questions

Section 10 of `COMPARISON.md` lists six open questions. Answer each in 80 words or fewer:

1. Effort flag vs rule 19 — escape hatch by the back door, or single derived envelope?
2. Fresh-reviewer mode — M14 sub-mode (no new boundary) or new authority axis?
3. Rule 21 evidence threshold for meta-optimize — is "≥5 invocations" enough, or do we need a controlled A/B?
4. Anti-repetition entries — same surface as Reviewer Memory or separate Failure Memory?
5. Did Claude miscategorize `experiment-queue`, `Output Manifest Protocol`, or `/result-to-claim` as out-of-scope?
6. Run-level effort dial value over per-call effort + `budgets.global` — UX wrapper, or behavior the per-call effort cannot reach?

### Section 4 — What Claude missed

Name up to three ARIS mechanics that the comparison **failed to flag** entirely. Specifically scan:

- `skills/auto-paper-improvement-loop/`, `skills/dse-loop/`, `skills/idea-discovery-robot/` — workflow patterns the comparison did not enumerate
- `skills/shared-references/effort-contract.md`, `skills/shared-references/reviewer-independence.md`, `skills/shared-references/experiment-integrity.md` — rule files that may overlap with code-oz's universal-rules.md
- `tools/experiment_queue/queue_manager.py` — runtime mechanic that may be more than "out of scope"
- `tools/generate_codex_claude_review_overrides.py` — the harness's own reviewer routing logic

For each, decide: cargo-cult or load-bearing?

### Section 5 — One thing Claude is wrong about

Pick the single weakest claim in `COMPARISON.md` and steelman the opposing position. The goal is to surface the failure mode, not to reach agreement. Claude will rebut in `SYNTHESIS.md`; this is the disagreement seed.

---

## Format

Return your response as a single Markdown document (no code-fenced wrappers around the whole thing). Use the section headers above (`## Section 1 — Verdict on the verdict`, etc.). Cite specific files and line numbers where possible (you have read-only filesystem access to `~/Projects/code-oz` and `~/Projects/agents/templates/Auto-claude-code-research-in-sleep`).

When you cite a rule, use its rule number (rule 19, rule 20, rule 21, etc.) rather than re-quoting the text.

When you call a borrow weak, propose a concrete strengthening or a clear rejection — never "needs more thought."

Time budget: as long as you need at xhigh effort. Quality over latency.
