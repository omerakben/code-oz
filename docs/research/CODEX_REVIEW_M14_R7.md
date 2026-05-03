# Codex implementation review — M14 R7

Thread: `019dee43-91ee-7db0-b299-48d250470f48`
Reviewed branch: `feat/m14-reviewer-panel`
Reviewed commit: `480c9d3`
Date: 2026-05-03

## Verdict

`fix-first`

The R6 closure commit materially closes the two explicit R6 findings. The `panel_quorum_rejected_same_family_vote` contract now says v0.1 only emits that event from `code-oz doctor --panel-baseline` as the config-load positive control, and the runtime layer-4 path remains the `panel_voter_same_family_at_runtime` intervention. The common-errors table also removed the stale codes R6 named and added the F3/F4/F5/F6/R2/R3 implementation codes.

I found one new contract-truth issue while checking the R7 requirement that the new layer column be accurate. It is docs-only and narrow, but it is not just style: the contract still maps `panel_voter_same_family_as_build` to config-load only, while the implementation and tests also emit that exact code from the post-company-override agent-loader check, explicitly described as layer 2.

## Validation

- `git log --oneline main..HEAD | head -1` returned `480c9d3 docs(contracts/review-panel,state/schemas): close R6 - event-emission claim narrowed + common-errors table truth-aligned`.
- `git status --short --branch` showed branch `feat/m14-reviewer-panel` with untracked `.claude/` and `docs/research/CODEX_BRIEFING_M14_R7.md`.
- `git diff --check HEAD^ HEAD` passed.
- `bun run typecheck` passed.
- `bun test` is blocked by the read-only sandbox with `EPERM: operation not permitted, mkdtemp '/var/folders/.../T/...'`; it stopped at 1612 pass / 793 fail / 2405 tests. I did not treat this as product signal.
- Targeted pure tests passed: `bun test tests/state-events-panel.test.ts tests/review-report-multi-reviewer-schema.test.ts tests/review-report-panel-adversarial.test.ts tests/review-report-panel-verdict-invariant.test.ts` returned 79 pass / 0 fail.
- `bun test tests/agent-loader-review-panel.test.ts` passed its 7 tests before the paired orchestrator file hit the same `mkdtemp EPERM` sandbox block.

## R6 closure audit

Closed:

- `docs/contracts/REVIEW_PANEL.md:135` and `docs/contracts/REVIEW_PANEL.md:368` now scope `panel_quorum_rejected_same_family_vote` to the doctor baseline config-load positive control and state that v0.1 has no runtime emitter for this event.
- `src/state/schemas.ts:190` through `src/state/schemas.ts:196` now matches that wording and says later-layer discriminator values are reserved.
- `rg -n "panel_advisory_only|panel_routed_lineage_unknown|review_panelist_field_order|event_panel_quorum_inconsistent" docs/contracts/REVIEW_PANEL.md src tests` returned no active hits.
- `docs/contracts/REVIEW_PANEL.md:445` through `docs/contracts/REVIEW_PANEL.md:456` now names the actual implementation codes R6 asked for.
- `docs/contracts/REVIEW_PANEL.md:131` now uses `event_invalid_value` for the layer-5 `review_panel_completed` backstop.
- `docs/contracts/REVIEW_PANEL.md:298` now points panelist block parsing errors at the `review_panel_reviewer_*` family.

## Findings

### 1. medium — `panel_voter_same_family_as_build` is still documented as config-load only even though loader layer 2 emits it

Files:

- `docs/contracts/REVIEW_PANEL.md:28`
- `docs/contracts/REVIEW_PANEL.md:128`
- `docs/contracts/REVIEW_PANEL.md:446`
- `src/agents/loader.ts:102`
- `src/agents/loader.ts:315`
- `tests/agent-loader-review-panel.test.ts:1`
- `tests/agent-loader-review-panel.test.ts:123`

The R7 brief asks whether the common-errors layer column is accurate. One row is not. `docs/contracts/REVIEW_PANEL.md:446` says `panel_voter_same_family_as_build` belongs to `1 (config-load)`, and `docs/contracts/REVIEW_PANEL.md:28` says same-family voters are rejected at config-load. The five-layer table also lists layer 2 as `src/providers/registry.ts` with no rejection code.

Implementation evidence says the same code is also a layer-2 loader rejection:

- `src/agents/loader.ts:102` through `src/agents/loader.ts:108` calls `enforceReviewerPanelCrossFamily` after `applyCompanyOverrides` and describes it as layer 2 of the five-layer defense.
- `src/agents/loader.ts:315` through `src/agents/loader.ts:320` emits `panel_voter_same_family_as_build` with a rule string that explicitly says `loader layer 2`.
- `tests/agent-loader-review-panel.test.ts:1` through `tests/agent-loader-review-panel.test.ts:3` describes this as layer 2, and `tests/agent-loader-review-panel.test.ts:123` through `tests/agent-loader-review-panel.test.ts:127` asserts the issue includes `loader layer 2`.

This is not a runtime panel bug. The behavior is safer than the contract implies because the loader catches cases config-load can miss after company overrides and resolved BUILD agent provider selection. The remaining problem is contract/debugging truth: an operator following the common-errors table or five-layer table would not know that `panel_voter_same_family_as_build` may come from loader layer 2.

Recommendation:

- Update the locked rule to say same-family voters are rejected at config-load or agent-loader post-company-override validation.
- Update the five-layer table's layer-2 row to name `src/agents/loader.ts` / `enforceReviewerPanelCrossFamily` and the `panel_voter_same_family_as_build` code, or otherwise explicitly place the loader check in the layer model.
- Update the common-errors row for `panel_voter_same_family_as_build` to `1 (config-load) + 2 (agent-loader post-company-override check)`.

## Summary

Verdict `fix-first`. The R6 issues are closed, typecheck is clean, and the targeted pure tests are green. This should be a small docs-only correction to the layer map, not another implementation round. After this layer-2 contract truth is aligned, R8 should be eligible for `push` unless a new behavioral or contract-truth issue appears.
