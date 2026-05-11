---
name: comparison-agenticSeek
companion-docs:
  - ../README.md (sessions index + decision values)
  - ../../../CLAUDE.md (influence library; non-negotiable rules)
  - ../../product/AI_SOFTWARE_COMPANY_THESIS.md (product north star)
target: head-to-head against `~/Projects/agents/templates/agenticSeek` (Fosowl, GPL-3.0, GitHub-trending side-project)
status: converged 2026-05-10 — round 3 confirmed 0 deltas from both Opus and Codex
date: 2026-05-10
session: 02
template: agenticSeek
template-commit: HEAD as of 2026-05-10 local snapshot
verdict: YES, with selective borrows (most agenticSeek strengths are off-mission for code-oz; a small number of mechanics are worth absorbing)
---

# Code-Oz vs agenticSeek

## 0. TL;DR

**Verdict: YES — code-oz is the right runtime for its category and is structurally stronger on the SDLC authority mechanics that overlap with agenticSeek** (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`). agenticSeek is still ahead on shipped MCP discovery breadth, local-provider availability, and personal-assistant UX surfaces (voice, browser autonomy, chat front-end). Those areas are not category-defining for code-oz and should not be described as places code-oz is already ahead — they are off-spine borrow candidates or off-mission, which is a category answer, not a "we already win" answer. The Codex round confirmed the category answer holds without a category-defining gap. Four borrow candidates land in section 5 / section 8: **B3 (MCP finder authority)**, **B1 (VERIFY-fail bad-plan telemetry)**, **B4 (local-first OpenAI-compatible provider)**, and a demoted **B2 (advisory DEFINE risk / effort hint)**. Local-first privacy was upgraded from "off-mission" to "demand-gated borrow" after Codex pushback. Each borrow must clear Rule 20 (one new authority per milestone) and Rule 21 (measurable risk-reduction effect) before earning a milestone slot.

agenticSeek is GPL-3.0; per the CLAUDE.md influence-library rule, only patterns are borrowable. No code, snippets, or trained-classifier weights cross the boundary.

## 1. What agenticSeek is

A 100% local-first **personal AI assistant** ("Manus alternative"). Voice-enabled chat front-end, smart agent router, autonomous web browsing with stealth Selenium, code interpreters in five languages, and a planner that decomposes user goals into sub-tasks for specialized sub-agents.

- Stack: Python 3.10, FastAPI (`api.py`), Selenium, Docker, SearxNG, Redis, Ollama / LM Studio / OpenAI-compatible.
- Core surfaces: web search (`SearxNG`), browser automation (`browser.py`, 39 KB), code execution (Bash / Python / C / Go / Java interpreters), file ops, MCP tool finder, voice TTS / STT.
- Planner pattern: single LLM call emits a JSON plan, executor runs each step, planner re-invokes after every step with success / failure feedback and may rewrite the tail of the plan ("dynamic re-planning").
- Routing: trained `AdaptiveClassifier` model on 240 KB of few-shot examples + Bart zero-shot pipeline + complexity classifier; classifies user intent (talk vs. coder vs. file vs. web vs. planner) and difficulty (LOW / HIGH).
- Safety: substring denylist of unsafe commands (`unsafe_commands_unix` ≈ 30 entries; `is_unsafe(cmd)` returns true on substring match — "rm" appears inside "warm" so the model is best described as a hint).
- Memory: conversation array compressed by a LED summarization model; persisted as JSON files keyed by session UUID.
- Project state: side-project, "zero roadmap and zero funding," GPL-3.0.

## 2. The category mismatch is the headline

agenticSeek and code-oz are not in the same product category, even though both are "multi-agent" systems.

| Axis                     | agenticSeek                                    | code-oz                                                                                  |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Category                 | Local personal assistant (Manus alternative)   | Repo-native agentic SDLC runtime                                                         |
| Primary user             | End user with a chat / voice prompt            | Developer (or non-tech user via DEFINE) shipping production code                         |
| Primary surface          | Web UI / CLI chat box                          | CLI binary that drives a phase-graph against a working tree                              |
| Output                   | Files in a workspace + chat answers            | Tagged commit + audit trail under `.code-oz/` + production-ready code in a real worktree |
| Trust model              | "It runs locally so it's safe"                 | "Provider isolation + worktree + permission manifest + cross-family review"              |
| State substrate          | Conversation memory + JSON session dump        | `events.jsonl` + schema-validated gate files                                             |
| Failure mode             | Wrong agent picked, plan mis-parsed            | Gate fails → `NEEDS_INTERVENTION.json` with actionable suggestion                        |
| Concurrency / multi-task | Single user goal at a time                     | Multi-task lifecycle with per-task locks (M16)                                           |

Treating agenticSeek as a feature competitor would mis-aim the comparison. The right question is: **does it solve a problem in the SDLC runtime category that code-oz has not solved**, or does it offer a primitive **that, lifted into the SDLC context, raises the bar measurably**? Most of the answer is no, and the few yes candidates land in section 5.

## 3. Direct overlap matrix

Each row is a mechanic that exists in *both* projects. "code-oz status" is "what we already have"; "verdict" is the disposition under the influence-library borrow rule (no code dependencies; patterns only).

| #   | Mechanic                          | agenticSeek                                                                                          | code-oz                                                                                                                                                          | Verdict                                                                                       |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Multi-agent orchestration         | `PlannerAgent` decomposes goal → JSON plan → per-step sub-agent dispatch; in-memory dict for results | `Phase` graph DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP with file-based gates, M12 company roster, M14 reviewer panel, M15 debate scheduler                           | **code-oz ahead** — agenticSeek has no concept of phases, gates, or cross-family review       |
| 2   | Pass / fail signal between phases | LLM emits "NO_UPDATE" string in free-form text; planner regexes for it                               | `state/GATE_<PHASE>_PASSED.json` validated by `src/state/gates.ts` schemas (CLAUDE.md Rule 1)                                                                     | **code-oz ahead** — Rule 1 explicitly forbids agenticSeek's pattern after the maestro lesson  |
| 3   | Provider abstraction              | Multi-provider via `llm_provider.py`; one provider per session via `config.ini`                      | `IAgentProvider` (M2), capability contract (M11), Codex / Claude / Gemini / xAI adapters; reviewer panel runs simultaneous providers (M14)                       | **code-oz ahead** — first-class cross-family review is the central thesis                     |
| 4   | Cross-family / cross-model review | Absent. Single LLM provider does plan, execute, and self-grade.                                      | M9 cross-family REVIEW; M14 Reviewer Panel v1 (multi-reviewer simultaneous); M10 `requestDebate()`; M15 debate-policy scheduler with budget-aware single-opponent | **code-oz ahead** — this is the product north star (`AI_SOFTWARE_COMPANY_THESIS.md`)          |
| 5   | Re-planning after every step      | Planner re-invoked after **every step** (success or failure) with `(goal, prior_results, this_step_result, success_flag)`; LLM emits `NO_UPDATE` or rewrites the tail. The success-only short-circuit at `planner_agent.py:206-207` is commented out, so re-planning fires unconditionally on every step (`planner_agent.py:299`). | M8 VERIFY → restart-on-fail policy with phase-locked retry; M16 multi-task VERIFY-fail restart cycle (e2e in tests). PLAN is static once its gate passes. | **code-oz ahead in rigor; agenticSeek conflates decomposition failure with implementation failure** — see borrow B1 below |
| 6   | Code execution                    | Per-language interpreter tools that exec blocks parsed from LLM text                                 | Worktree-isolated build (M7) + permission manifest (Rule 9) + BUILD artifact authority (M7)                                                                      | **code-oz ahead on isolation**; agenticSeek is lighter for ad-hoc scripting                   |
| 7   | Safety / sandboxing               | `tools/safety.py`: `is_unsafe(cmd)` returns true if any of ~30 strings appear as substrings in `cmd` | Permission manifest with allowed commands / network / file roots / env vars / timeout / secret access (Rule 9); default = no execution                           | **code-oz ahead** — agenticSeek's substring match is brittle in both directions: false-positives on benign substrings (`rm` inside `warm` blocks `warm`; `git` blocks all git use) and misses shell-level evasions |
| 8   | Memory                            | Conversation list + LED summarization model + JSON session files                                     | `events.jsonl` cumulative event log + per-phase artifact files + run-level resume                                                                                | **code-oz ahead on auditability**; agenticSeek lighter for chat continuity                    |
| 9   | Resume / session recovery         | Reload last session JSON                                                                             | `runId` + idempotent gate writes + `code-oz resume` (Rule 12)                                                                                                    | **code-oz ahead**                                                                             |
| 10  | Budgets / cost control            | None visible; user manages token cost via provider choice                                            | `budgets.global` namespace, `assertWithinBudget` from `events.jsonl` (Rule 19), M13 role-cost policy                                                              | **code-oz ahead**                                                                             |
| 11  | Brownfield mode                   | Implicit — "tell me to do X with files in the workspace"                                             | Explicit AUDIT phase + AUDIT artifact (Rule 14)                                                                                                                  | **code-oz ahead**                                                                             |
| 12  | MCP tool integration              | `mcp_agent.py` + `mcpFinder.py`; agent can search MCP registry for tools                             | `tool_use.repo_context` sub-scope (Rule 18); MCP host pattern borrowed from opencode but not yet shipped                                                          | **agenticSeek ahead in shipped breadth**; see borrow B3 below                                 |
| 13  | Intent classification / routing   | Trained `AdaptiveClassifier` on few-shot examples + zero-shot Bart pipeline + complexity classifier  | Phase taxonomy is fixed; no per-turn intent classifier. Role assignment is hard-coded in personas.                                                               | **agenticSeek ahead in mechanism, but off-mission for SDLC**; see borrow B2 below             |
| 14  | Web browser autonomy              | `browser.py` ≈ 39 KB; Selenium + stealth mode + form-fill                                            | Not present. Repo-native scope.                                                                                                                                  | **off-mission** — see section 6                                                               |
| 15  | Voice (TTS / STT)                 | TTS + STT + trigger word ("Friday")                                                                  | Not present.                                                                                                                                                     | **off-mission**                                                                               |
| 16  | Web frontend                      | React frontend + FastAPI backend + Docker compose                                                    | CLI binary only; W3-lite ships native macOS / Linux binaries                                                                                                     | **off-mission for v0.1**; revisit if non-tech-user DEFINE flow needs a GUI                    |
| 17  | Local-first / private             | Strong claim; runs on Ollama / LM Studio with zero outbound calls                                    | Provider-agnostic via `IAgentProvider`; xAI direct HTTP adapter (PE-1); local provider would just be another `IAgentProvider` impl                               | **code-oz architecturally compatible; not yet shipped**; see borrow B4 (deferred / demand-gated) |

Score (qualitative, not arithmetic): under the SDLC-runtime category frame, code-oz is stronger on the core authority mechanics — gates, cross-family review, worktree isolation, audit state, resume, brownfield handling, and budgets. agenticSeek is ahead on shipped MCP discovery breadth and local-provider availability; browser autonomy, voice, chat front-end, and memory-compression-as-canonical-state remain off-category for v0.1 rather than scoreable SDLC gaps. Privacy was reclassified after the Codex round from off-mission to demand-gated borrow B4.

## 4. Where code-oz is structurally better — and why

The four claims below are the load-bearing differentiation. Each maps to a non-negotiable rule in CLAUDE.md.

1. **File-based gates with schema validation.** Rule 1. agenticSeek parses LLM text for "NO_UPDATE" to decide whether the plan is done. We wrote that exact pattern into the maestro lesson and refused to repeat it. Schema-validated gate files are inspectable, replayable, and never lie about pass / fail because the model said the right keyword.
2. **Cross-family review at REVIEW gate.** Rule 2 + M9 + M14. agenticSeek's single-provider self-grading is the canonical failure mode our product thesis attacks (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`: "provider and model bias are real"). Our reviewer panel and debate scheduler are direct mitigations.
3. **Worktree-per-run isolation + permission manifest.** Rule 9 + M7. agenticSeek runs `BashInterpreter` against the host shell with substring-denylist safety. We isolate builds in a worktree, gate every command behind a manifest that names allowed commands / network / file roots / env vars / timeout / secret access, and fail closed.
4. **Run-level budget enforcement.** Rule 19 + M13. agenticSeek has no concept of cumulative spend; the user is responsible. We enforce `maxTurns` / `maxProviderCalls` / `maxTokensEstimate` / `maxWallTimeMinutes` from `events.jsonl` per call, soft-warn at 0.75 of budget, hard-kill at 1.0, and emit `NEEDS_INTERVENTION` with an actionable suggestion. Multi-task budgets per M16 default config.

