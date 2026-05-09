# M16 C5 handoff — BUILD prompt persistence + preApproveBuildHook

**Read this cold; act on it.** Self-contained handoff for a fresh-context session. Branch is hot at `2ebab81`.

## Snapshot

| Item | Value |
|---|---|
| Branch | `feat/m16-cli-completion` |
| HEAD | `2ebab81` (M16 C4) |
| Origin tip | `e25f3d4` (v0.16.0-alpha.0) |
| Unpushed commits | 9 |
| Suite | **2856 pass / 0 fail / 1 skip** (live xAI gated) |
| Typecheck | clean |
| Codex R0 verdict | `feature-with-modifications`, all 9 risks accepted (`docs/research/CODEX_RESPONSE_M16.md`, thread `019e0a59`) |

```
2ebab81 feat(worktree,phases): idempotent worktree wrapper + build/verify locks (M16 C4)
a88b86a feat(cli): production seams + exit code contract (M16 C3)
8b6aa95 docs(design/m16): C3 handoff for fresh-context session
e81e9ec fix(providers/fake-script): validate chunks/toolCalls + deep-freeze (M16 C2 follow-on)
37910db feat(providers,cli): cross-process fake-replay fixture (M16 C2)
1f05673 feat(state): per-task lifecycle cursor events + projection helper (M16 C1)
971988d docs(design/m16): synthesis kickoff lock — Codex R0 fully accepted
a1d0af0 docs(research/m16): Codex R0 verdict feature-with-modifications
11f8195 docs(research/m16): planning briefing for production CLI completion
e25f3d4 ← origin/main (v0.16.0-alpha.0)
```

## What's landed in M16 so far

