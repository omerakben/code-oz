# Codex final review - byterover-cli landing batch

**Date:** 2026-05-10
**Reviewer:** Codex
**Branch:** `feat/byterover-09-borrows`
**Base:** `origin/main` at `0dce4b0`

## Verdict

`fix-first` (fixed in-place; no remaining blocker found after `fcd4bfb`)

I read the actual patch for each requested commit with `git show e672e9b`, `git show 57a1456`, `git show aae1e7b`, and `git show a0d377e`. The implementation is aligned with the locked B3 design after one reducer fix and one SYNTHESIS shipped-scope correction.

## Severity table

| ID | Severity | Finding | Status |
|---|---|---|---|
| F1 | block-push | `summarizeByParentTask` queued only parented invocations, so an unparented completion in the same phase could consume the later parented queue head and over-attribute cost. | Fixed in `src/providers/cost.ts`; regression added in `tests/cost-by-parent-task.test.ts`. |
| F2 | nit | `SYNTHESIS.md` final landing plan still named nonexistent `src/phases/debate-runtime.ts`, claimed README index work that did not ship, and overstated tests for B3. | Fixed in `docs/comparison/09-byterover-cli/SYNTHESIS.md`. |

## Findings

### F1 - Parent-task rollup mispaired mixed same-phase events

The new reducer said it mirrored `summarizeBudgetUse` FIFO-by-phase pairing, but it skipped unparented `agent_invoked` rows entirely before queueing. That meant a same-phase trace like unparented invoke, parented invoke, unparented complete, parented complete would assign the unparented completion's `tokensUsed` to the parent task. The fix queues every invocation and only counts tokens/calls when the queued head has a `parentTaskId` (`src/providers/cost.ts:992`). The regression at `tests/cost-by-parent-task.test.ts:126` failed red before the code change and passes now.

### F2 - SYNTHESIS shipped-scope drift

`SYNTHESIS.md` still had pre-design residue in the final landing plan: `src/phases/debate-runtime.ts` and a `docs/comparison/README.md` update. The branch actually shipped `src/tools/debate-request.ts` plus the panel invoker injection path, and intentionally avoided the README to prevent cross-session collision. I corrected the shipped file list and test description at `docs/comparison/09-byterover-cli/SYNTHESIS.md:124`.

## Design checks

B3 matches the locked pre-design memo:

- `ProviderRequest.parentTaskId` exists and is optional at `src/providers/types.ts:88`.
- Both `agent_invoked` and `agent_completed` schema variants carry optional `parentTaskId` at `src/state/schemas.ts:490` and `src/state/schemas.ts:523`.
- The wrapper writes through using the requested spread pattern on both events at `src/providers/invoke.ts:150` and `src/providers/invoke.ts:289`.
- The validator accepts omission and enforces `^T-\d{3,}$` when present at `src/state/events.ts:300`, `src/state/events.ts:335`, and `src/state/events.ts:2245`.
- `summarizeByParentTask` is separate from `summarizeBudgetUse` at `src/providers/cost.ts:989`.
- REVIEW debate fire paths set `parentTaskId` at `src/phases/review.ts:1290` and `src/phases/review.ts:2700`.
- REVIEW panel uses the invoker context seam at `src/phases/review-panel.ts:109` and `src/phases/review-panel.ts:377`, consumed by `productionPanelistInvoker` at `src/cli/production-seams.ts:570`.
- The synthetic opposing debate turn carries `parentTaskId` while still omitting `role` at `src/tools/debate-request.ts:540`; synthesis carries both caller role, when canonical, and the same parent at `src/tools/debate-request.ts:604`.

Rule 22 and builder wording are aligned:

- CLAUDE status is refreshed to v0.17 / 3128 offline tests at `CLAUDE.md:9`.
- Rule 22 consolidates B1+B4 and cross-references `src/agents/defaults/builder.md` at `CLAUDE.md:45`.
- The byterover-cli influence-library row is present at `CLAUDE.md:69`.
- Builder RED-first detail includes the 5-step order and "If you catch yourself..." framing at `src/agents/defaults/builder.md:59`.

SYNTHESIS records the seven resolved decisions and the shipped four-commit scope at `docs/comparison/09-byterover-cli/SYNTHESIS.md:170`. It still mentions `code-oz consult` only inside the F1 historical error report at `docs/comparison/09-byterover-cli/SYNTHESIS.md:20`; the accepted future shape is `tool_use.repo_context.tools += 'search'`, not an invented consult surface.

## Compatibility and trust boundary

I do not see a forward-compat break. The new field is optional, existing tests assert event types or selected fields, and the branch adds an explicit omission test at `tests/provider-invoke-parent-task-id.test.ts:108`. A future strict full-object fixture for parented REVIEW panel/debate events must include `parentTaskId`; that is expected, not a break.

I do not see an unsanitized trust-boundary issue. `parentTaskId` is sourced from existing task IDs, the PLAN/CLI surfaces enforce the `T-NNN` grammar, and `appendEvent` validates before write. It is not sent to adapters because `PreparedProviderRequest` does not include the field (`src/providers/types.ts:126`).

## Validation

- Targeted RED check: `bun test tests/cost-by-parent-task.test.ts` failed before the reducer fix for the new mixed same-phase regression.
- Targeted GREEN check: `bun test tests/cost-by-parent-task.test.ts` passed after the fix.
- Full suite: `bun test` passed, `3129 pass`, `1 skip`, `0 fail`.
- Typecheck: `bun run typecheck` exited 0.
- Whitespace: `git diff --check` clean.

## Open questions

None.

## Reframes

None.

## Final commits after this review

- `fcd4bfb fix(cost): repair parentTaskId rollup pairing (Codex round 3 closure)`
- `docs(comparison): add Codex final review (Codex round 3 closure)` (this file's commit)