## 5. Borrow candidates

Each is a *pattern* (not code), with milestone disposition. None of these is granted a milestone yet — Rule 20 (one new authority per milestone) and Rule 21 (no new parallel-provider surface without measurable risk-reduction effect) gate that decision. They are entered as candidates for ROADMAP review.

**Final ranking after Codex round** (see § 8 for full re-rank rationale):

1. **B3 — MCP finder authority** — promoted; demand-gated; needs its own gate, not a `tool_use.repo_context` extension.
2. **B1 — VERIFY-fail bad-plan telemetry** — narrowed to telemetry only; no gate artifact, no plan mutation.
3. **B4 — local-first OpenAI-compatible provider** — privacy framing upgraded; demand-gated to PE-2.
4. **B2 — DEFINE risk / effort hint** — demoted; advisory only; `suggested_path` framing dropped.
5. ~~Substring denylist sandbox~~ — killed (see § 6).
6. ~~Memory compression as canonical state~~ — killed (see § 6).

### B1. Lightweight dynamic re-planning telemetry inside the existing VERIFY → BUILD restart cycle

**Pattern:** agenticSeek's planner re-runs after every step with `(goal, prior_results, this_step_result, success_flag)` and is allowed to rewrite the tail of the plan. The rewrite is bounded ("Make the plan the same length as the original one or with only one additional step. Do not change past tasks." — `planner_agent.py:221-222`).

