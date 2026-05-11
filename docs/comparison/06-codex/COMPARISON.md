---
session: 06-codex
template: openai/codex (CLI source tree at ~/Projects/agents/templates/codex)
date: 2026-05-10
author: code-oz session
status: draft for Codex debate
companion: ./CODEX_BRIEFING.md, ./CODEX_RESPONSE.md, ./SYNTHESIS.md
---

# code-oz vs codex — comparison

## TL;DR

**Decision: YES, with selective borrows.** Codex is a *coding-agent CLI*, not an SDLC-orchestration framework. The two projects are in different categories — Code-Oz coordinates Codex (and other CLIs) as agents through phase-gated artifacts. Code-Oz is structurally ahead on every orchestration axis (phase-graph spine, file-based gate signals, cross-family review, debate-policy scheduler, brownfield AUDIT). Codex is structurally ahead on the *single-agent CLI craft* axes that Code-Oz delegates to it (sandboxing, approval-presets, in-process review-skill decomposition, post-merge babysit-pr loop, skill-with-scripts format).

Five borrowable mechanics, three rejections, one explicit policy lock — all detailed below. None require a new milestone; four fit cleanly into the M16+ trailing edge plus W3+ workflow surface.

## Category framing

Codex is a coding-agent CLI (peer to Claude Code, Cursor, Aider). Code-Oz is a *repo-native agentic SDLC runtime* (per `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`) that orchestrates Codex CLIs as agents.

The structural relationship is the same as `claude-code` (substrate platform): Code-Oz invokes `mcp__plugin_agent-codex_codex-native__codex` for cross-family review under rule 19. The codex template *is* the implementation Code-Oz already depends on. Comparing surface-for-surface would miscategorize what each project does. The right axes are:

1. **Where Codex's mechanics could land inside Code-Oz** without violating phase-gate or one-authority-per-milestone discipline.
2. **Where Code-Oz's orchestration discipline outruns Codex** as a single-agent CLI.
3. **Where the two genuinely diverge** and no borrow makes sense.

## Map of codex's surface

| Surface | Where it lives | Notes |
|---|---|---|
| Rust workspace | `codex-rs/` | 100+ crates; ~80% are infra (sandboxing, MCP, transports, secrets, file-system, plugins) |
| TS shim | `codex-cli/` | npm-published wrapper |
| SDK | `sdk/` | language SDKs |
| Skills bundle | `.codex/skills/` | 11 production skills (5 review-context, babysit-pr, codex-bug, codex-issue-digest, codex-pr-body, remote-tests, test-tui) |
| Collaboration modes | `codex-rs/collaboration-mode-templates/templates/` | `default.md`, `plan.md` (8.8k), `execute.md`, `pair_programming.md` |
| AGENTS.md | repo root | 18k of self-contributor guidance |
| Sandboxing | `bwrap`, `linux-sandbox`, `process-hardening`, `sandboxing` | production-grade |
| Approval / permissions | `utils/approval-presets`, `execpolicy`, `shell-escalation` | layered preset system |
| Telemetry | `rollout-trace`, `otel`, `analytics` | append-only event log + OTEL |
| Auth | `keyring-store`, `secrets`, `login`, `aws-auth` | system-keyring credentials |
| Agent identity | `agent-identity` | one-crate identity model (28k LoC `lib.rs`) |
| Plugin host | `core-plugins`, `utils/plugins` | dlopen-style plugin model |
| MCP | `codex-mcp`, `mcp-server`, `rmcp-client`, `builtin-mcps` | both client and server |

Docs (`docs/`) are stub redirects — most are 100-300 byte pointers to `developers.openai.com/codex` or `platform.openai.com`. Substantive on-disk docs are AGENTS.md, install.md, contributing.md.

## Axis-by-axis

### A1 — Coordination spine

| | code-oz | codex |
|---|---|---|
| Mode | Phase-graph + agentic sub-orchestration: `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` | Single-agent loop with collaboration-mode switching (`default`, `plan`, `execute`, `pair_programming`) |
| Inter-agent handoff | File-based artifacts (`SPEC.md`, `PLAN.md`, `SOURCE_CHECK.md`, `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`) validated by Zod schemas | Single in-process state; no inter-agent handoff |
| Gate signals | `state/GATE_<PHASE>_PASSED.json`, file-only, never parsed from LLM text (rule 1) | n/a — no gate concept |
| Worktree isolation | M7 worktree-per-run authority | n/a |

