# AUDIT.md (v0.1)

Artifact contract for the AUDIT phase. Authoritative for v0.1; the brownfield analog of `docs/contracts/SPEC.md`.

*Gate philosophy: Reversed Conversation (see [`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`](../product/AI_SOFTWARE_COMPANY_THESIS.md)).*

## What AUDIT.md is

The output of the AUDIT phase. A plain Markdown document at `.code-oz/artifacts/AUDIT.md` that captures what was found in an existing codebase in response to an operator problem statement — which files are likely affected, what reproduction evidence exists, and what invariants the fix must respect.

AUDIT.md is the brownfield entry-phase artifact. In the greenfield flow, DEFINE produces `SPEC.md` and PLAN consumes it. In the brownfield flow, AUDIT produces `AUDIT.md` and PLAN consumes it instead. The two consumption paths are mutually exclusive per run, determined by the run's profile (event-derived; see rule 1 and the handoff section below).

**Single-provider for v0.1.** No cross-family AUDIT review runs in this milestone. AUDIT is executed by a single Auditor persona via the configured provider. Cross-family review at AUDIT is deferred to a future milestone.

The AUDIT phase does NOT write code, propose a fix, or prescribe a task list. That is PLAN's job. AUDIT scopes the problem: it finds the files, documents the reproduction evidence, and records the constraints. PLAN reads AUDIT.md where it would otherwise read SPEC.md.

## Canonical frontmatter

Every AUDIT.md carries a YAML frontmatter block at the top of the file, before the `# AUDIT` title. The block identifies the run, phase, profile, and artifact version so that the gate writer can bind the sha256 and the parser can reject stale or misrouted artifacts.

```yaml
---
artifact: AUDIT.md
version: "0.1"
runId: <run-id>
phase: audit
profile: brownfield
generatedAt: <ISO 8601 datetime, e.g. 2026-05-21T14:32:00Z>
operatorStatement: <one-line summary of the operator problem statement>
---
```

Field rules (each required; no optional fields in v0.1):

- `artifact`: exact string `AUDIT.md`.
- `version`: exact string `"0.1"`.
- `runId`: the run's canonical id string; must match the run state's `runId`.
- `phase`: exact string `audit`.
- `profile`: exact string `brownfield`.
- `generatedAt`: ISO 8601 datetime (UTC preferred). The orchestrator writes this; personas MUST NOT fabricate it.
- `operatorStatement`: a one-line plain-text summary of the operator's problem statement, verbatim or lightly trimmed. Not a paraphrase invented by the Auditor.

Validation rejects any AUDIT.md whose frontmatter is absent, malformed, or carries an unexpected value for `artifact`, `phase`, or `profile`.

## Four required sections

Sections appear in this canonical order. Each section body contains only bullets (`- `) and blank lines — no paragraphs, code fences, or sub-headings, except where this contract explicitly permits them. This is intentional: deterministic structure makes pass/fail machine-checkable per non-negotiable rule 1.

| Section | What it answers | Min content |
|---|---|---|
| `## Localization` | Which files or areas are likely affected, with exact citations | ≥ 1 entry |
| `## Reproduction` | What evidence exists for the reported problem, and what was observed vs. what the operator proposed | ≥ 1 bullet |
| `## Constraints` | Invariants and boundaries the fix must respect | ≥ 1 bullet |
| `## Audit sources` | The information sources the Auditor consulted during this analysis | ≥ 1 entry |

### `## Localization`

Each entry names a file or area the Auditor identified as likely affected, with a citation. The **exact citation format** is:

```
path/to/file.ts:LINE
```

or a line range:

```
path/to/file.ts:LINE-LINE
```

Rules:

- `path/to/file.ts` is a repo-relative path from the run's base worktree root (no leading `/` or `./`).
- `LINE` is a positive integer. `LINE-LINE` is a contiguous range where the second number is greater than or equal to the first.
- A file citation without a line number is rejected by the parser (use `:1` for whole-file attribution when no narrower range is determinable).
- Each entry is a single bullet: `- <file:line> — <one-line rationale>`.
- The `—` separator (em dash, U+2014) is required between the citation and the rationale.

Example entries:

