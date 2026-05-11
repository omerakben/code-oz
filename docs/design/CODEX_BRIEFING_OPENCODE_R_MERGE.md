---
session: Session 3 of 3 — opencode triage + branch hygiene
phase: R-merge (one round, sandbox read-only)
locked-contract: docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md § "Session 3 — opencode triage + branch hygiene (locked, reframed per H4)"
prior-handoffs: docs/handoffs/2026-05-12-session-1-clean.md → docs/handoffs/2026-05-12-session-2-b1a-effort.md
---

# Codex R-merge briefing — opencode triage (Session 3 of 3)

## Goal

One Codex review round on the merged state of `main` after Session 3 step 4 lands. Surface: did the ROADMAP.md conflict resolution regress anything? Are the 2 new opencode candidate slots well-formed? Is the merged tree internally consistent across the touched docs? Pre-design + R-merge is sufficient for this work (one new authority is design-only; no runtime change).

## What landed in this session

Single merge commit (`6fae670`) on `main` brings in the only non-merge commit from `worktree-opencode-fixfirst` (`4870a32 docs(opencode-fixfirst): MCP trust-boundary design + 2 roadmap candidate slots (Commit A 1/3)`):

| File | Change | Conflict? |
|---|---|---|
| `docs/contracts/MCP_TRUST_BOUNDARY.md` | new (117 lines) | no — clean add |
| `docs/comparison/11-opencode/CODEX_BRIEFING.md` | new (125 lines) | no — clean add |
| `docs/comparison/11-opencode/CODEX_RESPONSE.md` | new (70 lines) | no — clean add |
| `docs/comparison/11-opencode/COMPARISON.md` | new (324 lines) | no — clean add |
| `docs/comparison/11-opencode/SYNTHESIS.md` | new (151 lines) | no — clean add |
| `docs/design/ROADMAP.md` | +2 candidate slots | YES — resolved manually |

Pre-merge Q7 lineage observability diff (3 files, 164 lines: `src/phases/review-panel.ts` + `src/state/schemas.ts` + `tests/review-panel-orchestrator.test.ts`) was stashed before the merge per the synthesis. Stash ref: `stash@{0}: On worktree-opencode-fixfirst: Q7 lineage observability work for separate landing (Session 3 split)`. The stash adds a `panel_voter_lineage_unknown` event emission for panelists the verdict excluded for unknown lineage.

### ROADMAP.md conflict — how I resolved it

The merge-base was `0dce4b0` (M16-era). Main has progressed ~30 milestones since with multiple ROADMAP edits; worktree had only 4870a32's +2-line change to the post-M16 candidate area. Conflict region: lines 384–395 in the new file (post-merge), spanning the "post-M16 candidate slot" listing area.

- HEAD side (main) had a `**Template-comparison-derived deferred milestones (slots reserved 2026-05-10):**` umbrella with **4 gptme-derived candidates** (M17 / M18 / M19+ / M20+) plus a `Discipline:` bullet that references `docs/contracts/RULE21_BENCHMARK.md`.
- Worktree side (4870a32) had **2 unbulleted opencode candidate slots** (deny-dominant wildcard permissions; cancellation / timeout / debate-recursion guard) plus a thinner `Discipline:` bullet without the `RULE21_BENCHMARK.md` reference.

**Resolution:** kept main's `Template-comparison-derived deferred milestones` umbrella, kept main's 4 gptme candidates verbatim, kept main's `RULE21_BENCHMARK.md`-referencing Discipline bullet verbatim. Inserted the 2 opencode candidate slots inside the same umbrella, after M20+, with `; opencode B2` / `; opencode M-CANCEL` provenance tags appended to the slot names so the lineage is grep-able. Updated the umbrella header date string to `(slots reserved 2026-05-10 gptme + 2026-05-12 opencode)`.

The 2 opencode candidate slots are kept VERBATIM from the worktree commit — body text is unchanged, only the heading line is shortened to fit the umbrella style (added `; opencode B2` provenance, kept the rest).

## Triage decisions for opencode fix-soons (Session 3 step 5)

Recorded here for Codex sanity check; final form lives in the Session 3 handoff doc.

