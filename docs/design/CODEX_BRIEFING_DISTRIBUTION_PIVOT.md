# CODEX_BRIEFING — Distribution pivot: native CLI → multi-host plugin (superpowers-shaped)

Date: 2026-05-20
Model/effort: gpt-5.5, xhigh, sandbox read-only
Type: planning-convergence debate (cross-model peer review rule, step 1)

## Goal

Decide whether — and how — code-oz changes its distribution model from a standalone Bun CLI/binary to a superpowers-shaped multi-host plugin that installs *inside* the agents users already run (Claude Code first, then Cursor, then Codex). The trigger is direct user feedback: multiple prospective users said the same thing — "do you have a plugin for Claude Code / Cursor / Codex? Nobody wants to download a new CLI." Adoption (the 1000-star bar) is currently wall-blocked at the install step.

This debate must converge on a distribution architecture before any code lands. It does not commit code.

## Context: what superpowers actually is

We cloned `obra/superpowers` (v5.1.0) to `template/superpowers/` for reference. Findings:

- **Zero runtime, zero dependencies.** It is pure behavior-shaping content: ~13 skills (Markdown), per-host instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`), and a `SessionStart` hook that bootstraps `using-superpowers`, which makes the skills auto-trigger.
- **One repo → many hosts.** Per-host manifests: `.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, `.opencode/`, `gemini-extension.json`. A deterministic `scripts/sync-to-codex-plugin.sh` rsyncs `skills/` into the OpenAI Codex plugin repo, excluding `hooks/ docs/ tests/ scripts/ package.json CLAUDE.md`. Different hosts get different bootstrap mechanisms; the skills are the shared payload.
- **Distribution = official marketplaces.** `/plugin install superpowers@...` (Claude), the OpenAI plugins marketplace (Codex), Cursor's marketplace, Gemini extensions, etc. The install friction is near zero because there is no engine to install.
- **Its own contributor policy is instructive.** superpowers' `CLAUDE.md` explicitly rejects "domain-specific skills" and "third-party dependencies" from core — they "belong in their own standalone plugin." That is direct evidence code-oz should be its **own** plugin, not PRs into superpowers.

## Context: what code-oz is (and why it is not superpowers)

code-oz is a **runtime/orchestrator**, not a prompt pack. Its differentiators are mechanical enforcement, not advice:

- **Rule 1 — file-based gate signals only.** Never parse LLM text for pass/fail. Gates are `GATE_<PHASE>_PASSED.json` written by orchestrator-owned primitives.
- **Rule 2 — cross-family review.** The REVIEW agent MUST be a different provider family than BUILD. This requires spawning a second family as a subprocess with its own isolated worktree.
- **Rule 15 — epistemic sidecars** validated at gate preflight (`HYPOTHESES.md`, `OPEN_QUESTIONS.md`).
- **Rule 19 — run-level budget enforcement** read per-call from `events.jsonl`.
- **Already-contracted external boundary.** `docs/contracts/MCP_TRUST_BOUNDARY.md` (design, demand-gated) and rule 1's external-surface clause already say: MCP/hook/external surfaces may read events and submit *advisory request files*, but **never write gate files, canonical artifacts, or `events.jsonl`**. `docs/contracts/CROSS_AGENT_COMPAT.md` already establishes the `AGENTS.md`-as-thin-pointer pattern for non-Claude tools.

**The crux.** A skill running inside Claude Code (or Cursor, or Codex) is, by construction, one host model following a prompt. It cannot write authoritative gate files (rule 1), and it cannot perform cross-family review (rule 2) because it lives inside a single family. So the parts of code-oz that are pure discipline (the *what to do* — brainstorm, 3-source-check, RED-first, anti-slop) port cleanly to prompts; the parts that are the moat (the *enforcement and the cross-family evidence*) do not. A naive "make code-oz a superpowers-style plugin" deletes the moat and contradicts `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`.

## Constraints (non-negotiable; an option that breaks these is out)

- Rule 1 holds: external surfaces (plugin, MCP, hook) never own gate/artifact/event writes. A skills tier may *advise* the discipline but must not present itself as having written a gate.
- Rule 2 holds: cross-family review remains a runtime authority; it cannot be faked by a single-host skill.
- Rule 16 holds: any shipped persona/skill imports `src/prompts/universal-rules.md`; LLM-generated personas forbidden.
- Rule 20 holds: one new authority/capability boundary per milestone. A multi-host distribution surface must be staged, not bundled.
- Rule 21 holds: no new parallel-provider surface without measurable risk reduction in `events.jsonl`.
- Tests run offline; `FakeProvider` covers the spine.

## The options on the table

