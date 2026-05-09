# Session kickoff — M15 implementation: Debate-policy scheduler v1

> Source of truth for Phase 2. Synthesized 2026-05-08 from `docs/research/CODEX_BRIEFING_M15.md` + `docs/research/CODEX_RESPONSE_M15.md` (Codex `gpt-5.5 xhigh`, thread `019e0561-3c95-72a2-b786-056eb685307f`, verdict `accept-with-modifications`).
>
> Repo state at draft time: `main` clean at `34d1dbe`, tag `v0.15.0-alpha.0` on `3572514`. Default no-push policy applies.
>
> This doc supersedes `docs/design/SESSION_M15_KICKOFF.md` for implementation. The earlier kickoff documented Phase 0/1 (context recovery + Codex debate); Phase 1 is now closed and this doc locks Phase 2.

---

## 1. Locked scope (one new authority boundary, rule 20)

**M15 ships:** an automatic-trigger policy for the existing single-opponent `requestDebate()` runtime built in M10. Orchestrator-side mechanical predicate — no LLM consulted in the decision. Default mode `manual` preserves M10 behavior unchanged.

**Out of scope (deferred to M16+):**
- Multi-opponent debate
- Researcher fan-out / phase-tail
- New permission sub-scope (`tool_use.debate.scheduler`)
- New persona role (the scheduler is mechanical, not an LLM)
- Pre-VERIFY trigger surface
- Verdict-confidence as a primary signal
- Auto-debate-on-advisory-block trigger
- Multi-opponent variants of `requestDebate()`
- Auto-resume from partial debate state
- Cost / latency as hard ship gates (telemetry only)

**Tag target:** `v0.16.0-alpha.0` on the Codex-blessed SHA (R-final), default no-push.

---

## 2. Decisions locked from Codex triage

The brief's §4 design choices stand with the following amendments (each is `accept` from `CODEX_RESPONSE_M15.md` triage table unless noted):

### 2.1 Reviewer permission decision (Ozzy locked 2026-05-08)

**Path chosen: A — bundled `src/agents/defaults/reviewer.md` is granted `tool_use.debate`.**

Rationale: rule 21 baseline must be measurable on the canonical fixture path the shipped product takes. Path B (persona-opt-in) makes the baseline a property of customization, not the bundled product, and the rule-21 ship gate would prove "scheduler works on this fixture" without proving "scheduler works on what users get out of the box."

Cost accepted: cross-family discipline is now baked into the bundled reviewer's permission shape. The reviewer's `tool_use.debate.opposingProviders` list must be populated such that every entry passes M11 eligibility AND differs in family from the reviewer's own provider family. Concrete scope (commit 8): `opposingProviders: [claude]` (the reviewer ships `provider: codex`; gemini is a stub with `eligiblePhases=NO_PHASES` so M11 filters it; xai requires operator-configured API-key auth that bundled defaults stay conservative on). `maxRounds: 1`, `timeoutMsPerRound: 120000`, `maxConcurrent: 1`, `network: provider-only`, `maxFiles: 16`, `maxTokens: 32000`. The exact YAML is locked in §11.8.

**M15 Phase 2 A1 lock (`docs/research/CODEX_RESPONSE_M15_REPLAN.md` Q2, 2026-05-08)**: the original kickoff text required opposing-provider != BUILD-family AND != reviewer-family. The BUILD-family-exclusion clause is dropped: the load-bearing invariant is opposing-family != REVIEW-family (enforced by M10 `requestDebate()` runtime + load-time validator at `src/agents/schema.ts:402-424`). Rule 2 already enforces BUILD-family != REVIEW-family at the gate before the scheduler can run; the debate challenges the REVIEW verdict, not certifies BUILD. The bundled reviewer intentionally allows a BUILD-family opponent (claude) to steel-man the BUILD-favorable side. A reviewer persona may still choose to exclude BUILD-family opponents for stricter independence; that's a persona configuration choice, not a runtime invariant.

### 2.2 Trigger split — panel vs single (Codex Risk #1)

The brief's §4.2 conflated panel-mode and single-mode triggers. M14 panel REVIEW does NOT have a numeric `Score.Final score` — the canonical artifact uses the literal string `panel` and `review_resolved.finalScore=10` is a compatibility sentinel only.

**Locked split:**

| Mode | Triggers (logical OR; any matched fires) |
|---|---|
| `single` | (a) `score_in_grey_zone`: `Score.Final score ∈ [triggers.reviewScoreGreyZone.min, max]` (default `[5, 7]`); (b) `needs_revision_with_high_score`: `Score.Final verdict === 'needs-revision' AND Score.Final score >= 6` |
| `panel` | `panel_voter_disagreement`: ≥2 eligible voters return distinct verdicts (one ready, one needs-revision OR one block) |

Panel mode does NOT consult `Score.Final score`. Score-grey-zone is single-mode only. `needs_revision_with_high_score` is single-mode only (panel mode has no synthesized numeric score to gate on).

Advisory voters raising `block` are NOT a trigger in v1. (Codex Q5 rejected; deferred to M16+.)

### 2.3 Event correlation fields (Codex Risk #3)

`runId/taskId/attempt` is insufficient once an extra REVIEW round is inserted. Every scheduler event MUST carry the following correlation fields where applicable:

| Field | Type | Required on event | Purpose |
|---|---|---|---|
| `decisionId` | `string` (ULID) | all scheduler events | Unique per scheduler decision; joins evaluated/fired/skipped/error to a single trace |
| `reviewRound` | `number` (1-indexed) | all scheduler events | Pre-debate REVIEW round that produced the input |
| `preReviewReportSha256` | `string` (hex) | `evaluated`, `fired`, `skipped` | sha256 of the pre-debate REVIEW.md content (canonical artifact at decision time) |
| `debateTopic` | `string` | `fired` only | Joins to `debate_started.topic` for the resulting debate |
| `postReviewReportSha256` | `string` (hex) | new event `debate_scheduler_postreview` (commit 4b) | sha256 of the post-debate REVIEW.md content; pairs with `preReviewReportSha256` for verdict-flip metric |
| `inputDigest` | `string` (hex) | `evaluated` only | Canonicalized SchedulerInput sha256; reproducibility for rule-21 baseline |

The rule-21 baseline command joins `(decisionId, preReviewReportSha256, postReviewReportSha256)` to compute verdict-flip and new-finding-rate.

### 2.4 Lock-collision fix (Codex Risk #4)

`runReview()` acquires `.review.lock` per phase. The brief's §4.1 "extra REVIEW round runs" naively recurses into `runReview()` from the post-verdict hook → lock contention.

**Locked path: factor the round body, not return-and-loop.**

Rationale: return-and-loop pushes scheduler state into the outer orchestrator, which would either require the outer to know about scheduler internals (couples authority) or require a new persistent "scheduler-pending" state file (rule 1 + new state surface, bundling).

Implementation shape (commit 4b):
- Extract the lock-free round body from `runReview()` into a private internal `runReviewRoundLocked(opts)` that the outer `runReview()` already holds the lock for.
- The post-verdict hook (still inside the outer `runReview()` stack frame, lock still held) calls the scheduler. If the scheduler fires, the hook invokes `requestDebate` (which has its own concurrency cap, see §2.6), then calls `runReviewRoundLocked` directly to run the post-debate round under the existing lock.
- Per-round cap (4-round max from M9) still enforced — the post-debate round consumes one of the 4 slots.

If the scheduler fires on the 4th round (last allowed under the cap), the post-debate round is the *5th attempt* in spirit but the *4th REVIEW round in the cap accounting*: the pre-debate-on-round-4 finding state is replaced by the post-debate-on-round-4 finding state, and the gate writes from the post-debate result. No 5th round. (This matches "REVIEW always wins, debate is signal" from §2.10.)

### 2.5 Aggregate budget preflight (Codex Q6)

The scheduler MUST refuse to fire if the *worst-case full-transaction* cost would tip `budgets.global`. Worst-case transaction = opposing turn + synthesis turn + post-debate REVIEW round (which itself is panel-aware: in panel mode, the post-debate round runs the full panel of eligible voters).

Preflight logic (commit 5):
- Compute expected token cost from `priceTable` + persona's declared `maxTokens` (debate budget) + post-debate REVIEW round token estimate from M14's panel preflight machinery.
- Call `assertWithinBudget` with the projected cumulative spend; if it would warn at `softWarnAtRatio` AND firing pushes past the warn threshold, emit `debate_scheduler_skipped { reason: 'budget_exhausted' }`.
- If it would tip past `1.0` (hard kill), emit skip + `NEEDS_INTERVENTION.json` (operator-actionable: lower `maxPerRun` or raise budget).

Mid-debate budget kill is NOT acceptable as the primary mechanism (Codex Q6 path b rejected). The aggregate preflight is the gate.

### 2.6 Concurrency interaction (Codex Q11 sub-item)

Scheduler-fired debate counts against M10's `maxConcurrent: 1` per `(runId, phase)`. If a manual `<debate-request>` is already in-flight when the scheduler decides to fire, scheduler emits `debate_scheduler_skipped { reason: 'concurrent_limit' }` (and does NOT block waiting). The debate doesn't fire; gate writes from original REVIEW verdict.

This preserves rule-1 (gate writes from a real REVIEW verdict, not from an aborted scheduler attempt).

### 2.7 Failure surface — broader intervention list (Codex Q8)

`requestDebate` errors are partitioned into operator-actionable (raise `NEEDS_INTERVENTION.json`) and transient/parse (degrade to original REVIEW verdict + `debate_scheduler_error`):

| Underlying error | Scheduler reaction |
|---|---|
| `provider_auth_missing` | `NEEDS_INTERVENTION` (Q8) |
| `provider_permissions_violation` | `NEEDS_INTERVENTION` (Q8) |
| `debate_concurrent_limit_exceeded` | `NEEDS_INTERVENTION` (Q8 — operator-actionable: resolve open debates) |
| `debate_topic_collision` | `NEEDS_INTERVENTION` (Q8 — operator-actionable: distinct topic surface) |
| Scheduler-generated `debate_manifest_blocked` | `NEEDS_INTERVENTION` (Q8 — operator-actionable: fix `.code-ozignore` or raise `maxFiles`) |
| `debate_response_invalid` | `debate_scheduler_error { reason: 'artifact_invalid' }` + degrade |
| `debate_decision_invalid` | `debate_scheduler_error { reason: 'artifact_invalid' }` + degrade |
| Transient provider IO | `debate_scheduler_error { reason: 'transient_io' }` + degrade |
| Any other `ProviderError` | `debate_scheduler_error { reason: 'other' }` + degrade |

Degraded gate writes use the original (pre-debate) REVIEW verdict and findings.