```markdown
## Localization

- src/phases/plan.ts:76-90 — RunPlanOptions profile field is absent; brownfield routing falls through to greenfield branch.
- src/commands/run.ts:309-368 — fresh-run dispatch does not call dispatchAudit for brownfield profile.
- src/artifacts/source-check.ts:418 — heading check hardcodes "Spec sources"; brownfield heading never accepted.
```

### `## Reproduction`

This section records evidence for the problem. The Auditor MUST distinguish what it **observed** (with evidence from static analysis of the repo) from what the operator **proposed** as the problem description.

**Observed-vs-operator-proposed distinction (locked rule):**

- A bullet marked `Observed:` states a fact the Auditor confirmed by reading the repo (a code path, a missing branch, an incorrect constant, a failing test, etc.). Each observed fact MUST name a file:line citation from `## Localization` or an inline citation.
- A bullet marked `Proposed:` records what the operator stated as the problem. The Auditor does not assert this as observed; it records it faithfully.
- A bullet marked `Unresolved:` flags a reproduction claim that cannot be confirmed without runtime access the Auditor does not have (e.g., a crash that only occurs under a specific environment, a race condition, a production-only configuration). **Unresolved runtime facts MUST also be routed to `OPEN_QUESTIONS.md` per rule 15 (Scientist tail).** The validator rejects an AUDIT.md that marks a fact `Observed:` and then acknowledges (in the same or adjacent bullet) that runtime confirmation was not possible.

