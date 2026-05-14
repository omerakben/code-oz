# Failure-gates demo (`02-failure-gates`)

> Governance only matters if bad runs get blocked.

The `01-todo-cli` demo shows the happy path. This demo proves the gates do what they claim to do: refuse the wrong thing. Five fixtures. Each exercises one specific governance failure mode by invoking the underlying production gate API directly with bad input and asserting the refusal happens.

**This demo is NOT a full lifecycle simulation.** It does not spawn `code-oz init && code-oz run`. It does not produce a real production `events.jsonl` ledger. It calls the same production primitives the orchestrator uses — `writeGate`, `writeNeedsInterventionGate`, `requestReview`, the `ReviewStatus` distinction — and captures evidence of their refusal behavior into per-fixture output directories. The captured `NEEDS_INTERVENTION.json` (fixture 03) is a real production gate file, written via the production `writeNeedsInterventionGate` API. The captured `events-sketch.jsonl` files are fixture-author summaries of what production code did, NOT real production events written via `appendEvent`.

For the complete production lifecycle (DEFINE → SHIP including real `events.jsonl`), run the [`01-todo-cli`](../01-todo-cli/README.md) happy-path demo — its committed outputs at `docs/demo/01-todo-cli/output/balanced/state/events.jsonl` are real production events. The full per-phase failure-mode lifecycle simulation (ie `code-oz run` driving each fixture all the way through the gates) ships in v0.21 alongside the M17 brownfield runtime. v0.20.1 demonstrates the gate primitives in isolation; v0.21 wires them into a full lifecycle harness.

## Run it

```sh
bun run demo:failure-gates
```

Then inspect the produced output:

```sh
ls docs/demo/02-failure-gates/output/
cat docs/demo/02-failure-gates/output/01-tampered-artifact/events-sketch.jsonl
cat docs/demo/02-failure-gates/output/03-verify-fail/NEEDS_INTERVENTION.json
```

Every fixture writes its captured outputs under `docs/demo/02-failure-gates/output/<fixture>/`. The committed outputs in this repo were captured on the maintainer's machine; local runs will match the structure and the `actual.txt` pass-criterion text but the temporary directory paths recorded in `actual.txt` (and in fixture 02's events-sketch) will differ by run. We do NOT assert byte-for-byte snapshot equality.

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

- **Tampered approvals do not propagate.** `writeGate` with a mismatched `artifactSha256` raises `gate_artifact_sha256_mismatch` and refuses to record the approval. The same primitive is invoked at every phase preflight in the production lifecycle.
- **Scope discipline at REVIEW.** The realpath + worktree-prefix check that production review-finding validation uses (one of several validation steps inside `src/phases/review.ts`) refuses paths that resolve outside the run worktree.
- **Intervention writing produces structured artifacts.** `writeNeedsInterventionGate` writes a schema-validated `NEEDS_INTERVENTION.json` carrying actionable suggestions. Production calls this API on cap-exhausted retries and on durable intervention paths; a normal verify failure first goes through `verify_failed` + restart for the first three attempts, then escalates to intervention only if attempts are exhausted.
- **Builder and reviewer must differ in model family.** `requestReview` throws `provider_permissions_violation` BEFORE invoking the reviewer when builder and reviewer share a family. The check is in `src/tools/review-request.ts`.
- **Status enum distinguishes needs-revision from resolved.** The `ReviewStatus` union at `src/phases/review.ts:224` carries four values; only `resolved` advances toward SHIP. The full routing through `finalizeReviewRound` and `decideReviewRemediation` is exercised in `tests/review-phase.test.ts`.

## What this does NOT prove

- **It does not prove FakeProvider writes good code.** FakeProvider is deterministic and tiny. The point of using FakeProvider here is reproducibility, not model quality. The captured outputs in this directory are committed; running the demo should match them.
- **It does not prove `code-oz` catches every governance failure.** Five fixtures cover five enforcement paths. There are more enforcement paths in the spine (cost budgets, debate scheduler, mutation gating at BUILD time, etc.) that are not exercised here. The fixtures grow with future releases.
- **It does not benchmark `code-oz` against direct-agent workflows.** That is the [`Agent Gate Bench`](../../benchmarks/agent-gate-bench.md) protocol; the runner ships in v0.21.

## Inspecting the evidence

Each fixture's output directory contains:

| File | Content | Production-equivalent? |
|------|---------|------------------------|
| `events-sketch.jsonl` | A per-fixture sketch of the events the production code path emitted, in approximate JSON-line shape. **Author-constructed** — not produced by the production `appendEvent` API. Event names in the sketch are illustrative; some have direct production analogs (`verify_failed`, `phase_entered`), others are summary-only (`review_finding_rejected`). | NO — see warning below |
| `NEEDS_INTERVENTION.json` (fixture 03 only) | The schema-validated production gate file written by `writeNeedsInterventionGate`. This file IS a real production gate artifact and matches the schema at `src/state/schemas.ts:1582`. | YES |
| `REVIEW.md` (fixture 05 only) | A demo-authored REVIEW.md illustrating a `needs-revision` verdict with findings. Production review writes a richer REVIEW.md via `runReview`. | NO — illustrative |
| `actual.txt` | The fixture orchestrator's summary of what was attempted, what production API was called, and what blocked. | n/a (orchestrator output) |

> **Why "events-sketch" instead of "events.jsonl"?** The production `events.jsonl` is the append-only run ledger written by `appendEvent` (`src/state/events.ts`). It carries strict event schemas (e.g., `verify_failed` requires fields like `runId`, `agent`, `attempt`, `taskId`, `reportSha`, `terminationReason`, `failureSummary`). The demo orchestrator does NOT spin up a full run and does NOT call `appendEvent`. Calling the per-fixture file `events.jsonl` would mislead anyone inspecting it after running the demo. Keeping the suffix `-sketch.jsonl` and the framing here makes it explicit: these are author-constructed evidence summaries of what the production code path did. The full production ledger format is documented at [`docs/references/file-based-gates.md`](../../references/file-based-gates.md), and a real production `events.jsonl` is committed under [`docs/demo/01-todo-cli/output/balanced/state/events.jsonl`](../01-todo-cli/output/balanced/state/) for comparison.

## Why this demo exists

A common objection to AI coding tools is "but how do I know the agent did what it said it did?" In direct-agent workflows the honest answer is "you trust the agent and the chat transcript." `code-oz` replaces trust with evidence: the gate file, the events ledger, the per-run worktree, and the cross-family review verdict are all on disk after every run.

This demo makes that evidence concrete. Every claim in the README about file-based gates and SHA-bound approvals corresponds to a fixture you can run in 30 seconds and a captured output you can read.

If you find a case the gates should catch but do not, that is the most valuable issue you can file. See [`.github/ISSUE_TEMPLATE/demo_failure.yml`](../../.github/ISSUE_TEMPLATE/demo_failure.yml).
