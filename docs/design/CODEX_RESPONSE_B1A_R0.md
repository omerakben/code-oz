---
name: CODEX_RESPONSE_B1A_R0
status: closed
review-round: R0 (read-only design review on the existing diff)
codex-model: gpt-5.5
codex-effort: xhigh
sandbox: read-only
thread-id: 019e17f8-88a8-7890-bc69-4786b627bdfd
date: 2026-05-12
verdict: fix-first
briefing: docs/design/CODEX_BRIEFING_B1A_R0.md
---

# Codex R0 response — B1a Commit 2

## Verdict
fix-first

Primary blocker: active-run replay records the effective budget snapshot, but does not replay it. It re-applies the recorded effort level to whatever config exists at resume time, so editing `.code-oz/config.yaml` mid-run changes the supposedly fixed active-run envelope.

## (a) Event order
Position 2 is correct. The envelope is a run-start invariant, not first-phase work. The implementation appends `run_started`, then `effort_envelope_applied`, then `phase_entered` in `src/state/run.ts:277`, `src/state/run.ts:293`, and `src/state/run.ts:309`. The e2e pins that order at `tests/e2e/cli-effort-envelope.test.ts:145`.

One fix-soon doc/code-comment cleanup: `src/commands/run.ts:295` still says the event is "the third event after run_started + phase_entered", which contradicts the lock.

If position 3 were chosen, the required changes are: `CLAUDE.md:44`, `docs/design/B1A_EFFORT_FLAG.md:80`, `docs/references/budgets.md:204`, `tests/e2e/cli-effort-envelope.test.ts:139`, plus the append order/comments in `src/state/run.ts:288`. I do not recommend that.

## (b) Renumber completeness
Full-worktree grep found one non-provenance miss:

- fix-soon: `docs/design/B1A_EFFORT_FLAG.md:137` still quotes the invariant as `22.`. That should be `23.`.

The other hits are deliberate provenance or the R0 briefing itself: `docs/design/B1A_EFFORT_FLAG.md:18`, `docs/design/B1A_EFFORT_FLAG.md:126`, and `docs/design/CODEX_BRIEFING_B1A_R0.md:23`. No actionable `rule 22` hits in `src/`, `tests/`, `src/prompts/`, README, or AGENTS. No top-level `skills/` directory exists in this worktree.

## (c) Coupling bugs
**block-push**: Active-run replay does not preserve the recorded envelope. `src/state/run.ts:299` records `originalBudgets` and `effectiveBudgets`, but `src/commands/run.ts:630` reads only the effort level and `src/commands/run.ts:641` applies it to the current loaded config. Fix: replay `event.effectiveBudgets` or apply effort to `event.originalBudgets`, not the current config. Add an e2e that starts a run, edits `.code-oz/config.yaml`, resumes, and proves the old recorded envelope still governs.

**fix-soon**: `applyRecordedEffort` and `readRecordedEffort` fail open on any event-read error via `.catch(() => [])` at `src/commands/run.ts:634` and `src/commands/run.ts:649`. `readEvents` already returns `[]` for missing files and throws for malformed logs at `src/state/events.ts:2600`. Remove the catch so replay fails closed.

**fix-soon**: "Emission is unconditional" is not true for direct `initRun()` callers. Comments claim unconditional at `src/state/run.ts:211` and `src/state/run.ts:265`, but the append is gated at `src/state/run.ts:293`. Keep the guard and make the comments honest: CLI fresh runs always pass budgets; low-level state tests/callers do not.

**nit**: JSON snapshot freeze loss is acceptable. Events are JSON; consumers should not rely on runtime `Object.freeze`. Also `applyEffort()` already returns mutable budget objects, and the unit test mutates the returned config at `tests/config-effort-unit.test.ts:337`. No blocker here.

**fix-soon**: Explicit `--effort` on a legacy active run with no recorded envelope is accepted but ignored. The mismatch check only fires when `recorded !== null` at `src/commands/run.ts:185`, while replay falls back to balanced at `src/commands/run.ts:627`. Reject explicit `--effort` when no envelope exists.

