---
template: maestro
location: ~/Projects/agents/templates/maestro
audited: 2026-05-10
status: live (debate pending)
companion: ../../CLAUDE.md (influence library), ../README.md (comparison index)
authors: code-oz primary, Codex debate to follow
---

# Code-Oz vs maestro

## TL;DR

**Verdict: YES, with selective borrows.** Maestro is the parent template — three of code-oz's 21 non-negotiable rules came from it (file-based gate signals, three-source verification, Opus-default model policy). Code-oz reified those as a typed Bun/TypeScript spine with schema-validated gate JSON, an `events.jsonl` log, seven artifact contracts, a Reviewer Panel, a debate scheduler, and 21 numbered project rules. The lessons are absorbed and surpassed.

What is *not* absorbed is a small set of mechanics around runtime supervision, plan-vs-actual reflection, and the positive-direction handoff between runs. The five candidate borrows below are minor artifacts and one runtime primitive — none of them require a new authority boundary unless we change scope.

## Method

Read on the maestro side: `CLAUDE.md`, `MANIFEST.md`, `orchestrator/README.md`, `commands/session-start.md`, `.claude/agents/research-validator.md`, `.claude/rules/07-research-before-code.md`, `cowork/monitor.md`. Read on the code-oz side: project `CLAUDE.md` (21 rules), `docs/design/ROADMAP.md`, gate model in `src/state/gates.ts`, post-M16 status in `MEMORY.md`. Both sides classified by feature; gaps ranked under rule 20 (one new authority per milestone) and rule 21 (no new parallel-provider surface without measurable risk reduction).

## Architectural fork point

The two systems part ways at the runtime layer:

- **Maestro** is Claude-Code-as-runtime. `orchestrator.sh` runs perpetual cycles by spawning `claude -p --dangerously-skip-permissions --model claude-opus-4-6 --output-format json`. State lives in `state.json`, intervention signals are touch-files, and external supervisors (Gatekeeper, Monitor, Frontier-Evolve) watch from Claude Desktop's Cowork mode.
- **Code-oz** is a standalone Bun/TypeScript runtime that talks to provider APIs directly via `IAgentProvider` (Claude/Codex/Gemini SDKs reading CLI OAuth tokens; xAI direct HTTP per PE-1). State is a typed FSM with schema-validated `GATE_<PHASE>_PASSED.json` files, `events.jsonl`, and `runId`-keyed resume. There is no perpetual loop and no external supervisor.

That fork is not negotiable. Anything bound to the bash loop (`PAUSE`/`STOP` touch-files, tmux/launchd, iMessage notifications, `.claudeignore` for orchestrator isolation, headless `claude -p` invocation) is not portable to the code-oz architecture without inventing a new runtime — and inventing a new runtime is not on any milestone roadmap. The borrowable surface is the artifact, gate, and reflection model, not the runtime.

## Feature matrix

