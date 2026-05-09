# Ralph M15 prompt (overnight implementation loop)

This is the canonical prompt fed to each Ralph iteration. Ozzy will launch via `/ralph-loop` with completion-promise `M15_COMPLETE` and max iterations 30.

---

## RALPH PROMPT (start)

You are implementing M15 Debate-policy scheduler v1 for `code-oz` over an overnight Ralph loop. This is iteration N of up to 30. You have a canonical plan and a per-iteration discipline. Follow them exactly.

### Your environment

- **Working directory:** `/Users/ozzy-mac/Projects/code-oz`
- **Branch:** `feat/m15-debate-scheduler` (created from `main` at `f7aca73`)
- **NEVER push, NEVER tag, NEVER merge.** All work stays local until Ozzy reviews.
- **NEVER commit broken code.** Every commit must follow `bun test` showing `0 fail` AND `bun run typecheck` clean.
- **Default no-push policy applies.** M14 push grant was one-time; M15 follows the standard pattern.

### Your canonical plan

Read these in this order at the start of every iteration:

1. `docs/design/SESSION_M15_IMPL_KICKOFF.md` — the locked plan (11 commits, file paths, schema definitions, lock-collision fix, rule-21 metric definitions, anti-patterns). This is the SOURCE OF TRUTH.
2. `docs/research/CODEX_RESPONSE_M15.md` — Codex's pushbacks; consult §"Risks the proposing side missed" + §"Where I disagree" when in doubt about design intent.
3. `docs/research/CODEX_BRIEFING_M15.md` — only if you need design rationale that isn't in the kickoff.

