# Comparison: code-oz vs agentic-canvas

> **Final verdict (post-Codex round 1):** YES — code-oz exceeds agentic-canvas as a governed multi-agent SDLC runtime. The two projects sit in adjacent product categories with one plausible convergence path (canvas-as-frontend-to-runtime). Five narrow patterns are worth borrowing as deferred polish; three are rejected; one previously-rejected pattern was split into accept/reject/defer bins after Codex pushback.
>
> **Date:** 2026-05-10
> **code-oz status (truth source: `package.json`):** v0.17.0-alpha.0, M16 closed, ~3108 tests, post-PE-1
> **agentic-canvas status:** Milestones 0–6 complete, M7 partial (per `progress.md`)
> **Templates rule (`CLAUDE.md`):** "Patterns are borrowed; **no code dependencies, no submodules, no copy-paste**."
> **Process:** Pre-debate draft → Codex `gpt-5.5` xhigh peer review (round 1) → synthesis. Raw Codex response: `CODEX_RESPONSE.md`. Verdict: `agree-with-modifications`.
>
> **Current-status note (2026-06-14):** This comparison is a dated snapshot. code-oz has since moved to the v0.21.x alpha line, ships curl/npm/Homebrew for macOS/Linux, has repo-root Claude Code marketplace metadata, and still does not ship Windows/Scoop.

---

## 0. Doc-rot caveat (Codex finding, fix-first)

While drafting this comparison, Codex flagged that code-oz's canonical docs have drifted four milestones behind shipped reality:

- `package.json` → `0.17.0-alpha.0`
- `CLAUDE.md` line 9 → still says `v0.13.0-alpha.0`, "PE-1 closed", "1983 offline tests"
- `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` → still frames M9/M10 as future in places

This comparison treats `package.json` + the `MEMORY.md` milestone trail (M14/M15/M16) as truth. Updating `CLAUDE.md` + the thesis to match shipped state is a separate backlog ticket — see §7 action 1. The drift does not change the verdict here, but it is real evidence that documentation discipline lagged the milestone cadence after M13.

---

## 1. Category framing — adjacent, with one convergence path

| Axis | agentic-canvas | code-oz |
|---|---|---|
| Product category | Visual workflow contract + editor (DAG) | Repo-native agentic SDLC runtime |
| Primary surface | Browser canvas (Drawflow, vendored) on `127.0.0.1` | CLI + file artifacts (`bun build --compile` native binary) |
| Stack | Vanilla JS + Node HTTP server, no build step | Bun + TypeScript, strict typecheck, FakeProvider for offline determinism |
| User loop | Human draws → agent executes JSON → human reviews claims | Multi-agent orchestrated SDLC w/ debate + reviewer panel + audit trail |
| Phase model | Plan / Execute / Review / Iterate (4) | DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP (6) + brownfield AUDIT |
| State source-of-truth | Single `workflow.json` file (schema v0.4) | Typed FSM + `events.jsonl` + schema-validated `state/GATE_<PHASE>_PASSED.json` files |
| Cross-family review | None (text comments on claims) | First-class — Rule 2 + M14 Reviewer panel v1 (multi-provider, sequential synthesis into one canonical `REVIEW.md`) |
| Debate primitive | None | First-class — M10 `requestDebate()` runtime + M15 Debate-policy scheduler v1 |
| Provider abstraction | Plugin per platform (Claude Code, Codex CLI) interprets JSON | Strict `IAgentProvider` + capability contract (M11) + role-cost policy (M13) |
| Test discipline | Not surfaced | ~3108 offline tests, FakeProvider, e2e via real binary spawn |
| Distribution | Claude Code marketplace + Codex skills + local Node server | Bun-compiled native binary; W3 ⇒ curl/npm/Homebrew for macOS/Linux |
| Maturity | M0–M6 complete, M7 partial, schema v0.4 | M16 closed, 16 milestones + PE-1, v0.17.0-alpha.0 |

The two projects answer different questions today. agentic-canvas asks *"how do humans visually design a DAG that agents can execute?"* — code-oz asks *"how do multiple adversarial agents reach a verifiable, debated, gate-passed software outcome?"*

