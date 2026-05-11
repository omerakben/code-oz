---
name: CODEX_SYNTHESIS_3SESSION_HANDOFF
status: locked (execution-ready)
date: 2026-05-12
sources:
  - docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md
  - docs/design/CODEX_RESPONSE_3SESSION_HANDOFF.md (thread 019e17a8)
verdict-in: fix-first
verdict-locked: accept-with-modifications (after applying all fix-first findings)
---

# Synthesis — three-session handoff plan + demo prep (locked)

This doc supersedes the briefing in operational terms. Next three sessions execute from this file. The briefing is the historical input; this is the contract.

## What changed after Codex review

Three load-bearing premises in the original briefing were wrong; this synthesis corrects them.

1. **Session 3 is not "Commit A 2/3 + 3/3."** The opencode synthesis explicitly demand-gates MCP implementation. Commit A is complete after 1/3. The remaining opencode work is fix-soon backlog, not a continuation of the A series. Session 3 is reframed as **"opencode triage + branch hygiene."**
2. **Session 2 is not "implement Commit 2 from scratch."** The B1a worktree already carries 439 lines of Commit-2-shaped work across 7 files. Session 2 is reframed as **"R0 on existing diff → fix → R1 → merge."**
3. **The opencode worktree's current diff is not MCP scope.** It is Q7 panel-voter lineage observability (`src/phases/review-panel.ts`, `src/state/schemas.ts`, `tests/review-panel-orchestrator.test.ts`, 164 lines). Must be split or shelved before any Session 3 MCP-track work.

## Locked verdicts (decision table)

| ID | Question | Codex verdict | Locked action |
|---|---|---|---|
| D1 | Session 3 hypothesis | fix-first → H4 | Session 3 = opencode triage. Split out Q7 lineage diff from opencode worktree first. |
| D2 | Session 1 dirt | accept-with-mods | Restore 06-codex; path-scoped cleanup only; move handoff to `docs/handoffs/`; add `.claude/` to `.gitignore`; force-remove merged worktrees with consent |
| D3 | B1a rule number | accept | Rule 23 (not 22). Fix `B1A_EFFORT_FLAG.md` + diff + `docs/references/budgets.md` |
| D4 | B1a review cadence | accept-with-mods | Run R0 on existing diff THEN R1 after fixes |
| D5 | Demo example | accept | Greenfield todo CLI, FakeProvider-driven, deterministic, offline |
| D6 | Tag timing | accept-with-mods | Merge through Session 3 locally; tag `v0.19.0-alpha.0` only AFTER demo lands, with explicit Ozzy approval |
| D7 | Worktree cleanup | accept-with-mods | Targeted force-remove with consent; do NOT reconfigure the hook |
| D8 | Demo length/format | accept | asciicast + Markdown, ~5 min, under `docs/demo/` + README link |
| D9 | B1a bundling risk | accept-with-mods | Keep B1a as 2 commits; gate Commit 2 on R0 + targeted test list |
| D10 | Demo over-sells thesis | accept-with-mods | Label every walkthrough section "works today" vs "contract prepared." Top 4 highlights: gate files, cross-family REVIEW, `--effort`, budget/event telemetry. MCP is contract-only. |
| D11 | Missed risks | fix-first | Add preflight inventory step (`git status` + `git diff --stat` classification) before Session 2 and Session 3 |

## Session 1 — clean working tree (locked)

### Operating principle

Path-scoped only. Never blanket `git clean`. The briefing + Codex response + synthesis are themselves untracked and would be collateral damage.

### Ordered steps

1. **Preflight inventory.** `git status` + `git worktree list` + `git stash list` recorded into the session handoff doc at start.
2. **Restore 06-codex deletion.** `git checkout HEAD -- docs/comparison/06-codex/`. Verify by re-reading one file.
3. **Move untracked WIP doc files to their owning worktrees** (path-scoped):
   - `docs/comparison/03-aris/` (4 files) → `.claude/worktrees/aris-borrows-pre-m17/docs/comparison/03-aris/` if not already there
   - `docs/comparison/11-opencode/` (4 files) → opencode worktree (verify with `ls .claude/worktrees/opencode-fixfirst/docs/comparison/11-opencode/`)
   - `docs/design/B1A_EFFORT_FLAG.md` → B1a worktree (verify before remove from main)
   - After verification: `rm` only the verified-present-elsewhere copies from main's working tree
