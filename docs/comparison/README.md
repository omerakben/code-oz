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

| # | Template | Date | Decision | Folder |
|---|----------|------|----------|--------|
| 01 | ace | 2026-05-10 | YES, with selective borrows (M17-M20 Reviewer Memory sequence; see SYNTHESIS) | [01-ace/](01-ace/) |
| 02 | agenticSeek | 2026-05-10 | YES, structurally stronger on SDLC authority mechanics that overlap (not "ahead on every"); 4 borrow candidates ranked B3 (conditional on MCP-gap evidence) -> B1 (VERIFY-fail bad-plan telemetry, no plan-mutation authority) -> B4 (local-first OpenAI-compatible provider, demand-gated to PE-2) -> B2 (advisory DEFINE risk/effort hint, no `suggested_path`); substring denylist + memory-compression-as-canonical-state killed; local-first privacy upgraded from off-mission to demand-gated borrow; 3 rounds (Codex `accept-with-modifications` thread `019e12ac` -> 12 round-2 deltas, 10 distinct after merge -> round 3 both Opus and Codex independently report `converged` with 0 deltas, threads `019e131b` / `019e1323`); GPL-3.0 license noted | [02-agenticSeek/](02-agenticSeek/) |
| 03 | Auto-claude-code-research-in-sleep (aris) | 2026-05-10 | YES, with selective borrows (M14.1 fresh-reviewer + M17 storage + M19+ Failure Memory; see SYNTHESIS) | [03-aris/](03-aris/) |
| 04 | Archon | 2026-05-10 | YES, category-scoped (6 borrow candidates B1/B2/B3/B5/B6/B7 + 2 no-borrows A4/A6); Codex `accept-with-modifications`; see SYNTHESIS | [04-archon/](04-archon/) |
| 05 | agent-skills | 2026-05-10 | YES, with selective borrows | [05-agent-skills/](05-agent-skills/) |
| 06 | codex (openai/codex CLI) | 2026-05-10 | YES, with selective borrows (B1/B2/B4/B6 land at next prompt+config revision; B3/B5 demand-gated; L1 trust-boundary lock; M1-M3 missed borrows pinned); Codex `push` thread `019e12ec` | [06-codex/](06-codex/) |
| 06 | codegraph | 2026-05-10 | YES, ahead on category; B1 contract cleanup (Option D-reserved) + B2 three-case eval harness (v0.2 W3 polish) + B5 reclassified deferred-with-trigger; Codex `accept-with-modifications` thread `019e12ed` (Q8 caught: `symbol` slot is contract debt today) | [06-codegraph/](06-codegraph/) |
| 07 | learn-harness-engineering | 2026-05-10 | YES, ahead — pedagogy vs runtime; 5 borrows post-Codex (B2 blocking rule-21 methodology + B5 fail-closed tool registry + B1 external-only diagnostic + B4 relocated + R3 flipped to confirm existing AGENTS.md pointer); 4 confirmed rejects (R1/R2/R4 + B3 deferred); Codex `accept-with-modifications` (gpt-5.5 xhigh, single attempt) | [07-learn-harness-engineering/](07-learn-harness-engineering/) |
| 07 | maestro | 2026-05-10 | YES, with selective borrows (B1 narrowed wave-verify; B2 heartbeat deferred as projection; B3 PLAN_DIFF blocked on SHIP contract; B4 separated from B5; B5 `outcome=abandoned` use-case-gated; B7 maestro bash loop rejected, `code-oz watch` deferred with contract draft); Codex `fix-first` thread `019e12ee` — all 6 findings closed in synthesis (rule-21 misapplication corrected → rule 20, RUN_OUTCOMES schema risk surfaced, SHIP-contract gap identified, Bun-native CI added to deferred set); maestro is the parent template — three load-bearing rules already absorbed (rules 1/3/4) | [07-maestro/](07-maestro/) |
| 08 | pi-mono | 2026-05-10 | YES, with selective borrows (B1 renamed `requestedModel`/`responseId`; B2 split into B2a mechanism + B2b policy; B3 hardened to observer-only + wrapper-owned redactor; B4 12-pair offline cross-family handoff matrix; B5 allowlisted env reader, not whole-env Map; B6 reframed as code-oz-original typed `ProviderDiagnostic`; B7 deferred behind compiled-binary keepalive test; B8 downgraded to model lifecycle guard); Codex `accept-with-modifications` thread `019e12f0` — six disagreements accepted (B2 split, B3 hardening, B5 allowlist, B6 reframe, B7 deferral, B8 downgrade), S1 catalog deferred until provider #2, R1 annotated demand-gated for meta-providers | [08-pi-mono/](08-pi-mono/) |
| 08 | prd-taskmaster | 2026-05-10 | YES, code-oz exceeds — 2 prompt-adjacent borrows (B1 vague-language linter + B2 Goals sufficiency, both diagnostic-only) bundled under M-SPEC1; 8 mechanics rejected (USER-TEST every-5, TaskMaster delegation, datetime tracking, learn-accuracy averages, security-audit regex, rollback tagging, CLAUDE.md template, calc-tasks heuristic); Codex `accept-with-modifications` thread `019e12f0-43a3-7e31-bcf8-1e1bb4f83093` — 3 verified factual corrections folded in (15-term vocabulary incl. `poor`; prd-taskmaster runtime authority wider than first stated; `learn-accuracy.py` is duration averager not adjustment-factor learner); diagnostics MUST live outside `SpecLoadError` to keep zero new authority footprint | [08-prd-taskmaster/](08-prd-taskmaster/) |
| 09 | byterover-cli | 2026-05-10 | YES, with selective borrows (B1+B4 consolidated into rule 22 — consumer-first + RED-first TDD; B3 `parentTaskId` fan-out cost rollup shipped on `feat/byterover-09-borrows`; B2 `code-oz consult` deferred to M17/M18 after Codex F1 caught the invented surface; B5/B6 pattern-only; R10 reclassified to defer-with-high-bar); 3 Codex rounds — `fix-first` thread `019e12ec` (8 findings) + pre-design thread `019e1318` + final review (round 3 closure); 3128+ offline tests pass | [09-byterover-cli/](09-byterover-cli/) |
| 10 | mattpocock-skills | 2026-05-10 | YES, with selective borrows — modified (Codex `fix-first` thread `019e12f3`); 5 borrows split across M18b vocabulary (B1' durable project glossary at `.code-oz/artifacts/GLOSSARY.md` with opt-in promotion to root `CONTEXT.md`; B4' 3-true ADR offer gate in DEFINE/PLAN; B3' advisory architecture vocabulary for REVIEW) + M19 validation-loop (B2' feedback-loop declaration in PLAN/BUILD/VERIFY contracts; B5' `[CODEOZ-DEBUG-<runId>]` prefix + VERIFY residue check); B6 dropped (no AUDIT contract yet); N4/N5 reclassified deferred-with-trigger; M17 collision caught; slot retargeted from M18 to **M18b** to preserve gptme's M18 reservation (context-projection probe, PR #22); SPEC.md misclaim corrected (no user-stories field — six fixed sections only); see SYNTHESIS | [10-mattpocock-skills/](10-mattpocock-skills/) |
| 11 | Mimir | 2026-05-10 | YES, ahead on the discipline axes that matter to code-oz (memory-native MCP product is out-of-category by deliberate commitment); 5 borrows post-Codex (B5 Ecko-as-checklist + B4 memory-hygiene rubric + B3 rate-limit queue + B2 `OpenAICompatProvider` extraction + B1 read-only MCP server); 7 confirmed rejects (N1 Neo4j, N2 Studio/VS Code, N3 LangGraph Python tier, N4 Lambda executor, N5 Agentinator LLM persona generation, N6 OAuth/RBAC, N7 NornicDB); 4 new project-level constraints (C-MIMIR-1 MCP write-back fence; C-MIMIR-2 queue telemetry visibility; C-MIMIR-3 HTTP adapter extraction discipline; C-MIMIR-4 LLM-generated personas forbidden — clarifies rule 16); Codex `accept-with-modifications` thread `019e12f0-d136-70b0-8d9b-f573981f90bb` — 2 block-borrow risks closed, 2 fix-soon closed; B2 timing inverted (after PE-2 second adapter); B3 deferred until first 429; B1 demand-gated post-SHIP/W4+ | [11-mimir/](11-mimir/) |
| 11 | opencode | 2026-05-10 | YES, with selective borrows (5 borrows / 3 no-borrows); Codex `fix-first` thread `019e12f2` — 2 block-push closed in synthesis (B2 wildcard permissions graduates from sub-commit refinement to own milestone slot with deny-dominant semantics; B3 MCP trust-boundary design pre-loaded as `docs/contracts/MCP_TRUST_BOUNDARY.md`); 4 fix-soon/fyi accepted (N1 SlowProvider/HangProvider stress tests for cancellation classes; B1 fixture metrics; JSONL secondary-index thresholds 10MB / 50k events / p95 50ms; family-lineage hardening); product-axis re-anchored from "SDLC pipeline labels" to governance machinery (rules 20/21 + cross-model peer review rule + accumulated regression fixtures); trust-boundary incompatibility named as the decisive reason not to fork opencode's `packages/llm/`; closes the audited-influence-library backlog | [11-opencode/](11-opencode/) |

## Open questions surfaced by comparisons (decisions, not milestones)

- **SHIP contract** — does SHIP get its own `docs/contracts/SHIP.md`? Blocks 07-maestro/B3 (`PLAN_DIFF.md`) and 07-maestro/B4 (`NEXT_RUN.md`). Surfaced 2026-05-10 by Codex during maestro debate.
- **`outcome=abandoned`** — what is the use case that justifies extending `RUN_OUTCOMES` (currently `shipped | stopped | paused` at `src/state/schemas.ts:421`)? Blocks 07-maestro/B5. Surfaced 2026-05-10.
- **`code-oz watch` demand signal** — defined as a recurring unattended use case beyond W3-lite scope. Reopens 07-maestro/B7. Surfaced 2026-05-10.

## Backlog

Audited (CLAUDE.md influence library, not yet compared): _none — full influence library covered as of session 11 (opencode)._

All previously-unaudited templates closed. (`byterover-cli` in [09-byterover-cli/](09-byterover-cli/), `skills` in [10-mattpocock-skills/](10-mattpocock-skills/), both 2026-05-10.)

## Sibling index — `docs/comparisons/<template>/`

A second sweep uses the canonical `docs/comparisons/` pattern (with the s). Sessions there:

| # | Template | Date | Decision | Folder |
|---|----------|------|----------|--------|
| 1 | agentic-canvas | 2026-05-10 | YES, ahead — 5 borrows / 3 rejects / 1 split | [../comparisons/agentic-canvas/](../comparisons/agentic-canvas/) |
| 2 | chorus | 2026-05-10 | YES, ahead — categorically distinct (collab platform vs CLI) | [../comparisons/chorus/](../comparisons/chorus/) |
| 3 | claude-code | 2026-05-10 | YES, ahead — substrate (CLI host) vs framework | [../comparisons/claude-code/](../comparisons/claude-code/) |
| 4 | gptme | 2026-05-10 | YES, ahead in SDLC discipline domain — 2 narrowed-borrows (B1 compaction probe, B3 cross-tool AGENT_FILES opt-in), 4 deferred (incl. new D3 eval harness, Codex-flagged), 5 rejected; Codex `fix-first` thread `019e12ed` | [../comparisons/gptme/](../comparisons/gptme/) |
