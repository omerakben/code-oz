# Codex review - M8 VERIFY-lite implementation

**Thread:** current Codex review session (thread id not exposed locally)
**Prior thread:** `019ddf5f-2792-78a1-a114-4bf3f72bd229` (M8 planning debate)
**Date:** 2026-04-30
**Model:** GPT-5.5
**Effort:** xhigh
**Sandbox:** workspace read/write for review artifact; implementation reviewed as read-only

## Verdict

`fix-first`

The M8 substrate modules mostly point in the right direction, and the full offline suite passes. The phase-level VERIFY implementation is not shippable yet. `runVerify()` is ordered backwards around evidence collection, does not durably write interventions, erases streamed failure logs, and has no production source-revert seam for mutation. These are gate-boundary defects, not Pre-M9 polish.

## Findings

### block-push

1. **`runVerify()` invokes and parses the verifier before evidence exists, so fail/restart is structurally broken.**
   The code composes/invokes/parses the persona at `src/phases/verify.ts:184-215`, then runs the validation command and mutation gate only afterward at `src/phases/verify.ts:217-251`. The prompt asks the persona to author evidence-grounded rationale and failure constraint text, but the persona has not received runner evidence or mutation status. Worse, if the persona drafted a pass-shaped artifact and the runner later fails, `failureConstraint` stays null at `src/phases/verify.ts:286-298`; the round-trip parse then returns `verify_validation_failed` at `src/phases/verify.ts:301-313` instead of writing `VERIFY.md`, preserving forensics, emitting `verify_failed`, and restarting. Fix: run primary validation and mutation first, compute orchestrator fields, then invoke the persona with concrete evidence/log refs and ask only for rationale, mutation notes, and fail constraint. Parse/repair that merged artifact afterward.

2. **VERIFY interventions are return values only, not durable `NEEDS_INTERVENTION.json` gates.**
   `runVerify()` returns `intervention(...)` for missing/invalid BUILD reports, persona failures, schema failures, Scientist failures, and forensics failures at `src/phases/verify.ts:121-123`, `src/phases/verify.ts:135-150`, `src/phases/verify.ts:195-215`, `src/phases/verify.ts:307-313`, `src/phases/verify.ts:330-332`, and `src/phases/verify.ts:382-386`. It never calls `writeNeedsInterventionGate` or appends an `intervention` event, unlike BUILD's durable path at `src/phases/build.ts:825-870`. The attempt-cap path is also only a returned `nextAction: 'intervention'` at `src/phases/verify.ts:444-450`, while the contract says attempt 5 writes `NEEDS_INTERVENTION.json`. Fix before tag: add a VERIFY-side `recordIntervention` and use it for every intervention branch, including cap exhaustion.

3. **Failure forensics overwrite the streamed stdout/stderr logs with empty files.**
   The runner streams primary logs to `forensics/<attempt>/stdout.log` and `stderr.log` at `src/phases/verify.ts:217-229`. On fail, `runVerify()` calls `writeVerifyForensicsBundle()` with `stdout: ''` and `stderr: ''` at `src/phases/verify.ts:368-375`. The writer then writes the required `stdout.log` and `stderr.log` entries from those empty strings at `src/worktree/forensics.ts:203-210`, clobbering the logs the runner just produced. This violates `VERIFY.md`'s evidence contract and corrupts the failure bundle. Fix: either pass captured log contents into the forensics writer or make the writer preserve already-streamed log files instead of rewriting them.

4. **Mutation cannot be exercised end-to-end because source revert has no production implementation.**
   The mutation gate's core contract is source-only revert, but M8 only defines `RevertSeam` at `src/phases/verify-mutation.ts:211-230` and requires callers to inject it at `src/phases/verify.ts:83-85` and `src/phases/verify.ts:237-251`. The only orchestration seam in `tests/verify-phase.test.ts:108-112` is a no-op mock, and there is no production implementation in `src/`. This means the accepted mutation semantics are unit-tested but not actually available to VERIFY. Fix: implement the real worktree revert/restore seam and add at least one integration test where an added test fails after behavior files are restored to base.

