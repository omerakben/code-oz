# Briefing — M16 Production CLI completion (R0 planning round)

**Brief date:** 2026-05-08
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule (planning-convergence debate before any code lands)
**Branch:** `feat/m16-cli-completion` at HEAD `e25f3d4` (origin/main; v0.16.0-alpha.0 just shipped)

## Trigger and ground

M15 shipped `v0.16.0-alpha.0` (Codex R2 push, all 9 R1 findings closed). 2706 tests pass. Then **Ring 2 dogfood** ran on a real project (`~/Projects/code-oz-dogfood`, scaffolded greenfield, BA + Lead personas invoked through real `claude` subprocess CLI):

- `code-oz init` ✓
- `code-oz doctor providers/tools/git` ✓ (claude + codex CLIs healthy, ripgrep 15.1, git 2.54)
- `code-oz run --request "Build a tiny TypeScript module called session-name..."` ✓ — DEFINE converged on turn 0; SPEC.md landed; BA caught an "empty input" edge case worth being explicit about
- `code-oz approve define` ✓
- `code-oz run` ✓ — PLAN landed PLAN.md (3 atomic tasks) + SOURCE_CHECK.md (5 spec sources, 1 ref-none with documented searches, 3 docs sources) + HYPOTHESES.md + OPEN_QUESTIONS.md
- `code-oz approve plan` ✓
- `code-oz run` **FAILED**: `code-oz run: an active run is in progress at phase build (...). Wait for the in-progress phase to complete, or inspect .code-oz/state/runs/.`

Static-trace inspection of `src/commands/run.ts`:

- Line 486: `if (phase === 'plan') { await dispatchPlan(...) }`
- Line 491-497: `else { stderr "active run is in progress at phase ${phase}" + exit 1 }`
- **No `dispatchBuild`, `dispatchVerify`, `dispatchReview`, `dispatchShip` exists.**

The CLI help even foreshadowed it: `Run the active phase (DEFINE → PLAN; M7 adds BUILD onward)`. M7-M10 milestones added the runtime functions (`runBuild`, `runVerify`, `runReview`) with full test coverage but **never extended `run.ts`**. The 2706 e2e tests bypass the CLI by importing the runtime functions directly with hand-built option records.

## What's actually missing (four concurrent gaps)

### Gap 1 — CLI dispatch table for BUILD / VERIFY / REVIEW

`src/commands/run.ts` only knows DEFINE and PLAN. After PLAN approve, currentPhase advances to `build`, but the run command refuses with "phase in progress." The runtime is fine; the front door is half-built.

### Gap 2 — `runShip` runtime function does not exist

```
$ find src -name "ship*" -o -name "*ship*"
(no results)

$ grep -rn "GATE_SHIP_PASSED\|runShip\|preApproveShipHook" src/
(no results)
```

The phase machine advances `currentPhase` to `'ship'` after REVIEW approval (the M9 e2e test asserts this at `tests/e2e/review-lite-greenfield-pass.test.ts:623`), but no runtime handles SHIP. There's no `GATE_SHIP_PASSED.json` writer, no SHIP artifact authority, no `preApproveShipHook`. The phase is a stub end-state.

### Gap 3 — `code-oz resume` command does not exist

CLAUDE.md non-negotiable rule 12: *"Resume is a v0.1 feature. `runId`, idempotent gate writes, `code-oz resume`. Terminal death after PLAN must not restart DEFINE."*

The runtime supports resume (idempotent gate writes work; `probeReviewResume` exists; M15 C18 added scheduler-resume mismatch detection). But there's no `code-oz resume` command. `src/commands/` contains `init.ts`, `run.ts`, `approve.ts`, `doctor.ts` — no `resume.ts`. Rule 12 is unkept since v0.1.

### Gap 4 — Production seams for VERIFY (`RunnerSeam`, `RevertSeam`) and persona invocation (`invokePersona`) do not exist as exported helpers

Each phase function takes dependency-injection seams that test fixtures wire by hand:

