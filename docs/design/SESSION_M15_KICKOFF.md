# Session kickoff — M15: Debate-policy scheduler v1

> Paste this entire file into the next Claude Code session as the opening prompt.
> Drafted 2026-05-07 at the close of the M14-tag session. Repo state at draft time: `main` clean at `34d1dbe`, tag `v0.15.0-alpha.0` on `3572514`, 2425 tests pass / 0 fail / 1 skip. Default no-push policy applies.

---

## Role for this session

You are working on `code-oz`, a Bun + TypeScript adaptive multi-agent SDLC runtime. Your goal is to **close M15 — Debate-policy scheduler v1** end-to-end (plan → debate → implement → review → tag → handoff) following project standards. Read `CLAUDE.md` and `MEMORY.md` first; the auto-loaded memory has the full M11→M14 trail.

This session uses **multi-agent + multi-family discipline**:
- Multi-agent: dispatch subagents (Explore, code-architect, code-reviewer, Plan) for parallel research and isolated review; the orchestrator (you) writes canonical artifacts.
- Multi-family: every milestone passes a Codex debate at planning convergence and a Codex review at implementation completion. Codex runs `gpt-5.5` at `xhigh` effort, sandbox `read-only`. Codex verdict is data, not authority.

---

## M15 scope (locked in `docs/design/ROADMAP.md`, line 380)

**Authority boundary:** automatic-trigger policy for the existing single-opponent `requestDebate()` runtime built in M10.
**NOT in scope:** multi-opponent debate, panel-style debate, Researcher fan-out, parallel builders. These are M16+ deferred until measurable need (CLAUDE.md rule 21, Agentless caution).

**Locked invariants:**
1. **One authority per milestone (CLAUDE.md rule 20).** M15 ships exactly one new authority: the scheduler. Do not bundle.
2. **Measurable risk reduction over baseline (CLAUDE.md rule 21).** The scheduler must produce a measurable signal in `events.jsonl` that justifies the trigger over the simpler "no-debate" or "always-debate" baselines. If you cannot define the metric before implementation, stop and pressure-test scope with Codex.
3. **Single-opponent only.** Same primitive M10 shipped (`requestDebate({ opponent, files, claim })`). The scheduler chooses *when* to call it, not *how many* opponents.
4. **File-based gate signals only (rule 1).** Scheduler decisions go through `events.jsonl` + typed structures, never parsed LLM text.
5. **Per-persona opponent binding (M12 contract).** `tool_use.debate.opposingProviders` on the persona is the source of truth for which opponent gets selected when the scheduler fires.

**Open shape questions to resolve in the Codex debate (NOT pre-decided):**
- Trigger surface: phase-tail hook? Verdict-confidence threshold? Verifier-flake rate? Reviewer disagreement when no panel exists? Cost-budget remainder?
- Hysteresis / cooldown: per-run cap on auto-debates, per-phase cap, dedup window.
- Override semantics: persona opt-out, run-config opt-out, NEEDS_INTERVENTION on scheduler self-disagreement.
- Schema location: extend existing debate event schema, or new `state/schemas/debate-policy.ts`?
- Failure surface: what happens if scheduler fires but `requestDebate()` errors (e.g., opponent provider auth-fail)?

Bring these to Codex as debate prompts; let pushback shape the contract.

---

## Phase 0 — Context recovery (parallel reads, single message)

Before any plan, batch-read in one assistant turn:

- `CLAUDE.md` (project rules — confirm rules 1, 2, 4, 16, 17, 18, 20, 21 are live)
- `docs/design/ROADMAP.md` (M14 closure note, M15 row, PE/W tracks)
- `docs/contracts/COMPANY.md` (per-persona `tool_use.debate.opposingProviders` binding from M12)
- The M10 debate runtime contract (search: `grep -rn "requestDebate" docs/contracts/ src/`)
- The M11 capability contract (`docs/contracts/CAPABILITY.md` — opponent provider lineage)
- The M14 reviewer-panel contract (`docs/contracts/review-panel.md`) — for shape parallels (do not copy, read for shape)
- `state/schemas/` — find existing debate schemas to extend
- Latest Codex review trail: `docs/research/CODEX_REVIEW_M14.md` rounds R1–R9 (so M15 inherits the same review discipline shape)

