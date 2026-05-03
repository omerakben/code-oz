# Session kickoff — M14 Reviewer panel v1

**Date:** 2026-05-02 (overnight Ralph loop session)
**Branch:** `feat/m14-reviewer-panel`
**Tag target:** `v0.15.0-alpha.0`
**Test target:** ~2340-2370 pass / 0 fail / 1 skip (carrying 2222 from main + ~120-150 new)
**Authority boundary:** panel quorum + cross-family enforcement + orchestrator-owned synthesis
**Cross-model peer review trail:**
- Briefing: [`docs/research/CODEX_BRIEFING_M14.md`](../research/CODEX_BRIEFING_M14.md)
- Response: [`docs/research/CODEX_RESPONSE_M14.md`](../research/CODEX_RESPONSE_M14.md) (verdict: `accept-with-modifications`, thread `019deb75`)
- Synthesized: this document

---

## 1. Synthesis summary

Codex's planning-debate verdict was `accept-with-modifications`. Four substantive pushbacks were accepted into this locked plan:

1. **Same-family advisory has NO gate authority — positive OR negative.** The original draft let advisory `block` findings escalate; Codex correctly identified this as negative authority-laundering. Advisory findings are recorded with `authorityImpact: 'advisory'` and visible in synthesis, but canonical verdict computation ignores them unless an eligible cross-family voter independently raises the same fingerprint.

2. **Quorum is exactly 2 cross-family voters for v1, NOT configurable.** No `quorum: { minCrossFamilyVoters: N }` knob. Loader rejects panels with fewer or more than 2 voters (extras must be `advisory`). Configurable quorum is a separate authority boundary (M16+ if measurable need).

3. **Stage per-panelist drafts; canonical REVIEW.md only after synthesis.** Original draft wrote per-panelist atomically to canonical REVIEW.md. Codex caught that this creates partial-but-authoritative artifacts. New shape: panelist drafts go to `state/review-panel/round-N/panelist-<id>.md`, canonical REVIEW.md is written once at synthesis after all required panelists complete.

4. **Rule-21 ship gate requires a new metric event, not raw counts.** Current REVIEW events record finding counts, not fingerprints, so `unique_findings_delta` is not computable from `events.jsonl`. M14 adds `review_panel_baseline_completed` event with the full metric payload and the doctor command emits it. Ship gate becomes `panelOnlyActionableFindingCount > 0`, not raw delta.

Other accepted modifications: file paths corrected (`src/config/schema.ts` + `load.ts` + `agents/loader.ts`, not `src/config/company.ts`); fake-provider test plan corrected (use invocation seam preserving real provider identity; do not invent provider IDs); 5-layer defense-in-depth instead of 2-layer; reuse M13 `budget_warning` event (no new `panel_cost_warn`); commit 5 split into pure-helper + runtime-orchestrator (10 commits total).

---

## 2. Locked design (verdict-binding invariants)

### 2.1 Canonical panel verdict rule (orchestrator-owned)

The pure `computeCanonicalPanelVerdict(input)` function is the single source of truth for panel verdicts. Persona prompts cannot override it; even malformed REVIEW.md inputs cannot escape it (parser recomputes and rejects contradictions).

