# Briefing — M14 Reviewer panel v1 — implementation review (R1)

**Brief date:** 2026-05-03
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule (implementation completion)
**Branch under review:** `feat/m14-reviewer-panel` at HEAD `29cdd7b`

## What you're reviewing

11 commits delivered overnight via Ralph loop on `feat/m14-reviewer-panel`. M14 is the first simultaneous-provider surface in `code-oz`. Authority boundary: panel quorum + cross-family enforcement + orchestrator-owned synthesis.

```
29cdd7b docs(roadmap,thesis): mark M14 closed + wire doctor --panel-baseline CLI
569afb4 test(e2e/review-panel): full panel round + rule-21 ship gate proof
67ff66a feat(commands/doctor-panel-baseline): rule-21 ship-gate metric command
921db06 feat(providers/cost): aggregate panel preflight + reuse M13 budget_warning
39b614b feat(phases/review-panel): sequential orchestrator + staging writes + manifest equality
e1a1c3e feat(phases/review-panel-verdict): pure computeCanonicalPanelVerdict + T1-T9
0e859b1 feat(state/events): panel event taxonomy + layer-5 quorum backstop
53ff03f feat(artifacts/review-report): multi-reviewer schema + Synthesis block + parse-time quorum recomputation
1c3e3ff feat(config): reviewer.panel schema + 2-layer same-family-voter rejection
5d97983 docs(contracts/review-panel): grammar + quorum + advisory rule + canonical verdict + staging artifact + baseline metric event
0da4e78 docs(m14): planning briefing + Codex response + locked kickoff + Ralph prompt
```

## Required reading

1. `docs/research/CODEX_BRIEFING_M14.md` — original planning brief (your prior context)
2. `docs/research/CODEX_RESPONSE_M14.md` — your R0 verdict (`accept-with-modifications`, thread `019deb75`); 4 substantive pushbacks recorded
3. `docs/design/SESSION_M14_KICKOFF.md` — locked plan synthesizing R0 pushbacks
4. `docs/contracts/REVIEW_PANEL.md` — the contract surface (commit 1)

