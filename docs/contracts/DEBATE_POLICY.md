# DEBATE_POLICY (v0.1, M15)

User-facing contract for **Debate-policy scheduler v1** — the orchestrator-side automatic-trigger policy for the existing single-opponent `requestDebate()` runtime built in M10. Extends [`DEBATE.md`](./DEBATE.md) with a mechanical predicate that decides *when* to fire a debate based on objective signals from completed REVIEW artifacts; the M10 primitive is unchanged. The persona is no longer the only trigger.

This contract is the M15 authority boundary. Manual `<debate-request>` blocks (M10 behavior) are unchanged; auto mode is opt-in via `debatePolicy.mode: auto` in `.code-oz/config.yaml`. Multi-opponent debate, Researcher fan-out, pre-VERIFY triggers, and per-phase scheduler generalization are all M16+ deferred until measurable need (rule 21 + Agentless caution).

## Phase overview

The scheduler runs at one call site only in v0.1: the **post-verdict, pre-gate-write** moment of the REVIEW phase. After `computeCanonicalVerdict` (single-mode) or `computeCanonicalPanelVerdict` (panel-mode), the runtime invokes the scheduler hook (`src/phases/review-scheduler-hook.ts`). The hook builds a typed `SchedulerInput` snapshot from in-scope state, calls the pure decision function (`src/policy/debate-scheduler.ts:evaluateSchedulerDecision`), emits the resulting events, and (when wired) drives the fire path through an executor seam.

Authority boundary (rule 20, single-axis): **orchestrator-side automatic-trigger policy + measurable risk metric.** Nothing else lands in M15. The M10 `requestDebate` primitive is frozen surface; the M14 panel surface is read-only consumed; no new permission scope is introduced.

## Surface

### Config grammar

```yaml
# .code-oz/config.yaml
debatePolicy:
  mode: auto                       # 'off' | 'manual' | 'auto' (default: 'manual')
  maxPerRun: 2                     # cap on auto-fired debates per run
  maxPerTask: 1                    # cap per (runId, taskId)
  triggers:
    reviewScoreGreyZone:           # single-mode only
      min: 5
      max: 7
    panelVoterDisagreement: true   # panel-mode only
    needsRevisionWithHighScore: true # single-mode only
  cooldown:
    dedupByFingerprint: true       # dedup by (taskId, attempt, preReviewReportSha256)
```

Absent `debatePolicy:` block resolves to `DEFAULT_DEBATE_POLICY` (mode='manual'); M10 behavior is preserved unchanged.

### Decision function signature

```ts
type SchedulerInput = {
  readonly mode: DebateSchedulerMode
  readonly review: SchedulerReviewState  // single | panel discriminated union
  readonly history: SchedulerHistorySnapshot
  readonly budget: { readonly aggregatePreflightWouldTip: boolean; readonly tipReason?: ... }
  readonly persona: { readonly hasDebatePermission: boolean; readonly opposingProviders: readonly ProviderId[] }
  readonly concurrency: { readonly debateInFlight: boolean }
  readonly manifest: { readonly projectedFileCount: number; readonly maxFiles: number }
  readonly policy: SchedulerPolicySnapshot
}

type SchedulerDecision =
  | { readonly fire: true; readonly reason: SchedulerFireReason }
  | { readonly fire: false; readonly reason: SchedulerSkipReason; readonly budgetTipReason?: ... }

export function evaluateSchedulerDecision(input: SchedulerInput): SchedulerDecision
```

The function is pure: no I/O, no global state, no LLM. Deterministic on the input snapshot.

### Event taxonomy

Six event types emitted by the scheduler. All carry the `decisionId` (run-scoped ULID) correlation field so the disjoint trace `evaluated -> fired/skipped -> postreview/error` joins into a single decision record.

| Event | When | Payload |
|---|---|---|
| `debate_scheduler_evaluated` | Always (per scheduler decision) | `inputDigest` (sha256 of canonicalized SchedulerInput), `mode`, `reviewMode`, `preReviewReportSha256` |
| `debate_scheduler_fired` | Decision was fire AND executor wired | `reason: SchedulerFireReason`, `opposingProvider`, `debateTopic`, `preReviewReportSha256` |
| `debate_scheduler_skipped` | Decision was skip | `reason: SchedulerSkipReason`, optional `budgetTipReason` on the `budget_exhausted` reason |
| `debate_scheduler_error` | Fired but executor returned error_degrade (or threw) | `reason: SchedulerErrorReason`, optional `underlyingErrorCode` |
| `debate_scheduler_postreview` | Fired and post-debate REVIEW round completed | `verdictPre`, `verdictPost`, `findingsAddedCount`, `actionableFindingsAddedCount`, `preReviewReportSha256`, `postReviewReportSha256` |
| `debate_policy_baseline_completed` | `doctor --debate-policy-baseline` command terminal | rule-21 metrics + per-trigger breakdown + `passedRuleTwentyOne` |

