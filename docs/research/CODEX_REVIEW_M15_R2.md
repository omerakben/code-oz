# Codex implementation review - M15 R2

Verdict: `push`
Thread: `019e09bb-adf3-71c2-adca-74296236b755`
Model: gpt-5.5
Sandbox: read-only, approval policy never
Reviewed branch: feat/m15-debate-scheduler at 21f8b6e
Base: 38f2c10
Date: 2026-05-08

## Verdict

`push`

The R2 branch closes the five R1 block-push findings and the four fix-soon findings at the runtime surface that mattered: production single-mode REVIEW now fires through `requestDebate`, re-enters the lock-free round body with `schedulerEnabled: 'disabled_post_debate'`, swaps the post-debate outcome before final gate effects, feeds real postreview scalars into the rule-21 reducer, and has a production FakeProvider trace that would fail on the R1 no-op path. I found no block-push or fix-first issues. Validation I could run: `bun run typecheck` passed, and `bun test tests/review-fire-path-helpers.test.ts tests/policy-debate-scheduler.test.ts` passed 98/0. Temp-dir tests, including C16/C17, are still blocked in this sandbox by `EPERM mkdtemp`, so I audited those paths by source and commit diff.

## R1 finding closure verification

### R1 #1 (block-push, production single-mode auto-fire)
- Closure SHA + verdict: `d4874ce`, closed
- The production single-mode executor is now inside `runReviewRoundLocked`, selects an eligible opponent, builds the topic/briefing/manifest, calls `hooks.emitFired`, invokes `requestDebate`, drains the runner, reads `DECISION.md`, and then calls `runReviewRoundLocked` directly for post-debate REVIEW with `schedulerEnabled: 'disabled_post_debate'` (`src/phases/review.ts:1212-1338`). It does not re-enter public `runReview`; the only recursive call is the private locked body (`src/phases/review.ts:1338`). On success, it computes the finding diff and swaps `outcome` before `finalizeReviewRound` consumes terminal gate effects (`src/phases/review.ts:1358-1370`, `src/phases/review.ts:1420-1422`, `src/phases/review.ts:1442-1507`).

### R1 #2 (block-push, aggregate preflight wired)
- Closure SHA + verdict: `d4874ce` single mode and `1de8a3c` panel mode, closed
- Single mode now reads the current events list, builds the preflight input, runs `aggregateDebateSchedulerPreflight`, and passes `wouldTip` plus optional `tipReason` into `runReviewSchedulerHook` before any fire path can run (`src/phases/review.ts:1179-1196`, `src/phases/review.ts:1373-1397`). Panel mode does the same with panel-sized preflight (`src/phases/review.ts:2603-2613`, `src/phases/review.ts:2731-2753`). The per-call budget chokepoint remains in `invokeAgent` through `assertWithinBudget` (`src/providers/invoke.ts:117-122`).

### R1 #3 (block-push, production trace feeds rule-21)
- Closure SHA + verdict: `5c60f7b`, closed
- `tests/e2e/debate-scheduler-production-baseline.test.ts` uses `buildProviderRegistry({ providerOverride: 'fake' })`, not a hand-built provider registry (`tests/e2e/debate-scheduler-production-baseline.test.ts:113-123`). It drives real `runReview`, real `requestDebate`, and the recursive post-debate path (`tests/e2e/debate-scheduler-production-baseline.test.ts:790-799`), discriminates the post-debate reviewer response on the locked prompt phrase from `src/phases/review.ts:2376` (`tests/e2e/debate-scheduler-production-baseline.test.ts:669-676`), asserts evaluated/fired/postreview lifecycle and event order (`tests/e2e/debate-scheduler-production-baseline.test.ts:827-844`), and feeds the real events into `computeDebatePolicyBaseline` (`tests/e2e/debate-scheduler-production-baseline.test.ts:915-932`). It would fail on `38f2c10` because the base call site passed no executor (`38f2c10:src/phases/review.ts:949`) and the hook returned `fireOutcome: { fired: false }` on fire decisions without an executor (`38f2c10:src/phases/review-scheduler-hook.ts:365-374`).

### R1 #4 (block-push, denominator counts every fire)
- Closure SHA + verdict: `db7f826`, closed
- The reducer now counts every `debate_scheduler_fired` in `firedCount`, uses a discriminated `JoinedFire` union for `success`, `error`, and `missing`, and surfaces `errorCount` plus `missingTerminalCount` in the computation/report shape (`src/commands/doctor-debate-baseline.ts:75-89`, `src/commands/doctor-debate-baseline.ts:291-319`, `src/commands/doctor-debate-baseline.ts:328-369`). The gating rates divide by total fired count (`src/commands/doctor-debate-baseline.ts:226-234`). The 99-error plus 1-corrective worked example is covered in tests (`tests/commands-doctor-debate-baseline.test.ts:396-438`).

