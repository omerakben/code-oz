# M16 C6 → C13 → R1 loop plan

**Locked:** 2026-05-09
**Branch:** `feat/m16-cli-completion` at `5a572a1` (C5)
**Target:** C13 + Codex R1 verdict `push`, then STOP for Ozzy's explicit push approval.
**Scope authority:** kickoff `docs/design/SESSION_M16_KICKOFF.md` lines 109-131. Do not relitigate. Single-axis per commit (rule 20).

## Snapshot

| Item | Value |
|---|---|
| Branch | `feat/m16-cli-completion` |
| HEAD | `5a572a1` (C5) |
| Origin tip | `e25f3d4` (v0.16.0-alpha.0) |
| Unpushed commits | 10 |
| Suite | 2875 pass / 0 fail / 1 skip |
| Typecheck | clean |
| Net delta target by C13 | ~2900+ tests |

## Roles

| Role | Identity | When to use |
|---|---|---|
| **Maestro** | This conversation (Opus 4.7, main context) | Always-on. Holds milestone state, drafts touch-maps, dispatches sub-agents, synthesizes verdicts, implements, commits. |
| **Codex pre-design** | `mcp__plugin_agent-codex_codex-native__codex` with `gpt-5.5` xhigh, `sandbox: read-only`, `cwd: <repo-root>` | Load-bearing commits only (C6/C7/C8/C9/C12). Independent design review BEFORE Maestro implements. Returns: `accept` / `accept-with-modifications` / `redesign`. Treat as data, not authority. |
| **Opus subagent** | `Agent` tool with `subagent_type: feature-dev:code-architect` or `general-purpose` | Optional. Use only if a touch-map needs deep parallel exploration that would burn main-context tokens (e.g., C12 multi-task fixture design). Default: Maestro does it inline. |
| **Codex R1** | Same Codex MCP, `agent-codex:codex-review` skill flow | After C13 lands. Verdict: `push` / `fix-first` / `debate-required`. Block-push and block-next-milestone severities get a fix commit (never amend) before push approval. |

## Per-commit cycle (template)

For commit `Cn` where `n ∈ {6, 7, 8, 9, 10, 11, 12, 13}`:

1. **Anchor.** Read kickoff line for Cn (file list + acceptance). Read prior commit's tail in `git show HEAD --stat` to verify branch state matches expectations.
2. **Touch-map.** Read every file slated for modification. Trace existing patterns (composeBuildPrompt at `src/phases/build.ts`, dispatchPlan at `src/commands/run.ts`, etc.) so the new dispatcher mirrors the existing shape.
3. **Pre-design dispatch (load-bearing only).** For C6/C7/C8/C9/C12 launch Codex pre-design via the agent-codex skill. Brief the agent: kickoff Cn row, the existing patterns Maestro identified, the proposed approach, list of risks the agent should pressure-test. Run in parallel with continued touch-map work where possible.
4. **Synthesize.** Pin Codex's load-bearing modifications. Drop nits / FYIs unless they save a future round-trip. Record the synthesized plan inline (no separate handoff doc per commit — kickoff is the handoff for C6-C13).
5. **Implement.** Test-first where reasonable. Mirror existing dispatcher shape exactly (dispatchPlan, runApprove preApprove*Hook). One axis only — no opportunistic refactors.
6. **Verify.** Run `bun test` (full suite). Run `bun run typecheck`. Both must be clean before commit.
7. **Commit.** Single-axis conventional commit. No emoji. No "Co-Authored-By" footer. Message format: `feat(scope): subject (M16 Cn)` or `feat(cli): subject (M16 Cn)`.
8. **Mark + advance.** TaskUpdate Cn → completed. If next commit is queued and tests are green, advance immediately. If context fatigue or blocker hit, write a short tail note and stop.

## C6 — dispatchBuild

**Load-bearing.** Codex pre-design required.

**Files (kickoff line 124):**
- Modify: `src/commands/run.ts` — add `dispatchBuild(opts)`; phase-resolve into BUILD path.
- New test: `tests/cli-dispatch-build.test.ts`.

**Acceptance:**
- Loads PLAN, resolves task via cursor (`src/state/task-cursor.ts` from C1), creates/reuses worktree via `loadOrCreateRunWorktree` (C4), loads bundled builder + scientist personas, calls `runBuild`, surfaces `BuildResult`.
- Per-test exit codes asserted (`EXIT_OK` / `EXIT_INTERVENTION` / `EXIT_USAGE` from C3).
- Refuses to advance if `.code-oz/state/runs/<runId>/NEEDS_INTERVENTION.json` exists (Q7 path correction in kickoff line 60).

**Pre-design brief Codex with:**
- The existing `dispatchPlan` shape — does dispatchBuild mirror it cleanly?
- Worktree wrapper (C4) idempotency: if worktree exists, do we reuse silently or surface a recorded reuse?
- Task cursor reading: walk PLAN.md tasks, find first without `task_completed`. Where does `--task T-NNN` override land?
- Production seams (C3) wiring: does dispatchBuild call `productionInvokePersona` or pass it as injected dependency?
- BUILD_REPORT.md sha (C5): is the BUILD_REPORT pre-existence check sane (resume-safe)?

