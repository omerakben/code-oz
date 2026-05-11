---
name: CODEX_BRIEFING_3SESSION_HANDOFF
status: planning-convergence (pre-implementation)
owner: Claude Opus 4.7 (xhigh) — maestro; Codex (gpt-5.5 xhigh, sandbox read-only) — reviewer
goal: finalize the scope of three sequenced sessions (clean → B1a → opencode A) and the post-sequence demo, with explicit per-session handoff contracts
no-code-this-session: true
---

# Briefing — three-session handoff plan + demo prep

## Goal of this planning session

Finalize the scope, ordering, and handoff contracts for three sequential sessions plus a demo-prep follow-up. No code lands in this session. Output is the synthesis doc that the next three sessions will execute against.

Sessions, in lock order:

1. **Session 1 — clean working tree.** Resolve dirty state on `main`, prune stale worktrees, decide what to commit and what to delete.
2. **Session 2 — land B1a (effort flag).** Verify Commit 1 (already on `worktree-aris-borrows-pre-m17`), implement Commit 2, Codex review, merge to main.
3. **Session 3 — opencode MCP Commit A 2/3 + 3/3.** Continue from `worktree-opencode-fixfirst` (HEAD `4870a32`, Commit A 1/3 already committed).
4. **Demo prep.** Author a short walkthrough that exercises B1a + cross-family REVIEW + the MCP trust-boundary contract.

## Background — current repo state (2026-05-11)