```typescript
// src/phases/review-panel-verdict.ts (pure, no I/O)

export interface PanelistInput {
  readonly id: string                         // stable per-panelist id
  readonly providerId: ProviderId             // resolved at runtime via registry
  readonly providerFamily: ProviderFamily     // resolved at runtime via registry.familyOf()
  readonly modelPolicy: string
  readonly role: 'voter' | 'advisory'         // declared in config
  readonly score: number                      // 0-10 from panelist persona
  readonly verdict: 'ready' | 'needs-revision' | 'block'  // panelist-self-reported
  readonly findings: readonly ReviewFinding[]
}

export interface PanelVerdictInput {
  readonly buildFamily: ProviderFamily        // resolved from build_provider_recorded
  readonly panelists: readonly PanelistInput[]
}

export interface PanelVerdict {
  readonly panelVerdict: 'ready' | 'needs-revision' | 'block'
  readonly quorumReason: string               // human-readable
  readonly eligibleVoterFamilies: readonly ProviderFamily[]
  readonly excludedReviewerIds: readonly string[]
  readonly excludedReasons: readonly { id: string; reason: string }[]
  readonly synthesizedFindings: readonly SynthesizedFinding[]
}

export interface SynthesizedFinding {
  readonly id: string                         // F-NNN, fingerprint(file, title)
  readonly title: string
  readonly file: string
  readonly line: string
  readonly severity: ReviewSeverity           // strictest among eligible voters; or claimed-advisory if no voter raised
  readonly authorityImpact: 'voter' | 'advisory'  // 'advisory' if only advisory panelists raised this fingerprint
  readonly sources: readonly string[]         // panelist ids that raised this fingerprint
  readonly recommendation: string             // first non-empty among sources
  readonly roundRaised: number
  readonly roundResolved: number | 'unresolved'
}

// Algorithm:
function computeCanonicalPanelVerdict(input: PanelVerdictInput): PanelVerdict {
  // Layer 1: Compute eligibility
  const eligibility = input.panelists.map(p => ({
    panelist: p,
    eligibleForQuorum: p.role === 'voter' && p.providerFamily !== input.buildFamily,
    excludeReason: p.role === 'voter' && p.providerFamily === input.buildFamily
      ? `same-family voter rejected (build=${input.buildFamily}, reviewer=${p.providerFamily})`
      : p.role === 'advisory'
      ? 'advisory role'
      : undefined
  }))
  const eligibleVoters = eligibility.filter(e => e.eligibleForQuorum).map(e => e.panelist)
  const advisoryPanelists = eligibility.filter(e => !e.eligibleForQuorum).map(e => e.panelist)

  // Layer 2: Synthesize findings (dedup by fingerprint, attribute by source, mark authorityImpact)
  const synthesized = synthesizeFindings(input.panelists, eligibleVoters)

  // Layer 3: Verdict computation — eligible voters only for gate authority
  // Step 1: any unresolved 'block' from eligible voter → 'block'
  if (synthesized.some(f => f.authorityImpact === 'voter' && f.severity === 'block' && f.roundResolved === 'unresolved')) {
    return { panelVerdict: 'block', /* ... */ }
  }
  // Step 2: any unresolved 'fix-first' from eligible voter → 'needs-revision'
  if (synthesized.some(f => f.authorityImpact === 'voter' && f.severity === 'fix-first' && f.roundResolved === 'unresolved')) {
    return { panelVerdict: 'needs-revision', /* ... */ }
  }
  // Step 3: quorum requires exactly 2 eligible cross-family voters, both score >= 6 AND verdict 'ready'
  if (eligibleVoters.length !== 2) {
    return {
      panelVerdict: 'needs-revision',
      quorumReason: `cross-family quorum NOT met: required exactly 2 eligible voters, got ${eligibleVoters.length}`,
      /* ... */
    }
  }
  if (eligibleVoters.some(v => v.score < 6 || v.verdict !== 'ready')) {
    return { panelVerdict: 'needs-revision', /* ... */ }
  }
  // Step 4: ready
  return {
    panelVerdict: 'ready',
    quorumReason: `cross-family quorum reached: 2 of 2 voters from {${eligibleVoters.map(v => v.providerFamily).join(', ')}}`,
    eligibleVoterFamilies: eligibleVoters.map(v => v.providerFamily),
    excludedReviewerIds: advisoryPanelists.map(p => p.id),
    excludedReasons: eligibility.filter(e => e.excludeReason).map(e => ({ id: e.panelist.id, reason: e.excludeReason! })),
    synthesizedFindings: synthesized,
  }
}
```

**Table-test invariants** (commit 5 must include all 8 rows):

| Test | Composition | buildFamily | Expected verdict |
|---|---|---|---|
| T1 | 1 same-family voter + 1 cross-family voter, both ready 8 | claude | rejected at config-load OR `needs-revision` (1 eligible) |
| T2 | 1 same-family advisory + 1 cross-family voter | claude | `needs-revision` (1 eligible voter) |
| T3 | 1 same-family advisory + 2 cross-family voters, all ready 7+ | claude | `ready` |
| T4 | 1 same-family advisory raising `block` + 2 cross-family voters ready 8+ | claude | `ready` (advisory cannot veto) |
| T5 | 2 cross-family voters: ready 7, needs-revision 5 | claude | `needs-revision` |
| T6 | 2 cross-family voters ready 8, one has unresolved `fix-first` finding | claude | `needs-revision` |
| T7 | 2 same-family voters | claude | rejected at config-load |
| T8 | advisory-only panel | claude | rejected at config-load OR `needs-revision` (0 voters) |