**Code-oz is categorically ahead.** Codex has no equivalent of a phase graph or gated handoff; the `plan.md` collaboration mode is a *single-agent mode switch*, not a multi-agent contract. The `<proposed_plan>` block at the end of plan mode is the closest Codex has, and it's still text emitted by one agent.

### A2 — Reviewer surface

| | code-oz | codex |
|---|---|---|
| Cross-provider review | M14 Reviewer panel v1: simultaneous Claude + Codex + Gemini reviewers, panel synthesis (rule 20) | None — single provider |
| Within-provider decomposition | Single REVIEW persona with universal anti-slop rules; rounds 1-N (cap 4) catch different bug classes | **Code-review orchestrator + 5 specialized review-context skills**: `code-review-breaking-changes`, `code-review-change-size`, `code-review-testing`, `code-review-context`, plus the orchestrator. One subagent per skill. Returns *every* finding from each subagent. |
| Review policy | Cross-family REVIEW with different provider family than BUILD (rule 2) | n/a |
| Debate | M15 debate-policy scheduler v1 (single-opponent) | n/a |
| Stop condition | Max 4 rounds, exit on score≥6 + verdict=ready | Per-skill prescriptive checks |

**Code-oz is ahead on cross-provider; codex is ahead on within-provider decomposition.** These are orthogonal axes. Codex's pattern — one orchestrator subagent fans out to N specialist sub-skills, each with a tightly-scoped prompt — produces deeper findings per pass than a monolithic REVIEW persona. The skills are each 5-15 lines: `code-review-change-size` is "≤800 lines, ≤500 for complex, recommend a split if larger"; `code-review-context` is "no history rewrite, no items >10K tokens, P0 anything >1K tokens". This is not the universal-anti-slop list — it's the *per-scope* checklist.

**Borrow candidate (B1).** Specialized review sub-skills inside the REVIEW persona prompt or as an orchestrated sub-pass. Aligns with rule 16 (universal rules ship inside every persona) by adding a *scope-specific* rule sheet imported alongside the universal sheet.

### A3 — Skill format

| | code-oz | codex |
|---|---|---|
| Skill location | `.code-oz/skills/` (planned) and `src/prompts/personas/` | `.codex/skills/<skill-name>/` |
| Format | Markdown + YAML frontmatter (`name`, `description`, `type`, `phase`, `provider`, `modelPolicy`, `permissions`) | Markdown + YAML frontmatter (`name`, `description`); some skills include `agents/`, `references/`, `scripts/` subdirs |
| Optional sibling | Single sibling `.ts` for hooks/MCP tools/runners | Subdirs: `references/` for reference docs, `scripts/` for executables, `agents/` for sub-agent prompts |
| Skill size | universal-rules.md ~120 lines | code-review skills 5-15 lines each; babysit-pr is 200 lines + scripts/ + references/ + agents/ |

**Code-oz is ahead on metadata richness; codex is ahead on subdirectory structure.** Codex's pattern of `SKILL.md` next to `references/`, `scripts/`, and `agents/` is a cleaner way to ship a skill that needs runnable code (e.g., the babysit-pr `gh_pr_watch.py` watcher) and reference material that the skill prompt cites by relative path. Code-Oz's "single sibling .ts" rule is too rigid for skills that bundle non-trivial runners.

**Borrow candidate (B2).** Extend skill-format spec to permit `references/` and `scripts/` subdirs alongside `SKILL.md`. Permission manifest still gates execution. This is a docs-and-format change, not a runtime change — fits W3+ skill catalog work.

### A4 — Post-SHIP / merge monitoring

| | code-oz | codex |
|---|---|---|
| Post-SHIP phase | None — SHIP is terminal | `babysit-pr` skill: state-machine watcher polling PR/CI/review until merged/closed |
| State machine | n/a | Explicit stop conditions, polling cadence (1m while CI red, base cadence after green), action priorities (review > flaky-retry), trusted-author gating, retry budget |
| Loop cap | n/a | "Don't stop merely because a single snapshot returns idle while checks are still pending" |

