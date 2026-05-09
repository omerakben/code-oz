# Session M16 implementation kickoff — Production CLI completion (post-R0 lock)

**Locked:** 2026-05-09
**Branch:** `feat/m16-cli-completion` at `a1d0af0` (Codex R0 verdict committed)
**Authority boundary (rule 20):** production CLI dispatch surface for the M7-M15 runtime + durable task cursor for multi-task PLANs. SHIP runtime authority + full resume defer to **M17** per Codex's recommended split.

## Trigger and ground

Ring 2 dogfood on `~/Projects/code-oz-dogfood` halted at BUILD because `code-oz run` only dispatches DEFINE+PLAN. Briefing at `docs/research/CODEX_BRIEFING_M16.md`; Codex R0 response at `docs/research/CODEX_RESPONSE_M16.md` (thread `019e0a59`, verdict `feature-with-modifications`).

Codex's central pushback: **the lean missed task scheduling.** PLAN.md supports multiple `T-NNN` tasks, but the state machine only knows phases. Without a durable task cursor, M16 would silently ship only the first task. The dogfood's own PLAN has three tasks (T-001 scaffold, T-002 module, T-003 CLI). This is the structural blind spot the cross-model peer review existed to surface.

## Locked scope (post-Codex)

**M16 ships:**

1. Durable task cursor + per-task lifecycle events
2. Production seams (`productionInvokePersona`, `productionRunner`, `productionRevertSeam`)
3. Cross-process fake-replay fixture (so the CLI e2e is real, not direct-import)
4. Idempotent `loadOrCreateRunWorktree` wrapper
5. BUILD prompt-snapshot persistence (so VERIFY forensics survive resume)
6. Per-phase orchestration locks (`build.lock`, `verify.lock`)
7. `dispatchBuild` + `dispatchVerify` + `dispatchReview` in `run.ts`
8. `preApproveBuildHook` validation + `BUILD_REPORT.md` post-edit guard
9. Task-loop dispatch (after REVIEW.ready for task N, advance to BUILD task N+1; only after the last task's REVIEW passes does state advance to `ship`)
10. `code-oz doctor run` — read-only state inspector
11. Exit code contract + a one-line progress format for long persona invocations
12. CLI e2e test that spawns the actual binary and walks DEFINE → REVIEW for a multi-task PLAN to `currentPhase: ship`
13. `--provider fake` warning banner in production runs (loud, recorded in events.jsonl)

**M17 ships (deferred):**

- `src/phases/ship.ts` (`runShip`) writing canonical `SHIP.md` + `gate_required(ship)`
- `preApproveShipHook` + `approve ship` consumes the gate
- `code-oz resume` command (full resume-from-state authority)
- `code-oz intervention resolve <code>` (clears `NEEDS_INTERVENTION.json` after operator action)
- AUDIT phase rejection messaging (M16 emits a precise "AUDIT runtime not implemented" error if `currentPhase === 'audit'`; full AUDIT runtime is M17+)

## R0 closure decisions (Q1-Q13)

### Q1 — task cursor (PUSH accepted, biggest reshape)
**Decision:** durable task cursor in events.jsonl. New event types: `task_started`, `task_review_passed`, `task_completed`. Task state derived from event projection (rule 1: file-based gate signals — no parallel state). `dispatchBuild` resolves "next pending task" by walking PLAN.md tasks in order and finding the first one without a `task_completed` event. `--task T-NNN` overrides for explicit operator control. Resume-safe: in-flight BUILD attempt is detected via `build.lock` + `build_started` without `build_completed`.

### Q2 — worktree creation (ACCEPT-WITH-MODIFICATION)
**Decision:** new `loadOrCreateRunWorktree` wrapper in `src/worktree/load-or-create-run-worktree.ts`. Verifies `base.txt`, idempotent on existing run path, emits `worktree_created` exactly once (or verifies the prior emission's sha matches), refuses orphaned partial dirs with `worktree_partial_state` intervention.

### Q3 — verify attempt source (ACCEPT-WITH-CROSS-CHECK)
**Decision:** `dispatchVerify` reads `BUILD_REPORT.md` for task+attempt AND verifies matching `build_completed` + `build_provider_recorded` events before invoking VERIFY. **BUILD prompt snapshot is now persisted by `runBuild`** as `.code-oz/runs/<runId>/build-attempt-<N>.prompt.txt` (atomic write, sha256 recorded in `build_completed` event). VERIFY reads this from disk; the dispatcher does NOT reconstruct the prompt.

### Q4 — review round resolution (ACCEPT-WITH-STRONGER-RULES)
**Decision:** `dispatchReview` cross-checks prior `REVIEW.md` taskId/attempt against `review_round_completed` sha. If prior verdict was `needs-revision`, round comes from the remediation decision's `nextReviewRound`, not recomputed. New helper `resolveNextReviewRound(events, reviewMd?)` in `src/phases/review-resume.ts`.

### Q5 — debate scheduler output (ACCEPT, NON-BLOCKING)
**Decision:** print a compact one-line summary when M15 auto-mode fires (e.g., `[scheduler] grey-zone fire → debate vs claude → corrective verdict ready (1 actionable added)`). Not load-bearing for M16; full scheduler trace lives in `code-oz doctor run`.

### Q6 — runShip (PUSH accepted)
**Decision:** **deferred to M17.** The lean conflicted with existing gate architecture. M17 will ship: `src/phases/ship.ts` writing `SHIP.md` + `gate_required(ship)`, `preApproveShipHook` validating per-task `task_completed` count matches PLAN task count, `approve ship` consumes gate via existing `approveGate`. M16's last dispatched phase is REVIEW; after the last task's REVIEW passes, `currentPhase` stays at `review` for that task, and the task cursor advances to the next task's BUILD. Only when ALL tasks have `task_completed` does state machine logic advance `currentPhase` to `ship`.

### Q7 — resume on intervention (ACCEPT-WITH-PATH-CORRECTION)
**Decision:** `dispatchBuild/Verify/Review` all check for `.code-oz/state/runs/<runId>/NEEDS_INTERVENTION.json` at the top and refuse to advance, surfacing the intervention's actionable suggestions. Path correction: `.code-oz/state/runs/<runId>/`, not `.code-oz/runs/<runId>/`. Telling users to `git rm` is wrong (it's local-ignored state); message is "remove only after manual resolution; `code-oz intervention resolve` deferred to M17."

### Q8 — run vs resume (PUSH accepted)
**Decision:** `code-oz run` becomes phase-aware in M16 (it already needs to be for BUILD/VERIFY/REVIEW dispatch). `run` advances to the next unstarted phase OR the next pending task. `resume` (M17) is the explicit "pick up partial in-flight phase" command — distinguished from `run` by checking `build.lock`/`verify.lock`/`review.lock` for in-flight markers AND by handling phase-not-started-but-events-present states.

### Q9 — brownfield AUDIT (ACCEPT)
**Decision:** out of scope for M16. `code-oz run` rejects `currentPhase === 'audit'` with `audit_runtime_not_implemented` intervention message: "AUDIT phase has no runtime in v0.16; brownfield support deferred to a future milestone. Active run paused at AUDIT phase cannot proceed via CLI."

### Q10 — test coverage (PUSH accepted)
**Decision:** **C2 = cross-process fake-replay fixture** (moved early). New `--fake-script <path>` CLI flag accepts a JSONL transcript: each line is `{ matcher: { phase, agent }, response: { content } }`. Bootstrap loads the script when `--provider fake` + `--fake-script` are both present; FakeProvider expects against the script entries in declared order. The CLI e2e (C12) feeds the script for all five phases (BA, lead, builder, verifier, reviewer) so the spawned binary has deterministic responses across the whole DEFINE→REVIEW cycle. Test-only: production code paths cannot reach this fixture; the loader path is gated by env var `CODE_OZ_TEST_FAKE_SCRIPT_OK=1` to prevent accidental enabling in real runs.

### Q11 — milestone name (ACCEPT)
**Decision:** M16. Tag at `v0.17.0-alpha.0` after R1 push.

### Q12 — tag split (PUSH accepted)
**Decision:** split M16/M17. M16 ships everything in "Locked scope" above; M17 ships SHIP.md + runShip + resume + intervention-resolve. Single tag at end of M16 (`v0.17.0-alpha.0`); M17 tag (`v0.18.0-alpha.0`) closes the first true DEFINE → SHIP flow.

### Q13 — deferrals (ACCEPT-WITH-ADDITIONS)
**Confirmed deferrals:**
- AUDIT runtime (M17+)
- TUI inspector (W2.2)
- `code-oz reflect` + skill outcomes (W2.4)
- npm publish + Homebrew tap (W3 distribution track)
- SHIP packager (artifact production beyond gate writer)
- SHIP runtime + `code-oz resume` + `code-oz intervention resolve` (M17)
- Streaming chunked persona output to stdout (M16 ships one-line progress only)

## Risks accepted (R1-R9)

R1 (no task lifecycle cursor) → C1 task cursor + events.
R2 (SHIP bypasses gate architecture) → SHIP deferred to M17.
R3 (fake CLI e2e cannot script across processes) → C2 fake-script fixture.
R4 (BUILD prompt snapshot not durable) → C5 BUILD prompt-snapshot persistence.
R5 (concurrent run double-invokes phases) → C4 phase locks (`build.lock`, `verify.lock`; review already has its own lock).
R6 (approve build under-validated) → C8 `preApproveBuildHook`.
R7 (validation runner contract undefined) → C3 production seams contract.
R8 (exit code semantics undefined) → C3 exit code contract.
R9 (--provider fake contamination) → C13 fake-provider warning banner + `code-oz run` records `fake_provider_warning_emitted` event.

## Locked architectural decisions (do not relitigate)

L1. **Phase machine stays unchanged.** `define → plan → build → verify → review → ship` is canonical. Multi-task semantics live in event projection, NOT in the state machine. The task cursor advances `(currentPhase, currentTaskIndex)`; when `currentTaskIndex === plan.tasks.length` AND last `currentPhase === 'review'`, state machine advances to `ship`. This keeps M7-M15 runtime untouched.

L2. **No autoadvance through phases or tasks without operator approval.** Every gate transition still requires `code-oz approve <phase>`. After approving REVIEW for task N, `code-oz run` advances to BUILD for task N+1 (or to SHIP if no more tasks). The user always sees state changes coming.

L3. **Production seams as separate module.** `src/cli/production-seams.ts` exports `productionInvokePersona`, `productionRunner`, `productionRevertSeam`. Each has a unit test. Phase dispatchers compose them. This decouples seam complexity from dispatch logic.

L4. **CLI e2e test (C12) runs binary via `Bun.spawn`.** No direct imports of dispatchers. Pre-scripted fake responses via `--fake-script <path>` (C2). Asserts gate files land + currentPhase advances + task cursor walks all PLAN tasks.

L5. **Single-axis commits.** Each commit ships one axis. C1=task cursor, C2=fake-script fixture, C3=production seams + exit code contract, C4=phase locks + worktree wrapper, C5=BUILD prompt persistence + preApproveBuildHook, C6=dispatchBuild, C7=dispatchVerify, C8=dispatchReview, C9=task-loop dispatch (BUILD→VERIFY→REVIEW iterates per task), C10=`code-oz doctor run`, C11=fake-provider warning, C12=CLI e2e, C13=docs+ROADMAP+kickoff lock.

L6. **No new permission scopes, no new gates, no new agent personas.** M16 wires existing authorities; only new authority surface is the **task cursor** (a refinement of phase-state, not a new permission domain). Three new event types (`task_started`, `task_review_passed`, `task_completed`) added to the state schema.

L7. **Test-coverage discipline.** Per-commit acceptance: each commit's tests must close before the next commit lands. The CLI e2e (C12) is the milestone-level proof; per-dispatcher unit tests are the per-commit proof. Net delta target: 2706 → ~2900+.

## Commit sequence (C1-C13, single-axis per rule 20)

| # | Slice | Files (primary) | Acceptance |
|---|---|---|---|
| C1 | Task cursor + events | `src/state/schemas.ts` (new event types), `src/state/task-cursor.ts` (new pure helper), `src/artifacts/plan.ts` (task-list helpers), `tests/state-task-cursor.test.ts` | Task cursor derives `(currentTaskIndex, taskId)` from PLAN.md + events.jsonl. New events validated. No state-machine changes. |
| C2 | Fake-script fixture | `src/cli/bootstrap.ts` (`--fake-script` parse), `src/providers/fake.ts` (script-load helper), `tests/providers-fake-script.test.ts` | `--fake-script <path>` + `--provider fake` + env `CODE_OZ_TEST_FAKE_SCRIPT_OK=1` loads JSONL expectations into the shared FakeProvider. |
| C3 | Production seams + exit code contract | `src/cli/production-seams.ts` (new), `src/cli/exit-codes.ts` (new), `tests/cli-production-seams.test.ts`, `tests/cli-exit-codes.test.ts` | `productionInvokePersona` drains invokeAgent stream; `productionRunner` spawns validation command with timeout/truncation/log paths; `productionRevertSeam` git-stash semantics; exit codes 0/1/2 enumerated. |
| C4 | Phase locks + idempotent worktree | `src/worktree/load-or-create-run-worktree.ts` (new), `src/phases/build.ts` + `src/phases/verify.ts` (lock acquisition), `tests/worktree-load-or-create.test.ts`, `tests/phases-build-lock.test.ts` | `build.lock`/`verify.lock` mutually exclusive with concurrent invocations; worktree wrapper idempotent on existing dir; orphaned partial dir → intervention. |
| C5 | BUILD prompt persistence + preApproveBuildHook | `src/phases/build.ts` (snapshot write), `src/commands/approve.ts` (preApproveBuildHook), `tests/phases-build-prompt-snapshot.test.ts`, `tests/approve-build-hook.test.ts` | Prompt written atomically; sha256 recorded in `build_completed` event; preApproveBuildHook validates BUILD_REPORT.md + sha + post-edit detection. |
| C6 | dispatchBuild | `src/commands/run.ts` (dispatchBuild), `tests/cli-dispatch-build.test.ts` | dispatchBuild loads PLAN, resolves task via cursor, creates/reuses worktree, loads bundled builder+scientist, calls runBuild, surfaces BuildResult. Per-test exit codes asserted. |
| C7 | dispatchVerify | `src/commands/run.ts`, `tests/cli-dispatch-verify.test.ts` | Reads BUILD_REPORT.md + prompt snapshot, wires productionRunner + productionRevertSeam, calls runVerify, handles VerifyResult (completed/failed/intervention) and emits restart guidance on failed. |
| C8 | dispatchReview | `src/commands/run.ts`, `tests/cli-dispatch-review.test.ts` | Resolves round via `resolveNextReviewRound`, panel vs single mode, calls runReview, handles ReviewResult (resolved/needs_revision/blocked/intervention), prints scheduler summary if M15 fired. |
| C9 | Task-loop dispatch | `src/commands/run.ts` (`advanceAfterReviewApprove`), `src/state/task-cursor.ts` (extension), `tests/cli-task-loop.test.ts` | After REVIEW.ready + approve for task N: cursor advances to task N+1; `code-oz run` enters BUILD for N+1. After last task: cursor.completed=true; state machine advances to `ship` on next state-projection (consumed by M17). |
| C10 | `code-oz doctor run` | `src/commands/doctor-run.ts` (new), `src/cli.ts` (route), `tests/commands-doctor-run.test.ts` | Read-only inspector: prints active runId, currentPhase, task cursor, last 10 events, intervention state, worktree existence, scheduler events for current round. No state mutation. |
| C11 | --provider fake warning banner | `src/commands/run.ts`, `src/cli/bootstrap.ts`, `tests/cli-fake-provider-warning.test.ts` | Loud stderr banner on every dispatcher when --provider fake active; `fake_provider_warning_emitted` event recorded; absent in event log → CI test fails. |
| C12 | CLI e2e test (binary spawn, multi-task PLAN) | `tests/e2e/cli-multi-task-cycle.test.ts` (new), test fixture for fake-script | Spawns `bun run src/cli.ts` (or dist/code-oz), drives DEFINE → PLAN (multi-task) → BUILD/VERIFY/REVIEW × N tasks → currentPhase=ship. Asserts every gate file, every task_completed event, no double-invocation, no dangling lock. |
| C13 | Docs + ROADMAP + kickoff lock | `docs/design/ROADMAP.md` (M16 entry), `src/cli.ts` (--help text), kickoff doc closure annotation, package.json bump if tagged | LAST commit; only after all tests pass; ROADMAP closes M16; `--help` no longer says "M7 adds BUILD onward." |

## Verification gate before R1

After C13:
- `bun test` — 2706 → ~2900+ pass / 0 fail / 1 skip
- `bun run typecheck` — clean
- `bun run smoke` — passes against rebuilt binary
- **The Ring 2 dogfood project resumes from CLI alone** and reaches `currentPhase: ship` with all task cursor entries present (T-001/T-002/T-003 each have `task_completed` event).
- `code-oz doctor run` works against the dogfood project and reports clean state.
- CLI e2e test (C12) passes deterministically on the multi-task fixture.
- `code-oz run --help` no longer hedges. `code-oz --help` lists `doctor run`.
- Codex R1 verdict: `push` (after closing any block-push or fix-soon).

## Rules of engagement

- One single-axis slice per commit (rule 20). C6/C7/C8 each ship one phase dispatcher.
- After each commit: `bun test` + `bun run typecheck` clean before moving to the next.
- Commit messages follow conventional format. No "update memory" in subject lines. No emojis.
- Branch stays `feat/m16-cli-completion`; no merge to main until R1 says push.
- No future-milestone leakage: no SHIP runtime, no full resume, no intervention-resolve, no AUDIT runtime, no streaming UI, no distribution work.
- The Ring 2 dogfood project is the canonical real-world test target. Its current halted state is the resume case M16 must validate against.

## Defer to post-M16

- M17 — SHIP runtime (`runShip`) + `SHIP.md` + `preApproveShipHook` + `approve ship` + full `code-oz resume` + `code-oz intervention resolve`
- M18+ — AUDIT runtime + brownfield CLI
- W2.2 — TUI inspector + failure-recovery UX
- W2.3 — onboarding/tour mode
- W2.4 — `code-oz reflect` + skill-outcomes JSONL log
- W3+ — npm publish + Homebrew tap + Scoop bucket
- Streaming chunked persona output to stdout (currently buffered)
- SHIP packager (artifact production beyond gate writer)
