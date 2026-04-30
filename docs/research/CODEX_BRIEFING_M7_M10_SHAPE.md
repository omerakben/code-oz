# Codex briefing — M7–M10 shape and the debate-agent thesis

**Date:** 2026-04-30
**Status:** thesis-level debate (NOT formal M7 implementation briefing — that comes next session)
**Caller:** Claude Opus 4.7 + Ozzy
**Target:** Codex `gpt-5.5` xhigh, sandbox read-only
**Cycle:** session-cycle "plan" phase, before any M7 code

## What you are reading

This is a **thesis-level convergence debate**, parallel to the synthesis-round debate that produced rules 15-19 in CLAUDE.md (`docs/research/CODEX_BRIEFING_SYNTHESIS.md` → `CODEX_RESPONSE_SYNTHESIS.md`). We are not asking you to review M7 implementation choices yet. We are asking you to debate the **shape of the next four milestones** and a **new product-feature thesis** that emerged from a 5-minute conversation between Claude and Ozzy after M6 closed.

If we get the shape wrong here, M7 onward gets harder. If we get the debate-agent thesis right, the project's value proposition shifts.

## Where we stand

`code-oz` is a Bun + TypeScript CLI that boots an adaptive multi-agent software-company simulation over a phase-graph + agentic sub-orchestration spine. v0.6.0-alpha.0 is tagged on `main` locally (not pushed). 783 offline tests pass. Typecheck clean. Binary at `dist/code-oz` reports `0.6.0-alpha.0`.

What works at v0.6:

- DEFINE → PLAN with bundled BA + Lead + Scientist personas, gate signals as schema-validated files (`state/GATE_<PHASE>_PASSED.json`).
- PLAN produces `PLAN.md` + `SOURCE_CHECK.md` + Scientist sidecars (`HYPOTHESES.md`, `OPEN_QUESTIONS.md`); gate-preflight blocks on overdue or blocking-importance open questions.
- Repo-context tools (glob, grep, read) live behind `tool_use.repo_context` permission scope; rg-backed; locked caps (50 results / 16 KB / 20 reads / 5 s timeout / network: 'none').
- `budgets.global` enforces cumulative spend (turns, calls, tokens, wall-time) read live from `events.jsonl`; soft-warn at 0.75 ratio, hard-kill at 1.0.
- Universal rule sheet (20 items: 10 prohibitions + 10 affirmations) injected into every persona prompt.
- M6 review trail: 3 Codex rounds, 8 findings closed (5 block-push, 2 block-next-milestone, 1 partial-fix). Final verdict: push.

What is stubbed:

- BUILD / VERIFY / REVIEW phases.
- Worktree-per-run isolation (Archon-style).
- Scientist phase-tails for BUILD / VERIFY / REVIEW.
- AUDIT (brownfield phase) and SHIP.

The pre-existing M7 plan in `docs/design/ROADMAP.md` bundles BUILD-lite + VERIFY-lite + REVIEW-lite + worktree into a single milestone. **Ozzy is rejecting that bundle.** The proposal in this brief is to split.

## The four decisions on the table

After the briefing, Ozzy gave four answers to four scope questions. Restated:

### Decision 1 — Split-per-milestone

> "Vertical and horizontal scaling is better for the R[eview] context. Split build, split verify, split review, and combine these on our latest commit."

Concretely: M7 = BUILD-lite alone. M8 = VERIFY-lite alone. M9 = REVIEW-lite alone. Each milestone tags its own `vX.Y.0-alpha.0` release on `main`. Each milestone runs the full session-cycle (kickoff → Codex planning debate → implementation → Codex implementation review → tag).

The motivation: the M5/M6 cadence empirically validates that one focused Codex debate per milestone beats one wide debate spanning multiple phases. The Codex review of M6 caught a rule-13 violation (PLAN + Scientist were inlining artifact content into prompts while reporting `agent_invoked.bytesSent: 0` — silent corruption hiding behind passing tests). That find required Codex to actually trace the data flow on a single phase. A bundled M7 review across three phases would be too wide for that depth.

The trade: 3× the Codex round-trips, 3× the kickoff-and-tag overhead, 3× the calendar cost. For a high-stakes app, accepted.

