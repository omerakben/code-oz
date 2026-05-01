# M9 overnight session summary (2026-04-30 → 2026-05-01)

**For:** Ozzy. Goodnight handoff at v0.8.0-alpha.0 + M9 commits 1–6. Morning state at v0.9.0-alpha.0 merged to main.

---

## Headline

- **v0.9.0-alpha.0 tagged and merged to main** (local; no GitHub push).
- **1578 tests pass / 1 skip / 0 fail. Typecheck clean.**
- **All Codex review findings closed** across 3 review rounds (push verdict on round 3).
- **All overnight-agent findings addressed** (security, code review, quality engineering).
- **No tech debt at milestone close** — only fyis / nits deferred per CLAUDE.md rule.

main is at merge commit `20aacd6`; the milestone commit is `644f39b` (where the tag points).

---

## What landed (commits)

19 implementation commits (M9 commits 0–11) followed by 13 review/fix/cleanup commits (12–24) + the milestone summary commit:

```
M9 commit 0   docs(design): synthesis (kickoff + Codex briefing/response, thread 019de05a)
M9 commit 1   feat(substrate): worktree lifetime through REVIEW + BUILD provider durability + family-aware loader
M9 commit 2   feat(agents): tool_use.review_request schema + load validation
M9 commit 3   feat(state): review_* event types + validators
M9 commit 4   feat(artifacts): review-report parser + serializer + canonicalizer
M9 commit 5   feat(prompts): review-system.md template + composer
M9 commit 6   feat(agents): reviewer persona (replaces M2 stub)
M9 commit 7   feat(phases): one-round REVIEW orchestrator (runReview)
M9 commit 8   feat(e2e): one-round REVIEW e2e
M9 commit 9   feat(substrate): typed carry-forward Source field
M9 commit 10  feat(phases): REVIEW remediation coordinator (multi-round)
M9 commit 11  feat(e2e): multi-round REVIEW e2e + v0.9 spine demo
M9 commit 12  docs(research): Codex implementation review (verdict: fix-first)
M9 commit 13  fix(approve): bp#1 — preApproveReviewHook validates REVIEW.md + sha-bound review_resolved
M9 commit 14  fix(phases): bp#2 — VERIFY.md ↔ BUILD_REPORT.md upstream-ref cross-check
M9 commit 15  fix(phases): bp#3 — deleted-file rejection + line-range existence
M9 commit 16  fix(providers): bp#4 — ProviderRegistry validates adapter family vs familyOf(id)
M9 commit 17  fix(state,phases): fs#1 + fs#2 — canonicalize-throw catch + reviewReportSha256 in event
M9 commit 18  fix(phases): bp#3 follow-ups (symlink escape via realpath, Line: 0) + bp#4 phase-level test + fs#2 message branching
M9 commit 19  docs(research): Codex re-review verdicts (fix-first → push)
M9 commit 20  refactor(m9): Codex workspace-write cleanup pass (autonomous)
M9 commit 21  fix(worktree): security audit MEDIUM-2 — runPaths validates runId as ULID
M9 commit 22  fix(phases): QA 1.1 — concurrency lock for runReview orchestration
M9 commit 23  fix(phases,artifacts): QA 5.2 + 4.1 + 4.4 — validation hardening
M9 commit 24  chore(tests): code-reviewer L4 — remove dead void appendEvent in commit-8 e2e
v0.9 summary  v0.9.0-alpha.0 milestone commit (CLAUDE.md status + version bumps)
Merge         feat/m9-review → main (--no-ff, matches v0.7/v0.8 pattern)
```

The tag v0.9.0-alpha.0 points to the milestone summary commit `644f39b`.

---

## Authority boundary closed (CLAUDE.md rule 20)

M9 introduced exactly one new authority boundary: **cross-family REVIEW authority**. The 4-round loop discipline + cross-family enforcement + score+verdict exit policy ship as one coherent authority. M10 is Debate runtime authority — no preemption.

---

## Three-round Codex implementation review