**The convergence path** (Codex pressure-test, accepted): agentic-canvas explicitly markets a "see the plan → edit the plan → save the plan → run the plan" loop. A future where a canvas-style frontend reads code-oz's run state and offers human-edit-the-plan affordances is not adjacent trivia — it is a plausible UX moat. The framing of "different categories" is honest about today, not predictive about v0.3+. See §3.4 below for the convergence-hypothesis borrow.

---

## 2. Where code-oz already exceeds — ten deep wins

These are mission-level capabilities that agentic-canvas's roadmap does not target.

1. **Cross-family review is mission, not afterthought.** Rule 2 + M14 Reviewer panel v1 require the REVIEW agent to be a different provider family than the BUILD agent, with file-paths-not-summaries handoff (`docs/contracts/REVIEW_PANEL.md`). Panelists run sequentially and synthesize one canonical `REVIEW.md`. agentic-canvas review is free-text comments on claims; no structural family check.
2. **Debate runtime as a first-class primitive.** M10 shipped `requestDebate({ proponent, opponent, topic, files, rounds })` (`docs/contracts/DEBATE.md`). M15 added a policy scheduler that fires debate on cost / disagreement / risk triggers (`docs/contracts/DEBATE_POLICY.md`). agentic-canvas has zero structured argumentation — review notes are text strings.
3. **Provider capability contract + role-cost policy.** M11 introduced a typed capability contract per provider (`docs/contracts/PROVIDERS.md`); M13 introduced role-cost policy under `budgets.global`. agentic-canvas plugins each independently re-interpret agent metadata, with no shared contract.
4. **File-based gate signals (Rule 1).** `state/gates.ts` schemas validate `GATE_<PHASE>_PASSED.json` per phase; never parse LLM text for pass/fail. agentic-canvas has no machine-validated gate — phase progress is inferred from claim status fields.
5. **Worktree isolation per run (M7).** Each run gets its own `git worktree` with audit-completeness recovery for crash-during-recreate (`docs/contracts/WORKTREE.md`). agentic-canvas runs in the user's working directory.
6. **Brownfield AUDIT phase.** Rule 14 + dedicated AUDIT artifact for existing repos; agentic-canvas treats every workflow as greenfield design.
7. **Universal anti-slop rules + maestro discipline.** Rules 16/17 import `src/prompts/universal-rules.md` (10 prohibitions + 10 affirmations) into every persona prompt; the maestro 9-family bug map (`docs/research/01-maestro-rule-checker.md`) is authoritative. agentic-canvas has no persona-prompt discipline encoded.
8. **Epistemic sidecars at every gate (Rule 15).** `HYPOTHESES.md` + `OPEN_QUESTIONS.md` validated by gate-preflight (`src/phases/gate-preflight.ts`); overdue open questions block the gate. agentic-canvas has no equivalent — claims are evidence, not falsifiable predictions.
9. **One-authority-per-milestone discipline (Rule 20).** Each milestone introduces exactly one new gate or capability domain. The pre-debate M7 row that bundled five authorities was caught and decomposed. agentic-canvas roadmap bundles freely.
10. **Run-level budget enforcement (Rule 19).** `budgets.global.{maxTurns, maxProviderCalls, maxTokensEstimate, maxWallTimeMinutes}` with cumulative reads from `events.jsonl` — soft-warn at 0.75, hard-kill at 1.0, with actionable `NEEDS_INTERVENTION.json`. agentic-canvas has no budget surface.

These are not borrowable from agentic-canvas because **agentic-canvas does not have them.**

---

## 3. Borrowable patterns — five narrow, deferred polishes

Each pattern is rated against code-oz invariants and given a milestone target. Patterns 3.1–3.3 were in the v1 draft; **3.4 and 3.5 were added after Codex round 1**.

### 3.1 Typed evidence-claim schema (highest-value borrow)

**What agentic-canvas has.** Each claim carries `evidence[]` of typed entries — `command` / `file` / `diff` / `screenshot` / `test` / `url` / `human_note`. Schema-validated, separately tracked from `review { status, reviewer, reviewedAt, notes }`.

