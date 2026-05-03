# Codex implementation review — M14 R2

Thread: `019dee08-756b-7ed2-984f-0298ab14c39a`
Model: `gpt-5.5`
Sandbox: read-only, approval policy never
Reviewed branch: `feat/m14-reviewer-panel` at `3bb8b65`
Date: 2026-05-03

## Verdict

`fix-first`

The seven closure commits substantially close the original R1 bugs. F2, F3, F4, F5, F6, and F7 are behaviorally aligned with the requested fixes. F1 wires panel mode into `runReview` for a first happy-path round and emits the compatibility `review_resolved` event expected by approval.

Do not tag M14 yet. R2 found the expected different class of issue: panel mode now returns `needs_revision`, but the lifecycle still cannot safely continue into the next panel round and does not implement the staging resume contract claimed by `REVIEW_PANEL.md`. The contract docs also still describe the pre-F1 event model and the pre-F7 fixture-declared metric story.

Validation Codex ran:

- `bun run typecheck` passed.
- `bun test tests/review-report-panel-adversarial.test.ts` passed: 4 pass / 0 fail.
- `bun test tests/review-report-panel-verdict-invariant.test.ts` passed: 4 pass / 0 fail.
- `bun test tests/review-phase-panel-dispatch.test.ts` was blocked by the read-only sandbox: `mkdtemp` returned `EPERM` under `/var/folders/.../T`, so the reported failures are sandbox setup failures, not test assertions.
- Full `bun test` was not runnable in this sandbox for the same temp-dir write reason.

## R1 finding closure audit

### F1 — `runReview` dispatch to `runReviewPanel`

Partially closed.

The dispatch branch is placed after BUILD/VERIFY/ref checks and before the single-reviewer cross-family check at `src/phases/review.ts:643`. It returns the same `ReviewResult` variants. The resolved path emits `review_resolved`, runs the Scientist tail, validates Scientist sidecars, and calls `requireGate('review')` at `src/phases/review.ts:1957`. The blocked path emits `review_blocked(reason='block')` before terminal intervention at `src/phases/review.ts:2022`. The needs-revision path calls `decideReviewRemediation` against parsed synthesized findings at `src/phases/review.ts:2064`.

The remaining gap is lifecycle continuity. A panel `needs_revision` result cannot cleanly proceed into round 2 with a prior panel `REVIEW.md`, and panel staging resume is not implemented. See findings 1 and 2.

### F2 — `approve review` mode-aware parser

Closed. `preApproveReviewHook` detects report mode, parses panel artifacts with `parseReviewPanelReport`, gates on `finalVerdict === 'ready'`, and uses shared `upstreamRefs`. It checks `review_resolved` first, then accepts a matching ready `review_panel_completed` event for panel artifacts.

### F3 — Registry-owned runtime family resolution

Closed. `RunReviewPanelOptions.registry` is required. Runtime and declared panel families are resolved through `opts.registry.familyOf(...)`, not invoker-supplied `providerFamily`. Events, canonical reviewers, verdict inputs, and cross-family checks use the registry-resolved family.

### F6 — Aggregate budget preflight

Closed. `assertPanelWithinBudget` runs before `review_panel_started`, staging directory creation, and panelist invocation. Refusal returns `panel_budget_exceeded` with no panel start event or panelist call. Soft warnings reuse `budget_warning`; no `panel_cost_warn` vocabulary was added.

### F4 — Authority-impact source consistency

Closed. The parser validates reviewer ids, source ids, and `authorityImpact` from eligible voter presence. The adversarial test file covers the right cases, and the F4 check accumulates issues rather than silencing recompute failures.

### F5 — Cross-section verdict invariant

Closed. The parser now enforces `synthesis.panelVerdict === lastTimeline.panelVerdict`. Combined with existing score-vs-timeline and recomputed-vs-synthesis checks, the transitivity target is achieved.

### F7 — Doctor metric event + events-derived count

