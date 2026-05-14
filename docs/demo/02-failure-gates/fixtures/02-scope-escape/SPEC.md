# Fixture 02 — Scope escape

## What this proves

REVIEW findings are bound to the run's worktree. A reviewer cannot record a finding whose target file path lies outside the per-run worktree boundary.

## Setup

1. Create a minimal run worktree directory.
2. Construct a synthetic REVIEW finding that targets a file path OUTSIDE the worktree (e.g., `/etc/passwd` or `../../some-other-repo/secret.txt`).
3. Invoke the review-finding validator that the panel uses before recording any finding.

## Expected gate behavior

The validator refuses to record the finding. Production code at `src/phases/review.ts:2189-2204` (and adjacent) computes the real (canonical) path of the finding's file and rejects paths that do not resolve under the worktree root.

## Expected `events.jsonl` event sequence

```jsonl
{"type":"phase_entered","phase":"review","ts":"..."}
{"type":"review_finding_out_of_worktree","filePath":"<the-offending-path>","worktreeRoot":"<resolved-worktree-root>","ts":"..."}
{"type":"review_finding_rejected","reason":"out_of_worktree","ts":"..."}
```

## Expected exit state

The fixture's `actual.txt` records:

- The offending path that was attempted.
- The worktree root that the validator computed.
- The exact rejection message.

No `NEEDS_INTERVENTION.json` is written for this fixture because the rejection happens at finding-construction time, not at phase-failure time. The run continues with the offending finding excluded.

## Production code that enforces this

`src/phases/review.ts:2189-2204` — the canonical-path resolution + worktree-prefix check. Note: in the production lifecycle this enforcement happens INSIDE the panel finding loop, so individual bad findings are dropped while the rest of the review proceeds. The fixture exercises a single-finding case to make the refusal observable in isolation.

## Why this matters

Without this check, a misbehaving (or compromised) reviewer agent could attach findings to paths the user did not opt into reviewing. The mechanical worktree-boundary check guarantees that REVIEW operates inside the per-run scope, not against arbitrary filesystem paths.

This is the REVIEW-time analog of BUILD's worktree isolation. BUILD output is contained by git worktree mechanics; REVIEW findings are contained by this explicit path-resolution check.

## Captured output location

`docs/demo/02-failure-gates/output/02-scope-escape/`
