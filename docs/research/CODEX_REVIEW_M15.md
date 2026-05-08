# Codex implementation review - M15

Verdict: `fix-first`
Thread: `codex-m15-debate-scheduler-r1-2026-05-08-gpt55-xhigh` (`019e092f-c727-7442-ac18-fb6f57527f82`)
Model: `gpt-5.5`
Sandbox: read-only, approval policy never
Reviewed branch: `feat/m15-debate-scheduler` at `38f2c10`
Base: `f7aca73`
Date: 2026-05-08

## Verdict

`fix-first`

M15 is not ready to tag. The pure scheduler predicate, config surface, event schemas, and much of the unit-level policy coverage are in good shape, but the branch does not yet ship a production automatic debate scheduler. In production REVIEW, auto-mode can decide `fire: true`, but the call sites pass no `firePathExecutor`; the hook records only `debate_scheduler_evaluated` and returns `fireOutcome.fired: false`. The branch also adds aggregate budget preflight as a helper and hook option, but never calls it from production.

Argument for shipping anyway: default mode is still `manual`, the hook is non-invasive, and the contract now says `debate_scheduler_fired` occurs only when an executor is wired. That makes the current branch safer than a half-wired cost-incurring path.

I do not think that is honest enough for M15. The milestone authority boundary is "orchestrator-side automatic-trigger policy + measurable risk metric"; the ROADMAP row says M15 is closed; the kickoff acceptance gate requires the baseline to prove scheduler-on risk reduction; and the R0 lock-collision risk asked for a real fire path that does not re-acquire `.review.lock`. Current HEAD ships a telemetry-only evaluator plus hand-authored metric fixtures. That is a useful intermediate state, but not the milestone.

Validation Codex ran:

- `bun run typecheck` passed.
- `bun run dev doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` could not run in this read-only sandbox: `EPERM mkdtemp`.
- `bun test tests/policy-debate-scheduler.test.ts tests/commands-doctor-debate-baseline.test.ts` was blocked by the same read-only `mkdtemp` failure in the baseline tests. The policy tests in that combined run did pass before the command exited with the sandbox failures.

## Critical findings

### 1. block-push - Production auto-fire is a no-op

`src/phases/review.ts:949` calls `runReviewSchedulerHook` for single REVIEW mode without `firePathExecutor`. The panel call at `src/phases/review.ts:2066` does the same. In the hook, when `decision.fire === true` and no executor is passed, `src/phases/review-scheduler-hook.ts:365` returns with `fireOutcome: { fired: false, result: null }` after emitting only `debate_scheduler_evaluated`.

That behavior is not incidental. `tests/review-scheduler-fire.test.ts:479` locks the transitional path: a fire decision without executor emits evaluated only, no fired/postreview/error.

Impact: `debatePolicy.mode: auto` does not invoke `requestDebate()`, does not run a post-debate REVIEW round, does not emit `debate_scheduler_fired`, and does not change the gate result. The production behavior is "evaluate and continue," not "automatic-trigger policy."

This also means R0 Risk #4 is not closed. The branch avoids recursive `.review.lock` collision by never entering production fire path. The mock-executor tests prove the hook can accept an executor, but `src/phases/review.ts` has no factored `runReviewRoundLocked`, no `requestDebate` import, and no caller branch on `fireOutcome`.

Recommendation: wire the production executor before tag. It must call `requestDebate`, drain the runner, run the post-debate REVIEW body without re-acquiring `.review.lock`, emit `debate_scheduler_postreview` or `debate_scheduler_error`, and let REVIEW gate writes use the post-debate REVIEW result. Add a production REVIEW test, not only a hook test.

### 2. block-push - Aggregate budget preflight is not wired into production

`src/providers/cost.ts:839` adds `aggregateDebateSchedulerPreflight`, with projected cost for opposing turn + synthesis turn + post-debate REVIEW. The hook accepts `aggregatePreflightWouldTip` at `src/phases/review-scheduler-hook.ts:193`, but defaults to false at `src/phases/review-scheduler-hook.ts:292`.

There is no production caller. `rg aggregateDebateSchedulerPreflight src tests` shows only `src/providers/cost.ts` and tests. The `review.ts` hook calls at `src/phases/review.ts:949` and `src/phases/review.ts:2066` pass neither `aggregatePreflightWouldTip` nor `aggregatePreflightTipReason`.

Impact: `budget_exhausted` cannot fire from real REVIEW scheduling. A run can decide `fire: true` even when the full scheduler transaction would exceed budget. Today it still no-ops because of finding #1, but once the executor is wired this becomes a rule-19 budget violation unless fixed first.

