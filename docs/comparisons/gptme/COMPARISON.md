# gptme vs code-oz

**Date:** 2026-05-10
**Reviewer:** Claude Opus 4.7 (1M ctx) — code-oz session
**Scope:** `~/Projects/agents/templates/gptme` (gptme v0.31.x, agent-template v0.4 era)
**Method:** Single-session structural review, then Codex debate at convergence (per CLAUDE.md cross-model peer review rule).

---

## TL;DR

**Verdict: code-oz exceeds gptme in its target domain (repo-native agentic SDLC runtime); gptme exceeds code-oz in adjacent domains (general-purpose chat-first agent CLI, persistent-agent workspace). Different products with non-overlapping cores.**

- code-oz wins: file-based gate signals, cross-family adversarial review, debate runtime, role-cost policy under `budgets.global`, scientist tails, scoped-permission repo-context, Rule-20 authority-boundary discipline, Rule-21 risk-reduction-must-be-measurable.
- gptme wins: chat-loop substrate, lessons auto-injection, generalized hook lifecycle (>16 points), autocompact decision engine with cache-invalidation guard, Git-backed checkpoint with kind classification, persistent-agent workspace (Bob), MCP discovery + ACP server, plugin entry-points, **release-quality eval harness** (Codex-flagged miss), web UI / REST / Tauri desktop.
- **Final borrow set after Codex `fix-first` debate (thread `019e12ed-4038-7fe2-8800-5520e5f2048a`):** **2 narrowed-borrows now**, **3 deferred (incl. new D3 eval harness)**, **5 rejected**. See `CODEX_RESPONSE.md` and § Synthesis below.

---

## What gptme is

**Category:** general-purpose chat-first agent CLI; one of the first (Spring 2023). Provider-agnostic, local-first, single chat loop with tool calls.

**Core architecture:**

```
User → chat() loop
       ├── prompts/ (system prompt + AGENTS.md/CLAUDE.md/GEMINI.md ingestion)
       ├── tools/ (shell, ipython, patch, browser, vision, computer, subagent, rag, gh, tmux, todo, …)
       ├── hooks/ (PRE/POST × {message, tool, file, generation, session}, 16 types)
       ├── lessons/ (keyword/tool/pattern auto-injection + Anthropic skills format)
       ├── plugins/ (Python entry-points; tools+hooks+commands packaged together)
       ├── llm/ (Anthropic/OpenAI/Gemini/xAI/DeepSeek/OpenRouter/llama.cpp)
       ├── autocompact/ (multi-phase token compaction: reasoning strip → tool-result reduce → assistant compress)
       ├── checkpoint.py (Git-backed recovery markers, kind-classified)
       ├── mcp/ (MCP server discovery + dynamic loading)
       ├── acp/ (server gptme as coding agent for Zed/JetBrains)
       └── server/ (REST + web UI + Tauri desktop)
```

**Persistent-agent layer (`gptme-agent-template`):** a separate template repo. Each agent is a git repository; layout: `journal/YYYY-MM-DD.md`, `tasks/*.md` with YAML frontmatter, `knowledge/`, `lessons/`, `people/`, `projects/`. Reference implementation **Bob** has 1700+ autonomous sessions, opens PRs, fixes CI.

**Distinctive engineering:**

- **arewetiny** philosophy: minimal core, extend via plugins. Core/contrib split is enforced.
- **Cross-tool AGENT_FILES loading:** ingests `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `COPILOT.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`. Multi-tool ergonomics by default.
- **Architect/editor split prompt** (`prompts/architect.py`): WHAT/WHY plan from architect → diff blocks from editor. Separates planning model from edit model.
- **Autocompact decision engine** with `MIN_SAVINGS_RATIO = 0.10` — refuses to compact if savings would not justify cache invalidation. Three phases (reasoning strip → tool-result reduce → assistant-compression) with age thresholds.
- **Checkpoint** classifies workspaces into `clean_git | dirty_git | non_git | multi_root`; refuses MVP recovery for `non_git` and `multi_root`; requires `--include-dirty` for `dirty_git`.
- **Subagent** with executor mode + planner mode + batch jobs (`subagent_batch`) + completion hooks.
- **Lessons** distinct from skills: keyword/tool/pattern auto-injection, session-wide cap (default 20), summary on exit.
- **Cost tracking** (`util.cost`) integrated into the chat loop, not a sidecar.

---

## What code-oz is

**Category:** repo-native agentic SDLC runtime (market) framed as an AI software company (product metaphor). Locked 2026-04-30 in `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`.

**Core architecture:**

```
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP   (greenfield)
AUDIT  → PLAN → BUILD → VERIFY → REVIEW → SHIP   (brownfield)
                                  ↑
                              cross-family
                              (different provider
                               than BUILD)

