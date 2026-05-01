# code-oz — M9 implementation session handoff (commits 7–11)

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else. The non-negotiable rules in there override anything that conflicts in this handoff.

This handoff picks up M9 from commit 7 through commit 11 (orchestrator + e2e). The synthesis kickoff (`docs/design/SESSION_M9_KICKOFF.md`) covers the locked 13 decisions + 12-commit sequence; **read it first**. This file is a delta on top, written for the second session of the M9 implementation.

## State at start of this session

- **Repo:** `github.com/omerakben/code-oz` (local-only; not yet pushed). Branch `main` carries the M8 merge plus the docs/product-thesis fast-forward.
- **Branch:** `feat/m9-review`, 6 implementation commits + 1 synthesis commit landed.
- **Last commit:** `54cd5f4` — M9 commit 6 (reviewer persona).
- **Tests:** 1504 pass, 1 skip, 0 fail (offline). Net new in M9 so far: ~179 tests across 7 new files.
- **Typecheck:** clean.
- **Tag target:** `v0.9.0-alpha.0` after Codex implementation review verdict = `push`.

## Commits 1–6 already landed

```
54cd5f4 commit 6  feat(agents): reviewer persona (replaces M2 stub)
df19fbd commit 5  feat(prompts): review-system.md template + composer
019dfd2 commit 4  feat(artifacts): review-report parser + serializer + canonicalizer
b6891bb commit 3  feat(state): review_* event types + validators
83b1662 commit 2  feat(agents): tool_use.review_request schema + load validation
3c40adb commit 1  feat(substrate): worktree lifetime through REVIEW + BUILD provider durability + family-aware loader
388effb commit 0  docs(design): M9 synthesis (kickoff + Codex briefing/response, thread 019de05a)
```

### What each commit gave you

| Commit | Modules / files | What's now available |
|---|---|---|
| 1 | `src/providers/families.ts` (new), `src/agents/loader.ts`, `src/commands/approve.ts`, `src/state/{schemas,events}.ts`, `src/phases/build.ts`, `docs/contracts/{WORKTREE,REVIEW}.md` | Family-aware load-time check via `familyOf()`; `build_provider_recorded` event emitted after `build_completed` (carries provider/family/model); `preApproveVerifyHook` narrowed to verdict-pass guard; new `preApproveReviewHook` removes worktree on REVIEW-approve (idempotent on missing worktree, refuses on missing event); WORKTREE.md cleanup retargeted to REVIEW-approve; REVIEW.md fix-first strict rule + cap-composition lock documented. |
| 2 | `src/agents/schema.ts` | `ReviewRequestPermissions` interface + `validateReviewRequest()` enforcing `tools=['request-review']`, `providers ⊆ PROVIDER_FAMILIES`, `maxRounds ≤ 4` (rule 6), `timeoutMsPerRound ≤ 600_000`, `network='provider-only'`. |
| 3 | `src/state/{schemas,events}.ts` | Four review_* events (`review_started` carries cross-family pair; `review_round_completed` per-round score+verdict+findings counts; `review_resolved` ≥6 score; `review_blocked` reason ∈ {block, cap_exhausted}). Cross-family invariant validated on `review_started`. |
| 4 | `src/artifacts/review-report.ts` (~880 lines) | `parseReviewReport`, `serializeReviewReport` (deterministic), `canonicalizeFindings` (fingerprint-based F-NNN with ping-pong reopen), `computeCanonicalVerdict` (canonical verdict rule), `renderRepairPrompt` (≤5 clipped offending_lines bounded grammar). Path validation, deleted-file rejection, fix-first strict lock, cross-section invariants (round count alignment, final score alignment, final verdict alignment, cap-status alignment). |
| 5 | `src/prompts/review-system.md`, `src/prompts/index.ts` | Template with `{{REVIEW_CONTEXT}}` dynamic token (round + upstream refs + manifest + VERIFY summary + prior digests); `composeReviewPromptPure` and `composeReviewPrompt` mirror the verify-composer. Topic-1 prompt-only borrows pinned: tests-first, five axes, exact false-coverage caveat. |
| 6 | `src/agents/defaults/reviewer.md` | Full persona (~5k body). Frontmatter: provider=codex, write=`.code-oz/artifacts/REVIEW.md`, bash=deny, `tool_use.repo_context` (glob/grep/read on worktree), `tool_use.review_request` (request-review, providers=[codex,gemini], maxRounds=4, timeoutMsPerRound=120000, network=provider-only). |

