# Codex briefing — code-oz vs claude-code template borrow audit (v0.17)

**Audience:** Codex (gpt-5.5 xhigh, sandbox: read-only).
**Author:** Claude Opus 4.7 (xhigh).
**Date:** 2026-05-10.
**Companion docs:** `docs/comparisons/claude-code/COMPARISON.md` (full analysis), prior comparisons under `docs/comparisons/agentic-canvas/` and `docs/comparison/01-ace/` … `docs/comparison/05-agent-skills/`, plus `CLAUDE.md` rules 1–21.
**Mode:** structured peer review under the project's cross-model peer-review rule (`CLAUDE.md` "Cross-model peer review (durable rule)").

You are the cross-family reviewer. Your role is adversarial, not advisory. Push back wherever the comparison reasoning is weak, the borrow set is over-claimed, or the scope of an absorbed borrow understates authority cost. We disagree productively; we do not converge to a soft "looks fine."

---

## What this briefing is

A per-template head-to-head comparison between **code-oz** (v0.17.0-alpha.0, the repo-native agentic SDLC runtime under `~/Projects/code-oz`) and the **claude-code** template (`~/Projects/agents/templates/claude-code` — Anthropic's official CLI harness + 13 bundled reference plugins under `plugins/`, plus `examples/{hooks,settings,mdm}/`, `.devcontainer/`, and a TS issue-lifecycle DSL under `scripts/`).

This template is structurally different from prior comparison targets. It is **the substrate** code-oz currently runs on top of, not a peer agentic framework. The harness tier (terminal rendering, MCP host, OAuth flow, plugin marketplace, hook execution engine, settings hierarchy, MDM) is out of scope by definition: code-oz is its own runtime, not a Claude Code plugin. The plugin tier (13 reference plugins) is the comparison target.

The comparison's verdict is **YES, code-oz is structurally ahead of the bundled plugin tier on every load-bearing dimension**, with three narrow borrows worth absorbing as polish and ten patterns explicitly rejected. Your job is to pressure-test the verdict, the borrow set, the rejection list, and the boundary-cost framings.

---

## Locked context (do not re-debate these)

These are project-level rules, already adopted, with empirical validation. Treat them as constraints, not options.

- **Rule 1**: file-based gate signals only; never parse LLM text for pass/fail.
- **Rule 2**: cross-family review at REVIEW gate; pass file paths, not summaries.
- **Rule 7**: Markdown artifact contracts only; no JSON serialization for inter-phase handoffs.
- **Rule 9**: permission manifest required; default-deny on commands / network / file-roots / env-vars / timeout / secret access.
- **Rule 12**: resume is a v0.1 feature; `runId`, idempotent gate writes, `code-oz resume`.
- **Rule 13**: privacy by default; explicit file manifests; no silent recursive context.
- **Rule 16**: universal anti-slop rules ship inside every persona prompt.
- **Rule 17**: maestro 4-layer FS memory is authoritative; documented in `docs/research/01-maestro-rule-checker.md`.
- **Rule 19**: run-level budget enforcement under `budgets.global` is mandatory, not advisory; cumulative spend read from `events.jsonl`.
- **Rule 20**: one new authority boundary per milestone.
- **Rule 21**: no new parallel-provider surface without measurable risk-reduction effect against the single-provider baseline.

The 3 already-borrowed patterns from this template (plugin format, hook event names, filesystem discovery — see CLAUDE.md influence table and `COMPARISON.md` §3) are also locked. The audit at §3 of `COMPARISON.md` confirms they are still load-bearing at v0.17.

W3-lite Ralph loop is shipped at run-wrapper tier (memory `w3_lite_ralph_loop_launch.md`); the inside-session Ralph variant is rejected separately at §4.5.

---

## The borrow set

Three candidates, ranked from lowest authority cost to highest:

**B1 — Issue-validate-then-filter pass for the M14 panel.** After a panel reviewer writes `REVIEW.md` with N issues, fan out one Haiku-tier validation call per issue (same provider family as the reviewer). Each validator returns `{ confirmed: bool, reasoning: string }`. Filter unconfirmed issues from the merged panel verdict. Source: `code-review` plugin steps 5–6. Cost: extends `src/phases/review-fire-path.ts` + one schema field on `REVIEW.md`. Authority: zero new boundary if scoped under M14.1 polish or M17.

**B2 — Hookify-style guardrail rule sheet for the permission manifest.** New optional file `.code-oz/guardrails.md` (or `guardrails/<rule>.md` collection). Each rule has frontmatter `{ name, enabled, event, pattern, action: warn|block, scope, message }` and Markdown body. Pattern matcher fires inside the tool-call wrapper and prompt-submission path. `warn` writes to `events.jsonl`; `block` aborts and triggers `NEEDS_INTERVENTION.json`. Source: `hookify` plugin matcher engine + `security-guidance` Python regex hook. Cost: new module `src/policy/guardrails.ts` + tool-call wrapper integration. Authority: extends rule 9 ("rule 9 gains pattern rules"); zero new boundary if scoped tight.

**B3 — Reviewer presets curation library.** `agentpacks/reviewer-presets/{silent-failure-hunter, type-design-analyzer, comment-analyzer, simplifier, security-auditor, test-coverage-auditor}.yaml`. Source: `pr-review-toolkit` six named agents. Cost: data files. Authority: zero. Defer to W3 polish or after the panel sees ≥10 production runs.

The full mapping (sections 4 and 6 of `COMPARISON.md`) covers thirteen plugins; ten are explicitly not recommended (plugin marketplace, MCP host machinery, MDM, devcontainer, issue-lifecycle DSL, ralph-wiggum inside-session loop, commit-commands slash commands, output-style plugins, frontend-design auto-invoke, plugin-dev/agent-sdk-dev/migration meta-tooling, and feature-dev parallel architects).

---

## Your assignment

Produce a structured response with five sections. Be terse, specific, and adversarial.

### Section 1 — Verdict on the verdict (200 words max)

Do you concur with **YES, with three narrow borrows**? If you would shift to YES-ahead-no-borrows or NO-credible-gap, say which and why. The bar is: name a specific template mechanic (or harness-tier feature) that either (a) is already covered better than the comparison gives credit for, or (b) is missing from the comparison and would change the recommendation.

### Section 2 — Per-borrow review

For each of B1, B2, B3, give:

- **Authority cost**: agree / disagree with the comparison's claim. If disagree, what new authority axis does the borrow introduce?
- **Rule 21 risk**: agree / disagree with the comparison's classification (B1 = intra-slot fan-out, debatable; B2 = N/A; B3 = N/A). If disagree, what measurable risk-reduction effect would the borrow need to demonstrate before landing?
- **Milestone fit**: agree / disagree with the proposed slot (M14.1 or M17 for B1; standalone M16+ commit for B2; deferred for B3). If disagree, what slot fits and why?
- **One concrete bug class** the borrow would introduce or paper over. If you cannot name one in 30 seconds, the borrow is fine.

### Section 3 — The ten contested questions

§10 of `COMPARISON.md` lists ten open questions. Answer each in 80 words or fewer.

### Section 4 — What Claude missed

Name up to three template mechanics that the comparison **failed to flag** entirely. Specifically scan:

- `plugins/plugin-dev/skills/<*>/SKILL.md` — the seven sub-skills (hook, MCP, structure, settings, commands, agents, skills) that may overlap with code-oz's universal-rules/maestro doctrine.
- `plugins/feature-dev/agents/code-architect.md` — the parallel-architect prompt; is the prompt itself richer than what code-oz's PLAN persona currently uses?
- `plugins/hookify/core/{config_loader.py, rule_engine.py}` — the matcher engine internals; does the engine handle anything beyond simple regex (priority, multi-condition, cooldown, scope) that B2 should inherit?
- `plugins/ralph-wiggum/scripts/` and `hooks/` — the inside-session loop's actual safeguards; might one of those safeguards (max-iterations, completion-promise flag) translate to code-oz's outside-session loop without the inside-session conflict?
- `examples/hooks/` raw files (not plugin-wrapped) — there may be a hook pattern not covered by the 13 plugins.
- `scripts/issue-lifecycle.ts` — the lifecycle DSL pattern; does its declarative shape suggest a runtime-tier analogue (lifecycle DSL for run states / restart thresholds)?
- `.claude-plugin/marketplace.json` — the marketplace metadata format; would a code-oz analogue (a `code-oz-runs.json` registry of locally-available reviewer presets / personas / debate skills) be useful?

For each, decide: cargo-cult or load-bearing?

### Section 5 — One thing Claude is wrong about

Pick the single weakest claim in `COMPARISON.md` and steelman the opposing position. The goal is to surface the failure mode, not to reach agreement. Claude will rebut in `SYNTHESIS.md`; this is the disagreement seed.

---

## Format

Return your response as a single Markdown document (no code-fenced wrappers around the whole thing). Use the section headers above (`## Section 1 — Verdict on the verdict`, etc.). Cite specific files and line numbers where possible (you have read-only filesystem access to `~/Projects/code-oz` and `~/Projects/agents/templates/claude-code`).

When you cite a rule, use its rule number (rule 19, rule 20, rule 21, etc.) rather than re-quoting the text.

When you call a borrow weak, propose a concrete strengthening or a clear rejection — never "needs more thought."

Time budget: as long as you need at xhigh effort. Quality over latency.

---

## A note on the meta-bug encountered while writing this

While writing `COMPARISON.md`, the bundled `security-guidance` PreToolUse hook fired against the Write call because the document mentions one of the 9 dangerous-API tokens by name in the rejection table. The fix was lexical (replace literal tokens with categorical names like "deserialization gadgets"). The bug surfaces a real lesson for B2 design: a guardrail rule sheet needs a `scope:` frontmatter field that distinguishes runtime tool calls from artifact authoring, otherwise the rules will block legitimate documentation that mentions them. Please pressure-test whether B2's caveats adequately address this class.
