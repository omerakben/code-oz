# Codex planning response - M16 R0

Verdict: `feature-with-modifications`
Thread: `019e0a59-293d-7830-8809-8afb2eb0d532`
Model: gpt-5.5
Sandbox: read-only, approval policy never
Reviewed branch: feat/m16-cli-completion at 11f8195
Base: e25f3d4
Date: 2026-05-09

## Verdict

The trigger is real and the branch should proceed, but the lean is not ready to lock. The missing CLI dispatchers are only the visible failure. The deeper contract gap is that the runtime has phase-level gates but no durable task-level cursor, while real PLAN artifacts contain multiple `T-NNN` tasks. If M16 simply wires BUILD/VERIFY/REVIEW and then adds a minimal SHIP gate, `approve review` can advance the run to `ship` after T-001 while T-002/T-003 never ran. I would proceed with M16 only after adding a task-lifecycle decision and splitting SHIP/resume out of the first implementation slice.

## Q-pushbacks (Q1-Q13)

### Q1 - next pending task
Push. Auto-selecting the next task is right for UX, but the repo has no task status field in PLAN and no task cursor in state. `PLAN.md` supports multiple H3 tasks (`src/artifacts/plan.ts:14-24`, `docs/contracts/PLAN.md:60-85`), while `approveGate` advances linearly from review to ship (`src/state/machine.ts:17-23`, `src/state/schemas.ts:10-17`). Add a durable task cursor/event such as `task_started`, `task_review_passed`, `task_completed`, or explicitly reject multi-task PLANs until M17. Do not infer completion from absent/present canonical `BUILD_REPORT.md`, because that file is overwritten per task/attempt.

### Q2 - worktree creation
Accept with modification. `dispatchBuild` should create or reuse the run worktree; a separate command is unnecessary. But `createRunWorktree` is not idempotent today: it rejects an existing run path (`src/worktree/create-run-worktree.ts:53-61`) and leaves event emission to the caller (`src/worktree/create-run-worktree.ts:41-45`). M16 needs a `loadOrCreateRunWorktree` wrapper that verifies `base.txt`, emits or verifies `worktree_created`, and refuses orphaned partial dirs with actionable intervention.

### Q3 - verify attempt source
Accept with a cross-check. `BUILD_REPORT.md` is the source of truth for task and attempt (`src/phases/verify.ts:265-304`), but dispatch must also verify matching `build_completed` and `build_provider_recorded` events before invoking VERIFY. Bigger issue: `RunVerifyOptions` requires `attemptPatchContent` and `buildPromptSnapshot` (`src/phases/verify.ts:91-94`), but `runBuild` does not persist the composed prompt. M16 must make BUILD persist the exact prompt snapshot, otherwise VERIFY forensics and resume cannot be production-faithful.

### Q4 - review round resolution
Accept with stronger source-of-truth rules. Round from prior `REVIEW.md` is fine only after checking it matches the current `taskId`, attempt, and latest `review_round_completed` sha. If the prior review was `needs-revision`, use the remediation decision's `nextReviewRound` instead of recomputing from canonical `REVIEW.md` alone (`src/phases/review-remediation.ts:175-180`).

### Q5 - debate scheduler output
Accept as non-blocking. Print a compact scheduler summary when M15 auto-mode fires, but do not make table rendering load-bearing for M16. Events are already durable. A verbose `doctor run` view is the better place for full scheduler traces.

### Q6 - runShip v0.1 checks
Push. The lean conflicts with current contracts. `CANONICAL_ARTIFACTS.ship` is `SHIP.md` (`src/state/schemas.ts:31-39`), and terminal `run_ended` is emitted by approve-time transition only after a terminal gate (`src/state/run.ts:878-907`). A phase runtime writing `GATE_SHIP_PASSED.json` directly violates the explicit approve pattern. Minimal SHIP should write a small `SHIP.md`, call `requireGate('ship')`, then `approve ship` should validate and let `approveGate` end the run. Also, SHIP must prove every PLAN task completed, not merely that one REVIEW gate exists.

### Q7 - resume on intervention
Accept with path correction. Intervention should dominate resume. The file lives under `.code-oz/state/runs/<runId>/NEEDS_INTERVENTION.json`, not `.code-oz/runs/<runId>/...`, and telling users to `git rm` is wrong for local ignored state. M16 can say "remove only after manual resolution" and defer `code-oz intervention resolve`.

