---
name: B1A_EFFORT_FLAG
status: design (post-Codex-pre-design-review; thread 019e1318)
owner: Claude Opus 4.7 (xhigh) as maestro; sub-agent implements
source: docs/comparison/03-aris/SYNTHESIS.md §B1a
authority-cost: one authority boundary (rule 19 budget envelope), ~9 code sub-surfaces — split into two commits per Codex strengthening recommendation
target: shippable as two pre-M17 polish commits; not a milestone of its own
codex-pre-design-thread: 019e1318-f933-7403-86d2-13c87f8a8dab (verdict: reject as written, fix-first; 4 load-bearing bugs caught)
---

## Pre-implementation revision log

Codex pre-design review (thread 019e1318) caught four load-bearing bugs:

1. **`budgets.perPhase` was missed entirely.** The loader has `budgets.perPhase.<phase>` at `src/config/load.ts:525-527, :786-840` enforced by `src/providers/cost.ts:221-285, :581-632, :857-907`. **Must scale.** Original design listed only `budgets.global` and `byRole`.
2. **Active-run reload sites bypass the derived config.** A run spans multiple CLI invocations; active dispatch reloads raw config at `src/commands/run.ts:956, 1083, 1387, 1694`. Without event-replay, only DEFINE gets the effective envelope.
3. **`initRun()` owns the initial event sequence** at `src/state/run.ts:221-243`. Must be in the touchlist as the fresh-run emission owner.
4. **Rule 23 was too absolute.** "MUST NOT increase" blocks B1b from amending the rule. Add escape clause. (Renumbered from rule 22 in this design doc; rule 22 on `main` is now consumer-first/RED-first TDD per `CLAUDE.md:50`.)

Codex also confirmed: `applyEffort()` in own file, floor + min-1 (preserve explicit 0), `maxToolCallsPerTurn` stays invariant, `maxWallTimeMinutes` scales, standalone event (not a `run_started` field).

Commits split per Codex strengthening recommendation:

- **Commit 1** — pure config transform: `src/config/effort.ts`, `src/config/schema.ts` if types touched, and unit tests covering global / perPhase / byRole. No wiring.
- **Commit 2** — CLI flag + event emission + active-run replay + binary e2e. Includes fresh-run emission in `initRun()` and reconstruction in the active-run reload sites.

---

# B1a — `--effort` flag as derived budget envelope

## Scope

Add a top-level `code-oz run --effort {lite|balanced|max|beast}` flag that derives the effective `budgets.global` envelope at run start by multiplying every **scalable cap** by the effort multiplier. The flag changes **no** phase behavior, reviewer count, debate likelihood, audit strictness, or restart-policy threshold.

This is the ARIS effort-contract pattern *split in half*: B1a covers only the budget-envelope axis. The assurance axis (effort affects reviewer rounds, panel size, mutation threshold, restart cap) is deferred to **B1b — Assurance-aware effort contract** (a separate milestone).

## Multiplier table

| Level | Multiplier |
|---|---|
| `lite` | 0.4x |
| `balanced` | 1.0x (default, equivalent to no flag) |
| `max` | 2.5x |
| `beast` | 6.0x |

Pinned to single floats to avoid the ARIS ambiguity of `5-8x`. The applied multiplier is logged.

## Which caps scale, and why

`budgets.global` exposes nine fields (`src/config/load.ts:535-595`). Classify each:

| Field | Scales? | Reason |
|---|---|---|
| `maxTurns` | yes | Run-shape cap; scales with envelope |
| `maxProviderCalls` | yes | Run-shape cap; scales with envelope |
| `maxTokensEstimate` | yes | Run-shape cap; scales with envelope |
| `maxWallTimeMinutes` | yes | Run-shape cap; scales with envelope |
| `maxToolCallsPerTurn` | **no** | Per-turn quality knob, not a run envelope; scaling it changes behavior |
| `toolCallBudgetMultiplier` | **no** | Already a ratio; multiplying ratios compounds |
| `maxReviewRounds` | **no** | Assurance cap — invariant: effort cannot decrease assurance, and increasing it without the assurance contract (B1b) misleads on review depth |
| `softWarnAtRatio` | **no** | Ratio, not a budget. Stays at 0.75 regardless of effort. |
| `priceTable` | **no** (optional) | Pricing telemetry, not a cap |

Per-role rows under `budgets.global.byRole.<role>` carry `maxProviderCalls` and `maxTokensEstimate` — both **scale**.

