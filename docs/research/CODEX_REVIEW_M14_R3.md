# Codex implementation review — M14 R3

Thread: `019dee1c-c47a-7d32-a66a-b0adf9b0bac2`
Model: `gpt-5.5`
Sandbox: read-only, approval policy never
Reviewed branch: `feat/m14-reviewer-panel` at `5a4b11a`
Date: 2026-05-03

## Verdict

`fix-first`

The R2 closure commits fixed the main F1 lifecycle hole: panel `priorReviewMd` is parsed mode-aware, `priorPanelReport` is forwarded into `runReviewPanel`, finding ids are reused by fingerprint, missing prior findings resolve in the current round, and ping-pong reopen resets `roundResolved` to `unresolved`.

Do not tag M14 yet. R3 found the expected residue class: the new panel resume guard is narrower than the single-reviewer guard it claims to mirror, and R2-F3 left stale lifecycle/docs comments that still describe non-existent staging parser or fixture-declared metric behavior.

Validation Codex ran:

- `bun run typecheck` passed.
- `bun test tests/review-report-panel-adversarial.test.ts tests/review-report-panel-verdict-invariant.test.ts` passed: 8 pass / 0 fail.
- The combined targeted panel suite was blocked by the read-only sandbox: `mkdtemp` returned `EPERM` under `/var/folders/.../T`, so `tests/review-panel-orchestrator.test.ts`, `tests/review-phase-panel-dispatch.test.ts`, and `tests/e2e/review-panel-baseline.test.ts` could not execute assertions here.
- Full `bun test` was not runnable in this sandbox for the same temp-dir write reason.

## R2 finding closure audit

### R2-F1 — Panel multi-round lifecycle

Closed from file evidence.

`runReview` now calls `detectReviewReportMode` for `priorReviewMd` and dispatches panel artifacts through `parseReviewPanelReport` before the panel branch. `runReviewPanelBranch` forwards `priorPanelReport` into `runReviewPanel`.

`runReviewPanel` carries prior synthesized findings forward by fingerprint, reuses prior F-NNN ids, continues numbering past the highest prior id, marks prior fingerprints not raised in the current round as resolved at the current round, appends the new timeline entry to the prior timeline, and reopens previously resolved fingerprints by setting `roundResolved: 'unresolved'`.

The tests cover the main lifecycle path, ping-pong reopen, and runReview-level prior panel dispatch. The R2-F1 id assertion was made durable by capturing the generated id rather than hard-coding `F-001`.

### R2-F2 — Panel staging resume guard

Partially closed.

The implementation honestly chose option (b): block on partial panel staging rather than auto-resume. `runReview` calls `probePanelResume` before `runReviewPanelBranch`, and the no-completed-event path returns `review_panel_resume_mismatch` with a staging directory and panelist file count. `review_panel_resume_mismatch` is an intervention code, not a new event type.

The guard is still too narrow. See finding 1.

### R2-F3 — Contract doc alignment

Partially closed.

`REVIEW_PANEL.md` now correctly documents the compatibility `review_resolved` emission, the numeric `finalScore=10` sentinel, and the `review_panel_completed` fallback in `preApproveReviewHook`. The rule-21 ship-gate metric text and fixture README now distinguish requested same-family rejection attempts from observed event counts.

Stale claims remain in `REVIEW_PANEL.md` and one `doctor-panel-baseline.ts` algorithm comment. See findings 2 and 3.

## Findings

### 1. block-push — Panel resume guard trusts `review_panel_completed` without verifying canonical REVIEW.md

Files: `src/phases/review-resume.ts:282`, `src/phases/review.ts:688`, `tests/review-phase-panel-dispatch.test.ts:699`

`probePanelResume` suppresses `review_panel_resume_mismatch` as soon as it finds a matching `review_panel_completed` event. Unlike `probeReviewResume`, it never verifies that the canonical `REVIEW.md` exists or that its sha256 matches `review_panel_completed.reviewReportSha256`.

That leaves the exact R3 residue case open: panel staging can exist with a completed event, but the canonical artifact can be missing, corrupted, or overwritten. A fresh `runReview` call then proceeds into `runReviewPanelBranch` and re-invokes panelists, overwriting staging evidence instead of surfacing an operator recovery path. The single-reviewer probe already blocks the analogous state as `sha_mismatch`; panel mode should not be weaker on the staging-vs-canonical authority guarantee.

The regression test named "completed panel round (review_panel_completed event present) does not trigger resume mismatch" does not pre-seed staging plus a completed event before the guard. It only proves the normal F1 happy path still resolves. Add a test with `panelist-*.md`, a matching `review_panel_completed` event, and a missing or mismatched canonical `REVIEW.md`; assert `review_panel_resume_mismatch` and zero panelist invocations.

Recommendation: give `probePanelResume` the canonical review path, read it when a completed event exists, compare sha256 against `review_panel_completed.reviewReportSha256`, and return the same intervention code when the artifact is absent or mismatched. The suggestion text can distinguish `no_completed_event` from `sha_mismatch` the way `probeReviewResume` does.