### 2.8 Rule-21 metrics — corrective + actionable (Codex Q7)

The brief's §4.8 metrics rewarded any verdict churn (verdict-flip) and any new finding (new-finding rate). Codex Risk: these reward bad flips and noisy debates.

**Locked metrics (both deterministic on FakeProvider):**

| Metric | Definition | Floor | Notes |
|---|---|---|---|
| **Corrective verdict delta** | % of `debate_scheduler_fired` events whose post-debate REVIEW round produces a verdict closer to the fixture oracle's labeled-correct verdict than the pre-debate verdict was. Direction matters: (a) `needs-revision` flipping to `ready` when oracle says `ready` is corrective; (b) `ready` flipping to `needs-revision` when oracle says `needs-revision` is corrective; (c) flipping in the wrong direction is anti-corrective. | ≥10% on the canonical fixture set | Reported as `corrective_count / fired_count`; anti-corrective count surfaced separately as a regression signal |
| **New-actionable-finding rate** | % of fired debates whose post-debate REVIEW round adds ≥1 finding with severity ∈ `{block, fix-first}` (NOT `nit` or `fyi`) by fingerprint, where the fingerprint was absent from the pre-debate REVIEW round | ≥30% on the canonical fixture set | Counts severity-meaningful findings only — ignores nits/fyi noise |
| **Per-trigger breakdown** | Both metrics broken down by `SchedulerFireReason` | Reported, no floor | Tunes trigger thresholds |
| **No-signal-fire rate** | % of fired debates whose post-debate REVIEW round produces *exactly the same* verdict AND adds zero new findings | Reported, no floor | Surfaces wasted fires |

The fixture oracle is a labeled-correct field on each fixture: `tests/fixtures/debate-scheduler-baseline/<fixture>.oracle.json` with `{ verdict: 'ready' | 'needs-revision' | 'block' }`. Determinism: FakeProvider responses are scripted by `(phase, agent, taskId, attempt, reviewRound, debateTurn)` keying. Same fixture under `mode: off` (control) and `mode: auto` (treatment) yields a deterministic events.jsonl pair.

Cost overhead per fire and latency overhead are surfaced as telemetry (commit 6b output), NOT as ship gates.

### 2.9 Resume recovery (Codex Q11 sub-item)

Three resume points must be defined:

| Crash point | Recovery |
|---|---|
| `evaluated` emitted, no `fired`/`skipped` | On resume, re-evaluate at the pre-debate REVIEW state; emit a new `evaluated` with the same `decisionId` carried forward. The earlier `evaluated` event remains in `events.jsonl` (append-only); the rule-21 baseline reducer dedups on `decisionId`. |
| `fired` emitted, no `debate_started` | Re-fire is unsafe (cost double-charge). On resume, the orchestrator emits `debate_scheduler_error { reason: 'resume_after_fire_no_start' }` + `NEEDS_INTERVENTION` (operator-actionable: confirm or skip). Default behavior: skip the post-debate round, gate writes from original REVIEW. |
| `debate_resolved` emitted, no `postreview` | Run the post-debate REVIEW round on resume. The DECISION.md is the canonical debate artifact; the post-debate round consumes it as evidence. Gate write happens after the post-debate round. |

Resume is opt-in via `code-oz resume` (existing v0.1 surface from rule 12). The scheduler does not auto-resume.

### 2.10 REVIEW always wins (Codex Q9)

DECISION.md (caller-authored synthesis) and post-debate REVIEW.md may disagree. The post-debate REVIEW verdict is gate-authoritative. DECISION.md is evidence the post-debate REVIEW round considers; it is not a vote.

If the post-debate REVIEW returns the same verdict as pre-debate AND adds no new findings, that's a no-signal fire — surfaces in the `no_signal_fire_rate` metric (§2.8). Wasteful, not broken.

### 2.11 Manifest expansion (Codex Q11 sub-item)

