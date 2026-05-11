---
template: learn-harness-engineering (WalkingLabs)
template-path: ~/Projects/agents/templates/learn-harness-engineering
template-shape: VitePress course site + 1 exportable skill (`harness-creator`) + 6 Electron sample projects
code-oz-version: v0.17.0-alpha.0 (M16 closed, PE-1 shipped)
session: 07
date: 2026-05-10
decision: YES, ahead — with 4 selective borrows + 4 rejects (category-scoped: pedagogy template vs runtime)
---

# Code-Oz vs learn-harness-engineering

## TL;DR

`learn-harness-engineering` is a **teaching course** that explains *how to scaffold a harness around a coding agent for one repo at a time*. Its substantive deliverable is a single skill (`harness-creator`) that produces `AGENTS.md` + `feature_list.json` + `init.sh` + `progress.md` + `session-handoff.md` for an arbitrary project, plus six reference patterns adapted from Claude Code's own runtime architecture.

`code-oz` is the **runtime that institutionalizes harness engineering** as enforced phase gates with cross-family review, debate scheduling, reviewer panels, file-based gate signals, the maestro discipline, repo-context permissioning, and rule-20 authority discipline. Code-oz already implements every subsystem the course teaches, in many cases more strictly (file-based gate signals vs. parse-LLM-text), and adds capabilities the course does not address at all (cross-family REVIEW, debate runtime, reviewer panels, run-level budget enforcement).

**The category mismatch is the most important finding.** The course is downstream of Claude Code's runtime patterns; code-oz is a peer runtime layer with stronger discipline. Borrows are limited and pedagogical / contractual, not architectural.

## Method

Read the course's `README.md`, `CLAUDE.md`, the full `harness-creator/SKILL.md.en`, and five of the six reference patterns (Memory Persistence, Context Engineering, Multi-Agent, Lifecycle & Bootstrap, Tool Registry, Gotchas). Mapped each subsystem and pattern to code-oz's current and roadmapped surfaces. Identified borrow candidates and rejection rationales.

## Subsystem-by-subsystem head-to-head

The course's framing is the **five-subsystem harness**: Instructions, State, Verification, Scope, Lifecycle. Code-oz's architecture is the **six-phase taxonomy** (DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP) plus a separate AUDIT phase for brownfield. Mapping the course's framework onto code-oz's runtime:

### 1. Instructions

| | learn-harness-engineering | code-oz |
|---|---|---|
| Surface | `AGENTS.md` (~50–100 lines), `CLAUDE.md` alternative, `docs/` hierarchy, progressive disclosure | `src/prompts/universal-rules.md` (20-item anti-slop sheet, embedded in every persona prompt — rule 16), per-persona prompts, `docs/contracts/REPO_CONTEXT.md` for permission sub-scopes (rule 18), `docs/research/01-maestro-rule-checker.md` as authoritative discipline dossier (rule 17) |
| Enforcement | "Read before starting" — agent compliance is an instruction, not a gate | Universal rules are *imported* into every persona, cannot be relaxed by the persona; maestro is the rule-checker role; gate preflight enforces; `repo_context_searched` events audit search results |
| Verdict | Course teaches the pattern. Code-oz already enforces it as a runtime invariant in three pinned rules. | **Code-oz ahead.** |

### 2. State

| | learn-harness-engineering | code-oz |
|---|---|---|
| Surface | `feature_list.json` (status: done / in-progress) + `progress.md` (free-form session log) + `git log` + optional `session-handoff.md` | Typed FSM, `state/events.jsonl` event log, schema-validated `state/GATE_<PHASE>_PASSED.json` per phase (rule 1), `AUDIT.md` for brownfield (rule 14), idempotent gate writes for resume (rule 12) |
| Enforcement | Agent updates files at session end. Compliance not enforced. | Gate files schema-validated by `src/state/gates.ts`; cannot pass a phase without writing the file; reducer rebuilds state from `events.jsonl`; resume is a v0.1 feature, not a vNext promise. |
| Cross-session continuity | `progress.md` + `feature_list.json` re-read at session start | Run lifecycle: `runId`, idempotent gate writes, `code-oz resume` |
| Verdict | Course's `feature_list.json` is a JSON-shaped scratchpad; code-oz's gate files are typed contracts the runtime validates. The course's pattern is a strict subset of code-oz's pattern, with one exception (see borrow B5 below). | **Code-oz ahead.** |

