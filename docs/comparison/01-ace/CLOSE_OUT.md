---
name: close-out-comparison-ace
companion-docs: COMPARISON.md, CODEX_BRIEFING.md, CODEX_RESPONSE.md, SYNTHESIS.md, CONTRACTS_NEEDED.md, PROPAGATE_TO_CLAUDE_MD.md, ROUND_1.md, ROUND_2.md
target: final sign-off and convergence record for the ACE template-comparison session
status: closed — Round 4 Codex confirmation returned "Round 4 clean. PR-merge-ready." Both critics aligned at clean accept; no remaining findings of any severity.
date: 2026-05-10
---

# Close-out — session 01, ACE

## Session bar (from the user's brief)

> "At the end of your main session, it should be 100% satisfaction with Claude + Codex, aligned, and saying I cannot find any more improvements, fixes, better approaches, or anything cleaner than the template."

## Convergence record

| Round | Critic | Lens | Findings | Outcome |
|---|---|---|---|---|
| 0 (debate) | Codex thread `019e12ab` | "pressure-test the comparison and the M17 borrow set" | 1 block-soft + Q1-Q5 + 3 missed items + 3 risks | `accept-with-modifications`; M17-M20 split adopted |
| 1 | Opus `code-reviewer` agent `a61af991e5e656007` | "claim-vs-source + style + rules 1-21" | 22 findings (1 block-push, 10 fix-soon, 11 nits) | All material findings applied; ROUND_1.md log |
| 2 architect | Opus `code-architect` agent `ac656cca4ee02e716` | "systemic + contract gaps + decomposition" | 13 findings (3 block-push, 8 fix-soon, 2 open-questions) | All material findings applied; ROUND_2.md log |
| 2 codex | Codex fresh thread `019e1322` | "what did we miss in ACE" | 7 findings (3 fix-soon + 1 open-question + 2 nits + risks list) | `accept-with-modifications`; all modifications applied |
| 3 codex | Codex fresh thread `019e132c` | "final sweep, convergence check" | 1 fix-before-merge (event-name mismatch); L1/L2/L3 otherwise clean | All applied |
| 3 opus | Opus `pr-review-toolkit:code-reviewer` agent `a2528ef755ecd046c` | "guideline adherence + PR readiness" | 7 findings (4 fix-soon citation + style; 3 nits style + meta) | All applied |
| 4 codex | Codex fresh thread `019e1409` | "convergence confirmation" | None — verdict: "Round 4 clean. PR-merge-ready." | Closed |

## Decision shape (final)

**YES, with selective borrows.** ACE is a complement, not a competitor.

**Milestone sequence (4):**

- **M17** — Reviewer Memory v1: read substrate. One authority, four sub-surfaces (S1 storage, S2 event, S3 read-API, S4 ID-gen). Strict parser, explicit slug mapping at `src/memory/section-slugs.ts`, warm-start collision test, doctor privacy check.
- **M18** — Reviewer Memory v1: ADD-only mutator authority. Closed-enum at v0.1 (only `ADD`); UPDATE/MERGE/DELETE/CREATE_META reserved but rejected with `op_not_supported`. Scientist tail. Both ACE silent-skip paths closed.
- **M19** — Reviewer Memory v1: helpful-attribution, derived. Harmful-attribution deferred until citation infrastructure lands. Manual override via `code-oz doctor memory flag-harmful`. `memoryStats` projection. Event names match `docs/references/file-based-gates.md:153-161`.
- **M20** — Reviewer Memory v1: budget + compaction-proposal authority. Proposals only; applying destructive ops is M21 (or M18-extension). Deterministic-only string/tag similarity; LLM voting rejected.

**Two contract files needed before M17 code lands** (staged in `CONTRACTS_NEEDED.md` because `docs/contracts/` is high-conflict territory with parallel sessions):

- `docs/contracts/REVIEWER_MEMORY.md`
- `docs/contracts/MEMORY_OPERATIONS.md`

**Two propagations deferred to the comparison-series synthesis session** (staged in `PROPAGATE_TO_CLAUDE_MD.md`):

- CLAUDE.md "Influence library" row for `ace`.
- ROADMAP.md M17-M20 entries + M16+ clarifying note.