Plus T9: T4 with same-family advisory raising `block` AND a cross-family voter independently raising the same fingerprint → severity escalates to `block`, panel verdict `block` (corroboration). This proves advisory findings can be ratified by an eligible voter via fingerprint match.

### 2.2 Five-layer defense-in-depth

Same-family voters cannot satisfy cross-family quorum. Five enforcement layers, all must agree:

1. **Config-load** (`src/config/load.ts`): rejects panels where any `role: voter` panelist's family equals build family. Error: `panel_voter_same_family_as_build`.
2. **Runtime registry family resolution** (`src/providers/registry.ts`): each panelist's family resolved via `registry.familyOf(providerId)` at invocation time, NOT pure `familyOf()`. Captures test-seam overrides + future routed-provider lineage.
3. **Artifact-parse recomputation** (`src/artifacts/review-report.ts`): `parseReviewReport` recomputes quorum from serialized `Reviewers` block; rejects if claimed `panelVerdict: ready` cannot be reconstructed from recorded panelists. Error: `review_artifact_quorum_inconsistent`.
4. **Quorum-time filtering** (`src/phases/review-panel-verdict.ts`): `computeCanonicalPanelVerdict` filters same-family voters from eligible-voter set even if they slipped through config-load.
5. **Event-validator consistency** (`src/state/events.ts`): `review_panel_completed` events with `panelVerdict: ready` are validated against panelist-completed event ancestors; rejected if recorded eligible-voter count < 2. Error: `event_panel_quorum_inconsistent`.

A `panel_quorum_rejected_same_family_vote` event fires whenever any of layers 1-4 rejects a same-family vote. Layer 5 emits `event_validator_panel_quorum_inconsistent` (does not reject; flags forensic).

### 2.3 Routed-provider lineage gating

Any provider whose underlying model family cannot be resolved (e.g., future OpenRouter/gateway adapters) is INELIGIBLE for cross-family voter role. Implementation: `registry.familyOf(providerId)` returns `'unknown'` for routed providers without resolved lineage; `eligibleForQuorum` requires `providerFamily !== 'unknown'` AND `providerFamily !== buildFamily`. Out-of-scope for M14 implementation (no routed providers yet), but the eligibility predicate must check it so PE-2+ doesn't break panel quorum.

### 2.4 Manifest equality invariant

Each panelist must receive the same `PreparedProviderRequest.files` manifest. The orchestrator builds the manifest ONCE per panel round and passes the same prepared request to each panelist (with provider id swapped). Manifest hash recorded per-panelist; if two panelists in the same round have different manifest hashes, that's a bug — the panelist completion event records the hash, and the doctor baseline command refuses to compare runs where panelists saw different manifests.

### 2.5 Staging vs canonical artifact

```
state/review-panel/round-1/
  panelist-reviewer-A.md       (atomic write on review_panelist_completed)
  panelist-reviewer-B.md       (atomic write on review_panelist_completed)
  panelist-reviewer-C.md       (advisory; same path pattern)
state/REVIEW.md                (atomic write ONLY after synthesis; canonical)
```

Resume picks up at first missing panelist staging file. Synthesis is idempotent: rerunning synthesis on completed panelist drafts produces byte-identical canonical REVIEW.md. `parseReviewReport` only accepts canonical REVIEW.md; staging files have a separate parser used only for resume.

### 2.6 REVIEW.md schema (canonical, panel mode)

