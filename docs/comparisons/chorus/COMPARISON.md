# Comparison: code-oz vs Chorus

> **Pre-debate verdict (round 0):** YES — code-oz exceeds Chorus as a governed agentic SDLC runtime. The two projects sit in adjacent product categories with one strong convergence path (code-oz as MCP-served runtime under a Chorus-style collaboration surface). Six narrow patterns are worth borrowing as deferred polish; six are rejected as wrong-stack or wrong-surface; one is staged as a deferred hypothesis.
>
> **Date:** 2026-05-10
> **code-oz status (truth source: `package.json`):** v0.17.0-alpha.0, M16 closed, ~3108 tests, post-PE-1
> **Chorus status (truth source: Chorus `package.json` + CHANGELOG):** v0.7.1, fine-grained agent permissions shipped 2026-05-02 (0.7.0)
> **Templates rule (`CLAUDE.md`):** "Patterns are borrowed; **no code dependencies, no submodules, no copy-paste**."
> **Process:** Pre-debate draft → Codex `gpt-5.5` xhigh peer review (round 1) → synthesis. This file is the v1 draft pre-Codex. Raw Codex response: `CODEX_RESPONSE.md` (after dispatch).

---

## 0. Doc-rot caveat (carried from agentic-canvas comparison, 2026-05-10)

`docs/comparisons/agentic-canvas/COMPARISON.md` already documented that `CLAUDE.md` line 9 says "v0.13.0-alpha.0 — PE-1 closed" while `package.json` is at `0.17.0-alpha.0` (M16 closed). That drift is still present today and applies here too. This comparison treats `package.json` + the `MEMORY.md` milestone trail (M14/M15/M16) as truth. Updating the canonical docs is a separate backlog ticket — out of scope for this session, in scope for the next milestone close-out checklist.

The drift does not change the verdict. It is repeated here only so a Codex reviewer reading this file in isolation does not re-flag it.

---

## 0.5. Codex round 1 dispatch failure + self-verified priors (2026-05-10)

Codex round 1 dispatch hit a transient OpenAI infrastructure failure on both attempts (`remote compaction failed: stream disconnected before completion`, threads `019e12ed-…` and `019e1300-…`). Codex consumed ~237k of 258k context-window tokens reading the draft + cited code; the server-side compaction call that frees space for the final assistant turn died mid-stream and Codex emitted `turn.failed` instead of the structured response. Per dispatcher discipline, no model/sandbox fallback was attempted. See `CODEX_RESPONSE.md` for the failure record and salvaged in-progress messages.

Four priors were salvaged from Codex's between-tool agent messages. The synthesizer (this draft author) verified each against actual code rather than wait for the retry. The priors are honest enough to act on now; round 2 will still re-test them once the compaction service recovers.

**Verified priors (each integrated into the draft below):**

1. **`CLAUDE.md` doc-rot.** Already noted in §0; no change.
2. **§3.3 internal inconsistency.** Confirmed by `grep -n "v0\.3+\|first v0\.2"` on this file: line 143 (in §3.3 itself) said "v0.3+ post-W3" while §5 / §6 / §7 promoted it to "first v0.2 milestone after W3 ships." Reconciled in §3.3 below — promotion stands; the §3.3 target line is updated to match §5 / §6 / §7.
3. **§3.5 partial-overlap.** Confirmed by reading `src/state/events.ts:202–295`: `agent_invoked` events **already** carry `provider`, `model` (M12), `role` (M12 company-role), `tokensEstimate`, `filesSent`, `bytesSent`, `costEstimateUSD` (M13). The original §3.5 borrow ("add provider + model + costEstimate per event") is partially redundant. §3.5 is rewritten below to narrow the borrow to its non-redundant slice: extend the same actor-attribution discipline to *every* event type (debate events, scientist-tail events, gate events, etc.), verified by an `events.ts` validation rule that no event type may emit without an actor binding.
4. **§3.1 borrow shape.** Confirmed by reading `~/Projects/agents/templates/Chorus/src/mcp/tools/public.ts` (29 `server.registerTool` calls, 1060 lines): many "public" tools mutate (comments, notification read-state, elaboration answers, `chorus_create_tasks`, `chorus_update_task`). The Chorus PERMISSIONS doc explicitly acknowledges this gap: "*If you need tighter control (e.g. only PMs create tasks), treat that as a follow-up and add a permission gate on this tool.*" §3.1 below is reframed: the borrow is the **permission-map coverage discipline** (`TOOL_PERMISSIONS` map enforced by a test suite that fails when a new mutating handler is added without a gate) — not Chorus's specific public/gated split, which has known gaps.

**These four priors do not change the YES verdict.** They sharpen three of six borrows. Round 2 (post-retry) may surface additional findings the synthesizer cannot self-discover; the action list (§7) marks every borrow that has seen only one round of self-verification.

---

## 0.6. Codex round-1 retry (R1B) findings — integrated 2026-05-10

The trimmed round-1 retry succeeded (thread `019e1321-4c1b-7833-a20e-6114a68c4bf9`). Verdict: **agree-with-modifications**, 5 findings (2 fix-first, 2 fyi, 1 nit). Raw response: `CODEX_RESPONSE_R1B.md`.

The two fix-first items reshape Phase-2 implementation; both are integrated below in §3.1, §3.3, and §3.5.

