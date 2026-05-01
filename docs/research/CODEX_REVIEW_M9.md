# Codex M9 implementation review (CLAUDE.md rule 8)

**Verdict:** `fix-first`

**Thread:** `019de0cf-6307-7e20-965d-31ed3a8b8226`
**Branch:** `feat/m9-review`
**Briefing:** [`CODEX_BRIEFING_M9_REVIEW.md`](./CODEX_BRIEFING_M9_REVIEW.md)
**HEAD at review:** `6f2834b` (commit 11)
**Tag target:** `v0.9.0-alpha.0` (after fix-first findings are closed and the focused M9 test slice reruns)

Codex `gpt-5.5` xhigh, sandbox `read-only`, 2026-04-30.

---

## Findings

### bp#1 — block-push

**File:** [`src/commands/approve.ts:234`](../../src/commands/approve.ts#L234)

**What:** `approve review` removes the worktree but does not parse `REVIEW.md` or require `Final verdict: ready`. The REVIEW hook only checks for a `build_provider_recorded` event before cleanup.

**Why:** A user-editable or corrupted `REVIEW.md` can still be bound into `GATE_REVIEW_PASSED.json` after `gate_required` exists. That violates rule 1: artifact-based gate signals are load-bearing.

**Remediation:** Add a REVIEW pre-approval validator mirroring `preApproveVerifyHook`: parse `REVIEW.md`, reject invalid schema, reject non-`ready`, require `review_resolved` for the same task/attempt/sha, then remove the worktree.

### bp#2 — block-push

**File:** [`src/phases/review.ts:435`](../../src/phases/review.ts#L435)

**What:** `runReview` checks `VERIFY.md` only for matching `taskId` and `attempt`, then `verdict=pass`. It does not cross-check `VERIFY.md`'s `baseCommitSha` / `patchSha256` against `BUILD_REPORT.md`.

**Why:** REVIEW can bless a BUILD report whose task/attempt matches, while the VERIFY pass is bound to a different patch or base. That breaks the upstream-ref contract and can produce a false REVIEW pass.

**Remediation:** Before invoking the reviewer, compare `verifyReport.buildRef.baseCommitSha` and `verifyReport.buildRef.patchSha256` with `buildReport.base.baseCommitSha` and `buildReport.patch.patchSha256`; emit `review_upstream_mismatch` intervention on drift. Add a regression test with same task/attempt but different patch sha.

### bp#3 — block-push

**File:** [`src/artifacts/review-report.ts:930`](../../src/artifacts/review-report.ts#L930)

**What:** finding validation only checks `File:` membership in `changedFilePaths`. It does not reject deleted-file manifest entries and does not validate cited line/range existence in the current worktree.

**Why:** Locked decision 7 required deleted-file rejection and line/range existence checks. Current code can serialize findings against deleted files or impossible line numbers, making `REVIEW.md` look authoritative when the cited evidence is not inspectable.

**Remediation:** Pass the full changed-file manifest plus worktree root into REVIEW finalization. Reject `change: deleted`; for `added|modified`, read the file under the run worktree, reject symlink escapes, and ensure `Line` end is within the current file's line count.

### bp#4 — block-push

**File:** [`src/phases/build.ts:675`](../../src/phases/build.ts#L675)

**What:** BUILD provider durability records `familyOf(builderAgent.provider)`, and REVIEW compares with `familyOf(reviewerAgent.provider)`. It does not use the actual runtime registry/adaptor family, and `ProviderRegistry` does not reject adapter `id` / `family` mismatches.

**Why:** This leaves the exact laundering risk from the planning round partially open: a misregistered adapter can present a different operational family while the event log records only the declared id's default family.

**Remediation:** Make `ProviderRegistry` validate adapter family against `registry.familyOf(id)` unless an explicit override is supplied. Record BUILD family via `opts.invokeCtx.registry.familyOf(builderProvider)` or the validated adapter family, and have `runReview` use the same registry-backed lookup.

### fs#1 — fix-soon

**File:** [`src/phases/review.ts:591`](../../src/phases/review.ts#L591)

**What:** `canonicalizeFindings()` can throw on duplicate ids after fingerprint canonicalization, but `runReview` does not catch it.

**Why:** A malformed reviewer draft can crash the phase instead of producing actionable `NEEDS_INTERVENTION.json`, violating the M9 repair/intervention discipline.

**Remediation:** Wrap canonicalization in a `try/catch`, surface `review_validation_failed` with the persisted draft path, and add a phase-level test where `F-NEW` fingerprint-collides with an existing id in the same draft.

### fs#2 — fix-soon

**File:** [`src/phases/review-resume.ts:143`](../../src/phases/review-resume.ts#L143)

**What:** resume probing treats any matching `review_round_completed` event as enough. The event has no `reviewReportSha256`, so the code cannot verify that the canonical `REVIEW.md` and the event agree.

**Why:** Kickoff decision 10 says a round is complete only when canonical `REVIEW.md` and `review_round_completed` agree. Current state can miss an orphan/corrupt event or stale artifact and may count it toward the cap.

**Remediation:** Add `reviewReportSha256` to `review_round_completed`, emit it from `runReview`, and have resume/cap logic verify the current canonical artifact for the active round before counting it.

---

## Agreed-with-implementation

- Worktree lifetime moved in the right direction: VERIFY approval no longer removes the worktree, and REVIEW approval owns cleanup.
- The strict `fix-first` rule is correctly reflected in canonical verdict computation and parser invariants.
- REVIEW remediation uses a separate coordinator rather than reusing `scheduleAttemptNPlus1`.
- The typed `Source: review-needs-revision` carry-forward shape is the right substrate and avoids fake VERIFY forensics.
- Bounded repair prompts are implemented as small error-code/rule/offending-line prompts, not transcript accumulation.
- Topic-1 prompt safeguards are present: tests-first, five axes, and the false-security-coverage caveat.

## Where I changed my mind

I expected the main risk to be cap composition. The implementation's cap ordering is mostly coherent. The bigger blockers are artifact binding gaps around approval, upstream refs, and runtime family truth.

## Verdict statement

`fix-first`. Do not tag `v0.9.0-alpha.0` until the block-push findings are fixed and the focused M9 tests are rerun. I attempted the focused test slice; pure review-report/canonicalizer/remediation tests passed, but runReview/worktree tests could not run in the read-only sandbox because temp directory creation was blocked, and the escalated rerun was not approved.

---

End of review.
