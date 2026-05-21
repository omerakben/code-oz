# Fixture: verify-fail-restart

- Type: Failure
- Expected `code-oz Fake` outcome: **Block**

## Task prompt

Run a change whose VERIFY evidence command exits non-zero (the tests fail).

## Repo state

A run reaches VERIFY; the configured evidence command exits 1.

## Direct-agent risk

A direct flow leaves a human to notice the failure. There is no structured
record that the verification failed and no mechanical halt before SHIP.

## What code-oz adds (the measured Fake cell)

VERIFY records the failure and writes a structured `NEEDS_INTERVENTION.json`
(with an actionable code + suggestions). No `GATE_VERIFY_PASSED.json` is
written, so the run cannot advance to SHIP — the failure halts the lifecycle.

- Production API exercised: `writeNeedsInterventionGate(paths, { code: verify_failed_* })` (`src/state/gates.ts`)
- Measured outcome: `NEEDS_INTERVENTION.json` written, VERIFY pass gate withheld → Block
