---
session: 06-codex
template: openai/codex
date: 2026-05-10
codex-thread: 019e12ec-1f53-7982-90f1-9b07ce8eab05
final-verdict: push
companion: ./COMPARISON.md, ./CODEX_BRIEFING.md, ./CODEX_RESPONSE.md
---

# Synthesis — code-oz vs codex (session 06)

Cross-model peer review converged on `push` after one round. Codex's `gpt-5.5` xhigh return endorsed all four recommended borrows (B1, B2, B4, B6) with modifications, agreed the deferrals (B3, B5) and rejections (R1, R2, R3) were correctly scoped, tightened L1's wording so the policy-lock is accurate instead of aspirational, and surfaced three borrows we missed (M1-M3). It also caught one factual error in the comparison: the plan-persona file is `src/prompts/plan-system.md`, not the non-existent `src/prompts/personas/plan.md`. That correction has been applied in both `COMPARISON.md` and `CODEX_BRIEFING.md`.

This document is the merged decision record. It supersedes `COMPARISON.md` where the two disagree.

## Closed decisions

### B1 — Decomposed review sub-skills (accept-with-modifications)

**What lands.** Add a structured specialist rubric inside the existing REVIEW persona prompt — context discipline, breaking-changes scope, change-size cap (≤800 lines / ≤500 for complex), and test-authoring guidance. The rubric ships as scope-specific sections imported *after* the universal anti-slop rules (rule 16 stays primary).

**What does not land.** Nested provider sub-passes by default. Codex's pattern of "one orchestrator skill spawns N specialist subagent calls" multiplies provider calls under panel review. With the M14 panel running 3 reviewers and 4-5 specialists each, naive nesting puts 12-15 provider calls behind a single REVIEW pass — a rule-19 budget violation and a rule-21 "no parallel-provider surface without measured risk-reduction" violation.

**Escalation rule.** Specialist sub-passes only fire when:
- diff is high-risk (touches state machine, locks, contracts), OR
- `events.jsonl` shows a missed-review pattern (e.g., the same bug class slipping through over N runs)

**Where it lands.** `src/prompts/review-system.md` (new specialist-rubric section). All sub-pass calls counted under `budgets.global`.

**Status.** Land alongside the next REVIEW prompt revision; no new milestone needed.

### B2 — Skill format extension (accept-with-modifications)