Run in parallel: `git status`, `git log --oneline -15`, `git tag --sort=-creatordate | head -5`, `bun test 2>&1 | tail -8`, `bun run typecheck 2>&1 | tail -10`.

Optional cleanup decision (ask Ozzy first): the merged `feat/m14-reviewer-panel` branch can be deleted local + remote. Do not delete unilaterally.

---

## Phase 1 — Codex debate at planning convergence (mandatory, CLAUDE.md `Cross-model peer review`)

Authoritative pattern: M14 used `docs/research/CODEX_BRIEFING_M14.md` → Codex `accept-with-modifications` → synthesis in `docs/design/SESSION_M14_KICKOFF.md`. M15 follows the same shape.

**Step 1.1 — Write `docs/research/CODEX_BRIEFING_M15.md`.** Include:

1. **Goal** — Debate-policy scheduler v1: automatic trigger over existing single-opponent `requestDebate()`.
2. **Constraints** — rule 20 (one authority), rule 21 (measurable risk reduction), single-opponent only, no panel.
3. **Recommended initial plan** — your proposed trigger surface, hysteresis, schema, override semantics, failure handling. Be specific. Recommend one path; Codex can flip you.
4. **Acceptance criteria** — what "done" looks like at the gate. Include the measurable-risk-reduction metric you'll record in `events.jsonl`.
5. **Pinned answers** (closed issues — Codex must not reopen): "M15 is single-opponent only", "no Researcher phase-tail", "scheduler is orchestrator-owned, not persona-owned".
6. **Debate prompts** (open questions — Codex picks apart):
   - Should the scheduler fire pre-VERIFY (cheap) or post-VERIFY (informed)? Both?
   - Is verdict-confidence the right primary signal, or is it post-hoc rationalization that lets weak BUILDs slip through?
   - What's the "off" position? `debatePolicy: { mode: "manual" }` only? Per-phase opt-in?
   - Does the scheduler need its own permission scope (parallel to `tool_use.repo_context` from M9)?
   - How does the scheduler interact with M14's reviewer-panel verdict? Auto-debate on panel disagreement?
   - Cost-policy interaction (M13): scheduler may over-fire and blow `budgets.global.maxProviderCalls`; what's the fail-safe?

**Step 1.2 — Run Codex.** Tool: `mcp__plugin_agent-codex_codex-native__codex`. Config:
- `model`: `gpt-5.5` (fall back from `gpt-5.5-codex` / `gpt-5.1-codex-max` per CLAUDE.md — those don't work on Ozzy's auth)
- `model_reasoning_effort`: `xhigh`
- `sandbox_mode`: `read-only`
- `approval_policy`: `never`
- Pass the briefing path, not inline content.

**Step 1.3 — Capture verdict and pushbacks.** Write `docs/research/CODEX_RESPONSE_M15.md`. Categorize each Codex pushback: `accept`, `accept-with-mod`, `reject-with-reason`. Update `CLAUDE.md` rule list ONLY if a brand-new durable rule emerges (rare; M14 produced none).

**Step 1.4 — Write `docs/design/SESSION_M15_IMPL_KICKOFF.md`** synthesizing the locked plan. Per memory feedback `feedback_one_phase_per_milestone.md`: plan must show exactly one authority boundary or stop and re-debate.

Do not write any production code in Phase 1.

---

## Phase 2 — Implementation (single authority, narrow surface)

**Branch:** `feat/m15-debate-scheduler` from `main`. Conventional commits. No emojis. No "Co-Authored-By: Claude" footer.

**Build order (typical shape — adjust to debate outcome):**
1. Schema and types (`state/schemas/debate-policy.ts`, types into `src/state/debate.ts` or a new `src/policy/debate-scheduler.ts`)
2. Scheduler primitive (pure function: `(context) → { fire: boolean, reason: string }`)
3. Wiring at the trigger surface (phase tail or wherever the debate concludes)
4. Events: `debate_scheduler_evaluated`, `debate_scheduler_fired`, `debate_scheduler_skipped` with reason codes
5. Config surface: `debatePolicy:` block in `.code-oz/config.yaml` with `mode`, `triggers`, `cooldown`, `maxPerRun`
6. Doctor command: `code-oz doctor` reports current scheduler config + last-N decisions
7. Tests: deterministic offline tests using `FakeProvider` + scripted contexts; live tests gated behind env var if needed
8. Docs: `docs/contracts/DEBATE_POLICY.md` + ROADMAP.md row check + memory entry

