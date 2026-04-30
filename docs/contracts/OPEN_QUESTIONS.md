# OPEN_QUESTIONS.md (v0.1)

User-facing summary of the open-questions sidecar artifact, written by the Scientist phase-tail. Authoritative for v0.1.

## What OPEN_QUESTIONS.md is

A plain Markdown document at `.code-oz/artifacts/OPEN_QUESTIONS.md` that records questions the run has surfaced but not yet answered, each with status, importance, and (optionally) a due-by date. The sidecar persists across phases; ids are stable.

The discipline is rule 15's mechanics. The dossier behind it is `docs/research/05-scientist-and-open-questions-agent.md`. Open questions deferred indefinitely turn into hypotheses ("we are proceeding as if X is true; falsifier: Y"); resolved questions either close as out-of-scope or feed back into the next phase's input.

## Canonical structure

```markdown
# OPEN QUESTIONS

## Q-001: Should the app produce gender-neutral suggestions only?

- Phase: define
- Status: open
- Importance: medium
- DueBy: 2026-05-15
- Context: SPEC.md `## Open questions`, bullet 1 — user has not yet decided.
- Resolution attempts: none yet.

## Q-002: What is the device performance baseline for the 50ms acceptance criterion?

- Phase: plan
- Status: deferred
- Importance: high
- DueBy: 2026-05-10
- Context: H-002's falsifier requires a concrete benchmark profile; SPEC says "phone-class device" without specifying.
- Resolution attempts: 2026-04-30 — Lead persona proposed M1 emulator profile; user has not confirmed.

## Q-003: Is the agent-skills syllable adapter actually clean-room reusable?

- Phase: plan
- Status: resolved
- Importance: high
- DueBy: -
- Context: H-003's falsifier needed verification before T-001 implementation.
- Resolution attempts: 2026-04-30 — static analysis shows the adapter is a generic syllable-counting technique, not unique to agent-skills. H-003 marked confirmed.
- Resolved: 2026-04-30 — clean-room reuse approved.
```

## Three required H2 / H3 / bullet structure

| Element | Required | Notes |
|---|---|---|
| `# OPEN QUESTIONS` (H1 title) | yes | Exact text on the first non-empty line |
| `## Q-NNN: <one-line question>` | ≥ 0 | Each block is one question; runs may have zero questions at any phase |

Each `## Q-NNN` block contains exactly these required bullets in order:

```markdown
- Phase: <phase the question was first emitted in>
- Status: <open | resolved | deferred>
- Importance: <low | medium | high | blocking>
- DueBy: <ISO date YYYY-MM-DD or `-` if no deadline>
- Context: <one-line context, may cite SPEC/PLAN/HYPOTHESES anchors or ids>
- Resolution attempts: <one line per attempt, comma-separated; `none yet.` if zero>
```

When `Status: resolved`, append a final bullet:

```markdown
- Resolved: <ISO date YYYY-MM-DD> — <one-line resolution>
```

- Bullets are one line each.
- Status transitions are append-only at the orchestrator level (see "Status semantics").

## Question id grammar (locked)

```text
Q-NNN          # zero-padded three-or-more digits, run-scoped, stable across phases
```

- Allocated by `allocateQuestionId` in `src/artifacts/open-questions.ts`.
- Run-scoped: ids are unique within a single `runId`.
- Stable: a `Q-NNN` allocated in DEFINE keeps the same id when status changes in PLAN/BUILD/VERIFY/REVIEW.
- Reuse a prior id when the same question persists across phases.

## Status semantics

| Status | Meaning | Allowed next status |
|---|---|---|
| `open` | Question is live; needs resolution | `resolved`, `deferred` |
| `resolved` | Question has an answer; the answer is recorded in `Resolved:` | terminal |
| `deferred` | Question is acknowledged but parked (e.g., out of phase scope, awaiting external input) | `open`, `resolved` |

