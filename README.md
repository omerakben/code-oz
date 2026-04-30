# code-oz

Repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship.

## Status

`v0.8.0-alpha.0` - M8 milestone. DEFINE, PLAN, BUILD-lite, and VERIFY-lite are implemented with file-based gates, worktree isolation, patch contracts, verification evidence, mutation gating, and restart-on-fail policy. See `docs/design/ROADMAP.md` for the full plan.

What works in `v0.8`:

- `code-oz init` - scaffolds `.code-oz/` with greenfield/brownfield detection.
- `code-oz run` - DEFINE phase via the BA persona; on `code-oz approve define`, advances to PLAN; PLAN phase via the Lead persona, with the Scientist phase-tail emitting `HYPOTHESES.md` + `OPEN_QUESTIONS.md` and gate-preflight blocking on overdue or blocking-importance open questions.
- BUILD-lite - applies one PLAN task through a patch contract inside an isolated run worktree and writes `BUILD_REPORT.md`.
- VERIFY-lite - executes the recorded validation command through `tool_use.execute`, captures evidence in `VERIFY.md`, runs mutation gating for new-behavior tests, and restarts failed attempts from a clean worktree with forensics preserved.
- `code-oz doctor providers` - provider auth + CLI presence probe.
- `code-oz doctor tools` - checks `rg` (ripgrep) is on PATH for the M6 repo-context tools.
- `tool_use.repo_context` - `glob`, `grep`, `read` available to personas at locked caps (50 / 16 KB / 20 / 5 s / `network: 'none'`).
- `tool_use.execute` - no-shell, argv-only validation execution with scrubbed environment, timeouts, stream caps, and termination reasons.
- `budgets.global` - `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`; soft warnings at `softWarnAtRatio` (default 0.75); optional `priceTable` for dollar telemetry.

## What it is

> **Run coding agents through an auditable SDLC from your terminal.**

`code-oz` is a standalone terminal CLI that runs your favorite coding agents (Claude, Codex, Gemini, OpenCode, Roo Code) through a real software delivery lifecycle. It coordinates role-specialized agents over a hybrid phase-graph + agentic sub-orchestration spine with hard gates between phases, file-based state, and cross-family adversarial review.

The tool runs on the user's own Claude / Codex / Gemini CLI subscriptions (via SDKs that read CLI OAuth tokens from disk). No API keys required.

Product thesis: [`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`](docs/product/AI_SOFTWARE_COMPANY_THESIS.md). Tagline: *Run an AI software company from your terminal.* The market category is a repo-native agentic SDLC runtime; the AI software company framing is how we explain roles to humans.

## Phases

Greenfield: `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP`.

Brownfield: `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP`. Auto-detected on boot.

## Try it (M8 alpha)

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

# Verify external dependencies (ripgrep is needed for repo-context tools)
~/Projects/code-oz/dist/code-oz doctor tools
```

REVIEW-lite lands in M9. Debate runtime lands in M10. See `docs/design/ROADMAP.md` for the milestone plan.

## Influence library

Patterns are borrowed (not depended on) from: `agent-skills` (Markdown skill format + SDLC phase taxonomy), `opencode` (distribution + MCP), `Archon` (`IAgentProvider` + worktree isolation), `pi-mono` (streaming events), `maestro` (file-based gates, 3-source verification, Opus-default), `Auto-claude-code-research-in-sleep` (cross-family review loop), `claude-code` (plugin/skill/hook conventions).

See `docs/design/ROADMAP.md` for the full inheritance map.

## License

MIT - see `LICENSE`.
