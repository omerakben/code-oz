# Codex response — M9 REVIEW-lite implementation

**Thread:** `019de05a-139a-7450-a439-4433006a94fe`
**Date:** 2026-04-30
**Model:** GPT-5.5
**Effort:** xhigh
**Sandbox:** read-only
**Brief:** [`docs/research/CODEX_BRIEFING_M9.md`](./CODEX_BRIEFING_M9.md)

## Verdict on the decisions

1. **accept-with-modifications.** Use REVIEW as the outer coordinator, but do not call `scheduleAttemptNPlus1` for REVIEW findings. That function is VERIFY-specific and emits `verify_restart_initiated`. Alternative: add a REVIEW remediation coordinator that writes round N, removes or preserves the current passed worktree according to the updated cleanup contract, prepares a typed review carry-forward, then hands control back to BUILD attempt N+1. VERIFY restarts between REVIEW rounds must not increment REVIEW round count.

2. **accept-with-modifications.** Orchestrator-minted run-scoped `F-NNN` ids are right. Modification: persona drafts should use existing ids or `F-NEW`; the canonicalizer assigns new ids and reuses prior ids by fingerprint `(file, normalized title, recommendation intent)`. Resolution remains persona-claimed, but the orchestrator validates only structural facts: valid round number, prior id exists, no ready exit with unresolved `block` or `fix-first`, and no id collision.

3. **accept-with-modifications.** The orchestrator must own `Score.Final verdict`. Modification: it should also own the `Round timeline.<verdict>` value. The persona owns findings, score, and rationale-like recommendation text. Canonical verdict rule: any current `block` finding means `block`; otherwise unresolved `block` or `fix-first`, or score `< 6`, means `needs-revision`; otherwise `ready`.

4. **reject.** Do not implement "multiplicative worst case" accounting. Alternative: two monotonic global counters, both scoped to `(runId, taskId)`: max 4 clean BUILD attempts total and max 4 REVIEW provider rounds total. No per-review-round BUILD reset, no 16-attempt interpretation. Whichever cap trips first owns the intervention.

5. **accept-with-modifications.** Keep the literal three layers, but M9 must fix the current weak spots. `loader.ts` currently compares provider ids, not provider families; change it to use the registry family authority. Also record the actual BUILD provider/family durably, because `BUILD_REPORT.md` does not currently have the `Provider` field the briefing assumes. Use a build event or a minimal BUILD_REPORT extension, then compare recorded BUILD family to reviewer adapter family at REVIEW invocation.

6. **accept-with-modifications.** Orchestrator-only timeline writer is correct. Modification: the persona should still see compact prior-round history through the prompt context: prior score, computed verdict, unresolved findings, and resolved ids. It should not draft timeline bullets.

7. **accept-with-modifications.** Finalize-time path validation is right. Add strict normalization: reject absolute paths, `..`, symlink escapes, path aliases, and files absent from BUILD_REPORT's changed-file manifest. Also validate cited line/range exists in the current worktree for added/modified files. Deleted-file findings need a locked convention or should be rejected in M9.

8. **reject.** Do not squeeze REVIEW findings into M8's VERIFY-shaped `Failure carry-forward` grammar as-is. It expects failed validation evidence and forensics. Alternative: land a M9-followup substrate commit before tag that introduces a typed carry-forward source: `verify-fail | review-needs-revision`. For review, serialize: prior attempt, prior review round, REVIEW.md path/sha, prior verdict `needs-revision`, summary, and constraint. Then BUILD can accept attempt > 1 from either source without schema lying.

9. **accept-with-modifications.** Two total drafts per round is right. Modification: the repair prompt must be bounded: error code, exact violated rule, and clipped offending lines only. Do not append full failed drafts across four rounds.

10. **accept-with-modifications.** Per-round atomic resume is right. Modification: do not silently discard partial drafts. Persist ignored drafts under `.code-oz/runs/<runId>/review-drafts/round-N-attempt-M.md`, but only treat a round as complete when canonical `REVIEW.md` and `review_round_completed` agree. Mismatch on resume is intervention, not replay.

11. **reject.** Do not target a larger persona because REVIEW has more surface. Alternative: target ~3.5-4.2k. Keep universal rules, tests-first, five axes, the exact false-security-coverage caveat, one full needs-revision example, and at most one tiny ready example. Put grammar in contracts and parser tests, not persona prose.

12. **accept-with-modifications.** Add a dynamic token, but make it `{{REVIEW_CONTEXT}}`, not only `{{PRIOR_ROUNDS_FINDINGS}}`. It should render round number, upstream refs, changed-file manifest, VERIFY pass summary, prior scores/verdicts, and prior findings. Keep `{{AGENT_BODY}}` static.