4. **Commit handoff doc.** Move `SESSION_HANDOFF_2026-05-11.md` to `docs/handoffs/2026-05-11-afk-merge-loop.md`. Commit as `docs(handoffs): preserve 2026-05-11 AFK merge loop handoff`.
5. **`.gitignore` fix.** Add `.claude/` to `.gitignore` after verifying no repo-owned files live under it. Commit as `chore(gitignore): ignore .claude/ host scratch directory`.
6. **Worktree cleanup (force-remove with consent).**
   - Generate the removal list: every worktree where the branch is merged into `origin/main` AND the branch name is not `worktree-aris-borrows-pre-m17` AND not `worktree-opencode-fixfirst`.
   - Ask Ozzy explicitly: "force-remove these N worktrees + delete their branches?"
   - On yes: `git worktree remove --force <path>` then `git branch -D <branch>` per entry.
7. **Commit this synthesis + briefing + Codex response** to `docs/design/`. (They are currently untracked and Session 1 hardware-deletes them otherwise.) Commit as `docs(design): three-session handoff briefing + Codex response + synthesis`.

### Acceptance — Session 1 closed

- `git status` returns nothing (or only intentional state)
- `git worktree list` shows exactly 3 entries: main + aris + opencode
- `docs/comparison/06-codex/` restored and tracked
- `docs/handoffs/2026-05-11-afk-merge-loop.md` committed
- `.claude/` in `.gitignore`
- Briefing + Codex response + synthesis committed
- Handoff doc written: `docs/handoffs/2026-05-12-session-1-clean.md` with the closing state

### Optional in parallel with Session 1 (read-only)

Session 3 design clarification can proceed read-only during Session 1: re-read `docs/comparison/11-opencode/SYNTHESIS.md` in full and produce a draft triage list of opencode fix-soon items. No file writes outside `docs/design/`.

## Session 2 — B1a effort flag (locked, R0-first)

### Operating principle

The B1a worktree at `.claude/worktrees/aris-borrows-pre-m17` already carries 7-file / 439-line Commit-2 diff. Treat that diff as a proposed implementation, run Codex R0 read-only on it, fix what comes back, then R1 before merge.

### Ordered steps

1. **Preflight inventory in the B1a worktree.** `git status` + `git diff --stat` + classify each modified file as keep-as-is / fix / split / discard.
2. **Fix rule number from 22 to 23** in `docs/design/B1A_EFFORT_FLAG.md`, the working-tree diff, and `docs/references/budgets.md`. Rule 22 is already consumer-first/RED-first TDD per `CLAUDE.md:50`.
3. **Lock event order.** `initRun()` at `src/state/run.ts:221-243` emits `run_started` then `phase_entered`. Decide: `effort_envelope_applied` goes between them, or after `phase_entered`? Lock the answer in `B1A_EFFORT_FLAG.md` § "Where the flag lives" before tests hard-code it.
4. **Write CODEX_BRIEFING_B1A_R0.md** with the current diff context + the four debate prompts: (a) event order, (b) rule number renumber complete?, (c) any coupling bugs in the existing diff, (d) any sub-surface that should split out.
5. **Invoke Codex R0** with `sandbox: read-only`, `gpt-5.5` xhigh. Capture as `CODEX_RESPONSE_B1A_R0.md`.
6. **Address R0 findings.** Block-push + fix-soon close before continuing. Nits/fyis may defer.
7. **Verify Commit 1 still applies cleanly.** `git log --oneline main..` on the worktree branch should show `1176d5d` (audit + design) and `252baac` (applyEffort pure transform) unchanged.
8. **Commit 2** as a single commit: `feat(config+state): --effort flag wires budget envelope through CLI, events, active-run replay (B1a Commit 2 of 2)`. Includes all 7 files + the new e2e test.
9. **Targeted test list** (from `B1A_EFFORT_FLAG.md:132-137`):
   - `bun test tests/config-effort-unit.test.ts`
   - `bun test tests/cli-effort-envelope.test.ts`
   - `bun test tests/providers-cost.test.ts tests/cost-byrole.test.ts tests/cost-debate-scheduler-preflight.test.ts`
   - `bun test tests/review-panel-orchestrator.test.ts tests/state-events.test.ts tests/state-run.test.ts`
   - `bun run typecheck` clean
   - Then `bun test` total: 3244 + N new
