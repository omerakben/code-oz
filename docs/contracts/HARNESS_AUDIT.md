---
name: harness audit (external-project diagnostic)
companion-docs: ../../CLAUDE.md (rules 14, 20)
target: external projects code-oz is asked to manage; AUDIT phase preflight (rule 14 brownfield)
status: external diagnostic — does NOT alter code-oz's six-phase taxonomy
scope: read-only assessment; outputs a HARNESS_AUDIT.md artifact in the target project's `.code-oz/` directory; never blocks code-oz's own gates
source: rubric structure adapted from `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/SKILL.md.en` § Phase 2 (lines 70-82); modified per code-oz's six-phase mapping
---

# HARNESS_AUDIT.md — external-project harness diagnostic

## 1. Scope and explicit non-scope

This rubric measures the **external project's** harness quality. It is not a measurement of code-oz itself.

Code-oz's six-phase taxonomy (DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP, plus AUDIT for brownfield per rule 14) is unchanged. The five subsystems below are a translation layer for assessing external projects' baseline state before code-oz drives them. They describe *harness quality* — a property any agentic codebase can be measured against. Code-oz's phases describe *workflow authority boundaries* — a property of the code-oz runtime itself. Section 5 explains why these two frameworks coexist without competing.

**Output**: a Markdown report at `<external-repo>/.code-oz/HARNESS_AUDIT.md`. The report is informational. It informs AUDIT phase decisions but does not gate them, and it does not write entries to `events.jsonl` for code-oz runs.

**Deferred**: a `code-oz doctor --harness-audit` subcommand is **not** in scope. The rubric is specified here so manual audit is possible today; CLI scaffolding waits until external demand justifies it. Per rule 20, no new authority surface lands without need.

**What this contract is not**:
- Not a competing taxonomy for code-oz's phases.
- Not a gate signal. Audit results never write `GATE_*_PASSED.json` files.
- Not a runtime artifact. The report lives in the *target project's* `.code-oz/` directory; code-oz's own runs read it as input to AUDIT phase reasoning, the way a SPEC reads a stakeholder brief.

## 2. The five-subsystem rubric

For each subsystem, assign a score 1-5:

| Score | Meaning |
|-------|---------|
| 5 | Exemplary, documented, consistently followed |
| 4 | Good, mostly complete, occasional gaps |
| 3 | Adequate, covers basics, missing polish |
| 2 | Weak, incomplete, inconsistently applied |
| 1 | Missing or actively harmful |

### 2.1 Instructions

Progressive disclosure of project orientation. The agent should be able to bootstrap from a small entry file and follow links to deeper context without scanning the entire repo. Typical artifacts: `AGENTS.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCT.md`, README.

| Score | Typical observation |
|-------|---------------------|
| 5 | Single canonical orientation file (often `CLAUDE.md` or `AGENTS.md`) with explicit pointers to architecture, product, and contributor docs; rules and constraints called out separately from prose. |
| 4 | Canonical file exists; one or two pointers are stale or missing. |
| 3 | A README exists with project overview, but agents must crawl directories to find architecture or rules. |
| 2 | Scattered docs across multiple READMEs; no clear entry point; rules implicit. |
| 1 | No agent-facing instructions; the project assumes oral tradition. |

**How code-oz's phases consume this score**: DEFINE phase consumes this when SPEC is drafted (the cleaner the instructions, the less time spent on intent elicitation). AUDIT phase consumes this as the primary input — a low Instructions score means the brownfield AUDIT artifact must inventory missing rules before PLAN can proceed.

### 2.2 State

Persistent record of where the project is and what changed. Includes git history hygiene, `progress.md` or session-handoff conventions, and any structured backlog (`feature_list.json`, GitHub issues, tracker tickets).

| Score | Typical observation |
|-------|---------------------|
| 5 | Clean conventional commits, an active session-handoff or progress doc, and a backlog that is the *projection* of decisions, not a separate source of truth. |
| 4 | Commits are clean; backlog drifts from reality occasionally. |
| 3 | Git log readable but informal; handoff happens orally between contributors. |
| 2 | Mixed commit styles, stale backlog, no handoff convention. |
| 1 | History rewritten frequently or commits opaque; no shared sense of state. |