- **C1** `1f05673` — Task lifecycle cursor + 3 new event types (`task_started`/`task_review_passed`/`task_completed`) + `src/state/task-cursor.ts`. +40 tests.
- **C2** `37910db` + `e81e9ec` follow-on — Cross-process fake-replay fixture. `--fake-script <path>` gated by `--provider fake` AND `CODE_OZ_TEST_FAKE_SCRIPT_OK=1`. `src/providers/fake-script.ts`. +47 tests.
- **C3** `a88b86a` — Production seams (`productionInvokePersona`, `productionRunner` over `runValidationCommand`, `productionRevertSeam`) + exit code contract (`EXIT_OK`/`EXIT_INTERVENTION`/`EXIT_USAGE`; closes R0 Risk #8). +45 tests.
- **C4** `2ebab81` — Idempotent `loadOrCreateRunWorktree` (four-case wrapper: fresh / idempotent / event-missing / partial-state) + outer `withLock` over `runBuild`/`runVerify` at `<runDir>/.build.lock` + `<runDir>/.verify.lock`. Cross-model peer review caught three load-bearing modifications at single-commit granularity (separate lock dir from `runPaths.lockDir`; caller-holds-phase-lock TOCTOU contract; specific failure detail in partial-state messages). +18 tests.

## What's next: C5 — BUILD prompt persistence + preApproveBuildHook

**Authority:** make the BUILD prompt durable so VERIFY forensics survive resume, and lock the BUILD-approve gate validation. Closes R4 (BUILD prompt snapshot not durable per kickoff line 92) and pre-stages the `preApproveBuildHook` that C8 will use. **Single axis per rule 20: ships infrastructure; no phase dispatch.**

### Files to modify / create

1. **`src/phases/build.ts` (modify)** — write the composed prompt to disk atomically AFTER composition + BEFORE persona invocation; record sha256 on `build_completed` event.

   Touch points:
   - `composeBuildPrompt` call at `src/phases/build.ts:419-423` produces `composedPrompt: string`. Right after that line (before the `invokePersona(composedPrompt)` call at line 427), atomically write the prompt to disk. Record the sha256 in a local variable for the eventual `build_completed` emission.
   - `build_completed` event emission near `src/phases/build.ts:687-689` (`type: 'build_completed'`). Add the new `promptSnapshotSha256` field there (and update the `build_completed` schema in `src/state/schemas.ts:684-696` and the validator in `src/state/events.ts:713`).
   - Path convention (locked by R0 Q3, kickoff line 48): `.code-oz/runs/<runId>/build-attempt-<N>.prompt.txt`. That is the **worktree** run dir (`runPaths` from `src/worktree/paths.ts`), not the state run dir. The wrapper at C4 already gives you a `WorktreePaths` via `loadOrCreateRunWorktree`'s `paths` field, but `runBuild` does not currently consume it that way — `runBuild` receives `opts.worktree` (`BuildWorktreeBinding` at `src/phases/build.ts:127`) which has `worktreePath` (the git worktree subdir, NOT the run dir). You will need to either: (a) extend `WorktreePaths` with a `buildPromptSnapshot(attempt)` helper in `src/worktree/paths.ts` analogous to `patchFilePath` at line 64, or (b) compute the path inline. Prefer (a) — it locks the convention in one place.
   - Atomic write: `atomicWriteFile(promptPath, composedPrompt)` from `src/artifacts/atomic-write.ts:36`. Used by build.ts already at line 613 for BUILD_REPORT.md.
   - Sha computation: `createHash('sha256').update(composedPrompt, 'utf8').digest('hex')` (mirrors how `buildReportSha256` is computed near line 689).

2. **`src/state/schemas.ts` (modify)** — add `promptSnapshotSha256` to the `build_completed` event variant at line 684-696. 64-char lower-case hex (`/^[0-9a-f]{64}$/`). Required (not optional) per Q3's "BUILD prompt snapshot is now persisted" lock — every `build_completed` event after C5 carries it.

3. **`src/state/events.ts` (modify)** — extend the `build_completed` validator at line 713-727 to require the new sha field with the same regex check as `buildReportSha256` (line 723).

4. **`src/commands/approve.ts` (modify)** — new export `preApproveBuildHook`. Place between `preApproveVerifyHook` (line 293-297) and `preApproveReviewHook` (line 365-375). The hook validates:
   1. **BUILD_REPORT.md exists** (atomic-written by `runBuild`).
   2. **`build_completed` event for the active task+attempt is present in events.jsonl.**
   3. **BUILD_REPORT.md sha matches `build_completed.buildReportSha256`** — post-edit detection. If the operator hand-edited BUILD_REPORT.md after BUILD wrote it, the sha differs and the hook refuses with `build_report_post_edit` intervention.
   4. **Prompt snapshot file exists** at `<worktreeRunDir>/build-attempt-<N>.prompt.txt` AND its sha matches `build_completed.promptSnapshotSha256`. Same post-edit detection logic.
   5. Mirror the throw shape used by `preApproveVerifyHook` (read it for the exact error / context surface). On any failure: `throw new Error(...)` so `runApprove` (line 227-243) propagates it as a usage error; the approve command surfaces the message.

   Add a call to `preApproveBuildHook` in `runApprove` at line 227-243 alongside the existing verify/review calls. The phase resolution logic upstream determines which hook fires.

5. **`tests/phases-build-prompt-snapshot.test.ts` (new)** — covers the runBuild side:
   - Happy path: `runBuild` writes the prompt to `<worktreeRunDir>/build-attempt-1.prompt.txt`; `build_completed` event carries a 64-hex `promptSnapshotSha256` matching the on-disk sha.
   - Multi-attempt: attempt 2 writes to `build-attempt-2.prompt.txt`; both files present; `build_completed` events for each carry distinct shas.
   - Atomic semantics: simulate write-failure (e.g., parent dir missing) — runBuild surfaces a build failure with a non-leaky error code.
   - sha256 stable across reads: write the file, compute the sha from disk, assert it matches `build_completed.promptSnapshotSha256`.
   - Schema validation: emit `build_completed` without `promptSnapshotSha256` and confirm `readEvents` fails with the new validator error.

6. **`tests/approve-build-hook.test.ts` (new)** — covers `preApproveBuildHook`:
   - Happy path: BUILD_REPORT.md + prompt snapshot present, both shas match `build_completed` event → hook succeeds (no throw).
   - BUILD_REPORT.md missing → throws.
   - `build_completed` event missing → throws.
   - BUILD_REPORT.md edited post-write (sha mismatch) → throws with a `build_report_post_edit` message.
   - Prompt snapshot file missing → throws.
   - Prompt snapshot edited post-write (sha mismatch) → throws with a `build_prompt_post_edit` message.
   - Multiple attempts in events.jsonl: hook validates against the LATEST `build_completed` for the active task (the one approve is gating).

### Acceptance per kickoff

Per `docs/design/SESSION_M16_KICKOFF.md` row C5:

> Prompt written atomically; sha256 recorded in `build_completed` event; preApproveBuildHook validates BUILD_REPORT.md + sha + post-edit detection.

After C5:
- `bun test` — 2856 → ~2880+ pass (estimate +25 from prompt-snapshot tests + hook tests).
- `bun run typecheck` — clean.
- No phase dispatch yet; C6 consumes the durable prompt + the new hook.

## Architectural context (do not re-derive)

### Why durable prompt: VERIFY forensics survive resume

Q3 closure (kickoff lines 47-48): VERIFY currently re-composes the prompt from agent body + plan task on every invocation. After C5, VERIFY reads the persisted prompt from disk, so a crashed-mid-VERIFY run can resume with the exact prompt the persona saw — including any non-determinism from the compose function (timestamps, hash inputs, etc.). The forensics bundle written on VERIFY-fail (`writeVerifyForensicsBundle` in `src/worktree/forensics.ts`) gets the prompt without re-running BUILD.

### Two-RunPaths gotcha (re-affirmed in C4)

`code-oz` has two parallel run trees — same `<runId>`, different roots:
- **State** `RunPaths` (`src/state/run.ts:77`, `runPathsFor()`): `.code-oz/state/runs/<runId>/`. Holds `events.jsonl`, gate files, `.lock` (per-run lock for events/gates), `.build.lock` / `.verify.lock` / `.review.lock` (orchestration locks added in C4). Also where NEEDS_INTERVENTION.json lives.
- **Worktree** `WorktreePaths` (`src/worktree/paths.ts:45`, `runPaths()`): `.code-oz/runs/<runId>/`. Holds `worktree/` (git worktree), `patches/`, `forensics/`, `build-drafts/`, `base.txt`, `README.md`. **The prompt snapshot lives here per Q3**: `.code-oz/runs/<runId>/build-attempt-<N>.prompt.txt`.

`runBuild` already has both: state-side via `opts.runPaths`, worktree-side via `opts.worktree.worktreePath`. Add a helper to `WorktreePaths` (`buildPromptSnapshot(attempt)`) so the path convention is in one place.

### Atomic write + sha pattern (existing precedent)

`atomicWriteFile` (write to `.tmp`, fsync, rename) is at `src/artifacts/atomic-write.ts:36`. `runBuild` already uses it for BUILD_REPORT.md at line 613:
```ts
await atomicWriteFile(reportPath, buildReportText)
const buildReportSha256 = createHash('sha256').update(buildReportText, 'utf8').digest('hex')
```

Mirror that pattern for the prompt. Same regex (`/^[0-9a-f]{64}$/`) for validator.

### preApproveVerifyHook is the precedent for preApproveBuildHook

Read `src/commands/approve.ts:293-340` (preApproveVerifyHook) carefully. It validates:
- VERIFY.md exists at canonical path
- VERIFY.md sha matches `verify_completed` event's `verifyReportSha256`
- Post-edit detection for VERIFY.md

Mirror the structure exactly. The shape is the load-bearing piece — operators rely on the same throw-on-violation semantics across phases.

### Build_completed event-schema migration

The schema change at `src/state/schemas.ts:684-696` and validator at `src/state/events.ts:713-727` is a **breaking** schema change (`promptSnapshotSha256` is required). Existing fixtures + tests that emit `build_completed` events without the new field will fail validator-driven tests. Audit `tests/build-phase.test.ts` and any other test that constructs a `build_completed` event manually — they need the new field. `grep -rn "type: 'build_completed'" tests/` to enumerate.

### Approve flow today

`runApprove` in `src/commands/approve.ts:86-243` resolves the active phase, then calls the matching `preApprove*Hook`. The phase-resolution logic is already there for verify/review. Adding `preApproveBuildHook` requires:
1. Detecting the build phase boundary (look at how the function picks between `preApproveVerifyHook` and `preApproveReviewHook` — the same gate-state logic should select build).
2. Threading the right inputs: BUILD_REPORT.md path, events.jsonl path, prompt snapshot path. Look at how `PreApproveVerifyHookInput` (line 293) is built; `PreApproveBuildHookInput` is symmetric.

## Locked decisions (from `SESSION_M16_KICKOFF.md`, do not relitigate)

1. **L1** — Phase machine stays unchanged. Multi-task semantics live in event projection (C1).
2. **L2** — No autoadvance through phases. Every gate transition requires explicit `code-oz approve <phase>`.
3. **L3** — Production seams in a separate module. (Done in C3.)
4. **L4** — CLI e2e test (C12) runs binary via `Bun.spawn`. C5 sets up the durable artifacts the e2e needs.
5. **L5** — Single-axis commits. C5 ships **prompt persistence + preApproveBuildHook only**; no dispatcher, no SHIP wiring, no resume.
6. **L6** — No new permission scopes, no new gates, no new agent personas.

## What's deferred to M17 (do not touch in M16)

- `src/phases/ship.ts` (`runShip`) — SHIP is a new authority, M17.
- `code-oz resume` command.
- `code-oz intervention resolve <code>` command.
- AUDIT runtime (M18+).
- Validation runner consulting `budgets.global.maxWallTimeMinutes`.

## Cross-model peer review discipline (UPDATED for C4 lessons)

**Per-commit cross-model review** (saved as memory `feedback_per_commit_cross_model_review.md`): for any commit that touches shared infrastructure (locks, seams, gate contracts, event schemas, multi-phase coordination), run a Codex independent design review BEFORE the lead writes code. Same shape as the milestone-level R0/R1 cycle but at single-commit granularity.

**C5 qualifies for this** because:
- It mutates the `build_completed` event schema (multi-phase contract — VERIFY + REVIEW + dispatchers all consume `build_completed`).
- It adds a new approve hook surface that future phases (C8 + M17 SHIP) will mirror.

**Recommended workflow for C5:**

1. Launch two parallel agents:
   - **Opus explorer** (general-purpose): map touch points — read `preApproveVerifyHook` for shape; enumerate every existing `build_completed` emit site that needs the new field; check whether `composeBuildPrompt` is deterministic (matters for sha stability across re-composition).
   - **Codex researcher** (`agent-codex:codex-researcher`): independent design review. Specific risks to surface: (a) prompt non-determinism breaking the resume-safety story; (b) the schema change ordering — schema-bump must land before any test-fixture emit-site update or the suite goes red mid-bisect; (c) what happens if the prompt file is present but has zero bytes vs missing entirely; (d) approve-hook ordering vs. existing hooks.

2. Synthesize Codex's verdict + Opus's map into the implementation.

3. Implement source first; then dispatch parallel Opus agents to write the test files in parallel with each other.

The C4 cycle proved the ROI: Codex caught three load-bearing modifications at single-commit granularity that the lead lean would otherwise have shipped (separate lock dir, caller-holds-phase-lock TOCTOU contract, specific failure detail in partial-state messages).

**At C13 (last M16 commit):** run the milestone-level Codex R1 review against the post-implementation SHA. Iterate to push verdict before tagging `v0.17.0-alpha.0`.

## Project meta-rules to remember

- **No push without explicit approval.** Branch is local-only; user pushes when M16 closes. (Current state: 9 unpushed commits.)
- **No emojis in code, commit messages, or test files.** No `Co-Authored-By: Claude` footers.
- **Conventional commit format** with single-axis scope (e.g. `feat(phases): BUILD prompt persistence (M16 C5)`).
- **Auto mode is on** (per the user's session preference) — execute autonomously, minimize check-ins on routine decisions.
- **Parallel Opus + Codex is endorsed** for non-trivial commits — see "Cross-model peer review discipline" above.

## Open threads

- **Background C1 review file**: `docs/research/CODEX_REVIEW_M16_C1.md` was never written (a Codex background agent reported success but no file landed). Treat C1 as locked-by-internal-verification; R1 at C13 covers any C1-level issues.
- **Lock-busy intervention does not write a gate** (build/verify/review): R5 lock collisions return the result struct without writing NEEDS_INTERVENTION.json. This is consistent across all three phases but technically blurs rule 1 (file-based gate signals). Codex flagged it as fine-as-is for C4 because lock-busy is a "no work was started, no state changed" case. Future audit: should approve-time hooks observe lock state and refuse if a `*_already_in_flight` happened recently? File as M17 / W2 candidate.
- **Flag-value parser UX nit** (pre-existing): `--fake-script --request go` greedily consumes `--request` as the path. Same shape exists for `--request` already. Worth a follow-up "flag-value safety" pass — would tighten parser UX across all value-taking flags. Not C5 concern.

## Pacing rule

- One single-axis slice per commit (rule 20).
- After each commit: `bun test` + `bun run typecheck` clean before the next.
- Conventional commit messages. No "update memory" in subjects. No emojis.
- Branch stays `feat/m16-cli-completion`; no merge to main until R1 says push.
- Ring 2 dogfood (`~/Projects/code-oz-dogfood/`, halted at BUILD) is the canonical real-world test target — M16 verification gate requires `code-oz run` from there to reach `currentPhase: ship` with `task_completed` events for T-001/T-002/T-003.

## Quick references

- Kickoff: `docs/design/SESSION_M16_KICKOFF.md` (the 13-commit sequence)
- C3 handoff (still load-bearing for seam contracts): `docs/design/SESSION_M16_C3_HANDOFF.md`
- R0 briefing: `docs/research/CODEX_BRIEFING_M16.md`
- R0 verdict: `docs/research/CODEX_RESPONSE_M16.md` (thread `019e0a59`)
- C5 source touch points:
  - `src/phases/build.ts:419-423` — composeBuildPrompt call site
  - `src/phases/build.ts:687-689` — build_completed event emit
  - `src/phases/build.ts:613` — atomic-write precedent for BUILD_REPORT.md
  - `src/state/schemas.ts:684-696` — build_completed event variant
  - `src/state/events.ts:713-727` — build_completed validator
  - `src/commands/approve.ts:293-340` — preApproveVerifyHook precedent
  - `src/commands/approve.ts:227-243` — runApprove dispatch
  - `src/worktree/paths.ts:45-57` — WorktreePaths factory + helpers
  - `src/artifacts/atomic-write.ts:36` — atomicWriteFile

## When you're ready to start

```
git status                                                   # confirm branch clean at 2ebab81
bun test                                                     # baseline 2856 / 0 / 1
bun run typecheck                                            # clean
ls -la docs/research/CODEX_REVIEW_M16_C1.md 2>/dev/null     # background review check (still expected absent)
```

Then read `feedback_per_commit_cross_model_review.md` from memory, dispatch parallel Opus + Codex for C5 design, synthesize, implement, dispatch parallel test-writing agents, verify, commit. Same flow that worked for C4.

C5 should land in one focused commit (~150-200 LOC source + ~250 LOC tests).