```yaml
# REVIEW.md (panel mode)
Round: 1

Reviewers:
  - id: reviewer-A
    providerId: codex
    providerFamily: codex
    modelPolicy: gpt-5.5
    role: voter
    score: 8
    verdict: ready
    crossFamilyCheck: passed
    buildFamily: claude
    manifestHash: <sha256>
  - id: reviewer-B
    providerId: gemini
    providerFamily: gemini
    modelPolicy: gemini-2.5-pro
    role: voter
    score: 7
    verdict: ready
    crossFamilyCheck: passed
    buildFamily: claude
    manifestHash: <sha256>      # MUST equal reviewer-A.manifestHash
  - id: reviewer-C
    providerId: claude
    providerFamily: claude
    modelPolicy: claude-opus-4-7
    role: advisory
    score: 9
    verdict: ready
    crossFamilyCheck: same-family (advisory only)
    buildFamily: claude
    manifestHash: <sha256>      # MUST equal voter manifest hashes

Synthesis:
  panelVerdict: ready
  quorumReason: "cross-family quorum reached: 2 of 2 voters from {codex, gemini}"
  eligibleVoterFamilies: [codex, gemini]
  excludedReviewerIds: [reviewer-C]
  excludedReasons:
    - { id: reviewer-C, reason: "advisory role" }
  uniqueFindingsByReviewer: { reviewer-A: 2, reviewer-B: 3, reviewer-C: 1 }
  sharedFindings: 1

Findings:
  - id: F-001
    title: "Missing null check on user input"
    file: src/handler.ts
    line: 42
    severity: fix-first
    authorityImpact: voter
    sources: [reviewer-A, reviewer-B]
    recommendation: "Add explicit null guard"
    roundRaised: 1
    roundResolved: unresolved
  - id: F-002
    title: "Variable shadowing in callback"
    file: src/handler.ts
    line: 67
    severity: nit
    authorityImpact: advisory
    sources: [reviewer-C]
    recommendation: "Rename inner var"
    roundRaised: 1
    roundResolved: unresolved
```

**Single-reviewer mode unchanged** (M9 backwards-compat): when `reviewer.panel` is absent or has 1 entry, the existing M9 single-`Reviewer:` block schema is used. Both shapes round-trip via the same parser; the parser dispatches on presence of `Reviewers:` (plural) vs `Reviewer:` (singular).

### 2.7 Rule-21 ship-gate metric event

```typescript
// New event in src/state/schemas.ts
interface ReviewPanelBaselineCompleted {
  type: 'review_panel_baseline_completed'
  fixtureId: string                        // path or hash of test fixture
  singleRunId: string
  panelRunId: string
  singleFindingCount: number
  panelFindingCount: number
  panelOnlyFindingCount: number            // raised by panel, missed by single
  panelOnlyActionableFindingCount: number  // panelOnly AND severity ∈ {block, fix-first} AND authorityImpact === 'voter'
  expectedFindingRecallDelta?: number      // present when fixture has oracle
  disagreementCount: number                // count of review_panel_disagreement events in panel run
  sameFamilyVoteRejectionCount: number     // count of panel_quorum_rejected_same_family_vote events
  manifestEqualityHeld: boolean            // true if all panelists in panel run shared same manifest hash
  singleReviewArtifactHash: string         // sha256 of single-mode REVIEW.md
  panelReviewArtifactHash: string          // sha256 of panel-mode REVIEW.md
  costOverheadRatio: number                // panel cost / single cost (telemetry, non-gating)
  wallClockOverheadMs: number              // panel duration - single duration (telemetry, non-gating)
}
```

**Ship gate** (must hold on the M14 baseline fixture before tagging):
- `panelOnlyActionableFindingCount > 0`
- `sameFamilyVoteRejectionCount >= 1` (positive control: requires deliberate same-family-vote attempt fixture that gets rejected)
- `manifestEqualityHeld === true`
- `disagreementCount >= 1` (supporting evidence; not core gate)

---

## 3. Locked commit sequence (10 commits)

Each commit serves one slice of the M14 authority boundary (panel quorum + cross-family enforcement + synthesis). All commits combined respect rule 20: ONE new authority boundary in this milestone.