- HEAD: `e64e4ff` on `main`, in sync with `origin/main`. Tag `v0.18.0-alpha.0` pushed.
- Tests: 3244 pass / 2 skip / 0 fail.
- Working tree dirt (not yet committed):
  - 4 deleted files under `docs/comparison/06-codex/` (BRIEFING, RESPONSE, COMPARISON, SYNTHESIS). Last touched by commits `e18d127` (added) and `edc408d` (PR #24 message references 06-codex). Reason for current deletion is unclear — likely a stash mishap or sub-agent rm. Originals are recoverable via `git checkout HEAD -- docs/comparison/06-codex/` if intentional restoration is the call.
  - Untracked: `SESSION_HANDOFF_2026-05-11.md` (handoff doc from the AFK loop), `.claude/` (plugin local state), `docs/comparison/03-aris/` (4 files, 675 lines, belongs to `worktree-aris-borrows-pre-m17`), `docs/comparison/11-opencode/` (4 files, 670 lines, belongs to `worktree-opencode-fixfirst`), `docs/design/B1A_EFFORT_FLAG.md` (169 lines, the ratified B1a design doc).
- Worktrees on disk: 9 substantive (main + 2 WIP branches + 6 merged branches with stray uncommitted files) + 14 locked `.claude/worktrees/agent-*` from the M16 C9 follow-on series. All non-WIP branches are merged into origin/main.
- WIP branches (commits ahead of main):
  - `worktree-aris-borrows-pre-m17` at `252baac` — applyEffort() pure transform (Commit 1 of 2). Also `1176d5d` — ARIS borrow audit + B1a design doc.
  - `worktree-opencode-fixfirst` at `4870a32` — MCP trust-boundary design + 2 roadmap candidate slots (Commit A 1/3). Bound to `.claude/worktrees/opencode-fixfirst`.

## Constraints (cross-session)

- **Rule 5 (workflow):** default no-push. Each session merges to local main only; push happens on explicit Ozzy authorization.
- **Rule "Cross-model peer review":** every session that touches behavior runs at least one Codex round at completion. Session 1 is doc + state hygiene only, so Codex review there is optional unless the resolution of 06-codex deletion is non-obvious.
- **Rule "no tech debt at milestone close":** every block-push / fix-soon Codex finding closes before tag or before merge to main. Nits/fyis may defer.
- **Rule 20 sub-surface count discipline:** count actual sub-surfaces touched, not authority labels. B1a is 9 sub-surfaces under 1 authority axis (the rule-19 budget envelope).
- **Rule 22 (consumer-first, RED-first TDD):** Session 2 and Session 3 follow RED-first. Write the failing test, run it red, then minimal implementation, then green.
- **No emojis, no Co-Authored-By: Claude footers.**
- **All commands run offline.** `FakeProvider` covers spine tests. Live xAI is gated behind env flags.

## Session 1 scope — clean working tree

### What needs deciding

S1-D1: **The 06-codex deletion.** Three plausible resolutions:
  - (a) Restore — `git checkout HEAD -- docs/comparison/06-codex/`. Treat the deletion as accidental.
  - (b) Stage and commit the deletion — if the 06-codex content actually moved into another path (verify by grepping for unique sentinel strings from each file).
  - (c) Investigate further before deciding — `git log -p --follow docs/comparison/06-codex/SYNTHESIS.md | head -200` to see whether anything renamed the directory.
  My recommended default: (a) restore, then (c) verify. Codex: agree, or do you prefer commit-the-delete?

S1-D2: **The 5 untracked working-tree files belonging to WIP branches.** They appear under `main`'s working tree because the worktrees that own them sit under `.claude/worktrees/` not the main checkout. Three options:
  - (a) `git clean -n` to preview, then `git clean -f` to remove from main. The files exist on their branches.
  - (b) Add them to `.gitignore` to silence the noise.
  - (c) Move them into their respective worktree directories (manual).
  My recommended default: (a) clean from main after confirming they exist on their WIP branches.

S1-D3: **`SESSION_HANDOFF_2026-05-11.md`.** It is a session record, not a contract. Options:
  - (a) Commit to `docs/handoffs/2026-05-11-afk-merge-loop.md`.
  - (b) Delete — the content survives in the v0.18.0-alpha.0 release notes.
  - (c) Move to `.claude/` (local-only).
  My recommended default: (a) — handoffs are evidence the AFK pattern works; future Codex retrospectives may reference them.

S1-D4: **`.claude/` directory.** Already `.gitignore`'d as far as I can tell, but the working-tree shows it as untracked. Action: confirm `.claude/` is in `.gitignore`; if not, add it.

S1-D5: **Worktree cleanup.** 14 locked `.claude/worktrees/agent-*` + 8 substantive worktrees outside `.claude/worktrees/`. All non-WIP branches are merged. The local hook blocks `git worktree remove --force` and `git branch -D` without overrides. Options:
  - (a) Bypass the hook this once with explicit consent — remove all worktrees whose branches are merged into origin/main.
  - (b) Leave them and reconfigure the hook to allow `--force` on merged branches.
  - (c) Leave them entirely.
  My recommended default: (a) with Ozzy's explicit OK on the force-remove. The branches are merged; this is reversible only insofar as the commits exist on main. The worktrees themselves carry no unmerged state per the handoff doc.

### Acceptance criteria — Session 1 closed

- `git status` returns nothing (or only intentional state)
- `git worktree list` shows: main + `worktree-aris-borrows-pre-m17` + `worktree-opencode-fixfirst` (3 entries total)
- 06-codex deletion resolved (restored, committed-as-delete, or documented)
- `SESSION_HANDOFF_2026-05-11.md` moved to a permanent home
- Handoff doc written: `docs/handoffs/2026-05-12-session-1-clean.md` (or similar) with the resolution decisions and any new gotchas

### Handoff to Session 2

Hard requirements:
- Clean `git status`
- `worktree-aris-borrows-pre-m17` is still at `252baac` (Commit 1 of B1a unchanged)
- `B1A_EFFORT_FLAG.md` either committed to main (as a design doc) or still living on the worktree branch (decide in Session 1)

## Session 2 scope — B1a effort flag

### Reference

The design doc is `docs/design/B1A_EFFORT_FLAG.md` (already ratified by Codex thread `019e1318` — 4 load-bearing bugs caught and fixed pre-design). The 9 sub-surfaces are pinned. Commit 1 already lives on `worktree-aris-borrows-pre-m17` at `252baac`.

### Commit 2 scope (per the touchlist in B1A_EFFORT_FLAG.md §"File touchlist", item 5–11)

5. `src/commands/run.ts` arg parser at line 375+ — add `--effort` and `--effort=...` cases, validate against `EFFORT_LEVELS`, reject unknown values
6. `src/state/run.ts:221-243` `initRun()` — emit `effort_envelope_applied` immediately after `run_started`
7. `src/state/events.ts` — add `effort_envelope_applied` to event union + schema validator + no-op projection
8. `src/commands/run.ts` active-run reload sites at `:956, :1083, :1387, :1694` — reconstruct effective config from event after each `loadConfig()`. Reject mismatched `--effort` on active run.
9. `tests/cli-effort-envelope.test.ts` (NEW) — binary-spawn e2e covering fresh-run + active-run + mismatched-effort-rejected at all four levels
10. `CLAUDE.md` — add **rule 23** (NOT rule 22 — rule 22 already exists for consumer-first/RED-first TDD; B1a's effort-flag invariant is a separate rule). Codex: confirm this re-numbering is correct.
11. `docs/references/budgets.md` — add "Effort multipliers" section

### Acceptance criteria — Session 2 closed

The 5 acceptance criteria from B1A_EFFORT_FLAG.md §"Acceptance criteria" (a–f) plus:
- `bun test` total: 3244 + N new (where N is the new test count, expected ~15–25)
- `bun run typecheck` clean
- Codex review (R0 on Commit 2 design before implementation? Or just R1 after? Codex: advise) returns push verdict
- Merge to local main with the Commit 1 + Commit 2 pair (no squash)
- No tag (B1a is pre-M17 polish, not a milestone)

### Handoff to Session 3

- `code-oz run --effort {lite|balanced|max|beast}` works end-to-end
- `events.jsonl` carries `effort_envelope_applied` after every fresh run start
- Active-run continuation correctly replays effort
- Demo can showcase the budget envelope dimension

## Session 3 scope — opencode MCP Commit A 2/3 + 3/3

### Reference

Commit A 1/3 is `4870a32` on `worktree-opencode-fixfirst` (bound to `.claude/worktrees/opencode-fixfirst`). It lands:
- `docs/contracts/MCP_TRUST_BOUNDARY.md` (12 invariants for any future MCP integration)
- `docs/design/ROADMAP.md` +2 candidate slots: (B2) deny-dominant wildcard permission expressions; (M-CANCEL) cancellation + timeout + debate-recursion guard with AbortSignal first
- `docs/comparison/11-opencode/{COMPARISON,CODEX_BRIEFING,CODEX_RESPONSE,SYNTHESIS}.md`

Codex review history: 3 rounds (R1 fix-first, R2 fix-first, R3 push) — all findings closed. Threads `019e131e`, `019e1328`, `019e132d`.

### Open question — what are Commits A 2/3 and A 3/3?

The Commit A 1/3 message implies a 3-commit series but does not enumerate 2/3 and 3/3. Reading the synthesis (`docs/comparison/11-opencode/SYNTHESIS.md` — to be re-read in Session 3 kickoff), the plausible splits are:

- **Hypothesis H1 — implementation-thin:** A 2/3 = add `tool_use.mcp` to the permission scope union in `src/agents/types.ts` + tests; A 3/3 = preflight check in `src/providers/invoke.ts` that refuses MCP usage when the trust-boundary contract isn't satisfied (still no real MCP wiring; just the guard). Authority cost: 1 new permission sub-scope, design-only enforcement.

- **Hypothesis H2 — events-only:** A 2/3 = add `mcp_*` audit-event types to the event union per the contract's "audit-event envelopes mirror repo_context_searched shape" requirement; A 3/3 = consumer-side audit ingestion + tests. Authority cost: events + projection.

- **Hypothesis H3 — contract-only completion:** A 2/3 = expand the trust-boundary contract with the 13th invariant Codex deferred (TBD on re-reading SYNTHESIS.md); A 3/3 = pull the MCP trust-boundary tests + fixtures into the test harness. Authority cost: zero runtime; doc + tests only.

Codex: which hypothesis matches the SYNTHESIS intent? Or is the actual split different? **This is the most important question of the briefing.**

### Acceptance criteria — Session 3 closed (provisional, pending H1/H2/H3 decision)

- All commits in the A series merged to local main
- Codex review converges to push verdict
- Tests pass with new additions
- `docs/contracts/MCP_TRUST_BOUNDARY.md` is referenced from `CLAUDE.md` if not already
- No tag (this is post-v0.18 polish, not a milestone)

### Handoff to demo prep

- MCP trust-boundary contract is land-ready for any future MCP integration milestone
- 2 roadmap candidate slots (B2, M-CANCEL) are visible in ROADMAP for the demo narrative

## Demo prep scope (post-Session 3)

### Goal

Show the `code-oz` "AI software company" thesis in action: artifact-driven SDLC, file-based gates, cross-family REVIEW, debate, run-level budgets with the new `--effort` flag, and the MCP trust-boundary contract as the next authority frontier.

### Open decisions for Codex

D-DEMO-1: **Example project.** Options:
  - (a) A small greenfield CLI: "build a todo list with file-based persistence." Compact, easy to follow, demonstrates DEFINE→SHIP linearly.
  - (b) A small brownfield audit: take an existing 200-line script with one known bug and run `code-oz` AUDIT→PLAN→BUILD→VERIFY→REVIEW. Demonstrates the brownfield contract and AUDIT artifact.
  - (c) Both, as separate demos.
  - (d) Something else entirely (e.g., a "self-build" where code-oz audits its own scaffold).
  My recommended default: (a) for the first demo, (b) as a follow-up.

D-DEMO-2: **Recording format.** Options:
  - (a) asciicast / asciinema — small file, embeddable in README, replayable.
  - (b) Markdown walkthrough with pasted terminal output. Searchable, but static.
  - (c) Video with voiceover.
  - (d) GitHub-rendered live demo via Actions.
  My recommended default: (a) for the terminal cast + (b) for the README narrative.

D-DEMO-3: **Length.** Options:
  - (a) <3 min — show one phase transition, one gate file, one REVIEW handoff.
  - (b) 3–8 min — full DEFINE→SHIP cycle, condensed.
  - (c) 8–15 min — full cycle with debate + Reviewer panel + `--effort beast`.
  My recommended default: (b).

D-DEMO-4: **What to highlight.** A non-rule-of-three list of candidates: gate files; cross-family REVIEW; `--effort` flag; debate runtime; Reviewer panel; brownfield AUDIT; budget telemetry. Top 4 by demo impact?

D-DEMO-5: **Where it lives.** Options:
  - (a) `docs/demo/` directory in the repo.
  - (b) Top-level `README.md` with the cast embedded.
  - (c) GitHub release notes for v0.19.0-alpha.0 (assuming the post-Session-3 release).
  - (d) All of the above.
  My recommended default: (a) + linked from (b).

D-DEMO-6: **Tag after Session 3?** Options:
  - (a) Tag `v0.19.0-alpha.0` after Session 3 merges. Reasons: B1a is a user-visible feature (new CLI flag), worth a release.
  - (b) Tag after the demo lands. Reasons: the demo is part of the release story.
  - (c) No tag until M17 lands.
  My recommended default: (a) tag after Session 3 closes.

### Acceptance criteria — demo prep closed

- One asciicast or equivalent recording exists
- One Markdown walkthrough lives under `docs/demo/` or equivalent
- README links to the demo
- A Codex retrospective round runs on the full 3-session + demo sweep to surface anything missed

## Cross-session invariants

- All work happens locally. No push to origin without explicit Ozzy approval per session.
- All Codex reviews use `gpt-5.5` at xhigh effort, `sandbox: read-only` for design rounds, `workspace-write` for fix-rounds when modifications are needed.
- The handoff doc between sessions is mandatory. Format: `docs/handoffs/2026-05-XX-session-N-<topic>.md` with the closing state (`git status`, `git worktree list`, test count, what's next).
- Memory entries get written per session under `.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/` for: notable decisions, surprise findings, validated approaches.

## Debate prompts for Codex

Top-priority (must answer):

D1: **Session 3 scope (H1/H2/H3).** Which hypothesis matches the opencode SYNTHESIS intent for Commits A 2/3 and A 3/3? Or propose a fourth.

D2: **Session 1 dirt resolution.** For each of S1-D1 through S1-D5, agree with the recommended default or propose a different action.

D3: **B1a rule number.** Rule 22 already exists (consumer-first + RED-first TDD). The B1a effort-flag invariant should be rule 23. Confirm or push back.

D4: **B1a Codex review cadence.** R0 read-only on Commit 2 design before implementation, or just R1 after Commit 2 lands? Both, or neither?

D5: **Demo example project.** D-DEMO-1: greenfield todo CLI, brownfield audit, or something else?

D6: **Tag-after-Session-3 question.** D-DEMO-6: tag `v0.19.0-alpha.0` after Session 3, after the demo, or not until M17?

Medium-priority (advisory):

D7: **Worktree cleanup approach.** S1-D5: force-remove with consent or reconfigure the hook?

D8: **Demo length and format.** D-DEMO-2, D-DEMO-3.

D9: **Bundled-authority risk in Session 2.** Commit 2 has 6 sub-surfaces (CLI parse, event schema, event emission, active-run replay 4 sites, e2e test, doc). Is that under rule 20's per-milestone budget, given B1a is "pre-M17 polish"? Or should B1a be reframed as a half-milestone and the sub-surfaces split further?

D10: **Risk that the demo over-sells.** The "AI software company" thesis is product north star. The demo's job is to ship the actual feature set, not the aspiration. What's the discipline for separating "what `code-oz` does today" from "what the thesis aims at"?

Bonus (open-ended):

D11: **What did we miss?** Any structural risk in the 3-session plan that the briefing doesn't address.

## Format of the synthesis

After Codex responds, the synthesis goes in `docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md` with:
- Verdict per debate prompt (Codex's answer + accepted / rejected / modified)
- Final locked scope for each session
- Final demo-prep scope
- Order of operations
- Sign-off statement
