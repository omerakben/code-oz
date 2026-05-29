# REVIEW_PANEL (v0.1, M14)

User-facing contract for **Reviewer panel v1** — the first simultaneous-provider surface in `code-oz`. Extends [`REVIEW.md`](./REVIEW.md) with multi-reviewer panel mode: cross-family quorum, same-family-advisory enforcement, and orchestrator-owned synthesis.

This contract is the M14 authority boundary. Single-reviewer mode (M9 baseline) is unchanged; panel mode is opt-in via `reviewer.panel: [...]` config under the `company:` block. The single-reviewer canonical artifact and event taxonomy continue to govern when no panel is configured.

## Phase overview

When `reviewer.panel` is configured with two or more entries, the REVIEW phase delegates to the panel orchestrator (`src/phases/review-panel.ts`). The panel runs all configured panelists **sequentially** against the same BUILD output, stages each panelist's draft to a per-panelist staging file, and synthesizes one canonical `REVIEW.md` after all required panelists complete. The orchestrator owns the canonical verdict via `computeCanonicalPanelVerdict` (`src/phases/review-panel-verdict.ts`); panelists score and submit findings, but never author the panel verdict.

Authority boundary (rule 20, single-axis): **panel quorum + cross-family enforcement + orchestrator-owned synthesis.** Nothing else lands in M14.

## Panel grammar (config)

```yaml
# .code-oz/config.yaml
company:
  reviewer:
    panel:
      - { provider: codex, role: voter }
      - { provider: gemini, role: voter }
      - { provider: claude, role: advisory }   # same-family as builder; advisory only
```

### Locked rules