**How code-oz's phases consume this score**: code-oz's own state model (`events.jsonl` + schema-validated gate files in `state/`) supersedes whatever the external project uses. The external project's state is relevant only as a **starting baseline**: a high score means AUDIT can ingest the existing record cheaply; a low score means AUDIT must reconstruct project state from git diff and source code alone.

### 2.3 Verification

The project's own ability to tell working code from broken code without human inspection. Includes test suite presence and pass rate, lint configuration, type-check, smoke runs, and end-to-end pipeline existence.

| Score | Typical observation |
|-------|---------------------|
| 5 | Comprehensive unit + integration + e2e suite, lint and type-check in CI, fast local feedback (<30s common path). |
| 4 | Unit + integration coverage; e2e or smoke incomplete; CI runs the green path. |
| 3 | Unit tests cover the happy path; lint configured but not enforced. |
| 2 | Tests exist but flaky or out of date; no enforcement. |
| 1 | No tests, or tests that have not run successfully in the recent history. |

**How code-oz's phases consume this score**: VERIFY phase consumes this directly. If the score is 2 or below, VERIFY is structurally at risk — code-oz cannot collect evidence of correctness from a verification surface that does not exist. In practice, a low Verification score means BUILD phase will need test-infrastructure work *before* the feature work that triggered the run; PLAN should reflect that ordering.

### 2.4 Scope

Discipline around how much work is in flight. Includes whether the project tackles one feature at a time, whether "definition of done" is explicit, and whether scope creep is visible in commit history.

| Score | Typical observation |
|-------|---------------------|
| 5 | Single active feature at a time, definition of done written before work starts, commits stay on-topic. |
| 4 | One feature in flight; occasional drive-by fixes bundled. |
| 3 | Multiple features in flight; done criteria informal. |
| 2 | Frequent context switches; commits bundle unrelated work. |
| 1 | No notion of scope; work-in-progress is open-ended. |

**How code-oz's phases consume this score**: PLAN phase consumes this. If the score is 2 or below, PLAN must include scope-discipline groundwork before the first BUILD invocation — naming the single feature, writing acceptance, and explicitly excluding adjacent work that would otherwise leak into the run. A high score means PLAN can be lean.

### 2.5 Lifecycle

How a unit of work begins and ends. Includes init or setup scripts, clean-state checklists for a fresh contributor environment, branch / worktree conventions, and handoff protocol when work pauses.

| Score | Typical observation |
|-------|---------------------|
| 5 | One-command setup, documented clean-state checklist, branch convention enforced, handoff doc updated at session end. |
| 4 | Setup is one or two commands; handoff happens but is not formally captured. |
| 3 | Setup requires reading scattered docs; branch convention loose. |
| 2 | Setup is tribal knowledge; handoff via chat or memory. |
| 1 | No setup path; new contributors fail to bootstrap unaided. |

**How code-oz's phases consume this score**: AUDIT phase consumes this as a risk signal. If the score is 2 or below, the run lifecycle is at risk — code-oz's worktree-per-run isolation may need extra checkpoints (more frequent gate writes, narrower BUILD authority, stricter VERIFY restart-on-fail thresholds) to compensate for an unstable host environment.

## 3. How to perform the audit

The audit is a manual procedure today. A contributor reads the target project and assigns scores. The procedure should take 20-40 minutes for a typical small repo.

