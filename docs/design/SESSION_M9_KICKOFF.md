# code-oz — M9 implementation session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else. The non-negotiable rules in there override anything that conflicts in this kickoff.

This session ships **M9 — REVIEW-lite + cross-family handoff**. Tag at end: `v0.9.0-alpha.0`. Branch: `feat/m9-review` from `main` (already cut; current HEAD `b869f3b` carries the thesis pressure-test merge).

## State at start of this session

- **Repo:** `github.com/omerakben/code-oz` (local-only; not yet pushed). Branch `main` carries the M8 merge plus the docs/product-thesis fast-forward.
- **Last release:** `v0.8.0-alpha.0` — M8 closed. VERIFY-lite + restart-on-fail + mutation-test gate. Tagged on `main` locally.
- **Tests:** 1325 passing, offline.
- **Binary:** `dist/code-oz` reports `0.8.0-alpha.0`.
- **What works:** DEFINE → PLAN → BUILD → VERIFY end to end with FakeProvider against `greenfield-baby-name` fixture; worktree-per-run isolation; orchestrator-owned BUILD_REPORT.md + VERIFY.md authoring; restart-policy with 4-attempt cap + typed `VerifiedFailedAttempt` input; mutation gate with source-only revert + abnormal-termination semantics; cleanup-on-VERIFY-approve via `preApproveVerifyHook`; canonical event order on VERIFY-fail; Scientist phase-tail at BUILD and VERIFY gates.
- **What's stubbed:** REVIEW phase (1.9k stub from M2). DEBATE runtime. SHIP. AUDIT. The current M8 `preApproveVerifyHook` removes the worktree on VERIFY approval (`src/commands/approve.ts:316`); M9 substrate must change this so the worktree survives through REVIEW.

## Authority boundary (CLAUDE.md rule 20)

M9 introduces exactly one new authority boundary: **cross-family REVIEW authority**.

Like M8's "VERIFY evidence + restart-on-fail" pair, this reads multi-faceted but is structurally one authority. The 4-round loop discipline + cross-family enforcement + score+verdict exit policy are inseparable: cross-family review without bounded loop policy becomes infinite re-review; bounded loop without cross-family becomes self-affirmation. The two halves form one authority viewed from different angles. Per the M7-M10 shape verdict: M10 is Debate runtime authority. Don't preempt in M9.

## Why this session exists (the thesis)

After M8 closed, a CLAUDE.md rule-7 debate (Claude + Codex, thread `019de05a`, 2026-04-30) pressure-tested 13 implementation decisions for M9. Codex returned **3 rejects, 10 accept-with-modifications, 0 clean accepts**. Three of the rejects exposed real bugs in the briefing leans:

- **Decision 4 (cap composition):** my "multiplicative worst case 4×4=16" lean weakened M8's restart discipline. Codex's two-monotonic-global-counters-of-4-each scoped to `(runId, taskId)` is the correct semantics; whichever cap trips first owns the intervention.
- **Decision 8 (REVIEW-driven carry-forward):** my "reuse M8's `Failure carry-forward` shape" lean would create fake forensics — that grammar expects failed validation evidence, not REVIEW findings. Codex's typed `Source: verify-fail | review-needs-revision` field is the correct shape; lands as a M9-followup substrate commit before tag, after one-round REVIEW lands.
- **Decision 11 (persona size):** my "~4-5k larger than verifier" lean repeated the M7/M8 prose-equals-authority pattern. Codex's "~3.5-4.2k with one full needs-revision example + one tiny ready example" is right; parser ownership + canonical context + bounded repair prompts are the authority.

Codex also flagged eight risks the briefing missed:

1. **Worktree lifetime bug.** M8's `preApproveVerifyHook` removes the worktree on VERIFY approval; M9 REVIEW needs `.code-oz/runs/<runId>/worktree/` alive to read changed files. Contracts and code disagree. **Substrate fix required before any REVIEW loop work.**
2. **Cross-family laundering via runtime adapter mismatch.** `loader.ts:90` compares provider IDs literally (`if (review.provider === build.provider)`), not family-aware. A misconfigured adapter could make a "codex"-declared reviewer operationally same-family. **Family-aware comparison required.**
3. **BUILD provider not durably recorded.** BUILD_REPORT.md has no `Provider` field; build events do not include provider. The briefing's invocation-time REVIEW check assumed a recorded provider that does not exist. **Substrate addition required.**
4. **Authority overlap on terminal failure.** If REVIEW round 1 needs-revision and the follow-up BUILD attempt exhausts VERIFY's 4-attempt cap, the intervention is VERIFY-owned ("while addressing REVIEW round 1"). Do not also emit `review_blocked` — double-terminal state corrupts resume semantics.
5. **Findings ping-pong across rounds.** If `F-001` resolves in round 2 and reappears in round 3, minting `F-005` hides recurrence. Fingerprint-based id reuse + reopen on recurrence is required.
6. **Prompt drift across 8 possible reviewer invocations.** Repair prompts must be bounded — error code, exact violated rule, clipped offending lines only. Never accumulate full failed drafts.
7. **Topic-1 false-coverage drift detection.** Stays prompt-only in M9 (no runtime axis metrics). Static prompt-snapshot tests verify `review-system.md` contains tests-first, five axes, exact security caveat.
8. **`fix-first` semantics contradiction in REVIEW.md.** One paragraph says "does not block exit"; the exit rule forbids `ready` with unresolved `fix-first`. M9 locks the stricter rule: unresolved `fix-first` blocks `ready`.

