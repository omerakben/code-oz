---
name: implementation-plan-06-codegraph
companion: COMPARISON.md, CODEX_RESPONSE.md (this folder)
target: implement Codex-aligned borrows from codegraph comparison; reach Claude+Codex `push` verdict
status: in-progress
branch: worktree-feat+comparison-codegraph
baseline-tests: 3108 pass / 0 fail (verified 2026-05-10)
---

# Implementation plan — codegraph borrows

## Scope

Land the three Codex-aligned borrow decisions from `CODEX_RESPONSE.md`:

- **B1** — Contract cleanup (Option D-reserved): tighten the `'symbol'` slot in `RepoContextToolName` so it is reserved-but-not-permissionable. Reject at config-load AND at runtime with typed `tool_unavailable`. Document the reservation and the 4-condition AND reopen telemetry signal.
- **B2** — Three-case deterministic evaluation harness for repo_context tools. Discovery + usage + budget pressure. Recall@k + bytes + tool-call counts. No LLM-judged path in default CI. New `bun run eval:repo_context` script.
- **B5** — Reclassify framework-aware route detection from no-borrow to deferred-with-trigger. ROADMAP entry.

Plus: full offline tests pass, two Codex review rounds (R1 + R2 minimum) reaching `push`, PR up.

## Locked decisions (from CODEX_RESPONSE.md)

1. **D-reserved over D-strict.** Keep `'symbol'` in `RepoContextToolName` so the schema slot is preserved for the telemetry-gated reopen. Reject it explicitly at config-load via `validateRepoContext` and at runtime via `intersectPermissions`. New error code `schema_reserved_tool` at config layer; existing `tool_unavailable` at runtime layer.
2. **Three eval cases, not seven.** Discovery + usage + budget pressure. Each fixture is a synthetic temp-repo built per-test (mirrors existing `tests/repo-context-*.test.ts` pattern). Each fixture asserts: recall@k for expected files, total `resultBytes`, total `resultTokensEstimate`, tool-call count, selected-path count (`maxFilesForNextManifest`), truncation flag. No LLM is called; the harness is pure deterministic functional measurement of `glob`/`grep`/`read`.
3. **No LLM-judged path in default CI.** Optional/manual harness can be added later; out of scope here.
4. **B5 reclassified up.** Update ROADMAP W3 section to list "deferred-with-trigger: framework-aware route detection — land if routing/API-surface audit persona enters company roster (W4 candidate)."
5. **Reopen telemetry signal locked at 4-condition AND.** All four must fire on three runs across two repos. Documented in REPO_CONTEXT.md § "Reservation and reopen-the-slot signal."

## Files to change

### B1 contract cleanup

| File | Change |
|---|---|
| `src/agents/schema.ts` | Add `RESERVED_REPO_CONTEXT_TOOLS = ['symbol'] as const` constant; modify `validateRepoContext` to reject any tool name in `RESERVED_REPO_CONTEXT_TOOLS` with new code `'schema_reserved_tool'`. |
| `src/agents/errors.ts` (or schema.ts where AgentLoadIssue codes live) | Add `'schema_reserved_tool'` to the issue-code union if not already there. |
| `src/tools/repo-context/types.ts` | JSDoc on `RepoContextToolName` clarifying `'symbol'` is reserved-but-not-permissionable; doc anchor to REPO_CONTEXT.md § Reservation. |
| `src/tools/repo-context/permissions.ts` | Defensive runtime check: if `request.tool === 'symbol'`, throw `RepoContextError` with code `'tool_unavailable'`. |
| `src/tools/repo-context/runner.ts` | Update inline comment to point at the new defensive guarantee. |
| `src/prompts/index.ts:231` | Update `TOOL_DESCRIPTIONS.symbol` to reflect reservation status and link the doc anchor. |
| `docs/contracts/REPO_CONTEXT.md` | Replace § "`symbol` (optional in M6, deferred)" with § "Reservation and reopen-the-slot signal." Codify the 4-condition AND. |

### B1 tests