- `runBuild.invokePersona: (composedPrompt: string) => Promise<string>` — tests pass `async () => CANNED_TEXT`. Production needs `invokeAgent(ctx, request)` consumption that returns final content text.
- `runVerify.runner: RunnerSeam` — tests pass `async () => ({ exitCode: 0, ... })`. Production needs `Bun.spawn` of the validation command in the worktree with timeout enforcement.
- `runVerify.revertSeam: RevertSeam` — tests pass `{ snapshot:noop, revert:noop, restore:noop }`. Production needs git-stash-or-copy semantics inside the worktree.
- `runReview.invokePersona` — same shape as BUILD's, same gap.

The phase modules' header comments call these out: *"fully testable without spawning real subprocesses. The orchestrator's [seams])"* — meaning the CLI dispatcher must author them. The dispatcher doesn't exist, so the seams don't either. They're a single missing surface.

## Why this slipped past M7-M15

The empirical pattern: every milestone extended the **runtime** with single-axis discipline (rule 20) and proved each runtime function via e2e tests that **import the runtime directly with hand-built option records**, bypassing the CLI. The CLI dispatch was the ONE seam tests didn't exercise. So 2706 tests pass and the runtime is solid; the CLI front-door for BUILD/VERIFY/REVIEW/SHIP/resume was never written.

This is a real gap, not a polish chore. It's the **production CLI authority surface** that turns the runtime into a usable product. Without it, only DEFINE+PLAN work end-to-end from the user's keyboard.

## Recommended path (Lean)

**M16 — Production CLI completion.** Ship the CLI authority surface in a single milestone. Single-axis commits per rule 20:

1. **C1 — Production seams module** (`src/cli/production-seams.ts` new):
   - `productionInvokePersona(ctx, agent): (composed) => Promise<string>` — drains `invokeAgent` stream into final content text. Used by all three phase dispatchers.
   - `productionRunner(): RunnerSeam` — `Bun.spawn` of validation command in worktree, captures stdout/stderr/exit/duration, enforces timeoutMs from BUILD task.
   - `productionRevertSeam(worktreeRoot): RevertSeam` — git-stash-based snapshot/revert/restore inside the worktree. Mirrors the contract in `src/phases/verify-mutation.ts`.
   - Unit tests against `Bun.spawn` mock + a temp git repo for revertSeam.

2. **C2 — `dispatchBuild` in `run.ts`**:
   - Loads PLAN.md, picks next pending task (or `--task T-NNN` flag if specified).
   - Resolves or creates worktree via `createRunWorktree` (idempotent on existing worktree per resume contract).
   - Loads bundled `builder` + `scientist` agents from registry.
   - Wires `productionInvokePersona` for the builder.
   - Calls `runBuild`, surfaces `BuildResult`. On `complete`, prints next-step ("review BUILD_REPORT.md, then run `code-oz approve build`"). On `intervention`, prints intervention code + actionable suggestions, exits 1.

3. **C3 — `dispatchVerify` in `run.ts`**:
   - Reads BUILD_REPORT.md to get attempt + patch + buildPromptSnapshot.
   - Loads bundled `verifier` + `scientist` agents.
   - Wires `productionInvokePersona`, `productionRunner`, `productionRevertSeam`.
   - Calls `runVerify`. On `completed`: "review VERIFY.md, then run `code-oz approve verify`." On `failed`: handle restart per `nextAction` ('restart' → emit BUILD attempt N+1 carry-forward, "run `code-oz run` to start attempt N+1"; 'intervention' → exit 1). On `intervention`: print + exit 1.

4. **C4 — `dispatchReview` in `run.ts`**:
   - Loads bundled `reviewer` + `scientist` agents.
   - Determines round (1 if no prior REVIEW.md; round + 1 if `priorReviewMd` present and verdict was `needs-revision`).
   - Wires `productionInvokePersona` for the reviewer. Wires `panelistInvoker` if `config.company.reviewer.panel.length >= 2` (panel mode).
   - Calls `runReview`. On `resolved`: "review REVIEW.md, then run `code-oz approve review`." On `needs_revision`: print remediation summary + "run `code-oz run` to drive BUILD attempt N+1." On `blocked`: print blockers + exit 1. On `intervention`: print + exit 1.