**Codex is ahead on a category Code-Oz has not entered.** Code-Oz's SHIP is terminal — no concept of post-merge monitoring. Codex's babysit-pr is the first credible model for an *ongoing* phase that watches third-party signals (CI, GitHub reviews) and re-enters BUILD-fix-and-push only when criteria are met.

This is *not* an immediate borrow because:
- It implies a new authority boundary (post-SHIP authority — auto-pushing fixes against an already-shipped artifact). Rule 20 says one new authority per milestone, and the post-M16 sequence is locked.
- The trust model is different: babysit-pr trusts the human reviewer set; Code-Oz's cross-family review is the trust source.

**Borrow candidate (B3, demand-gated).** A WATCH phase post-SHIP, optional, gated by demand (someone shipped Code-Oz output and wants the loop to continue). Defer until W3+ ship volume produces a real signal. Pin the design pattern in the influence library now.

### A5 — Sandboxing and process hardening

| | code-oz | codex |
|---|---|---|
| Isolation | Worktree-per-run (M7); subprocess delegation to Codex/Claude/Gemini CLIs | bwrap (Linux user namespaces), Seatbelt (macOS), process-hardening, linux-sandbox crates |
| Network policy | Repo-context tool denies network (rule 18); HTTP providers (xAI) under strict allowlist | `CODEX_SANDBOX_NETWORK_DISABLED=1` env at subprocess level; explicit network-disabled tests |
| Permission manifest | `.ts` escape hatches require manifest (rule 9): commands, network, file roots, env, timeout, secrets | execpolicy + shell-escalation + approval-presets layered system |

**Codex is ahead because it has to be — it's the runner.** Code-Oz currently delegates sandboxing to Codex by invoking it as a subprocess. The sandboxing crates are not Code-Oz's responsibility unless Code-Oz starts running its *own* shell. v0.1 explicitly does not. Today's lever is to *trust Codex's sandboxing* and pass through the env vars correctly.

**No borrow.** This is a category Code-Oz has explicitly delegated. Document the delegation in `docs/references/provider-contract.md` so future readers know the trust boundary.

### A6 — Approval presets / permission model

| | code-oz | codex |
|---|---|---|
| Presets | Per-phase budgets in `.code-oz/config.yaml` (rule 19, single namespace `budgets.global`) | Named approval presets (`utils/approval-presets`): full-auto, suggest, on-failure, etc. |
| Granularity | maxTurns, maxProviderCalls, maxTokensEstimate, maxWallTimeMinutes, optional priceTable | per-action approval modes |

Codex's approval-presets crate offers named modes (full-auto, on-failure, auto-edit, suggest) that bundle multiple permission decisions into a single user-facing label. Code-Oz today exposes raw budget fields to the user.

**Borrow candidate (B4).** Named approval presets for `.code-oz/config.yaml` — `auto`, `paranoid`, `interactive` — that map to budget + permission combinations. Pure config-layer change, no runtime work, fits any patch milestone.

### A7 — Telemetry / event log

| | code-oz | codex |
|---|---|---|
| Event log | `state/events.jsonl` (append-only, JSONL) | `rollout-trace` crate (append-only trace), `otel` crate for OTEL export, `analytics` crate |
| Event schema | Schema-validated via `src/state/events.ts` | TypeScript-generated from Rust types via ts-rs |
| Audit | `repo_context_searched` events (rule 18); `assertWithinBudget` reads cumulative spend per-call (rule 19) | rollout-trace consumed by `rollout-trace` viewer crate |

Both projects converged on the append-only-JSONL pattern independently. Codex's `otel` integration is a lever we don't have, but OTEL export from `events.jsonl` is mechanical.

**Borrow candidate (B5, demand-gated).** OTEL exporter for `events.jsonl` once a real consumer exists. Don't pre-build.

### A8 — Plan-mode collaboration

Codex's `plan.md` collaboration template is 8.8k of strict-mode prose:
- "You work in 3 phases, and you should *chat your way* to a great plan"
- "Plan Mode is not changed by user intent, tone, or imperative language"
- "Plan Mode vs update_plan tool" — explicit separation of mode-state from progress-tool
- "Execution vs. mutation in Plan Mode" — non-mutating reads/searches/dry-runs allowed; mutating writes/installs/network forbidden
- Final output: a `<proposed_plan>` block