The kickoff document IS the plan. Do NOT redesign. If you find a contradiction between the kickoff and reality (a file path doesn't exist, an API signature in src has drifted), fix the kickoff doc in the same commit AND keep going.

### Your per-iteration discipline

```
1. cd /Users/ozzy-mac/Projects/code-oz && git status && git log --oneline main..HEAD
   → Identify which of the 11 commits in §3 of SESSION_M15_IMPL_KICKOFF.md are done.
   → Identify the NEXT commit slice (lowest-numbered unfinished commit).

2. If ALL 11 commits exist AND completion criteria in §12 of kickoff hold:
   → Run completion checklist (test count + typecheck + doctor commands + memory updated).
   → If all green, emit <promise>M15_COMPLETE</promise> and stop.
   → If any criterion fails, this is the "fix gap" iteration: address the missing criterion, run completion checklist again next iteration.

3. Otherwise, implement the NEXT commit slice from §3 of kickoff:
   → Read the commit's authority slice description + new tests count from §3 + concrete notes from §11
   → Make the file changes (Edit > Write where possible)
   → Run `bun test` after every meaningful change
   → If tests fail, fix the cause (do NOT skip tests, do NOT delete tests)
   → Run `bun run typecheck`
   → Stage files INDIVIDUALLY (`git add <file>` not `git add -A`)
   → Commit with conventional-commit format (no emojis, no Co-Authored-By footer)

4. Verify the commit:
   → `git log -1 --stat` — confirm files included
   → `bun test` — re-confirm 0 fail
   → `git status` — should be clean (or only have files for next commit's slice)

5. If you encounter a blocker (3 consecutive iterations stuck on same problem):
   → Write notes to memory `now.md` describing: blocker, attempted approaches, last clean commit, suggested morning action
   → Emit <promise>M15_BLOCKED</promise> and stop
```

### CLAUDE.md non-negotiables (load-bearing for M15)

Before any code lands in a commit, verify the change respects these rules. Violation = revert and rethink.

1. **Rule 1 — File-based gate signals only.** No parsing LLM text for scheduler decisions. The decision function is a pure predicate over typed inputs.
2. **Rule 2 — Cross-family review.** M10 runtime enforces caller-vs-opponent family separation; scheduler adds nothing, removes nothing.
3. **Rule 7 — Plain Markdown artifacts.** REVIEW.md and DECISION.md stay Markdown+YAML. No JSON serialization for inter-phase handoffs.
4. **Rule 13 — Privacy by default.** Scheduler manifest expansion (kickoff §2.11) respects `.code-ozignore` and persona's `maxFiles`. Pre-skip if the union exceeds — do NOT throw after firing.
5. **Rule 16 — Universal anti-slop in personas.** Reviewer's persona prompt body unchanged in commit 8 (only frontmatter changes).
6. **Rule 19 — Run-level budget enforcement.** Aggregate preflight per kickoff §2.5 + §7. Reuse `budgets.global` semantics; do NOT introduce a new namespace.
7. **Rule 20 — One authority per milestone.** M15's authority is automatic-trigger policy + measurable risk metric. NOTHING ELSE. If you find yourself adding multi-opponent debate, Researcher fan-out, pre-VERIFY trigger, or a Scheduler persona — STOP. That's a different milestone.
8. **Rule 21 — Measurable risk reduction.** Doctor command + `debate_policy_baseline_completed` event. Without `correctiveDeltaRate >= 0.10` AND `newActionableFindingRate >= 0.30` on the canonical fixture set, M15 does not ship.

### Concrete workflow per commit slice

**Commit 1: state schemas.** Edit `src/state/schemas.ts` to extend `LoggedEvent` union with the six new event types from kickoff §4. Edit `src/state/events.ts` to add validators. Add `tests/state-debate-scheduler-events.test.ts` with round-trip + correlation-field tests. Test count delta: ~18.

**Commit 2: pure decision function.** Create `src/policy/debate-scheduler.ts` with `evaluateSchedulerDecision()` matching the signature in kickoff §5. Pure function — no I/O, no global state. Add `tests/policy-debate-scheduler.test.ts` with table tests covering every `SchedulerSkipReason` (positive case) + every `SchedulerFireReason` (positive + negative-near-miss). Test count delta: ~30.

**Commit 3: config surface.** Edit `src/config/schema.ts` to add `debatePolicy?` with defaults from kickoff §2.12. Edit `src/config/load.ts` for validation (mode enum, range checks on grey-zone). Add `tests/config-debate-policy.test.ts` rejecting every invalid permutation. Test count delta: ~14.

**Commit 4a: REVIEW phase evaluate hook.** Edit `src/phases/review.ts` and `src/phases/review-panel.ts` to add the post-verdict-computation hook that builds `SchedulerInput` and calls `evaluateSchedulerDecision`. Emit `debate_scheduler_evaluated` always; emit `debate_scheduler_skipped` for skip decisions. NO fire path yet (decision result is logged but the fire branch is a TODO marker for commit 4b). Add `tests/review-scheduler-evaluate.test.ts`. Test count delta: ~14.

**Commit 4b: REVIEW fire + post-debate round + lock-collision fix.** Factor `runReview` body: extract `runReviewRoundLocked` from the existing per-round implementation. The outer `runReview` retains lock acquisition + the round loop; the locked body is the round-execution surface that re-runs for the post-debate round. Wire the fire path: `requestDebate` invocation + `runReviewRoundLocked` post-debate run + `debate_scheduler_postreview` event + canonical REVIEW.md replacement. Round counter does NOT increment for the post-debate round. Route `requestDebate` errors per kickoff §2.7 table. Add `tests/review-scheduler-fire.test.ts` and `tests/review-scheduler-postreview.test.ts`. Lock contention proof: instrument `.review.lock` acquire/release count; assert ≤1 acquire per outer `runReview` call regardless of fire path. Test count delta: ~24.

**Commit 5: cost preflight.** Edit `src/providers/cost.ts` to add `aggregateDebateSchedulerPreflight` matching the signature in kickoff §7. Reuse `assertWithinBudget` semantics for tip-detection (no new chokepoint). The scheduler hook supplies the result to `SchedulerInput.budget.aggregatePreflightWouldTip`. Skip event extends with optional `budgetTipReason`. Add `tests/cost-debate-scheduler-preflight.test.ts` with one tip case per cap. Test count delta: ~12.

**Commit 6a: doctor --debate-policy.** Edit `src/commands/doctor.ts` to add `--debate-policy` subcommand: prints current config + tabulates last 20 `debate_scheduler_*` events from `events.jsonl`. Read-only; no new event emitted. Add `tests/commands-doctor-debate-policy.test.ts`. Test count delta: ~8.

**Commit 6b: doctor --debate-policy-baseline.** Create `src/commands/doctor-debate-baseline.ts`. Edit `src/commands/doctor.ts` to wire `--debate-policy-baseline <fixture-set>`. Command runs same fixture under `mode: off` then `mode: auto`; computes corrective verdict delta + new-actionable-finding rate + per-trigger breakdown + no-signal-fire rate + cost/latency overhead; emits `debate_policy_baseline_completed` with `passedRuleTwentyOne: boolean`. Exit code 0 on pass. Add `tests/commands-doctor-debate-baseline.test.ts`. Test count delta: ~14.

**Commit 7: contract doc.** Create `docs/contracts/DEBATE_POLICY.md` per kickoff §9 sections (surface, defense-in-depth, common errors, opt-out semantics, rule-21 metric definitions, resume semantics, forward-compat for M16+, anti-patterns). No code change. Test count delta: 0.

**Commit 8: reviewer permission grant.** Edit `src/agents/defaults/reviewer.md` frontmatter to add the `tool_use.debate` block per kickoff §11.8. Update existing tests asserting "only `lead.md` has `tool_use.debate`" to "lead.md AND reviewer.md have it." Add `tests/agents-reviewer-debate-permission.test.ts` verifying the M11 cross-family eligibility check on the new opposingProviders list. Test count delta: ~6.

**Commit 9: e2e fixtures + tests + closure.** Create `tests/fixtures/debate-scheduler-baseline/` with the six fixture variants from kickoff §11.9. Create `tests/e2e/debate-scheduler-grey-zone.test.ts` and `tests/e2e/debate-scheduler-panel-disagreement.test.ts`. Each e2e test asserts the corresponding `debate_scheduler_postreview` event payload matches expected verdictPre/verdictPost/findingsAddedCount/actionableFindingsAddedCount. Edit `docs/design/ROADMAP.md` to mark M15 row closed (date + version + test count). Test count delta: ~20.

### Anti-patterns to avoid (auto-revert if you catch yourself)

1. **Bundling.** If a commit touches more than one authority slice, split it.
2. **Skipping tests.** If a test fails, fix the cause. Never delete a failing test or wrap with `.skip`.
3. **Adding a Scheduler persona.** The scheduler is mechanical orchestrator code. Rule 20.
4. **Making `auto` the default.** `manual` preserves M10 behavior; cost story not yet proven.
5. **Multi-opponent debate variants.** Out of scope. M16+.
6. **Verdict-confidence as primary signal.** Same-prior post-hoc rationalization.
7. **Deferring rule-21 measurement.** Rule 21 IS the ship gate.
8. **New `tool_use.debate.scheduler` sub-scope.** Bundling. Reuse `tool_use.debate`.
9. **New gate file for scheduler decisions.** Rule 1 + rule 20.
10. **Mid-debate budget kill as primary mechanism.** Aggregate preflight is the gate.
11. **Generalizing scheduler to fire from any phase.** Rule 20: post-REVIEW only for v1.
12. **Replacing `requestDebate` body.** M10 primitive frozen.
13. **Letting REVIEW lose to DECISION.** Kickoff §2.10 — REVIEW always wins.
14. **Pushing.** No `git push`. No `git tag`. No merge. Branch stays local.
15. **`Co-Authored-By: Claude` footer.** Don't add it.
16. **Emojis in code or commit messages.** Don't add them.
17. **`git add -A` or `git add .`** — stage files individually by name.

### Memory updates (your job at completion or block)

Update `/Users/ozzy-mac/.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/now.md` with the end-state snapshot:
- Branch state (commits ahead of main)
- Test count delta from baseline (2425)
- Doctor baseline metric values (correctiveDeltaRate, antiCorrectiveCount, newActionableFindingRate, noSignalFireRate)
- What's ready for morning (Codex review? Branch stays local pending Ozzy approval?)

Add or update `/Users/ozzy-mac/.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/m15_progress.md` with:
- Commits landed
- Codex pushback resolution (every accept item from CODEX_RESPONSE_M15.md triage table that's now wired in)
- Any deviations from the kickoff plan + rationale
- Open questions for morning

Update `MEMORY.md` index with the m15_progress.md link line.

### Completion-promise emission rules

Emit `<promise>M15_COMPLETE</promise>` ONLY when ALL completion criteria in kickoff §12 hold:
- 11 commits exist on `feat/m15-debate-scheduler`
- `bun test` shows ~2585 pass / 0 fail / 1 skip (live xAI gated)
- `bun run typecheck` clean
- `bun run dev doctor --debate-policy` runs without error
- `bun run dev doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` exits 0 AND emits `debate_policy_baseline_completed { passedRuleTwentyOne: true, correctiveDeltaRate >= 0.10, newActionableFindingRate >= 0.30 }`
- All `SchedulerSkipReason` values have ≥1 positive test case
- All `SchedulerFireReason` values have ≥1 positive test case
- `docs/contracts/DEBATE_POLICY.md` exists
- `docs/design/ROADMAP.md` M15 row marked closed
- `MEMORY.md` updated with `m15_progress.md`

Emit `<promise>M15_BLOCKED</promise>` if you've spent 3+ iterations on the same blocker, OR if you discover an architectural mistake in the kickoff that requires Ozzy's input (e.g., a contract surface you cannot satisfy without redesign).

### Your iteration ends with one of:

1. A new commit landed (continue to next iteration)
2. `<promise>M15_COMPLETE</promise>` (loop terminates, success — Codex review next)
3. `<promise>M15_BLOCKED</promise>` (loop terminates, intervention needed)

Begin iteration N now.

## RALPH PROMPT (end)
