# MCP runtime convergence hypothesis

Status: Rule-21 hold. Not a milestone.
Date: 2026-05-10
Source: `docs/comparisons/chorus/COMPARISON.md` §3.6.

## Hypothesis

Code-oz becomes a headless agentic SDLC runtime exposed over MCP. The team-facing surface — Chorus-style web UI, Claude Code, Codex CLI, OpenCode, or a custom client — consumes that MCP surface. The binary still owns file-based gates as authority; the frontend is a viewer plus driver. State stays in `.code-oz/state/` and `.code-oz/artifacts/`; MCP is transport only.

The split this hypothesis implies: code-oz owns artifacts, gates, worktrees, debate, review, budgets, and the audit trail. The frontend owns presence, Kanban, multi-human collaboration, and the audit display. Neither owns both.

## Why this matters

Chorus already proves the MCP-as-runtime-transport pattern works at scale: 40+ tools across PM/Developer/Admin surfaces, stateless `POST /api/mcp` endpoint, per-request authentication via API key, permission-gated tool registration. Three plugin ports (Claude Code, Codex CLI, OpenCode) consume the same MCP surface without bespoke transport code.

This is more concrete than the agentic-canvas canvas-as-frontend hypothesis (`docs/comparisons/agentic-canvas/COMPARISON.md` §3.4). Canvas-as-frontend asks code-oz to validate a UI shape it has no evidence about. MCP-as-runtime asks code-oz to validate a transport pattern that Chorus has already operated in production for ~6 months.

## Tool surface (sketch, not commitment)

The same five tools listed in `docs/comparisons/chorus/COMPARISON.md` §3.3:

- `code_oz_get_run_state(runId)` — current phase, last gate, open questions.
- `code_oz_request_review(reviewer, files, question)` — wraps the existing M9 / M10 primitive.
- `code_oz_request_debate(...)` — wraps the M10 `requestDebate()` runtime.
- `code_oz_approve_phase(phase, runId)` — writes `GATE_<PHASE>_PASSED.json`. Requires the §3.1 permission grid to gate it; Builder roles must not be able to call this.
- `code_oz_view_artifact(artifact, runId)` — read-only artifact view.

The surface is small on purpose. Anything that mutates run state goes through the existing gate writers, never around them.

## What would have to be true to commit

Per Rule 21 (no new parallel-provider surface without measurable risk-reduction effect), all four conditions must hold before this becomes a milestone:

- §3.3 (`code-oz mcp serve` subcommand) lands and is dogfooded by the maintainers for at least one full milestone end to end.
- At least one external MCP-aware client (Claude Code, Codex CLI, OpenCode, or Chorus) successfully drives a code-oz run from DEFINE through SHIP without bypass.
- A real demand signal appears: a user or an active session asking for "I want to run code-oz from my team's Kanban / from another agent harness."
- The privacy-by-default constraint (Rule 13, `127.0.0.1`-only bind) holds across all four conditions without weakening.

## What would falsify

The hypothesis is falsified if any of the following hold after §3.3 ships:

- The MCP surface is technically possible but no client drives it for three or more milestones after launch — adoption is the load-bearing piece, not capability.
- The privacy-by-default constraint forces remote-driving into impractical configurations (SSH tunnel, Tailscale, reverse proxy) without weakening Rule 13. If the only path to remote driving is to relax the rule, the hypothesis is wrong-shape.
- MCP transport itself is deprecated or replaced by Anthropic / OpenAI before §3.3 ships. The pattern is bet on a stable transport; if the transport moves, this hypothesis moves with it or dies.

## Tracking

This document is a Rule-21 hold per `CLAUDE.md`, not a milestone. No code changes follow from filing it. The next time §3.3 (MCP server) is debated for a milestone slot, this hypothesis is the priors document.

References:

- `docs/comparisons/chorus/COMPARISON.md` §3.6 (the borrow source).
- `docs/comparisons/agentic-canvas/COMPARISON.md` §3.4 (the prior canvas-as-frontend hypothesis this one supersedes in concreteness).
- `CLAUDE.md` Rule 13 (privacy by default).
- `CLAUDE.md` Rule 21 (no new parallel-provider surface without measurable risk-reduction effect).
