# Fixture 05 — Reviewer blocks risk

## What this proves

A reviewer verdict of `needs-revision` is a phase-level state transition, not a soft signal. The lifecycle routes back to a revision sub-phase instead of advancing to SHIP.

## Setup

1. Construct a minimal `ReviewResult` payload representing a reviewer flagging a risky change:
   - `verdict: "needs-revision"`
   - `findings: [ { id: "F1", severity: "high", file: "src/example.ts", line: 10, summary: "shell-injection risk: command built via string concatenation" } ]`
   - `summary: "Reviewer identified a shell-injection risk; revision required before SHIP."`
2. Invoke the REVIEW phase result writer with that payload.

## Expected gate behavior

The phase records the `needs-revision` outcome and does NOT advance to SHIP. The REVIEW status enum at `src/phases/review.ts:224` distinguishes `resolved`, `needs_revision`, `blocked`, and `intervention`. Production code at `src/phases/review.ts:237-244` routes the `needs_revision` case into the revision coordinator instead of writing `GATE_REVIEW_PASSED.json`.

## Expected `events.jsonl` event sequence

```jsonl
{"type":"phase_entered","phase":"review","ts":"..."}
{"type":"review_round_completed","verdict":"needs-revision","findingCount":1,"ts":"..."}
{"type":"review_routed_to_revision","reason":"reviewer_needs_revision","ts":"..."}
```

The fixture exits BEFORE `GATE_REVIEW_PASSED.json` is written — that gate file is what `SHIP` would consume to advance, and it is not produced when the verdict is `needs-revision`.

## Expected exit state

- `REVIEW.md` is written with the full reviewer payload (verdict + findings + summary).
- A `revision_request.json` (or equivalent) records the routing decision and the next revision-round target.
- `GATE_REVIEW_PASSED.json` is NOT written.

The fixture's `actual.txt` confirms:

- Verdict was `needs-revision`.
- No SHIP gate file was created.
- The expected number of findings was carried through.

## Production code that enforces this

`src/phases/review.ts:224` defines the `ReviewStatus` enum that distinguishes outcomes. `src/phases/review.ts:237-244` routes the `needs_revision` case. The full status set:

```ts
export type ReviewStatus = 'resolved' | 'needs_revision' | 'blocked' | 'intervention'
```

- `resolved` → writes `GATE_REVIEW_PASSED.json`; SHIP proceeds.
- `needs_revision` → routes to revision coordinator; SHIP gate NOT written.
- `blocked` → run halts pending intervention.
- `intervention` → `NEEDS_INTERVENTION.json` written.

## Why this matters

In a direct-agent flow, a reviewer comment is text. A human (or a downstream agent) reads it and decides whether to act. There is no mechanical link between "the reviewer flagged a security risk" and "the change does not ship."

`code-oz` makes that link mechanical. The `needs-revision` verdict drives a state transition; SHIP cannot fire because the gate file SHIP needs is never written. The reviewer's findings live in `REVIEW.md` and are inspectable; the lifecycle position is on-disk and unambiguous.

The complementary fixture is `04-same-family-review` (which proves the REVIEW invocation has to come from a different family to begin with). Together they cover both the "who reviews" and "what review decides" sides of the policy.

## Captured output location

`docs/demo/02-failure-gates/output/05-reviewer-blocks-risk/`
