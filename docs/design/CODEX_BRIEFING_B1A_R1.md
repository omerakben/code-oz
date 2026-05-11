---
name: CODEX_BRIEFING_B1A_R1
status: pending-invocation
review-round: R1 (post-Commit 2 implementation review)
codex-model: gpt-5.5
codex-effort: xhigh
sandbox: read-only
date: 2026-05-12
worktree: .claude/worktrees/aris-borrows-pre-m17
branch: worktree-aris-borrows-pre-m17
prior-rounds:
  - 019e1318 (pre-design review — 4 load-bearing bugs caught and closed before any code landed)
  - 019e17f8 (R0 on existing diff — 1 block-push + 6 fix-soon caught and closed)
target-commit: b605f48 (Commit 2 of 2)
---

# Codex R1 briefing — B1a Commit 2 (post-R0 closure)

R1 verifies that the R0 fixes (thread `019e17f8`) closed cleanly without introducing new issues, and that nothing else was missed. Verdict needed: `push` / `fix-first` / `debate-required`.

## What changed between R0 and R1

All 1 block-push + 6 fix-soon items from `docs/design/CODEX_RESPONSE_B1A_R0.md` were addressed in Commit 2 (`b605f48`):

### R0 closures (each verified by the targeted tests passing 3163/0/1 + new regression e2e)

**B1 (block-push — active-run replay snapshot fidelity)**
- `src/commands/run.ts` `applyRecordedEffort` now reads `effectiveBudgets` directly from the recorded `effort_envelope_applied` event and replaces `config.budgets` (cast through `unknown as Budgets` because the schema is intentionally schema-light per `src/state/schemas.ts:1452-1457`).
- Old behavior was `applyEffort(currentlyLoadedConfig, recorded.effort)` — editing `.code-oz/config.yaml` mid-run silently changed the envelope.
- New helper `findLatestEffortEnvelopeEvent` returns the full event (effort + effectiveBudgets) via `RecordedEnvelope` interface. `findLatestEffortEnvelope` (effort-only) was retired.
- New e2e: `tests/e2e/cli-effort-envelope.test.ts` test "active-run replay uses RECORDED effectiveBudgets, not the currently-loaded config (Codex R0 B1)" — sabotages `.code-oz/config.yaml` to set `perPhase.plan.maxProviderCalls=1` mid-run, asserts the recorded envelope (24 from `lite × 60`) still governs and PLAN completes its 2-call script without budget kill.

**F1 (fix-soon — stale comment at `src/commands/run.ts:295`)**
- Comment rewritten to reference position 2 (between `run_started` and `phase_entered`) per the event-order lock.

**F2 (fix-soon — `B1A_EFFORT_FLAG.md:137` quoted invariant as `22.`)**
- Renumbered to `23.` in the rule-quote block.

**F3 (fix-soon — `.catch(() => [])` in event reads)**
- Removed from both `applyRecordedEffort` and `readRecordedEffort`. `readEvents` already returns `[]` for missing files and throws for malformed logs; we now let those throw rather than silently treating as "no envelope".

**F4 (fix-soon — "emission is unconditional" comments lying)**
- `src/state/run.ts` docblock + inline comment rewritten to clarify: emission is conditional on `originalBudgets`/`effectiveBudgets` being supplied. CLI fresh runs always supply both, so production fresh runs always record the envelope; low-level state-machine unit tests / fixture helpers that omit budgets emit no envelope event.

**F5 (fix-soon — legacy active-run silently ignores explicit `--effort`)**
- `src/commands/run.ts` mismatch entry-point now rejects explicit `--effort` when `recorded === null` (legacy run pre-dating B1a). New helper `rejectEffortOnLegacyRunToStderr` emits the documented message.
- New e2e: "active-run rejects explicit --effort when no recorded envelope (legacy run, Codex R0 F5)" — synthesizes a legacy state by stripping the `effort_envelope_applied` line from `events.jsonl`, then asserts `--effort lite` exits with code 2 + the documented stderr.

**F6 (fix-soon — event payload field-name drift + schema `byRole?` placement)**
- `docs/design/B1A_EFFORT_FLAG.md:78` (the § "Where the flag lives" Logging bullet) now lists `originalBudgets: CodeOzConfig['budgets']`, `effectiveBudgets: CodeOzConfig['budgets']` (was the four-field `originalGlobal/effectiveGlobal/originalByRole/effectiveByRole` shape).
- `src/state/schemas.ts:1470-1482` removed the spurious top-level `byRole?` from both `originalBudgets` and `effectiveBudgets` field types. `byRole` lives nested under `global` per `GlobalBudget.byRole` in `src/config/schema.ts`.

**F7 (fix-soon — design doc test paths stale)**
- Replaced 3 occurrences of `tests/cli-effort-envelope.test.ts` with `tests/e2e/cli-effort-envelope.test.ts` (`replace_all`).

