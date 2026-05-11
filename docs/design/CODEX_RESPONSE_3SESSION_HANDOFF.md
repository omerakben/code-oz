---
name: CODEX_RESPONSE_3SESSION_HANDOFF
status: complete
reviewer: Codex (gpt-5.5 xhigh, sandbox read-only)
thread: 019e17a8-672e-72d1-8486-f1181d5e3200
verdict: fix-first
date: 2026-05-12
---

# Codex response — 3-session handoff plan

## Verdict per debate prompt

- D1: Session 3 scope, H1/H2/H3 or H4
- Answer: fix-first
- Reasoning: H1 and H2 are not supported by the opencode synthesis: B3 says "write the design now, implement demand-gated," and the revised borrow table pins implementation to a future demand checkpoint, not Commit A 2/3 or 3/3 (`docs/comparison/11-opencode/SYNTHESIS.md:34-48`, `docs/comparison/11-opencode/SYNTHESIS.md:112-120`). H2 also jumps from "audit-event shapes are locked" to "ship event union and ingestion," but the contract says the canonical schema lands when the implementation milestone opens (`.claude/worktrees/opencode-fixfirst/docs/contracts/MCP_TRUST_BOUNDARY.md:35-37`, `.claude/worktrees/opencode-fixfirst/docs/contracts/MCP_TRUST_BOUNDARY.md:67-79`). H3 is closer, but I do not see a missing 13th invariant in the synthesis; the local-server network limitation is already explicit as axiom 12 (`.claude/worktrees/opencode-fixfirst/docs/contracts/MCP_TRUST_BOUNDARY.md:31-33`). The actual synthesis intent was: close the two block-push items with contract + roadmap rows + comparison framing, then leave implementation demand-gated (`docs/comparison/11-opencode/SYNTHESIS.md:130-138`). H4: "Commit A is complete after A 1/3; remaining opencode work must be reclassified as separate fix-soon backlog, not MCP Commit A."
- Recommendation: Reject H1/H2/H3 for Session 3. Rename Session 3 to "opencode follow-up triage" unless Ozzy explicitly wants to pull one fix-soon item forward. If work proceeds, first split the current uncommitted `panel_voter_lineage_unknown` changes out of the MCP series, because that maps to Q7 lineage hardening, not B3 MCP (`docs/comparison/11-opencode/SYNTHESIS.md:82-88`).

- D2: Session 1 dirt resolution, S1-D1 through S1-D5
- Answer: accept-with-modifications
- Reasoning: S1-D1 restore is correct: `06-codex` is still referenced from CLAUDE and the comparison index, and the deleted files are tracked decision records (`CLAUDE.md:35`, `docs/comparison/README.md:39`, `docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:48-52`). S1-D2 should not use broad `git clean -f`; the current briefing itself is untracked and would be collateral damage. S1-D3 commit the handoff under `docs/handoffs/`; it records the v0.18 loop, cleanup blockers, and WIP branches (`SESSION_HANDOFF_2026-05-11.md:70-91`). S1-D4 needs an actual `.gitignore` update: `.claude/` is not ignored today, only two Ralph-loop files are (`.gitignore:29-34`). S1-D5 should force-remove only merged, non-WIP worktrees after explicit Ozzy consent; the two WIP branches are named as still active (`SESSION_HANDOFF_2026-05-11.md:72-77`).
- Recommendation: Restore `docs/comparison/06-codex/`; path-clean only known branch-owned untracked artifacts; move the handoff to `docs/handoffs/`; add `.claude/` to `.gitignore`; prune merged worktrees with explicit approval.

- D3: B1a rule number
- Answer: accept
- Reasoning: Rule 23 is correct. CLAUDE.md already has rule 22 for consumer-first design and RED-first TDD (`CLAUDE.md:50`), while the B1a design still proposes rule 22 in two places (`docs/design/B1A_EFFORT_FLAG.md:108-119`). The briefing's renumbering note is right (`docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:101-103`).
- Recommendation: Before Commit 2 lands, update `B1A_EFFORT_FLAG.md`, the implementation diff, and `docs/references/budgets.md` to call this rule 23.

