---
name: Session 3 closing handoff — opencode triage + branch hygiene
status: closed
session: 3 of 3
date: 2026-05-12
authoritative-contract: docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md
prior-session: docs/handoffs/2026-05-12-session-2-b1a-effort.md
next-session: Demo prep — post-Session 3 (greenfield todo CLI walkthrough, `v0.19.0-alpha.0` tag on Ozzy approval)
---

# Session 3 closing handoff — opencode triage + branch hygiene

Session 3 from the locked 3-session plan executed cleanly. The opencode worktree merged into local `main` after a single planned ROADMAP.md conflict resolution; the 164-line Q7 lineage observability diff was split off to a stash for later. One Codex review round on the merged state returned `push`. No tag, no push to GitHub.

## What landed this session

| SHA | Commit |
|---|---|
| `6fae670` | Merge branch 'worktree-opencode-fixfirst' into main (opencode triage — Commit A 1/3, MCP trust-boundary + 2 candidate slots) |
| `63d18c2` | docs(opencode-r-merge): Codex R-merge briefing + response — verdict push (thread 019e1837) |
| (this commit) | docs(handoffs): Session 3 of 3 closing handoff — opencode triage + branch hygiene |

The merge brings in `4870a32` (only non-merge commit on `worktree-opencode-fixfirst`):

| File | Change | Conflict? |
|---|---|---|
| `docs/contracts/MCP_TRUST_BOUNDARY.md` | new (117 lines) | clean add |
| `docs/comparison/11-opencode/CODEX_BRIEFING.md` | new (125 lines) | clean add |
| `docs/comparison/11-opencode/CODEX_RESPONSE.md` | new (70 lines) | clean add |
| `docs/comparison/11-opencode/COMPARISON.md` | new (324 lines) | clean add |
| `docs/comparison/11-opencode/SYNTHESIS.md` | new (151 lines) | clean add |
| `docs/design/ROADMAP.md` | +2 candidate slots | YES — resolved manually |

## ROADMAP.md conflict resolution

Merge-base was `0dce4b0` (M16-era); main has progressed ~30 milestones since with multiple ROADMAP edits, worktree only had 4870a32's +2-line change to the post-M16 candidate area.

- HEAD side (main) had a `**Template-comparison-derived deferred milestones (slots reserved 2026-05-10):**` umbrella with **4 gptme-derived candidates** (M17 / M18 / M19+ / M20+) plus a `Discipline:` bullet referencing `docs/contracts/RULE21_BENCHMARK.md`.
- Worktree side (`4870a32`) had **2 unbulleted opencode candidate slots** (deny-dominant wildcard permissions; cancellation / timeout / debate-recursion guard) plus a thinner `Discipline:` bullet without the `RULE21_BENCHMARK.md` reference.

**Resolution:** kept main's umbrella + 4 gptme candidates + `RULE21_BENCHMARK`-referencing Discipline bullet verbatim. Inserted the 2 opencode candidate slots inside the same umbrella, after M20+, with `; opencode B2` / `; opencode M-CANCEL` provenance tags appended to the slot names so the lineage is grep-able. Umbrella header date updated to `(slots reserved 2026-05-10 gptme + 2026-05-12 opencode)`.

The 2 opencode candidate slot bodies are verbatim from `4870a32`. Codex R-merge confirmed both intents preserved (`docs/design/CODEX_RESPONSE_OPENCODE_R_MERGE.md` § "Answers" question 1).

## Q7 lineage observability stash

The opencode worktree carried a 164-line uncommitted diff that was NOT MCP scope (3 files: `src/phases/review-panel.ts`, `src/state/schemas.ts`, `tests/review-panel-orchestrator.test.ts`). Per the synthesis it was split off before the merge.

Stashed as `stash@{0}: On worktree-opencode-fixfirst: Q7 lineage observability work for separate landing (Session 3 split)`. Content: adds a `panel_voter_lineage_unknown` event emission inside `runReviewPanel` for panelists the verdict excluded for unknown lineage. The verdict-side rejection already exists at `src/phases/review-panel-verdict.ts:158` (Codex confirmed); this stash is the emission side.

