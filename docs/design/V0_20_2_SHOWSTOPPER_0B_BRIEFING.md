# Codex briefing — v0.20.2 showstopper #0b (Claude CLI has no tool-use loop wired in BUILD)

**Date:** 2026-05-14
**Author:** Maestro (Opus 4.7) under Ozzy oversight
**Codex model:** gpt-5.5 xhigh, sandbox read-only
**Companion thread:** showstopper #0a (TASK_BLOCK injection) is debated separately — see thread `019e281e` and `V0_20_2_SHOWSTOPPER_0A_CODEX_RESPONSE.md`. #0a's "Locked decisions" assume #0b solves "the builder still cannot read files."

## Goal of this debate

Pressure-test the fix shape for v0.20.2 finding #0b before any code lands. The handoff (`docs/handoffs/2026-05-14-v0.20.2-bug-free-handoff.md` § "Showstopper #0b") proposes one architecture (wire a true multi-turn tool-use loop). This brief surfaces a fourth alternative that uses existing infrastructure and asks Codex to compare all four.

## The bug, verified

`src/providers/claude.ts:63-100` invokes Claude CLI with `args = ['--print', '--output-format', 'json', '--no-session-persistence']`. Single-shot mode: Claude reads stdin, prints a JSON result, exits. The adapter always emits `stopReason: 'end_turn'`. No `tool_use` stop reason. No conversation continuation.

`src/providers/invoke.ts:229-249` has a *receiving-end* handler for `stopReason: 'tool_use'` and `toolCalls`. Comment line 232: "M7 BUILD/REVIEW orchestration will use this shape." Present tense. Architected, never wired.

`src/tools/repo-context/runner.ts` is implemented end-to-end: `runRepoContextTool` orchestrates a single tool call, intersects permissions, runs glob/grep/read, emits `repo_context_searched` events. Comment in the same file (line 8): "selectedPaths starts as []; the next invocation's wrapper updates it when the agent's tool-result includes selection metadata."

`src/phases/build.ts:423` constructs `composeBuildPrompt({ agentBody, readySignal, availableTools })` with no file content. `src/phases/build.ts:460` invokes the persona via `opts.invokePersona(composedPrompt)`.

`src/cli/production-seams.ts:113-144` (`productionInvokePersona`) constructs `ProviderRequest { ... files: opts.files ?? [] }`. The caller in `src/commands/run.ts:1623` passes `opts.files` empty for BUILD.

`src/providers/claude.ts:257-264` (`renderStdin`) DOES render files: when `req.files.length > 0`, it concatenates `prompt + "\n\nFiles in scope:\n=== path ===\ncontent"` for each file.

**The file-manifest pipeline exists and works. BUILD just doesn't pass files into it.**

### Proof (v0.20.2 prdiff dogfood)

Three BUILD attempts against the prdiff intent. The events.jsonl contains **zero `repo_context_searched` events**. Builder Opus's draft responses say "no PLAN.md in this empty directory" — because Opus has no callable tools AND the stdin manifest is empty. The `agent_invoked` event records `filesSent: 0, bytesSent: 0`.

## Constraints (non-negotiable)

1. **Rule 22 (TDD):** RED test first.
2. **Rule 13 (privacy by default; explicit file manifests):** `code-oz` never silently sends recursive repo context. Files leaving the repo go through the explicit manifest, intersected with `permissions.read`.
3. **Rule 18 (repo-context permission scope):** Agentic search is a `tool_use.repo_context` sub-scope. Search results are audited via `repo_context_searched` events. Selected paths enter the *next* invocation's `ProviderRequest.files`.
4. **Rule 20 (one new authority per milestone):** v0.20.2 is a patch release. Introducing a NEW orchestration primitive (multi-turn tool-use loop) is an authority expansion. A milestone-shaped extension goes to v0.21+; a manifest-expansion fix is in scope.
5. **Rule 7 (artifact contracts plain Markdown):** Tool results between turns are a runtime artifact, not a phase artifact, but the discipline of plain Markdown payloads applies.
6. **Cross-family REVIEW (rule 2):** Whatever architecture lands must work for REVIEW (GPT-5.5 / Codex), not just Claude. The handoff calls this out: "the loop must be provider-agnostic in `invoke.ts`."
7. **Privacy guard in `claude.ts:5-15`:** Runs Claude CLI from empty temp cwd to prevent CLAUDE.md auto-discovery. Manifest content goes through stdin only. No `--add-dir`.