**What code-oz has today.** `events.jsonl` (`src/state/events.ts`, ~99k) records phase events; VERIFY artifact (`docs/contracts/VERIFY.md`) carries proof of build/test/lint. Evidence is stored as free-form Markdown plus typed events, not as a typed-evidence union.

**Why borrow.** Formalizing an `EvidenceClaim` discriminated union — `{ kind: "command" | "file_diff" | "test_result" | "url" | "human_note", payload: ... }` — would tighten VERIFY/REVIEW artifact contracts and unlock cleaner reviewer-panel evidence aggregation. It does not change gate behavior, just typing.

**Cost.** Low. Pure additive schema work in `src/state/schemas.ts`; no new authority. One short milestone in v0.2 series, paired with a VERIFY contract revision.

**Rule check.** Compatible with Rule 7 (artifact contracts in plain Markdown) — typed evidence is a sidecar JSON, the human-readable artifact stays Markdown. Compatible with Rule 20 — single sub-surface (schema), single phase touched (VERIFY).

**Target:** M17 or earliest v0.2 milestone A, paired with §3.2 (`RunSummary`) since both are derived read-models. (§3.4 is the read-only viewer, which is a downstream consumer; not paired with §3.1.)

### 3.2 Read-only `RunSummary` derived read-model (Codex finding, missed-borrow)

**What agentic-canvas has.** Top-level `runs[]` array on the workflow root + roadmap text for execution history. Agents and viewers read `runs[]` as a portable, schema-validated handoff object.

**What code-oz has today.** `events.jsonl` + gate files + run state. All canonical, all queryable, but no portable run-summary object that a viewer, plugin, or handoff surface can consume without reconstructing from events.

**Why borrow.** A derived `RunSummary` (built from events + gate files, never authoritative on its own) would unlock:
- A read-only viewer (§3.4) that does not need to re-parse `events.jsonl`
- Skill wrappers (§3.3) that present run state to Claude Code / Codex without exposing internal event schema
- Future canvas-as-frontend integration (§3.4 step 2) without coupling the canvas to internal state shapes

**Cost.** Low. Pure derivation; no new authority. Paired with §3.1.

**Rule check.** Compatible with Rule 1 (gates remain file-based, `RunSummary` is *derived*, never written before a gate). Compatible with Rule 13 (privacy by default — `RunSummary` redacts secrets via existing `.code-ozignore` pipeline).

**Target:** M17 or W3.x, alongside §3.1.

### 3.3 Lightweight skill-wrapper distribution — promoted to W3.x strategic (Codex finding, scope-creep correction)

**What agentic-canvas has.** Dual marketplace presence — `plugin-claude/` published to Claude Code marketplace, plus `skills-codex/` markdown skills for Codex CLI. Each wraps the same JSON contract.

**What code-oz had at snapshot time.** Native binary distribution was planned around npm/Homebrew/Scoop (W3), with no marketplace presence. Current v0.21.x reality is curl/npm/Homebrew for macOS/Linux plus repo-root Claude Code marketplace metadata; Windows/Scoop is still future work.

**Why this is W3.x, not deferred polish (revised after Codex round 1).** code-oz's binary-first distribution is correct for *authority* — the binary is the single source of truth, gates are file-based, skills cannot bypass them. But *discovery* happens inside the agent surfaces (Claude Code, Codex CLI) where users already live. agentic-canvas demonstrates that even technically superior local tools lose adoption to weaker tools with marketplace presence. The held-back disagreement Codex named ("adoption can beat architecture") makes this strategic, not cosmetic.

**Cost.** Low. Two thin markdown skills + plugin manifests that exec the binary (`code-oz init`, `code-oz run`, `code-oz status`, `code-oz view`). No runtime change.

**Rule check.** Compatible with all rules — skills do not bypass gates, do not add provider behavior, do not embed code-oz logic.

**Target:** W3.x. The binary remains source of truth.

### 3.4 Read-only viewer + canvas-as-frontend integration hypothesis (Codex finding, framing)

**What agentic-canvas has.** `canvas.html` + `canvasctl.mjs open <workflow.json>` boots a Node HTTP server on `127.0.0.1`, renders the DAG with live status, supports save/claim/review through `/api/*` endpoints.