### Decision 2 — Worktree-per-run isolation lands with M7 (BUILD-lite)

> "Archon-like, multi-layered worktree-per-isolation."

BUILD is the first phase where untrusted writes happen (the BUILD agent emits code that later phases compile and test). Without isolation the agent writes into the user's working tree. Archon's pattern (per `templates/Archon/`) is a worktree per `runId`, with cleanup on success and preservation on failure for forensics.

The trade: worktree management adds surface area to M7. Mitigation: lock the contract (`docs/contracts/WORKTREE.md`) before any orchestrator code; reuse Bun's `Bun.spawn` for `git worktree add/remove`; gate on `code-oz doctor` checking `git --version >= 2.40`.

### Decision 3 — VERIFY fail = restart BUILD from scratch

> "If VERIFY fails we should be starting over to process. I think, why is VERIFY important then?"

Ozzy is rejecting the patch-and-retry loop. When VERIFY fails, the run does not enter a soft-heal loop where the agent is fed the failure and asked to patch. Instead: the BUILD output is discarded, the worktree is destroyed, and the next attempt is a clean BUILD with the failure context surfaced as a new constraint in the BUILD prompt.

Hard cap: the existing 4-round REVIEW cap (rule 6) generalizes here as a 4-attempt BUILD cap. Attempt 5 lands in `NEEDS_INTERVENTION.json` (rule 11).

The motivation: gates that allow soft-retry erode into not-gates. Most agent frameworks (LangGraph supervisor patterns, AutoGPT, ARIS) have a fix-loop at every step; the loop dilutes the gate's authority and makes failure modes hard to reason about. Hard restart preserves the gate.

The trade: throws away potentially-useful BUILD work on every VERIFY fail. Acceptable because (a) BUILD-lite output is small at v0.7-v0.9 scale, (b) the discipline is more valuable than the wasted tokens, (c) the failure context becomes a constraint for attempt N+1 so we are not flying blind.

### Decision 4 — One milestone per session, microscope each with Codex

> "Don't overload yourself. Make it in the separate sessions, then microscope code with the Codex and get the ideas and research it. This is a high-stakes application."

Operational rule. No two milestones in one Claude Code session. Each milestone gets its own kickoff doc, its own Codex planning debate, its own implementation review pass. Reset context between milestones.

## The debate-agent thesis (the new thing)

This is the question we most want you to push on.

Ozzy made a claim that, if true, changes what `code-oz` is selling:

> "What we are kind of doing is similar when I'm asking you, like a Codex, to debate, and then we are always finding something new. While building this code, we identify many things, which is cooperation with these Claude plus Codex. We should be saying this is the feature, actually debating scenario, when debating starts. It's the prompts themselves, and the prompts you are prompting Codex with — this is what we find the most valuable things."

Translated: the Claude+Codex debate-during-design pattern (not just review-at-gate) is itself a product feature of `code-oz`. The narrow `requestReview({ reviewer, files, question })` primitive in CLAUDE.md only fires at the REVIEW gate. The thesis says there should be a broader `consult()` or `debate()` primitive that **any phase** can invoke when stuck on a design or scope question. The prompts used for the debate become a **first-class artifact**, not transient runtime ephemera.

The current architecture-locks table marks broad `consult()` as v0.3. The thesis is that its empirical value is higher than v0.3 implies and it should land sooner.

Two open sub-questions:

**(a) Naming and timing.** Does the debate-agent feature get its own milestone (M10? W4?) after BUILD/VERIFY/REVIEW are solid, or does it land earlier as a contract doc (`docs/contracts/DEBATE.md`) so we can use it during M7-M9 internally before exposing it as a CLI surface?

**(b) Artifact shape.** When a debate fires, what is the artifact?

- *Option α (paired):* `DEBATE_BRIEFING.md` + `DEBATE_RESPONSE.md` (matches current manual workflow).
- *Option β (transcript):* `DEBATES/<phase>-<topic>.md` with structured sections (question, claude-position, codex-position, synthesis, decision).
- *Option γ (event-log):* `events.jsonl` gets `debate_started` / `debate_resolved` and the question/answer pair lives there.

Combinations possible (e.g., α for the artifact, γ for the event-log audit trail).

