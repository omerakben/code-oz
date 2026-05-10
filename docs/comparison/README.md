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

1. Read structure, README, and the implementation files that matter (not just docs).
2. Map the template's features against code-oz's current and roadmapped surfaces.
3. Decide: do we already meet the bar this template sets, or do we need to borrow / debate?
4. Run a Codex debate (briefing → response → synthesis) under the project's cross-model peer review rule.
5. Record the borrow set as a ranked list with milestone targets.

## Decision values

- **YES, we are ahead** — the template solves a problem code-oz already handles better; record why for the influence library and move on.
- **YES, with selective borrows** — the template overlaps but contributes a specific mechanic worth absorbing into a future milestone.
- **NO, we have a gap** — the template solves something code-oz needs and does not yet have a credible plan for; debate and decide whether to insert a new milestone.

## Sessions

| # | Template | Date | Decision | Folder |
|---|----------|------|----------|--------|
| 01 | ace | 2026-05-10 | YES, with selective borrows (M17-M20 Reviewer Memory sequence; see SYNTHESIS) | [01-ace/](01-ace/) |

Other sessions (02 onwards) land their own rows through their own PRs; the merge order is the order the user merges PRs.

## Backlog

Audited (CLAUDE.md influence library, not yet compared by this session): `agent-skills`, `opencode`, `Archon`, `pi-mono`, `maestro`, `Auto-claude-code-research-in-sleep`, `claude-code`.

Unaudited (on-disk, no entry in CLAUDE.md): `agenticSeek`, `agentic-canvas`, `byterover-cli`, `Chorus`, `claude-coder`, `codegraph`, `codex`, `gptme`, `learn-harness-engineering`, `Mimir`, `prd-taskmaster`, `skills`.