## Acceptance criteria

1. On the paused prdiff run `01KRKW0D94C3F80002CSAR29NT`, BUILD T-001 ("Scaffold src/version.ts") completes with a successfully-applied patch in the worktree.
2. Builder receives enough file context to write the patch correctly.
3. The fix is provider-agnostic — REVIEW (GPT-5.5 cross-family) also benefits.
4. Privacy guards remain intact: no silent recursive repo access; everything traceable to the manifest.
5. (Stretch) `repo_context_searched` events appear in events.jsonl for modification tasks — required for full audit, optional for v0.20.2 if Option D is chosen.

## Four candidate architectures

### Option A — Anthropic-style multi-turn tool-use loop inside the BUILD invocation

The handoff's recommended shape. Per the handoff:

> When invocation receives a `tool_use` block in the response, the provider does not return to the caller; instead it loops: match each tool call against the agent's `permissions.tool_use.repo_context`, run `runRepoContextTool` for each call, append `repo_context_searched` events, append the `tool_use` + `tool_result` pair to the conversation, re-invoke Claude CLI with the extended conversation, repeat until response has no `tool_use`, or until `maxToolCallsPerTurn` (already in config) is hit.

Where the loop lives: `src/providers/claude.ts` (adapter-internal) or `src/providers/invoke.ts` (wrapper-level provider-agnostic).

**Implementation cost:** 2-4 days. Requires:
- Multi-turn conversation shape into Claude CLI (does `--print --output-format json` accept a JSON conversation on stdin? Probably not — `--print` is single-prompt-in, JSON-result-out by design. Likely need `--continue` with session ID OR direct Anthropic SDK fallback when `tool_use` is requested. Adds an entire second auth path.)
- Provider-agnostic loop in invoke.ts for REVIEW.
- New test surface: tool-use mock adapters, multi-turn cassettes.

**Benefit:** True interactive agent — builder can iteratively read/grep/glob before crafting the patch.

**Cost:** Rule-20 authority expansion. Adds a new orchestration primitive (multi-turn provider conversation) and a second auth path (Anthropic SDK alongside Claude CLI). Several days of test surface.

### Option B — Code-oz multi-call provenance loop (one tool call = one re-invocation)

Each `tool_use` from the provider is parsed by the wrapper. The wrapper runs `runRepoContextTool` (which already emits the `repo_context_searched` event). The selected paths flow into the NEXT `ProviderRequest.files` and the wrapper re-invokes the SAME BUILD phase with the expanded manifest. Each invocation is a separate `agent_invoked` / `agent_completed` event.

**Implementation cost:** 1-2 days. Requires:
- New "retry-with-expanded-manifest" orchestration in `src/phases/build.ts` (or in invoke.ts, agent-agnostic).
- New event type or "follow-up invocation" annotation.
- Budget accounting across multiple invocations per task.
- Termination guarantee (cap on follow-up invocations).

**Benefit:** Matches code-oz's existing provenance model — every file the agent saw is in `agent_invoked.filesSent`. Existing event ledger continues to work.

**Cost:** Inflates events.jsonl for tool-heavy tasks. Each glob/grep/read becomes its own `agent_invoked` event. Confusing for users reading the ledger. Budget caps need redesign per-task instead of per-call.

### Option C — Expose the worktree to Claude CLI via `--add-dir`

Drop the `claude.ts:67` privacy guard (empty temp cwd). Pass `--add-dir <worktree>` so Claude CLI's built-in glob/grep/read tools operate on the run's worktree. Claude handles its own tool-use loop internally. One CLI invocation per BUILD turn.

**Implementation cost:** 0.5 days. Just unset the temp cwd guard for BUILD/REVIEW and add `--add-dir` to the args.

**Benefit:** Smallest code change. Zero new orchestration. Claude's mature tool-use loop is reused.

