# code-oz — M8 Codex briefing (VERIFY-lite + restart-on-fail + mutation-test gate)

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M7 has shipped (`v0.7.0-alpha.0`, 1005 tests passing offline, 17-commit `feat/m7-build-lite` → `main` merge with two-round Codex trail closed: implementation review thread `019ddeea` and post-fix review thread `019ddf20`, both closed `push` after the block-push and block-next-milestone findings landed in commits 16-17). The M7-M10 shape thesis debate closed `accept-with-modifications` (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`, thread `019ddea0`, 2026-04-30); CLAUDE.md rule 20 is in force ("one new authority boundary per milestone"); ROADMAP locks M8 = **VERIFY evidence authority + restart-on-fail policy**.

The shared contract surface VERIFY consumes is fully pinned:

- `docs/contracts/VERIFY.md` (commit `d1cfb8e`, pre-M7) — VERIFY.md schema, restart-on-fail policy seam, mutation gate seam, error taxonomy, BUILD ref binding, what REVIEW reads from this
- `docs/contracts/BUILD.md` (commit `d1cfb8e` + commit 17 of M7 tightening validation-command shape) — BUILD_REPORT.md schema, including the four-bullet `## Validation command` block VERIFY copies verbatim
- `docs/contracts/WORKTREE.md` (commit `f504c3d` of M7) — `.code-oz/runs/<runId>/` layout including extensible forensics directory; M8 appends `VERIFY.md` (frozen), `attempt-<N>.patch` (frozen), `build-prompt-snapshot.md` to the M7-required six entries
- `docs/contracts/REVIEW.md` (commit `d1cfb8e`, pre-M7) — REVIEW reads VERIFY's `BUILD ref` and `Verdict` only; mutation status indirectly gates REVIEW

**M8 is now VERIFY-lite + restart-on-fail policy + mutation-test gate implementation only.** Acceptance per ROADMAP § M8:

> VERIFY runs configured command or generated smoke test; emits `VERIFY.md` with command shape + evidence + verdict. Failed VERIFY does NOT enter a soft patch loop. Worktree destroyed as active candidate, forensics preserved, attempt N+1 starts clean from same approved PLAN with failure constraint surfaced into the BUILD prompt. Hard cap of 4 clean attempts; attempt 5 lands in `NEEDS_INTERVENTION.json` per CLAUDE.md rule 11. Mutation-test gate rejects tautological tests for new-behavior tests. VERIFY-lite e2e with FakeProvider: success path (DEFINE → PLAN → BUILD → VERIFY) and failure-then-retry path (tests the restart policy with attempt N + N+1). All M7 tests still pass. Tag: `v0.8.0-alpha.0`.

You are not debating *what* to verify (the contracts pin that). You are debating *how* to verify it — thirteen implementation decisions where my leans need pressure. Push back hard where the leans are wrong; sanity-check rather than rubber-stamp where they hold.

Ozzy's framing of why VERIFY discipline matters (2026-04-30): *"if VERIFY fails we should be starting over to process — why is VERIFY important then?"* The restart-on-fail policy is what makes VERIFY's verdict authoritative; if BUILD could re-patch in response to failure, VERIFY would be a hint, not a gate. M8's job is to ship that authority without ceremony.

Mirror the verdict format from `CODEX_RESPONSE_M7.md`: numbered decisions, `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications` per the DEBATE.md verdict enum, "Where I agree", "Where I disagree (with specific alternative)", "Decisions you must lock before code".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1-20. Rules 1 (file-based gates), 2 (cross-family review at REVIEW gate, **not** at VERIFY — VERIFY is intra-family in v0.1), 6 (4-attempt cap pattern), 7 (Markdown contracts), 9 (permission manifest for execution; `tool_use.execute` is M8's new sub-scope), 11 (`NEEDS_INTERVENTION.json` on cap), 13 (privacy by default), 15 (Scientist tail at gates), 16 (universal-rules.md injection), 19 (`budgets.global` enforcement covers VERIFY's runner-call costs), 20 (M8's authority boundary is **VERIFY evidence + restart-on-fail policy** — strictly one boundary, not two: evidence is meaningless without the loop discipline that makes it authoritative).

- **`docs/contracts/VERIFY.md`** (commit `d1cfb8e`) — VERIFY.md schema with six required H2 sections (BUILD ref, Validation command, Evidence, Verdict, Mutation, Failure constraint), locked grammars (BUILD ref immutable binding, Failure constraint 6-bullet shape with 200-char caps on summary and constraint), `tool_use.execute` permission sub-scope, four event names (`verify_started`, `verify_completed`, `verify_failed`, `verify_restart_initiated`), Scientist tail spec, restart-on-fail policy 5-step discipline, M8 → M7-restart handoff seam, M8 → M9 handoff seam, error table.

- **`docs/contracts/BUILD.md`** (commit `d1cfb8e` + M7 commit 17 tightening) — what M8's VERIFY reads on entry: `Task.Task`, `Task.Attempt`, `Base.Base commit`, `Patch.Patch sha256`, `Changed files` manifest, `Validation command` (4 bullets verbatim — substitution rejected), `Failure carry-forward` (when present). M7 commit 17 closed the block-next-milestone finding by enforcing `Working directory` matches the run worktree path and timeout is bounded; M8 inherits that tightened shape.

- **`docs/contracts/WORKTREE.md`** (commit `f504c3d`, M7 commit 1) — run directory layout including extensibility contract for `forensics/<N>/`. M7 ships six required entries (`diff.patch`, `stdout.log`, `stderr.log`, `BUILD_REPORT.md`, `manifest.txt`, `prompt-constraints.md`); M8 appends three (`VERIFY.md` frozen, `attempt-<N>.patch` frozen, `build-prompt-snapshot.md`). Cleanup-on-success and preserve-on-failure paths are pinned but neither fires in M7 (BUILD-pass alone is insufficient — the worktree must survive the BUILD gate so VERIFY can read it; M7 commit 8 / Codex H2 already wired the extensible writer that accepts these M8 additions).

- **`docs/contracts/SCIENTIST.md`**, **`docs/contracts/PLAN.md`**, **`docs/contracts/REPO_CONTEXT.md`**, **`docs/contracts/GATES.md`** — substrate VERIFY consumes. PLAN.md task block grammar (which decision 4 may extend), gate-preflight pattern that VERIFY mirrors, Scientist phase-tail discipline.

- **`docs/design/ROADMAP.md` § M8** — file list: `src/phases/verify.ts`, `src/artifacts/verify-report.ts`, `src/phases/verify-mutation.ts` (revert-and-replay), `src/agents/defaults/verifier.md`, `src/prompts/verify-system.md`, `src/tools/test-runner.ts` (language-agnostic), `src/phases/restart-policy.ts`, `phases.build.maxAttempts` config, tests, `tests/e2e/verify-lite-greenfield.test.ts`.

- **`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`** — your prior verdict. Risk #1 ("worktree is not a sandbox" — applies to VERIFY's runner: `bash: deny` + scoped `tool_use.execute` + no network are the load-bearing safeguards until W4 containerization), risk #2 ("fake green gate" — VERIFY is the gate that can produce this if mutation is skipped or evidence is forged), risk #3 ("preserved diff, logs, artifact hashes, and prompt constraints, not just a leftover worktree" — names the M8 forensics-population list explicitly), risk #5 ("Scientist tail may become gate noise" — same 3/3 cap applies to VERIFY's tail).

- **`docs/design/CODEX_REVIEW_M7.md`** (thread `019ddf20`) — the M8-territory follow-ups Codex called out: VERIFY runner execution, restart-on-fail, cleanup-on-VERIFY-pass, full forensics population from a real VERIFY failure (frozen VERIFY.md, patch copy, prompt snapshot). All four land in M8 by design.

- **`docs/design/CODEX_RESPONSE_M7.md`** (thread `019ddeea`) — the implementation debate Codex closed for M7. Decision 9 (e2e fixture: extend M6 / `greenfield-baby-name`) was accepted; M8 e2e tests inherit the same fixture. Decision 12 (load-time + runtime validation for `tool_use.write`) was accepted with modifications (require exact templated worktree root); M8 mirrors the same shape for `tool_use.execute`.

You do not need to re-read every M2-M7 source file. Glance at:

- **`src/phases/build.ts`** — the canonical phase pattern after M7 tightening: orchestrator preflight → persona invocation → `repair → finalize` → atomic write → Scientist tail → gate-preflight. VERIFY mirrors this shape (input is BUILD_REPORT.md instead of PLAN.md; output is VERIFY.md instead of BUILD_REPORT.md; the runner-execution step replaces patch-application).
- **`src/artifacts/build-report.ts`** — the canonical artifact-parsing pattern. `parseVerifyReport` follows: BOM strip, line split, section walk, section-order check, grammar validation per section, throw `VerifyReportLoadError` with frozen issues.
- **`src/agents/defaults/builder.md`** — current ~6.5k BUILD persona post-M7. VERIFY persona mirrors structure (preamble + universal-rules-injection + role + discipline + format) but is structurally simpler (persona authors only Verdict.Rationale, Mutation.Notes, Failure constraint body; orchestrator owns Evidence and BUILD ref).
- **`src/prompts/universal-rules.md`** — the 20-item rule sheet (rule 16). Injected into VERIFY persona prompt unchanged from M7.
- **`src/state/schemas.ts`**, **`src/state/events.ts`** — event union pattern. M8 adds 4 `verify_*` event types per VERIFY.md.
- **`src/agents/schema.ts`** + **`src/agents/load.ts`** — `AgentPermissions` shape and load-time validation. M8 adds `tool_use.execute` per VERIFY.md, with same load-time shape Decision 12 of M7 locked: only one tool (`test-runner`), only one root (the run's worktree path), bounded timeouts and stdout/stderr caps.
- **`src/state/run.ts`** `requireGate`, `approveGate`, gate-preflight pattern. VERIFY's gate-preflight extends BUILD's pattern: validates VERIFY.md plus Scientist sidecars (per rule 15) plus the cap-counter state.
- **`src/worktree/forensics.ts`** — the extensible writer M7 commit 8 / Codex H2 shipped. VERIFY's preserve step reuses the same `extras` parameter to add the three new entries.
- **`src/agents/defaults/verifier.md`** — current 1.5k stub from M2, replaced wholesale in M8.

---

## What's locked (not up for debate)

These come from CLAUDE.md, the pinned contracts, and the M7-M10 shape thesis debate.

1. **VERIFY writes `VERIFY.md` with the six-section schema in `VERIFY.md`.** Section order, grammar, error codes are pinned. Persona may not invent sections. Evidence is orchestrator-recorded; persona authors only `Verdict.Rationale`, `Mutation.Notes`, and `Failure constraint` body.
2. **`tool_use.execute` is the only new sub-scope landing in M8.** It governs validation-command execution; the runtime tool is `test-runner` with `roots: ['.code-oz/runs/<runId>/worktree/']`, `timeoutMs: 60000`, `maxStdoutBytes: 1048576`, `maxStderrBytes: 1048576`, `network: 'none'`. Schema lands in `src/agents/schema.ts`; load-time + runtime validation per Codex M7 Decision 12 lean.
3. **Validation command is executed verbatim from BUILD_REPORT.md.** Persona-side substitution or interpolation is rejected with `verify_command_substitution`. The orchestrator computes the canonical command line from BUILD_REPORT's four `Validation command` bullets and intersects the `tool_use.execute` request with that shape; mismatches reject before any process spawns.
4. **Restart-on-fail policy is 5-step, no soft patch loop.** Per VERIFY.md § "Restart-on-fail policy": (a) forensics preserved, (b) worktree destroyed as active candidate, (c) attempt N+1 starts clean from same approved PLAN, (d) hard cap 4 clean BUILD attempts, (e) attempt 5 → `NEEDS_INTERVENTION.json`. The cap counts clean BUILD attempts; patch retries do not exist.
5. **VERIFY persona is `claude` family in v0.1.** Cross-family enforcement is M9's REVIEW boundary, not M8. Pinning VERIFY as Claude in M8 does not preempt M9; the cross-family check is REVIEW's load-time validation against BUILD's family.
6. **VERIFY-lite stops before REVIEW.** No cross-family review in M8; VERIFY pass writes `GATE_VERIFY_PASSED.json` and the run terminates pending `code-oz approve verify` and the (still-stubbed) REVIEW phase.
7. **Mutation gate semantics are `revert-and-replay`.** Status enum is `{pass, fail, not-applicable}`. `pass` requires reverting the patch's changed-file paths to base contents and confirming the validation command exits non-zero (i.e., the new tests genuinely test new behavior). `not-applicable` skips the gate; `fail` blocks VERIFY pass with `Mutation.Status: fail`.
8. **Scientist tail runs at VERIFY gate** per rule 15 + VERIFY.md § "Scientist tail". Cap of 3 new hypotheses + 3 new questions per VERIFY pass is named in VERIFY.md, matching BUILD's M7 cap. Pass-side: hypotheses with falsifiers now satisfied get `verified` annotation. Fail-side: failure summary may seed a new `Q-NNN`.
9. **Universal rules sheet (rule 16) injected into VERIFY persona prompt.** Imported from `src/prompts/universal-rules.md`; persona may add VERIFY-specific rules below but cannot relax universals.
10. **No DEBATE runtime in M8.** `requestDebate()` lands in M10. Process contract was M7 commit 2.
11. **All tests offline via FakeProvider.** Live-provider tests opt-in only. The runner abstraction (`src/tools/test-runner.ts`) is real Bun.spawn code, but VERIFY-lite e2e tests use a FakeProvider-emitted patch whose validation command is a deterministic shell-free synthetic (e.g., a Bun-script asserter that reads the worktree and writes a known exit code); M8 does not require a real `bun test` invocation in the test suite.
12. **`budgets.global` enforcement covers VERIFY's runner calls.** Per CLAUDE.md rule 19: `tool_use.execute` invocations contribute wall-time and (with `priceTable`) dollar telemetry to cumulative spend. Soft warn at 75%, hard kill at 100%. Re-uses the M6 `assertWithinBudget` shape; no parallel namespace.
13. **Forensics extensibility is by basename, not by relocation.** M8's three new entries (`VERIFY.md`, `attempt-<N>.patch`, `build-prompt-snapshot.md`) live alongside M7's six in the same `forensics/<N>/` directory. M8 may not rewrite or relocate the M7 entries.

---

## What's up for debate

Thirteen decisions. Numbered for your reply.

### Decision 1 — Test-runner abstraction shape

**My lean: thin wrapper around `Bun.spawn` with `signal` for timeout cancellation, captured stdout/stderr written directly to `forensics/<N>/stdout.log` + `stderr.log` during execution (streaming append, not buffered-then-flushed), and a 1 MiB cap per stream enforced via accumulated-bytes check on each chunk.**

The runner exposes `runValidationCommand({ command, cwd, timeoutMs, expectedExitCode, stdoutLogPath, stderrLogPath, maxStdoutBytes, maxStderrBytes }) → { exitCode, durationMs, stdoutBytes, stderrBytes, truncated: { stdout: boolean, stderr: boolean }, timedOut: boolean }`. Streaming-append means a runaway test that produces 10 MiB of stdout writes the first 1 MiB to disk and then the runner kills the child via `AbortController`; we never buffer the full output in memory.

**Counter-cases to consider:**
- (a) **Subprocess pool**: pre-warmed Bun child to amortize startup. Premature optimization for v0.1 — the validation command is invoked once per BUILD attempt, and pool lifecycle (cleanup on test crash, environment isolation between calls) is its own complexity. Defer to W3.
- (b) **Buffered capture instead of streaming**: simpler code path but loses output if the runner crashes mid-execution. Forensics on VERIFY-fail must include the partial stdout/stderr; streaming is the correct posture for a forensics-driven discipline.
- (c) **Direct `bun test` integration without the abstraction**: faster path to an e2e but couples M8 to a single test framework. ROADMAP names "language-agnostic test-runner abstraction" as the M8 deliverable; the abstraction is load-bearing for W3+ multi-language.

**Question for you:** Bun.spawn + streaming is the right call for v0.1, or push for buffered + simpler?

### Decision 2 — Attempt counter source of truth

**My lean: derived from `events.jsonl` reduced over `runId` filter, counting completed BUILD attempts (`build_completed` events for the run). No separate `attempts.json`; no field in `current.json`.**

Three paths considered:
- (a) **Event-log reduction** (lean): each call to "what's the next attempt number?" reduces `events.jsonl` filtered by `runId` and counts `build_completed` events, returning `count + 1`. Single source of truth; no parallel state to drift.
- (b) **`current.json` field**: a `currentAttempt: number` in the derived state file. Faster to read but `current.json` is convenience-derived per ROADMAP § State model; introducing canonical state into it inverts that posture.
- (c) **Separate `attempts.json`**: dedicated file written atomically on each BUILD-completed / VERIFY-failed transition. Adds a third concurrent writer to `.code-oz/state/runs/<runId>/`; race conditions across the three (events.jsonl, current.json, attempts.json) are the failure mode this rejects.

**Counter-case:** event-log reduction is O(events) on every check. For long-running concurrent debug sessions with thousands of events, that's a real cost. A memoized in-memory cache of the last-seen `currentAttempt` per runId in the orchestrator process eliminates the cost without persisting state.

**Question for you:** event-log reduction with in-memory cache (lean), or commit to `current.json` as canonical for restart bookkeeping?

### Decision 3 — Mutation-gate applicability declaration

**My lean: extend PLAN.md task grammar with a new bullet `- Asserts: new-behavior | bugfix | refactor | docs` declared per task. Mutation gate is `applicable` iff `Asserts: new-behavior`. The flag is persona-authored at PLAN time; the orchestrator validates it during PLAN's gate-preflight.**

Two paths considered:
- (a) **Explicit `Asserts:` flag** (lean): PLAN persona declares intent at task creation. Concrete, debuggable, persists across restart attempts. Orchestrator validates the enum.
- (b) **Inferred from `## Files`**: any task whose `## Files` block contains a `**/*.test.ts`-matching path with `change: added` is treated as `new-behavior`. Implicit, no PLAN grammar churn, but couples mutation applicability to file-naming convention.

**Counter-cases to consider:**
- If (a), what happens on tasks where new behavior is asserted via a *modification* to an existing test file (adding a new `it(...)` block)? The `change: added` heuristic in (b) misses this; (a) handles it cleanly because the persona declares intent.
- If (b), what about non-`.test.ts` test conventions (e.g., `*.spec.ts`, `__tests__/*.ts`)? Configurable test glob in `.code-oz/config.yaml` shifts the cost to ops.

**Question for you:** explicit `Asserts:` flag (lean), inferred from file naming, or hybrid (declared but with a sane default inferred at PLAN draft time)?

### Decision 4 — PLAN.md task grammar extension for change-kind

**My lean: extend PLAN.md task grammar with `change: added | modified | deleted` per file in the `## Files` block, mirroring BUILD_REPORT.md's `## Changed files` grammar. PLAN's gate-preflight validates that any `modified` or `deleted` path exists in the host's `HEAD` (M7's BUILD entry preflight check 3 already validates this against the bound base; the extension surfaces the intent at PLAN time so drift is caught earlier).**

Codex M7 implementation review finding #2 (`block-push`, closed in M7 commit 16) raised: "PLAN can reason over a file absent in base, and BUILD will proceed." M7 closed this conservatively by failing absent task files at BUILD entry. The remaining question for M8: does PLAN declare the intent (added vs modified) so the persona's reasoning is checked at PLAN time, or does BUILD continue to fail conservatively?

Three paths considered:
- (a) **PLAN declares change kind** (lean): grammar extension; BUILD's preflight check 3 cross-checks PLAN's declared `added` against base absence, `modified` against base presence. Drift fails early with `plan_change_kind_drift`.
- (b) **Fail conservatively** (current M7 posture): no PLAN grammar change; BUILD's preflight 3 fails any task referencing files absent in base unless explicitly marked `added` (which currently has no syntax). This requires the persona to know to use a not-yet-defined marker — the failure mode that triggered finding #2.
- (c) **Defer to M9 / W2**: leave the grammar alone; document the failure mode in `OPEN_QUESTIONS.md` and handle later. Risk: same failure mode reproduces.

**Counter-cases to consider:**
- M7 closed finding #2 with conservative-fail at BUILD entry, which is correct *given* the absent grammar. But absent grammar means PLAN persona can write a task that *will* fail at BUILD time without warning, wasting an attempt slot. Earlier feedback is cheaper.
- Grammar extension changes PLAN's contract; it's not free. PLAN.md migration: existing tests with `## Files` blocks need `change:` bullets. Backward-compat: parser accepts old format with a deprecation warning, mints `change: modified` as default for the next minor.

**Question for you:** extend PLAN grammar (lean), keep conservative-fail (status quo), or hybrid (extend grammar but auto-default `change: modified` for unannotated files)?

### Decision 5 — Failure-constraint emitter authority

**My lean: VERIFY persona authors both `Failure summary` and `Constraint` under `repair → finalize` discipline. Orchestrator validates ≤ 200 chars and rejects multi-line. The Constraint must be directive (imperative voice) and the summary descriptive; the persona's repair feedback enforces the voice distinction.**

Two paths considered:
- (a) **Persona authors both** (lean): persona reads the failed evidence (stdout, stderr, exit code) and synthesizes both fields. Concrete, narrative, debuggable.
- (b) **Orchestrator template + persona narrative**: orchestrator generates a stub Constraint from the exit code (e.g., "Tests failed with exit code 1") and the persona fills in the narrative summary. Less brittle, less informative.

**Counter-cases to consider:**
- The Constraint is what feeds back into BUILD attempt N+1's prompt verbatim. If the persona authors it, hallucinated constraints can mislead the next BUILD attempt. (Empirical M5/M6 history: persona-authored summaries occasionally drifted into prescription rather than description.)
- A worked example in the VERIFY persona prompt ("Bad: 'Fix the test'. Good: 'Use last-syllable stress for two-syllable surnames'") plus a failed-repair penalty (treat empty/vague Constraint as `verify_failure_constraint_grammar`) shifts the persona toward concrete output.

**Question for you:** persona authors both (lean), orchestrator-templated Constraint, or hybrid (persona authors with structured worked examples in prompt)?

### Decision 6 — Restart cap semantics

**My lean: 4 clean *BUILD* attempts (per VERIFY.md § "Restart-on-fail policy" line 184). The count covers BUILD attempts that produce a valid BUILD_REPORT.md. BUILD-failures (no valid report) are NOT in the cap — they emit `NEEDS_INTERVENTION.json` directly per BUILD.md § "Event types emitted" and the run terminates without entering restart.**

Two paths considered:
- (a) **Clean BUILD attempts only** (lean, current contract reading): the 4-attempt cap protects against tautological-verification loops, not BUILD persona protocol violations. BUILD persona that emits malformed responses 5 times in a row is a different failure mode (likely a model regression or prompt bug); intervention should fire on the first violation.
- (b) **Total attempt slots regardless of failure mode**: 4 attempts, period. Simpler counting, but conflates BUILD's persona-failure path with VERIFY's evidence-failure path.

**Counter-case:** in practice, a BUILD attempt that fails persona-protocol can be retried by the same prompt with feedback. The "no soft patch loop" rule is about VERIFY-fail, not BUILD-protocol-fail. Keeping them separate means BUILD-fail can have its own (much smaller) repair cap inside the protocol stage; M7 already does this with `repair → finalize` capped at 3.

**Question for you:** 4-cap covers VERIFY-fail-driven restarts only (lean), or 4-cap is total invocations regardless of failure mode?

### Decision 7 — Cleanup-on-VERIFY-pass timing

**My lean: cleanup fires on `verify_completed` (event-driven), before `code-oz approve verify` is invoked. The worktree is gone by the time the user types `approve`; the artifacts (VERIFY.md, BUILD_REPORT.md, manifests) survive in `.code-oz/artifacts/` and `.code-oz/runs/<runId>/forensics/` (empty on success), `patches/` (retained).**

Two paths considered:
- (a) **Event-driven** (lean): cleanup is mechanical, not approval-gated. The user's `approve verify` writes the gate file but does not destroy state; the destruction happened atomically with the pass-verdict write.
- (b) **Gate-driven**: cleanup waits for `code-oz approve verify`. The user can inspect the worktree before approving, then cleanup fires on approve.

**Counter-cases to consider:**
- (a) is faster and simpler but blocks the user's ability to manually inspect a passing run's worktree (which can be useful for "how did this actually look on disk?" debugging).
- (b) keeps the worktree available for inspection but introduces a window where a user who never types `approve` accumulates worktrees on disk. `code-oz prune` (W2) cleans them, but until W2, gate-driven cleanup creates orphan worktrees.
- Hybrid: cleanup fires on `verify_completed` *unless* `phases.verify.preserveOnPass: true` is set in `.code-oz/config.yaml`. Default off; opt-in for debugging.

**Question for you:** event-driven cleanup (lean), gate-driven, or event-driven with opt-in preserve flag?

### Decision 8 — Forensics population ordering on VERIFY-fail

**My lean: the orchestrator orders `worktree_forensics_preserved` strictly before `verify_failed` in `events.jsonl`. The sequence: VERIFY persona returns `Verdict: fail` → orchestrator validates VERIFY.md → forensics dir populated (frozen VERIFY.md, frozen attempt-<N>.patch, build-prompt-snapshot, plus M7's six entries refreshed) → `worktree_forensics_preserved` event emitted → `verify_failed` event emitted → `verify_restart_initiated` event emitted (or NEEDS_INTERVENTION if attempt = 4) → `git worktree remove --force` → `worktree_destroyed` event.**

The ordering matters because `verify_failed` is the durable signal that restart-on-fail is in motion; forensics must be on disk before that signal fires (otherwise a crash between `verify_failed` and `worktree_forensics_preserved` leaves the system claiming a fail without evidence). M7's WORKTREE.md § "Forensics layout" already names "order matters: a destroyed worktree cannot be re-diffed" — this question extends that ordering to event emission.

Three paths considered:
- (a) **Forensics-first ordering** (lean, conservative): no `verify_failed` is durable until forensics is durable. Crash-safe.
- (b) **Parallel emission**: emit `verify_failed` and `worktree_forensics_preserved` concurrently. Faster but breaks the "evidence before signal" discipline; a crash between the two leaves an inconsistent state.
- (c) **Single-event composite**: one `verify_failed` event with embedded `forensicsBundleHash` field. Simpler audit but less granular for replay tooling.

**Counter-case:** strict ordering serializes I/O. For BUILD-failure-driven `NEEDS_INTERVENTION` (a different code path), a similar ordering exists. M8 should be consistent with M7's emit ordering, not invent a new style.

**Question for you:** forensics-first strict ordering (lean), or composite event?

### Decision 9 — VERIFY persona repair cap

**My lean: 2 attempts. Tighter than PLAN's and BUILD's 3-cap because VERIFY's persona output is structurally simpler (three free-form fields: `Verdict.Rationale`, `Mutation.Notes`, `Failure constraint` body — all under hard char caps and grammar locks).**

Two paths considered:
- (a) **2-cap** (lean): structurally simpler output → less repair surface → smaller cap. Tightens token budget on VERIFY repairs.
- (b) **3-cap matching PLAN/BUILD**: consistency over per-phase tuning. Easier to reason about across phases.

**Counter-case:** matching PLAN/BUILD reduces cognitive overhead. The token savings from 3→2 are small in expectation (most VERIFY drafts pass first try; the second attempt typically fixes a single grammar violation). Consistency is cheap insurance.

**Question for you:** 2-cap (lean for tighter discipline), 3-cap (consistency), or `phases.verify.maxRepairAttempts` config knob?

### Decision 10 — VERIFY authority split (orchestrator vs persona per field)

**My lean: VERIFY mirrors BUILD's authority split published in BUILD.md § "Authoring authority". Orchestrator owns: `BUILD ref` (all 5 bullets, copied verbatim from BUILD_REPORT.md), `Validation command` (4 bullets, copied verbatim from BUILD_REPORT.md), `Evidence` (6 bullets, recorded from process execution), `Mutation.Status` (computed from revert-and-replay outcome). Persona owns: `Verdict.Verdict` (one of `pass`/`fail`, validated against evidence), `Verdict.Rationale` (free-form ≤ 200 chars), `Mutation.Notes` (free-form ≤ 200 chars), `Failure constraint` body (when verdict = fail).**

The orchestrator-author / persona-author split reduces the "fake green gate" surface: the persona cannot forge `Evidence.Exit code` or claim `Mutation.Status: pass` without the revert-and-replay actually returning that status. Codex M7 review's C1 finding (orchestrator owns computed fields) generalizes to VERIFY directly.

**Counter-case:** allowing the persona to author `Mutation.Status` (with cross-check) could surface persona-side reasoning about edge cases the orchestrator's binary `pass`/`fail` misses. But the grammar locks `Status` to three values; persona narrative goes in `Notes` which is already persona-authored.

**Question for you:** mirror BUILD's split (lean), or shift more fields to persona for richer rationale?

### Decision 11 — Mutation-gate test-file revert semantics

**My lean: when reverting the patch's changed-file paths to base, the orchestrator reverts ALL changed-file paths including test files. This is the correct semantics: if the new test file is reverted (not present), the validation command must fail (`bun test tests/scoring-syllable.test.ts` exits non-zero because the file does not exist), which means `Mutation.Status: pass` (the new test asserts new behavior — its absence breaks validation).**

Two paths considered:
- (a) **Revert all changed paths** (lean): including test files. The mutation gate validates that the validation command's pass depends on the patch's changes — including the new tests themselves.
- (b) **Revert source-only**: leave test files in place at post-patch state, revert only `change: added | modified` paths matching `**/!(*.test|*.spec).ts` patterns. The mutation gate then validates that the *source* changes are necessary for the new tests to pass, but not whether the new tests themselves are non-empty.

**Counter-cases to consider:**
- (a) catches both "tautological tests" (new test that would pass without the patch's source changes) AND "no new tests" (patch added source but no test file). But it conflates these into one `Mutation.Status: fail` signal; the persona's `Notes` field disambiguates.
- (b) is closer to traditional mutation testing (test the source, not the test) but assumes the test file's existence. For new-behavior tasks, the test file is part of the new behavior; reverting it is correct.

**Question for you:** revert all changed paths (lean), source-only, or differentiate based on `Asserts:` flag from decision 3?

### Decision 12 — VERIFY persona size and content

**My lean: target ~5-6k. Smaller than BUILD's 6.5k because the output structure is simpler (no patch-authoring grammar; 3 free-form text fields instead of patch + Title + Notes). Includes universal-rules-import + role-framing + evidence-reading discipline + mutation-gate explanation + failure-constraint authoring discipline + repair instructions + worked examples (2-3 short pass cases, 2-3 short fail cases).**

Current `src/agents/defaults/verifier.md` is 1.5k stub from M2. M7's `builder.md` is ~6.5k post-tightening. VERIFY's narrative core: how to read evidence, how to author a useful Constraint, what mutation status means, when to repair vs surrender to intervention.

**Counter-case:** worked examples bloat prompts and have unclear payoff in M5/M6 trail data. A leaner ~4k prompt with one worked example per case (4 total) might produce equivalent output. Test the hypothesis with M8 e2e: leaner prompt's repair rate vs lean+examples.

**Question for you:** ~5-6k with worked examples (lean), or push for ~4k with one example per case?

### Decision 13 — VERIFY-lite e2e fixture strategy

**My lean: extend the M6 fixture (`tests/fixtures/greenfield-baby-name`, accepted in Codex M7 Decision 9) with a second PLAN task `T-002` whose validation command intentionally fails on the first BUILD attempt's patch (e.g., a deliberately-buggy patch the FakeProvider emits) and passes on the second attempt's patch. The same fixture supports both M8 e2e tests: `tests/e2e/verify-lite-greenfield-pass.test.ts` (DEFINE → PLAN → BUILD → VERIFY for `T-001`, all pass) and `tests/e2e/verify-lite-greenfield-restart.test.ts` (`T-002`, fail then retry then pass).**

Two paths considered:
- (a) **Extend M6/M7 fixture with T-002** (lean): same fixture, two e2e tests, restart path exercised end-to-end with FakeProvider emitting the failure-then-success patch sequence.
- (b) **Two separate fixtures**: `verify-lite-pass/` and `verify-lite-restart/`. Cleaner separation but requires duplicating the SPEC.md and PLAN.md (with task variants).

**Counter-case:** (a) couples test isolation to FakeProvider state machine complexity. The FakeProvider needs to know "this is attempt 1 vs attempt 2 for the same runId" and emit different patch bodies accordingly. M5's FakeProvider is keyed by `(phase, taskId)` not by attempt number; extending to attempt-aware emission is a real change.

**Question for you:** extend M6 fixture with attempt-aware FakeProvider (lean), or split into two fixtures with single-attempt FakeProvider per fixture?

---

## The recommended path (commit-by-commit, ~10 commits)

```
M8 commit 1:  src/agents/schema.ts adds tool_use.execute; src/agents/load.ts validates;
              tests/agent-load-tool-use-execute.test.ts (load-time + runtime stub)
M8 commit 2:  src/state/schemas.ts + src/state/events.ts add 4 verify_* event types;
              tests/state-events-verify.test.ts
M8 commit 3:  src/tools/test-runner.ts (Bun.spawn + streaming + caps + timeout);
              tests/test-runner-{spawn,timeout,truncation,exit-code,errors}.test.ts
M8 commit 4:  src/artifacts/verify-report.ts (parse/serialize/atomic-write per VERIFY.md schema);
              tests/verify-report-{parse,serialize,grammar,build-ref,failure-constraint}.test.ts
M8 commit 5:  src/phases/verify-mutation.ts (revert-and-replay; applicability check; status mapping);
              tests/verify-mutation-{revert,replay,applicable,not-applicable,fail-tautology}.test.ts
M8 commit 6:  src/phases/restart-policy.ts (cap counter via events.jsonl reduction; failure-carry-forward
              propagation; NEEDS_INTERVENTION emission at attempt 5);
              tests/restart-policy-{cap-counter,carry-forward,intervention,events}.test.ts
M8 commit 7:  src/agents/defaults/verifier.md + src/prompts/verify-system.md (universal-rules import,
              full prompt, worked examples; replaces M2 stub)
M8 commit 8:  src/phases/verify.ts (orchestrator: BUILD ref bind → command execute → evidence record →
              mutation gate → persona invoke → repair → finalize → forensics-on-fail OR cleanup-on-pass →
              Scientist tail → gate-preflight); tests/verify-phase-{pass,fail,mutation-fail,
              cleanup-on-pass,forensics-on-fail,scientist-tail}.test.ts
M8 commit 9:  src/worktree/forensics.ts extended for M8's three new entries (frozen VERIFY.md,
              frozen patch, build-prompt-snapshot); src/phases/build.ts wired to consume
              prompt-constraints.md when attempt > 1; tests/forensics-extras-{verify,patch,prompt}.test.ts
              + tests/build-failure-carry-forward-restart.test.ts
M8 commit 10: tests/e2e/verify-lite-greenfield-pass.test.ts + tests/e2e/verify-lite-greenfield-restart.test.ts
              (full DEFINE → PLAN → BUILD → VERIFY pass path; full attempt-1-fail then attempt-2-pass
              restart path with FakeProvider attempt-aware patch emission against extended
              greenfield-baby-name fixture)
```

Plus an eleventh Codex-review-fix commit if your verdict is `fix-first`.

If decision 4 lands as `accept` (extend PLAN grammar with `change: added | modified | deleted`), an additional commit slots between current commits 4 and 5:

```
M8 commit 4.5: src/artifacts/plan.ts grammar extension; PLAN.md task block accepts
               `change:` per file; backward-compat default `change: modified`;
               tests/plan-grammar-change-kind.test.ts + tests/plan-build-binding-change-kind.test.ts
```

If decision 3 lands as `accept` (extend PLAN grammar with `Asserts:` flag), the same `commit 4.5` carries the `Asserts:` extension as well.

Tag: `v0.8.0-alpha.0` after Codex review verdict = `push`.

---

## Decision prompts (numbered for your reply)

1. **Decision 1** — test-runner shape: Bun.spawn + streaming + 1 MiB caps (lean), or buffered + simpler?
2. **Decision 2** — attempt counter: events.jsonl reduction with in-memory cache (lean), or `current.json` canonical?
3. **Decision 3** — mutation applicability: explicit `Asserts:` flag in PLAN (lean), inferred from file naming, or hybrid?
4. **Decision 4** — PLAN change-kind: extend grammar (lean), keep conservative-fail, or hybrid with default?
5. **Decision 5** — failure-constraint: persona authors both (lean), orchestrator-templated, or hybrid?
6. **Decision 6** — restart cap: 4-cap covers VERIFY-fail only (lean), or total invocations?
7. **Decision 7** — cleanup-on-pass: event-driven (lean), gate-driven, or opt-in preserve?
8. **Decision 8** — forensics ordering: forensics-first strict (lean), or composite event?
9. **Decision 9** — VERIFY repair cap: 2 (lean), 3 (match), or config-driven?
10. **Decision 10** — authority split: mirror BUILD (lean), or shift fields to persona?
11. **Decision 11** — mutation revert: all changed paths (lean), source-only, or `Asserts:`-driven?
12. **Decision 12** — VERIFY persona size: ~5-6k with examples (lean), or ~4k with single examples?
13. **Decision 13** — e2e fixture: extend M6 with attempt-aware FakeProvider (lean), or split into two?

---

## What I want from you

- Numbered verdict on each of the thirteen decisions: `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications` per the DEBATE.md verdict enum. For each `accept-with-modifications` or `reject`, the specific alternative — concrete enough that I can land it in a commit without further round-trips.
- Risks I'm not seeing. M8 is the first milestone where the gate executes user code (the validation command). What does the runtime surface miss? Especially: where could "fake green gate" sneak in via mutation gate edge cases (e.g., flaky tests, timeouts mistaken for fails, non-deterministic exit codes)? Where could restart-on-fail leak attempts from BUILD-protocol-failure into the VERIFY-fail cap?
- Decisions you would defer. If any of the thirteen should be punted to M9 or later, name them. Particular candidates: decision 3 (mutation applicability) and decision 4 (PLAN grammar) both touch PLAN's contract; one of them landing in M8 is sufficient if the other can defer cleanly.
- A recommended commit-order critique. The 10-commit path above mirrors M5/M6/M7 cadence (schemas → events → tools → artifacts → algorithm → policy → persona → phase → integration → e2e); if you see a better ordering (e.g., persona prompt before phase orchestrator, restart policy split into multiple commits), say so.

This is the M8 *implementation* briefing. The M7-M10 shape thesis debate is closed (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`); do not relitigate the M7/M8/M9 split or the BUILD/VERIFY/REVIEW boundary. Stay inside the thirteen decisions.

---

## Reference

- **Pinned contracts:** [`VERIFY.md`](../contracts/VERIFY.md), [`BUILD.md`](../contracts/BUILD.md), [`WORKTREE.md`](../contracts/WORKTREE.md), [`REVIEW.md`](../contracts/REVIEW.md), [`PLAN.md`](../contracts/PLAN.md), [`SCIENTIST.md`](../contracts/SCIENTIST.md), [`DEBATE.md`](../contracts/DEBATE.md)
- **Roadmap:** [`docs/design/ROADMAP.md § M8`](./ROADMAP.md)
- **Prior debates:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30 — risk #1 sandbox, risk #2 fake green gate, risk #3 forensics list, risk #5 Scientist gate noise), [`CODEX_RESPONSE_M7.md`](./CODEX_RESPONSE_M7.md) (thread `019ddeea`), [`CODEX_REVIEW_M7.md`](./CODEX_REVIEW_M7.md) (thread `019ddf20` — closed `push` after M7 commits 16-17 addressed the block-push and block-next-milestone findings; M8 inherits a clean substrate)
- **Empirical history:** `docs/design/CODEX_BRIEFING_M{2..7}.md` + matching responses + reviews
- **Non-negotiable rules:** `CLAUDE.md` rules 1-20, especially 7 (this debate satisfies it), 11 (intervention codes), 19 (`budgets.global` covers VERIFY runner calls), 20 (M8's authority boundary is **VERIFY evidence + restart-on-fail policy** — strictly one boundary; evidence is meaningless without the loop discipline that makes it authoritative)
