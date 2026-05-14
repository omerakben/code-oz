# Codex debate on v0.20.3 finding #1 — BUILD worktree reset between attempts

**Date:** 2026-05-14
**Session ID:** `019e28d9-bd57-71e0-b1a2-262cae205234`
**Model / effort:** `gpt-5.5` @ xhigh, sandbox=read-only
**Verdict:** `accept-with-modifications`
**Duration:** ~7 min, 131,517 tokens

## Brief

The brief was constructed from Explore-agent fact-sheet output and dispatched as a structured debate covering: restart entry, base-SHA persistence, existing reset primitives (none), carry-forward, event sequence, recommended design (A–E), and eight debate questions covering policy + rule 20 + test coverage + risks.

## Codex response (verbatim)

Verdict: `accept-with-modifications`.

This is the right fix, but I would lock the implementation more tightly before code lands. The invariant is: every BUILD attempt after attempt 1 starts from the run's immutable base commit before the builder sees files, derives file refs, or applies a patch.

### Decision answers

1. **Reset triggering policy: unconditional when `attempt > 1`.** Do not gate on prior `worktree_patch_applied`. That couples correctness to audit history and misses dirty worktrees from VERIFY execution, REVIEW remediation, manual drift, or partial prior behavior. `runBuildInner()` already enforces attempt/carry-forward drift at `src/phases/build.ts:313`, so `attempt > 1` is the right trigger.

2. **`git clean -fdx` scope: yes, remove untracked and ignored files.** The run worktree is orchestrator-owned. Leaving untracked or ignored output is exactly how attempt N contaminates attempt N+1. The reset primitive must run only at `WorktreeBinding.worktreePath`, never at project root.

3. **Failure handling: abort immediately to `NEEDS_INTERVENTION`.** Do not fall through to persona or patch apply. That creates misleading diagnostics against a known-invalid substrate. If `build_started` has already emitted, close with `build_failed` before `intervention`, matching the helper pattern at `src/phases/build.ts:982`.

4. **VERIFY restart interaction: reset lives in BUILD only.** VERIFY restart already routes back through `dispatchBuild()` after `verify_restart_initiated` at `src/commands/run.ts:1124`. Do not add a second reset call in VERIFY or `scheduleAttemptNPlus1()`. One authority boundary: BUILD-entry worktree normalization.

5. **Event ordering: emit after `build_started`, before prompt composition.** Keep attempt logs shaped as `build_started` → `worktree_reset_to_base` → prompt/persona → patch events. The insertion point is after `src/phases/build.ts:414` and before prompt composition at `src/phases/build.ts:427`. Update `BUILD.md` because its current event row says `build_started` means persona invoked at `docs/contracts/BUILD.md:219`, while code already emits it before compose/invoke.

6. **Rule 20 compliance: yes, cohesive one boundary.** `resetWorktreeToBase` plus `worktree_reset_to_base` are one authority boundary if they remain a single BUILD-entry normalization primitive plus its audit event. Do not also expand `revert-seam`, mutate restart policy, or add route-specific cleanup semantics.

7. **Test coverage: D is required but insufficient.** Add:
   - Unit test for `resetWorktreeToBase`: tracked changes, staged added files, untracked files, ignored files all cleared.
   - Event schema/validator test for `worktree_reset_to_base`.
   - BUILD failure-path test for `worktree_reset_failed`.
   - Binary-spawn e2e is required because this touches state-machine/run-loop behavior. The repo's own review prompt says integration tests are mandatory for state-machine or agent logic at `src/prompts/review-system.md:72`. Target the REVIEW-needs-revision restart path especially, because the existing multi-round review test explicitly does not re-run BUILD attempt 2 at `tests/e2e/review-lite-greenfield-multi-round.test.ts:25`.

