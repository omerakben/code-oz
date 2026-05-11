# Codex pre-design memo — B3 parentTaskId hotfix

**Reviewer:** OpenAI Codex CLI, `gpt-5.5` xhigh, sandbox read-only.
**Thread:** `019e1318-9907-7640-8d99-905dca0b09cc`.
**Date:** 2026-05-10.
**Verdict:** `revise-and-implement` (Claude's mental model needed correction on file layout; design itself is sound).

> Codex was asked to write to this file but the read-only sandbox correctly rejected it. Verbatim memo below; saved here by Claude.

---

## Verdict

`revise-and-implement`.

## Field name

`parentTaskId` is the right name if the value is always the existing `T-NNN` task id. No conflict with `ProviderRequest`, whose optional fields are currently `model`, `maxOutputTokens`, `role` (`src/providers/types.ts:61`). Do not reuse `decisionId`; scheduler events use that as a ULID join key (`src/phases/review-scheduler-hook.ts:84`).

## Wrapper write site

Confirmed. `src/providers/invoke.ts` is the only `agent_invoked` / `agent_completed` writer (`src/providers/invoke.ts:123`, `src/providers/invoke.ts:266`). Use exactly `...(req.parentTaskId !== undefined ? { parentTaskId: req.parentTaskId } : {})` in both event objects, matching the `role` / cost spread pattern.

## Set sites — synthesis file list needs corrections

- **No `src/phases/debate-runtime.ts`.** Current debate runtime is `src/tools/debate-request.ts`.
- **Panel requests are not constructed in `review-panel.ts`.** `runReviewPanel` only has `opts.upstreamRefs.taskId` and calls `opts.panelistInvoker(...)` (`src/phases/review-panel.ts:358`). Add a third invoker context arg like `{ parentTaskId: opts.upstreamRefs.taskId }`, consumed where the real request is built in `productionPanelistInvoker` (`src/cli/production-seams.ts:558`).
- **Debate:** add optional `parentTaskId` to `DebateRequestInput`, pass it into both internal `ProviderRequest`s (`src/tools/debate-request.ts:533`, `src/tools/debate-request.ts:586`), and set it at the two REVIEW scheduler calls (`src/phases/review.ts:1270`, `src/phases/review.ts:2676`).
- `review-scheduler-hook.ts` only passes `taskId` into the executor (`src/phases/review-scheduler-hook.ts:493`); `review-fire-path.ts` is pure helpers/error mapping, not a request constructor (`src/phases/review-fire-path.ts:332`).
- `plan.ts` also calls `requestDebate`, but has no `T-NNN` task in scope, so omit it (`src/phases/plan.ts:318`).
- No build debate call found.

## Reducer

Prefer a separate `summarizeByParentTask(...)` in `src/providers/cost.ts`, not another field on `BudgetCounts`. `summarizeBudgetUse` is budget-enforcement plumbing with FIFO-by-phase pairing (`src/providers/cost.ts:114`); keeping parent rollup separate avoids running reporting logic on every budget check.

## Validator

Add optional `parentTaskId` to both `PhaseEvent` variants (`src/state/schemas.ts:442`, `src/state/schemas.ts:491`). In `events.ts`, validate when present against `TASK_ID_PATTERN` (`src/state/events.ts:66`) for both `agent_invoked` and `agent_completed`.

## Tests

Add schema tests in `tests/state-events-debate.test.ts`; wrapper pass-through in `tests/provider-invoke-role.test.ts` or a new parent-task file; parent rollup in `tests/providers-cost.test.ts`; production seam panel pass-through in `tests/cli-production-seams.test.ts`; debate pass-through in `tests/debate-request.test.ts`; one FakeProvider run assertion in `tests/cli-task-loop.test.ts` if full CLI coverage is desired.

## Forward compat

Optional field should not break existing readers. Validators do not reject unknown extra fields today, reducers ignore extra properties, and tests mostly assert event types or selected fields. One caution: existing `debateTopic` / `debateTurn` are schema-validated but not currently written by `ProviderRequest`, so do not rely on them for this hotfix.