### Q8 - run vs resume
Push. Keep `resume` as an explicit command, but `run` still must be phase-aware. The dogfood failure happened because the normal next gesture after `approve plan` is `code-oz run`, and `run.ts` only dispatches PLAN (`src/commands/run.ts:484-497`). `resume` should handle partial/in-flight detection. `run` should start the next unstarted phase when no phase-start event exists.

### Q9 - brownfield AUDIT
Accept. AUDIT has no runtime and should be out of scope. The M16 CLI should still reject `currentPhase: audit` with a precise "AUDIT runtime not implemented" message, not the generic in-progress message.

### Q10 - test coverage
Push. C7 should come earlier as a failing skeleton, because it defines the missing product proof. But `--provider fake` alone cannot drive a spawned multi-command CLI e2e: every subprocess gets a fresh FakeProvider, and current CLI only pre-scripts BA turns from `--request-file` (`src/commands/run.ts:115-128`). Add a durable fake replay fixture or test-only script file before relying on full-cycle binary tests.

### Q11 - milestone name
Accept. M16 is the right label for the measurable need exposed by Ring 2 dogfood. Do not call it M15.5.

### Q12 - tag split
Push. A single `v0.17.0-alpha.0` tag is too much if it includes task cursor, production seams, BUILD/VERIFY/REVIEW dispatch, SHIP, and resume. Tag M16 after production dispatch through REVIEW is proven against the real CLI. Put SHIP and full resume in M17 unless the plan is narrowed aggressively.

### Q13 - deferrals
Accept with additions. Defer AUDIT, TUI, intervention-resolve, distribution, SHIP packager, and brownfield. Also defer fancy streaming UI, but not basic progress lines. Do not defer task cursor or fake CLI replay if the acceptance target remains real greenfield dogfood.

## Risks

### Risk 1 - no task lifecycle cursor
The lean assumes "next pending task," but PLAN task completion is not a durable state. The state machine advances `define -> plan -> build -> verify -> review -> ship` (`src/state/schemas.ts:10-17`), and `approveGate` moves REVIEW approval directly into SHIP (`src/state/run.ts:878-891`). The dogfood PLAN has T-001, T-002, and T-003, so SHIP could become true after only T-001 unless M16 adds task-level state.

### Risk 2 - SHIP bypasses the gate architecture
C5 says `runShip` writes `GATE_SHIP_PASSED.json` directly. Existing phases write artifacts and `gate_required`; approval writes gates and transition events (`src/state/run.ts:350-403`, `src/state/run.ts:843-907`). If SHIP is in M16, it needs `SHIP.md`, `requireGate('ship')`, `preApproveShipHook`, and then `approve ship`.

### Risk 3 - fake CLI e2e cannot be scripted across processes
`buildProviderRegistry({ providerOverride: 'fake' })` returns a new shared fake per process (`src/cli/bootstrap.ts:159-170`). Full-cycle CLI tests that spawn `bun run src/cli.ts` cannot preload BUILD/VERIFY/REVIEW expectations unless M16 adds a durable fake script fixture. Without that, C7 either becomes direct-import testing again or fails with generic fake responses.

### Risk 4 - BUILD prompt snapshot is not durable
VERIFY requires the build prompt snapshot for failed-attempt forensics (`src/phases/verify.ts:91-94`, `src/phases/verify.ts:539-555`). `runBuild` composes the prompt and invokes the persona (`src/phases/build.ts:383-397`) but does not persist the prompt. Production dispatch cannot reconstruct the exact bytes after a process crash or resume.

### Risk 5 - concurrent `code-oz run` can double-invoke phases
`runReview` has a dedicated long-running lock because the per-run event lock must not be held across provider calls (`src/phases/review.ts:522-537`). BUILD and VERIFY do not have equivalent phase orchestration locks. Two shells can both see `currentPhase: build` and both invoke the builder unless dispatch adds `build.lock` and `verify.lock` or a shared phase-in-flight claim.

### Risk 6 - approve build remains under-validated
`approve.ts` has explicit pre-approval validation for DEFINE, VERIFY, and REVIEW (`src/commands/approve.ts:193-250`), but not BUILD. Since BUILD_REPORT.md is user-editable before approval, M16 should add `preApproveBuildHook` to parse `BUILD_REPORT.md`, confirm `build_completed` sha, and reject stale/malformed edits before VERIFY consumes them.