**Code-oz today:** M8 has restart-on-fail; M16 wired multi-task lifecycle. The current cycle restarts the *current task* but the orchestrator-level plan is static once PLAN passes its gate.

**Borrow:** at VERIFY-fail, log telemetry tied to `(failure_class, task_id, attempt_count, repeat_failure_flag)` inside the existing VERIFY-fail / restart-on-fail surface. Do not emit proposed tail diffs, do not create a gate artifact, and do not grant plan-mutation authority. The signal we are building is "repeated restarts under the same failure class indicate the plan is wrong," not "let the planner edit itself."

**Disposition:** candidate for a future milestone behind M16 stabilization. Must clear Rule 21 (measurable: does plan-revision telemetry reduce VERIFY-fail loops vs. baseline?). Off the critical path for v0.1.

### B2. Intent / complexity classifier as a routing input — not a phase replacement

**Pattern:** agenticSeek's `AdaptiveClassifier` predicts both the right agent and the difficulty of a request; the planner uses both signals to decide whether to invoke the planner at all (LOW complexity bypasses planning entirely).

**Code-oz today:** every run goes through DEFINE → PLAN regardless of complexity. For trivial tasks this is overhead; for non-tech users it is welcome rigor. There is no graceful "fast path" for "fix this typo" requests.