Behavior closed, docs/comments stale. The CLI now constructs ephemeral `RunPaths`, passes them into `loadAndRunPanelBaseline`, emits real `panel_quorum_rejected_same_family_vote` events through synthetic same-family configs loaded by `loadConfig`, and counts them back from the run-local event log. Stale prose remains in `PanelBaselineFixture.sameFamilyVoteRejectionAttempts` comments and `tests/fixtures/review-panel-baseline/README.md`.

## Findings

### 1. block-push — Panel mode cannot continue into a second REVIEW round

Files: `src/phases/review.ts:575`, `src/phases/review-panel.ts:516`

Panel mode now returns `needs_revision`, but a normal round-2 call cannot consume the prior panel `REVIEW.md`.

`RunReviewOptions.priorReviewMd` is documented as the prior canonical `REVIEW.md` for `round > 1`, but `runReview` always parses it with the single-reviewer parser before the panel dispatch:

```ts
if (opts.round > 1 && opts.priorReviewMd != null) {
  priorReport = parseReviewReport(opts.priorReviewMd)
}
```

F2 exists because panel artifacts require `parseReviewPanelReport`; a panel prior artifact contains `## Reviewers`, not single-mode `## Reviewer`. So panel round 1 `needs_revision` followed by round 2 with the prior panel report fails before it reaches the panel branch.

Even if a caller omits `priorReviewMd`, `runReviewPanel` creates a one-entry `roundTimeline` for the current round and synthesizes findings only from current invocations. It has no input for prior panel findings, no way to mark prior findings resolved in round 2, and no way to preserve the panel timeline required by the 4-round cap contract.

Recommendation: make prior REVIEW parsing mode-aware before the dispatch branch. Add a `ReviewReportPanelData` prior path into `runReviewPanel` or a panel-specific branch that appends timeline, carries prior synthesized findings, marks resolved findings, and preserves cap semantics. Add a lifecycle test: panel round 1 returns `needs_revision`, BUILD/VERIFY attempt 2 passes, panel round 2 receives prior panel `REVIEW.md`, resolves, and approval succeeds.

### 2. block-push — Panel staging resume contract is still not implemented

Files: `docs/contracts/REVIEW_PANEL.md:164`, `src/phases/review-panel.ts:337`, `src/phases/review.ts:591`

`REVIEW_PANEL.md` says panel resume reads completed staging files by `review_panelist_completed` events and continues at the first missing panelist. The implementation writes staging drafts and completion events, but it never reads them on a later call. The panel loop always starts at index 0.

The existing resume probe in `runReview` is still single-reviewer-specific: it checks `review-drafts/round-N-attempt-1.md` and `review_round_completed`. It does not inspect `review-panel/round-N/panelist-*.md`, `review_panelist_completed`, or `review_panel_completed`.

If panelist A completes and panelist B fails or the process dies, the next `runReview` call will re-invoke panelist A instead of resuming from B or surfacing a panel-specific resume mismatch. That violates the staging-vs-canonical authority guarantee: completed per-panelist evidence can be silently superseded.

Recommendation: either implement panel resume from `review_panelist_completed` plus staging sha events, or deliberately block on incomplete panel staging with a `review_panel_resume_mismatch` intervention. Add tests for A-complete/B-fails and rerun behavior.

### 3. medium — Contract docs still describe the pre-F1 and pre-F7 behavior

Files: `docs/contracts/REVIEW_PANEL.md:356`, `src/phases/review.ts:1962`, `src/phases/review-panel.ts:549`, `tests/fixtures/review-panel-baseline/README.md:55`, `src/commands/doctor-panel-baseline.ts:84`

The implementation intentionally emits a panel-path `review_resolved` event so `approve.ts` can use the existing ready-event check. The contract still says panel mode does not emit the single-reviewer terminal events and instead uses only panel taxonomy. That is now false.

The `review_resolved.finalScore` field also uses `REVIEW_SCORE_MAX` as a numeric sentinel while the canonical panel artifact records `Final score: panel`. That can be defensible as compatibility glue, but the contract should explicitly say so because event consumers will otherwise treat 10 as a real reviewer-authored score.