5. **C5 — `runShip` runtime + `dispatchShip`**:
   - `src/phases/ship.ts` new — minimal v0.1: validate prior gates (DEFINE + PLAN + BUILD + VERIFY + REVIEW all PASSED), validate worktree clean (no uncommitted changes from REVIEW round), emit `ship_completed` event, write `GATE_SHIP_PASSED.json` (no artifact authored — SHIP in v0.1 is the "OK to merge" gate, not a packager).
   - `dispatchShip` in run.ts reads gate states + invokes `runShip` + prints "run is shipped — merge the worktree branch when ready."
   - Approve hook: `preApproveShipHook` may be a no-op in v0.1 (gate writes are sufficient).

6. **C6 — `code-oz resume` command** (`src/commands/resume.ts` new):
   - Reads `.code-oz/state/active.json` for active runId.
   - Loads `state/runs/<runId>/current.json` to determine resume target (currentPhase + phasesCompleted + last events).
   - Surface `NEEDS_INTERVENTION.json` if present (intervention dominates resume).
   - Otherwise dispatches to the same `dispatchPlan/Build/Verify/Review/Ship` based on `currentPhase`. Resume == "run the in-progress phase from the resume probe inward."
   - Distinct from `run` only in messaging: `run` advances when no run is active or the prior phase was approved; `resume` is explicit "pick up the in-progress phase."
   - Reuses `probeReviewResume` (review.ts) and `detectSchedulerResumeMismatch` (review-fire-path.ts) — those already exist for resume safety.

7. **C7 — End-to-end CLI integration test** (`tests/e2e/cli-full-cycle.test.ts` new):
   - Drives `init → run (define) → approve → run (plan) → approve → run (build) → approve → run (verify) → approve → run (review) → approve → run (ship)` via the CLI binary using `Bun.spawn`, on a temp project, with `--provider fake` so no real provider calls happen.
   - Asserts: each phase's gate file lands, `currentPhase` advances correctly, final state reaches SHIP.
   - This is the test that exists to prove the CLI front-door works — closes the test-coverage gap that hid M7-M15's CLI omission.

8. **C8 — Doc updates**:
   - Update `code-oz run --help` to remove "(DEFINE → PLAN; M7 adds BUILD onward)" parenthetical.
   - Update `code-oz --help` to add `resume` to the command list.
   - `docs/design/ROADMAP.md` adds M16 entry.
   - `CLAUDE.md` rule 12 reference unchanged (rule already says resume is v0.1; this just makes it true).

**Estimated scope:** ~1200-1800 LOC across the 8 commits (production seams ~250, three phase dispatchers ~150 each, runShip+dispatchShip ~250, resume ~200, e2e test ~250, docs ~50). 5-7 single-axis commits. Tag at `v0.17.0-alpha.0` after R1 push.

## Locked architectural decisions (these you should not relitigate)

L1. **No autoadvance through phases.** Each gate transition requires explicit `code-oz approve <phase>`. This matches M9's existing pattern (worktree removal happens at REVIEW-approve, not REVIEW-resolve). The user always knows when state will change.

L2. **`dispatchBuild` does not auto-restart on VERIFY-fail.** When VERIFY fails with `nextAction: 'restart'`, the carry-forward block is written and the user runs `code-oz run` to drive BUILD attempt N+1. This matches M8's `scheduleAttemptNPlus1` design — the CLI tells the user what's next, the user pulls the trigger.

L3. **`runShip` v0.1 is a gate writer, not a packager.** No `dist/` build, no tarball, no version bump, no git tag from inside SHIP. Those are operator concerns. SHIP just validates all upstream gates passed, validates worktree clean, writes `GATE_SHIP_PASSED.json`, emits `ship_completed`. The package-and-merge work is what the operator does AFTER SHIP gate passes.