## Why this session exists

Commits 1–6 are the substrate. **Commit 7 is where it all snaps together.** The pattern from M8's `src/phases/verify.ts` (906 lines) is the canonical orchestrator shape: preflight → persona invoke → repair-if-needed → finalize → atomic write → events → Scientist tail → gate-preflight. Commit 7 mirrors that, plus cross-family invocation-time check (compare latest `build_provider_recorded` family to the reviewer agent's family — substrate is already on disk and tested by commit 1).

Commits 8–11 close the loop with e2e tests and multi-round support.

## Authority boundary recap (CLAUDE.md rule 20)

M9 introduces exactly one new authority boundary: **cross-family REVIEW authority**. The 4-round loop discipline + cross-family enforcement + score+verdict exit policy are inseparable; treat them as one authority. M10 = Debate runtime, M11+ = thesis productization sequence. Don't preempt.

## Must-read artifacts (in order)

1. **`CLAUDE.md`** — non-negotiable rules 1–21. Particularly: 2 (cross-family review at REVIEW gate — M9's load-bearing rule), 6 (4-round loop cap with score+verdict exit), 11 (intervention codes), 19 (`budgets.global` covers REVIEW per-round calls), 20 (M9's single authority boundary).
2. **`docs/design/SESSION_M9_KICKOFF.md`** — full M9 plan, 13 locked decisions, 12-commit sequence. The "Locked decisions" table and "Don't-do list" sections are still authoritative for commits 7–11.
3. **`docs/research/CODEX_RESPONSE_M9.md`** — Codex's verdict (thread `019de05a`); reference for the exact Codex alternatives if any commit feels under-specified.
4. **`docs/contracts/REVIEW.md`** — pinned schema. Commit 4 implements the parser; commit 7 consumes it. Note the M9 commit 1 `fix-first` strict lock and the cap-composition section.
5. **`docs/contracts/{BUILD,VERIFY,WORKTREE}.md`** — substrate. Commit 7 reads BUILD_REPORT.md for the changed-file manifest, VERIFY.md for the pass summary, and the latest `build_provider_recorded` event for the BUILD family.

## Files to glance at (not re-read in full)

- **`src/phases/verify.ts`** (906 lines, M8 final) — the canonical phase pattern. `runReview` mirrors structure: orchestrator preflight → persona invocation → finalize-with-repair → atomic write → events → Scientist tail → gate-preflight.
- **`src/phases/build.ts`** — repair-loop pattern for the two-draft cap.
- **`src/phases/scientist.ts`** + **`src/phases/gate-preflight.ts`** — Scientist phase-tail invocation pattern (3/3 caps; gate preflight validates HYPOTHESES.md / OPEN_QUESTIONS.md before writing GATE_REVIEW_PASSED.json).
- **`src/tools/review-request.ts`** (85 lines) — already enforces cross-family at invocation. **Commit 7 calls into this from `src/phases/review.ts`; do NOT modify the tool.**
- **`src/artifacts/review-report.ts`** (M9 commit 4) — `parseReviewReport`, `serializeReviewReport`, `canonicalizeFindings`, `computeCanonicalVerdict`, `renderRepairPrompt`.
- **`src/prompts/index.ts`** — `composeReviewPromptPure` and `composeReviewPrompt` are the M9 commit 5 entry points.
- **`src/state/run.ts`** + **`src/state/events.ts`** — `requireGate`, `appendEvent`, `readEvents`, `runPathsFor`, `RunPaths`.
- **`src/artifacts/atomic-write.ts`** — `atomicWriteFile` for the canonical REVIEW.md write.