**nit**: Mismatch logic is centralized, so normal CLI paths have consistent stderr/exit code via `src/commands/run.ts:178` and `src/commands/run.ts:675`. Symmetry is logically covered by `recorded !== parsed.effort`, but the e2e only covers max → lite at `tests/e2e/cli-effort-envelope.test.ts:290`. Add lite → balanced or balanced → beast.

## (d) Sub-surface split candidates
keep-bundled: mismatch rejection. It is load-bearing for active-run idempotence and should land with replay, after the legacy/no-envelope case is fixed.

keep-bundled: `docs/references/budgets.md`. The new section is canonical contract text and aligns with the milestone precedence chain. Splitting it out would increase doc/code drift risk.

keep-bundled: active-run snapshot replay fix. It is not a separate authority boundary; it is the core B1a reader half of the writer/reader contract.

keep-bundled: schema/doc cleanup for `originalBudgets` / `effectiveBudgets`. The event contract is already in this commit, and the cleanup is small.

## Additional findings
**fix-soon**: The event payload contract is still inconsistent in docs/types. `docs/design/B1A_EFFORT_FLAG.md:78` names `originalGlobal/effectiveGlobal/originalByRole/effectiveByRole`, while the implementation emits `originalBudgets/effectiveBudgets`. `src/state/schemas.ts:1470` also advertises top-level `byRole?`, but `CodeOzConfig['budgets']` has `byRole` under `global`.

**fix-soon**: Design doc test paths are stale. The actual file is `tests/e2e/cli-effort-envelope.test.ts:1`, but `docs/design/B1A_EFFORT_FLAG.md:119`, `docs/design/B1A_EFFORT_FLAG.md:137`, and `docs/design/B1A_EFFORT_FLAG.md:151` still point at `tests/cli-effort-envelope.test.ts`.

**fix-soon**: The new e2e is untracked. `git diff --name-only` shows only 7 tracked files, while `git ls-files --others --exclude-standard` shows `tests/e2e/cli-effort-envelope.test.ts` and the briefing. Since the briefing's touchlist includes that test at `docs/design/CODEX_BRIEFING_B1A_R0.md:38`, make sure Commit 2 includes it.

## Sign-off
verdict: fix-first

fix-first findings (block-push + fix-soon) must close before Commit 2 lands.

---

## Maestro action plan (synthesis step 6)

Closure order (block-push first):

1. **B1 (block-push)**: Active-run replay must use recorded `effectiveBudgets` (or `applyEffort(originalBudgets, effort)`), not the current config. Update `applyRecordedEffort` in `src/commands/run.ts`. Add e2e that proves config-edit-mid-run + resume preserves the recorded envelope.

2. **F1 (fix-soon)**: Comment cleanup at `src/commands/run.ts:295`. "Third event" → position 2 wording.

3. **F2 (fix-soon)**: Renumber `docs/design/B1A_EFFORT_FLAG.md:137` "22." → "23.".

4. **F3 (fix-soon)**: Remove `.catch(() => [])` in `applyRecordedEffort` / `readRecordedEffort`. Fail-closed.

5. **F4 (fix-soon)**: Make "emission is unconditional" comments honest at `src/state/run.ts:211` and `:265`.

6. **F5 (fix-soon)**: Reject explicit `--effort` when no recorded envelope exists on an active run. Edit `src/commands/run.ts:178-185` region.

7. **F6 (fix-soon)**: Reconcile event payload field names. Update `docs/design/B1A_EFFORT_FLAG.md:78` from `originalGlobal/effectiveGlobal/originalByRole/effectiveByRole` to `originalBudgets/effectiveBudgets`. Also clarify `src/state/schemas.ts:1470` `byRole?` placement (it lives under `global`, not top-level).

8. **F7 (fix-soon)**: Update design doc test paths `tests/cli-effort-envelope.test.ts` → `tests/e2e/cli-effort-envelope.test.ts` at lines 119, 137, 151.

Deferred to R1 backlog:
- nit: additional mismatch e2e pairs (lite → balanced, balanced → beast).
- nit: JSON snapshot freeze loss (accepted as-is).

The new e2e file gets added via `git add` at Commit 2 stage (synthesis step 8); it is not lost.