**Codex R-merge finding (fix-soon):** the stash does NOT apply cleanly to current main. `git apply --check` fails at `src/state/schemas.ts:1187` because the current `panel_quorum_rejected_same_family_vote` event is now wrapped in `OptionalActorAttributed<...>` (Chorus §3.5 actor-attribution discipline that landed during the v0.18 sweep), while the stash expects the older raw-union shape from merge-base `0dce4b0`. Also, the new event type lacks a strict validation case in `src/state/events.ts:1679`.

**Disposition:** keep stashed. Any future landing must (a) rebase against current `OptionalActorAttributed<>` wrapping, (b) add a strict validation case for `panel_voter_lineage_unknown`, (c) re-run the panel-runtime tests against the rebased shape. Per synthesis default and the Codex R-merge sanity check, the deferral is defensible — current `providerFamily` union does not include `unknown` (`src/providers/types.ts:36`), so the observability gap is forward-looking (PE-2 OpenRouter scope) not retroactive.

## Triage decisions for opencode fix-soons

| Item | Source in 11-opencode/SYNTHESIS.md | Decision | Rationale |
|---|---|---|---|
| B1 recorded HTTP fixtures (sub-milestone) | §4 | keep-deferred (Before PE-2) | Pre-loads metrics; landing waits for PE-2 demand checkpoint per synthesis. |
| B1 metrics (request-body hash stability; response schema coverage; typed error coverage; live-vs-replay parity; # of live calls removed; fixture age warn-at-90d / block-at-180d) | §4 | keep-deferred (Before PE-2) | Bundles with B1 itself. |
| B2 deny-dominant wildcard permissions | §1 | keep-deferred (now roadmap slot, demand-gated) | Landed as a candidate slot in this merge. |
| B3 MCP consumer implementation | §2 | keep-deferred (impl on demand checkpoint) | `MCP_TRUST_BOUNDARY.md` now on main; implementation milestone opens on demand. |
| B4 install ergonomics (npm + Homebrew + Scoop) | §"Revised borrow ranking" | keep-deferred (inside W3) | W3 is the install milestone. |
| B5 provider-error classification | §"Revised borrow ranking" | keep-deferred (co-shipped with B1) | Bundles with B1 typed-error coverage. |
| N1 stress tests (SlowProvider + HangProvider; panel-quorum-under-timeout; debate-cancellation-under-interrupt; nested-`requestDebate` collision) | §3 | keep-deferred (now roadmap slot M-CANCEL, demand-gated) | Landed as the M-CANCEL candidate slot in this merge. |
| N3 secondary-index thresholds (10MB / 50k events / 50ms p95) | §5 | keep-deferred (M19+ telemetry roadmap row) | Thresholds documented; no action needed until M19+. |
| Q7 family lineage hardening (`loader_provider_lineage_unknown` distinct event + e2e test of synthetic unknown-lineage voter) | §6 | keep-stashed pending future rebase | The stashed diff implements §6 but needs a small rebase before any follow-up landing (see § "Q7 lineage observability stash" above). |

Codex R-merge confirmed the triage table covers all fix-soon items from the synthesis (`docs/design/CODEX_RESPONSE_OPENCODE_R_MERGE.md` § "Answers" question 6).

## Codex review trail

One round — R-merge:

| Round | Thread | Verdict | Findings |
|---|---|---|---|
| R-merge | `019e1837` | push | 1 fix-soon (Q7 stash rebase need) + 1 nit (rules 1-21 in archived comparison inputs — historical, no edit) |

Trail artifacts:
- `docs/design/CODEX_BRIEFING_OPENCODE_R_MERGE.md`
- `docs/design/CODEX_RESPONSE_OPENCODE_R_MERGE.md`

Both findings are non-blocking. The fix-soon is forward-looking for the future Q7 follow-up session; the nit is no-edit by design because rewriting archived comparison inputs would be revisionist (the SYNTHESIS.md and `comparison/README.md` carry the current view).

## Test counts

- Pre-Session-3 baseline (main at `e7a24e6`): 3299 pass / 2 skip / 0 fail (re-measured at Session 2 close per the v0.18-residue lesson).
- Post-merge (`6fae670`): 3299 pass / 2 skip / 0 fail. Unchanged — the merge is docs-only.
- Post-handoff commit: unchanged. No source-code touched this session.

Typecheck silent (`bun run typecheck` → `tsc --noEmit` zero output).

## Acceptance — Session 3 closed

Per `docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md` § "Acceptance — Session 3 closed":

- [x] `docs/contracts/MCP_TRUST_BOUNDARY.md` is on `main` (clean add in `6fae670`)
- [x] 2 roadmap candidate slots (B2 deny-dominant wildcard, M-CANCEL cancellation/timeout/debate-recursion) are on `main` (added inside the gptme umbrella in `6fae670` via the conflict resolution)
- [x] opencode comparison docs are on `main` (`docs/comparison/11-opencode/*` clean-added in `6fae670`)
- [x] Opencode worktree carries the stashed Q7 work for later (`stash@{0}`)
- [x] Codex R-merge verdict = push (thread `019e1837`)
- [x] No tag
- [x] Triage decisions documented (this handoff § "Triage decisions for opencode fix-soons")

All acceptance criteria satisfied.

## Surprises / lessons (memory candidates)

### 1. Codex R-merge cleanly caught the Q7 stash rebase obstruction

The stash was created on a branch base (`0dce4b0`) ~30 milestones older than current main. The synthesis assumed the stash would be cleanly retrievable in a future session. Codex's `git apply --check` revealed the actor-attribution wrapping discipline (`OptionalActorAttributed<>`) that landed during the v0.18 sweep means the stash now needs a small manual rebase before any follow-up landing. This is exactly the bug class that catches synthesis-stage assumptions about "later" — schema discipline that lands between sessions silently invalidates stashed work.

**Memory candidate**: stashes created on a base older than current main should record the merge-base SHA in the stash message and the expected re-application context in the closing handoff. Future sessions can grep the stash list for the merge-base SHA and check whether intervening commits touched the stashed surface area.

### 2. Verbatim conflict resolution earned `push` on round 1

The ROADMAP.md conflict resolution kept both sides' body text verbatim — the only changes were the umbrella header date (additive: `+ 2026-05-12 opencode`) and the provenance tags inside the parenthetical slot names (`; opencode B2`, `; opencode M-CANCEL`). Codex R-merge confirmed faithfulness on question 1 without any block-push finding. The cross-session pattern: when merging a long-stale branch, prefer in-place insertion of the new content into the host file's current structure over re-flattening the host structure to match the stale branch's expectations.

### 3. Historical comparison inputs deliberately freeze a moment in time

The "rules 1-21" mentions in `docs/comparison/11-opencode/CODEX_BRIEFING.md:115` and `COMPARISON.md:194` are NOT documentation drift — they accurately capture the rule count on 2026-05-10 when the comparison was authored. Rules 22 and 23 landed afterward. The synthesis and README supersede them. Editing the comparison inputs after the fact would corrupt the historical trail Codex relies on for rule-stability evidence.

## Worktree and branch state

Local branch state (3 worktrees, 3 branches):

```
/Users/ozzy-mac/Projects/code-oz                                        <this commit> [main]
/Users/ozzy-mac/Projects/code-oz/.claude/worktrees/aris-borrows-pre-m17 c075e60 [worktree-aris-borrows-pre-m17]
/Users/ozzy-mac/Projects/code-oz/.claude/worktrees/opencode-fixfirst    4870a32 [worktree-opencode-fixfirst]
```

Both retained worktrees are now merged but kept for archival until the next worktree-cleanup pass. The stash `stash@{0}: On worktree-opencode-fixfirst: Q7 lineage observability work for separate landing (Session 3 split)` lives on; `stash@{1}` is the pre-existing pre-merge-stash-pi-mono-borrows from before this 3-session plan started.

Local main is **15 commits ahead of `origin/main`**:
- Session 1 (3): `2e2bdbc`, `daa891c`, `2e49704`
- Session 2 worktree-side, merged in (5): `1176d5d`, `252baac`, `b605f48`, `0595a99`, `c075e60`
- Session 2 main-side (3): `3926963` (merge B1a), `a7f0c57` (v0.18 hygiene), `184fa4d` (Session 2 handoff)
- Session 2 follow-up (1): `e7a24e6` (commit-count accuracy fix)
- Session 3 (3): `6fae670` (merge opencode), `63d18c2` (R-merge trail), this commit

`git status --short` on main after this commit: empty.

## Final state

- **Local main:** 15 commits ahead of `origin/main`. No push.
- **Tests:** 3299 pass / 2 skip / 0 fail. Stable across the merge.
- **Typecheck:** silent.
- **Tag:** v0.18.0-alpha.0 (latest). No new tag in this session.
- **Worktrees:** 3 (main + aris + opencode), both auxiliary worktrees retained for archival.
- **Stashes:** 2 (`stash@{0}` Q7 lineage, `stash@{1}` pre-merge pi-mono-borrows).

## Handoff to demo prep (per synthesis § "Demo prep — post-Session 3 (locked)")

All 3 streams are now merged on local main. Working tree clean. The 2 future-track candidate slots (opencode B2, opencode M-CANCEL) are deferred-with-roadmap-row and ready to start as new sessions when their measurable-risk-reduction conditions trigger.

Per the locked synthesis demo plan:

1. **Scope the example.** Write `docs/demo/01-todo-cli/SPEC.md` (~1 page) — the would-be DEFINE input. Example: greenfield todo CLI with file persistence, ~50 LOC target.
2. **Dry-run the example offline** with `FakeProvider`. Validate the cycle completes without errors at default effort.
3. **Run again at `--effort lite` and `--effort beast`.** Capture both `events.jsonl` tails.
4. **Record asciicast.** `asciinema rec docs/demo/01-todo-cli/cast.cast` against the dry-run script. 5 min target.
5. **Write `docs/demo/01-todo-cli/README.md`** — walkthrough with embedded cast + transcript + "works today" labels.
6. **README at repo root** — add a "Demo" section linking to the demo.
7. **Codex retrospective.** One round on the full 3-session + demo sweep. Capture as `CODEX_RETRO_3SESSION_SWEEP.md`.
8. **Request explicit tag approval from Ozzy.** On approval: bump to `0.19.0-alpha.0`, tag `v0.19.0-alpha.0`, push tag, publish GitHub release.

Top 4 demo highlights (per synthesis):

1. Gate files — show `GATE_PLAN_PASSED.json` and one `NEEDS_INTERVENTION.json`.
2. Cross-family REVIEW — a real REVIEW step where BUILD is one provider and REVIEW is a different family.
3. `--effort` flag — show `lite` vs `beast` running the same DEFINE → different budget envelopes. Show the `effort_envelope_applied` event.
4. Budget/event telemetry — show `events.jsonl` tail with budget warnings and run-level spend rollup.

MCP trust-boundary contract gets a brief mention in the "what's next" section. No MCP-touching commands are run in the demo.

## Next session boot script

```
cd /Users/ozzy-mac/Projects/code-oz
git status --short              # expect: empty
git worktree list               # expect: 3 entries (main + aris + opencode, both auxiliary retained)
git stash list                  # expect: 2 entries (Q7 lineage + pre-merge pi-mono)
git log --oneline -5            # expect: this commit at top
bun test                        # expect: 3299 pass / 0 fail / 2 skip
# Then start demo prep step 1 (scope docs/demo/01-todo-cli/SPEC.md)
```

Push policy stays default no-push. Ozzy's explicit approval is required for the eventual `v0.19.0-alpha.0` tag + GitHub release (per synthesis § "Cross-session invariants").