Recommendation: call `aggregateDebateSchedulerPreflight` in `review.ts` before `runReviewSchedulerHook`, using the real reviewer or panel post-review estimate, and pass its result into the hook. Add a production-level test where auto-mode would trigger but preflight causes `debate_scheduler_skipped { reason: 'budget_exhausted' }`.

### 3. block-push - The rule-21 ship gate proves fixture math, not scheduler behavior

The files named e2e do not run the code path under review. `tests/e2e/debate-scheduler-grey-zone.test.ts:15` imports `loadFixtureSet` and `runDebatePolicyBaseline`; the tests read hand-authored `control.jsonl` and `treatment.jsonl` under `tests/fixtures/debate-scheduler-baseline`. `tests/e2e/debate-scheduler-panel-disagreement.test.ts:14` does the same.

The baseline driver also only loads fixture files from disk. `src/commands/doctor-debate-baseline.ts:343` reads fixture subdirectories, parses `oracle.json`, `control.jsonl`, and `treatment.jsonl`, then computes metrics. No FakeProvider run, no `runReview`, no `requestDebate`, and no production scheduler hook output is generated by the baseline command.

Impact: the canonical fixture set can pass while production auto-mode never fires. That is exactly the current branch state. This violates the rule-21 intent in `CLAUDE.md:43` and the kickoff acceptance gate at `docs/design/SESSION_M15_IMPL_KICKOFF.md:627`.

The hand-authored anti-corrective fixture is useful as a metric-definition test. It should stay in the metric unit suite. But it is not sufficient as the milestone ship gate until there is at least one live FakeProvider-driven baseline path that proves production emits evaluated -> fired -> debate_started/debate_resolved -> postreview for the same scenario.

Recommendation: keep the offline JSONL fixture tests, but add a production fixture generator or e2e test that runs auto-mode with FakeProvider through REVIEW and then feeds the resulting events into the baseline reducer. The rule-21 gate should fail if the production path only emits `debate_scheduler_evaluated`.

### 4. block-push - Rule-21 metrics are gameable because failed fires disappear from the denominator

`src/commands/doctor-debate-baseline.ts:141` computes metrics only over `collectFires(fixture.treatmentEvents)`. `collectFires` joins `debate_scheduler_fired` to `debate_scheduler_postreview` by `decisionId`, but its own comment at `src/commands/doctor-debate-baseline.ts:244` says fires without postreview are silently dropped. The code then only pushes joined rows at `src/commands/doctor-debate-baseline.ts:266`.

The tests lock this behavior. `tests/commands-doctor-debate-baseline.test.ts:327` says "fires without postreview are dropped", and `tests/commands-doctor-debate-baseline.test.ts:349` asserts `firedCount` is `1` when there are two fired events and only one postreview.

That contradicts the contract definition. `docs/contracts/DEBATE_POLICY.md:144` says the corrective denominator is total fired count. Dropping orphaned or errored fires inflates both correctiveDeltaRate and newActionableFindingRate. A treatment with 100 fires, 99 failed postreviews, and 1 corrective postreview reports a 100 percent corrective rate instead of 1 percent.

Recommendation: make `firedCount` count every `debate_scheduler_fired`. Join postreview/error/skipped by `decisionId`, but classify missing postreview as non-corrective and non-actionable, or fail the baseline fixture as malformed. Include `debate_scheduler_error` in the reducer output so degraded/error fires are visible and cannot be hidden.

### 5. block-push - New-actionable-finding rate trusts fixture-authored scalar counts

The rule-21 metric is supposed to count new findings by fingerprint and severity `{block, fix-first}`. Current implementation counts `actionableFindingsAddedCount > 0` from `debate_scheduler_postreview` at `src/commands/doctor-debate-baseline.ts:165`. The event schema only checks that the scalar is a non-negative integer and does not exceed `findingsAddedCount` at `src/state/events.ts:1719` and `src/state/events.ts:1729`.

Because the production executor is absent, no code computes this scalar from pre/post REVIEW findings. The fixtures author it directly, for example `tests/fixtures/debate-scheduler-baseline/single-grey-zone-corrective/treatment.jsonl:3`.

Impact: the baseline proves that the reducer honors a pre-computed count. It does not prove that the scheduler can detect "new actionable findings by fingerprint", nor that nits/fyis are excluded. This is a rule-21 false-positive risk.

Recommendation: move the fingerprint/severity diff into production code that creates `debate_scheduler_postreview`, then test it against real pre/post REVIEW artifacts. The baseline reducer can consume the scalar after that, but at least one e2e fixture should prove the scalar was produced from actual findings.