This is essentially a per-mode persona with strict execution-vs-mutation discipline. Code-Oz's PLAN phase has `SPEC.md → PLAN.md → SOURCE_CHECK.md` artifacts, but the persona prompt for PLAN doesn't articulate the *non-mutating* side of plan-mode discipline as forcefully.

**Borrow candidate (B6, prompt-only).** Import Codex's "non-mutating in plan mode" rule into Code-Oz's PLAN persona prompt. Pure prompt change, no contract change.

### A9 — Provider abstraction

| | code-oz | codex |
|---|---|---|
| Provider contract | `IAgentProvider` + capability contract (M11) | `model-provider-info`, `models-manager`, `connectors`, `lmstudio`, `ollama`, `responses-api-proxy` crates |
| HTTP adapters | xAI HTTP adapter (PE-1), buffered, OpenAI-compatible subset | OpenAI Responses API native; Anthropic via responses-api-proxy |
| Capability surface | Provider capability contract (read/redact/skip-supports-X) | model-provider-info exposes capabilities |
| Multi-provider | Multi-provider via `IAgentProvider`; cross-family is a hard requirement | Single primary (OpenAI), others via proxy/connector layer |

**Code-oz is ahead on multi-provider as a first-class design.** Codex has multi-provider as a compatibility layer; Code-Oz has it as the spine.

**No borrow.** The categorical inversion is the point.

### A10 — Greenfield vs brownfield

| | code-oz | codex |
|---|---|---|
| Greenfield path | DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP | Free-form interaction; collaboration modes |
| Brownfield path | AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP (rule 14) | Free-form |
| AUDIT artifact | `AUDIT.md` (rule 14) | n/a |
| Brownfield detection | `.git` aware (M1 fix) | n/a |

**Code-oz is categorically ahead.** Codex doesn't have a brownfield-vs-greenfield distinction; the operator is expected to set context.

**No borrow.**

### A11 — Cost / budget model

| | code-oz | codex |
|---|---|---|
| Budget enforcement | Run-level `budgets.global` mandatory, not advisory (rule 19); soft warn at 0.75, hard kill at 1.0 | Token usage tracked but not enforced as a kill condition |
| Role cost (M13) | Role-cost policy under `budgets.global`; per-role spending caps | n/a |
| Dollar telemetry | Optional `priceTable` for dollar conversion | n/a |

**Code-oz is ahead.** Codex tracks usage but doesn't enforce. Code-Oz's mandatory-not-advisory enforcement is the lock.

**No borrow.**

### A12 — Skill bundle: babysit-pr's runner pattern

The `babysit-pr` skill bundles a 200-line `SKILL.md` with `scripts/gh_pr_watch.py`, `references/heuristics.md`, `references/github-api-notes.md`, and `agents/` subdirs. The SKILL.md tells Codex to *run the python watcher and consume its JSON output*, classify CI failures using gh CLI commands, prioritize review-feedback over flaky-retry, and so on.

This is the canonical "skill that bundles a runner". The script is in-tree, version-controlled, deterministic. The skill prompt makes the script's behavior the source of truth and treats Codex as the supervisor.

**This is the fully realized form of B2 (skill-with-scripts).** Worth quoting in the influence library entry.

## Decision matrix

| ID | Borrow | Status | Where it lands | Effort |
|---|---|---|---|---|
| B1 | Decomposed review sub-skills (code-review orchestrator + N specialized scope-skills) | recommended | REVIEW persona prompt restructure (W3+ workflow); compose with M14 panel by running specialized sub-skills *inside each panel reviewer* | medium (prompt + a few new skill files) |
| B2 | Skill format extension: `SKILL.md` + `references/` + `scripts/` subdirs | recommended | Skill catalog spec (W3+ skill catalog) | small (docs + format spec) |
| B3 | WATCH phase post-SHIP (babysit-pr equivalent) | demand-gated | Defer until W3+ ship volume produces signal; pin design pattern in influence library now | n/a until demand |
| B4 | Named approval presets in `.code-oz/config.yaml` (`auto`, `paranoid`, `interactive`) | recommended | Config layer; any patch milestone | small |
| B5 | OTEL exporter for `events.jsonl` | demand-gated | Defer | n/a |
| B6 | Plan-mode "non-mutating" rule in PLAN persona prompt | recommended | `src/prompts/plan-system.md` (corrected post-Codex review — the personas/ subdir does not exist) | trivial |
| R1 | Codex sandboxing crates (bwrap, linux-sandbox, process-hardening) | rejected | Delegate to Codex; document the trust boundary | n/a |
| R2 | Codex provider abstraction style (single-primary + connector layer) | rejected | Code-Oz's multi-provider-first is the lock | n/a |
| R3 | Codex's free-form interaction model | rejected | Phase graph is the lock | n/a |
| L1 | **Trust-boundary policy lock**: Code-Oz delegates process-level sandboxing to provider CLIs (Codex, Claude Code, Gemini); when a provider runs as HTTP (xAI), Code-Oz applies the request-body allowlist instead | new policy | `docs/references/provider-contract.md` (extend existing trust-boundary section) | small |