## Commit sequence (delta from kickoff)

```
M9 commit 7:  feat(phases): one-round REVIEW orchestrator (happy path + ready/needs-revision/block exits)
M9 commit 8:  feat(e2e): one-round REVIEW e2e (greenfield-baby-name, FakeProvider)
M9 commit 9:  feat(substrate): typed carry-forward source field for round 2+
M9 commit 10: feat(phases): REVIEW remediation coordinator + multi-round REVIEW orchestrator
M9 commit 11: feat(e2e): multi-round REVIEW e2e + full v0.9 spine e2e
M9 commit 12: docs(design): Codex M9 implementation review (CLAUDE.md rule 8)
M9 commit 13+: any fix-first commits Codex review surfaces

Tag v0.9.0-alpha.0 after Codex review verdict = `push`.
```

## Commit 7 — one-round REVIEW orchestrator

**Files to create:**
- `src/phases/review.ts` (mirrors `src/phases/verify.ts` shape; expect ~700–900 lines)
- `src/phases/review-resume.ts` (per-round atomic resume; partial-draft persistence; mismatch-on-resume → intervention)
- `tests/review-phase.test.ts` (round 1 pass / needs-revision / block; cross-family check; partial draft resume; resume mismatch intervention; Scientist tail)

**Files to modify:**
- `src/phases/scientist.ts` — add a REVIEW branch (3/3 cap; reads REVIEW.md plus prior sidecars; severity-block / fix-first findings escaping a `ready` exit (which the schema does not permit) seed Q-NNN open questions)

**Public API shape (mirror `runVerify`):**

```ts
export interface RunReviewOptions {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly cwd: string
  readonly reviewerAgent: AgentDefinition
  readonly scientistAgent: AgentDefinition
  readonly taskId: string
  readonly invokeCtx: InvokeContext
  readonly invokePersona: (prompt: string) => Promise<string>
  readonly now?: () => string
  /** Round number (1 in M9 commit 7; 2..4 in M9 commit 10). */
  readonly round: number
  /** Prior REVIEW.md when round > 1. Pass `null` for round 1. */
  readonly priorReviewMd?: string | null
}

export type ReviewStatus = 'resolved' | 'needs_revision' | 'blocked' | 'intervention'

export interface ReviewResult {
  readonly status: ReviewStatus
  readonly reviewReportPath?: string
  readonly verdict?: ReviewVerdict
  readonly score?: number
  readonly findings?: readonly ReviewFinding[]
  readonly intervention?: { readonly code: string; readonly rule: string; readonly draftPath?: string }
}
```

**Algorithm (mirror `runVerify` discipline):**