**What lands.** Skill catalog supports `SKILL.md + references/ + scripts/ + agents/` subdirectory layout (codex's `.codex/skills/babysit-pr/` pattern).

**Rule 9 generalization.** Permission manifest scope expands from "any `.ts` escape-hatch" to "any executable runner". Manifest fields per skill:
- `command` — argv form
- `interpreter` — bun/node/python/sh; explicit
- `cwd` — required
- `file_roots` — read/write/none per root
- `network` — allow/deny + allowlist
- `env` — allowlist (no inheritance)
- `secrets` — allowlist
- `timeout` — seconds
- `output_caps` — stdout/stderr byte caps

**Subagent rule.** Every prompt under `agents/` imports `universal-rules.md` first and cannot relax the universal rules (rule 16 stays load-bearing).

**Where it lands.** Update rule 9 in CLAUDE.md and the skill-catalog spec (W3+). Format extension is docs-only until a skill ships scripts.

**Status.** Rule 9 update is a candidate for the next CLAUDE.md revision.

### B3 — WATCH phase post-SHIP (deferred, demand-gated)

**Confirmed deferral.** A WATCH/PR-steward loop introduces continuing authority after SHIP, GitHub write behavior, retry policy, and possibly auto-push. That is not a trailing-edge tweak. Pin the design pattern in the influence library; reopen as a post-M16 milestone only after real SHIP/PR usage exists.

**Influence-library entry.** "babysit-pr is the canonical post-merge state-machine: explicit stop conditions, polling cadence (1m red, base after green), action priorities (review-feedback > flaky-retry), trusted-author gating, retry budget. Adopt only when demand is real."

**Status.** Pinned only.

### B4 — Named approval presets (accept-with-modifications)

**What lands.** Presets in `.code-oz/config.yaml` are *aliases that expand to explicit resolved config*, not hidden semantic modes. When the user picks `preset: paranoid`, the resolved config is logged in `events.jsonl` showing every budget and permission that was set. Explicit keys override preset values — preset is the floor, not the ceiling.

**Rule 19 alignment.** "Cost budgets are config, not vibes." Presets must not hide what the budget is.

**Where it lands.** `.code-oz/config.yaml` schema + `src/state/budgets.ts` (or wherever budget resolution lives) + an `events.jsonl` `config_resolved` event at run start.

**Status.** Land in the next config-schema revision; no new milestone.

### B5 — OTEL exporter (deferred, demand-gated)

**Confirmed deferral.** OTEL is useful when there is a dashboard or support workflow. Until then, it risks creating telemetry ceremony.

**Authority lock for when it lands.** When OTEL ships, it is *one-way export from `events.jsonl`*. Never a second event authority. The canonical event log is `events.jsonl` and stays so.

**Status.** Pinned only. Rule for the future export.

### B6 — Plan-mode "non-mutating" rule (accept-with-modifications)

**What lands.** `src/prompts/plan-system.md` gains a strict mutation-vs-exploration section adapted from codex's `plan.md` collaboration template.

**Mutation list (forbidden in PLAN).**
- Edits to repo-tracked files
- Package installs (`bun install`, `npm install`, etc.)
- Formatter or linter runs that rewrite files
- Database migrations or codegen
- Network calls that mutate external state
- Branch creation, commits, pushes

**Exploration list (allowed in PLAN).**
- Reading files, configs, schemas, types, manifests
- Searches and static analysis
- Dry-run commands that don't write to repo-tracked paths
- Tests/builds that may write to caches (`target/`, `.cache/`, `.bun/`) but not repo-tracked files

**Where it lands.** `src/prompts/plan-system.md` — flat layout, no `personas/` subdir.

**Status.** Land in the next prompt revision; no new milestone.

### R1 / R2 / R3 — Rejections confirmed

**R1 (sandboxing crates).** Code-oz delegates process-level sandboxing to provider CLIs and document the trust boundary under L1.

**R2 (single-primary provider).** Multi-provider/cross-family is the categorical lock (rule 21).

**R3 (free-form interaction).** Phase graph + Markdown artifacts is the lock (rules 1, 7).

### L1 — Trust-boundary policy lock (accept-with-modifications)

**Tightened wording.** Replace "Code-Oz never spawns shells directly" with:

> Code-Oz does not provide general shell execution; code-oz-owned execution is limited to no-shell argv runners or manifest-gated skill scripts, while provider CLIs own their subprocess sandbox/approval model.

**Where it lands.** `docs/references/provider-contract.md` — extend the existing "Auth model — subprocess delegation + API-key transmission (v0.1)" section with this trust-boundary statement.

**Status.** Land in the next provider-contract revision.

## Missed borrows (added by Codex)

### M1 — codex-pr-body discipline (parked for SHIP/GitHub integration)

**Pattern.** Explain *why* first, then net change, preserve existing body content, include intentional verification, avoid local absolute paths.

**Where it lands when SHIP integrates with GitHub.** SHIP persona prompt or a SHIP sub-skill.

**Status.** Pinned only — wait for the SHIP/GitHub integration milestone.

### M2 — High-touch module size review sub-skill

**Pattern.** Codex's AGENTS.md has a "high-touch module size / core bloat" rule (≤500 LoC target, ≤800 LoC hard, no helper methods called once, prefer new modules over growing existing). Code-oz can mirror this as a review sub-skill targeting orchestrator/state-machine files — exactly the surface where M16 C9 caused 8 production bugs from sub-surface coupling.

**Where it lands.** Specialist rubric inside `src/prompts/review-system.md` (composes with B1).

**Status.** Land alongside B1 — high value given the C9 lesson.

### M3 — Agent bill-of-materials (parked)

**Pattern.** Lightweight provenance metadata: `agent_version`, `agent_harness_id`, `running_location`. Useful for future doctor bundles or integration traces.

**Where it lands when needed.** `state/events.jsonl` start-of-run event, plus doctor output.

**Status.** Pinned only — wait for a debugging incident that needs it.

## Rule-violation flags (accepted)

The flags Codex raised are real:

- B1 implementation must enforce the budget cap (rule 19) and the measured-risk gate (rule 21). Specialist sub-passes are escalation, not default.
- B2 must generalize rule 9 to all executable runners. The `agents/` subdir must import `universal-rules.md` first (rule 16).
- B3 stays demand-gated to avoid rule 20 violation.
- B5 must be one-way export only — never a parallel event authority.
- L1 wording is tightened (above).

## What changes after this synthesis

### Immediate (next prompt revision, no new milestone)

1. `src/prompts/plan-system.md` — add B6 mutation/exploration section.
2. `src/prompts/review-system.md` — add B1 specialist rubric (context, breaking-changes, change-size, testing) + M2 module-size sub-skill.
3. `docs/references/provider-contract.md` — extend with L1 tightened trust-boundary statement.
4. `.code-oz/config.yaml` schema — add B4 named presets that expand to explicit resolved config.
5. `CLAUDE.md` rule 9 — generalize from "`.ts` escape hatch" to "any executable runner" (B2 rule update).

### Pinned in influence library (no immediate work)

- B3 (WATCH phase / babysit-pr post-merge state-machine) — adopt only when SHIP/PR demand is real.
- B5 (OTEL exporter) — adopt when a real consumer exists; one-way export from `events.jsonl` only.
- M1 (codex-pr-body discipline) — adopt at SHIP/GitHub integration.
- M3 (agent bill-of-materials) — adopt when a debugging incident needs it.

### Closed

- R1 (sandboxing crates) — code-oz delegates.
- R2 (single-primary provider) — multi-provider-first is the lock.
- R3 (free-form interaction) — phase graph is the lock.

## Why code-oz is ahead (recap, post-debate)

Codex confirmed the categorical asymmetry. Code-oz outruns codex on every orchestration axis:

1. Phase-graph spine + file-based gate signals (rules 1, 7)
2. Cross-family REVIEW with provider isolation (rule 2)
3. Reviewer panel v1 (M14 — first simultaneous-provider surface)
4. Debate-policy scheduler (M15)
5. Provider capability contract (M11)
6. Role-cost policy under `budgets.global` (M13)
7. Brownfield AUDIT phase + artifact (rule 14)
8. Epistemic sidecars at phase gates (rule 15)
9. Universal anti-slop rules in every persona prompt (rule 16)
10. 3-source verification at PLAN gate (rule 3)
11. One-authority-per-milestone discipline (rule 20)
12. Mandatory run-level budget enforcement (rule 19)
13. Measurable-risk-reduction lock for new parallel-provider surfaces (rule 21)

Codex is ahead on the single-agent-CLI craft surfaces Code-Oz delegates to it (sandboxing, approval-presets craft, decomposed review craft, post-merge babysit loop, skill-with-scripts format). Borrowing the *patterns* without dragging the *category* is the synthesis posture — and Codex agreed.

## Next session

Move to the next unaudited template per the README backlog. Candidates: `byterover-cli`, `Mimir`, `prd-taskmaster`, `gptme`, `learn-harness-engineering`, `codegraph`, `codex-coder`. One per session.
