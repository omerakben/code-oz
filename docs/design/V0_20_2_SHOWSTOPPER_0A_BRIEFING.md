# Codex briefing — v0.20.2 showstopper #0a (BUILD prompt has no TASK_BLOCK injection)

**Date:** 2026-05-14
**Author:** Maestro (Opus 4.7) under Ozzy oversight
**Codex model:** gpt-5.5 xhigh, sandbox read-only
**Companion thread:** showstopper #0b debates the tool-use loop (separate brief)

## Goal of this debate

Pressure-test the fix shape for v0.20.2 finding #0a before any code lands. The handoff (`docs/handoffs/2026-05-14-v0.20.2-bug-free-handoff.md` § "Showstopper #0a") proposes one specific shape. This brief surfaces alternatives and asks Codex to challenge the recommended shape against the alternatives, flag second-order bugs, and confirm or refute the test discipline.

## The bug, verified

`src/prompts/build-system.md` has 5 substitution tokens: `{{UNIVERSAL_RULES}}`, `{{AGENT_BODY}}`, `{{COMMON_RATIONALIZATIONS}}`, `{{AVAILABLE_TOOLS}}`, `{{READY_SIGNAL}}`. There is no slot for per-task PLAN.md content (Files / Validation / Risk / Hypotheses / Sources from the T-NNN block).

`src/prompts/index.ts:298-329` (`composeBuildPromptPure`) and `:337-351` (`composeBuildPrompt`) accept `agentBody` + `readySignal` + `availableTools` only. `ComposeBuildPromptInput` has no `task` field.

`src/phases/build.ts:362` (`loadPlanAndSelectTask`) loads the task into the orchestrator for its own use (validation command, planSha) but never threads it into the prompt going to the builder Opus.

### Proof (v0.20.2 prdiff dogfood)

`build-attempt-1.prompt.txt` from run `01KRKW0D94C3F80002CSAR29NT`: 252 lines, contains no `prdiff`, no `Scaffold`, no `src/version.ts`, no `T-001` outside an example placeholder in the persona prompt. The `agent_invoked` event for the builder records `filesSent: 0, bytesSent: 0`. Builder Opus correctly refused per rule 1 + rule 8 ("no claims you haven't verified"), emitting `NEEDS_INTERVENTION.json` with code `build_persona_protocol_violation`. Same failure on three separate retries against both v0.20.0 binary and v0.20.1 dev source.

## Constraints (non-negotiable)

1. **Rule 22 (TDD):** RED test first, watch it fail for the right reason, then minimal implementation.
2. **Rule 1 (file-based gate signals):** the orchestrator never trusts LLM text for pass/fail. TASK_BLOCK content is authored from the parsed `PlanTask`, not from the persona's reading of PLAN.md.
3. **Rule 7 (artifact contracts in plain Markdown):** inter-phase handoffs use Markdown. TASK_BLOCK is rendered into the system prompt, which is itself Markdown — but the question of serialization shape (Markdown body vs YAML frontmatter vs fenced JSON block) is open.
4. **Rule 22 (consumer-first):** the consumer is the builder Opus's first message. Define the minimal token surface it needs, then implement the renderer.
5. **CLAUDE.md project § "Architecture locks":** state model is "Markdown + YAML frontmatter (agent-skills schema)" — there is project precedent for both shapes.
6. **No new gate authority** (rule 20). This fix changes prompt assembly, not gate semantics.
7. **`SPEC.md` / `PLAN.md` are SHA-bound at approval** (TRUST.md § "SHA-256-bound approvals"). TASK_BLOCK is derived from the same parsed PlanTask the gate signed off on, so source-of-truth is preserved.

## Acceptance criteria

