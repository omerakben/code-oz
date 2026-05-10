---
name: rule-21 benchmark methodology
companion-docs: ../../CLAUDE.md (rule 21), ./DEBATE_POLICY.md (worked example)
target: any milestone proposing a new parallel-provider surface (multi-opponent debate, parallel builder candidates, researcher fan-out, reviewer panel v2, etc.)
status: canonical methodology; MUST be satisfied before the rule 21 ship gate fires for any new parallel-provider surface
---

# RULE21_BENCHMARK (v0.1)

Canonical measurement methodology for CLAUDE.md non-negotiable rule 21. This contract generalizes the rule-21 ship-gate pattern that [`DEBATE_POLICY.md`](./DEBATE_POLICY.md) shipped for the M15 debate-policy scheduler into a milestone-agnostic playbook. Any future milestone that proposes a new parallel-provider surface must satisfy the gating metrics defined here before its ship gate can fire.

This is a methodology contract, not an authority claim. It introduces no new gates, no new permission sub-scopes, and no new artifact types. It codifies how the project measures the risk-reduction effect that rule 20 has already decided to grant authority for.

### Relationship to DEBATE_POLICY.md

This doc and `DEBATE_POLICY.md` carry different responsibilities:

- **`DEBATE_POLICY.md` is the worked example.** It defines the M15 debate-policy scheduler's surface, config grammar, event taxonomy, defense-in-depth ordering, failure surface, opt-out semantics, and the rule-21 metric definitions specifically for that surface. It is the authoritative spec for M15 and the canonical reference for how the methodology was first applied.
- **This doc is the generalized methodology.** It abstracts the rule-21 measurement pattern from M15's specifics (debate-scheduler events, score grey-zone triggers, post-debate REVIEW round) into a shape that future surfaces can apply (multi-opponent debate, parallel builder candidates, Researcher fan-out, reviewer panel v2, etc.). It is the authoritative spec for *how* future surfaces must measure rule-21 satisfaction.

When this doc and `DEBATE_POLICY.md` overlap (they both describe the corrective-rate floor 0.10, the new-actionable-finding floor 0.30, the no-signal-fire telemetry, the cost/latency overhead telemetry), the line numbers in `DEBATE_POLICY.md` are the source of truth for M15-specific text and this doc cites them. If a future revision introduces drift between the two — for example, M15's anti-pattern list adds a thirteenth entry — the methodology contract owner reconciles by either updating this doc to match or filing a contradiction note.

The two docs cross-reference: `DEBATE_POLICY.md` is the canonical worked example; this doc is the canonical methodology that worked example is an instance of.

## Section 1 — What rule 21 demands

### Rule 21 verbatim (CLAUDE.md `non-negotiable rules`)