## C7 — dispatchVerify

**Load-bearing.** Codex pre-design required.

**Files (kickoff line 125):**
- Modify: `src/commands/run.ts` — add `dispatchVerify`.
- New test: `tests/cli-dispatch-verify.test.ts`.

**Acceptance:**
- Reads `BUILD_REPORT.md` + prompt snapshot (C5), wires `productionRunner` (C3) + `productionRevertSeam` (C3), calls `runVerify`, handles `VerifyResult` (`completed` / `failed` / `intervention`), emits restart guidance on failed.
- Locks: acquires `verify.lock` via the wrapper installed in C4. TOCTOU contract: caller holds the phase lock, runVerify does not re-lock.

**Pre-design brief Codex with:**
- Restart-on-fail policy from M8: when VerifyResult is `failed`, dispatchVerify must record a `verify_restart_recommended` event AND emit operator guidance. Confirm.
- VERIFY reads prompt snapshot from `<worktreeRunDir>/build-attempt-<N>.prompt.txt` (C5 path), NOT state run dir. Confirm dispatcher passes the right path.
- Phase-lock contract: caller-holds-lock vs runVerify re-locks. Lock granularity is per-task or per-run?
- prompt-snapshot sha verification at dispatch time vs at preApproveBuildHook time — duplicated check or single source of truth?

## C8 — dispatchReview

**Load-bearing.** Largest single dispatcher — Codex pre-design required, expect 2-3 modifications.

**Files (kickoff line 126):**
- Modify: `src/commands/run.ts` — add `dispatchReview`.
- New test: `tests/cli-dispatch-review.test.ts`.

**Acceptance:**
- Resolves round via `resolveNextReviewRound(events, reviewMd?)` (kickoff line 51 — confirm this helper exists or create it).
- Panel vs single mode driven by config + capability gating (M11 + M14).
- Calls `runReview`, handles `ReviewResult` (`resolved` / `needs_revision` / `blocked` / `intervention`).
- Prints scheduler one-line summary if M15 auto-mode fires (kickoff Q5, line 54): `[scheduler] grey-zone fire → debate vs claude → corrective verdict ready (1 actionable added)`.

**Pre-design brief Codex with:**
- Round resolution: prior `REVIEW.md` taskId/attempt vs `review_round_completed` sha cross-check — confirm helper signature.
- Scheduler one-liner: where does the scheduler fire (inside runReview? before? after?) and how does dispatcher detect that to print the line?
- Panel mode: does dispatchReview decide panel-or-single, or does runReview own it? (M14 contract.)
- needs_revision flow: does dispatcher write the remediation decision, or does runReview? Where does `nextReviewRound` get persisted?

## C9 — Task-loop dispatch

**Load-bearing.** State-machine glue. Codex pre-design required.

**Files (kickoff line 127):**
- Modify: `src/commands/run.ts` — add `advanceAfterReviewApprove`.
- Modify: `src/state/task-cursor.ts` — extension for "advance to next task" projection.
- New test: `tests/cli-task-loop.test.ts`.

**Acceptance:**
- After `REVIEW.ready` + `approve review` for task N: cursor advances to task N+1 (emit `task_completed` for N + `task_started` for N+1).
- `code-oz run` then enters BUILD for task N+1 on next invocation.
- After last task's `task_completed`: cursor reports `completed: true`; state machine advances `currentPhase: ship` on next state-projection (consumed by M17).
- L2 lock holds: no autoadvance through phases or tasks without operator approval (kickoff line 103).

**Pre-design brief Codex with:**
- The `task_completed` event emission — at approve-review time or at task-cursor projection time? Race condition: if the operator approves review and the projection has not run, the task cursor lies.
- L2 invariant: every gate transition still requires `code-oz approve <phase>`. Does `advanceAfterReviewApprove` accidentally autoadvance, or is it gated by the next `code-oz run` invocation?
- "Last task" detection: how does the cursor know `plan.tasks.length` matches? PLAN.md re-read every time, or cached?

## C10 — `code-oz doctor run`

**Light. Skip pre-design.**

**Files (kickoff line 128):**
- New: `src/commands/doctor-run.ts`.
- Modify: `src/cli.ts` — route `doctor run`.
- New test: `tests/commands-doctor-run.test.ts`.

**Acceptance:**
- Read-only inspector. Prints active runId, currentPhase, task cursor, last 10 events, intervention state, worktree existence, scheduler events for current round.
- No state mutation. No file writes. No network.

## C11 — `--provider fake` warning banner

**Light. Skip pre-design.**

**Files (kickoff line 129):**
- Modify: `src/commands/run.ts` — banner + event emit.
- Modify: `src/cli/bootstrap.ts` — banner detection.
- New test: `tests/cli-fake-provider-warning.test.ts`.

**Acceptance:**
- Loud stderr banner on every dispatcher when `--provider fake` is active.
- `fake_provider_warning_emitted` event recorded in events.jsonl.
- Test asserts: banner stderr present + event emitted; absent → CI test fails.

## C12 — CLI e2e (binary spawn, multi-task PLAN)

