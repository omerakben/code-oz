# Response — M14 Reviewer panel v1

**Thread:** 019deb75-bf40-7a40-a849-2131e0328085
**Date:** 2026-05-02
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** [`CODEX_BRIEFING_M14.md`](./CODEX_BRIEFING_M14.md)

## Verdict

accept-with-modifications

Claude's draft is directionally right: REVIEW is the correct first simultaneous-provider surface, panel mode should remain opt-in, and canonical verdict authority must stay with the orchestrator. I would not start the Ralph implementation loop until four changes are locked: same-family advisory findings must not have negative gate authority, rule-21 metrics must be computable from `events.jsonl`, quorum should be fixed and narrow for v1, and the fake-provider test strategy must preserve real provider-family semantics.

## Answers to open questions (Q1-Q12)

### Q1. Authority-laundering construction proof

**Recommendation:** Use both config-load rejection and quorum-time filtering, but add artifact-parse and event-validation backstops.

**Reasoning:** Config-load should reject any `role: voter` panelist whose resolved family equals the resolved BUILD family, because the operator should learn the mistake before a provider call happens. Quorum-time filtering is still mandatory because runtime family resolution can differ from pure `familyOf()` once test seams, W3 adapters, or routed providers exist.

**Pushback on Claude's draft:** Config-load plus quorum-time is not enough if `REVIEW.md` can be malformed or if a bug writes `panelVerdict: ready` with inflated quorum counts. `parseReviewReport` or the new panel parser must recompute quorum from the serialized `Reviewers` block and reject contradictions. `events.ts` should also validate any `review_panel_completed` event that claims a ready verdict with fewer than two eligible cross-family ready voters.

### Q2. Quorum floor — fixed 2 or configurable k-of-N

**Recommendation:** Fixed two eligible cross-family voters for M14, no configurable quorum knob.

**Reasoning:** M14 is the first simultaneous-provider surface, so the product should prove the smallest useful panel before exposing k-of-N semantics. A configurable quorum field is a second authority boundary because it lets users tune release authority. Keep v1 narrow enough that the construction proof is table-testable.

**Pushback on Claude's draft:** Loader should reject panels with fewer than two cross-family voters and should either reject more than two cross-family voters for v1 or treat the extras as advisory. My preference is stricter: exactly two cross-family voters plus optional advisory panelists. That makes the baseline fixture, canonical verdict proof, and docs clear.

### Q3. Findings dedup vs disagreement signal

**Recommendation:** Keep `fingerprintFinding(file, title)` unchanged, but emit disagreement data when reviewers attach different severity or verdict to the same fingerprint.

**Reasoning:** The M9 fingerprint rule is part of the ping-pong ratchet, and replacing it in M14 would create a second change axis. But deduping into one finding must not erase useful signal. Use `review_panel_disagreement` with a `kind: 'severity' | 'verdict' | 'presence' | 'advisory_unratified'` discriminator instead of adding a separate `review_panel_severity_disagreement` event.

**Pushback on Claude's draft:** "Strictest severity wins" should apply only across eligible cross-family voters. A same-family advisory reviewer may record a claimed severity, including `block`, but that severity cannot escalate the canonical gate outcome unless an eligible cross-family voter shares the fingerprint or the orchestrator can independently validate it as a deterministic contract violation.

### Q4. Sequential vs parallel — is parallel actually bundling

**Recommendation:** Sequential invocation is correct for M14.

**Reasoning:** "Simultaneous-provider surface" should mean multiple independent provider outputs contribute to one orchestrator-owned decision, not literal wall-clock concurrency. Parallel invocation would add atomic-resume, race, partial-budget, and ordering complexity without proving more risk reduction. Sequential is also easier to make deterministic with FakeProvider and easier to inspect in `events.jsonl`.

**Pushback on Claude's draft:** This is more a wording bug than a design bug. Docs should call M14 a "multi-provider reviewer panel" more often than "parallel" or "simultaneous." The thesis can still say first simultaneous-provider surface, but implementation docs should be precise: independent panelists, sequential execution, canonical synthesis.

### Q5. Round-cap reduction for panel

**Recommendation:** Keep the 4 panel-round cap.

