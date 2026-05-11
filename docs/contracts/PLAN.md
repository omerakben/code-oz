# PLAN.md (v0.1)

User-facing summary of the artifact the PLAN phase produces. The contract below is authoritative for v0.1; a future deeper pinned spec at `docs/references/plan-contract.md` will track parser internals when M6 lands.

## What PLAN.md is

The output of the PLAN phase. A plain Markdown document at `.code-oz/artifacts/PLAN.md` that decomposes an approved SPEC.md into atomic, independently testable tasks with named files, validation commands, risk notes, hypothesis citations, and source citations.

A PLAN.md looks like this:

```markdown
# PLAN

## Goals

- Decompose the baby-name app SPEC into atomic, testable tasks.
- Cover every acceptance criterion from SPEC with at least one task.

## Tasks

### T-001: Implement syllable scorer

- Files: src/scoring/syllable.ts, tests/scoring-syllable.test.ts
- Validation: bun test tests/scoring-syllable.test.ts
- Risk: Stress-pattern detection on multisyllabic surnames is heuristic; tune against fixture pairs.
- Hypotheses: H-001, H-002
- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-001

### T-002: Wire scorer into candidate selector

- Files: src/candidates/select.ts, tests/candidate-select.test.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: Selection bias toward shorter names if scorer's normalization is wrong.
- Hypotheses: H-003
- Sources: SC-SPEC-002, SC-REF-NONE-001

## Sources

- SPEC.md acceptance criteria 1, 3 (covered by T-001, T-002).
- Reference template `~/Projects/agents/templates/<x>` syllable-pattern adapter (covered by SC-REF-001).

## Out of scope

- Surname generation (SPEC explicit non-goal).
- Internet-backed name databases (SPEC constraint: no network).

## Open questions

- Q-001: gender-neutral suggestions only? (deferred until SPEC update)
```

## How PLAN.md gets written

The PLAN phase runs the Lead persona (`src/agents/defaults/lead.md`) with access to the approved SPEC.md plus the `tool_use.repo_context` sub-scope (glob, grep, read). The persona uses repo-context tools to find reference patterns, optionally consults Context7 docs (cached offline per `docs/contracts/REPO_CONTEXT.md`), produces a SOURCE_CHECK.md naming three sources per task, and emits PLAN.md with atomic tasks.

The orchestrator parses the draft, validates the section schema, calls the Scientist phase-tail (writes/updates HYPOTHESES.md and OPEN_QUESTIONS.md), runs gate-preflight, and atomically writes `.code-oz/artifacts/PLAN.md` plus the sidecars.

If the persona produces a draft that fails validation, repair and finalize rituals apply (mirroring DEFINE; per `docs/contracts/SPEC.md`). The orchestrator never writes an invalid PLAN.md.

## Five required H2 sections plus the Tasks block

| Section | What it answers | Min content |
|---|---|---|
| `## Goals` | What this PLAN aims to deliver | ≥ 1 bullet |
| `## Tasks` | The atomic work items | ≥ 1 H3 task block |
| `## Sources` | Aggregate references this plan relies on | ≥ 1 bullet |
| `## Out of scope` | What this PLAN explicitly excludes (echoes SPEC non-goals + plan-level exclusions) | ≥ 1 bullet |
| `## Open questions` | Plan-level questions not yet resolved (mirror OPEN_QUESTIONS.md ids) | ≥ 1 bullet (use `- None known at plan time.` if none) |

Sections appear in canonical order. **`## Tasks` is the only section whose body contains H3 blocks**; every other section body is bullets-only (mirroring SPEC.md).

## Task block grammar (locked)

```markdown
### T-NNN: <one-line title>

- Files: <comma-separated entries; each `<path>` or `<path> (modified|added|deleted)`>
- Validation: <a single shell command, bun-test or equivalent>
- Risk: <one-line risk note>
- Hypotheses: <comma-separated H-NNN ids, or `- Hypotheses: none` if none claimed>
- Sources: <comma-separated source ids from SOURCE_CHECK.md>
- Bugfix: <single existing test path>   (optional)
```

- **`T-NNN` ids are run-scoped and stable.** Allocated by the orchestrator (`allocateTaskId`) per run; persist across edits. Cross-run identity is W2 territory.
- Each task block has all five required bullets in the order shown.
- Bullets are one line each. Multi-line task descriptions are not allowed; split into two tasks instead.
- The Risk bullet is required; if there is no significant risk, write `- Risk: none`.
- The optional `Bugfix:` bullet is permitted as the sixth and last bullet. It declares that the task is reusing a single pre-existing failing test as its validation (the test file is not edited; only source-under-test changes). When present, the test path lives in `Bugfix:` and does NOT need to appear in `Files:` (which would force a misleading `(modified)` annotation on an untouched file). Closes Codex PR #15 P2 fix-soon — the schema was previously too rigid for bug-fix tasks that reuse a failing test verbatim.