**What code-oz could borrow as hypothesis.** Two shapes, evaluated together:

1. **First step (concrete):** `code-oz view <runId>` boots a read-only browser view of the phase graph + current state + last 50 events from a `RunSummary` (§3.2). 127.0.0.1-only, no write API, no gate-bypass paths.
2. **Second step (hypothesis to track, not commit to):** A canvas-style frontend that consumes `RunSummary` + offers human-edit-the-plan affordances *before* the next BUILD attempt. This would test whether canvas-as-frontend-to-runtime is the UX moat Codex flagged as a convergence path.

**Why borrow as hypothesis.** Pinned in CLAUDE.md Rule 21: *"No new parallel-provider surface lands without a measurable risk-reduction effect."* Same standard applies here: the viewer is a real UX win; the canvas-frontend is a hypothesis until measurable. The pattern is to track it, not implement it speculatively.

**Cost.** Step 1: medium (new CLI subcommand + embedded static assets). Step 2: TBD — should be planned only after step 1 ships and friction is observed.

**Rule check.** Read-only is the load-bearing constraint. Write paths through the viewer would conflict with Rule 1 (gates are file-based, not API-driven). Privacy by default (Rule 13) requires `127.0.0.1`-only bind, never `0.0.0.0`.

**Target:** Step 1 in v0.3+, **depends on §3.2 (`RunSummary`) being shipped first** in v0.2 milestone A. Step 1 ships as its own milestone (not paired with §3.2). Step 2 = `docs/comparisons/agentic-canvas/CANVAS_FRONTEND_HYPOTHESIS.md` open question, no milestone.

### 3.5 Agent metadata fields as typed planning annotations (Codex finding, missed-borrow)

**What agentic-canvas has.** Optional `agent` metadata on each node: `{ role, intent, inputs, outputs, acceptanceCriteria, recommendedTools, riskLevel, notes }`. Permissive (`additionalProperties: true` is intentional in their schema philosophy).

**What code-oz could borrow.** A typed PLAN/SPEC annotation block — `{ acceptanceCriteria[], recommendedTools[], riskLevel: "low" | "medium" | "high", notes }` — surfaced as planning vocabulary in `docs/contracts/PLAN.md` and `docs/contracts/SPEC.md`. **Critically: non-authoritative.** These are annotations consumed by viewers, summaries, and human reviewers; they do **not** loosen the M11 provider capability contract (which remains the only source of truth for what a provider may do).

**Why borrow.** code-oz's PLAN and SPEC artifacts already encode much of this implicitly. Naming them as typed annotations:
- Improves PLAN ergonomics (acceptance criteria become structured, not Markdown prose)
- Gives the viewer (§3.4) something semantic to render beyond status
- Aligns with agentic-canvas's planning vocabulary, easing future canvas-frontend integration

**Cost.** Low. Schema additions to PLAN/SPEC contracts; existing artifacts continue to validate (additive, optional fields).

**Rule check.** Compatible with M11 (capability contract stays strict; annotations are cosmetic). Compatible with Rule 7 (artifacts stay Markdown; the annotation block is plain YAML frontmatter or a small JSON sidecar).

**Target:** v0.2 series, alongside §3.1 (`EvidenceClaim`) since both touch artifact contracts.

---

## 4. Patterns to reject — and one previously-rejected pattern split

### 4.1 Rejected outright

1. **`additionalProperties: true` schema permissiveness for the *provider/capability* surface.** agentic-canvas's schema is intentionally permissive across the board; code-oz's strict capability contract (M11) is the opposite philosophy and intentional. The agent-metadata annotations in §3.5 are the *non-authoritative* slice that can be permissive — the provider capability contract stays strict. Loosening it would silently re-introduce provider drift.
2. **Vanilla JS / no-build runtime.** Different stack lock; Bun + TS + strict typecheck is a load-bearing decision (Rule 8 + offline FakeProvider determinism). Borrowing the no-build philosophy would cost test discipline.
3. **`127.0.0.1` HTTP server as primary runtime.** Conflicts with binary-distribution model (Rule 8 + W3). The viewer borrow in §3.4 is *read-only debugging on a sub-port*, not the primary surface.