**Borrow:** an *advisory* DEFINE risk / effort hint that records expected complexity, likely tool needs, and operator attention points. It must not emit `suggested_path`, imply abbreviated / direct flow, or affect whether DEFINE, PLAN, VERIFY, or REVIEW runs. Phase-collapse — if it is ever proposed — is a separate Rule-20 decision, not a side-effect of this hint.

**Disposition:** candidate, but the *trained classifier* itself is not borrowed; we would use the existing provider on a structured prompt with a 5-shot example block. Risk-reduction claim must be measured before promotion.

### B3. MCP finder authority (MCP-tool discovery sub-agent)

**Pattern:** agenticSeek has a `mcpFinder.py` tool that lets an agent search a registry for an MCP server that fits the current task and dynamically install it.

**Code-oz today:** Rule 18 defines `tool_use.repo_context`; MCP host integration was borrowed from opencode but not yet shipped. The "discovery" half is absent.

**Borrow:** a distinct MCP tool-adoption authority — *not* an extension of `tool_use.repo_context`. A permitted shipped role may propose a pinned MCP server during PLAN, with adoption captured in the artifact as a structured record: server identity, pinned version, declared capability set, allowed file-roots, network surface, env-var / secret access, and an explicit re-approval requirement on any of those changing. Operator approval at install time is necessary but not sufficient; the harder failure mode is post-approval drift via server update, transitive tool addition, or registry compromise under a trusted name. Network access denied for the finder tool itself. Researcher is a deferred role under the M12 roster decision; B3 must not implicitly require Researcher to ship.

**Disposition:** candidate, lower priority than M14 / M15 stabilization. Rule 21 review: measurable benefit only when an MCP-tool gap is repeatedly hitting `NEEDS_INTERVENTION`.

### B4. Local-first OpenAI-compatible provider (demand-gated; privacy framing upgraded after Codex)

**Pattern:** agenticSeek runs against Ollama / LM Studio over an OpenAI-compatible HTTP surface. Useful when the developer wants zero outbound calls.

