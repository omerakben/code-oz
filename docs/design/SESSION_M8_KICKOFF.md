# code-oz — M8 implementation session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else. The non-negotiable rules in there override anything that conflicts in this kickoff.

This session ships **M8 — VERIFY-lite + restart-on-fail policy + mutation-test gate**. Tag at end: `v0.8.0-alpha.0`. Branch: `feat/m8-verify-lite` from `main`.

## State at start of this session

- **Repo:** `github.com/omerakben/code-oz` (local-only; not yet pushed). Branch `main` carries the M7 merge.
- **Last release:** `v0.7.0-alpha.0` — M7 closed. BUILD-lite + worktree subsystem + patch validate/apply + BUILD_REPORT.md + Scientist tail at BUILD gate. Tagged on `main` locally.
- **Tests:** 1005 passing, offline.
- **Binary:** `dist/code-oz` reports `0.7.0-alpha.0`.
- **What works:** DEFINE → PLAN → BUILD end to end with FakeProvider against `greenfield-baby-name` fixture; worktree-per-run isolation; orchestrator-owned BUILD_REPORT.md authoring with persona-authored Title/Notes only; patch path-safety scanner; Scientist tail at BUILD gate; BUILD entry preflight (PLAN sha pin, task existence, base-drift detection, repo-context root override, validation-command well-formedness).
- **What's stubbed:** VERIFY phase. REVIEW phase. Restart-on-fail policy. Mutation-test gate. Cleanup-on-VERIFY-pass. AUDIT phase. SHIP. The current M7 BUILD always writes `failureCarryForward: null` (`src/phases/build.ts:462`); M8 closes that as part of restart-policy work in commit 7.

## Authority boundary (CLAUDE.md rule 20)

M8 introduces exactly one new authority boundary: **VERIFY evidence + restart-on-fail policy**.

This reads like two boundaries but is structurally one. Restart-on-fail only exists because VERIFY's evidence is authoritative; if BUILD could re-patch in response to failure, VERIFY would be a hint, not a gate. The two halves are inseparable — the same authority viewed from inside (evidence) and outside (loop policy). Per Codex's M7-M10 shape verdict: M9 is cross-family REVIEW authority; M10 is Debate runtime authority. Don't preempt either in M8.

## Why this session exists (the thesis)

After M7 closed, a CLAUDE.md rule #7 debate (Claude + Codex, thread `019ddf5f`, 2026-04-30) pressure-tested 13 implementation decisions. Codex returned 4 rejects, 9 accept-with-modifications, 0 clean accepts. Three of the rejects exposed real bugs in the briefing leans:

- **Decision 11 (mutation revert):** my "revert all changed paths" lean caused vanished test files to register as `Mutation.Status: pass` — the gate would learn nothing. Codex's source-only revert (keep test files at post-patch, revert only behavior files) is the correct semantics.
- **Decision 7 (cleanup timing):** my event-driven lean contradicted WORKTREE.md:86 ("triggered when VERIFY passes **and the VERIFY gate is approved**"). The pinned contract already had the answer; the lean should never have been a decision.
- **Decision 10 (verdict authority):** my "persona authors `Verdict.Verdict`" lean created a fake-green path. Binary verdict is a pure function of evidence and mutation status — orchestrator owns it; persona owns rationale only.
- **Decision 3 (Asserts: flag):** my proposed PLAN grammar extension introduced a persona-side bypass lever (a sloppy persona could mislabel new-behavior as refactor). Codex deferred it; conservative manifest-driven applicability is enough for M8.

Codex also flagged six risks the briefing missed (terminationReason enum, expected-non-zero exit code semantics, flaky-test fake-pass surface, restart-cap event-source leak, real-sandbox vs contract gap, BUILD `failureCarryForward: null` debt).

Synthesis: 13 decisions absorbed, commit sequence reordered (PLAN grammar moves to commit 1, restart-policy moves earlier to commit 7), seven new locked items added.

## Must-read artifacts (in order)

