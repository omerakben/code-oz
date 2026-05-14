# Fixture 03 — Verify intervention

## What this proves

`writeNeedsInterventionGate` writes a schema-validated `NEEDS_INTERVENTION.json` carrying actionable suggestions. This is the production primitive the orchestrator invokes when VERIFY exhausts its restart attempts or hits a non-restart-eligible failure mode.

## Important framing (corrected per Codex R1)

A normal VERIFY evidence-command failure does **not** immediately produce `NEEDS_INTERVENTION.json`. Production behavior at `src/phases/verify.ts:599+` is:

1. Run the evidence command.
2. On non-zero exit: emit `worktree_forensics_preserved` + `verify_failed` events.
3. For attempts 1–3: return restart (the run retries with the next BUILD attempt).
4. For attempt 4 OR a non-restart-eligible failure (e.g., contract violation, missing artifact): escalate to durable intervention via `writeNeedsInterventionGate`.

This fixture exercises step 4 — the durable-intervention path that production reaches on cap exhaustion or non-restart-eligible failures. The fixture does NOT exercise the verify_failed + restart loop (that requires the full BUILD-VERIFY orchestrator harness, which lives in `tests/verify-phase.test.ts:392+` and ships with the M17 brownfield runtime).

## Setup

1. Construct a minimal `GatePaths` (run dir + artifact root + lock dir).
2. Construct a `NeedsInterventionGate` payload representing the cap-exhausted state (or a non-restart-eligible failure):
   - `code: "verify_failed_evidence_command_exit_nonzero"`
   - `rule: "the configured evidence command must exit zero before VERIFY advances"`
   - `actionableSuggestions: [...]`
3. Invoke `writeNeedsInterventionGate(gatePaths, gate)`.

## Expected gate behavior

Production code at `src/state/gates.ts:290+` (`writeNeedsInterventionGate`) writes the gate file atomically (temp file → rename) under the per-run lock. The schema validator at `validateNeedsIntervention` checks all required fields (version, runId, phase, agent, code, rule, actionableSuggestions, eventPointer, createdAt) before the write proceeds.

## Expected exit state

- `NEEDS_INTERVENTION.json` exists at `<runDir>/NEEDS_INTERVENTION.json`.
- The file content is valid JSON matching `NeedsInterventionGate` schema (`src/state/schemas.ts:1582`).
- Required fields present: `version: 1`, `runId`, `phase: "verify"`, `agent`, `code`, `rule`, `actionableSuggestions: [...]`, `eventPointer`, `createdAt`.

## Production code that enforces this

- `src/state/gates.ts:290` — `writeNeedsInterventionGate` (the writer the orchestrator invokes).
- `src/state/gates.ts:314+` — `writeControlGate` (atomic write + lock + schema validation).
- `src/phases/verify.ts:599+` — the caller-side logic that decides WHEN to invoke `writeNeedsInterventionGate` (cap-exhaustion, non-restart-eligible failures).

## Why this matters

In a direct-agent workflow, a failing test eventually surfaces somewhere: the agent might mention it in chat, the human might notice the test output, both might miss it. There is no structured artifact carrying the failure signal that a third party can inspect after the fact.

`code-oz` makes the failure structured. The `NEEDS_INTERVENTION.json` artifact carries enough context for a human to triage without re-running the failure: which command failed, what its exit context was, what suggestions the orchestrator emits. The run does not advance; it pauses for an explicit human decision.

## Captured output location

`docs/demo/02-failure-gates/output/03-verify-fail/`

- `NEEDS_INTERVENTION.json` — **a real production gate file** (this fixture is the only one in this demo whose committed output is a production-API-written artifact)
- `events-sketch.jsonl` — author-constructed event sketch (NOT a production events.jsonl)
- `actual.txt` — orchestrator summary