**Harness techniques to lean on:**

| Technique | When | Why |
|---|---|---|
| **Parallel tool calls** | Phase 0 reads, multi-file grep, multi-file edits with no dependency | One round-trip vs. N |
| **TaskCreate** | Top-level milestone steps + sub-tasks per commit | Persistent state across compaction |
| **Subagent: Explore** | "Where does `requestDebate` get called from?" | Read-window protection |
| **Subagent: code-architect** | Scheduler API shape design before coding | Independent design pressure |
| **Subagent: code-reviewer** | Pre-Codex self-review on each commit | Cheap second opinion |
| **Background `bun test --watch`** | While editing | Continuous regression signal |
| **`run_in_background`** for long Codex runs | Codex `gpt-5.5 xhigh` debates take 30–60s | Don't block on completion |
| **Worktree isolation (`isolation: "worktree"`)** | If you need to spike an alternative scheduler shape without dirtying `feat/m15` | M9 pattern, free if no changes |
| **ScheduleWakeup** | If a Codex review run is queued and you want to check back without polling | Self-paced loop |
| **Ralph loop** (`ralph-loop:ralph-loop`) | Optional for the implementation phase if it has natural per-iteration commits — see Phase 2.5 below | Overnight progress with done-condition |

**Test discipline (CLAUDE.md rule 8):** every test runs offline via `FakeProvider`. Live-provider tests are opt-in only behind `CODE_OZ_LIVE_PROVIDER_TESTS=...`.

**Anti-patterns to refuse (from M12/M14 review history):**
- Bundling debate-policy + multi-opponent (rule 20 violation)
- Adding a measurable-risk metric *after* implementation to retroactively justify (rule 21 violation)
- Letting scheduler bypass `budgets.global` caps (rule 19)
- Same-family auto-debate counting as risk reduction (cross-family discipline, rule 2 spirit)

### Phase 2.5 — Optional Ralph loop for implementation grind

If after Phase 1 the implementation decomposes cleanly into 8–12 single-axis commits, consider a Ralph loop overnight (W3-lite + M14 precedent). Pattern:

1. Write `docs/design/RALPH_M15_PROMPT.md` modeled on `RALPH_M14_PROMPT.md`. Include: branch name, commit list with single-axis scope per commit, done-condition (e.g., "all 12 commits land + 2425+ tests pass + typecheck clean + Codex R1 dispatched"), no-push rule, NEEDS_INTERVENTION clause.
2. Launch via `/ralph-loop:ralph-loop`.
3. On wake, R1 the resulting commit chain via Codex review immediately.

Skip Ralph if scope is small or shape is still uncertain after the debate. Don't Ralph unresolved design.

---

## Phase 3 — Codex review iteration (`Cross-model peer review` rule, item 2)

After implementation lands on `feat/m15-debate-scheduler`:

**Step 3.1 — Write `docs/research/CODEX_BRIEFING_M15_REVIEW.md`** — point Codex at the latest commit SHA, list the milestone authority boundary, list contracts changed, list new event types, ask for verdict `push` / `fix-first` / `debate-required` with severity-tagged findings.

**Step 3.2 — Run Codex review.** Same config as Phase 1.2.

**Step 3.3 — Iterate until convergence:**
- Every `block-push` finding closes in a follow-up commit (CLAUDE.md `feedback_no_tech_debt.md`). Never amend a tagged commit.
- Every `block-next-milestone` finding closes before tag.
- `fix-soon` and `nit` may defer if tracked in `MEMORY.md`.
- After each closure batch, dispatch a fresh Codex round. Pattern from M14: R1 caught 7 block-push, R2 contract drift, R3+ residual doc drift, R8 0 findings, R9 final pre-tag verification.
- Expected rounds for M15: 2–4 if scope stays narrow. >5 rounds means scope leaked — stop and re-debate.

**Step 3.4 — Final pre-tag verification round.** A short "is this still clean at the tag SHA?" pass before stamping the tag. Pattern from M14 R9.