### 4.2 Split (was: "11 control-flow primitives rejected outright" — Codex pushback, false-rejection)

The v1 draft rejected all 11 node primitives (`branch` / `merge` / `loop` / `parallel` / `trycatch` / `wait` / `subflow` / `start` / `end` / `generic` / `human`) on Rule 20 grounds. Codex pushed back: the right rejection is "no user-composable executable DAG runtime now," not "these primitives have no value." Revised three-bin split:

- **Reject as executable runtime:** A user-composable DAG that lets users define new control flow at runtime. Bundles 6+ sub-surfaces; violates Rule 20; conflicts with code-oz's phase-FSM model.
- **Accept as read-only viewer taxonomy:** `parallel`, `wait`, `subflow` (and `start` / `end` / `human`) become visualization vocabulary in §3.4's viewer for representing existing code-oz state shapes — e.g., a worktree-isolated builder candidate set is a `parallel` cluster in the viewer, a debate awaiting a verdict is a `wait` node. Zero runtime change.
- **Defer until measurable need:** Executable `parallel builder candidates` (multiple BUILD attempts on the same task with worktree isolation, then canonical-selection on VERIFY). Codex correctly noted this needs manifest equality, worktree isolation, provider/budget preflight, and canonical selection rules — **subflow is only a possible display label, not a solution**. Hold per Rule 21 until measurable risk-reduction effect is on the table.

---

## 5. Adoption-vs-architecture risk (held-back disagreement, Codex round 1)

Codex's held-back disagreement is worth surfacing in the report:

> "I almost pushed harder against 'code-oz already exceeds' because adoption can beat architecture. code-oz is clearly stronger as a governed runtime, but agentic-canvas is closer to where humans inspect and reshape plans. If code-oz stays CLI-only too long, the technically superior system may still feel less usable than a weaker visual contract."

This is the strategic risk to track. The verdict (`YES, code-oz exceeds`) is correct on architecture; it is *contingent* on adoption work landing in W3.x. The skill-wrapper promotion (§3.3) and viewer + convergence hypothesis (§3.4) are the load-bearing mitigations. If neither lands by W3, the comparison should be re-run with adoption metrics included.

---

## 6. Net assessment

code-oz is mission-superior to agentic-canvas across every dimension that matters for agentic SDLC: cross-family review, debate primitives, gate discipline, provider abstraction, budget enforcement, brownfield support, test rigor, and milestone discipline. agentic-canvas is a polished visual surface for a *complementary* product category (workflow design) — with one plausible convergence path (canvas-as-frontend-to-runtime) that code-oz can opt into via the §3.4 hypothesis without importing agentic-canvas's runtime semantics.

Five narrow patterns are worth borrowing as deferred polish. Three patterns are explicitly rejected. One previously-rejected pattern was split into accept/reject/defer bins after Codex pushback.

**Recommended action:** Continue current trajectory. Promote skill wrappers (§3.3) from "post-W3 polish" to W3.x strategic adoption work. File the four other borrows as backlog tickets with milestone targets. Do not interrupt M17 planning.

---

## 7. Action list (post-Codex synthesis)

1. **Doc-rot fix:** Update `CLAUDE.md` line 9 status block + `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` M9/M10 framing to reflect post-M16 reality. Out of scope for this comparison session; file as backlog ticket. *Target: next milestone close-out checklist; add to Rule 0 ("post-milestone doc-rot sweep") if it recurs.*
2. **EvidenceClaim + RunSummary backlog ticket** (§3.1 + §3.2): paired derived read-models, M17 or earliest v0.2.
3. **Skill-wrapper promotion** (§3.3): move from "post-W3 polish" to W3.x; binary remains source of truth.
4. **Viewer step 1** (§3.4 step 1): `code-oz view <runId>` read-only on 127.0.0.1, v0.3+, depends on §3.2 (`RunSummary`) shipped first — ships as its own milestone, not paired.
5. **Canvas-as-frontend hypothesis** (§3.4 step 2): track in `docs/comparisons/agentic-canvas/CANVAS_FRONTEND_HYPOTHESIS.md`, no milestone until measurable need.
6. **Agent-metadata-as-planning-annotations** (§3.5): add to PLAN/SPEC contracts in v0.2, alongside §3.1.
7. **Re-run this comparison post-W3:** if §3.3 (skill wrappers) or §3.4 step 1 (viewer) ship before W3 close, include adoption metrics.

