# M16 C3 handoff — Production seams + exit code contract

**Read this cold; act on it.** This is a fresh-context handoff. The branch is hot and waiting.

## Snapshot

| Item | Value |
|---|---|
| Branch | `feat/m16-cli-completion` |
| HEAD | `e81e9ec` (the C2 follow-on) |
| Origin tip | `e25f3d4` (M16 base; v0.16.0-alpha.0 just shipped on main) |
| Suite | **2793 pass / 0 fail / 1 skip** (live xAI gated) |
| Typecheck | clean |
| Codex R0 verdict | `feature-with-modifications`, all 9 risks accepted (`docs/research/CODEX_RESPONSE_M16.md`, thread `019e0a59`) |

```
e81e9ec fix(providers/fake-script): validate chunks/toolCalls + deep-freeze (M16 C2 follow-on)
37910db feat(providers,cli): cross-process fake-replay fixture (M16 C2)
1f05673 feat(state): per-task lifecycle cursor events + projection helper (M16 C1)
971988d docs(design/m16): synthesis kickoff lock — Codex R0 fully accepted
a1d0af0 docs(research/m16): Codex R0 verdict feature-with-modifications
11f8195 docs(research/m16): planning briefing for production CLI completion
e25f3d4 ← origin/main (v0.16.0-alpha.0)
```

## Why M16 exists

Ring 2 dogfood on `~/Projects/code-oz-dogfood` halted at BUILD. `code-oz run` only dispatches DEFINE+PLAN; the M7-M15 runtime is fully tested but the CLI front-door for BUILD/VERIFY/REVIEW/SHIP/resume was never wired. Codex R0 caught a structural blind spot the lean missed: **no task lifecycle cursor.** PLAN.md supports multiple `T-NNN` tasks but the state machine only knows phases — without a cursor, M16 would silently ship only the first task. M16/M17 split locked.

## What landed in M16 so far

**C1 (`1f05673`)** — Task lifecycle cursor + 3 new event types (`task_started`, `task_review_passed`, `task_completed`) + pure projection helper at `src/state/task-cursor.ts`. No runtime emit sites yet — those come in C5/C6/C8/C9. +40 tests.

