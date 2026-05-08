# Briefing — M15 Phase 2 production fire-path wiring (R2)

**Brief date:** 2026-05-08
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule (R1 closure verification before tag)
**Branch under review:** `feat/m15-debate-scheduler` at HEAD `5c60f7b`
**Base:** `38f2c10` (R1 review SHA — Phase 1 closure)

## What you're reviewing

Your R1 verdict (`docs/research/CODEX_REVIEW_M15.md`, thread `019e092f`) was `fix-first` with 5 block-push and 4 fix-soon findings on `38f2c10`. The central problem you flagged: production `auto` mode silently no-opped because the call sites at `src/phases/review.ts:949` (single) and `:2066` (panel) passed no `firePathExecutor`, so a `decision.fire === true` decision returned `fired: false` after only emitting `debate_scheduler_evaluated`. Rule-21 was provable only on hand-authored fixtures.

The replan round (`docs/research/CODEX_RESPONSE_M15_REPLAN.md`, thread `019e093d`) returned `accept-with-modifications` on Path B: reshape M15 to include full production wiring; tag once at the end. C12-C19 land that wiring + close every R1 finding except verify-the-end-to-end-trace (C17, deferred when it was first cut). C17 closed in this session.

Nine commits since `38f2c10`, listed newest-first per `git log --oneline 38f2c10..HEAD`:

```
5c60f7b test(e2e/review): production fire-path executor proven end-to-end (M15 C17)
7e2eb44 docs(contracts,design): drop BUILD-family-exclusion + correct premature M15 closure (M15 C19)
9f2f957 feat(phases/review): scheduler-resume mismatch detection (M15 C18)
db7f826 feat(commands/doctor): rule-21 reducer counts every fire in denominator (M15 C16)
d5a1fe3 feat(phases/review): fingerprint+severity finding diff for post-debate scalars (M15 C15)
1de8a3c feat(phases/review): wire production fire-path executor for panel-mode REVIEW (M15 C14)
d4874ce feat(phases/review): wire production fire-path executor for single-mode REVIEW (M15 C13b)
9d207c9 feat(phases/review-scheduler-hook): emit fired before requestDebate via emitFired callback (M15 C13a)
442c4c8 refactor(phases/review): extract runReviewRoundLocked + finalizeReviewRound (M15 C12)
```

Implementation order is reverse: 442c4c8 (factor) → 9d207c9 (event ordering) → d4874ce (single wire) → 1de8a3c (panel wire) → d5a1fe3 (fingerprint diff) → db7f826 (reducer denominator) → 9f2f957 (resume detection) → 7e2eb44 (doc drift) → 5c60f7b (production e2e).

## Verification at HEAD

- `bun test` — **2706 pass / 0 fail / 1 skip** (live xAI gated). Net delta vs `38f2c10`: +71 tests covering the production fire path + reducer denominator change + resume detection + production-trace e2e.
- `bun run typecheck` — clean.
- Local `bun run dev doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` — exits 0; `passedRuleTwentyOne: true` (canonical fixture set still passes after C16 reducer denominator fix).
- Local `bun run dev doctor --debate-policy` — runs without error.

(If your sandbox blocks `mkdtemp` — your R1 environment did — the C16 + C17 specific tests can be exercised under `bun test tests/commands-doctor-debate-baseline.test.ts tests/e2e/debate-scheduler-production-baseline.test.ts` after granting `os.tmpdir()` write. Or take the assertions on faith and audit the diffs.)

## Verdict format

Return one of: `push` | `fix-first` | `debate-required`. Format your response as `docs/research/CODEX_REVIEW_M15_R2.md` (mirror the R1 review file). The branch tags `v0.16.0-alpha.0` only on `push`.

## Required reading

1. `docs/research/CODEX_REVIEW_M15.md` — your R1 verdict (your prior context; the 5 block-push + 4 fix-soon list; the "Argument for shipping anyway" you rejected)
2. `docs/research/CODEX_RESPONSE_M15_REPLAN.md` — your replan verdict (`accept-with-modifications` on Path B; A1 BUILD-family-exclusion drop; the C12-C19 commit sequence acceptance)
3. `docs/design/SESSION_M15_PHASE2_KICKOFF.md` — the locked Phase 2 plan we executed (commit table; locked design decisions; verification gate before tag)
4. `docs/contracts/DEBATE_POLICY.md` — the contract surface; § "Failure surface" (executor result mapping), § "Resume semantics" (the three crash points C18 detects), § "Opponent-family invariant" (the A1 replacement language)

## Required code reading (load-bearing paths, by R1 finding)

Sample selectively. The load-bearing paths grouped by which R1 finding they close:

### Closure of R1 #1 (block-push) — production single-mode auto-fire

- `src/phases/review.ts:1178-1419` (commit `d4874ce`) — production fire-path executor closure inside `runReviewRoundLocked` step 14b. 7-step sequence: select opponent (M11 + cross-family), build topic + briefing + manifest, emit `fired` (C13a), call `requestDebate`, drain runner, read DECISION.md, recursive `runReviewRoundLocked('disabled_post_debate')`, swap outcome.
- `src/phases/review-fire-path.ts` (new helper module, commit `d4874ce`) — pure helpers extracted from review.ts: `selectEligibleOpponent`, `buildDebateTopicForReview`, `buildDebateBriefingSections`, `mapProviderErrorToFireResult`, `buildSchedulerPreflightInputForSingle`. 39 helper unit tests in `tests/review-fire-path-helpers.test.ts`.
- `src/phases/review.ts:591` — `RunReviewRoundLockedOptions.schedulerEnabled: 'enabled' | 'disabled_post_debate'` flag prevents recursive scheduler fire from the post-debate round (Codex replan Risk #5 closure).
- `src/phases/review.ts:1027-1031` — `validateFindingPaths` is called BEFORE the scheduler hook so a malformed pre-debate persona response cannot reach the fire path.

### Closure of R1 #2 (block-push) — aggregate budget preflight wired

- `src/phases/review.ts:1186-1192` (single mode, commit `d4874ce`) and `:2747-2753` (panel mode, commit `1de8a3c`) — `aggregateDebateSchedulerPreflight` is called BEFORE `runReviewSchedulerHook`; its `wouldTip` + `tipReason` flow into the hook so `budget_exhausted` skip fires correctly when the full transaction would tip a `budgets.global` cap.
- `src/phases/review-fire-path.ts:437-471` — `buildSchedulerPreflightInputForSingle` and `buildSchedulerPreflightInputForPanel` author the preflight input shape with conservative per-turn token estimates; per-call `assertWithinBudget` chokepoints stay as the per-call backstop.

### Closure of R1 #3 (block-push) — production trace feeds rule-21

- `tests/e2e/debate-scheduler-production-baseline.test.ts` (commit `5c60f7b`, **THIS SESSION**) — full DEFINE → PLAN → BUILD → VERIFY → REVIEW(round 1) e2e using `buildProviderRegistry({ providerOverride: 'fake' })`. The pre-debate persona lands grey-zone score=5 + verdict='needs-revision' → auto-mode scheduler fires; the post-debate persona (dispatched off the locked composed-prompt phrase `### Cross-family debate evidence (DECISION.md)`) lands score=8 + verdict='ready' with one new fix-first finding marked resolved this round. Stage 1 verifies the production-emitted events; Stage 2 wraps the real `events.jsonl` in a synthetic `FixtureRecord` with `oracle={verdict:'ready'}` and feeds it to `computeDebatePolicyBaseline`. Asserts `firedCount=1`, `correctiveCount=1`, `newActionableCount=1`, `passedRuleTwentyOne=true`. Test FAILS on `38f2c10` (no `debate_scheduler_fired` ever emitted).
- The hand-authored `tests/fixtures/debate-scheduler-baseline/*` fixtures stay as metric-definition unit tests, per your R1 recommendation. They prove the reducer math; the new e2e proves the production path emits the events the reducer reads.

### Closure of R1 #4 (block-push) — denominator counts every fire

- `src/commands/doctor-debate-baseline.ts:328-369` (commit `db7f826`) — `collectFires` now returns a discriminated `JoinedFire` union (`success` joined to postreview by decisionId | `error` joined to error by decisionId | `missing` no terminal). Every `debate_scheduler_fired` increments `firedCount`. `errorCount` and `missingTerminalCount` surface in `BaselineComputation` and `BaselineReport`.
- `src/commands/doctor-debate-baseline.ts:226-227` — `correctiveDeltaRate = correctiveCount / firedCount` and `newActionableFindingRate = newActionableCount / firedCount`. Worked example: 99 errored fires + 1 corrective fire now reports a 1% rate (was 100% under the old reducer).
- `tests/commands-doctor-debate-baseline.test.ts` — three new assertions for the corrected denominator + the locked "fires without postreview are dropped" assertion at `:327` was reversed.

### Closure of R1 #5 (block-push) — production fingerprint+severity diff

- `src/phases/review-fire-path.ts:243-323` (commit `d5a1fe3`) — `diffFindingsForPostDebate` is the production diff function. Same definition as the contract: `findingsAddedCount` = post fingerprints not in pre; `actionableFindingsAddedCount` = new fingerprints with severity in `{block, fix-first}` OR re-used fingerprints whose severity escalated from nit/fyi to actionable.
- `src/phases/review.ts:1358-1361` — single-mode executor calls `diffFindingsForPostDebate(preDebateFindings, postRound.canonical.findings)` and surfaces the result to the hook. The `debate_scheduler_postreview` scalars are now production-derived from the canonical `REVIEW.md` content, not fixture-authored. The C17 e2e proves this end-to-end.

### Closure of R1 #6 (fix-soon) — fired-before-debate-started ordering

- `src/phases/review-scheduler-hook.ts:188-194,457-516` (commit `9d207c9`) — `runFirePath` accepts an `emitFired` callback (synthesized from the run's `EventLogPaths`). The executor MUST call `emitFired` after selecting opposing provider + topic and BEFORE invoking `requestDebate`. The hook's contract-violation check at `:516` raises if the executor calls `requestDebate` before `emitFired`.
- The C17 e2e asserts the production trace order: `firedIdx < startedIdx` after reading `events.jsonl` (commit `5c60f7b`). Resume contract honored.

### Closure of R1 #7 (fix-soon) — A1 BUILD-family-exclusion clause drop

- `src/phases/review-fire-path.ts:79-110` (commit `d4874ce`) — `selectEligibleOpponent` filters reviewer's `opposingProviders` by (a) M11 capability eligibility for 'review' AND (b) cross-family vs the reviewer's own family. **Does NOT filter by BUILD family.** The runtime invariant is caller-family != opposing-provider-family; rule 2 has already enforced BUILD vs REVIEW cross-family at the gate, so debate opponent only needs to differ from REVIEW family.
- `docs/contracts/DEBATE_POLICY.md` § "Opponent-family invariant" (commit `7e2eb44`) — the locked replacement language pinned in Phase 2 kickoff. M15 does NOT require opposing != BUILD family; the bundled reviewer intentionally allows a BUILD-family opponent so the BUILD-favorable side has a steel-manning voice.
- `docs/design/SESSION_M15_IMPL_KICKOFF.md` — BUILD-family-exclusion clause dropped (commit `7e2eb44`).
- `tests/agents-reviewer-debate-permission.test.ts` — first-line comment text drift fixed (`['claude', 'gemini']` → `['claude']`) to match the assertion on the same file.

### Closure of R1 #8 (fix-soon) — scheduler-resume mismatch detection

- `src/phases/review-fire-path.ts:577-742` (commit `9f2f957`) — `detectSchedulerResumeMismatch` scans events.jsonl for the three crash points named in `DEBATE_POLICY.md` § "Resume semantics": `evaluated_no_terminal`, `fired_no_debate_started`, `debate_resolved_no_postreview`. Returns a typed `SchedulerResumeMismatch` or null.
- `src/phases/review.ts` (resume entry, commit `9f2f957`) — `runReviewRoundLocked` runs `detectSchedulerResumeMismatch` immediately after the existing `probeReviewResume`, only for `schedulerEnabled === 'enabled'` rounds. On detection, halts with `NEEDS_INTERVENTION` carrying one of three new typed codes (`debate_scheduler_resume_evaluated_no_terminal`, `debate_scheduler_resume_fired_no_debate_started`, `debate_scheduler_resume_debate_resolved_no_postreview`) plus actionable suggestions.
- `tests/phases-review-resume-mismatch.test.ts` — 9 new tests covering all three crash points + the no-mismatch happy path.

### Closure of R1 #9 (fix-soon) — lock-collision proof on real production path

- `src/phases/review.ts` (commit `442c4c8`) — `runReviewRoundLocked` is now a private function the public `runReview` invokes inside its `.review.lock` envelope; the recursive post-debate round invokes `runReviewRoundLocked` directly (NOT `runReview`) so the outer lock is never re-acquired. Codex R0 Risk #4 closure realized in code, not just claimed in a mock-executor test.
- The C17 e2e exercises this end-to-end: the real production trace shows two `review_round_completed` events for round 1 (pre-debate + post-debate) inside one outer `runReview` call. If the recursive call re-acquired the lock, it would deadlock; the e2e completes in ~230ms.

### Doc drift closure

- `docs/contracts/DEBATE_POLICY.md` (commit `7e2eb44`) — A1 replacement language for opponent-family invariant.
- `docs/design/SESSION_M15_IMPL_KICKOFF.md` (commit `7e2eb44`) — BUILD-family-exclusion clause dropped.
- `docs/design/ROADMAP.md` (commit `7e2eb44`) — M15 closure claim downgraded to "Phase 2 in flight, tag pending Codex R2."

## What you must verify

For each of the 9 R1 findings (5 block-push + 4 fix-soon), verify the closure SHA above honors the recommendation. Reasonable line-by-line cross-checks:

1. R1 #1: walk `runReviewRoundLocked` step 14b (lines 1178-1419). Does the executor closure call `requestDebate` directly (not `runReview`)? Does the post-debate round invoke `runReviewRoundLocked` (not `runReview`)? Does `schedulerEnabled` propagate as `'disabled_post_debate'` in the recursive call? Is the post-debate `outcome` swapped before `finalizeReviewRound` reads it?
2. R1 #2: at `review.ts:1186-1192` (single) and `:2747-2753` (panel), is `aggregateDebateSchedulerPreflight` called with the events list resolved BEFORE the scheduler hook runs? Does `wouldTip` flow into the hook? Is the per-call `assertWithinBudget` still in place as the backstop (per the helpers' kickoff Decision; not refactored)?
3. R1 #3: in `tests/e2e/debate-scheduler-production-baseline.test.ts`, is the test using `buildProviderRegistry({ providerOverride: 'fake' })` (production registry constructor with a knob, not a hand-built FakeProvider)? Does the post-debate persona shim dispatch off the locked composed-prompt phrase from `src/phases/review.ts:2376`? Does Stage 2 feed the real events.jsonl to `computeDebatePolicyBaseline`, not a fixture file?
4. R1 #4: in `src/commands/doctor-debate-baseline.ts:328-369`, does `collectFires` return every `debate_scheduler_fired` (not just those joined to postreview)? Does the `JoinedFire` discriminator make the three states impossible to confuse? Are `errorCount` + `missingTerminalCount` surfaced in `BaselineReport`? Does the worked-example test prove 99-errored-1-corrective reports 1%, not 100%?
5. R1 #5: walk `diffFindingsForPostDebate`. Does the severity-rank table match the contract? Does the test cover the escalation path (re-used fingerprint + severity escalation = actionable, NOT findingsAdded)? Does the C17 e2e prove the scalar is production-derived?
6. R1 #6: in `runFirePath`, is `emitFired` called by the executor BEFORE `requestDebate`? Does the C17 e2e assert `firedIdx < startedIdx` on the real trace?
7. R1 #7: does `selectEligibleOpponent` filter by M11 + cross-family-vs-reviewer-only (NOT BUILD family)? Is the `DEBATE_POLICY.md` § "Opponent-family invariant" replacement language present? Does the test-comment drift in `tests/agents-reviewer-debate-permission.test.ts` first-line comment now match the `['claude']` assertion?
8. R1 #8: does `detectSchedulerResumeMismatch` cover all three crash points named in the contract? Does the resume entry in `runReviewRoundLocked` call it BEFORE the round body runs? Are the typed `NEEDS_INTERVENTION` codes carried with actionable suggestions?
9. R1 #9: is `runReview` -> `runReviewRoundLocked` the only lock-acquiring path? Does the recursive post-debate call invoke `runReviewRoundLocked` directly without re-entering `runReview`? Does the C17 e2e prove no deadlock end-to-end?

## What I want from you

1. **Verdict** (`push` | `fix-first` | `debate-required`).
2. **Per-finding closure verification** — for each R1 finding, mark `closed` | `fix-first` | `still-open` with a one-paragraph rationale and load-bearing line numbers. If you find a remaining R1 issue, name it; if you find a NEW issue, file it (`block-push` | `fix-first` | `fix-soon` | `nit`).
3. **Sanity check on the C17 e2e** specifically — does the test prove what it claims to prove? Failure ground: it should FAIL on `38f2c10` because `debate_scheduler_fired` would never appear (the executor was a no-op). Argue or accept.
4. **Any concerns about Phase 2 authority creep** (rule 20). Phase 2 was reshaped from "telemetry-only milestone" to "telemetry + production wiring + resume detection." Is that one authority boundary or several? My read: it's still "orchestrator-side automatic-trigger policy" — the scheduler is the authority; the production wiring is what makes the authority real. Push back if you disagree.
5. **Tag readiness.** The branch tags `v0.16.0-alpha.0` only on `push`. State whether anything else needs to land before tag.

## Defer to post-M15 (out of scope for R2)

- Path C / M15.5 (rejected during replan)
- A2 BUILD-family-exclusion (unworkable until non-codex-non-claude bundled opponent exists)
- A3 persona-configurable BUILD-family exclusion (M16+)
- Panel corrective-delta oracle semantics (panel `verdictPre/Post='panel'` is not oracle-comparable in v0.1)
- Broad auto-resume UX (C18 ships minimal halt + intervention; resume-aware orchestration deferred)
- Cost/latency floors as ship gates
- Advisory-block triggers, verdict-confidence triggers, pre-VERIFY scheduling, scheduler persona, multi-opponent debate
