# Response - M15 Phase 3 replan

**Thread:** `019e093d-0ede-7b72-a789-649f136c4472`
**Codex self-assigned label:** `codex-m15-replan-2026-05-08-gpt55-xhigh`
**Date:** 2026-05-08
**Model:** gpt-5.5 xhigh
**Sandbox:** read-only
**Approval:** never
**Branch:** `feat/m15-debate-scheduler` at `38f2c10`
**Brief:** `docs/research/CODEX_BRIEFING_M15_REPLAN.md`

---

## Verdict on the decisions

Overall verdict: accept-with-modifications.

Q1: accept Path B. Path A is too clever for a milestone whose roadmap and kickoff already claim production automatic scheduling. Path C is cleaner accounting than A, but still tags a rule-21 claim before real scheduler events exist. Path B is the honest close: current `38f2c10` is Phase 1 predicate/telemetry work; M15 should not tag until production fire-path wiring exists and is proven.

Rule 20 still holds if the implementation stays inside this boundary: "orchestrator-side automatic-trigger policy for existing single-opponent `requestDebate()`." CLAUDE.md says M15 is "Debate-policy scheduler v1 (single-opponent only)" and M16+ owns Researcher, parallel builders, and multi-opponent debate (`CLAUDE.md:42-43`). Wiring the fire path is not a second authority boundary. It makes the already-claimed M15 authority real. It must not add new triggers, a scheduler persona, a new permission scope, a new gate file, or multi-opponent debate.

The C12-C19 sketch is the right ballpark, but I would tighten it:

- C12 should extract a lock-free review round body and separate final gate handling. The extracted body should write/parse REVIEW.md and emit the round event, but not write `review_resolved`, `review_blocked`, gate-required, remediation, or scientist-tail terminal effects until the scheduler decision is settled.
- C13 should be split unless the patch stays small: first fix the fire-path contract so `debate_scheduler_fired` can be emitted before `requestDebate()`, then wire single-mode production. Current `runFirePath` invokes the executor at `src/phases/review-scheduler-hook.ts:400-419` and only emits `debate_scheduler_fired` at `src/phases/review-scheduler-hook.ts:455-473`, which is still the bad ordering once the executor calls `requestDebate()`.
- C14 panel production wiring is valid, but should reuse the same executor path. Do not build a second panel-only scheduler.
- C15 fingerprint/severity diff belongs before the live e2e. The postreview scalar cannot remain fixture-authored; the event schema only validates non-negative counts (`src/state/events.ts:1719-1734`).
- C16 reducer fix is necessary, but reversing assertions at `tests/commands-doctor-debate-baseline.test.ts:327,349` is not enough. The reducer currently collects only joined `fired -> postreview` rows (`src/commands/doctor-debate-baseline.ts:141`, `src/commands/doctor-debate-baseline.ts:244-270`), contradicting the contract denominator at `docs/contracts/DEBATE_POLICY.md:144-150`.
- C17 is the right proof target only if it generates events from the real `runReview` and real `requestDebate` path. Reading hand-authored fixture JSONL again would not satisfy rule 21.
- C18 resume detection is not optional after production fire wiring. It can be minimal and conservative, but the contract already names crash states at `docs/contracts/DEBATE_POLICY.md:166-176`.
- C19 should be last, after verification. The ROADMAP row is currently premature because it says M15 is closed with production fire path inside the outer lock (`docs/design/ROADMAP.md:380`), while production calls still omit `firePathExecutor` at `src/phases/review.ts:949` and `src/phases/review.ts:2066`.

Q2: accept A1, with replacement language. Drop the BUILD-family-exclusion clause. Rule 2 already enforces BUILD vs REVIEW cross-family at the REVIEW gate (`CLAUDE.md:24`), and `requestDebate()` correctly enforces caller vs opponent family (`src/tools/debate-request.ts:174-188`). The debate is challenging the REVIEW verdict, not certifying BUILD. Opponent != REVIEW family is the load-bearing invariant.

A2 is unworkable in v0.1. The bundled builder is `provider: claude` (`src/agents/defaults/builder.md:5`), reviewer is `provider: codex` (`src/agents/defaults/reviewer.md:5`), reviewer currently declares `opposingProviders: ['claude']` (`src/agents/defaults/reviewer.md:27-28`), and Gemini is explicitly `eligiblePhases: NO_PHASES` (`src/providers/capabilities.ts:101-104`). XAI is real but API-keyed, so it cannot be the bundled canonical baseline.