**Code-oz today:** PE-1 already lifted us into HTTP-direct territory with xAI. A local OpenAI-compatible adapter is a small additional `IAgentProvider` that reads a base URL.

**Borrow:** add a generic `LocalOpenAIProvider` adapter behind PE-roadmap. Demand-gated per the xAI roadmap precedent (multi-cloud deferred to v0.2). No special-casing in the spine; it is just another `IAgentProvider`. Generic OpenAI-compatible only — Ollama / LM Studio specific quirks are deferred unless the provider capability contract cannot express them.

**Disposition:** candidate for PE-2 if a user demand checkpoint hits. Codex round upgraded the framing: privacy is a real adoption / trust property for proprietary repositories and secret-bearing worktrees, not branding. Rank above pure-UX borrows. Rule 21 measurement: zero outbound provider file payloads in `events.jsonl` and provider previews for the targeted role(s); gate completion rate, VERIFY pass rate, and REVIEW quality stay within tolerance of the cloud baseline. If a local model cannot clear a role's capability check, the adapter remains available only for roles it can actually satisfy.

## 6. Off-mission patterns (deliberately not borrowed)

| Pattern                   | Why off-mission for code-oz                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Voice (TTS / STT)         | Repo-native SDLC runtime is not a personal-assistant chat surface. Voice is a UX feature for a category we are not in.                                                                                                   |
| Browser autonomy          | Out-of-scope. If a phase needs web research, we delegate to a provider with a browsing tool — we do not own the browser.                                                                                                 |
| React + FastAPI front-end | The CLI is the v0.1 surface. W3-lite ships native binaries. A GUI may matter later for non-tech-user DEFINE, but it is a separate product surface and agenticSeek's chat-centered shape is not the right pattern.        |
| Manus-alternative pitch   | Misframes the runtime as a personal AI. The product north star is "AI software company," not "AI butler."                                                                                                                |
| Memory compression as canonical state | A LED summarizer over conversation history is fine for chat UX. For code-oz it would replace inspectable, replayable `events.jsonl` + phase artifacts with model-compressed state — the opposite of audit-friendly.      |
| Substring denylist sandbox | Brittle in both directions and (Codex caught) the upstream file has a missing-comma bug producing the unintended token `route--force` on line 31. Survives only as a negative test corpus for permission-manifest validation. |

**Privacy moved out of this table.** The earlier draft listed local-first / private as off-mission; Codex argued — correctly — that for proprietary code and secret-bearing worktrees, "zero outbound provider traffic" is a real adoption / trust property. It is now a demand-gated borrow (B4) in section 5, not an off-mission item.

## 7. Open questions (resolved in round 1)

The seven open questions and three bonus questions in [codex-briefing.md](codex-briefing.md) were answered in the round-1 response and integrated in § 8. They are retained below for transcript continuity but are *not* active uncertainty. Remaining uncertainty is limited to Rule 20 / Rule 21 promotion criteria for B1–B4, which is a ROADMAP question, not a comparison question.

1. **Is the verdict ("YES, with selective borrows") the right shape?** Specifically, does agenticSeek demonstrate any *category-defining* primitive that we are calling off-mission but is actually load-bearing for the SDLC runtime?
2. **Borrow B1 (plan-revision telemetry):** is `plan_revision_proposed` a useful event, or is it noise that pollutes `events.jsonl` without a clear consumer? Should it be a gate-file artifact instead?
3. **Borrow B2 (advisory complexity classifier):** does an advisory classifier at DEFINE risk training operators to skip phases by default? Is the abbreviated-path concept compatible with Rule 20 (one authority per milestone)?
4. **Borrow B3 (MCP finder sub-scope):** what is the failure mode if an operator approves an MCP server that subsequently turns malicious? Does the sub-scope need a stronger trust boundary than the base `tool_use.repo_context`?
5. **Borrow B4 (local-first provider):** is a generic `LocalOpenAIProvider` enough, or does Ollama-specific behavior (model pulls, GPU memory negotiation, function-calling format quirks) merit a dedicated adapter?
6. **Routing trade-off:** agenticSeek picks the agent *per turn*; we pick the role *per phase*. Are we leaving capability on the table by not routing per turn within a phase (e.g. Reviewer-panel slot selection)?
7. **Safety differential:** would the substring denylist *plus* our permission manifest be measurably safer than the manifest alone, or is it redundant noise that would just produce false positives?

