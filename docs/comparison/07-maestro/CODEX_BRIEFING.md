---
debate-target: maestro template comparison
sibling-doc: COMPARISON.md (read this first)
codex-model: gpt-5.5 (xhigh effort)
codex-sandbox: read-only
codex-config-overrides: model_reasoning_effort=xhigh
expected-output: structured response with verdict per borrow + meta-critique
---

# Codex briefing — maestro comparison

## Why you are being briefed

Code-oz is in its template comparison series — one template per session, vs `~/Projects/agents/templates/`. Maestro is the seventh comparison. It is not a typical template comparison: maestro is the parent template. Three of code-oz's 21 non-negotiable rules trace directly to maestro (rule 1 file-based gate signals, rule 3 three-source verification, rule 4 Opus-default model policy). Code-oz's project lead also wrote maestro.

The COMPARISON.md sibling document is the analysis. Your job is to pressure-test it before any borrow decision goes into a milestone.

## What is locked (do not relitigate)

These are pinned by project rules in `CLAUDE.md`. Treat them as constraints, not decisions on the table:

- Rules 1 (file-based gate signals), 3 (three-source verification), 4 (Opus default), 7 (plain-Markdown artifact contracts), 13 (privacy by default with `.code-ozignore`) are absorbed and reified.
- Rule 20 — one new authority boundary per milestone. Any borrow that bundles multiple sub-surfaces under one axis label is a violation.
- Rule 21 — no new parallel-provider surface lands without measurable risk reduction over the single-provider baseline. Specifically applies to anything multi-agent, multi-reviewer, or multi-debate.
- Architectural fork. Code-oz is a Bun/TypeScript runtime that calls provider APIs via `IAgentProvider`. It is *not* going to become Claude-Code-as-runtime via headless `claude -p`. Anything bound to maestro's bash loop is not portable.
- Branch strategy `local-dev → staging → main` is a maestro/TUEL convention. Code-oz uses feature branches. Reject is final.

## What is on the table

Five borrow candidates, two rejects-for-now, and one reject set. From COMPARISON.md:

| ID | Borrow | Verdict in COMPARISON.md |
|---|---|---|
| B1 | Wave-based execution + grep verification primitive in BUILD/VERIFY | **Accept** — closes the gap on rule 5 (already a project rule, no spine implementation) |
| B2 | Heartbeat schema for external monitor surface | **Accept (defer)** — document `docs/contracts/HEARTBEAT.md`; build when consumer arrives |
| B3 | `PLAN_DIFF.md` SHIP-tail artifact (plan-vs-actual reflection) | **Accept** — extension of Scientist tail (rule 15) |
| B4 | `NEXT_RUN.md` forward-feed terminal-state class | **Accept** — sibling of `NEEDS_INTERVENTION.json` |
| B5 | `ABANDON.json` terminal-state class | **Accept (bundle with B4)** — round out terminal vocabulary |
| B6 | PR review gate (Phase 0 of session-start) | **Reject for v0.x** — depends on GitHub PR pipeline integration we don't have |
| B7 | Perpetual orchestrator loop / `code-oz watch` | **Reject for v0.x** — rule 21 measurable-risk-reduction test not met |
| Reject set | Headless `claude -p` runtime, branch strategy, Cowork supervisors, iMessage notifications, `.claudeignore` orchestrator-isolation | **Final** — architectural / cultural locks |

## Debate prompts

Pick the prompts where you have the strongest signal. You do not have to answer every prompt — surface the ones where you disagree, where you see a blind spot, or where the evidence is thinner than the verdict claims.

### 1. The B7 rejection

Maestro's perpetual loop (`orchestrator.sh`) ran 100+ autonomous sessions on TUEL AI before being generalized into a template. Code-oz's W3-lite Ralph Loop overnight was successful (10 iterations, ~1.5h, 9 commits, 5/5 smoke passing) but only ran once. The COMPARISON argues rule 21's measurable-risk-reduction test is unmet because the wrapper functionality already proved adequate.

- Is rule 21 the right rule to apply here? It governs *parallel-provider* surfaces; the perpetual loop is a runtime mode, not a parallel-provider feature. If the right rule is something else, what should it be?
- Is the W3-lite outcome strong enough evidence that one-shot + thin wrapper is sufficient, or is it a single data point that the comparison is over-reading?
- If a `code-oz watch` mode lands in v0.2, what is the contract surface that minimizes new authority? (Heartbeat? Cycle counter? Fresh runId per cycle? Reusing the existing `runId` model?)

### 2. The B1 sub-surface count

