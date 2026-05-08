# Briefing — M15 Phase 3 replan (post-Codex-R1 fix-first verdict)

**Brief date:** 2026-05-08
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** Codex R1 returned `fix-first` (`docs/research/CODEX_REVIEW_M15.md`); rule 20 + rule 21 require a planning-convergence round before more code lands
**Branch:** `feat/m15-debate-scheduler` at HEAD `38f2c10`

## What happened

You returned `fix-first` on `38f2c10` with **5 block-push + 4 fix-soon findings + premature-ROADMAP-closure FYI**. The central finding (R1 #1) is structural: production auto-fire is a no-op because `firePathExecutor` is never wired at the call sites in `src/phases/review.ts` (lines 949 and 2066). Findings #2-#5 cascade from this; findings #6-#9 are independent correctness issues that surface once #1 is wired.

I documented this scope cut in advance: `m15_progress.md` "Open follow-up #1" + briefing question #1 to you flagged it. You rejected the cut as not honest enough for the milestone. I agree with your reasoning — the M15 authority boundary is "orchestrator-side automatic-trigger policy + measurable risk metric" and a no-op fire path makes both halves untrue.

The user has authorized a planning-convergence round before any more code lands.

## The central scope decision

Three paths to close M15:

### Path A — Telemetry-only M15 (rename + ship as-is)

- Rename the milestone authority boundary to "orchestrator-side automatic-trigger **decision predicate** + telemetry surface + measurable risk-metric definition"
- Update DEBATE_POLICY.md, ROADMAP.md, kickoff to match
- Tag `v0.16.0-alpha.0` from a follow-up SHA (after fixing findings #4 reducer gameability, #5 fingerprint diff, #6 event order, #7 Path A, doc drift) but explicitly excluding production fire-path wiring
- Defer findings #1, #2, #3, #8, #9 to a new milestone "M15.5 Production fire-path wiring + live FakeProvider e2e"
- Cost: rule-21 ship gate becomes "metric definitions are gameable-resistant on adversarial fixtures" not "production scheduler reduces risk"
- Risk: M15 ships with a known authority-mismatch between contract claim and code behavior, even after rename. Stigmatizes the pattern.

### Path B — Reshape M15 to include full production wiring (don't tag yet)

- Treat `38f2c10` as Phase 1 of M15 (predicate + telemetry); Phase 2 wires production
- Open a fresh kickoff for the production-wiring slice (executor in `review.ts`, `runReviewRoundLocked` factor, real fingerprint diff in postreview emission, aggregate preflight wiring, live FakeProvider e2e, resume detection)
- Stay on `feat/m15-debate-scheduler`; close all 9 findings + the doc drift + ROADMAP correction in a Phase 2 commit sequence
- Tag once at the end as the "real" v0.16.0-alpha.0
- Cost: M15 grows in scope. Estimated 6-10 commits beyond `38f2c10`. May take several sessions.
- Risk: rule 20 violation looks possible if Phase 2 introduces a second authority surface. But: production wiring of an already-locked predicate is not a new authority — it's the existing authority becoming real. So rule 20 holds if framed correctly.

### Path C — Tag M15 as evaluator-only + ship M15.5 as fire path

- Same code-shape as Path A (rename + ship), then immediately open M15.5 with full production wiring as a single-axis follow-up milestone
- Difference from Path A: the rename is permanent. M15 is "scheduler decision predicate + telemetry"; M15.5 is "scheduler production fire path"
- Cost: cleaner accounting; no retroactive renaming. Two tags + two release notes instead of one.
- Risk: The metric definition in M15 ships unproven by real events. Until M15.5, "rule 21 ship gate" is a conditional claim.

## My recommendation: Path B with tight Phase 2 scope

I lean Path B. The reasoning:

1. **Rule 20 holds.** The authority boundary is the predicate + telemetry + metric. Wiring the predicate's production fire path is making the authority real, not adding a new one. M11 was a contract; M11 wiring later was the same authority becoming load-bearing.

2. **Rule 21 holds.** The measurable-risk-reduction floor was claimed but not measured. Path B closes that gap before tag.

3. **No-tech-debt rule fires.** All 9 findings + doc drift must close before tag. Path A defers #1-#3, #8, #9 — those are block-push or fix-soon, not nits/fyis.

4. **Phase 2 is ~6-10 commits.** Concrete sequence sketch (each single-axis):
   - C12: factor `runReviewRoundLocked` in `src/phases/review.ts` (prep refactor; no behavior change)
   - C13: production `firePathExecutor` for single mode (wire `aggregateDebateSchedulerPreflight`, call `requestDebate`, run post-debate REVIEW round under existing lock, emit `fired` BEFORE `requestDebate`)
   - C14: production `firePathExecutor` for panel mode (same shape, panel-aware preflight)
   - C15: real `actionableFindingsAddedCount` from fingerprint/severity diff in postreview emission
   - C16: rule-21 reducer fix — count failed fires in denominator; classify error/skip per finding #4; **reverse the locked test assertions** at `tests/commands-doctor-debate-baseline.test.ts:327,349`
   - C17: live FakeProvider production e2e that exercises evaluated → fired → debate_started → debate_resolved → postreview through the real `runReview` path; feed the resulting events into `doctor --debate-policy-baseline`
   - C18: resume detection in production for `evaluated-no-terminal`, `fired-no-start`, `resolved-no-postreview`
   - C19: ROADMAP.md correction + doc drift in test comments + kickoff/contract update for whichever Path A resolution we pick

5. **The Path A BUILD-family question (R1 #7) is independent and must resolve first.** See next section.

## The Path A structural question (R1 #7)

The kickoff (`SESSION_M15_IMPL_KICKOFF.md:41`) said:

> The reviewer's `tool_use.debate.opposingProviders` list must be populated such that every entry passes M11 eligibility AND differs in family from the run's BUILD provider AND from the reviewer's own provider family.

The implementation (`src/agents/defaults/reviewer.md:27`): `opposingProviders: ['claude']`.

The bundled defaults: BUILD = claude (`src/agents/defaults/builder.md:5`), REVIEWER = codex (`src/agents/defaults/reviewer.md:5`).

So with the bundled product, the kickoff's BUILD-family-exclusion clause is violated by the only opponent (claude == BUILD family). M11-eligible alternatives:

| Family | Eligible? | Why not |
|---|---|---|
| codex | No | reviewer's own family |
| claude | Yes (M11) but | == BUILD family per kickoff clause |
| gemini | No | `eligiblePhases: NO_PHASES` (M11 stub) |
| xai | Yes (M11) but | requires operator-configured XAI_API_KEY; bundled defaults stay conservative |

The bundled product has **no valid opponent** under the kickoff clause as written.

The M10 runtime (`src/tools/debate-request.ts:177-187`) checks caller-family != opposing-family only. It does NOT check BUILD-family != opposing-family. So the kickoff clause was kickoff-only; the runtime never enforced it.

Three resolutions:

### A1 — Drop the BUILD-family-exclusion clause

Rationale: At REVIEW time, REVIEW is already cross-family with BUILD (rule 2 enforces this at the REVIEW gate). The debate's purpose is to challenge REVIEW's verdict, not to second-review BUILD. Opponent != REVIEW family suffices for cross-family debate. If opponent happens to match BUILD family, opponent might be biased toward BUILD's choices — but that's steel-manning the BUILD-favorable position, which is what a debate should do. REVIEW remains gate authority (your Q9).

Effect: bundled `opposingProviders: ['claude']` becomes valid. Update kickoff + DEBATE_POLICY.md + add a regression test that says reviewer-codex may schedule a debate against claude when BUILD was claude.

### A2 — Keep BUILD-family-exclusion, ship gemini-conditional opposingProviders

Rationale: BUILD-family exclusion was a real bias-avoidance signal. The opponent should not share family with BUILD because that would let BUILD's family review its own work via debate.

Effect: bundled `opposingProviders: ['gemini']` is the only valid option. Today gemini has `eligiblePhases: NO_PHASES` (M11 stub) so the runtime would reject. This means M15 ships with auto-mode permanently no-op until M16 brings gemini live. Useless. Or we ship M15 telemetry-only and gate auto-mode behind `XAI_API_KEY` operator config — rule-21 baseline only runs with operator API key, which is not the bundled-product story.

### A3 — Make BUILD-family exclusion persona-configurable

Rationale: bias-avoidance is a per-persona concern. A reviewer that wants strict isolation declares `opposingProviders` excluding BUILD family; a reviewer that wants steel-manning includes BUILD family. The runtime continues to enforce only caller != opposing.

Effect: kickoff clause becomes "reviewer SHOULD consider excluding BUILD family from `opposingProviders`; runtime enforces only caller != opposing." Bundled defaults keep `[claude]` (steel-manning posture). Documentation captures the trade-off.

I lean A1 over A3 over A2.
- A1 is cleanest: aligns with what the runtime actually enforces, removes a constraint that was never load-bearing.
- A3 is honest about persona-level choice but adds documentation surface without functional change.
- A2 is unworkable in v0.1 with the current provider mix.

## What I want from you

Three questions. Be specific.

### Q1: Path A vs B vs C

Of the three paths to close M15, which do you recommend? If Path B, are 6-10 commits the right ballpark, and is the C12-C19 sequence single-axis enough? Are there commits I should split or merge?

### Q2: Path A structural resolution (R1 #7)

A1, A2, or A3? Argue your pick. If A1, the BUILD-family-exclusion clause was over-restrictive and should be dropped from the kickoff; what's the right replacement language for DEBATE_POLICY.md so the cross-family discipline still reads cleanly?

### Q3: Lock-collision fix shape

Finding #1 says wire production executor + factor `runReviewRoundLocked` so the post-debate REVIEW round runs under the outer `.review.lock` without re-acquiring. Two implementation shapes:

- **Inline shape:** the executor's body lives inside `runReview` (between the post-verdict scheduler hook and the gate write). The post-debate REVIEW round is a second loop iteration of the existing review-round body.
- **Factored shape:** extract `runReviewRoundLocked(opts: ReviewRoundOpts)` from `runReview`. The executor calls it. The outer `runReview` holds the lock; the executor body never touches lock state.

Which do you prefer for v0.1? The inline shape is less code; the factored shape is more testable (a real-path lock-collision test becomes possible per finding #9). Lean toward whichever serves the readability + test-surface goal best.

### Q4 (negative space): What did I miss?

Did I miss a finding pattern in your R1 verdict that should reshape the plan? Did I overlook a CLAUDE.md non-negotiable rule the replan would violate? If you'd defer any of #6-#9 to M16+, say so and why.

## Ground rules

- Sandbox is read-only; print your response inline. I'll save it to `docs/research/CODEX_RESPONSE_M15_REPLAN.md`.
- Token economy: aim 4-6k. Quality > volume.
- Verdict on the plan, not just the questions: `accept`, `accept-with-modifications`, or `reject-with-reason`.

Begin.