F7 behavior is now events-derived in the CLI path, but the fixture README and `PanelBaselineFixture.sameFamilyVoteRejectionAttempts` comments still describe the count as synthetic fixture metadata.

Recommendation: update `REVIEW_PANEL.md` to describe the compatibility `review_resolved` emission, the `finalScore` sentinel, the `review_panel_completed` fallback, and the true F7 event-derived positive control. Update the fixture README/comments to distinguish requested attempts from observed event count.

## Anti-pattern audit

- New `panel_cost_warn` event vocabulary: not found. F6 emits `budget_warning`.
- Synthesizer-as-persona: not found. Synthesis remains orchestrator-owned and mechanical.
- Configurable quorum knob: not found. Fixed exactly two voter panelists remains enforced.
- Same-family advisory able to force `block` or `needs-revision`: not reintroduced in helper/parser paths. Voter corroboration remains required.
- Imaginary ProviderId values in tests: canonical fixtures use real provider ids. The one fake provider id in `review-panel-orchestrator.test.ts` is an adversarial runtime-unresolved test, not a production fixture.
- Sequential to parallel: not introduced. `runReviewPanel` iterates sequentially.
- Bundling multiple authority surfaces: the seven commits mostly preserve single-axis discipline. The F3/F6/F1 order swap is reasonable because F3 and F6 extend `RunReviewPanelOptions` first, leaving F1 as wiring.

## Rule-20 commit-by-commit audit

1. `264e4ec feat(phases/review-panel): registry-owned runtime family resolution (F3)`
   Scoped to F3. Message accurate. Test delta proportional.

2. `cc4b265 feat(phases/review-panel): aggregate panel budget preflight wired into orchestrator (F6)`
   Scoped to F6. No new event vocabulary. Message accurate.

3. `fc7dc75 feat(phases/review): dispatch to runReviewPanel when company.reviewer.panel configured (F1)`
   Mostly scoped to F1. The change is large but expected. It does not bundle F2 parser work. It underdescribes the remaining lifecycle gap: dispatch works for first-round panel flow, but not for panel multi-round prior state or panel resume.

4. `a706e87 feat(commands/approve): mode-aware REVIEW.md parser + panel-event acceptance (F2)`
   Scoped to F2. Message accurate. Shared `upstreamRefs` migration is clean.

5. `32adc72 feat(artifacts/review-report): parser enforces authority-impact source consistency (F4)`
   Scoped to F4. Adversarial tests are appropriate. Message accurate.

6. `c517194 feat(artifacts/review-report): parser enforces cross-section verdict invariant (F5)`
   Scoped to F5. Tests cover the new invariant, canonical acceptance, and existing score/timeline invariant. Message accurate.

7. `3bb8b65 feat(commands/doctor): events-derived rule-21 metric + CLI emits review_panel_baseline_completed (F7)`
   Scoped to F7 and implements option (a) honestly in code. Message accurate. Stale comments/README text should be fixed before tag because they now contradict behavior.

## What Claude could have done better

Claude closed the direct R1 bullets but did not run the first negative-space lifecycle test: panel round 1 `needs_revision` into panel round 2 with the prior panel artifact. That would have exposed the single-parser prior-review path immediately.

Claude also treated staging writes as enough for the staging contract. The contract says resume from staging; the implementation only writes staging. A crash-after-panelist-A test would have forced the missing decision: resume, or block with a panel-specific recovery intervention.

Finally, the contract file should have been updated in the same fix-first round. F1 intentionally changed the panel event model by emitting `review_resolved`, and F7 intentionally changed metric provenance from fixture-declared to events-derived. Leaving the docs stale creates exactly the contract drift this R2 round was meant to catch.

## Summary

Verdict `fix-first`. The R1 closure commits are mostly correct, and the parser/budget/doctor fixes look sound. M14 should not tag until panel needs-revision can continue into a real second panel round, incomplete panel staging is either resumable or explicitly blocked, and `REVIEW_PANEL.md` plus fixture comments match the new F1/F7 behavior.