### Option A — Full skills-only pivot (become superpowers)
Abandon the runtime. Ship skills + hooks across hosts. Maximum adoption, near-zero install friction.
- Cost: deletes the moat (gates, cross-family review, evidence). Contradicts the thesis. Enters a category superpowers already owns, as a fork with a different skill list. Violates the spirit of rules 1 and 2.

### Option B — Engine kept; multi-host thin plugins bridge to it
Keep the runtime as source of truth. Per-host plugins register commands/skills that invoke the engine via the contracted MCP trust boundary (or subprocess). Gates, events, cross-family review stay in the engine.
- Cost: the engine must still exist on the machine, so *some* install friction returns. Mitigation: ship the engine as a bundled binary asset or an npm/`npx`-launched MCP server so it is one install from inside the host. Open question: does this force re-targeting the engine from a Bun-compiled binary to a Node-distributable MCP server?

### Option C — Hybrid tiered (lead recommendation, to be attacked)
One repo, two products with an explicit funnel:
- **Tier 1 — skills funnel (advisory, zero runtime).** A genuinely useful superpowers-shaped skills pack: brainstorming, 3-source-check, RED-first TDD, the universal anti-slop sheet, the maestro discipline. Installable in every host marketplace. **Honesty constraint: it must never claim gate authority, never write `GATE_*.json`, and must surface that it is single-model discipline, not enforced gates or cross-family review.** This is the 1000-star adoption front door.
- **Tier 2 — the engine (enforced).** The full runtime, reachable via MCP from inside the same hosts, for users who want hard gates + event evidence + cross-family review. Tier 1 upsells to Tier 2 at a concrete moment: "want this gate *enforced* and reviewed by a different model family? run it through the engine."
- Cost/risk: brand confusion (two things both called code-oz); conversion risk (users stay on free Tier 1, never convert); the integrity risk that an advisory tier *looks* like it gives gates and quietly trains users to believe rule 1's guarantees without the engine.

## Recommended plan (my lean — pressure-test it)

Option C, staged under rule 20:
- **D1 — Claude Code skills funnel.** Advisory-only, no gate authority (so arguably introduces *no* new gate authority → rule-20-clean). One host. Honest framing baked into `using-code-oz` bootstrap: "discipline as skills; enforced gates + cross-family review require the engine."
- **D2 — MCP bridge (opens the MCP_TRUST_BOUNDARY implementation milestone).** The Claude Code plugin invokes the engine for enforced gates + cross-family review. The distribution pivot *is* the demand checkpoint that contract has been waiting for. One bridge = one boundary.
- **D3 — Cursor adapter** (skills + MCP). **D4 — Codex adapter.** Each host = one boundary.
- Keep the standalone CLI/binary as the engine. The plugin is the new front door, not a replacement.

## Debate prompts (answer each; disagree where warranted)

1. **Is the Tier-1 skills funnel coherent, or a trap?** Does an advisory-only skills tier that visibly resembles code-oz cannibalize the brand and quietly violate rule 1's spirit by making users believe they have gates when they have prompts? If it is viable, what is the minimum honesty mechanism that keeps it from lying (naming, a banner, refusal to emit gate-shaped output)?

2. **A vs B vs C.** Which distribution architecture best serves the adoption goal *without* deleting the moat? If you reject C, defend B or a variant.

3. **The install-friction reality check.** Can the engine plausibly be near-zero-install (npm/`npx` MCP server) given it is currently a Bun-compiled binary? Is re-targeting to a Node-distributable MCP server worth it, or do we bundle the Bun binary as a plugin asset? Name the cheaper credible path.

4. **Cross-family review inside single-family hosts.** Tier 1 inside Claude Code structurally cannot do cross-family review. Is it acceptable to ship a "code-oz" surface that lacks its headline feature, as long as it is honestly the funnel? Or does that dilute the one thing that differentiates us?

5. **Rule-20 staging.** Is D1 (advisory skills, no gate authority) genuinely *not* a new authority boundary, or am I rationalizing to slip a large surface past rule 20? Propose the correct boundary decomposition if mine is wrong.

6. **Sequencing vs M17.** code-oz is mid-roadmap (M17 AUDIT runtime is the next planned milestone; v0.20.3 just shipped). Does the distribution pivot pre-empt M17, run parallel, or wait? What is the opportunity cost of pausing runtime milestones to build distribution?

7. **The one thing I am most likely wrong about.** Name the load-bearing assumption in this briefing most likely to be false, and what evidence would settle it.

## Acceptance for this debate

Converged when we have: a chosen distribution architecture (A/B/C/variant), a rule-20-respecting milestone decomposition, an honesty mechanism for any advisory tier, and an explicit position on sequencing against M17. Output captured to `CODEX_RESPONSE_DISTRIBUTION_PIVOT.md`, synthesized before any implementation milestone opens.
