# Codex review - M8 fix-first re-review

Thread: current Codex re-review session  
Prior review: `docs/design/CODEX_REVIEW_M8.md` on commit `f406d87`  
Date: 2026-04-30  
Branch reviewed: `feat/m8-verify-lite` at `d223cdb`

## Verdict

`fix-first`

The original seven block-push findings are materially addressed. The orchestration is now evidence-first, the repair turn exists, failure logs are preserved, the production revert seam is real, and the phase-level tests cover the main pass/fail/restart shapes.

I am still blocking push because the VERIFY pass path is not actually approvable: `runVerify()` emits `verify_completed` but never emits `gate_required` for `verify`, while `runApprove()` refuses approval without that event. That leaves `code-oz approve verify` unreachable after a normal VERIFY pass, so `GATE_VERIFY_PASSED.json` cannot be written from the phase runner's real output.

## Findings

### block-push

1. `runVerify()` never calls `requireGate()` on pass, so `code-oz approve verify` is blocked before `preApproveVerifyHook` can run.

   `src/phases/verify.ts:484-503` emits `verify_completed` and returns `completed`, but the module does not import or call `requireGate({ phase: 'verify' })`. `src/commands/approve.ts:156-174` requires a matching `gate_required` event for the target phase before it will approve anything. The existing happy-path VERIFY test asserts only `verify_started` and `verify_completed` at `tests/verify-phase.test.ts:357-362`, and the approve tests call `preApproveVerifyHook` directly at `tests/commands-approve.test.ts:342-414`, bypassing `runApprove`'s real gate-required precondition.

   This breaks the M8 approval path: after a VERIFY pass, an operator can have a valid `VERIFY.md` and still fail `code-oz approve verify` with "no `gate_required` event for verify." Other completed phases own this signal in their phase runner, for example `runPlan()` calls `requireGate()` at `src/phases/plan.ts:574-581` and `runBuild()` does the same at `src/phases/build.ts:668-674`.

   Fix: after successful `VERIFY.md` write, Scientist tail, and `verify_completed`, call `requireGate({ phase: 'verify', blockedOn: 'code-oz approve verify' })`. Add an integration test that runs `runVerify()` pass, then `runApprove({ phase: 'verify' })`, and asserts the worktree is removed plus `GATE_VERIFY_PASSED.json` is written.

### block-next-milestone

1. `scheduleAttemptNPlus1()` hardcodes `taskId: 'T-001'`, so restart events are wrong for any task other than T-001.

   In the restart branch, `verify_restart_initiated.taskId` is derived through `extractTaskIdFromForensics()` at `src/phases/schedule-attempt.ts:126-140`, and that helper always returns `T-001` at `src/phases/schedule-attempt.ts:169-180`. The intervention branch does the same at `src/phases/schedule-attempt.ts:152-162`. This is a real risk, not just a harmless M8 placeholder, because `verify_failed` is emitted with the actual `opts.taskId` at `src/phases/verify.ts:552-565`, while the paired restart event can be emitted under a different task ID.

   This can corrupt the canonical fail sequence for `T-002+`: readers scoped to `(runId, taskId, attempt)` will see `verify_failed(T-002)` but `verify_restart_initiated(T-001)`. Since the full run-loop is M9, I would not make this a second block-push finding, but M9 should not start until this function accepts `taskId` explicitly, or `VerifyFailed` carries `taskId` as a required field.

2. The VERIFY failure-order validator is not retry-safe past attempt 1.

   `worktree_forensics_preserved` already has `attempt` in the schema at `src/state/schemas.ts:354-363`, but `validateVerifyFailureEventOrder()` treats it as run-scoped and filters all such events for the run at `src/phases/verify-event-order.ts:66-82`. It also treats `worktree_destroyed` as run-scoped because the event has no attempt/task fields. After attempt 1 fails and attempt 2 later fails, the validator can pick attempt 1's `worktree_destroyed` while checking attempt 2 and report an out-of-order sequence. If M9 uses this validator to guard restart orchestration, it will produce false negatives on the first real retry loop.

   Fix before M9: scope `worktree_forensics_preserved` by attempt, and either add attempt/task metadata to `worktree_destroyed` or validate order using a contiguous event slice returned by the scheduler instead of scanning all run-wide worktree events.

### fix-soon