**Load-bearing. Largest test in the milestone. Codex pre-design required.**

**Files (kickoff line 130):**
- New: `tests/e2e/cli-multi-task-cycle.test.ts`.
- New: test fixture for fake-script (covers DEFINE → PLAN multi-task → BUILD/VERIFY/REVIEW × 3 → ship).

**Acceptance:**
- Spawns `bun run src/cli.ts` (NOT direct imports of dispatchers, per L4 in kickoff line 107).
- Drives DEFINE → PLAN (multi-task) → BUILD/VERIFY/REVIEW × N tasks → `currentPhase: ship`.
- Asserts: every gate file lands, every `task_completed` event present, no double-invocation, no dangling lock files.

**Pre-design brief Codex with:**
- Fake-script JSONL design: one entry per persona invocation. How does the script differentiate task N's builder from task N+1's builder? (Matcher field — phase + agent + taskId? or order-only?)
- Spawn vs in-process: is `Bun.spawn` for the CLI harness reliable enough for e2e timing, or do we hit subprocess flakiness? Fallback strategy.
- Lock cleanup: after the test, does the worktree dir need explicit cleanup, or does temp-dir teardown handle it?
- Ship-precondition assertion: how does the test know "currentPhase=ship" is correct? Reads state file vs. asserts via `code-oz doctor run`?

## C13 — Docs + ROADMAP + kickoff lock

**Light. Skip pre-design. LAST commit.**

**Files (kickoff line 131):**
- Modify: `docs/design/ROADMAP.md` — M16 entry closed.
- Modify: `src/cli.ts` — `--help` text no longer says "M7 adds BUILD onward."
- Modify: `docs/design/SESSION_M16_KICKOFF.md` — closure annotation.
- Optional: `package.json` if tagging happens here vs after R1.

**Acceptance:**
- All tests pass.
- ROADMAP closes M16 row with commit shas + final test count.
- `--help` reflects the M16 dispatch surface.
- Kickoff doc has a "## Closure" section with completion date + R1 verdict pointer.

**Tag policy:** do NOT bump version or tag in C13. Tag (`v0.17.0-alpha.0`) happens AFTER R1 verdict push + Ozzy's push approval, in a separate operation.

## R1 protocol (after C13)

1. **Run the verification gate** (kickoff line 133-143):
   - `bun test` — clean ~2900+
   - `bun run typecheck` — clean
   - `bun run smoke` — passes against rebuilt binary (`bun run build:binary` first if not already done)
   - `code-oz doctor run` — reports clean state on a sample run
2. **Compose the R1 brief.** New file `docs/research/CODEX_REVIEW_M16.md` (round 1 section). Include: branch tip, commits ahead of main, test counts, the C6-C13 acceptance status, the resume scenario the dogfood would walk through.
3. **Dispatch Codex R1** via `agent-codex:codex-review` skill flow (or `mcp__plugin_agent-codex_codex-native__codex` with the review prompt).
4. **Synthesize the verdict:**
   - `push` → STOP. Report to Ozzy: branch ready, R1 clean, request push approval.
   - `fix-first` → record findings, fix them in follow-up commits (one commit per finding class; never amend), re-run R2 until `push`.
   - `debate-required` → write a debate brief, run a Codex debate round, synthesize, then proceed.
5. **Never push without explicit Ozzy approval.** PE-1's autonomy grant was scoped to PE-1 only.

## Stop conditions

| Condition | Action |
|---|---|
| C13 lands + R1 = push | STOP. Report to Ozzy. Await push approval. |
| Codex R1 = fix-first | Continue: write fix commits, run R2, R3 ... up to round 4 cap (rule 6 in CLAUDE.md). |
| Codex R1 = debate-required | STOP at the debate boundary. Write debate brief. Run debate. Synthesize. Resume only if synthesis converges. |
| Test failure mid-loop | STOP at that commit. Fix in place. Do not advance until tests are clean. |
| Block-push severity finding | STOP at the next commit boundary. Fix as a follow-up commit. |
| Context fatigue (token usage > 80%) | STOP at next commit boundary. Write a tail note in this doc + memory. Hand off to a fresh-context session. |
| Unrelated user message | Pause and respond. Resume only on user signal. |

## Resume protocol (if context dies)

A fresh-context session reading this doc cold should:
1. Read `git log feat/m16-cli-completion ^main --oneline` to find the next pending commit.
2. Locate that commit's row in this doc.
3. Read the kickoff line for that commit.
4. Pick up the per-commit cycle from step 1 (anchor).
5. The TaskList (this session) holds per-commit progress; if the new session can't read it, fall back to git log + this doc.

## Logging discipline

- No new commit-by-commit handoff docs. The kickoff is the contract for C6-C13.
- Memory updates only at C13 completion + R1 verdict (per "no tech debt at milestone close" + "M16 in flight" memory entry).
- Codex round artifacts land at `docs/research/CODEX_REVIEW_M16.md` (R1 section) + per-round blocks within.
- Pre-design Codex calls for C6/C7/C8/C9/C12 are logged inline in the dispatch (no separate per-commit briefing doc — the kickoff has the spec).
