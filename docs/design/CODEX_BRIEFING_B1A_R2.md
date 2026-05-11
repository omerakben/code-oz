---
name: CODEX_BRIEFING_B1A_R2
status: pending-invocation
review-round: R2 (narrow doc/comment drift verification per R1 sign-off)
codex-model: gpt-5.5
codex-effort: xhigh
sandbox: read-only
date: 2026-05-12
worktree: .claude/worktrees/aris-borrows-pre-m17
branch: worktree-aris-borrows-pre-m17
prior-rounds:
  - 019e1318 (pre-design — 4 bugs closed)
  - 019e17f8 (R0 — 1 block-push + 6 fix-soon closed)
  - 019e1807 (R1 — 6 doc/comment drift sites flagged, runtime verified)
target-commit: 0595a99 (R1 closure follow-up)
---

# Codex R2 briefing — B1a Commit 2 narrow drift verification

R1 verdict was fix-first with the specific instruction: "Runtime replay can merge after that cleanup and a final narrow R2 check." R2 verifies the 6 doc/comment drift sites are now resolved without introducing new contradictions.

## What changed since R1 (commit `0595a99`)

Six sites closed in commit `0595a99`:

| R1 finding | File | Change |
|---|---|---|
| F4 partial | `src/state/run.ts:233-244` (was :237) | `originalBudgets?` JSDoc rewritten: emission conditional, CLI always supplies both |
| F4 partial | `src/state/schemas.ts:1442-1461` (was :1449) | Event-union header: "Recording is conditional"; replay reads `effectiveBudgets` directly |
| F6 partial | `src/state/schemas.ts:1456` | Parenthetical "optional `byRole`" replaced with "`byRole` lives NESTED under `global`" |
| F6 partial | `src/state/events.ts:2199` | Validator comment: `byRole` nested under `global`, not top-level |
| F6 partial | `docs/design/B1A_EFFORT_FLAG.md:116` | Touchlist item 6 corrected to `{ global, perPhase }`; `byRole` nested |
| Missed angle | `docs/design/B1A_EFFORT_FLAG.md:118` | Touchlist item 8 corrected: replay reads recorded `effectiveBudgets` directly (was "re-applying applyEffort()") |

Tests: 3163 pass, 0 fail, 1 skip (unchanged from R1). Typecheck clean.

R2 review trail target paths:
- `docs/design/CODEX_BRIEFING_B1A_R1.md`
- `docs/design/CODEX_RESPONSE_B1A_R1.md`

## R2 debate prompts (narrow)

### (1) Are the 6 R1 closure sites clean and correct?

Spot-check each site. Specifically:
- Is the `originalBudgets?` JSDoc clear about WHEN no event fires (only when BOTH inputs are omitted)?
- Does the schema-header comment now correctly describe both: (a) replay reads `effectiveBudgets` directly, (b) recording is conditional on budgets being supplied?
- Are the four `byRole` mentions consistently nested-under-global across schemas.ts, events.ts, and B1A_EFFORT_FLAG.md?
- Does B1A_EFFORT_FLAG.md:118 now match the actual implementation (replay reads `effectiveBudgets`, not re-applies `applyEffort`)?

### (2) New contradictions introduced?

Did the R1 closure edits introduce any new contradictions elsewhere? In particular:
- Does the new comment text in `src/state/schemas.ts` still match the JSDoc on the event-union members?
- Does the touchlist item 8 update in `B1A_EFFORT_FLAG.md` flow logically with the rest of the doc?

### (3) Anything still drifted?

Grep the worktree (excluding the deliberate "renumbered from rule 22" provenance notes and the briefing/response files for prior rounds) for:
- `unconditional` (B1a context)
- `top-level` + `byRole` (excluding the corrected mentions)
- `re-appl` + `applyEffort` (excluding `applyRecordedEffort` and `applyEffort()`-the-function context)
- `tests/cli-effort-envelope` (un-prefixed path; should all be `tests/e2e/`)

Report any matches that contradict the current contract.

## Acceptance for advancing past R2

- Verdict: `push` (ready to merge to local main) or `fix-first` (more closures).
- This is intended to be the FINAL round on this commit pair. If `fix-first` again, the merge to local main blocks until cleared.

## How to invoke

Standard: `gpt-5.5` xhigh, sandbox read-only, this worktree.