10. **Write CODEX_BRIEFING_B1A_R1.md** + invoke Codex R1 after Commit 2 lands. Capture as `CODEX_RESPONSE_B1A_R1.md`. Continue until verdict is push.
11. **Merge B1a worktree branch to local main.** `git checkout main && git merge --no-ff worktree-aris-borrows-pre-m17`. Push only on explicit Ozzy approval.
12. **Handoff doc:** `docs/handoffs/2026-05-XX-session-2-b1a-effort.md`.

### Acceptance — Session 2 closed

- All acceptance criteria from `B1A_EFFORT_FLAG.md` § "Acceptance criteria" satisfied
- `code-oz run --effort {lite|balanced|max|beast}` works end-to-end via binary
- `events.jsonl` carries `effort_envelope_applied` after every fresh run
- Active-run continuation correctly replays effort
- Mismatched `--effort` on active run rejects with documented error
- Codex R1 verdict = push
- Merged to local main (no push without Ozzy approval)
- No tag

### Handoff to Session 3

- B1a CLI works on `main`
- `B1A_EFFORT_FLAG.md` accurately reflects what shipped
- Rule 23 lives in `CLAUDE.md`
- The new event type is in the schema validator

## Session 3 — opencode triage + branch hygiene (locked, reframed per H4)

### Operating principle

Commit A is complete after 1/3. There is no MCP runtime work in this session. The job is: (a) split the misplaced Q7 lineage diff out of the opencode worktree, (b) merge Commit A 1/3 to main, (c) triage the remaining fix-soon items from the opencode synthesis and decide which (if any) to pull forward.

### Ordered steps

1. **Preflight inventory in the opencode worktree.** `git status` + `git diff --stat`. Classify each modified file. Current expectation: `src/phases/review-panel.ts`, `src/state/schemas.ts`, `tests/review-panel-orchestrator.test.ts` are Q7 lineage, not MCP.
2. **Split the Q7 lineage diff onto its own branch.** From the opencode worktree:
   - `git stash push -m "Q7 lineage observability work for separate landing" src/phases/review-panel.ts src/state/schemas.ts tests/review-panel-orchestrator.test.ts`
   - Verify `git status` is clean
   - Decide whether to retrieve the stash onto a new branch in a later session, or drop it. Default: keep stashed, file an issue, address in a follow-up session if Codex R0 on the Q7 work surfaces value.
3. **Verify Commit A 1/3 is unchanged.** `git log --oneline main..` should show only `4870a32`.
4. **Merge opencode worktree branch to local main.** `git checkout main && git merge --no-ff worktree-opencode-fixfirst`. This brings in `docs/contracts/MCP_TRUST_BOUNDARY.md` + 2 roadmap candidate slots + opencode comparison docs.
5. **Triage remaining opencode fix-soons.** Re-read `docs/comparison/11-opencode/SYNTHESIS.md` §"Open Questions" / §"Borrow rankings." For each fix-soon: keep-deferred / pull-into-next-milestone / drop. Record in `docs/handoffs/2026-05-XX-session-3-opencode-triage.md`.
6. **Codex R-merge.** One Codex review round on the merged state: did anything regress? Are the candidate slots well-formed? Sandbox read-only.
7. **Address findings.** Block-push + fix-soon close before handoff.
8. **Handoff doc.**

### Acceptance — Session 3 closed

- `docs/contracts/MCP_TRUST_BOUNDARY.md` is on `main`
- 2 roadmap candidate slots (B2, M-CANCEL) are on `main`
- opencode comparison docs are on `main` (resolves the untracked-files state from Session 1)
- Opencode worktree is either clean or carries the stashed Q7 work for later
- Codex R-merge verdict = push
- No tag
- Triage decisions documented

### Handoff to demo prep

- All 3 streams merged on local main
- Working tree clean
- 2 future-track items either deferred-with-issue or ready to start as new sessions

## Demo prep — post-Session 3 (locked)

### Operating principle

Show what works today. Label every walkthrough section "works today" or "contract prepared for future work." The MCP trust-boundary is contract-only; it is not runtime-active. The "AI software company" thesis is the metaphor, not the deliverable.

### Top 4 demo highlights