1. **`CLAUDE.md`** — non-negotiable rules 1-20. Particularly: 7 (this session satisfies the M8 leg), 8 (Codex review at implementation completion fires before tag), 11 (intervention codes), 19 (`budgets.global` covers VERIFY runner calls), 20 (M8's single authority boundary).
2. **`docs/design/CODEX_BRIEFING_M8.md`** — the briefing (338 lines, 13 decisions).
3. **`docs/design/CODEX_RESPONSE_M8.md`** — Codex's verdict (thread `019ddf5f`, 4 rejects + 9 accept-with-modifications, 6 risks).
4. **`docs/contracts/VERIFY.md`**, **`BUILD.md`**, **`WORKTREE.md`** — pinned contracts. VERIFY is the schema M8 implements writers for. BUILD is the input M8 reads. WORKTREE is the lifecycle M8 extends (cleanup-on-pass, forensics extras).
5. **`docs/contracts/PLAN.md`** — commit 1 extends the `Files:` bullet grammar.
6. **`docs/design/ROADMAP.md` § M8** — updated scope reflecting Codex's modifications. Authoritative.

You do not need to re-read every M2-M7 source file. Glance at:

- **`src/phases/build.ts`** — the canonical phase pattern after M7 tightening. VERIFY mirrors the shape (input is BUILD_REPORT.md, output is VERIFY.md; runner replaces patch-application).
- **`src/artifacts/build-report.ts`** — the canonical artifact-parsing pattern. `parseVerifyReport` follows the same BOM-strip, line-split, section-walk shape.
- **`src/agents/defaults/builder.md`** (~6.5k post-M7 tightening) — the mid-size persona pattern. `verifier.md` targets ~3.5-4.5k (Codex pushed back on briefing's 5-6k lean).
- **`src/state/schemas.ts`**, **`src/state/events.ts`** — event union pattern. M8 adds 4 `verify_*` event types per VERIFY.md.
- **`src/agents/schema.ts`** + **`src/agents/load.ts`** — `AgentPermissions` shape and load-time validation. M8 adds `tool_use.execute` mirroring M7's `tool_use.write` shape (Decision 12 of M7).
- **`src/worktree/forensics.ts`** — already extensible (M7 commit 8 / Codex H2). M8 wires the three new entries via the same `extras` parameter.

## Locked decisions (synthesis of briefing leans + Codex verdicts)

| # | Final shape |
|---|---|
| 1 | `Bun.spawn` + streaming logs to forensics paths + AbortController timeout + 1 MiB stream caps. **Argv-only spawn**, no shell, no command substitution, no env-prefix tricks. Returns `terminationReason: "exit" \| "timeout" \| "stdout-cap" \| "stderr-cap" \| "spawn-error"`. **Mutation pass requires `terminationReason: "exit"` strictly.** |
| 2 | Attempt counter derived from max `build_completed.attempt` for same `(runId, taskId)`. Cross-check against `BUILD_REPORT.md.Task.Attempt`; gaps or duplicates → intervention. Do NOT count `build_started`, `build_failed`, or `verify_build_ref_mismatch`. |
| 3 | **Mutation applicability uses VERIFY.md:96 pinned rule** (added test path in changed-file manifest matching `phases.verify.testGlob`). No `Asserts:` flag in PLAN — deferred. Skipped cases logged in `Mutation.Notes`. |
| 4 | PLAN `Files:` bullet extended with **inline change kind**: `path (modified \| added \| deleted)`. Old entries default to `modified` with deprecation warning. BUILD preflight enforces: `added` means absent at base, `modified`/`deleted` mean present at base; drift fails as `plan_change_kind_drift`. |
| 5 | Persona authors `Failure summary` + `Constraint`. Validate grammar facts only (single-line, length cap, no control chars, no command substitution); **do not implement imperative-voice validator** (brittle, language-sensitive). Use prompt examples + one repair pass to steer wording. |
| 6 | 4-attempt cap covers **VERIFY-failed clean BUILD attempts only**. Typed `VerifiedFailedAttempt` input gates restart-policy entry. BUILD-protocol failure, runner spawn failure before evidence, BUILD-ref mismatch → straight to intervention, bypass cap. |
| 7 | **Cleanup-on-VERIFY-pass is gate-driven**, not event-driven. `code-oz approve verify` validates VERIFY.md + Scientist sidecars → removes worktree → emits `worktree_destroyed` → writes `GATE_VERIFY_PASSED.json`. Removal failure blocks gate write, emits intervention. |
| 8 | Forensics-first ordering: write logs → write canonical VERIFY.md → write forensics bundle → emit `worktree_forensics_preserved` → emit `verify_failed` → remove worktree → emit `worktree_destroyed` → emit `verify_restart_initiated` (or intervention for cap). A crash before `verify_failed` leaves no durable restart signal without evidence. |
| 9 | **2 total VERIFY drafts** (initial + 1 repair), not 2 repairs after first. Schema violation on draft 2 → `verify_validation_failed` + intervention. Not config-driven in M8. |
| 10 | **Orchestrator owns binary `Verdict.Verdict`** (computed from Evidence + Mutation.Status). Persona owns `Verdict.Rationale`, `Mutation.Notes`, `Failure summary`, `Constraint`. Removes the persona's fake-green path. |
| 11 | **Source-only mutation revert.** Start from post-patch worktree, restore non-test changed paths to base, replay validation command. Mutation pass requires `terminationReason: "exit"` AND non-expected exit code. Test files stay at post-patch; reverting them would conflate "missing file" with "test caught the change". |
| 12 | **Verifier persona ~3.5-4.5k**, with `verify-system.md` carrying schema excerpts. One pass example + one fail example. Long grammar lives in parser tests and contract files, not in prose. |
| 13 | Extend `greenfield-baby-name` fixture with second task. **FakeProvider keyed explicitly by `(phase, taskId, attempt)`** — no hidden mutable state. Each e2e test creates a fresh provider instance. Restart e2e asserts attempt 1 forensics, worktree destruction, attempt 2 fresh worktree, `Failure carry-forward` propagation, event ordering. |

Additional locked items from Codex's risk surface:

- **Mutation applicability requires `Expected exit code: 0`.** Otherwise `Mutation.Status: not-applicable` with `Notes` rationale. The contract example assumes "new tests fail" means non-zero on reverted code (VERIFY.md:98).
- **Scrubbed env on runner spawn.** Whitelist of safe env vars only (no inherited secrets). cwd pinned to worktree absolute path. `network: 'none'` is contract; OS-level isolation is W4.
- **`failureCarryForward` propagation closes M7 debt.** `src/phases/build.ts:462` currently serializes null; M8 commit 7 wires the actual propagation.

## Commit sequence (Codex's reordering)

```
M8 commit 0:  docs(design): M8 synthesis + ROADMAP update + Codex briefing/response (this commit)
M8 commit 1:  feat(plan): change-kind annotation in PLAN task Files bullet
              docs/contracts/PLAN.md grammar extension (inline `path (modified|added|deleted)`)
              src/artifacts/plan.ts parser update + atomic write
              tests/plan-grammar-change-kind.test.ts
              Existing fixture PLAN.md files updated with explicit change kinds
M8 commit 2:  feat(agents): tool_use.execute schema + load validation + no-shell command grammar
              src/agents/schema.ts adds tool_use.execute
              src/agents/load.ts validates: one tool, one root, bounded timeouts/caps,
                argv-only command grammar (rejects shell operators / redirects / env-prefix /
                command substitution / absolute executable paths)
              tests/agent-load-tool-use-execute.test.ts
M8 commit 3:  feat(state): verify_* event types + validators
              src/state/schemas.ts adds 4 verify_* events
              src/state/events.ts validators
              tests/state-events-verify.test.ts
M8 commit 4:  feat(tools): test-runner with streaming, caps, timeout, env scrub, terminationReason
              src/tools/test-runner.ts (Bun.spawn + streaming + AbortController + scrubbed env)
              tests/test-runner-{spawn,timeout,truncation,exit-code,abnormal-termination,
                env-scrub,no-shell-grammar}.test.ts
M8 commit 5:  feat(artifacts): verify-report parser + serializer (orchestrator-owned binary Verdict)
              src/artifacts/verify-report.ts
              tests/verify-report-{parse,serialize,grammar,build-ref,failure-constraint,
                verdict-authority}.test.ts
M8 commit 6:  feat(phases): mutation gate (source-only revert, abnormal-termination semantics)
              src/phases/verify-mutation.ts
              tests/verify-mutation-{revert,replay,applicable,not-applicable,fail-tautology,
                abnormal-termination}.test.ts
M8 commit 7:  feat(phases): restart-policy + BUILD failureCarryForward propagation (M7 debt)
              src/phases/restart-policy.ts (typed VerifiedFailedAttempt; cap-counter via
                events.jsonl reduction; cross-check vs BUILD_REPORT.md; NEEDS_INTERVENTION at 5)
              src/phases/build.ts wires failureCarryForward propagation (closes
                build.ts:462 null serialization)
              phases.build.maxAttempts in src/config/schema.ts (default 4)
              tests/restart-policy-{cap-counter,carry-forward,intervention,events,
                verified-only}.test.ts
              tests/build-failure-carry-forward-restart.test.ts
M8 commit 8:  feat(worktree): forensics extras + event ordering tests
              src/worktree/forensics.ts wires three M8 extras (frozen VERIFY.md,
                frozen attempt-<N>.patch, build-prompt-snapshot)
              tests/forensics-extras-{verify,patch,prompt}.test.ts
              tests/event-ordering-verify-fail.test.ts
M8 commit 9:  feat(agents): verifier persona + verify-system template + composer
              src/agents/defaults/verifier.md (3.5-4.5k; replaces M2 stub)
              src/prompts/verify-system.md (universal-rules import + schema excerpts +
                1 pass example + 1 fail example)
M8 commit 10: feat(spine): VERIFY orchestrator + cleanup-on-approval + e2e
              src/phases/verify.ts (orchestrator: BUILD ref bind → command execute →
                evidence record → mutation gate → persona invoke → repair → finalize →
                forensics-on-fail; **no event-driven cleanup**)
              src/commands/approve.ts extension: approve verify → validate VERIFY.md +
                Scientist sidecars → remove worktree → emit worktree_destroyed →
                write GATE_VERIFY_PASSED.json (failure blocks gate write)
              VERIFY's Scientist phase-tail
              tests/verify-phase-{pass,fail,mutation-fail,scientist-tail}.test.ts
              tests/e2e/verify-lite-greenfield-pass.test.ts
              tests/e2e/verify-lite-greenfield-restart.test.ts
M8 commit 11: docs(design): Codex M8 implementation review (CLAUDE.md rule 8)
M8 commit 12+: any fix-first commits Codex review surfaces
```

Tag `v0.8.0-alpha.0` after Codex review verdict = `push`.

## Acceptance criteria for the session

- VERIFY runs validation command via `Bun.spawn` (no shell, scrubbed env, cwd pinned, argv-only); emits `VERIFY.md` with the six required H2 sections per VERIFY.md schema.
- Failed VERIFY does NOT enter a soft patch loop. Worktree destroyed as active candidate after `worktree_destroyed` event; forensics preserved with all nine entries (M7's six + M8's three); attempt N+1 starts clean from same approved PLAN with failure constraint surfaced into the BUILD prompt.
- Hard cap of 4 clean BUILD attempts (counted by completed BUILD reports cross-checked against `BUILD_REPORT.md.Task.Attempt`). BUILD-protocol failures, runner spawn failures, and BUILD-ref mismatches bypass the cap → straight to intervention. Attempt 5 lands in `NEEDS_INTERVENTION.json` per CLAUDE.md rule 11.
- Mutation gate rejects tautological tests for new-behavior tasks. Source-only revert (test files preserved at post-patch). Applicability requires `Expected exit code: 0` AND added test in changed-file manifest matching `phases.verify.testGlob`. Mutation pass requires `terminationReason: "exit"` AND non-expected exit.
- Cleanup-on-VERIFY-pass fires inside `code-oz approve verify`, not on `verify_completed` event. Removal failure blocks gate write and emits intervention.
- VERIFY-lite e2e with FakeProvider: success path (DEFINE → PLAN → BUILD → VERIFY for `T-001`, all pass) and failure-then-retry path (`T-002` with attempt-1 fail → forensics preserved → worktree destroyed → attempt-2 fresh worktree → pass). FakeProvider keyed by `(phase, taskId, attempt)` with no hidden state.
- All M7 tests still pass (1005 carried). Net new tests: ~70-90 across the M8 suite.
- Codex implementation review (rule 8) returns `push` after any fix-first commits land.
- Tag: `v0.8.0-alpha.0`.

## Don't-do list (anti-scope-creep)

- **No cross-family REVIEW.** That's M9's authority boundary. VERIFY persona stays Claude-family in v0.1.
- **No Debate runtime.** `requestDebate()` is M10. The process contract was M7 commit 2.
- **No retry framework for flaky tests.** Record `durationMs`, `terminationReason`, replay exit code in `Mutation.Notes` for forensic visibility, but don't auto-retry.
- **No real OS-level sandboxing.** `bash: deny` + scrubbed env + no shell + no network are contract-level safeguards. W4 containerization is the hostile-code defense.
- **No `Asserts:` flag in PLAN.** Codex deferred it. Mutation applicability uses the conservative manifest-driven rule from VERIFY.md:96.
- **No persona-authored binary `Verdict.Verdict`.** Orchestrator computes it. Persona authors only the rationale narrative.
- **No event-driven cleanup.** WORKTREE.md:86 says gate-driven. The pinned contract already settled this.
- **No subprocess pool optimization.** Defer to W3.
- **No buffered stream capture.** Streaming-append to forensics paths during execution is load-bearing for crash-resilient forensics.
- **No PLAN.md grammar deprecation enforcement in M8.** Backward-compat default `change: modified` ships; deprecation warning fires; hard-fail on absent annotation lands in W2 after fixtures migrate.
- **No push to GitHub.** Local commits only (CLAUDE.md "Working in this repo" rule 5).
- **No version tag mid-milestone.** Tag `v0.8.0-alpha.0` only after Codex review verdict = `push`.

## Codex review at end (CLAUDE.md rule 8)

Before tagging:

1. Bundle the diff: `git diff main..HEAD` plus the 10-commit message log + the `feat/m8-verify-lite` HEAD sha.
2. Write `docs/design/CODEX_BRIEFING_M8_REVIEW.md` (or invoke directly with the diff bundle) — this is the implementation-review pass, not a thesis pass.
3. Invoke `mcp__plugin_agent-codex_codex-native__codex` with `gpt-5.5` xhigh, `sandbox: read-only`. Capture response as `docs/design/CODEX_REVIEW_M8.md`.
4. Codex returns one of: `push` / `fix-first` / `debate-required`. Per the no-tech-debt-at-milestone-close memory: close ALL findings (including block-next-milestone) before tagging; only nits/fyis can defer.
5. Tag `v0.8.0-alpha.0` after the review verdict is `push`.

## Resume notes

If this session crashes mid-implementation:

- Each commit is atomic. Resume by reading `git log --oneline -20` to see how far M8 progressed, then continue from the next commit in the sequence above.
- The 13 locked decisions are the spec. If a commit feels under-specified, re-read `CODEX_RESPONSE_M8.md` for Codex's exact alternative — the modifications are concrete enough to land without further round-trips.
- The Codex debate trail (`CODEX_BRIEFING_M8.md` + `CODEX_RESPONSE_M8.md`) is immutable history. Do NOT re-run the debate. Codex's M8 implementation review fires only after all 10 commits land.
- If a contract section feels wrong mid-implementation, pause and ask Ozzy rather than amending the contract — VERIFY.md / BUILD.md / WORKTREE.md were pinned pre-M7 and cost real days. Mid-milestone contract amendment is an explicit decision, not a side-effect.

## After this session

The next session is **M9 — REVIEW-lite with cross-family handoff**:

- Branch `feat/m9-review-lite` from `main`.
- One new authority boundary: cross-family REVIEW authority (CLAUDE.md rule 20).
- Codex briefing per rule 7. Codex implementation review per rule 8.
- Tag: `v0.9.0-alpha.0`.

The M9 kickoff doc gets written either at the end of M8 (if the user wants it teed up) or at the start of M9 itself.

## Three of us are building this

Cross-family debate produced this session's plan. Cross-family review will validate M8's implementation. The discipline is the product — never present "ready to proceed" without it.

End of M8 implementation kickoff.