B1 (wave-verification primitive) closes rule 5. The proposed implementation is a VERIFY-tail step that emits `WAVE_VERIFY.json` with grep recounts of every numeric claim in `BUILD_REPORT.md`.

- Does this require a `BUILD_REPORT.md` schema change (structured count rows for VERIFY to recount)? If yes, that is two sub-surfaces, not one — possible rule-20 violation.
- Is "VP grep verification" actually portable to a typed runtime, or is it a bash-era pattern that a TypeScript spine should solve differently (e.g., AST-aware verification, semantic counts)?
- Maestro catches three to five missed items per rename session this way. Is rename-session pattern blindness even a code-oz failure mode? Code-oz personas use file manifests (rule 13), not silent recursive context. The failure mode that bit M16 C9 was sub-surface bundling under one axis label — does B1 address that, or is it solving the wrong bug?

### 3. The B3 vs Scientist-tail overlap

B3 (`PLAN_DIFF.md`) is proposed as a Scientist-tail extension (rule 15). Rule 15 already mandates `HYPOTHESES.md` and `OPEN_QUESTIONS.md` per phase.

- Is `PLAN_DIFF.md` distinct from `HYPOTHESES.md` post-mortem update, or is it the same artifact under a different name? If same, fold instead of adding.
- Maestro's plan-vs-actual section in END.md is human-curated. The code-oz equivalent would be diffed by what — a script? A persona? Itself a Scientist invocation? The implementation choice has rule-20 implications.

### 4. The B4+B5 bundling

The COMPARISON proposes bundling `NEXT_RUN.md` (forward-feed) with `ABANDON.json` (abandonment terminal class) under one milestone slot.

- Are these one rule-20 axis ("terminal-state vocabulary") or two ("positive-direction handoff" + "abandonment as a normal terminus")?
- Does ABANDON.json need the cleanup-on-next-run side? Maestro cleans abandoned session folders in the next cycle's session-end. Code-oz has no equivalent cleanup pass — would the runner need new logic?
- Is there a third terminal class missing from the vocabulary? (e.g., `STOPPED.json` for explicit user abort, distinct from intervention.)

### 5. Reject set audit

The COMPARISON's reject set is short. Did I miss anything in the maestro template that is portable but not on the borrow list — particularly:
- The `.claude/skills/` documentation pattern (only one skill in the template; could be a skill discovery scaffold)
- The CI pipeline `pr-checks.yml` 5-job structure (lint, typecheck, test, security, docs, conformance)
- The `CODEOWNERS` pattern
- The `.claude/templates/` starter library for `code-oz init`

If any of these is a missed borrow, escalate.

### 6. Meta — comparison framing

The COMPARISON closes by saying maestro's contribution to code-oz is closed at the rule layer. Is that framing correct, or does it underweight the discipline that maestro might still teach? Specifically: maestro's "production lessons learned" in CLAUDE.md (squash-merge divergence, agent pattern blindness, START.md scope gaps expected, Drizzle Kit table rename bug, ~10% session abandonment, Codex-pair-skip-for-mechanical) are TUEL-specific. Are any of them generalizable to code-oz?

## Output format

Reply with:

```
# Codex response — maestro comparison

## Top-line verdict
[push / fix-first / debate-required / accept-with-modifications, plus one paragraph on why]

## Per-borrow verdict
- B1: [agree / disagree / modify] — reasoning
- B2: [...] — reasoning
- B3: [...] — reasoning
- B4: [...] — reasoning
- B5: [...] — reasoning
- B6: [...] — reasoning
- B7: [...] — reasoning
- Reject set: [agree / additions]

## Blind spots in COMPARISON.md
[anything the lead missed that you would flag block-push or fix-first severity]

## Debate findings
[answer the prompts where you have signal; skip where you don't]

## Recommended action
[what should the lead do next? close the comparison? open a sub-comparison? reopen a reject?]
```

Be willing to push back. The lead's verdict is YES, with selective borrows — if your read is "code-oz is missing more than this," say so. The point is structural review, not deference.

## Context for your reasoning

- code-oz repo: `/Users/ozzy-mac/Projects/code-oz` (read-only access)
- maestro template: `/Users/ozzy-mac/Projects/agents/templates/maestro` (read-only access)
- Latest milestone: M16 (Production CLI completion, v0.17.0-alpha.0, 3108 tests, shipped 2026-05-10)
- Project rules: `code-oz/CLAUDE.md` (21 numbered non-negotiables)
- Memory: `code-oz/.claude/memory/MEMORY.md` for milestone history
- Comparison series index: `code-oz/docs/comparison/README.md` (this is row 07)