| Maestro feature | Code-oz state | Verdict |
|---|---|---|
| File-based gate signals (NEEDS_INTERVENTION / PAUSE / STOP touch-files) | Adopted as rule 1; reified as schema-validated `GATE_<PHASE>_PASSED.json` (`src/state/gates.ts`) plus `events.jsonl` and typed FSM | **Surpassed** (typed JSON beats touch-files) |
| Three-source verification (spec + reference code + library docs) | Adopted as rule 3; `SOURCE_CHECK.md` is a PLAN gate artifact with schema validation | **Equal** (same content, gated artifact) |
| Opus-default model policy (no Sonnet, no Haiku) | Adopted as rule 4; encoded in persona `modelPolicy` frontmatter and `src/prompts/universal-rules.md` | **Surpassed** (per-persona policy, not single global) |
| Plain-Markdown artifact contracts | Adopted as rule 7; seven artifacts (SPEC, PLAN, SOURCE_CHECK, BUILD_REPORT, VERIFY, REVIEW, AUDIT) vs maestro's three (START / IMPLEMENT / END) | **Surpassed** |
| Cross-family review at REVIEW gate | Adopted as rule 2; M14 Reviewer Panel v1 runs the simultaneous-provider variant | **Surpassed** (panel beats single reviewer) |
| Hard cap on review loops (4 rounds, exit on score≥6 + verdict=ready) | Adopted as rule 6 | **Equal** |
| Wave-based execution + grep verification between waves | Listed as rule 5; **no spine primitive yet** — the rule is honored procedurally, not enforced | **GAP — borrow candidate B1** |
| Heartbeat file for external monitors | `events.jsonl` is consumable but no first-class heartbeat schema; nothing emits "I am alive at T" without producing a phase event | **GAP — borrow candidate B2** |
| Plan-vs-actual reflection in END.md | `BUILD_REPORT.md` records what was built; `VERIFY.md` records evidence; nothing diffs PLAN.md decisions against BUILD output | **GAP — borrow candidate B3** |
| "Next Session Should" forward-feed in END.md | `NEEDS_INTERVENTION.json` is the negative-direction handoff; no positive-direction equivalent | **GAP — borrow candidate B4** |
| Abandonment as a normal terminal class (~10% of maestro sessions) | Every code-oz run ends in either gate completion or `NEEDS_INTERVENTION` — there is no semantic for "DEFINE found nothing to do" | **GAP — borrow candidate B5** |
| Perpetual orchestrator loop | `code-oz resume` is one-shot recovery; no `code-oz watch`. The W3-lite Ralph Loop exercise (2026-05-02) covered the only currently credible unattended use case | **REJECT** (rule 21: no measurable risk reduction over one-shot today) |
| External supervisors (Gatekeeper / Monitor / Frontier-Evolve in Cowork) | None | **REJECT** (only needed if the perpetual loop is adopted) |
| Headless `claude -p` runtime invocation | `IAgentProvider` SDKs + xAI direct HTTP | **REJECT** (architectural fork) |
| Branch strategy `local-dev → staging → main` with no feature branches | Feature branches per `feat/`/`fix/`/`refactor/` convention | **REJECT** (different team/scale assumption) |
| iMessage / macOS notifications | None | **REJECT** (UX/integration noise, not core) |
| `.claudeignore` for orchestrator isolation | `.code-ozignore` exists for privacy redaction (rule 13) — different intent | **No borrow needed** |
| `.claude/templates/` starter library (CLAUDE.md / project-config / .claudeignore templates) | `.code-oz/config.yaml` schemas exist; no starter library | **GAP (low priority, W3+ UX)** |
| Production lessons embedded in template (CLAUDE.md "Production lessons learned") | 21 numbered non-negotiable rules + `.claude/memory/MEMORY.md` auto-memory + per-milestone progress files | **Surpassed** |
| PR review gate as Phase 0 of session-start | No VCS integration in the phase graph; SHIP closes a milestone but does not block on external PR feedback | **GAP — but rule 21 hard to pass** |

## Already in code-oz from maestro (the absorbed lessons)

These rules in `CLAUDE.md` cite maestro by name in their lineage:

- **Rule 1.** File-based gate signals only. Reified as schema-validated `GATE_<PHASE>_PASSED.json` files (`src/state/gates.ts`) — not touch-files. The schema validation is the upgrade.
- **Rule 3.** Three-source verification before any code (spec + reference code + library docs). Reified as `SOURCE_CHECK.md` PLAN gate artifact. PLAN cannot pass without it.
- **Rule 4.** Opus default; warn on downgrade. Encoded in `modelPolicy` frontmatter on each persona and globally in `src/prompts/universal-rules.md`. Empirically validated by maestro's Session 55 incident (Sonnet research agents producing cascading data errors — wrong screenshot counts, wrong line ranges — that cost 100x more to debug than running Opus would have cost to run).
- **Rule 5.** Wave-based execution + grep verification between phases. Honored procedurally; the spine primitive is the gap (see B1 below).
- **Universal anti-slop rules** (rule 16) and the maestro discipline / nine-family bug map (rule 17) trace to maestro's research-validator agent and rule 07 (`research-before-code`).

The conclusion is that maestro's load-bearing lessons already shape code-oz at the rule layer. The remaining question is which mechanics are worth lifting into the spine.