1. **Read inputs:** BUILD_REPORT.md, VERIFY.md, prior REVIEW.md (when round > 1). Compute the changed-file manifest from BUILD_REPORT.md.
2. **Cross-family invocation-time check:** read events.jsonl, find the latest `build_provider_recorded` for `(runId, taskId)`. Compare its `family` to `familyOf(reviewerAgent.provider as ProviderId)`. If equal → `intervention` with code `review_cross_family_violation` (this is a config edit between BUILD and REVIEW; the load-time check passed at startup but the runtime state changed).
3. **Render `{{REVIEW_CONTEXT}}` block:** round number, upstream refs (paths + sha256), changed-file manifest (one bullet per file), VERIFY pass summary line, prior round digests for round > 1.
4. **Compose prompt:** `composeReviewPrompt({ agentBody: reviewerAgent.body, readySignal: REVIEW_READY_SIGNAL, availableTools: [...], reviewContext })`.
5. **Emit `review_started`** with cross-family pair recorded.
6. **Invoke persona** (initial draft).
7. **Parse persona response** — extract `## Findings` H3 blocks + `## Score.Final score`. If the response is malformed (no ready signal, no findings section, missing score, parser issue), construct a `renderRepairPrompt` with the bounded grammar (≤ 5 clipped offending lines) and re-invoke. **Two drafts max.** Track each rejected draft to `.code-oz/runs/<runId>/review-drafts/round-N-attempt-M.md` (kickoff Decision 10 — never silently discard).
8. **Canonicalize findings:** `canonicalizeFindings({ draftFindings, priorFindings, round })` returns the canonical findings list with stable F-NNN ids and ping-pong reopens.
9. **Compute verdict:** `computeCanonicalVerdict(findings, personaScore)`.
10. **Validate paths:** call `parseReviewReport` (or call `parseFindings` directly) with the changed-file manifest from BUILD_REPORT.md to enforce `review_finding_path_unknown`.
11. **Build the canonical REVIEW.md:** assemble `ReviewReportData` (round timeline = prior + this round's bullet; cap status from round number); `serializeReviewReport`; `atomicWriteFile`.
12. **Emit `review_round_completed`.**
13. **Branch on verdict:**
    - `ready` → emit `review_resolved` (with reviewReportSha256), run Scientist phase-tail, `requireGate('review')`, return `{ status: 'resolved', ... }`.
    - `needs-revision` → return `{ status: 'needs_revision', ... }`. **Do NOT call `scheduleAttemptNPlus1`** (kickoff Decision 1: that function is VERIFY-specific). Multi-round handling is M9 commit 10's job; in commit 7, return without re-invoking BUILD.
    - `block` → emit `review_blocked` (reason='block', reviewReportSha256), write `NEEDS_INTERVENTION.json` with code `review_block_terminal`, return `{ status: 'blocked', ... }`.
14. **Resume mismatch:** if a partial draft exists from a prior session that does NOT match the canonical REVIEW.md sha + `review_round_completed` event for this round, raise intervention `review_resume_mismatch` (kickoff Decision 10) — do not replay.

**Constants:**
- `REVIEW_READY_SIGNAL = '<review-ready/>'` (mirror `<verify-ready/>`).
- Reuse `REVIEW_REPAIR_OFFENDING_LINES_MAX` from `src/artifacts/review-report.ts`.

**Cross-cutting locks (re-read kickoff):**
- Decision 1: REVIEW is the outer coordinator; **don't call `scheduleAttemptNPlus1` for REVIEW findings**.
- Decision 4: two monotonic global counters (4 BUILD attempts, 4 REVIEW rounds) — commit 7 only sees one round; commit 10 wires the cap.
- Decision 5: family check uses recorded BUILD family from `build_provider_recorded`, not from re-reading BUILD agent config.
- Decision 6: orchestrator-only Round timeline writer.
- Decision 10: per-round atomic resume; partial drafts persisted under `.code-oz/runs/<runId>/review-drafts/`; mismatch on resume → intervention.

## Commit 8 — one-round REVIEW e2e

**Files to create:**
- `tests/e2e/review-lite-greenfield-pass.test.ts`

**FakeProvider keying (kickoff Decision 13):** keyed by `(phase, agent, taskId, attempt, reviewRound)` with explicit object keying; **fresh provider instance per test** to avoid hidden state. M8's e2e tests use `(phase, agent, taskId, attempt)`; extend to add `reviewRound`. The change goes in `src/providers/fake.ts` if not already there — check the existing keying first; if it's `(phase, agent, taskId, attempt)`, add the `reviewRound` axis as an optional field.

**Test scenario:** greenfield-baby-name fixture, single task T-001, BUILD passes (FakeProvider stubs builder + scientist responses), VERIFY passes (FakeProvider stubs verifier + scientist), REVIEW round 1 returns `ready` (FakeProvider stubs reviewer + scientist), `code-oz approve review` removes the worktree (preApproveReviewHook from commit 1), GATE_REVIEW_PASSED.json is written.

**Update fixture if needed:** the kickoff says reuse `greenfield-baby-name` (was originally `greenfield-web` in the plan, now the existing fixture). If the fixture is missing T-001, extend it; otherwise reuse as-is.

## Commit 9 — typed carry-forward source field

**The substrate piece for round 2+ remediation (kickoff Decision 8).** Codex caught that reusing M8's `Failure carry-forward` shape for REVIEW findings would create fake forensics. The fix is a typed `Source: verify-fail | review-needs-revision` field added to BUILD_REPORT.md's failure carry-forward block.

**Files to modify:**
- `src/artifacts/build-report.ts` — extend `Failure carry-forward` parser + serializer with the `Source` field (locked enum `verify-fail | review-needs-revision`).
- `src/artifacts/review-report.ts` — add a helper `serializeReviewCarryForward(reviewReportPath, sha, summary, constraint)` that emits the typed block for REVIEW round 1 needs-revision exits.
- `src/phases/build.ts` — BUILD prompt accepts `attempt > 1` from either source (verify-fail OR review-needs-revision); the carry-forward block is rendered identically but the `Source` field is read.
- `docs/contracts/BUILD.md` — document the `Source` field.

**Files to create:**
- `tests/build-report-typed-carry-forward.test.ts` (parser + serializer round-trip with both Source values)
- `tests/review-needs-revision-typed-carry-forward.test.ts` (REVIEW round 1 needs-revision writes a valid carry-forward block consumable by BUILD attempt N+1)

**Why commit 9 lands AFTER commit 7 (one-round REVIEW):** commit 7 doesn't need the carry-forward field for `ready` or `block` exits; it surfaces only on `needs-revision`. Codex pinned this as a "M9-followup substrate commit before tag" — commit 9 lands the carry-forward shape; commit 10 consumes it.

## Commit 10 — REVIEW remediation coordinator + multi-round orchestrator

**Files to create:**
- `src/phases/review-remediation.ts` (NEW coordinator — NOT `scheduleAttemptNPlus1` per kickoff Decision 1)

**Files to modify:**
- `src/phases/review.ts` — round 1 `needs-revision` exit calls into `review-remediation.ts`.

**The remediation coordinator (kickoff Decision 1 + 4):**

1. Round N's `needs-revision` exit triggers a BUILD attempt N+1 with the typed carry-forward block (commit 9's shape).
2. **Two monotonic global counters scoped to (runId, taskId):**
   - `reviewRoundsUsed` — incremented each REVIEW round.
   - `buildAttemptsUsed` — incremented each BUILD attempt (already exists from M7/M8).
   - Both capped at 4. Whichever trips first owns the intervention.
