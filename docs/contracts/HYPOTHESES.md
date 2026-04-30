# HYPOTHESES.md (v0.1)

User-facing summary of the hypotheses sidecar artifact, written by the Scientist phase-tail. Authoritative for v0.1.

## What HYPOTHESES.md is

A plain Markdown document at `.code-oz/artifacts/HYPOTHESES.md` that records the load-bearing claims the run has made so far, each with a falsifier (the observation that would prove the claim wrong). The sidecar persists across phases — PLAN's hypotheses survive into BUILD, VERIFY, and REVIEW.

The discipline is rule 15's mechanics. The dossier behind it is `docs/research/05-scientist-and-open-questions-agent.md`. The failure-family rationale is `docs/research/02-llm-failure-research.md` family 14 (assumption propagation).

## Canonical structure

```markdown
# HYPOTHESES

## H-001: The repo's Bun runtime supports `Bun.write` atomic semantics

- Phase: define
- Status: confirmed
- Falsifier: A test that calls `Bun.write` on a partially-fsynced temp + rename sequence and observes a half-written target.
- Evidence: docs/references/spec-contract.md § "Atomic write discipline"; src/state/gates.ts (existing pattern in v0.5.0).
- Risk if false: Gate writes lose durability under crash; entire SDLC discipline collapses.

## H-002: The syllable scorer can rank 5-name candidates within 50ms on phone-class hardware

- Phase: plan
- Status: open
- Falsifier: Microbenchmark on the M1 emulator profile shows >50ms median for 5 candidates.
- Evidence: SPEC.md acceptance criterion 1 (5 candidates); SPEC constraint (phone-class device).
- Risk if false: SPEC acceptance criterion 1 fails; PLAN's task T-001 needs rework.

## H-003: agent-skills syllable-pattern adapter is clean-room reusable

- Phase: plan
- Status: open
- Falsifier: Static analysis shows the adapter pattern is unique to agent-skills' implementation, not a generic technique.
- Evidence: SC-REF-001 (SOURCE_CHECK.md).
- Risk if false: PLAN task T-001 violates rule on no copy-paste from influence library.
```

## Three required H2 / H3 / bullet structure

| Element | Required | Notes |
|---|---|---|
| `# HYPOTHESES` (H1 title) | yes | Exact text on the first non-empty line |
| `## H-NNN: <one-line title>` | ≥ 0 | Each block is one hypothesis; runs may have zero hypotheses at DEFINE if `retroSeedDefine` is off |

Each `## H-NNN` block contains exactly these five bullets in order:

```markdown
- Phase: <phase the hypothesis was first emitted in>
- Status: <open | confirmed | rejected | obsolete>
- Falsifier: <a concrete observation or test that would prove the hypothesis wrong>
- Evidence: <citations: SPEC.md sections, SOURCE_CHECK.md ids, or external references>
- Risk if false: <one-line consequence>
```

- Bullets are one line each. Multi-line evidence is comma-separated within the bullet.
- Status transitions are append-only at the orchestrator level (see "Updates and id reuse" below).

## Hypothesis id grammar (locked)

```text
H-NNN          # zero-padded three-or-more digits, run-scoped, stable across phases
```

- Allocated by `allocateHypothesisId` in `src/artifacts/hypotheses.ts`.
- Run-scoped: ids are unique within a single `runId`. Cross-run identity is W2 territory (cross-run memory).
- Stable: an `H-NNN` allocated in PLAN keeps the same id when its status updates in BUILD/VERIFY/REVIEW.
- Reuse a prior id when the same claim persists across phases; allocate a new id only when a new claim emerges.

## Status semantics

| Status | Meaning | Allowed next status |
|---|---|---|
| `open` | Claim is live; falsifier not yet evaluated | `confirmed`, `rejected`, `obsolete` |
| `confirmed` | Falsifier evaluated and the claim survives | `obsolete` (if scope changes) |
| `rejected` | Falsifier evaluated and the claim is wrong | `obsolete` (if scope changes) |
| `obsolete` | The claim is no longer load-bearing for the run (e.g., scope cut) | terminal |

Rejected hypotheses are NOT deleted. They stay in the file as forensic record. Rule of thumb: if a future phase needs to know "we considered this and ruled it out," the rejected hypothesis is the audit trail.

## Falsifier requirements

Every hypothesis has a falsifier. The falsifier:

- Names a concrete observation, measurement, or test result.
- Is independent of the hypothesis itself ("the test I would run that would prove this wrong").
- Avoids tautology ("if it doesn't work, it's wrong").

Anti-pattern: `Falsifier: We will see if this works.` This is rejected by validation.

The 20-item universal rule sheet (`src/prompts/universal-rules.md`) bans anti-falsifier patterns; Scientist persona reads them as part of every invocation.

## Atomic write discipline

HYPOTHESES.md is written atomically (temp + fsync + rename + dir fsync). The Scientist phase-tail computes the new file content from the prior file plus the persona's update, then writes it. Partial writes are impossible by construction.

The orchestrator never writes an invalid HYPOTHESES.md; failure paths produce `HYPOTHESES.draft.md` plus `NEEDS_INTERVENTION.json`.

## Events emitted

| Event | When | Shape |
|---|---|---|
| `hypothesis_added` | A new `H-NNN` appears in HYPOTHESES.md | `{ id, phase, status, falsifier }` |
| `hypothesis_updated` | An existing `H-NNN` changes status, falsifier, evidence, or risk | `{ id, phase, prevStatus, nextStatus, changedFields }` |
| `science_emitted` | The Scientist phase-tail completes for a phase | `{ phase, hypothesesCount, openQuestionsCount }` |

All three are no-ops in the state reducer (do not advance phase state). They exist for the audit trail and W2 replay.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `hypothesis_missing_section` | A required bullet absent | Edit or rerun |
| `hypothesis_no_falsifier` | Falsifier bullet absent or empty | Add a concrete falsifier |
| `hypothesis_id_collision` | Two `H-NNN` blocks share an id | Renumber via the orchestrator |
| `hypothesis_id_format` | Id not matching `^H-\d{3,}$` | Use `H-001`, `H-042`, etc. |
| `hypothesis_invalid_status` | Status not in the locked enum | Use `open`, `confirmed`, `rejected`, or `obsolete` |
| `hypothesis_status_transition_invalid` | Status went from a terminal state to a non-terminal one | Allocate a new id instead of resurrecting |

## Reference

- **Linked contracts:** [`SCIENTIST.md`](./SCIENTIST.md), [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md), [`PLAN.md`](./PLAN.md)
- **Dossier:** `docs/research/05-scientist-and-open-questions-agent.md`
- **Failure-family rationale:** `docs/research/02-llm-failure-research.md` family 14 (assumption propagation), family 17 (overconfidence)
- **Non-negotiable rule:** `CLAUDE.md` rule 15 (Scientist tail at every phase contract)
