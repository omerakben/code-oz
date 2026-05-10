---
name: template-comparisons
companion-docs: ../../CLAUDE.md (influence library)
target: per-template head-to-head comparison and borrow-decision record for `~/Projects/agents/templates/*`
status: live index, one folder per template, one project per session
---

# Template comparisons

This folder records head-to-head comparisons between code-oz and each project under `~/Projects/agents/templates/`. The CLAUDE.md "influence library" lists 7 audited templates; the on-disk folder has 22. Each session focuses on one template, produces one folder here, and runs a Codex debate on the findings before the comparison is closed.

## Method

For every template:

1. Read structure, README, and 1-2 core implementation files.
2. Map ACE-style features against code-oz's current and roadmapped surfaces.
3. Decide: do we already meet the bar this template sets, or do we need to borrow / debate?
4. Run a Codex debate (briefing → response → synthesis) under the project's cross-model peer review rule.
5. Record the borrow set as a ranked list with milestone targets.

## Decision values

- **YES, we are ahead** — the template solves a problem code-oz already handles better; record why for the influence library and move on.
- **YES, with selective borrows** — the template overlaps but contributes a specific mechanic worth absorbing into a future milestone.
- **NO, we have a gap** — the template solves something code-oz needs and does not yet have a credible plan for; debate and decide whether to insert a new milestone.

## Sessions

Each row is owned by one session. PRs from other sessions add their own rows; this PR only owns row `02 | agenticSeek`.

| #  | Template    | Date       | Decision                                                                                                                                                                                                                                                                       | Folder                              |
| -- | ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 02 | agenticSeek | 2026-05-10 | YES, structurally ahead under the SDLC-runtime category frame; 4 borrow candidates ranked B3 → B1 → B4 → B2 (B3 promoted; B2 demoted; substring denylist + memory compression killed); local-first privacy upgraded from off-mission to demand-gated borrow; Codex `accept-with-modifications` thread `019e12ac` | [02-agenticSeek/](02-agenticSeek/) |

## Backlog

Audited (CLAUDE.md influence library, not yet compared in this session): `agent-skills`, `opencode`, `Archon`, `pi-mono`, `maestro`, `Auto-claude-code-research-in-sleep`, `claude-code`.

Unaudited (on-disk, no entry in CLAUDE.md): `agentic-canvas`, `byterover-cli`, `Chorus`, `claude-coder`, `codegraph`, `codex`, `gptme`, `learn-harness-engineering`, `Mimir`, `prd-taskmaster`, `skills`.