5. **The VERIFY fail path skips the Scientist tail required by rule 15 and the VERIFY contract.**
   The contract says VERIFY writes `VERIFY.md`, runs the Scientist tail, and on fail may seed `OPEN_QUESTIONS.md`. The implementation calls `runScientistPhaseTail()` only in the pass branch at `src/phases/verify.ts:319-332`; the fail branch starts at `src/phases/verify.ts:353` and goes directly to forensics/events/restart. Fix: run the VERIFY Scientist tail after canonical `VERIFY.md` is written for both pass and fail, with fail-side intervention behavior if sidecars are invalid.

6. **The one-repair-round decision is not implemented where it matters.**
   Decision 9 locked two total VERIFY drafts. The prompt documents that at `src/prompts/verify-system.md:138-142`, but `runVerify()` makes a single persona call at `src/phases/verify.ts:192-215` and immediately returns `verify_validation_failed` on parser failure. Given the strict six-section parser, this is not just ergonomics; it turns normal recoverable draft drift into intervention. Fix this in the same pass as the orchestration reorder: preserve the bad draft, send one named repair prompt, then finalize or write durable intervention.

7. **There is no phase-level pass/fail/restart coverage, so the current suite cannot catch the gate defects above.**
   `tests/verify-phase.test.ts` states the full integration tests are deferred at `tests/verify-phase.test.ts:1-6` and only covers entry-validation plus the ready-signal constant at `tests/verify-phase.test.ts:134-211`. It never asserts a completed pass, a primary validation fail, mutation fail, forensics preservation, Scientist tail, `verify_failed`, restart carry-forward, or cap intervention. The full `bun test` pass is therefore not evidence that M8's authority boundary works. Add the minimal pass and fail/restart e2e before tagging M8.

### block-next-milestone

1. **`code-oz approve verify` can be deferred from M8, but not past the first M9 commit.**
   I agree with the cleanup-on-approval model from Decision 7. A pass should leave the worktree inspectable, and the gate file should be written only after successful cleanup. But M9 cannot consume VERIFY without a real `GATE_VERIFY_PASSED.json` path. Land `approve verify` before REVIEW-lite starts.

2. **The remaining canonical fail events are acceptable only if the Pre-M9 scheduler is the immediate next change.**
   Deferring `worktree_destroyed` and `verify_restart_initiated` out of `runVerify()` is acceptable if a single schedule-attempt-N+1 orchestrator owns worktree removal and next BUILD creation. It is not acceptable to start REVIEW-lite while `verify_failed` is the last durable fail event.

3. **The ROADMAP M8 acceptance text is now stale relative to the implementation.**
   `docs/design/ROADMAP.md:234-240` still says commit 10 includes `approve verify`, Scientist tail tests, and two e2e tests. The briefing says those were deferred. Update the roadmap before the next milestone so M9 does not inherit false acceptance criteria.

### fix-soon

1. **`Mutation.Notes` ignores the computed mutation result.**
   `evaluateMutation()` returns the diagnostic note at `src/phases/verify-mutation.ts:67-70` and `src/phases/verify-mutation.ts:288`, but `runVerify()` discards it and writes `personaParsed.mutation.notes` at `src/phases/verify.ts:284-285`. That can produce `Mutation.Status: fail` with notes claiming the gate passed. Use `mutationResult.notes` as the canonical note, or give the persona the computed note and allow only a bounded paraphrase with semantic checks.

2. **Runner and revert errors can escape instead of becoming actionable VERIFY interventions.**
   `runVerify()` awaits `opts.runner()` and `evaluateMutation()` without a try/catch at `src/phases/verify.ts:221-251`. `evaluateMutation()` intentionally rethrows runner errors after restore in `src/phases/verify-mutation.ts:272-286`, and tests assert the throw at `tests/verify-mutation-terminations.test.ts:128-143`. That is fine for the pure helper, but the phase boundary must catch it and write `NEEDS_INTERVENTION.json`.

3. **The verifier prompt is too large and currently duplicates the wrong authority model.**
   The persona file plus system template are about 16 KB together (`src/agents/defaults/verifier.md`, `src/prompts/verify-system.md`). Size alone is not block-push, but the prose tells the persona to emit placeholders for orchestrator fields at `src/prompts/verify-system.md:83-136` while the parser requires real values. After fixing orchestration, cut the prompt to persona-owned fields plus two examples.