**Reasoning:** The round cap measures remediation cycles, while M13 budgets measure provider-call and token cost. Scaling rounds down by panel size would make a 3-panel experiment effectively unable to remediate. The cost problem should be solved by aggregate preflight and existing budget enforcement, not by distorting the review-loop semantics.

**Pushback on Claude's draft:** The cap is fine only if panel preflight evaluates aggregate cost and provider-call count before any panelist runs. If the configured reviewer role budget cannot support one full panel round, the phase should fail before partial panel artifacts are produced.

### Q6. Cost preflight aggregate semantics

**Recommendation:** Choose option (a): aggregate preflight before any panelist invokes.

**Reasoning:** A partial panel has no valid quorum, so "N-1 reviewers worth of value" is audit noise in this milestone. Refuse the whole panel with `provider_budget_exceeded` and actionable config suggestions. This preserves the invariant that a panel round means one complete pass through all required panelists.

**Pushback on Claude's draft:** Do not add a new `panel_cost_warn` event. M13 already established `budget_warning` with optional `role`; M14 should reuse that event and add aggregate helper logic in `src/providers/cost.ts` rather than adding a second warning vocabulary.

### Q7. Same-family-advisory: useful or noise

**Recommendation:** Keep same-family advisory in M14, but remove all gate authority from it.

**Reasoning:** Same-family advisory can produce findings and can be useful as a prompt-sensitivity comparison, but it cannot help reach `ready` and it cannot veto `ready` by itself. Otherwise the design prevents positive authority-laundering while allowing negative authority-laundering. Same-family review is useful evidence, not release authority.

**Pushback on Claude's draft:** Do not coerce same-family advisory findings down to `nit` or `fyi`, because that falsifies what the reviewer said. Record the claimed severity with `authorityImpact: advisory`; the synthesis may show it prominently, but canonical verdict computation must ignore it unless corroborated by an eligible cross-family voter.

### Q8. Rule-21 measurement: are the three metrics enough

**Recommendation:** No, not as drafted.

**Reasoning:** The three metric names are close, but current REVIEW events record counts, not finding fingerprints, so `unique_findings_delta(panel, single)` is not computable from `events.jsonl` alone unless M14 adds a baseline-summary event. Also, `same_family_vote_rejection_count` proves the anti-laundering guard fires; it is not itself risk reduction against the single-reviewer baseline.

**Pushback on Claude's draft:** `doctor --panel-baseline` should append or emit a deterministic `review_panel_baseline_completed` metric event with `fixtureId`, `singleRunId`, `panelRunId`, `singleFindingCount`, `panelFindingCount`, `panelOnlyFindingCount`, `panelOnlyActionableFindingCount`, `expectedFindingRecallDelta` when the fixture has an oracle, `disagreementCount`, `sameFamilyVoteRejectionCount`, and artifact hashes. Cost and wall-clock overhead should be non-gating telemetry in the same report.

### Q9. Panel resume semantics

**Recommendation:** Do not append partial panelist blocks to canonical `REVIEW.md` and treat that as a valid artifact.

**Reasoning:** A canonical `REVIEW.md` should represent an orchestrator-computed review decision, not an in-progress scratchpad. Write per-panelist drafts atomically to a staging path, emit `review_panelist_completed` with the draft hash, then synthesize canonical `REVIEW.md` only after every required panelist completes. Resume should read completed panelist hashes and continue at the first missing panelist.

**Pushback on Claude's draft:** Per-panelist atomic writes are good, but the target should not be canonical `REVIEW.md` until synthesis. This preserves M9 fingerprint discipline because canonicalization still happens once over all panelist outputs for the round. If reviewer 2 later names the same bug differently, the existing `fingerprint(file, title)` may miss the dedup, but that is an existing fingerprint limitation, not a resume-specific failure.

### Q10. v0.1 default — single-reviewer or panel

**Recommendation:** Keep single-reviewer as default and make panel opt-in.

**Reasoning:** The product thesis says panels are a differentiator, but CLAUDE.md rule 21 says complexity must earn its keep. New users should not pay the token, latency, and configuration cost of a panel until the baseline command proves the benefit on their project. Default-panel without cost evidence would violate the same discipline that made M13 land before M14.

