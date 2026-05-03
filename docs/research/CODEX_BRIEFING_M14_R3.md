# Briefing — M14 Reviewer panel v1 — implementation review (R3)

**Brief date:** 2026-05-03 (afternoon, post-R2)
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** R2 fix-first verdict closure (CLAUDE.md cross-model peer review rule)
**Branch under review:** `feat/m14-reviewer-panel` at HEAD `5a4b11a` (24 commits ahead of `main`)

## Context

Round 1 (`docs/research/CODEX_REVIEW_M14.md`, thread `019debc4`) returned `fix-first` with 7 block-push findings.
Round 2 (`docs/research/CODEX_REVIEW_M14_R2.md`, thread `019dee08`) returned `fix-first` with 3 findings (2 block-push, 1 medium):

1. block-push — Panel mode cannot continue into a second REVIEW round (`priorReviewMd` always parsed via `parseReviewReport`)
2. block-push — Panel staging resume contract is not implemented (the impl writes staging but never reads it)
3. medium — Contract docs (`REVIEW_PANEL.md`, fixture README, `PanelBaselineFixture` comments) describe the pre-F1 event model and pre-F7 fixture-declared metric story

This round reviews the 3 closure commits that landed on top:

```
5a4b11a docs(contracts/review-panel,fixtures): align contract docs with F1 + F7 + R2-F1 + R2-F2 behavior (R2-F3)
0fc2e90 feat(phases/review,review-resume): panel staging resume guard via review_panel_resume_mismatch (R2-F2)
91879a9 feat(phases/review,review-panel): panel multi-round lifecycle — prior REVIEW.md carry-forward (R2-F1)
```

Tests: 2424 pass / 1 skip / 0 fail (was 2419 after the R1 closure round + 5 new tests across the 3 R2 commits). Typecheck clean.

## Required reading (in order)

1. `docs/research/CODEX_REVIEW_M14_R2.md` — your R2 verdict (THE SOURCE OF TRUTH for what was supposed to land in this round)
2. The 3 closure commits at HEAD (`git log --oneline main..HEAD | head -3`)

