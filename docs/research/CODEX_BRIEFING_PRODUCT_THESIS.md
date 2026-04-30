# Codex briefing — `code-oz` product thesis pressure-test

**Date:** 2026-04-30
**Status:** thesis (positioning + post-M10 roadmap; no implementation in this session)
**Caller:** Claude Opus 4.7 + Ozzy
**Target:** Codex `gpt-5.5` xhigh, sandbox read-only
**Cycle:** session-cycle "plan" phase, between M8 close and M9 kickoff

## What you are reading

`code-oz` is at `v0.8.0-alpha.0`. M8 shipped VERIFY-lite (evidence, mutation gate, restart-on-fail, cleanup-on-approval, N+1 scheduler). 1325 offline tests pass. M9 (REVIEW-lite) and M10 (Debate runtime) remain.

Between M8 close and M9 kickoff, the user has named a product thesis: `code-oz` is not a coding agent — it is an **AI software company runtime**. The thesis is captured in `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`.

This briefing pressure-tests the thesis. It does not propose new code. It asks: is the positioning correct, is the post-M10 roadmap derived from it correct, and what risks does it miss?

The expected output is a `feature-with-modifications` verdict in the worst case and `accept-with-modifications` in the best case — a `reject` verdict requires explicit reasoning about why the empirical M2–M8 pattern (cross-family review, file-based gates, debate-before-code, evidence-before-confidence) does not generalize to a product position.

## Where we stand

### Shipped spine (v0.8.0-alpha.0)

- **DEFINE** (M5): BA persona + ask-me runner + SPEC.md contract + greenfield/brownfield detection.
- **PLAN** (M6): Lead persona + 3-source verification (SPEC + reference + docs) + SOURCE_CHECK.md + repo-context tools (`tool_use.repo_context`) + Scientist substrate (HYPOTHESES.md + OPEN_QUESTIONS.md + phase-tail) + run-level budgets (`budgets.global`).
- **BUILD-lite** (M7): Builder persona + worktree-per-run isolation (`tool_use.write`) + patch contract + BUILD_REPORT.md + `WORKTREE.md` and `BUILD.md` contracts. Authority: BUILD artifact + worktree isolation.
- **VERIFY-lite** (M8): Verifier persona + `tool_use.execute` (no-shell argv-only with scrubbed env, timeouts, stream caps) + test-runner adapter + VERIFY.md + mutation gate + restart-on-fail + forensics extras + canonical event order + cleanup-on-approval + N+1 scheduler. Authority: VERIFY evidence + restart-on-fail.

### Cross-family review and debate (process-only today)

- **`requestReview()`** (M4): narrow primitive that fires only at REVIEW gate. Cross-family enforced at load time. Used by tests today; M9 wires it into REVIEW-lite as a runtime path.
- **`requestDebate()`** (M10): does not exist yet. Process contract pinned in `docs/contracts/DEBATE.md` (M7 commit). Today's debates run via `mcp__plugin_agent-codex_codex-native__codex` MCP server with `BRIEFING.md` / `RESPONSE.{codex,claude}.md` / `DECISION.md` artifacts under `docs/research/` and `docs/design/`. M10 ships the runtime that lets any phase persona invoke it programmatically.

### What is stubbed

- M9 REVIEW-lite (next milestone).
- M10 Debate runtime (after M9).
- `company:` config and per-role provider/model policy (post-M10 productization).
- AUDIT (brownfield phase) and SHIP (W4).
- W2 non-expert workflow (DEFINE-0 / Prompter front-door + TUI inspector).

### Empirical pattern that produced the thesis

Every milestone since M2 has produced a Codex briefing → response → decision triplet under `docs/research/` or `docs/design/`. Notable:
- **M5 / M6 synthesis round** (thread `019ddc5f`): produced rules 15–19 (Scientist tail, universal rules, maestro discipline, repo-context permission scope, run-level budget enforcement).
- **M6 close → M7 shape** (thread `019ddea0`): flipped the original M7 plan from a five-authority bundle (BUILD + VERIFY + REVIEW + Scientist tails + Prompter experiment) to one-authority-per-milestone (rule 20). This was a structural mitigation against authority creep.
- **M7 / M8 implementations**: each surfaced 5–9 Codex findings that landed as fix-first commits before tag.

The pattern is durable: cross-family debate-before-code catches blind spots that single-model authoring misses. The thesis claims this empirical pattern is also the product.

## What is locked

These constraints bound this debate. Not relitigable.