Synthesis: 13 decisions absorbed (3 rejects, 10 accept-with-modifications), commit sequence reordered (substrate-first per Codex's "recommended next step"), eight new locked items added.

## Must-read artifacts (in order)

1. **`CLAUDE.md`** — non-negotiable rules 1-21. Particularly: 2 (cross-family review at REVIEW gate — **M9's load-bearing rule**), 6 (4-round loop cap with score+verdict exit), 7 (this session satisfies the M9 leg), 8 (Codex review at implementation completion fires before tag), 11 (intervention codes), 19 (`budgets.global` covers REVIEW per-round calls), 20 (M9's single authority boundary), 21 (forward-looking baseline; M9's single-reviewer is what panel-quorum-vs-baseline measurements compare against in M14).
2. **`docs/research/CODEX_BRIEFING_M9.md`** — the briefing (373 lines, 13 decisions, plumbed Topic-1 sub-decisions).
3. **`docs/research/CODEX_RESPONSE_M9.md`** — Codex's verdict (thread `019de05a`, 3 rejects + 10 accept-with-modifications, 8 risks).
4. **`docs/contracts/REVIEW.md`** — pinned schema. M9 implements writers for it. Note the `fix-first` clarification (locked by this session: unresolved `fix-first` blocks `ready`).
5. **`docs/contracts/BUILD.md`**, **`docs/contracts/VERIFY.md`**, **`docs/contracts/WORKTREE.md`** — substrate. WORKTREE.md needs the cleanup retarget (M8's VERIFY-approve hook moves to REVIEW-approve in M9 commit 1).
6. **`docs/research/SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md`** — Topic-1 sub-decisions for `review-system.md` (already locked).
7. **`docs/design/ROADMAP.md` § M9** — file list. The fixture name says `greenfield-web`; the repo has `greenfield-baby-name`. Use the existing fixture; update the roadmap inline as part of commit 0.

You do not need to re-read every M2-M8 source file. Glance at:

- **`src/phases/verify.ts`** (906 lines, M8 final) — canonical phase pattern. REVIEW mirrors structure: orchestrator preflight → persona invocation → `repair → finalize` → atomic write → Scientist tail → gate-preflight.
- **`src/phases/build.ts`** (920 lines) — repair-loop pattern. M9's per-round repair mirrors.
- **`src/phases/restart-policy.ts`** + **`src/phases/schedule-attempt.ts`** — substrate M9 partially consumes. **Do NOT call `scheduleAttemptNPlus1` for REVIEW findings** — it emits `verify_restart_initiated`, which is wrong semantics. M9 commit 10 introduces a REVIEW remediation coordinator.
- **`src/tools/review-request.ts`** (85 lines, M4) — cross-provider primitive M9 consumes. Already enforces cross-family via `ctx.registry.familyOf()`. M9 does NOT modify; it calls into it from `src/phases/review.ts`.
- **`src/agents/loader.ts:82-103`** (`enforceCrossFamilyReview`) — load-time check. Currently compares provider IDs literally; M9 commit 1 fixes to use family comparison.
- **`src/commands/approve.ts:278-348`** (`preApproveVerifyHook`) — M9 commit 1 removes the worktree-removal call from this hook; new `preApproveReviewHook` does worktree removal at REVIEW approval.
- **`src/artifacts/verify-report.ts`** (24 KB, M8) — canonical artifact-parsing pattern. `parseReviewReport` follows.
- **`src/agents/defaults/verifier.md`** (4.5k, M8 final) — mid-size persona pattern. `reviewer.md` targets ~3.5-4.2k (Codex pushed back on briefing's 4-5k lean).
- **`src/agents/defaults/reviewer.md`** (1.9k stub from M2) — replaced wholesale in M9.
- **`src/prompts/verify-system.md`** (98 lines, M8 final) + **`src/prompts/index.ts`** `composeVerifyPromptPure` — persona prompt template + composer pattern.
- **`src/state/schemas.ts`**, **`src/state/events.ts`** — event union pattern. M9 adds 4 `review_*` events.
- **`src/agents/schema.ts`** + **`src/agents/load.ts`** — `AgentPermissions` shape. M9 adds `tool_use.review_request`.

## Locked decisions (synthesis of briefing leans + Codex verdicts)

| # | Final shape |
|---|---|
| 1 | REVIEW is the outer coordinator. **Do not call `scheduleAttemptNPlus1` for REVIEW findings.** Add a REVIEW remediation coordinator (M9 commit 10) that writes round N, prepares typed review carry-forward, hands control to BUILD attempt N+1. VERIFY restarts between REVIEW rounds **do not** increment REVIEW round count. |
| 2 | Orchestrator-minted run-scoped `F-NNN` ids. Persona drafts use existing ids or `F-NEW`; canonicalizer assigns new ids and reuses prior ids by fingerprint `(file, normalized title, recommendation intent)`. Resolution persona-claimed; orchestrator validates structural facts only (valid round number, prior id exists, no `ready` exit with unresolved `block`/`fix-first`, no id collision). Ping-pong recurrence reopens the original id. |
| 3 | Orchestrator owns `Score.Final verdict` AND `Round timeline.<verdict>` per round. Persona owns findings, score, recommendation text. **Canonical verdict rule:** any current `block` finding → `block`; otherwise unresolved `block` or `fix-first`, OR `score < 6` → `needs-revision`; otherwise `ready`. **Locks the stricter `fix-first` interpretation** per Codex catch on REVIEW.md contradiction. |
| 4 | **Two monotonic global counters scoped to `(runId, taskId)`:** max 4 clean BUILD attempts total, max 4 REVIEW provider rounds total. No per-round BUILD reset. No 16-iteration interpretation. Whichever cap trips first owns the intervention. |
| 5 | Three-layer cross-family enforcement, with two substrate fixes: (a) `loader.ts` uses family comparison via shared `familyOf(providerId) → family` lookup (new `src/providers/families.ts` module); (b) BUILD provider/family recorded durably via new `build_provider_recorded` event (lighter than BUILD_REPORT.md schema extension); REVIEW invocation-time check compares recorded BUILD family to reviewer adapter family. REVIEW.md's `Reviewer.Cross-family check: passed` bullet records the durable adapter family used for the call. |
| 6 | Orchestrator-only `Round timeline` writer. Persona sees compact prior-round history through prompt context (prior score, computed verdict, unresolved findings, resolved ids); never drafts timeline bullets. |
| 7 | Finalize-time `File:` path validation with strict normalization: reject absolute paths, `..`, symlink escapes, path aliases, files absent from BUILD_REPORT's changed-file manifest. Validate cited line/range exists in current worktree for `added`/`modified` files. **Deleted-file findings rejected in M9** (no locked convention yet). |
| 8 | **Multi-round remediation lands as a M9-followup substrate commit before tag**, not in the M8 carry-forward grammar. Typed carry-forward source field added: `Source: verify-fail | review-needs-revision`. For review: serialize prior attempt, prior review round, REVIEW.md path/sha, prior verdict `needs-revision`, summary, constraint. BUILD prompt accepts attempt > 1 from either source. |
| 9 | 2 total drafts per round (initial + 1 repair). **Repair prompt is bounded:** error code, exact violated rule, clipped offending lines only. Never append full failed drafts across rounds. |
| 10 | Per-round atomic resume. Persist ignored partial drafts under `.code-oz/runs/<runId>/review-drafts/round-N-attempt-M.md` (do not silently discard). Round complete only when canonical `REVIEW.md` AND `review_round_completed` event agree. **Mismatch on resume → intervention, not replay.** |
| 11 | Reviewer persona ~3.5-4.2k. Universal rules + tests-first + five axes + exact false-security-coverage caveat + **one** full needs-revision example + at most one tiny ready example. Grammar lives in contracts and parser tests, not persona prose. |
| 12 | Dynamic `{{REVIEW_CONTEXT}}` token in template (renders round number + upstream refs + changed-file manifest + VERIFY pass summary + prior scores/verdicts + prior findings). `{{AGENT_BODY}}` stays static. |
| 13 | Reuse `greenfield-baby-name` fixture; update ROADMAP/demo naming inline (was `greenfield-web`). FakeProvider keyed by `(phase, agent, taskId, attempt, reviewRound)` with explicit object keying; fresh provider instance per test. One-round pass e2e + one two-round remediation e2e (after multi-round substrate lands); deeper cap cases in unit tests. |

Additional locked items from Codex's risk surface:

- **Worktree preserved through REVIEW.** M9 commit 1 deletes worktree-removal from `preApproveVerifyHook` and adds `preApproveReviewHook` that removes the worktree at REVIEW approval. WORKTREE.md updated to match. SHIP cleanup policy beyond REVIEW is deferred (W4 territory).
- **`fix-first` unresolved blocks `ready`.** REVIEW.md clarification commits in M9 commit 1; canonical verdict rule (decision 3) enforces this.
- **`build_provider_recorded` event added in commit 1.** Lighter than BUILD_REPORT.md schema extension. Includes `runId`, `taskId`, `attempt`, `provider`, `family`, `model`. Recorded immediately after `build_completed`; durable across resume.
- **Family-aware loader cross-family check.** Shared `familyOf(providerId) → family` lookup in `src/providers/families.ts` (new module); `loader.ts` and runtime `ProviderRegistry` both consume.
- **Authority overlap: VERIFY-restart owns intervention.** When REVIEW round N's follow-up BUILD attempt exhausts VERIFY's 4-attempt cap, the intervention is VERIFY-owned with context "while addressing REVIEW round N." REVIEW round count does not advance during VERIFY restart. No `review_blocked` emitted in this path.
- **Ping-pong detection in canonicalizer.** Findings that fingerprint-match a prior-resolved finding reopen the original `F-NNN` id rather than minting a new one. Cap-exhausted intervention names reopened findings explicitly.
- **Prompt-snapshot tests in M9.** Static tests verify `review-system.md` contains tests-first language, five-axes scaffolding, exact false-coverage caveat. Runtime axis metrics deferred to M14 panel measurement.
- **Bounded repair prompt grammar.** Repair prompt structure pinned: `error_code: <code>`, `violated_rule: <rule text>`, `offending_lines: <≤ 5 clipped lines>`. No full draft body forwarded.

## Commit sequence (Codex's substrate-first reordering)

```
M9 commit 0:  docs(design): M9 synthesis + ROADMAP update + Codex briefing/response
              (this commit on feat/m9-review)

M9 commit 1:  feat(substrate): worktree lifetime through REVIEW + BUILD provider durability
                              + family-aware loader cross-family check
              src/commands/approve.ts: remove worktree-removal from preApproveVerifyHook;
                add preApproveReviewHook that removes worktree on REVIEW approve
              src/state/schemas.ts: new build_provider_recorded event
              src/phases/build.ts: emit build_provider_recorded after build_completed
              src/agents/loader.ts: family-aware comparison via shared familyOf()
              src/providers/families.ts (new): pure familyOf(providerId) → family lookup;
                shared by loader and runtime ProviderRegistry
              docs/contracts/WORKTREE.md: cleanup-on-VERIFY-pass deleted; cleanup-on-REVIEW-pass added
              docs/contracts/REVIEW.md: fix-first unresolved blocks ready (lock stricter rule)
              tests/{worktree-lifetime-through-review,build-provider-recorded,
                family-aware-loader,fix-first-unresolved-blocks-ready}.test.ts

M9 commit 2:  feat(agents): tool_use.review_request schema + load validation
              src/agents/schema.ts adds tool_use.review_request per REVIEW.md
              src/agents/load.ts validates: bounded maxRounds ≤ 4, providers list,
                bounded timeoutMsPerRound, network: provider-only
              tests/agent-load-tool-use-review-request.test.ts

M9 commit 3:  feat(state): review_* event types + validators
              src/state/schemas.ts adds 4 review_* events per REVIEW.md
              src/state/events.ts validators
              tests/state-events-review.test.ts

M9 commit 4:  feat(artifacts): review-report parser + serializer
              (orchestrator-owned Round timeline + per-round verdict + Final verdict;
               persona-owned Findings + Score; fingerprint-based F-NNN canonicalizer;
               bounded repair prompt grammar; deleted-file findings rejected)
              src/artifacts/review-report.ts
              tests/review-report-{parse,serialize,grammar,upstream-refs,timeline,
                findings,score,cap-status,verdict-authority,fingerprint-canonicalize,
                ping-pong-reopen,path-validation,fix-first-blocks-ready,
                deleted-file-rejected}.test.ts

M9 commit 5:  feat(prompts): review-system.md template + composer with {{REVIEW_CONTEXT}}
              src/prompts/review-system.md (~3.5-4.2k; universal-rules + tests-first +
                five axes + exact false-security-coverage caveat + 1 needs-revision example +
                1 tiny ready example + 2 inline rebuttals)
              src/prompts/index.ts composeReviewPromptPure with {{REVIEW_CONTEXT}} token
              tests/prompts-review-{compose,tokens,topic1-content-snapshot}.test.ts

M9 commit 6:  feat(agents): reviewer persona (replaces M2 stub)
              src/agents/defaults/reviewer.md (full ~3.5-4k persona body with universal-rules-injection
                + cross-family framing + tool_use scopes)

M9 commit 7:  feat(phases): one-round REVIEW orchestrator (happy path + ready/needs-revision/block exits)
              src/phases/review.ts (orchestrator: BUILD ref bind →
                cross-family invocation-time check via family-of-build vs family-of-reviewer →
                persona invoke → finalize with two-draft cap + bounded repair prompt →
                orchestrator computes binary Round-1 verdict + Final verdict →
                if ready, exit; if needs-revision, intervention with M9-followup
                "multi-round remediation in next commit" message; if block, intervention)
              src/phases/scientist.ts extension for REVIEW phase-tail (3/3 cap)
              src/phases/review-resume.ts (per-round atomic resume; partial drafts
                persisted; mismatch-on-resume → intervention)
              tests/review-phase-{round-1-pass,round-1-needs-revision,
                round-1-block,cross-family-check,scientist-tail,
                partial-draft-resume,resume-mismatch-intervention}.test.ts

M9 commit 8:  feat(e2e): one-round REVIEW e2e
              tests/e2e/review-lite-greenfield-pass.test.ts
              FakeProvider keying extended to (phase, agent, taskId, attempt, reviewRound)
              fresh provider instance per test

M9 commit 9:  feat(substrate): typed carry-forward source field for round 2+
              src/artifacts/build-report.ts: Failure carry-forward.Source field added
                (`verify-fail | review-needs-revision`)
              src/artifacts/review-report.ts: REVIEW round 1 needs-revision exit
                writes a typed carry-forward block (REVIEW.md path/sha + summary + constraint)
              src/phases/build.ts: BUILD prompt accepts attempt > 1 from either source
              docs/contracts/BUILD.md: carry-forward Source field documented
              tests/build-report-typed-carry-forward.test.ts
              tests/review-needs-revision-typed-carry-forward.test.ts

M9 commit 10: feat(phases): REVIEW remediation coordinator + multi-round REVIEW orchestrator
              src/phases/review-remediation.ts (round N+1 trigger; NEW coordinator —
                NOT scheduleAttemptNPlus1 which is VERIFY-specific;
                two monotonic global counters of 4 each per (runId, taskId);
                authority overlap: VERIFY-restart-cap-exhausted owns intervention
                with "while addressing REVIEW round N" context;
                REVIEW round count does not advance during VERIFY restart;
                fingerprint-based ping-pong detection consumed from canonicalizer)
              src/phases/review.ts updated to call review-remediation on needs-revision exit
              tests/review-remediation-{round-2-pass,round-2-block,
                review-cap-exhausted,build-cap-exhausted-during-review,
                authority-overlap-verify-owns,ping-pong-cap-naming}.test.ts

M9 commit 11: feat(e2e): multi-round REVIEW e2e + spine e2e
              tests/e2e/review-lite-greenfield-multi-round.test.ts
                (T-003: round 1 needs-revision → BUILD attempt 2 → round 2 ready)
              tests/e2e/spine-greenfield.test.ts (full DEFINE → PLAN → BUILD → VERIFY → REVIEW)
              docs/demo/v0.9-spine.md
              tests/fixtures/greenfield-baby-name extended with T-003

M9 commit 12: docs(design): Codex M9 implementation review (CLAUDE.md rule 8)
M9 commit 13+: any fix-first commits Codex review surfaces
```

Tag `v0.9.0-alpha.0` after Codex review verdict = `push`.

## Acceptance criteria for the session

- REVIEW receives changed file paths from BUILD's manifest (CLAUDE.md rule 2: never curated summaries).
- Cross-family enforcement layered: load-time in `loader.ts` (family-aware via `familyOf()`); invocation-time in `phases/review.ts` (recorded BUILD family vs reviewer adapter family); recorded post-condition in `REVIEW.md` `Reviewer.Cross-family check: passed`.
- Loop capped at 4 REVIEW rounds AND 4 BUILD attempts per `(runId, taskId)`, both monotonic; whichever trips first owns the intervention. VERIFY-restart cap exhaustion during REVIEW round N is VERIFY-owned with "while addressing REVIEW round N" context.
- Exit on `score ≥ 6` AND `verdict: ready` AND no unresolved `block` or `fix-first` (CLAUDE.md rule 6 + locked `fix-first` strict rule).
- Worktree preserved through REVIEW; removed at REVIEW approval via `preApproveReviewHook`. Removal failure blocks gate write and emits intervention.
- Findings ping-pong detection: fingerprint-matched recurrence reopens original `F-NNN` id; cap-exhausted intervention names reopened findings explicitly.
- Repair prompts bounded: error code + violated rule + clipped offending lines only; full failed drafts never appended across rounds.
- Per-round atomic resume; partial drafts persisted; mismatch on resume → intervention.
- Topic-1 plumb-through verified via prompt-snapshot tests (`review-system.md` contains tests-first, five axes, exact false-coverage caveat).
- REVIEW-lite e2e with FakeProvider: success path (one-round ready exit) and multi-round path (round 1 needs-revision → BUILD attempt 2 → round 2 ready). FakeProvider keyed by `(phase, agent, taskId, attempt, reviewRound)` with no hidden state.
- Full v0.9 spine e2e test (DEFINE → PLAN → BUILD → VERIFY → REVIEW) passes.
- All M8 tests still pass (1325 carried). Net new tests: ~80-100 across the M9 suite.
- Codex implementation review (rule 8) returns `push` after any fix-first commits land.
- Tag: `v0.9.0-alpha.0`.

## Don't-do list (anti-scope-creep)

- **No SHIP phase work.** SHIP is W4. M9 stops at REVIEW pass + `code-oz approve review` + worktree removal.
- **No DEBATE runtime.** `requestDebate()` is M10. REVIEW persona's `tool_use` permissions in v0.1 cover only `repo_context` + `review_request`-receipt.
- **No reviewer panel logic.** Single reviewer is M9's baseline; panels are M14 per the post-M10 productization sequence.
- **No runtime axis metrics for the five axes.** Static prompt-snapshot tests only. Behavioral drift detection is M14 territory.
- **No REVIEW.md schema additions.** Topic-1 sub-decisions locked: prompt-only borrows. Findings format unchanged. Severity enum unchanged.
- **No `scheduleAttemptNPlus1` reuse for REVIEW findings.** That function is VERIFY-specific. M9 commit 10 introduces a separate REVIEW remediation coordinator.
- **No 16-iteration cap interpretation.** Two global monotonic counters of 4 each. No per-review-round BUILD reset.
- **No persona-authored binary verdicts.** Orchestrator owns `Score.Final verdict` AND `Round timeline.<verdict>` per round.
- **No deleted-file findings.** Rejected in M9; locked convention deferred.
- **No silent partial-draft discard.** Persist under `.code-oz/runs/<runId>/review-drafts/`.
- **No accumulated transcripts in repair prompts.** Bounded grammar only.
- **No persona size > 4.2k.** Codex pushed back hard on prose-equals-authority. ~3.5-4.2k target.
- **No push to GitHub.** Local commits only (CLAUDE.md "Working in this repo" rule 5).
- **No version tag mid-milestone.** Tag `v0.9.0-alpha.0` only after Codex review verdict = `push`.

## Codex review at end (CLAUDE.md rule 8)

Before tagging:

1. Bundle the diff: `git diff main..HEAD` plus the 12-commit message log + the `feat/m9-review` HEAD sha.
2. Write `docs/research/CODEX_BRIEFING_M9_REVIEW.md` (or invoke directly with the diff bundle) — implementation review pass.
3. Invoke `mcp__plugin_agent-codex_codex-native__codex` with `gpt-5.5` xhigh, `sandbox: read-only`. Capture response as `docs/research/CODEX_REVIEW_M9.md`.
4. Codex returns one of: `push` / `fix-first` / `debate-required`. Per the no-tech-debt-at-milestone-close memory: close ALL findings (including block-next-milestone) before tagging; only nits/fyis can defer.
5. Tag `v0.9.0-alpha.0` after the review verdict is `push`.

## Resume notes

If this session crashes mid-implementation:

- Each commit is atomic. Resume by reading `git log --oneline -20` to see how far M9 progressed, then continue from the next commit in the sequence above.
- The 13 locked decisions are the spec. If a commit feels under-specified, re-read `CODEX_RESPONSE_M9.md` for Codex's exact alternative.
- The Codex debate trail (`CODEX_BRIEFING_M9.md` + `CODEX_RESPONSE_M9.md`) is immutable history. Do NOT re-run the debate. Codex's M9 implementation review fires only after all 12 commits land.
- If a contract section feels wrong mid-implementation, pause and ask Ozzy. M9 commit 1 is the only sanctioned mid-milestone contract amendment (WORKTREE.md cleanup retarget + REVIEW.md `fix-first` clarification).
- The substrate-first ordering (commit 1) is non-negotiable. Implementing REVIEW parser/prompt/loop before commit 1 lands creates work that will be rewritten when the worktree-lifetime + BUILD-provider-durability fixes land.

## After this session

The next session is **M10 — Debate runtime + `requestDebate()` primitive**:

- Branch `feat/m10-debate` from `main`.
- One new authority boundary: Debate runtime authority (CLAUDE.md rule 20).
- Codex briefing per rule 7. Codex implementation review per rule 8.
- Tag: `v0.10.0-alpha.0`.

The M10 kickoff doc gets written either at the end of M9 (if the user wants it teed up) or at the start of M10 itself.

## Three of us are building this

Cross-family debate produced this session's plan. Cross-family review will validate M9's implementation. The discipline is the product — never present "ready to proceed" without it. M9 ships that discipline as a runtime primitive: the same cross-family review the project uses to plan itself, now callable on any code change inside the gate.

End of M9 implementation kickoff.