| # | Subject | Authority slice | New tests |
|---|---|---|---|
| 1 | `docs(contracts/review-panel): grammar + quorum + advisory rule + canonical verdict + staging artifact + baseline metric event` | Contract surface only — no runtime change. Defines panel grammar, exact `computeCanonicalPanelVerdict` signature, staging-vs-canonical artifact rule, `review_panel_baseline_completed` event payload schema, all 8 (+ T9) panel composition test cases as invariants | 0 |
| 2 | `feat(config): panel schema in config/schema.ts + load.ts validation + agents/loader.ts integration + same-family-voter rejection at config-load` | Config-time enforcement only. Loader rejects: same-family voters, voters !== 2, advisory-only panels, panels with > 2 voters | ~15 |
| 3 | `feat(artifacts/review-report): multi-reviewer schema + Synthesis block + parse-time quorum recomputation` | Schema + serializer/parser. Round-trips both M9 single + M14 panel shapes. Parser rejects contradictory quorum claims (`review_artifact_quorum_inconsistent`) | ~20 |
| 4 | `feat(state/events): panel event taxonomy (started, panelist_completed, completed, disagreement, quorum_rejected, baseline_completed)` | Event schemas + validators. `review_panel_completed` with `ready` verdict validated against panelist ancestors (event-validator backstop, layer 5) | ~15 |
| 5 | `feat(phases/review-panel-verdict): pure computeCanonicalPanelVerdict helper + table-tests T1-T9` | Pure verdict authority. No I/O. Table-tests cover all 9 panel compositions including same-family advisory ratification edge case | ~25 |
| 6 | `feat(phases/review-panel): sequential orchestrator + staging writes + synthesis + runReview delegation + manifest equality + runtime family resolution + routed-lineage rejection` | Runtime orchestration. Delegates from `runReview` when `panel.length > 1`. Sequential panelist invocation; per-panelist staging write + `review_panelist_completed`; canonical REVIEW.md atomic write only after synthesis. Manifest hash equality enforced. Runtime registry resolves panelist family (NOT pure `familyOf`). Routed/unknown-lineage providers rejected as voters. | ~25 |
| 7 | `feat(providers/cost): aggregate panel preflight + per-reviewer attribution + reuse budget_warning` | Budget integration. Aggregate preflight refuses whole panel before any call if budget insufficient. Per-reviewer cost attributed via `role: 'reviewer'` (existing M13 pattern). NO new event — reuses M13 `budget_warning`. | ~10 |
| 8 | `feat(commands/doctor): doctor --panel-baseline <fixture> command + emits review_panel_baseline_completed metric event` | Rule-21 ship gate. Wired through `src/commands/doctor.ts`. Runs same fixture in single-mode then panel-mode; computes all metric fields; emits event; prints summary report. | ~15 |
| 9 | `test(e2e/review-panel): full panel round + panel-only-actionable proof + same-family-rejection positive control + invocation-seam fixture` | E2E proof of rule-21 ship gate. Fixture `tests/fixtures/review-panel-baseline/` uses invocation-seam (preserves real provider IDs/families via scripted responses; does NOT invent fake provider IDs). Includes T1-T9 fixtures + same-family-vote rejection fixture + panel-only-actionable finding fixture. | ~20-30 |
| 10 | `docs(roadmap,thesis): M14 closure + measurement deltas recorded` | Closure docs. ROADMAP M14 row marked closed; thesis post-M10 table updated. NO "update memory" in commit subject — assistant memory is not a product artifact. | 0 |

**Commit-message style**: conventional commits, no emojis, no Co-Authored-By footer (per CLAUDE.md "Working in this repo" rule 4).

**Per-commit invariant**: all tests must pass before commit. Ralph's per-iteration gate: `bun test` must show `0 fail` before any `git add` / `git commit`. Failed test = revert iteration's edits, retry approach.

---

## 4. File surface (locked paths)

### New files (10)

- `docs/contracts/REVIEW_PANEL.md` — panel grammar + semantics
- `src/phases/review-panel-verdict.ts` — pure `computeCanonicalPanelVerdict` helper
- `src/phases/review-panel.ts` — runtime orchestrator
- `src/commands/doctor-panel-baseline.ts` — measurement command
- `tests/fixtures/review-panel-baseline/` — fixture directory (multiple files)
- `tests/review-panel-config-validation.test.ts`
- `tests/review-panel-canonical-verdict.test.ts` (table-tests T1-T9)
- `tests/review-panel-orchestrator.test.ts`
- `tests/review-panel-events.test.ts`
- `tests/review-panel-cost-aggregate.test.ts`
- `tests/review-panel-doctor-baseline.test.ts`
- `tests/e2e/review-panel-baseline.test.ts`
- `tests/review-report-multi-reviewer-schema.test.ts`

### Modified files (8)

