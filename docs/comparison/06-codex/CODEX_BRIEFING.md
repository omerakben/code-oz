---
audience: Codex CLI (gpt-5.5, xhigh, sandbox: read-only)
purpose: Debate the borrow decisions in COMPARISON.md before they enter the influence library
context: Comparing code-oz (this repo) against the upstream openai/codex CLI source tree at ~/Projects/agents/templates/codex
pinned-rules:
  - "Rule 16: universal anti-slop rules ship inside every persona prompt"
  - "Rule 19: run-level budget enforcement is mandatory, not advisory"
  - "Rule 20: one new authority per milestone (post-M16 sequence locked)"
  - "Rule 21: no new parallel-provider surface lands without measurable risk-reduction"
  - "Rule 9: permission manifest required for any .ts escape-hatch execution"
  - "Cross-model peer review is the empirical lock — see CLAUDE.md"
expected-output: CODEX_RESPONSE.md with verdict accept | accept-with-modifications | reject per borrow
---

# Codex briefing — code-oz vs codex (session 06)

## Goal

Stress-test the borrow decisions in `COMPARISON.md` for the codex template comparison. Output: per-borrow verdict (accept / accept-with-mods / reject) plus any borrow we missed or any rule violation we didn't catch.

## Constraints

- code-oz integrates Codex CLI for cross-family peer review (rule 19 of CLAUDE.md). The codex template *is* the implementation we depend on. The comparison is therefore "substrate vs orchestrator", not "framework vs framework".
- Post-M16 milestone sequence is locked: M17+ work is not yet scoped. Borrows that imply a new milestone need rule-20 justification.
- We are at v0.17.0-alpha.0 with M16 (production CLI completion) shipped. 3108 tests pass. Next on roadmap is template-comparison sweep, then v0.2 demand-gated work.

## Recommended borrows (ranked)

### B1 — Decomposed review sub-skills

**Pattern:** Codex's `code-review` orchestrator skill spawns one subagent per specialized scope-skill (`code-review-context`, `code-review-breaking-changes`, `code-review-change-size`, `code-review-testing`). Each scope-skill is 5-15 lines of prescriptive checks. Returns *every* finding from each subagent.

**Where it lands in code-oz:** REVIEW persona prompt (W3+ workflow). Compose with M14 reviewer panel by running specialized sub-skills *inside* each panel reviewer.

**Compatibility check (rule 16):** Universal anti-slop rules ship inside every persona. The borrow adds *scope-specific* rule sheets imported alongside the universal sheet. Question: does this dilute or sharpen rule 16?

**Question for Codex:** Does running 4-5 specialist sub-skills per reviewer (×3 panel reviewers = 12-15 prompts per REVIEW pass) produce enough additional signal to justify the extra cost, or is it just multiplying tokens? Should the panel-level decomposition be flat (one specialist per panel reviewer) instead of nested?

### B2 — Skill format extension

**Pattern:** Codex skills can include `references/` (cited markdown), `scripts/` (executables called from SKILL.md), and `agents/` (sub-agent prompts) as sibling subdirs. Example: `babysit-pr/scripts/gh_pr_watch.py` is invoked from the SKILL.md as `python3 .codex/skills/babysit-pr/scripts/gh_pr_watch.py --pr auto --watch`.

**Where it lands in code-oz:** Skill catalog spec (W3+ skill catalog).

**Compatibility check (rule 9):** "Permission manifest required for any `.ts` escape-hatch execution." Should `scripts/*.py` count as an escape hatch under the same manifest, or does it need its own permission scope (`scripts.exec`)?

**Question for Codex:** What's the minimum manifest for a skill that ships an executable runner? Should the manifest live next to the script (`scripts/MANIFEST.json`) or stay in the SKILL.md frontmatter?

### B3 — WATCH phase post-SHIP (demand-gated)

**Pattern:** Codex's `babysit-pr` skill is a state-machine watcher polling PR/CI/review until merged/closed, with explicit stop conditions, polling cadence (1m red, base after green), action priorities (review-feedback > flaky-retry), trusted-author gating, retry budget.

**Decision in COMPARISON:** Defer. Pin design pattern in influence library now.

**Question for Codex:** Are we deferring this for the wrong reason? The product thesis ships role-specialized agents through artifacts; a post-SHIP watcher is the role-specialist for "PR steward". Is W3+ "send the binary to friends" enough demand signal to justify a post-M16 milestone slot for it, or does the demand really need to come from someone *running code-oz output as a CI consumer*?

### B4 — Named approval presets