### R1 #5 (block-push, production fingerprint+severity diff)
- Closure SHA + verdict: `d5a1fe3`, closed
- `diffFindingsForPostDebate` now derives postreview scalars from canonical pre/post REVIEW findings by fingerprint and severity rank (`src/phases/review-fire-path.ts:243-323`). New actionable means a new actionable fingerprint or reuse of an existing fingerprint escalated from `nit`/`fyi` to `fix-first`/`block`; escalation increments `actionableFindingsAddedCount` without incrementing `findingsAddedCount` (`src/phases/review-fire-path.ts:312-320`). Production single-mode uses this diff when emitting postreview (`src/phases/review.ts:1358-1369`), and the e2e asserts the resulting scalars (`tests/e2e/debate-scheduler-production-baseline.test.ts:883-897`).

### R1 #6 (fix-soon, fired-before-debate-started ordering)
- Closure SHA + verdict: `9d207c9`, closed
- The executor contract now receives `hooks.emitFired` and explicitly requires it before `requestDebate` (`src/phases/review-scheduler-hook.ts:168-194`). The hook appends `debate_scheduler_fired` from that callback (`src/phases/review-scheduler-hook.ts:450-488`), and the production executor calls it before `requestDebate` (`src/phases/review.ts:1258-1270`). The C17 e2e asserts `debate_scheduler_fired` precedes `debate_started` in the real trace (`tests/e2e/debate-scheduler-production-baseline.test.ts:837-844`).

### R1 #7 (fix-soon, BUILD-family-exclusion drop)
- Closure SHA + verdict: `d4874ce` plus `7e2eb44`, closed
- `selectEligibleOpponent` filters by declared debate permission, M11 review eligibility, and cross-family versus the reviewer only; there is no BUILD-family filter (`src/phases/review-fire-path.ts:79-110`). The contract now states the runtime invariant is caller-family != opposing-provider-family and explicitly says M15 does not require opposing provider to differ from BUILD family (`docs/contracts/DEBATE_POLICY.md:206-208`). The reviewer permission test comment and assertion now agree on `['claude']` (`tests/agents-reviewer-debate-permission.test.ts:4-20`, `tests/agents-reviewer-debate-permission.test.ts:31-49`).

### R1 #8 (fix-soon, scheduler-resume mismatch detection)
- Closure SHA + verdict: `9f2f957`, closed
- `detectSchedulerResumeMismatch` covers all three named crash points: `evaluated_no_terminal`, `fired_no_debate_started`, and `debate_resolved_no_postreview` (`src/phases/review-fire-path.ts:603-607`, `src/phases/review-fire-path.ts:635-742`). `runReviewRoundLocked` calls it after the existing review resume probe and before the round body, only for scheduler-enabled rounds (`src/phases/review.ts:826-840`). The actual intervention code names are `debate_scheduler_resume_after_fire`, `debate_scheduler_resume_after_resolve`, and `debate_scheduler_resume_evaluate_orphan`; each has actionable suggestions (`src/phases/review.ts:499-514`). The code names differ from the R2 briefing strings, but the behavior and typed handling are present.

### R1 #9 (fix-soon, lock-collision proof)
- Closure SHA + verdict: `442c4c8` plus `5c60f7b`, closed
- Public `runReview` is still the only lock-acquiring entry point (`src/phases/review.ts:539-562`). The extracted `runReviewRoundLocked` is private and assumes the lock is already held (`src/phases/review.ts:638-650`). The post-debate path calls `runReviewRoundLocked` directly, not `runReview` (`src/phases/review.ts:1327-1338`), and `rg` shows no other `runReview(` call inside `review.ts` beyond the public declaration and the initial locked invocation. The production e2e verifies two `review_round_completed` events for round 1 inside one `runReview` call (`tests/e2e/debate-scheduler-production-baseline.test.ts:817-825`).

## New findings (if any)

### N1. nit - R2 briefing metadata and resume-code names drift from HEAD
The R2 briefing itself has stale inventory details: it says the branch under review is HEAD `5c60f7b` even though the reviewed HEAD is `21f8b6e` (`docs/research/CODEX_BRIEFING_M15_R2.md:7`), it lists nine commits while `38f2c10..21f8b6e` includes the R2 briefing commit plus the earlier phase-2 kickoff/docs commit (`docs/research/CODEX_BRIEFING_M15_R2.md:16-28`), and it names resume intervention codes/test paths that do not match the implementation (`docs/research/CODEX_BRIEFING_M15_R2.md:96-100`, actual code at `src/phases/review.ts:834-840` and tests at `tests/review-fire-path-helpers.test.ts:742-953`). This is documentation drift in the operating briefing, not a runtime or tag blocker.

## Tag readiness

This branch is tag-ready from the R2 review perspective. The R1 block-push issues are closed, the fix-soon issues have concrete runtime or test closure, and the only new finding I found is a non-blocking briefing nit. `v0.16.0-alpha.0` can be tagged from `21f8b6e` after Ozzy's explicit push/tag approval. I did not independently run the temp-dir C16/C17 tests because this read-only sandbox blocks `mkdtemp`; the source-level e2e construction is the right proof and would fail on the R1 no-op path.
