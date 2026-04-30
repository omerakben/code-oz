# Codex response — M8 VERIFY-lite implementation

**Thread:** `019ddf5f-2792-78a1-a114-4bf3f72bd229`
**Date:** 2026-04-30
**Model:** GPT-5.5
**Effort:** xhigh
**Sandbox:** read-only
**Brief:** [CODEX_BRIEFING_M8.md](./CODEX_BRIEFING_M8.md)

## Verdict on the decisions

1. **accept-with-modifications.** Use `Bun.spawn`, streaming logs, timeout cancellation, and 1 MiB stream caps as proposed in [Decision 1](./CODEX_BRIEFING_M8.md:82). Modification: the runner must not execute through a shell. Parse the `Command` bullet into an argv vector under a narrow grammar and reject shell operators, redirects, env-prefix tricks, absolute executable paths, and command substitution before spawn. Return `terminationReason: "exit" | "timeout" | "stdout-cap" | "stderr-cap" | "spawn-error"` alongside `exitCode`. Mutation can only pass on `terminationReason: "exit"` with an actual non-expected exit code. Timeouts and cap kills are VERIFY failures or intervention, never mutation success. This keeps `bash: deny` meaningful under the `tool_use.execute` contract [VERIFY.md](../contracts/VERIFY.md:145) and the non-sandbox warning [WORKTREE.md](../contracts/WORKTREE.md:238).

2. **accept-with-modifications.** Keep events as the source of truth, not `current.json` [CODEX_BRIEFING_M8.md](./CODEX_BRIEFING_M8.md:95). Modification: derive next attempt from the max `build_completed.attempt` for the same `runId` and task, not from raw count alone. Cross-check that max against `BUILD_REPORT.md` `Task.Attempt`; gaps or duplicate attempts are restart-policy bugs and should produce intervention. Do not count `build_started`, `build_failed`, or `verify_build_ref_mismatch`, because BUILD failure is not VERIFY restart per [BUILD.md](../contracts/BUILD.md:193).

3. **reject.** Do not add `Asserts:` to PLAN in M8. Implement the pinned conservative rule: mutation is applicable only when BUILD's orchestrator-owned changed-file manifest contains an added test path matching the configured test glob [VERIFY.md](../contracts/VERIFY.md:96). The explicit `Asserts:` flag lets a PLAN persona mislabel new behavior as `refactor` and bypass the gate. Defer the flag until there is a broader PLAN contract pass. M8 should record skipped cases in `Mutation.Notes`, not grow two PLAN axes at once.

4. **accept-with-modifications.** Extend PLAN with change kind, because the current PLAN grammar has only `Files`, `Validation`, `Risk`, `Hypotheses`, and `Sources` [PLAN.md](../contracts/PLAN.md:72), while BUILD preflight already needs added-vs-existing intent [BUILD.md](../contracts/BUILD.md:183). Modification: keep `files` as a path list for compatibility, but parse optional inline file kinds: `src/foo.ts (modified), tests/foo.test.ts (added)`. Old entries default to `modified` with a deprecation warning. BUILD preflight must enforce `added` means absent at base, `modified` and `deleted` mean present at base, and drift fails as `plan_change_kind_drift`. This also fixes the current M7 simplification that allows absent files as possible additions [build.ts](../../src/phases/build.ts:689).

5. **accept-with-modifications.** The persona may author `Failure summary` and `Constraint`, matching the contract [VERIFY.md](../contracts/VERIFY.md:106). Modification: do not implement an imperative-voice validator. That will be brittle and language-sensitive. Validate only grammar facts: single line, non-empty, length cap, no control chars, no command substitution, and no new task/file scope. Use prompt examples and one repair pass to steer wording. The orchestrator owns the mechanical bullets: attempt, forensics path, validation command, and verdict.

6. **accept-with-modifications.** The four-attempt cap covers clean BUILD attempts that reached a valid `BUILD_REPORT.md`, not BUILD protocol failures [VERIFY.md](../contracts/VERIFY.md:177). Modification: restart-policy must have a typed input like `VerifiedFailedAttempt`, produced only after `VERIFY.md` validates with `Verdict: fail`. BUILD protocol failure, runner spawn failure before evidence exists, and BUILD-ref mismatch must go straight to `NEEDS_INTERVENTION.json`, not through the VERIFY-fail cap. This keeps the BUILD-fail path distinct from `verify_failed` [BUILD.md](../contracts/BUILD.md:202).

7. **reject.** Do not clean up on `verify_completed` before approval. The pinned worktree contract says cleanup-on-success is triggered when VERIFY passes and the VERIFY gate is approved [WORKTREE.md](../contracts/WORKTREE.md:86). Alternative: `code-oz approve verify` validates `VERIFY.md` and Scientist sidecars, removes the worktree, emits `worktree_destroyed`, then writes `GATE_VERIFY_PASSED.json`. If removal fails, approval writes intervention and does not write the gate. This preserves manual inspection between VERIFY pass and approval, and avoids a pass gate that still has an active worktree.

