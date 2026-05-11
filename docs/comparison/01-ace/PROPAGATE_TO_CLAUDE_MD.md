---
name: propagate-to-claude-md-ace
companion-docs: SYNTHESIS.md, ../../../CLAUDE.md (influence library section)
target: staged update to CLAUDE.md influence library + ROADMAP for the M17-M20 sequence
status: deferred until parallel comparison sessions converge (CLAUDE.md is high-conflict territory)
date: 2026-05-10
---

# Staged updates to CLAUDE.md and ROADMAP.md

Parallel comparison sessions are all queueing updates to the same canonical docs. This file stages the ACE-specific propagations so a later synthesis session can merge them with the other templates' propagations in one pass.

## Update 1 — CLAUDE.md "Influence library" table

**Current state** (CLAUDE.md, "Influence library" section):

```markdown
| Template                             | Pattern                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `agent-skills`                       | Skill frontmatter format + DEFINE→SHIP phase taxonomy + Common Rationalizations table        |
| `opencode`                           | `bun build --compile` distribution + MCP host/client + permission system                     |
| `Archon`                             | `IAgentProvider` interface + worktree-per-run isolation                                      |
| `pi-mono`                            | Streaming event model + multi-provider abstraction                                           |
| `maestro`                            | File-based gate signals + 3-source verification + Opus-default policy                        |
| `Auto-claude-code-research-in-sleep` | Cross-family review + Reviewer Memory + 4-round-cap loop + plain-Markdown artifact contracts |
| `claude-code`                        | Plugin format + hook event names + filesystem discovery                                      |
```

**Proposed addition** (one row, alphabetical insertion before `agent-skills` or appended — either works; the table is a flat list):

```markdown
| `ace`                                | Bullet-shaped lesson format + ADD-only delta-op invariant + helpful/harmful attribution + lesson-consumption telemetry (M17-M20 substrate, see `docs/comparison/01-ace/`) |
```

## Update 2 — ROADMAP.md M16+ row

**Current state** (`docs/design/ROADMAP.md` M16+ row, approximately line 381):

```markdown
- **M16+ (deferred until measurable need):** Researcher phase-tail (when Lead-persona source verification overflows), parallel builder candidates (security-wedge trigger), multi-opponent debate (when single-opponent proves insufficient on real disagreement cases), Skills layer architecture (when M9/M10 produce duplication pain).
```

**Proposed update** — add an M17-M20 entry before the M16+ deferred row, and update the M16+ row to acknowledge the new sequence:

```markdown
- **M17 — Reviewer Memory v1: read substrate.** Lesson file format, parser/validator, `lesson_consumed` event, retrieval API. One authority (read substrate), four sub-surfaces (S1 storage, S2 event, S3 read-API, S4 ID-gen) tracked per the M16 C9 sub-surface lesson. See `docs/comparison/01-ace/SYNTHESIS.md`.
- **M18 — Reviewer Memory v1: ADD-only mutator.** Deterministic applier; UPDATE/MERGE/DELETE/CREATE_META rejected as `op_not_supported`. Two contract files (`REVIEWER_MEMORY.md`, `MEMORY_OPERATIONS.md`) must exist before M17 code lands.
- **M19 — Reviewer Memory v1: helpful-attribution.** Derived from `events.jsonl`. No materialized counters. Harmful-attribution deferred until citation-tracking lands. Manual override via `code-oz doctor memory flag-harmful`.
- **M20 — Reviewer Memory v1: budget + compaction-proposal.** `memory.maxStoredTokens` budget. String-similarity dedup. Proposals only; applying destructive ops is a separate later milestone (M21 or M18-extension).
- **M16+ (deferred until measurable need):** Researcher phase-tail (when Lead-persona source verification overflows), parallel builder candidates (security-wedge trigger), multi-opponent debate (when single-opponent proves insufficient on real disagreement cases), Skills layer architecture (when M9/M10 produce duplication pain). **Note:** Reviewer Memory (M17-M20) is the cross-run learning substrate; Researcher is a phase-tail that might consume it but is not required for M17-M20 to ship.
```

## Why this propagation is deferred

Parallel comparison sessions (rows 02-12+ in `docs/comparison/README.md`) are likely queueing rows in the same Influence library table and adding their own M-numbered milestones to ROADMAP.md. Applying this propagation in the ACE session PR would conflict with all of them.

The right pattern: a future synthesis session reads every `docs/comparison/*/PROPAGATE_TO_CLAUDE_MD.md`, merges them in one pass against the current CLAUDE.md, and lands a single propagation commit. That commit is also the natural moment to compact the comparison series (close any rows that ship, archive paper-trail folders for templates that did not produce a borrow).

## Coordination contract

When the comparison-series synthesis session runs, it MUST:

1. Read every `docs/comparison/*/PROPAGATE_TO_CLAUDE_MD.md`.
2. Verify the proposed CLAUDE.md row is still accurate (the comparison may be stale).
3. Verify the proposed ROADMAP.md milestones do not collide with other sessions' M-numbers.
4. Apply all updates in one commit.
5. Update each session folder's README cell with the final M-numbers.
