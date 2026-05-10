# Codex Response — gptme vs code-oz

**Codex model:** gpt-5.5 (xhigh reasoning), sandbox: read-only
**Thread:** `019e12ed-4038-7fe2-8800-5520e5f2048a`
**Verdict:** `fix-first`

## 1. Verdict on the decision matrix

**B1: accept-with-modifications.** The useful part is the cache-aware decision threshold, not gptme's full compaction behavior. gptme's decision code gates on estimated savings over `MIN_SAVINGS_RATIO = 0.10`, but its trigger threshold is actually 50 percent context plus massive tool result, not the 80 percent described in the comparison (`gptme/tools/autocompact/decision.py:15`, `gptme/tools/autocompact/decision.py:130`). code-oz may borrow a deterministic `CompactionDecisionProbe`, but not LLM resume summarization or hidden context mutation. Rule 20 needs this as the single milestone authority, and Rule 21 needs `events.jsonl` evidence before compaction changes provider inputs (`CLAUDE.md:42`, `CLAUDE.md:43`).

**B2: reject as "borrow now."** gptme's checkpoint solves direct mutation of the user workspace with `git reset --hard` and optional `git clean -fd` (`gptme/checkpoint.py:360`, `gptme/checkpoint.py:394`, `gptme/checkpoint.py:406`). code-oz already makes BUILD mutate isolated worktrees, and the product principle says builders mutate isolated worktrees, not the active tree (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md:196-197`). The worktree is the checkpoint. Borrow only topology/refusal diagnostics later, not a restore primitive.

**B3: accept-with-modifications.** gptme's file list is useful, but its load behavior is too trusting. It loads cross-tool files including `.cursorrules` and `.windsurfrules` (`gptme/prompts/__init__.py:23`) and then frames them as instructions the model "MUST follow" (`gptme/prompts/workspace.py:341`). Worse, it walks from home to workspace (`gptme/prompts/workspace.py:121`). code-oz may borrow discovery plus explicit AUDIT/DEFINE confirmation, not blind ingestion.

**D1: agree.** Defer. The comparison understates the surface: gptme has more than 16 hook types, including transforms, confirmations, elicitation, cwd, and cache invalidation (`gptme/hooks/types.py:61`). Default hook registration plus plugin hook registration makes this an extension authority (`gptme/hooks/__init__.py:149`, `gptme/hooks/__init__.py:242`). Rule 20 says no.

**D2: agree.** Defer. gptme's subagent API is not just a clean batch helper. It includes executor/planner modes, parallel/sequential subtasks, subprocess mode, ACP mode, profiles, model routing, and optional isolated worktrees (`gptme/tools/subagent/api.py:32`, `:80`, `:95`). That is a parallel-agent authority and must wait for measured need.

**R1: agree.** Reject. Lessons auto-inclusion matches by keywords, regex patterns, skill names, and tools (`gptme/lessons/matcher.py:89`, `:123`), then injects hidden system context (`gptme/lessons/auto_include.py:145`). That conflicts with deterministic persona prompts and Rule 16.

**R2: agree.** Reject. gptme plugins can provide tools, hooks, commands, providers, and init functions (`gptme/plugins/plugin.py:21`), loaded via Python entry points (`gptme/plugins/entrypoints.py:25`). That is extension-surface authority creep.

