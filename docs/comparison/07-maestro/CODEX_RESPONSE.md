---
debate-target: maestro template comparison
sibling-docs: COMPARISON.md, CODEX_BRIEFING.md
codex-model: gpt-5.5 (xhigh effort)
codex-sandbox: read-only
codex-thread: 019e12ee-6734-7db1-82e1-0a630ca04005
codex-verdict: fix-first
status: verbatim Codex output (DO NOT EDIT)
synthesis: SYNTHESIS.md
---

# Codex response — maestro comparison

## Top-line verdict
fix-first. The selective-borrow direction is right, but COMPARISON should not close as written: B1 hides a second contract surface, B7 is rejected under the wrong primary rule, and B4+B5 are over-bundled. Maestro's bash loop should stay rejected, but `code-oz watch` should remain a narrow deferred sub-comparison, not a final rejection.

## Per-borrow verdict
- B1: modify — agree with closing rule 5, disagree with "grep every numeric claim in BUILD_REPORT.md." Current BUILD_REPORT.md is mostly orchestrator-authored structured data, not a claim ledger. If BUILD_REPORT.md needs structured count rows, B1 becomes two surfaces: BUILD schema plus VERIFY artifact. Keep it one surface by making VERIFY derive checks from existing PLAN/BUILD manifests, or split it.
- B2: agree-defer — heartbeat is visibility, not provider authority. Do not build until a consumer exists. If documented now, make it a projection over events/current state, not a second source of truth.
- B3: modify — plan-vs-actual is distinct from HYPOTHESES.md, but `PLAN_DIFF.md` should probably be a SHIP-tail section/artifact generated from PLAN task ids, BUILD_REPORT manifests, task events, and REVIEW/VERIFY outcomes. There is no current `docs/contracts/SHIP.md`, so accepting this as "small" is premature.
- B4: modify — `NEXT_RUN.md` is useful, but it is positive handoff, not a terminal-state class. It should be consumed by DEFINE/PLAN only when explicitly wired, otherwise it becomes ceremonial.
- B5: disagree as bundled — `ABANDON.json` is not "no risk." It changes terminal vocabulary, run outcome schema, reducer behavior, current-state projection, and maybe active-run cleanup. Bundle with B4 only if cleanup is explicitly out of scope.
- B6: agree — reject for v0.x. The blocker is VCS/PR authority, not rule 21 unless the gate imports Gemini/Copilot/provider reviewers.
- B7: modify — reject maestro's perpetual bash loop for v0.x, but do not call `code-oz watch` finally rejected. Rule 21 is the wrong primary rule unless watch introduces parallel-provider behavior. The real tests are rule 20, run-state integrity, and measurable operator risk reduction.
- Reject set: agree / additions — keep headless `claude -p`, `--dangerously-skip-permissions`, branch strategy, Cowork supervisors, iMessage notifications, tmux/launchd, and `.claudeignore` runtime isolation rejected. Add CI recipe and starter templates as deferred repo-maintenance/UX candidates, not runtime borrows. CODEOWNERS is premature until real ownership boundaries exist.

## Blind spots in COMPARISON.md
The biggest blind spot is treating B1 as "VERIFY already owns evidence." The proposed implementation needs a claim source. Free-form numeric grep is brittle; structured counts require BUILD contract changes.

The second blind spot is over-reading W3-lite. W3-lite was a scoped overnight scaffold with hard caps and manual morning review. It proves thin wrappers can work once under tight scope; it does not prove perpetual mode has no product value.

The third blind spot is terminal-state accounting. `RUN_OUTCOMES` is currently `shipped | stopped | paused`; `ABANDON.json` would require a state-machine and event-schema change, not just a new file.

The comparison also underweights release infrastructure. Maestro's GitHub Actions workflow is not directly portable because `code-oz` uses Bun and currently has no `.github/`, but a Bun-native CI baseline is a real missed deferred borrow.

## Debate findings
B7: rule 21 is not the right primary rule. A one-provider watch loop is not a parallel-provider surface. Use rule 20 first: watch introduces a runtime authority boundary. Rule 21 applies only if watch also adds supervisors, reviewer fanout, debate fanout, or provider-backed monitoring.

B7 contract if reopened: fresh `runId` per cycle; separate `watchId` or `cycleId`; heartbeat as derived status; cycle counter outside per-run gate files; no reuse of success gates across cycles; no external supervisors in v1; halt on `NEEDS_INTERVENTION`, `STOP`, budget kill, or foreign drift. Reusing the same `runId` across cycles would violate the append-only gate model.

B1: VP grep verification is portable only if scoped to declared patterns, file manifests, task ids, and known symbol/path claims. It should not scan arbitrary prose for numbers. The M16 C9 failure mode was authority bundling, not rename blindness; B1 helps only if it verifies task/file completeness, not just count claims.

B3: do not make a persona "remember" the diff. A deterministic SHIP-tail generator should compare planned task ids and acceptance criteria against emitted task/build/verify/review events, then allow Scientist to update hypotheses/questions from that result. Human-curated plan-vs-actual is not enough for code-oz.

B4+B5: these are two axes unless B5 is reduced to `run_ended.outcome='abandoned'` plus a reason, with no cleanup behavior. `NEXT_RUN.md` is forward planning; abandonment is a terminal run state. Different consumers, different risks.

Reject set audit: `.claude/skills/documentation-first` mostly overlaps rule 3 and the existing docs-first discipline. The starter templates are worth deferring to `code-oz init` UX. The CI workflow is the most concrete missed borrow, but should be a Bun-native release-infra item, not part of maestro runtime absorption.

## Recommended action
Do not close the comparison yet. Revise COMPARISON.md with: B1 narrowed or split; B7 rewritten as "reject maestro loop, defer watch sub-comparison"; B4 and B5 separated unless cleanup is explicitly excluded; B3 moved behind a SHIP contract decision; CI/starter templates recorded as deferred non-runtime candidates. Then close the maestro comparison as "yes, selective borrows, with watch reopened only by a future demand signal."
