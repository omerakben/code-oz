---
name: CODEX_RESPONSE_B1A_R1
status: closed
review-round: R1 (post-Commit-2 verification)
codex-model: gpt-5.5
codex-effort: xhigh
sandbox: read-only
thread-id: 019e1807-46d2-7260-a133-714f7851b310
date: 2026-05-12
verdict: fix-first
briefing: docs/design/CODEX_BRIEFING_B1A_R1.md
target-commit: b605f48 (Commit 2 of 2)
---

# Codex R1 response — B1a Commit 2

## Verdict
fix-first

Runtime behavior for the R0 blocker is closed, but R0 doc/comment closures are still incomplete. I would not merge this to local main with rule-23 contract text still contradicting the implementation.

## (1) R0 fixes verified
B1: verified at runtime. `applyRecordedEffort` reads the recorded event and replaces `config.budgets` with `recorded.effectiveBudgets`, not `applyEffort(currentConfig, recorded.effort)`: `src/commands/run.ts:651`, `src/commands/run.ts:669`. The cast is acceptable for self-written events because `initRun` snapshots typed `Budgets` via JSON round-trip: `src/state/run.ts:133`, `src/state/run.ts:310`. It is not a tamper-proof deep validator, but that is consistent with the schema-light design.

F1: verified. The fresh-run comment now says second event, between `run_started` and `phase_entered`: `src/commands/run.ts:304`.

F2: verified. The design doc quote is rule `23.`: `docs/design/B1A_EFFORT_FLAG.md:137`.

F3: verified. The `.catch(() => [])` was removed from `applyRecordedEffort` and `readRecordedEffort`: `src/commands/run.ts:651`, `src/commands/run.ts:677`. `readEvents` returns `[]` only for missing files and throws on malformed logs: `src/state/events.ts:2600`, `src/state/events.ts:2660`. The throw propagates through `runCommand` to the CLI top-level error handler, which is the intended fail-closed behavior: `src/cli.ts:79`.

F4: partial. The main docblock and inline comment are now honest: `src/state/run.ts:211`, `src/state/run.ts:268`. But the option comment still says "event fires unconditionally" while the guard is conditional: `src/state/run.ts:237`, `src/state/run.ts:300`. `src/state/schemas.ts` also still says recording is unconditional: `src/state/schemas.ts:1449`.

F5: verified. Explicit `--effort` on a legacy active run is rejected when `recorded === null`: `src/commands/run.ts:185`, `src/commands/run.ts:188`. The stderr names both options: resume without `--effort`, or start fresh: `src/commands/run.ts:729`.

F6: partial. The event union type no longer has top-level `byRole`, and the nested placement is documented there: `src/state/schemas.ts:1469`. But nearby comments still say optional top-level `byRole`: `src/state/schemas.ts:1456`, `src/state/events.ts:2199`. The design doc touchlist also still says the payload contains `{ global, perPhase, byRole }`: `docs/design/B1A_EFFORT_FLAG.md:116`.

F7: verified. The actionable design-doc paths now point to `tests/e2e/cli-effort-envelope.test.ts`: `docs/design/B1A_EFFORT_FLAG.md:119`, `docs/design/B1A_EFFORT_FLAG.md:152`.

## (2) Active-run replay across four reload sites
dispatchPlan: verified. Reloads raw config, applies recorded effort before bootstrap, then passes that config into `invokeCtx`: `src/commands/run.ts:1158`, `src/commands/run.ts:1183`.

dispatchBuild: verified. Same recorded-envelope reload before bootstrap, then `invokeCtx.config` reaches `runBuild`: `src/commands/run.ts:1288`, `src/commands/run.ts:1483`.

dispatchVerify: verified. Same path before verifier/scientist lookup, then into `runVerify`: `src/commands/run.ts:1595`, `src/commands/run.ts:1730`.

dispatchReview: verified. Same path before reviewer/scientist lookup, then into single or panel review invokers: `src/commands/run.ts:1905`, `src/commands/run.ts:2032`.