L4. **Production seams are a separate module** (`src/cli/production-seams.ts`), not inlined in run.ts. Three reasons: (a) testable in isolation, (b) reusable by `code-oz resume`, (c) keeps run.ts focused on dispatch logic.

L5. **`code-oz resume` reuses dispatchers, not a separate code path.** Resume == "pick up wherever currentPhase left off, dispatch through the same dispatcher the run command uses." If `currentPhase === 'review'` and a partial REVIEW.md draft exists, resume invokes `dispatchReview` which invokes `runReview` which invokes `probeReviewResume` and continues from that resume substrate. Single source of resume truth.

L6. **C7 e2e test runs CLI via `Bun.spawn`, not direct imports.** The whole point of M16 is "the CLI is exercised by tests." Importing dispatchers and calling them in-process would replicate the test omission that hid M7-M15's CLI gap. Spawn the actual `dist/code-oz` binary (or `bun run src/cli.ts`) in a temp project, observe stdout + state files.

L7. **Single-axis discipline.** C2/C3/C4 each ship one phase dispatcher. C5 ships SHIP runtime + dispatcher together (acceptable single axis = "SHIP authority"). C1/C6 are infrastructure. No commit bundles two phases.

L8. **No new authority boundary.** M16 wires existing M7-M10/M14/M15 runtime authorities into the CLI; SHIP is the only new authority but it's documented in the architecture taxonomy already (DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP). No new gates, no new permission scopes, no new event types beyond `ship_completed` + `gate_required(ship)`.

## Decision matrix (please push back where the lean is wrong)

### Q1 — Should `dispatchBuild` auto-resolve "next pending task" or require `--task T-NNN`?

**Lean:** auto-resolve to the next PLAN task whose status is not `complete` (BUILD_REPORT.md absent or attempt < REVIEW round count). `--task T-NNN` overrides if specified.

