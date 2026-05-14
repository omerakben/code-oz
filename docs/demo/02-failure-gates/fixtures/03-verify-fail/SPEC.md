# Fixture 03 — Verify fail

## What this proves

The VERIFY phase enforces evidence. If the configured evidence command fails, the phase writes a structured `NEEDS_INTERVENTION.json` containing actionable suggestions rather than silently advancing.

## Setup

1. Construct a minimal `VERIFY` phase context: a worktree path, a `BUILD_REPORT.md` pointer, and a fake evidence command that exits non-zero.
2. Invoke the VERIFY intervention path directly with that context — `src/phases/verify.ts` exports `writeVerifyIntervention()` for exactly this case.

## Expected gate behavior

The phase writes `NEEDS_INTERVENTION.json` at the run state directory. Production code at `src/phases/verify.ts:180-205` constructs the intervention payload and calls `writeNeedsInterventionGate()` from `src/state/gates.ts`.

## Expected `events.jsonl` event sequence

```jsonl
{"type":"phase_entered","phase":"verify","ts":"..."}
{"type":"verify_failed","reason":"evidence_command_exit_nonzero","exitCode":1,"ts":"..."}
{"type":"intervention_written","reason":"verify_failed","ts":"..."}
```

## Expected exit gate file

`NEEDS_INTERVENTION.json` with:

- `code: "verify_failed"`
- `phase: "verify"`
- `evidenceCommand: "<the command that was run>"`
- `exitCode: <the actual exit code>`
- `stdoutTail: "<last N bytes of stdout>"`
- `stderrTail: "<last N bytes of stderr>"`
- `suggestions: [ "inspect <worktree>/VERIFY_EVIDENCE for the test output", "re-run the failing test locally", "if the test is flaky, mark it skipped and document in BUILD_REPORT", ... ]`

## Production code that enforces this

`src/phases/verify.ts:180-205` builds the intervention payload; `src/state/gates.ts:290` (`writeNeedsInterventionGate`) is the orchestrator-owned writer.

## Why this matters

In a direct-agent workflow, a failing test is a soft signal. The agent may notice, the human may notice, neither may notice. By the time something ships and breaks in production, there is no audit trail of "the test was failing here, we chose to advance anyway."

`code-oz` makes the failure explicit and inspectable. The `NEEDS_INTERVENTION.json` artifact carries enough context for a human to triage without re-running the failure: which command failed, what its exit code was, what its stdout / stderr tail looked like. The run does not advance; it pauses for an explicit human decision.

## Captured output location

`docs/demo/02-failure-gates/output/03-verify-fail/`