### 3. Verification

| | learn-harness-engineering | code-oz |
|---|---|---|
| Surface | Agent runs `init.sh` (npm install + check + test + build) at start and before claiming done; `feature_list.json` records evidence as a string field | VERIFY phase as a dedicated authority boundary (M8); evidence captured in `VERIFY.md`; restart-on-fail policy; rule 1 — **never parse LLM text output for pass/fail; only file-based gate signals validated by schema** |
| Anti-pattern blocked | "Agent says done but tests fail" — partly enforced by definition-of-done checklist | Same anti-pattern, structurally impossible: VERIFY gate writes fail-evidence files; reducer rejects pass without `GATE_VERIFY_PASSED.json` |
| Verdict | Course's pattern is "agent runs tests"; code-oz's pattern is "the runtime owns the verdict and the agent contributes evidence." | **Code-oz ahead, materially.** |

### 4. Scope

| | learn-harness-engineering | code-oz |
|---|---|---|
| Surface | "One feature at a time" rule + `feature_list.json` definition-of-done checklist | Rule 20 — one new authority boundary per milestone; rule 21 — no parallel-provider surface without measurable risk-reduction; per-phase budgets in `.code-oz/config.yaml`; run-level budget enforcement (rule 19) at `budgets.global` with `softWarnAtRatio`/hard-kill |
| Granularity | Feature-level scope discipline | Phase-level + milestone-level + run-level scope discipline, with budget telemetry into `events.jsonl` |
| Verdict | The course's "one feature" maps to code-oz's "one phase per milestone, one authority per milestone." Code-oz's discipline is finer-grained and budget-enforced. | **Code-oz ahead.** |

### 5. Lifecycle

| | learn-harness-engineering | code-oz |
|---|---|---|
| Surface | `init.sh` at start; clean-state checklist at end; handoff note for next session | Full DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle; AUDIT for brownfield; worktree-per-run isolation (M7); `code-oz resume` with idempotent gate writes; M8 restart-on-fail policy; SHIP gate is the only release point |
| Provider safety | Tool registry pattern (read-only / concurrent-safe per call); permission pipeline policy → user → project → local → session; protected paths/commands | `IAgentProvider` contract; xAI HTTP adapter (PE-1); strict request-body allowlist; provider failure → actionable `NEEDS_INTERVENTION.json` (rule 11); `M11` capability contract; M13 role-cost policy under `budgets.global` |
| Trust boundary | Bootstrap stage 3 — explicit consent inflection, no secrets loaded before trust crossed | `docs/references/provider-contract.md` "Auth model — subprocess delegation + API-key transmission (v0.1)" — already pinned; PE-1 review trail in `CODEX_REVIEW_PE1.md` |
| Verdict | Course's bootstrap (4 stages, dependency-ordered, memoized) is a generalization of Claude Code's startup. Code-oz's lifecycle is a higher-level SDLC cycle. The course's pattern targets *agent runtimes*; code-oz is *one entry mode* (CLI). | **Different scope. Code-oz does not need the bootstrap pattern; the course's pattern is for runtime authors not yet at code-oz's level.** |

## Capabilities the course does NOT address

These are non-trivial. The course's framework treats them as out-of-scope or names them only obliquely:

1. **Cross-family adversarial REVIEW.** Rule 2: REVIEW agent must be a different provider family than BUILD. The course's multi-agent pattern has Coordinator/Fork/Swarm, but no provider-family adversarialism. (Rule 2 was distilled from `Auto-claude-code-research-in-sleep`, not WalkingLabs.)
2. **Debate runtime + reviewer panels.** M10 ships `requestDebate()` as a primitive; M14 ships Reviewer Panel v1; M15 ships debate-policy scheduler v1. The course has zero coverage.
3. **3-source verification before any code.** Rule 3 — `SOURCE_CHECK.md` (spec + reference code + library docs) blocks PLAN. Course has no equivalent.
4. **Cross-model peer review of milestones.** The Codex briefing/response/synthesis ritual (this very document is part of it). The course has no equivalent — its "benchmarking" methodology compares with-vs-without-harness for *one* model.
5. **Run-level budget enforcement with `events.jsonl`-backed cumulative spend.** Rule 19. The course's "context budget" template is a *display* of token allocation, not an enforcement mechanism.
6. **Schema-validated gate files.** Course's `feature_list.json` has a schema (`feature-list.schema.json`) but no gate semantics — files don't block phase progression.
7. **AUDIT phase for brownfield (rule 14).** Course assumes greenfield-or-existing-codebase symmetric; code-oz has dedicated AUDIT artifact and gate.
8. **Permission sub-scopes for tool use (`tool_use.repo_context`).** Rule 18. The course's tool-registry pattern is one level coarser.