**Cost:** **Privacy regression.** The privacy guard exists for a reason — Claude Code auto-discovers CLAUDE.md files up the cwd hierarchy and adds them to context. With `--add-dir <worktree>`, the worktree's full content is exposed beyond what's in the explicit manifest. Code-oz's audit trail loses fidelity: `agent_invoked.filesSent` no longer reflects what the agent saw. Rule 13 is violated. The agent might also use built-in Claude Code tools that are NOT `repo_context` (e.g., shell exec) — escaping the permission scope. **Reject for v0.20.2.**

### Option D — Manifest expansion via `task.fileChanges` (no tool-use loop)

The plumbing for `ProviderRequest.files → wrapper-loaded content → stdin manifest` already exists end-to-end. The bug is that `runBuild`'s call to `productionInvokePersona` constructs `files: opts.files ?? []` (empty) when it should pass the files named in `task.fileChanges`.

**Implementation cost:** 0.5 days. Requires:
- In `src/phases/build.ts`, derive `files: task.fileChanges.map(fc => ({ path: fc.path }))` from the parsed PlanTask.
- Pass through `runBuild`'s opts → `productionInvokePersona` → `ProviderRequest.files`.
- The wrapper already handles permissions intersection, content loading, hashing, manifest building. The Claude adapter already renders files as stdin "Files in scope:" sections (line 257-264).

**Benefit:** Uses existing pipeline. No new orchestration. Provider-agnostic by construction (every adapter already handles `PreparedProviderRequest.files`). Provenance preserved via `agent_invoked.filesSent`. Rule 13 honored: explicit manifest, intersected with permissions. Rule 20 unaffected: no new authority. Closes the prdiff dogfood for scaffold (T-001) AND modification tasks (T-002+) where `task.fileChanges` lists the relevant paths.

**Cost:** Builder cannot do exploratory search (glob/grep across the worktree before deciding what to read). For tasks where `task.fileChanges` is incomplete, the builder lacks context. Mitigation: PLAN authoring quality matters more; the SOURCE_CHECK + 3-source verification (rule 3) already enforces this. For tasks that need broader exploration, defer Option A to v0.21+ as a true authority expansion.