Per-phase rows under `budgets.perPhase.<phase>` (loaded at `src/config/load.ts:525-527, :786-840`, enforced at `src/providers/cost.ts:235-285`) carry `maxTurns?`, `maxProviderCalls?`, `maxTokensEstimate?` — all three **scale**. This was missed in the original design and caught in Codex pre-design review.

This satisfies the synthesis acceptance criterion: *scales all budget caps together — including per-phase and per-role caps. No mixed-scale caps.*

The four scalable run-shape caps + the two scalable per-role caps + the three scalable per-phase caps form the **scaled set**. Everything else is **invariant**.

**Rounding:** floor with min 1 only when original `> 0`. Preserve explicit zero. Matches loader semantics at `src/config/load.ts:543, :683-708, :819-839`.

## Where the flag lives

- **Parsing**: `src/commands/run.ts` arg-parser loop (alongside `--request`, `--task`, etc., around line 375+). New cases: `--effort` and `--effort=...`. Validates the value is one of the four levels; rejects anything else with a `--help`-cite error.
- **Application**: between `loadConfig()` and any consumer. The application function lives in `src/config/load.ts` (or a sibling file `src/config/effort.ts` — TBD with Codex) and takes `(resolved: ResolvedConfig, effort: EffortLevel) → ResolvedConfig` returning a new object with the scaled fields. Pure function, no side effects.
- **Logging**: emit a new event `effort_envelope_applied` at run start *before* any phase work, carrying `{ effort: EffortLevel, multiplier: number, originalBudgets: CodeOzConfig['budgets'], effectiveBudgets: CodeOzConfig['budgets'] }`. Both snapshots are full `CodeOzConfig['budgets']` JSON values (i.e., `{ global, perPhase }`; `byRole` lives nested under `global` per the loader shape, NOT at top level). The original envelope is recorded *only* in this event; active-run reload reads `effectiveBudgets` directly from the event (Codex R0 B1; replay does NOT re-apply `applyEffort` to the currently-loaded config). The rest of the run (including `assertWithinBudget`) reads from the effective envelope.

## Event order lock (synthesis step 3, 2026-05-12)

`initRun()` emits three events into `events.jsonl` at run start, inside one `withLock` block:

1. `run_started` (always)
2. `effort_envelope_applied` (when budgets are supplied; CLI path always supplies)
3. `phase_entered(<initial>)` (always)

**Position 2 is locked.** The envelope describes the run, not the first phase, so it is captured at run start ahead of any phase work. Three authorities concur on this order:

- CLAUDE.md rule 23 text: "emits `effort_envelope_applied` immediately after `run_started`"
- This design doc § "Where the flag lives" Logging bullet: "at run start *before* any phase work"
- `docs/references/budgets.md` § "Effort multipliers (B1a)": "emits one `effort_envelope_applied` event immediately after `run_started`"

Consumers may rely on this order: `tests/e2e/cli-effort-envelope.test.ts` asserts `events[1].type === 'effort_envelope_applied'` and `events[2].type === 'phase_entered'`. Active-run reload sites (`src/commands/run.ts`) scan by `type === 'effort_envelope_applied'` so position is informational for them, but the test is the hard constraint.

Codex R0 may push back on this lock; if so, the alternative is position 3 (after `phase_entered`) and the design doc + rule 23 text + budgets.md prose must all be reworded in the same fix-first commit.

## File touchlist (split across two commits)

### Commit 1 — pure config transform

1. `src/config/effort.ts` (NEW) — pure function `applyEffort(config, effort) → config`, multiplier table, `EFFORT_LEVELS` const tuple. Operates on full `CodeOzConfig` (not just `budgets.global`), returns a new config object with global / perPhase / byRole all scaled coherently.
2. `src/config/schema.ts` — if `EffortLevel` type needs to live with the schema types (TBD: implementer chooses based on existing module shape).
3. `src/config/load.ts` — re-export `EffortLevel` for downstream consumers if needed. No logic change.
4. `tests/config-effort-unit.test.ts` (NEW) — unit tests covering `applyEffort()`:
   - Each scaled-set field scales by the multiplier (global, perPhase, byRole)
   - Invariant-set fields are byte-identical pre/post
   - `balanced` (1.0x) is byte-identical pre/post
   - Floor + min-1 rule when original > 0
   - Explicit 0 preserved
   - Empty `byRole` / missing `perPhase` keys handled without crash

### Commit 2 — wiring, events, replay, e2e