## Constraints we will not relax

The 19 rules in `CLAUDE.md` are non-negotiable. Highlights relevant to this debate:

- Rule 1: file-based gate signals only.
- Rule 2: cross-family review at REVIEW gate (BUILD provider ≠ REVIEW provider family).
- Rule 6: max 4 review rounds, exit on score ≥ 6 + verdict = ready.
- Rule 7: artifact contracts in plain Markdown, never JSON.
- Rule 9: permission manifest required for any `.ts` escape-hatch execution.
- Rule 10: cost budgets are config (`budgets.global`).
- Rule 12: resume is a v0.1 feature; idempotent gate writes.
- Rule 15: epistemic sidecars (Scientist tail) at every phase gate.
- Rule 16: universal anti-slop rules in every persona prompt.
- Rule 17: maestro discipline named and authoritative.
- Rule 18: codebase context retrieval has its own permission scope (`tool_use.repo_context`).
- Rule 19: run-level budget enforcement is mandatory, not advisory.

The cross-model peer-review rules (7, 8, 9, 10 in CLAUDE.md's "Cross-model peer review" section) are also non-negotiable: every milestone gets a Codex planning debate before code lands, and a Codex implementation review before tag.

## What "good" looks like for this debate

A useful response from you, Codex, looks like:

1. **Pushback on Decision 1 (split-per-milestone).** Is splitting actually right, or is bundling BUILD-lite + VERIFY-lite cheaper because the BUILD agent's output is what VERIFY validates and they share most of the data model? If you find a bundling case, name the specific trade we are missing.
2. **Pushback on Decision 2 (worktree timing).** Should worktree-per-run land before BUILD-lite (its own M7 with BUILD pushed to M8) so the isolation contract is hardened in isolation? Or is shipping it alongside BUILD the right cadence?
3. **Pushback on Decision 3 (hard-restart on VERIFY fail).** Is there a real cost to discarding BUILD output that we are underestimating? Are there industry patterns (Aider's `repo-map`, Devin's iterative-build, SWE-agent) where the patch-and-retry loop empirically wins, and if so, why?
4. **Pushback on Decision 4 (one-milestone-per-session).** Is there a reason to bundle two related milestones in one session if they share a contract surface? Or is the discipline always worth it?
5. **The big one — debate-agent thesis.** Does the cross-family debate pattern justify being a first-class product feature, or is it process discipline that should stay outside the CLI surface? If a feature, when does it land? What is the artifact shape? Is there a precedent (LangGraph's multi-agent debate, Constitutional AI's critique-revise loop, Microsoft AutoGen's GroupChat) that we should borrow from or explicitly reject?
6. **Risks we are not seeing.** What is the second-order failure mode of this M7-M10 plan? What lands at M10 and immediately falls over because of a decision made in M7?
7. **Recommended next step.** A single concrete first action for the M7 session — name the file we should write, or the contract we should pin first.

## Format we want back

Sections:

- `## Verdict on the four decisions` — one of `accept` / `reject` / `accept-with-modifications` per decision, with a one-paragraph rationale each.
- `## Verdict on the debate-agent thesis` — `feature` / `process-only` / `feature-with-modifications`. If feature: timing, artifact shape, naming.
- `## Risks we are not seeing` — bullet list, severity-ranked.
- `## Recommended M7 first action` — one paragraph.
- `## What you would have done differently if you were Claude` — one paragraph (this is the "always finding something new" part Ozzy values most).

## Calibration

- Treat M7-M10 as work that happens over the next 4-6 weeks at one milestone per session.
- Treat the debate-agent feature as potentially adding 1-2 weeks to the v0.7-v1.0 timeline if accepted as a feature.
- Assume single-developer (Ozzy + Claude + Codex) execution with no team to coordinate with.
- Assume the project ships as both a CLI and a paid SaaS later; the CLI must work standalone offline (FakeProvider).
- Assume the target audience for v1.0 is mid-tier engineers who want an LLM software-company they can trust on real work, not a demo.

Treat your own opinions as data, not authority. We will weigh disagreement and push back where warranted (CLAUDE.md cross-model peer review rule 9).

## End of brief

Three of us are building this — Claude, Codex, Ozzy. Tell us where we are wrong.