1. `composeBuildPromptPure({ ..., task: <PlanTask> })` produces a string containing the task's `id`, every entry in `task.files`, the verbatim `task.validation`, and the verbatim `task.risk`.
2. On the paused prdiff run `01KRKW0D94C3F80002CSAR29NT`, after applying the fix, builder Opus emits `<build-ready/>` plus a unified-diff patch for T-001 against the worktree (this is the dogfood-passes gate from the handoff).
3. No regression in any existing `composeBuildPrompt` test.
4. `BUILD_REQUIRED_TOKENS` grows by one entry (`TOKEN_TASK_BLOCK`); `composeBuildPromptPure` throws when the template is missing it.

## Recommended fix shape (handoff's locked baseline)

From the handoff:

1. **Template edit** (`src/prompts/build-system.md`): add a new section `## Task` with the substitution token `{{TASK_BLOCK}}` after the agent-body section, before the rationalizations.
2. **Renderer edit** (`src/prompts/index.ts`):
   - Add `const TOKEN_TASK_BLOCK = '{{TASK_BLOCK}}'`.
   - Add it to `BUILD_REQUIRED_TOKENS`.
   - Add `task: PlanTask` to `ComposeBuildPromptPureInput` and `ComposeBuildPromptInput`.
   - Render the task block with id, files, validation, risk, hypotheses, sources in a stable Markdown shape; replace `TOKEN_TASK_BLOCK` with the rendered string.
3. **Wiring edit** (`src/phases/build.ts:423`): pass `task: planLoad.task` into `composeBuildPrompt(...)`.
4. **RED test** (`tests/prompts/compose-build-prompt.test.ts`): assert the rendered prompt contains task id + every files entry + verbatim validation + verbatim risk.

## Debate prompts

### Prompt 1 — TASK_BLOCK content surface (minimum vs full)

The PlanTask shape from `src/artifacts/plan.ts:104-115`:

```ts
interface PlanTask {
  readonly id: string                          // 'T-001'
  readonly title: string                       // one-line title
  readonly files: readonly string[]            // back-compat: paths only
  readonly fileChanges: readonly PlanTaskFile[] // M8: authoritative path + change kind
  readonly validation: string                  // single shell command
  readonly risk: string                        // one-line; literal 'none' allowed
  readonly hypotheses: readonly string[]       // [] when persona wrote "none"
  readonly sources: readonly string[]          // ≥ 1 source id
  readonly bugfix?: PlanTaskBugfix             // optional; pre-existing failing test reuse
  readonly startLine?: number                  // 1-indexed line of '### T-NNN:'
}
```

Option A (**minimum**): id, title, fileChanges, validation, risk. ~150-300 tokens.

Option B (**full**): id, title, fileChanges, validation, risk, hypotheses, sources, bugfix?. ~300-600 tokens.

Option C (**maximum context**): everything in B plus a PLAN.md excerpt for the task block verbatim. ~500-1500 tokens.

Which option is the right balance? Specifically:

- Does the builder need `hypotheses` for the patch, or are hypotheses only auditing artifacts that the orchestrator validates against rule 15 (Scientist sidecars)?
- Does the builder need `sources` (e.g., "S-rfc7159") to write the patch, or are they only proof to REVIEW that DEFINE/PLAN cited authority?
- Is `bugfix.existingTest` load-bearing for the builder (it must reuse the failing test) or is that the orchestrator's job to enforce via VERIFY?
- Recommend Option A, B, or C. Justify with one bug it would prevent or one cost it would avoid.

### Prompt 2 — Placement in the system prompt

The current template order:

```
1. # BUILD phase — system instructions
2. ## Universal rules — {{UNIVERSAL_RULES}}
3. ## Your identity — {{AGENT_BODY}}
4. ## Common rationalizations — {{COMMON_RATIONALIZATIONS}}
5. ## Available tools — {{AVAILABLE_TOOLS}}
6. ## What the orchestrator authors (you do not)
7. ## What you author
8. ## Output protocol — {{READY_SIGNAL}}
9. ## Patch grammar (locked)
10. ## No-loop discipline
11. ## Scope discipline
```

