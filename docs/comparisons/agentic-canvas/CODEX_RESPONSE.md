# Codex peer review — code-oz vs agentic-canvas comparison

> **Round 1 — raw response.** Captured 2026-05-10. Model: `gpt-5.5` xhigh, sandbox read-only.
> Thread: `019e12b5-c744-74e3-b1af-7c8d5c04d3c3`. Briefing: `COMPARISON.md` v1 draft (pre-debate).

## 1. Verdict

`agree-with-modifications`

code-oz exceeds agentic-canvas as a governed SDLC runtime. I would not publish the current comparison unchanged: it overstates a few code-oz claims, undersells distribution/UX, and misses two borrowable schema/read-model patterns.

## 2. Findings

**[fix-first] [doc-rot] Status truth is split across files** — `package.json` says `0.17.0-alpha.0`, but `CLAUDE.md` still says `v0.13.0-alpha.0`, PE-1 closed, and 1983 tests; `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` still frames M9/M10 as future in places. The comparison can say code-oz is post-M16 only if it also calls out that canonical docs are stale or updates them before synthesis. Cites: `package.json`, `CLAUDE.md`, `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`, `docs/comparisons/agentic-canvas/COMPARISON.md`.

**[fix-first] [framing] Different categories is honest but incomplete** — The category distinction is real: code-oz is a repo-native SDLC runtime; agentic-canvas is a visual workflow contract/editor. But agentic-canvas explicitly targets "see the plan -> edit the plan -> save the plan -> run the plan," so a canvas-as-frontend-to-code-oz future is a plausible convergence path, not just adjacent trivia. Cites: `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`, `agentic-canvas/ROADMAP.md`.

**[fix-first] [missed-borrow] `runs[]` deserves a read-model ticket** — agentic-canvas already has a top-level `runs` schema slot and roadmap text for execution history. code-oz has stronger `events.jsonl`, gate files, and run state, but no portable run-summary object for a viewer, plugin, or handoff surface. Borrow this as a derived `RunSummary`, not as authority. Cites: `agentic-canvas/schemas/agent-canvas.schema.json`, `agentic-canvas/ROADMAP.md`, `docs/contracts/GATES.md`.

**[fix-first] [missed-borrow] Agent metadata fields are useful if kept non-authoritative** — `recommendedTools`, `riskLevel`, and `acceptanceCriteria` should not loosen M11 provider capability checks, but they map well to PLAN/SPEC/VIEW summaries. Treat them as typed planning annotations or viewer metadata, not provider/runtime permission. Cites: `agentic-canvas/SCHEMA.md`, `agentic-canvas/schemas/agent-canvas.schema.json`, `docs/contracts/PLAN.md`, `docs/contracts/SPEC.md`.

**[fyi] [false-rejection] Rejecting all 11 primitives is too broad** — Adopting the full node taxonomy as executable runtime would violate Rule 20, yes. But the right rejection is "no user-composable DAG runtime now," not "these primitives have no value." `parallel`, `wait`, and `subflow` can be read-only viewer taxonomy or planning vocabulary over existing code-oz state. Cites: `agentic-canvas/README.md`, `agentic-canvas/CLAUDE.md`, `CLAUDE.md`.

**[fyi] [false-borrow] Subflow does not solve parallel builder candidates** — agentic-canvas's own example says subflow is a composition marker, not nested execution. Parallel builder candidates need manifest equality, worktree isolation, provider/budget preflight, and canonical selection rules; subflow is only a possible display label. Cites: `agentic-canvas/workflows/examples/subflow-composition_course-launch.json`, `docs/contracts/WORKTREE.md`, `docs/contracts/REVIEW_PANEL.md`.

**[fix-first] [scope-creep] Distribution asymmetry is strategic, not polish** — agentic-canvas has Claude marketplace install docs plus Codex plugin packaging, even if M7 is partial. code-oz's binary-first path is right for authority, but thin Claude/Codex skill wrappers should move from "post-W3 polish" to W3.x adoption work because discovery happens inside those agent surfaces. Cites: `agentic-canvas/plugin-claude/README.md`, `agentic-canvas/codex-plugin/README.md`, `CLAUDE.md`.

**[nit] [overstated-win] "Simultaneous-provider surface" is imprecise** — M14 is multi-reviewer and multi-provider, but `REVIEW_PANEL.md` says panelists run sequentially and then synthesize one canonical `REVIEW.md`. Say "multi-provider panel surface" unless you mean simultaneous as a logical surface, not concurrent execution. Cite: `docs/contracts/REVIEW_PANEL.md`.

## 3. Recommended next actions

1. Amend `COMPARISON.md` before synthesis: keep the YES verdict, add "runtime-governance axis," and add a doc-rot caveat for stale canonical docs. Target: now.
2. File `EvidenceClaim + RunSummary` as a derived read-model backlog item. Why: it strengthens VERIFY/REVIEW/viewer/plugin surfaces without changing gate authority. Target: M17 or W3.x.
3. Move Claude/Codex wrapper skills earlier than post-W3. Why: agentic-canvas proves discovery/distribution matter even for local tools. Target: W3.x, binary remains source of truth.
4. Split control-flow borrowing into three bins: reject executable DAG runtime, accept read-only visualization vocabulary, defer executable `parallel builder candidates` until measurable need. Target: roadmap note.
5. Track canvas-as-frontend explicitly as an integration hypothesis. Why: it may become a UX moat for code-oz without importing agentic-canvas runtime semantics. Target: v0.3+ viewer exploration.

## 4. One disagreement held back

I almost pushed harder against "code-oz already exceeds" because adoption can beat architecture. code-oz is clearly stronger as a governed runtime, but agentic-canvas is closer to where humans inspect and reshape plans. If code-oz stays CLI-only too long, the technically superior system may still feel less usable than a weaker visual contract.