## Borrow candidates (ranked)

### B1 — Wave-based execution primitive in BUILD/VERIFY  *(highest signal)*

**Maestro mechanic.** Tasks execute in dependency order across waves. Between waves, a "VP" pass runs grep verification against agent-reported counts and line ranges. This catches the "agent pattern blindness" failure mode — when a file contains identical patterns, agents rename only the first and report all as done. Maestro production catches three to five missed items per rename session this way.

**Code-oz state.** Rule 5 says "wave-based execution + grep verification between phases catches pattern blindness." There is no spine primitive that enforces it. BUILD produces a `BUILD_REPORT.md`; VERIFY produces a `VERIFY.md` with evidence. Neither one runs grep recounts of agent-reported numbers as a gate.

**Why it fits code-oz.** Rule 5 is already a non-negotiable. Closing the gap between rule and runtime means the rule starts paying for itself instead of relying on the persona to remember it. The implementation is a VERIFY-tail step that emits a `WAVE_VERIFY.json` artifact with grep recounts of every numeric claim in `BUILD_REPORT.md`, validated by the existing gate machinery. No new authority boundary — VERIFY already owns evidence.

**Risk.** Persona claims that lack numeric content slip through. Mitigation: require BUILD_REPORT.md to declare counts in a structured table; VERIFY recounts only the structured rows.

**Milestone hook.** Could land as part of M16-tail polish if it stays under one commit, or as a small M17 lead.

### B2 — Heartbeat schema for external monitor surface  *(small, optional)*

**Maestro mechanic.** Each phase writes a JSON heartbeat with PID, current phase, cycle count, UTC timestamp. External Cowork tasks (Gatekeeper, Monitor) read it via Desktop Commander, flag stale (>45 min) heartbeats, and send iMessage alerts.

**Code-oz state.** `events.jsonl` is monotonic and consumable, but a watcher has to read the whole tail and infer "alive at T" from the latest event. There is no `state/heartbeat.json` with a single-line schema.

**Why it fits.** This is a *visibility* surface, not a parallel-provider surface — rule 21 doesn't apply. Risk reduction is measurable (time-to-detect-stuck-run drops from O(events.jsonl scan) to O(stat heartbeat.json)). Adoption cost is one writer at every phase boundary plus a documented schema.

**Why it might not.** If we never plan to run unattended, the heartbeat has no consumer. The M16 e2e completion test exercises a full run in <1 minute; nothing today is stuck-detection-bound.

**Milestone hook.** Defer until W3+ unattended-mode work resurfaces. Until then, document the schema in `docs/contracts/HEARTBEAT.md` so the format is decided when the consumer arrives.

### B3 — `PLAN_DIFF.md` as a SHIP-tail artifact  *(epistemic feedback)*

**Maestro mechanic.** END.md contains a plan-vs-actual section that compares START.md's task list against what got committed. This produces explicit drift signal: which tasks slipped, which got descoped, which acceptance criteria were modified mid-flight.

**Code-oz state.** None. PLAN.md decisions are gospel until BUILD; BUILD_REPORT.md describes what got built; nothing reconciles them.

**Why it fits.** Plan-vs-actual diff is the natural extension of the Scientist tail (rule 15). HYPOTHESES.md predicts; PLAN_DIFF.md confirms or falsifies. Read-only artifact, no new authority. Particularly useful for milestones where rule 20 was almost violated — the diff would have flagged M16 C9 as bundling six sub-surfaces under one axis label before it shipped, instead of after the eight production bugs surfaced.

**Risk.** Templating effort and discipline cost. If nobody reads it, the artifact becomes ceremonial.

**Milestone hook.** Pair with whichever milestone next adds a Scientist-tail extension. Could be a one-commit add.

### B4 — `NEXT_RUN.md` forward-feed  *(positive-direction handoff)*

**Maestro mechanic.** END.md ends with a "Next Session Should" section that gets read by the next cycle's session-start as Phase 2 context. This is how maestro stitches sessions into a coherent multi-day arc despite each session having a fresh context window.