**Pushback on Claude's draft:** No pushback on the default. The docs should present panel as the first opt-in confidence upgrade, not as the default workflow. A future default flip needs live-provider cost data, not just FakeProvider evidence.

### Q11. Authority bundling check

**Recommendation:** Split commit 5.

**Reasoning:** A pure `computeCanonicalPanelVerdict` helper with exhaustive tests is a separate code path from runtime panel orchestration, even though they serve one authority boundary. Keeping them separate makes review easier and prevents the synthesis rule from being buried in invocation plumbing. The boundary remains one thing: panel quorum and synthesis authority.

**Pushback on Claude's draft:** Commit 4 is M14-essential if it contains lifecycle, panelist-completed, disagreement, quorum-rejection, and baseline metric event shapes. Commit 7 is not M14.5 polish; it is the rule-21 ship gate and must remain in M14. The non-essential part is `panel_cost_warn`, which should be removed in favor of existing `budget_warning`.

### Q12. Anything else load-bearing Claude missed

**Recommendation:** Add privacy-manifest equality, routed-provider lineage, fake-provider family semantics, and event-ordering invariants to the plan before implementation.

**Reasoning:** Every panelist must receive the same provider file manifest unless a documented permission difference exists; otherwise panel deltas can be caused by different context, not provider judgment. If a routed provider's underlying family cannot be resolved, it cannot be an eligible voter. Event ordering also matters because `events.jsonl` replay is line-position ordered, not timestamp ordered.

**Pushback on Claude's draft:** The fake-provider test plan needs correction. The current `ProviderId` union is `claude | codex | gemini | fake | xai`, and `FakeProvider` has id and family `fake`, so fixtures named `claude-fake-reviewer-A` and `codex-fake-reviewer-B` are not real provider IDs. M14 tests should use an invocation seam or scripted panelist responses while preserving `providerId` and `providerFamily` as real data, not invent fake cross-family providers.

## Risks Claude's draft missed

- **critical** Rule-21 metrics are not computable from current events because review events record finding counts, not finding fingerprints. Mitigation: add a `review_panel_baseline_completed` metric event or equivalent deterministic metric event emitted by `doctor --panel-baseline`, with artifact hashes and panel-vs-single counts.

- **high** Same-family advisory findings can become negative authority-laundering if they can force `block` or `needs-revision`. Mitigation: advisory findings are visible in synthesis but excluded from canonical gate impact unless corroborated by an eligible cross-family voter.

- **high** The proposed fake-provider fixture names imply fake cross-family provider IDs that do not exist in `src/providers/types.ts`. Mitigation: test through a panelist invocation seam or real provider IDs with scripted responses, without expanding provider identity in M14.

- **medium** `panel_cost_warn` duplicates the M13 `budget_warning` event vocabulary. Mitigation: reuse `budget_warning` and add aggregate panel budget helpers rather than adding a parallel cost event.

- **medium** Partial writes to canonical `REVIEW.md` can create an artifact that looks authoritative before quorum is complete. Mitigation: stage per-panelist drafts and write canonical `REVIEW.md` only after synthesis, or mark partial artifacts as unparseable for gate purposes.

- **medium** Provider manifest drift can fake a panel benefit. Mitigation: record and compare each panelist's manifest hash; baseline measurement must fail if panelists did not receive the same file set.

- **medium** Routed-provider lineage can launder family identity when an upstream gateway hides the underlying model family. Mitigation: any routed provider with unknown lineage is ineligible for cross-family voter quorum until lineage is resolved.

- **low** The brief points to `src/config/company.ts`, but current config parsing lives in `src/config/load.ts` and schema in `src/config/schema.ts`. Mitigation: update file-path references before synthesis so Ralph edits the correct files.

## Authority-laundering construction proof

Claude's positive-vote rule is mostly right: same-family reviewers must be excluded from the ready quorum by construction, and quorum-time filtering is the right final backstop. It does not survive every panel composition as written because step 1 and step 2 let any advisory finding from any family determine `block` or `needs-revision`. That gives same-family reviewers negative gate authority, which is still authority.

The M14 construction should be:

1. Resolve BUILD family from `build_provider_recorded` or the same runtime source used by existing REVIEW invocation checks.

2. Resolve each panelist family through the runtime registry at invocation and record it in the panelist block.

3. Mark `eligibleForQuorum = role === 'voter' && reviewerFamily !== buildFamily`.

4. Canonical block and fix-first checks consider eligible cross-family voter findings only.

5. Same-family advisory findings are included in `Synthesis.advisoryFindings` and disagreement metrics, but they do not count for ready and do not veto ready.

6. Ready requires exactly two eligible cross-family voter panelists in v1, both with score >= 6, verdict `ready`, and no unresolved eligible voter `block` or `fix-first` finding.

This construction survives the important panel compositions:

| Panel composition | Expected result |
| --- | --- |
| 1 same-family voter + 1 cross-family voter | Rejected at config-load; if it reaches runtime, same-family voter filtered out and quorum fails |
| 1 same-family advisory + 1 cross-family voter | Quorum fails because only one eligible cross-family voter exists |
| 1 same-family advisory + 2 cross-family voters, both ready | Ready only if both eligible voters are ready and have no unresolved actionable findings |
| 1 same-family advisory with block + 2 cross-family voters ready | Ready may pass; advisory block is recorded but cannot veto without cross-family voter corroboration |
| 2 cross-family voters, one ready and one needs-revision | Needs-revision because eligible voter quorum is not unanimous-ready |
| 2 cross-family voters, both ready, one has unresolved fix-first | Needs-revision because eligible voter actionable finding gates ready |
| 2 same-family voters + no cross-family voters | Rejected at config-load; runtime quorum fails if malformed config slips through |
| 0 voters, advisory-only panel | Rejected at config-load; runtime quorum fails |

Same-family voters can still slip through if enforcement relies on only one layer. Edge cases include config-load using pure `familyOf()` while runtime `ProviderRegistry.familyOf()` has an override, a future gateway provider with unresolved lineage, a malformed `REVIEW.md` claiming quorum counts that do not match `Reviewers`, or test code inventing provider IDs outside `PROVIDER_IDS`. Defense-in-depth should therefore be config-load rejection, invocation-time family resolution, artifact-parse recomputation, quorum-time filtering, and event validator consistency checks.

Config-load plus quorum-time is necessary, but not sufficient by itself. The extra layers are cheap relative to the risk: parser recomputation protects artifact integrity, event validation protects replay integrity, and runtime family resolution protects future adapter families. The important discipline is that same-family evidence can inform humans but cannot satisfy or veto the orchestrator's gate.

## Rule-21 measurement adequacy

No. The three metrics in section 4.7 do not yet satisfy "measurable risk reduction in `events.jsonl` against the simpler baseline."

The core problem is data availability. Current review events include `findingsRaised`, `findingsResolved`, score, verdict, and artifact hashes, but not finding fingerprints or source reviewer IDs. A later summarizer cannot compute `unique_findings_delta(panel, single)` from events alone unless the doctor command emits an event that records those metric outputs, or M14 expands review events to include stable finding fingerprints.

There is also a false-confidence problem. `cross_family_disagreement_count >= 1` proves disagreement, not improvement. `same_family_vote_rejection_count >= 1` proves a guard, not risk reduction. Both are useful, but neither demonstrates that the panel caught something the simpler baseline missed.

The ship gate should require:

1. `panelOnlyActionableFindingCount > 0` on the same fixture, where actionable means an eligible cross-family voter raised a finding that would affect remediation or release confidence.

2. `sameFamilyVoteRejectionCount >= 1` on a deliberate positive-control fixture that attempts to configure a same-family voter.

3. `disagreementCount >= 1` only as supporting evidence, not as the core risk-reduction proof.

4. Artifact hashes for the single and panel runs, so the metric event can be traced back to exact `REVIEW.md` content.

5. Manifest equality or a recorded reason for any manifest difference, so the measurement is provider-comparison evidence rather than context-difference evidence.

Cost and latency overhead should be shown in the report but should not be the v1 ship gate. They matter for product truth, but rule 21 is about risk-reduction effect. The best M14 measurement is narrow and deterministic: same FakeProvider fixture, same artifacts, scripted single-reviewer miss, scripted panel-only actionable finding, same-family voter rejection, and metric output stored in or derivable from `events.jsonl`.