Replacement DEBATE_POLICY language:

```md
Scheduler-fired debate uses the existing M10 `tool_use.debate` permission and `requestDebate()` runtime checks. The runtime invariant is caller-family != opposing-provider-family. M15 does not require the opposing provider to differ from the original BUILD provider family, because REVIEW has already enforced BUILD-family != REVIEW-family before the scheduler can run. A reviewer persona may choose to exclude BUILD-family opponents for stricter independence, but the bundled reviewer intentionally allows a BUILD-family opponent to steelman the BUILD-favorable side. REVIEW remains the gate authority; debate output is evidence for a post-debate REVIEW round, not a gate decision.
```

Q3: prefer the factored shape. `runReview()` acquires `.review.lock` at `src/phases/review.ts:448-471`; the scheduler hook currently runs inside the locked review body before terminal branching (`src/phases/review.ts:942-968`). A private `runReviewRoundLocked(opts)` gives a real test seam for the invariant R1 #9 asked for: one outer `.review.lock`, scheduler fire, real `requestDebate`, post-debate review body, canonical REVIEW.md replacement, no second lock acquisition. The current mock test only proves the hook does not create `.review.lock` (`tests/review-scheduler-fire.test.ts:449-472`).

The factored body must include a guard so the post-debate review round does not invoke the scheduler again. Otherwise a grey-zone post-debate REVIEW can recursively schedule another debate and accidentally become multi-fire debate orchestration inside M15.

Q4: no CLAUDE.md non-negotiable rule blocks Path B as long as the scope stays narrow. The rules that matter are rule 19 budgets, rule 20 authority boundary, and rule 21 measurable effect (`CLAUDE.md:41-43`). Path B can satisfy all three. Path A/C would leave rule 21 effectively conditional.

I would not defer findings #6-#9 to M16+. Once production firing is wired, #6 event ordering, #7 Path A language, #8 resume detection, and #9 real lock proof become part of the M15 correctness surface. The only deferrable part is broad automatic resume UX. Minimal detection plus safe intervention is enough for M15.

## Risks the proposing side missed

The biggest missed implementation risk is that "emit fired before `requestDebate`" is incompatible with the current executor shape. The executor currently returns `opposingProvider` and `debateTopic`, but the hook emits `debate_scheduler_fired` only after the executor returns (`src/phases/review-scheduler-hook.ts:400-473`). If the production executor calls `requestDebate()`, `debate_started` and `debate_resolved` are emitted inside that executor (`src/tools/debate-request.ts:482-499`, `src/tools/debate-request.ts:620-632`) before `debate_scheduler_fired`. Fix the contract, not just the production caller. Either split prepare/execute, or give the executor a callback that emits `fired` after provider/topic selection and before `requestDebate()`.

Second: C12 must avoid pre-debate terminal side effects. The scheduler hook sits before the ready/needs-revision/block branch in single mode (`src/phases/review.ts:942-975`) and before panel terminal branching (`src/phases/review.ts:2054-2086`). That placement is correct. The extracted body must preserve it. If the first REVIEW result writes `review_resolved`, `review_blocked`, gate-required, remediation, or scientist-tail effects before the post-debate REVIEW round, REVIEW authority becomes ambiguous.

Third: aggregate preflight must cover the worst-case transaction, not just the happy path. Rule 19 is mandatory (`CLAUDE.md:41`). The helper exists and models opposing + synthesis + post-review calls (`src/providers/cost.ts:839-851`), but production does not pass its result into the hook today (`src/phases/review.ts:949-968`, `src/phases/review.ts:2066-2084`). When wiring it, count worst-case post-review behavior: single reviewer draft plus repair allowance, panel eligible voters plus repair/synthesis behavior if applicable, and any required scientist-tail call if a terminal post-review state runs it. The per-call wrapper can still hard-kill, but the scheduler should skip before `fired` when the full transaction would predictably tip budget.

Fourth: C17 needs a stronger proof construction than "FakeProvider e2e emits the right event sequence." It must fail in the current no-op branch. The current e2e files load fixture JSONL from disk (`tests/e2e/debate-scheduler-grey-zone.test.ts:14-19`, `tests/e2e/debate-scheduler-panel-disagreement.test.ts:13-16`), and the baseline loader reads `oracle.json`, `control.jsonl`, and `treatment.jsonl` (`src/commands/doctor-debate-baseline.ts:336-365`). The replacement proof should create a temp fixture from actual events produced by `runReview` with `debatePolicy.mode='auto'`, then run the same baseline reducer against those generated events. Use `buildProviderRegistry({ providerOverride: 'fake' })`, because it preserves per-id families while routing all calls through FakeProvider (`src/cli/bootstrap.ts:125-180`).

