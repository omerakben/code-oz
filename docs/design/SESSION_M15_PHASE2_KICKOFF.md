# M15 Phase 2 — Production fire-path wiring

**Locked:** 2026-05-08
**Branch:** `feat/m15-debate-scheduler` at `38f2c10`
**Authority boundary:** unchanged — orchestrator-side automatic-trigger policy for existing single-opponent `requestDebate()`. Phase 2 makes the existing M15 authority real, not a new one (see rule 20 analysis in replan response).

## Trigger and ground

Codex R1 (`docs/research/CODEX_REVIEW_M15.md`, thread `019e092f`) returned `fix-first` on `38f2c10` with 5 block-push + 4 fix-soon findings. Codex replan round (`docs/research/CODEX_RESPONSE_M15_REPLAN.md`, thread `019e093d`) returned `accept-with-modifications` on Path B.

The central problem: production `firePathExecutor` is never wired at `src/phases/review.ts:949` (single) and `:2066` (panel). `decision.fire === true` silently returns `fired: false`. Rule-21 ship gate proves fixture math, not scheduler behavior.

This kickoff locks the C12-C19 commit sequence that closes the 5 block-push + 4 fix-soon before tag.

## Locked design decisions (Phase 2)

1. **Path B**: reshape M15 to include full production wiring; tag once at end. (Path A telemetry-only rejected — too clever for a milestone whose ROADMAP claims production scheduling.)

2. **A1 — drop BUILD-family-exclusion clause** from `DEBATE_POLICY.md` and `SESSION_M15_IMPL_KICKOFF.md`. The runtime invariant is caller-family != opposing-provider-family. Rule 2 already enforces BUILD vs REVIEW cross-family at the REVIEW gate. The debate is challenging the REVIEW verdict, not certifying BUILD. Bundled `opposingProviders: ['claude']` is steel-manning posture, not a bug. **Replacement language pinned in C19 task.**

3. **Factored shape for C12**: `runReviewRoundLocked(opts, now)` private function. Outer `runReview` holds `.review.lock`; extracted body never touches lock state. Body MUST support `schedulerEnabled: 'enabled' | 'disabled_post_debate'` flag to prevent recursive scheduler fire from post-debate REVIEW round.

4. **Fire-path contract reshape (C13a)**: `debate_scheduler_fired` event MUST emit BEFORE `requestDebate()`. Current order at `src/phases/review-scheduler-hook.ts:400-473` emits `fired` AFTER executor returns; `requestDebate` emits `debate_started` inside the executor body — so real-world ordering would be `evaluated → debate_started → fired`. Resume contract assumes `fired` precedes `debate_started`.

5. **C16 reducer is a redesign, not a test reversal**. Current `collectFires` drops orphaned fires from denominator (`src/commands/doctor-debate-baseline.ts:244-270`). Contract says denominator = total fired count (`docs/contracts/DEBATE_POLICY.md:144,150`). Fix: count every `debate_scheduler_fired`; classify missing/error as non-corrective and non-actionable; surface error/missing counts in baseline report.

6. **C17 must FAIL on the current no-op path**. The proof is real production scheduler-fire events feeding into the baseline reducer. Use `buildProviderRegistry({ providerOverride: 'fake' })` (preserves per-id families while routing through FakeProvider; see `src/cli/bootstrap.ts:125-180`). Single mode first, panel after.

7. **Panel cannot prove corrective-delta** (panel `verdictPre/Post='panel'` is not oracle-comparable). Panel contributes new-actionable + no-signal telemetry only. Single mode is the corrective-delta proof.

8. **C18 minimal resume detection only.** Three crash points named in `DEBATE_POLICY.md:166-176`. Conservative: detect + emit `debate_scheduler_error` + raise `NEEDS_INTERVENTION`. Broader auto-resume UX deferred.

## Commit sequence (C12-C19)