**Code-oz state.** `NEEDS_INTERVENTION.json` is the negative-direction handoff. There is no positive sibling — no canonical place where a finished run says "the next run should pick up X, Y, Z." Auto-memory partly fills this for human-driven sessions, but agent-driven runs (Ralph Loop class) have no protocol for it.

**Why it fits.** It is the missing half of NEEDS_INTERVENTION. Together they form a complete terminal-state vocabulary: "stuck and need help" / "done and here is what is next" / "done and clean."

**Risk.** Unread artifact if no consumer wires it to DEFINE/AUDIT.

**Milestone hook.** Bundle with B5 (abandonment) — together they round out terminal-state semantics.

### B5 — `ABANDON.json` as a terminal class  *(small, semantic)*

**Maestro mechanic.** ~10% of sessions end abandoned (DEFINE found nothing to do, PR gate blocked planning, etc.). Next cycle's session-end cleans up the empty session folder. Abandonment is normal, not a failure.

**Code-oz state.** Every run ends in either gate completion or `NEEDS_INTERVENTION`. A DEFINE that finds nothing to do has to either invent fake work or tilt itself into NEEDS_INTERVENTION — both are wrong semantics.

**Why it fits.** One JSON schema (`reason`, `phase`, `cleanup_pending`), one new event type, one branch in the runner. Closes the gap. Bundles cleanly with B4.

**Risk.** None I can see. The change is additive.

**Milestone hook.** Same as B4.

### B6 — Reject for now: PR review gate (Phase 0)

Maestro's Phase 0 of session-start blocks new planning until open PR review feedback is addressed. The mechanic depends on a GitHub PR pipeline driven by Gemini and Copilot reviewers — code-oz has no equivalent integration and currently does not need one. Rule 21's "measurable risk reduction" test is hard to pass for a feature that mostly serves the maestro/TUEL workflow. Reject for v0.x; revisit if code-oz starts shipping into a PR-gated team workflow.

### B7 — Reject for now: perpetual orchestrator loop / `code-oz watch`

Maestro's `orchestrator.sh` runs cycles forever with intervention signals, failure backoff, and external supervisors. Code-oz has `code-oz resume` for one-shot recovery and that is currently sufficient. The W3-lite Ralph Loop exercise (memory `w3_lite_ralph_loop_launch.md`) covered the only credible unattended use case in 1.5 hours over ten iterations using a thin shell wrapper. Adding a perpetual mode means inventing a new authority boundary (the loop), the supervisor surface (Gatekeeper-equivalent), and the abandonment-cleanup machinery — all to recover the wrapper functionality we already proved adequate. Reject for v0.x.

## Reject set (architectural / cultural locks)

- Headless `claude -p` runtime invocation — fundamental fork; code-oz uses provider SDKs and direct HTTP.
- Branch strategy `local-dev → staging → main` with no feature branches — different team and scale assumption.
- Cowork supervisors (Gatekeeper, Monitor, Frontier-Evolve) — only valuable atop a perpetual loop, which we are not adopting.
- iMessage / macOS notifications — not core; orthogonal to the runtime.
- `.claudeignore` for orchestrator isolation — different intent than code-oz's privacy `.code-ozignore`; both legitimate, no merge needed.

## Where code-oz is ahead

The fair summary is that maestro is a battle-tested *configuration* template (40+ files, ~5,540 lines of markdown and YAML, no compiled runtime) and code-oz is a typed runtime that absorbed maestro's lessons and built a stricter spine on top. Specifics:

