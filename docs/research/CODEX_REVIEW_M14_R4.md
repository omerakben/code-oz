# Codex implementation review — M14 R4

Thread: `019dee29-6d2d-7181-828f-b3d15889fa93`
Model: `gpt-5.5`
Sandbox: read-only, approval policy never
Reviewed branch: `feat/m14-reviewer-panel` at `3a11a0c`
Date: 2026-05-03

## Verdict

`fix-first`

The R3 closure commits land the important runtime fix: panel resume now mirrors the single-reviewer canonical-artifact sha check when `review_panel_completed` is present, and the production `runReview` panel branch passes `.code-oz/artifacts/REVIEW.md` into the probe.

Do not tag M14 yet. R4 found remaining R3-F2 residue in active contract/source surfaces: `REVIEW_PANEL.md` still says the orchestrator can regenerate from staging, and one paragraph overstates staging sha verification as a read/verify behavior. Active source comments and a validator fixture also still teach the old `state/review-panel/...` path.

Validation Codex ran:

- `bun run typecheck` passed (`tsc --noEmit` exited 0).
- `bun test` was blocked by the read-only sandbox: the suite repeatedly fails on `EPERM: operation not permitted, mkdtemp '/var/folders/.../T/...'`. It reported 1612 pass / 793 fail / 2405 tests before exit, but the failures are sandbox temp-dir write failures, not accepted signal for the expected 2425 pass / 1 skip / 0 fail.

## R3 finding closure audit

### R3-F1 — Panel resume guard trusts `review_panel_completed` without verifying canonical REVIEW.md

Closed from file evidence.

`PanelResumeProbeInput` now accepts `reviewReportPath?: string`, and the production panel branch in `runReview` passes `join(opts.runPaths.artifactRoot, 'REVIEW.md')`.

`probePanelResume` now finds a matching `review_panel_completed` by `(taskId, attempt, finalRound)`, returns `reason: 'no_completed_event'` when no event matches, reads the canonical `REVIEW.md` when an event exists and `reviewReportPath` is supplied, and returns `reason: 'sha_mismatch'` when the canonical artifact is missing or its sha256 differs from `event.reviewReportSha256`.

The intervention remains `review_panel_resume_mismatch`, and `runReview` renders distinguishable rule text for no-event vs sha-mismatch cases. The actionable suggestions now mention both the staging directory and the canonical artifact/event sha comparison.

The new regression test seeds staging files plus a synthetic `review_panel_completed` event with no canonical `REVIEW.md`, then asserts `review_panel_resume_mismatch`, `reviewReportSha256` in the rule text, and zero panelist invocations. It only covers the missing-artifact variant, not an existing wrong-sha artifact, but the implementation path is the same after `readIfExists` succeeds and hashes the on-disk content.

For empty or partial canonical files, the probe hashes the on-disk content and compares it to the event sha. That blocks ordinary empty/partial writes. It cannot detect a semantically bad artifact if the event already recorded that exact bad sha, but that is the same authority model as the single-reviewer probe and not a new R4 blocker.

### R3-F2 — `REVIEW_PANEL.md` residual drift

Partially closed.

The specific edited section now uses `.code-oz/runs/<runId>/review-panel/round-<N>/` and `.code-oz/artifacts/REVIEW.md`, removes the separate staging parser and synthesis-idempotence claims, corrects parser dispatch to `## Reviewers` vs `## Reviewer`, names `parseReviewPanelReport`, and mentions the R3-F1 sha-mismatch case.

Remaining drift is still present. See findings 1 and 2.

### R3-F3 — `doctor-panel-baseline.ts` algorithm comment

Closed from file evidence.

The `runPanelBaseline` JSDoc now describes the actual events-derived same-family rejection metric when `runPaths` is supplied, and the no-`runPaths` fixture fallback. I did not find a regression in the `PanelBaselineFixture.sameFamilyVoteRejectionAttempts` explanation in the inspected range.

## Findings

### 1. medium — `REVIEW_PANEL.md` still claims staging recovery/verification behavior v0.1 does not implement

Files: `docs/contracts/REVIEW_PANEL.md:158`, `docs/contracts/REVIEW_PANEL.md:447`, `src/phases/review-panel.ts:423`, `src/phases/review-panel.ts:449`, `src/phases/review-resume.ts:325`

