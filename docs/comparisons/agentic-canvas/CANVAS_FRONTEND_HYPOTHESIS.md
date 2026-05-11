# Canvas-as-frontend-to-runtime — hypothesis tracker

> **Date opened:** 2026-05-10
> **Origin session:** agentic-canvas comparison, post-Codex round 1 synthesis
> **Doc class:** Hypothesis tracker. **Not** a roadmap commitment.
> **Owner:** maestro (this repo)
> **Companion docs:** `COMPARISON.md` §3.4 + §5, `CODEX_RESPONSE.md` finding "[fix-first] [framing]" + held-back disagreement.

---

## Status

Open hypothesis. **Not** a roadmap item. Tracked separately from the §3.4 step 1 read-only viewer (`code-oz view <runId>`), which **is** a concrete v0.3+ deliverable that depends on the `RunSummary` derived read-model (§3.2) being shipped first in v0.2 milestone A.

This doc exists so the convergence path Codex flagged in round 1 does not get lost in the COMPARISON's action list, and so any future activation has a written contract for what the hypothesis is, what would falsify it, and what guardrails apply.

The default state of this hypothesis is **dormant**. Activation requires written evidence against the trigger criteria below.

---

## Hypothesis statement

A canvas-style frontend that consumes the `RunSummary` derived read-model (§3.2) and offers human-edit-the-plan affordances *before* the next BUILD attempt becomes a UX moat for code-oz, eclipsing pure-CLI usability for the inspect-and-reshape-the-plan loop without compromising governed-runtime authority.

The claim has two halves and both must hold for the hypothesis to be worth activating:

1. **Usability claim:** for the specific loop of inspecting a plan, spotting a problem, and reshaping it before the next BUILD attempt, a canvas-style frontend is materially easier than the CLI.
2. **Authority-preservation claim:** the canvas can deliver that usability without becoming a parallel runtime, without writing gate files, and without bypassing the binary's authority over phase advancement.

If either half fails — if the canvas is not measurably easier, or if it cannot stay subordinate to the binary — the hypothesis is disconfirmed and the doc is closed.

---

## Origin

The convergence path was surfaced as a Codex round 1 finding on the `code-oz vs agentic-canvas` comparison.

**Codex finding (fix-first, framing):**

> "Different categories is honest but incomplete. The category distinction is real: code-oz is a repo-native SDLC runtime; agentic-canvas is a visual workflow contract/editor. But agentic-canvas explicitly targets 'see the plan -> edit the plan -> save the plan -> run the plan,' so a canvas-as-frontend-to-code-oz future is a plausible convergence path, not just adjacent trivia."
> — `docs/comparisons/agentic-canvas/CODEX_RESPONSE.md` §2

**Held-back disagreement (Codex round 1):**

> "I almost pushed harder against 'code-oz already exceeds' because adoption can beat architecture. code-oz is clearly stronger as a governed runtime, but agentic-canvas is closer to where humans inspect and reshape plans. If code-oz stays CLI-only too long, the technically superior system may still feel less usable than a weaker visual contract."
> — `docs/comparisons/agentic-canvas/CODEX_RESPONSE.md` §4

The synthesis in `COMPARISON.md` §3.4 split the borrow into two steps: step 1 is the read-only viewer (a real v0.3+ deliverable), step 2 is this hypothesis. Section 5 of the same comparison surfaces the adoption-vs-architecture risk that this hypothesis is the second-line mitigation for; the first-line mitigation is skill-wrapper distribution (§3.3).

This doc is step 2 of that split.

---

## What "canvas-frontend" would mean

A concrete sketch — used for shared vocabulary only, not as a design.

- Builds on the §3.4 step 1 read-only viewer (`code-oz view <runId>`) and the §3.2 `RunSummary` derived read-model. The viewer ships first; this hypothesis is what may follow.
- Adds human-edit-the-plan affordances. Candidate edit surfaces (each one independently in scope or out of scope at activation time):
  - Edit `PLAN.md` acceptance criteria visually (the §3.5 typed planning annotations make this tractable).
  - Reorder phases or tasks within the current plan window.
  - Annotate tasks with `riskLevel` (the §3.5 annotation), notes, or recommended tools.
  - Pause the run before the next BUILD attempt and request a re-PLAN.
  - View — not author — the latest `REVIEW.md` or `DEBATE.md` summary.