| Item | Source in 11-opencode/SYNTHESIS.md | Decision | Rationale |
|---|---|---|---|
| B1 recorded HTTP fixtures (sub-milestone) | §4 | keep-deferred (Before PE-2) | Pre-loads metrics; landing waits for PE-2 demand checkpoint per synthesis. |
| B1 metrics (request-body hash stability; response schema coverage; typed error coverage; live-vs-replay parity; # of live calls removed; fixture age warn-at-90d / block-at-180d) | §4 | keep-deferred (Before PE-2) | Bundles with B1 itself. |
| B2 deny-dominant wildcard permissions | §1 (now roadmap slot) | keep-deferred (slot reserved on roadmap, demand-gated) | Just landed as a candidate slot under §1 of this merge. |
| B3 MCP consumer implementation | §2 (design just landed) | keep-deferred (impl on demand checkpoint) | `MCP_TRUST_BOUNDARY.md` is now on main; implementation milestone opens on demand. |
| B4 install ergonomics (npm + Homebrew + Scoop) | §"Revised borrow ranking" | keep-deferred (inside W3) | W3 is the install milestone. |
| B5 provider-error classification | §"Revised borrow ranking" | keep-deferred (co-shipped with B1) | Bundles with B1 typed-error coverage. |
| N1 stress tests (SlowProvider + HangProvider; panel-quorum-under-timeout; debate-cancellation-under-interrupt; nested-`requestDebate` collision) | §3 (now roadmap slot M-CANCEL) | keep-deferred (slot reserved on roadmap, demand-gated) | Just landed as the M-CANCEL candidate slot under §3 of this merge. |
| N3 secondary-index thresholds (10MB / 50k events / 50ms p95) | §5 | keep-deferred (M19+ telemetry roadmap row) | Thresholds documented; no action needed until M19+. |
| Q7 family lineage hardening (`loader_provider_lineage_unknown` distinct event + e2e test of synthetic unknown-lineage voter) | §6 | keep-stashed pending R-merge value call | The stashed 164-line diff actually implements §6 (it adds `panel_voter_lineage_unknown` emission, not just the test). Default per synthesis: keep stashed, file an issue, address in a follow-up if R-merge or later planning round surfaces value. |

## Constraints and rules

- Read-only sandbox. No file writes.
- Reviewer authority is `data, not authority` (CLAUDE.md cross-model peer review rule §3). Codex disagreement is weighed against the synthesis intent, not deferred to blindly.
- Hard-cap of 4 review rounds (rule 6); this is round 1 and likely the only round.
- `4870a32` is a docs-only commit. There is no source-code change in this merge.
- The 2 new candidate slots are design-only and do NOT introduce a new authority boundary on this merge (rule 20). Either may be promoted to an actual milestone later via its own planning round.

## Specific questions for Codex

1. **Conflict resolution faithfulness.** Did I preserve both intents? Specifically: (a) main's 4 gptme candidates with their original M17 / M18 / M19+ / M20+ provisional numbering are intact; (b) the 2 new opencode candidates are present with bodies verbatim from `4870a32`; (c) main's `Discipline:` bullet with `RULE21_BENCHMARK.md` reference is kept (not the worktree's thinner version). Anything off?
2. **Provenance tag legibility.** I appended `; opencode B2` and `; opencode M-CANCEL` to the slot names so future readers can grep the lineage. Is that style consistent with the existing roadmap and CLAUDE.md provenance conventions? Or should it be a footnote / reference link instead?
3. **Cross-doc consistency after the merge.** The new `docs/contracts/MCP_TRUST_BOUNDARY.md` references CLAUDE.md rules 9, 11, 13, and 18. Main's CLAUDE.md (post-Session 2) has rules numbered 1–23 with rule 22 (consumer-first / RED-first TDD) and rule 23 (--effort budget invariant). The MCP contract was authored when CLAUDE.md only had rules 1–21. Did any rule references in `MCP_TRUST_BOUNDARY.md` (or in the new 11-opencode docs) shift such that they now point at the wrong rule? Spot-check the rule references against current `CLAUDE.md` numbering.
4. **Q7 stash disposition.** The stash adds `panel_voter_lineage_unknown` emission (matches §6 of opencode synthesis). Default is keep-stashed. Two questions: (a) does it apply cleanly to current main, given the M14+ panel-runtime changes since merge-base `0dce4b0`? (You can read the stash content but not apply it; the question is whether the surface area `runReviewPanel` body around line 473, `panel_voter_excluded_reasons` event union, and the M14 verdict tests look mergeable on inspection.) (b) Is the deferral defensible, or does the missing emission create a measurable observability gap PE-2 will hit?
5. **Candidate-slot rule-21 readiness.** Both new candidate slots cite measurable risk-reduction conditions (synthesis §3 stress tests; synthesis §1 deny-dominant invariant). Are those conditions strong enough to qualify under CLAUDE.md rule 21's "measurable risk-reduction effect" requirement when (if) they get promoted to actual milestones? If not, what would tighten them?
6. **Anything I missed.** Is there a fix-soon in `docs/comparison/11-opencode/SYNTHESIS.md` or `CODEX_RESPONSE.md` that I dropped or mis-classified in the triage table? Anything in the merge that violates a CLAUDE.md rule (especially rule 20 — one authority per milestone — given the merge brings in candidate slots rather than promoting them)?

## Recommended verdict format

`push` / `fix-first` / `debate-required`, with severity-tagged findings:
- **block-push** — must close before the merge is considered shippable / before any further session work.
- **block-next-milestone** — must close before the next milestone tag (would be `v0.19.0-alpha.0` per the locked synthesis).
- **fix-soon** — should close within the next 1-2 sessions but not blocking.
- **nit / fyi** — no action expected.

Cite file paths + line numbers for every finding (`docs/...:NN`).

## Sandbox

`gpt-5.5` xhigh, `sandbox: read-only`. Single round.