1. **`code-oz` remains repo-native and CLI-first for v0.1.** Vercel-style hosted SaaS is post-v1.0; the offline-first, FakeProvider-validated CLI runs the discipline.
2. **M9 = REVIEW-lite only.** Authority boundary: cross-family REVIEW. Not bundled with M10.
3. **M10 = Debate runtime only.** Authority boundary: `requestDebate()` primitive. Not bundled with M9 or W2.
4. **Broad `consult()` remains v0.3.** Distinct from `requestDebate()`. The thesis does not move this.
5. **Rule 20: one new authority boundary per milestone.** The thesis cannot expand M9 or M10 scope to fit a `company:` roster ahead of schedule.
6. **Rule 7: Markdown artifact contracts.** Not JSON. Not YAML.
7. **Rule 2: cross-family review at REVIEW gate is non-negotiable.** Reviewer family ≠ BUILD family at config-load time.
8. **Rule 13: privacy by default.** `.code-ozignore`, secret redaction, file-size caps, manifest preview before any provider call.
9. **Rule 19: budgets are config, not vibes.** Cumulative `budgets.global` enforced by the wrapper.
10. **Provenance policy: no borrowing from `claude-code-main` (the leaked Anthropic source).** Clean-room only from public docs and audited templates (`agent-skills`, `opencode`, `claude-code` (the public plugin scaffold), `Archon`, `pi-mono`, `maestro`, `Auto-claude-code-research-in-sleep`).
11. **Empirical cadence: every milestone gets a Codex planning debate** (rule 7 of cross-model peer review). The thesis is not a reason to skip future debates.

## What is up for debate

The core claim:

> Single-model software development inherits single-model bias. `code-oz` reduces that risk by assigning different providers and models to software-company roles, then forcing their work through artifacts, evidence gates, and cross-family review.

The proposed external category:

> AI software company runtime.

Alternative external category to consider:

> Agentic SDLC runtime, multi-provider.

The proposed user-facing wedge:

> Competitors give you agents. `code-oz` gives you the company structure that makes agents build production software together.

The proposed post-M10 productization:

| Surface | Description |
|---|---|
| `docs/contracts/COMPANY.md` or `docs/contracts/ROLES.md` | Role roster contract: BA, Lead, Researcher, Debate opponent, Builder, Verifier, Reviewer, Scientist, Orchestrator |
| `.code-oz/config.yaml` `company:` block | Maps each role to provider, model, budget, permissions |
| Per-role provider/model policy | E.g., BA → Gemini, Lead → Claude, Reviewer → Codex (different family from BUILD) |
| Debate policy by phase and risk level | When `requestDebate()` fires automatically vs. on-demand |
| Optional parallel builder candidates in separate worktrees | One PLAN task, multiple BUILD attempts in parallel worktrees, Reviewer chooses the best |
| Reviewer panel support | Multiple reviewers from different families on the same BUILD |
| Role-cost policy under `budgets.global` | Per-role token caps inside the run-level budget |

## The recommended path

1. **Adopt the thesis as product north star now.** Land it in `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` (already exists), point `CLAUDE.md` and `README.md` at it (already done), and reference it in `ROADMAP.md` post-M10 sections (already done).
2. **Do not implement role roster or parallel provider execution before M9 / M10 close.** Rule 20 protection.
3. **Use the post-M10 productization plan above as the staging order**, but treat each surface as its own potential authority boundary. Likely sequence:
   - **M11 (post-M10):** Land `docs/contracts/COMPANY.md` + `.code-oz/config.yaml` `company:` schema + per-role provider/model policy. Authority boundary: role roster + per-role config.
   - **M12:** Researcher phase-tail (sibling to Scientist). Authority boundary: Researcher source verification across providers.
   - **M13:** Reviewer panel (multiple reviewers per BUILD). Authority boundary: panel synthesis + cross-family voting.
   - **M14:** Parallel builder candidates. Authority boundary: candidate selection + Reviewer-as-tournament-judge.
   - **M15:** Debate policy automation (when `requestDebate()` fires automatically based on phase + risk level). Authority boundary: debate scheduler.

   The exact numbering is not committed; what is committed is the one-authority-per-milestone discipline and the order (roster → Researcher → panel → parallel builders → debate scheduler), with each milestone debated in its own Codex round.

4. **Marketing positioning vs. README content.** The "AI software company runtime" frame works for tweets and pitch decks. The README opens with technical claims (repo-native, provider-neutral, file-based gates, cross-family review, evidence-before-confidence) and references the thesis once.

## Decision prompts

1. **Category naming.** Is "AI software company runtime" the right external category, or should it be the *internal metaphor* with "Agentic SDLC runtime, multi-provider" as the *market-facing category*? HivePipe, Sonar, and Qodo already say "agentic SDLC"; the "company" framing is evocative internally but might confuse external buyers who pattern-match against ChatDev / MetaGPT (research) rather than production tooling.

2. **Wedge against broad enterprise platforms.** Microsoft Agent Framework, AWS Bedrock multi-agent collaboration, and Google Gemini Enterprise Agent Platform validate the multi-agent governance category but enter from the enterprise-agent-platform direction (cross-team workflows, identity, registry, simulation). `code-oz` enters from the repo-native software-delivery direction. Is this a sustainable wedge, or do these platforms inevitably eat the software-delivery niche when their evaluation/observability surfaces mature?

3. **Wedge against single-agent coding tools.** Codex CLI, Claude Code, Gemini CLI, OpenCode, Roo Code, Cursor agents, Devin, Factory, Replit, Base44 — `code-oz` is an *orchestration layer* on top of these, not a competitor. Is this positioning durable, or does the user mistake it for "yet another coding agent" because the CLI surface (`code-oz run`) looks similar?