## 8. Synthesis (post-Codex round)

The Codex round was substantive and forced four real changes. Codex agreed the verdict shape is directionally right but pressure-tested several specific claims and produced load-bearing pushback. Reading order: [codex-briefing.md](codex-briefing.md) → [codex-response.md](codex-response.md) → this section.

### Where Codex pushed back successfully (changes accepted)

1. **Verdict scope correction.** Opus framed code-oz as "ahead on every directly-overlapping mechanic." Codex pointed out this conflates *architecture quality* with *shipped user capability*. agenticSeek does ship a local UI, a local-provider path, browser autonomy, and MCP discovery — even if most of those are off-category. The TL;DR is corrected: code-oz is ahead **on every axis where the SDLC runtime category is the right frame**, which is not the same as "ahead on every user-value surface."

2. **Local-first privacy is closer to a real product surface than the draft admitted.** Section 6 originally listed it as off-mission. Codex argued that for proprietary code and secret-bearing worktrees, "zero outbound provider traffic" is a serious adoption / trust boundary, not a personal-assistant branding hook. **Disposition:** B4 stays demand-gated to PE-2, but ranks above pure-UX borrows; privacy moves from section 6 (off-mission) to section 5 (borrow candidate, deferred but recognized).

3. **B3 (MCP finder) failure mode is post-approval drift, not bad recommendation.** Opus framed the risk as "operator approves a malicious server." Codex named the harder problem: an operator approves a server *once*, then the server updates, drifts, or is compromised, gaining new abilities (file read, network, secret access, repo edit) under a trusted name. `tool_use.repo_context` is *not* an adequate analogy; the new authority needs identity / version / capability / file-root / network / env-var / re-approval semantics. **Disposition:** B3 promoted to rank 1 *if* MCP-tool gaps repeatedly drive `NEEDS_INTERVENTION`. Sub-scope must be a real new tool-adoption authority, not a `repo_context` extension.

4. **B2 (complexity classifier) evidence is weaker than the draft implied.** Codex inspected agenticSeek's few-shot labels and observed that "Debug this JavaScript code that's not running properly," "Make a snake game in python," and similar non-trivial coding tasks are labeled `LOW`. Mapping that pattern to abbreviated SDLC flow would be dangerous. **Disposition:** B2 demoted; if it survives at all it is a *risk and effort hint* surfaced in DEFINE artifacts, never `suggested_path: full | abbreviated | direct`. Phase-collapse becomes a separate Rule-20 decision later.

5. **Safety substring denylist is killed as a borrow.** Codex flagged that the agenticSeek `safety.py` file has a missing comma between `route` and `--force` (line 31 of the file), producing the unintended single token `route--force`. Beyond the bug, the denylist would false-positive on substrings (`rm` matches `warm`), miss shell-level evasions, and block broad categories like `git`. **Disposition:** killed as a runtime safety layer. The pattern survives only as a *negative test corpus* for permission-manifest validation, not as defense-in-depth.

6. **Real B1 opening is "evidence that repeated restarts point at a bad plan," not plan mutation.** Opus framed B1 as plan-revision telemetry; Codex sharpened it. agenticSeek conflates decomposition failure (re-planning's sweet spot) with implementation failure (restart-on-fail's sweet spot). Code-oz is rigorous about the second and arguably blind to the first. **Disposition:** B1 narrows to telemetry tied to `(failure_class, task_id, attempt_count, repeat_failure_flag)` inside the existing VERIFY-fail surface — never a gate-file artifact, never plan mutation authority.

7. **GPL-3.0 reinforces the influence-library rule.** Codex noted agenticSeek's license. The CLAUDE.md influence rule already says "patterns only, no code dependencies, no submodules, no copy-paste." GPL-3.0 makes that rule load-bearing in the legal sense too: any direct copy would licence-infect code-oz. Section 6 of this doc and the comparison index now carry a one-line license note.

### Where Codex agreed (claims that survive intact)

- Per-turn routing should not become a general runtime pattern. Phase-bound role assignment is what makes artifacts auditable. The interesting opening is *decision telemetry* (why this reviewer / debate opponent was picked) inside the *existing* panel and scheduler authority.
- Memory-compression-as-canonical-state is a hard no. A derived summary may become useful as a context-budget optimization later but must never replace `events.jsonl` or phase artifacts.
- Front-end is off-mission for v0.1 but not forever. A GUI for non-tech-user DEFINE is a legitimate product-surface ROADMAP candidate; agenticSeek's chat-centered UI is the wrong pattern to borrow.

