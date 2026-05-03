# Ralph M14 prompt (overnight implementation loop)

This is the canonical prompt fed to each Ralph iteration. Ozzy will launch via `/ralph-loop` (or equivalent invocation pattern) with completion-promise `M14_COMPLETE` and max iterations 25.

---

## RALPH PROMPT (start)

You are implementing M14 Reviewer panel v1 for `code-oz` over an overnight Ralph loop. This is iteration N of up to 25. You have a canonical plan and a per-iteration discipline. Follow them exactly.

### Your environment

- **Working directory:** `/Users/ozzy-mac/Projects/code-oz`
- **Branch:** `feat/m14-reviewer-panel` (created from `main` at `4b846a1`)
- **NEVER push, NEVER tag, NEVER merge.** All work stays local until Ozzy reviews in the morning.
- **NEVER commit broken code.** Every commit must follow `bun test` shows `0 fail` AND `bun run typecheck` is clean.

### Your canonical plan

Read these in this order at the start of every iteration:

1. `docs/design/SESSION_M14_KICKOFF.md` — the locked plan (10 commits, file paths, test targets, completion criteria). This is the SOURCE OF TRUTH.
2. `docs/research/CODEX_RESPONSE_M14.md` — Codex's 12 pushbacks; consult §"Authority-laundering construction proof" + §"Commit sequence rule-20 audit" when in doubt.
3. `docs/research/CODEX_BRIEFING_M14.md` — only if you need design rationale that isn't in the kickoff.