At least one `Proposed:` bullet is always required (the operator's statement must be recorded). Zero `Observed:` bullets is permitted only when the Auditor genuinely cannot confirm any claim statically; in that case all factual claims must appear as `Unresolved:` and the corresponding `OPEN_QUESTIONS.md` entries must reference them.

Example entries:

```markdown
## Reproduction

- Proposed: brownfield runs fail silently at PLAN because the profile is not passed through.
- Observed: src/commands/run.ts:1192-1204 — dispatchPlan is called without a profile argument; the function signature at src/phases/plan.ts:76 accepts no profile field. Confirmed by static read.
- Observed: src/artifacts/source-check.ts:418 — heading check is `=== 'Spec sources'`; no branch for `'Audit sources'`. Confirmed by grep.
- Unresolved: whether the silent failure produces a NEEDS_INTERVENTION.json or exits 0 without writing a gate file. Cannot confirm without spawning the CLI against a brownfield fixture. Routed to Q-001.
```

### `## Constraints`

Invariants the fix must respect. These become PLAN's non-negotiable boundaries — the brownfield analog of SPEC's `## Constraints` section.

Each bullet is a single constraint statement. Constraints may cite existing behavior (`Preserve:`), external requirements (`Require:`), or explicit exclusions (`Exclude:`). Prefixes are optional but recommended for clarity when the constraint type is not obvious from the text.

Example entries:

```markdown
## Constraints

- Preserve: greenfield runs must continue to route through runDefine and consume SPEC.md; no behavioral change to the existing path.
- Preserve: approveGate() is the only gate-write primitive; no approveAuditGate (rule 20).
- Require: profile is read from event-derived run state, not from mutable .code-oz/config.yaml (rule 1).
- Exclude: cross-family AUDIT review is out of scope for v0.1.
```

### `## Audit sources`

The information sources the Auditor consulted. For brownfield SOURCE_CHECK, this section's entries are the upstream pool from which `SC-AUDIT-NNN` ids are drawn (see the handoff section below).

Each entry is a single bullet citing a file, a grep result, or a repo-context search. The entry format mirrors the `## Reference sources` H3 blocks in SOURCE_CHECK.md but stays in flat-bullet form here (the H3 granularity lives in SOURCE_CHECK.md, not AUDIT.md):

```markdown
- <file:line> — <one-line description of what was read and why>
```

At least one entry is required. Entries that are search queries (no single file result) use the form:

```markdown
- grep:<pattern> in <path> — <one-line description>
```

## Scientist tail (rule 15)

AUDIT is a primary-artifact phase. It produces HYPOTHESES.md and OPEN_QUESTIONS.md sidecars like every other primary phase. The Scientist phase-tail runs after the Auditor emits AUDIT.md and before the gate write, following the exact sequence specified in `docs/contracts/SCIENTIST.md`.

**Do not duplicate the sidecar format here.** The authoritative sidecar contracts are:

- [`HYPOTHESES.md`](./HYPOTHESES.md) — hypothesis ids, status semantics, falsifier requirements, atomic write discipline.
- [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) — question ids, status semantics, blocking/overdue gate rules.
- [`SCIENTIST.md`](./SCIENTIST.md) — phase-tail runner sequence, gate-preflight, loose-coupling pattern, permission manifest.

**Gate-blocking applies to AUDIT without exception.** Gate-preflight (`validateScientistSidecars({ phase: 'audit', artifactRoot })`) runs before `GATE_AUDIT_PASSED.json` is written. If HYPOTHESES.md or OPEN_QUESTIONS.md is missing, unparseable, has a hypothesis with no falsifier, or has an overdue open question, the gate does not advance. The orchestrator writes `NEEDS_INTERVENTION.json` instead.

The key interaction between reproduction evidence and open questions: when the Auditor marks a reproduction claim `Unresolved:` in `## Reproduction`, the corresponding question MUST appear in OPEN_QUESTIONS.md with `Importance: high` or `Importance: blocking` (not `low` or `medium`) because an unresolved runtime reproduction claim is load-bearing for PLAN's task scope.

## Rejection rules

The AUDIT.md validator (implemented in `src/artifacts/audit-parser.ts`) rejects an AUDIT.md that violates any of the following. Each rule maps to an error code the validator emits.

1. **`audit_missing_frontmatter`** — the YAML frontmatter block is absent or does not start on line 1 of the file.
2. **`audit_frontmatter_malformed`** — the frontmatter YAML does not parse, or a required field (`artifact`, `version`, `runId`, `phase`, `profile`, `generatedAt`, `operatorStatement`) is absent or blank.
3. **`audit_frontmatter_wrong_artifact`** — `artifact` is not exactly `AUDIT.md`.
4. **`audit_frontmatter_wrong_phase`** — `phase` is not exactly `audit`.
5. **`audit_frontmatter_wrong_profile`** — `profile` is not exactly `brownfield`.
6. **`audit_frontmatter_runid_mismatch`** — `runId` does not match the active run's id.
7. **`audit_missing_section`** — one or more of the four required H2 sections (`## Localization`, `## Reproduction`, `## Constraints`, `## Audit sources`) is absent.
8. **`audit_section_out_of_order`** — the four required sections are present but not in canonical order (Localization → Reproduction → Constraints → Audit sources).
9. **`audit_section_empty`** — a required section has no bullets.
10. **`audit_localization_missing_citation`** — a `## Localization` bullet does not contain a `file:line` citation matching the pattern `[^:\s]+:\d+(-\d+)?`.
11. **`audit_localization_citation_format`** — a `## Localization` citation has a line number of 0, a range where the second number is less than the first, or a leading `/` or `./` in the path.
12. **`audit_localization_missing_separator`** — a `## Localization` bullet contains a citation but no ` — ` (em-dash with surrounding spaces) separator before the rationale.
13. **`audit_reproduction_no_proposed`** — `## Reproduction` has no bullet starting with `Proposed:`.
14. **`audit_reproduction_observed_unverified`** — a bullet starts with `Observed:` but its text includes a phrase indicating uncertainty (`cannot confirm`, `not verified`, `unclear if`, `may be`, `possibly`). Observed claims must be verified; uncertainty belongs in `Unresolved:` bullets.
15. **`audit_reproduction_unresolved_not_routed`** — a bullet starts with `Unresolved:` but the corresponding `OPEN_QUESTIONS.md` has no `Q-NNN` entry that references it. (Checked at gate-preflight, not at artifact validation time, because OPEN_QUESTIONS.md is written by the Scientist phase-tail after AUDIT.md.)
16. **`audit_unexpected_content`** — a required section body contains a paragraph, code fence, or sub-heading that this contract does not permit.
17. **`audit_title_missing`** — the `# AUDIT` H1 title is absent (must appear as the first non-frontmatter line).
18. **`audit_validation_failed`** — the Auditor persona produced a draft that failed validation after both the repair ritual and the finalize ritual. The orchestrator writes `AUDIT.draft.md` and `NEEDS_INTERVENTION.json`; the canonical `AUDIT.md` is not written.

## Handoff section

After AUDIT approval, PLAN runs with the brownfield profile. The handoff is narrow and explicit.

### How PLAN reads AUDIT.md

`RunPlanOptions` carries a `profile` field. `dispatchPlan` resolves the profile from the loaded run state (event-derived per rule 1), not from the mutable `.code-oz/config.yaml`. When `profile === 'brownfield'`, `runPlan` reads `.code-oz/artifacts/AUDIT.md` instead of `.code-oz/artifacts/SPEC.md`. The Lead persona receives the AUDIT.md content in its context window where SPEC.md would otherwise appear. Greenfield PLAN is unchanged.

If the approved artifact is absent at PLAN entry, the error is: `PLAN cannot run without an approved AUDIT.md` (brownfield) or `PLAN cannot run without an approved SPEC.md` (greenfield).

### `SC-AUDIT-NNN` source-id grammar

For brownfield runs, PLAN's SOURCE_CHECK.md uses a new source-id kind to cite the AUDIT.md as an upstream source. The grammar (extending the locked SOURCE_CHECK grammar in `docs/contracts/SOURCE_CHECK.md`):

```
SC-AUDIT-NNN     # audit source — a finding or constraint drawn from AUDIT.md
```

- `NNN` is zero-padded three-or-more digits.
- Run-scoped and stable (same as `SC-SPEC-NNN`).
- An `SC-AUDIT-NNN` block cites a localization entry, reproduction bullet, or constraint bullet from AUDIT.md by H2 section and bullet position.

**`SC-AUDIT-NNN` source block grammar** (used inside SOURCE_CHECK.md, NOT inside AUDIT.md):

```markdown
### SC-AUDIT-NNN: <one-line title>

- Audit: AUDIT.md `## <Section>`, bullet <N>
- Quote: <verbatim or near-verbatim text from the cited AUDIT.md bullet>
```

### `## Audit sources` heading in SOURCE_CHECK.md

For brownfield runs, SOURCE_CHECK.md uses `## Audit sources` **in place of** `## Spec sources`. This is not optional and not additive: a brownfield SOURCE_CHECK.md MUST have `## Audit sources` and MUST NOT have `## Spec sources`. A greenfield SOURCE_CHECK.md MUST have `## Spec sources` and MUST NOT have `## Audit sources`. The validator at `src/artifacts/source-check.ts` receives the run profile and enforces the matching single heading.

The `SC-AUDIT-NNN` ids appear in the `## Audit sources` section of SOURCE_CHECK.md and are referenced in the `## Coverage` table alongside `SC-REF-NNN` and `SC-DOC-NNN` ids as usual.

Extended source-id pattern (implemented in `src/artifacts/source-check.ts`):

```
/^SC-(SPEC|REF|REF-NONE|DOC|DOC-NONE|AUDIT)-\d{3,}$/
```

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `audit_missing_frontmatter` | YAML frontmatter block absent | Add the frontmatter block at line 1 |
| `audit_frontmatter_malformed` | Frontmatter missing a required field or fails YAML parse | Fix the field; rerun AUDIT |
| `audit_frontmatter_runid_mismatch` | `runId` does not match active run | Do not copy AUDIT.md between runs |
| `audit_missing_section` | A required H2 section is absent | Add the section; rerun AUDIT |
| `audit_section_out_of_order` | Sections present but not canonical | Reorder to: Localization → Reproduction → Constraints → Audit sources |
| `audit_section_empty` | A required section has no bullets | Add at least one bullet |
| `audit_localization_missing_citation` | A Localization bullet has no `file:line` citation | Add a citation or use `:1` for whole-file |
| `audit_localization_citation_format` | Citation has line 0, inverted range, or leading slash | Fix the path and line numbers |
| `audit_reproduction_no_proposed` | Reproduction section has no `Proposed:` bullet | Add the operator's statement as a `Proposed:` bullet |
| `audit_reproduction_observed_unverified` | An `Observed:` bullet contains uncertainty language | Move uncertain claims to `Unresolved:` |
| `audit_reproduction_unresolved_not_routed` | An `Unresolved:` claim has no matching Q-NNN | Scientist phase-tail must route it to OPEN_QUESTIONS.md |
| `audit_validation_failed` | Draft failed repair + finalize rituals | Inspect `AUDIT.draft.md`; rerun AUDIT |

## Fixture examples

The five examples below are the parser's test fixtures (C5b). Each is a complete, valid AUDIT.md. They are minimal and concrete; no prose filler.

---

### Fixture 1 — regression (something that used to work and broke)

```markdown
---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-regression-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T09:00:00Z
operatorStatement: gate approval silently succeeds on a PLAN.md that is missing the Tasks section
---

# AUDIT

## Localization

- src/artifacts/plan.ts:214-230 — validatePlanMarkdown; Tasks section check is absent from the required-sections array.
- src/commands/approve.ts:494-498 — preApprovePlanHook calls validatePlanMarkdown but does not assert Tasks presence separately.
- tests/artifacts/plan.test.ts:88-102 — existing test suite has no fixture for a Tasks-absent PLAN.md.

## Reproduction

- Proposed: approving a PLAN.md with no ## Tasks section exits 0 and writes GATE_PLAN_PASSED.json.
- Observed: src/artifacts/plan.ts:214-230 — REQUIRED_SECTIONS array is ['Goals', 'Sources', 'Out of scope', 'Open questions']; 'Tasks' is absent. Confirmed by grep.
- Observed: tests/artifacts/plan.test.ts:88-102 — no test exercises a Tasks-absent fixture. Confirmed by read.

## Constraints

- Preserve: all existing plan validation tests must remain green.
- Preserve: PLAN.md files generated before this fix that contain Tasks are unaffected; the fix adds a check, not a structural change.
- Require: the fix adds 'Tasks' to REQUIRED_SECTIONS in src/artifacts/plan.ts; no schema changes elsewhere.

## Audit sources

- src/artifacts/plan.ts:214-230 — read REQUIRED_SECTIONS array.
- src/commands/approve.ts:494-498 — read preApprovePlanHook call chain.
- tests/artifacts/plan.test.ts:88-102 — read existing fixture coverage.
```

---

### Fixture 2 — feature gap (missing capability)

```markdown
---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-featuregap-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T10:15:00Z
operatorStatement: code-oz has no command to list open questions across the active run
---

# AUDIT

## Localization

- src/commands/index.ts:1 — command registry; no 'questions' subcommand registered.
- src/artifacts/open-questions.ts:1 — parser + serializer for OPEN_QUESTIONS.md exist; no read-only export for CLI consumption.
- docs/contracts/OPEN_QUESTIONS.md:1 — contract specifies 'code-oz questions list' as a W2 CLI command; not yet implemented.

## Reproduction

- Proposed: running 'code-oz questions list' exits with an unknown-command error.
- Observed: src/commands/index.ts:1 — grep for 'questions' returns zero matches. Confirmed by grep.
- Observed: docs/contracts/OPEN_QUESTIONS.md:1 — 'code-oz questions list' listed under W2 milestone, not shipped. Confirmed by read.

## Constraints

- Require: the new command is read-only; it does not write OPEN_QUESTIONS.md.
- Preserve: existing 'code-oz run' and 'code-oz approve' command surfaces are unchanged.
- Exclude: 'code-oz questions resolve' is a separate command deferred to the same W2 milestone; this AUDIT scopes only 'list'.

## Audit sources

- src/commands/index.ts:1 — grep for 'questions'.
- src/artifacts/open-questions.ts:1 — read exported surface.
- docs/contracts/OPEN_QUESTIONS.md:1 — read W2 milestone row.
```

---

### Fixture 3 — "audit this codebase" with deeper work deferred (scoping + routing to open questions)

```markdown
---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-codebaseaudit-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T11:00:00Z
operatorStatement: audit the events.jsonl schema for fields that are documented in contracts but not emitted in practice
---

# AUDIT

## Localization

- src/state/schemas.ts:1 — canonical event schema definitions.
- src/state/events.ts:1 — event emission primitives.
- docs/contracts/SCIENTIST.md:1 — documents science_emitted, hypothesis_added, hypothesis_updated, question_added, question_resolved, question_deferred event types.

## Reproduction

- Proposed: some event types listed in contract docs are never emitted by the runtime.
- Observed: grep:science_emitted in src/ — zero matches in src/state/events.ts. The event type is documented in docs/contracts/SCIENTIST.md but has no emit call. Confirmed by grep.
- Observed: src/state/schemas.ts:1 — science_emitted is declared in the schema but grep of src/phases/ shows no call site. Confirmed by grep.
- Unresolved: whether hypothesis_updated and question_deferred are emitted in practice requires tracing all phase-tail call sites and verifying against a live events.jsonl fixture. Scope exceeds static read. Routed to Q-001.
- Unresolved: whether missing emit calls cause gate-preflight failures or are silent no-ops requires running the full lifecycle. Routed to Q-002.

## Constraints

- Require: any fix emits events only through the orchestrator-owned event-emission primitives in src/state/events.ts (rule 1).
- Exclude: adding new event types is out of scope for this PLAN cycle; only missing emit calls for existing declared types are in scope.
- Preserve: existing event order invariants documented in src/state/schemas.ts must not change.

## Audit sources

- src/state/schemas.ts:1 — read declared event types.
- src/state/events.ts:1 — read emit primitive exports.
- grep:science_emitted in src/ — confirmed zero emit call sites.
- docs/contracts/SCIENTIST.md:1 — read documented event list.
```

---

### Fixture 4 — operator-runtime-required (reproduction cannot be observed without runtime)

```markdown
---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-runtime-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T12:30:00Z
operatorStatement: BUILD phase hangs indefinitely when the provider returns a streaming response that closes without a stop_reason field
---

# AUDIT

## Localization

- src/providers/invoke.ts:312-340 — streaming response consumer loop; stop condition checks stopReason field.
- src/phases/build.ts:88-110 — BUILD phase invokes invokeAgent; timeout handling.
- src/config/schema.ts:145-150 — maxTurns and maxWallTimeMinutes budget config.

## Reproduction

- Proposed: when a streaming provider response closes the connection without a stop_reason field, BUILD hangs until the process is killed externally.
- Observed: src/providers/invoke.ts:312-340 — the consumer loop exits only when stopReason is truthy; there is no timeout path for a stream that closes with stopReason === undefined. Confirmed by read.
- Observed: src/phases/build.ts:88-110 — BUILD passes maxWallTimeMinutes to invokeAgent but invokeAgent's stream loop does not reference it. Confirmed by read.
- Unresolved: whether a real provider (Claude, xAI) can produce a stream that closes without stop_reason under network partition conditions. Requires live provider testing. Routed to Q-001.
- Unresolved: whether the hang is a true indefinite block or eventually times out at the OS socket level. Requires runtime observation. Routed to Q-002.

## Constraints

- Require: the fix must not break the existing streaming consumer for normal responses (stop_reason present).
- Require: timeout enforcement must route through assertWithinBudget per rule 19.
- Preserve: the FakeProvider offline path must remain deterministic; the fix must not add a real timer dependency to offline tests.
- Exclude: fixing underlying provider behavior (stop_reason emission) is out of scope; only the consumer's resilience is in scope.

## Audit sources

- src/providers/invoke.ts:312-340 — read stream consumer loop.
- src/phases/build.ts:88-110 — read BUILD invocation and budget passing.
- src/config/schema.ts:145-150 — read maxWallTimeMinutes field definition.
```

---

### Fixture 5 — multi-file localization (several files cited)

```markdown
---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-multifile-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T13:45:00Z
operatorStatement: the --effort flag is accepted by the CLI but has no visible effect on budget caps in events.jsonl
---

# AUDIT

## Localization

- src/commands/run.ts:45-60 — CLI flag parsing; --effort is parsed but value is not passed to applyEffort.
- src/config/effort.ts:1 — applyEffort function; multiplies scalable budget fields.
- src/state/schemas.ts:220-235 — effort_envelope_applied event schema; auditReportSha256 field absent from this event (different event family).
- src/phases/run.ts:80-95 — run entry point; applyEffort should be called here before phase dispatch.
- tests/config/effort.test.ts:1 — effort tests exist for applyEffort in isolation but no test spawns the CLI and checks events.jsonl for effort_envelope_applied.

## Reproduction

- Proposed: running 'code-oz run --effort high' produces the same budget caps in events.jsonl as running without --effort.
- Observed: src/commands/run.ts:45-60 — parsed effort value is stored in a local variable but never passed to applyEffort or the run options. Confirmed by read.
- Observed: src/phases/run.ts:80-95 — applyEffort is imported but the call site is commented out. Confirmed by grep.
- Observed: tests/config/effort.test.ts:1 — no test contains 'effort_envelope_applied' or 'events.jsonl'. Confirmed by grep.

## Constraints

- Require: --effort affects only scalable budget fields per rule 23; maxReviewRounds and panel slot count must not change.
- Require: effort_envelope_applied is emitted at event position 2 (between run_started and phase_entered) per docs/design/B1A_EFFORT_FLAG.md.
- Preserve: runs without --effort continue to use the config file's budget values unchanged.
- Preserve: active-run resume replays effectiveBudgets from the effort_envelope_applied event; changing config.yaml mid-run must not change the envelope.

## Audit sources

- src/commands/run.ts:45-60 — read --effort flag parsing.
- src/config/effort.ts:1 — read applyEffort export.
- src/phases/run.ts:80-95 — read call site (commented out).
- grep:effort_envelope_applied in tests/ — confirmed zero matches.
- docs/design/B1A_EFFORT_FLAG.md:1 — read event-order lock and replay contract.
```

---

## Atomic write discipline

AUDIT.md is written atomically (temp + fsync + rename + dir fsync). The Auditor persona emits a draft; the orchestrator validates it, then writes the canonical file. Sidecars (HYPOTHESES.md, OPEN_QUESTIONS.md) follow the same discipline, written by the Scientist phase-tail after AUDIT.md.

The orchestrator never writes an invalid AUDIT.md. On validation failure after repair and finalize rituals, it writes `AUDIT.draft.md` (the unvalidated content for inspection) and `NEEDS_INTERVENTION.json`. The canonical `AUDIT.md` is not written.

## Approving AUDIT.md

AUDIT writes `AUDIT.md`, `HYPOTHESES.md`, and `OPEN_QUESTIONS.md`, emits the `audit_completed` event carrying `auditReportSha256`, and exits 0:

```text
AUDIT phase complete. Review .code-oz/artifacts/AUDIT.md, then run:
  code-oz approve audit
```

`code-oz approve audit` runs `preApproveAuditHook`, which:

1. Loads the `audit_completed` event from events.jsonl and reads `auditReportSha256`.
2. Validates AUDIT.md on disk against that sha (rejects if the file was edited after the event).
3. Runs `validateAuditMarkdown` (this contract's schema).
4. Runs `validateScientistSidecars({ phase: 'audit', artifactRoot })`.
5. If all pass: calls `approveGate()` (generic; no `approveAuditGate`), writes `GATE_AUDIT_PASSED.json`, appends transition events.
6. If any fail: writes `NEEDS_INTERVENTION.json` with the failing check's error code; does not advance.

The `audit_completed` event shape:

```ts
{ type: 'audit_completed', runId: string, phase: 'audit', auditReportSha256: string }
```

This mirrors the `build_completed.buildReportSha256` pattern (`src/commands/approve.ts:474-529, 694-758`).

## Reference

- **Brownfield analog:** [`SPEC.md`](./SPEC.md) — the greenfield DEFINE artifact contract; AUDIT.md mirrors its discipline.
- **Sidecar contracts:** [`HYPOTHESES.md`](./HYPOTHESES.md), [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md), [`SCIENTIST.md`](./SCIENTIST.md) — authoritative for the Scientist tail.
- **Handoff consumer:** [`SOURCE_CHECK.md`](./SOURCE_CHECK.md) — `SC-AUDIT-NNN` source-id grammar; `## Audit sources` heading.
- **Gate contract:** [`GATES.md`](./GATES.md) — how `code-oz approve audit` sha256-binds AUDIT.md.
- **Provider contract:** [`PROVIDERS.md`](./PROVIDERS.md) — how the Auditor persona's calls flow through `invokeAgent`.
- **M17 design:** [`docs/design/SESSION_M17_KICKOFF.md`](../design/SESSION_M17_KICKOFF.md) — locked scope, C5a/C5b commit rows, R1 modifications.
- **Implementation:** `src/phases/audit.ts`, `src/artifacts/audit-schema.ts`, `src/artifacts/audit-parser.ts`, `src/agents/defaults/auditor.md`, `src/prompts/audit-system.md`.
- **Non-negotiable rules:** `CLAUDE.md` rules 1 (file-based gate signals), 3 (3-source verification), 15 (Scientist tail), 18 (repo_context scope), 20 (one authority per milestone).
