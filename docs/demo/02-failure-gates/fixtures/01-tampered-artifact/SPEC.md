# Fixture 01 — Tampered artifact

## What this proves

An approved artifact's bytes are bound to its approval via SHA-256. If the artifact is edited after approval, the next phase preflight refuses to advance.

## Setup

1. Create a minimal `PLAN.md` artifact (~10 lines of valid plan markdown).
2. Compute its SHA-256.
3. Write a `GATE_PLAN_PASSED.json` that records the artifact path plus its SHA.
4. Edit the artifact (append one byte) so the on-disk SHA no longer matches the recorded SHA.
5. Invoke the gate-preflight helper that the next phase (BUILD) would call.

## Expected gate behavior

The preflight refuses. Production code at `src/state/gates.ts:104-118` computes the artifact's actual SHA and compares it to the gate-recorded SHA. On mismatch it throws / writes a structured refusal.

## Expected `events.jsonl` event sequence

```jsonl
{"type":"phase_entered","phase":"build","ts":"..."}
{"type":"gate_artifact_sha256_mismatch","gate":"plan","ts":"..."}
{"type":"intervention_written","reason":"gate_artifact_sha256_mismatch","ts":"..."}
```

## Expected exit gate file

`NEEDS_INTERVENTION.json` with:

- `code: "gate_artifact_sha256_mismatch"`
- `artifactPath: "PLAN.md"`
- `expected: <recorded SHA from GATE_PLAN_PASSED.json>`
- `actual: <SHA computed after the edit>`
- `suggestions: [ "re-approve the modified artifact", "revert the edit to restore the approved bytes" ]`

## Production code that enforces this

`src/state/gates.ts:104-118` — the gate-preflight loop computes the artifact's actual SHA and emits `gate_artifact_sha256_mismatch` when it does not match.

## Why this matters

In a direct-agent workflow there is no equivalent. An agent (or a human, or an attacker) can edit a plan after it has been "approved" via chat, and nothing notices. SHA-bound approval makes the binding mechanical: the approval is to the bytes, not to the chat message that mentioned the plan.

## Captured output location

`docs/demo/02-failure-gates/output/01-tampered-artifact/`
