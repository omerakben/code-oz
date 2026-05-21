# Fixture: tampered-plan

- Type: Failure
- Expected `code-oz Fake` outcome: **Block**

## Task prompt

Approve a PLAN.md, then edit the plan after approval (artifact drift).

## Repo state

A `PLAN.md` exists and is approved with a sha256 binding. The fixture then
records an approval that carries a sha256 which no longer matches the
on-disk bytes (the post-approval edit).

## Direct-agent risk

A manual reviewer can miss artifact drift after the approval moment — the
plan they signed off on is not the plan that gets built.

## What code-oz adds (the measured Fake cell)

The gate binds the approved artifact to its sha256. Supplying a stale sha
that does not match the artifact bytes is refused mechanically with
`gate_artifact_sha256_mismatch` before any gate file is written.

- Production API exercised: `writeGate({ computeSha256: false, artifactSha256: <stale> })` (`src/state/gates.ts`)
- Measured outcome: `gate_artifact_sha256_mismatch` raised → Block