For modification tasks where existing files exist:
- `task.fileChanges[].change === 'modify'` → wrapper loads current content from worktree
- `task.fileChanges[].change === 'add'` → wrapper records the path (file doesn't exist yet); builder writes new content
- `task.fileChanges[].change === 'delete'` → wrapper loads current content so builder can confirm what's being removed

For scaffold tasks (T-001 prdiff: "Scaffold src/version.ts"):
- `task.fileChanges = [{ path: 'src/version.ts', change: 'add' }]` → wrapper sees zero existing content (file doesn't exist); manifest is empty in terms of bytes but the path IS recorded. Builder receives the task block (id, title, files, validation, risk) via TASK_BLOCK + agent body, knows what to build, and writes the patch from intent.

### Comparison matrix

| Dimension | A (true tool-use) | B (multi-call provenance) | C (--add-dir) | D (manifest expansion) |
|---|---|---|---|---|
| Implementation cost | 2-4 days | 1-2 days | 0.5 days | 0.5 days |
| Rule 13 (privacy) | OK (loop in invoke.ts honors permissions) | OK | **Violated** | OK |
| Rule 18 (repo_context) | Realized | Realized | Bypassed | Not realized; agent has no callable tools |
| Rule 20 (one authority/milestone) | **Adds authority** | Adds authority (less so) | None | None |
| Cross-family (rule 2) | Required to be provider-agnostic | Required | Claude-only | Provider-agnostic by construction |
| Provenance fidelity | High | High but spammy | **Low** (lost) | High |
| Scaffold task support | Yes | Yes | Yes | Yes |
| Modification task support | Yes (best — agent reads selectively) | Yes | Yes (but lossy provenance) | Yes (when `fileChanges` is complete) |
| Exploratory task support | Yes | Yes | Yes | No (PLAN must enumerate) |

## Debate prompts

### Prompt 1 — Which option ships in v0.20.2?

Codex's recommendation. Rank Options A, B, C, D by which closes the prdiff dogfood with the smallest code change AND respects rule 20 (one new authority per milestone).

Specifically: is Option D sufficient to close the prdiff dogfood (T-001 scaffold + T-002…T-011 are well-scoped in their PLAN task blocks)? If yes, defer A/B to v0.21+ as a milestone-shaped authority expansion. If no, name which prdiff task fails under Option D and why.

### Prompt 2 — Where does the chosen architecture's code live?

If A or B is recommended: does the loop live in `src/providers/claude.ts` (adapter-internal, but then REVIEW's Codex adapter needs a duplicate implementation) or `src/providers/invoke.ts` (wrapper-level, provider-agnostic)?

If D is recommended: does file derivation live in `src/phases/build.ts` (BUILD-specific) or in a new helper in `src/runtime/file-manifest.ts` (reusable for VERIFY / REVIEW if they ever need file content)?

### Prompt 3 — Does the chosen architecture preserve #0a's TASK_BLOCK?

#0a injects TASK_BLOCK into the system prompt. In Option A's multi-turn loop, the system prompt persists across turns automatically. In Option D, the prompt is sent once per invocation — TASK_BLOCK is in every BUILD prompt. Either way, the TASK_BLOCK content survives. Confirm.

### Prompt 4 — How does the orchestrator handle "task.fileChanges names a path that doesn't exist yet"?

Under Option D, the wrapper's manifest builder must handle:
- Existing file → load, hash, ship to provider.
- New file (change: 'add') → path is recorded but no content shipped. The wrapper currently is at `src/providers/manifest.ts` — does it gracefully handle a path that doesn't exist? If not, what's the change shape?

(For Options A/B, this is irrelevant — the agent picks files via tool calls. But A/B doesn't ship in v0.20.2 per Prompt 1 recommendation.)

### Prompt 5 — REVIEW phase support

REVIEW (cross-family, GPT-5.5) operates on the BUILD output: the patch + its source files. Does Option D's manifest-expansion approach correctly cover REVIEW's needs?

Specifically: REVIEW's prompt today (`src/phases/review.ts` around line 983) passes a composed prompt but no files. REVIEW also needs to see the source files the patch touches (otherwise it can't judge correctness). Does Option D extend to REVIEW by deriving `files` from the BUILD output's changed-files manifest?

### Prompt 6 — Test discipline

Per rule 22 RED-first, what's the minimum test for the chosen architecture?

- For Option D: a test that asserts `runBuild` constructs `files` from `task.fileChanges` and passes them through `invokePersona`. Plus a test that the wrapper correctly handles `change: 'add'` (path with no existing content).
- For Options A/B: tool-use mock adapters, multi-turn cassettes, budget enforcement under the loop.

### Prompt 7 — Future migration path

If v0.20.2 ships Option D, what does the v0.21+ migration to Option A look like? Specifically: does Option D introduce technical debt that would make Option A harder to land later? Or is Option D a clean stepping stone (existing manifest pipeline + new tool-use loop layered on top)?

### Prompt 8 — Anything I missed

Name any second-order risk, naming concern, doc gap, or test surface I haven't named. Especially: any way Option D breaks an existing test or contract?

## Output expected from Codex

Same shape as the #0a debate response:

- Per-prompt recommendation with 2-4 sentence reasoning, one bug/cost prevented, optional acceptance test.
- End with a 5-10 line "Locked decisions" block I can paste into the implementation PR.
- If any prompt produces "debate-required: more analysis needed before locking," name what the next debate must resolve.

Specifically, I'm requesting:

1. **Yes/no on Option D as the v0.20.2 architecture.** If yes, lock the code path. If no, justify which Option A/B/C closes the dogfood with smaller risk than D's "PLAN must enumerate files" tradeoff.
2. **An explicit prdiff dogfood acceptance criterion** I can use to declare #0b closed: e.g., "T-001 BUILD succeeds with exit 0 and a patch landed in the worktree under Option D."
3. **One sentence each** on Rule 13 honor, Rule 18 status (realized vs deferred), Rule 20 status.

Be specific. The implementation will start from your synthesis, so the locked-decisions block is load-bearing — same as the #0a debate.