Sample (don't deep-read) the implementation files mentioned in each commit message. Specifically, the load-bearing paths:
- `src/phases/review-panel-verdict.ts` — pure canonical verdict; T1-T9 in `tests/review-panel-canonical-verdict.test.ts`
- `src/phases/review-panel.ts` — runtime orchestrator (sequential + staging + synthesis)
- `src/artifacts/review-report.ts` — multi-reviewer schema + parse-time quorum recompute
- `src/config/load.ts` `mergeReviewerPanel` + `src/agents/loader.ts` `enforceReviewerPanelCrossFamily`
- `src/state/events.ts` `review_panel_completed` validator (layer-5 backstop)
- `src/commands/doctor-panel-baseline.ts` + `src/commands/doctor.ts` CLI wiring
- `tests/fixtures/review-panel-baseline/baseline.json` + `tests/e2e/review-panel-baseline.test.ts`

## Verdict format

Return one of: `push` | `fix-first` | `debate-required`. Format your response as `docs/research/CODEX_REVIEW_M14.md` (mirror M11/M12/M13 review files).

## What you must verify (R0 pushback closure)

For each of your 4 R0 pushbacks, verify the implementation honors it:

### R0-Q1 (authority-laundering construction)

- Is the 5-layer defense-in-depth fully wired? Layers per `REVIEW_PANEL.md` § "Five-layer defense-in-depth":
  1. Config-load (`src/config/load.ts`): rejects same-family voters at YAML parse
  2. Agent loader (`src/agents/loader.ts` `enforceReviewerPanelCrossFamily`): authoritative re-check vs resolved BUILD agent
  3. Artifact-parse recomputation (`src/artifacts/review-report.ts` `parseReviewPanelReport` + `recomputePanelVerdictFromArtifact`)
  4. Quorum-time filtering (`src/phases/review-panel-verdict.ts` `computeCanonicalPanelVerdict`)
  5. Event-validator backstop (`src/state/events.ts` `review_panel_completed` ready-with-eligibleVoterFamilies-count check)

- Can a same-family voter slip through any layer? Walk a same-family voter attempt through all 5 and confirm it's caught.

### R0-Q7 (same-family advisory has NO gate authority)

- `computeCanonicalPanelVerdict` step 3 (block check) and step 4 (fix-first check) — do they filter to `authorityImpact === 'voter'` only?
- T9 (advisory ratification) — does the test verify advisory severity ESCALATES to voter-impact only when a cross-family voter raises the same fingerprint?
- Is severity recorded faithfully on advisory findings (not coerced to nit/fyi)?

### R0-Q2 (quorum exactly 2 cross-family voters; no knob)

- Does the loader reject panels with !==2 voters?
- Is there any `quorum` config knob smuggled in? (Should be NONE.)
- Is the canonical verdict computation hard-coded to exactly 2 eligible voters?

### R0-Q9 (stage per-panelist drafts; canonical only after synthesis)

- Does the orchestrator write to `state/runs/<runId>/review-panel/round-<N>/panelist-<id>.md` first?
- Does canonical `REVIEW.md` get written ONLY after synthesis completes?
- Test for partial-but-authoritative artifact: can a process die between staging and synthesis and leave a malformed canonical REVIEW.md?

### R0-Q8 (rule-21 ship gate via review_panel_baseline_completed)

- Does the metric event payload match the schema in commit 4?
- Does the doctor command emit `panelOnlyActionableFindingCount > 0` on the canonical fixture?
- Is the ship gate enforced (e.g., `bun run dev doctor --panel-baseline` exits 1 on FAIL)?
- Are all 4 thresholds in the rule? Look at the e2e test in commit 9.

## Anti-patterns to flag if you find them

These would be R0 pushback violations:

1. New `panel_cost_warn` event vocabulary (R0 forbade; reuse M13 `budget_warning`)
2. Synthesizer-as-persona (R0 forbade; mechanical orchestrator-only synthesis)
3. Configurable quorum (k-of-N) — must be fixed 2 in v1
4. Same-family advisory able to force `block` or `needs-revision` without cross-family corroboration
5. Imaginary ProviderId values (e.g., `claude-fake-reviewer-A`) — must use real PROVIDER_IDS
6. Advisory severity coerced to nit/fyi — recorded value must preserve what panelist said
7. Sequential vs parallel — must be sequential in v1
8. Panel as default mode — must be opt-in (single-reviewer remains default)
9. Bundling multiple authority surfaces in one commit (rule 20)
10. "update memory" in commit subject (closure commit must not include this)

## Rule-20 audit (commit-by-commit single-axis check)

Walk each of the 10 implementation commits:
1. Does it serve exactly one slice of the M14 authority boundary?
2. Did anything from a future milestone leak in?
3. Is the test count delta proportional to the slice (not zero, not enormous)?

Flag any commit that bundles or sneaks in an unrelated change.

## What I want you to find (test the briefing's negative space)

- Did Claude take any shortcut in commit 6 (orchestrator) that weakens the staging discipline?
- Are there error paths in `runReviewPanel` that should be `intervention` but aren't (e.g., partial write failure)?
- Is the manifest equality check sound — does it actually catch a drifted manifest, or could a buggy invoker pass identical mock hashes while seeing different files?
- Does `computeCanonicalPanelVerdict` align with the parser-side `recomputePanelVerdictFromArtifact` on every panel composition (T1-T9 + edge cases)?
- Does `loadAndRunPanelBaseline` validate fixture shape sufficiently to reject malformed inputs without misleading error messages?
- Are there any places where `familyOf()` is called but `registry.familyOf()` should be (runtime-overrides honored)?

## Test surface verification

- Total tests at HEAD: 2400 pass / 1 skip / 0 fail (claimed)
- Typecheck clean
- `bun run dev doctor --panel-baseline tests/fixtures/review-panel-baseline/baseline.json` → all 4 ship-gate thresholds PASS

If you can't independently verify (read-only sandbox), trust + flag any test that you suspect doesn't actually test what it claims.

## Operating rules

1. **Be specific.** Vague verdicts ("looks fine") rejected. Each finding should be a concrete file path + line range + severity.
2. **Severity classes:**
   - `block-push` — stops the milestone tag; must be addressed before push
   - `fix-soon` — should be addressed in the same milestone but not blocking-push
   - `fix-next-milestone` — defer; acceptable if no tech debt
   - `nit` — trivia; safe to defer
   - `fyi` — informational
3. **Verdict mapping:**
   - `push` — no block-push or fix-soon findings (or all addressed); ready to tag
   - `fix-first` — has block-push or fix-soon findings; address then re-review
   - `debate-required` — fundamental issue; needs another planning round
4. **Token economy.** Aim for 5-8k response. Quality > volume.
5. **Write the response file directly via the Write tool? NO — sandbox is read-only.** Print the response inline; Claude will write it to `docs/research/CODEX_REVIEW_M14.md`.

Begin.
