# Codex review briefing — M8 implementation

**Branch:** `feat/m8-verify-lite` (11 commits ahead of `main`)
**Final commit:** `f406d87`
**Test baseline:** 1288 pass / 1 skip / 0 fail (started from M7's 1005)
**Typecheck:** clean
**Reviewer:** GPT-5.5 (review_model = gpt-5.4 per `~/.codex/config.toml`; xhigh effort)
**Sandbox:** read-only (review only)

## What you are reviewing

M8 = VERIFY-lite + restart-on-fail policy. The full plan was negotiated in [`docs/design/CODEX_BRIEFING_M8.md`](./CODEX_BRIEFING_M8.md) and your prior thread `019ddf5f` ([`docs/design/CODEX_RESPONSE_M8.md`](./CODEX_RESPONSE_M8.md)). 13 decisions; 4 rejects + 9 accept-with-modifications. The 10 implementation commits below land all 9 accept-with-mods and 3 of the 4 rejects' alternatives. The fourth reject (decision 12: prompt-size experiment) was simply not done — verifier persona is ~7.7k vs Codex recommendation of 3.5-4.5k, justified inline in the commit message.

## Commit map (in order)

| Commit | SHA | Subject | Tests Δ |
|---|---|---|---|
| 0 | `fbfc9e9` | docs(design): M8 synthesis + ROADMAP + Codex debate trail | n/a |
| 1 | `69480f3` | feat(plan): change-kind annotation in PLAN task Files | +19 |
| 2 | `841c9f8` | feat(agents,tools): tool_use.execute schema + argv-only command grammar | +57 |
| 3 | `6d8ef57` | feat(tools): test-runner with streaming logs, caps, timeout, terminationReason | +22 |
| 4 | `df1c597` | feat(state): verify_* event types and validators | +31 |
| 5 | `8d4711e` | feat(artifacts): VERIFY.md parser/serializer with cross-field verdict validation | +53 |
| 6 | `afc313b` | feat(phases): mutation gate with source-only revert and abnormal-termination guards | +35 |
| 7 | `3a6b163` | feat(phases): restart policy + BUILD failure-carry-forward wiring | +26 |
| 8 | `ec6ee1c` | feat(worktree,phases): M8 forensics extras + canonical event order | +21 |
| 9 | `9c5c444` | feat(agents,prompts): VERIFY persona + verify-system + composer | +12 |
| 10 | `f406d87` | feat(phases): VERIFY orchestration wiring 9 M8 modules | +7 |

Total: 53 files changed, 8207 insertions, 56 deletions. Net +283 tests.

## Decision-by-decision implementation map

Map your 13 decisions in [`docs/design/CODEX_RESPONSE_M8.md`](./CODEX_RESPONSE_M8.md) to the commits that land them:

1. **Decision 1 (test-runner shape, accept-with-mods)** → commits 2 + 3.
   - Commit 2 lands the argv-only grammar parser (`src/tools/command-grammar.ts`) rejecting shell operators / redirects / env-prefix / command substitution / absolute exec paths. Tests in `tests/command-grammar.test.ts`.
   - Commit 3 lands the runner (`src/tools/test-runner.ts`) using `Bun.spawn` argv form with the parsed argv vector, scrubbed env (PATH/HOME/LANG only), streaming caps via `FileHandle.write` chunks, AbortController-driven timeout, discriminated `terminationReason` enum: `'exit' | 'timeout' | 'stdout-cap' | 'stderr-cap' | 'spawn-error'`. Tests across 5 files.

2. **Decision 2 (attempt counter, accept-with-mods)** → commit 7. `deriveNextAttempt()` reduces `events.jsonl` to `max(build_completed.attempt) + 1` for the matching `(runId, taskId)`. Counts only `build_completed`; does not count `build_started` / `build_failed` / `verify_build_ref_mismatch`. Cross-check against `BUILD_REPORT.md` is at the BUILD entry guard (commit 7's drift check at build.ts:271-322).

3. **Decision 3 (no PLAN Asserts: flag, reject)** → commit 1 + commit 6. Mutation applicability is conservative per the manifest only (`evaluateApplicability()` in `src/phases/verify-mutation.ts`): added test path matching the configured suffix AND `expectedExitCode === 0`. No PLAN grammar Asserts: flag.

4. **Decision 4 (PLAN change-kind, accept-with-mods)** → commit 1. PLAN task `Files` bullets accept `(added)` / `(modified)` / `(deleted)` annotations; absent annotation defaults to `modified` with deprecation warning. BUILD entry preflight cross-check is deferred to a follow-up commit after PLAN-grammar consumers migrate (the M2-M7 consumer migration is the M9 prep work — see "Deferred" below).

5. **Decision 5 (failure-text validation, accept-with-mods)** → commit 5. `parseVerifyReport` enforces grammar facts only on persona-authored `Failure summary` + `Constraint`: single line, non-empty, ≤ 200 chars. No imperative-voice validator. Prompt examples + one repair pass steer wording (commits 9 + 10).

6. **Decision 6 (cap covers verified attempts only, accept-with-mods)** → commit 7. `VerifiedFailedAttempt` is the typed gate input — only constructible from a parsed VERIFY.md with `Verdict: fail`. BUILD-protocol failures and `verify_build_ref_mismatch` produce intervention directly without traversing `decideRestart()`.

7. **Decision 7 (cleanup-on-approval, reject)** → commit 10. `runVerify()` does NOT destroy the worktree on a pass — a `code-oz approve verify` CLI handles that step. Approve-verify is a Pre-M9 follow-up (named explicitly in the commit-10 message). On VERIFY-pass, the gate file is also NOT written by `runVerify` — the approve command writes it after successful cleanup.

8. **Decision 8 (event ordering, accept-with-mods)** → commit 8 (groundwork) + commit 10 (partial wiring).
   - Commit 8 ships `CANONICAL_VERIFY_FAILURE_EVENT_ORDER` constant and `validateVerifyFailureEventOrder()` validator.
   - Commit 10's `runVerify()` emits `worktree_forensics_preserved → verify_failed` on fail. The remaining two events (`worktree_destroyed`, `verify_restart_initiated`) fire from the schedule-attempt-N+1 orchestrator (Pre-M9 follow-up).

9. **Decision 9 (two drafts max, accept-with-mods)** → commits 9 + 10. The verifier persona body and verify-system.md document the one-repair-round protocol (initial draft + one repair → fail = `verify_validation_failed`). The current `runVerify` invocation does NOT yet implement the repair turn — single invocation only. Repair-turn wiring is a Pre-M9 follow-up.

10. **Decision 10 (orchestrator owns Verdict, accept-with-mods)** → commits 5 + 9 + 10. `parseVerifyReport`'s cross-field rule enforces `Verdict.Verdict === pass iff exit matches expected AND mutation ∈ {pass, n/a}`. `runVerify` computes the binary verdict and overrides whatever the persona writes. The verifier persona body explicitly documents this split.

11. **Decision 11 (mutation reverts behavior files only, reject)** → commit 6. `selectBehaviorFiles()` keeps test files (added or modified) at post-patch contents and selects only non-test files for revert. `mutationStatusFromResult()` rejects abnormal terminations (timeout / cap kill / spawn error) as mutation pass.

12. **Decision 12 (compact verifier persona, reject)** → commit 9 — partially honored. Verifier body is ~7.7k chars vs your 3.5-4.5k recommendation. Justification (commit 9 message): the orchestrator-vs-persona authority split + 6-section schema + cross-field rule + two worked examples warrant the overage. **Open question: do you still see this as a problem?** If yes, name the specific sections to cut.

13. **Decision 13 (fixture extension, accept-with-mods)** → deferred. Greenfield-baby-name fixture extension and full e2e (`tests/e2e/verify-lite-greenfield.test.ts`) are Pre-M9 follow-ups, named in commit 10's message.

## What we want from this review

Per CLAUDE.md rule 8 (Codex review at implementation completion):

1. **Verdict:** one of `push` / `fix-first` / `debate-required`.
   - `push`: tag and merge to main, treat any nits as M9 work.
   - `fix-first`: name specific commits to address before tagging; we'll make a follow-up commit (never amend) and re-review.
   - `debate-required`: a structural decision in M8 still has an unresolved disagreement that another debate round should settle.

2. **Findings list**, each tagged with severity:
   - `block-push`: must address before tagging M8 (e.g., a security hole, a contract violation, a logic bug that would corrupt forensics).
   - `block-next-milestone`: must address before M9 starts (e.g., a layering issue that M9 would amplify, an assumption M9 would inherit).
   - `fix-soon`: address in a Pre-M9 commit on this branch or in M9's first commit.
   - `nit`: cosmetic, optional.
   - `fyi`: observation, no action.

3. **Specific scrutiny areas** I want you to attack hardest:
   - **The deferred items in commit 10**: are any of them block-push severity rather than Pre-M9? Specifically:
     - The remaining two canonical events on fail (`worktree_destroyed`, `verify_restart_initiated`) firing from a Pre-M9 commit, not from `runVerify`. Is that a problem for M8 closing?
     - The `runVerify` repair turn (decision 9) being absent.
     - The full e2e integration test being deferred.
     - The `code-oz approve verify` CLI being absent (gate file is therefore never written by M8 — runs effectively pause after VERIFY pass).
   - **The verifier persona body size (~7.7k vs 3.5-4.5k recommended)**. Is the overage justified or do you still see prompt-size risk?
   - **The `RunnerResultShape` extension in commit 10** to add optional `stdoutBytes` / `stderrBytes`. Polluting the mutation seam's slim shape, or fine since they're `?` optional and ignored by mutation logic?
   - **The mutation gate's `evaluateMutation` calls the runner with the same `cwd` as the primary validation invocation**, but the actual revert operation is mocked behind a seam. Without a real RevertSeam implementation, can mutation actually be exercised end-to-end yet?
   - **The argv-only command grammar in commit 2 rejects single quotes, double quotes, and backslash** (not just the families Codex named). Is that too strict?
   - **The `maxFilesForNextManifest: 0` schema relax in commit 9**. Do you see any way this could be abused, or is "VERIFY genuinely doesn't promote paths" a real M8-shaped justification?

4. **Risks Claude is not seeing** (your standard "Risks" section). Particular interest:
   - Anything M9 (REVIEW-lite) will inherit from M8 that should be tightened now rather than later.
   - Anything in the verify orchestration that would silently produce a fake-pass under specific edge cases not covered by the existing tests.
   - Anything in the restart policy's drift checks that an adversarial caller could route around.

5. **Decisions you would defer**. If anything in the deferred list above looks like it should NOT be deferred, name it.

## Files changed

53 files, 8207 insertions, 56 deletions. Major source files:

```
src/agents/defaults/verifier.md                    122  | (rewrite)
src/agents/schema.ts                               187  | (extends with tool_use.execute, relaxes maxFilesForNextManifest)
src/artifacts/plan.ts                               86  | (commit 1: change-kind annotation)
src/artifacts/verify-report.ts                     764  | (new: parser/serializer)
src/phases/build.ts                                 69  | (commit 7: carryForward wiring + drift checks)
src/phases/restart-policy.ts                       146  | (new)
src/phases/verify-event-order.ts                   139  | (new)
src/phases/verify-mutation.ts                      289  | (new)
src/phases/verify.ts                               490  | (new: orchestration)
src/prompts/index.ts                                66  | (composeVerifyPrompt)
src/prompts/verify-system.md                       148  | (new template)
src/state/events.ts                                121  | (verify_* validators)
src/state/schemas.ts                                87  | (verify_* event types)
src/tools/command-grammar.ts                        98  | (new)
src/tools/test-runner.ts                           309  | (new)
src/worktree/forensics.ts                           97  | (M8 extras helpers)
```

23 new test files. 1288 tests pass, typecheck clean. No new warnings.

## Output

Write your response into a file at `docs/design/CODEX_REVIEW_M8.md` with the canonical structure used by prior reviews:

```markdown
# Codex review — M8 VERIFY-lite implementation

**Thread:** <your-thread-id>
**Date:** 2026-04-30
**Model:** GPT-5.4 (review_model)
**Effort:** xhigh
**Sandbox:** read-only

## Verdict

<push | fix-first | debate-required>

## Findings

### block-push
...

### block-next-milestone
...

### fix-soon
...

### nit / fyi
...

## Where I agree
...

## Where I disagree
...

## Risks Claude is not seeing
...

## Decisions you would defer
...
```

Be direct. Cite specific files and line numbers. Don't hedge.