Where does `## Task` (with `{{TASK_BLOCK}}`) go? Options:

- Option α: between sections 3 and 4 ("identity, then your assignment, then how not to rationalize").
- Option β: between sections 5 and 6 ("identity, rationalizations, tools, then task — task is what you use the tools on").
- Option γ: between sections 11 and 8 — i.e., right before `## Output protocol` ("everything you need to know, THEN your task, THEN how to output it").
- Option δ: as the user message (role: user), not in the system prompt, so the system prompt is task-independent and reusable across tasks.

Which is best? Specifically: which placement maximizes the builder's attention to the task (recency / primacy in long prompts), and which placement minimizes confusion with the "What the orchestrator authors" section (where TASK_BLOCK fields look adjacent to BUILD_REPORT computed fields)?

### Prompt 3 — Serialization shape

Three shapes for the rendered TASK_BLOCK body:

Markdown (handoff's implied shape):
```md
- **Task ID:** T-001
- **Title:** Scaffold src/version.ts
- **Files to change:**
  - `src/version.ts` (add)
- **Validation:** `bun test src/version.test.ts`
- **Risk:** No existing tests in path; first scaffold commit
- **Hypotheses:**
  - H1: A typed module exporting `VERSION` from package.json's version field satisfies callers
- **Sources:** S-001, S-002
```

YAML frontmatter (precedent: agent-skills format):
```md
---
task_id: T-001
title: Scaffold src/version.ts
files:
  - { path: src/version.ts, change: add }
validation: bun test src/version.test.ts
risk: No existing tests in path; first scaffold commit
hypotheses:
  - H1: A typed module exporting VERSION...
sources: [S-001, S-002]
---
```

Fenced JSON block:
```json
{
  "task_id": "T-001",
  "title": "Scaffold src/version.ts",
  "files": [{"path": "src/version.ts", "change": "add"}],
  "validation": "bun test src/version.test.ts",
  "risk": "No existing tests in path; first scaffold commit",
  "hypotheses": ["H1: A typed module exporting VERSION..."],
  "sources": ["S-001", "S-002"]
}
```

Which shape does Opus 4.7 attend to best inside a long system prompt? Specifically:

- The "Markdown shape" is the lowest-friction read but the loosest serialization (extra whitespace, list-style drift in test snapshots).
- YAML is precise but introduces a foreign island in a Markdown prompt.
- JSON is brittle if any field contains the wrong character (newline in `risk`, backtick in `validation`).
- Is there a precedent in the existing prompts (DEFINE / PLAN / REVIEW system prompts) that we should match for consistency?

### Prompt 4 — System vs user role for TASK_BLOCK

Today the builder invocation is single-turn against a Claude CLI subprocess (showstopper #0b debates upgrading to multi-turn). The orchestrator passes the rendered system prompt as the system message and an empty user message (or a user message that names the task).

Option α: TASK_BLOCK in the system prompt (handoff's implied shape).
Option β: TASK_BLOCK in the user message; system prompt is task-independent.

Question: in the future tool-use loop (showstopper #0b), the model will exchange multiple turns. The system prompt persists across turns; the user message is per-turn. If TASK_BLOCK is in the user message, every turn needs to repeat it OR the model forgets it after a tool round. If TASK_BLOCK is in the system, the model carries it across turns automatically.

Should TASK_BLOCK be system or user, considering the future #0b world?

### Prompt 5 — `task` parameter required vs optional

If `task` is **required** in `ComposeBuildPromptInput`, every existing caller of `composeBuildPrompt` must be updated to pass it. This forces the bug we're closing to never regress (TypeScript compile errors catch missing arg). The cost is a wider blast radius for the change.

If `task` is **optional** with a default (e.g., `task?: PlanTask` and the renderer either omits the section or renders a "no task selected" placeholder when absent), the change is narrower but a future caller could forget to pass `task` and the bug would silently return.

Which option is correct under rule 22 ("design for the smallest correct surface") and rule 7 ("artifact contracts are plain Markdown — never JSON serialization for inter-phase handoffs")?

### Prompt 6 — Test discipline

The handoff names one RED test: assert the rendered prompt contains id + every files entry + verbatim validation + verbatim risk. Question: is this sufficient? Specifically:

- Should there be a snapshot test on a known PlanTask producing a known rendered string? (Pro: catches any drift; Con: brittle to whitespace/list-style)
- Should there be a structural test that asserts the section header `## Task` (or whatever shape Codex recommends in Prompt 2) appears at the expected location?
- Should there be a test that asserts the TASK_BLOCK content is also re-readable by a parser (e.g., extract `task_id` from the rendered shape and confirm it matches the input)? This is overkill for prompt rendering but might be useful if TASK_BLOCK ever needs to be machine-introspectable.
- Should there be an integration test against the failing dogfood fixture (Run `01KRKW0D94C3F80002CSAR29NT`)? Per rule 22 and the BUG-free motto, yes — but the integration test belongs to the dogfood-smoke script (handoff § "The dogfood smoke"), not to the prompt-rendering test.

Name the minimum set of tests required and the maximum set worth writing.

### Prompt 7 — Second-order risks

What does this fix break or risk?

- Token bloat: TASK_BLOCK at Option C size adds ~1500 tokens to every BUILD invocation. With Opus 4.7 at 1M context and 128k max output, this is fractionally small, but per `budgets.global.maxTokensEstimate` (rule 19) it contributes to the run's cumulative spend. Per `effort_envelope_applied` (rule 23), the `--effort lite` envelope is tight (~30 USD / 770k tokens for the whole run as observed in the prdiff dogfood). Token cost matters at lite effort.
- Secret leak: PlanTask fields are author-controlled. Could `task.validation` contain a secret (e.g., `curl -H "Authorization: Bearer $TOKEN"`)? In principle yes; per TRUST.md the validation command is copied verbatim into BUILD_REPORT.md and the runtime evidence. The TASK_BLOCK injection makes it visible to the BUILD agent's prompt context. Is this a regression on TRUST.md's redaction discipline, or is this already covered (PLAN.md authoring is the user's responsibility)?
- Misalignment with `## What the orchestrator authors`: TASK_BLOCK's fields (validation, risk) are also among "What the orchestrator authors" computed fields. The template explicitly says "If you embed any of these computed fields in your response, the orchestrator drops them silently — they are not authoritative." Does TASK_BLOCK's presence in the system prompt confuse the boundary between "given to you" and "you must not author"? Specifically: validation is given to you (so you know what will be run against your patch) but you must not author it (the orchestrator copies it verbatim). Is the existing language strong enough to prevent the model from emitting `## Validation` in its output?
- Future tool-use loop interaction (#0b): when the builder runs tool calls (glob, grep, read) and receives tool_results, the conversation grows. Does TASK_BLOCK stay in system or get redundantly repeated across turns? (Linked to Prompt 4 above.)

### Prompt 8 — Anything else

Use independent judgment. Flag anything I missed that should land in this brief OR in a separate brief before code lands.

## Output expected from Codex

For each prompt 1–8, give a structured response:

- A recommendation (which option, or a hybrid).
- The reasoning in 2–4 sentences.
- A specific bug or cost the recommendation prevents.
- (Optional) one acceptance test that proves the recommendation works.

End with a synthesis: a single 5–10 line "Locked decisions" block I can paste into the implementation PR. If any prompt produces "debate-required", name what the next debate must resolve.

## Companion: showstopper #0b

A separate brief on showstopper #0b (Claude CLI tool-use loop) will be dispatched as its own debate thread. The two showstoppers are coupled — #0a sets the prompt content, #0b sets the orchestration protocol — but their fix shapes can be debated in isolation. Cross-reference each other only where Prompt 4 (system vs user) and Prompt 7 (turn behavior) intersect.
