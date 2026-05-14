# Failure-gates demo (`02-failure-gates`)

> Governance only matters if bad runs get blocked.

The `01-todo-cli` demo shows the happy path. This demo proves the gates do what they claim to do: refuse the wrong thing and produce inspectable evidence of the refusal. Five fixtures. Each exercises one specific governance failure mode. Each fixture is deterministic via FakeProvider — no live LLM, no spend, no flake.

The point of this demo is NOT that FakeProvider writes better code. The point is that the same gates, the same `events.jsonl` ledger, and the same `NEEDS_INTERVENTION.json` / `STOP.json` mechanics work every time, and each one carries the exact evidence a third party needs to reconstruct what happened.

## Run it

```sh
bun run demo:failure-gates
```

Then inspect the produced output:

```sh
ls docs/demo/02-failure-gates/output/
cat docs/demo/02-failure-gates/output/01-tampered-artifact/events.jsonl
cat docs/demo/02-failure-gates/output/01-tampered-artifact/NEEDS_INTERVENTION.json
```

Every fixture writes its captured outputs under `docs/demo/02-failure-gates/output/<fixture>/`. The committed outputs in this repo are the expected outputs — running the demo locally should match them byte-for-byte (modulo timestamps, which are recorded but not asserted).

Exit code is 0 if every fixture's gate behavior matched its expected snapshot, non-zero otherwise. The orchestrator prints a per-fixture pass/fail summary at the end.

## The five fixtures

| # | Fixture | What it exercises | Production code that blocks it |
|---|---------|-------------------|--------------------------------|
| 1 | [`01-tampered-artifact`](fixtures/01-tampered-artifact/SPEC.md) | An approved artifact (`PLAN.md`) is edited after approval; next phase preflight refuses. | `src/state/gates.ts:104-118` — `gate_artifact_sha256_mismatch` |
| 2 | [`02-scope-escape`](fixtures/02-scope-escape/SPEC.md) | A REVIEW finding cites a path outside the run worktree; review refuses to record the finding. | `src/phases/review.ts:2189-2204` — out-of-worktree finding rejection |
| 3 | [`03-verify-fail`](fixtures/03-verify-fail/SPEC.md) | VERIFY's evidence command fails; phase writes `NEEDS_INTERVENTION.json` and pauses. | `src/phases/verify.ts:180-205` — `writeNeedsInterventionGate` |
| 4 | [`04-same-family-review`](fixtures/04-same-family-review/SPEC.md) | Cross-family REVIEW invoked with reviewer family equal to builder family; the tool throws. | `src/tools/review-request.ts:60-78` — `provider_permissions_violation` |
| 5 | [`05-reviewer-blocks-risk`](fixtures/05-reviewer-blocks-risk/SPEC.md) | Reviewer verdict is `needs-revision`; lifecycle routes back to revision instead of SHIP. | `src/phases/review.ts:237-244` — `needs_revision` routing |

## What this proves

- **Tampered approvals do not propagate.** An artifact's SHA-256 binds the approval to the exact bytes. If anything changes after approval — by an agent, by a human, by an attacker — the next phase notices.
- **Scope discipline holds at REVIEW too, not just at BUILD.** Even if a reviewer wants to comment on something outside the run's worktree, the gate refuses.
- **Verification evidence is enforced, not advisory.** A run with a failing test command writes a structured `NEEDS_INTERVENTION.json` for a human to inspect. It does not silently advance.
- **Builder and reviewer must differ in model family.** The cross-family REVIEW policy is mechanical, not a recommendation. Same-family review is refused before the reviewer is called.
- **Risky reviewer findings route back to revision.** A `needs-revision` verdict is not a soft signal. The lifecycle treats it as a phase-level state transition.

## What this does NOT prove

- **It does not prove FakeProvider writes good code.** FakeProvider is deterministic and tiny. The point of using FakeProvider here is reproducibility, not model quality. The captured outputs in this directory are committed; running the demo should match them.
- **It does not prove `code-oz` catches every governance failure.** Five fixtures cover five enforcement paths. There are more enforcement paths in the spine (cost budgets, debate scheduler, mutation gating at BUILD time, etc.) that are not exercised here. The fixtures grow with future releases.
- **It does not benchmark `code-oz` against direct-agent workflows.** That is the [`Agent Gate Bench`](../../benchmarks/agent-gate-bench.md) protocol; the runner ships in v0.21.

## Inspecting the evidence

Each fixture's output directory contains:

| File | Content |
|------|---------|
| `events.jsonl` | The append-only ledger of every event the gate produced. Each line is a structured JSON event. |
| `NEEDS_INTERVENTION.json` or `STOP.json` | The structured gate-refusal artifact, when the fixture's gate produces one. Names the exact rule that refused, the actionable suggestions, and the offending input. |
| `actual.txt` | The fixture orchestrator's summary of what happened (what was attempted, what blocked, where the block was enforced). |

The ledger format is documented at [`docs/references/file-based-gates.md`](../../references/file-based-gates.md).

## Why this demo exists

A common objection to AI coding tools is "but how do I know the agent did what it said it did?" In direct-agent workflows the honest answer is "you trust the agent and the chat transcript." `code-oz` replaces trust with evidence: the gate file, the events ledger, the per-run worktree, and the cross-family review verdict are all on disk after every run.

This demo makes that evidence concrete. Every claim in the README about file-based gates and SHA-bound approvals corresponds to a fixture you can run in 30 seconds and a captured output you can read.

If you find a case the gates should catch but do not, that is the most valuable issue you can file. See [`.github/ISSUE_TEMPLATE/demo_failure.yml`](../../.github/ISSUE_TEMPLATE/demo_failure.yml).