1. **Gate files.** Show `GATE_PLAN_PASSED.json` and one `NEEDS_INTERVENTION.json`.
2. **Cross-family REVIEW.** A real REVIEW step where BUILD is one provider and REVIEW is a different family.
3. **`--effort` flag.** Show `lite` vs `beast` running the same DEFINE → produce different budget envelopes. Show the `effort_envelope_applied` event.
4. **Budget/event telemetry.** Show `events.jsonl` tail with budget warnings and the run-level spend rollup.

### Walkthrough plan

- Example: greenfield todo CLI with file persistence. ~50 LOC target.
- Recording: asciicast (5 min target) + Markdown transcript under `docs/demo/`.
- README link.
- Mention MCP trust-boundary contract briefly in the "what's next" section. Do not run any MCP-touching commands.

### Ordered steps

1. **Scope the example.** Write `docs/demo/01-todo-cli/SPEC.md` (1 page) — the would-be DEFINE input.
2. **Dry-run the example offline** with `FakeProvider`. Validate the cycle completes without errors at default effort.
3. **Run again at `--effort lite` and `--effort beast`.** Capture both `events.jsonl` tails.
4. **Record asciicast.** `asciinema rec docs/demo/01-todo-cli/cast.cast` against the dry-run script.
5. **Write `docs/demo/01-todo-cli/README.md`** — the walkthrough with embedded cast + transcript + "works today" labels.
6. **README at repo root** — add a "Demo" section linking to `docs/demo/01-todo-cli/README.md`.
7. **Codex retrospective.** One round on the full 3-session + demo sweep. Anything that should change about how comparison series ships next time? Anything the demo over-promises? Capture as `CODEX_RETRO_3SESSION_SWEEP.md`.
8. **Request explicit tag approval from Ozzy.** On approval: bump package.json to `0.19.0-alpha.0`, tag `v0.19.0-alpha.0`, push tag, publish GitHub release.

### Acceptance — demo prep closed

- `docs/demo/01-todo-cli/` exists with SPEC + cast + README
- Root README links to demo
- Codex retrospective recorded
- `v0.19.0-alpha.0` tagged + pushed + GitHub release (on Ozzy approval)

## Cross-session invariants (re-affirmed)

- Local-only merges. No push without explicit Ozzy approval.
- Codex review at every behavior-change boundary. `gpt-5.5` xhigh, read-only for design, workspace-write only if Codex needs to apply fixes itself.
- Preflight inventory at the start of Sessions 2 and 3 (this is a new requirement per D11).
- Handoff doc per session under `docs/handoffs/` with `git status` + `git worktree list` + test count + what's next.
- Memory entries written per session for surprises, validated approaches, and any rule-tension findings.
- No emojis. No `Co-Authored-By: Claude` footer.
- All tests offline via `FakeProvider`. Live xAI gated behind env flags.

## Risk register (carried into execution)

| ID | Risk | Mitigation | Owner phase |
|---|---|---|---|
| R1 | Q7 lineage diff lost in stash | File issue immediately; reference stash ID in handoff doc | Session 3 step 2 |
| R2 | B1a Commit 2 diff has hidden coupling bug | Codex R0 on the diff before any commit | Session 2 step 5 |
| R3 | Event-order ambiguity (`run_started` vs `effort_envelope_applied` vs `phase_entered`) leaks into tests | Lock the order in design doc before any test runs | Session 2 step 3 |
| R4 | Schema conflict between B1a and Q7 lineage diffs | Sessions 2 and 3 strictly serial. Session 3 only after Session 2 merges. | Cross-session |
| R5 | Demo over-sells the thesis | "works today" labels mandatory; MCP is contract-only | Demo prep step 5 |
| R6 | Worktree force-remove blocked by hook even with consent | Use `git worktree remove --force` with `--force` flag; if still blocked, use `git worktree prune` after manual rm | Session 1 step 6 |
| R7 | Rule 23 renumber conflicts with concurrent rule additions | Verify `CLAUDE.md` rule count immediately before commit; if a rule landed between Session 1 and Session 2, renumber to 24 | Session 2 step 2 |

## Sign-off

Verdict: **accept-with-modifications**, all fix-first findings incorporated. Codex thread `019e17a8` retained as evidence. Execution starts at Session 1.

---

*Next action: hand off this synthesis + briefing + response to Ozzy for sign-off, then begin Session 1.*
