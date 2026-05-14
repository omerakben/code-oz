# Fixture sample run

This is the canonical fixture the GUI renders against in v0. It represents a brownfield run mid-execution:

- **Profile:** brownfield
- **Current phase:** build (with T-001 awaiting review-fix re-build, T-002 verify-passed, T-003 building, T-004 pending)
- **AUDIT:** approved
- **PLAN:** approved
- **First REVIEW round on T-001:** verdict `fix-first` with 2 findings
- **Budget:** 75.4% spent (just tripped soft-warn)

## Files

- `events.jsonl` — 54-line append-only event log. Realistic shapes per `~/Projects/code-oz/src/state/schemas.ts`; below the step-2 ≥60 target because this fixture avoids filler events for v0.
- `current.json` — derived run-state projection (cards, currentPhase, budgets). The GUI server replays events.jsonl to build this, but a static projection is checked in to bootstrap tests.
- `AUDIT.md` — the audit artifact (approved).
- `PLAN.md` — the plan artifact (approved). Lists 4 tasks.
- `BUILD_REPORT.md` — partial build report; covers T-001 and T-002.
- `VERIFY.md` — partial verify report; covers T-001 and T-002.
- `REVIEW.md` — review round 1 for T-001 (`fix-first`, 2 findings).

## Properties the GUI must render correctly

- All 6 board columns visible, each header rendered with plain English + technical subtitle.
- UNDERSTAND column: 1 approved AUDIT card.
- PLAN column: 1 approved PLAN card.
- BUILD column: T-003 (in-progress shimmer) + T-004 (pending muted).
- VERIFY column: empty (T-001 + T-002 advanced past).
- REVIEW column: T-001 (awaiting-approval, emerald loud) + T-002 (in-progress, calm).
- SHIP column: empty dashed.
- Budget gauge at 75.4% (amber).
- Decisions fixture coverage: gate approval, open question, AI verdict, debate outcome, and budget warning rows.

## Updating the fixture

If you append events to `events.jsonl` to test live SSE, write each line as a single-line JSON object. Do not prettify. The server's fs.watch + tail loop reads one line per event.