## Fix-soon

### 6. fix-soon - The current executor event order would break resume semantics once wired

`runFirePath` invokes the executor first at `src/phases/review-scheduler-hook.ts:400` and only emits `debate_scheduler_fired` after the executor returns at `src/phases/review-scheduler-hook.ts:458`. A real executor would call `requestDebate()`, which emits `debate_started` at `src/tools/debate-request.ts:482` and `debate_resolved` at `src/tools/debate-request.ts:621` before the executor returns.

So the real event order would be evaluated -> debate_started -> debate_resolved -> fired -> postreview, not evaluated -> fired -> debate_started -> debate_resolved -> postreview. The resume case in `docs/contracts/DEBATE_POLICY.md:173` explicitly depends on `fired` existing before `debate_started`.

Recommendation: emit `debate_scheduler_fired` before entering the executor, or split the executor contract so provider/topic selection happens before `requestDebate()`. Then test event ordering with a fake executor that appends `debate_started` and `debate_resolved`.

### 7. fix-soon - Path A eligibility is ambiguous with the default BUILD provider

The bundled builder is `provider: claude` at `src/agents/defaults/builder.md:5`. The bundled reviewer is `provider: codex` at `src/agents/defaults/reviewer.md:5`, and M15 grants it `opposingProviders: ['claude']` at `src/agents/defaults/reviewer.md:27`.

If M15's Path A requirement is still the kickoff rule that reviewer debate opponents must differ from both the REVIEW provider and the BUILD provider, then the default product has zero eligible opponents. `docs/design/SESSION_M15_IMPL_KICKOFF.md:41` says exactly that: every entry must differ from the run's BUILD provider and from the reviewer's own provider family.

The implementation does not enforce the BUILD-family part. `runReviewSchedulerHook` only checks that the reviewer has debate permission and that the list length is non-zero at `src/phases/review-scheduler-hook.ts:233`. The M10 runtime checks caller vs opponent family at `src/tools/debate-request.ts:174`; it does not check opponent vs BUILD family.

Answer to briefing question #7: the canonical rule-21 PASS is not traceable to a BUILD provider at all. The fixtures hand-author `opposingProvider: "claude"` and do not include a `build_provider_recorded` event. Under bundled defaults, that opponent is the BUILD family. If BUILD-family exclusion is required, the current fixtures are invalid. If it is not required, update the kickoff/contract and add a test that says reviewer-codex may schedule a debate against claude even when BUILD was claude.

### 8. fix-soon - Resume semantics are contract-only for scheduler fires

`docs/contracts/DEBATE_POLICY.md:166` defines the three crash points, and `src/state/schemas.ts:317` includes `resume_after_fire_no_start`. But production `review.ts` has no code that detects evaluated-without-terminal, fired-without-start, or resolved-without-postreview for scheduler decisions. The only executable coverage is mock-executor error emission in `tests/review-scheduler-fire.test.ts:335`.

This is less severe than finding #1 because production never fires today. Once production firing is wired, this must be implemented before tag or the contract will overstate recovery.

### 9. fix-soon - The lock-collision test does not prove the production invariant it names

`tests/review-scheduler-fire.test.ts:449` verifies that the hook plus mock executor do not create a `.review.lock` directory. That does not prove that a real post-debate REVIEW round runs under the outer `runReview` lock, because there is no production post-debate REVIEW round and no `runReviewRoundLocked` extraction.

The correct proof should instrument the real `runReview` path: one outer `.review.lock` acquisition, scheduler fire, `requestDebate`, post-debate review body, canonical `REVIEW.md` replacement, no second lock acquisition.

## Nits / FYIs

- R0 Risk #1 is closed in the pure predicate. Panel mode sets `score: null` and `verdict: 'panel'` in `src/phases/review-scheduler-hook.ts:270`, and `evaluateTrigger` only evaluates `panel_voter_disagreement` for panel mode at `src/policy/debate-scheduler.ts:276`. The policy tests cover panel not firing score-grey-zone at `tests/policy-debate-scheduler.test.ts:301` and advisory dissent not firing at `tests/policy-debate-scheduler.test.ts:360`.

- R0 Risk #2 is only partially closed. `src/agents/defaults/reviewer.md:27` grants `tool_use.debate`, and `src/providers/capabilities.ts:101` explains why gemini is ineligible today. But the e2e tests do not exercise the bundled reviewer path; they load hand-authored JSONL.

- R0 Risk #3 is mostly closed in schema validation. `src/state/events.ts:1590` through `src/state/events.ts:1745` validates scheduler events, and `src/state/events.ts:1876` enforces `decisionId` and `reviewRound`. The remaining gap is the reducer: it does not join evaluated -> fired/skipped -> postreview/error; it joins fired -> postreview only.