### Risk 7 - validation runner budget and output semantics are undefined
Provider budget enforcement lives in `invokeAgent` (`src/providers/invoke.ts:114-180`), but VERIFY's validation command runs through `RunnerSeam` (`src/phases/verify-mutation.ts:199-210`). `productionRunner` must define timeout killing, stdout/stderr truncation, log paths, and whether validation wall time counts against run-level wall-time budgets.

### Risk 8 - exit code semantics need a contract
M16 should lock exit codes before tests: `0` when a phase completes and awaits approval, `1` for intervention/blocked/needs operator action, `2` for CLI usage/config errors. `needs_revision` is especially important: it may be an expected REVIEW result, but it should not look like a successful gate-ready phase.

### Risk 9 - `--provider fake` can contaminate real runs
`--provider fake` is a real runtime override today (`src/commands/run.ts:283-289`, `src/cli/bootstrap.ts:125-170`). If production BUILD/VERIFY/REVIEW accept it without loud labeling, users can generate fake BUILD_REPORT/VERIFY/REVIEW artifacts in real projects. Keep it, but print and record an unmistakable fake-provider warning.

## Single-axis-commit shape critique

C1 is right, but it should include production seam contracts plus test-only fake replay only if kept small; otherwise split fake replay into C0. C2/C3/C4 should remain separate phase-dispatch commits. C7 should move earlier as a red/green CLI proof, not after all dispatchers are written. C5 as written violates rule 20 and the approve pattern: SHIP runtime plus dispatcher plus direct gate write is a new terminal authority and should move to M17. C6 full resume also deserves M17 unless reduced to a thin read-only/intervention-aware wrapper around existing dispatchers. Add a new early commit for task cursor or explicitly reject multi-task PLANs.

## The thing the lean misses

The lean misses that "production CLI completion" is not just phase dispatch. It is task scheduling. The product promises PLAN tasks, BUILD implements one atomic task, and real dogfood generated three tasks. Without a durable task cursor and a rule for looping BUILD→VERIFY→REVIEW per task, M16 can make the CLI appear complete while silently shipping only the first task.

## Should code-oz doctor run be in M16?

Yes, but only as a minimal read-only inspector. It is not a new authority boundary if it only reads `active.json`, `current.json`, gates, events, task cursor, intervention state, and worktree existence. It is useful before `resume` lands because it gives the operator a safe command that cannot double-charge providers. Defer TUI, repair, tailing, and intervention resolution to W2/M17.

## Tag boundary

Argument for one milestone: the user-visible bug is one bug, "the CLI front door stops after PLAN." BUILD/VERIFY/REVIEW runtimes already exist, so wiring them into `run.ts` is mostly exposing existing authority. A single M16 tag would let Ring 2 dogfood finish and avoid release-accounting churn.

Argument for split: the lean actually bundles at least three authorities: production dispatch, terminal SHIP, and resume-from-state. The task cursor blind spot adds a fourth if multi-task PLANs are supported. Rule 20 exists to prevent exactly this kind of convergence bundle.

Recommendation: split. M16 should ship production BUILD/VERIFY/REVIEW dispatch, task cursor, phase locks, fake CLI replay, and a minimal `doctor run`, proven by a CLI e2e that reaches "all PLAN tasks reviewed, currentPhase=ship." M17 should ship SHIP.md + `runShip` + `approve ship` + full `code-oz resume` semantics and then tag the first true DEFINE→SHIP flow.

## Recommended changes before kickoff lock

- Add a C0 decision: durable task cursor/events, or explicit one-task-only rejection. I recommend durable task cursor because the dogfood PLAN is multi-task.
- Move C7 earlier and add a cross-process fake replay fixture; `--provider fake` alone is insufficient for spawned CLI tests.
- Add `preApproveBuildHook` and later `preApproveShipHook`.
- Change C5 so SHIP writes `SHIP.md` and `gate_required(ship)`, not `GATE_SHIP_PASSED.json` directly.
- Persist BUILD prompt snapshots during BUILD and read them during VERIFY.
- Add long-running phase locks for BUILD and VERIFY before production provider calls.
- Define CLI exit codes and minimal progress output before implementation.
- Split M16/M17: M16 for BUILD/VERIFY/REVIEW CLI dispatch plus task cursor; M17 for SHIP and full resume.
- Include minimal `code-oz doctor run` in M16 as read-only state inspection.
