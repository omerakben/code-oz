---
name: round-2-architect-and-codex-fresh
companion-docs: ROUND_1.md, SYNTHESIS.md, CONTRACTS_NEEDED.md, PROPAGATE_TO_CLAUDE_MD.md
target: log of Round 2 (Opus code-architect + Codex fresh thread) and fixes applied
status: closed
date: 2026-05-10
opus-reviewer: Opus code-architect subagent (`code-architect`, agent ID `ac656cca4ee02e716`)
codex-thread: 019e1322-70dc-7453-aea1-4df4d8763ca2 (fresh thread, "missed angles" lens)
---

# Round 2 — architect + Codex fresh thread

## Severity tally (combined, deduplicated)

- block-push: 3
- fix-soon: 9
- open-question: 3
- nit: 4

The two critics converged on the four most important findings independently: contract gaps, M19 memory-poisoning vulnerability, M20 authority count, and parser strictness.

## Findings applied

### Block-push (3)

| # | Source | Title | Resolution |
|---|---|---|---|
| R2A-F1 | Opus architect | M17 bundles 4 authorities (storage + event + read-API + ID-gen) | Compromise: M17 stays one authority (read substrate) but enumerates 4 sub-surfaces (S1-S4) per the M16 C9 sub-surface lesson. Each sub-surface has its own gate-exit test. Splitting into M17a + M17b was considered and rejected because the four are tightly coupled (cannot have a read API without a format to read, etc.). |
| R2A-F7 | Opus architect | M19 attribution vulnerable to memory poisoning (a malicious lesson can pass through `gate_passed` without explicit human catch until post-deploy) | M19 v0.1 ships helpful-attribution only. Harmful-attribution deferred until citation-tracking infrastructure lands. Manual override via `code-oz doctor memory flag-harmful <lesson-id>` writes an override event, doctor-flagged entries excluded from retrieval. |
| R2A-F12 | Opus architect | Section-to-slug mapping table location undefined | Pinned to `src/memory/section-slugs.ts` as a frozen TypeScript const. Adding a section requires code change + migration script + doctor validation. |

### Fix-soon (9)

| # | Source | Title | Resolution |
|---|---|---|---|
| R2C-1 | Codex | M17 doesn't reject ACE's permissive parser | Strict full-line-anchored grammar added to M17 in-scope. ACE's `parse_playbook_line` permissiveness explicitly rejected. |
| R2C-2 / R2A-F4 | Both | Need REVIEWER_MEMORY.md and MEMORY_OPERATIONS.md contracts before M17 | Drafts staged in `CONTRACTS_NEEDED.md`. Actual files deferred because `docs/contracts/` is high-conflict territory with parallel comparison sessions. |
| R2C-3 | Codex | M19 leaves ACE's `get_playbook_stats` projection on the table | `memoryStats` projection added to M19 in-scope: `{ total, unused, withHelpfulSignal, byMappedSection }` derived from events. ACE's hardcoded thresholds explicitly rejected. |
| R2A-F2 | Opus architect | M18 reject-at-parse for unknown ops is hidden forward-compat authority | M18 scope updated: op-type field is a closed enum at M18 (only `ADD`); future ops bump the schema version and update the applier together; callers query the applier's capability surface. |
| R2A-F6 | Opus architect | ROADMAP M16+ row should cross-reference M17-M20 | Staged in `PROPAGATE_TO_CLAUDE_MD.md` (deferred to avoid parallel-session conflict). |
| R2A-F9 | Opus architect | M18 mutator needs Scientist tail (rule 15) | M18 in-scope now emits `HYPOTHESES.md` + `OPEN_QUESTIONS.md` sidecars under `./.code-oz/scientist/memory-mutation/`. |
| R2A-F11 | Opus architect | M17 gate-exit missing warm-start collision test | Gate-exit now includes: "load a fixture lesson with ID `<slug>-00042`, add a new entry, verify the new ID is `<slug>-00043` or higher." |
| R2A-F5 | Opus architect | ACE row should be added to CLAUDE.md influence library | Staged in `PROPAGATE_TO_CLAUDE_MD.md` (deferred to avoid parallel-session conflict). |
| R2C-7 | Codex | Risks list lives only in CODEX_RESPONSE.md, not canonical SYNTHESIS | New `## Risks carried forward` section added to SYNTHESIS.md with all 6 risks (3 from R1, 3 from R2). |