| File | Coverage |
|---|---|
| `tests/agents-schema-symbol-reservation.test.ts` | Config-load rejects any agent declaring `'symbol'` in `tool_use.repo_context.tools[]`. |
| `tests/repo-context-permissions-symbol-reservation.test.ts` | Defense-in-depth: even if `'symbol'` somehow makes it past config load, `intersectPermissions` rejects it with `tool_unavailable`. |
| `tests/repo-context-prompts-symbol-reservation.test.ts` (or extend an existing prompts test) | The `TOOL_DESCRIPTIONS.symbol` text reflects RESERVED status. |

### B2 eval harness

| File | Purpose |
|---|---|
| `scripts/eval-repo-context.ts` | Runner: instantiates synthetic temp-repo per case, drives `runRepoContextTool`, computes recall@k + budget metrics, prints JSON report, exits non-zero on regression. |
| `tests/evaluation/repo-context/case-01-discovery.ts` | Fixture: 12 files in synthetic repo; expected discovery set of 4. Asserts recall@4 = 1.0, total bytes ≤ 64 KB. |
| `tests/evaluation/repo-context/case-02-usage.ts` | Fixture: caller graph (5 callers of one symbol). Broad grep query. Asserts recall@5 = 1.0 without hitting `maxResults`. |
| `tests/evaluation/repo-context/case-03-budget-pressure.ts` | Fixture: 30 candidate files. Pattern matches 12. Asserts selected-path count ≤ `maxFilesForNextManifest`, total result-bytes ≤ `maxBytesPerResult × maxResults`, recall@k ≥ 0.8 within budget. |
| `tests/evaluation/repo-context/runner.test.ts` | Vitest/bun-test wrapper that runs all three cases as a deterministic regression suite (so they execute in `bun test` AND in `bun run eval:repo_context`). |
| `package.json` | Add `eval:repo_context` script. |

### B5 + ROADMAP

| File | Change |
|---|---|
| `docs/design/ROADMAP.md` | W3 section: replace "Optional `symbol` LSP integration..." line with "Deferred-with-trigger items" subsection enumerating B1 reopen telemetry signal + B5 framework-aware route detection. |

## Test invariants (must hold at every commit)

1. `bun test` passes offline. Baseline 3108; after B1 + B2 expect 3108 + ~6 (B1 reservation + 3 eval cases + 1 runner wrapper + 1 prompts test).
2. `bun run typecheck` clean.
3. No emoji in any code or doc.
4. No `Co-Authored-By: Claude` footers in commit messages.
5. No write to `docs/comparison/06-codex/`, `07-*/`, `08-*/`, `09-*/`, `10-*/`, `11-*/`, or `docs/comparison/README.md` (those belong to parallel sessions).

## Commit sequence

1. **`docs(comparison): add codegraph head-to-head and Codex debate record`** — bring the three comparison docs (COMPARISON.md, CODEX_BRIEFING.md, CODEX_RESPONSE.md) and this IMPLEMENTATION_PLAN.md into the branch.
2. **`fix(repo_context): tighten symbol slot to reserved-but-not-permissionable`** — B1 contract cleanup + tests + REPO_CONTEXT.md addendum.
3. **`feat(eval): add three-case deterministic repo_context evaluation harness`** — B2 harness + bun-test wrapper + package.json script.
4. **`docs(roadmap): reclassify route detection to deferred-with-trigger`** — B5 reclassification + W3 section update.

## Codex review rounds

After commit 4, dispatch Codex R1 review on the head commit. Expected verdicts and responses:

- `push` → done, open PR.
- `fix-first` (block-push or block-next-milestone) → fix in commit 5+, dispatch R2.
- `fix-first` (fix-soon / nit) → close findings in commit 5+, dispatch R2 confirming closure.
- `debate-required` → record debate in CODEX_R2_DEBATE.md, synthesize, fix.

Two-round target. R1+R2 must converge to `push`.

## Out of scope (explicitly)

- Implementing the actual `'symbol'` backend (Option A/B/C). The whole point of this work is that the slot stays reserved.
- B3 MCP-consume path implementation. Wrapping spec recorded in COMPARISON.md only.
- Updating `docs/comparison/README.md` to reflect post-implementation status (parallel sessions own that file; let Ozzy reconcile on merge).
- Touching any other comparison folder.
- Touching `events.jsonl` event-projection code that allows `tool: 'symbol'` (must remain in the union for backward-compat in case any historical event is replayed; new events cannot get `'symbol'` because the gates above prevent it).
