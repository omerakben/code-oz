# CLAUDE.md — code-oz

This file orients Claude Code sessions working on `code-oz`.

## What this project is

`code-oz` is a standalone Bun + TypeScript CLI that boots an adaptive multi-agent software-company simulation over a hybrid phase-graph + agentic sub-orchestration spine. Hard SDLC gates between phases (file-based, schema-validated). Cross-family adversarial review. Non-technical-user intent elicitation at the front. Multi-provider via `IAgentProvider` (Claude / Codex / Gemini SDKs reading CLI OAuth tokens).

Status: **v0.1.0-alpha.0 — M1 milestone (CLI bootstrap)**. M2–M7 build out the spine. Read `docs/design/ROADMAP.md` first.

## Where decisions live

- `docs/design/ROADMAP.md` — full milestone plan, decision matrix, day-by-day PR plan
- `docs/adr/0001-mvp-option-e.md` — MVP scope decision (Option E, spine-first end-to-end)
- `docs/design/CODEX_BRIEFING.md` and `docs/design/CODEX_RESPONSE.md` — debate transcripts that produced the roadmap

## Non-negotiable rules (audit-derived)

1. **File-based gate signals only.** Never parse LLM text output for pass/fail. Use `state/GATE_<PHASE>_PASSED.json` files validated by `src/state/gates.ts` schemas. (maestro lesson)
2. **Cross-family review at REVIEW gate.** REVIEW agent must be a different provider family than BUILD. Pass file paths, not curated summaries. (ARIS lesson)
3. **3-source verification before any code.** Spec + reference code + library docs. PLAN cannot pass without `SOURCE_CHECK.md`. (maestro lesson)
4. **Opus default; warn on downgrade.** `claude-opus-4-7` is the primary model; downgrading requires explicit config. (maestro session-55 lesson)
5. **Wave-based execution + grep verification** between phases catches pattern blindness.
6. **Hard cap on review loops:** max 4 rounds, exit on score≥6 + verdict=ready. (ARIS)
7. **Artifact contracts in plain Markdown** (`SPEC.md`, `PLAN.md`, `SOURCE_CHECK.md`, `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`) — never JSON serialization for inter-phase handoffs.
8. **`FakeProvider` runs the full lifecycle offline.** Every spine test is deterministic and network-free.
9. **Permission manifest required for any `.ts` escape hatch execution.** Allowed commands / network / file roots / env vars / timeout / secret access. Default: no execution.
10. **Cost budgets are config, not vibes.** `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxReviewRounds`, per-phase budgets in `.code-oz/config.yaml`.
11. **Provider failures become actionable `NEEDS_INTERVENTION.json`**, never opaque SDK stack traces.
12. **Resume is a v0.1 feature.** `runId`, idempotent gate writes, `code-oz resume`. Terminal death after PLAN must not restart DEFINE.
13. **Privacy by default.** `.code-ozignore`, secret redaction, file-size caps, "files sent to provider" preview per phase. Agents receive explicit file manifests, never silent recursive repo context.
14. **Brownfield AUDIT has its own artifact.** Never treat existing code as a blank canvas.

## Architecture locks

- **Stack:** Bun + TypeScript, native single-file binary via `bun build --compile`.
- **Distribution (W3+):** npm + Homebrew + Scoop with auto-PATH-patching install script.
- **File format:** Markdown + YAML frontmatter (agent-skills schema, extended with `type` / `phase` / `provider` / `modelPolicy` / `permissions`). Optional sibling `.ts` for hooks/MCP tools/runners.
- **Phase taxonomy:** `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` (greenfield) and `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP` (brownfield).
- **State model:** typed FSM + `state/events.jsonl` event log + schema-validated gate files. No SQLite v0.1.
- **Cross-provider primitive:** narrow `requestReview({ reviewer, files, question })` only at REVIEW gate. Broad `consult()` is v0.3.

## Influence library

The `templates/` collection in `~/Projects/agents/templates/` is the influence library. Patterns are borrowed; **no code dependencies, no submodules, no copy-paste**. Audited templates and what they contributed:

| Template | Pattern |
|---|---|
| `agent-skills` | Skill frontmatter format + DEFINE→SHIP phase taxonomy + Common Rationalizations table |
| `opencode` | `bun build --compile` distribution + MCP host/client + permission system |
| `Archon` | `IAgentProvider` interface + worktree-per-run isolation |
| `pi-mono` | Streaming event model + multi-provider abstraction |
| `maestro` | File-based gate signals + 3-source verification + Opus-default policy |
| `Auto-claude-code-research-in-sleep` | Cross-family review + Reviewer Memory + 4-round-cap loop + plain-Markdown artifact contracts |
| `claude-code` | Plugin format + hook event names + filesystem discovery |

## Working in this repo

1. **Run all commands from the repo root.** `bun install`, `bun test`, `bun run dev <command>`, `bun run build:binary`.
2. **Branches:** `main` only on tagged releases. Feature branches: `feat/`, `fix/`, `refactor/`, `test/`, `docs/`. Conventional commit messages.
3. **Tests must run offline.** Spine tests use `FakeProvider`. Live-provider tests are opt-in only and gated behind env flags.
4. **No emojis in code or commit messages.** No "Co-Authored-By: Claude" footers unless asked.
5. **Never push to GitHub without explicit user approval.** Local commits are fine.
6. **Skills available in this repo:** any skill from the user's global skill set applies. The non-negotiable rules above override anything that conflicts.

## Cross-model peer review (durable rule)

This project is high-stakes. Single-model output has blind spots; cross-family review structurally mitigates them. The rule fires on every milestone:

7. **Codex debate at planning convergence.** Before starting implementation of any milestone (M2, M3, ...), run a Codex debate round on the milestone scope: write a structured `CODEX_BRIEFING.md` (goal, constraints, acceptance, the recommended plan, debate prompts), invoke `mcp__plugin_agent-codex_codex-native__codex` with `gpt-5.5` xhigh and `sandbox: read-only`, capture `CODEX_RESPONSE.md`, and synthesize before any code lands. The user's preference: never present "ready to proceed" without the debate.

8. **Codex review at implementation completion.** Before tagging or pushing any milestone, run a Codex review on the latest commit. Codex returns one of `push` / `fix-first` / `debate-required`. Block-push and block-next-milestone severity findings get addressed in a follow-up commit (never amend) before the milestone is closed.

9. **Codex's verdict is data, not authority.** Weigh disagreement, sanity-check agreement, push back when warranted. The point is structural review, not deference.

10. **Codex model fallback.** Globally configured `gpt-5.5` at xhigh effort. The `gpt-5.5-codex` and `gpt-5.1-codex-max` variants do NOT work on Ozzy's ChatGPT-account auth — fall back to `gpt-5.5` if they fail. Reasoning effort `xhigh` is set in `~/.codex/config.toml` defaults; pass `{model_reasoning_effort: "xhigh"}` in the config override only when overriding.

This rule was empirically validated 2026-04-29: Codex's planning-convergence debate flipped the MVP from Option C to Option E (spine-first end-to-end), and Codex's M1 implementation review caught five real issues including a doc/code lie in the scaffold (`.code-oz/.gitignore` promised but not written), `--force` semantics that were the "dangerous middle," and brownfield detection that ignored `.git` despite the locked rule. See `docs/design/CODEX_RESPONSE.md` for the original debate.

## Quick references

- Run dev CLI: `bun run dev init`, `bun run dev run`, `bun run dev doctor`
- Run tests: `bun test` (offline, full suite) or `bun test --watch`
- Build native binary: `bun run build:binary` → `dist/code-oz`
- Type-check: `bun run typecheck`