### Open-question (3)

| # | Source | Title | Resolution |
|---|---|---|---|
| R2A-F3 | Opus architect | Verify `docs/references/file-based-gates.md:240` actually documents event-type forward-compat | Verified. Line 240 is the "Open-type-union (M4)" rule. Unknown `type` values pass shape validation and survive verbatim. The citation in SYNTHESIS is correct. |
| R2C-4 / R2A-F8 | Both | M20 bundles two authorities (budget + destructive mutation) | M20 reframed as "compaction-proposal authority": M20 emits proposals only; applying destructive ops is M21 (or M18-extension). Rule 21 explicit: does NOT apply at M20 (deterministic-only, no LLM voting). |

### Nit (4)

| # | Source | Title | Resolution |
|---|---|---|---|
| R2C-5 | Codex | Reject ACE's eval-harness surfaces explicitly | Added to "What this comparison does NOT recommend": `DataProcessor`, `evaluate_test_set`, `online_eval_frequency`. |
| R2C-6 | Codex | "schema accepts" too formal; ACE's validator permits and does not reject unknown types | Paragraph 1 of COMPARISON.md updated. |
| R2A-F10 | Opus architect | M19 should include doctor privacy-regression check | Doctor check added to M17 in-scope (and called out as load-bearing in M19) — `lesson_consumed` events must only carry `{ lessonId, entrySha, phase, agent, runId, taskId }`. |
| R2A-F13 | Opus architect | COMPARISON.md paragraph 1 missing bullet_usage_log privacy note | Paragraph 1 updated with explicit privacy callout citing `logger.py:32-81`. |

## Decision shape after Round 2

- **Strategic call:** unchanged. YES with selective borrows; Reviewer Memory v1 stays a 4-milestone sequence.
- **M17:** unchanged at the authority level (one boundary, read substrate) but materially tightened. Now ships strict parser + explicit slug mapping + warm-start collision test + privacy doctor check + sub-surface accounting (S1-S4).
- **M18:** tightened. Now ships forward-compat rule (closed-enum at v0.1), explicit rejection of all four future ops as `op_not_supported`, both ACE silent-skip paths converted to `NEEDS_INTERVENTION`, Scientist tail.
- **M19:** v0.1 narrowed to helpful-attribution only. Harmful deferred to a milestone that ships citation tracking. Manual override via doctor command. `memoryStats` projection added (with ACE's hardcoded thresholds explicitly rejected).
- **M20:** reframed as compaction-proposal authority. Applying destructive ops is M21 (or M18-extension). Deterministic-only; LLM-based merge voting rejected.

## What did NOT change

- The 4-milestone sequence count (M17-M20).
- The "YES with selective borrows" decision.
- The borrow set B1-B7 (just narrowed across more milestones; nothing dropped except the rejected items already documented).
- The 4 starting paper-trail files (`COMPARISON.md`, `CODEX_BRIEFING.md`, `CODEX_RESPONSE.md`, `SYNTHESIS.md`).

## What was added

- `CONTRACTS_NEEDED.md` — staged drafts of `REVIEWER_MEMORY.md` and `MEMORY_OPERATIONS.md` (the actual contract files are deferred to avoid parallel-session conflict in `docs/contracts/`).
- `PROPAGATE_TO_CLAUDE_MD.md` — staged updates to CLAUDE.md and ROADMAP.md (deferred to avoid parallel-session conflict).
- `## Risks carried forward` section in SYNTHESIS.md (6 risks total).

## Convergence check

Both critics raised independent findings. Both findings sets close cleanly. Codex's Round 2 verdict was `accept-with-modifications` on both the M17-M20 sequence and the borrow set; all modifications applied. Architect's findings are addressed (3 block-push closed, 6 fix-soon applied, 1 open-question verified, 4 nits applied).

## What's next

Round 3: final sweep. Dispatch both critics again — Opus reviewer or architect on the updated docs, and Codex on the canonical SYNTHESIS — and check for convergence to a clean `accept` with no findings. If both sign off, write CLOSE_OUT.md and push the PR.