### nit / fyi

1. **The optional `stdoutBytes` / `stderrBytes` extension on `RunnerResultShape` is fine.**
   The fields are optional at `src/phases/verify-mutation.ts:132-140`, and mutation status logic ignores them at `src/phases/verify-mutation.ts:150-195`. This is not seam pollution.

2. **The argv grammar is strict, but acceptable for v0.1.**
   Rejecting quotes and backslash at `src/tools/command-grammar.ts:15-27` means paths with spaces cannot be validation targets. That is a usability limit, not a security or correctness bug. Keep it strict until there is a real argv list in the contract.

3. **`maxFilesForNextManifest: 0` is justified.**
   The schema relax at `src/agents/schema.ts:515-560` is bounded to non-negative integers under the existing hard cap, and VERIFY genuinely should not promote repo-context paths into a next manifest. I do not see an abuse path from zero.

4. **The isolated module tests are useful.**
   The parser, runner, event schema, mutation status mapping, and forensics extra-name tests are good substrate coverage. The missing layer is phase integration.

## Where I agree

- The no-shell runner posture is right: `Bun.spawn` argv form, command grammar, scrubbed env, timeout, stream caps, and `terminationReason` are the correct M8 primitives.
- Orchestrator-owned `Verdict.Verdict` and `Mutation.Status` are correct. The persona should explain evidence, not decide the binary gate.
- Source-only mutation semantics are correct: keep tests at post-patch contents, revert behavior files only, and require ordinary non-expected exit for mutation pass.
- Cleanup-on-approval is the right model. `runVerify()` should not destroy a passing worktree before the user approves the VERIFY gate.
- The `maxFilesForNextManifest: 0` schema relaxation matches VERIFY's role and does not weaken the M6 cap.

## Where I disagree

- I disagree that the commit-10 deferred list is all Pre-M9 polish. The repair turn, e2e coverage, and real mutation revert seam are part of M8's evidence authority. Deferring all three is how the backward `runVerify()` ordering and log clobber survived.
- I disagree with making the persona emit a full six-section `VERIFY.md` before orchestrator evidence exists. The correct interaction is compute evidence first, then ask the persona for the few human-authored fields, then serialize the canonical artifact.
- I disagree that returning `VerifyIntervention` is enough. This repo's gate discipline is file-based. A VERIFY intervention that does not write `NEEDS_INTERVENTION.json` is not durable state.

## Risks Claude is not seeing

- A real validation failure after a pass-shaped persona draft currently becomes `verify_validation_failed` intervention, not `verify_failed` restart. That defeats the core restart-on-fail policy.
- Failure logs can appear present by path in `VERIFY.md` while the forensics bundle has empty stdout/stderr because of the overwrite bug.
- Mutation notes can contradict mutation status because the implementation discards `mutationResult.notes`.
- Any runner grammar error or real revert failure can throw through the phase boundary and leave neither `VERIFY.md` nor `NEEDS_INTERVENTION.json`.
- M9 will inherit an unverifiable precondition unless `approve verify` and `GATE_VERIFY_PASSED.json` land before REVIEW-lite starts.

## Decisions you would defer

- Defer `approve verify` only until the immediate Pre-M9 commit. It is not block-push for M8 if M8 intentionally stops after `verify_completed`, but it is block-next-milestone.
- Defer loosening argv grammar. The current rejection of quotes/backslashes is conservative and acceptable.
- Defer prompt-size tuning after the orchestration fix. Cut the prompt then, because the current extra prose is tied to the wrong persona/full-artifact flow.
- Do not defer the repair turn, the real mutation revert seam, fail-side Scientist tail, durable interventions, or pass/fail e2e coverage. Those are M8 closure items.

## Validation

- `bun test tests/verify-phase.test.ts tests/verify-mutation-terminations.test.ts tests/forensics-m8-extras.test.ts` passed: 24 pass / 0 fail.
- `bun run typecheck` passed.
- `bun test` passed: 1288 pass / 1 skip / 0 fail.