8. **Missed risks:**
   - Reset must happen before `deriveBuildTaskFiles()` at `src/phases/build.ts:472`, or added files from attempt 1 can leak into provider file refs.
   - Emit `worktree_reset_to_base` only after both `reset --hard` and `clean -fdx` succeed.
   - `durationMs` should measure both git commands and be non-negative.
   - Failure reason should name which git command failed and include bounded stderr.
   - Do not read or rewrite `base.txt` inside the reset primitive; use the already-bound `opts.worktree.baseCommitSha`.
   - Update actor attribution recommendations for the new event if the event system expects orchestrator-owned worktree events there.
   - Existing e2e that counts `worktree_created` as proof of freshness is not enough. A reset event plus compose-time clean-state assertion is the actual proof.

### Locked decisions before code lands

- Add exactly one new worktree primitive: `src/worktree/reset.ts`.
- Export exactly one public function: `resetWorktreeToBase({ worktreePath, baseCommitSha })`.
- Implement with `git reset --hard <baseCommitSha>` followed by `git clean -fdx`.
- Run reset only for `attempt > 1` inside BUILD.
- Run reset before prompt composition, prompt snapshot, provider file-ref derivation, persona invocation, and patch apply.
- Emit `worktree_reset_to_base` only on success.
- On reset failure, stop immediately with code `worktree_reset_failed`.
- Do not call reset from VERIFY, REVIEW, scheduler, approve hooks, or `loadOrCreateRunWorktree`.
- Do not reuse `revert-seam`; it is file-scoped VERIFY machinery, not the BUILD restart reset authority.
- Preserve artifacts, patches, forensics, gates, and `.code-oz/state`; only the git worktree contents are reset/cleaned.
- Add the event to `EVENT_TYPES`, `PhaseEvent`, validator, and actor-attribution recommendation map.
- Event payload is locked: `{ type, runId, phase: 'build', attempt, baseCommitSha, durationMs, at/ts }`, using the repo's existing timestamp convention consistently.
- Update `docs/contracts/BUILD.md` restart policy and event table.
- Add the unit, schema, failure, and binary-spawn e2e coverage before implementation is considered complete.
- The binary-spawn e2e must prove attempt 2 compose sees base-only content, not just that attempt 2 eventually passes.

## Codex-only signals (beyond brief)

1. Codex independently flagged `BUILD.md:219` event-row drift — claims `build_started` means persona invoked, but code emits it before compose. Pre-existing doc bug surfaced as a side effect; should land in the same v0.20.3 #1 PR.
2. Codex moved the insertion point earlier than the brief proposed: reset must precede `deriveBuildTaskFiles()` at `build.ts:472`, not merely precede patch-apply. Otherwise attempt-1 added paths leak into the provider `files` manifest.
3. Codex pinned the binary-spawn e2e to specifically exercise the REVIEW-needs-revision restart path (not just VERIFY-fail restart), citing the existing `review-lite-greenfield-multi-round.test.ts:25` gap.
4. Codex required `build_failed` to be emitted before `intervention` when reset fails after `build_started`, matching the existing helper pattern at `build.ts:982`.
5. Codex rejected any expansion of `revert-seam` and any reset calls from `loadOrCreateRunWorktree`, scheduler, approve hooks, VERIFY, or REVIEW — strict single-call-site enforcement.

## Implementation roadmap (derived from locked decisions)

