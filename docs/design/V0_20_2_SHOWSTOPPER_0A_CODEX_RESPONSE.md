# Codex response — v0.20.2 showstopper #0a debate

**Codex thread:** `019e281e-d4db-7700-869c-cf3f05b0ea31`
**Model:** gpt-5.5 xhigh
**Sandbox:** read-only
**Date:** 2026-05-14

This document captures Codex's structured response to `V0_20_2_SHOWSTOPPER_0A_BRIEFING.md`. The "Locked decisions" block at the end is the implementation contract.

## Prompt 1 — TASK_BLOCK content surface

**Recommendation:** Hybrid A+bugfix. Render `id`, `title`, authoritative `fileChanges`, verbatim `validation`, verbatim `risk`, and optional `bugfix.existingTest`. Omit `hypotheses` and `sources` from the BUILD prompt.

**Reasoning:** The builder's consumer need is patch scope plus validation, not audit provenance. Hypotheses and source ids are PLAN/Scientist/REVIEW evidence surfaces. Source ids without `SOURCE_CHECK.md` content are low-value and can invite source-citation noise. `bugfix.existingTest` is load-bearing because the builder must reuse the existing failing test and not "helpfully" add or edit it unless it is also in `Files`.

**Prevents:** A bugfix BUILD that modifies the reproduction test because the test path was hidden in `Validation:` but absent from `Files:`.

**Acceptance test:** A PlanTask with `bugfix.existingTest` renders `- Bugfix: tests/x.test.ts`. A PlanTask with hypotheses/sources does not render those ids in the BUILD task block.

## Prompt 2 — Placement in the template

**Recommendation:** Option α — between `## Your identity` and `## Common rationalizations`, with the header `## Task` and one sentence: "These are input constraints from the approved PLAN task; do not author these fields."

**Reasoning:** Preserves current template order and avoids placing task fields directly beside `## What the orchestrator authors`, where `Validation` and report fields can blur. Gives the model identity first, then assignment, then anti-rationalization and protocol constraints. Recency can be handled by `## Scope discipline` continuing to say "one task only."

**Prevents:** The model emitting `## Validation` or BUILD_REPORT-like fields because the task block is visually adjacent to orchestrator-owned output fields.

**Acceptance test:** Assert `## Task` appears after `## Your identity` and before `## Common rationalizations`.

## Prompt 3 — Serialization shape

**Recommendation:** Canonical Markdown task block matching PLAN.md's existing H3-plus-bullets grammar — `### T-001: title`, `- Files: path (added)`, `- Validation: ...`, `- Risk: ...`, optional `- Bugfix: ...`. NOT YAML, NOT JSON.

**Reasoning:** Plain Markdown is stable enough for substring/order tests and avoids JSON/YAML escaping rules that do not buy a machine consumer. No bold-label prose. No fenced JSON.

**Prevents:** A validation command containing backticks, quotes, or shell syntax being altered by JSON/YAML serialization assumptions.

**Acceptance test:** Exact small renderer test for a single PlanTask canonical block, not a full prompt snapshot.

## Prompt 4 — System vs user role for TASK_BLOCK

**Recommendation:** For v0.20.2, treat TASK_BLOCK as persistent task context inside the composed prompt (current single-blob shape). Pushback on the brief's framing — `ProviderRequest` does not split into system/user roles today.

**Reasoning:** Claude/Codex receive stdin; xAI renders a single user message. There is no system/user role split in production. For #0b, if roles are introduced later, the task must live in persistent per-task context (system-equivalent), not a transient user turn that disappears after tool results. Do not design v0.20.2 tests around role semantics the provider layer does not implement.

**Prevents:** A false green design where the unit test says "system message" but production sends a single user/stdin blob and future tool turns lose the task.

**Acceptance test:** Current prompt snapshot includes the task before invocation. #0b later proves the task remains available after a tool-result continuation.

## Prompt 5 — Required vs optional `task` parameter

**Recommendation:** `task` is required in both `ComposeBuildPromptPureInput` and `ComposeBuildPromptInput`.

**Reasoning:** BUILD without a selected PlanTask is invalid by construction. Production blast radius is small (one real call site plus prompt tests). An optional placeholder recreates the exact silent failure this showstopper is closing.

**Prevents:** A future caller composing a valid-looking BUILD prompt with no task context.

**Acceptance test:** `bun run typecheck` fails until all `composeBuildPrompt` callers pass a PlanTask, and the missing `{{TASK_BLOCK}}` token throws at runtime.

## Prompt 6 — Test discipline

**Recommendation, minimum:** Four tests cover the surface:

1. Renderer content (id + every fileChanges entry + verbatim validation + verbatim risk + optional bugfix when present).
2. Required-token failure (template missing `{{TASK_BLOCK}}` throws at compose time).
3. Template placement (`## Task` between `## Your identity` and `## Common rationalizations`).
4. Build-phase wiring (capture the rendered prompt that production `runBuild` sends to the provider; assert task content appears).

**Reasoning:** The handoff's content-only test is necessary but not sufficient — it would not catch a missing token requirement, wrong template placement, or `build.ts` failing to pass `planLoad.task`. Avoid full prompt snapshots because universal-rules/persona prose churn will make them noisy. Parser re-readability is overkill unless a later machine consumer is introduced.

**Maximum worth writing:** Add optional bugfix rendering coverage, selected-task-not-other-task wiring (assert T-001 appears, T-002 doesn't), and the dogfood smoke for run `01KRKW0D94C3F80002CSAR29NT` outside the prompt unit suite.

**Prevents:** Passing `composeBuildPromptPure` tests while production BUILD still invokes the builder with no selected task.

## Prompt 7 — Second-order risks

**Recommendation:** Accept the fix with three mitigations:

1. Use A+bugfix to control token bloat (~150-250 tokens, not Option C's ~1500).
2. Label TASK_BLOCK as "input constraints from the approved PLAN task" (helps the model not echo Validation/Risk as if it were authoring them).
3. Update TRUST.md to document that approved PLAN task fields (Validation, Risk) are sent to the BUILD provider — not just local artifact content.

**Reasoning:** Secret exposure is not fully covered by current TRUST wording. `Validation:` and `Risk:` become provider prompt content for BUILD. Do not redact the task block (validation must be verbatim), but document that PLAN authors must use env var names, not literal secrets. Also update prompt-snapshot tests/comments that currently describe determinism as only agentBody/readySignal/tools — task is now part of the prompt input.

**Prevents:** A lite-effort run wasting budget on PLAN excerpts; a user assuming `Validation: curl -H "Authorization: Bearer literal"` stays local.

**Acceptance test:** Task block contains no PLAN excerpt; prompt snapshot for T-001 contains `T-001` and not `T-002`.

## Prompt 8 — Anything I missed

**Recommendation:** Add one explicit dependency note — #0a assigns the task, but does not by itself provide file contents.

**Reasoning:** Production `productionInvokePersona` defaults `files: []` for BUILD. #0b owns the tool-use loop. For scaffold-only tasks, TASK_BLOCK may be enough (the builder creates a NEW file from intent, no need to read). For modification tasks, the builder still needs repo-context tool continuation or an explicit selected-file manifest. The dogfood acceptance "builder emits a patch" should be scoped to tasks that need no read, or marked dependent on #0b / file-manifest work.

**Prevents:** Declaring #0a fixed after the prompt contains `T-001` while the builder still cannot inspect `src/version.ts` or adjacent code.

**Acceptance test:** Dogfood smoke must assert either tool-use/file manifest supplied the needed file context, or the task is genuinely scaffold-only.

## Locked decisions (paste into implementation PR description)

```text
- Add `{{TASK_BLOCK}}` to `src/prompts/build-system.md` and `BUILD_REQUIRED_TOKENS`.
- Insert `## Task` after `## Your identity` and before `## Common rationalizations`.
- Render TASK_BLOCK as canonical PLAN-style Markdown: `### T-NNN: title`, `Files`, `Validation`, `Risk`, optional `Bugfix`.
- Use `task.fileChanges` as the authoritative file surface; include every path and change kind.
- Do not render `hypotheses`, `sources`, `startLine`, or a verbatim PLAN.md excerpt in BUILD.
- Make `task: PlanTask` required for both pure and async BUILD prompt composers.
- Wire `runBuild` to pass `planLoad.task` into `composeBuildPrompt`.
- Tests must cover content, missing token, placement, and production wiring through captured/persisted prompt text.
- Document that #0a supplies task context only; file-read context remains #0b or manifest scope.
```

## Notes from this debate

1. Codex could not find `docs/handoffs/2026-05-14-v0.20.2-bug-free-handoff.md` in the read-only sandbox because that file is on branch `docs/v0.20.2-bug-free-handoff`, not on `main` or this debate branch. The brief was self-contained, so the debate proceeded without it. The implementation should land on a separate `feat/v0.20.2-build-task-block` branch off main.

2. Codex's pushback on Prompt 4 framing is important — the brief assumed a system/user role split. Production today is single-prompt. The debate brief for #0b should NOT assume role separation exists; it should evaluate whether to introduce roles as part of the tool-use loop or to keep single-prompt and inject TASK_BLOCK once per BUILD call.

3. The TRUST.md mitigation in Prompt 7 is a real new constraint. It should land in the same PR as the #0a implementation (one logical change: "BUILD prompt now contains PLAN task content; document the implication for users").