### 2. medium — `REVIEW_PANEL.md` still over-claims staging parser and completed-staging synthesis behavior

Files: `docs/contracts/REVIEW_PANEL.md:158`, `docs/contracts/REVIEW_PANEL.md:159`, `docs/contracts/REVIEW_PANEL.md:174`, `docs/contracts/REVIEW_PANEL.md:356`

The R2-F3 docs pass did not remove all old staging/resume claims.

The staging section says "staging files have a separate parser used only for forensic inspection" and "rerunning synthesis on completed staging files produces byte-identical canonical REVIEW.md". I could not find an implemented staging parser or a path that reads completed staging files to rerun synthesis. The v0.1 runtime writes staging files and blocks on incomplete staging; it does not synthesize from staging on a later invocation.

The schema section also says the parser dispatches on `Reviewers:` vs `Reviewer:` and that both shapes round-trip through `serializeReviewReport` / `parseReviewReport`. The implementation dispatches on exact H2 lines `## Reviewers` vs `## Reviewer`, and panel artifacts use `serializeReviewPanelReport` / `parseReviewPanelReport`.

There is also path drift in the same area: it describes `state/review-panel/round-N/` and `state/REVIEW.md`, while the implementation writes staging under `state/runs/<runId>/review-panel/round-N/` via `runPaths.runDir`, and canonical `REVIEW.md` under the artifact root.

Recommendation: rewrite this section to say v0.1 does not parse or resume from staging. Staging is forensic evidence only unless an operator manually intervenes. Name the actual parser pair and actual paths.

### 3. medium — `doctor-panel-baseline.ts` still has the pre-F7 metric algorithm comment

File: `src/commands/doctor-panel-baseline.ts:177`

The `PanelBaselineFixture.sameFamilyVoteRejectionAttempts` JSDoc was fixed, but the `runPanelBaseline` algorithm comment still says:

```text
sameFamilyVoteRejectionCount = fixture.sameFamilyVoteRejectionAttempts
```

That is the stale pre-F7 story R2 explicitly asked to remove. The code below the comment is better: production callers with `runPaths` emit real `panel_quorum_rejected_same_family_vote` events and count them back from the run-local log; only legacy callers without `runPaths` fall back to the fixture value.

Recommendation: update the algorithm comment to match the actual branch: requested attempts drive real config-load rejection events when `runPaths` is present; the metric is observed from events; the fixture-declared value is only the no-runPaths fallback.

## Anti-pattern audit

- New event vocabulary: not introduced. `review_panel_resume_mismatch` appears only as an intervention code and actionable-suggestion mapping, not an event type.
- Authority-surface bundling: the three R2 commits are each tied to one R2 finding. No major leaked implementation scope found.
- Opposite-direction doc drift: still present. `REVIEW_PANEL.md` now documents the new compatibility event model, but stale staging parser and synthesis-from-staging claims remain.
- Incidental tests: R2-F1's F-NNN test is durable enough. R2-F2's second test name overstates what it covers because it does not seed a prior completed event before the probe.

## Rule-20 commit-by-commit audit

1. `91879a9 feat(phases/review,review-panel): panel multi-round lifecycle - prior REVIEW.md carry-forward (R2-F1)`
   Scoped to R2-F1. Message accurately describes the mode-aware prior parser and carry-forward behavior. Test delta is proportional.

2. `0fc2e90 feat(phases/review,review-resume): panel staging resume guard via review_panel_resume_mismatch (R2-F2)`
   Scoped to R2-F2 and chooses the block path honestly. The implementation is narrower than the "mirrors probeReviewResume" claim because it lacks canonical artifact sha verification when `review_panel_completed` exists.

3. `5a4b11a docs(contracts/review-panel,fixtures): align contract docs with F1 + F7 + R2-F1 + R2-F2 behavior (R2-F3)`
   Scoped to docs/comments. It fixes the main event taxonomy and rule-21 metric wording, but leaves stale claims in `REVIEW_PANEL.md` and the algorithm comment in `doctor-panel-baseline.ts`.

## What Claude could have done better

The R2-F2 fix tested only the no-`review_panel_completed` crash shape. A true mirror of the single-reviewer resume probe needs the second half too: completed event present but canonical artifact missing or sha-mismatched. The R3 brief called this out as negative space, and the current code misses it.

The R2-F3 docs pass focused on the newly edited paragraphs but did not grep the contract for older parser/resume wording. A quick search for `resume`, `staging files`, `parseReviewReport`, and `serializeReviewReport` in `REVIEW_PANEL.md` exposes the remaining drift.

## Summary

Verdict `fix-first`. R2-F1 is closed, and the broad R2-F2/R2-F3 direction is right. M14 should not tag until panel resume mismatch detection validates the canonical panel `REVIEW.md` sha when a completed event exists, and the remaining stale staging/parser/metric comments are corrected.
