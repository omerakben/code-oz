# Codex implementation review — M14 R6

Thread: `019dee38-81b2-7701-8236-cf1abd3bd4d1`
Reviewed branch: `feat/m14-reviewer-panel` at `547efaa`
Reviewed commit: `547efaa`
Date: 2026-05-03

## Verdict

`fix-first`

The R5 closure commit fixes the main five-layer defense table and the `review-panel-verdict.ts` header comment, but it does not fully close the R5 event-emission drift. The active contract still says `panel_quorum_rejected_same_family_vote` is emitted by any layer 1-4 rejection in the event table, while the corrected prose now says v0.1 only emits it from the doctor baseline config-load positive control.

This is not a behavioral panel-runtime bug. Runtime still rejects same-family voter laundering through `panel_voter_same_family_at_runtime`, typecheck is clean, and the pure parser/event tests I could run are green. But R6 was explicitly asked to verify the event-emission claim was narrowed. It is only partially narrowed, so I would not tag yet.

## Validation

- `git log --oneline main..HEAD | head -1` returned the expected HEAD commit at `547efaa`.
- `git log --oneline main..HEAD | wc -l` returned `31`, while the R6 brief says 32 commits ahead of `main`. I did not treat this as a blocker because the reviewed HEAD matches.
- `git diff --check HEAD^ HEAD` passed.
- `bun run typecheck` passed (`tsc --noEmit` exited 0).
- `bun test` is blocked by this read-only sandbox. It failed on temp-dir writes with `EPERM: operation not permitted, mkdtemp '/var/folders/.../T/...'`, producing 1612 pass / 793 fail / 2405 tests before exit. This matches the known R2-R5 sandbox limitation, not accepted product signal.
- Targeted pure tests passed:
  - `bun test tests/state-events-panel.test.ts`: 43 pass / 0 fail.
  - `bun test tests/review-report-multi-reviewer-schema.test.ts`: 28 pass / 0 fail.
- `bun test tests/review-panel-orchestrator.test.ts` was blocked by the same `mkdtemp EPERM` limitation before assertions could run.

## R5 closure audit

Closed:

- `docs/contracts/REVIEW_PANEL.md:129` now lists the layer-3 parser invariant bundle: manifest equality, F4 source/authority-impact consistency, F5 cross-section verdict consistency, and recomputed verdict consistency.
- `docs/contracts/REVIEW_PANEL.md:130` now points layer 4 at `src/phases/review-panel.ts` and names the relevant runtime authority interventions from the R5 finding.
- `docs/contracts/REVIEW_PANEL.md:133` explains that `computeCanonicalPanelVerdict` is the pure algorithm shared by runtime layer 4 and parse-time recomputation in layer 3.
- `src/phases/review-panel-verdict.ts:15` through `src/phases/review-panel-verdict.ts:28` no longer claims the verdict helper module itself is layer 4.

Partially closed:

- `docs/contracts/REVIEW_PANEL.md:135` correctly narrows `panel_quorum_rejected_same_family_vote` to the v0.1 doctor-baseline config-load producer, but the event table and schema comments still preserve the old layer 1-4 emission claim.

## Findings

### 1. medium — `panel_quorum_rejected_same_family_vote` is still documented as a layer 1-4 event outside the corrected prose

Files:

- `docs/contracts/REVIEW_PANEL.md:135`
- `docs/contracts/REVIEW_PANEL.md:368`
- `src/state/schemas.ts:190`
- `tests/state-events-panel.test.ts:247`

R5 asked for the `panel_quorum_rejected_same_family_vote` claim to be narrowed to v0.1 reality: only the doctor baseline emits it, and runtime layer 4 surfaces same-family rejection as `panel_voter_same_family_at_runtime`.

The closure commit fixes the prose at `docs/contracts/REVIEW_PANEL.md:135`, but the same contract still says this event is emitted when "Any of layers 1-4 rejects a same-family vote attempt" at `docs/contracts/REVIEW_PANEL.md:368`. The state schema comment also still describes the event as "layer 1-4 of the 5-layer defense" at `src/state/schemas.ts:190`, and the validator test names still assert later-layer event validity.

