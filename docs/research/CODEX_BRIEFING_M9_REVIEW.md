# Codex briefing — M9 implementation review (CLAUDE.md rule 8)

**Branch:** `feat/m9-review`
**HEAD:** `6f2834b70b3059ef0047c009d00f0a364674423c`
**Commits:** 0 (synthesis) + 11 (substrate + orchestrator + e2e), 12,214 insertions across 52 files
**Tests:** 1555 pass / 1 skip / 0 fail
**Typecheck:** clean
**Tag target:** `v0.9.0-alpha.0` (after this review's verdict = `push`)

This briefing requests Codex's implementation review of the M9 REVIEW-lite + cross-family handoff milestone, per CLAUDE.md rule 8 ("Codex review at implementation completion fires before tag"). Codex's planning-convergence debate (thread `019de05a`, captured in `docs/research/CODEX_RESPONSE_M9.md`) returned 3 rejects + 10 accept-with-modifications + 8 risks; the implementation absorbed all of them per the substrate-first reordering. This pass is the implementation-side review that gates `v0.9.0-alpha.0`.

## Commit set

```
388effb commit 0   docs(design): M9 synthesis (kickoff + Codex briefing/response, thread 019de05a)
3c40adb commit 1   feat(substrate): worktree lifetime through REVIEW + BUILD provider durability + family-aware loader
83b1662 commit 2   feat(agents): tool_use.review_request schema + load validation
b6891bb commit 3   feat(state): review_* event types + validators
019dfd2 commit 4   feat(artifacts): review-report parser + serializer + canonicalizer
df19fbd commit 5   feat(prompts): review-system.md template + composer
54cd5f4 commit 6   feat(agents): reviewer persona (replaces M2 stub)
ffa71c2 commit 7   feat(phases): one-round REVIEW orchestrator (M9 c7)
4ca4ebb commit 8   feat(e2e): one-round REVIEW e2e (M9 c8)
0492f38 commit 9   feat(substrate): typed carry-forward Source field (M9 c9)
936b6f7 commit 10  feat(phases): REVIEW remediation coordinator (M9 c10)
6f2834b commit 11  feat(e2e): multi-round REVIEW e2e + v0.9 spine demo (M9 c11)
```

## Authority boundary (CLAUDE.md rule 20)

M9 introduces exactly one new authority boundary: **cross-family REVIEW authority**. The 4-round loop discipline + cross-family enforcement + score+verdict exit policy are inseparable: cross-family review without bounded loop is infinite re-review; bounded loop without cross-family is self-affirmation. The two halves form one authority viewed from different angles.

## What landed (against `SESSION_M9_KICKOFF.md` § Locked decisions)

The 13 kickoff decisions, each tagged with the commit that lands it:

| # | Decision | Landed |
|---|---|---|
| 1 | REVIEW outer coordinator; no `scheduleAttemptNPlus1` for REVIEW findings; new `review-remediation.ts` (commit 10). VERIFY restarts between REVIEW rounds do NOT increment REVIEW round count. | 7 + 10 |
| 2 | Orchestrator-minted run-scoped F-NNN ids; persona uses F-NEW or existing; canonicalizer assigns + reuses by fingerprint `(file, normalized title, recommendation intent)`; ping-pong recurrence reopens original id. | 4 + 7 |
| 3 | Orchestrator owns `Score.Final verdict` AND `Round timeline.<verdict>` per round. Persona owns findings, score, recommendation. **Canonical verdict rule:** any current unresolved `block` → `block`; any unresolved `block`/`fix-first` OR `score < 6` → `needs-revision`; otherwise `ready`. Locks the stricter `fix-first` interpretation. | 4 + 7 |
| 4 | **Two monotonic global counters scoped to (runId, taskId)**: max 4 clean BUILD attempts total, max 4 REVIEW rounds total. No per-round BUILD reset. Whichever cap trips first owns the intervention. | 10 |
| 5 | Three-layer cross-family enforcement: load-time `loader.ts` family comparison via shared `familyOf()` (commit 1, new `src/providers/families.ts`); BUILD provider/family recorded durably via new `build_provider_recorded` event (commit 1); REVIEW invocation-time check compares recorded BUILD family to reviewer adapter family (commit 7). | 1 + 7 |
| 6 | Orchestrator-only `Round timeline` writer. Persona sees compact prior-round history through prompt context (prior score, computed verdict, unresolved findings, resolved ids); never drafts timeline bullets. | 4 + 7 |
| 7 | Finalize-time `File:` path validation with strict normalization: reject absolute paths, `..`, symlink escapes, files absent from BUILD_REPORT's changed-file manifest. Validate cited line/range exists in current worktree. **Deleted-file findings rejected in M9.** | 4 + 7 |
| 8 | Multi-round remediation lands as M9-followup substrate before tag, not in M8 carry-forward grammar. Typed carry-forward `Source: verify-fail \| review-needs-revision` field added. | 9 |
| 9 | 2 total drafts per round (initial + 1 repair). **Repair prompt is bounded:** error code, exact violated rule, clipped offending lines only. Never append full failed drafts. | 4 + 7 |
| 10 | Per-round atomic resume. Persist ignored partial drafts under `.code-oz/runs/<runId>/review-drafts/round-N-attempt-M.md`. Round complete only when canonical REVIEW.md AND `review_round_completed` event agree. **Mismatch on resume → intervention, not replay.** | 7 (`review-resume.ts`) |
| 11 | Reviewer persona ~3.5-4.2k. Universal rules + tests-first + five axes + exact false-security-coverage caveat + one full needs-revision example + one tiny ready example. | 6 |
| 12 | Dynamic `{{REVIEW_CONTEXT}}` token in template; `{{AGENT_BODY}}` static. | 5 + 7 |
| 13 | Reuse `greenfield-baby-name` fixture; FakeProvider keyed by `(phase, agent)` (defer reviewRound axis to commit 11+ via FIFO queue), fresh provider instance per test. | 8 + 11 |

Plus the 8 risks Codex flagged in the kickoff debate, all closed:

1. **Worktree lifetime through REVIEW** — `preApproveVerifyHook` narrowed to verdict-pass guard; new `preApproveReviewHook` removes worktree at REVIEW approval; `WORKTREE.md` retargeted. (commit 1)
2. **Cross-family laundering via runtime adapter mismatch** — `loader.ts` uses family comparison via shared `familyOf()`; new `src/providers/families.ts`. (commit 1)
3. **BUILD provider not durably recorded** — new `build_provider_recorded` event emitted post-`build_completed`. (commit 1)
4. **Authority overlap on terminal failure** — REVIEW remediation coordinator's `build_cap_blocked` decision returns "while addressing REVIEW round N" context; runReview surfaces `review_build_cap_overlap` intervention WITHOUT emitting `review_blocked` (no double-terminal state). (commit 10)
5. **Findings ping-pong across rounds** — `canonicalizeFindings` fingerprint reuse + `roundResolved='unresolved'` reopen logic. Cap-exhausted intervention names reopened ids explicitly. (commit 4 + 10)
6. **Prompt drift across reviewer invocations** — `renderRepairPrompt` produces `{error_code, violated_rule, offending_lines: ≤5}`; full failed drafts never appended. (commit 4 + 7)
7. **Topic-1 false-coverage drift detection** — prompt-only via static snapshot tests on `review-system.md` content. (commit 5)
8. **`fix-first` semantics contradiction in REVIEW.md** — strict rule locked: unresolved `fix-first` blocks `ready`; parser raises `review_unresolved_blocker` on contradiction. (commit 1 + 4)

## Files for review

The review is best targeted at the new orchestration + coordinator + substrate. In rough order of importance:

### Authority-bearing modules (where bugs hide)

- **`src/phases/review.ts`** (1432 lines) — the orchestrator. Cross-family invocation-time check; persona shim with bounded repair; canonical verdict computation; round-trip serialize → parse for grammar lock-in; review_started / review_round_completed / review_resolved / review_blocked event ordering.
- **`src/phases/review-remediation.ts`** (259 lines) — the M9 commit 10 coordinator. The three decisions (`continue`, `review_cap_exhausted`, `build_cap_blocked`); cap precedence (REVIEW first, BUILD second); reopened-id collection; orchestrator-shaped summary + constraint synthesis from unresolved findings.
- **`src/phases/review-resume.ts`** (163 lines) — per-round atomic resume primitives. Path naming, `persistReviewDraft`, `cleanupReviewDraftsForRound`, `probeReviewResume` (mismatch detection).
- **`src/artifacts/review-report.ts`** (1397 lines) — parser + serializer + canonicalizeFindings + computeCanonicalVerdict + renderRepairPrompt + the new `serializeReviewCarryForward` helper that produces `Source: review-needs-revision` carry-forward blocks for BUILD attempt N+1.
- **`src/artifacts/build-report.ts`** (changed) — `BuildReportCarryForwardSource` enum + required `source` field + parser rejection of missing/unknown Source values.
- **`src/state/schemas.ts`** (changed) — four `review_*` events + `build_provider_recorded` event with the cross-family invariant validated (`buildFamily !== reviewerFamily` on `review_started`).
- **`src/providers/families.ts`** (51 lines, new) — shared `familyOf(providerId)` lookup. Single source of truth for load-time + runtime cross-family check.
- **`src/agents/loader.ts`** (changed) — `enforceCrossFamilyReview` now uses `familyOf()` instead of literal provider id comparison.
- **`src/commands/approve.ts`** (changed) — `preApproveVerifyHook` narrowed to verdict-pass guard; new `preApproveReviewHook` removes worktree at REVIEW approval; cleanup-on-VERIFY-pass deleted (M9 commit 1 substrate retarget).

### Personas + prompts

- **`src/agents/defaults/reviewer.md`** (~3.5k body) — full reviewer persona replacing M2 stub; provider=codex; `tool_use.repo_context` (glob/grep/read on worktree) + `tool_use.review_request` (providers=[codex,gemini], maxRounds=4, timeoutMsPerRound=120000, network=provider-only).
- **`src/prompts/review-system.md`** (~3.5-4.2k) + **`src/prompts/index.ts`** `composeReviewPromptPure` — template with required tokens (`{{AGENT_BODY}}`, `{{COMMON_RATIONALIZATIONS}}`, `{{UNIVERSAL_RULES}}`, `{{AVAILABLE_TOOLS}}`, `{{READY_SIGNAL}}`, `{{REVIEW_CONTEXT}}`).

### Tests of authority-bearing claims

- `tests/review-phase.test.ts` (22 cases): entry validation, round 1 ready/needs-revision/block, persona handling (invoke-throws, ready-signal repair, both drafts fail, unknown file path), resume mismatch (stale draft + no completion event), gate_required event, Scientist tail.
- `tests/review-remediation.test.ts` (11 cases): pure decision logic for continue / review_cap_exhausted / build_cap_blocked + reopened-id surfacing + clipping of summary/constraint.
- `tests/review-remediation-integration.test.ts` (1 case): runReview round 4 needs-revision → blocked + review_blocked(reason=cap_exhausted) + NEEDS_INTERVENTION.json.
- `tests/build-report-typed-carry-forward.test.ts` (8 cases): both Source values round-trip; parser rejects missing Source (legacy M8 shape) and unknown values.
- `tests/review-needs-revision-typed-carry-forward.test.ts` (7 cases): `serializeReviewCarryForward` validation + round-trip into BUILD's parser.
- `tests/e2e/review-lite-greenfield-pass.test.ts`: full DEFINE → PLAN → BUILD → VERIFY → REVIEW (round 1 ready) → approve review (worktree gone + GATE_REVIEW_PASSED.json).
- `tests/e2e/review-lite-greenfield-multi-round.test.ts`: round 1 needs-revision → carry-forward shape → round 2 ready (with synthesized BUILD/VERIFY attempt 2 state).
- `tests/worktree-lifetime-through-review.test.ts` (commit 1): VERIFY-approve preserves worktree; REVIEW-approve removes it.
- `tests/family-aware-loader.test.ts` (commit 1): family-aware cross-family check at load time.
- `tests/build-provider-recorded.test.ts` (commit 1): event emission post-`build_completed`; durable across resume.
- `tests/fix-first-unresolved-blocks-ready.test.ts` (commit 1 + 4): the strict `fix-first` rule.
- `tests/agent-load-tool-use-review-request.test.ts` (commit 2): the `tool_use.review_request` schema validation (bounded maxRounds, providers subset of `PROVIDER_FAMILIES`, network=provider-only).
- `tests/state-events-review.test.ts` (commit 3): the four `review_*` events + cross-family invariant validation.
- `tests/review-report*.test.ts` (commit 4): parser + serializer + canonicalize + repair prompt.
- `tests/prompts-review-system.test.ts` (commit 5): topic-1 prompt-only borrows verified via static content snapshot.

## Specific review-pass requests

Per `CLAUDE.md` rule 8 + `no-tech-debt-at-milestone-close` memory: close ALL findings (including `block-next-milestone`) before tagging; only nits/fyis can defer.

I want Codex's review to specifically scrutinize:

### A. Cross-family enforcement (the load-bearing claim of M9)

1. Does `enforceCrossFamilyReview` in `src/agents/loader.ts` close every load-time path? Are there agent-config shapes where the family check would silently pass when it shouldn't?
2. Does `runReview`'s invocation-time check (commit 7) read the correct `build_provider_recorded` event? Specifically: the latest event for `(runId, taskId, attempt)`, where `attempt` is derived from BUILD_REPORT.md's task.attempt. Is there a race window where a stale event from a prior attempt could be picked up?
3. Is the `review_started` event's `buildFamily` field validated against the BUILD agent's actual resolved family at runtime? Or could a misconfigured runtime adapter declare one family but resolve as another?
4. The `families.ts` default mapping is `{claude→claude, codex→codex, gemini→gemini, fake→fake}`. Is this correct given v0.1 doesn't yet ship `claude-cli`/`anthropic-api` adapters that would share family `claude`?

### B. Cap composition (the no-infinite-loop guarantee)

1. Two monotonic global counters scoped to `(runId, taskId)`: REVIEW rounds + BUILD attempts. Are there scenarios where decideReviewRemediation's tally could miscount? Specifically: what if events.jsonl has a `review_round_completed` for a round that never wrote a canonical REVIEW.md (orphan event)?
2. The cap precedence is REVIEW first, BUILD second. Is there a case where REVIEW round 4 needs-revision + BUILD attempts already at 4 should yield `review_cap_exhausted` (which loses the BUILD context)? Or should that produce a layered intervention?
3. `runReview` on round 4 needs-revision exits as `blocked` (not `needs_revision`). The `verdict` field is set to `'block'` in the result. Is this honest? The canonical verdict rule says round 4's verdict is still `needs-revision`; we're conflating "REVIEW-loop terminal state" with "round-N canonical verdict". Should the result type carry both?

### C. Authority overlap (VERIFY-cap during REVIEW remediation)

The handoff says: "VERIFY restarts during a REVIEW remediation BUILD attempt do NOT increment `reviewRoundsUsed`. The intervention is VERIFY-owned with 'while addressing REVIEW round N' context. REVIEW round count does not advance, and `review_blocked` is **not** emitted in this path."

1. Is this enforced anywhere at runtime? Currently `decideReviewRemediation` returns `build_cap_blocked` with the right context message, but the actual VERIFY-cap intervention happens in `runVerify` → `decideRestart` (restart-policy.ts), which doesn't know about REVIEW context. Is the contract honored end-to-end, or is there a gap where a VERIFY-cap during REVIEW remediation produces a generic VERIFY intervention that doesn't mention REVIEW round N?
2. Should `restart-policy.decideRestart` accept an optional `currentCarryForwardSource` parameter and inject the "while addressing REVIEW round N" context when source = `review-needs-revision`?

### D. Ping-pong detection (the no-fake-progress guarantee)

1. `canonicalizeFindings`'s fingerprint = `(file, normalized title)`. Is this fingerprint stable enough? E.g., a persona that rephrases the same finding ("`topN` is missing edge case docs" vs. "missing edge-case docs in `topN`") would mint different fingerprints. Should the fingerprint be looser (drop file or normalize more aggressively)?
2. The cap-exhausted reason names reopened ids explicitly. But `collectReopenedIds` includes ids whose `roundRaised < priorRound` AND `roundResolved === 'unresolved'` AND severity is block/fix-first. This conflates "reopened by ping-pong" with "raised in a prior round and never resolved". Is the conflation worth surfacing more granularly?

### E. Bounded repair prompt (the no-prompt-drift guarantee)

1. `renderRepairPrompt` clips at 5 offending lines. The repair flow runs ONCE; if the second draft still fails, runReview surfaces a terminal intervention. Is one repair turn enough? The verify.ts pattern uses one repair too, so consistency is good — but does REVIEW's larger response (Findings + Score) have more failure modes per draft, justifying two repair turns?
2. `runRepair`'s second draft also runs path validation; if the persona keeps citing an unknown file, the second-draft path-issue surfaces as `review_finding_path_unknown` terminal. The first-draft grammar-issue and second-draft path-issue could both be present; runReview only surfaces one. Is that OK?

### F. Per-round atomic resume (the no-replay-on-stale-draft guarantee)

1. `probeReviewResume` checks: draft on disk for round N AND no `review_round_completed` event for `(taskId, attempt, round)`. The path is `round-N-attempt-1.md`. What if attempt-2 draft exists but attempt-1 doesn't? Probe says no draft — does that mean the resume mismatch wouldn't fire?
2. `cleanupReviewDraftsForRound` runs after the canonical write. If the canonical write succeeded but cleanup failed, the next runReview() for the SAME round (a re-invocation) would see a stale draft + a matching `review_round_completed` event → probe says "no mismatch" → but what does the orchestrator do then? Re-run round N? That's not idempotent.

### G. Scientist phase-tail at REVIEW gate

1. `runScientistPhaseTail` is invoked on both `verdict: ready` and `verdict: block` branches. Is gate-preflight (validateScientistSidecars) only on the `ready` branch correct? On `block`, the run has already produced a NEEDS_INTERVENTION; should the Scientist tail still run + check for blocking questions?
2. The Scientist tail invocation passes `phase: 'review'`, which the existing scientist.ts runner handles generically. The handoff doc said "add a REVIEW branch (3/3 cap; reads REVIEW.md plus prior sidecars; severity-block / fix-first findings escaping a `ready` exit (which the schema does not permit) seed Q-NNN open questions)". I left scientist.ts unchanged, reasoning that the schema already prevents the parenthesized case. Was that a correct reading of the requirement, or did I miss something?

### H. The new typed carry-forward (M9 commit 9)

1. `BuildReportCarryForwardSource` is a locked enum; the parser rejects missing or unknown values. Existing M8 BUILD_REPORT.md fixtures (including those produced by an in-flight v0.8 run resumed under v0.9) would fail the parse. Is there a v0.8 → v0.9 migration story, or is the parser strictness intentional (the no-tech-debt rule says yes)?
2. `serializeReviewCarryForward`'s `priorVerdict` is orchestrator-shaped: `needs-revision (round N, sha XXX)`. Is this string a stable interface that BUILD's persona can rely on? Or should it be a structured field?

### I. The remediation coordinator's three decisions

1. The `synthesizeRemediationDirective` synthesis from unresolved findings produces a 200-char-clipped summary + constraint. Is this synthesis stable across rounds? E.g., findings reordering between rounds would produce different summaries.
2. The fallback case (no unresolved blockers + score < 6) produces a generic "address feedback noted in REVIEW.md" constraint. Is that actionable enough for BUILD attempt N+1?

### J. Test coverage gaps

1. The multi-round e2e test `tests/e2e/review-lite-greenfield-multi-round.test.ts` synthesizes BUILD attempt 2 + VERIFY attempt 2 directly (without invoking runBuild + runVerify) to avoid the worktree revert+reapply complexity. Does this synthesized state cover the real multi-round contract, or is there a class of bugs that only a real-runBuild attempt-2 would catch?
2. The kickoff lists `tests/e2e/spine-greenfield.test.ts` as a separate file; my commit 11 noted that `tests/e2e/review-lite-greenfield-pass.test.ts` already covers the full DEFINE→REVIEW chain and that creating a duplicate is ceremony. Was that a defensible call, or should the spine smoke be a separate file with different assertion focus?
3. Cap-edge cases: I have a test for round 4 needs-revision → cap_exhausted. I do NOT have a test for round 1 needs-revision with `buildAttemptsUsed === 4` (the build_cap_blocked path). Worth adding?

## Verdict format

Per the M1 + M2 + M3 + M4 + M5 + M6 + M7 + M8 review precedent, please return one of:

- **`push`** — implementation is sound; tag `v0.9.0-alpha.0`.
- **`fix-first`** — at least one block-push or block-next-milestone finding; address before tag. List findings by severity.
- **`debate-required`** — a fundamental design decision needs a fresh round of debate; describe the alternative.

For each finding, include: id (e.g., bp#1, fs#2, n#3), severity (`block-push` / `block-next-milestone` / `fix-soon` / `nit` / `fyi`), file:line citation, what's wrong, why it matters, and a concrete remediation.

The CLAUDE.md no-tech-debt-at-milestone-close rule is in effect: close ALL findings (incl. block-next-milestone) before tagging. Only `nit` and `fyi` can defer.

## Configuration

- Model: `gpt-5.5` xhigh
- Sandbox: `read-only`
- The full diff is on the branch; HEAD = `6f2834b`. Inspect any file directly via `git show 6f2834b:<path>` or by checking out the branch.

End of briefing.