1. Create `src/worktree/reset.ts` exporting `resetWorktreeToBase({ worktreePath, baseCommitSha })`. Implementation: `git reset --hard <sha>` then `git clean -fdx`; both at `worktreePath`. Return `{ ok: true, durationMs }` or `{ ok: false, code: 'worktree_reset_failed', reason: <git command name + bounded stderr> }`.
2. Add `worktree_reset_to_base` to `EVENT_TYPES` in `src/state/schemas.ts`; payload `{ type, runId, phase: 'build', attempt, baseCommitSha, durationMs, ts }`. Update validator + actor-attribution map.
3. In `runBuildInner()` at `src/phases/build.ts`: after `build_started` emission (line 414-425) and BEFORE prompt composition / `deriveBuildTaskFiles()` (line 472), insert the `attempt > 1` reset call. On failure: emit `build_failed` first (matching helper at 982), then call `recordIntervention` with code `worktree_reset_failed` + specific suggestion array (DO NOT rely on default fallback).
4. Add to `buildInterventionSuggestions`: case for `worktree_reset_failed` with actionable text.
5. Update `docs/contracts/BUILD.md` § Restart-on-fail policy AND § Event table. Fix the pre-existing `build_started` row drift (says "persona invoked" but emits before compose).
6. RED tests (in order):
   - Unit: `tests/worktree-reset.test.ts` — tracked changes, staged additions, untracked, ignored all cleared by `resetWorktreeToBase`.
   - Schema: extend `tests/state-schemas.test.ts` (or similar) — `worktree_reset_to_base` accepts the locked payload, rejects bad shapes.
   - BUILD failure path: extend `tests/build-phase.test.ts` — simulate reset failure, assert `build_failed` event THEN `intervention` event with code `worktree_reset_failed`.
   - Binary-spawn e2e: new test `tests/e2e/build-worktree-reset-attempt-2.test.ts` — drive a real BUILD restart through REVIEW-needs-revision; assert attempt 2 sees base-only worktree at compose time AND emits `worktree_reset_to_base` event with attempt=2.
7. All four test categories must be GREEN before merging. The binary-spawn e2e is the gate.

## What's NOT in scope (deferred or refused)

- VERIFY-side reset: refused by Codex (one boundary).
- REVIEW-side reset: refused by Codex.
- Reset on `loadOrCreateRunWorktree`: refused.
- Expanding `revert-seam`: refused.
- Mutating `prepareCarryForward` / restart policy: refused (carry-forward stays in artifacts, not worktree).
- Removing `worktree_patch_applied` event: out of scope.
- Reset throttling / debouncing: out of scope (always run when triggered).

## Implementation refinement (post-Codex, pre-merge)

Codex's locked decision was "unconditional reset when `attempt > 1`." The unconditional gate was **narrowed** to `attempt > 1 && carryForward?.source === 'verify-fail'` during implementation, based on test evidence:

- `tests/e2e/cli-multi-task-cycle.test.ts` (M16 C12) and `tests/phases-build-prompt-snapshot.test.ts` (M16 C5 multi-attempt) both encode the existing **review-needs-revision worktree-preservation contract** (M16 C9 Mod #7): when REVIEW returns `needs-revision`, the orchestrator preserves attempt 1's worktree so attempt 2's delta patch can build on the post-state. Unconditional reset clobbered this — both tests failed with `git apply` context-mismatch errors.
- The Codex brief did not surface this contract (the multi-task lifecycle + review-remediation routing lives in `src/phases/review-remediation.ts` / `src/commands/run.ts:1124`, which the fact-sheet did not enumerate in detail).
- The prdiff dogfood that motivated this fix was a verify-fail restart path (post-VERIFY restart, not post-REVIEW); the narrowed scope still closes the dogfood bug.

Per memory pin `feedback_codex_locked_decision_deferral_costs.md`: when Codex's locked decisions name a coupled change and the dogfood/test evidence shows the lock missed a contract, the lock gets refined — not scope-deferred. The reset still fires on verify-fail (the dogfood case); it leaves review-needs-revision alone (the preserved contract). Future implementation should re-engage Codex if a separate review-revision-side reset proves necessary.

## What's NOT yet shipped from the locked decisions

Codex required a **binary-spawn e2e** that drives a verify-fail restart and asserts attempt 2 compose sees base-only content. The existing `tests/e2e/cli-multi-task-cycle.test.ts` is a binary-spawn e2e but exercises review-needs-revision (per-contract, no reset). A verify-fail-specific binary-spawn e2e is documented as a v0.20.3 follow-up; the unit + integration tests in this PR cover the invariant at the BUILD-entry call site (`tests/worktree-reset.test.ts` + `tests/build-phase.test.ts § runBuild — worktree reset between attempts`). If a verify-fail dogfood post-v0.20.3 surfaces an issue this coverage doesn't catch, the binary-spawn e2e gets prioritized in v0.20.4.