Budget enforcement consumes `ctx.config` at the provider chokepoint: `src/providers/invoke.ts:121`, `src/providers/cost.ts:221`. `approve` does not need the recorded envelope because it validates gates/artifacts and does not invoke providers or budget checks: `src/commands/approve.ts:92`, `src/commands/approve.ts:173`.

## (3) New e2e test coverage
`active-run replay uses RECORDED effectiveBudgets...`: adequate for the B1 regression. It sabotages live YAML to make old semantics fail on PLAN's second provider call, then verifies the recorded `24` call cap governs: `tests/e2e/cli-effort-envelope.test.ts:293`, `tests/e2e/cli-effort-envelope.test.ts:325`, `tests/e2e/cli-effort-envelope.test.ts:375`. Gap: it only exercises `dispatchPlan` dynamically. Static trace covers the other three reload sites.

`active-run rejects explicit --effort when no recorded envelope...`: adequate. The stripped-event legacy synthesis is realistic enough for the reader contract and asserts exit 2 plus legacy-run stderr: `tests/e2e/cli-effort-envelope.test.ts:393`, `tests/e2e/cli-effort-envelope.test.ts:411`, `tests/e2e/cli-effort-envelope.test.ts:427`.

I did not rerun tests because this pass was constrained to read-only review. `git diff --check 252baac..HEAD` was clean.

## (4) Missed angles
The main missed angle is doc/comment drift inside the contract files changed by this commit. `docs/design/B1A_EFFORT_FLAG.md` still says active-run reload re-applies `applyEffort()` from the event, which is exactly the old B1-bug shape: `docs/design/B1A_EFFORT_FLAG.md:118`. That should be changed to "read recorded `effectiveBudgets` directly."

No runtime approve/doctor site appears to need the recorded envelope. Crash recovery with missing `current.json` is covered by event-derived `loadRun`; replay happens later at the dispatch sites.

## Additional findings
fix-first: Clean up the remaining contradictory rule-23 comments/docs in a follow-up commit:
- `src/state/run.ts:237` says event fires unconditionally.
- `src/state/schemas.ts:1449` says recording is unconditional.
- `src/state/schemas.ts:1456` and `src/state/events.ts:2199` still imply top-level `byRole`.
- `docs/design/B1A_EFFORT_FLAG.md:116` and `docs/design/B1A_EFFORT_FLAG.md:118` still carry the old payload/replay model.

## Sign-off
verdict: fix-first

Close the doc/comment drift in a new follow-up commit, not by amending `b605f48`. Runtime replay can merge after that cleanup and a final narrow R2 check.

---

## Maestro action plan (R1 closure)

Six doc/comment drift sites to clean up in a follow-up commit:

1. `src/state/run.ts:237` — option JSDoc on `originalBudgets` opt says "event fires unconditionally" — change to "event fires when at least one of `originalBudgets` / `effectiveBudgets` is supplied".
2. `src/state/run.ts:~300` — the inline comment in initRun still says "unconditional" — same change.
3. `src/state/schemas.ts:1449` — schema-level comment says "Recording is unconditional — `--effort` flag absent records `effort='balanced'` with `multiplier=1.0`" — this is misleading because the recording is conditional on budgets being supplied. Reword to match the guard.
4. `src/state/schemas.ts:1456` — comment implies optional top-level `byRole?` — already removed from the type but the comment lingers. Strip.
5. `src/state/events.ts:2199` — comment with same top-level `byRole?` implication. Strip.
6. `docs/design/B1A_EFFORT_FLAG.md:116` — touchlist describes payload as `{ global, perPhase, byRole }` — fix to `{ global, perPhase }` (byRole lives nested under global).
7. `docs/design/B1A_EFFORT_FLAG.md:118` — describes active-run reload as "re-applies applyEffort() to the recorded envelope" — this is the OLD B1-buggy shape. Change to "reads `effectiveBudgets` directly from the recorded event".

After closure: run typecheck + full test suite (must still be 3163 pass), then R2 (narrow scope: verify these 7 sites cleaned up). Merge to local main after R2 = push.