| # | Severity | Class | Summary | Reflected in |
|---|---|---|---|---|
| R1B-1 | fix-first | scope-creep | **Reverse the §3.3 MCP server promotion, NOT the agentic-canvas skill-wrapper promotion.** Skill wrappers are thin distribution; MCP server adds runtime authority. Split into read-only-first (demand-gated v0.3+) + write-capable-deferred. Remove `request_review`, `request_debate`, `approve_phase` from the first MCP shape. | §3.3 demoted + split; §5 / §6 / §7 reflect |
| R1B-2 | fix-first | framing | **Don't import Chorus's 5×3 grid as a replacement / wrapper for `AgentPermissions.tool_use`.** code-oz already has `read/write/bash` + `tool_use.{repo_context, write, execute, review_request, debate}` with caps, roots, providers, network, concurrency. A flat `spec:write` / `review:write` grid would duplicate or disagree. The borrow is the **coverage-map discipline** (test-enforced permission inventory) + an **artifact-emitter coverage map**, not a new root model. | §3.1 reframed |
| R1B-3 | fyi | false-borrow | **§3.5 narrowing is correct for `agent_invoked` but "every event must carry actor binding" is too blunt.** Replace blanket statement with an actor-policy table: agent/tool/provider/human events need explicit actor fields; pure orchestrator lifecycle events use an implicit orchestrator category. State precisely which `agent_invoked` fields are required vs optional (required: `agent`, `provider`, manifest, `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`; optional: `model`, `role`, `costEstimateUSD`). | §3.5 framing refined |
| R1B-4 | fyi | framing | §3.1 self-verified prior #4 (Chorus `public.ts` mutating tools) is confirmed; reframe is correct. | §3.1 caveat retained |
| R1B-5 | nit | doc-rot | §3.3 timing contradiction is fixed; remaining `v0.3+` references are historical. Clarify §6 wording to name agentic-canvas's split: skill wrappers → W3.x; viewer → v0.3+. | §6 wording clarified |

**Held-back disagreement (Codex R1B):** Almost rejected the MCP-server borrow outright. Decided not to because multiple comparisons converge on "external agent surfaces need a programmatic way to inspect code-oz runs." The correction is sequencing + write-boundary discipline, not rejection.

**Verdict still YES.** code-oz still exceeds Chorus as governed SDLC runtime. The borrow shape sharpens.

---

## 1. Category framing — different categories, one strong convergence path

| Axis | Chorus | code-oz |
|---|---|---|
| Product category | Multi-tenant browser-based AI+human collaboration platform (AI-DLC harness) | Repo-native agentic SDLC runtime (single-user CLI binary) |
| Primary surface | Web UI (Next.js + React 19 + shadcn/ui) on `localhost:8637` | CLI + file artifacts (`bun build --compile` native binary) |
| Stack | Next.js 15 + Postgres 16 + Prisma + Redis (optional) + Vitest 4 | Bun + TypeScript + strict typecheck + FakeProvider for offline determinism |
| User loop | Multi-human + multi-agent share one Kanban; AI proposes, humans approve | Single-user runs the lifecycle; multi-agent debate + cross-family review run inside the binary |
| Phase model | Idea → Proposal → [Document + Task DAG] → Execute → Verify → Done (AI-DLC, AWS-derived) | DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP (greenfield) + AUDIT (brownfield) |
| State source-of-truth | Postgres tables (21 Prisma models) with `relationMode = "prisma"` | Typed FSM + `events.jsonl` + schema-validated `state/GATE_<PHASE>_PASSED.json` files |
| Permission model | **5×3 permission grid** (resource × action × 5 resources × 3 actions = 15 bits), 3 presets + Custom | Per-agentpack permission scopes (e.g., `tool_use.repo_context.{tools, roots}`); no resource×action grid |
| Agent ↔ runtime transport | Stateless MCP server (`/api/mcp`) with permission-gated tool registration | In-process `IAgentProvider` interface; agents don't see code-oz's runtime via MCP |
| Cross-family review | None — `proposal-reviewer` and `task-reviewer` are read-only subagents but no provider-family check | First-class — Rule 2 + M14 Reviewer panel v1 (multi-provider, sequential synthesis into one canonical `REVIEW.md`) |
| Debate primitive | None | First-class — M10 `requestDebate()` runtime + M15 Debate-policy scheduler v1 |
| Provider abstraction | Plugin per surface (Claude Code, Codex CLI, OpenCode); no shared capability contract | Strict `IAgentProvider` + capability contract (M11) + role-cost policy (M13) |
| Worktree isolation | None | Per-run git worktree (M7) with audit-completeness recovery for crash-during-recreate |
| Brownfield | Not addressed — every project is greenfield | Dedicated AUDIT phase + artifact contract (Rule 14) |
| Test discipline | Vitest, 95% lines / 85% branches threshold, Prisma mocked for service tests | ~3108 offline tests, FakeProvider, e2e via real binary spawn |
| Distribution | npm (`npx @chorus-aidlc/chorus`) + Docker Compose + AWS CDK | Bun-compiled native binary; W3 → npm/Homebrew/Scoop |
| Maturity | v0.7.1, fine-grained perms shipped May 2026 | v0.17.0-alpha.0, 16 milestones + PE-1 |
| Multi-tenancy | First-class (`Company` is the tenant root, all queries scoped by `companyUuid`) | Single-user (no tenant boundary) |
| Real-time UX | Presence indicators, SSE event stream, Kanban animations, Cmd+K universal search | None (CLI only) |
| AI-DLC lineage | Explicit (cites AWS AI-DLC blog + open-source workflows) | Implicit (functionally equivalent phase taxonomy, no citation) |