- **Schema-validated gate JSON beats touch-files.** Rule 1's ancestry is maestro's `NEEDS_INTERVENTION` / `PAUSE` / `STOP` touch-files; code-oz's `GATE_<PHASE>_PASSED.json` adds a typed schema. A malformed gate file fails at parse, not at runtime.
- **Seven artifact contracts beat three.** Maestro's START / IMPLEMENT / END covers the session arc; code-oz's SPEC / PLAN / SOURCE_CHECK / BUILD_REPORT / VERIFY / REVIEW / AUDIT covers the SDLC arc. Brownfield gets its own AUDIT (rule 14) — maestro has no equivalent.
- **Reviewer Panel v1 (M14) beats sequential cross-family review.** Maestro reviews are sequential (Codex pair planning, Codex pair review, Gemini and Copilot on the PR). Code-oz's M14 ships the simultaneous-provider surface — the first parallel-provider feature that survived rule 21's measurable-risk-reduction test.
- **Debate-policy scheduler v1 (M15) is a primitive maestro does not have.** `requestDebate()` is configurable; maestro's Codex pair role is hard-coded into each command file.
- **Provider capability contract (M11) and role-cost policy under `budgets.global` (M13) are spine primitives.** Maestro hardcodes the model in `orchestrator.sh` and budgets in `MAX_TURNS_*`. Code-oz makes both first-class config.
- **Production CLI completion (M16) shipped 12 production bugs caught and closed before tag.** This is the kind of multi-task lifecycle work maestro mechanically can't do because every phase is a fresh `claude -p` with no shared FSM. Code-oz can.
- **21 numbered non-negotiable rules vs maestro's 8 generic engineering rules.** Code-oz's rules are project-specific, locked, and many of them (15-21) were pinned during cross-family debates and post-incident analysis.
- **`MEMORY.md` index + auto-memory** is borrowed from maestro and extended: code-oz's auto-memory has 30+ entries with type frontmatter, ranked by relevance.

## What we do not get from this comparison

The discipline maestro contributes is *not* a roadmap input for v0.x — it is already absorbed. The borrow set above is small and surgical. There is no scenario in which "code-oz adopts maestro patterns" produces a milestone-shaped piece of work; the absorption already happened in M0-M16 by treating maestro as the influence library's anchor template.

The interesting question for the Codex debate is not "should we borrow more?" — it is "are we missing a feedback loop maestro had that we lost in the typed-spine transition?" Specifically: maestro's plan-vs-actual reflection (B3) and forward-feed handoff (B4) are the two mechanisms by which maestro turned isolated session arcs into coherent multi-day work. Code-oz's `events.jsonl` and milestone-progress memory entries are arguably the same loop at a coarser granularity, but the comparison forces us to verify rather than assume.

## Open questions for the debate

1. **B1 milestone fit.** Is wave-verification a one-commit add to M16-tail polish, or does it deserve its own milestone slot? If it changes BUILD_REPORT.md schema (structured count rows), the rule-20 sub-surface count is non-trivial.
2. **B3 vs Scientist tail.** Does PLAN_DIFF.md duplicate or extend the existing HYPOTHESES.md / OPEN_QUESTIONS.md tail (rule 15)? If it duplicates, fold it into the Scientist contract instead of standing it up alone.
3. **B4+B5 bundling.** Is the terminal-state vocabulary (NEEDS_INTERVENTION + NEXT_RUN + ABANDON) a single small commit, or does the cleanup-on-next-run side of B5 require runner changes that justify a milestone?
4. **B7 finality.** Is the "no perpetual loop" rejection durable for v0.2, or does the eventual `code-oz watch` UX become a defining product feature once multi-provider runs become routine?
5. **Reject set audit.** Did I miss anything in the maestro template that is portable but not on the borrow list — particularly anything in the unread `.claude/skills/` documentation or the CI pipeline (`pr-checks.yml`) that we have not already mirrored?

## Verdict

YES, code-oz is ahead and surpasses maestro on the dimensions that matter for an SDLC runtime. The three load-bearing maestro lessons are absorbed and reified as typed code, not markdown discipline. The five borrow candidates above are minor artifacts and one runtime primitive; none of them require new authority boundaries unless the scope of the rejected items (perpetual loop, PR gate) changes.

This comparison is the seventh in the series. Decision recorded for the influence library: maestro's contribution to code-oz is closed at the rule layer; future maestro updates would have to introduce something genuinely new (a debate scheduler variant, a different reviewer panel discipline) to reopen it.

The Codex debate that follows will pressure-test the borrow set, the rejection set, and especially the rule-21 application to B7.
