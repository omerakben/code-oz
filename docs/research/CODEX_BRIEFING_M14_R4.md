# Briefing — M14 Reviewer panel v1 — implementation review (R4)

**Brief date:** 2026-05-03 (afternoon, post-R3)
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** R3 fix-first verdict closure (CLAUDE.md cross-model peer review rule)
**Branch under review:** `feat/m14-reviewer-panel` at HEAD `3a11a0c` (28 commits ahead of `main`)

## Context

- R1 (`docs/research/CODEX_REVIEW_M14.md`, thread `019debc4`): fix-first, 7 block-push findings → all closed in commits 14–20.
- R2 (`docs/research/CODEX_REVIEW_M14_R2.md`, thread `019dee08`): fix-first, 3 findings → closed in commits 22–24.
- R3 (`docs/research/CODEX_REVIEW_M14_R3.md`, thread `019dee1c`): fix-first, 3 findings (1 block-push + 2 medium) → closed in commits 26–27.

This round reviews the 2 R3 closure commits at HEAD:

```
3a11a0c docs(contracts/review-panel,doctor-panel-baseline): close residual doc drift (R3-F2 + R3-F3)
9605606 feat(phases/review-resume,review): probePanelResume sha-mismatch check (R3-F1)
```

Tests: 2425 pass / 1 skip / 0 fail (was 2424 after R2 closure round + 1 new R3-F1 regression test). Typecheck clean.

## Required reading (in order)

1. `docs/research/CODEX_REVIEW_M14_R3.md` — your R3 verdict (THE SOURCE OF TRUTH for what was supposed to land in this round)
2. The 2 closure commits at HEAD (`git log --oneline main..HEAD | head -2`)

## Verdict format

Return one of: `push` | `fix-first` | `debate-required`. Format your response as `docs/research/CODEX_REVIEW_M14_R4.md` (mirror prior round files).

## What you must verify

### R3-F1 — `probePanelResume` sha-mismatch check

- Does `PanelResumeProbeInput` accept `reviewReportPath?: string`?
- Does the panel-branch call site (`src/phases/review.ts`) pass `join(opts.runPaths.artifactRoot, 'REVIEW.md')`?
- When `review_panel_completed` is present, does the probe read the canonical REVIEW.md, sha256 it, and compare against `event.reviewReportSha256`?
- Does it return `reason: 'sha_mismatch'` when the artifact is missing OR the sha disagrees?
- Does it return `reason: 'no_completed_event'` when no event matches?
- Is the orchestrator's intervention `rule` text now distinguishable between the two crash shapes?
- Are the actionable suggestions updated to mention canonical sha verification?
- Is the new regression test correct? (staging present + completed event present + canonical artifact MISSING → review_panel_resume_mismatch with `reviewReportSha256` in the message + zero panelist invocations)

### R3-F2 — REVIEW_PANEL.md residual drift

- Are paths corrected to `.code-oz/runs/<runId>/review-panel/round-<N>/` and `.code-oz/artifacts/REVIEW.md`?
- Is the "staging files have a separate parser" claim removed?
- Is the "synthesis from staging is idempotent" claim removed?
- Is the parser dispatch description corrected to `## Reviewers` vs `## Reviewer` (H2 lines, not `Reviewers:`/`Reviewer:`)?
- Is the layer-3 row corrected to `parseReviewPanelReport`?
- Does the resume policy paragraph now mention the R3-F1 sha-mismatch case alongside no_completed_event?
- Did Claude grep `REVIEW_PANEL.md` for `staging`, `parseReviewReport`, `serializeReviewReport`, `state/`, and similar terms? Are there any other lurking stale claims (sample the whole file, not just the lines Codex cited)?

### R3-F3 — `doctor-panel-baseline.ts` algorithm comment

- Is the inline algorithm comment in `runPanelBaseline` JSDoc updated to describe the events-derived path AND the no-runPaths fallback?
- No regression in the JSDoc on `PanelBaselineFixture.sameFamilyVoteRejectionAttempts`?

## Anti-pattern audit

R3 closure should NOT have introduced:
1. New event vocabulary (R3-F1 should reuse `review_panel_resume_mismatch` intervention code, no new events).
2. New rule-20 bundling.
3. Doc claims that overshoot the implementation (R3-F2 should describe v0.1 reality only, not aspirational M16+ behavior).

## Rule-20 commit-by-commit audit

Walk each of the 2 R3 closure commits:
1. Does it serve exactly one R3 finding (or the F2+F3 doc-only pair)?
2. Are there leaked changes from a different finding's scope?
3. Is the test count delta proportional to the closure?

## What I want you to find (test the briefing's negative space)

- Per `feedback_review_rounds_catch_different_classes.md`, R4 may find: tests that pass under the new logic but assert weak invariants; doc claims that are MORE accurate but still not minimal; a code path Claude didn't realize is now reachable.
- Are there any other places in the codebase (not just the contract doc) where the old `state/review-panel/...` path or `parseReviewReport` (singular) is mentioned for panel mode?
- Does the new `probePanelResume` correctly handle the case where the canonical REVIEW.md exists but is empty or partial-write? (The probe reads via `readFile` and sha256s the bytes; an empty file would have a known sha — does that match the event sha by coincidence? Almost certainly not, but worth confirming.)

## Test surface verification

- `bun run typecheck` should be clean.
- `bun test` should report 2425 / 1 skip / 0 fail.

If you can run them, do so; otherwise rely on file evidence.

## R4 verdict mapping

- `push` → tag `v0.15.0-alpha.0` + merge to `main` locally + ask Ozzy for explicit push approval (default no-push policy still applies).
- `fix-first` → address findings before tag (no tech-debt rule).
- `debate-required` → escalate to Ozzy.

After 3 rounds of fix-first, R4 is the cleanup round. If R4 returns push, M14 ships. If R4 finds another fix-first, the team's choice is to keep iterating per the no-tech-debt rule.