## Where the course exceeds code-oz (genuine borrow candidates)

The course's pedagogy and a few specific mechanics expose patterns code-oz can absorb cheaply.

### B1 — Five-subsystem self-assessment scorecard for contributor onboarding

The course offers a 1–5 rubric per subsystem (5 = exemplary, 1 = missing/harmful). Identifying the lowest-scoring subsystem as the bottleneck is a useful **diagnostic shape** for a runtime that ships to other developers. Code-oz could expose a `code-oz doctor --harness-audit` mode (or a `docs/contracts/HARNESS_AUDIT.md`) that scores any external project against the same five subsystems before code-oz manages it. Low cost. High pedagogical value.

**Insertion**: New helper subcommand for `code-oz doctor`, or new doc under `docs/contracts/`.
**Milestone**: post-M16 polish, not blocking.
**Effort**: 1 commit (doc) + optional 2 commits (CLI subcommand + tests).

### B2 — Baseline-vs-harness benchmark methodology for rule 21 enforcement

Rule 21 says "no new parallel-provider surface without a measurable risk-reduction effect." Today, the rule's *measurement methodology* is implicit — "measurable in `events.jsonl`." The course gives an explicit playbook: define 2–3 representative tasks, run with-vs-without, record success/time/tokens/rework, aggregate, decide. Code-oz should codify this as a **pre-milestone playbook** for any future M14/M15-style parallel surface. Pin it under `docs/contracts/RULE21_BENCHMARK.md` or fold it into `ROADMAP.md` § rule 21.

**Insertion**: New doc; reference from `ROADMAP.md` and `docs/contracts/PARALLEL_SURFACES.md` (if exists, otherwise create alongside).
**Milestone**: post-M16 polish; required *before* M17+ if any parallel surface is proposed.
**Effort**: 1 commit (playbook doc) + 1 commit (rule-21 cross-reference update).

### B3 — Codify "Hook trust is all-or-nothing" as a runtime gotcha pin

Course gotcha #10 — if workspace untrusted, all hooks skip; not per-hook trust evaluation. Code-oz's permission model already has trust-boundary discipline (PE-1 doc), but the *all-or-nothing* invariant for any future hook system is not yet pinned. Pin this gotcha now under `docs/contracts/REPO_CONTEXT.md` § "Hook trust" so the next milestone that touches hooks (none in roadmap; pre-emptive) inherits the invariant.

**Insertion**: Append to `docs/contracts/REPO_CONTEXT.md`.
**Milestone**: post-M16 polish (preemptive pin).
**Effort**: 1 commit.

### B4 — Front-load distinctive trigger language in skill / persona descriptions

Course gotcha #12 — skill description budgets are tight (~150 chars per entry); front-loaded trigger language gets priority, tails get cut. Code-oz's persona prompts and any skills under the `agents` library should follow the same rule. This is a writing convention, not a runtime change. Pin as a section of `src/prompts/universal-rules.md` (or as a sibling rule).

**Insertion**: Update `src/prompts/universal-rules.md` (or append to the maestro dossier).
**Milestone**: post-M16 polish.
**Effort**: 1 commit (text); 1 follow-up commit if any current persona description violates the rule.

## Where code-oz can borrow from but should NOT

### R1 — Replace the six-phase taxonomy with the five-subsystem framework

The course's framework is **descriptive** (what a good harness has). Code-oz's six-phase taxonomy is **prescriptive** (what the runtime enforces). They map; they don't substitute. Restructuring would lose the gate semantics. **Reject.**