## Commit sequence rule-20 audit

1. `docs(contracts/review-panel): panel grammar + quorum semantics + same-family advisory rule`

   Yes, single-axis if it is contract-only. Add exact event metric contracts here so rule 21 is not invented later in code. This commit should define the canonical panel verdict rule, the staging-vs-canonical artifact rule, and the baseline metric event payload.

2. `feat(config/company): panel config schema + loader validation + same-family-vote rejection`

   Yes, but the path is wrong. This should target `src/config/schema.ts`, `src/config/load.ts`, and loader integration, not `src/config/company.ts`. Keep it to schema, validation, and error messages only. Do not invoke providers or write artifacts here.

3. `feat(artifacts/review-report): multi-reviewer schema + per-reviewer Reviewer blocks + Synthesis block`

   Yes, if it is parser/serializer/schema only. It may include parse-time recomputation that rejects contradictory quorum claims, but should not invoke providers or write gates. Back-compat for the singular `Reviewer:` shape is the right call.

4. `feat(state/events): review_panel_started + review_panel_completed + review_panel_disagreement + panel_quorum_rejected_same_family_vote events`

   Yes, event taxonomy is one slice, but the list should change. Include `review_panel_started`, `review_panelist_completed`, `review_panel_completed`, `review_panel_disagreement`, `panel_quorum_rejected_same_family_vote`, and `review_panel_baseline_completed` if rule-21 metrics are event-owned. Do not include `panel_cost_warn`.

5. `feat(phases/review-panel): panel orchestrator + sequential reviewer invocation + canonical verdict computation`

   Not clean as written. Split pure canonical verdict computation and tests from runtime orchestration, or at least make the pure helper the first part of the commit and easy to review. The runtime commit should only wire sequential invocation, staging, synthesis, and delegation from `runReview`.

6. `feat(providers/cost): per-panel preflight aggregate + per-reviewer budget attribution + panel-cost-warn event`

   Mostly yes, because budget integration is M14-essential. Change the event portion: aggregate preflight should use existing `assertWithinBudget` semantics or a new aggregate helper, and soft warnings should reuse `budget_warning`. No new `panel_cost_warn` event.

7. `feat(doctor): panel-baseline measurement command + events.jsonl summarizer`

   Yes, this is rule-21 ship-gate work, not polish. It should be implemented before the final e2e proof so the e2e can assert the exact metric output. The command should be wired through the existing `src/commands/doctor.ts` command structure.

8. `test(e2e/review-panel): full panel round on review-lite fixture + panel-vs-single risk-reduction proof`

   Yes, but the fixture description must be corrected. Do not create imaginary fake provider IDs; use deterministic scripted responses with real provider-family metadata and assert manifest equality. Include a same-family voter rejection fixture and a panel-only actionable finding fixture.

9. `docs(roadmap,thesis): mark M14 closed + record measurement deltas + update memory`

   Yes for closure docs after measured deltas exist. Remove "update memory" from the commit subject unless it refers to a repo-owned doc. Global/local assistant memory is not a product artifact and should not be part of a source commit.

Recommended reordering: commit 4 should include the baseline metric event before commit 7; commit 7 should precede commit 8; split commit 5 into canonical helper then orchestrator if the implementer wants a cleaner review trail. The sequence still respects rule 20 because all commits serve one authority boundary: panel quorum and orchestrator synthesis.

## Concrete file-path / code-path edits to Claude's draft

- Change §3.1 commit 2: `src/config/company.ts` to `src/config/schema.ts`, `src/config/load.ts`, and `src/agents/loader.ts` integration.

- Change §3.1 commit 4: add `review_panelist_completed` and `review_panel_baseline_completed`; remove any planned `panel_cost_warn` event from the event taxonomy.

- Change §3.1 commit 5: `panel orchestrator + sequential reviewer invocation + canonical verdict computation` to two steps: `computeCanonicalPanelVerdict` pure helper and tests, then sequential panel orchestrator and `runReview` delegation.

