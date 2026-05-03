# Codex implementation review — M14 R5

Thread: `019dee31-ea00-7011-b959-fb829393bc55`
Reviewed branch: `feat/m14-reviewer-panel` at `9bdcec1`
Reviewed commit: `9bdcec1 docs(contracts/review-panel,review-panel,state/schemas,state-events-panel): close R4 residual doc drift`
Date: 2026-05-03

## Verdict

`fix-first`

The R4 closure commit correctly closes both R4 findings. The staging wording now matches runtime behavior, the common-error recovery guidance no longer claims regeneration from staging, and the active source/test path drift is fixed.

Do not tag M14 yet. The requested final sweep found one remaining active contract/comment drift in the five-layer defense-in-depth surface. This is not a runtime bug in the panel path, but it is still active authority-boundary documentation drift in the M14 contract.

## Validation

- `git log --oneline main..HEAD | head -1` returned the expected R4 closure commit at `9bdcec1`.
- `bun run typecheck` passed (`tsc --noEmit` exited 0).
- `bun test` could not produce the expected 2425 pass / 1 skip / 0 fail in this read-only sandbox. It failed on temp-dir writes (`EPERM: operation not permitted, mkdtemp '/var/folders/.../T/...'`) and exited with 1612 pass / 793 fail / 2405 tests. These failures match the sandbox limitation seen in R4, not accepted product signal.
- `rg -n "state/review-panel|state/REVIEW\.md" docs/contracts src tests` returned no matches.

## R4 closure audit

### R4 finding #1 — REVIEW_PANEL.md staging recovery/verification overshoots

Closed.

`docs/contracts/REVIEW_PANEL.md:158` now says the orchestrator writes each staging file and records `stagingSha256` from in-memory content. It explicitly says v0.1 does not read staging back for verification, resume, recovery, or synthesis-from-staging.

`docs/contracts/REVIEW_PANEL.md:447` now gives operator recovery guidance for `review_artifact_quorum_inconsistent`: inspect canonical `REVIEW.md` and `events.jsonl`, then restore the canonical artifact or clear run state and rerun REVIEW. It no longer claims the orchestrator regenerates from staging.

### R4 finding #2 — Active source/test path drift

Closed.

- `src/phases/review-panel.ts:96` now points the staging draft comment at `.code-oz/runs/<runId>/review-panel/round-<N>/panelist-<id>.md`.
- `src/state/schemas.ts:870` now uses the same run-local path in the `review_panelist_completed.stagingPath` comment.
- `tests/state-events-panel.test.ts:152` now seeds `.code-oz/runs/01HX/review-panel/round-1/panelist-reviewer-A.md`.
- The active source/contract/test grep for `state/review-panel` and `state/REVIEW.md` is clean.

## Finding

### 1. medium — Five-layer defense table still describes the pre-closure authority shape

Files: `docs/contracts/REVIEW_PANEL.md:121`, `docs/contracts/REVIEW_PANEL.md:129`, `docs/contracts/REVIEW_PANEL.md:130`, `docs/contracts/REVIEW_PANEL.md:133`, `src/phases/review-panel-verdict.ts:8`, `src/phases/review-panel.ts:16`, `src/phases/review-panel.ts:392`, `src/artifacts/review-report.ts:1874`, `src/artifacts/review-report.ts:1903`, `src/artifacts/review-report.ts:1953`

The contract's five-layer table is not fully accurate after the R1/R2/R3 fixes that R5 asked me to sweep.

Layer 3 is listed only as `Artifact-parse recomputation` with error code `review_artifact_quorum_inconsistent`. The parser now enforces more than recomputation: manifest equality (`review_panelist_manifest_mismatch`) and F4 authority-impact/source consistency (`review_artifact_authority_impact_inconsistent`) before the recomputed verdict check. Those are active parser defenses in `src/artifacts/review-report.ts:1874`, `src/artifacts/review-report.ts:1903`, and `src/artifacts/review-report.ts:1953`, but the table still only names the final recompute error.

Layer 4 is listed as `Quorum-time filtering` in `src/phases/review-panel-verdict.ts` with no rejection code. That no longer matches the runtime authority surface. `src/phases/review-panel.ts:16` describes layer 4 as the panel orchestrator, and `src/phases/review-panel.ts:392` shows why: the orchestrator resolves provider family through `registry.familyOf()` and returns `panel_voter_same_family_at_runtime` before any artifact is materialized when a runtime override collapses a voter into the build family. The pure verdict helper is still part of canonical synthesis, but the table should identify the orchestrator as the layer-4 runtime authority and name the same-family-at-runtime intervention.

There is also related wording drift at `docs/contracts/REVIEW_PANEL.md:133`: it says `panel_quorum_rejected_same_family_vote` fires whenever any of layers 1-4 rejects a same-family vote attempt. The only producer in active code is the doctor baseline positive-control path for config-load rejection; the runtime layer-4 path returns `panel_voter_same_family_at_runtime` and does not emit that event. Either the contract should narrow the event claim to what v0.1 emits, or the runtime should emit the event on the layer-4 intervention. Given R5's cleanup framing, I would keep this as a docs/comment correction unless the team wants the layer-4 event for telemetry.

Recommendation:

- Update `docs/contracts/REVIEW_PANEL.md` so layer 3 names the parser invariant bundle: manifest equality, authority-impact/source consistency, and verdict recomputation.
- Update layer 4 to point at `src/phases/review-panel.ts` as the panel orchestrator runtime authority, with `registry.familyOf()` resolution and `panel_voter_same_family_at_runtime`.
- Align `src/phases/review-panel-verdict.ts:8` so it no longer claims the verdict helper itself is layer 4. It can say the helper is the pure algorithm used by the layer-4 orchestrator and mirrored by layer-3 parser recomputation.
- Clarify whether `panel_quorum_rejected_same_family_vote` is only the doctor-baseline/config-load positive control in v0.1, or emit it in the runtime layer-4 same-family intervention.

## Anti-pattern audit

- R4 staging overshoot: closed.
- Old `state/review-panel` / `state/REVIEW.md` active path drift: closed.
- Synthesis-from-staging or staging parser claim: no active overstatement found; remaining `synthesis-from-staging` mentions are negative statements.
- New runtime scope creep: none found in the R4 closure commit.
- Remaining drift: five-layer defense table and related active comments/event wording.

## Summary

Verdict `fix-first`. The R4 fixes are correct and typecheck is clean, but M14 should not tag until the five-layer defense table and related active comments/event wording match the current post-F3/R2/R3 runtime shape.