### Deferred from R0 (per "Sign-off" — nits OK to defer)

- nit: additional mismatch e2e pairs (lite → balanced, balanced → beast). Existing test covers max → lite; the mismatch logic is symmetric on `recorded !== parsed.effort`. Codex confirmed in R0 the logic is centralized.
- nit: JSON snapshot freeze loss accepted as design (events are JSON; consumers should not depend on runtime `Object.freeze`).

## Diff inventory (against `252baac`, the Commit 1 base)

```
 CLAUDE.md                                       |   1 +
 docs/design/B1A_EFFORT_FLAG.md                  |  34 ++-
 docs/design/CODEX_BRIEFING_B1A_R0.md            | (new)
 docs/design/CODEX_RESPONSE_B1A_R0.md            | (new)
 docs/references/budgets.md                      |  45 +++
 src/commands/run.ts                             | 238 +++++++++++++-
 src/state/events.ts                             |  97 ++++++
 src/state/run.ts                                |  89 +++++-
 src/state/schemas.ts                            |  51 +++
 tests/e2e/cli-effort-envelope.test.ts           | (new)
```

Total: 10 files / +1250 / -19. Of that, ~+200 from R0 closure deltas (the rest is the original 471-line diff scope).

## R1 debate prompts

### (1) Did the R0 fixes close all findings without introducing new bugs?

Cross-check each of B1, F1-F7 against the commit. Specifically:
- B1: is the `as unknown as Budgets` cast safe given the schema-light validator? Are there callers downstream of `applyRecordedEffort` that depend on `Object.freeze` semantics on `config.budgets`? (The freeze happens in the loader; the recorded snapshot is a JSON round-trip and was never frozen.)
- F3: by removing `.catch(() => [])`, do we now propagate `readEvents` errors to a CLI surface that does not handle them? Trace the error path through the four `applyRecordedEffort` call sites.
- F5: is the legacy-run rejection user-friendly enough? The message tells the user to "resume without --effort to keep the legacy envelope, or start a fresh run" — is the second branch (start fresh) safe given the existing `code-oz init` workflow?

### (2) Active-run replay correctness across all four reload sites

`src/commands/run.ts` has four sites that call `applyRecordedEffort`:
- `dispatchPlan` reload path
- `dispatchBuild` reload path
- `dispatchVerify` reload path
- `dispatchReview` reload path

Trace each one. Does each correctly bind the returned `config` to the downstream consumers (provider invocation, budget assertions, phase preflights)? Is there any site where the OLD `applyEffort(config, recorded.effort)` semantics survived and would still consult the live config?

### (3) New e2e test coverage adequate?

The two new regression tests in `tests/e2e/cli-effort-envelope.test.ts`:
- "active-run replay uses RECORDED effectiveBudgets, not the currently-loaded config" — uses YAML sabotage on `perPhase.plan.maxProviderCalls`. Are there other budget surfaces that the sabotage misses (per-role byRole? global maxTokensEstimate?) that would also benefit from coverage?
- "active-run rejects explicit --effort when no recorded envelope" — strips the event line from `events.jsonl` directly. Is this synthesis realistic enough, or should we generate a "real" legacy run via fixture?

### (4) Anything else missed (pre-design + R0 + R1 lens)

Pre-design (`019e1318`) closed 4 load-bearing bugs. R0 (`019e17f8`) closed 1 block-push + 6 fix-soon. R1 is the third opinion. What hasn't been checked?

Candidate angles:
- Does the resume-from-crash path (when `current.json` is missing) recover the recorded envelope correctly?
- Does `bun run dev doctor` need to acknowledge the recorded envelope when reporting active-run health?
- Does the `code-oz approve <phase>` invocation read the recorded envelope? (Currently, `approve` does not go through `applyRecordedEffort` — should it?)

## Acceptance for advancing past R1

- Verdict: `push` (Commit 2 is ready to merge), `fix-first` (more closures needed before merge), or `debate-required` (surface a load-bearing disagreement for thread).
- If `push`: synthesis step 11 (merge to local main) follows. Synthesis is explicit: no push to GitHub without Ozzy approval.
- If `fix-first`: close findings in a new commit (do NOT amend `b605f48`), then R2.

## How to invoke

```
mcp__plugin_agent-codex_codex-native__codex({
  model: "gpt-5.5",
  effort: "xhigh",
  sandbox: "read-only",
  cwd: "/Users/ozzy-mac/Projects/code-oz/.claude/worktrees/aris-borrows-pre-m17",
  prompt: "<see CODEX_BRIEFING_B1A_R1.md and answer all 4 R1 debate prompts; return verdict in CODEX_RESPONSE_B1A_R1.md shape>"
})
```