- `src/config/schema.ts` — `reviewer.panel` schema
- `src/config/load.ts` — same-family-voter rejection at config-load
- `src/agents/loader.ts` — panel loader integration
- `src/artifacts/review-report.ts` — multi-reviewer schema + parse-time quorum recomputation
- `src/phases/review.ts` — delegation point to `review-panel.ts`
- `src/providers/cost.ts` — aggregate panel preflight + reuse `budget_warning`
- `src/state/events.ts` + `src/state/schemas.ts` — new event types + validator backstop
- `src/commands/doctor.ts` — wire `--panel-baseline` subcommand
- `docs/contracts/REVIEW.md` — link to REVIEW_PANEL.md, document panel-mode delegation
- `docs/design/ROADMAP.md` — M14 closure
- `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` — Reviewer panel row updated

---

## 5. What is explicitly NOT in M14 (rule 20 defer list)

- Automatic-trigger policy for panels (M15)
- Multi-opponent debate (M16+)
- Parallel builder candidates (M16+; security-wedge trigger)
- Synthesizer-as-persona (M16+ if mechanical synthesis proves insufficient)
- Generalized parallel-provider primitive across phases (M16+)
- Researcher phase-tail (M16+)
- Panel for VERIFY phase (M16+; deterministic runner stays v0.1 verifier)
- Cross-family check at any layer beyond REVIEW (BUILD stays single-builder)
- Configurable quorum (k-of-N) — fixed 2 for v1
- Wall-clock parallel panelist invocation (sequential for v1)
- Panel as default mode (single-reviewer remains default; panel opt-in)
- Live-provider panel measurement (FakeProvider scripted responses for v1; live-provider deferred to demand-checkpoint after PE-1 friend survey)

---

## 6. Per-iteration test gate (Ralph invariant)

Every Ralph iteration must end with:

1. `bun test` shows `0 fail` (carrying tests + new tests both green)
2. `bun run typecheck` clean
3. Test count monotonically increases (within tolerance for delete-rename)
4. `git diff --stat` shows changes consistent with the in-progress commit
5. If any check fails: revert the iteration's edits via `git restore`, retry approach

If three consecutive iterations fail the same check, write a `NEEDS_INTERVENTION.md` note in the repo root and emit `<promise>M14_BLOCKED</promise>` to halt the loop. The morning review will resume from the intervention point.

---

## 7. Completion criteria (Ralph completion-promise gate)

Ralph emits `<promise>M14_COMPLETE</promise>` ONLY when ALL of the following hold:

- [ ] All 10 commits exist on `feat/m14-reviewer-panel` branch
- [ ] Each commit's authority slice is single-axis (rule 20)
- [ ] `bun test` shows `~2340-2370 pass / 0 fail / 1 skip`
- [ ] `bun run typecheck` clean
- [ ] `bun run dev doctor --panel-baseline tests/fixtures/review-panel-baseline` succeeds AND emits `review_panel_baseline_completed` event with:
  - `panelOnlyActionableFindingCount > 0`
  - `sameFamilyVoteRejectionCount >= 1`
  - `manifestEqualityHeld === true`
  - `disagreementCount >= 1`
- [ ] All 9 canonical verdict table-tests (T1-T9) pass
- [ ] No partial REVIEW.md artifacts in test runs (canonical only after synthesis)
- [ ] `now.md` and `m14_progress.md` memory updated with end-state
- [ ] No `git push`, no `git tag`, no merge — branch left for Ozzy's morning review

If any criterion fails: emit `<promise>M14_BLOCKED</promise>` and write notes in `now.md` for morning intervention.

---

## 8. Morning handoff

Upon Ralph completion, the morning state for Ozzy will be:

**Best case**: All criteria met. Branch `feat/m14-reviewer-panel` ready for Codex review round R1. Run `mcp__plugin_agent-codex_codex-native__codex` with M14_REVIEW briefing pointing at HEAD. Codex returns push/fix-first/debate-required. If push: tag `v0.15.0-alpha.0`, merge to main locally, hand to Ozzy for explicit push approval.

**Likely case**: Most criteria met, Codex R1 returns `fix-first` with N findings. Notes in `now.md` flag the findings; Ozzy decides whether to address in this session or schedule.

**Fallback case**: `M14_BLOCKED` emitted. `now.md` contains the blocker description, last successful commit, attempted approaches. Ozzy course-corrects.

---

## End of kickoff