The two projects answer different questions. Chorus asks *"how do multiple humans and AI agents collaborate visually on the same shared backlog with audit trails and presence?"* — code-oz asks *"how does a single developer get a verifiable, debated, gate-passed software outcome from adversarial agents on their own machine?"*

**The convergence path** (strong, more concrete than agentic-canvas's canvas hypothesis): Chorus already runs an MCP server that permission-gates tools and treats agents as authenticated principals. A future `code-oz mcp serve` that exposes run state + selected actions over MCP would let Chorus (or any MCP-aware client) drive code-oz runs while code-oz keeps file-based gates as authority. This is not adjacent trivia — it is a deployment shape where code-oz is the headless runtime and Chorus (or similar) is the team-facing surface. See §3.6 below.

---

## 2. Where code-oz already exceeds — eleven deep wins

These are mission-level capabilities that Chorus's roadmap does not target.

1. **Cross-family review is mission, not afterthought.** Rule 2 + M14 Reviewer panel v1 require the REVIEW agent to be a different provider family than the BUILD agent, with file-paths-not-summaries handoff (`docs/contracts/REVIEW_PANEL.md`). Panelists run sequentially and synthesize one canonical `REVIEW.md`. Chorus's `proposal-reviewer` and `task-reviewer` are read-only Claude Code subagents — same provider family as the worker, no structural family check.
2. **Debate runtime as a first-class primitive.** M10 shipped `requestDebate({ proponent, opponent, topic, files, rounds })` (`docs/contracts/DEBATE.md`). M15 added a policy scheduler that fires debate on cost / disagreement / risk triggers (`docs/contracts/DEBATE_POLICY.md`). Chorus has zero structured argumentation — review notes are free-text comments on Tasks/Proposals.
3. **Provider capability contract + role-cost policy.** M11 introduced a typed capability contract per provider (`docs/contracts/PROVIDERS.md`); M13 introduced role-cost policy under `budgets.global`. Chorus has no provider-capability surface — each plugin (Claude Code, Codex, OpenCode) re-interprets the agent contract independently.
4. **File-based gate signals (Rule 1).** `state/gates.ts` schemas validate `GATE_<PHASE>_PASSED.json` per phase; never parse LLM text for pass/fail. Chorus's gates are DB rows on Proposal (`status: draft → submitted → approved`) and Task (`status: to_do → in_progress → to_verify → done`); there is no machine-validated gate artifact, and field-level transitions are handler-checked, not schema-validated.
5. **Worktree isolation per run (M7).** Each run gets its own `git worktree` with audit-completeness recovery for crash-during-recreate (`docs/contracts/WORKTREE.md`). Chorus runs in the user's working directory — there is no concept of an isolated workspace per task.
6. **Brownfield AUDIT phase.** Rule 14 + dedicated AUDIT artifact for existing repos; Chorus treats every project as greenfield (Idea → Proposal flow assumes no prior code state).
7. **Universal anti-slop rules + maestro discipline.** Rules 16/17 import `src/prompts/universal-rules.md` (10 prohibitions + 10 affirmations) into every persona prompt; the maestro 9-family bug map (`docs/research/01-maestro-rule-checker.md`) is authoritative. Chorus has skill-level prompts but no persona-prompt-level discipline encoded.
8. **Epistemic sidecars at every gate (Rule 15).** `HYPOTHESES.md` + `OPEN_QUESTIONS.md` validated by gate-preflight (`src/phases/gate-preflight.ts`); overdue open questions block the gate. Chorus has no equivalent — Tasks have acceptance criteria but no falsifiable predictions.
9. **One-authority-per-milestone discipline (Rule 20).** Each milestone introduces exactly one new gate or capability domain. The post-M16 reflection (`feedback_rule20_sharper_application.md` in MEMORY) sharpened the rule to count sub-surfaces, not just labels. Chorus releases bundle freely (e.g., 0.7.0 shipped fine-grained perms + UI picker + DB migration + plugin updates + REST/MCP rewiring in one ship).
10. **Run-level budget enforcement (Rule 19).** `budgets.global.{maxTurns, maxProviderCalls, maxTokensEstimate, maxWallTimeMinutes}` with cumulative reads from `events.jsonl` — soft-warn at 0.75, hard-kill at 1.0, with actionable `NEEDS_INTERVENTION.json`. Chorus has no budget surface.
11. **Cross-model peer review as durable rule.** Every milestone runs a Codex debate at planning convergence + a Codex review at implementation completion (`CLAUDE.md` "Cross-model peer review (durable rule)"). Chorus has no analogous discipline — code review is human + reviewer-subagent only.

These are not borrowable from Chorus because **Chorus does not have them.**

---

## 3. Borrowable patterns — six narrow, deferred polishes

Each pattern is rated against code-oz invariants and given a milestone target.

### 3.1 Permission-map coverage discipline + artifact-emitter coverage map (highest-value borrow; reframed by R1B-2)

**What Chorus has.** A 5×3 permission matrix (`Resource × Action` where `Resource ∈ {idea, proposal, document, task, project}`, `Action ∈ {read, write, admin}`) yielding 15 bits. Three named presets (`developer_agent` / `pm_agent` / `admin_agent`) expand to fixed subsets, plus a `Custom` option. The effective permission set is the union of preset expansion + custom bits, computed once per request via `computeEffectivePermissions(roles, customPermissions)` (`src/lib/authz/permissions.ts`). Tool visibility is gated by `registerPermissionedTool(server, auth, requiredPermission, name, config, handler)` — tools whose required permission is missing are simply absent from the agent's tool list. REST routes use a `requireAgentPermission(permission, handler)` decorator factory.

**The coverage-discipline mechanism.** Chorus's `src/mcp/tools/permission-map.ts` exports a `TOOL_PERMISSIONS` constant mapping every gated tool name to its required `Permission`. The map is **not** consulted at runtime (gates are inlined at each call site so the permission stays visible next to the handler) — it is the **source of truth for tests**. `src/mcp/__tests__/server.test.ts` asserts that every tool registered in `pm.ts` / `developer.ts` / `admin.ts` is listed under the expected permission, and the suite catches drift when someone adds a new mutating tool without a gate. **This coverage test is the load-bearing discipline, more so than the 5×3 grid itself.**

**Honest caveat (verified prior #4 from the failed Codex round 1).** Chorus's own `public.ts` has 29 `server.registerTool` calls including mutating handlers (`chorus_add_comment`, `chorus_create_tasks`, `chorus_update_task`, notification read-state, elaboration answers) — the Chorus PERMISSIONS doc itself acknowledges this gap: *"If you need tighter control (e.g. only PMs create tasks), treat that as a follow-up and add a permission gate on this tool."* The borrow code-oz should make is the **coverage-discipline mechanism + the typed grid**, not Chorus's specific public/gated split, which has known holes that Chorus is still closing.

**What code-oz has today.** `AgentPermissions` (`src/agents/schema.ts:226`) is already a layered model with top-level `read` / `write` / `bash` plus `tool_use.{repo_context, write, execute, review_request, debate}`. Each sub-scope carries its own caps, roots, providers, network, or concurrency rules. **There is no flat resource × action grid here, and adding one would conflict with the existing layered authority** — that was the round-0 misframing R1B-2 corrected. What is genuinely missing: (a) a single test-enforced inventory map asserting that every artifact-mutating call site has a declared scope, and (b) a per-artifact coverage map answering "which role may write `BUILD_REPORT.md` / `VERIFY.md` / `REVIEW.md` / `SPEC.md` / `PLAN.md` / `SCIENTIST.md` / `AUDIT.md`."

**Why borrow (narrowed by R1B-2).** Two separate-but-paired pieces, both small, neither a new root authority model:

1. **Permission-map coverage test** — port Chorus's `TOOL_PERMISSIONS` + test pattern to code-oz. A single source-of-truth map enumerates every privileged tool path in `src/tools/*.ts` (debate-permissions, debate-request, review-request, repo-context, ignore-policy) along with its required scope under `AgentPermissions.tool_use.*`. A test fails if a new tool lands without an entry. **The map is enforced by tests, not consulted at runtime** — gates stay inlined at each call site so the permission stays visible next to the handler. This is exactly Chorus's discipline (`docs/PERMISSIONS.md` §4.1) and is the load-bearing piece.

2. **Artifact-emitter coverage map** — a separate map declaring which role(s) may emit a write-event for each artifact (`SPEC.md`, `PLAN.md`, `SOURCE_CHECK.md`, `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, `SCIENTIST.md`, `HYPOTHESES.md`, `OPEN_QUESTIONS.md`). A test fails if a phase write happens from a role not declared. This catches the exact failure mode the round-0 grid was trying to prevent — a Builder writing `REVIEW.md` because its prompt slipped — without introducing a new root authority that conflicts with `tool_use.*`.

Honest caveat from R1B-4 + the round-0 §0.5 finding #4: Chorus's own `public.ts` has 29 `server.registerTool` calls including mutating handlers (`chorus_add_comment`, `chorus_create_tasks`, `chorus_update_task`, notification read-state, elaboration answers) — Chorus's PERMISSIONS doc itself acknowledges the gap. The **coverage-map discipline mechanism** (test-enforced inventory) is what code-oz should borrow; the specific public/gated split is not.

**Cost.** Low. Two small modules + two test suites. No new root authority model. No conflict with existing `AgentPermissions.tool_use.*`.

**Rule check.** Compatible with Rule 7 (artifacts stay Markdown; the maps are runtime / test concerns). Compatible with Rule 16. Single sub-surface per Rule 20: one new test discipline. Reinforces M11 by making role-vs-provider authority lines visible without duplicating them.

**Target:** v0.2 series, post-W3. Pair with §3.4 (Reversed Conversation) since both are role-discipline borrows.

### 3.2 Per-AC dual-path verification (Builder self-check + Reviewer mark)

**What Chorus has.** `AcceptanceCriterion` is its own Prisma table (`prisma/schema.prisma:242`) with two parallel state machines per row:
- `devStatus` (`pending | passed | failed`) + `devEvidence` + `devMarkedByType` + `devMarkedBy` + `devMarkedAt` — Developer self-check
- `status` (`pending | passed | failed`) + `evidence` + `markedByType` + `markedBy` + `markedAt` — Admin verification

Both paths are independent, both tracked, both surfaced in the UI as separate columns. The dev fills `devStatus` during work; the admin (or admin agent) fills `status` during verify.

**What code-oz has today.** `VERIFY.md` has a single binary `## Verdict` section (`pass | fail`) with one rationale bullet. `SPEC.md` carries acceptance criteria as bullets but they are not structured as per-AC dual-path validations — the verdict is one decision over the whole task.

**Why borrow.** Per-AC dual-path verification turns "did this task pass?" into a per-criterion structured record:
- Builder writes per-AC self-check bullets in `BUILD_REPORT.md` (or a sibling `BUILD_AC.md`).
- VERIFY/REVIEWER independently writes per-AC verdict + evidence in `VERIFY.md`.
- Disagreement at the per-AC level is a stronger debate trigger (M15) than a single binary fail.
- Reviewer panel synthesis (M14) becomes per-AC instead of per-task — finer granularity, fewer "the reviewer agreed but on a different point" failures.

**Cost.** Low to medium. SPEC.md gets a typed-bullet schema for ACs (numbered, stable IDs); BUILD_REPORT.md and VERIFY.md add per-AC sections. No new authority — the gate stays binary at the file level, the per-AC granularity is *inside* the artifact.

**Rule check.** Compatible with Rule 7 (still Markdown). Reinforces Rule 1 (gates remain file-based; per-AC structure tightens what passes). Pairs naturally with §3.5 (RunSummary borrow from agentic-canvas).

**Target:** v0.2 series. Pairs with the agentic-canvas EvidenceClaim borrow — both touch VERIFY/REVIEW contracts.

### 3.3 Stateless MCP server, split into 3.3a (read-only-now) + 3.3b (write-deferred) by R1B-1

**What Chorus has.** `POST /api/mcp` is a stateless MCP endpoint — each request authenticates via API Key and a fresh per-request server instance is built. Tools are registered based on the agent's effective permission set. Agents call MCP tools (`chorus_claim_task`, `chorus_submit_for_verify`, etc.) over HTTP. The MCP server is the agent's only interaction surface for mutating Chorus state.

**What code-oz has today.** No MCP server. Agents are driven by the binary in-process via `IAgentProvider`. Agents talk to **other** MCP servers (Context7 etc.) through their own client; they don't *expose* code-oz state via MCP.

**Round-0 was wrong.** The pre-debate draft promoted a single `code-oz mcp serve` (read + write tools combined) from "v0.3+ post-W3" to "first v0.2 milestone after W3 closes." Codex R1B-1 flagged this as scope-creep: the read surface is a small adoption win, the write surface is a new authority domain that needs its own auth model + write-boundary discipline + a milestone. Bundling them was the same mistake Rule 20 was sharpened to prevent (`feedback_rule20_sharper_application.md`).

**The split (R1B-corrected):**

#### 3.3a Read-only `code-oz mcp serve` (demand-gated, post-W3)

A small read-only MCP surface:
- `code_oz_get_run_state(runId)` — current phase, last gate, open questions
- `code_oz_view_artifact(artifact, runId)` — read-only artifact view (paired with the agentic-canvas RunSummary borrow + §3.5 actor-attribution audit)
- `code_oz_list_runs()` — minimal index

These tools never write state, never trigger phase transitions, never produce gate signals. They are an introspection surface only. `127.0.0.1`-only bind (Rule 13). No new auth boundary — read access maps to existing local-user filesystem auth.

**Target.** Demand-gated post-W3. Don't pre-build; wait for a real driver (an external client wanting to introspect a run). When triggered, this is one small focused milestone.

#### 3.3b Write-capable MCP control tools (deferred, separate milestone, post-3.3a)

The originally-proposed write tools — `code_oz_request_review`, `code_oz_request_debate`, `code_oz_approve_phase` — are deferred. They carry real risks the read surface does not:
- `approve_phase` writes a gate signal — must not bypass the existing approval flow + must integrate with §3.1 coverage discipline.
- `request_review` and `request_debate` invoke M10 primitives that consume budget — needs the MCP-call counter wired into `budgets.global` per Rule 19.
- All three need an auth model (API key per run? per principal? token-scoped?) — a real auth boundary, not just `127.0.0.1` filesystem trust.

Per Rule 20: 3.3b gets its own milestone, after 3.3a has been dogfooded.

**Rule check.** 3.3a is compatible with Rule 1 (read-only, no gate writes). 3.3a is compatible with Rule 13 (`127.0.0.1` only). 3.3b triggers Rule 20 — one new authority domain, its own milestone — and Rule 21 — no new MCP control surface without measurable risk-reduction (so 3.3b stays a hypothesis until 3.3a proves the introspection demand exists).

**Target.** 3.3a: demand-gated post-W3. 3.3b: deferred until 3.3a demand is verified.

### 3.4 "Reversed Conversation" as named philosophy

**What Chorus has.** A named principle borrowed from AWS AI-DLC: **AI proposes, humans verify** (not human prompt → AI execute). The principle is reflected in the workflow shape — Idea elaboration is AI-led Q&A; Proposal is AI-drafted with Admin approval gate; Task acceptance is dual-path verification. The naming is load-bearing — it tells contributors the workflow is intentionally "AI does the proposing" rather than "human does the prompting."

**What code-oz has today.** Functionally equivalent in DEFINE (BA persona runs ask-me-style intent elicitation) and PLAN (Lead persona runs 3-source verification, presents PLAN.md for user approval). But there is no named philosophy; the docs frame it as "phase gates" rather than "reversed conversation."

**Why borrow.** Naming the discipline elevates it. "We use Reversed Conversation in DEFINE/PLAN" is a more durable, transferable principle than "DEFINE has a user-approval gate." It also gives code-oz a clean lineage citation back to AWS AI-DLC, which strengthens the product thesis (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`) without changing any behavior.

**Cost.** Trivial. Documentation-only change — add the principle to CLAUDE.md as a new rule (or to the thesis doc), reference it in DEFINE/PLAN/SPEC contracts.

**Rule check.** Compatible with all rules. Strengthens Rule 7 framing.

**Target:** Next doc-rot sweep (paired with the v0.13→v0.17 status update flagged in §0).

### 3.5 Actor-attribution discipline by event class (narrowed twice: §0.5 prior #3 then R1B-3)

**What Chorus has.** `Activity` is its own Prisma table with denormalized session attribution (`sessionUuid` + `sessionName`). `src/services/activity.service.ts` logs all significant actions. The discipline is uniform per event-class: every Activity row carries the actor for that class.

**What code-oz has today (verified prior #3, refined by R1B-3).** `src/state/events.ts:202–295` and `src/state/schemas.ts` make `agent_invoked` already strong on actor attribution. The exact field-by-field breakdown:

| `agent_invoked` field | Required? | Source |
|---|---|---|
| `agent` (persona name) | required | M4 rule 13 |
| `provider` | required | M4 rule 13 |
| `manifest` (`{ files: [...] }`) | required | M4 rule 13 |
| `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope` | required | M4 rule 13 |
| `model` | optional, validated when present | M12 |
| `role` (company-role) | optional, validated when present | M12 |
| `costEstimateUSD` | optional, validated when present | M13 |

So for the one event type where attribution matters most, code-oz is already at parity with Chorus's Activity. The borrow is narrower than "every event must carry actor binding" (R1B-3 flagged that as too blunt).

**Actor-policy table by event class (R1B-3 corrected shape):**

| Event class | Examples | Actor policy |
|---|---|---|
| Agent invocation | `agent_invoked` | Explicit actor fields (`agent`, `provider`, optional `model` / `role` / `costEstimateUSD`). Already complete. |
| Tool use | `repo_context_searched`, `review_request_*`, `debate_request_*` | Explicit actor field (the agent that requested the tool). Add as optional initially, validate when present. |
| Provider response | `build_provider_recorded`, `verify_provider_recorded` | Explicit `provider` field carrying the responding family. Already partially present. |
| Human gate | `gate_approved`, `gate_rejected` | Explicit `actor: "user"` or `actor: "external"` field. Implicit "the user" was acceptable in v0.1; explicit named actor strengthens audit. |
| Orchestrator lifecycle | `phase_started`, `phase_completed`, `run_started`, `run_completed` | **Implicit `actor: "orchestrator"` is acceptable.** These are housekeeping events with no agent originator. Validation rule should NOT fail when actor is absent for this class. |

The borrow is to formalize this table as a per-class policy in `src/state/schemas.ts` + validation logic, plus an audit helper that lists events whose declared actor field is missing (excluding the orchestrator-lifecycle class).

**Cost.** Low. Schema additions for non-`agent_invoked` event types that need explicit actors + a soft validation rule (warns, doesn't fail) + an audit helper. Required-binding promotion deferred to v0.2 to avoid breaking in-flight `events.jsonl` files.

**Rule check.** Compatible with Rule 1 (events remain the trace; gates remain authority). Compatible with Rule 19. The orchestrator-lifecycle exception keeps the validation rule honest — it doesn't fail on legitimate housekeeping events that have no agent originator.

**Status:** **Implemented in commit `02452a0`** (`feat(events): §3.5 Chorus borrow — uniform actor-attribution discipline for all event types`). +5 tests; 3109 → 3114 pass. Schema additions to `src/state/schemas.ts`; soft validation in `src/state/events.ts`; audit helper in same file; tests in `tests/state-events-actor-attribution.test.ts`. The actor-policy-table refinement above (post-implementation R1B-3 framing) is captured here for future reference; the implementation already uses the soft-validation shape that matches.

### 3.6 Code-oz as MCP-served headless runtime (convergence hypothesis)

**What Chorus demonstrates.** A multi-agent collaboration platform whose primary agent transport is MCP, with permission gating at the tool-registration boundary, works at scale (40+ MCP tools across PM/Developer/Admin surfaces; stateless transport; per-request auth). Plugins for Claude Code, Codex CLI, and OpenCode all consume the same MCP surface.

**What code-oz could become.** Headless runtime exposed over MCP (§3.3) + a Chorus-style collaboration UI as one possible frontend. The frontend does *not* have to be Chorus itself — it can be any MCP-aware client. Code-oz keeps file-based gates as the authority; the frontend is a viewer + driver.

This is more concrete than the agentic-canvas canvas-as-frontend hypothesis because:
- Chorus already proves the MCP-as-runtime-transport pattern works.
- The split is clean: code-oz owns artifacts + gates; the frontend owns presence + Kanban + audit display.
- It does not require code-oz to become a web app — code-oz stays a binary; the frontend is a separate concern.

**Cost.** Hypothesis only. Track in `docs/research/MCP_RUNTIME_HYPOTHESIS.md`. No milestone until §3.3 ships and a real demand signal appears.

**Rule check.** Same as §3.3 — privacy by default, gate writes go through file path.

**Target:** Post §3.3. Hypothesis tracking, not a milestone yet.

---

## 4. Patterns to reject — six explicit rejections

### 4.1 Postgres + Prisma + Redis stack

Chorus runs on Postgres 16 + Prisma + Redis (optional). For a multi-tenant browser SaaS this is correct. For code-oz it is wrong: the binary-distribution model (Bun-compiled native binary, no Node required) + offline FakeProvider determinism (Rule 8) + privacy-by-default (Rule 13) all point to file-based state, not a daemon. Postgres-as-state would force a daemon mode, conflict with the resume model (Rule 12), and add a dependency that the binary can't ship.

### 4.2 Browser-based dashboard as primary surface

Chorus is browser-first (Next.js + React 19 + shadcn/ui). For team collaboration this is correct. For code-oz it is wrong: same reasons as agentic-canvas's `127.0.0.1` HTTP server rejection — conflicts with binary-first distribution. The viewer borrow from agentic-canvas (`code-oz view <runId>` read-only on `127.0.0.1`) is the right amount of browser surface for code-oz; a full dashboard is too much.

### 4.3 Live presence indicators

Chorus's presence system (server-throttled MCP-tool-derived events, SSE delivery, 3s auto-clear, colored borders, agent badges) is genuinely impressive. For a CLI-first single-user tool it is wrong-surface: there are no other humans to be "present to," and the CLI surface does not need real-time activity rendering. The audit trail in `events.jsonl` covers the same need at lower cost.

### 4.4 Polymorphic human/agent assignment

Chorus's `assigneeType: "user" | "agent"` model lets a Task be assigned to either a human or an AI agent. For code-oz this is wrong-domain: the orchestrator runs everything; tasks are never assigned to "the user." User intervention happens at gate approvals, not at task assignment. The Reversed Conversation borrow (§3.4) names the right mental model.

### 4.5 OIDC + SuperAdmin + multi-tenant Company model

Chorus's auth (OIDC for users, API Keys for agents, SuperAdmin via env-based bcrypt, multi-tenant Company root) is right for a hosted SaaS. For code-oz a single-user CLI it is wrong-scale: there is no IdP, no tenant boundary, no admin role distinct from the user. Rule 9 (permission manifest required for `.ts` escape hatch execution) is the right size for code-oz's privilege model.

### 4.6 i18n at the framework level

Chorus uses `next-intl` with mandatory en/zh keys for every user-facing string. For a hosted product targeting a Chinese-language user base this is correct. For a CLI binary with English-only output, this is overhead that does not pay off. If demand emerges, a single `messages/` directory is enough — no framework dependency.

---

## 5. Adoption-vs-architecture risk (carried from agentic-canvas, refined by R1B-1)

The agentic-canvas comparison surfaced a held-back disagreement: *"adoption can beat architecture"* — code-oz is a stronger governed runtime, but if it stays CLI-only too long, weaker tools with marketplace presence may still win usage.

Chorus reinforces this risk from a different angle. Chorus has **three plugin ports** — Claude Code (`public/chorus-plugin/`), Codex CLI (`plugins/chorus/`), and OpenCode (`docs/CONNECT_OPENCODE.md`). The Codex port is intentionally stateless because Codex's hook model lacks `SubagentStart`/`SubagentStop`; Chorus shipped it anyway because *being on the surface where users live* matters more than feature parity.

**The right adoption mitigation is read-only introspection, not write-capable control** (R1B-1 corrected the round-0 promotion). The agentic-canvas comparison's promotion of skill wrappers from "post-W3 polish" to "W3.x strategic" stands — skill wrappers are thin distribution shims and add no runtime authority. The round-0 draft incorrectly extended the same promotion to the full MCP-server-with-write-tools plan. R1B-1 split that into:

- **§3.3a (read-only introspection)** — demand-gated post-W3, no new authority, small milestone when triggered. This is the genuine adoption mitigation.
- **§3.3b (write-capable control)** — its own milestone, deferred until 3.3a proves the demand. This is the new authority domain that Rule 20 + Rule 21 hold back.

So the cumulative-promotion concern from R1B is resolved cleanly: agentic-canvas's skill-wrapper W3.x promotion remains, this comparison's §3.3a is demand-gated post-W3, and §3.3b is a hold-until-measurable.

---

## 6. Net assessment

code-oz is mission-superior to Chorus across every dimension that matters for **single-user governed agentic SDLC**: cross-family review, debate primitives, gate discipline, provider abstraction, budget enforcement, brownfield support, test rigor, milestone discipline, worktree isolation, epistemic sidecars. Chorus is mission-superior to code-oz across every dimension that matters for **multi-human + multi-agent team collaboration**: presence, Kanban, OIDC, multi-tenant, MCP-as-transport, Cmd+K search, document export, structured Q&A elaboration. Neither could replace the other.

Six narrow patterns are worth borrowing as deferred polish (§3.1–§3.5) plus one convergence hypothesis (§3.6). Six patterns are explicitly rejected as wrong-stack or wrong-surface (§4).

**Recommended action:** Continue current trajectory through W3. **§3.3a (read-only MCP introspection) is demand-gated post-W3, NOT promoted to first v0.2 milestone.** §3.3b (write-capable MCP control) is deferred to its own milestone after §3.3a proves demand. The agentic-canvas skill-wrapper W3.x promotion stands as the genuine adoption-discovery mitigation. File §3.1 (reframed as coverage-discipline + artifact-emitter map) / §3.2 / §3.4 / §3.5 (already implemented) as v0.2 backlog tickets. Track §3.6 in a research doc. Clarify §6 wording: agentic-canvas split skill wrappers (W3.x) from viewer (v0.3+); this comparison aligns with that split, not a single-axis promotion.

---

## 7. Action list (post-R1B synthesis)

1. **Doc-rot fix:** Already filed (agentic-canvas §7 action 1). No new ticket.
2. **§3.1 Permission-map coverage discipline + artifact-emitter coverage map** (R1B-2 reframed; NOT a 5×3 grid): v0.2 milestone, post-W3. Implementation slice in this PR is the test-enforced inventory mechanism only; full artifact-emitter map deferred to its own commit.
3. **§3.2 Per-AC dual-path verification:** v0.2 milestone, paired with agentic-canvas EvidenceClaim borrow.
4. **§3.3a Read-only `code-oz mcp serve`:** Demand-gated post-W3. NOT promoted to first v0.2 milestone — R1B-1 reverted that. When triggered, one small focused milestone.
5. **§3.3b Write-capable MCP control tools:** Deferred to its own milestone, post-§3.3a, gated on Rule 21 measurable demand.
6. **§3.4 Reversed Conversation as named philosophy:** **Implemented in commit `2c13ffb`** (this PR).
7. **§3.5 Event actor-attribution discipline:** **Implemented in commit `02452a0`** (this PR). Required-binding promotion deferred to v0.2.
8. **§3.6 MCP runtime convergence hypothesis:** Tracked in `docs/research/MCP_RUNTIME_HYPOTHESIS.md` (this PR, commit `2c13ffb`). No milestone until §3.3a ships and a real driver appears.
9. **Re-run this comparison post-§3.3a:** if read-only MCP introspection lands, include adoption metrics from MCP-client driving.

---

## Appendix A — Chorus one-screen brief

- **Mission:** AI-DLC harness for human + AI collaboration. AI proposes, humans verify (Reversed Conversation). Multi-tenant browser platform with embedded PGlite for single-user mode + Postgres for multi-user.
- **Architecture:** Next.js 15 (App Router + Turbopack) + Postgres 16 + Prisma 7 + Redis 7 (optional, falls back to in-memory). 21 Prisma models. UUID-first. Multi-tenant via `companyUuid`. Service layer: 19 service modules (~9k LOC).
- **Phases:** Idea → Proposal → [Document + Task DAG] → Execute → Verify → Done.
- **Permissions:** 5×3 matrix (idea/proposal/document/task/project × read/write/admin) = 15 bits, 3 presets + Custom.
- **Agent transport:** Stateless MCP server (`POST /api/mcp`), per-request auth via `cho_*` API Key, fresh server instance per request, tools registered by `registerPermissionedTool` if effective permission is present.
- **Sessions:** First-class session lifecycle for sub-agent observability (active ↔ inactive (1h no heartbeat) → closed → reopen → active). Sessions checkin/checkout from tasks.
- **Real-time:** SSE event stream + Redis Pub/Sub multi-instance + presence indicators (server-throttled, 3s auto-clear).
- **Plugins:** Claude Code (`public/chorus-plugin/`) + Codex CLI (`plugins/chorus/`) + OpenCode connector. 7 skills + 2 reviewer subagents.
- **Distribution:** `npx @chorus-aidlc/chorus` (one command, embedded PGlite) + Docker Compose (full stack) + AWS CDK.
- **Status:** v0.7.1, fine-grained perms shipped 0.7.0 on 2026-05-02.

## Appendix B — file inventory at survey

- Chorus root: `CLAUDE.md` (14k), `README` (17k), `CHANGELOG` (28k), `docs/` (44 files including ARCHITECTURE 91k, PRD_Chorus 58k, MCP_TOOLS 60k, PERMISSIONS 12k, AIDLC_GAP_ANALYSIS 38k), `src/services/` (~9k LOC across 19 files), `src/mcp/tools/` (10 files, ~140k total).
- code-oz: 19 contract docs in `docs/contracts/`; 17 phase implementations in `src/phases/` (review.ts 112k, build.ts 33k, verify.ts 34k, plan.ts 32k, …); 198 test files (~3108 tests).

## Appendix C — Codex round 1 dispatch + retry

**Round 1 (R1A) dispatched 2026-05-10, both attempts FAILED.** Threads `019e12ed-52d6-74a3-b648-40b2d071fa45` and `019e1300-4443-76c3-ad82-f68e69a4b73a`. Failure mode: transient OpenAI infrastructure failure (`remote compaction failed: stream disconnected before completion`) at ~237k of 258k context. Per dispatcher discipline, no model/sandbox fallback was attempted.

Four priors were salvaged from Codex's between-tool agent messages and self-verified by the synthesizer (this draft author): `CLAUDE.md` doc-rot, §3.3 internal inconsistency, §3.5 partial-overlap with `agent_invoked`, §3.1 borrow shape. All integrated into §0.5 above. Raw failure record + salvaged messages: `CODEX_RESPONSE.md`.

**Round 1 retry (R1B) dispatched 2026-05-10, succeeded.** Thread `019e1321-4c1b-7833-a20e-6114a68c4bf9`. Trim strategy: scope reduced to four §0.5 self-verified findings + three highest-stakes borrows (§3.1, §3.3, §3.5). Result: **agree-with-modifications**, 5 findings (2 fix-first, 2 fyi, 1 nit). Held-back disagreement: almost rejected MCP-server borrow outright; sequencing fix instead.

R1B's two fix-first findings (R1B-1: reverse §3.3 promotion + split into 3.3a/3.3b; R1B-2: drop "richer grid" framing for §3.1) reshape Phase-2 implementation. Both integrated into §0.6, §3.1, §3.3, §5, §6, §7. The R1B fyi findings (R1B-3 actor-policy table for §3.5; R1B-4 §3.1 caveat confirmation) are reflected in §3.5 framing and the §3.1 caveat retention. R1B-5 nit on §6 wording is reflected in §6 above.

Raw R1B response: `CODEX_RESPONSE_R1B.md`.