1. **Read the entry point.** Open `AGENTS.md`, `CLAUDE.md`, or `README.md` (whichever exists first). Score Instructions: does this file route the reader to the project's architecture, rules, and constraints, or does it leave the reader to crawl?
2. **Inspect git history.** `git log --oneline -50` and `git log --pretty=format:'%s' | head -100`. Score State: are commits conventional? Is there a separate progress or handoff doc? Does the backlog (issues, tracker, JSON file) match the recent commits, or has it drifted?
3. **Run verification.** Find the test command (`package.json` scripts, `Makefile`, `pyproject.toml`, etc.) and run it. Note pass count, fail count, time. Check for lint and type-check configs. Score Verification on coverage breadth and CI enforcement.
4. **Map work-in-progress.** `git branch -a` and `git status` across active branches; check open PRs. Score Scope: how many features are in flight? Are commits on each branch on-topic, or do they bundle drive-by fixes?
5. **Walk a fresh-contributor path.** From a clean directory, attempt to follow the project's setup instructions to a working build. Score Lifecycle on how many undocumented steps surface.
6. **Identify the bottleneck.** The lowest-scoring subsystem is the bottleneck. AUDIT phase decisions should focus there first.
7. **Write the report.** Use the template in section 4. File it at `<external-repo>/.code-oz/HARNESS_AUDIT.md`.

The lowest-scoring subsystem is the bottleneck; AUDIT phase decisions should focus there first.

## 4. Output format

Template for `<external-repo>/.code-oz/HARNESS_AUDIT.md`. Contributor fills in scores, observations, and the bottleneck call.

```markdown
---
target-repo: <git remote or local path>
audit-date: YYYY-MM-DD
auditor: <handle>
code-oz-version: <vX.Y.Z>
---

# Harness audit — <project name>

## Scores

| Subsystem | Score (1-5) | Observation |
|-----------|-------------|-------------|
| Instructions | _ | <one or two sentences> |
| State | _ | <one or two sentences> |
| Verification | _ | <one or two sentences> |
| Scope | _ | <one or two sentences> |
| Lifecycle | _ | <one or two sentences> |

## Bottleneck

<Name the lowest-scoring subsystem. One paragraph: what specifically is missing or weak, what code-oz phase will absorb the cost, and what the AUDIT phase artifact should call out as a precondition before PLAN proceeds.>

## AUDIT phase implications

- <bullet: which code-oz phases are most affected>
- <bullet: any preconditions BUILD or VERIFY must satisfy>
- <bullet: any rule-20 authority adjustments needed for this run>

## Notes

<Free-form. Useful artifacts found, surprises, anything the next auditor should know.>
```

The template is the contract. Contributors should not invent additional sections; downstream tooling (when it exists) will key off this shape.

## 5. Why this is NOT a competing taxonomy

The five subsystems describe **harness quality** — properties any agentic codebase can be measured against, regardless of which runtime drives it. Code-oz's six phases describe **workflow authority boundaries** — properties of the code-oz runtime itself, with gate semantics, schema-validated state files, and rule-20 authority discipline.

The two map cleanly:

| Subsystem | Primary code-oz consumer |
|-----------|--------------------------|
| Instructions | DEFINE (intent elicitation), AUDIT (brownfield context) |
| State | AUDIT (baseline ingest), then superseded by `events.jsonl` |
| Verification | VERIFY (evidence collection) |
| Scope | PLAN (acceptance and exclusion) |
| Lifecycle | AUDIT (run-isolation risk signal) |

They map; they do not substitute. The rubric output is an **input** to the AUDIT phase artifact, not a competitor for the same role. A contributor who tries to use the rubric as code-oz's own internal taxonomy will find that:

- The rubric has no gate semantics. Code-oz phases do.
- The rubric has no schema-validated state file. Code-oz phases write `GATE_*_PASSED.json`.
- The rubric does not produce `events.jsonl` entries. Code-oz phases do.
- The rubric does not enforce rule-20 (one new authority per milestone). Code-oz phases do.

Per rule 20, code-oz adds at most one new authority boundary per milestone. The five-subsystem rubric is **not** an authority boundary; it is a measurement tool for projects that exist outside code-oz's authority. Adding it inside code-oz would dilute rule 20.

The rubric structure is adapted from `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/SKILL.md.en` § Phase 2 (lines 70-82). The 1-5 scoring scheme and the five-subsystem decomposition are taken directly from the source. The mapping back to code-oz's six-phase model and the explicit external-only scoping are the modifications required to keep this contract compatible with code-oz's existing authority discipline.