- Change §3.1 commit 6: replace `panel-cost-warn event` with `aggregate panel budget preflight + existing budget_warning reuse`.

- Change §4.1 step 1: "If any finding (from voter or advisory) is severity='block' AND unresolved" to "If any finding from an eligible cross-family voter is severity='block' AND unresolved."

- Change §4.1 step 2: "from voter or advisory" to "from eligible cross-family voters; advisory findings are visible in synthesis but carry no gate authority unless corroborated by an eligible voter."

- Change §4.1 step 3c: "at least 2 cross-family voters" to "exactly two eligible cross-family voters for M14 v1; no configurable quorum in v1."

- Change §4.2: keep `fingerprintFinding(file, title)` but add `review_panel_disagreement` with `kind` and source reviewer IDs when severities, verdicts, or finding presence differ by fingerprint.

- Change §4.3: state "sequential multi-provider panel" explicitly and avoid implying literal parallel execution.

- Change §4.5: replace "per-panelist atomic write to REVIEW.md" with "per-panelist atomic staging write plus `review_panelist_completed`; canonical REVIEW.md is written only after synthesis."

- Change §4.6: add `authorityImpact: 'voter' | 'advisory'` or equivalent on synthesized findings so same-family advisory severity is preserved without gate power.

- Change §4.7: add `review_panel_baseline_completed` metric fields and require `panelOnlyActionableFindingCount > 0`, not just disagreement count.

- Change §5 Q6 answer in synthesis: aggregate preflight should refuse the whole panel before any call; no partial panel value in M14.

- Change §5 Q7 answer in synthesis: same-family advisory may record real severity, but canonical verdict ignores it unless an eligible cross-family voter corroborates.

- Change §3.2 new files: `src/cli/doctor-panel-baseline.ts` should probably be `src/commands/doctor-panel-baseline.ts` and wired from `src/commands/doctor.ts`, matching the current command layout.

- Change §3.2 tests: add tests for parser recomputing quorum from serialized `Reviewers`, event validator rejecting impossible ready counts, panelist manifest equality, and routed/unknown-lineage provider rejection.

- Change §3.2 test fixture language: replace `claude-fake-reviewer-A` and `codex-fake-reviewer-B` with a deterministic invocation seam that preserves real `providerId` and `providerFamily` values.

- Change §4.7 ship gate: `unique_findings_delta > 0` to `panelOnlyActionableFindingCount > 0`, because raw finding count can reward duplicate or low-value findings.

- Change §4.7 ship gate: keep `same_family_vote_rejection_count >= 1` as a construction positive control, not as the risk-reduction metric itself.

- Change §4.1 output fields: add `eligibleVoterFamilies`, `excludedReviewerIds`, and `excludedReasons` to the quorum reason payload or synthesis model so audit does not depend on prose parsing.

- Change §2.6 layered enforcement: add "artifact-parse recomputation" and "event replay validation" as layers, or explicitly say they are implementation hardening required by this response.

## What I would have done differently if I were Claude

I would have included the construction proof as executable invariants instead of prose first. The brief should have specified the exact `computeCanonicalPanelVerdict(input)` shape, table-tested every panel composition, and shown which layer catches each same-family laundering attempt.

I also would have defined the rule-21 event payload before naming the doctor command. Without event fields or a baseline summary event, the measurement claim sounds locked but is not yet implementable from `events.jsonl`. The strongest M14 is narrow: exactly two cross-family voters, optional same-family advisory with no gate authority, sequential independent invocation, staged panelist outputs, one canonical synthesis, and a baseline doctor command that proves panel-only actionable findings against the single-reviewer fixture.

The final thing I would have corrected is the test plan. FakeProvider is excellent for deterministic orchestration, but it is currently one provider family, not a magic stand-in for Claude and Codex at the same time. A good M14 plan should say how deterministic tests preserve real provider-family data before Ralph starts coding.

---

## Summary

Verdict: `accept-with-modifications`. Most important pushbacks: same-family advisory must have no positive or negative gate authority; rule-21 metrics need a real event-derived baseline payload; M14 should use exactly two eligible cross-family voters with deterministic family-preserving tests. Claude should redraft §4.1, §4.7, and commit 5/6 before Ralph starts.