- Every edit persists as a commit on the run's worktree (M7 isolation), routed through the existing CLI surface as a subprocess exec (`code-oz patch-plan ...` or equivalent). The canvas does **not** call file-write APIs directly.
- The canvas is a **client of code-oz**, not a re-implementation of it. Backend authority remains the binary plus the file-based gates plus the events log.
- Read-only first (the §3.4 step 1 viewer); read-write second (this hypothesis); never bypasses gates, never short-circuits a phase.

The shape is deliberately under-specified. If the hypothesis activates, the activation milestone owns the design. The point of this doc is to lock in what the canvas-frontend is *allowed* to be and what it must never be.

---

## What "canvas-frontend" must NOT mean

The anti-state is load-bearing. These are the constraints that prevent the hypothesis from quietly becoming an authority-creep vector.

1. **It must not re-implement code-oz's runtime semantics.** The canvas does not own a phase FSM, does not own gate logic, does not own debate or review orchestration. Drift between two runtime implementations is the single largest risk this rule prevents. Influence-library rule from `CLAUDE.md`: "Patterns are borrowed; no code dependencies, no submodules, no copy-paste." A second runtime in a browser would violate the spirit even if it never imports a line of agentic-canvas code.
2. **It must not directly write `events.jsonl` or `state/GATE_<PHASE>_PASSED.json`.** Rule 1: file-based gate signals are written by the binary, validated by `src/state/gates.ts` schemas. A UI surface that writes them would silently invalidate the gate contract. All writes from the canvas go through CLI subcommands (subprocess exec), never through direct filesystem calls.
3. **It must not add a new authority domain.** Rule 20: one new authority boundary per milestone. The canvas-frontend reuses BUILD authority, REVIEW authority, plan-edit authority — it does not invent a new domain. If a candidate feature requires a new gate type or a new capability surface, that is a separate milestone, not a canvas extension.
4. **It must not bind to non-loopback.** Rule 13: privacy by default. The canvas binds to `127.0.0.1` only. No `0.0.0.0`, no LAN exposure, no tunnel by default, no auth-token-in-querystring shortcuts. A team-collaboration variant is out of scope and conflicts with Rule 8 (offline FakeProvider determinism) and Rule 13 by construction.
5. **It must not vendor agentic-canvas runtime, Drawflow, html2canvas, Dagre, or ELK as a code dependency.** Influence-library rule applies. Patterns borrowed; libraries not. If the canvas activates and a graph-rendering library is needed, the choice is a separate evaluation against the bundle-size and offline-binary constraints of `bun build --compile`.
6. **It must not silently auto-edit human-authored artifacts.** Edits to `PLAN.md`, `SPEC.md`, `HYPOTHESES.md`, or any other gate-tracked artifact go through explicit user actions with diff preview before commit. No background reconciliation, no auto-apply, no AI-suggested edits applied without confirmation.
7. **It must not become the primary surface.** The CLI is and remains the primary surface. The canvas is a debugging and inspection aid that earns its keep on the inspect-and-reshape loop, not a replacement for `code-oz run`, `code-oz status`, or `code-oz resume`.
8. **It must not break offline determinism.** The §3.4 step 1 viewer is read-only on `127.0.0.1` and serves embedded static assets. The hypothesis variant inherits the same constraint — no CDN, no remote fonts that would block rendering, no telemetry call-home.

---

## Trigger criteria for activation

Specific measurable conditions that, if met, justify lifting this from hypothesis to roadmap. The hypothesis activates on **evidence**, not on vibes, schedule pressure, or a single user request. The Rule 21 discipline check applies: simpler workflows beat complex agent systems unless complexity earns its keep.

