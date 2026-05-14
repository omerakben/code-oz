# Fixture 05 — Reviewer status illustration

## What this proves (status-shape illustration)

The `ReviewStatus` union at `src/phases/review.ts:224` distinguishes four outcomes — `'resolved'`, `'needs_revision'`, `'blocked'`, `'intervention'` — and only `'resolved'` produces `GATE_REVIEW_PASSED.json` in production. The fixture demonstrates the enum distinction and the structural decision (would this status produce SHIP gate? would it route back to revision?).

## Important framing (corrected per Codex R1)

This fixture is a **status-shape illustration**, not a routing-execution proof. The actual production routing through `runReview` → `finalizeReviewRound` (`src/phases/review.ts:631`) → `decideReviewRemediation` (`src/phases/review.ts:107`, with full implementation at line ~1572+) requires a fully-constructed REVIEW phase context with active orchestration state. The full routing is exercised in `tests/review-phase.test.ts:620+` and is not duplicated here.

The fixture's value is making the distinction visible to readers: when a reviewer returns `needs_revision`, that status is a distinct value in the `ReviewStatus` enum, and production code branches on it differently from `resolved`.

## Setup

1. Construct a `ReviewResult`-shaped object with `status: 'needs_revision'`, one finding, and a summary.
2. Verify the status is in the documented `ReviewStatus` enum.
3. Verify `wouldShip = (status === 'resolved')` is `false`.
4. Verify `wouldRouteToRevision = (status === 'needs_revision')` is `true`.

## Expected gate behavior

The fixture writes a demo-authored `REVIEW.md` with the findings + summary, illustrating what the production review writes when a reviewer returns `needs_revision`. The fixture also confirms (by assertion) that no `GATE_REVIEW_PASSED.json` would be written for this status.

## Expected exit state

- `REVIEW.md` exists in the fixture's output directory (illustrative, not produced by `runReview`).
- The fixture's `actual.txt` records:
  - `status: needs_revision`
  - `status is in ReviewStatus enum: true`
  - `would write GATE_REVIEW_PASSED.json: false`
  - `would route to revision instead: true`

## Production code referenced

- `src/phases/review.ts:224` — `ReviewStatus` union definition.
- `src/phases/review.ts:631` — `runReview` → `finalizeReviewRound` (the production entry to the routing logic).
- `src/phases/review.ts:107` — `decideReviewRemediation` (the routing decision; full implementation around line 1572+).
- `tests/review-phase.test.ts:620+` — the production-routing tests (where the actual branching is exercised end-to-end).

## Why this matters

In a direct-agent workflow, "the reviewer flagged a security risk" is text — usually in chat, sometimes in a comment, sometimes ignored. There is no mechanical state transition that prevents the change from advancing.

`code-oz` makes the link mechanical via the `ReviewStatus` enum. The status is a distinct value in the type system; production code branches on it; only `'resolved'` writes the SHIP gate file. The fixture shows the distinction; production tests prove the routing.

## Captured output location

`docs/demo/02-failure-gates/output/05-reviewer-blocks-risk/`

- `REVIEW.md` — demo-authored illustrative review (NOT produced by `runReview`)
- `events-sketch.jsonl` — author-constructed event sketch (NOT a production events.jsonl)
- `actual.txt` — orchestrator summary

For a production-shaped REVIEW.md produced by `runReview`, see the M14/M15 review-panel test fixtures and the planned brownfield-smoke artifacts shipping in v0.21.