---

## Appendix A — agentic-canvas one-screen brief

- **Mission:** Local-first browser canvas (Drawflow) for designing agentic-coding workflows as DAGs; agents (Claude Code or Codex CLI) consume the resulting JSON and produce evidence-backed claims.
- **Architecture:** Vanilla JS canvas + Node HTTP server on `127.0.0.1`. State is a single `workflow.json` file (schema v0.4, JSON Schema 2020-12). REST API for save/claim/review.
- **Phases:** Plan → Execute → Review → Iterate.
- **Node primitives:** start, end, branch, merge, loop, parallel, trycatch, wait, generic, human, subflow (subflow declared but not yet implemented).
- **Evidence types:** command, file, diff, screenshot, test, url, human_note.
- **Plugins:** `plugin-claude/` (4 skills: plan/execute/review/repair) + `skills-codex/` (5 markdown skills) + `codex-plugin/` (under-developed). Common CLI: `scripts/canvasctl.mjs` (open / validate / new / summarize / claims / export-plan / print).
- **Distribution:** Claude Code marketplace (`mustafaakben/agentic-canvas-claude`) + Codex skills directory + local repo clone.
- **Status:** M0–M6 complete, M7 partial. Validated end-to-end per `progress.md`.
- **Strengths:** JSON-as-contract, evidence-typed claims, no-build philosophy, local-first, dual-marketplace presence.
- **Gaps (per agentic-canvas's own roadmap):** Subflow nesting unimplemented; debate primitives minimal; agent-to-agent data flow only via JSON; canvas UI degrades beyond ~50 nodes; provider drift between Claude/Codex plugin interpretations.

## Appendix B — file inventory at survey

- agentic-canvas root: 8 markdown files (README 12k, CLAUDE 12k, AGENTS 12k, ROADMAP 31k, progress 13k, AGENT-CANVAS 2.1k, SCHEMA 1.8k, USER-GUIDE 1.4k); `canvas.html` 9.1k; `schemas/agent-canvas.schema.json` ~310 lines.
- code-oz: 19 contract docs in `docs/contracts/` (BUILD 24k, REVIEW_PANEL 32k, REVIEW 17k, DEBATE 21k, DEBATE_POLICY 18k, PROVIDERS 12k, COMPANY 18k, WORKTREE 21k, …); 17 phase implementations in `src/phases/` (review.ts 112k, build.ts 33k, verify.ts 34k, plan.ts 32k, …); 198 test files (~3108 tests).

## Appendix C — Codex round 1 summary

- **Verdict:** `agree-with-modifications`
- **Findings:** 5 fix-first (1 doc-rot, 1 framing, 2 missed-borrow, 1 scope-creep), 2 fyi (1 false-rejection, 1 false-borrow), 1 nit (overstated-win on "simultaneous-provider").
- **Outcome:** All 5 fix-first items integrated into this final report; 2 fyis integrated as the §4.2 split and a clarifying note in §3.4; 1 nit applies to `CLAUDE.md` Rule 20 wording, not this report — filed under §7 action 1.
- **Disagreement held back:** "Adoption can beat architecture" — surfaced in §5 as the strategic risk for W3.x.
- **Raw response:** `CODEX_RESPONSE.md`.
- **Thread:** `019e12b5-c744-74e3-b1af-7c8d5c04d3c3`.

A second round of Codex review was subsequently requested on the deliverable bundle (specs B1–B5 + hypothesis tracker + INDEX); see `CODEX_RESPONSE_R2.md` for the raw response and `INDEX.md` § "Codex round trail" for the running tally. The R1 verdict on this comparison report (`YES, code-oz exceeds`) survived intact through R2 and the held-back disagreement is now load-bearing in §5 + the W3.x action list.