4. **Roster timing.** Does the post-M10 company-roster productization match the shipped architecture (BA + Lead + Builder + Verifier + Reviewer + Scientist), or does it overpromise roles (Researcher, Debate opponent, parallel builders) that need their own milestones to land safely?

5. **First simultaneous-providers surface.** When `code-oz` first lets two providers work in parallel inside one run (post-M10), which surface is the right wedge? Options:
   - **Researcher fan-out:** spec source + reference source + docs source come from three different providers, synthesized by Lead.
   - **Debate opponents:** PLAN persona (Claude) is debated by Codex *and* Gemini in parallel during planning convergence.
   - **Builder candidates:** one PLAN task, three BUILD attempts in parallel worktrees by three providers, Reviewer picks one.
   - **Reviewer panel:** one BUILD output, two reviewers from different families, panel-synthesis decides.
   - **Scientist sidecars:** different providers fill HYPOTHESES.md and OPEN_QUESTIONS.md to widen the epistemic floor.

   Which is highest-leverage as the v0.2 differentiator? Which carries the most rule-20 risk?

6. **What should be explicitly excluded.** The thesis warns against "uncontrolled parallel agents" and "noisy swarms." Should that be a 21st non-negotiable rule? E.g., *"Add a parallel-provider surface only when its risk-reduction effect is empirically measurable in `events.jsonl` against the single-provider baseline."* Without this, post-v1.0 contributors might argue for parallel agents on aesthetic grounds.

7. **Documentation footprint.** Which parts of the thesis belong in:
   - `README.md` (one paragraph, technical-first framing)
   - `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` (full thesis, authoritative for north star)
   - `CLAUDE.md` (one-line pointer in "Where decisions live")
   - `ROADMAP.md` (post-M10 section delta)
   - Marketing surfaces (tweets, pitch decks, future landing page)

   Where does it leak through too much (over-claiming) and where does it leak through too little (under-claiming)?

8. **Risks the thesis misses.** Five candidates we have considered:
   - **Agentless caution drift.** The thesis acknowledges the Agentless paper's caution that simpler workflows beat complex agent systems on benchmarks. Does the role-roster post-M10 plan respect that, or does it grow toward the unmanaged swarm the thesis says it will not become?
   - **Provider asymmetry.** Claude / Codex / Gemini have different file-edit capabilities, tool-use reliability, and OAuth requirements. The thesis treats them as interchangeable workers. Does that hold up under load?
   - **Cross-family verifiability.** Rule 2 says reviewer family ≠ BUILD family. With three families (Claude / Codex / Gemini) and the post-M10 panel surfaces, the family-graph gets fragile. Could a Reviewer panel inadvertently violate cross-family if a panelist matches BUILD's family?
   - **Cost trajectory.** Multi-provider runs multiply token cost. The thesis lists "budget and permission controls" as features, but the user-facing cost story is muted. Is this a liability for adoption?
   - **Trust hierarchy.** The thesis says "Don't trust a model. Trust the process." But every component (BUILD persona, Reviewer, Scientist) is itself a model. Is the "process" framing durable, or does it elide the fact that we are still trusting models, just with stricter handoff contracts?

   Push back on each, and add the risks we are not seeing.

## What I want from you

Return:

1. **Verdict** — one of `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications`. One paragraph rationale.
2. **Strongest positioning statement** — your single best one-line external-facing wedge. Allowed to use any framing; you do not have to keep "AI software company runtime."
3. **Market differentiation table** — your version, columns: market player | their position | `code-oz` difference. Include at least Microsoft Agent Framework, AWS Bedrock multi-agent, Google Gemini Enterprise, Codex / Claude Code, HivePipe, Sonar, Cursor agents.
4. **Risks the thesis misses** — bullet list, severity-ranked.
5. **Roadmap recommendation after M10** — your M11 → M15 (or alternative) sequencing, with explicit rule-20 protection.
6. **Concrete edits to `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`** — call out specific section names and what should change.
7. **The single positioning trap we should explicitly reject** — name it; explain why it kills the thesis.
8. **What you would have done differently if you were Claude** — one paragraph, the most valuable signal.

## Calibration

- Treat this as a positioning + post-M10 roadmap debate, not an M9 or M10 scope debate. Do not propose changes to M9 or M10.
- Treat your verdicts as data, not authority (rule 9 of cross-model peer review). We will weigh disagreement and push back where warranted.
- Single-developer (Ozzy + Claude + Codex) execution. No team coordination.
- Target audience for v1.0 is mid-tier engineers who want an LLM software company they can trust on real work, not a demo.
- The CLI must work standalone offline (FakeProvider). Hosted SaaS is post-v1.0.

## End of brief

Three of us are building this — Claude, Codex, Ozzy. Tell us where the thesis is wrong, what it over-claims, and what it under-claims. Especially: tell us where the post-M10 productization sequence has a rule-20 violation hiding inside one of the milestones we proposed.
