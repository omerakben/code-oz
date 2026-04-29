# code-oz

Multi-agent software-company simulation CLI with hard SDLC gates.

## Status

`v0.1.0-alpha.0` — M1 milestone (CLI bootstrap). See `docs/design/ROADMAP.md` for the full plan.

## What it is

`code-oz` is a standalone terminal CLI that boots an adaptive multi-agent software company — BA, PM, UX, Lead, FE, BE, QA, Reviewer, exec personas — over a hybrid phase-graph + agentic sub-orchestration spine. Hard gates between phases, file-based state, cross-family adversarial review.

The tool runs on the user's own Claude / Codex / Gemini CLI subscriptions (via SDKs that read CLI OAuth tokens from disk). No API keys required.

## Phases

Greenfield: `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP`.

Brownfield: `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP`. Auto-detected on boot.

## Try it (M1 alpha)

```bash
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun test
bun run dev init   # in a fresh directory, scaffolds .code-oz/
```

`run` and `doctor` commands are stubs in M1 — full implementations land in M2–M7.

## Influence library

Patterns are borrowed (not depended on) from: `agent-skills` (Markdown skill format + SDLC phase taxonomy), `opencode` (distribution + MCP), `Archon` (`IAgentProvider` + worktree isolation), `pi-mono` (streaming events), `maestro` (file-based gates, 3-source verification, Opus-default), `Auto-claude-code-research-in-sleep` (cross-family review loop), `claude-code` (plugin/skill/hook conventions).

See `docs/design/ROADMAP.md` for the full inheritance map.

## License

MIT — see `LICENSE`.
