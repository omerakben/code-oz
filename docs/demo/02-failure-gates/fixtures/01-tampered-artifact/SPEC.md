# Fixture 01 — Tampered artifact

## What this proves

`writeGate` refuses to record an approval when the supplied `artifactSha256` does not match the bytes on disk. This is the production primitive that the orchestrator's gate-write path uses; tampered approvals fail at this primitive before any gate file lands.

## Setup

1. Create a minimal `PLAN.md` artifact (~10 lines of valid plan markdown) at the artifact root.
2. Compute its real SHA-256 (the demo lets `writeGate` do this when `computeSha256: true`; for this fixture we DO NOT set computeSha256).
3. Invoke `writeGate({computeSha256: false, gate: {..., artifactSha256: "<deliberately wrong hash>"}})`.

## Expected gate behavior

Production code at `src/state/gates.ts:107-118` recomputes the artifact's actual SHA-256 against the supplied `artifactSha256` and throws `GateLoadError` with `code: 'gate_artifact_sha256_mismatch'`. The thrown error is RAISED BEFORE any `GATE_<PHASE>_PASSED.json` file is written; the temp file path is created earlier in `writeGate` only after this check passes.

## Expected exit state

- A thrown `GateLoadError` with `issues[0].code === 'gate_artifact_sha256_mismatch'`.
- **No `GATE_PLAN_PASSED.json` file is written** — the gate-write path bails before the file lands.
- **No `NEEDS_INTERVENTION.json` is written by this fixture.** In the production lifecycle the orchestrator catches the error and routes it through its standard intervention plumbing (which writes `NEEDS_INTERVENTION.json` via `writeNeedsInterventionGate`); the demo does NOT exercise that orchestration layer. Fixture 03 demonstrates `writeNeedsInterventionGate` directly.

## Production code that enforces this

`src/state/gates.ts:107-118` — when `computeSha256 !== false` AND `opts.gate.artifactSha256 !== undefined`, the writer recomputes the SHA via `sha256File(artifactAbs)`. On mismatch, the writer throws `GateLoadError([{code: 'gate_artifact_sha256_mismatch', ...}])`.

## Why this matters

In a direct-agent workflow, an "approval" is typically a chat acknowledgement. There is no mechanical link between the approval and the bytes of the artifact. An agent (or a human, or an attacker) can edit the artifact post-approval and nothing notices.

`code-oz` makes the binding mechanical: the approval is to the bytes' SHA-256, not to the chat message that mentioned the plan. The first time anything tries to advance against an artifact whose SHA does not match the recorded one, the gate-write primitive refuses.

## Captured output location

`docs/demo/02-failure-gates/output/01-tampered-artifact/`

- `actual.txt` — orchestrator summary (what was attempted, what raised, the error code and rule)
- `events-sketch.jsonl` — author-constructed event sketch (NOT a production events.jsonl)