Spine: typed FSM + state/events.jsonl + schema-validated GATE_<PHASE>_PASSED.json
       + plain-Markdown artifact contracts (SPEC, PLAN, SOURCE_CHECK, BUILD_REPORT,
         VERIFY, REVIEW, AUDIT) + scientist tails (HYPOTHESES, OPEN_QUESTIONS).

Authority: Rule 20 — one new authority boundary per milestone.
           Rule 21 — no new parallel-provider surface without measurable
                     risk-reduction effect in events.jsonl.
```

**Distinctive engineering** (the 21 non-negotiable rules in `CLAUDE.md`, plus shipped milestones):

- File-based gate signals only; never parse LLM text for pass/fail.
- Cross-family REVIEW agent (different provider than BUILD).
- 3-source verification before any code (`SOURCE_CHECK.md`).
- Worktree-per-run isolation with audit-completeness recovery.
- Debate runtime (`requestDebate()` primitive, M10).
- Reviewer panel v1 (M14) — first simultaneous-provider surface.
- Debate-policy scheduler v1 (M15) — single-opponent only, telemetry-first.
- Role-cost policy under unified `budgets.global` (M13).
- Production CLI completion (M16): pre-design + per-commit Codex review + binary-spawn e2e.
- Scientist tails at every gate (`docs/contracts/SCIENTIST.md`).
- Universal anti-slop rules baked into every persona prompt.
- `repo_context` permission scope with audited `repo_context_searched` events.
- Cumulative budget enforcement read from `events.jsonl` — no parallel state.

**Status:** v0.17.0-alpha.0 (M16 closed); 3108 tests; xAI direct HTTP integration shipped (PE-1); active branches per template comparison.

---

## Side-by-side

| Axis | gptme | code-oz |
|---|---|---|
| **Primary loop** | `chat()` — turns of (LLM reply → tool calls → tool results → LLM reply…) | Phase graph DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP with file-based gates between each |
| **State spine** | LogManager + JSONL conversation logs | Typed FSM + `state/events.jsonl` + schema-validated gate files |
| **Inter-agent handoff** | Same chat log; subagent shares results via tool returns | Plain-Markdown artifact contracts; never JSON serialization between phases |
| **Multi-provider** | `llm/` adapters (Anthropic/OpenAI/Gemini/xAI/DeepSeek/OpenRouter/llama.cpp) | `IAgentProvider` w/ `XaiProvider` HTTP, Claude/Codex/Gemini SDK adapters reading CLI OAuth |
| **Cross-family review** | None — single model, single chat | REVIEW gate enforces different family from BUILD; Reviewer panel v1 (M14) |
| **Debate primitive** | None | `requestDebate()` (M10) + debate-policy scheduler v1 (M15) |
| **Token budgets** | `cost.py` per-call accounting; `autocompact` if over | `budgets.global` cumulative caps from `events.jsonl`; soft-warn at 0.75, hard-kill at 1.0; `NEEDS_INTERVENTION.json` |
| **Context compaction** | `autocompact/` — three-phase, savings-thresholded, cache-aware | None — phase boundaries naturally bound context per phase |
| **Workspace recovery** | `checkpoint.py` — Git-backed, kind-classified, refuses risky configs | Worktree-per-run + audit-completeness recovery (M7) |
| **Hooks** | 16 lifecycle types (message/tool/file/generation/session × pre/post/transform) | Single review-scheduler hook (M15); not a general lifecycle surface |
| **Knowledge injection** | Lessons (keyword/tool/pattern auto-load) + Anthropic skills | Universal anti-slop rules + per-persona prompts; no auto-load by keywords |
| **Plugins** | Python entry-points; packages tools+hooks+commands | None — agentpacks (skill bundles) only |
| **Subagents** | `subagent` tool: executor + planner + batch + completion-hooks | Phase agents; reviewer panel; debate participants — but not an in-chat subagent surface |
| **CLI agent files** | Loads AGENTS.md/CLAUDE.md/GEMINI.md/COPILOT.md/.cursorrules/.windsurfrules | Loads its own CLAUDE.md only |
| **Architect/editor split** | Built-in (architect.py prompt template) | PLAN→BUILD already separates roles; structural equivalent |
| **Persistent agent workspace** | Bob template: journal/tasks/knowledge/lessons/people/projects | Run-scoped artifacts in `.code-oz/runs/<runId>/`; not a personal-assistant frame |
| **MCP** | MCP client (server discovery + dynamic load) | Codex MCP integration in dev tooling; not a runtime agent capability |
| **ACP** | Serves gptme to Zed/JetBrains | Out of scope (not a coding-agent peer to Zed) |
| **Distribution** | pipx/uv/PyInstaller; web UI; Tauri desktop | `bun build --compile` single binary; CLI only |
| **Tests** | High coverage, mypy/ruff strict | 3108 offline tests; live-provider tests env-gated |
| **Release cadence** | Frequent (v0.27→v0.31 in ~9 months); Bob ships continuously | Milestone-gated (M1→M16); Codex review per milestone |
| **Authority discipline** | None codified | Rule 20 (one authority/milestone); Rule 21 (no parallel-provider surface without measurable effect) |

---

## Where gptme wins (and why code-oz does not need to chase)

1. **General-purpose agent CLI usefulness.** gptme answers any prompt with shell/python/browser/computer-use. code-oz refuses unless the prompt enters DEFINE. Different markets.
2. **Persistent-agent (Bob) longevity.** 1700+ autonomous sessions, GitHub PR opener, CI fixer, Twitter posting, Discord bot. code-oz is not a personal-assistant runtime; this is the Researcher persona's eventual frame, not the spine's.
3. **Plugin ecosystem ergonomics.** Python entry-points are friendlier than agentpack frontmatter. gptme-contrib has consortium / imagen / lsp / ace / gupp. code-oz's surface is intentionally narrower (Rule 20).
4. **Web UI / REST / Tauri / ACP.** gptme is multi-front (terminal, browser, IDE peer, desktop). code-oz is CLI-only by design.
5. **Lessons keyword auto-injection.** Powerful for general work. Wrong shape for code-oz, which needs deterministic phase prompts (Rule 16: universal rules baked in, not contextually injected).

---

## Where code-oz wins (and why gptme structurally cannot catch up without rewriting)

1. **File-based gate signals.** Spine reads `state/GATE_<PHASE>_PASSED.json`, validated by zod schemas. gptme's loop has no equivalent because its loop is one chat — there is no inter-step validation surface. Adding one would mean redesigning the chat loop into a phase graph.
2. **Cross-family adversarial review at REVIEW gate.** Built-in different-provider check; Reviewer panel v1 simultaneous review. gptme has no provider-family awareness; consortium plugin in contrib is the closest, and it is opt-in multi-model consensus, not adversarial review.
3. **3-source verification before any code (`SOURCE_CHECK.md`).** Spec + reference + library docs as gate precondition. gptme has neither the gate nor the contract.
4. **Debate runtime (`requestDebate()`) and debate scheduler.** Two providers exchange arguments under a policy with telemetry. gptme has nothing comparable.
5. **`budgets.global` cumulative enforcement.** Read from `events.jsonl` per-call; soft-warn / hard-kill ratios; `NEEDS_INTERVENTION.json`. gptme tracks cost per-call without cumulative kill semantics.
6. **Scientist tails at every gate.** `HYPOTHESES.md`, `OPEN_QUESTIONS.md` blocking gate writes when overdue. Epistemic discipline is built in.
7. **Authority discipline (Rule 20 + Rule 21).** One new authority per milestone; no new parallel-provider surface without measurable effect. gptme has neither — features land when shipped, not when proven to reduce risk.
8. **Repo-context permission scope.** `tool_use.repo_context` audited via `repo_context_searched` events; selected paths enter the *next* invocation's `ProviderRequest.files`, never a hidden context. gptme's RAG tool is similar in shape but not gate-aware.
9. **Worktree-per-run isolation + audit-completeness recovery.** Crash-during-recreate is recoverable. gptme's checkpoint is closer in spirit but operates on the user's repo, not on a per-run sandbox.
10. **Per-commit Codex pre-design** for shared-infra commits (lesson from M16 C4). Cross-model review is a *workflow*, not just a feature.

---

## Borrow set (Rule 21 classification: measurable risk-reduction)

### Borrow now (3) — defensive primitives, no authority creep

#### B1. Autocompact decision engine with cache-invalidation guard

**What:** gptme's `tools/autocompact/decision.py` decides whether compaction is worth the cache cost, using `MIN_SAVINGS_RATIO = 0.10`. Three phases, gated by `total_tokens > limit OR close_to_limit (>= 0.8 × ctx)`.

**Why it fits code-oz:** Multi-phase runs accumulate `events.jsonl` and artifact context across DEFINE→PLAN→BUILD→VERIFY→REVIEW. As runs grow (M14 Reviewer panel, M15 debate scheduler with multi-round transcripts), provider invocations risk exceeding model context. Cache invalidation has the same cost in code-oz as gptme — the 1-hour cache TTL is a real budget line.

**Risk-reduction measurement:** Token count per provider invocation logged today; we can add `compaction_skipped_savings_ratio` and `compaction_applied_tokens_saved` to `events.jsonl` and gate the feature on observed > 0.10 ratio across a baseline of runs.

**Authority cost:** Adds a new internal capability (`CompactionPolicy`) but no new gate, no new provider surface. Fits Rule 20 — could ride into M17 or later as the single new authority.

**What we copy:** the *decision logic* and the *cache-aware threshold*, not the implementation. code-oz's compaction targets `events.jsonl` projection + artifact ingestion, not gptme's chat log.

---

#### B2. Checkpoint kind-classification with refusal modes

**What:** gptme's `checkpoint.py` classifies workspaces into `clean_git | dirty_git | non_git | multi_root` and *refuses* MVP recovery for non-git and multi-root cases. Storage in `$XDG_STATE_HOME/gptme/checkpoints/<fingerprint>.jsonl` — never inside the user's repo.

**Why it fits code-oz:** code-oz already has worktree-per-run isolation. But within a phase, an editor failure or a power loss between provider call and gate write leaves the run in an ambiguous state. Today we recover via audit-completeness; we do not have a "snapshot before BUILD edits" primitive that survives crash-during-write.

**Risk-reduction measurement:** Add a checkpoint-write event before BUILD's first edit and at each VERIFY pass; on resume, compute `audit_completeness_recovered_via_checkpoint` count. If checkpoints aren't used, drop the feature.

**Authority cost:** Adds a recovery capability; does not change gate semantics. Compatible with Rule 20.

**What we copy:** the *kind-classification + refusal* discipline (refuse to checkpoint multi-root or non-git workspaces, require `--include-dirty` for dirty trees), and the *out-of-tree storage path* (state under `~/.code-oz/checkpoints/<runId>/`, not in the user repo).

---

#### B3. Cross-tool AGENT_FILES ingestion at AUDIT/DEFINE

**What:** gptme's `prompts/__init__.py` always loads `AGENTS.md`, `CLAUDE.md`, `COPILOT.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md` if present in the repo.

**Why it fits code-oz:** AUDIT (brownfield) and DEFINE (greenfield with existing repo context) both benefit from any prior agent-rule files the user already wrote for Cursor/Claude Code/Copilot. Today code-oz only reads its own `CLAUDE.md`. Brownfield audit specifically is hampered by ignoring the user's existing tool-specific instructions.

**Risk-reduction measurement:** Add `agent_files_loaded` count + `agent_files_paths` array to AUDIT and DEFINE events. Survey on a corpus of repos to see how often these files exist and how much they reduce intake-question count.

**Authority cost:** Pure intake change; affects DEFINE and AUDIT prompts only. No gate change. Compatible with Rule 20.

**What we copy:** the *file list*, the *load order* (user-level then project-level), and the *cross-tool philosophy* — not the gptme code.

---

### Defer to v0.2 (2) — interesting but premature for v0.1

#### D1. Generalized hook lifecycle (16 types)

**Why defer:** code-oz has exactly one production hook today (`review-scheduler-hook.ts` from M15). Generalizing to 16 hook points without measurable need is exactly the Rule-21 anti-pattern. Revisit in v0.2 when at least three concrete consumers exist.

**Trigger to revisit:** when ≥3 features want to subscribe to the same lifecycle event, lift the pattern.

#### D2. Subagent batch+planner pattern

**Why defer:** Rule 21 explicitly pins parallel-provider surface to measurable effect. The Researcher phase-tail and parallel builder candidates are deferred until M16+ already. gptme's batch pattern (`subagent_batch` → `subagent_wait`) is a clean pattern to lift *when we get to it*, not before.

**Trigger to revisit:** when M14.x or later proves Reviewer panel needs concurrent execution, port gptme's executor/planner pattern as the implementation.

---

### Reject (5) — category mismatch or rule conflict

#### R1. Lessons keyword/tool auto-injection

**Why reject:** Rule 16 mandates universal anti-slop rules + per-persona prompts. Auto-injecting context based on conversation keywords undermines deterministic phase prompts. Skill bundles already exist in agentpacks. The lessons format would compete with both.

#### R2. Plugin entry-points (Python packages)

**Why reject:** Rule 20 — one authority per milestone. Plugin systems are an authority on extension surface and bring scope creep. agentpacks already cover the bundling need.

#### R3. Persistent-agent journal/people/projects (Bob template)

**Why reject:** code-oz is not a personal-assistant runtime. The product thesis is repo-native SDLC. The "AI software company" metaphor frames *roles*, not *individuals with diaries*. Bob's value is real but in a different product.

#### R4. Architect/editor split prompt

**Why reject:** Already structurally present as PLAN→BUILD with separate persona prompts and separate gate signals. Borrowing the gptme prompt template would not add anything.

#### R5. Web UI / REST server / Tauri desktop / ACP

**Why reject:** CLI-only is a deliberate distribution choice. ACP would put code-oz inside Zed/JetBrains as a coding agent peer, which is a different product surface. Out of scope for v0.1 and v0.2.

---

## Why code-oz is more efficient for its target

- **Determinism.** File-based gates → reproducible runs. gptme's chat-loop relies on the LLM ending its reply correctly; code-oz's spine refuses to advance without a schema-valid gate file.
- **Bias mitigation by design.** Cross-family REVIEW + debate runtime + scientist tails turn provider/model bias into a structural property the runtime works around. gptme has one model in the loop; bias is the user's problem.
- **Cumulative cost ceilings.** `budgets.global` reads `events.jsonl` per-call. gptme's `cost.py` is a sidecar; nothing in the loop kills the run when cumulative spend crosses a line.
- **Authority hygiene.** Rule 20 plus Codex pre-design for shared-infra commits caught 12 production bugs in M16 alone. gptme ships features when they're ready; code-oz ships authorities when they're proven necessary.
- **Repo-context as a gate-aware capability.** Selected paths enter the *next* invocation's `ProviderRequest.files`. Audited via `repo_context_searched` events. gptme's RAG/read tool is similar in shape but not part of a gate's preflight.

---

## Why we still want B1-B3

The spine wins on discipline. It does not win on every operational primitive. Autocompact, checkpoint kind-classification, and cross-tool AGENT_FILES ingestion are *defensive* primitives that close real gaps:

- B1 closes the long-multi-phase context-overflow gap.
- B2 closes the crash-during-write recovery gap (between worktree create and gate write).
- B3 closes the brownfield intake gap.

None of them violates Rule 20 (each lands as a single new authority within one milestone) or Rule 21 (each comes with `events.jsonl` measurement).

---

## Open questions for Codex debate

1. Is B1 (autocompact) actually needed when phase boundaries already bound context? Could we instead write a discipline rule "no phase artifact may exceed N tokens" and refuse to advance otherwise?
2. Is B2 (checkpoint) redundant with worktree audit-completeness recovery? Or is the gap real (between worktree create and first gate write)?
3. Is B3 (cross-tool AGENT_FILES) a security issue? `.cursorrules` is essentially executable instruction; do we treat it as trusted input or as user-attestable input requiring a confirm?
4. Should D1/D2 be promoted to "borrow now" because their patterns are mature in gptme and porting later is more expensive than porting now?
5. Did we miss anything? Specifically: gptme's `morph` tool (fast edits) vs code-oz's BUILD edit pattern; gptme's `precommit.py` integration vs code-oz's VERIFY gate; gptme's `eval/` suite vs code-oz's offline test suite.

---

## Verdict

**Code-oz is structurally superior in its domain (repo-native agentic SDLC) and gptme is structurally superior in its domain (general-purpose chat-first agent CLI). The two are not competing.**

### Original recommendation (pre-debate)

Borrow set: 3 (B1 autocompact, B2 checkpoint kind-classification, B3 cross-tool AGENT_FILES). 2 deferred (D1 hooks, D2 subagent batch). 5 rejected.

### After Codex `fix-first` debate

Codex (gpt-5.5 xhigh, thread `019e12ed-4038-7fe2-8800-5520e5f2048a`) flagged three blocking issues in the original recommendation:

1. **B1 prose described the wrong threshold.** gptme uses 50% context + massive-tool-result trigger, not 80%. The full autocompact engine also performs LLM resume summarization and view-branch swaps that violate code-oz's "files in `ProviderRequest.files` are explicit, never silently mutated" discipline. Narrow B1 to a deterministic context-size and compaction-opportunity *probe* only; build a discipline rule ("no phase artifact may exceed N tokens at gate write") first.
2. **B2 borrowed a destructive-restore primitive that does not fit code-oz's worktree-isolation model.** `restore_checkpoint()` calls `git reset --hard` and optionally `git clean -fd`. Code-oz's BUILD already mutates per-run worktrees only — the worktree IS the checkpoint. Demote B2 to a deferred *topology/refusal-diagnostics* borrow.
3. **B3 trusted gptme's load behavior too much.** gptme walks from home to workspace and frames `.cursorrules` / `.windsurfrules` as "MUST follow" instructions. Cross-tool files are not authoritative code-oz policy. Narrow B3 to discovery + explicit AUDIT/DEFINE opt-in with `agent_files_discovered/accepted/rejected` telemetry. No parent/home walk.

Codex also surfaced one strategic miss the briefer missed entirely:

4. **D3 (new): Release/run-quality eval harness.** gptme has a model-leaderboard eval suite (`docs/evals.rst`) with CSV/JSON export and SWE-bench support. Code-oz's offline tests validate orchestration, not live run quality across model/release combos. Add as a deferred borrow until it earns its milestone slot.

### Final borrow set

| Action | Item | Note |
|---|---|---|
| Borrow now (narrowed) | **B1** | deterministic context-size + compaction-opportunity probe only; no LLM summarization, no view-branch swap |
| Borrow now (narrowed) | **B3** | AGENT_FILES discovery + explicit AUDIT/DEFINE opt-in; no home/parent walk |
| Defer | **B2** (renamed) | worktree topology/refusal diagnostics; revisit when audit-completeness recovery measurably fails |
| Defer | **D1** | generalized hook lifecycle |
| Defer | **D2** | subagent executor/planner/batch |
| Defer | **D3 (new)** | release-quality eval harness inspired by gptme evals |
| Reject | R1 | Lessons keyword/tool auto-injection (Rule 16 conflict) |
| Reject | R2 | Plugin entry-points (Rule 20 authority creep) |
| Reject | R3 | Persistent-agent journal/people/projects (category mismatch) |
| Reject | R4 | Architect/editor prompt template (already structurally present) |
| Reject | R5 | Web UI / REST / Tauri / ACP (CLI-only architecture lock) |

### Outcome counts

- 2 narrowed borrows now (B1, B3)
- 3 deferred (B2 demoted, D1, D2, D3 added) — wait, four deferred (B2, D1, D2, D3)
- 5 rejected (R1-R5)

**Total: 2 borrow / 4 defer / 5 reject. Net of one full classification round.**

The Codex debate caught real bugs in the recommendation (wrong threshold prose, restore-semantics mismatch, trust-boundary blind spot, missing eval-harness gap) — the cross-model peer review rule earned its keep again.
