# Briefing — M15 Debate-policy scheduler v1

**Brief date:** 2026-05-07
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule (planning convergence) + ROADMAP.md line 380 ("M15 — Debate-policy scheduler v1") + `docs/design/SESSION_M15_KICKOFF.md` Phase 1
**Prior context (load order):**
- `docs/design/ROADMAP.md` lines 374-388 (post-M10 productization sequence; M15 row at 380)
- `docs/design/SESSION_M15_KICKOFF.md` (the kickoff Claude is currently executing — locks scope to single-opponent scheduler)
- `docs/contracts/DEBATE.md` (M10 runtime contract; `requestDebate` shape, event taxonomy, permission sub-scope)
- `docs/contracts/COMPANY.md` lines 167-180 (M15 forward-compat note: "scheduler reads from per-persona `tool_use.debate.opposingProviders`, not from `company:`")
- `docs/contracts/REVIEW.md` (single-reviewer M9 baseline) + `docs/contracts/REVIEW_PANEL.md` (M14 panel surface — *not* extended by M15, only consumed)
- `docs/contracts/PROVIDERS.md` § "Capabilities and eligibility (M11)"
- `src/tools/debate-request.ts` (M10 runtime — single-opponent primitive; M15 does NOT touch this file's body)
- `src/tools/debate-request-extract.ts` (manual `<debate-request>` extraction; preserved as the `mode: manual` path)
- `src/phases/plan.ts` lines 271-365 (current persona-side trigger; M15 leaves it intact)
- `src/state/schemas.ts` lines 168-180, 779-820 (debate event schemas the scheduler extends)
- `src/providers/cost.ts` (M13 budgets; scheduler must respect `budgets.global`)
- CLAUDE.md non-negotiable rules 1, 2, 7, 9, 13, 16, 19, 20, 21
- Memories `m14_progress.md`, `m13_progress.md`, `m10_progress.md`, `feedback_one_phase_per_milestone.md`, `feedback_no_tech_debt.md`

---

## 1. Goal

Ship M15 as an **automatic-trigger policy** for the existing single-opponent `requestDebate()` runtime built in M10. The orchestrator decides when to fire a debate based on objective signals from completed phase artifacts; the persona is no longer the only trigger. Land as `v0.16.0-alpha.0` after Codex review verdict `push`.

The product principle this milestone serves (CLAUDE.md rule 21 + `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`): **no parallel-provider surface lands without measurable risk reduction in `events.jsonl` against the simpler baseline.** "Scheduler-on" must produce a measurable signal vs "scheduler-off" before M15 ships, not after. The signal is defined in §4.8 of this brief.

The "AI software company" framing (`AI_SOFTWARE_COMPANY_THESIS.md`): in a real engineering team, calling for a second opinion is sometimes the manager's job, not the IC's. M15 makes that managerial discipline programmatic, not a persona prompt-engineering trick.

---

## 2. Non-negotiable constraints (locked, NOT debatable)

These are pinned by `SESSION_M15_KICKOFF.md` § "M15 scope" + CLAUDE.md rules + the M10 runtime contract. Codex MUST treat them as load-bearing in the response; deviation requires a separate full debate.

### 2.1 Rule 20 — one new authority boundary per milestone

M15's authority boundary is **orchestrator-side automatic-trigger policy + measurable risk metric**. Everything else is bundling and must be explicitly out-of-scope:
- NO multi-opponent debate (single-opponent only per M10; multi-opponent is M16+ pending measurable need)
- NO Researcher phase-tail (deferred per ROADMAP.md line 381)
- NO new permission scope (reuse `tool_use.debate`; introducing `tool_use.debate.scheduler` would bundle a permission authority on top of the trigger authority)
- NO new persona role ("scheduler-as-persona" is bundling; the scheduler is mechanical orchestrator code, not an LLM)
- NO new gate file (gate writes still depend on existing phase gate criteria; debate result feeds back into the same phase round)
- NO modification to `src/tools/debate-request.ts` body (the M10 primitive is frozen surface)

### 2.2 Rule 21 — measurable risk reduction is the ship gate

Without a defined `events.jsonl` measurement that demonstrates scheduler-on vs scheduler-off risk reduction, M15 does not ship. The measurement must:
- Be **deterministic** (computable from `events.jsonl` alone, no live-provider variance)
- **Compare scheduler-on vs scheduler-off on the same FakeProvider fixtures**
- **Surface upstream of the scheduler call site** so the metric records *both fired and skipped decisions*, not just the ones that fired (M14 R9 lesson: bake the metric into `events.jsonl` schema upstream of the scheduler call site, not retrofitted from event-stream filtering)
- Surface as `code-oz doctor --debate-policy-baseline` (or equivalent CLI command, mirroring M14's `--panel-baseline`)

Specific metric proposal in §4.8.

### 2.3 Single-opponent only (M10 primitive frozen)

The runtime primitive in `src/tools/debate-request.ts` ships exactly the same shape M10 ships: one caller, one opposingProvider, one BRIEFING + RESPONSE + DECISION cycle. The scheduler chooses *when* to call it, not *how many* opponents to call. Multi-opponent is M16+.

### 2.4 File-based gate signals only (rule 1)

Scheduler decisions are typed structures persisted as `events.jsonl` events — never parsed from LLM text. The decision function is a pure deterministic predicate over typed inputs (REVIEW.md parsed result + cost-policy state + cooldown counters); LLMs are not consulted.

### 2.5 Per-persona `opposingProviders` (M12 contract) is the source of truth

When the scheduler decides to fire, the opposingProvider is selected from the calling persona's `tool_use.debate.opposingProviders` list — *not* from a new `debatePolicy.opponent` config row, *not* from `company:` overrides. The M10 selection logic is reused unchanged. If the persona has no `tool_use.debate` permission OR an empty `opposingProviders` list OR a list whose entries fail M11 eligibility, the scheduler emits `debate_scheduler_skipped` with reason `persona_no_eligible_opponent` and the gate writes as normal.

### 2.6 Cross-family discipline preserved (rule 2)

Scheduler-fired debates honor the same cross-family checks as manual debates. The `requestDebate` runtime still enforces caller-vs-opponent family separation; M15 adds nothing to that enforcement and removes nothing.

### 2.7 No new parallel-provider surface beyond M14

The scheduler may *consume* M14 panel verdicts as a trigger signal. It must NOT *extend* the panel surface, e.g., by auto-debating against multiple panel members in parallel. That is M16+ multi-opponent territory.

### 2.8 Default mode preserves existing behavior

Default `debatePolicy.mode: "manual"` reproduces M10's behavior unchanged: the PLAN persona emits `<debate-request>` blocks; orchestrator forwards to `requestDebate`. New users get this. Auto-mode is explicit opt-in via `.code-oz/config.yaml`.

### 2.9 Pinned answers — closed in advance (Codex must not reopen)

Per `SESSION_M15_KICKOFF.md` § "Open shape questions to resolve in the Codex debate":

| Question | Pinned answer | Source |
|---|---|---|
| Multi-opponent debate? | NO | rule 20, kickoff §M15 scope |
| Researcher phase-tail? | NO | ROADMAP line 381, deferred to M16+ |
| Scheduler ownership | Orchestrator, not persona | kickoff §M15 scope |
| Single-opponent runtime change | NO | M10 primitive frozen |
| Per-persona `opposingProviders` source of truth | YES | COMPANY.md line 180, DEBATE.md |

If Codex reopens these, push back with the citation. Productive disagreement is welcome on the §5 open questions only.

---

## 3. Recommended plan (Claude's draft for Codex pressure-test)

### 3.1 Commit sequence (one authority slice per commit, eight total)

| # | Commit | Authority |
|---|---|---|
| 1 | `feat(state): debate scheduler event types` — extend `src/state/schemas.ts` with `debate_scheduler_evaluated`, `debate_scheduler_fired`, `debate_scheduler_skipped`. Validators in `src/state/events.ts`. | Schema |
| 2 | `feat(policy): pure scheduler decision function` — new `src/policy/debate-scheduler.ts` with `SchedulerInput`, `SchedulerDecision`, `evaluateSchedulerDecision()`. Pure function, no I/O, no LLM. | Decision logic |
| 3 | `feat(config): debatePolicy: block in CodeOzConfig` — `src/config/schema.ts` adds `debatePolicy?: { mode, triggers, cooldown, maxPerRun, maxPerTask }`. Default `{ mode: 'manual' }`. | Config surface |
| 4 | `feat(phases/review): post-REVIEW scheduler hook` — `src/phases/review.ts` (and `review-panel.ts`) post-verdict-computation, pre-gate-write hook calls `evaluateSchedulerDecision`. On fire, invokes `requestDebate` synchronously; debate result feeds an extra REVIEW round (consumes existing 4-round cap). | Trigger surface |
| 5 | `feat(providers): scheduler honors budgets.global` — `src/providers/cost.ts` integration. Pre-fire `assertWithinBudget` simulation; if firing would tip budget, scheduler emits `debate_scheduler_skipped` with reason `budget_exhausted`. | Cost policy interaction |
| 6 | `feat(commands/doctor): --debate-policy and --debate-policy-baseline` — surfaces current config + last-N decisions + rule-21 baseline metric. Mirrors M14's `--panel-baseline` shape. | Observability |
| 7 | `docs(contracts/DEBATE_POLICY): orchestrator-owned authority surface` — new `docs/contracts/DEBATE_POLICY.md`. Defense-in-depth layers, common errors, opt-out semantics, rule-21 metric definition, forward-compat for M16+. | Contract |
| 8 | `feat(tests): e2e + ROADMAP closure` — `tests/e2e/debate-scheduler-grey-zone.test.ts` (FakeProvider REVIEW grey-zone fires debate; debate flips verdict; new round writes gate). ROADMAP M15 row marked closed. | Verification |

Each commit is a single authority slice. Codex pressure-test in Q10: am I bundling anything?

### 3.2 File surface

**New files:**
- `src/policy/debate-scheduler.ts` (~200 LOC: types, pure `evaluateSchedulerDecision`, helpers for hysteresis counter from `events.jsonl`)
- `docs/contracts/DEBATE_POLICY.md` (~7-9k: surface, defense-in-depth, errors, forward-compat)
- `tests/policy-debate-scheduler.test.ts` (pure unit — fixtures cover every trigger + every skip reason)
- `tests/phases/review-scheduler-integration.test.ts` (REVIEW phase integration; both manual and auto modes)
- `tests/e2e/debate-scheduler-grey-zone.test.ts` (FakeProvider end-to-end)
- `tests/commands-doctor-debate-policy.test.ts` (doctor command + baseline)

**Extended files:**
- `src/state/schemas.ts` (+3 event types in the union, +schemas)
- `src/state/events.ts` (+3 validators)
- `src/config/schema.ts` (+`debatePolicy` field)
- `src/config/load.ts` (+`mergeDebatePolicy`)
- `src/phases/review.ts` (+post-verdict-computation hook)
- `src/phases/review-panel.ts` (+post-verdict-computation hook; mirrors `review.ts`)
- `src/commands/doctor.ts` (+`--debate-policy`, `--debate-policy-baseline`)
- `docs/design/ROADMAP.md` (M15 row closed)
- `MEMORY.md` (+`m15_progress.md` index entry)

**Untouched (locked surfaces):**
- `src/tools/debate-request.ts` (M10 primitive frozen)
- `src/tools/debate-request-extract.ts` (manual extraction path preserved)
- `src/tools/debate-permissions.ts` (permission preview unchanged)
- `src/agents/schema.ts` (no new permission scope)

---

## 4. Locked design choices (Claude's draft — Codex MUST pressure-test these)

### 4.1 Trigger surface — REVIEW post-completion only (single call site)

| Considered surface | Verdict | Reason |
|---|---|---|
| Pre-VERIFY phase tail | REJECT | VERIFY is a deterministic test runner; debating BUILD's plan choice before validation is moot — the test result IS the validation. |
| Pre-REVIEW phase tail | REJECT | REVIEW input is BUILD output; nothing to debate before reviewers weigh in. |
| **Post-REVIEW phase tail (pre-gate-write)** | **ADOPT** | REVIEW.md verdict is the highest-stakes signal in v0.1 (gates the milestone). Grey-zone scores and panel disagreement are objective triggers. |
| Post-VERIFY (on fail) | REJECT for v1 | VERIFY-fail already triggers BUILD restart per M8; layering scheduler on top bundles authority with M8's restart-on-fail. M16+. |
| Anywhere a phase fails | REJECT | "Anywhere" violates single-call-site discipline (rule 20). |

The hook fires AFTER `computeCanonicalVerdict` (single-reviewer M9) or `computeCanonicalPanelVerdict` (panel M14) but BEFORE `GATE_REVIEW_PASSED.json` is written. If the scheduler fires, `requestDebate` runs synchronously; the resulting DECISION.md is included in the REVIEW round's evidence; an extra REVIEW round runs (consuming the existing 4-round cap, no new cap); gate writes from the post-debate REVIEW result.

### 4.2 Trigger signals (objective only — verdict-confidence rejected)

The scheduler decision function is a pure predicate over `SchedulerInput`:

```ts
type SchedulerInput = {
  readonly mode: 'off' | 'manual' | 'auto'
  readonly review: {
    readonly score: number  // REVIEW.md Score.Final score
    readonly verdict: 'ready' | 'needs-revision' | 'block'
    readonly mode: 'single' | 'panel'
    // Panel-only:
    readonly panelistVerdicts?: ReadonlyArray<{ id: string; verdict: 'ready' | 'needs-revision' | 'block' }>
  }
  readonly history: {
    readonly debatesFiredThisRun: number
    readonly debatesFiredThisTask: number
    readonly priorFingerprintsThisTask: ReadonlySet<string>
  }
  readonly budget: { readonly wouldTipIfFired: boolean }
  readonly persona: {
    readonly hasDebatePermission: boolean
    readonly opposingProviders: readonly ProviderId[]  // post-eligibility filter
  }
  readonly policy: {
    readonly maxPerRun: number
    readonly maxPerTask: number
    readonly triggers: {
      readonly reviewScoreGreyZone: { readonly min: number; readonly max: number }
      readonly panelVoterDisagreement: boolean
      readonly needsRevisionWithHighScore: boolean  // verdict=needs-revision AND score >= 6
    }
  }
}

type SchedulerDecision =
  | { readonly fire: true; readonly reason: SchedulerFireReason }
  | { readonly fire: false; readonly reason: SchedulerSkipReason }
```

**Trigger signals (`SchedulerFireReason`):**
- `score_in_grey_zone`: `score ∈ [triggers.reviewScoreGreyZone.min, max]` (default `[5, 7]`)
- `panel_voter_disagreement`: panel mode + eligible voters return distinct verdicts (one ready, one needs-revision)
- `needs_revision_with_high_score`: `verdict === 'needs-revision' AND score >= 6` (boundary case — almost ready)

**Skip signals (`SchedulerSkipReason`):**
- `mode_off` / `mode_manual` (auto disabled)
- `no_trigger_matched` (none of the above signals fired)
- `max_per_run_exhausted` / `max_per_task_exhausted`
- `budget_exhausted`
- `persona_no_debate_permission`
- `persona_no_eligible_opponent` (empty opposingProviders post-M11-eligibility-filter)
- `dedup_fingerprint_already_debated` (this `(taskId, attempt, fingerprint)` already triggered in this run)

**Verdict-confidence is NOT used.** Per kickoff debate prompt: "Is verdict-confidence the right primary signal, or is it post-hoc rationalization that lets weak BUILDs slip through?" My answer: post-hoc. Persona-authored verdict-confidence is a self-report under the same prompt that produced the verdict — same prior, same blind spot. Objective signals (score grey-zone, voter disagreement) are model-independent.

### 4.3 Hysteresis defaults (locked)

```yaml
debatePolicy:
  mode: manual              # 'off' | 'manual' | 'auto'
  maxPerRun: 2              # cap on auto-fired debates per run
  maxPerTask: 1             # cap per (runId, taskId) — no consecutive auto-fires on same task
  triggers:
    reviewScoreGreyZone: { min: 5, max: 7 }
    panelVoterDisagreement: true
    needsRevisionWithHighScore: true
  cooldown:
    dedupByFingerprint: true   # same (taskId, attempt, fingerprint) doesn't re-trigger
```

Counters (`history.debatesFiredThisRun`, `debatesFiredThisTask`) are derived from `events.jsonl` reduction over `debate_scheduler_fired` events for the matching run/task — not from a parallel state file (rule 1: file-based gate signals; rule 19: cumulative spend from events.jsonl, no parallel state).

### 4.4 Default mode = `manual`

Three modes:

| Mode | Manual `<debate-request>` blocks | Scheduler auto-fires |
|---|---|---|
| `off` | Disabled (returns intervention if persona emits `<debate-request>`) | Disabled |
| `manual` | Enabled (M10 behavior unchanged) | Disabled |
| `auto` | Enabled | Enabled |

`manual` is the default. New users get M10 behavior unchanged. `auto` is explicit opt-in. `off` is the escape hatch for "no debates at all this run" (useful for cost-constrained runs and for the rule-21 baseline measurement; see §4.8).

### 4.5 Failure surface

The scheduler decision function never throws. `requestDebate` *can* throw at runtime (auth-fail, manifest-blocked, malformed RESPONSE, etc.). When the scheduler fires and `requestDebate` throws:

| Underlying error | Scheduler reaction |
|---|---|
| `provider_auth_missing` | Emit `debate_scheduler_error { reason: 'auth_missing' }` + `NEEDS_INTERVENTION.json` (operator-actionable, not transient). Gate does NOT write. |
| `debate_manifest_blocked` | Emit `debate_scheduler_error { reason: 'manifest_blocked' }`. Gate writes from the *original* REVIEW verdict (degraded). |
| `debate_response_invalid` / `debate_decision_invalid` | Emit `debate_scheduler_error { reason: 'artifact_invalid' }`. Gate writes from original. |
| `debate_concurrent_limit_exceeded` | Emit `debate_scheduler_error { reason: 'concurrent_limit' }`. Gate writes from original. |
| Any other `ProviderError` | Emit `debate_scheduler_error { reason: 'other' }`. Gate writes from original. |

Rationale: auth-missing is the only operator-actionable structural error in this surface; degrading silently on manifest/parse errors preserves the rule-1 invariant (gate writes from a real REVIEW verdict, not from an aborted scheduler attempt).

### 4.6 Schema location

Extend `src/state/schemas.ts` (existing pattern; mirrors how M10 added `debate_started` / `debate_resolved` to the union). Pure logic in new `src/policy/debate-scheduler.ts`. No new file under a hypothetical `src/state/schemas/` (the project keeps schemas as a single union-shaped module).

New event types in the existing `LoggedEvent` union:

```ts
| {
    readonly version: 1
    readonly type: 'debate_scheduler_evaluated'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly mode: 'off' | 'manual' | 'auto'
    readonly inputDigest: string  // sha256 of canonicalized SchedulerInput (rule-21 reproducibility)
  }
| {
    readonly version: 1
    readonly type: 'debate_scheduler_fired'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly reason: SchedulerFireReason
    readonly opposingProvider: ProviderId
    readonly debateTopic: string  // matches debate_started.topic for join-key
  }
| {
    readonly version: 1
    readonly type: 'debate_scheduler_skipped'
    readonly ts: string
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly phase: 'review'
    readonly reason: SchedulerSkipReason
  }
```

`debate_scheduler_evaluated` always fires (rule-21 record both fire and skip in one place). `_fired` and `_skipped` are the disjoint outcomes. The `inputDigest` field lets the rule-21 baseline command verify that the same input across two runs (scheduler-on / scheduler-off) is genuinely the same.

### 4.7 Permission scope — reuse `tool_use.debate`

No new `tool_use.debate.scheduler` sub-scope. Rationale:

- The persona on which the scheduler acts is the calling persona for the eventual `requestDebate` call. That persona's `tool_use.debate` permission already governs what it may debate, against whom, with what file budget, and at what concurrency.
- Adding `tool_use.debate.scheduler` would bundle a permission-design authority on top of M15's trigger authority (rule 20 violation).
- The "scheduler is orchestrator-owned" pinned answer (§2.9) refers to the *trigger decision*, not the *permission gate*. The orchestrator decides; the persona's permission still gates whether the call can land.
- A persona with no `tool_use.debate` declared simply gets `debate_scheduler_skipped { reason: 'persona_no_debate_permission' }` — same skip semantics as `mode: manual`.

### 4.8 Rule-21 metric (TWO metrics, both deterministic on FakeProvider)

The metric is defined **before** implementation per rule 21 + the M14 R9 lesson (kickoff §Acceptance gate: "Measurable risk-reduction metric defined and emitted to events.jsonl per scheduler decision").

**Metric 1: Verdict-flip rate.**
- Definition: % of `debate_scheduler_fired` events whose post-debate REVIEW round produces a *different* `Score.Final verdict` than the pre-debate round.
- Numerator: count of fired debates where `verdict_pre !== verdict_post`.
- Denominator: count of `debate_scheduler_fired` events in the run set.
- **Floor: ≥10%** on the FakeProvider baseline fixture set. A scheduler that flips < 10% of fired verdicts is mostly no-op; cost story does not earn its keep.

**Metric 2: New-finding rate.**
- Definition: % of fired debates whose post-debate REVIEW round raises ≥1 new finding fingerprint not present in the pre-debate REVIEW round.
- Numerator: count of fired debates where `findings_post \ findings_pre ≠ ∅`.
- Denominator: count of `debate_scheduler_fired` events.
- **Floor: ≥30%** on the FakeProvider baseline. Lower means the debate is mostly re-confirming, not generating new signal.

**Both metrics are deterministic on FakeProvider** because FakeProvider responses are scripted by `(phase, agent, taskId, attempt, reviewRound, debateTurn)` keying. The baseline command runs the same fixture under `mode: off` (control) and `mode: auto` (treatment) and computes the metrics from the resulting `events.jsonl` pair.

**Surface:** `code-oz doctor --debate-policy-baseline` (mirrors M14's `--panel-baseline` shape). Output:
- Pass/fail per metric vs floor.
- Per-trigger breakdown (which `SchedulerFireReason` produced which flips/findings).
- `debate_scheduler_baseline_completed` event emitted for telemetry.

The metric is the rule-21 gate: M15 does not tag if either floor is unmet on the canonical fixture set.

### 4.9 Interaction with M14 panel

M14 panel verdicts are **read-only** inputs to the scheduler. Specifically, the panel verdict computation (`computeCanonicalPanelVerdict`) is unchanged; the scheduler observes:

- `panelistVerdicts`: per-panelist `(id, verdict)` pairs
- The synthesized `Score.Final score` (panel-level)
- The synthesized `Score.Final verdict` (panel-level)

Panel voter disagreement (one eligible voter says ready, the other says needs-revision) is the strongest panel-mode trigger. Advisory-only disagreement is *not* a trigger (consistent with §2.7 in REVIEW_PANEL.md: advisory findings have `authorityImpact: 'advisory'`).

If panel mode is configured with `panelVoterDisagreement: true` AND the eligible voters split, scheduler fires. The chosen opposingProvider for the scheduler-fired debate comes from the *calling persona's* `tool_use.debate.opposingProviders`, not from one of the panel voters — the scheduler's debate is a third opinion, not a re-litigation of one panelist's view.

---

## 5. Open questions for Codex (debate prompts)

Codex MUST answer each directly. Vague verdicts ("looks fine") are insufficient — give a recommendation with reasoning. Pinned answers in §2.9 are not eligible for these prompts.

### Q1. Trigger surface — single call site at post-REVIEW, or also pre-VERIFY?

§4.1 commits to post-REVIEW only. Pre-VERIFY was rejected because VERIFY is a deterministic test runner. **Is post-REVIEW alone sufficient for v1, or does pre-VERIFY add value I missed?** Specifically: pre-VERIFY would let the scheduler debate "is this BUILD plan likely to pass verification?" before the test even runs. That's a different question class than "is this REVIEW verdict trustworthy?". Argument for: catches plan-level errors before VERIFY's binary signal. Argument against: pre-VERIFY signal is squishier (no objective score yet); rule-20 says one call site for v1; M16+ can add more.

### Q2. Verdict-confidence — really post-hoc, or am I over-rotating?

§4.2 rejects verdict-confidence as a primary signal because persona-authored confidence is under the same prior as the verdict it accompanies. **Is this the right call, or is verdict-confidence actually useful as a tiebreaker on score grey-zone?** Counter-argument: a persona that scores 6 with confidence 0.4 is materially different from a persona that scores 6 with confidence 0.95. The 0.4 case is exactly when a debate is most useful.

### Q3. Default mode — `off`, `manual`, or `auto`?

§4.4 picks `manual`. **Is that right?**
- `off` default: zero behavioral change; users must opt in twice (set `manual` to use `<debate-request>`, set `auto` to use scheduler). Friction.
- `manual` default: M10 behavior preserved; scheduler is opt-in.
- `auto` default: aggressive; new users get scheduler-fires-on-grey-zone immediately. May feel surprising (cost spike, latency spike).

### Q4. Permission scope — reuse `tool_use.debate` or new sub-scope?

§4.7 reuses existing scope. Alternative: introduce `tool_use.debate.scheduler: { enabled: boolean, maxFiresPerPhase: number }` so personas can declare scheduler-eligibility independently of manual debate eligibility. **Is the simpler reuse the right call, or is the bundling argument too strict?** Counter: a future "Researcher" or "QA" persona may want manual debate but no auto-scheduler exposure. Today's bundled personas don't, but the scope precedent matters.

### Q5. Panel-mode triggers — voter disagreement only, or also advisory raising `block`?

§4.9 limits panel-mode triggers to *eligible voter* disagreement, ignoring advisory voters even when they raise `block`. **Is that right?** Counter-argument: an advisory voter raising `block` is exactly the construction-guarantee-no-veto case — but it's also the case where a debate might surface real signal that the cross-family voters missed. Should `panelAdvisoryRaisesBlock` be a (default-off, opt-in) trigger?

### Q6. Cost-policy interaction — strict pre-check vs running aggregate?

§3.1 commit 5 proposes "if firing would tip budget, scheduler skips with reason `budget_exhausted`." But debate is multiple provider calls (opposing + synthesis = +2 minimum, +3 if continuation). **Should the scheduler:**
- (a) Refuse to fire if the *worst-case* debate cost would tip budget (strict; conservative);
- (b) Fire and let the in-flight `assertWithinBudget` chokepoint kill it mid-debate (aggressive; uses partial debate value);
- (c) Compute expected cost from priceTable + maxFiles + persona budgets and decide?

§4.5 implies (a). Defend or push back.

### Q7. Rule-21 metric — are verdict-flip + new-finding rates sufficient?

§4.8 proposes two metrics with floors of 10% and 30%. **Are these the right metrics?** What's missing? Some candidates:
- Per-trigger-reason effect: do score-grey-zone fires have different metrics than panel-disagreement fires? Useful for tuning trigger thresholds.
- Cost overhead per fired debate: events.jsonl already has `tokensEstimate` per `agent_invoked`; the baseline could surface average cost per fire.
- Latency overhead: wall time per fired debate (mean / p95).
- False-fire rate: % of fires where post-debate REVIEW returns *exactly the same* verdict and findings (no signal at all).

Are the two I picked the right two for the v1 ship gate, with the rest as M16+ telemetry?

### Q8. Failure surface — `provider_auth_missing` raises NEEDS_INTERVENTION but other errors degrade silently. Right call?

§4.5 says only `provider_auth_missing` raises NEEDS_INTERVENTION; other `requestDebate` errors degrade to "gate writes from original REVIEW verdict." **Is that the right policy?** Counter: `debate_concurrent_limit_exceeded` is also operator-actionable (resolve open debates). `debate_manifest_blocked` is operator-actionable (fix `.code-ozignore`). Should the policy be "any operator-actionable error raises NEEDS_INTERVENTION; only transient/parse errors degrade silently"? If so, what's the canonical list?

### Q9. Debate result feeds an extra REVIEW round — but if DECISION conflicts with reviewer findings, who wins?

§4.1 says "debate result feeds back into REVIEW round; gate writes from post-debate REVIEW result." But DECISION.md (caller-authored synthesis) and REVIEW.md (reviewer-authored verdict) can disagree. Concrete case: REVIEW says `score: 6, verdict: needs-revision`; debate fires; DECISION says "the reviewer's concern is wrong, ship it"; post-debate REVIEW round still says `needs-revision`. **Who wins?**
- (a) The post-debate REVIEW round (current proposal — REVIEW always wins; debate is signal, not authority).
- (b) DECISION.md (debate concluded, persona accepted; ship).
- (c) Mandatory-third-round logic (if DECISION and REVIEW still disagree, escalate to NEEDS_INTERVENTION).

§4.1 implies (a). I lean (a) because REVIEW remains the gate authority (rule 1; M9). But (a) means scheduler-fired debates can be no-ops if the reviewer is stubborn — is that wasteful?

### Q10. Authority bundling check (rule 20)

Look at §3.1 against rule 20. **Am I bundling anything?** Specifically:
- Commit 4 introduces both REVIEW phase hook AND extra-REVIEW-round-on-fire mechanic. Are those one authority (post-REVIEW automation) or two (trigger + result-consumption)?
- Commit 6 ships both `--debate-policy` (config inspector) AND `--debate-policy-baseline` (rule-21 metric). Should baseline be its own commit?
- §4.8 proposes two metrics; §4.4 ships three modes. Is the "modes + metrics" pair one authority (debatePolicy surface) or two?

### Q11. Anything else load-bearing missing?

Open prompt: what does the brief miss that would block M15 or surface a bug six months from now? Specifically interested in:
- Resume semantics: a run interrupted between `debate_scheduler_fired` and `debate_started` (or between `debate_resolved` and post-debate REVIEW round) — what's the recovery?
- Concurrency with `requestDebate` from a manual `<debate-request>` block in the same run: M10's `maxConcurrent: 1` per `(runId, phase)` — does scheduler-fired debate count? §4.5 row `debate_concurrent_limit_exceeded` says yes; defend or push back.
- Privacy/manifest interactions: scheduler-fired debates use the calling persona's `tool_use.debate.maxFiles` budget. The files surfaced come from the scheduler's choice, not the persona's `<debate-request>` body. What files does scheduler surface? My answer: the changed-file manifest from `BUILD_REPORT.md` + the `REVIEW.md` itself. Is that right?
- TUI / inspector implications (W2.2): does the scheduler need a real-time "scheduler decided X" surface, or is `events.jsonl` post-hoc enough?

---

## 6. Anti-patterns to reject explicitly

If Codex's response includes any of these, that's a failure of the briefing — push back hard.

1. **"Add a Scheduler persona"** — bundling, violates rule 20. The scheduler is mechanical orchestrator code.
2. **"Make `auto` the default"** — see Q3; cost story not proven yet, and M10 behavior preservation matters.
3. **"Add multi-opponent debate"** — out of scope per §2.3 + kickoff lock.
4. **"Use verdict-confidence as primary signal"** — post-hoc rationalization risk per §4.2.
5. **"Defer the rule-21 measurement to a follow-up"** — rule 21 IS the ship gate; deferring it ships an unsubstantiated claim.
6. **"Add a new `tool_use.debate.scheduler` permission scope"** — see §4.7 + Q4; bundling unless Codex makes a strong case.
7. **"Skip Codex review before tag"** — violates CLAUDE.md cross-model peer review rule.
8. **"Generalize the scheduler to fire from any phase"** — rule 20 says one call site for v1.
9. **"Replace `requestDebate` with a multi-opponent variant for the scheduler path"** — out of scope per §2.3.
10. **"Add a new gate file for scheduler decisions"** — rule 1 + §2.1; gate writes still depend on existing phase gate criteria.

---

## 7. Acceptance criteria (Codex's verdict will be measured against these)

Codex's response is acceptable if it:
- Answers all 11 open questions (Q1-Q11) directly with a recommendation + reasoning, not just "looks fine"
- Explicitly addresses authority-bundling (Q10 + §3.1) — confirms or pushes back on the eight-commit shape with rule-20 lens
- Confirms or pushes back on the §4.8 rule-21 metric definition — must give a yes/no on whether the two metrics + floors satisfy rule 21
- Flags any anti-pattern from §6 if it surfaces in their reasoning
- Identifies at least one risk or bug Claude's draft missed (because if the draft is perfect, Codex isn't earning its keep)

Verdict types Codex can return (per DEBATE.md § "Verdict enum"):
- `accept` — Claude's draft holds; proceed to implementation
- `accept-with-modifications` — Claude's draft is directionally right but specific decisions need adjustment (list them)
- `reject` — fundamental issue; M15 needs different shape (justify with reasoning)
- `feature-with-modifications` — the proposed direction is real but the scope or naming should change

---

## 8. Codex configuration

```toml
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
sandbox = "read-only"
approval_policy = "never"
```

Per CLAUDE.md cross-model peer review rule § "Codex model fallback": `gpt-5.5-codex` and `gpt-5.1-codex-max` do NOT work on Ozzy's account; fall back to `gpt-5.5` if invoked variant fails. xhigh effort is set in `~/.codex/config.toml` defaults; explicitly pass in this debate to be sure.

---

## End of brief