8. **accept-with-modifications.** Keep forensics-first ordering [CODEX_BRIEFING_M8.md](./CODEX_BRIEFING_M8.md:180). Modification: emit `verify_restart_initiated` only after `worktree_destroyed`, because the event means the failed worktree is no longer active [VERIFY.md](../contracts/VERIFY.md:162). The event order should be: write logs, write canonical `VERIFY.md`, write forensics bundle, emit `worktree_forensics_preserved`, emit `verify_failed`, remove worktree, emit `worktree_destroyed`, then emit `verify_restart_initiated` or intervention for cap. A crash before `verify_failed` must leave no durable restart signal without evidence.

9. **accept-with-modifications.** Use the smaller VERIFY repair budget [CODEX_BRIEFING_M8.md](./CODEX_BRIEFING_M8.md:195). Modification: define it as two total VERIFY drafts, not two repairs after the first draft. Initial draft plus one repair is enough for a structurally small artifact. If the second draft still violates schema, emit `verify_validation_failed` and intervention. Do not make this config-driven in M8.

10. **accept-with-modifications.** Mirror BUILD's orchestrator/persona split, but move `Verdict.Verdict` to the orchestrator. BUILD already treats computed fields as orchestrator-owned [BUILD.md](../contracts/BUILD.md:58), and VERIFY evidence is computed from the runner [VERIFY.md](../contracts/VERIFY.md:83). The persona owns `Verdict.Rationale`, `Mutation.Notes`, `Failure summary`, and `Constraint`. The orchestrator owns `BUILD ref`, `Validation command`, `Evidence`, `Mutation.Status`, and the binary `Verdict`. This removes a fake-green path where a persona marks pass despite bad evidence.

11. **reject.** Do not revert all changed paths for mutation. Reverting the new test file makes the command fail because the file is missing, so even an empty or tautological test can look like mutation pass. Alternative: keep test files at post-patch contents and revert only behavior files to base. For applicable mutation, start from the post-patch worktree, restore non-test changed paths to base, then rerun the validation command. `Mutation.Status: pass` requires an actual non-expected exit from the tests, not timeout, truncation, missing test file, or spawn error. This matches the contract's stated goal: new tests fail on reverted code [VERIFY.md](../contracts/VERIFY.md:98).

12. **reject.** Do not target a 5-6k verifier persona. The M7 response already pushed persona bodies away from large duplicated grammar blocks [CODEX_RESPONSE_M7.md](./CODEX_RESPONSE_M7.md:22). Alternative: keep `verifier.md` around 3.5-4.5k, with `verify-system.md` carrying schema excerpts and universal rules. Include one compact pass example and one compact fail example. Put long grammar in parser tests and contract files, not in persona prose.

13. **accept-with-modifications.** Extend the existing `greenfield-baby-name` fixture [CODEX_BRIEFING_M8.md](./CODEX_BRIEFING_M8.md:241). Modification: make FakeProvider attempt-aware by explicit key `(phase, taskId, attempt)`, not hidden mutable state. Each e2e test should create a fresh provider instance. The restart e2e must assert attempt 1 forensics, worktree destruction, attempt 2 fresh worktree, `Failure carry-forward` in BUILD_REPORT, and event ordering.

## Where I agree

The streaming runner posture is right. VERIFY is a forensics gate, and losing partial stdout/stderr on a crash would weaken the failure record. The contract already requires logs to exist before `VERIFY.md` is finalized [VERIFY.md](../contracts/VERIFY.md:83), so streaming is not extra polish.

Events are the right base for restart bookkeeping. `current.json` is derived state in this repo's model, while `events.jsonl` is the replay source. The existing event schema already treats M7 worktree and BUILD events as typed write-side variants [schemas.ts](../../src/state/schemas.ts:92), so M8 should extend that path.

The clean BUILD attempt cap is the right cap. The restart policy says attempts 1-4 are clean BUILD invocations and attempt 5 writes intervention [VERIFY.md](../contracts/VERIFY.md:184). Counting BUILD protocol failures in that cap would hide a prompt/schema bug as if it were a repeated test failure.

Forensics-first is right. WORKTREE says a destroyed worktree cannot be re-diffed [WORKTREE.md](../contracts/WORKTREE.md:109), and M7 already added an extensible forensics writer for M8 extras [forensics.ts](../../src/worktree/forensics.ts:1). The only change is event order around worktree destruction.

The shared fixture is fine if attempt is explicit. M7 already accepted extending `greenfield-baby-name` rather than making a new canonical fixture [CODEX_RESPONSE_M7.md](./CODEX_RESPONSE_M7.md:28). The risk is hidden FakeProvider state, not fixture reuse.

