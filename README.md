# code-oz

Multi-agent software-company simulation CLI with hard SDLC gates.

## Status

`v0.6.0-alpha.0` — M6 milestone. PLAN phase + 3-source verification + repo-context MVP + Scientist substrate + run-level budgets. See `docs/design/ROADMAP.md` for the full plan.

What works in `v0.6`:

- `code-oz init` — scaffolds `.code-oz/` with greenfield/brownfield detection.
- `code-oz run` — DEFINE phase via the BA persona; on `code-oz approve define`, advances to PLAN; PLAN phase via the Lead persona, with the Scientist phase-tail emitting `HYPOTHESES.md` + `OPEN_QUESTIONS.md` and gate-preflight blocking on overdue or blocking-importance open questions.
- `code-oz doctor providers` — provider auth + CLI presence probe.
- `code-oz doctor tools` — checks `rg` (ripgrep) is on PATH for the M6 repo-context tools.
- `tool_use.repo_context` — `glob`, `grep`, `read` available to personas at locked caps (50 / 16 KB / 20 / 5 s / `network: 'none'`).
- `budgets.global` — `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`; soft warnings at `softWarnAtRatio` (default 0.75); optional `priceTable` for dollar telemetry.

## What it is

`code-oz` is a standalone terminal CLI that boots an adaptive multi-agent software company — BA, PM, UX, Lead, FE, BE, QA, Reviewer, exec personas — over a hybrid phase-graph + agentic sub-orchestration spine. Hard gates between phases, file-based state, cross-family adversarial review.

The tool runs on the user's own Claude / Codex / Gemini CLI subscriptions (via SDKs that read CLI OAuth tokens from disk). No API keys required.

## Phases

Greenfield: `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP`.

Brownfield: `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP`. Auto-detected on boot.

## Try it (M6 alpha)

```bash
# Clone and install
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun test
bun run build:binary

# Scaffold a project in a fresh directory (don't dirty the cloned repo)
mkdir /tmp/code-oz-smoke && cd /tmp/code-oz-smoke
~/Projects/code-oz/dist/code-oz init
ls -la .code-oz/

# Verify external dependencies (ripgrep is needed for M6 repo-context tools)
~/Projects/code-oz/dist/code-oz doctor tools
```

BUILD/VERIFY/REVIEW phases land in M7. See `docs/design/ROADMAP.md` for the milestone plan.

## Influence library

Patterns are borrowed (not depended on) from: `agent-skills` (Markdown skill format + SDLC phase taxonomy), `opencode` (distribution + MCP), `Archon` (`IAgentProvider` + worktree isolation), `pi-mono` (streaming events), `maestro` (file-based gates, 3-source verification, Opus-default), `Auto-claude-code-research-in-sleep` (cross-family review loop), `claude-code` (plugin/skill/hook conventions).

See `docs/design/ROADMAP.md` for the full inheritance map.

## License

MIT — see `LICENSE`.