1. `verify_validation_failed` tells the operator to inspect `VERIFY.draft.md`, but the verifier drafts are never written.

   `actionableSuggestionsFor('verify_validation_failed')` points to `VERIFY.draft.md` at `src/phases/verify.ts:219-222`. `invokeWithRepair()` keeps both drafts in local variables at `src/phases/verify.ts:707-741`, then returns only a code and reason. The resulting intervention is durable as a gate file and event, but it is not very actionable for the exact failure mode where the draft text is the evidence. Write at least the final rejected draft, preferably both drafts, before recording `verify_validation_failed`.

2. `docs/contracts/VERIFY.md` is stale on the authority split.

   The implementation now makes `Mutation.Notes` orchestrator-owned via `mutationResult.notes` at `src/phases/verify.ts:432-436`, and the prompt says the persona must not author it at `src/prompts/verify-system.md:45-52`. The contract still says the persona authors `Mutation` / `Mutation.Notes` at `docs/contracts/VERIFY.md:13` and `docs/contracts/VERIFY.md:78-81`. Since this repo treats Markdown contracts as load-bearing artifacts, update the contract before M9 uses it as REVIEW's input spec.

### nit / fyi

1. The one-shot repair policy is strict enough.

   I would not add more verifier retries. The current `invokeWithRepair()` implements the intended two-draft maximum at `src/phases/verify.ts:702-741`. More retries would reintroduce the soft-loop behavior M8 is explicitly trying to avoid.

2. `parseVerifyPersonaResponse()` accepts extra H2 sections and a ready marker that appears after preceding prose.

   This is acceptable because the orchestrator only merges `Rationale`, `Failure summary`, and `Constraint`, and drops everything else. If live providers drift, tighten this to reject unknown H2 sections after the marker, but I would not block on it.

## Where I agree

- bp#1 is closed in the core ordering. `runVerify()` now reads and validates `BUILD_REPORT.md`, emits `verify_started`, runs validation, evaluates mutation, computes the binary verdict, then invokes the persona only for persona-owned fields.
- bp#2 is mostly closed. The enumerated VERIFY intervention paths now route through `recordVerifyIntervention()`, which writes `NEEDS_INTERVENTION.json` and appends an `intervention` event.
- bp#3 is closed. `preserveExistingStdoutStderr` preserves runner-streamed `stdout.log` and `stderr.log`, and the regression test covers the real clobber shape.
- bp#4 is closed for M8's intended text-file scope. `createGitRevertSeam()` handles added, modified, and deleted files with real git worktrees, and the mutation e2e exercises it through `runVerify()`.
- bp#5 is closed. The Scientist tail runs before the pass/fail branch, so fail-side VERIFY gets the phase tail too.
- bp#6 is closed. The repair turn exists and is intentionally one-shot.
- bp#7 is closed. The phase-level e2e coverage now exercises pass, repair pass, validation fail, timeout fail, cap exhaustion, and real revert-seam mutation.
- `preApproveVerifyHook` is a reasonable helper boundary. Exporting it for tests is fine; the problem is not the abstraction, it is the missing `gate_required` signal before `runApprove()` can call it.

## Where I disagree

- I disagree that `approve verify` is fully landed. The cleanup hook is present, but the real approval path still depends on a `gate_required(verify)` event that `runVerify()` never emits.
- I disagree that the hardcoded `T-001` scheduler fallback is harmless for M8. If `scheduleAttemptNPlus1()` is claimed as the M8 canonical-event completer, its events need to be correctly scoped even before M9 wires the next BUILD invocation.
- I disagree with leaving the VERIFY contract stale while the code and prompt have moved to the small-response protocol. This repo's contracts are part of the implementation surface, not background notes.

## Risks Claude is not seeing

- The pass path currently proves `VERIFY.md` can be written, not that the VERIFY gate can be approved. Add the runVerify-pass-to-runApprove-verify test; it should fail before the `requireGate()` fix.
- `VerifyFailed` is shaped as one interface with optional `carryForward` / `nextAttempt`, but `scheduleAttemptNPlus1()` uses non-null assertions in the restart branch. M9 should split this into a discriminated union so malformed scheduler calls cannot throw before writing intervention state.
- Multi-attempt event validation is likely to become noisy once the run-loop retries for real, because some worktree events are run-scoped while verify events are task/attempt-scoped.
- The contract drift around `Mutation.Notes` can leak into M9 prompt design if REVIEW is implemented from `docs/contracts/VERIFY.md` rather than the current `runVerify()` authority model.

## Validation

- `bun test tests/verify-phase.test.ts tests/revert-seam.test.ts tests/schedule-attempt.test.ts tests/forensics-m8-extras.test.ts tests/commands-approve.test.ts` passed: 47 pass / 0 fail.
- `bun run typecheck` passed.