5. `src/commands/run.ts` — arg parser case at the existing parse loop (~line 375+). Cases: `--effort` and `--effort=...`. Validates against `EFFORT_LEVELS`. Rejects unknown values with a `--help`-cite error. Default `'balanced'`.
6. `src/state/run.ts` — `initRun()` at `:221-243` is the fresh-run sequence owner. Emit `effort_envelope_applied` immediately after `run_started`. The event payload includes `effort`, `multiplier`, `originalBudgets`, `effectiveBudgets` where `*Budgets` is shaped exactly like `CodeOzConfig['budgets']` (i.e., contains `global` and `perPhase`). `byRole` lives NESTED under `global` per `GlobalBudget.byRole` in `src/config/schema.ts`, not as a top-level sibling (Codex R0 F6 / R1 thread 019e1807).
7. `src/state/events.ts` — add `effort_envelope_applied` to the event union and schema validator. Projection (`reduceEvents`) is a no-op for this event (it does not change state machine fields; it only records forensics). Schema requires `effort` ∈ `EFFORT_LEVELS`, `multiplier` matching the table, `originalBudgets` / `effectiveBudgets` shaped per `CodeOzConfig['budgets']`.
8. `src/commands/run.ts` active-run reload sites (~lines 956, 1083, 1387, 1694) — after each `loadConfig()`, reconstruct the effective config by reading the `effort_envelope_applied` event from `events.jsonl` and replaying the recorded `effectiveBudgets` directly (Codex R0 B1, thread 019e17f8 — NOT re-applying `applyEffort` to the currently-loaded config, because that exposes the run to mid-run YAML edits). If `--effort` is passed on an active run and differs from the recorded effort, reject with a clear error: *"this run was started with --effort <recorded>; pass the same value or omit the flag"*. If `--effort` is passed on a legacy active run with no recorded envelope, reject with the legacy-run message (Codex R0 F5).
9. `tests/e2e/cli-effort-envelope.test.ts` (NEW) — binary-spawn e2e per `feedback_milestone_e2e_non_negotiable.md`:
   - Spawn `code-oz run --effort lite|balanced|max|beast` four times
   - Parse `events.jsonl` after run start
   - Assert exactly one `effort_envelope_applied` event with the correct payload
   - Assert the next phase consumes the effective envelope (run a no-op phase that emits a budget telemetry event)
   - Assert active-run continuation preserves the effective envelope (resume the run; new phase still sees the effective budgets)
   - Assert active-run with mismatched `--effort` rejects with the documented error