Activation requires **at least two** of the following six signals in writing, with **at least one** of them being a post-viewer or edit-specific signal (signal #3 or #4). Codex round 2 pushback (`CODEX_RESPONSE_R2.md` finding 4): the original ≥3-of-6-with-both-friction-signals-mandatory rule was calibrated to almost never fire at v0.2-v0.3 user volume. The recalibration lowers the bar enough that the hypothesis can activate on real evidence from a small early-user cohort, without making activation trivial:

1. **Three or more (≥3)** explicit user-friction reports on text-only status workflow during VERIFY/REVIEW iteration. "Reports" means: a GitHub issue, a structured user-feedback entry under `docs/feedback/`, or a `NEEDS_INTERVENTION.json` carrying a usability-related actionable suggestion. Anonymous chat-thread complaints do not count.
2. **Two or more (≥2)** reported instances of "I gave up reading `events.jsonl` and ran `code-oz reset`" or equivalent abandonment during a live run, captured in user telemetry, handoff feedback, or a `NEEDS_INTERVENTION.json` event with `category: "user_abandoned_run"` or similar.
3. **After the §3.4 step 1 viewer ships (v0.3+)**, two or more (≥2) users explicitly request edit-affordances within 30 days of viewer GA. The request must specify a concrete edit they wanted to make (e.g., "I wanted to fix the acceptance criterion for task T-7 without re-running PLAN").
4. A measurable drop-off rate at the PLAN gate — users abandoning runs before BUILD because the plan is too dense to inspect from the CLI. "Measurable" means observable in `events.jsonl` as a pattern of `phase_entered: "PLAN"` followed by `run_abandoned` or `code-oz reset` without any `gate_passed: "PLAN"` in between, across at least 10 distinct runs from at least 3 distinct users.
5. The §3.5 typed planning annotations (`acceptanceCriteria[]`, `riskLevel`, `recommendedTools[]`, `notes`) ship in the v0.2 series and produce visible CLI rendering pain — e.g., a single `code-oz plan show` output exceeding 200 lines on a representative project, or a documented user complaint that the annotation density is unreadable in plain text.
6. Codex round-N or a future cross-family reviewer independently re-flags canvas-frontend as a UX gap on a comparison or a UX audit, citing this hypothesis tracker by name.

Each signal must be documented in `events.jsonl` (where applicable) or in a dated entry in the decision log below. The point: hypothesis activates on evidence, not on the comfort of a visual surface.

---

## Anti-trigger criteria — when NOT to activate

The Rule 21 discipline check works in both directions. The canvas only earns its keep if it produces measurable risk-reduction or usability gains. These are the conditions under which the doc gets closed without activation.

1. **CLI friction below the threshold.** User feedback over the v0.2–v0.3 window shows the CLI is friction-free for the target persona (the developer running coding agents through an auditable SDLC from their terminal). Canvas-frontend would be premature optimization on a problem nobody has.
2. **The viewer absorbs the demand.** The §3.4 step 1 read-only viewer plus the §3.3 skill wrappers reduce the inspect-the-plan friction below the activation threshold. Read-only inspection plus CLI edits ends up being the equilibrium; edits-from-canvas is solving a problem that no longer exists.
3. **Authority-preservation cost is too high.** Detailed design at activation time shows the subprocess-exec contract for canvas-driven edits requires a new authority domain (Rule 20 violation) or a parallel state surface (Rule 1 violation). The cost of preserving authority discipline outweighs the usability win.
4. **Adoption work landed via other channels.** Skill wrappers (§3.3) plus the typed planning annotations (§3.5) plus marketplace presence delivered the adoption gain Codex's held-back disagreement was worried about, without needing a canvas surface.
5. **Maintenance budget unavailable.** A canvas-frontend is a separate UI codebase to maintain across binary upgrades. If the project does not have the steady maintenance budget for it at activation time, the right answer is to keep the hypothesis dormant.

If two or more anti-triggers fire, the maestro closes this doc with an explicit "disconfirmed" decision-log entry and links the closing evidence.

---

## Risk profile

Five risks, ranked by load-bearing-ness for the authority-preservation claim.

1. **Authority creep — gate-write paths.** The canvas grows direct gate-write paths (e.g., a "mark phase passed" button) and Rule 1 is violated. Severity: critical. Probability if not actively prevented: high — UIs naturally drift toward direct writes for latency reasons.
2. **Bifurcation — two state shapes.** CLI users and canvas users see different state shapes because the canvas re-derives state from `events.jsonl` rather than consuming the canonical `RunSummary`. Severity: high. Probability: medium.
3. **Code dependency — vendoring.** Vendoring agentic-canvas itself, or Drawflow, or another graph library happens because "it would just be faster." The influence-library rule is violated. Severity: high. Probability: medium.
4. **Maintenance cost.** The canvas becomes a separate UI codebase that must be kept in sync with binary upgrades, schema changes, and new contract surfaces. Severity: medium. Probability: high if the canvas ships at all.
5. **Adversarial risk — local file-write parity.** An attacker who can write to `.code-oz` state files can also drive canvas inputs (since the canvas binds to `127.0.0.1`, an attacker with shell access has the same authority either way). Severity: low (the canvas does not expand the attack surface meaningfully). Probability: low. The mitigation is "do not invent a network-exposed variant."

---

## Mitigations (if activated)

Per-risk mitigations. These are pre-committed; the activation milestone inherits them as constraints, not options.

1. **Authority creep — gate-write paths.** All canvas writes route through CLI subcommands via subprocess exec. The canvas process has zero filesystem-write capability against `state/`, `events.jsonl`, or any gate file. Subprocess exec is observable in `events.jsonl` as `cli_invocation` events; an audit query "did the canvas ever bypass the binary?" must be answerable with a single `jq` filter.
2. **Bifurcation — two state shapes.** `RunSummary` (§3.2) is the only state contract the canvas reads. The canvas implements zero state derivation. If a field is not in `RunSummary`, the canvas does not display it. New canvas surface needs ⇒ extend `RunSummary` first, then update the canvas.
3. **Code dependency — vendoring.** No agentic-canvas, no Drawflow, no html2canvas, no Dagre, no ELK as a code dependency. If a graph-rendering library is needed, evaluation is a separate decision against `bun build --compile` constraints. The canvas's static assets are embedded in the binary (no runtime download).
4. **Maintenance cost.** Canvas ships only if the maintenance budget is documented up front: who owns it, how it gets updated when `RunSummary` changes, what the contract-test surface looks like. If those answers are not available at activation time, the canvas does not ship.
5. **Adversarial risk.** Bind to `127.0.0.1` only. No remote-access variant, no port-forward instructions in docs, no auth-token-via-URL shortcuts. The canvas inherits the trust model of the local user account; no expansion.

---

## Open research questions

Eight questions to resolve before activation. None of these is answered today; activation cannot proceed until each has a written answer.

1. **Tech surface choice.** Web canvas (Drawflow-style HTML on `127.0.0.1`), terminal-rich TUI (the opencode pattern), or native macOS/Linux app — which best matches the code-oz user persona? The web option inherits agentic-canvas's design pressure; the TUI option stays close to the binary and avoids a second codebase; the native option costs the most. Default leaning today: TUI, because Rule 8 + offline determinism + no-CDN constraints align naturally with a terminal-rich surface.
2. **Edit semantics.** What subset of `PLAN.md` is editable visually? Acceptance criteria? Phase ordering? Per-task agent assignments? Risk annotations? The minimal viable edit surface is probably "acceptance criteria text" since the §3.5 typed planning annotations make it tractable. Anything beyond that adds authority-preservation cost.
3. **Conflict resolution.** If a run is editing `PLAN.md` while a phase is mid-flight, what happens? Does the canvas refuse the edit until the phase pauses? Does it queue the edit? Does it require explicit `code-oz pause-after-current-phase` before unlocking edits? The conservative answer is "edits are only allowed while the run is paused at a gate boundary," but that constrains the usability claim.
4. **Multi-user.** Single-user local-first only, or does this open the door to team collaboration? Team collaboration conflicts with Rule 13 (privacy) and Rule 8 (offline determinism) by construction. The conservative answer is "local-only forever"; if team collaboration becomes a separate product question, it gets its own thesis doc.
5. **Identity and resume.** Who is the user — the original developer who started the run, or a teammate resuming someone else's run? `code-oz resume` (Rule 12) supports the latter. Does the canvas authenticate identity in any way, or does it inherit the trust model of the local user account? Default leaning: inherit local user account; no canvas-level auth.
6. **Keyboard accessibility.** Visual canvas tools often fail accessibility audits. WCAG 2.2 compliance bar? Keyboard-only navigation? Screen-reader support? If the canvas is a TUI, accessibility comes mostly free; if it is a browser canvas, accessibility costs real engineering.
7. **Mobile and small-form-factor.** Any mobile-friendly variant warranted, or strictly desktop? Default leaning: strictly desktop. Mobile contradicts Rule 13 by construction (no remote access) and the developer-laptop persona.
8. **Versioning.** How does the canvas frontend version against the binary? Single binary that embeds the canvas (canvas updates ship with binary releases)? Separate canvas package (canvas can drift from binary)? The single-binary answer keeps the influence-library and offline-determinism constraints intact; the separate-package answer costs synchronization discipline. Default leaning: single binary embeds the canvas; the canvas surface versions with the binary.

---

## Influence library reference

Specific cross-references for any future activation work. The influence-library rule from `CLAUDE.md` applies: patterns borrowed, no submodules, no copy-paste, no code dependencies.

External templates (in `~/Projects/agents/templates/`):

- **agentic-canvas** — the source pattern for "see the plan → edit the plan → save the plan → run the plan." Read it for vocabulary and UX shape, never for code. Specifically: `README.md`, `CLAUDE.md`, `ROADMAP.md`, `schemas/agent-canvas.schema.json`, `canvas.html`. The `canvas.html` + `scripts/canvas-server.mjs` shape is the reference for what a `127.0.0.1` browser canvas with a Node HTTP server looks like in agentic-canvas. code-oz cannot copy that shape — Rule 8 (`bun build --compile` native binary) and Rule 13 (privacy by default) constrain the equivalent code-oz implementation.
- **opencode** — terminal-rich (TUI) alternative shape. Listed in the influence library for `bun build --compile` distribution and the MCP host/client pattern. Worth re-examining for TUI patterns at activation time.
- **Drawflow** (https://github.com/jerosoler/Drawflow) — the vendored graph-rendering library agentic-canvas uses. Reference only. Never vendored into code-oz. If a graph library is needed at activation time, evaluation is a separate decision against `bun build --compile` constraints.

code-oz contracts that constrain activation:

- `docs/contracts/REVIEW_PANEL.md` — Reviewer panel v1 contract; the canvas displays panel output, never authors it.
- `docs/contracts/WORKTREE.md` — M7 worktree-isolation contract; canvas-driven edits commit to the run's worktree.
- `docs/contracts/PROVIDERS.md` — M11 provider capability contract; the canvas does not invent a new provider surface.
- `docs/contracts/GATES.md` — file-based gate contract; canvas writes never touch gate files directly.
- `docs/contracts/PLAN.md` and `docs/contracts/SPEC.md` — artifact contracts that the §3.5 typed planning annotations extend; the canvas reads these annotations.
- `docs/contracts/DEBATE.md` and `docs/contracts/DEBATE_POLICY.md` — debate runtime; the canvas displays debate state read-only.

code-oz rules from `CLAUDE.md` that constrain activation: Rule 1 (file-based gates), Rule 8 (offline FakeProvider determinism), Rule 13 (privacy by default), Rule 15 (epistemic sidecars at phase gates), Rule 20 (one authority boundary per milestone), Rule 21 (no new parallel-provider surface without measurable risk-reduction effect).

---

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-05-10 | Hypothesis opened, not activated. | Codex round 1 surfaced the convergence path as a "fix-first framing" finding plus a held-back disagreement on adoption-vs-architecture. The §3.4 step 1 read-only viewer ships first as the concrete v0.3+ deliverable; this hypothesis is step 2, deferred to evidence-based trigger. Companion doc: `COMPARISON.md` §3.4 + §5; raw Codex response: `CODEX_RESPONSE.md`; thread `019e12b5-c744-74e3-b1af-7c8d5c04d3c3`. |

Future updates land here as additional rows when triggers fire or are explicitly disconfirmed. Each row should cite the evidence (events, feedback files, telemetry queries, or a follow-up Codex round). The decision-log format is intentionally narrow — date, decision, rationale — to keep the trail auditable.

---

## Periodic review cadence

Re-read this hypothesis at every code-oz minor-version bump (v0.2.0, v0.3.0, v0.4.0, …) and after each user-cohort feedback round. If trigger criteria fire, escalate to a roadmap discussion and add a decision-log entry. If anti-triggers accumulate, close the doc with a "disconfirmed" entry and link the closing evidence. Default state remains dormant.
