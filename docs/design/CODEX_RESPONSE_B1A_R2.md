---
name: CODEX_RESPONSE_B1A_R2
status: closed
review-round: R2 (narrow doc/comment drift verification)
codex-model: gpt-5.5
codex-effort: xhigh
sandbox: read-only
thread-id: 019e1810-6c79-7e13-844f-5a0127547b8e
date: 2026-05-12
verdict: push
briefing: docs/design/CODEX_BRIEFING_B1A_R2.md
target-commit: 0595a99 (R1 closure follow-up)
---

# Codex R2 response — B1a Commit 2 narrow drift verification

## Verdict
push

## (1) R1 closures verified
- clean: `src/state/run.ts:211-226`, `src/state/run.ts:235-245` now states emission is conditional, no event is appended when both budget snapshots are omitted, CLI fresh runs always supply both, and one supplied snapshot defaults the other.
- clean: `src/state/schemas.ts:1442-1454` now says active-run replay reads `effectiveBudgets` directly and recording is conditional on budgets being supplied.
- clean: `src/state/schemas.ts:1456-1461`, `src/state/schemas.ts:1473-1477` now says top-level snapshot shape is `{ global, perPhase }`, with `byRole` nested under `global`.
- clean: `src/state/events.ts:2195-2201` now says validator checks `global` + `perPhase`; `byRole` is nested under `global`, not top-level.
- clean: `docs/design/B1A_EFFORT_FLAG.md:116` now says `*Budgets` contains `global` and `perPhase`, with `byRole` nested under `global`.
- clean: `docs/design/B1A_EFFORT_FLAG.md:118` now says replay uses recorded `effectiveBudgets` directly and explicitly does not re-apply `applyEffort` to current config.

## (2) New contradictions
none

The new schema-header text matches the event member JSDoc. The design doc's item 8 also matches the implementation in `src/commands/run.ts:635-669`, where `applyRecordedEffort` replaces `config.budgets` with recorded `effectiveBudgets`.

## (3) Remaining drift
- `unconditional`: only unrelated `phase_entered(ship)` hits in `src/state/run.ts:554` and `src/state/run.ts:1300`. No B1a envelope drift.
- top-level `byRole`: only corrected nested-under-`global` statements or legitimate `budgets.global.byRole` references. No stale top-level payload claim.
- `re-applying applyEffort` in design docs: only negated corrections at `docs/design/B1A_EFFORT_FLAG.md:78` and `docs/design/B1A_EFFORT_FLAG.md:118`. No old positive replay claim remains.
- bare `tests/cli-effort-envelope.test.ts`: none in target docs. Historical matches remain only in prior-round review trail files, which are excluded by the R2 briefing.

## Sign-off
verdict: push

commit 0595a99 is ready for merge to local main.