- D4: B1a Codex review cadence
- Answer: accept-with-modifications
- Reasoning: Run both. B1a touches CLI parsing, config replay, event schema, event emission, active-run reload sites, tests, and docs (`docs/design/B1A_EFFORT_FLAG.md:95-111`). The pre-design review already caught four load-bearing bugs, which is evidence that this surface benefits from review before final implementation (`docs/design/B1A_EFFORT_FLAG.md:13-25`). Current live state also shows Commit 2-like uncommitted work in the B1a worktree, so R0 should review the diff before it becomes a commit.
- Recommendation: R0 read-only on the current Commit 2 diff, then implement/fix, run targeted tests, then R1 implementation review before merge.

- D5: Demo example project
- Answer: accept
- Reasoning: Use D-DEMO-1 (a), greenfield todo CLI first. It demonstrates the current greenfield DEFINE to SHIP flow and the new `--effort` flag without depending on brownfield AUDIT maturity (`docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:165-171`). Brownfield audit is a good second demo, but mixing both in the first pass creates a longer proof surface.
- Recommendation: First demo: tiny todo CLI with file persistence, FakeProvider-driven, deterministic, offline.

- D6: Tag after Session 3
- Answer: accept-with-modifications
- Reasoning: Prefer D-DEMO-6 (b), tag after demo lands, not immediately after Session 3. B1a is user-visible, but the plan's demo acceptance includes a walkthrough, README link, and retrospective (`docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:200-205`). Tagging before that splits the release story and risks releasing a feature whose proof artifact lands later. Push/tag still requires explicit Ozzy approval (`CLAUDE.md:82`, `docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:207-210`).
- Recommendation: Merge locally through Session 3, build the demo, then request explicit approval for `v0.19.0-alpha.0`.

- D7: Worktree cleanup approach
- Answer: accept-with-modifications
- Reasoning: Choose S1-D5 (a), not hook reconfiguration. The handoff says the stale locked worktrees are merged and blocked only by local force safeguards (`SESSION_HANDOFF_2026-05-11.md:53-61`). Reconfiguring the hook weakens future protection globally, while a one-time targeted cleanup with explicit consent matches the risk.
- Recommendation: Generate a removal list, exclude `worktree-aris-borrows-pre-m17` and `worktree-opencode-fixfirst`, then force-remove only merged worktrees Ozzy approves.

- D8: Demo length and format
- Answer: accept
- Reasoning: Use D-DEMO-2 (a)+(b): asciicast plus Markdown. Use D-DEMO-3 (b): 3-8 minutes. That is enough to show a real cycle without turning the demo into a lecture (`docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:172-183`).
- Recommendation: Target 5 minutes, with a Markdown transcript under `docs/demo/` and a README link.

- D9: Bundled-authority risk in Session 2
- Answer: accept-with-modifications
- Reasoning: B1a is acceptable under rule 20 only if it stays a single budget-envelope authority and does not smuggle in assurance behavior (`docs/design/B1A_EFFORT_FLAG.md:31-36`, `CLAUDE.md:48`). The split into pure transform and wiring is the right containment (`docs/design/B1A_EFFORT_FLAG.md:22-25`). Do not split Commit 2 further unless R0 finds a concrete coupling bug; CLI flag, event emission, active-run replay, and e2e are one coherent consumer path.
- Recommendation: Keep B1a as two commits, but gate Commit 2 on R0 plus the exact targeted test list in the design (`docs/design/B1A_EFFORT_FLAG.md:132-137`).

