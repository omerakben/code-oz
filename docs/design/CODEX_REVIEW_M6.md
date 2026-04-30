# code-oz — M6 Codex implementation review

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-30
- **Branch:** `feat/m6`

Three review rounds. Final verdict: **`push`**. M6 is ready to tag.

## Round 1 — initial review on commit `abc1c7a`

- **Thread ID:** `019ddcc5-1583-7521-9280-a7c3f4e36ee7`
- **Verdict:** `fix-first`
- **Findings:** 5 block-push + 2 block-next-milestone

| # | Severity | Topic |
|---|---|---|
| 1 | block-push | PLAN + Scientist inlined artifact content into the prompt while passing `files: []` to `invokeAgent`, violating rule 13's manifest-as-audit-source invariant |
| 2 | block-push | PLAN orchestrator never dispatched repo-context tool_calls; the e2e even commented "real tool_use is M7+" |
| 3 | block-push | `intersectPermissions` let request roots replace agent roots (an agent scoped to `src` could request `tests`) |
| 4 | block-push | `parsePlan` accepted malformed `Hypotheses:` and `Sources:` entries; `validatePlanSourceCoverage` did not exist |
| 5 | block-push | Scientist phase-tail composed its prompt without `universal-rules.md`, violating rule 16 |
| 6 | block-next-milestone | `phases.scientist.retroSeedDefine` config key promised in the kickoff was missing from schema, defaults, and loader |
| 7 | block-next-milestone | `dispatchPlan` discarded the user's `--provider fake` override after DEFINE approval |

## Round 2 — re-review on commits `b0641a8` + `850298b`

- **Thread ID:** `019ddcd6-2c0d-79a3-8a97-4823469d5d6c`
- **Verdict:** `fix-first` (1 block-push remaining)

Findings 1, 2, 3, 5, 6, 7 closed. Finding 4 only partially closed: `validatePlanSourceCoverage` accepted task ids only, so it could not detect (a) a PLAN task citing an undeclared `Sources: SC-...-999` id, nor (b) a divergence between a PLAN task's `Sources:` bullet and its row in `SOURCE_CHECK.md ## Coverage`. Codex reproduced the gap with a fixture.

## Round 3 — re-review on commit `70d7d19`

- **Thread ID:** `019ddcdc-7088-7a02-adf7-9e734485687a`
- **Verdict:** `push`

> push. Finding #4 is closed. I found no remaining block-push or block-next-milestone issue in `70d7d19`.

`validatePlanSourceCoverage` now takes the full `PlanTaskCoverageInput[]` carrying each task's `id` + `sources`, rejects undeclared Sources ids, and enforces set-equality between PLAN per-task Sources and the same task's Coverage row. Two regressions added.

## Acceptance gate at tag time

- All 542 M5 tests still pass; new M6 tests bring the total to **783** (target was ~700+).
- `bun run typecheck` clean.
- `bun run build:binary` produces a working `dist/code-oz` reporting `0.6.0-alpha.0`.
- The 14-commit substrate-first sequence is intact (no amends, no rebases). Two follow-up fix commits (`b0641a8`, `850298b`) plus one tightening commit (`70d7d19`) closed every Codex finding.
- `code-oz init` + a programmatic DEFINE → approve → PLAN → approve flow against the `tests/fixtures/greenfield-baby-name/` fixture is exercised by `tests/e2e/plan-greenfield.test.ts`.
- `code-oz doctor tools` reports `rg` status.
- Codex implementation review returns `push` after three rounds; all `block-push` and `block-next-milestone` findings closed before tagging (per CLAUDE.md rule 8 + the user's "no tech debt at milestone close" memory).

## What this rule is doing

Rule 8 ("Codex review at implementation completion") fired three times in this session:

1. The first round caught seven real issues — the rule-13 manifest violation in particular would have been a silent corruption class hiding behind passing tests, because the audit invariant lives in the manifest, not in the model behavior.
2. The second round caught a partial fix (cross-check accepting task ids only).
3. The third round confirmed closure.

The author kept the locked 14-commit sequence intact and added three follow-up commits (`b0641a8`, `850298b`, `70d7d19`) to close findings, mirroring the M5 fix-first pattern. No commits were amended or rebased; each one stands alone in `git log`.