- Manifest pre-skip is correct in the pure decision path. The hook projects changed files + BUILD_REPORT + VERIFY + REVIEW at `src/phases/review-scheduler-hook.ts:255`, and the predicate skips before trigger evaluation at `src/policy/debate-scheduler.ts:249`. What is not proven is the real scheduled manifest because the fire path is absent.

- `debate_policy_baseline_completed.costOverheadAvgTokens: 0` on canonical fixtures is acceptable as offline telemetry, not as a ship-gate proof. The problem is not the zero itself; it is that these fixtures are the only rule-21 evidence.

- `tests/agents-reviewer-debate-permission.test.ts:4` still says the locked shape is `opposingProviders=['claude', 'gemini']`, while the actual assertion at `tests/agents-reviewer-debate-permission.test.ts:37` expects `['claude']`. The later inline comment explains the narrowing, so this is documentation drift inside the test.

- `git log f7aca73..HEAD` includes `ea10fb2 docs(design/m15): RALPH_M15_PROMPT.md for overnight implementation loop` in addition to the 11 implementation commits listed in the review brief. This is not a blocker, but the brief's "11 commits delivered" omits one branch commit.

- ROADMAP closure is premature. `docs/design/ROADMAP.md:380` says M15 is closed with production fire path inside the outer lock. Current code does not match that statement.

## Rule-20 commit audit

- `91c71c6 feat(state)`: single-axis schema/event work. Good shape.
- `0aedfcd feat(policy)`: single-axis pure predicate. Good shape; no verdict-confidence or panel score leakage found.
- `4b2942f feat(config)`: single-axis config surface. Default `manual` is correct at `src/config/schema.ts:214`.
- `4538c88 feat(phases/review)`: evaluate-hook slice is acceptable as a 4a intermediate, but it intentionally discards fire decisions.
- `1a31f1d feat(phases/review)`: subject overpromises. It adds an executor interface and mock tests, not a production fire path or real lock-collision fix.
- `23931fc feat(providers)`: subject overpromises "hook plumbing." The helper and hook option exist; production `review.ts` never calls it.
- `b18d55e feat(commands/doctor)`: inspector surface is scoped and read-only.
- `9df1fbd feat(commands/doctor)`: baseline command is scoped, but the metric is currently fixture-math-only and gameable.
- `94e63d4 docs(contracts/DEBATE_POLICY)`: contract is useful, but it claims production behavior that code does not implement.
- `b08b9d8 feat(agents)`: permission grant is scoped, but Path A needs the BUILD-family decision clarified.
- `38f2c10 feat(tests,docs)`: closure commit is premature; the "e2e" tests read fixture JSONL rather than running production.
- `ea10fb2 docs(design/m15)`: extra prompt doc commit is benign and outside the M15 runtime authority.

No future M16 multi-opponent debate, Researcher tail, pre-VERIFY scheduling, new scheduler persona, new gate file, or `tool_use.debate.scheduler` permission scope was found.

## Positive observations

- The pure scheduler gate order is simple and testable. The panel/single split is the right shape.
- Config loading is strict and preserves default `manual`.
- Scheduler event schemas have strong correlation-field validation.
- The baseline reducer includes corrective, anti-corrective, no-signal, and per-trigger telemetry, which is the right reporting vocabulary once it is backed by real events.
- The reviewer permission grant deliberately avoids gemini while it is `eligiblePhases: []`, which is the correct M11 interpretation.
- The M10 `requestDebate()` body was not modified.

## Recommended next step

Do not tag `v0.16.0-alpha.0` from `38f2c10`.

Add a follow-up implementation commit that wires the production fire path in `src/phases/review.ts`, wires `aggregateDebateSchedulerPreflight`, emits `debate_scheduler_fired` before `requestDebate` begins, computes postreview finding deltas from real pre/post REVIEW artifacts, and handles scheduler intervention/error outcomes. Then add one FakeProvider production test that runs REVIEW auto-mode end to end and feeds its actual events into `doctor --debate-policy-baseline`.

After that, rerun:

- `bun run typecheck`
- `bun test tests/policy-debate-scheduler.test.ts tests/review-scheduler-fire.test.ts tests/review-scheduler-postreview.test.ts tests/cost-debate-scheduler-preflight.test.ts`
- `bun test tests/e2e/debate-scheduler-grey-zone.test.ts tests/e2e/debate-scheduler-panel-disagreement.test.ts`
- `bun run dev doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline`

Re-review the follow-up SHA before closing M15.