**C2 (`37910db`) + follow-on (`e81e9ec`)** — Cross-process fake-replay fixture. New `--fake-script <path>` CLI flag gated by `--provider fake` AND `CODE_OZ_TEST_FAKE_SCRIPT_OK=1` env var. Loader at `src/providers/fake-script.ts`: `loadFakeScript(path)` reads JSONL, validates per-line (collects all issues, doesn't fail-fast), `applyFakeScript(fake, entries)` registers expectations. Wired into both `runCommand` (DEFINE path) and `dispatchPlan` (active-run path) so future dispatchers inherit transparently. +47 tests (42 original + 5 follow-on tightenings).

## What's next: C3 — Production seams + exit code contract

**Authority:** define the production-side seams that future dispatchers (C6/C7/C8) compose. C3 ships **infrastructure** — no phase dispatch happens here. Single axis per rule 20.

### Files to create

1. **`src/cli/production-seams.ts` (NEW)** — three exports:

   **`productionInvokePersona(invokeCtx, agent, opts?): (composedPrompt) => Promise<string>`**
   - Wraps `invokeAgent(invokeCtx, request)` and drains the AsyncIterable<ProviderEvent>.
   - Returns the final content text from `turn_completed` event (mirrors `collectProviderResponse` in `src/providers/fake.ts:259-272`).
   - Supports streaming progress: when `opts.onChunk` is set, forward `content_chunk` events as they arrive.
   - Used by C6/C7/C8 dispatchers as the production replacement for the test-fixture `invokePersona: async () => CANNED_TEXT` shim used in `tests/e2e/review-lite-greenfield-pass.test.ts`.
   - The agent's `provider` field resolves through the registry; the wrapper handles invocation, budget enforcement, intervention surfacing.

   **`productionRunner(): RunnerSeam`**
   - Implements the `RunnerSeam` contract from `src/phases/verify-mutation.ts:209`:
     ```ts
     type RunnerSeam = (input: MutationRunnerInput) => Promise<RunnerResultShape>
     ```
   - `MutationRunnerInput` (`verify-mutation.ts:199-207`): `command`, `cwd`, `timeoutMs`, `stdoutLogPath`, `stderrLogPath`, `maxStdoutBytes`, `maxStderrBytes`.
   - `RunnerResultShape` (`verify-mutation.ts:132-140`): `terminationReason: 'exit' | 'timeout' | 'stdout-cap' | 'stderr-cap' | 'spawn-error'`, `exitCode`, `durationMs`, optional truncation flags + byte counts.
   - Implementation: `Bun.spawn(command, { cwd, timeout: timeoutMs })`. Pipe stdout/stderr to log paths AND track byte counts; truncate at the caps. Map exit modes to `terminationReason`. Handle spawn errors as `'spawn-error'` with `exitCode: null`.
   - **Critical**: `terminationReason: 'exit'` AND `exitCode === null` is anomalous (already handled at `verify-mutation.ts:177`). Production runner should never emit that combo — emit `'spawn-error'` instead.

   **`productionRevertSeam(worktreeRoot): RevertSeam`**
   - Implements the `RevertSeam` contract from `src/phases/verify-mutation.ts:218-230`:
     - `snapshot(paths) → Promise<unknown>` — save current contents.
     - `revert(files, baseCommitSha) → Promise<void>` — make paths look like baseCommitSha (added → delete, modified → restore, deleted → recreate from base).
     - `restore(snapshot) → Promise<void>` — roll back to snapshot.
   - Implementation: git-stash-based or fs-snapshot-based inside the run worktree. The simplest pattern: snapshot reads file contents into memory; revert uses `git checkout <baseCommitSha> -- <path>` for modified, `fs.unlink` for added, `git checkout <baseCommitSha> -- <path>` for deleted; restore writes contents back.
   - **Constraint**: must operate INSIDE the worktree only. No top-level repo touches.

2. **`src/cli/exit-codes.ts` (NEW)** — Lock the CLI exit code contract Codex R0 Risk #8 demanded:
   ```ts
   export const EXIT_OK = 0           // phase complete; awaiting approve
   export const EXIT_INTERVENTION = 1 // intervention/blocked/needs-revision
   export const EXIT_USAGE = 2        // CLI usage / config errors
   ```
   - Plus a tiny mapping helper if helpful: `exitCodeForPhaseResult(result)` so C6/C7/C8 don't re-derive.
   - The semantic distinction Codex flagged: `needs_revision` is an EXPECTED REVIEW result but should NOT look like a successful gate-ready phase. Map to `EXIT_INTERVENTION` (1), not 0.

3. **`tests/cli-production-seams.test.ts` (NEW)** — unit tests for all three seams.
   - `productionInvokePersona`: drains FakeProvider stream into final text; `onChunk` callback fires per chunk; surfaces ProviderError as exception (matches existing `invokeAgent` contract).
   - `productionRunner`: against a mock `Bun.spawn` (use the test-runner mock pattern from existing tests like `tests/cli-bootstrap-company.test.ts` if there's one, else inject via a `spawn` parameter for testability). Cover exit, timeout, stdout-cap, stderr-cap, spawn-error.
   - `productionRevertSeam`: against a temp git repo. Cover modified/added/deleted file revert. Snapshot+restore round-trip.

4. **`tests/cli-exit-codes.test.ts` (NEW)** — exhaustively cover the three constants + the mapping helper. Small file.

### Acceptance per kickoff

Per `docs/design/SESSION_M16_KICKOFF.md` Commit Sequence row C3:

> `productionInvokePersona` drains invokeAgent stream; `productionRunner` spawns validation command with timeout/truncation/log paths; `productionRevertSeam` git-stash semantics; exit codes 0/1/2 enumerated.

After C3:
- `bun test` — 2793 → ~2820+ pass (estimate +25 from production-seam tests + a few from exit-codes)
- `bun run typecheck` — clean
- No phase dispatch yet. C6/C7/C8 consume these seams.

## Architectural context (do not re-derive)

### How phase functions consume seams today

The runtime functions (`runBuild`, `runVerify`, `runReview`) take seams as options. The M9 e2e test (`tests/e2e/review-lite-greenfield-pass.test.ts:445-457`) hand-builds them for tests:

```ts
const noopRunner: RunnerSeam = async () => ({
  terminationReason: 'exit', exitCode: 0, durationMs: 1,
  truncated: { stdout: false, stderr: false },
})
const noopRevertSeam: RevertSeam = {
  async snapshot() { return null },
  async revert() { /* no-op */ },
  async restore() { /* no-op */ },
}
```

These are TEST seams. Production seams are what C3 ships.

### invokeAgent contract for `productionInvokePersona`

`src/providers/invoke.ts` exports `invokeAgent(ctx, request): AsyncIterable<ProviderEvent>`. ProviderEvent variants include `content_chunk` (streaming text), `turn_completed` (final response), and others. The drain pattern (already in `collectProviderResponse` at `src/providers/fake.ts:259`):

```ts
let response: ProviderResponse | null = null
for await (const ev of stream) {
  if (ev.type === 'content_chunk' && opts?.onChunk) opts.onChunk(ev.text)
  if (ev.type === 'turn_completed') response = ev.response
}
if (response === null) throw new Error('stream ended without turn_completed')
return response.content
```

That's the spine of `productionInvokePersona`. The onChunk callback is for the streaming-progress ask Codex flagged in R0 — basic progress lines are NOT deferred (per kickoff Q13).

### Streaming output policy (R0 Q5)

Codex Q5 said scheduler-summary tables aren't load-bearing for M16; full traces live in `code-oz doctor run` (C10). For `productionInvokePersona`, basic progress lines ARE expected so users see something during a 60-second claude invocation. Keep it minimal: one line per chunk arrival, OR a single dot per chunk, OR just the agent name + turn number. Avoid fancy TTY tricks — non-TTY environments should produce sane text.

### Risk 7 closure (validation runner contract)

Codex R0 Risk 7: "RunnerSeam timeout/output contract undefined."

`productionRunner` MUST define and respect:
- **timeout killing**: `Bun.spawn` accepts `timeout: <ms>`. On timeout, returns `terminationReason: 'timeout'`.
- **stdout/stderr truncation**: when bytes exceed cap, emit `'stdout-cap'` / `'stderr-cap'` and stop reading.
- **log paths**: write to `stdoutLogPath` / `stderrLogPath` from the input. These are forensics artifacts — they survive resume.
- **wall time vs run-level budget**: Codex flagged this. Keep simple in C3: `productionRunner` does NOT consult `budgets.global.maxWallTimeMinutes`. Validation wall-time is a per-attempt concern; the run-level cap is the orchestrator's. Add a comment to that effect; M17 or W2 can extend if needed.

## Locked decisions (from `SESSION_M16_KICKOFF.md`, do not relitigate)

1. **L1** — Phase machine stays unchanged. Multi-task semantics live in event projection (C1).
2. **L2** — No autoadvance through phases. Every gate transition requires explicit `code-oz approve <phase>`.
3. **L3** — Production seams are a separate module (`src/cli/production-seams.ts`), not inlined in `run.ts`. **C3 is exactly that module.**
4. **L4** — CLI e2e test (C12) runs binary via `Bun.spawn`, not direct imports. C12 will use the C2 fake-script fixture; C3 sets up the seams it composes.
5. **L5** — Single-axis commits. C3 ships seams + exit codes; **does not ship any phase dispatcher**. Resist scope creep.
6. **L6** — No new permission scopes, no new gates, no new agent personas in M16.

## What's deferred to M17 (do not touch in M16)

- `src/phases/ship.ts` (`runShip`) — SHIP is a new authority, M17.
- `code-oz resume` command.
- `code-oz intervention resolve <code>` command.
- AUDIT runtime (M18+).
- TUI inspector (W2.2).
- npm publish + Homebrew (W3 distribution).
- Validation runner consulting `budgets.global.maxWallTimeMinutes` — M17/W2.

## Cross-model peer review discipline

Per CLAUDE.md, after **C13 lands** (the last M16 commit), run a Codex R1 implementation review against the post-implementation SHA. Iterate to push verdict before tagging `v0.17.0-alpha.0`. The R0 verdict + risks are already captured in `docs/research/CODEX_RESPONSE_M16.md`; R1 will verify closure.

**Background C1 review status:** A Codex background agent was dispatched to review C1 (`1f05673`). It reported task completion but no `docs/research/CODEX_REVIEW_M16_C1.md` file landed on disk. Either Codex is still running async OR the agent finished without saving. **Recommendation for next session:** check `docs/research/CODEX_REVIEW_M16_C1.md` early; if absent, either re-dispatch in foreground OR treat C1 as locked-by-internal-verification and continue to R1 at C13.

## Open threads observed during C2 verification

**Flag-value parser UX nit (pre-existing, not C2-specific):** `--fake-script --request go` greedily consumes `--request` as the path then errors on `go` as unknown. Same shape exists for `--request` already. Worth a follow-up "flag-value safety" pass — would tighten parser UX across all value-taking flags. Not a C3 concern; file as M17 / W2.2 candidate or note as a small chore between commits.

## Pacing rule

- One single-axis slice per commit (rule 20).
- After each commit: `bun test` + `bun run typecheck` clean before moving to the next.
- Commit messages follow conventional format. No "update memory" in subject lines. No emojis.
- Branch stays `feat/m16-cli-completion`; no merge to main until R1 says push.
- The Ring 2 dogfood project (`~/Projects/code-oz-dogfood/`, currently halted at BUILD) is the canonical real-world test target — M16 verification gate requires `code-oz run` from there to reach `currentPhase: ship` with `task_completed` events for T-001/T-002/T-003.

## Quick references

- Kickoff: `docs/design/SESSION_M16_KICKOFF.md` (the 13-commit sequence)
- R0 briefing: `docs/research/CODEX_BRIEFING_M16.md`
- R0 verdict: `docs/research/CODEX_RESPONSE_M16.md` (thread `019e0a59`)
- Phase function options: `src/phases/build.ts:72-115` (RunBuildOptions), `src/phases/verify.ts:82-112` (RunVerifyOptions), `src/phases/review.ts:162-210` (RunReviewOptions)
- Seam contracts: `src/phases/verify-mutation.ts:132-230` (RunnerSeam, RevertSeam, RunnerResultShape)
- Existing test seam patterns: `tests/e2e/review-lite-greenfield-pass.test.ts:445-457` (noopRunner, noopRevertSeam)
- Drain stream pattern: `src/providers/fake.ts:259-272` (collectProviderResponse)

## When you're ready to start

```
git status                      # confirm branch is clean at e81e9ec
bun test                        # baseline 2793 / 0 / 1
bun run typecheck               # clean
ls -la docs/research/CODEX_REVIEW_M16_C1.md 2>/dev/null  # background review check
```

Then create `src/cli/production-seams.ts` and `src/cli/exit-codes.ts` and start. C3 should land in one focused commit (~250-400 LOC source + ~200 LOC tests). The handoff is authoritative; the kickoff is canonical for the milestone.