Scheduler-fired debate's file manifest must include:
1. `BUILD_REPORT.md`'s changed-file manifest (the patch under review)
2. `BUILD_REPORT.md` itself (BUILD's claim)
3. `VERIFY.md` (verifier's evidence)
4. `REVIEW.md` (reviewer's verdict)

If the union exceeds the persona's declared `maxFiles`, the scheduler emits `debate_scheduler_skipped { reason: 'manifest_size_exceeds_maxFiles' }`. Pre-skip on size; do NOT throw after firing.

### 2.12 Defaults preserved

`debatePolicy.mode` default is `manual` (Codex Q3 confirmed). New users get M10 behavior unchanged. `auto` is explicit opt-in. `off` is escape hatch (used by the rule-21 baseline command).

---

## 3. Commit sequence (11 commits, single-axis each)

Each commit is one authority slice. Order respects dependencies (schemas before consumers; pure logic before wiring; permission grant before e2e fixture). Total 11 commits = brief's 8 + Codex's 4→4a/4b split + Codex's 6→6a/6b split + 1 reviewer permission grant for Path A.

| # | Subject | Files | Test delta |
|---|---|---|---|
| 1 | `feat(state): debate scheduler event types + correlation fields` | `src/state/schemas.ts`, `src/state/events.ts`, `tests/state-debate-scheduler-events.test.ts` (new) | +18 |
| 2 | `feat(policy): pure scheduler decision function` | `src/policy/debate-scheduler.ts` (new), `tests/policy-debate-scheduler.test.ts` (new) | +30 |
| 3 | `feat(config): debatePolicy block in CodeOzConfig` | `src/config/schema.ts`, `src/config/load.ts`, `tests/config-debate-policy.test.ts` (new) | +14 |
| 4a | `feat(phases/review): post-verdict scheduler evaluate hook` | `src/phases/review.ts`, `src/phases/review-panel.ts`, `tests/review-scheduler-evaluate.test.ts` (new) | +14 |
| 4b | `feat(phases/review): scheduler fire + post-debate round + lock-collision fix` | `src/phases/review.ts`, `src/phases/review-panel.ts`, `tests/review-scheduler-fire.test.ts` (new), `tests/review-scheduler-postreview.test.ts` (new) | +24 |
| 5 | `feat(providers): scheduler aggregate budget preflight` | `src/providers/cost.ts`, `tests/cost-debate-scheduler-preflight.test.ts` (new) | +12 |
| 6a | `feat(commands/doctor): --debate-policy config inspector` | `src/commands/doctor.ts`, `tests/commands-doctor-debate-policy.test.ts` (new) | +8 |
| 6b | `feat(commands/doctor): --debate-policy-baseline rule-21 ship gate` | `src/commands/doctor.ts`, `src/commands/doctor-debate-baseline.ts` (new), `tests/commands-doctor-debate-baseline.test.ts` (new) | +14 |
| 7 | `docs(contracts/DEBATE_POLICY): orchestrator-owned authority surface` | `docs/contracts/DEBATE_POLICY.md` (new) | 0 |
| 8 | `feat(agents): default reviewer gets tool_use.debate (M15 path A)` | `src/agents/defaults/reviewer.md`, `tests/agents-reviewer-debate-permission.test.ts` (new) | +6 |
| 9 | `feat(tests,docs): e2e + ROADMAP closure + memory entry` | `tests/fixtures/debate-scheduler-baseline/*` (new), `tests/e2e/debate-scheduler-grey-zone.test.ts` (new), `tests/e2e/debate-scheduler-panel-disagreement.test.ts` (new), `docs/design/ROADMAP.md` (M15 row close) | +20 |

**Expected test count at convergence:** 2425 (M14 floor) + 160 (above) = **~2585 tests, 0 fail, 1 skip (live xAI gated).**

**Untouched (locked surfaces):**
- `src/tools/debate-request.ts` — M10 primitive frozen
- `src/tools/debate-request-extract.ts` — manual extraction path preserved
- `src/tools/debate-permissions.ts` — permission preview unchanged (no new sub-scope)
- `src/agents/schema.ts` — no new permission scope
- `src/phases/review-panel-verdict.ts` — M14 panel verdict computation unchanged

---

## 4. Schema definitions (commit 1)

Extend the `LoggedEvent` union in `src/state/schemas.ts`:

```ts
| {
    readonly version: 1
    readonly type: 'debate_scheduler_evaluated'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly decisionId: string  // ULID
    readonly reviewRound: number
    readonly mode: 'off' | 'manual' | 'auto'
    readonly inputDigest: string  // sha256
    readonly preReviewReportSha256: string  // sha256
  }
| {
    readonly version: 1
    readonly type: 'debate_scheduler_fired'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly decisionId: string
    readonly reviewRound: number
    readonly reason: SchedulerFireReason
    readonly opposingProvider: ProviderId
    readonly debateTopic: string
    readonly preReviewReportSha256: string
  }
| {
    readonly version: 1
    readonly type: 'debate_scheduler_skipped'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly decisionId: string
    readonly reviewRound: number
    readonly reason: SchedulerSkipReason
    readonly preReviewReportSha256: string
  }
| {
    readonly version: 1
    readonly type: 'debate_scheduler_error'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly decisionId: string
    readonly reviewRound: number
    readonly reason:
      | 'artifact_invalid'
      | 'transient_io'
      | 'resume_after_fire_no_start'
      | 'other'
    readonly underlyingErrorCode?: string  // free-form provider error code
  }
| {
    readonly version: 1
    readonly type: 'debate_scheduler_postreview'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly decisionId: string
    readonly reviewRound: number  // same round as pre-debate; round count not incremented
    readonly preReviewReportSha256: string
    readonly postReviewReportSha256: string
    readonly verdictPre: 'ready' | 'needs-revision' | 'block' | 'panel'
    readonly verdictPost: 'ready' | 'needs-revision' | 'block' | 'panel'
    readonly findingsAddedCount: number  // post \ pre, by fingerprint
    readonly actionableFindingsAddedCount: number  // post \ pre, severity ∈ {block, fix-first}
  }
| {
    readonly version: 1
    readonly type: 'debate_policy_baseline_completed'
    readonly ts: string
    readonly runId: string
    readonly fixtureSet: string
    readonly correctiveDeltaRate: number  // [0,1]
    readonly antiCorrectiveCount: number
    readonly newActionableFindingRate: number  // [0,1]
    readonly noSignalFireRate: number  // [0,1]
    readonly perTriggerBreakdown: ReadonlyArray<{
      readonly reason: SchedulerFireReason
      readonly fired: number
      readonly correctiveCount: number
      readonly newActionableCount: number
    }>
    readonly costOverheadAvgTokens: number
    readonly latencyOverheadAvgMs: number
    readonly passedRuleTwentyOne: boolean
  }
```

`SchedulerFireReason` and `SchedulerSkipReason` enums:

```ts
type SchedulerFireReason =
  | 'score_in_grey_zone'
  | 'panel_voter_disagreement'
  | 'needs_revision_with_high_score'

type SchedulerSkipReason =
  | 'mode_off'
  | 'mode_manual'
  | 'no_trigger_matched'
  | 'max_per_run_exhausted'
  | 'max_per_task_exhausted'
  | 'budget_exhausted'
  | 'persona_no_debate_permission'
  | 'persona_no_eligible_opponent'
  | 'concurrent_limit'
  | 'manifest_size_exceeds_maxFiles'
  | 'dedup_fingerprint_already_debated'
```

---

## 5. Pure decision function (commit 2)

`src/policy/debate-scheduler.ts`:

```ts
type SchedulerInput = {
  readonly mode: 'off' | 'manual' | 'auto'
  readonly review: {
    readonly mode: 'single' | 'panel'
    readonly score: number | null  // null for panel mode
    readonly verdict: 'ready' | 'needs-revision' | 'block' | 'panel'
    readonly panelistVerdicts: ReadonlyArray<{
      readonly id: string
      readonly verdict: 'ready' | 'needs-revision' | 'block'
      readonly authorityImpact: 'voter' | 'advisory'
    }>
  }
  readonly history: {
    readonly debatesFiredThisRun: number
    readonly debatesFiredThisTask: number
    readonly priorFingerprintsThisTask: ReadonlySet<string>
  }
  readonly budget: {
    readonly aggregatePreflightWouldTip: boolean
  }
  readonly persona: {
    readonly hasDebatePermission: boolean
    readonly opposingProviders: readonly ProviderId[]  // post-M11-eligibility-filter
  }
  readonly concurrency: {
    readonly debateInFlight: boolean
  }
  readonly manifest: {
    readonly projectedFileCount: number
    readonly maxFiles: number
  }
  readonly policy: {
    readonly maxPerRun: number
    readonly maxPerTask: number
    readonly triggers: {
      readonly reviewScoreGreyZone: { readonly min: number; readonly max: number }
      readonly panelVoterDisagreement: boolean
      readonly needsRevisionWithHighScore: boolean
    }
    readonly cooldown: {
      readonly dedupByFingerprint: boolean
    }
  }
}

type SchedulerDecision =
  | { readonly fire: true; readonly reason: SchedulerFireReason }
  | { readonly fire: false; readonly reason: SchedulerSkipReason }

export function evaluateSchedulerDecision(input: SchedulerInput): SchedulerDecision
```

Decision evaluation order (short-circuits on first match):
1. `input.mode === 'off'` → skip `mode_off`
2. `input.mode === 'manual'` → skip `mode_manual`
3. `!persona.hasDebatePermission` → skip `persona_no_debate_permission`
4. `persona.opposingProviders.length === 0` → skip `persona_no_eligible_opponent`
5. `concurrency.debateInFlight` → skip `concurrent_limit`
6. `history.debatesFiredThisRun >= policy.maxPerRun` → skip `max_per_run_exhausted`
7. `history.debatesFiredThisTask >= policy.maxPerTask` → skip `max_per_task_exhausted`
8. `policy.cooldown.dedupByFingerprint && fingerprintMatchesPrior(...)` → skip `dedup_fingerprint_already_debated`
9. `budget.aggregatePreflightWouldTip` → skip `budget_exhausted`
10. `manifest.projectedFileCount > manifest.maxFiles` → skip `manifest_size_exceeds_maxFiles`
11. **Trigger evaluation** (mode-aware):
    - If `review.mode === 'panel'` AND `policy.triggers.panelVoterDisagreement` AND eligible voters split → fire `panel_voter_disagreement`
    - If `review.mode === 'single'` AND `review.score !== null` AND `score ∈ [grey-zone.min, max]` → fire `score_in_grey_zone`
    - If `review.mode === 'single'` AND `review.verdict === 'needs-revision'` AND `review.score >= 6` AND `policy.triggers.needsRevisionWithHighScore` → fire `needs_revision_with_high_score`
    - Else → skip `no_trigger_matched`

The function is pure: no I/O, no global state, deterministic on the input snapshot. The skip orderings above also encode rule-21 (every skip carries a reason; the baseline reducer can break down skipped-fires by reason).

---

## 6. Wiring at the call site (commits 4a + 4b)

**Commit 4a (evaluate, no fire):**
- `src/phases/review.ts` post-`computeCanonicalVerdict`, pre-gate-write: build `SchedulerInput` from in-scope state, call `evaluateSchedulerDecision`, emit `debate_scheduler_evaluated`. If decision is `fire: false`, emit `debate_scheduler_skipped` with the reason. If decision is `fire: true`, emit `debate_scheduler_evaluated` only — actual fire path is commit 4b.
- `src/phases/review-panel.ts` post-`computeCanonicalPanelVerdict`, pre-gate-write: same shape, with panel-aware SchedulerInput.

**Commit 4b (fire + post-debate round + lock-collision fix):**
- Factor `runReview` body: extract the round-running internals into `runReviewRoundLocked(opts: RoundLockedOpts)`. The outer `runReview` retains lock acquisition and the loop over rounds; the locked body is the pure round-execution surface.
- `runReview` calls `runReviewRoundLocked` per round. The post-verdict scheduler hook (still inside the lock-held outer frame) calls the scheduler. On fire:
  1. Emit `debate_scheduler_fired` with the chosen `opposingProvider` from the persona's `tool_use.debate.opposingProviders` (M10 selection logic reused).
  2. Invoke `requestDebate({ opponent, files: scheduledManifest, claim: REVIEW.md verdict })`.
  3. On `requestDebate` success: invoke `runReviewRoundLocked` for the post-debate round, with the DECISION.md prepended to the input context.
  4. Emit `debate_scheduler_postreview` with `verdictPre`, `verdictPost`, `findingsAddedCount`, `actionableFindingsAddedCount`.
  5. The post-debate round's REVIEW.md replaces the pre-debate REVIEW.md in the canonical artifact slot.
  6. Round counter does NOT increment for the post-debate round (it's the same round, reissued post-debate). The 4-round cap from M9 is unchanged.
- On `requestDebate` error: route per §2.7 table.

Lock contention proof: there is no inner `runReview` call; the inner is `runReviewRoundLocked`, which never re-acquires `.review.lock`. The outer holds it for the entirety of `(pre-round → scheduler eval → optional fire → optional post-round)` per round.

---

## 7. Cost integration (commit 5)

`src/providers/cost.ts` adds:

```ts
type AggregatePreflightInput = {
  readonly priceTable: PriceTable
  readonly opposingProvider: ProviderId
  readonly opposingMaxTokens: number  // from persona's tool_use.debate.maxTokens
  readonly synthesisMaxTokens: number  // same
  readonly postReviewMode: 'single' | 'panel'
  readonly postReviewMaxTokens: number  // from reviewer persona, or sum across panelists in panel mode
  readonly cumulativeSpendSoFar: BudgetSpend
  readonly budgets: BudgetsGlobal
}

export function aggregateDebateSchedulerPreflight(input: AggregatePreflightInput): {
  readonly wouldTip: boolean
  readonly projectedSpend: BudgetSpend
  readonly tipReason?: 'maxTokensEstimate' | 'maxProviderCalls' | 'maxTurns' | 'maxWallTimeMinutes'
}
```

The scheduler hook (commit 4a) calls this BEFORE evaluating the decision and supplies the result to `SchedulerInput.budget.aggregatePreflightWouldTip`. The `tipReason` is logged on `debate_scheduler_skipped { reason: 'budget_exhausted' }` for operator clarity (extends the skip event with an optional `budgetTipReason` field).

---

## 8. Doctor commands (commits 6a + 6b)

**6a: `code-oz doctor --debate-policy`**
- Prints current `debatePolicy` config from `.code-oz/config.yaml` (or defaults if absent).
- Reads last N=20 `debate_scheduler_*` events from `events.jsonl` and tabulates: total evaluated, fired, skipped (per reason), errored (per reason).
- No new event emitted.

**6b: `code-oz doctor --debate-policy-baseline <fixture-set>`**
- Runs the fixture set under `mode: off` (control), then `mode: auto` (treatment).
- Computes the four metrics from §2.8 + per-trigger breakdown.
- Compares against floors (§2.8): `correctiveDeltaRate ≥ 0.10` AND `newActionableFindingRate ≥ 0.30`.
- Emits `debate_policy_baseline_completed` event with `passedRuleTwentyOne: boolean`.
- Exit code: 0 on pass, non-zero on fail.

Canonical fixture set lives at `tests/fixtures/debate-scheduler-baseline/` (created in commit 9). Each fixture is a `.code-oz/` skeleton with a scripted FakeProvider response set + `oracle.json` per-run.

The rule-21 ship gate is `code-oz doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` exits 0. The CI matrix runs this; M15 does not tag if it fails.

---

## 9. Contract doc (commit 7)

`docs/contracts/DEBATE_POLICY.md` sections (modeled on `REVIEW_PANEL.md` + `DEBATE.md`):

1. **Surface** — config schema, decision function signature, event types
2. **Defense-in-depth layers** — the predicate-evaluation order from §5 mapped to the rule-1/rule-2/rule-19/rule-20/rule-21 invariants
3. **Common errors** — auth-missing, manifest-too-large, concurrent-limit, etc., with operator-action remediations
4. **Opt-out semantics** — `mode: off`, `mode: manual`, persona-level (no `tool_use.debate`), config-level (`maxPerRun: 0`)
5. **Rule-21 metric definitions** — corrective verdict delta, new-actionable-finding rate, per-trigger breakdown, no-signal-fire rate, with floors
6. **Resume semantics** — three crash points from §2.9
7. **Forward-compat for M16+** — multi-opponent (additive: scheduler picks N opponents), Researcher fan-out (additive: scheduler can fire on phases beyond REVIEW), pre-VERIFY trigger (additive: new call site)
8. **Anti-patterns** — the §10 list below

---

## 10. Anti-patterns to refuse (auto-revert if Ralph catches itself)

1. **Bundling.** Any commit touching more than one authority slice gets split.
2. **Skipping tests.** Failing tests are fixed at root cause. Never `skip`/delete to make a commit land.
3. **Adding a Scheduler persona.** The scheduler is mechanical orchestrator code. Rule 20.
4. **Making `auto` the default.** `manual` preserves M10 behavior; cost story not yet proven.
5. **Multi-opponent variants.** Out of scope per §1.
6. **Verdict-confidence as primary signal.** Same-prior post-hoc rationalization. §2.2 and Codex Q2.
7. **Deferring rule-21 measurement.** Rule 21 IS the ship gate. Commits 6b + 9 must land before tag.
8. **New `tool_use.debate.scheduler` sub-scope.** Bundling. Reuse `tool_use.debate`.
9. **New gate file for scheduler decisions.** Rule 1 + rule 20. Gate writes still depend on existing phase gate criteria.
10. **Mid-debate budget kill as primary mechanism.** Aggregate preflight is the gate. Mid-debate kill is the chokepoint backup.
11. **Generalizing scheduler to fire from any phase.** Rule 20: one call site for v1 (post-REVIEW only).
12. **Replacing `requestDebate` body.** M10 primitive frozen.
13. **Letting REVIEW lose to DECISION.** §2.10 — REVIEW always wins; DECISION is evidence.
14. **Bypassing `budgets.global`.** Rule 19. Aggregate preflight is mandatory.
15. **Same-family auto-debate.** Cross-family discipline (rule 2) preserved by M10 runtime; scheduler adds nothing, removes nothing.
16. **Pushing.** No `git push`. No `git tag`. No merge. Branch stays local until Ozzy approves.
17. **`Co-Authored-By: Claude` footer.** Don't add it (CLAUDE.md "Working in this repo").
18. **Emojis in code or commit messages.** Rule from CLAUDE.md.

---

## 11. Concrete implementation notes per commit

### 11.1 Commit 1 — schema

- Extend `LoggedEvent` union (no replacement of existing types).
- Validators in `src/state/events.ts` for each new type.
- ULID generator: reuse existing utility (search `src/util/ulid.ts` or equivalent; if absent, add minimal generator in `src/util/`).
- Test: assert union compatibility, validator round-trips, sha256 field is hex-string-of-64.

### 11.2 Commit 2 — pure decision

- File: `src/policy/debate-scheduler.ts` (new directory `src/policy/` if absent).
- No imports from `src/phases/`, `src/providers/`, `src/state/events.ts` writers — pure logic only. Imports allowed from `src/state/schemas.ts` (types), `src/types/`, `src/agents/schema.ts` (types).
- Test cases (table tests): each `SchedulerSkipReason` has at least one positive case; each `SchedulerFireReason` has at least one positive case + one negative-near-miss case. Mode boundary cases: panel mode never fires `score_in_grey_zone` regardless of input.

### 11.3 Commit 3 — config

- Add `debatePolicy?` to `CodeOzConfig`. Defaults locked in §2.12.
- Validation: `mode ∈ {'off', 'manual', 'auto'}`, `maxPerRun >= 0`, `maxPerTask >= 0`, `reviewScoreGreyZone.min <= max`, `min ∈ [0, 10]`, `max ∈ [0, 10]`.
- Test: every invalid permutation rejects with a specific error code.

### 11.4 Commit 4a — evaluate hook

- `src/phases/review.ts` post-verdict-computation, pre-gate-write: import `evaluateSchedulerDecision`, build `SchedulerInput` from current scope, emit `debate_scheduler_evaluated`.
- Same in `src/phases/review-panel.ts` for panel mode.
- Skip events fire here too (no fire path in commit 4a).
- Test: scheduler fires `evaluated` exactly once per phase round; `skipped` events match every skip reason.

### 11.5 Commit 4b — fire + post-debate + lock fix

- Factor `runReview` body: extract `runReviewRoundLocked` from the existing per-round implementation. Both the outer first-round and the post-debate round call this internal.
- The fire path is in the post-verdict hook (still inside the outer's lock frame): `requestDebate(...)` → on success, `runReviewRoundLocked(...)` for post-debate → `debate_scheduler_postreview` event → replace canonical REVIEW.md.
- Test: lock contention proof (instrument `.review.lock` acquire/release count; assert ≤1 acquire per outer `runReview` call regardless of fire path); verdict-pre-vs-post round-trip; canonical REVIEW.md replacement; round counter does NOT increment.

### 11.6 Commit 5 — budget preflight

- `aggregateDebateSchedulerPreflight` matches the signature in §7.
- Reuse `assertWithinBudget` semantics for tip-detection (no new chokepoint).
- Test: tip on each cap (`maxTokensEstimate`, `maxProviderCalls`, `maxTurns`, `maxWallTimeMinutes`) produces the right `tipReason`.

### 11.7 Commit 6a + 6b — doctor

- 6a is read-only; 6b runs the fixture set.
- 6b uses the existing FakeProvider scripting machinery (M14 panel-baseline precedent).
- Test: 6a tabulates events correctly; 6b computes metrics from a known fixture and matches expected values; rule-21 floor check passes/fails as designed.

### 11.8 Commit 8 — reviewer permission grant

YAML diff to `src/agents/defaults/reviewer.md` frontmatter (locked in §2.1):

```yaml
permissions:
  read: '*'
  write:
    - .code-oz/artifacts/REVIEW.md
  bash: deny
  tool_use:
    repo_context:
      tools: [glob, grep, read]
      roots: ['.code-oz/runs/<runId>/worktree/']
      maxResults: 50
      maxBytesPerResult: 16384
      maxFilesForNextManifest: 0
      timeoutMs: 5000
      network: none
    review_request:
      tools: [request-review]
      providers: [codex, gemini]
      maxRounds: 4
      timeoutMsPerRound: 120000
      network: provider-only
    debate:                             # NEW (M15 path A)
      tools: [request-debate]
      opposingProviders: [claude, gemini]
      maxRounds: 1
      timeoutMsPerRound: 120000
      maxConcurrent: 1
      maxFiles: 16
      maxTokens: 32000
      network: provider-only
```

The `opposingProviders: [claude, gemini]` is the M11-eligible cross-family default pool minus codex (the reviewer's own family).

Test: persona loader accepts the new `tool_use.debate` declaration; M11 eligibility check passes; existing tests asserting "only `lead.md` has `tool_use.debate`" are updated to "lead.md AND reviewer.md have `tool_use.debate`."

### 11.9 Commit 9 — e2e + closure

Fixtures (`tests/fixtures/debate-scheduler-baseline/`):
- `single-grey-zone-corrective/` — single-mode REVIEW score 6, oracle says `ready`, debate flips to `ready` (corrective)
- `single-grey-zone-anti-corrective/` — single-mode REVIEW score 6, oracle says `needs-revision`, debate flips to `ready` anyway (anti-corrective; surfaces in reporting)
- `single-needs-revision-high-score/` — single-mode REVIEW score 7 + verdict `needs-revision`, oracle says `ready`, debate flips to `ready`
- `panel-voter-disagreement/` — panel mode with two voters split, oracle says `ready`, debate adds new actionable finding raising verdict to `needs-revision` (corrective if oracle says `needs-revision`)
- `single-no-signal-fire/` — single-mode REVIEW score 5, debate fires, post-debate REVIEW returns same verdict + zero new findings (no-signal-fire metric)
- `manifest-size-exceeds/` — projected manifest exceeds reviewer's `maxFiles: 16`, scheduler skips with `manifest_size_exceeds_maxFiles`

E2E tests:
- `tests/e2e/debate-scheduler-grey-zone.test.ts` — runs the single-grey-zone fixtures end-to-end
- `tests/e2e/debate-scheduler-panel-disagreement.test.ts` — runs the panel-disagreement fixture end-to-end
- Both tests assert the corresponding `debate_scheduler_postreview` event payload matches expected verdictPre/verdictPost/findingsAddedCount/actionableFindingsAddedCount

ROADMAP update: M15 row → `Closed YYYY-MM-DD (v0.16.0-alpha.0, ~2585 tests).`

Memory update: `m15_progress.md` + index entry in `MEMORY.md`.

---

## 12. Acceptance gate (every box checks before tag)

- [ ] All 11 commits exist on `feat/m15-debate-scheduler`.
- [ ] `bun test` shows ~2585 pass / 0 fail / 1 skip.
- [ ] `bun run typecheck` clean.
- [ ] `bun run dev doctor --debate-policy` runs without error and prints sensible config.
- [ ] `bun run dev doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` exits 0 AND emits `debate_policy_baseline_completed` with `passedRuleTwentyOne: true`, `correctiveDeltaRate >= 0.10`, `newActionableFindingRate >= 0.30`.
- [ ] All `SchedulerSkipReason` values have at least one positive test case.
- [ ] All `SchedulerFireReason` values have at least one positive test case.
- [ ] `docs/contracts/DEBATE_POLICY.md` exists and is the source of truth.
- [ ] `docs/design/ROADMAP.md` M15 row marked closed.
- [ ] `MEMORY.md` updated with `m15_progress.md` link.
- [ ] Codex review converged: latest round verdict `push`, zero `block-push`, zero `block-next-milestone`.
- [ ] Tag staged on Codex-blessed SHA. Push pending Ozzy's explicit approval.

---

## 13. Codex review iteration shape (Phase 3)

After Ralph emits `<promise>M15_COMPLETE</promise>` (or convergence by hand):

1. Write `docs/research/CODEX_BRIEFING_M15_REVIEW.md` pointing Codex at the latest commit SHA, listing the milestone authority boundary and the contracts changed.
2. Run Codex review (`gpt-5.5 xhigh`, sandbox `read-only`, approval `never`).
3. Iterate per CLAUDE.md `feedback_no_tech_debt`:
   - Every `block-push` finding → follow-up commit (no amends on tagged SHAs).
   - Every `block-next-milestone` finding → follow-up commit before tag.
   - `fix-soon` and `nit` → defer if tracked in `MEMORY.md`.
   - After each closure batch → fresh Codex round.
4. Final pre-tag verification round (M14 R9 precedent).
5. Tag on the Codex-blessed SHA. Default no-push.

Expected rounds for M15: 2–4 if scope holds. >5 means scope leaked — stop and re-debate.

---

## 14. Standards (recap)

CLAUDE.md non-negotiable rules in scope:
- Rule 1 (file-based gate signals) — scheduler decisions are typed events, not LLM text
- Rule 2 (cross-family review) — preserved by M10 runtime, scheduler reuses
- Rule 7 (plain Markdown artifacts) — REVIEW.md and DECISION.md stay Markdown+YAML
- Rule 13 (privacy by default) — manifest expansion §2.11 respects `.code-ozignore` and `maxFiles`
- Rule 16 (universal anti-slop in personas) — reviewer's persona prompt unchanged in commit 8 (only frontmatter changes)
- Rule 19 (run-level budget enforcement) — aggregate preflight §2.5
- Rule 20 (one new authority boundary) — orchestrator-side automatic-trigger policy
- Rule 21 (measurable risk reduction) — corrective verdict delta + new-actionable-finding rate floors

Writing rules: no banned vocabulary, no rule-of-three lists, no "serves as", no section summaries, sentence-case headings, one em dash max per paragraph.

Git rules: feature branch only, conventional commits, no emojis, no Co-Authored-By footer, never push without explicit approval.

---

## End of kickoff. Begin Phase 2 implementation per §3 commit sequence.