13. **accept-with-modifications.** Reuse `greenfield-baby-name`; that is the real existing fixture, not `greenfield-web`. Modification: FakeProvider expectations must be explicit objects keyed by `(phase, agent, taskId, attempt, reviewRound)`, with a fresh provider instance per test. Add one one-round pass e2e and one two-round remediation e2e; keep deeper cap cases in unit tests.

## Risks the proposing side missed

The biggest missed risk is worktree lifetime. M8's `preApproveVerifyHook` removes the worktree on VERIFY approval, while M9 REVIEW needs `.code-oz/runs/<runId>/worktree/` to read changed files. M9 must retarget cleanup before any REVIEW loop work: preserve the worktree through REVIEW, then remove it on `approve review` or explicitly document that SHIP owns cleanup. The current contracts and code disagree.

Cross-family laundering is not solved by frontmatter. The runtime must compare actual adapter family, not only declared agent provider. `ProviderRegistry` should reject adapter id/family mismatches unless explicitly overridden in tests, `loader.ts` should use family comparison, and REVIEW.md should record the adapter family used for the call. Otherwise a bad registry or wrapper can make a "codex" reviewer that is operationally same-family.

The BUILD provider is not durably recorded where the briefing says it is. BUILD_REPORT has no `Provider` bullet and build events do not include provider. Invocation-time REVIEW checks cannot be resume-safe until M9 records the BUILD provider/family in a durable artifact or event.

Authority overlap needs one owner per terminal failure. If REVIEW round 1 asks for revision and the follow-up BUILD exhausts VERIFY attempts, the intervention is VERIFY-owned, with context "while addressing REVIEW round 1." Do not also emit `review_blocked`; that double-terminal state will corrupt resume semantics.

Findings can ping-pong. If `F-001` resolves in round 2 and reappears in round 3, minting `F-005` hides recurrence. Use fingerprint reuse and mark the original id unresolved again in the canonical state. At cap exhaustion, intervention should name reopened findings explicitly.

Prompt drift is real across eight possible reviewer invocations. Prior-round context must be compact and canonical, not accumulated transcripts. Repair prompts should never carry full draft bodies forward.

Topic-1 false coverage should stay prompt-only in M9. Add static tests that `review-system.md` contains tests-first, five axes, and the exact security caveat. Do not add runtime axis metrics now; that would turn prompt scaffolding into a schema feature.

`fix-first` semantics are contradictory in REVIEW.md: one paragraph says it does not block exit, while the exit rule forbids ready with unresolved `fix-first`. M9 should lock the stricter rule: unresolved `fix-first` blocks `ready`.

## Where I disagree

Decision 4's "4 x 4" framing is dangerous. The implementation should never reset BUILD attempts per review round. The cap is four clean BUILD attempts total for the task, plus four review rounds total. Anything else weakens M8's restart discipline.

Decision 8 is the most underpriced. REVIEW-driven remediation is not the same thing as VERIFY failure carry-forward. Reusing the M8 shape without a source field will create fake forensics and misleading `Prior verdict` text. This needs a small substrate commit before the multi-round e2e, not a prompt trick.

The proposed reliance on M4 `requestReview` as the invocation-time check is insufficient. That primitive checks the reviewer and build provider ids it is handed. M9 still has to prove those ids came from durable run facts, not current config drift or stale registry state.

The fixture plan is directionally fine, but the fixture name drift matters. ROADMAP says `greenfield-web`; the repo has `greenfield-baby-name`. Use the repo's existing fixture and update the roadmap/demo naming if needed.

The prompt-size lean repeats the M7/M8 pattern. More prose is not more authority. Parser ownership, canonical context, and bounded repair prompts are the authority.

## What I would defer

Defer Decision 8 to a M9-followup commit before tag: first land one-round REVIEW parser/events/prompt/orchestrator, then add typed review carry-forward and multi-round remediation.

Defer any runtime false-coverage detector for the five axes. M9 gets prompt snapshot tests only; behavioral drift belongs in post-M9 eval fixtures or M14 panel measurement.

Defer prompt-size experimentation. Pick the smaller reviewer now and tune only after repair-rate data exists.

Defer SHIP cleanup policy beyond the immediate M9 correction. M9 only needs a clear rule for preserving the worktree through REVIEW and removing it at the last M9 consumer.

## Recommended next step

First, land a substrate commit that preserves the active worktree through REVIEW and records the actual BUILD provider/family durably, before implementing the REVIEW parser, prompt, or loop.