**Push:** if multi-task PLANs are common, auto-resolve makes the happy path one-step. If the user wants control, `--task` is there. Counter-argument: explicit `--task` is safer for resume (if BUILD attempt 2 is in-flight on T-001 and the user runs `code-oz run`, it shouldn't accidentally jump to T-002). Resume-detection logic must inspect events.jsonl for in-flight BUILD attempts before "next-task" resolution fires.

### Q2 — Where does the worktree get created, dispatchBuild or a separate `code-oz worktree create` command?

**Lean:** `dispatchBuild` creates the worktree on first invocation if absent (idempotent on existing worktree per WORKTREE.md). Resume detects existing worktree and reuses.

**Alt:** separate `code-oz worktree create` makes the operator-visible step explicit, easier to debug. But adds a CLI gesture the user has to learn. M9 e2e creates worktree right before BUILD; pattern follows that.

### Q3 — How does `dispatchVerify` resolve attempt N? From events.jsonl or from BUILD_REPORT.md?

**Lean:** read BUILD_REPORT.md (the canonical artifact for the just-completed BUILD attempt) and pass `attempt: buildReport.task.attempt` to `runVerify`. The attempt number lives in the artifact; events.jsonl is the audit log, not the source of truth.

### Q4 — Round resolution for `dispatchReview`: 1 if no REVIEW.md, otherwise (priorRound + 1)?

**Lean:** load REVIEW.md if present; round = (priorReviewReport.score.roundCount + 1). If REVIEW.md absent, round = 1. The runtime validates against `REVIEW_ROUND_CAP = 4` already, so round overflow surfaces as intervention. Resume case: if review.lock exists or `review_started` was emitted without `review_resolved`, `probeReviewResume` reads back the in-flight state.

### Q5 — Should `dispatchReview` print debate scheduler info when M15 auto-mode fires?

**Lean:** yes, print the scheduler decision (`evaluated → fired with reason=score_in_grey_zone, opposingProvider=claude → debate completed → postreview verdictPre/Post`) inline so the operator sees the debate happened. Otherwise the auto-mode debate is invisible at CLI level. Pull from events.jsonl after `runReview` returns, filter to scheduler events for the just-finished round, render as a table.

### Q6 — `runShip` v0.1 acceptance: what does it actually verify?

**Lean (minimal):**
- All upstream gates exist + valid: `GATE_DEFINE_PASSED.json`, `GATE_PLAN_PASSED.json`, `GATE_BUILD_PASSED.json`, `GATE_VERIFY_PASSED.json`, `GATE_REVIEW_PASSED.json`.
- Worktree is removed (preApproveReviewHook already enforces this — sanity check at SHIP time).
- No active intervention (no `NEEDS_INTERVENTION.json` on the run).
- Final REVIEW verdict is `ready` (read REVIEW.md `Score.Final verdict`).

**Out of scope for v0.1 SHIP:**
- Any artifact production (no SHIP_REPORT.md).
- Git operations (no commit, no tag, no branch merge).
- Distribution (no binary build, no publish).

If the lean is too thin, name one more check that's load-bearing.

### Q7 — `code-oz resume` semantics on a `NEEDS_INTERVENTION.json`

**Lean:** resume detects the intervention file at the top of dispatch and refuses to advance. Prints the intervention code + actionable suggestions + path to `NEEDS_INTERVENTION.json`. User must `git rm .code-oz/runs/<runId>/NEEDS_INTERVENTION.json` (or use a future `code-oz intervention resolve <code>` command — out of scope for M16) to clear, then re-run.

**Alt:** resume tries to drive past the intervention if the underlying cause looks resolved (e.g., provider auth was missing, now present). Risky — the intervention exists because the orchestrator decided manual operator action was needed. Don't auto-clear.

### Q8 — Should `code-oz resume` and `code-oz run` be the same command?

**Lean:** keep them distinct. `run` advances when there's no active run OR the prior phase just got approved. `resume` is explicit "pick up the in-progress phase." Distinction matters for operator mental model: `run` says "do the next phase," `resume` says "I had a crash, what was I doing?"

**Alt:** unify. `run` becomes idempotent and resume-aware; the user only needs one command. Counter: when the user types `run` and there's an in-flight BUILD attempt that crashed mid-stream, do you re-fire the BUILD persona invocation? Cost double-charge risk. Distinguishing run from resume avoids that ambiguity.

### Q9 — What about brownfield AUDIT?

**Lean: out of scope for M16.** AUDIT phase is documented in the architecture (brownfield: AUDIT → PLAN → BUILD → ...) but no `runAudit` runtime exists. M16 ships greenfield CLI completion; AUDIT is M17 or later. The greenfield path (`profile: greenfield` in config) covers Ozzy's first dogfood and most early users. Brownfield is its own product surface.

### Q10 — Test coverage scope for M16

**Lean:** the C7 e2e test (binary spawn, full DEFINE → SHIP) is the critical proof. Per-dispatcher unit tests are valuable but secondary; the e2e covers the integration story. Production seams (C1) get their own unit tests.

**Push:** Codex M14 R1 raised "production REVIEW lifecycle integration is incomplete" because tests covered the runtime but not the CLI integration. M16 must close the same gap for ALL phases. Don't shortcut C7.

### Q11 — Naming: is M16 the right milestone label?

**Lean:** yes. M15 closed (v0.16.0-alpha.0); M16 is the next slot. The post-M10 ROADMAP sequence said "M16+ deferred until measurable need." The Ring 2 dogfood failure is the measurable need: the product can't be used.

**Alt:** label this "M15.5 — Production CLI completion" or "M7-M10 closure." Counter: it's a new authority surface (SHIP runtime) plus substantial CLI authority work; M16 is the honest label.

### Q12 — Single tag at v0.17.0-alpha.0, or split?

**Lean:** single tag at end of M16, after R1 push verdict. Pattern from M14 + M15. The 8 commits all serve the same milestone authority; splitting introduces release accounting overhead.

### Q13 — What's deferred from M16 to M17+?

**Confirmed deferrals:**
- AUDIT phase + brownfield CLI (M17 candidate)
- W2.2 TUI inspector + failure-recovery UX
- W2.3 onboarding + tour mode
- W2.4 `code-oz reflect` + skill-outcomes log
- npm publish + Homebrew tap + Scoop bucket (W3 distribution)
- SHIP packager (artifact production beyond gate writer)
- `code-oz intervention resolve <code>` command
- Brownfield AUDIT → PLAN bootstrap
- Schemas for SHIP_REPORT.md (deferred to a milestone that needs it)

## Acceptance criteria (gate before R1)

- `bun test` — 2706 → ~2750+ pass / 0 fail / 1 skip (gain from C1 unit tests + C7 e2e + per-dispatcher tests)
- `bun run typecheck` — clean
- `bun run smoke` — passes against rebuilt binary
- The Ring 2 dogfood project (`~/Projects/code-oz-dogfood`, currently halted at BUILD) **can resume from CLI alone** and walk through to SHIP gate. `code-oz resume` from that project's directory must dispatch BUILD against the existing PLAN; full DEFINE → SHIP cycle completes via `code-oz run` + `code-oz approve` from that project's CLI alone.
- `tests/e2e/cli-full-cycle.test.ts` exercises the binary, asserts every gate file lands.
- `code-oz --help` lists the `resume` command. `code-oz run --help` no longer hedges with "(M7 adds BUILD onward)."
- Codex R1 verdict on the post-implementation SHA: `push` (after closing any block-push or fix-soon).

## Verdict format you should return

Return one of: `accept` | `accept-with-modifications` | `feature-with-modifications` | `reject`. Format your response as `docs/research/CODEX_RESPONSE_M16.md` (mirror the R0 response files for M14/M15).

## What I want from you

1. **Verdict** on the recommended path with concrete pushbacks per Q1-Q13.
2. **Risks** I'm missing — anything in the runtime ↔ CLI contract that's load-bearing and not surfaced above.
3. **Single-axis-commit shape critique.** Is C1-C8 the right slicing? Do C2/C3/C4 belong as one "BUILD/VERIFY/REVIEW dispatch" commit or as three? Is the "SHIP runtime + dispatcher together as C5" cheating rule 20 (one new authority per milestone — SHIP is the new authority, but it's bundling runtime + CLI)?
4. **One thing the lean misses.** Cross-model peer review's job is to surface the blind spot. Name it.
5. **Should this milestone include `code-oz doctor run`?** I.e., a doctor subcommand that shows current run state without trying to advance it. Lean: out of scope for M16, but flag if you think it's load-bearing for the resume UX.

## Required reading

1. `docs/design/ROADMAP.md` — milestone state through M15 closed; M16+ deferral note
2. `CLAUDE.md` — rules 1, 11, 12, 20 in particular (file-based gates, NEEDS_INTERVENTION shape, resume-as-v0.1, single-axis discipline)
3. `src/commands/run.ts` — current dispatch logic; observe the absence after line 486
4. `src/commands/approve.ts` — `preApproveVerifyHook` + `preApproveReviewHook`; the approve side is fully wired
5. `src/phases/build.ts:72-115` — `RunBuildOptions` shape
6. `src/phases/verify.ts:82-112` + `src/phases/verify-mutation.ts:209-218` — `RunnerSeam` + `RevertSeam` contracts
7. `src/phases/review.ts:162-210` — `RunReviewOptions` + `PostDebateEvidence`
8. `tests/e2e/review-lite-greenfield-pass.test.ts` — the M9 e2e; reference for how tests wire the runtime by hand
9. `tests/e2e/debate-scheduler-production-baseline.test.ts` — M15 C17; reference for `buildProviderRegistry({ providerOverride: 'fake' })` seam used by C7

## Ground truth from the dogfood

If you want to verify the gap is real: clone the local state at `~/Projects/code-oz-dogfood/.code-oz/`. The DEFINE + PLAN artifacts are on disk, gates passed, run state at `currentPhase: 'build'`. Running `code-oz run` from that directory reproduces the failure verbatim. The runtime works (2706 tests prove it); the CLI front-door is half-built.