3. **VERIFY restarts during a REVIEW remediation BUILD attempt do NOT increment `reviewRoundsUsed`.** This is the authority overlap rule (Decision 4): if attempt N+1's BUILD fails VERIFY and exhausts the 4-attempt VERIFY cap, the intervention is VERIFY-owned with context "while addressing REVIEW round N" — REVIEW round count does not advance, and `review_blocked` is **not** emitted.
4. **Fingerprint-based ping-pong detection** (Decision 2) consumed from `canonicalizeFindings` (commit 4): cap-exhausted intervention names reopened findings explicitly.

**Test scenarios (in `tests/review-remediation*.test.ts`):**
- Round 1 needs-revision → BUILD attempt 2 → VERIFY pass → REVIEW round 2 ready (the happy multi-round path).
- Round 2 block (any round can emit `block`).
- REVIEW cap exhausted (4 rounds, no ready exit) → `review_blocked` reason='cap_exhausted'.
- BUILD cap exhausted during a REVIEW remediation → VERIFY-owned intervention; **no** `review_blocked` emitted; REVIEW round count stays at the round that triggered the BUILD attempt.
- Authority overlap: VERIFY cap during REVIEW round 2 → intervention message includes "while addressing REVIEW round 2".
- Ping-pong cap naming: when round-N exits with cap exhausted and a previously-resolved finding has been reopened, the NEEDS_INTERVENTION.json names the reopened finding(s) explicitly.

## Commit 11 — multi-round e2e + spine e2e