10. `CLAUDE.md` — add **rule 23** with the revised invariant text below. (Renumbered from rule 22; main's rule 22 is consumer-first/RED-first TDD.)
11. `docs/references/budgets.md` (NEW or APPEND if exists) — "Effort multipliers" section documenting the table, the scaled set, and the invariant.

Touchlist count: 9 code sub-surfaces (excluding the two new test files). Single authority axis: the existing rule-19 `budgets.global` envelope. No new gate, no new phase, no new provider surface.

Codex pre-design count: 6 minimum sub-surfaces (CLI parse/help, config transform, run-start event schema/validation, fresh-run wiring, active-run replay wiring, budget-consumer proof). The 9-count above is conservative (counts each active-run site, each test file separately).

## Rule 23 (proposed) — Effort-flag invariant

The constraint lands at the Commit 2 of B1a (per `feedback_canonical_doc_precedence_chain.md` — canonical-doc precedence stays consistent within the milestone). Revised per Codex pre-design feedback (was too absolute; B1b would have conflicted):

> **23. The `--effort` flag scales budgets only, never assurance.** The flag may multiply scalable `budgets.global` caps, `budgets.global.byRole` rows, and `budgets.perPhase.<phase>` rows. It MUST NOT change `maxReviewRounds`, panel slot count, mutation gate threshold, BUILD restart attempt cap, debate-policy thresholds (M15), or AUDIT strictness for brownfield runs — until an **assurance-aware effort contract (deferred B1b)** amends this rule with its own milestone-gated invariants. The flag emits `effort_envelope_applied` immediately after `run_started`, recording both the original and the effective envelope (each shaped as `CodeOzConfig['budgets']`). Active-run continuations reconstruct the effective envelope from this event; mismatched `--effort` on an active run is rejected. The rest of the run reads only from the effective envelope. Validated by `tests/config-effort-unit.test.ts` (transform correctness) and `tests/e2e/cli-effort-envelope.test.ts` (binary-spawn assertion across fresh-run + active-run + reject-on-mismatch).

## Acceptance criteria (from SYNTHESIS + Codex pre-design)

- [ ] E2E test runs the binary at every effort level and asserts:
  - (a) effective envelope = original × multiplier (per scalable cap, with floor + min-1 when original > 0)
  - (b) `budgets.global`, `budgets.perPhase`, and `budgets.global.byRole` caps scale at the same multiplier
  - (c) `events.jsonl` records both envelopes at run start (single event `effort_envelope_applied`)
  - (d) no phase behavior or gate threshold differs from baseline (the invariant-set fields are byte-identical in `originalBudgets` and `effectiveBudgets`)
  - (e) **active-run continuation preserves the effective envelope** by replaying the event
  - (f) **mismatched `--effort` on an active run is rejected** with the documented error
- [ ] `cli --help` documents `--effort` and lists the multiplier table
- [ ] `docs/references/budgets.md` (or equivalent) gains an "Effort multipliers" section that explicitly states: *the flag does not change phase behavior or audit strictness*
- [ ] **Codex approval condition** (from thread 019e1318): all of the following test files pass:
  - `bun test tests/config-effort-unit.test.ts`
  - `bun test tests/e2e/cli-effort-envelope.test.ts`
  - `bun test tests/providers-cost.test.ts tests/cost-byrole.test.ts tests/cost-debate-scheduler-preflight.test.ts`
  - `bun test tests/review-panel-orchestrator.test.ts tests/state-events.test.ts tests/state-run.test.ts`
  - `bun run typecheck` clean

## Backward compatibility

- Default behavior unchanged: `code-oz run` (no flag) is equivalent to `code-oz run --effort balanced`.
- Existing config files unaffected: `budgets.global` is read as-is and the multiplier is applied as a post-load transform.
- Existing tests unaffected: the `events.jsonl` projection rejects unknown events by default in some test fixtures; the new event must opt in to a known event list. Tests touched: any test that asserts the *full* event sequence of a run will see one extra event; targeted fix in those fixtures.

## Open questions for Codex pre-design review

Per `feedback_per_commit_cross_model_review.md` — the rule is: budgets are shared infra; Codex pre-design review before Lead implements catches load-bearing bugs. Five questions:

1. **Where to place `applyEffort()`?** Two options:
   - (a) `src/config/effort.ts` (new file) — pure function, easier to test in isolation.
   - (b) Inside `src/config/load.ts` as `applyEffortToConfig()` — co-located with the other config transforms.
   The synthesis is silent. I lean (a) for testability + separation of concerns. Codex: agree?

2. **Multiplier rounding.** `0.4 × 5 turns = 2 turns`. `0.4 × 1 turn = 0.4` — round to 0? Floor at 1? Floor at 0? The synthesis says "scales by the multiplier" but does not specify integer arithmetic. My proposal: floor to integer but enforce a minimum of 1 for any cap that is >0 in the original. Codex: agree, or is there a precedent in M13 byRole scaling?

3. **`maxWallTimeMinutes` at `lite`.** A 30-minute wall budget × 0.4 = 12 minutes. If a phase legitimately needs more than 12 minutes (e.g., a slow VERIFY), the run aborts. Is this acceptable, or should `maxWallTimeMinutes` be in the **invariant** set (not scaled) because cutting wall time is qualitatively different from cutting token budget? Codex: judge.

4. **`maxToolCallsPerTurn` classification.** I classified it as "invariant — per-turn quality knob." But the rule could be: scaling it lets `beast` runs handle multi-tool flows that `lite` runs cannot. Counter: that *is* a behavior change (the run can now do things it could not at `balanced`). I lean invariant. Codex: confirm or push back.

5. **Event placement in the projection.** `effort_envelope_applied` fires at run start, *after* `run_started`. Should it be:
   - (a) A standalone new event type, or
   - (b) A new field on the existing `run_started` event?
   (a) keeps the schema additive; (b) keeps the event count stable. My read: (a), because run_started is already validated and adding a complex object field risks breaking existing projections. Codex: confirm.

## Bug classes the design is intended to close

- ARIS-reported "draft-quality `beast` output" (effort-contract.md:46-68): closed by the project-level invariant (rule 23) that effort cannot decrease assurance. B1b will close the other half (effort cannot accidentally increase assurance without a contract).
- Codex pre-design review section 2 B1 bug class: "`--effort beast` 8x globals but per-phase/role caps unscaled, fail mid-run." Closed by the synthesis acceptance criterion (b) — *all* budget caps scale together — and verified by the unit test on `applyEffort()` matching every scalable-set field.
- Pre-existing concern: per `feedback_explicit_at_writer_and_reader.md`, when `applyEffort()` writes a derived envelope, every reader should consume from the derived envelope. The plan: the rest of the run (including `assertWithinBudget`) reads from the returned config; the original is captured only in the single `effort_envelope_applied` event for forensics.
