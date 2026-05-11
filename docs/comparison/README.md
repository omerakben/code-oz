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
2. Map template features against code-oz's current and roadmapped surfaces.
3. Decide: do we already meet the bar this template sets, or do we need to borrow / debate?
4. Run a Codex debate (briefing → response → synthesis) under the project's cross-model peer review rule.
5. Record the borrow set as a ranked list with milestone targets.

## Decision values

- **YES, we are ahead** — the template solves a problem code-oz already handles better; record why for the influence library and move on.
- **YES, with selective borrows** — the template overlaps but contributes a specific mechanic worth absorbing into a future milestone.
- **NO, we have a gap** — the template solves something code-oz needs and does not yet have a credible plan for; debate and decide whether to insert a new milestone.

## Sessions

Each row is owned by one session. PRs from other sessions add their own rows on merge.

| #  | Template    | Date       | Decision | Folder |
| -- | ----------- | ---------- | -------- | ------ |
| 02 | agenticSeek | 2026-05-10 | YES, structurally stronger on SDLC authority mechanics that overlap (not "ahead on every"); 4 borrow candidates ranked B3 (conditional on MCP-gap evidence) -> B1 (VERIFY-fail bad-plan telemetry, no plan-mutation authority) -> B4 (local-first OpenAI-compatible provider, demand-gated to PE-2) -> B2 (advisory DEFINE risk/effort hint, no `suggested_path`); substring denylist + memory-compression-as-canonical-state killed; local-first privacy upgraded from off-mission to demand-gated borrow; 3 rounds (Codex `accept-with-modifications` thread `019e12ac` -> 12 round-2 deltas, 10 distinct after merge -> round 3 both Opus and Codex independently report `converged` with 0 deltas, threads `019e131b` / `019e1323`); GPL-3.0 license noted | [02-agenticSeek/](02-agenticSeek/) |
| 07 | maestro     | 2026-05-10 | YES, with selective borrows (B1 narrowed wave-verify; B2 heartbeat deferred as projection; B3 PLAN_DIFF blocked on SHIP contract; B4 separated from B5; B5 `outcome=abandoned` use-case-gated; B7 maestro bash loop rejected, `code-oz watch` deferred with contract draft); Codex `fix-first` thread `019e12ee` -- all 6 findings closed in synthesis (rule-21 misapplication corrected -> rule 20, RUN_OUTCOMES schema risk surfaced, SHIP-contract gap identified, Bun-native CI added to deferred set); maestro is the parent template -- three load-bearing rules already absorbed (rules 1/3/4) | [07-maestro/](07-maestro/) |

## Open questions surfaced by comparisons (decisions, not milestones)

These are decisions the project owner makes outside any single milestone. Each is sourced to the comparison row that surfaced it.

- **SHIP contract** -- does SHIP get its own `docs/contracts/SHIP.md`? Blocks 07-maestro/B3 (`PLAN_DIFF.md`) and 07-maestro/B4 (`NEXT_RUN.md`). Surfaced 2026-05-10 by Codex during maestro debate (thread `019e12ee`).
- **`outcome=abandoned`** -- what is the use case that justifies extending `RUN_OUTCOMES` (currently `shipped | stopped | paused` at `src/state/schemas.ts:421`)? Blocks 07-maestro/B5. Surfaced 2026-05-10.
- **`code-oz watch` demand signal** -- defined as a recurring unattended use case beyond W3-lite scope. Reopens 07-maestro/B7. Surfaced 2026-05-10.

## Backlog

Audited templates from the CLAUDE.md influence library that have not yet been compared in a session: `opencode`, `pi-mono`, `claude-code`, `agent-skills`, `Archon`, `Auto-claude-code-research-in-sleep`.

Unaudited (on-disk, no entry in CLAUDE.md influence library): `agentic-canvas`, `byterover-cli`, `Chorus`, `claude-coder`, `codegraph`, `codex`, `gptme`, `learn-harness-engineering`, `Mimir`, `prd-taskmaster`, `skills`. These are surveyed by parallel sessions; see their PRs for verdicts.