Fifth: post-debate REVIEW must not trigger another scheduler decision. Add an explicit option such as `scheduler: 'enabled' | 'disabled_post_debate'` to the extracted round body, or keep the hook outside the extracted round body and call it only from the outer pre-debate path.

## Where I disagree

I disagree with treating C16 as mostly a test assertion reversal. The reducer design has to change. Counting only completed joined rows makes failures disappear from the denominator. The contract says denominator is total fired count (`docs/contracts/DEBATE_POLICY.md:144`, `docs/contracts/DEBATE_POLICY.md:150`); the code says fires without postreview are silently dropped (`src/commands/doctor-debate-baseline.ts:244-270`). The fixed reducer should count every `debate_scheduler_fired`, join postreview/error/missing-terminal by `decisionId`, and classify missing/error as non-corrective and non-actionable. It should also surface error/missing counts in the report so rule 21 cannot be gamed.

I also disagree with leaving the panel fixture as a rule-21 corrective proof. Panel `verdictPre='panel'` and `verdictPost='panel'` are not oracle-comparable under current reducer semantics. That is fine as telemetry and new-actionable signal, but it cannot prove corrective verdict delta. The mandatory production C17 proof should start with single REVIEW because single mode has a real verdict order and can prove corrective/anti-corrective behavior. Add panel production coverage after single mode works.

I disagree slightly with the wording "run post-debate REVIEW round under existing lock" if it implies a normal next round. The kickoff currently says the post-debate round on round 4 is still reported as round 4, not round 5 (`docs/design/SESSION_M15_IMPL_KICKOFF.md:81-86`). That is acceptable, but it means implementation must be very explicit about whether it is replacing the current round's gate result or appending a normal next REVIEW round. Do not let that emerge accidentally from control flow.

## What I would defer

Defer Path C/M15.5. It is only attractive if the user wants release accounting over product honesty, and this briefing says the user authorized a convergence round before more code lands.

Defer A2 permanently for v0.1. It depends on a bundled eligible non-codex, non-claude opponent that does not exist today.

Defer a formal A3 policy surface. Personas can still choose stricter `opposingProviders`, but the runtime and contract should not add a new configurable BUILD-family exclusion rule in M15.

Defer panel corrective-delta oracle semantics. Panel can contribute new-actionable and no-signal telemetry in M15; a real panel correctness oracle can wait.

Defer broad auto-resume UX. M15 needs detection and safe behavior for the named crash states, not a generalized resume engine for every partial scheduler transaction.

Defer cost/latency floors, advisory-block triggers, verdict-confidence triggers, pre-VERIFY scheduling, new scheduler permission scopes, scheduler persona, and multi-opponent debate.

## Recommended next step

Proceed with Path B, but rewrite the Phase 2 commit plan before coding:

1. C12: extract `runReviewRoundLocked` plus a finalization helper. No behavior change. The extracted round body must not own `.review.lock`, must not write terminal gate effects before scheduler settlement, and must support `schedulerEnabled: false` for post-debate review.
2. C13a: reshape the fire-path contract so provider/topic selection happens before `debate_scheduler_fired`, and `requestDebate()` happens after `fired`.
3. C13b: wire single-mode production executor in `review.ts`: aggregate preflight, eligible opponent selection, real manifest, real `requestDebate`, post-debate review body, real postreview event, intervention/error mapping.
4. C14: extend the same executor path to panel mode with panel-aware budget estimates and panel postreview behavior.
5. C15: compute `findingsAddedCount` and `actionableFindingsAddedCount` from real pre/post REVIEW artifacts by fingerprint and severity.
6. C16: fix the baseline reducer denominator and error/missing-terminal visibility.
7. C17: add one generated FakeProvider production baseline e2e for single mode that fails on the current no-op path, then add panel production coverage.
8. C18: implement minimal resume detection for evaluated-no-terminal, fired-no-start, and resolved-no-postreview.
9. C19: update DEBATE_POLICY, kickoff/test comments, and ROADMAP only after the above tests pass. ROADMAP must no longer claim closure before a Codex-blessed final SHA.

Then rerun typecheck, the scheduler unit suites, the new production e2e, and `doctor --debate-policy-baseline` against both generated and static fixtures before requesting the next Codex review.