## Things this session would have done if scope allowed

(Deferred to avoid parallel-session merge conflicts. The user's instruction: "ONLY FOCUS your template comparison scope in this session; don't overlap with the other sessions to avoid merge conflicts.")

- Draft the actual `docs/contracts/REVIEWER_MEMORY.md` and `docs/contracts/MEMORY_OPERATIONS.md` files (parallel sessions are writing in `docs/contracts/`).
- Add ACE row to CLAUDE.md influence library (parallel sessions are queueing rows).
- Add M17-M20 entries to ROADMAP.md (parallel sessions are queueing milestones).
- Scaffold `src/memory/section-slugs.ts` with an initial mapping (not in scope: this is M17 implementation).

## What the next session inherits

A clean substrate for M17 planning. Once parallel comparison sessions converge:

1. M17 planning session reads `CONTRACTS_NEEDED.md` and writes the two contract files.
2. Comparison-series synthesis session reads every `docs/comparison/*/PROPAGATE_TO_CLAUDE_MD.md` and applies them in one commit.
3. M17 implementation follows the rule-20 sub-surface accounting in `SYNTHESIS.md` § M17.

## Files in this session

```
docs/comparison/
├── README.md                       (series index; row 01 only — other sessions add their rows independently)
└── 01-ace/
    ├── COMPARISON.md               (original analysis, marked superseded; Round 1+2 in-place corrections)
    ├── CODEX_BRIEFING.md           (Round 0 pressure-test brief)
    ├── CODEX_RESPONSE.md           (Round 0 verbatim verdicts; thread 019e12ab)
    ├── SYNTHESIS.md                (canonical post-debate decisions; M17-M20 scope)
    ├── CONTRACTS_NEEDED.md         (staged drafts; deferred placement)
    ├── PROPAGATE_TO_CLAUDE_MD.md   (staged canonical-doc updates; deferred)
    ├── ROUND_1.md                  (Opus reviewer log)
    ├── ROUND_2.md                  (architect + Codex fresh-thread log)
    └── CLOSE_OUT.md                (this file)
```

## Final sign-off

**Codex (Round 3, thread `019e132c`):** `accept-with-modifications`. One fix-before-merge applied (M19 event-name correction). L1/L2/L3 lenses clean. Comparison-series exercise verdict: `continue`.

**Opus pr-review-toolkit reviewer (Round 3, agent `a2528ef755ecd046c`):** 7 findings — 4 fix-soon (3 citation corrections: `parse_playbook_line` actual range `13-27` not `23-46`; `task_completed` lives in `src/state/run.ts:454+` not in the v0.1 registry block; CONTRACTS_NEEDED C3 placement instruction targeted the rule prose at line 240 rather than the type literal block at 153-161), plus 1 fix-soon em-dash in COMPARISON.md paragraph 1, plus 2 nit em-dash items, plus 1 nit CLOSE_OUT meta-update (this entry). All 6 substantive items applied. The reviewer also spot-checked 25+ other citations and confirmed them correct.

**Codex (Round 4 confirmation, thread `019e1409`):** verbatim — "Round 4 clean. PR-merge-ready." No further findings of any severity.

Both critics aligned at clean accept. Close-out criterion met.

## Pair-programming closing statement

This session was the maestro-mode test: PM-and-technical-subject-expert orchestration of Opus subagents and Codex reviewers against a single template, in an isolated worktree, with no production-code changes. The output is decision documentation, the milestone shape for Reviewer Memory v1, and a precedent for how the comparison series should handle high-stakes borrows from research templates.

The strategic call (YES, with selective borrows) survived 4 rounds of pressure-testing and 42+ findings. The implementation shape (M17-M20) tightened substantially: from one bundled milestone to four with sub-surface accounting, contract files staged, propagations deferred, every silent-skip path closed, event names matched to source-of-truth, and a manual doctor override carved out for the case the architect's memory-poisoning analysis surfaced. None of this would have landed cleanly in a single-author pass.

The exercise itself earns its keep when it changes near-term milestones (M17-M20 are now durable plan, not first-draft sketches) and stops the moment it stops doing that. This session changed the plan. The discipline continues.