> **No new parallel-provider surface lands without a measurable risk-reduction effect.** Multi-agent / multi-provider features (Reviewer panels, parallel builder candidates, multi-opponent debate, Researcher fan-out) are added only when their risk-reduction effect is measurable in `events.jsonl` against the single-provider baseline. The Agentless caution (https://arxiv.org/abs/2407.01489) is product policy, not just research context: simpler workflows beat complex agent systems unless complexity earns its keep.

### Definition: parallel-provider surface

A surface is a "parallel-provider surface" — and therefore subject to this methodology — if it satisfies any of the following:

1. **Simultaneous-provider invocation.** The surface can dispatch two or more provider invocations whose outputs feed into the same downstream decision (gate write, verdict, artifact selection). Examples: M14 reviewer panel, hypothetical parallel builder candidates, hypothetical multi-opponent debate.
2. **Cross-provider arbitration.** The surface introduces an orchestrator-side mechanism that selects between, merges, or weights outputs from two or more provider families. Examples: panel quorum / disagreement detection, builder-candidate selector, debate verdict reconciler.
3. **Conditional fan-out.** The surface conditionally dispatches an additional provider invocation in response to a signal from a baseline single-provider phase, where the additional invocation is intended to reduce error in the baseline's output. Examples: M15 debate-policy scheduler post-REVIEW fire, hypothetical Researcher phase-tail fan-out, hypothetical pre-VERIFY trigger.

A surface is **not** a parallel-provider surface (and therefore does not require rule-21 measurement) when:

- It is a deterministic policy / scheduler with no LLM call (e.g., `evaluateSchedulerDecision` is pure code; the rule-21 obligation attaches to the *fire path*, not the predicate).
- It selects between providers but only one is invoked per call (rule 4 model selection, provider fallback chains).
- It is a within-family fan-out used purely for retry / IO transient handling (no risk-reduction claim).
- It is a developer-facing telemetry inspector that reads existing events without dispatching providers (`code-oz doctor --*-baseline`, `code-oz doctor run`).

### Relationship to rule 20

Rule 20 (one new authority boundary per milestone) gates **whether** a parallel-provider surface is even on the roadmap. The milestone scope must declare the surface as its single new authority boundary; bundling a parallel surface with other authorities (a new phase, a new permission sub-scope, a new gate file) is a rule-20 violation that must be unbundled before rule-21 measurement begins.

Rule 21 then gates **whether the surface ships**. Once rule 20 has authorized the surface and the milestone has implemented it, the rule-21 ship gate must fire green against the gating metrics defined in Section 3 before the milestone tag lands. Rule 21 is the *terminal* ship gate for parallel-provider work; rule 20 is the *upstream* scope gate.

The two rules compose: rule 20 prevents authority creep that masks bugs; rule 21 prevents the authority that survives rule 20 from shipping without measurable benefit. Both are non-negotiable; satisfying one does not waive the other.

## Section 2 — Methodology shape: control vs treatment

The methodology is a paired-run experiment over a canonical fixture set. The same fixtures execute twice:

- **Control run.** The pre-existing single-provider behavior. The new parallel-provider surface is configured off (e.g., `debatePolicy.mode: off` for M15; for future surfaces, the equivalent surface-disabled config). The control run captures the baseline `events.jsonl` that the treatment is measured against.
- **Treatment run.** The proposed parallel-provider surface configured to its bundled-default mode (e.g., `debatePolicy.mode: auto` for M15). The treatment run captures the `events.jsonl` that the gating metrics are computed from.

The two runs share the same fixture set, the same provider configuration (modulo the new surface's own config), the same FakeProvider seed, and the same model selection. The only intentional delta is the surface itself. This isolates the surface's risk-reduction effect from incidental variance.

DEBATE_POLICY.md applies this shape to the M15 debate scheduler (see `DEBATE_POLICY.md:130` § "Rule-21 metric definitions" — "the canonical fixture set's events.jsonl pair (control = `mode: off`, treatment = `mode: auto`)"); the same shape applies to any future surface.

### Canonical fixture set: what counts

The canonical fixture set lives under `tests/fixtures/<surface>-baseline/` (M15 example: `tests/fixtures/debate-scheduler-baseline/`). A fixture is a self-contained, deterministic, FakeProvider-only scenario that exercises the surface's decision surface. Fixtures must include both:

- **Fire-expected cases.** Inputs where the surface is *expected* to fire under its bundled-default config. These cases drive the gating metrics' numerators (corrective deltas, new actionable findings).
- **No-op cases.** Inputs where the surface is *not* expected to fire (e.g., REVIEW verdicts well outside the grey zone, persona without `tool_use.debate`, manifest exceeding `maxFiles`). These cases protect against silent misfires and exercise the skip-reason taxonomy.

Both classes must be present. A fixture set composed only of fire-expected cases is a rule-21 anti-pattern (see Section 6) because it removes the surface's selectivity signal.

### Fixture freezing

The canonical fixture set is **closed** once the milestone enters R0 review (the planning-convergence Codex round). Adding fixtures after the rule-21 baseline runs is suspect — the baseline reducer can't distinguish a genuine measurement from a fixture-curation pass that selects for the floor. New fixtures added mid-milestone require their own R0 round and a re-baseline. Fixtures may be added freely *before* R0 and *after* the milestone closes.

### Oracle definition

Each fixture in the set carries an oracle: the ground-truth verdict (or verdict-shaped output) that the surface is being measured against. The oracle is committed alongside the fixture under `tests/fixtures/<surface>-baseline/<fixture>/oracle.json` (or equivalent), so the rule-21 baseline reducer can compute distances deterministically.

For verdict-shaped surfaces (M15 debate scheduler, hypothetical multi-opponent debate, hypothetical pre-VERIFY trigger), the oracle is the canonical REVIEW verdict the fixture should resolve to. For non-verdict-shaped surfaces (hypothetical parallel builder candidates), the oracle is the *bundle* that survives REVIEW more often than any other candidate; the corrective metric measures whether the treatment surface's surviving bundle matches the oracle bundle more often than the control's.

If a surface has no natural oracle (e.g., a panel mode where the verdict is the literal `panel` sentinel rather than a numeric score), the corrective metric returns `null` for that fixture and is excluded from the corrective rate's denominator. M15 applies this to panel-mode debate fires (see `DEBATE_POLICY.md:140` "panel verdicts return distance=null (excluded from corrective rate; v0.1 has no panel oracle)").

### Worked examples per future surface

The shape (control = surface off, treatment = surface on, paired runs over a closed fixture set) is invariant. The oracle, the `pre`/`post` semantics, and the "fire" event differ per surface. This table maps each forward-compat candidate from `DEBATE_POLICY.md:178-186` to its concrete methodology shape:

| Surface | Control config | Treatment config | `pre` artifact | `post` artifact | Oracle |
|---|---|---|---|---|---|
| M15 debate scheduler (worked example) | `debatePolicy.mode: off` | `debatePolicy.mode: auto` | pre-debate REVIEW report | post-debate REVIEW report | canonical REVIEW verdict per fixture |
| Multi-opponent debate | `debatePolicy.multiOpponent: false` (or single-opponent fallback) | `debatePolicy.multiOpponent: true` with N=2 opponents | pre-debate REVIEW report (single-opponent baseline) | post-multi-debate REVIEW report | canonical REVIEW verdict per fixture (same as M15) |
| Researcher fan-out | Researcher persona disabled (no phase-tail dispatch) | Researcher persona enabled | artifact (PLAN, SOURCE_CHECK, etc.) without Researcher evidence | artifact after Researcher evidence consumed | canonical artifact-validation result per fixture |
| Pre-VERIFY trigger | `debatePolicy.preVerify: false` | `debatePolicy.preVerify: true` | pre-debate VERIFY result | post-debate VERIFY result | canonical VERIFY verdict per fixture |
| Configurable quorum | panel quorum threshold = 1 (M14 v1 default) | panel quorum threshold = `panelDisagreementThreshold: k` | v1 canonical panel verdict | v2 canonical panel verdict at threshold k | canonical REVIEW verdict per fixture |
| Per-persona scheduler overrides | run-scoped policy (M15 default) | per-persona overrides applied | scheduler decision per fixture under run-scoped policy | scheduler decision per fixture under per-persona policy | canonical REVIEW verdict per fixture (same as M15) |
| Parallel builder candidates | single builder (current) | N parallel candidate builders + selector | bundle the single builder produced | bundle the selector chose | bundle the canonical fixture's REVIEW oracle marks as surviving |
| Reviewer panel v2 | M14 v1 panel aggregation | v2 aggregation (whatever new mechanism v2 introduces) | v1 canonical panel verdict | v2 canonical panel verdict | canonical REVIEW verdict per fixture |

Two invariants across the table: the canonical fixture set is shared across runs, and the oracle is committed alongside the fixture. A milestone that proposes a new surface but cannot define its row (its control config, treatment config, `pre`/`post` artifacts, and oracle) has not yet earned its rule-20 authority slot — the methodology has nothing to measure against.

## Section 3 — Gating metrics (must hold; numerical floors)

Two metrics carry numerical floors. **PASS requires both floors held AND `firedCount > 0`.** A treatment run that satisfies the floors with zero fires is a no-op surface and does not earn its rule-20 authority allocation; the milestone must either tighten triggers, expand the canonical fixture set with fire-expected cases, or unbundle and defer.

### 3.1 Corrective verdict delta rate (gating, floor 0.10)

**Formula.** For each `<surface>_fired` event with a matching `<surface>_postreview` event in the treatment run, classify the verdict direction against the fixture oracle:

```
distance(verdict, oracle) = 0 if match, 1 if mismatch
panel verdicts (or any oracle-less surface output) return distance = null and are excluded
corrective:      distance(post) < distance(pre)
anti-corrective: distance(post) > distance(pre)
neutral:         distance(post) == distance(pre)

correctiveDeltaRate = correctiveCount / firedCount
```

**Numerator.** Count of fires classified as corrective. **Denominator.** Total `<surface>_fired` count in the treatment run, minus fires excluded for null distance.

**Generalization from DEBATE_POLICY.md.** M15 applies this to the M10 `requestDebate` primitive's post-debate REVIEW round (`DEBATE_POLICY.md:132-146`). The same formula applies to:

- **Parallel builder candidates.** `pre` = the bundle the control run's BUILD produced; `post` = the bundle the treatment run's parallel-builder selector chose. Distance is measured against the oracle bundle (the bundle that the canonical fixture's REVIEW oracle marks as the surviving choice).
- **Multi-opponent debate.** `pre` = the pre-debate REVIEW verdict (same as M15); `post` = the post-multi-debate REVIEW verdict. The multi-opponent variant has no separate distance shape; the additional opponents are an input to the same post-debate REVIEW round.
- **Researcher fan-out.** `pre` = the verdict (or artifact-validation result) without the Researcher signal; `post` = the verdict / result after the Researcher's evidence is consumed.
- **Reviewer panel v2.** `pre` = the v1 panel canonical verdict; `post` = the v2 canonical verdict (after whatever new aggregation v2 introduces).

**What failing the floor means.** A `correctiveDeltaRate < 0.10` means fewer than one in ten fires moves the surface's output toward the oracle. The surface's selectivity signal is not justifying its cost. Operator response: investigate which fixtures' fires are non-corrective (the per-trigger breakdown surfaces this), tighten the trigger thresholds, or expand the canonical fixture set with fire-expected cases that the surface is actually good at.

**Anti-corrective sub-metric.** The `antiCorrectiveCount` is surfaced separately as a regression signal. Anti-corrective fires move the surface's output *away* from the oracle. Even one anti-corrective fire is a documented hazard; sustained anti-corrective rate (e.g., > 0.05) blocks the ship gate independently of the corrective floor (the surface is causing measurable harm).

**Reporting.** The rule-21 baseline output (e.g., `<surface>_baseline_completed` event payload) carries `correctiveCount`, `antiCorrectiveCount`, `neutralCount`, `excludedCount`, `firedCount`, and the computed `correctiveDeltaRate`.

### 3.2 New-actionable-finding rate (gating, floor 0.30)

**Formula.**

```
newActionableFindingRate = newActionableFireCount / firedCount

where newActionableFireCount counts fires whose post-treatment artifact added at least
one finding with severity in {block, fix-first} by fingerprint that was absent from
the pre-treatment artifact.
```

**Numerator.** Count of fires whose post-treatment artifact (post-debate REVIEW report for M15; the surface-equivalent artifact for future surfaces) contained at least one new finding with severity ∈ `{block, fix-first}` keyed by fingerprint that did not appear in the pre-treatment artifact. **Denominator.** Total `<surface>_fired` count in the treatment run.

**Severity restriction (Codex Q7 carry-forward).** `nit` and `fyi` severities do **not** count toward the numerator. M15's design pinned this in `DEBATE_POLICY.md:152` ("`nit` and `fyi` severities do **not** count toward the numerator (Codex Q7 rejection of `any new finding` rate — surfaces noise as signal)"). The same restriction applies to every future parallel-provider surface. Surfacing noise as signal would let surfaces pass the floor by generating cosmetic findings; the methodology forbids it.

**Generalization from DEBATE_POLICY.md.** M15 applies this to post-debate REVIEW reports. The same formula applies to:

- **Parallel builder candidates.** "New finding" = a finding present in the surviving treatment-bundle's REVIEW that was absent from the control-bundle's REVIEW. Severity restriction unchanged.
- **Multi-opponent debate.** "New finding" = a finding present in the post-multi-debate REVIEW that was absent from the pre-debate REVIEW. Severity restriction unchanged.
- **Researcher fan-out.** "New finding" = a finding present in the artifact (PLAN, SOURCE_CHECK, BUILD_REPORT, etc.) that consumed the Researcher's evidence and was absent from the artifact without the Researcher's evidence. Severity restriction unchanged.
- **Reviewer panel v2.** "New finding" = a finding present in the v2 canonical verdict's findings list that was absent from the v1 canonical verdict's findings list. Severity restriction unchanged.

**What failing the floor means.** A `newActionableFindingRate < 0.30` means fewer than three in ten fires surface a new actionable finding. Combined with a passing corrective rate, this can indicate a surface that is "right for the wrong reason" (fixing verdicts without producing new evidence). Combined with a failing corrective rate, it confirms the surface is mostly noise. Operator response: examine the per-trigger breakdown to find which trigger reasons produce the most no-signal fires; tighten those triggers or remove them from the bundled defaults.

**Reporting.** The rule-21 baseline output carries `newActionableFireCount`, `firedCount`, the computed `newActionableFindingRate`, and a `newActionableFindings` breakdown by trigger reason.

### 3.3 PASS condition

```
PASS  ⇔  correctiveDeltaRate >= 0.10
       AND newActionableFindingRate >= 0.30
       AND firedCount > 0
       AND antiCorrectiveCount / firedCount <= 0.05  (regression guard)
```

The rule-21 ship gate (the milestone's `code-oz doctor --<surface>-baseline` entry point) emits PASS only when all four conditions hold. Any failing condition blocks the ship gate; the milestone tag cannot land until either the surface is tuned to PASS or the milestone is unbundled and the surface deferred.

### 3.4 Interpretation matrix

The two gating metrics carry independent diagnostic signal. The four-cell matrix below maps each combination to its operator response. The methodology is designed so that PASS only sits in the upper-left cell; the other three cells each produce specific tuning targets.

| | New-actionable rate >= 0.30 | New-actionable rate < 0.30 |
|---|---|---|
| **Corrective rate >= 0.10** | PASS (subject to regression guard + firedCount > 0) | Surface fixes verdicts without surfacing actionable evidence; investigate whether the corrective fires are coincidental (e.g., trigger reasons that fire on inputs the post-fire artifact happens to flip but adds no new finding fingerprints) |
| **Corrective rate < 0.10** | Surface surfaces actionable evidence but does not move verdicts; investigate whether the new findings are downstream-only (post-fire REVIEW logs them but they do not weight into the verdict) | FAIL with no specific tuning signal — surface is mostly noise; either tighten triggers significantly or unbundle the milestone |

The matrix is consumed at the post-baseline review. The R1 / R2 reviewer reads the metrics + the matrix together to decide whether a tuning round is reasonable or whether the surface needs to be unbundled before the milestone tag.

### 3.5 Edge cases

- **`firedCount == 0`.** Both rates are undefined (0/0). The surface failed to fire on any fixture under bundled-default config. PASS = false (Section 3.3 requires `firedCount > 0`). Operator response: expand the canonical fixture set with fire-expected cases, tighten triggers (loosen the gates that prevented fires), or unbundle.
- **All fires excluded for null distance.** The corrective rate has a 0/0 denominator. The surface fired but produced only oracle-less outputs (e.g., only panel-mode fires in M15 when the panel oracle is absent). Treat as `correctiveDeltaRate = null`; PASS = false (the gating condition cannot be evaluated). Operator response: add per-fixture oracles for the oracle-less class, or restrict triggers to the oracle-bearing class.
- **`antiCorrectiveCount > 0` but rate <= 0.05.** Sustained anti-correctness is a regression signal; even at low rate, every anti-corrective fire's fingerprint must be enumerated in the baseline output (Section 4.4). The R1 / R2 reviewer must explicitly acknowledge each anti-corrective fingerprint in the review notes — silent acceptance is a methodology violation.
- **Mid-baseline drift (the surface mutates between control and treatment).** The control + treatment runs must use identical surface code modulo the mode toggle. A milestone that lands a fix between runs invalidates the baseline; the baseline must re-run end-to-end. This is one motivation for keeping the baseline runnable from a single command (Section 5.1).

## Section 4 — Telemetry-only metrics (no floor; surface for tuning)

The following metrics are computed and surfaced in the rule-21 baseline output but do not gate the ship. They exist to give the operator (and the next reviewer) the data needed to tune triggers and detect drift.

### 4.1 No-signal-fire rate

```
numerator   = count of fires where post-treatment verdict equals pre-treatment
              AND zero new findings of any severity were added
denominator = firedCount
```

A high `noSignalFireRate` (e.g., > 0.30) suggests trigger thresholds are too aggressive — the surface is firing on inputs where it has nothing to add. M15 codifies this in `DEBATE_POLICY.md:158-160`: "Surfaces wasted fires — high values suggest the trigger thresholds are too aggressive."

The rate is telemetry, not gating, because some no-signal fires are healthy (the surface considered the input and confirmed the baseline was right). The metric becomes actionable when paired with the per-trigger breakdown — a single trigger reason responsible for most no-signal fires is the tuning target.

### 4.2 Per-trigger breakdown

For each fire reason in the surface's `<Surface>FireReason` enum:

- `firedCount` (per reason)
- `correctiveCount` (per reason)
- `antiCorrectiveCount` (per reason)
- `newActionableFindingCount` (per reason)
- `noSignalFireCount` (per reason)

DEBATE_POLICY.md applies this to M15's `score_in_grey_zone`, `needs_revision_with_high_score`, and `panel_voter_disagreement` (`DEBATE_POLICY.md:154-156`). The same shape applies to whatever fire reasons a future surface introduces.

The breakdown is the primary tuning surface. When a gating metric fails, the breakdown identifies which trigger reasons are responsible. When the surface is healthy, the breakdown surfaces drift over time — a previously-corrective trigger reason that flips to mostly-anti-corrective is a regression even when the aggregate rate still passes.

### 4.3 Cost / latency overhead

```
costOverheadAvgTokens   = sum of agent_invoked.tokensEstimate across the fire's
                          surface-invocation window, averaged over firedCount
latencyOverheadAvgMs    = wall-time delta between <surface>_fired.ts and
                          <surface>_postreview.ts (or surface-equivalent terminal
                          event), averaged over fires with both timestamps
```

DEBATE_POLICY.md applies this to M15 (`DEBATE_POLICY.md:162-164`). The same formula applies to any future surface.

These metrics inform the operator's cost / risk tradeoff. They are explicitly **not** gating: rule 21 measures *risk reduction*, not *cost reduction* (see Section 6 anti-pattern 2). A surface that doubles cost but earns its corrective floor still PASSes; the operator can choose to leave it off via the run-level opt-out, but the methodology does not block the ship.

### 4.4 Anti-corrective fires (regression signal)

The `antiCorrectiveCount` is surfaced both as a sub-metric of the corrective rate (Section 3.1) and independently as a telemetry record. The independent surface includes:

- The fingerprint of each anti-corrective fire (so the operator can inspect the fixture)
- The trigger reason that fired
- The verdict transition (`pre -> post`) and the oracle

Anti-corrective fires are the most actionable telemetry signal in the methodology. Even a single anti-corrective fire is documented as a hazard; the regression guard in Section 3.3 (`antiCorrectiveCount / firedCount <= 0.05`) makes sustained anti-correctness a ship-blocking condition.

### 4.5 Reporting shape

The `<surface>_baseline_completed` event payload carries a structured object that the rule-21 ship gate consumes. The shape is:

```ts
type RuleTwentyOneBaselineReport = {
  readonly surface: string                       // e.g., 'debate-policy', 'multi-opponent-debate'
  readonly fixtureRoot: string                   // e.g., 'tests/fixtures/debate-scheduler-baseline'
  readonly controlRunId: string
  readonly treatmentRunId: string
  readonly firedCount: number
  readonly skippedCount: number
  readonly orphanedFiresCount: number            // fires without matching postreview/error
  readonly correctiveCount: number
  readonly antiCorrectiveCount: number
  readonly neutralCount: number
  readonly excludedCount: number                 // fires with null distance
  readonly correctiveDeltaRate: number | null    // null if firedCount-excludedCount == 0
  readonly newActionableFireCount: number
  readonly newActionableFindingRate: number | null  // null if firedCount == 0
  readonly noSignalFireCount: number
  readonly noSignalFireRate: number | null
  readonly antiCorrectiveRate: number | null
  readonly costOverheadAvgTokens: number | null
  readonly latencyOverheadAvgMs: number | null
  readonly perTriggerBreakdown: ReadonlyArray<{
    readonly reason: string                      // typed fire reason from <Surface>FireReason
    readonly firedCount: number
    readonly correctiveCount: number
    readonly antiCorrectiveCount: number
    readonly newActionableFindingCount: number
    readonly noSignalFireCount: number
  }>
  readonly antiCorrectiveFireFingerprints: ReadonlyArray<{
    readonly fingerprint: string
    readonly reason: string
    readonly verdictPre: string
    readonly verdictPost: string
    readonly oracle: string
  }>
  readonly passedRuleTwentyOne: boolean
  readonly failureReasons: ReadonlyArray<string> // empty when passed; populated otherwise
}
```

The `failureReasons` array is the operator's actionable summary when PASS = false. Each entry is a typed reason (e.g., `corrective_rate_below_floor`, `new_actionable_rate_below_floor`, `fired_count_zero`, `anti_corrective_rate_above_guard`) so downstream tooling (the ship gate runner, future R0 / R1 / R2 review tooling) can branch on the reason without reparsing free text.

The shape is recommended, not mandated — a surface with reduced telemetry needs may emit a subset, but the gating metrics (`correctiveDeltaRate`, `newActionableFindingRate`, `firedCount`, `antiCorrectiveRate`, `passedRuleTwentyOne`, `failureReasons`) are mandatory.

## Section 5 — Implementation expectations

The rule-21 ship gate cannot fire until the milestone PR includes all of the following:

### 5.1 Baseline entry point

A `code-oz doctor --<surface>-baseline <fixture-root>` command (or equivalent inspector) that:

- Loads the canonical fixture set from `<fixture-root>` (M15 default: `tests/fixtures/debate-scheduler-baseline`).
- Runs the control + treatment pair against the fixture set (or consumes pre-recorded `events.jsonl` artifacts if the fixtures are pre-baked, as M15 does for fake-replay determinism).
- Computes the gating + telemetry metrics defined in Sections 3 and 4.
- Emits a terminal `<surface>_baseline_completed` event whose payload carries the computed metrics + `passedRuleTwentyOne: boolean`.
- Exits non-zero on PASS = false.

DEBATE_POLICY.md's worked example: `debate_policy_baseline_completed` event (`DEBATE_POLICY.md:69`) and the `code-oz doctor --debate-policy-baseline` command (`DEBATE_POLICY.md:130`).

### 5.2 Events.jsonl invariants

The surface must emit a structured event taxonomy that the baseline reducer consumes. Generalize from M15's six-event scheduler taxonomy (`DEBATE_POLICY.md:60-70`):

| Event suffix | When | Required payload |
|---|---|---|
| `<surface>_evaluated` | Always (per surface decision) | `inputDigest` (sha256 of canonicalized decision input), `decisionId` (run-scoped ULID correlation field) |
| `<surface>_fired` | Decision was fire AND executor wired | `decisionId`, `reason` (typed fire reason), surface-specific provenance fields |
| `<surface>_skipped` | Decision was skip | `decisionId`, `reason` (typed skip reason from defense-in-depth gate evaluation order) |
| `<surface>_error` | Fired but executor returned degrade-class error | `decisionId`, `reason` (typed error reason), optional `underlyingErrorCode` |
| `<surface>_postreview` | Fired and post-fire artifact-update completed | `decisionId`, `verdictPre`, `verdictPost`, `findingsAddedCount`, `actionableFindingsAddedCount`, surface-specific artifact shas |
| `<surface>_baseline_completed` | `doctor --<surface>-baseline` terminal | rule-21 metrics + per-trigger breakdown + `passedRuleTwentyOne` |

The `decisionId` correlation field is mandatory. It joins the disjoint trace `evaluated -> fired/skipped -> postreview/error` into a single decision record so the reducer can dedup on the latest `decisionId` per fingerprint (resume safety; see Section 5.4).

### 5.3 Defense-in-depth ordering

The surface's pure decision function must evaluate gates in a fixed order; first match wins. M15 applies this in `DEBATE_POLICY.md:74-89` with eleven gates mapped to CLAUDE.md non-negotiable rules. The same shape applies to future surfaces:

- The order is documented in the surface's own contract (not duplicated here).
- Each gate maps to an existing CLAUDE.md non-negotiable rule. If a gate cannot map, the gate is suspect — it may be smuggling a new authority claim that rule 20 has not approved.
- The terminal gate is always the trigger evaluation (the surface-specific predicate that decides whether the surface's risk-reduction signal is present in the input).
- Skip reasons are typed (an enum), not freeform strings, so the events.jsonl reducer can attribute every skip to a single most-upstream reason.

### 5.4 Append-only event log + dedup-on-latest-`decisionId` reducer

The events.jsonl log is append-only (rule 1). Resume after crash may re-emit `<surface>_evaluated` for the same fingerprint with a fresh `decisionId`. The rule-21 baseline reducer must dedup on the latest `decisionId` per fingerprint so the metrics reflect the resumed-and-completed decision, not the orphaned pre-crash decision.

DEBATE_POLICY.md codifies this in the resume semantics section (`DEBATE_POLICY.md:166-176`): "The earlier event remains in `events.jsonl` (append-only); the rule-21 baseline reducer dedups on the latest `decisionId` per fingerprint." The same pattern applies to every future surface.

The reducer's dedup behavior must be tested against a fixture that exercises the crash-then-resume case. A reducer that double-counts orphaned decisions inflates `firedCount` and depresses every per-fire ratio — a reducer bug masquerading as a surface failure.

### 5.5 Canonical fixture set

The fixture set committed under `tests/fixtures/<surface>-baseline/` must:

- Run deterministically with `FakeProvider` only (no network, no LLM). Rule 8.
- Exercise both fire-expected and no-op classes (Section 2).
- Carry per-fixture oracles (Section 2).
- Be frozen at R0 (Section 2). Mid-milestone additions require their own R0 round.
- Cover every trigger reason in the surface's `<Surface>FireReason` enum at least once. A trigger reason with zero fires in the canonical set is either dead code or a fixture gap.

The fixture set is the contract surface that the baseline reducer is measured against. Cherry-picked fixtures invalidate the entire methodology (Section 6 anti-pattern 1).

### 5.6 Reducer behavior

The rule-21 baseline reducer consumes the events.jsonl pair (control + treatment) and produces the metrics output. Required reducer behaviors:

1. **Per-fingerprint dedup on latest `decisionId`.** When the events log contains multiple `<surface>_evaluated` events for the same fingerprint (resume after crash), the reducer keeps only the latest `decisionId` and discards prior orphaned decisions. The fingerprint is surface-defined (M15 example: `(taskId, attempt, preReviewReportSha256)`); the reducer must accept a fingerprint extractor as input rather than hardcoding the M15 shape.
2. **Disjoint-trace join.** Each decision's events (`evaluated -> fired/skipped -> postreview/error`) join on `decisionId`. A `fired` event without a matching `postreview` (and no matching `error`) is an orphan; the reducer surfaces orphans in a separate `orphanedFiresCount` field, and orphan count > 0 with no `error` events is itself a degraded baseline (the surface fired but did not terminate cleanly).
3. **Pre/post artifact comparison.** For each completed `(fired, postreview)` pair, the reducer extracts `verdictPre` and `verdictPost` from the `postreview` payload, computes `distance(verdictPre, oracle)` and `distance(verdictPost, oracle)` from the fixture's oracle file, and records the corrective / anti-corrective / neutral classification. Findings comparison reads `findingsAddedCount` and `actionableFindingsAddedCount` directly from the `postreview` payload (the surface's executor is responsible for computing these against the pre-fire artifact's findings list, keyed by fingerprint).
4. **Per-trigger breakdown derivation.** The reducer groups fires by `reason` (the `SchedulerFireReason` enum value carried on the `fired` event) and emits per-reason aggregates (Section 4.2).
5. **Deterministic output.** Identical input events.jsonl pairs MUST produce byte-identical metrics output. Non-determinism (e.g., float precision drift, ordering-dependent aggregation) is a reducer bug.

The reducer is implemented once per surface (it consumes surface-specific event names and payload shapes), but the reducer's *contract* is shared across surfaces. A future shared `src/policy/rule21-baseline-reducer.ts` module can lift the fingerprint-dedup + disjoint-trace-join + per-trigger-breakdown invariants into a parameterized helper; the surface-specific bits (event names, payload shape, oracle reader) are injected.

### 5.7 R0 review checklist

When the milestone enters R0 (planning-convergence Codex round), the planning brief MUST present the rule-21 methodology evidence in a structured form:

- **Surface declaration.** A single sentence naming the parallel-provider surface and citing the rule-20 authority slot it consumes.
- **Methodology row.** The surface's row in the Section 2.4 worked-examples table, populated end-to-end (control config, treatment config, `pre`, `post`, oracle).
- **Fixture set inventory.** Path under `tests/fixtures/`, count of fire-expected fixtures, count of no-op fixtures, list of trigger reasons each fire-expected fixture exercises.
- **Reducer location.** Path to the surface's reducer (or a declaration that the shared reducer module is being reused).
- **Baseline command.** The exact `code-oz doctor --<surface>-baseline <fixture-root>` invocation that the ship gate fires.

R0 reviewers explicitly reject any milestone that cannot present these five items. The methodology cannot defer to R1 / R2 — by R1 the surface is implemented and the baseline is the gate; the methodology must be fully specified at R0 so that implementation has a target.

## Section 6 — Anti-patterns (rule 21 violations)

If a milestone is doing any of these, stop and re-debate the surface shape:

1. **Cherry-picked fixtures.** The canonical fixture set is closed at R0. New fixtures added after the rule-21 baseline runs are suspect — the baseline reducer cannot distinguish a genuine measurement from a fixture-curation pass that selects for the floor. If a new fixture is genuinely needed mid-milestone, it requires its own R0 round and a re-baseline. Adding a fixture purely to nudge the rate above 0.10 is a falsification of the methodology.

2. **Substituting tokens-saved or time-saved for risk-reduction.** Cost overhead and latency overhead are telemetry, not gating (Section 4.3). A surface that "earns its keep" by being faster or cheaper than the baseline does **not** satisfy rule 21. The rule's word is *risk-reduction*; the methodology measures verdict deltas and new actionable findings, not throughput. M15's worked example treats cost/latency as advisory only.

3. **Treating "any new finding" as new-actionable.** The new-actionable-finding rate (Section 3.2) restricts the numerator to severities ∈ `{block, fix-first}`. Counting `nit` and `fyi` severities surfaces noise as signal — a surface that generates ten cosmetic suggestions per fire would otherwise pass the floor on noise alone. M15 codifies the restriction in `DEBATE_POLICY.md:152` (Codex Q7); every future surface inherits it.

4. **Deferring rule-21 measurement to a follow-up milestone.** Rule 21 IS the ship gate. The methodology cannot be deferred to the milestone's R1 / R2 review or to a post-tag follow-up. The baseline must run green before the milestone tag lands. M15 codifies this in `DEBATE_POLICY.md:196` ("Deferring the rule-21 measurement to a follow-up. Rule 21 IS the ship gate."). A milestone that ships a parallel-provider surface without a passing baseline is a non-negotiable rule violation.

5. **Same-family parallel-provider variants.** Rule 2 (cross-family review at REVIEW gate) discipline must be preserved at the surface. A parallel-provider surface whose multiple invocations are all the same family (e.g., two Claude opponents in a hypothetical multi-opponent debate) measures *behavior change*, not *risk reduction* — rule 2 exists because same-family agreement is correlated, not independent. The methodology measures risk reduction relative to a single-provider baseline, and a same-family fan-out provides no independence axis. Same-family variants are forbidden at the surface; the surface's permission contract must enforce family separation (M15 example: `requestDebate()` runtime invariant `caller-family != opposing-provider-family`, see `DEBATE_POLICY.md:206-214`).

6. **Verdict-confidence as primary signal.** A surface that fires based on its own pre-fire confidence score is post-hoc rationalizing the same prior the pre-fire decision was made on. M15 codifies this in `DEBATE_POLICY.md:96` ("Verdict-confidence is **not** a primary signal (Codex Q2 — same-prior post-hoc rationalization)") and in the anti-pattern list (`DEBATE_POLICY.md:195`, "Verdict-confidence as primary signal. Same-prior post-hoc rationalization."). Future surfaces inherit the rule. Triggers must be objective signals from the input (score grey-zone, panel disagreement, manifest features, etc.), not the model's self-rated confidence in its own answer.

7. **New `tool_use.<surface>` permission sub-scopes that are not justified by a separate authority discussion.** A new permission sub-scope is a rule-20 authority claim. Bundling a new sub-scope into a milestone whose rule-20 authority was for the parallel-provider surface (not the permission grant) violates rule 20 and dilutes the methodology's measurement. M15's worked example reuses the existing M10 `tool_use.debate` rather than minting a `tool_use.debate.scheduler` (`DEBATE_POLICY.md:197` "New `tool_use.debate.scheduler` permission sub-scope. Bundling. Reuse `tool_use.debate`."). Future surfaces should reuse existing sub-scopes whenever the underlying primitive already exists, and any new sub-scope requires its own milestone's rule-20 slot.

8. **Adding a new gate file for the surface's decisions.** The surface's decisions are events, not gates (rule 1 + rule 20). M15 codifies this in `DEBATE_POLICY.md:198` ("New gate file for scheduler decisions. Rule 1 + rule 20. Gate writes still depend on existing phase gate criteria."). Future surfaces inherit the rule. The surface's events feed downstream phase gates, but the surface itself does not write a gate file.

9. **Mid-fire budget kill as primary mechanism.** The aggregate budget preflight (rule 19) is the gate. Mid-fire budget kills (the `assertWithinBudget` chokepoint) are a backup, never a primary mechanism. M15 codifies this in `DEBATE_POLICY.md:199` ("Mid-debate budget kill as primary mechanism. Aggregate preflight is the gate. Mid-debate kill is the chokepoint backup."). Surfaces that rely on mid-fire kills produce non-deterministic baselines (the kill point depends on cumulative spend, which depends on test ordering); rule 21 cannot measure them reliably.

10. **Generalizing the surface to fire from any phase.** Rule 20 again. M15 v0.1 fires post-REVIEW only (`DEBATE_POLICY.md:200`); generalizing to fire from any phase would bundle multiple authority boundaries into one milestone. Future surfaces that want a second call site (M15's deferred pre-VERIFY trigger is the canonical example) require their own milestone's rule-20 slot, their own canonical fixture set extension, and their own rule-21 baseline.

## When this doc fires

This methodology is the canonical rule-21 measurement contract. It MUST be satisfied before the rule-21 ship gate fires for any milestone proposing a new parallel-provider surface — including the M15 debate-policy scheduler (already satisfies; the source of the methodology, see `DEBATE_POLICY.md:128-164`) and every M16+ candidate enumerated in `DEBATE_POLICY.md:178-186` § "Forward-compat for M16+": multi-opponent debate (extending `requestDebate` to a `requestMultiDebate` primitive), Researcher fan-out (a phase-tail Researcher persona with a new fire reason), pre-VERIFY trigger (a second call site at `src/phases/verify.ts`), configurable quorum (panel disagreement threshold becoming `panelDisagreementThreshold: number`), and per-persona scheduler config overrides. Any future parallel-provider surface beyond these (parallel builder candidates, reviewer panel v2, etc.) inherits the same obligation. Rule 20 gates whether the surface earns a milestone slot; rule 21 measured under this methodology gates whether the surface ships from that slot.
