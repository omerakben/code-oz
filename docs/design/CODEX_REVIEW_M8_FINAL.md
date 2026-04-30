# Codex review - M8 final re-review

Thread: current Codex final re-review session
Prior re-review: `docs/design/CODEX_REVIEW_M8_FIX.md` on commit `d223cdb`
Date: 2026-04-30
Branch reviewed: `feat/m8-verify-lite` at `6a50be7`

## Verdict

`push`

The five named findings from `docs/design/CODEX_REVIEW_M8_FIX.md` are closed cleanly enough to ship M8. I found no new block-push or block-next-milestone issues in the `worktree_destroyed.attempt` schema change. The schema change is breaking, but it is acceptable for v0.1 per-run `events.jsonl` state: both production emitters were updated, event validation now requires the field, fixtures compile against the stricter type, and the retry-order validator now scopes all four canonical fail events by attempt.

## Findings

No block-push findings.

No block-next-milestone findings.

Non-blocking follow-ups:

1. `validateVerifyFailureEventOrder()` now filters all four canonical events by `attempt`, but still duplicate-checks only `verify_failed` and `verify_restart_initiated` at `src/phases/verify-event-order.ts:81-100`. The function contract says the canonical events appear "exactly once each" at `src/phases/verify-event-order.ts:52-56`, so M9 should either duplicate-check `worktree_forensics_preserved` and `worktree_destroyed` too, or relax that comment. This is not a push blocker because normal `scheduleAttemptNPlus1()` and `preApproveVerifyHook()` flows do not currently produce duplicate worktree events for the same attempt.
2. `docs/contracts/WORKTREE.md` still describes `worktree_destroyed` only as "`git worktree remove --force` returned zero" at `docs/contracts/WORKTREE.md:211`, without mentioning the new required `attempt` field. This is documentation drift, not a gate blocker, because the strict schema in `src/state/schemas.ts` and the M8 VERIFY contract now carry the operational detail.

## Where I agree

- bp#1 is closed. `runVerify()` emits `verify_completed` and then calls `requireGate({ phase: 'verify' })` at `src/phases/verify.ts:497-520`, matching the existing PLAN and BUILD pattern. `preApproveVerifyHook()` also writes `worktree_destroyed.attempt` from `VERIFY.md`'s BUILD ref at `src/commands/approve.ts:339-345`.
- bn-m#1 is closed. `VerifyFailed` now carries `taskId` and `attempt` at `src/phases/verify.ts:121-131`, and `scheduleAttemptNPlus1()` reads those fields directly for both restart and intervention events at `src/phases/schedule-attempt.ts:127-160`. The hardcoded `T-001` extractor is gone.
- bn-m#2 is closed. `worktree_destroyed` has required `attempt` in the schema at `src/state/schemas.ts:365-379`; `validateEvent()` enforces it at `src/state/events.ts:552-558`; `validateVerifyFailureEventOrder()` filters by `attempt` before ordering at `src/phases/verify-event-order.ts:66-79`. The new tests cover attempt 1 and attempt 2 independently.
- fix-soon #1 is closed. `invokeWithRepair()` returns rejected drafts at `src/phases/verify.ts:725-780`, and `runVerify()` writes them before recording `verify_validation_failed` at `src/phases/verify.ts:408-417` and `src/phases/verify.ts:783-794`.
- fix-soon #2 is closed. `docs/contracts/VERIFY.md` now states that the persona authors only the small structured response at `docs/contracts/VERIFY.md:13`, marks `Mutation` as orchestrator-recorded in the required-section table at `docs/contracts/VERIFY.md:65`, and explicitly says the persona may not author mutation fields at `docs/contracts/VERIFY.md:96-98`.

## Where I disagree

- I would not describe the new `tests/verify-phase.test.ts` case as a full `runApprove({ phase: 'verify' })` integration. The test asserts `gate_required(verify)`, then calls `preApproveVerifyHook()` directly at `tests/verify-phase.test.ts:572-598`. That still proves the two load-bearing pieces for the prior blocker, but a later end-to-end run-loop test should exercise `runApprove()` with `currentPhase=verify` and assert `GATE_VERIFY_PASSED.json`.
- I do not think the `worktree_destroyed.attempt` schema break needs migration work before push. v0.1 event logs are run-local state, and the current emitters plus validators are internally consistent.

## Risks Claude is not seeing

- The retry-order validator's duplicate-check asymmetry can hide a duplicated `worktree_forensics_preserved` or `worktree_destroyed` event inside the same attempt. This is a good M9 hardening target once the run-loop can actually retry.
- `ScheduleAttemptOptions.verifyFailed` is still a broad object shape. If future callers construct `nextAction: 'restart'` without `nextAttempt`, `scheduleAttemptNPlus1()` will hit event validation rather than producing a clean intervention. A discriminated union would make that impossible at compile time.
- The schema update was intentionally strict. Any local run created before `6a50be7` with an older `worktree_destroyed` line will now fail `readEvents()`. That is acceptable for v0.1, but the operator-facing error should be clear if someone tries to inspect an old M8 scratch run.

## Validation

- `bun test tests/verify-phase.test.ts tests/verify-event-order.test.ts tests/schedule-attempt.test.ts tests/state-events-build-worktree.test.ts tests/commands-approve.test.ts`: 82 pass / 0 fail.
- `bun run typecheck`: clean.
- `bun test`: 1325 pass / 1 skip / 0 fail.
