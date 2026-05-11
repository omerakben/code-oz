---
session: Session 3 of 3 — opencode triage + branch hygiene
phase: R-merge response (read-only, gpt-5.5 xhigh)
thread: 019e1837-2143-7c41-be58-7503c0e3b7e3
verdict: push
date: 2026-05-12
briefing: docs/design/CODEX_BRIEFING_OPENCODE_R_MERGE.md
---

# Codex R-merge response — opencode triage (Session 3 of 3)

## Verdict

**`push`.** No `block-push` or `block-next-milestone` findings. The merge is shippable as a docs/design merge.

## Findings

### fix-soon — Q7 stash needs small rebase before any follow-up landing

`git apply --check` on `stash@{0}` fails at `src/state/schemas.ts:1187` because the current `panel_quorum_rejected_same_family_vote` event is now wrapped in `OptionalActorAttributed<...>` (Chorus §3.5 actor-attribution discipline that landed during the v0.18 sweep), while the stash expects the older raw-union shape from merge-base `0dce4b0`.

Additionally, the stash adds a new known event type (`panel_voter_lineage_unknown`) but no strict validation case in `src/state/events.ts:1679`. A future landing should either add a validator case or explicitly accept schema-light validation.

**Disposition:** keep stashed. The fix-soon applies to the Q7 follow-up session, not to this merge. The metadata is recorded in the Session 3 handoff doc so a future session can pick it up with the rebase context in hand.

### nit — Archived opencode comparison inputs still say "rules 1-21" / "18 of 21"

Two historical comparison docs reference the pre-rules-22/23 state:

- `docs/comparison/11-opencode/CODEX_BRIEFING.md:115`
- `docs/comparison/11-opencode/COMPARISON.md:194`

These were authored on 2026-05-10 before rules 22 (consumer-first / RED-first TDD) and 23 (`--effort` invariant) landed. They are historical artifacts. The `SYNTHESIS.md` (at `docs/comparison/11-opencode/SYNTHESIS.md:13`) and `docs/comparison/README.md:48` supersede the raw comparison.

**Disposition:** no edit. Updating archived comparison inputs would be revisionist; the synthesis and the README carry the current view.

## Answers to specific questions

1. **Conflict resolution faithfulness.** Conflict resolution is faithful. The four gptme candidates are intact at `docs/design/ROADMAP.md:385`, the two opencode slots are present at `docs/design/ROADMAP.md:389`, and the `RULE21_BENCHMARK` discipline line is intact at `docs/design/ROADMAP.md:391`.

2. **Provenance tag legibility.** The `; opencode B2` / `; opencode M-CANCEL` tags are legible and grep-friendly. A little less polished than the existing parenthetical `gptme borrow ...` style. Not worth a fix. If this gets edited later, `(opencode B2)` would be the more consistent spelling.

3. **Cross-doc consistency: MCP rule references.** MCP rule references are still correct. Current CLAUDE rule 9 is at `CLAUDE.md:35`, rule 11 at `CLAUDE.md:37`, rule 13 at `CLAUDE.md:39`, and rule 18 at `CLAUDE.md:46`. The MCP contract references those same rule numbers at `docs/contracts/MCP_TRUST_BOUNDARY.md:5` and `docs/contracts/MCP_TRUST_BOUNDARY.md:116`. No renumbering break.

4. **Q7 stash disposition.** Not clean-applicable, but mergeable on inspection. The `runReviewPanel` insertion point still exists after canonical verdict computation at `src/phases/review-panel.ts:483`. Deferral is defensible: current verdict logic already excludes `providerFamily === 'unknown'` at `src/phases/review-panel-verdict.ts:158`, and current provider families do not include `unknown` at `src/providers/types.ts:36`. PE-2 should own the loader / pre-invoke lineage contract already named at `docs/design/ROADMAP.md:395`. The stash event is useful observability, not an immediate blocker.

5. **Candidate-slot rule-21 readiness.** Good enough for reservation, not final kickoff. B2 has the right deny-dominant invariant and event hook at `docs/design/ROADMAP.md:389`; tighten at promotion with red/green cases proving `findLast` last-match-wins would fail. M-CANCEL has concrete stress-test classes and sequencing at `docs/design/ROADMAP.md:390`; keep the promised split into separate sub-milestones so rule 20 does not get blurred.

6. **Anything missed.** The triage table is complete — covers B1 metrics, B2, B3, B4, B5, N1 stress tests, N3 thresholds, and Q7 lineage, matching `docs/comparison/11-opencode/SYNTHESIS.md:117` through `:138`. Rule 20 is not violated by this merge because these are candidate slots and design docs, not promoted runtime authority.

## Validation commands Codex ran

```
git status --short --branch
git log --oneline -5
git show 6fae670 --stat
git diff --check e7a24e6 6fae670
git stash show -p 'stash@{0}' | git apply --check -
```

The last command failed only on the Q7 stash schema hunk (the fix-soon finding above). All other validation clean.