**Pattern:** `utils/approval-presets` crate offers named modes (`full-auto`, `on-failure`, `auto-edit`, `suggest`) that bundle multiple permission decisions into a single user-facing label.

**Where it lands in code-oz:** `.code-oz/config.yaml` — `auto`, `paranoid`, `interactive` map to budget + permission combinations.

**Question for Codex:** Is this premature aesthetic? The presets only add value if the underlying budget+permission space is wide enough to confuse users. Today our config has ~6 budget knobs and a permission manifest. Is that wide enough to merit named presets, or are we naming a cardboard box?

### B5 — OTEL exporter for events.jsonl (demand-gated)

**Pattern:** Codex has `otel` and `analytics` crates that export traces to OpenTelemetry sinks.

**Decision in COMPARISON:** Defer until a real consumer exists.

**Question for Codex:** Same as B3 — is "we don't have a consumer" the right reason to defer, or does building OTEL export early give us a debugging lever (Honeycomb / Tempo dashboards on the spine) that pays back independent of external consumers?

### B6 — Plan-mode "non-mutating" rule in PLAN persona

**Pattern:** Codex's `plan.md` collaboration template is 8.8k of strict-mode prose: "You may explore and execute non-mutating actions that improve the plan. You must not perform mutating actions." Mutating includes installs, network, edits to repo-tracked files. Non-mutating includes reads, searches, dry-runs, builds-to-cache.

**Where it lands in code-oz:** `src/prompts/plan-system.md` (flat layout — corrected post-debate; the personas/ subdir does not exist).

**Question for Codex:** Is this already implicit in code-oz's PLAN phase (which produces SPEC.md → PLAN.md → SOURCE_CHECK.md and *cannot pass* without those artifacts)? Or is the explicit non-mutating discipline an additional lock that prevents "I'll just patch this one thing while planning" drift?

## Rejected borrows

### R1 — Codex sandboxing crates (bwrap, linux-sandbox, process-hardening)

**Reasoning:** Code-Oz delegates process-level sandboxing to provider CLIs (Codex, Claude Code, Gemini). The provider runs the shell; Code-Oz orchestrates. v0.1 explicitly does not run its own shell.

**Question for Codex:** Is this correct? When Code-Oz runs Codex via MCP, the sandbox boundary is Codex's. When it runs xAI HTTP (PE-1), there is no shell — only a request-body allowlist. Does this delegation actually hold, or is there a shell-like surface in code-oz we're not seeing?

### R2 — Single-primary provider with connector/proxy compatibility layer

**Reasoning:** Code-Oz's multi-provider-first is the categorical lock (rule 21).

**Question for Codex:** Confirm.

### R3 — Free-form interaction model

**Reasoning:** Phase graph + file-based gate signals is the categorical lock (rules 1, 2, 7).

**Question for Codex:** Confirm.

## New policy lock proposed

### L1 — Trust-boundary policy

**Statement:** "Code-Oz delegates process-level sandboxing to provider CLIs (Codex, Claude Code, Gemini). When a provider runs as HTTP (xAI), Code-Oz applies the request-body allowlist instead. Code-Oz never spawns shells directly."

**Where it lands:** Extend `docs/references/provider-contract.md` "Auth model — subprocess delegation + API-key transmission (v0.1)" section.

**Question for Codex:** Is this lock the right scope? Or should it be wider ("Code-Oz never executes user code directly; all execution authority is delegated") or narrower ("Code-Oz never spawns shells in v0.1")?

## Open questions (recap from COMPARISON)

1. Is B1 actually compatible with rule 16, or does adding scope-specific rule sheets dilute the universal sheet?
2. Is B2 compatible with rule 9? Should `scripts/*.py` count as an escape hatch with its own manifest?
3. Should B3 wait for demand, or is W3+ ship volume enough?
4. Is B4 too cute?
5. Is B6 already implicit in our PLAN persona?
6. Is there an identity model in `agent-identity/src/lib.rs` (28k LoC) we should mirror?

## What I want from you

For each borrow (B1-B6), reject (R1-R3), and lock (L1):

1. **Verdict**: accept | accept-with-modifications | reject.
2. **One-sentence rationale** tied to a code-oz rule or pinned doc.
3. **If accept-with-modifications**: what's the modification?
4. **If you spot a rule violation we didn't catch**: name it.

Plus: **what's the borrow we missed?** If you scan AGENTS.md, the skills directory, and the Cargo workspace and find a pattern code-oz should absorb that we didn't list, name it.

Cap your response at ~1500 words. Start with the verdicts table, then per-item rationales, then "missed borrows" if any, then the rule violations list.