Per CLAUDE.md rule 8 ("Codex review at implementation completion fires before tag"). Captured in `docs/research/CODEX_REVIEW_M9.md`:

| Round | Thread | HEAD | Verdict | Findings |
|---|---|---|---|---|
| 1 | `019de0cf` | 6f2834b (commit 11) | fix-first | 4 block-push (bp#1–4) + 2 fix-soon (fs#1–2) |
| 2 | `019de138` | a15c44e (commit 17) | fix-first | bp#3 sub-issues (symlink, Line:0) + bp#4 test gap + fs#2 message gap |
| 3 | `019de140` | 100b9da (commit 18) | **push** | All closed |

The discipline worked: cross-family review caught real bugs at the planning convergence (3 architectural rejects + 8 risks), the implementation review (6 findings), and the re-review (4 follow-ups). Closure-by-closure source inspection on round 3.

---

## Overnight agent findings (post-tag, pre-merge)

After Codex round-3 push verdict, three Claude agents + one autonomous Codex workspace-write pass reviewed the M9 surface in parallel:

### Security audit (security-auditor agent)

| Severity | Finding | Status |
|---|---|---|
| MEDIUM | Event log JSON injection via newlines in string fields | **False positive** (JSON.stringify escapes newlines as `\n` literal; documented at `events.ts:114`) |
| MEDIUM | Worktree path traversal via runId | **Closed** — commit 21 added ULID validation to all worktree path helpers |
| INFO | Symlink TOCTOU window | Accepted (filesystem-write attacker already has arbitrary code execution; line-count-only readback) |

### Quality engineering (quality-engineer agent)

| Priority | Finding | Status |
|---|---|---|
| Material | 1.1 — runReview concurrency TOCTOU | **Closed** — commit 22 added `<runDir>/.review.lock/` mkdir-as-mutex |
| Material | 5.2 — reversed line ranges silently accepted | **Closed** — commit 23 |
| Material | 4.1 — duplicate fingerprints in same draft | **Closed** — commit 23 |
| Doc-test | 4.4 — explicit-id reopen tracking | **Closed** — commit 23 |
| Doc-test | 2.3, 2.4, 2.5 (crash recovery edge cases) | Documented as accepted limitations / covered behavior |
| Doc-test | 3.1, 3.3, 5.1, 5.3, 5.4, 6.1, 6.2, 7.1, 7.2 | Deferred (documentation-style tests) |

### Code review (pr-review-toolkit:code-reviewer agent)

| Severity | Finding | Status |
|---|---|---|
| Medium | M3 — `findReviewResolvedFor` double-cast | **Closed** — commit 20 (Codex cleanup) |
| Low | L4 — dead `void appendEvent` in commit-8 e2e | **Closed** — commit 24 |
| Medium | M1, M2 — duplicate parsing helpers (2x today) | Deferred ("DRY at 3x" not yet triggered; sits at the line) |
| Medium | M4 — stale "M9 commit X" comments | Deferred to M10 cycle (one-pass cleanup later) |
| Medium | M5 — reviewer persona repo_context unused at runtime | **By design** — reserved for M10 debate runtime |
| Nit | N1, N2, N3 | Advisory; no action |

### Codex workspace-write cleanup (autonomous, gpt-5.5 xhigh)

Per Ozzy's "give Codex more access" directive: invoked with `sandbox: workspace-write, approval-policy: never`. 14 behavior-preserving changes committed as commit 20:

- Type guards (`isReviewSeverity`, `isReviewVerdict`) replacing parser `as` casts
- Named constants (`REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS`, `REVIEW_ROUND_MIN/CAP`, etc.)
- Stale comment cleanup
- Removed redundant `as ProviderId` casts after the bp#4 registry switch
- `findReviewResolvedFor` typed event guards (closes code-reviewer M3)
- Helper extractions for repeated intervention/error clipping

---

## What's queued for M10

1. **M10 — Debate runtime + `requestDebate()` primitive** (the Codex-confirmed next milestone).
2. The deferred M-prefix items from the code-reviewer agent (M1, M2, M4) can land as one cleanup commit early in M10.
3. **No tag will be moved or amended.** v0.9.0-alpha.0 is locked at `644f39b`.

Post-M10 productization sequence (locked 2026-04-30 from product thesis pressure-test, `docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`): M11 = Provider capability contract; M12 = Company roster (shipped roles only); M13 = Role-cost policy under `budgets.global`; M14 = Reviewer panel v1 (first simultaneous-provider surface); M15 = Debate-policy scheduler v1.

---

## Files of interest in this drop

- **`src/phases/review.ts`** (1769 lines) — the orchestrator. Cross-family invocation-time check, persona shim with bounded repair, validateFindingPaths (deleted-file rejection + line-range bounds + symlink escape via realpath), concurrency lock via `<runDir>/.review.lock/`.
- **`src/phases/review-remediation.ts`** (260 lines) — the coordinator (M9 commit 10). The three decisions: `continue`, `review_cap_exhausted`, `build_cap_blocked`. Authority overlap rule for VERIFY-restart-during-REVIEW.
- **`src/phases/review-resume.ts`** (212 lines) — per-round atomic resume. Mismatch detection with `reason: 'no_completed_event' | 'sha_mismatch'` distinction.
- **`src/artifacts/review-report.ts`** (1440 lines) — parser + serializer + canonicalizer + `serializeReviewCarryForward` (M9 commit 9 substrate). canonicalizeFindings rejects same-draft duplicate fingerprints (commit 23 QA 4.1) + tracks explicit-id reopens (commit 23 QA 4.4).
- **`src/providers/registry.ts`** — adapter family validation at construction (commit 16 bp#4). Closes the laundering hole.
- **`src/worktree/paths.ts`** — every helper validates `runId` as ULID (commit 21 security MEDIUM-2). Closes path traversal.
- **`src/commands/approve.ts`** — `preApproveReviewHook` parses REVIEW.md + checks `Final verdict: ready` + verifies `review_resolved.reviewReportSha256` matches the on-disk artifact (commit 13 bp#1).
- **`src/state/schemas.ts`** + **`src/state/events.ts`** — review_* events, `build_provider_recorded` event, `reviewReportSha256` required on `review_round_completed` (commit 17 fs#2).

---

## Final state

```
$ git log --oneline -10 main
20aacd6 Merge feat/m9-review: M9 REVIEW-lite + cross-family handoff (v0.9.0-alpha.0)
644f39b v0.9.0-alpha.0 — M9 REVIEW-lite + cross-family handoff (...)
f710c96 chore(tests): M9 commit 24 — code-reviewer L4: remove dead void appendEvent
7537bde fix(phases,artifacts): M9 commit 23 — QA 5.2 + 4.1 + 4.4
b8066c9 fix(phases): M9 commit 22 — QA 1.1: concurrency lock
17c0c3e fix(worktree): M9 commit 21 — security audit MEDIUM-2
f9c761e refactor(m9): commit 20 — Codex workspace-write cleanup pass
3498bcc docs(research): M9 commit 19 — Codex re-review verdicts (fix-first → push)
100b9da fix(phases): M9 commit 18 — Codex re-review follow-ups
a15c44e fix(state,phases): M9 commit 17 — fs#1 + fs#2

$ git tag -l v0.*
v0.1.0-alpha.0
v0.2.0-alpha.0
v0.3.0-alpha.0
v0.4.0-alpha.0
v0.5.0-alpha.0
v0.6.0-alpha.0
v0.7.0-alpha.0
v0.8.0-alpha.0
v0.9.0-alpha.0   ← tagged at 644f39b

$ bun test
1578 pass / 1 skip / 0 fail (3978 expects, 121 files, ~12s)

$ bun run typecheck
clean
```

Local merge only. Per CLAUDE.md "Working in this repo" rule 5 the merge is NOT pushed to GitHub. main is 29 commits ahead of `origin/main`; the M8 + M9 work has never been pushed.

---

End of overnight summary.