---

## Phase 4 — Tag, merge, hand off (DEFAULT NO-PUSH POLICY)

**Default policy is restored.** PE-1 and M14 push grants were one-time. M15 follows the standard pattern:

1. Final commit lands on `feat/m15-debate-scheduler`.
2. Tag locally: `git tag -a v0.16.0-alpha.0 -m "M15 — Debate-policy scheduler v1"` on the **Codex-blessed SHA** (tag-target invariant from M14: tag SHA = the SHA Codex blessed, not the post-tag closure SHA).
3. Merge `feat/m15-debate-scheduler` → `main` locally (no-ff to preserve milestone history).
4. **Stop. Ask Ozzy for explicit push approval.** Do not push tag, branch, or main. Do not create a GitHub release.
5. Update `MEMORY.md`: write `m15_progress.md`, link from index.
6. Update `docs/design/ROADMAP.md` M15 row to `Closed YYYY-MM-DD (vX.Y.Z, NNNN tests).`
7. Run `/remember` skill at session end to capture handoff state.

If Ozzy approves push: `git push origin main` then `git push origin v0.16.0-alpha.0`. Optionally `gh release create v0.16.0-alpha.0 --prerelease` mirroring M14's release notes shape.

---

## Acceptance gate (all must hold before tag)

- [ ] Codex debate verdict captured in `CODEX_RESPONSE_M15.md`; pushbacks accepted/rejected with reason.
- [ ] Implementation lands one (and only one) new authority boundary.
- [ ] Measurable risk-reduction metric defined and emitted to `events.jsonl` per scheduler decision.
- [ ] Codex review converged: latest round verdict `push`, zero `block-push` and zero `block-next-milestone` findings.
- [ ] Tests pass: floor 2425, expected ≥2475 with new scheduler tests. Zero fail. One skip (live xAI gated).
- [ ] `bun run typecheck` clean.
- [ ] `docs/contracts/DEBATE_POLICY.md` exists and is the source of truth.
- [ ] `docs/design/ROADMAP.md` M15 row marked closed.
- [ ] `MEMORY.md` updated with `m15_progress.md`.
- [ ] Tag staged on Codex-blessed SHA. Push pending Ozzy's explicit approval.

---

## Standards (recap, non-negotiable)

From `CLAUDE.md`:
- Rule 1: file-based gate signals only
- Rule 2: cross-family review at REVIEW gate (REVIEW agent ≠ BUILD provider family)
- Rule 4: Opus default; warn on downgrade
- Rule 16: universal anti-slop rules in every persona prompt
- Rule 17: maestro discipline as the rule-checker authority
- Rule 18: repo-context retrieval has its own permission scope
- Rule 19: run-level budget enforcement is mandatory, not advisory
- Rule 20: one new authority boundary per milestone
- Rule 21: no parallel-provider surface without measurable risk reduction

From writing rules: no banned vocabulary (`delve`, `tapestry`, `crucial`, `meticulous`, etc.), no rule-of-three lists, no "serves as", no section summaries, sentence-case headings, one em dash max per paragraph.

From git rules: feature branch only, conventional commits, no emojis, no "Co-Authored-By: Claude" footer, never push without explicit approval.

---

## Quick command reference

```bash
# Tests, type-check, build
bun test
bun test --watch
bun run typecheck
bun run build:binary

# Dev CLI
bun run dev init
bun run dev run
bun run dev doctor

# Branch hygiene at session start
git status && git branch -a && git tag --sort=-creatordate | head -3

# Cleanup (ask first)
git branch -d feat/m14-reviewer-panel
git push origin --delete feat/m14-reviewer-panel
```

---

## End-of-session handoff

1. Run `/remember` to refresh `now.md`, `recent.md`, daily file.
2. Confirm `MEMORY.md` index has the new `m15_progress.md` entry with one-line hook.
3. State explicitly in the closing message: tag SHA, merge SHA, push status (pushed / awaiting approval), test count, Codex round count, any deferred follow-ups.
4. If push is awaiting approval: spell out the exact commands Ozzy would run to push (or to tell you to push).

Begin Phase 0 in your first response. Do not skip the Codex debate. Do not bundle authorities. Do not push without explicit approval.