Resolved questions are NOT deleted. They stay in the file as forensic record. The `Resolved:` bullet captures the date and the one-line resolution.

## Importance and DueBy semantics

- **`Importance: low`** — nice-to-know.
- **`Importance: medium`** — should resolve before the run completes; non-blocking for the next phase.
- **`Importance: high`** — should resolve in the current or next phase; blocking if a `DueBy` is missed.
- **`Importance: blocking`** — must resolve before the current phase exits. The gate-preflight will block on `Status: open` + `Importance: blocking`.

`DueBy` is an ISO date or `-`. The gate-preflight blocks on:

- Any question with `Status: open` AND `Importance: blocking`.
- Any question with `Status: open` AND `DueBy` < today (overdue).

`Status: deferred` questions are allowed past the gate; `Status: resolved` questions are always allowed.

## Atomic write discipline

OPEN_QUESTIONS.md is written atomically (temp + fsync + rename + dir fsync). The Scientist phase-tail computes the new file content from the prior file plus the persona's update, then writes it.

The orchestrator never writes an invalid OPEN_QUESTIONS.md; failure paths produce `OPEN_QUESTIONS.draft.md` plus `NEEDS_INTERVENTION.json`.

## Events emitted

| Event | When | Shape |
|---|---|---|
| `question_added` | A new `Q-NNN` appears in OPEN_QUESTIONS.md | `{ id, phase, status, importance, dueBy }` |
| `question_resolved` | An existing question changes to `Status: resolved` | `{ id, phase, resolvedAt, resolution }` |
| `question_deferred` | An existing question changes to `Status: deferred` | `{ id, phase, deferredAt }` |
| `science_emitted` | The Scientist phase-tail completes (shared with HYPOTHESES.md) | `{ phase, hypothesesCount, openQuestionsCount }` |

All four are no-ops in the state reducer.

## Gate-preflight rule (locked)

`validateScientistSidecars({ phase, artifactRoot })` in `src/phases/gate-preflight.ts` blocks the gate when:

1. OPEN_QUESTIONS.md is missing or fails to parse.
2. Any `Status: open` question has `Importance: blocking`.
3. Any `Status: open` question has `DueBy` strictly less than today (overdue).

On block, the orchestrator writes `NEEDS_INTERVENTION.json` with `code: 'open_question_blocking'` or `code: 'open_question_overdue'` and includes the offending `Q-NNN` ids in the action text.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `question_missing_section` | A required bullet absent | Edit or rerun |
| `question_id_collision` | Two `Q-NNN` blocks share an id | Renumber via the orchestrator |
| `question_id_format` | Id not matching `^Q-\d{3,}$` | Use `Q-001`, `Q-042`, etc. |
| `question_invalid_status` | Status not in the locked enum | Use `open`, `resolved`, `deferred` |
| `question_invalid_importance` | Importance not in the locked enum | Use `low`, `medium`, `high`, `blocking` |
| `question_invalid_dueby` | DueBy not ISO `YYYY-MM-DD` or `-` | Fix the date |
| `question_resolved_missing_resolution` | `Status: resolved` without a `Resolved:` bullet | Add the bullet |
| `open_question_blocking` | Gate preflight: blocking question still open | Resolve or downgrade importance |
| `open_question_overdue` | Gate preflight: open question past `DueBy` | Resolve, defer, or extend the date |

## Reference

- **Linked contracts:** [`SCIENTIST.md`](./SCIENTIST.md), [`HYPOTHESES.md`](./HYPOTHESES.md), [`PLAN.md`](./PLAN.md)
- **Dossier:** `docs/research/05-scientist-and-open-questions-agent.md`
- **Non-negotiable rule:** `CLAUDE.md` rule 15 (Scientist tail at every phase contract)
- **Design rationale:** [`docs/design/CODEX_RESPONSE_M6.md`](../design/CODEX_RESPONSE_M6.md) decision 5 (loose gate-preflight)