## Why code-oz is ahead (recap)

1. **Phase-graph spine + file-based gate signals.** Codex has no equivalent.
2. **Cross-family REVIEW with provider isolation.** Codex has no equivalent.
3. **Debate-policy scheduler (M15).** Codex has no equivalent.
4. **Reviewer panel v1 (M14, simultaneous-provider).** Codex has no equivalent.
5. **Provider capability contract (M11).** Codex hardcodes a primary.
6. **Role-cost policy under `budgets.global` (M13).** Codex tracks but doesn't enforce.
7. **Brownfield AUDIT phase + artifact.** Codex is greenfield-only.
8. **Epistemic sidecars at phase gates** (HYPOTHESES.md, OPEN_QUESTIONS.md, rule 15). Codex has no equivalent.
9. **Universal anti-slop rules in every persona prompt** (rule 16). Codex skills are short and prescriptive but each ships independently.
10. **3-source verification at PLAN gate** (rule 3). Codex has no equivalent.
11. **One-authority-per-milestone discipline** (rule 20). Codex evolves continuously without this constraint.
12. **Mandatory run-level budget enforcement** (rule 19). Codex tracks but doesn't kill.

## Why codex is ahead (where Code-Oz delegates)

1. **Process-level sandboxing.** Code-Oz delegates and documents the trust boundary.
2. **Skill-with-scripts format.** Borrowable (B2).
3. **Decomposed review skills.** Borrowable (B1).
4. **Post-merge babysit loop.** Borrowable when demand exists (B3).
5. **Approval presets.** Borrowable (B4).
6. **Plan-mode mutation discipline.** Borrowable (B6).
7. **OTEL telemetry export.** Borrowable when demand exists (B5).

## Open questions for Codex debate

1. Is the decomposed-review-skill borrow (B1) actually compatible with rule 16 (universal anti-slop rules)? Or does it dilute the universal sheet by adding scope-specific sheets?
2. Is the skill-with-scripts format (B2) compatible with rule 9 (permission manifest required for any `.ts` escape hatch)? Should `scripts/*.py` count as an escape hatch with its own manifest?
3. Should B3 (WATCH phase) actually wait for demand, or does shipping v0.2 to friends produce enough signal to merit it now?
4. Is B4 (approval presets) too cute? It's a config-naming change. Should we just keep raw fields?
5. Is B6 (plan-mode mutation rule) already implicit in our PLAN persona, or is it worth adding the explicit non-mutating discipline?
6. Are we missing a category? The Codex `agent-identity` crate has a 28k-LoC `lib.rs` — is there an identity model in there we should mirror, or is it OpenAI-account-specific plumbing?

## References

- `~/Projects/agents/templates/codex/AGENTS.md`
- `~/Projects/agents/templates/codex/.codex/skills/` — 11 production skills
- `~/Projects/agents/templates/codex/codex-rs/Cargo.toml` — workspace crate inventory
- `~/Projects/agents/templates/codex/codex-rs/collaboration-mode-templates/templates/plan.md`
- `~/Projects/agents/templates/codex/docs/contributing.md`

## Series context

This comparison is session 06 in the docs/comparison/ series. Prior decisions:

- 01-ace: YES, with selective borrows (M17-M20 Reviewer Memory)
- 02-agenticSeek: YES, with selective borrows
- 03-aris: YES, with selective borrows (M14.1, M17, M19+ Failure Memory)
- 04-archon: YES, category-scoped (6 borrows)
- 05-agent-skills: YES, with selective borrows
- **06-codex: YES, with selective borrows (B1, B2, B4, B6 recommended; B3, B5 demand-gated)** — this session