The kickoff document IS the plan. Do NOT redesign. If you find a contradiction between the kickoff and reality (e.g., a file path doesn't exist), fix the kickoff doc in the same commit AND keep going.

### Your per-iteration discipline

```
1. cd /Users/ozzy-mac/Projects/code-oz && git status && git log --oneline main..HEAD
   → Identify which of the 10 commits in §3 of SESSION_M14_KICKOFF.md are done.
   → Identify the NEXT commit slice (lowest-numbered unfinished commit).

2. If ALL 10 commits exist AND completion criteria in §7 of kickoff hold:
   → Run completion checklist (test count + typecheck + doctor command + memory updated).
   → If all green, emit <promise>M14_COMPLETE</promise> and stop.
   → If any criterion fails, this is the "fix gap" iteration: address the missing criterion, run completion checklist again next iteration.

3. Otherwise, implement the NEXT commit slice from §3 of kickoff:
   → Read the commit's Authority slice description + New tests count
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
   → Write notes to `now.md` describing: blocker, attempted approaches, last clean commit, suggested morning action
   → Emit <promise>M14_BLOCKED</promise> and stop
```

### CLAUDE.md non-negotiables (load-bearing for M14)

Before any code lands in a commit, verify the change respects these rules. Violation = revert and rethink.

1. **Rule 1 — File-based gate signals only.** No parsing LLM text for verdicts. `computeCanonicalPanelVerdict` reads structured input only.
2. **Rule 2 — Cross-family review.** Same-family voters NEVER count toward quorum. Five-layer defense per kickoff §2.2.
3. **Rule 7 — Plain Markdown artifacts.** REVIEW.md stays Markdown+YAML. No JSON serialization.
4. **Rule 13 — Privacy by default.** Manifest equality (kickoff §2.4) — every panelist sees the same files.
5. **Rule 19 — Run-level budget enforcement.** Aggregate panel preflight per kickoff commit 7. Reuse M13 `budget_warning`, do NOT add `panel_cost_warn`.
6. **Rule 20 — One authority per milestone.** M14's authority is panel quorum + cross-family enforcement + synthesis. NOTHING ELSE. If you find yourself adding configurable quorum, automatic scheduling, multi-opponent debate, or panel for VERIFY — STOP. That's a different milestone.
7. **Rule 21 — Measurable risk reduction.** Doctor command + `review_panel_baseline_completed` event. Without `panelOnlyActionableFindingCount > 0` on the baseline fixture, M14 does not ship.

### Concrete workflow per commit slice

**Commit 1: contract docs.** Write `docs/contracts/REVIEW_PANEL.md` with all schema details from kickoff §2. No code change. Test count delta: 0.

**Commit 2: config.** Edit `src/config/schema.ts` (add `reviewer.panel` schema), `src/config/load.ts` (validate panel: exactly 2 voters, no same-family voters, optional advisory), `src/agents/loader.ts` (panel loader integration). Add `tests/review-panel-config-validation.test.ts`. Test count delta: ~15.

**Commit 3: artifact schema.** Edit `src/artifacts/review-report.ts` to add multi-reviewer schema + Synthesis block + parse-time quorum recomputation. Single-`Reviewer:` shape preserved (parser dispatches on plural `Reviewers:`). Add `tests/review-report-multi-reviewer-schema.test.ts`. Test count delta: ~20.

**Commit 4: events.** Edit `src/state/schemas.ts` + `src/state/events.ts` to add: `review_panel_started`, `review_panelist_completed`, `review_panel_completed`, `review_panel_disagreement`, `panel_quorum_rejected_same_family_vote`, `review_panel_baseline_completed`. Event-validator backstop on `review_panel_completed` with `ready` verdict. Add `tests/review-panel-events.test.ts`. Test count delta: ~15.

**Commit 5: pure verdict helper.** Create `src/phases/review-panel-verdict.ts` with the exact `computeCanonicalPanelVerdict` signature + algorithm from kickoff §2.1. NO I/O. Add `tests/review-panel-canonical-verdict.test.ts` with all 9 table-test cases (T1-T9). Test count delta: ~25.

**Commit 6: orchestrator.** Create `src/phases/review-panel.ts`. Edit `src/phases/review.ts` to delegate when `panel.length > 1`. Sequential panelist invocation. Per-panelist staging write to `state/review-panel/round-N/panelist-<id>.md`. `review_panelist_completed` event with manifest hash. Synthesis writes canonical REVIEW.md atomically. Manifest equality check. Runtime registry family resolution (NOT pure `familyOf`). Routed/unknown-lineage providers rejected. Add `tests/review-panel-orchestrator.test.ts`. Test count delta: ~25.

**Commit 7: cost.** Edit `src/providers/cost.ts` to add aggregate panel preflight. Reuse M13 `budget_warning` event (do NOT add new event). Add `tests/review-panel-cost-aggregate.test.ts`. Test count delta: ~10.

**Commit 8: doctor.** Create `src/commands/doctor-panel-baseline.ts`. Edit `src/commands/doctor.ts` to wire `--panel-baseline` subcommand. Command runs same fixture in single-mode then panel-mode; emits `review_panel_baseline_completed` event with full payload from kickoff §2.7; prints summary report. Add `tests/review-panel-doctor-baseline.test.ts`. Test count delta: ~15.

**Commit 9: e2e proof.** Create `tests/fixtures/review-panel-baseline/` with: invocation-seam fixture (preserves real provider IDs/families via scripted responses; does NOT invent fake provider IDs), same-family-vote rejection fixture, panel-only-actionable finding fixture. Create `tests/e2e/review-panel-baseline.test.ts` proving rule-21 ship gate. Test count delta: ~20-30.

**Commit 10: closure docs.** Edit `docs/design/ROADMAP.md` (mark M14 closed with measurement deltas). Edit `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` (Reviewer panel row updated). Test count delta: 0.

### Anti-patterns to avoid (auto-revert if you catch yourself)

1. **Bundling.** If a commit touches more than one authority slice, split it.
2. **Skipping tests.** If a test fails, fix the cause. Never delete a failing test or wrap with `.skip`.
3. **Inventing fake provider IDs.** Use the invocation seam pattern; provider IDs stay real (`claude`, `codex`, `gemini`, `fake`, `xai`).
4. **Writing partial REVIEW.md.** Per-panelist drafts go to STAGING. Canonical REVIEW.md only after synthesis.
5. **Adding `panel_cost_warn` event.** Reuse M13 `budget_warning` with `role: 'reviewer'`.
6. **Configurable quorum.** Fixed exactly 2 cross-family voters. No knob.
7. **Same-family advisory escalation.** Advisory findings are recorded with `authorityImpact: 'advisory'`, but NEVER escalate canonical verdict without cross-family voter corroboration via fingerprint.
8. **Pushing.** No `git push`. No `git tag`. No merge. Branch stays local.
9. **Co-Authored-By footer.** Don't add it (CLAUDE.md "Working in this repo" rule 4).
10. **Including "update memory" in commit subject** (commit 10).

### Memory updates (your job at completion or block)

Update `/Users/ozzy-mac/.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/now.md` with the end-state snapshot:
- Branch state (commits ahead of main)
- Test count delta from baseline (2222)
- Doctor baseline metric values (panelOnlyActionableFindingCount, etc.)
- What's ready for morning (Codex review? Merge approval? Block intervention?)

Add or update `/Users/ozzy-mac/.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/m14_progress.md` with:
- Commits landed
- Codex pushback resolution (which Codex modifications were accepted)
- Any deviations from the kickoff plan + rationale
- Open questions for morning

### Completion-promise emission rules

Emit `<promise>M14_COMPLETE</promise>` ONLY when ALL completion criteria in kickoff §7 hold. Specifically:
- 10 commits exist on `feat/m14-reviewer-panel`
- `bun test` shows `~2340-2370 pass / 0 fail / 1 skip`
- `bun run typecheck` clean
- `bun run dev doctor --panel-baseline tests/fixtures/review-panel-baseline` succeeds AND emits the metric event with `panelOnlyActionableFindingCount > 0`, `sameFamilyVoteRejectionCount >= 1`, `manifestEqualityHeld === true`, `disagreementCount >= 1`
- All 9 table-tests (T1-T9) pass
- Memory updated

Emit `<promise>M14_BLOCKED</promise>` if you've spent 3+ iterations on the same blocker, OR if you discover an architectural mistake in the kickoff plan that requires Ozzy's input.

### Your iteration ends with one of:

1. A new commit landed (continue to next iteration)
2. `<promise>M14_COMPLETE</promise>` (loop terminates, success)
3. `<promise>M14_BLOCKED</promise>` (loop terminates, intervention needed)

Begin iteration N now.

## RALPH PROMPT (end)