- **Exactly two `voter` panelists for v1.** Loader rejects panels with fewer or more than two voters with error `panel_voter_count_invalid`. Configurable quorum (k-of-N) is deferred to a future authority boundary.
- **Both voters must be cross-family relative to the build family.** Same-family voters are rejected at config-load (`src/config/load.ts`) AND at agent-loader post-company-override validation (`src/agents/loader.ts`'s `enforceReviewerPanelCrossFamily`), both with `panel_voter_same_family_as_build`. The loader check catches voter laundering that config-load cannot see — for example when company overrides change the resolved BUILD agent provider after config-load completed.
- **Optional advisory panelists.** Any number, any family. Recorded in synthesis but excluded from canonical verdict (positive AND negative gate authority disabled).
- **Single-reviewer back-compat.** When `reviewer.panel` is absent or has exactly one entry with no `role` field, M9 single-reviewer mode runs unchanged. Single-reviewer artifact, events, and verdict semantics are untouched.

## Same-family advisory authority (locked)

Same-family advisory reviewers can produce findings with any severity, but those findings have **no canonical gate authority** unless an eligible cross-family voter independently raises the same fingerprint.

Recorded as: `authorityImpact: 'advisory'` on each synthesized finding sourced only from advisory panelists. Recorded as `authorityImpact: 'voter'` when at least one eligible cross-family voter raised the fingerprint (advisory ratification).

This is the construction guarantee against **negative authority-laundering**: an advisory reviewer cannot veto a release by claiming `block` severity, just as a same-family voter cannot enable one by claiming `ready`. Useful prompt-sensitivity evidence is preserved (the claimed severity is recorded), but the canonical verdict ignores it without cross-family corroboration.

## Canonical panel verdict (orchestrator-owned)

`computeCanonicalPanelVerdict(input)` is the single source of truth for panel verdicts. It is a pure function with no I/O; persona prompts cannot override it; malformed `REVIEW.md` files are rejected by parser recomputation that calls back into this same function.

```
INPUT:
  buildFamily: ProviderFamily              (resolved from build_provider_recorded)
  panelists: [
    {
      id: stable string
      providerId: ProviderId               (from registry resolution at invocation)
      providerFamily: ProviderFamily       (from registry.familyOf() at invocation)
      modelPolicy: string
      role: 'voter' | 'advisory'           (from config)
      score: 0-10 integer                  (from panelist persona)
      verdict: 'ready' | 'needs-revision' | 'block'
      findings: ReviewFinding[]
    }
  ]

ALGORITHM:
  Step 1 (eligibility):
    For each panelist p:
      eligibleForQuorum = (p.role === 'voter' AND p.providerFamily !== buildFamily AND p.providerFamily !== 'unknown')
      excludeReason = (
        'same-family voter rejected' if voter and family match
        'advisory role'              if role is advisory
        'unknown lineage'            if family is 'unknown' (routed/gateway provider)
        undefined                    otherwise
      )

  Step 2 (synthesis):
    Group findings by fingerprint(file, title) using existing M9 fingerprintFinding.
    For each fingerprint group, build SynthesizedFinding:
      severity = strictest among eligible cross-family voter sources;
                 else strictest among advisory sources (recorded but authorityImpact='advisory')
      authorityImpact = 'voter' if any eligible voter raised it; else 'advisory'
      sources = [panelist.id for each panelist that raised this fingerprint]
      recommendation = first non-empty among sources (priority: voters first, then advisory)

  Step 3 (verdict — eligible voters only carry gate authority):
    If any synthesized finding has authorityImpact='voter' AND severity='block' AND roundResolved='unresolved':
      return panelVerdict='block'
    If any synthesized finding has authorityImpact='voter' AND severity='fix-first' AND roundResolved='unresolved':
      return panelVerdict='needs-revision'

  Step 4 (quorum):
    eligibleVoters = [p for p in panelists if eligibleForQuorum]
    If len(eligibleVoters) !== 2:
      return panelVerdict='needs-revision', quorumReason='cross-family quorum NOT met: required exactly 2 eligible voters, got <N>'
    If any v in eligibleVoters has v.score < 6 OR v.verdict !== 'ready':
      return panelVerdict='needs-revision', quorumReason='eligible voter not ready: <id> score=<s> verdict=<v>'

  Step 5 (ready):
    return panelVerdict='ready', quorumReason='cross-family quorum reached: 2 of 2 voters from {<families>}'

OUTPUT:
  panelVerdict: 'ready' | 'needs-revision' | 'block'
  quorumReason: string
  eligibleVoterFamilies: ProviderFamily[]
  excludedReviewerIds: string[]
  excludedReasons: { id: string, reason: string }[]
  synthesizedFindings: SynthesizedFinding[]
```

### Panel composition test cases (locked, T1-T9 in `tests/review-panel-canonical-verdict.test.ts`)

| # | Composition (build family: `claude`) | Expected panel verdict |
|---|---|---|
| T1 | 1 same-family voter (claude) + 1 cross-family voter (codex), both ready 8 | rejected at config-load OR `needs-revision` (1 eligible voter only) |
| T2 | 1 same-family advisory (claude) + 1 cross-family voter (codex) | `needs-revision` (1 eligible voter only) |
| T3 | 1 same-family advisory (claude) + 2 cross-family voters (codex, gemini), all score ≥ 6 ready | `ready` |
| T4 | 1 same-family advisory (claude) raising `block` + 2 cross-family voters (codex, gemini) ready 8+, no shared fingerprint | `ready` (advisory `block` has authorityImpact `advisory`; cannot veto) |
| T5 | 2 cross-family voters: ready 7, needs-revision 5 | `needs-revision` |
| T6 | 2 cross-family voters ready 8, one has unresolved `fix-first` finding | `needs-revision` (eligible voter actionable) |
| T7 | 2 same-family voters (claude + claude) | rejected at config-load |
| T8 | advisory-only panel (no voters) | rejected at config-load |
| T9 | Same as T4 PLUS one cross-family voter independently raises the same fingerprint as the advisory `block` | `block` (advisory finding ratified by cross-family voter; severity escalates) |

T9 proves advisory ratification: same-family `block` becomes canonical-effective only when a cross-family voter corroborates the same fingerprint.

## Five-layer defense-in-depth

Same-family voters cannot satisfy cross-family quorum. Five enforcement layers, all must agree; mismatch in any layer is a bug.

| # | Layer | File | Error code on rejection |
|---|---|---|---|
| 1 | Config-load | `src/config/load.ts` | `panel_voter_same_family_as_build` |
| 2 | Agent-loader post-company-override validation | `src/agents/loader.ts` (`enforceReviewerPanelCrossFamily`); also threads runtime `registry.familyOf()` resolution forward via `src/providers/registry.ts` | `panel_voter_same_family_as_build` (catches voter laundering that company overrides introduce after config-load) |
| 3 | Artifact-parse invariant bundle | `src/artifacts/review-report.ts` (`parseReviewPanelReport`) | `review_panelist_manifest_mismatch` (manifest equality), `review_artifact_unknown_source_id` + `review_artifact_authority_impact_inconsistent` (F4 source/impact), `review_artifact_verdict_field_inconsistent` (F5 cross-section verdict), `review_artifact_quorum_inconsistent` (recomputed verdict) |
| 4 | Panel orchestrator runtime authority | `src/phases/review-panel.ts` (`runReviewPanel`) | `panel_voter_same_family_at_runtime` (registry-resolved family collapses voter into BUILD family at runtime), `panel_provider_family_unresolved` (registry has no family for `providerId`), `panel_budget_exceeded` (aggregate preflight), `review_panelist_manifest_mismatch` (cross-panelist manifest disagreement), `review_panel_resume_mismatch` (partial staging guard with `reason: 'no_completed_event' \| 'sha_mismatch'`) |
| 5 | Event-validator consistency | `src/state/events.ts` | `event_invalid_value` (layer-5 backstop on `review_panel_completed`: when `panelVerdict='ready'`, `eligibleVoterFamilies` count must be 2) |

The pure `computeCanonicalPanelVerdict` helper in `src/phases/review-panel-verdict.ts` is the algorithm both layer 4 (orchestrator) and layer 3 (artifact-parse recompute via `recomputePanelVerdictFromArtifact`) call so the runtime authority and the parse-time recompute always agree on every panel composition.

In v0.1, the `panel_quorum_rejected_same_family_vote` event is emitted ONLY by the doctor baseline command (`code-oz doctor --panel-baseline`) when running synthetic same-family configs through `loadConfig` — it is the layer-1 positive control for rule-21 ship-gate measurement. The runtime layer-4 authority surfaces same-family rejection as a `panel_voter_same_family_at_runtime` intervention rather than emitting this event. (Future: emit the event on layer-4 intervention if telemetry needs it; deferred to M16+ until measurable need.)

## Routed-provider lineage gating

Any provider whose underlying model family cannot be resolved (e.g., future OpenRouter/gateway adapters) returns `'unknown'` from `registry.familyOf()` and is **ineligible for cross-family voter quorum**. Implementation: `eligibleForQuorum` requires `providerFamily !== 'unknown'` AND `providerFamily !== buildFamily`.

Out-of-scope for M14 implementation (no routed providers exist yet). The eligibility predicate must include the check so PE-2+ (OpenRouter) does not break panel quorum semantics.

## Manifest equality invariant

Each panelist must receive the **same** `PreparedProviderRequest.files` manifest. The orchestrator builds the manifest once per panel round and passes the same prepared request to each panelist (with provider id swapped). Each panelist's manifest hash is recorded in the per-panelist Reviewer block and in the `review_panelist_completed` event.

If two panelists in the same round have different manifest hashes, that is a bug — the doctor baseline command refuses to compare runs where panelists saw different manifests (`manifestEqualityHeld: false` in the metric event).

## Staging vs canonical artifact

```
.code-oz/runs/<runId>/review-panel/round-N/
  panelist-<id>.md         (atomic write on review_panelist_completed)
.code-oz/artifacts/REVIEW.md  (atomic write ONLY after synthesis; canonical)
```

- Per-panelist drafts are written atomically to `.code-oz/runs/<runId>/review-panel/round-<N>/panelist-<id>.md` upon `review_panelist_completed`.
- Canonical `REVIEW.md` is written atomically once after all required panelists complete and synthesis runs.
- **Resume policy (v0.1, M14 R2 finding #2 + R3 finding #1 closure)**: when partial panel staging is on disk for `(runId, taskId, attempt, round=N)` AND EITHER no `review_panel_completed` event exists for that coordinate OR the matching event's `reviewReportSha256` does not match the on-disk canonical `REVIEW.md`, `runReview` refuses to replay the round. It surfaces a `review_panel_resume_mismatch` intervention naming the staging directory + panelist file count + the reason (`no_completed_event` or `sha_mismatch`). The operator must inspect, clear, or hand-resume; the orchestrator MUST NOT silently re-invoke panelist 0 (that would overwrite completed-panelist evidence and break the staging-vs-canonical authority guarantee). Auto-resume from partial staging is M16+ (deferred until measurable need per rule 21).
- v0.1 has NO staging parser. Staging files are forensic evidence only. The orchestrator atomically writes each staging file and records its `stagingSha256` in `review_panelist_completed` from the in-memory content; v0.1 does NOT read staging back for verification, resume, recovery, or synthesis-from-staging. The canonical artifact is always produced by `serializeReviewPanelReport` from in-memory invocation results during the round that produced them.

This invariant prevents **partial-but-authoritative artifacts**: a canonical `REVIEW.md` with `panelVerdict: ready` cannot exist before the panel completes.

### Multi-round panel lifecycle (R2 finding #1 closure)

Panel mode supports rounds 1..4 (`REVIEW_ROUND_CAP`). On round N+1, the caller passes the prior canonical panel `REVIEW.md` as `RunReviewOptions.priorReviewMd`. `runReview` detects the grammar via `detectReviewReportMode` and dispatches to `parseReviewPanelReport` (NOT `parseReviewReport`) before the panel branch runs. The parsed `priorPanelReport` is forwarded to `runReviewPanel`, which:

- Carries forward F-NNN ids by fingerprint (re-raised findings reuse prior id + roundRaised).
- Marks prior fingerprints not raised this round as resolved-this-round.
- Builds `roundTimeline` as `[...prior.roundTimeline, newEntry]` so the canonical artifact spans the full multi-round run.
- Re-raised previously-resolved fingerprints are reset to `roundResolved: 'unresolved'` (ping-pong reopen — the panel verdict path catches them via the unresolved-voter-block / fix-first invariants).

## `REVIEW.md` schema (panel mode)

The canonical `REVIEW.md` parser dispatches on the H2 heading line: an exact `## Reviewers` line means panel mode (handled by `parseReviewPanelReport` / `serializeReviewPanelReport`); an exact `## Reviewer` line means M9 single-reviewer mode (handled by `parseReviewReport` / `serializeReviewReport`). The dispatch helper is `detectReviewReportMode`. Single-mode and panel-mode artifacts are NOT mutually round-trippable — each shape pairs with its own serializer/parser.

```markdown
# REVIEW

## Upstream refs

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: <build-sha>)
- VERIFY.md: .code-oz/artifacts/VERIFY.md (sha256: <verify-sha>)
- Task: T-001
- Attempt: 1
- Base commit: <commit-sha>
- Patch sha256: <patch-sha>

## Reviewers

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
  manifestHash: <sha256>            # MUST equal reviewer-A.manifestHash
- id: reviewer-C
  providerId: claude
  providerFamily: claude
  modelPolicy: claude-opus-4-8
  role: advisory
  score: 9
  verdict: ready
  crossFamilyCheck: same-family (advisory only)
  buildFamily: claude
  manifestHash: <sha256>            # MUST equal voter manifest hashes

## Synthesis

- panelVerdict: ready
- quorumReason: "cross-family quorum reached: 2 of 2 voters from {codex, gemini}"
- eligibleVoterFamilies: [codex, gemini]
- excludedReviewerIds: [reviewer-C]
- excludedReasons:
  - { id: reviewer-C, reason: "advisory role" }
- uniqueFindingsByReviewer: { reviewer-A: 2, reviewer-B: 3, reviewer-C: 1 }
- sharedFindings: 1

## Round timeline

- Round 1: 2026-05-03T01:23:45Z | findings raised: 5 | panelVerdict: ready

## Findings

### F-001: Missing null check on user input

- File: src/handler.ts
- Line: 42
- Severity: fix-first
- AuthorityImpact: voter
- Sources: [reviewer-A, reviewer-B]
- Recommendation: Add explicit null guard
- Round raised: 1
- Round resolved: unresolved

### F-002: Variable shadowing in callback

- File: src/handler.ts
- Line: 67
- Severity: nit
- AuthorityImpact: advisory
- Sources: [reviewer-C]
- Recommendation: Rename inner var
- Round raised: 1
- Round resolved: unresolved

## Score

- Round count: 1
- Final score: panel
- Final verdict: ready
- Exit reason: cross-family quorum reached AND no unresolved voter actionable findings

## Cap status

- Cap: 4 panel rounds
- Rounds used: 1
- Cap exhausted: false
```

### Required H2 sections (panel mode)

| Section | What it answers | Min content |
|---|---|---|
| `## Upstream refs` | Same as M9 single-reviewer | 6 bullets |
| `## Reviewers` | Per-panelist identity + cross-family + manifest hash | ≥ 2 panelist blocks (matches `len(panel)`) |
| `## Synthesis` | Orchestrator-owned panel verdict + quorum reason + audit fields | 7 bullets |
| `## Round timeline` | Per-panel-round summary in chronological order | ≥ 1 bullet |
| `## Findings` | All findings raised by any panelist (deduped + attributed) | ≥ 0 H3 blocks |
| `## Score` | Final round count, panel verdict, exit reason | 4 bullets (`Final score: panel` is the literal value) |
| `## Cap status` | Whether the panel-round cap (4) was hit | 3 bullets |

### `## Reviewers` block grammar (locked)

Each panelist is a YAML-flow-style block of named fields. Required fields per panelist: `id`, `providerId`, `providerFamily`, `modelPolicy`, `role`, `score`, `verdict`, `crossFamilyCheck`, `buildFamily`, `manifestHash`.

- `role` ∈ `{voter, advisory}`
- `crossFamilyCheck` ∈ `{passed, same-family (advisory only)}`
  - `passed` requires `providerFamily !== buildFamily`
  - `same-family (advisory only)` requires `role: advisory`
- `manifestHash` is `sha256(canonical(PreparedProviderRequest.files))`. All entries must match (manifest equality invariant).
- `score` is integer 0-10.

Panelist-block field order is fixed; reordering or missing fields produces a parse error in the `review_panel_reviewer_*` family (`review_panel_reviewer_missing`, `review_panel_reviewer_grammar`, etc.).

### `## Synthesis` block grammar (locked)

```yaml
- panelVerdict: ready | needs-revision | block
- quorumReason: <string, ≤ 200 chars>
- eligibleVoterFamilies: [<ProviderFamily>, <ProviderFamily>]   # exactly 2 if panelVerdict=ready, else 0-2
- excludedReviewerIds: [<id>, ...]
- excludedReasons:
  - { id: <id>, reason: <string> }
- uniqueFindingsByReviewer: { <reviewer-id>: <count>, ... }
- sharedFindings: <count of findings raised by ≥2 panelists>
```

The parser **recomputes** `panelVerdict` from `Reviewers` + `Findings` and rejects if claimed differs from computed (`review_artifact_quorum_inconsistent`). This is layer 3 of the five-layer defense.

### `## Findings` grammar extension (locked)

Single-reviewer mode finding fields are unchanged. Panel mode adds two fields per finding:

```markdown
### F-NNN: <title>

- File: <path>
- Line: <line or range>
- Severity: block | fix-first | nit | fyi
- AuthorityImpact: voter | advisory               # M14: present only in panel mode
- Sources: [<reviewer-id>, ...]                   # M14: present only in panel mode
- Recommendation: <directive>
- Round raised: <1-4>
- Round resolved: <1-4 | unresolved>
```

- `AuthorityImpact: voter` requires at least one source whose `role: voter` AND `crossFamilyCheck: passed`.
- `AuthorityImpact: advisory` means all sources are advisory or same-family.
- Single-reviewer mode finding blocks omit `AuthorityImpact` and `Sources` for back-compat.

## Permissions required

```yaml
# Per-panelist permissions inherit from the M9 reviewer permission shape (see REVIEW.md).
# The orchestrator owns the panel; each panelist is invoked with the same prepared request.

provider: <per-panelist>                         # codex | gemini for voters; claude (or any) for advisory
modelPolicy: <per-panelist>
permissions:
  read: ['.code-oz/artifacts/SPEC.md', '.code-oz/artifacts/PLAN.md',
         '.code-oz/artifacts/SOURCE_CHECK.md',
         '.code-oz/artifacts/BUILD_REPORT.md', '.code-oz/artifacts/VERIFY.md',
         '.code-oz/artifacts/HYPOTHESES.md', '.code-oz/artifacts/OPEN_QUESTIONS.md',
         '.code-oz/runs/<runId>/worktree/']
  write: []                                      # panelists do NOT write; orchestrator writes staging + canonical
  bash: deny
  tool_use:
    repo_context: <same as M9 reviewer>
    review_request: <not invoked by panelists; M9 review-request stays orchestrator-side>
```

Panelists never write artifacts directly. Orchestrator writes staging files (`.code-oz/runs/<runId>/review-panel/round-<N>/panelist-<id>.md`) on `review_panelist_completed` and canonical `REVIEW.md` (under `.code-oz/artifacts/`) on synthesis.

## Event types emitted

Names listed here; canonical schemas in `src/state/schemas.ts`.

| Event | Emitted when |
|---|---|
| `review_panel_started` | Panel orchestrator invoked; panel composition logged with resolved provider families |
| `review_panelist_completed` | A single panelist finishes; staging file written with manifest hash |
| `review_panel_disagreement` | Two panelists rate the same fingerprint differently (severity, verdict, or presence) |
| `panel_quorum_rejected_same_family_vote` | Layer-1 positive control: emitted by `code-oz doctor --panel-baseline` when a synthetic same-family panel YAML is rejected by `loadConfig`. The schema discriminator reserves later-layer values (`runtime-registry`, `artifact-parse`, `quorum-time`) for future use; v0.1 has no runtime emitter — runtime layer-4 surfaces same-family rejection as the `panel_voter_same_family_at_runtime` intervention. |
| `review_panel_completed` | Synthesis writes canonical REVIEW.md; `panelVerdict` recorded |
| `review_panel_baseline_completed` | `doctor --panel-baseline` finishes; rule-21 ship-gate metric event |

The single-reviewer event taxonomy (`review_started`, `review_round_completed`, `review_resolved`, `review_blocked`) continues to govern when no panel is configured.

Panel mode emits the panel taxonomy. **It also emits `review_resolved` (on the resolved path) and `review_blocked` (on the block path) as compatibility signals** so the existing `code-oz approve review` gate path (`preApproveReviewHook`) finds a ready/terminal event without contract change. The `review_resolved.finalScore` field is set to `REVIEW_SCORE_MAX` (10) as a sentinel because panel mode does not have a single persona-authored score — the canonical artifact records `Final score: panel`. Event consumers MUST NOT treat the value 10 as a real reviewer-authored score when the source path is panel; they should cross-check against the canonical artifact's `Final score: panel` marker.

`preApproveReviewHook` cross-checks REVIEW.md sha256 against `review_resolved` first; if absent for a panel artifact, it falls back to a matching ready `review_panel_completed` event with the same sha256 (defense-in-depth: covers operator-driven approvals on artifacts produced by older panel runs that pre-date the F1 `review_resolved` emission).

Both terminal paths write the same `GATE_REVIEW_PASSED.json` shape (rule 1: file-based gate signals only).

### `review_panel_disagreement` payload

```typescript
{
  type: 'review_panel_disagreement'
  fingerprint: string                       // fingerprintFinding(file, title)
  kind: 'severity' | 'verdict' | 'presence' | 'advisory_unratified'
  reviewerIds: string[]                     // panelists involved
  details: { reviewerId: string, severity?: ReviewSeverity, verdict?: PanelistVerdict, present: boolean }[]
}
```

`kind: advisory_unratified` fires when an advisory panelist raises a `block` or `fix-first` finding that no eligible cross-family voter corroborated.

### `review_panel_baseline_completed` payload (rule-21 ship-gate metric event)

```typescript
{
  type: 'review_panel_baseline_completed'
  fixtureId: string                                    // path or hash of test fixture
  singleRunId: string
  panelRunId: string
  singleFindingCount: number
  panelFindingCount: number
  panelOnlyFindingCount: number                        // raised by panel, missed by single
  panelOnlyActionableFindingCount: number              // panelOnly AND severity ∈ {block, fix-first} AND authorityImpact === 'voter'
  expectedFindingRecallDelta?: number                  // present when fixture has oracle
  disagreementCount: number                            // count of review_panel_disagreement events in panel run
  sameFamilyVoteRejectionCount: number                 // count of panel_quorum_rejected_same_family_vote events observed in the run-local log (F7: events-derived, NOT fixture-declared)
  manifestEqualityHeld: boolean
  singleReviewArtifactHash: string                     // sha256 of single-mode REVIEW.md
  panelReviewArtifactHash: string                      // sha256 of panel-mode REVIEW.md
  costOverheadRatio: number                            // panel cost / single cost (telemetry, non-gating)
  wallClockOverheadMs: number                          // panel duration - single duration (telemetry, non-gating)
}
```

**Ship gate** (M14 cannot tag without all of these holding on the M14 baseline fixture):
- `panelOnlyActionableFindingCount > 0`
- `sameFamilyVoteRejectionCount >= 1` (positive control: the fixture's `sameFamilyVoteRejectionAttempts` field declares the **requested** attempt count; for each, `code-oz doctor --panel-baseline` runs an actual same-family panel YAML through `loadConfig` and emits a real `panel_quorum_rejected_same_family_vote` event with `layer='config-load'`. The metric counts those events in the run-local log — a downstream caller that bypasses appendEvent would surface as 0. If `loadConfig` does NOT reject (real layer-1 regression), the doctor command throws a typed error rather than silently underreporting.)
- `manifestEqualityHeld === true`
- `disagreementCount >= 1` (supporting evidence)

## Loop cap

Same as M9 single-reviewer: max 4 **panel rounds** per `(runId, taskId)`. A "panel round" is one full pass through all required panelists (sequential). Per-panelist repair-draft retry (1) is preserved per panelist within a round.

The 4 panel-round cap and VERIFY's 4-attempt BUILD cap remain **two monotonic global counters scoped to `(runId, taskId)`**. Whichever cap trips first owns the intervention. The cost gate is **aggregate panel preflight** (per kickoff §3 commit 7), not round reduction; the round cap is unchanged from M9.

## Cost story

Aggregate panel preflight refuses the whole panel before any panelist invokes if budget cannot support one full panel round. Per-reviewer cost is attributed via M13's `role: 'reviewer'` budget gating. Soft warnings reuse M13's `budget_warning` event (no new `panel_cost_warn` event vocabulary).

## Doctor baseline command

```bash
bun run dev doctor --panel-baseline <fixture-path>
```

Runs the same fixture in single-mode (one reviewer) then panel-mode (configured panel from fixture); computes all `review_panel_baseline_completed` payload fields; emits the event; prints a markdown summary report. Used by `tests/e2e/review-panel-baseline.test.ts` to assert the rule-21 ship gate.

## Common errors

| Error | Meaning | Action | Layer |
|---|---|---|---|
| `panel_voter_count_invalid` | `reviewer.panel` has !==2 voters (covers advisory-only panels with 0 voters) | Edit config to have exactly 2 voters | 1 (config-load) + 4 (orchestrator runtime defense) |
| `panel_voter_same_family_as_build` | Declared voter family matches resolved build family — caught at config-load OR at agent-loader post-company-override validation | Edit config (or company role override) to use cross-family voter | 1 (config-load) + 2 (agent-loader `enforceReviewerPanelCrossFamily`) |
| `panel_voter_same_family_at_runtime` | Registry-resolved voter family matches build family at runtime (registry override laundering attempt) | Inspect `familyOverrides` and `defaultProvider` — runtime resolution must yield cross-family voter | 4 (orchestrator) |
| `panel_provider_family_unresolved` | Registry has no family mapping for the panelist's `providerId` | Add the provider id to `DEFAULT_FAMILY_BY_ID` or supply `familyOverrides` | 4 (orchestrator) |
| `panel_budget_exceeded` | Aggregate panel preflight would exceed a budget cap | Raise the named cap in `.code-oz/config.yaml` (the rule names the specific cap) | 4 (orchestrator preflight) |
| `review_panelist_manifest_mismatch` | Two panelists in same round report different manifest hashes (or parser detects same in canonical artifact) | Orchestrator bug or hand-edited artifact; intervention | 3 (artifact parse) + 4 (orchestrator) |
| `review_artifact_unknown_source_id` | A finding's `Sources` references an id absent from the `Reviewers` section | Hand-edited artifact; restore canonical artifact | 3 (artifact parse, F4) |
| `review_artifact_authority_impact_inconsistent` | A finding's `Authority impact` does not match eligibility-derived value from its sources | Hand-edited artifact; restore canonical artifact | 3 (artifact parse, F4) |
| `review_artifact_verdict_field_inconsistent` | `Synthesis.Panel verdict` disagrees with the last `Round timeline` entry's panel verdict | Hand-edited artifact; restore canonical artifact | 3 (artifact parse, F5) |
| `review_artifact_quorum_inconsistent` | Parsed `Synthesis.panelVerdict` differs from recomputed verdict | Artifact corruption; inspect canonical REVIEW.md and events.jsonl, then restore the canonical artifact or clear the run state and rerun REVIEW (v0.1 has no synthesis-from-staging path) | 3 (artifact parse) |
| `review_panel_resume_mismatch` | Partial panel staging on disk + (no `review_panel_completed` event OR canonical REVIEW.md sha mismatch). The intervention `rule` text discriminates the two reasons | Inspect `.code-oz/runs/<runId>/review-panel/round-<N>/` and `.code-oz/artifacts/REVIEW.md`; clear staging or restore the canonical artifact | 4 (orchestrator preflight) |
| `event_invalid_value` (layer-5 rule for `review_panel_completed`) | `review_panel_completed.eligibleVoterFamilies` count is not 2 when `panelVerdict='ready'` | Validator backstop; should not occur if layers 1-4 are healthy | 5 (event validator) |

## Reference

- **Linked contracts:** [`REVIEW.md`](./REVIEW.md) (single-reviewer baseline), [`REVIEWER_MEMORY.md`](./REVIEWER_MEMORY.md), [`BUILD.md`](./BUILD.md), [`VERIFY.md`](./VERIFY.md), [`COMPANY.md`](./COMPANY.md) (roster routing), [`PROVIDERS.md`](./PROVIDERS.md) (capability + family), [`GATES.md`](./GATES.md)
- **M17 Reviewer Memory pointer:** [`REVIEWER_MEMORY.md`](./REVIEWER_MEMORY.md) captures the file-based lesson hygiene rubric for reusable panel and single-review findings; panel synthesis remains the M14 artifact authority.
- **Non-negotiable rules:** `CLAUDE.md` rules 1 (file-based gates), 2 (cross-family review), 6 (4-round cap), 7 (Markdown contracts), 11 (`NEEDS_INTERVENTION.json`), 13 (privacy by default; manifest equality), 19 (run-level budget), 20 (one new authority boundary per milestone), 21 (measurable risk reduction in events.jsonl)
- **Cross-model peer review trail:** [`CODEX_BRIEFING_M14.md`](../research/CODEX_BRIEFING_M14.md), [`CODEX_RESPONSE_M14.md`](../research/CODEX_RESPONSE_M14.md), [`SESSION_M14_KICKOFF.md`](../design/SESSION_M14_KICKOFF.md)
