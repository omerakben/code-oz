# Session handoff — Phase 1 complete + M17 design closed + GUI prep

**Session date:** 2026-05-12
**Session shape:** autonomous full-cycle execution after Ozzy's "continue with our standards, don't need wait for me" grant
**Next session focus:** GUI prototype work (Ozzy continues from AI Studio mockups)
**Branch state:** `main` at `986acde`, everything pushed to `origin/main`. No local-only commits.

## TL;DR

- **1000-star plan Phase 1: fully closed.** All three install channels (npm, Homebrew, curl|sh) live and smoke-verified. Discussions enabled. Brownfield profile-detection prerequisite landed. 3366 tests pass.
- **M17 design loop: closed.** R0 (`revise`) → R1 (`accept-with-modifications`). Codex explicitly: "No R2 design round required if modifications fold into the implementation plan." Modifications are folded into `docs/design/SESSION_M17_KICKOFF.md` as canonical spec.
- **One manual step pending for Ozzy:** click "Pin" on [Q&A Discussion #29](https://github.com/omerakben/code-oz/discussions/29). GitHub's GraphQL API exposes `pinIssue` and `pinIssueComment` but not `pinDiscussion`; it's a web-UI-only action.
- **Implementation can start C1 in the next coding session.** The kickoff doc locks the commit sequence + R1 mods.
- **GUI prep notes below** so the next session can pick up from AI Studio mockups against a concrete CLI-bridge surface.

## What landed this session

### Phase 1 — six sub-steps, all closed

| Sub | Status | Key detail |
|---|---|---|
| **1.1** npm publish | ✅ Live | `@tuel/code-oz@0.20.0-alpha.0` on public npm. Scoped because unscoped `code-oz` was rejected by npm's similarity guard against `codecov` (Damerau-Levenshtein too tight). Project-local `.npmrc` routes `@tuel` to public registry (overrides user-level GitHub-Packages mapping). Wrapper download → SHA-verify → `~/.cache/code-oz/0.20.0-alpha.0/code-oz` (62MB Mach-O arm64) smoke-verified end-to-end. |
| **1.2** Homebrew tap | ✅ Live | `omerakben/homebrew-code-oz` public repo created. Formula rendered from `docs/homebrew/code-oz.rb.template`; `brew audit --strict --online` passed after removing redundant `version` line (template patched upstream so future renders skip the warning). `brew install omerakben/code-oz/code-oz` smoke-installed; `code-oz --version` → `0.20.0-alpha.0`. |
| **1.3** README trust strip | ✅ | 7 badges + macOS unsigned-binary caveat above the fold. |
| **1.4** Discussions | ✅ Enabled | `gh repo edit --enable-discussions`. Q&A Discussion #29 ("What is code-oz, in 2 minutes?") posted. **Manual pin pending in web UI** — API can't auto-pin discussions. |
| **1.5** Lean README | ✅ | 126 → 70 lines. Depth moved to new `docs/ABOUT.md` (milestone inventory, product thesis, influence library, architecture locks, install channel mechanics). |
| **1.6** Brownfield profile-detection prerequisite | ✅ | `src/commands/init.ts` detector + `src/commands/run.ts:311` profile propagation fixed. New `gitHasContentfulUntrackedFiles` helper catches `.git/` + untracked source case. 3362 → 3366 tests pass. Unblocks M17 C1 consumer-first RED test. |

### M17 design loop — R0 + R1, both closed

**Authority boundary (rule 20):** "AUDIT runtime + dispatch + persona + minimum PLAN consumption slice." Codex confirmed this stays single-axis because the PLAN slice is compatibility reads + citation vocabulary for AUDIT output, not new PLAN/BUILD/VERIFY/REVIEW behavior.

**Codex chain:**

| Round | Thread | Verdict | Outcome |
|---|---|---|---|
| R0 design | `019e1dd3` | `revise` | 6 substantive findings, 8 changes required. Biggest: PLAN dead-end (runPlan needs SPEC.md; Lead is SPEC-only; SOURCE_CHECK grammar has no `SC-AUDIT`). |
| R1 design | `019e1de4` | **`accept-with-modifications`** | 7/8 closures closed; 1 partial. Two modifications locked + 1 low cleanup + 3 risk-register additions. |

**Locked R1 modifications (folded into SESSION_M17_KICKOFF.md):**

- **M1:** AUDIT emits `audit_completed` event with `auditReportSha256` field. `preApproveAuditHook` validates AUDIT.md sha against the event (mirrors `build_completed.buildReportSha256` at `src/commands/approve.ts:474-529`).
- **M2:** `RunPlanOptions.profile` plumbed through; `dispatchPlan` reads `loaded.state.profile` (event-derived per rule 1), NOT mutable `.code-oz/config.yaml`. Prevents resume-with-mutated-config drift.
- **M3:** Brownfield SOURCE_CHECK REPLACES `## Spec sources` with `## Audit sources` (not optional; not additive). Validator receives profile context.

**Commit sequence: 10 commits, 30-34h estimate, P(ships on schedule) = 65% per Codex.**

## Pushed to origin/main this session

```
986acde docs(M17): R1 briefing + Codex verdict (accept-with-modifications) + kickoff
b8a3b4d docs(M17): R0 pre-design briefing + Codex verdict (revise)
a1d9563 fix(npm): scope under @tuel + route to public registry
ef25563 chore(npm): npm pkg fix — clean bin path + repository.url prefix
946470f docs(1000-star): Phase 1.3 + 1.5 — lean README + docs/ABOUT.md
9631330 docs(1000-star): Option D plan locked + Codex R0..R3-cleanup-2 review chain
066724e fix(1000-star): Phase 1.6 brownfield profile detection + propagation
```

**Separately, on `omerakben/homebrew-code-oz`:**

```
1263c93 feat: initial code-oz v0.20.0-alpha.0 formula
```

## Manual step pending for Ozzy

**Pin Discussion #29:** open https://github.com/omerakben/code-oz/discussions/29 in a browser and click "Pin discussion" from the discussion's options menu. GitHub's GraphQL API can't do this; only the web UI can. ~5 seconds.

## M17 implementation — ready to start

**Canonical spec:** `docs/design/SESSION_M17_KICKOFF.md`

**First action of next coding session (when M17 begins):**

1. Start C1 — write the two-RED-check brownfield CLI e2e test (test scaffolding only, no implementation):
   - Check 1: fresh-run brownfield emits `phase_entered(audit)` and NOT `persona_invocation_started(ba)`
   - Check 2: active-run `currentPhase: 'audit'` does NOT hit the generic fallback at `src/commands/run.ts:1134`
   - Must spawn the CLI (`Bun.spawn(['bun', 'run', 'src/cli.ts', 'run', '--provider', 'fake', '--request', '<prob>'])`)
   - Must assert on `events.jsonl`, NOT state shape
   - Forbidden imports: `dispatchAudit`, `runAudit`, `initRun`, `emitGateRequired`, `approveGate`, `runApprove`, `composeAuditPrompt`, any phase or audit module
   - Confirm BOTH checks fail today for the right reasons before C2 begins

2. C2-C9 follow the consumer-first sequence in the kickoff doc.

3. After C9, run M17 R1 impl review + R2 impl review (matching M14-M16 cadence) for fix-first / push verdict.

4. Tag `v0.21.0-alpha.0` after R2 push.

## GUI direction — prep notes for next session

Ozzy shared three AI Studio screenshots of a Gemini-generated GUI prototype (`code-oz GUI`) targeting non-technical users (PM, BA, QA). The shape:

- Bold "CODE / OZ" branding; "Local Core v2.4.1 GUI-BRIDGE: ACTIVE" header
- Sidebar: Workspace, Deployments, Intelligence (Suggestions, AI Optimize, Auto Docs)
- Main: OZ INITIALIZE / OZ SYNC / OZ MAGIC / OZ FORGE quick-action cards
- "THE OZ FORGE — NATURAL LANGUAGE TO CLI ENGINE" — natural-language → CLI command translation surface
- Console output stream with timestamped events
- Spellbook (saved commands library)
- Suggestions panel powered by Gemini 3 Flash

### What the GUI bridges to (CLI artifact surface)

Every CLI run produces a deterministic artifact ledger the GUI can render:

- `events.jsonl` per run at `.code-oz/state/runs/<runId>/events.jsonl` — append-only event log; the GUI's "Console Output Live Stream" reads this. Event types are stable per `src/state/schemas.ts`.
- Canonical artifacts per phase: `SPEC.md`, `PLAN.md`, `AUDIT.md` (M17), `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`, `SHIP.md` — markdown files at `.code-oz/artifacts/` with locked schemas. The GUI can render these per-role: BA sees SPEC/AUDIT; QA sees VERIFY/REVIEW; PM sees gate status + cost.
- Gate files: `GATE_<PHASE>_PASSED.json` at `.code-oz/state/runs/<runId>/` — sha256-bound to the artifact. The GUI's "Forge Command" approval flow targets these.
- Run state: `current.json` at the run dir — event-derived projection of run state (currentPhase, profile, task cursor). Read-only; events are the source of truth.
- Run history: per-run subdirectories under `.code-oz/state/runs/`.

### Role-aware projections worth designing

| Persona | Primary artifacts | Useful actions |
|---|---|---|
| **PM** | Run list, gate status, cost telemetry, debate events | Start run, approve gate, kill run on budget |
| **BA** | SPEC.md, AUDIT.md, OPEN_QUESTIONS.md | Edit SPEC, answer open questions, approve DEFINE/AUDIT |
| **QA** | VERIFY.md, REVIEW.md, BUILD_REPORT.md, validation commands | Re-run verify, escalate to debate, mark review-needs-revision |
| **Builder/Dev** | PLAN.md, BUILD_REPORT.md, BUILD prompts + diffs | View patch diff, re-run BUILD with --task, override task selection |
| **Engineering lead** | RULE21_BENCHMARK.md, debate scheduler events, cross-family review outcomes | Switch provider, adjust effort envelope, audit replay |

### What changes with M17 shipping for the GUI

M17 unlocks the **brownfield BA workflow** in your GUI — the most concrete non-technical-user value:

- BA opens a real repo in the GUI
- Types problem statement in the natural-language input
- GUI invokes `code-oz run` → AUDIT phase produces `AUDIT.md` with Localization + Reproduction + Constraints + ranked hypotheses
- BA reads the structured diagnosis (file:line citations, observed-vs-operator-proposed reproduction)
- BA approves → AUDIT.md flows to PLAN as the input artifact (M17's handoff slice)
- PM/BA can now scope a ticket from the diagnosis without reading code

Without M17, brownfield is dead-ended at "initialize project, write SPEC from scratch" — which is the greenfield-only flow. M17 turns code-oz into a tool BA can actually use.

### GUI design questions worth pre-thinking

1. **Bridge transport.** GUI ↔ CLI surface: subprocess spawn + read `events.jsonl` (simplest), file-watcher on `.code-oz/state/runs/` (real-time), or in-process via SDK (M17.x?). Start with file-watcher; the events.jsonl append-only structure is GUI-friendly.
2. **Approval flow UX.** Gates are markdown-artifact approvals. Web form vs. CLI-equivalent button + structured diff view of the artifact. The artifact IS the contract; the GUI's job is to render it cleanly.
3. **Cost surfacing.** `budgets.global` enforcement is token-based per `src/providers/cost.ts:213-318`; advisory dollar telemetry via `priceTable`. GUI should show BOTH (token gauge with hard kill threshold; dollar advisory).
4. **Multi-role auth.** If PM/BA/QA roles are real users (not single-operator), the gate-approval surface needs auth. Out-of-scope for v1 prototype but worth marking.
5. **Live event streaming.** events.jsonl is append-only; new lines = new events. SSE or websocket from GUI server → browser is the standard pattern.
6. **Persistence beyond `.code-oz/`.** The GUI may want its own state (saved spells, user preferences). Decide if it stores under `.code-oz/gui/` (shared with CLI) or a separate dir.
7. **What the GUI canNOT do.** Per rule 1 (file-based gate signals only) + rule 18 (repo_context as a permission scope), the GUI never bypasses gates and never has direct repo write access outside of approved phase artifacts. The orchestrator's primitives own those writes; the GUI is a render + approve surface.

### Suggested next-session GUI opening moves (Ozzy's call)

A. **Lock the bridge contract.** Pin down the events.jsonl → GUI render path. What events does the GUI care about? (`run_started`, `phase_entered`, `artifact_recorded`, `gate_required`, `persona_invocation_started/completed`, debate events.) Write a small `docs/contracts/GUI_BRIDGE.md` so the AI Studio prototype and the eventual real GUI both target the same surface.

B. **Choose framework + scaffold a v0 prototype.** AI Studio mockups → real Next.js/Vite + shadcn/ui app reading from a local code-oz run dir. Single-user, single-run, no auth. Renders one artifact at a time (start with PLAN.md or AUDIT.md).

C. **Run the GUI against a real code-oz run.** Use the demo at `docs/demo/01-todo-cli/` to produce a real events.jsonl + artifacts. Point the GUI at the run dir. Confirm the live-stream + artifact-render works end-to-end with the real data shapes.

D. **Defer the natural-language → CLI command translator** until the read-only render path works. The "OZ FORGE" surface is a stretch goal; the BA/PM use case is satisfied by render + approve alone.

## Memory entries seeded this session

Available for `next-session` recall in `/Users/ozzy-mac/.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/`:

- `phase_1_complete.md` — Phase 1 closure summary
- `phase_1_npm_published.md` — npm publish detail
- `m17_design_closed.md` — M17 R0/R1 design loop closure + locked R1 modifications
- `feedback_npm_similarity_guard.md` — npm name-similarity vs squatting failure mode lesson
- `option_d_1000_star_plan_locked.md` (updated) — full plan + autonomy mode

All linked from `MEMORY.md` index.

## Open questions for Ozzy (next-session check-in)

1. **Pin Discussion #29 — confirm done?** 5-second web-UI step.
2. **GUI direction:** A vs B vs C vs D from "Suggested next-session opening moves" above. Or different sequence entirely.
3. **M17 implementation timing:** start C1 in the next coding session, or run GUI work in parallel (separate worktree)? M17 is ~30-34h; GUI is unbounded but exploratory. Could parallel.
4. **M17 R1 packet template ownership:** C9 closure ships a template for future milestones. Want input on the shape before C9 lands?

## Recommended next-session opening prompt

> `Read docs/handoffs/2026-05-12-phase1-complete-m17-design-closed-gui-prep.md and bring me up to speed. I want to focus on the GUI work next — let's start with locking the bridge contract (option A from that doc).`

That gives the next-session Claude a clean entry point: read the handoff, recall memory, prep for the GUI bridge contract draft.