The post-debate REVIEW round consumes the **same** `reviewRound` value (no increment); the M9 4-round cap is unchanged.

## Defense-in-depth (decision-evaluation order)

The pure function evaluates gates in a fixed order. First match wins so the events.jsonl reducer can attribute every skip to a single most-upstream reason. Each gate maps to a CLAUDE.md non-negotiable rule:

| # | Gate | Skip reason on miss | Rule |
|---|---|---|---|
| 1 | mode === 'off' | `mode_off` | rule 21 (baseline control mode) |
| 2 | mode === 'manual' | `mode_manual` | rule 20 (M10 behavior preserved) |
| 3 | persona has `tool_use.debate` | `persona_no_debate_permission` | rule 18 (permission discipline) |
| 4 | persona has eligible opposing providers | `persona_no_eligible_opponent` | rule 2 (cross-family) |
| 5 | no debate already in-flight | `concurrent_limit` | M10 maxConcurrent=1 |
| 6 | maxPerRun cap not hit | `max_per_run_exhausted` | rule 19 (run-level budget) |
| 7 | maxPerTask cap not hit | `max_per_task_exhausted` | rule 19 |
| 8 | fingerprint not already debated | `dedup_fingerprint_already_debated` | rule 1 (file-based gate signals) |
| 9 | aggregate budget preflight does not tip | `budget_exhausted` | rule 19 |
| 10 | manifest size <= maxFiles | `manifest_size_exceeds_maxFiles` | rule 13 (privacy by default) |
| 11 | trigger evaluation matches a fire reason | `no_trigger_matched` | (mechanical, not laundered) |

Gate 11 is mode-aware:

- **Panel mode**: only `panel_voter_disagreement` (Codex Risk #1: panel REVIEW has no numeric Score.Final score; the literal `panel` is a sentinel, not a score). Advisory voters never count toward disagreement (rule 2 + REVIEW_PANEL.md authority shape).
- **Single mode**: `score_in_grey_zone` (default `[5, 7]`) OR `needs_revision_with_high_score` (verdict='needs-revision' AND score>=6).

Verdict-confidence is **not** a primary signal (Codex Q2 — same-prior post-hoc rationalization).

## Failure surface

When the fire-path executor encounters a `requestDebate` error, the failure is partitioned into operator-actionable (raise `NEEDS_INTERVENTION.json`, halt the run) and transient/parse (degrade to original REVIEW verdict + `debate_scheduler_error`).

| Underlying error | Scheduler reaction |
|---|---|
| `provider_auth_missing` | NEEDS_INTERVENTION (operator-actionable: configure credentials) |
| `provider_permissions_violation` | NEEDS_INTERVENTION (operator-actionable: cross-family / permission misconfig) |
| `debate_concurrent_limit_exceeded` | NEEDS_INTERVENTION (operator-actionable: resolve open debates) |
| `debate_topic_collision` | NEEDS_INTERVENTION (operator-actionable: unique topic surface) |
| `debate_manifest_blocked` (scheduler-generated) | NEEDS_INTERVENTION (operator-actionable: fix `.code-ozignore` or raise `maxFiles`) |
| `debate_response_invalid` / `debate_decision_invalid` | `debate_scheduler_error { reason: 'artifact_invalid' }` + degrade |
| Transient provider IO | `debate_scheduler_error { reason: 'transient_io' }` + degrade |
| Other `ProviderError` / executor exception | `debate_scheduler_error { reason: 'other' }` + degrade |

Degraded gate writes use the original (pre-debate) REVIEW verdict and findings.

## Opt-out semantics

Three layers of opt-out, each useful for a different scenario:

| Layer | Mechanism | When to use |
|---|---|---|
| Run-level | `debatePolicy.mode: off` | Rule-21 baseline control runs; cost-constrained runs that must NOT debate |
| Run-level | `debatePolicy.mode: manual` | M10 behavior preserved (default); manual `<debate-request>` blocks still work |
| Persona-level | Omit `tool_use.debate` from the persona's frontmatter | Custom reviewer that should never auto-debate |
| Cap-level | `debatePolicy.maxPerRun: 0` | Run any auto-mode evaluation but never fire |

Manual `<debate-request>` blocks from a persona body are **not** consulted by the scheduler — the manual M10 path remains independent. A persona may declare `tool_use.debate` but never emit a `<debate-request>`; in that case manual mode produces no debates, auto mode fires per the predicate.

## Rule-21 metric definitions

The rule-21 ship gate (`code-oz doctor --debate-policy-baseline`) computes four metrics from the canonical fixture set's events.jsonl pair (control = `mode: off`, treatment = `mode: auto`). PASS requires both floors to hold AND firedCount > 0.

### Corrective verdict delta rate (gating, floor 0.10)

For each `debate_scheduler_fired` event with a matching `debate_scheduler_postreview`, classify the verdict direction against the fixture oracle:

```
distance(verdict, oracle) = 0 if match, 1 if mismatch
panel verdicts return distance=null (excluded from corrective rate; v0.1 has no panel oracle)
corrective: distance(post) < distance(pre)
anti-corrective: distance(post) > distance(pre)
neutral: equal distance
```

Numerator: count of corrective fires. Denominator: total fired count.

Anti-corrective count is surfaced separately as a regression signal — fires that move AWAY from the oracle indicate the scheduler is making things worse on those fixtures and need investigation.

### New-actionable-finding rate (gating, floor 0.30)

Numerator: count of fires whose post-debate REVIEW added at least one finding with severity in `{block, fix-first}` by fingerprint that was absent from the pre-debate REVIEW. Denominator: total fired count.

`nit` and `fyi` severities do **not** count toward the numerator (Codex Q7 rejection of "any new finding" rate — surfaces noise as signal).

### Per-trigger breakdown (telemetry, no floor)

For each `SchedulerFireReason`: fired count, corrective count, new-actionable count. Useful for tuning `reviewScoreGreyZone` bounds, `panelVoterDisagreement` defaults, and `needsRevisionWithHighScore` flag.

### No-signal-fire rate (telemetry, no floor)

Numerator: count of fires where post-debate verdict equals pre-debate AND zero new findings were added. Denominator: total fired count. Surfaces wasted fires — high values suggest the trigger thresholds are too aggressive.

### Cost / latency overhead (telemetry, no floor)

`costOverheadAvgTokens`: sum of `agent_invoked.tokensEstimate` across the fire's debate + post-debate window, averaged over fired count. `latencyOverheadAvgMs`: wall-time delta between `debate_scheduler_fired.ts` and `debate_scheduler_postreview.ts`, averaged over fires with both timestamps.

## Resume semantics

Three crash points, each with a defined recovery:

| Crash point | Recovery |
|---|---|
| `evaluated` emitted, no `fired`/`skipped` | On resume, re-evaluate the scheduler at the pre-debate REVIEW state; emit a new `evaluated` with a fresh `decisionId`. The earlier event remains in `events.jsonl` (append-only); the rule-21 baseline reducer dedups on the latest `decisionId` per fingerprint. |
| `fired` emitted, no `debate_started` | Re-fire is unsafe (cost double-charge). On resume, the orchestrator emits `debate_scheduler_error { reason: 'resume_after_fire_no_start' }` + `NEEDS_INTERVENTION` (operator-actionable: confirm or skip). Default behavior: skip the post-debate round, gate writes from original REVIEW verdict. |
| `debate_resolved` emitted, no `postreview` | Run the post-debate REVIEW round on resume. The DECISION.md is the canonical debate artifact; the post-debate round consumes it as evidence. Gate write happens after the post-debate round. |

Resume is opt-in via `code-oz resume`. The scheduler does not auto-resume.

## Forward-compat for M16+

The v0.1 surface is intentionally narrow (rule 20). The following are deferred until measurable risk-reduction in events.jsonl justifies them (rule 21):

- **Multi-opponent debate**: the `requestDebate` primitive is single-opponent. M16+ may add `requestMultiDebate` as a separate primitive; the scheduler would gain a `multiOpponentTrigger` flag and fire path. The current `SchedulerFireReason` enum is forward-compatible — additional reasons append without breaking existing readers.
- **Researcher fan-out**: a phase-tail Researcher persona that consumes the scheduler's signal for upstream investigation. Adds a new SchedulerFireReason (`research_signal_anomaly` or similar) and a new event variant (`debate_scheduler_research_dispatched`).
- **Pre-VERIFY trigger**: a second call site at `src/phases/verify.ts` post-test-completion. Adds a new SchedulerFireReason (`pre_verify_plan_doubt` or similar) and threads `phase: 'verify'` through the existing event shape (which is already `phase: Phase` not `phase: 'review'` literal).
- **Configurable quorum**: `panelVoterDisagreement` could become `panelDisagreementThreshold: number` (k-of-N voters). Today it's a boolean.
- **Per-persona scheduler config overrides**: today the policy is run-scoped. M16+ could add `tool_use.debate.scheduler` per-persona overrides. The current omission is deliberate (Codex Q4 — no new permission sub-scope yet).

## Anti-patterns

If you find yourself doing any of these, stop and re-debate the milestone shape:

1. **Adding a Scheduler persona.** The scheduler is mechanical orchestrator code. Rule 20.
2. **Making `auto` the default.** `manual` preserves M10 behavior; cost story not yet proven.
3. **Multi-opponent variants in v0.1.** Out of scope. M16+.
4. **Verdict-confidence as primary signal.** Same-prior post-hoc rationalization.
5. **Deferring the rule-21 measurement to a follow-up.** Rule 21 IS the ship gate.
6. **New `tool_use.debate.scheduler` permission sub-scope.** Bundling. Reuse `tool_use.debate`.
7. **New gate file for scheduler decisions.** Rule 1 + rule 20. Gate writes still depend on existing phase gate criteria.
8. **Mid-debate budget kill as primary mechanism.** Aggregate preflight is the gate. Mid-debate kill is the chokepoint backup.
9. **Generalizing scheduler to fire from any phase.** Rule 20: post-REVIEW only for v1.
10. **Replacing `requestDebate` body.** M10 primitive frozen.
11. **Letting REVIEW lose to DECISION.** REVIEW always wins; DECISION is evidence the post-debate REVIEW round considers, not a vote.
12. **Bypassing `budgets.global`.** Rule 19. Aggregate preflight is mandatory.
13. **Same-family auto-debate.** Cross-family discipline (rule 2) is preserved by the M10 runtime; the scheduler adds nothing, removes nothing.

## Opponent-family invariant (M15 Phase 2 A1 lock, 2026-05-08)

Scheduler-fired debate uses the existing M10 `tool_use.debate` permission and `requestDebate()` runtime checks. The runtime invariant is **caller-family != opposing-provider-family**. M15 does not require the opposing provider to differ from the original BUILD provider family, because REVIEW has already enforced BUILD-family != REVIEW-family before the scheduler can run. A reviewer persona may choose to exclude BUILD-family opponents for stricter independence, but the bundled reviewer intentionally allows a BUILD-family opponent to steel-man the BUILD-favorable side. REVIEW remains the gate authority; debate output is evidence for a post-debate REVIEW round, not a gate decision.

Cross-references:
- Rule 2 (CLAUDE.md `non-negotiable rules`): BUILD vs REVIEW cross-family enforced at the REVIEW gate.
- `requestDebate()` at `src/tools/debate-request.ts:174-188`: caller vs opposing-family enforced at fire time.
- Load-time validator at `src/agents/schema.ts:402-424`: `opposingProviders` cannot include the persona's own family.
- Replan thread: `docs/research/CODEX_RESPONSE_M15_REPLAN.md` § Q2.

## Pinned design decisions (history)

These were locked during planning convergence (Codex `gpt-5.5 xhigh` debate, thread `019e0561-3c95-72a2-b786-056eb685307f`, 2026-05-07):

- **Reviewer permission grant (Path A, locked 2026-05-08)**: bundled `src/agents/defaults/reviewer.md` is granted `tool_use.debate` with `opposingProviders: ['claude']` so the rule-21 baseline measures on the canonical-fixture-friendly path. The list narrows to `claude` only because `gemini` is a stub (eligiblePhases=NO_PHASES) and `codex` is reviewer's own family; `xai` is M11-eligible but requires operator-configured API-key auth that bundled defaults stay conservative on. Path B (auto-mode opt-in only via persona customization) was rejected because it would prove the baseline on customization rather than on the bundled product. See `docs/design/SESSION_M15_IMPL_KICKOFF.md` §2.1.
- **Trigger split single vs panel (Codex Risk #1)**: panel mode never fires `score_in_grey_zone` or `needs_revision_with_high_score`. Panel REVIEW has no numeric Score.Final score; treating the literal `panel` sentinel as a numeric value would silently misfire.
- **Lock-collision fix (Codex Risk #4)**: the post-debate REVIEW round runs through an executor seam that does NOT re-acquire `.review.lock`. Production wiring + tests verify ≤1 acquire per outer `runReview` call.
- **Aggregate preflight (Codex Q6)**: refuse-before-fire is the gate. Mid-debate `assertWithinBudget` chokepoints stay as backup, never as primary mechanism.
- **REVIEW always wins (Codex Q9)**: DECISION.md is evidence the post-debate REVIEW round considers; it is not a gate authority. If post-debate REVIEW returns the same verdict as pre-debate AND adds zero new findings, that's a no-signal fire — wasteful, not broken.
