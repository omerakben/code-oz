---
name: contracts-needed-reviewer-memory
companion-docs: SYNTHESIS.md (M17-M20 scope), ../../contracts/SCIENTIST.md, ../../contracts/REPO_CONTEXT.md, ../../references/file-based-gates.md
target: staged contract drafts that must land before M17 implementation starts
status: draft — actual contract files live under `docs/contracts/`, which is shared with parallel comparison sessions; this file isolates the draft text until those sessions converge
date: 2026-05-10
---

# Contracts that must exist before M17 implementation

The Round 2 architect review flagged that `docs/contracts/SCIENTIST.md` and `docs/contracts/REPO_CONTEXT.md` were written before their associated code landed, and that the same discipline should apply to Reviewer Memory. This file captures the contract texts needed so the M17 planning session can drop them in without re-deriving them. They are not committed under `docs/contracts/` here because parallel comparison sessions are also writing under the same directory and a merge conflict is likely.

## C1 — `docs/contracts/REVIEWER_MEMORY.md`

Pins the on-disk lesson format, the `lesson_consumed` event schema, the read-path API surface, and the M19 join semantics. Required before M17 code lands.

### Required content

- **Frontmatter schema.** Required keys: `lessonId`, `entrySha`, `slug`, `section`, `createdAt`, `createdByPhase`, `createdByAgent`, `createdInRun`. Optional: `tags`, `relatedLessonIds`.
- **Bullet line grammar (strict).** Full-line anchored regex: `^\[(<slug>)-(\d{5})\] helpful=(\d+) harmful=(\d+) :: (.+)$`. Slug must be present in `src/memory/section-slugs.ts`. Content after `::` is non-empty. Counters are nonnegative integers. (Reject ACE's permissive `parse_playbook_line` at `playbook_utils.py:23-46`.)
- **Section header → slug mapping.** Lives in `src/memory/section-slugs.ts` as a frozen TypeScript const. Adding a new section is a code change + migration script + doctor validation. Slug is never derived from initials at runtime.
- **Lesson ID generation.** IDs derive from a content hash + collision-checked counter seeded from the highest existing ID at boot. Doctor fails if any lesson file contains IDs the generator cannot produce. **Never reset to 1 on warm-start** (the ACE bug at `ace.py:86-93`).
- **`lesson_consumed` event schema.** `{ version: 1, ts, runId, type: "lesson_consumed", lessonId, entrySha, phase, agent, taskId? }`. **No content snippets, no question snippets, no context snippets.** Privacy shape per rule 13. The event-type forward-compat path at `docs/references/file-based-gates.md:240` (the Open-type-union rule) makes this additive without a `version` bump.
- **Read-path API.** Function signature: `loadLesson(lessonId): Promise<Lesson>` and `findLessons({section?, slug?, limit?}): Promise<Lesson[]>`. Caps: 100 lessons per call, 16KB per lesson body, no recursive resolution of `relatedLessonIds` (caller fetches transitively if needed).
- **M19 join semantics.** A lesson is "helpful" if a `lesson_consumed` event for it exists in a run where the terminal event is `gate_passed` AND no `NEEDS_INTERVENTION` events follow it in the same run. v0.1 ships helpful-attribution only; harmful-attribution waits for the citation-tracking milestone.

## C2 — `docs/contracts/MEMORY_OPERATIONS.md`

Pins the M18 mutator op schema, the rejected-op behavior, the applier contract, and the cross-family rule for op proposers. Required before M18 code lands.

### Required content

- **Op schema (M18 v0.1, ADD-only).** `{ type: "ADD", section: string, content: string }`. `section` must be a known slug. `content` is non-empty, ≤4096 chars.
- **Reserved future ops.** `UPDATE`, `MERGE`, `DELETE`, `CREATE_META` are reserved names; their applier behavior is undefined at M18 and the applier rejects them with `op_not_supported`. When a future milestone implements them, it bumps the op-schema version and updates the applier's enum together. Callers MUST query the applier's capability surface, never assume the op set.
- **Applier contract.** `applyMemoryOperations(currentFile: string, ops: Op[]): { updatedFile: string, newLessonIds: string[] }`. Pure, deterministic, network-free. Atomic write semantics: caller writes to a temp file in the same directory then renames; never overwrites in place.
- **Cross-family rule (rule 2 extension).** If an LLM proposes ops based on Builder output, the proposer's provider family MUST differ from Builder's. The applier itself has no family.
- **Failure modes.**
  - Parse failure → `NEEDS_INTERVENTION.json` with code `memory_op_parse_failed`.
  - `op_not_supported` → `NEEDS_INTERVENTION.json` with code `memory_op_not_supported`.
  - Empty/sentinel LLM response from proposer (ACE's `INCORRECT_DUE_TO_EMPTY_RESPONSE`) → `NEEDS_INTERVENTION.json` with code `memory_proposer_empty_response`.
  - No silent skip (rule 11).
- **Scientist tail (rule 15).** Mutator emits `HYPOTHESES.md` and `OPEN_QUESTIONS.md` sidecars under `./.code-oz/scientist/memory-mutation/<runId>/` after each mutation. The lesson file is a primary artifact.
- **Universal anti-slop import (rule 16).** The proposer system prompt imports `src/prompts/universal-rules.md`.

## C3 — `docs/references/file-based-gates.md` event-type registry update

The Open-type-union rule at line 240 lets `lesson_consumed` land additively. The event-type registry should be updated when M17 ships to list the new type as recognized rather than unknown, so consumers can opt into strict per-type validation. This is a routine documentation update, not a contract change.

### Required content

Add to the recognized types list at line 240: `lesson_consumed`. Add per-type validation: `{ lessonId: non-empty string, entrySha: 64-char lowercase hex, phase: canonical phase enum, agent: non-empty string, taskId: optional non-empty string }`.

## Coordination note

Parallel comparison sessions are writing under `docs/contracts/` and `docs/references/`. The drop-in moment for these contracts is when:

1. The user signals all comparison-session PRs have merged.
2. M17 planning starts.

Until both are true, this file is the staged version. The actual contract files should be authored by the M17 planning session, copying from this file with whatever updates the M2-M11 comparisons surfaced about the canonical doc shape.