### Files entry grammar (M8 extension)

Each entry in the `Files:` bullet is either a bare path or a path followed by an optional change-kind annotation in parentheses:

```
src/scoring/syllable.ts (added), tests/scoring-syllable.test.ts (added)
src/candidates/select.ts (modified)
src/legacy/old.ts (deleted)
```

The change kind enum is locked: `modified` | `added` | `deleted`.

- **`added`** — the path does not exist in the run's base commit; the BUILD task creates it.
- **`modified`** — the path exists in the base commit; the BUILD task changes it.
- **`deleted`** — the path exists in the base commit; the BUILD task removes it.

Bare paths (no parenthetical) default to `change: modified` for backward compatibility with PLAN.md files generated before M8. Persona-emitted PLAN.md SHOULD use explicit annotations in v0.1; M8's serializer always writes the annotated form on canonical output. A future minor (W2 scope) may tighten this to require explicit annotation.

Parenthetical values outside the enum fail parsing with `plan_task_malformed` (rule: `Files entry change kind must be one of: modified, added, deleted`).

This grammar is consumed by:

- **BUILD entry preflight** (M8 commit 7) — verifies that `change: added` paths are absent in the bound base commit and that `change: modified | deleted` paths are present. Drift fails with `plan_change_kind_drift`.
- **Mutation gate applicability** (M8 commit 6) — applicable iff the changed-file manifest contains at least one `change: added` test path matching `phases.verify.testGlob` AND `Validation command.Expected exit code` is `0`.

## Why H3 task blocks instead of bullets

Codex push-back on briefing prompt 6 (`docs/design/CODEX_RESPONSE_M6.md` "Where I disagree" 5): a task is a structured object with five fields, not a single bullet. H3 blocks under `## Tasks` give the parser a deterministic anchor (`### T-NNN:`) and the persona an unambiguous template. Other sections stay bullet-only because they are flat lists.

## Atomic write discipline

PLAN.md is written atomically (temp + fsync + rename + dir fsync) per the same pattern as SPEC.md and the gate writers. Sidecars (HYPOTHESES.md, OPEN_QUESTIONS.md) follow the same discipline; SOURCE_CHECK.md is written immediately after PLAN.md inside the same phase exit.

## Approving PLAN.md

PLAN writes `PLAN.md`, `SOURCE_CHECK.md`, `HYPOTHESES.md`, and `OPEN_QUESTIONS.md`, then exits 0:

```text
PLAN phase complete. Review .code-oz/artifacts/PLAN.md, then run:
  code-oz approve plan
```

`code-oz approve plan`:

1. Validates PLAN.md schema (this contract).
2. Validates SOURCE_CHECK.md schema (`docs/contracts/SOURCE_CHECK.md`).
3. Runs gate-preflight: HYPOTHESES.md and OPEN_QUESTIONS.md exist, parse, no overdue open questions.
4. Computes `artifactSha256` from PLAN.md and binds into `GATE_PLAN_PASSED.json`.
5. Appends the layered transition events (`gate_written`, `phase_exited`, `phase_entered`).

If any of (1)–(3) fails, the approve writes `NEEDS_INTERVENTION.json` instead of the success gate.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `plan_missing_section` | A required H2 section is absent | Edit PLAN.md or rerun PLAN |
| `plan_section_out_of_order` | Sections present but not canonical | Reorder |
| `plan_section_empty` | A required section has no content | Add at least one bullet or task |
| `plan_task_malformed` | A task block missing one of the five required bullets | Fix per the locked grammar |
| `plan_task_id_collision` | Two task blocks share the same `T-NNN` id | Renumber via the orchestrator |
| `plan_task_id_format` | Task id not matching `^T-\d{3,}$` | Use `T-001`, `T-042`, etc. |
| `plan_source_unknown` | A task cites a source id absent from SOURCE_CHECK.md | Add the source or fix the citation |
| `plan_hypothesis_unknown` | A task cites an H-NNN id absent from HYPOTHESES.md | Add the hypothesis or fix the citation |
| `plan_validation_failed` | Persona produced a draft that failed validation after both repair and finalize rituals | Inspect `PLAN.draft.md` |

## Reference

- **Pinned reference (future):** `docs/references/plan-contract.md` (created when M6 lands)
- **Linked contracts:** [`SOURCE_CHECK.md`](./SOURCE_CHECK.md), [`HYPOTHESES.md`](./HYPOTHESES.md), [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md), [`REPO_CONTEXT.md`](./REPO_CONTEXT.md), [`SCIENTIST.md`](./SCIENTIST.md)
- **Gate contract:** [`GATES.md`](./GATES.md)
- **Design rationale:** [`docs/design/CODEX_RESPONSE_M6.md`](../design/CODEX_RESPONSE_M6.md) — locked task grammar, source ids, gate-preflight discipline
- **Roadmap:** [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § M6
