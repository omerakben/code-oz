# M14 baseline fixture

The canonical M14 baseline fixture for `code-oz doctor --panel-baseline`. This
fixture is the source-of-truth assertion for the rule-21 ship gate: the
metric event emitted by the doctor command, when run against this fixture,
must satisfy all four thresholds before M14 can tag.

## Expected baseline metrics

When fed through `runPanelBaseline`, this fixture produces:

- **panelOnlyActionableFindingCount**: 1
  - reviewer-A (codex voter) raises a `fix-first` finding
    (`src/handler.ts | missing null check on user input`) that the
    single-reviewer baseline missed entirely
  - reviewer-B (gemini voter) raises the same fingerprint with `block`
    severity → strictest-among-voters wins → severity escalates to `block`
  - The synthesized finding has `authorityImpact: voter` because both
    cross-family voters raised it; severity `block` (escalated)
  - The single-reviewer baseline only saw the cosmetic `nit`; this is the
    "panel caught what single missed" proof

- **disagreementCount**: 1
  - codex says `fix-first` for the null-check; gemini says `block`
  - Severity disagreement on the same fingerprint is recorded

- **sameFamilyVoteRejectionCount**: 1
  - Positive control. The fixture's `sameFamilyVoteRejectionAttempts: 1`
    declares the **requested attempt count**. When `loadAndRunPanelBaseline`
    is called with a `runPaths`, the doctor command runs each requested
    attempt as a real same-family panel YAML through `loadConfig` (layer 1
    of the 5-layer defense) and emits a real
    `panel_quorum_rejected_same_family_vote` event with `layer='config-load'`
    per rejection. The metric reads the count BACK from the run-local
    event log, so the value is observed-from-events (Codex M14 R1 finding
    #7 closure: option (a)). When `runPaths` is omitted (legacy library
    callers / isolated tests), the metric falls back to the
    fixture-declared attempt count and the value is informational only.

- **manifestEqualityHeld**: true
  - All panelists report the same `manifestHash` (no context-difference
    confound)

- **panelVerdict**: `block`
  - The escalated voter-impact `block` finding triggers
    `computeCanonicalPanelVerdict` step 3

## Why these numbers matter

Per CODEX_RESPONSE_M14.md § "Rule-21 measurement adequacy", the four
thresholds are the M14 ship gate:

1. `panelOnlyActionableFindingCount > 0` — proves panel catches actionable
   bugs single-reviewer misses (the core risk reduction)
2. `sameFamilyVoteRejectionCount >= 1` — proves the construction guarantee
   fires (positive control: anti-laundering layer is wired)
3. `manifestEqualityHeld === true` — proves panel deltas are
   provider-comparison evidence, not context-difference noise
4. `disagreementCount >= 1` — proves cross-family disagreement is
   surfaced (supporting evidence)

If any threshold fails, M14 cannot tag. The `tests/e2e/review-panel-
baseline.test.ts` test runs `loadAndRunPanelBaseline(...)` against this
fixture and asserts each threshold; a fixture change that breaks the
gate is a CI failure.

## Same-family rejection positive control

The `sameFamilyVoteRejectionAttempts: 1` field declares how many real
same-family vote attempts the doctor command should run when invoked
with a `runPaths`. Per F7 (Codex M14 R1 finding #7 closure), each
attempt is run through `loadConfig` against a synthetic same-family
panel YAML; each rejection emits a real
`panel_quorum_rejected_same_family_vote` event with `layer='config-load'`,
and the metric counts those events from the run-local log. If
`loadConfig` fails to reject (real layer-1 regression), the doctor
command throws a typed error rather than silently underreporting.

Layers 1 and 2 are also independently exercised by
`tests/review-panel-config-validation.test.ts` and
`tests/agent-loader-review-panel.test.ts`. The baseline fixture's role
in the rule-21 ship gate is to drive the metric event end-to-end; the
event-level assertion lives in
`tests/e2e/review-panel-baseline.test.ts` ("F7: sameFamilyVoteRejectionCount
is events-derived ...").

## Provider IDs are real

Per Codex pushback Q12, this fixture uses the real `ProviderId` union
values (`codex`, `gemini`, `claude`, `fake`, `xai`) — no invented IDs.
The "scripted response" is the per-panelist `findings` + `score` +
`verdict` data; the actual provider call would happen at runtime, but
the baseline command does not invoke providers — it consumes already-
recorded panelist responses.