**Files to create:**
- `tests/e2e/review-lite-greenfield-multi-round.test.ts` (T-003: round 1 needs-revision → BUILD attempt 2 → round 2 ready)
- `tests/e2e/spine-greenfield.test.ts` (full DEFINE → PLAN → BUILD → VERIFY → REVIEW; covers the entire v0.9 phase chain end-to-end)
- `docs/demo/v0.9-spine.md` (manual demo walkthrough for human verification)

**Files to modify:**
- `tests/fixtures/greenfield-baby-name/` — add T-003 to the PLAN.md and the corresponding source/test files so the multi-round path can exercise a real disagreement-then-resolution.

## Commit 12 — Codex implementation review (CLAUDE.md rule 8)

Before tagging:

1. Bundle the diff: `git diff main..feat/m9-review` plus the 11-commit message log + the `feat/m9-review` HEAD sha.
2. Write `docs/research/CODEX_BRIEFING_M9_REVIEW.md` (or invoke directly with the diff bundle) — implementation review pass.
3. Invoke `mcp__plugin_agent-codex_codex-native__codex` with `gpt-5.5` xhigh, `sandbox: read-only`. Capture response as `docs/research/CODEX_REVIEW_M9.md`.
4. Codex returns one of: `push` / `fix-first` / `debate-required`. **Per the no-tech-debt-at-milestone-close memory: close ALL findings (including block-next-milestone) before tagging; only nits/fyis can defer.**
5. Land any fix-first commits as commits 13+.
6. Tag `v0.9.0-alpha.0` after the review verdict is `push`.

## Acceptance criteria for this session (commits 7–11)

Carries forward from `SESSION_M9_KICKOFF.md` § Acceptance criteria:

- REVIEW receives changed file paths from BUILD's manifest (rule 2).
- Cross-family enforcement layered: load-time (commit 1, done); invocation-time in `phases/review.ts` (commit 7) compares recorded BUILD family to reviewer adapter family; recorded post-condition in `REVIEW.md` `Reviewer.Cross-family check: passed` (commit 4 parser already validates this).
- Loop capped at 4 REVIEW rounds AND 4 BUILD attempts per `(runId, taskId)`, both monotonic; whichever trips first owns the intervention. VERIFY-restart cap exhaustion during REVIEW round N is VERIFY-owned with "while addressing REVIEW round N" context.
- Exit on `score ≥ 6` AND `verdict: ready` AND no unresolved `block` or `fix-first` (rule 6 + locked fix-first strict rule).
- Worktree preserved through REVIEW; removed at REVIEW approval via `preApproveReviewHook` (commit 1, done).
- Findings ping-pong detection: fingerprint-matched recurrence reopens original `F-NNN` id; cap-exhausted intervention names reopened findings explicitly.
- Repair prompts bounded: error code + violated rule + clipped offending lines only; full failed drafts never appended.
- Per-round atomic resume; partial drafts persisted; mismatch on resume → intervention.
- Topic-1 plumb-through verified via prompt-snapshot tests (already done in commit 5).
- REVIEW-lite e2e with FakeProvider: success path (commit 8) and multi-round path (commit 11). FakeProvider keyed by `(phase, agent, taskId, attempt, reviewRound)` with no hidden state.
- Full v0.9 spine e2e test (DEFINE → PLAN → BUILD → VERIFY → REVIEW) passes (commit 11).
- All M8 tests still pass (1325 carried). Commits 7–11 should land ~50–80 net new tests.
- Codex implementation review (rule 8) returns `push` after any fix-first commits land (commit 12+).
- Tag: `v0.9.0-alpha.0`.

## Don't-do list (anti-scope-creep)

Carries forward from `SESSION_M9_KICKOFF.md` § Don't-do list, with M9-commit-7-specific additions:

- **No SHIP phase work.** SHIP is W4. M9 stops at REVIEW pass + `code-oz approve review` + worktree removal.
- **No DEBATE runtime.** `requestDebate()` is M10. REVIEW persona's `tool_use` permissions in v0.1 cover only `repo_context` + `review_request`-receipt.
- **No reviewer panel logic.** Single reviewer is M9's baseline; panels are M14.
- **No runtime axis metrics for the five axes.** Static prompt-snapshot tests only (already done in commit 5).
- **No REVIEW.md schema additions.** Topic-1 sub-decisions locked: prompt-only borrows. Findings format unchanged. Severity enum unchanged.
- **No `scheduleAttemptNPlus1` reuse for REVIEW findings.** That function is VERIFY-specific. Commit 10 introduces a separate REVIEW remediation coordinator.
- **No 16-iteration cap interpretation.** Two global monotonic counters of 4 each. No per-review-round BUILD reset.
- **No persona-authored binary verdicts.** Orchestrator owns `Score.Final verdict` AND `Round timeline.<verdict>` per round.
- **No deleted-file findings.** Rejected in M9; locked convention deferred.
- **No silent partial-draft discard.** Persist under `.code-oz/runs/<runId>/review-drafts/`.
- **No accumulated transcripts in repair prompts.** Bounded grammar only (≤ 5 clipped offending lines).
- **No push to GitHub.** Local commits only (CLAUDE.md "Working in this repo" rule 5).
- **No version tag mid-milestone.** Tag `v0.9.0-alpha.0` only after Codex review verdict = `push`.
- **No modifications to `src/tools/review-request.ts`.** That M4 primitive already enforces cross-family at invocation; commit 7 calls into it from `src/phases/review.ts` but does not modify it.
- **No commit-to-commit reordering.** Commits 7 → 8 → 9 → 10 → 11 → 12+ in order. Commit 9 (typed carry-forward) substrates commit 10 (multi-round); skipping ahead breaks the dependency graph.

## Resume notes

If this session crashes mid-implementation:

- Each commit is atomic. Resume by reading `git log --oneline -20` to see how far M9 progressed, then continue from the next commit in the sequence above.
- The 13 locked decisions in `docs/design/SESSION_M9_KICKOFF.md` are the spec. If a commit feels under-specified, re-read `CODEX_RESPONSE_M9.md` for Codex's exact alternative.
- The Codex debate trail (`CODEX_BRIEFING_M9.md` + `CODEX_RESPONSE_M9.md`) is immutable history. Do NOT re-run the debate. Codex's M9 implementation review (commit 12) fires only after all 11 commits land.
- The substrate-first ordering (commit 1) is non-negotiable; you have already inherited that work. Implementing review.ts before commit 1 would have meant rewriting it.
- If a contract section feels wrong mid-implementation, pause and ask Ozzy. The only sanctioned mid-milestone contract amendments are the M9 commit 1 ones (WORKTREE.md cleanup retarget + REVIEW.md fix-first clarification + cap-composition lock); those are done.

## Known facts at start of this session

- The `greenfield-baby-name` fixture exists; check what tasks it carries before commit 8/11 (extend if T-003 is missing).
- The FakeProvider keying axis for `reviewRound` may or may not exist — check `src/providers/fake.ts` first; if not, add it as part of commit 8.
- `src/phases/scientist.ts` already supports BUILD and VERIFY phase-tails; commit 7 adds a REVIEW branch (3/3 cap, mirror the existing severity threshold).
- `src/state/run.ts` `requireGate('review')` is already wired up by M2's stub; the new orchestrator just calls into it after the canonical REVIEW.md atomic-write succeeds.

## After this session

The next session is **M10 — Debate runtime + `requestDebate()` primitive**:

- Branch `feat/m10-debate` from `main`.
- One new authority boundary: Debate runtime authority (CLAUDE.md rule 20).
- Codex briefing per rule 7. Codex implementation review per rule 8.
- Tag: `v0.10.0-alpha.0`.

The M10 kickoff doc gets written either at the end of M9 (if the user wants it teed up) or at the start of M10 itself.

## Three of us are building this

Cross-family debate produced this session's plan. Cross-family review will validate M9's implementation. The discipline is the product — never present "ready to proceed" without it. M9 ships that discipline as a runtime primitive: the same cross-family review the project uses to plan itself, now callable on any code change inside the gate.

End of M9 commits 7–11 handoff.