**R3: agree.** Reject on category grounds. Bob's journal/people/projects layer was not in the core files I read, but the category mismatch is enough — code-oz's product thesis is repo-native SDLC, not personal-assistant runtime (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md:18,28`).

**R4: agree.** Reject. gptme's architect prompt is sensible, but code-oz already has PLAN and BUILD as separate gated roles. The gptme template asks the architect for exact files and changes but no code (`gptme/prompts/architect.py:9`) and then injects the plan into the editor (`gptme/prompts/architect.py:47`). That is a checklist, not a new primitive.

**R5: agree.** Reject. ACP and web/REST/Tauri surfaces are not code-oz's product. gptme explicitly supports ACP subagents that can target other compatible agents (`gptme/tools/subagent/api.py:80`). code-oz's architecture lock is CLI and typed phase FSM.

## 2. Counter-arguments to the five challenge questions

**1. Is B1 needed, or does the discipline-rule alternative win?**

The discipline-rule alternative wins first. Add artifact/token-size preflight and refuse oversized phase artifacts before building a compaction engine. B1 should proceed only as telemetry plus deterministic projection. gptme's actual autocompact can create view branches and switch the manager to compacted content (`gptme/tools/autocompact/hook.py:128`), and can fall back to LLM resume summarization (`gptme/tools/autocompact/hook.py:164`). code-oz should not copy either behavior into gate context.

**2. Is B2 redundant with worktree audit-completeness recovery?**

Yes, mostly. The claimed gap is real for gptme because it mutates the active Git workspace. It is artificial for code-oz if BUILD always happens in a per-run worktree. On crash, preserve the dirty worktree as forensics and restart from the last gate-known state. gptme's refusal modes are useful inspiration, but its `multi_root` test marks multiple worktrees as unsafe (`gptme/checkpoint.py:160`), which collides with code-oz's normal isolation model.

**3. Is B3 a trust-boundary violation?**

Yes, if implemented like gptme. `.cursorrules` and `.windsurfrules` are cross-tool instructions, not automatically authoritative code-oz policy. gptme even logs that they may not be compatible, then still appends them (`gptme/prompts/workspace.py:154`). code-oz should discover them, show paths and source tool, ask for opt-in, then record `agent_files_discovered`, `agent_files_accepted`, and `agent_files_rejected`.

**4. Should D1 or D2 be promoted to "borrow now"?**

No. D1 is a platform extension system. D2 is a parallel-agent execution surface. Both are exactly what Rule 20 and Rule 21 are meant to slow down. The mature implementation in gptme is a reason to revisit later, not a reason to import it speculatively.

**5. What did I miss?**

- **Morph: reject for now.** It requires OpenRouter, calls `openrouter/morph/morph-v3-fast`, then writes a full returned file after a separate model transforms the edit (`gptme/tools/morph.py:145,223`). That is a new edit-provider authority.
- **Precommit: add as a deferred VERIFY adapter, not a hook.** gptme auto-enables checks when `.pre-commit-config.yaml` exists (`gptme/tools/precommit.py:51`) and runs modified-file checks at turn post (`gptme/tools/precommit.py:329`). code-oz should only run it as explicit VERIFY evidence.
- **Eval suite: this is the strongest miss.** gptme has release-quality evals with model leaderboards, practical suites, CSV/JSON export, Docker guidance, and SWE-bench support (`docs/evals.rst:42,88,176,196`). code-oz's offline tests validate orchestration, but not live run quality across models/releases. Add a deferred eval-harness borrow.
- **Architect/editor template:** no classification change. It can inform PLAN prompt review, but not a borrow item.
- **Cost tracking: do not borrow as a budget primitive.** gptme has session warnings and cache-cold warnings (`gptme/hooks/cost_awareness.py:36,164`), while code-oz already has cumulative hard-kill budget enforcement under `budgets.global`. Consider only cache-cold warning telemetry as part of B1.

## 3. Risks I missed (Codex-flagged)

- **B1 threshold drift in gptme.** The comparison said 80 percent context, but `should_auto_compact` uses 50 percent + massive tool result, while the engine has its own 70 and 80 percent thresholds (`gptme/tools/autocompact/decision.py:130`, `engine.py:75`, `engine.py:79`). Copying the prose would copy the wrong behavior.
- **B2 destructive restore semantics.** `restore_checkpoint()` resets HEAD hard and optionally cleans untracked files (`gptme/checkpoint.py:394,409`). Incompatible with code-oz's user-change preservation discipline unless constrained to disposable run worktrees.
- **B3 home-to-workspace instruction inheritance.** gptme loads user config files and walks from home down to the workspace (`gptme/prompts/workspace.py:215,233`). code-oz should never silently inherit parent-directory instructions into provider context.
- **D1 understated.** Not 16 lifecycle points — also transform, confirmation, elicitation, cwd changes, and cache invalidation (`gptme/hooks/types.py:68,100,103`).
- **Precommit `StopPropagation`.** Pre-commit hooks can block downstream automation (`gptme/tools/precommit.py:355`). Fine in gptme's chat loop, but in code-oz that belongs in VERIFY gate evidence, not a general lifecycle hook.

## 4. Final verdict — `fix-first`

**Required classification changes before code-oz proceeds:**

| Original | Fixed |
|---|---|
| B1: Borrow now — Autocompact decision engine with cache-invalidation guard | **B1: Borrow now (narrowed) — deterministic context-size and compaction-opportunity probe only.** No LLM summarization, no automatic provider-context mutation, no view-branch equivalent. Measurement: `context_projection_tokens`, `compaction_opportunity_savings_ratio`, `compaction_skipped_savings_ratio`, `oversized_artifact_gate_refused`. |
| B2: Borrow now — Checkpoint kind-classification with refusal modes | **B2: Defer (renamed) — worktree topology/refusal diagnostics.** Reject gptme-style checkpoint restore. Measurement before implementation: count actual resumes where audit-completeness cannot recover from a dirty run worktree without destructive reset. |
| B3: Borrow now — Cross-tool AGENT_FILES ingestion | **B3: Borrow now (narrowed) — AGENT_FILES discovery plus explicit AUDIT/DEFINE opt-in.** No parent/home walk. Cross-tool files are informational until the user accepts them. Measurement: `agent_files_discovered`, `agent_files_accepted`, `agent_files_rejected`, `agent_instruction_conflicts`, intake-question delta. |
| (none) | **D3 (new): Release/run-quality eval harness inspired by gptme evals.** Defer unless it becomes the single milestone authority. |
| D1, D2, R1, R2, R3, R4, R5 | unchanged |

Borrow set after fix: **2 narrow-borrow candidates (each deferred to its own milestone), 4 deferred (B2 demoted + D1 + D2 + new D3 eval harness), 5 rejected.**

> **Note (post-R2 scope lock, thread `019e1319`):** Codex round 2 ratified Option A — RATIFY-ONLY. The two narrow-borrow candidates above (B1, B3) are reserved for their own future milestones (M17/M18 candidate slots in `docs/design/ROADMAP.md`); they are NOT implemented in this PR. The canonical post-debate settlement is `SYNTHESIS.md`.

---

*Original briefing recommended 3 borrow + 2 defer + 5 reject. Codex narrowed 2 borrows, demoted 1 borrow to defer, and added 1 new defer (eval harness). Net: tighter Rule-20/Rule-21 compliance and one new strategic gap (release-quality evals) the briefer missed entirely.*