| # | Slice | Files | Acceptance |
|---|---|---|---|
| C12 | Extract `runReviewRoundLocked` (single mode) + finalization helper | `src/phases/review.ts`, `tests/review-phase.test.ts` | Pure refactor; test count unchanged; typecheck clean; flag `schedulerEnabled` defaults to 'enabled' |
| C13a | Reshape fire-path contract: `fired` emits before `requestDebate` | `src/phases/review-scheduler-hook.ts`, `tests/review-scheduler-fire.test.ts` | Mock-executor tests updated; event ordering invariant locked in tests |
| C13b | Wire single-mode production executor in `review.ts:949` | `src/phases/review.ts`, `src/providers/cost.ts` (call site only), tests | Aggregate preflight wired; `requestDebate` called; post-debate round via `runReviewRoundLocked('disabled_post_debate')`; intervention/error mapping per Failure surface |
| C14 | Extend executor to panel mode at `review.ts:2066` | `src/phases/review.ts` (panel branch), tests | Panel-aware preflight; postreview emits new-actionable + no-signal telemetry only |
| C15 | Real fingerprint/severity diff in postreview emission | `src/phases/review-scheduler-hook.ts` (or new helper), `src/state/events.ts` (validation tightening), tests | `actionableFindingsAddedCount` computed from ReviewReportData diff; severity filter `{block, fix-first}` |
| C16 | Fix baseline reducer denominator + error/missing visibility | `src/commands/doctor-debate-baseline.ts`, `tests/commands-doctor-debate-baseline.test.ts` | Locked test assertions at `:327,349` reversed; new assertions for corrected denominator; error/missing counts surfaced |
| C17 | Generated FakeProvider production e2e | `tests/e2e/debate-scheduler-production-baseline.test.ts` (new), possibly fixtures helpers | Test FAILS on `38f2c10` (current no-op) and PASSES once C13b lands; uses `buildProviderRegistry({ providerOverride: 'fake' })` |
| C18 | Minimal resume detection | `src/phases/review.ts` (resume entry), tests | Three crash points detected; emits `debate_scheduler_error` + `NEEDS_INTERVENTION` |
| C19 | Doc updates + ROADMAP correction | `docs/contracts/DEBATE_POLICY.md`, `docs/design/SESSION_M15_IMPL_KICKOFF.md`, `docs/design/ROADMAP.md`, `tests/agents-reviewer-debate-permission.test.ts` (comment drift) | LAST commit; only after all tests pass; ROADMAP no longer claims premature closure |

## Replacement DEBATE_POLICY.md language (for C19)

Insert/replace the opponent-family invariant section:

```md
## Opponent-family invariant

Scheduler-fired debate uses the existing M10 `tool_use.debate` permission and
`requestDebate()` runtime checks. The runtime invariant is caller-family !=
opposing-provider-family. M15 does not require the opposing provider to differ
from the original BUILD provider family, because REVIEW has already enforced
BUILD-family != REVIEW-family before the scheduler can run. A reviewer persona
may choose to exclude BUILD-family opponents for stricter independence, but the
bundled reviewer intentionally allows a BUILD-family opponent to steelman the
BUILD-favorable side. REVIEW remains the gate authority; debate output is
evidence for a post-debate REVIEW round, not a gate decision.
```

## Verification gate before tag

After C19, all of these must hold on the post-Phase-2 SHA:

- `bun test` — 2700+ pass / 0 fail / 1 skip (estimated +30 from C13b, +20 from C17, +15 from C18, +10 from C16; subtractions possible from C16 test rewrites)
- `bun run typecheck` — clean
- `bun run dev doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` — exits 0; `passedRuleTwentyOne: true`
- `bun run dev doctor --debate-policy` — runs without error
- C17 generated e2e — passes against real production-emitted events
- Codex R2 verdict — `push` (no block-push or fix-soon)

## Rules of engagement

- One single-axis slice per commit (rule 20). C13a + C13b can land separately if patches are large; C12 must be pure refactor.
- No future-milestone leakage: no multi-opponent debate, no Researcher tail, no pre-VERIFY scheduling, no scheduler persona, no new permission scope, no new gate file.
- After each commit: `bun test` + `bun run typecheck` clean before moving to the next commit.
- Commit messages follow conventional format. No "update memory" in subject lines. No emojis.
- Branch stays `feat/m15-debate-scheduler`; no merge to main until R2 says push.

## Defer to post-M15

- Path C / M15.5 (rejected)
- A2 BUILD-family-exclusion (unworkable until non-codex-non-claude bundled opponent exists)
- A3 persona-configurable BUILD-family exclusion (M16+ if needed)
- Panel corrective-delta oracle semantics
- Broad auto-resume UX
- Cost/latency floors as ship gates
- Advisory-block triggers, verdict-confidence triggers, pre-VERIFY scheduling, scheduler persona, multi-opponent debate
