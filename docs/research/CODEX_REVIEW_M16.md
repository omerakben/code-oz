# Codex review — M16 production CLI completion

**Round:** R1 (post-implementation review)
**Branch:** `feat/m16-cli-completion`
**HEAD:** `9384522` (C13 closure)
**Origin tip:** `e25f3d4` (v0.16.0-alpha.0, M15 release)
**Commits ahead of origin/main:** 27
**Test count:** 2706 → 3088 (+382 tests, 0 fail, 1 skip, 7488 expect calls)
**Typecheck:** clean
**Smoke (`bun run smoke` against rebuilt binary):** ok in 1.168s
**Doctor run on sample:** prints "no active run", exits 0 — clean

## R0 verdict

R0 was `feature-with-modifications` (`docs/research/CODEX_RESPONSE_M16.md`, thread `019e0a59`). The R0 modifications were: structural blind spot — no task lifecycle cursor; M16/M17 split locked; 9 risks called out + 8 modifications. R0 was fully accepted in `971988d` (synthesis kickoff lock).

## Implementation summary

13 planned commits (C1-C13) + 7 unplanned C9 follow-on commits (closing 8 production bugs surfaced by the C12 e2e). Commit list in chronological order:

| # | SHA | Subject | Axis |
|---|---|---|---|
| C1 | `1f05673` | per-task lifecycle cursor events + projection helper | task cursor |
| C2 | `37910db` | cross-process fake-replay fixture | fake-script |
| C2.1 | `e81e9ec` | validate chunks/toolCalls + deep-freeze | C2 follow-on |
| C3 | `a88b86a` | production seams + exit code contract | seams + exit codes |
| C4 | `2ebab81` | idempotent worktree wrapper + build/verify locks | worktree wrapper |
| C5 | `5a572a1` | BUILD prompt persistence + preApproveBuildHook | BUILD persistence |
| C6 | `173d5fb` | dispatchBuild + --task override + restart resolver | BUILD dispatch |
| C7 | `7c680ce` | dispatchVerify + restart-loop routing + sha re-validation | VERIFY dispatch |
| C8 | `370ed97` | dispatchReview + remediation event + sha re-validation | REVIEW dispatch |
| C9 | `b3cf975` | task-loop dispatch + review-needs-revision route + worktree task-boundary recreate | task-loop |
| C10 | `36afd6b` | code-oz doctor run read-only inspector | doctor run |
| C11 | `18e80eb` | --provider fake stderr banner + emission event | fake banner |
| C9.1 | `c262efd` | cursor-aware ship transition + gate-file task-boundary lifecycle | C9 fix Bugs 1+2 |
| C9.2 | `5d21d9b` | phase_entered(build) on task boundary in approve-review | C9 fix Bug 3 |
| C9.3 | `3719403` | task-boundary supersedence in phase-transition helpers | C9 fix Bug 4 + class |
| C9.4 | `bb285bc` | attempt-boundary supersedence in clearStaleGateFile | C9 fix Bug 6 |
| C9.5 | `e041c48` | phase_entered(build) on attempt-boundary pre-routes | C9 fix Bug 7 |
| C9.6 | `0ac0f82` | resolveNextReviewRound walks across attempts | C9 fix Bug 9 |
| C9.7 | `c401dc7` | emit task_review_passed in dispatchReview | C9 fix Bug 10 |
| C12 | `08f4d45` | multi-task BUILD/VERIFY/REVIEW cycle via CLI binary spawn | e2e |
| C13 | `9384522` | close M16 — production CLI completion | docs closure |

## C6-C13 acceptance status

All closed. Each commit includes inline closure of its Codex pre-design modifications (the per-commit cross-model peer review pattern from memory `feedback_per_commit_cross_model_review`). Pre-design rounds were applied to load-bearing commits (C6, C7, C8, C9, C12); light commits (C10, C11, C13) skipped pre-design per the loop plan.

Pre-design closure counts:
- C6: 8 mods (7 block-push + 1 fix-soon).
- C7: 7 mods (3 block-push + 3 fix-soon + 1 nit).
- C8: 10 mods (5 block-push + 4 fix-soon + 1 nit; verdict was `redesign`).
- C9: 10 mods (7 block-push + 2 fix-soon + 1 nit; verdict was `redesign`).
- C12: 10 mods (4 block-push + 5 fix-soon + 1 nit).
- Total inline closures: 45 modifications across 5 commits, every one closed before commit.