The R3-F2 cleanup removed the main staging parser and synthesis-from-staging paragraph, but the active contract still contains two overshoots.

First, the staging section says staging files "are written and read for sha verification on `review_panelist_completed`." I could not find a runtime path that reads the staging file back for verification. `runReviewPanel` atomically writes `result.stagingContent`, then emits `stagingSha256: SHA(result.stagingContent)` from the in-memory content. `probePanelResume` reads the canonical `REVIEW.md`, not staging. That means the contract should say the event records the staged content sha, not that v0.1 reads staging for sha verification.

Second, the common errors table still says `review_artifact_quorum_inconsistent` means "Artifact corruption; orchestrator regenerates from staging." That directly contradicts the new v0.1 contract text and implementation: there is no synthesis-from-staging path, and R3-F2 explicitly removed that claim earlier in the same file.

Recommendation: make this contract minimal and runtime-true. Suggested replacement:

```markdown
- v0.1 has NO staging parser. Staging files are forensic evidence only. The orchestrator atomically writes each staging file and records `stagingSha256` in `review_panelist_completed`; v0.1 does not read staging during resume, recovery, or synthesis-from-staging.
```

For the common error action, replace "orchestrator regenerates from staging" with operator guidance such as "Artifact corruption; inspect canonical REVIEW.md and events.jsonl, then restore the canonical artifact or clear staging and rerun REVIEW."

### 2. medium — Active source comments and a validator fixture still use the old `state/review-panel/...` path

Files: `src/phases/review-panel.ts:96`, `src/state/schemas.ts:870`, `tests/state-events-panel.test.ts:152`

The R4 brief asked for a codebase-wide check for old panel staging paths. The active contract section was corrected, but these active source/test surfaces still mention or seed `state/review-panel/round-N/panelist-<id>.md`.

Runtime code writes to `join(opts.runPaths.runDir, 'review-panel', 'round-<N>')`, so this is not a behavior bug. It is still active drift: the `PanelistInvocationResult.stagingContent` comment, the `review_panelist_completed.stagingPath` schema comment, and the validator's "valid event" sample all teach the old path shape.

Recommendation: update those three active surfaces to `.code-oz/runs/<runId>/review-panel/round-<N>/panelist-<id>.md` or a concrete run-local equivalent. Historical planning docs can remain historical, but active type/schema comments and test fixtures should match the shipped path.

## Anti-pattern audit

- New event vocabulary: not introduced. R3-F1 reuses `review_panel_resume_mismatch` as an intervention code.
- New rule-20 bundling: not introduced. The runtime commit is scoped to R3-F1; the second commit bundles the doc-only R3-F2 + R3-F3 closure, which is acceptable in shape.
- Doc claims that overshoot implementation: still present. `REVIEW_PANEL.md` still claims regeneration from staging and overstates staging sha verification; active comments/tests still use the old staging path.

## Rule-20 commit-by-commit audit

1. `9605606 feat(phases/review-resume,review): probePanelResume sha-mismatch check (R3-F1)`

Scoped to R3-F1. The code path is proportional, uses the existing intervention code, and adds one regression test. No leaked authority surface found.

2. `3a11a0c docs(contracts/review-panel,doctor-panel-baseline): close residual doc drift (R3-F2 + R3-F3)`

Intended scope is acceptable because both findings were documentation/comment cleanup. It closes the cited `doctor-panel-baseline.ts` comment and most of `REVIEW_PANEL.md`, but does not fully close R3-F2 because stale staging recovery and path claims remain in active surfaces.

## What Claude could have done better

The R3-F2 pass appears to have searched the lines Codex cited, but not the whole active contract plus source comments for related verbs and paths. A grep for `from staging`, `regenerates`, and `state/review-panel` exposes the remaining drift immediately.

For contract docs, prefer implementation-minimal verbs. "Records a sha" is true here. "Reads for sha verification" and "regenerates from staging" imply runtime behavior that does not exist.

## Summary

Verdict `fix-first`. R3-F1 and R3-F3 are closed, and the runtime is in good shape from file evidence. M14 should not tag until the remaining active `REVIEW_PANEL.md` staging claims and old `state/review-panel/...` source/test references are corrected.