Implementation evidence:

- Runtime layer 4 returns `panel_voter_same_family_at_runtime` at `src/phases/review-panel.ts:398` through `src/phases/review-panel.ts:406`.
- The only active producer I found for `panel_quorum_rejected_same_family_vote` is the doctor baseline path in `src/commands/doctor-panel-baseline.ts`, which emits it with `layer: 'config-load'`.
- `rg -n "panel_quorum_rejected_same_family_vote" src tests docs/contracts/REVIEW_PANEL.md` shows no runtime layer-4 producer.

Recommendation:

- Update the event table row and schema/test comments to match the new v0.1 wording: this event is emitted by `code-oz doctor --panel-baseline` as the layer-1 positive control only.
- If the enum intentionally keeps later-layer values for forward compatibility, say that explicitly: the schema reserves the discriminator values, but v0.1 only has a config-load producer. Do not describe reserved values as emitted behavior.

### 2. medium — The common-errors table still names non-emitted or wrong error codes

Files:

- `docs/contracts/REVIEW_PANEL.md:445`
- `docs/contracts/REVIEW_PANEL.md:447`
- `docs/contracts/REVIEW_PANEL.md:448`
- `docs/contracts/REVIEW_PANEL.md:450`
- `docs/contracts/REVIEW_PANEL.md:452`
- `src/config/load.ts:443`
- `src/phases/review-panel.ts:240`
- `src/artifacts/review-report.ts:2201`
- `src/state/events.ts:1461`

The R6 residual sweep asked whether any rejection codes named in the table are not emitted, or implementation codes are not named. The active common-errors table still contains several stale codes.

Concrete mismatches:

- `panel_advisory_only` is documented at `docs/contracts/REVIEW_PANEL.md:447`, but I found no implementation or test reference. Advisory-only panels currently use `panel_voter_count_invalid`.
- `panel_routed_lineage_unknown` is documented at `docs/contracts/REVIEW_PANEL.md:448`, but I found no implementation or test reference. The runtime unresolved-family path is `panel_provider_family_unresolved`; serialized unknown-family voters are handled by eligibility/quorum recomputation rather than that named error.
- `review_panelist_field_order` is documented at `docs/contracts/REVIEW_PANEL.md:450`, but I found no implementation reference. The parser currently reports `review_panel_reviewer_missing`, `review_panel_reviewer_grammar`, or related reviewer errors.
- `event_panel_quorum_inconsistent` is documented at `docs/contracts/REVIEW_PANEL.md:452` and in the five-layer table, but the validator returns `event_invalid_value` with a layer-5 rule when a ready `review_panel_completed` event has the wrong eligible-voter count.

This is not a runtime failure. It is active contract/debugging drift: an operator following `REVIEW_PANEL.md` would look for codes the implementation does not produce.

Recommendation:

- Replace stale common-error rows with current implementation codes, or add the missing typed codes intentionally with tests.
- At minimum, align:
  - advisory-only or wrong voter count -> `panel_voter_count_invalid`
  - unresolved provider family -> `panel_provider_family_unresolved`
  - panelist grammar/order problems -> current parser codes, unless a dedicated `review_panelist_field_order` validator is added
  - layer-5 event backstop -> `event_invalid_value`, unless a dedicated `event_panel_quorum_inconsistent` code is added

## Anti-pattern audit

- R5 layer-3 and layer-4 table shape: materially corrected.
- `computeCanonicalPanelVerdict` authority wording: corrected.
- Runtime same-family-voter laundering: still rejected before artifact materialization through `panel_voter_same_family_at_runtime`.
- Old staging path drift: no active `state/review-panel` or `state/REVIEW.md` references found in active source/contracts/tests from the R5 sweep.
- Remaining problem: active contract tables still contain event/error-code truth drift.

## Summary

Verdict `fix-first`. This should be a narrow docs/test-comment cleanup, not another implementation round. After the event table, schema/test wording, and common-errors table are aligned with current emitted codes, R7 should be eligible for `push` unless a new behavioral or contract-truth issue appears.