## C9 follow-on bugs — empirical lesson

C12 e2e exposed 8 production bugs in C9's "task-loop dispatch" surface that no Codex pre-design or per-commit unit test caught. Each bug was a real coupling issue between approveReviewTaskGate and adjacent state-machine helpers:

| Bug | Class | Helper | Fix commit |
|---|---|---|---|
| 1 | Phase advancement (terminal, task) | `completeIncompleteTransitions` cursor-unaware ship | `c262efd` |
| 2 | Gate-file lifecycle (task) | `clearStaleGateFile` task boundary | `c262efd` |
| 3 | Phase advancement (iterate, task) | `approveReviewTaskGate` no `phase_entered(build)` | `5d21d9b` |
| 4 | Class fix | 5 sibling helpers missing `gate_file_cleared` supersedence | `3719403` |
| 6 | Gate-file lifecycle (attempt) | `clearStaleGateFile` attempt boundary | `bb285bc` |
| 7 | Phase advancement (attempt) | review-remediation + verify-restart pre-routes | `e041c48` |
| 9 | Resolver carry-forward | `resolveNextReviewRound` strict attempt equality | `0ac0f82` |
| 10 | Missing emission | `task_review_passed` event defined but never emitted | `c401dc7` |

Pattern: M16 helpers were authored under single-task / single-attempt / single-round assumptions. Multi-task multi-attempt requires walking across the relevant dimension. The unifying root: rule 20 (one new authority per milestone) needs sharper application — C9 bundled six sub-surfaces under "task-loop dispatch" and the breadth let coupling bugs through. The milestone-level e2e was the lens that exposed all 8.

Two fixture issues (Bugs 5 + 8/11) closed in C12's commit — Bug 5 (verify-fail vs review-needs-revision semantic difference; attempt-2 patch is delta on attempt-1 post-state, not fresh-against-base) and Bug 8/11 (default per-phase budget caps don't scale to multi-task; fixture overrides them, M17 should consider per-task scaling).

## R1 review scope

Codex, please review the full M16 milestone for:

1. **Material correctness.** Walk the diff `git diff e25f3d4..9384522`. Are there bugs that the C12 e2e didn't surface? Audit:
   - Each new event type (`task_review_passed`, `review_remediation_recorded`, `gate_file_cleared`, `fake_provider_warning_emitted`) — schema correctness, validator coverage, emission discipline.
   - The 5 phase-transition helpers extended in `3719403` — supersedence logic correct?
   - `resolveNextReviewRound` walk-across-attempts logic — does it correctly handle the carry-forward chain in all attempt orderings?
   - `approveReviewTaskGate`'s cursor-aware emission — race conditions under concurrent invocation? Idempotency under operator double-approve?
   - Worktree task-boundary recreate (`loadOrCreateRunWorktree` case #5) — fixed by C9 — any edge cases for resume mid-recreate?

2. **Surface boundaries.** Has any milestone authority leaked outside its declared scope? Specifically:
   - Did C8 dispatchReview accidentally take responsibility that belongs to runReview?
   - Did C9's `approveReviewTaskGate` violate L2 (no autoadvance through phases or tasks without operator approval)?
   - Are the 7 C9 follow-on commits really a single bug class, or is there hidden scope creep?

3. **Test coverage gaps.** The C12 e2e was decisive but is the e2e SUFFICIENT? Audit:
   - VERIFY-fail restart path: per the prior C12 agent's report, "no existing test exercises that approve-after-verify-restart sequence end-to-end through the binary." Bugs 6 and 7 were latent on that path. Is there now coverage?
   - Resume scenarios: does any test validate `code-oz run` mid-attempt (after a process kill) recovers correctly?
   - Panel mode: C12 explicitly disables panel mode. Is there integration coverage for panel mode multi-task?

4. **Documentation accuracy.** ROADMAP.md M16 entry, CLI --help, kickoff closure annotation — accurate?

5. **Known UX gap.** Default per-phase budgets (`verify.maxProviderCalls=5`) don't scale to multi-task PLANs. C12 fixture overrides them. Is this acceptable as a known issue for M17, or does R1 require closing in M16?

## Verdict

Return one of:
- `push` — milestone is shipping-ready. No block-push or block-next-milestone findings.
- `fix-first` — block-push or block-next-milestone findings; close before push approval.
- `debate-required` — non-trivial design disagreement; needs a debate round before resolution.

Use the standard severity taxonomy: block-push, block-next-milestone, fix-soon, nit, fyi. Cite file:line for every claim.

## Resume scenario for the dogfood

If R1 verdict is `push`, the Ring 2 dogfood project (`~/Projects/code-oz-dogfood/`) should now resume from CLI alone and reach `currentPhase: ship` with `task_completed` events for T-001 / T-002 / T-003. Per loop plan line 139, this is the manual acceptance gate.

---

# R1 verdict: `fix-first`

Codex thread `019e0fef-8748-78f3-819a-3052a7a96bcd`. Returned 4 block-push + 1 fix-soon.

| # | Severity | Issue | Location | Fix commit |
|---|---|---|---|---|
| 1 | block-push | `hasGateRequired` not (taskId, attempt) scoped | `dispatch-verify-helpers.ts:157` | `70107dc` |
| 2 | block-push | `loadOrCreateRunWorktree` called outside declared phase lock | `load-or-create-run-worktree.ts:25`, `run.ts:1222/1482/1780` | `ba8558d` |
| 3 | block-push | Worktree recreation can lose `worktree_created` audit event on crash | `load-or-create-run-worktree.ts:214/454` | `71ba332` |
| 4 | block-push | Default `verify.maxProviderCalls=5` doesn't fit canonical multi-task path | `config/schema.ts:297` | `858ea90` |
| 5 | fix-soon | `task_started` not idempotent across pre-build crash | `run.ts:1252` | `70107dc` |

Maestro decisions on Codex's options:
- Finding 2: Option A (dedicated worktree-level lock) — Option B violates C4 M2 "dispatcher does NOT hold the phase lock."
- Finding 3: combined — require strictly-after-destroy event AND emit recovery event under lock if subdir exists without one.
- Finding 4: raise defaults (build/review 60/30/1.5M, verify 30/30/600k); per-task scaling deferred to future milestone.

Plus coverage gap closure: new VERIFY-fail restart e2e at `tests/e2e/cli-verify-fail-restart.test.ts` (commit `8ea4dff`) exercising the destroy-and-recreate path.

Bonus production fix surfaced during the e2e implementation: verify-fail recreation pattern (sibling to C9 Mod #6's task-completed recreation) — closed inline via `isPostVerifyFailRecreation` alongside `isPostTaskCompletedRecreation`.

R1 fix-first commits (6 commits, 70107dc..f8e385e): +20 tests (3088 → 3108).

---

# R2 verdict: `push`

Codex thread `019e128e-fe7f-7890-b665-e0eb7174a231`. No block-push, block-next-milestone, fix-soon, or nit findings.

Closure verification confirmed for all 5 R1 findings:
- Finding 1: `findLatestVerifyCompletedIndex()` + forward-only `gate_required` search; unit test pins prior-task masking case.
- Finding 2: wrapper self-locks via `.worktree.lock` before `loadOrCreateRunWorktreeLocked()`; concurrency test pins at-most-one-create invariant.
- Finding 3: latest-created-vs-latest-destroyed walk + audit-completeness recovery branch under lock.
- Finding 4: defaults raised (build/review `60/30/1.5M`, verify `30/30/600k`); still bounded by global caps.
- Finding 5: `dispatchBuild` gates `task_started` on prior `(runId, taskId)` presence, not `attempt === 1`.

Sibling-bug check clean: supersedence pattern applied across `requireGate`, `recoverOrphanGates`, `completeIncompleteTransitions`, `completeTransitionForPhase`, `approveReviewTaskGate`, `validateRunIntegrity` (shared index helper at `src/state/run.ts:99`).

Codex couldn't run the test suite in its read-only sandbox (mkdtemp EPERM). Maestro independently verified main repo: 3108 / 0 fail / 1 skip, typecheck clean, smoke ok against rebuilt binary.

## M16 closure

- Total commits ahead of origin/main pre-tag: 33 (20 from session start + 13 R1 + tag-bump pending).
- Final test count: 2706 → 3108 (+402 across full M16 + R1).
- 12 production bugs caught and closed within M16 (8 from C12 e2e + 4 from Codex R1).
- Tag: `v0.17.0-alpha.0` (post-bump, post-merge).
- Push approval granted by Ozzy 2026-05-10 (after R2 push verdict).
