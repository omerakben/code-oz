# SOURCE_CHECK.md (v0.1)

User-facing summary of the 3-source verification artifact PLAN must produce before its gate can pass. The contract below is authoritative for v0.1.

## What SOURCE_CHECK.md is

A plain Markdown document at `.code-oz/artifacts/SOURCE_CHECK.md` that names, for each PLAN task, the three sources it relies on:

1. **SPEC** — the SPEC.md acceptance criterion or constraint the task implements.
2. **Reference** — an existing reference pattern in the influence library or the project, found via repo-context tools.
3. **Docs** — an authoritative library or framework doc passage (Context7 lookup; offline cache permitted).

Non-negotiable rule 3 (`CLAUDE.md`): PLAN cannot pass without SOURCE_CHECK.md naming spec, reference (or explicit none-found rationale), and docs (or explicit no-library rationale). The 3-source requirement is the load-bearing falsification mechanism for failure family 1 (API fabrication; `docs/research/02-llm-failure-research.md`).

## Canonical structure

```markdown
# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1 — given a surname, app produces 5 candidates

- Spec: SPEC.md `## Acceptance criteria`, bullet 1
- Quote: "Given a surname, the app produces 5 candidate given names."

### SC-SPEC-002: Constraint — runs locally, no network

- Spec: SPEC.md `## Constraints`, bullet 1
- Quote: "Runs locally on a phone-class device."

## Reference sources

### SC-REF-001: Syllable-scoring pattern from agent-skills template

- Path: ~/Projects/agents/templates/agent-skills/<x>.md
- Lines: 14-42
- Why: matches SPEC's stress-pattern requirement; clean-room patternable.

### SC-REF-NONE-001: No reference for the gender-neutral filter

- Searched: `glob ~/Projects/agents/templates/**/*name*.md`, `grep "gender" ~/Projects/agents/templates`
- Result: no relevant pattern found.
- Why explicit: SPEC open-question Q-001 is deferred; task T-002 implements the safest default and cites this absence rather than inventing a pattern.

## Docs sources

### SC-DOC-001: Bun File API for atomic writes

- Library: bun
- URL: https://bun.com/docs/api/file-io (cached at .code-oz/cache/docs/bun.md)
- Section: "Atomic writes"
- Why: validates atomic-write idiom for the scoring cache file.

### SC-DOC-NONE-001: No library used for syllable detection

- Why explicit: scorer is hand-written; no third-party API surface to verify.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-001
- T-002 -> SC-SPEC-002, SC-REF-NONE-001, SC-DOC-NONE-001
```

## Five required H2 sections

| Section | What it answers | Notes |
|---|---|---|
| `## Spec sources` | Which SPEC criteria/constraints this PLAN implements | ≥ 1 H3 source block |
| `## Reference sources` | Which reference patterns each task draws from | ≥ 1 H3 block; none-found cases use `SC-REF-NONE-NNN` |
| `## Docs sources` | Which library/API docs were consulted | ≥ 1 H3 block; no-library cases use `SC-DOC-NONE-NNN` |
| `## Coverage` | Per-task source citation | One bullet per `T-NNN`, mapping to source ids |
| `## Open questions` (optional) | Source-level questions not yet resolved | mirror OPEN_QUESTIONS.md |

## Source id grammar (locked)

```text
SC-SPEC-NNN          # spec source
SC-REF-NNN           # reference source found
SC-REF-NONE-NNN      # reference source explicitly absent (rationale required)
SC-DOC-NNN           # docs source found
SC-DOC-NONE-NNN      # docs source explicitly absent (rationale required)
```

- `NNN` is zero-padded three-or-more digits.
- Ids are run-scoped and stable.
- A `NONE` id requires an explicit rationale bullet (`Why explicit: ...`); absence-without-rationale fails validation.

Codex push-back on briefing prompt 7 (`docs/design/CODEX_RESPONSE_M6.md` "Where I disagree" 6): aggregate sections without ids make it impossible for a task to prove which evidence it relied on. The id + Coverage table makes citation falsifiable.

## Source block grammar (per H3 block)

Each H3 block has stable bullet keys per source kind:

**SPEC source (`SC-SPEC-NNN`):**

```markdown
### SC-SPEC-NNN: <one-line title>

- Spec: <SPEC.md anchor>
- Quote: <verbatim text from SPEC.md>
```

**Reference source found (`SC-REF-NNN`):**

```markdown
### SC-REF-NNN: <one-line title>

- Path: <relative or absolute path>
- Lines: <line range>
- Why: <one-line rationale>
```

**Reference source absent (`SC-REF-NONE-NNN`):**

```markdown
### SC-REF-NONE-NNN: <one-line title>

- Searched: <queries actually run>
- Result: <`no relevant pattern found.` or similar>
- Why explicit: <one-line rationale>
```

**Docs source found (`SC-DOC-NNN`):**

```markdown
### SC-DOC-NNN: <one-line title>

- Library: <name>
- URL: <upstream URL> (cached at .code-oz/cache/docs/<library>.md)
- Section: <heading or anchor>
- Why: <one-line rationale>
```

**Docs source absent (`SC-DOC-NONE-NNN`):**

```markdown
### SC-DOC-NONE-NNN: <one-line title>

- Why explicit: <one-line rationale>
```

## Coverage section

`## Coverage` is bullets-only. Each bullet is `T-NNN -> <comma-separated source ids>`.

- Every `T-NNN` in PLAN.md must appear in Coverage.
- Every source id in Coverage must exist as an H3 block in this file.
- Validation rejects a Coverage that names a source id absent from `## Spec sources` / `## Reference sources` / `## Docs sources`.

## Atomic write discipline

SOURCE_CHECK.md is written atomically (temp + fsync + rename + dir fsync) immediately after PLAN.md inside the same phase exit. The orchestrator never writes an invalid SOURCE_CHECK.md; failure paths produce `SOURCE_CHECK.draft.md` plus `NEEDS_INTERVENTION.json`.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `source_check_missing_section` | A required H2 section absent | Add the section |
| `source_check_id_collision` | Two source blocks share an id | Renumber |
| `source_check_id_format` | Id not matching the locked grammar | Use `SC-SPEC-NNN`, `SC-REF-NONE-NNN`, etc. |
| `source_check_none_missing_rationale` | A `NONE` id present without `Why explicit:` bullet | Add rationale or remove |
| `source_check_coverage_unknown_source` | Coverage names a source id not declared | Add the H3 block or fix the Coverage line |
| `source_check_coverage_unknown_task` | Coverage names a task id absent from PLAN.md | Remove or fix |
| `source_check_coverage_task_missing` | A `T-NNN` in PLAN.md absent from Coverage | Add Coverage line |
| `source_check_validation_failed` | Persona produced a draft that failed after repair + finalize | Inspect `SOURCE_CHECK.draft.md` |

## Reference

- **Linked contracts:** [`PLAN.md`](./PLAN.md), [`REPO_CONTEXT.md`](./REPO_CONTEXT.md), [`SCIENTIST.md`](./SCIENTIST.md)
- **Non-negotiable rule:** `CLAUDE.md` rule 3 (3-source verification before any code)
- **Failure-family rationale:** `docs/research/02-llm-failure-research.md` family 1 (API fabrication)
- **Design rationale:** [`docs/design/CODEX_RESPONSE_M6.md`](../design/CODEX_RESPONSE_M6.md) — locked source-id grammar + Coverage section