### R2 — Adopt `feature_list.json` as a code-oz artifact

Code-oz already has `SPEC.md`, `PLAN.md`, `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md` (rule 7) plus `events.jsonl` and gate files. A separate JSON feature tracker is redundant and would compete with the typed FSM. The course's `feature_list.json` is a *display* of the same data code-oz already projects from `events.jsonl`. **Reject.**

### R3 — Adopt the AGENTS.md + CLAUDE.md split

Code-oz uses `CLAUDE.md` (project) + `~/.claude/CLAUDE.md` (user) + the universal-rules prompt fragment. Adding a sibling `AGENTS.md` adds noise without enforcement. The course's reason for both is "alternative if using Claude Code"; code-oz already targets multiple providers via `IAgentProvider` and unifies under one project file. **Reject.**

### R4 — Adopt the four-stage bootstrap pattern (minimal-context → tools → trust → sensitive)

The course's bootstrap targets agent runtimes that have multiple entry modes (CLI, server, SDK) and need to load secret env vars conditionally. Code-oz has one entry mode (CLI) and a much simpler bootstrap (CLI args → config load → run lifecycle). The pattern is over-engineered for code-oz's surface area today, and PE-2+ is demand-gated. **Reject (premature).**

## Decision

**YES, code-oz is ahead.** The four borrows are pedagogical and contractual, not architectural — they pin patterns that strengthen documentation and discipline without changing the runtime. The four rejects are category mismatches.

The category split is the headline: code-oz is a *runtime* that competes with raw coding agents under the AI-software-company thesis; learn-harness-engineering is a *course* that teaches the harness mindset to people building harnesses for the first time. Code-oz's nearest peer in the course's framing is Claude Code itself (which the course's reference patterns are mostly summarizing).

## Borrow set, ranked

| # | Borrow | Source | Insertion | Effort | Status |
|---|--------|--------|-----------|--------|--------|
| B1 | Five-subsystem 1–5 self-assessment scorecard | SKILL.md Phase 2 | new `docs/contracts/HARNESS_AUDIT.md` + optional `code-oz doctor --harness-audit` | 1–3 commits | post-M16 polish |
| B2 | Baseline-vs-harness benchmark methodology for rule 21 | SKILL.md "Running Benchmarks" | new `docs/contracts/RULE21_BENCHMARK.md` + ROADMAP cross-ref | 2 commits | required before any future parallel surface |
| B3 | "Hook trust is all-or-nothing" invariant pin | gotchas.md #10 | append to `docs/contracts/REPO_CONTEXT.md` | 1 commit | post-M16 polish (preemptive) |
| B4 | Front-load distinctive trigger language in persona/skill descriptions | gotchas.md #12 | update `src/prompts/universal-rules.md` | 1 commit | post-M16 polish |

## Reject set

| # | Reject | Reason |
|---|--------|--------|
| R1 | Replace six-phase taxonomy with five-subsystem framework | course's framework is descriptive; code-oz's is prescriptive — different layer |
| R2 | Adopt `feature_list.json` as artifact | redundant with gate files + `events.jsonl` |
| R3 | Adopt AGENTS.md + CLAUDE.md split | adds noise without enforcement; code-oz unifies under one project file |
| R4 | Adopt four-stage bootstrap (minimal→tools→trust→sensitive) | premature for CLI-only entry mode; PE-2+ is demand-gated |

## Open question for Codex

The benchmark methodology (B2) is the only borrow that touches a load-bearing rule (rule 21). Is the methodology Codex-acceptable as the canonical measurement playbook for parallel-surface authority, or would Codex propose a different rigor bar (e.g., effect-size threshold, statistical significance, specific telemetry counters in `events.jsonl`)? See `CODEX_BRIEFING.md`.

## Why this comparison matters for the influence library

The audit of `~/Projects/agents/templates/` is now seven sessions deep. Pattern emerging: **the influence library splits cleanly into runtime peers (ace, archon, aris) and pedagogy templates (agent-skills, learn-harness-engineering)**. Pedagogy templates contribute writing conventions and diagnostic rubrics; runtime peers contribute architectural mechanics. Code-oz should resist absorbing pedagogy *as architecture* — the rule-20 authority discipline depends on staying lean.