## Where I disagree (with specific alternative)

Decision 3 overfits M8 by changing PLAN twice. `Asserts:` is not needed to ship the conservative mutation gate already pinned in VERIFY. Land change-kind in M8 because BUILD preflight needs it; defer assertion-kind because it introduces a second persona-authored bypass lever.

Decision 7 contradicts WORKTREE. Cleaning on `verify_completed` removes the user's last chance to inspect the passing candidate before approval. Put cleanup inside `approve verify` and require successful removal before the gate file appears.

Decision 10 gives the persona one field too many. The binary verdict is a pure function of evidence and mutation status. Letting the persona author it creates a fake-green path. The persona can explain the decision, not decide it.

Decision 11 is the largest technical disagreement. Reverting all changed paths makes "missing new test file" count as proof. Keep tests, revert implementation files, and only accept actual test failure as mutation pass.

Decision 12 repeats the prompt-size mistake from M7's rejected builder lean. A verifier prompt should be compact because the artifact parser, not prompt prose, enforces the contract.

## Risks Claude is not seeing

A mutation pass can be fake if timeout, stdout cap, stderr cap, or spawn failure is treated as a non-zero test failure. The runner result must separate ordinary exit from abnormal termination. Mutation pass only comes from an ordinary exit code that differs from expected.

A new-test-file revert can fake mutation success. If `bun test tests/new.test.ts` fails because the file vanished, the gate learned nothing about whether the test catches the source change.

Flaky tests can fake mutation success. If the reverted replay fails due flake, mutation passes even when the source change is irrelevant. M8 does not need a retry framework, but it must record `durationMs`, termination reason, and exact replay exit in `Mutation.Notes`, and it must never pass on timeout.

Expected non-zero validation commands make mutation semantics muddy. In M8, mutation applicability should require `Expected exit code: 0`; otherwise mark `not-applicable` with a note or fail the mutation gate as unsupported. The contract examples assume "new tests fail" means non-zero on reverted code [VERIFY.md](../contracts/VERIFY.md:98).

Restart caps can leak if the counter uses `build_started` or an increment-before-BUILD model. Count only completed BUILD reports that later produced VERIFY failures. `build_failed` emits intervention directly [BUILD.md](../contracts/BUILD.md:197), and `verify_build_ref_mismatch` is an ordering bug, not a candidate failure [VERIFY.md](../contracts/VERIFY.md:70).

The runtime surface still misses real sandboxing. `network: none` in the permission manifest is a contract, not OS isolation. User tests can still read host files, spawn child processes through test code, touch absolute paths, or use secrets from the inherited environment. M8 should spawn with a scrubbed env, no shell, cwd pinned to the worktree, and clear docs that W4 containerization is the hostile-code defense [WORKTREE.md](../contracts/WORKTREE.md:238).

## Decisions you would defer

Defer Decision 3. Ship mutation applicability from BUILD's changed-file manifest in M8, and revisit an explicit PLAN assertion field after M8 has data.

Defer any cleanup preservation config from Decision 7. The contract path is gate-driven cleanup, and `code-oz prune` is the later cleanup story [WORKTREE.md](../contracts/WORKTREE.md:95).

Defer prompt-size experiments from Decision 12. Pick the smaller verifier now; tune after repair-rate data exists.

## Recommended commit-order critique

The proposed order is close, but I would move the PLAN and BUILD restart seams earlier.

1. PLAN change-kind grammar and parser compatibility first, because BUILD preflight and mutation applicability depend on it.
2. `tool_use.execute` schema/load validation plus no-shell command grammar.
3. Verify event types and event validators.
4. Test runner with streaming logs, caps, timeout, env scrub, and termination reason tests.
5. `verify-report.ts` parser/serializer with orchestrator-owned verdict support.
6. Mutation module with source-only revert semantics and abnormal-termination tests.
7. Restart policy plus BUILD carry-forward support. Current BUILD still serializes `failureCarryForward: null` [build.ts](../../src/phases/build.ts:462), so this must land before full VERIFY integration.
8. Forensics extras and event ordering tests.
9. Verifier persona and prompt composer.
10. `verify.ts` orchestration, Scientist tail, cleanup-on-approval hook, and e2e tests.

## Decisions you must lock before code

Lock the command execution grammar: no shell, argv-only spawn, abnormal termination is never mutation pass.

Lock mutation semantics: keep test files, revert behavior files, require ordinary non-expected exit.

Lock verdict authority: orchestrator owns `Verdict.Verdict`; persona owns rationale and failure text.

Lock restart counting: same run and task, completed BUILD reports only, cross-checked against `BUILD_REPORT.md`.

Lock PLAN change-kind syntax and default behavior before touching BUILD preflight.

Lock cleanup timing: worktree removal happens during `approve verify` before the pass gate file is written.