Sample (don't deep-read) the implementation files:
- R2-F1: `src/phases/review.ts` (mode-aware priorReviewMd dispatch); `src/phases/review-panel.ts` (priorPanelReport merge logic)
- R2-F2: `src/phases/review-resume.ts` (`probePanelResume`); `src/phases/review.ts` (panel-branch wiring)
- R2-F3: `docs/contracts/REVIEW_PANEL.md`; `tests/fixtures/review-panel-baseline/README.md`; `src/commands/doctor-panel-baseline.ts` (fixture comment)

## Verdict format

Return one of: `push` | `fix-first` | `debate-required`. Format your response as `docs/research/CODEX_REVIEW_M14_R3.md` (mirror prior round files).

## What you must verify (R2 finding closure)

### R2-F1 — Panel multi-round lifecycle

- Does `runReview` detect priorReviewMd grammar via `detectReviewReportMode` and dispatch to `parseReviewPanelReport` for panel artifacts?
- Is `priorPanelReport` forwarded to `runReviewPanel`?
- In `runReviewPanel`, when prior data is supplied:
  - Are F-NNN ids carried forward by fingerprint? (current findings reuse prior id when fingerprint matches)
  - Are new fingerprints assigned ids continuing past the highest prior id?
  - Are prior findings whose fingerprint is NOT raised this round marked as resolved-this-round?
  - Is `roundTimeline` built as `[...prior.roundTimeline, newEntry]`?
  - Are re-raised previously-resolved fingerprints reset to `roundResolved: 'unresolved'` (ping-pong reopen)?
- Are the 3 lifecycle tests (multi-round + ping-pong + runReview-level dispatch) sufficient?

### R2-F2 — Panel staging resume guard

- Is `probePanelResume` correctly mirrored from `probeReviewResume`?
- Does the F1 panel branch call `probePanelResume` BEFORE dispatching to `runReviewPanelBranch`?
- Does the mismatch path return `review_panel_resume_mismatch` with the staging directory path + file count?
- Does the actionable-suggestion mapping cover the new code?
- Are the 2 regression tests (partial staging triggers intervention with zero invocations + completed round does not trigger guard) sufficient?
- Codex offered two options ("implement panel resume" or "block with intervention"); was option (b) chosen honestly, or is there a half-implementation?

### R2-F3 — Contract doc alignment

- Does `REVIEW_PANEL.md` § "Event taxonomy" now explain the F1 `review_resolved` compatibility emission, the `finalScore=10` sentinel, and the `review_panel_completed` sha-matched fallback?
- Does the "Staging artifact lifecycle" section now describe the v0.1 block-on-mismatch behavior + name the auto-resume deferral as M16+?
- Is the new "Multi-round panel lifecycle" subsection accurate (carry-forward + F-NNN reuse + timeline extension + ping-pong reopen)?
- Does the rule-21 ship-gate description now describe the events-derived `sameFamilyVoteRejectionCount` honestly?
- Does the fixture README distinguish "requested attempt count" from "observed event count"?
- Does `PanelBaselineFixture.sameFamilyVoteRejectionAttempts` JSDoc comment match the doc?

## Anti-pattern audit

The R1 + R2 anti-pattern lists: do any of the new R2-F1+F2+F3 changes introduce:
1. New event vocabulary that should reuse existing types? (None expected; R2-F2 emits `review_panel_resume_mismatch` as an INTERVENTION code, not a new event type — verify.)
2. Bundling multiple authority surfaces in one commit (rule 20)? Each of the 3 R2 commits should stay single-axis.
3. Doc drift in the OPPOSITE direction (over-claiming behavior the impl doesn't have)?
4. Tests that assert against incidental implementation choices (e.g., specific F-NNN values) rather than properties? (R2-F1's test was originally fragile on `expect(f001!.id).toBe('F-001')` — Claude fixed it to assert `match(/^F-\d{3}$/)` and reuse the captured id; verify this is the durable form.)

## Rule-20 commit-by-commit audit

Walk each of the 3 R2 closure commits:
1. Does it serve exactly one R2 finding?
2. Are there leaked changes from a different finding's scope?
3. Is the test count delta proportional to the closure?
4. Does the commit message describe what landed and why?

## What I want you to find (test the briefing's negative space)

- Did R2-F1's `runReview` mode-aware parse path leave any reference to `reviewData` / `priorReport` that should now use `priorPanelReport` for panel-mode runs?
- Does R2-F2's `probePanelResume` correctly identify the staging directory across all valid paths (e.g., trailing slash, missing `panelist-` prefix)? Does the file-count claim hold under pathological staging contents (e.g., a stray `.tmp` partial-write)?
- Did R2-F3 leave any place in `REVIEW_PANEL.md` where the OLD claims still appear? (Stale prose elsewhere in the doc that didn't get updated.)
- Per `feedback_review_rounds_catch_different_classes.md`, R3 typically catches the residue: where R1 caught behavioral and R2 caught contract-drift, R3 may catch "fix introduced a NEW lifecycle gap" (e.g., R2-F1's new merge logic but the synthesis side-effect events don't reflect carry-forward) or "fix is too narrow" (e.g., R2-F2 only catches staging-but-no-panel-completed; what about staging-with-completed-but-canonical-REVIEW.md-missing?).
- Is there a contract drift between the new `REVIEW_PANEL.md` text and the implementation? Specifically the "auto-resume not implemented in v0.1" claim — does the orchestrator behavior match this exactly, or does it have hidden auto-resume in some path?

## Test surface verification

- `bun run typecheck` should be clean.
- `bun test` should report 2424 / 1 skip / 0 fail.
- `bun test tests/review-panel-orchestrator.test.ts` — F3 + F6 + R2-F1 (25 tests).
- `bun test tests/review-phase-panel-dispatch.test.ts` — F1 + F2 + R2-F1 + R2-F2 (8 tests).
- `bun test tests/e2e/review-panel-baseline.test.ts` — F7 (11 tests).
- `bun test tests/review-report-panel-adversarial.test.ts` — F4 (4 tests).
- `bun test tests/review-report-panel-verdict-invariant.test.ts` — F5 (4 tests).

If you cannot run tests in your sandbox, note it and rely on file evidence + commit-message claims.

## R3 verdict mapping

- `push` → tag `v0.15.0-alpha.0` + merge to `main` locally + ask Ozzy for explicit push approval (default no-push policy still applies).
- `fix-first` → address findings in commits 25+ before tag (no tech-debt rule).
- `debate-required` → escalate to Ozzy.

Per `feedback_review_rounds_catch_different_classes.md`, R3 should catch a different class than R1 (behavioral) and R2 (contract drift). Likely surfaces: residual lifecycle gaps the R2-F1+F2 fixes uncovered, narrow-scope misses in the new probes, or doc claims that overshot the implementation.