- D10: Risk that the demo over-sells
- Answer: accept-with-modifications
- Reasoning: The product metaphor is "AI software company," but the current shipped product is a repo-native governed SDLC runtime (`CLAUDE.md:11`). The MCP contract is explicitly design-only and implementation-deferred (`.claude/worktrees/opencode-fixfirst/docs/contracts/MCP_TRUST_BOUNDARY.md:14-16`). The demo should show actual commands, artifacts, gate files, event rows, and review outputs; future MCP should be narrated as "next authority frontier," not shown as runtime behavior.
- Recommendation: In the walkthrough, label every section as "works today" or "contract prepared for future work." Top 4 highlights: gate files, cross-family REVIEW, `--effort`, and budget/event telemetry. Mention MCP only as a contract.

- D11: What did we miss
- Answer: fix-first
- Reasoning: The plan undercounts live-state drift. The main checkout lacks `docs/contracts/MCP_TRUST_BOUNDARY.md` at the requested path even though the briefing treats it as a readable Commit A output (`docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:123-129`). Both WIP worktrees now have uncommitted code-like changes, so the "Session 2 implement Commit 2" and "Session 3 continue MCP A" premises are stale. There is also a real conflict lane: B1a and opencode follow-up both touch event schemas.
- Recommendation: Add a short "preflight inventory" step before Session 2 and Session 3: `git status`, `git diff --stat`, and explicit classification of every uncommitted file as keep, split, or discard.

## Missed risks

- Severity: block-push. `docs/contracts/MCP_TRUST_BOUNDARY.md` is missing from the main checkout, despite being listed as required reading and Session 3 acceptance (`docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:123-150`). Mitigation: either merge Commit A 1/3 docs first or change all handoff paths to the opencode worktree path until merged.

- Severity: block-push. The B1a worktree already contains uncommitted Commit 2-looking changes, while the briefing says Session 2 still needs to implement Commit 2 (`docs/design/CODEX_BRIEFING_3SESSION_HANDOFF.md:95-111`). Mitigation: review that diff as R0 before anyone continues.

- Severity: block-push. The opencode worktree contains uncommitted Q7 lineage-observability changes, not MCP trust-boundary work. The synthesis names Q7 as a fix-soon/backlog item, not Commit A MCP scope (`docs/comparison/11-opencode/SYNTHESIS.md:82-88`, `docs/comparison/11-opencode/SYNTHESIS.md:138`). Mitigation: split or shelve it before Session 3.

- Severity: fix-soon. B1a event ordering is ambiguous. The design says emit immediately after `run_started` (`docs/design/B1A_EFFORT_FLAG.md:98-100`, `docs/design/B1A_EFFORT_FLAG.md:115-119`), while current `initRun()` emits `run_started` then `phase_entered` (`src/state/run.ts:221-243`). Mitigation: lock the exact order in the design before tests hard-code it.

- Severity: block-push. Broad `git clean -f` during Session 1 can delete active untracked planning artifacts, including this briefing and the intended Codex response. Mitigation: use path-scoped cleanup, never blanket clean until after synthesis files are saved or committed.

- Severity: fix-soon. `.claude/` is not ignored as a directory; only specific `.claude/ralph-loop.*` files are ignored (`.gitignore:29-34`). Mitigation: add `.claude/` to `.gitignore` after verifying no repo-owned files live there.

- Severity: fix-soon. Session 3 H1/H2 would introduce runtime authority even though the opencode synthesis explicitly demand-gates MCP implementation (`docs/comparison/11-opencode/SYNTHESIS.md:47`, `docs/comparison/11-opencode/SYNTHESIS.md:118`). Mitigation: do not add `tool_use.mcp` or `mcp_*` runtime events before a dedicated implementation milestone.

## Re-ordering proposal

Keep Session 1 first. A clean main and explicit worktree inventory are prerequisites because the current dirt includes tracked deletions, untracked planning docs, and WIP-branch artifacts.

Then do a short Session 2 preflight before implementing: B1a R0 on the existing uncommitted diff, rule-number correction to 23, and event-order decision. Only after that should Commit 2 be finalized and merged.

Session 3 design clarification can happen in parallel with Session 1 as a read-only decision, but Session 3 code should not run in parallel with B1a. Both lanes touch `src/state/schemas.ts`, and the opencode lane's current diff is not actually MCP scope.

## Sign-off

fix-first