### Final ranked borrow list

| Rank | Borrow | Disposition | Rule 21 measurement |
|------|--------|-------------|---------------------|
| 1 (conditional) | **B3 — MCP finder authority** *(promoted from rank 3, conditional on MCP-gap evidence)* | Demand-gated. Promotion to rank 1 fires only once repeated `NEEDS_INTERVENTION` events caused by missing MCP tools cross a measurement threshold; until then, B3 ranks below B1 telemetry. Distinct tool-adoption authority — not a `tool_use.repo_context` extension — with identity / version / capability / file-root / network / env-var / re-approval semantics. Off the spine; uses its own gate. | Repeated `NEEDS_INTERVENTION` from missing tools drops; permission denials, unexpected network attempts, secret-access attempts, and operator re-approval events stay bounded and auditable. |
| 2 | **B1 — VERIFY-fail bad-plan telemetry** *(re-scoped from "plan-revision telemetry")* | Telemetry-only inside the existing VERIFY-fail / restart-on-fail surface. No gate artifact. No plan mutation. | Repeat-failure reduction by failure class; fewer attempts-to-ready after first VERIFY fail; fewer cap-exhaustion interventions per comparable task. |
| 3 | **B4 — local-first OpenAI-compatible provider** *(privacy framing reinforced)* | Demand-gated to PE-2. Generic adapter, not Ollama-specific. Privacy is a real adoption / trust property, not branding. | Zero outbound provider file payloads for the targeted role(s); gate completion rate, VERIFY pass rate, and REVIEW quality stay within tolerance of the cloud baseline. |
| 4 | **B2 — DEFINE risk / effort hint** *(demoted; `suggested_path` framing dropped)* | Demand-gated and *advisory only*. No phase-collapse semantics. Hint surfaces inside DEFINE artifacts; operator decides. | Reduced abandoned runs or operator-override friction with no increase in VERIFY failures, REVIEW findings, or post-ship corrections vs. full-spine baseline. |
| — | ~~Safety denylist~~ *(killed)* | Not a runtime borrow. Allowed only as a negative test corpus for permission-manifest validation. | n/a |
| — | ~~Memory compression~~ *(killed)* | No summarizer as canonical state. Reconsider only as a context-budget optimization with strict measurement. | n/a |

### Blind spots that survived the round

- **License reminder:** agenticSeek is GPL-3.0. Patterns are borrowable; code, snippets, embeddings of the trained classifier weights, and any vendored fragments are not. This restates the CLAUDE.md influence-library rule with legal teeth.
- **Architecture-quality vs. shipped-capability framing:** Section 3 of the matrix is unchanged structurally, but the column "code-oz ahead" should be read as "ahead under the SDLC-runtime category frame," not "ahead on every dimension a user might care about."
- **No ROADMAP slot is granted by this comparison.** Borrows B1–B4 enter the candidate pool. Rule 20 (one new authority per milestone) and Rule 21 (measurable risk-reduction effect) gate any promotion to a milestone slot.

### Codex debate

- Briefing: [codex-briefing.md](codex-briefing.md)
- Round 1 response: [codex-response.md](codex-response.md) — `gpt-5.5` xhigh, sandbox `read-only`, thread `019e12ac-61a1-73c1-afca-3cf6c3cc754c`.
- Round 2 deltas (Codex): [round2-codex.md](round2-codex.md) — 6 deltas, all integrated.
- Round 2 deltas (Opus): [round2-opus.md](round2-opus.md) — 6 deltas, all integrated. Opus verified two source-fidelity bugs that Codex did not catch (re-planning trigger pattern; verbatim quote drop).
- Round 3 convergence (Codex): [round3-codex.md](round3-codex.md) — verdict `converged`, 0 deltas; thread `019e1323`.
- Round 3 convergence (Opus): [round3-opus.md](round3-opus.md) — verdict `converged`, 0 deltas; re-verified each round-2 delta with line citations.
- Synthesis: this section (§ 8). Round-2 changes: TL;DR reframe, score-line replacement, B1 narrowing, B2 `suggested_path` removal, B3 trust-boundary spec, B3 rank-1 conditional, row 5 trigger correction, row 7 directionality fix, verbatim quote restored, § 7 retirement. Round 3 confirmed full convergence with no material improvements remaining.
