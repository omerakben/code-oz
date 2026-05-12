---
session: M17 AUDIT runtime — R1 pre-design review
thread: 019e1dd3-0d23-7b33-b18f-ceb4d87d2350
model: gpt-5.5
reasoning-effort: xhigh
sandbox: workspace-write
verdict: accept-with-modifications
briefing-under-review: docs/research/CODEX_BRIEFING_M17_R1.md
parent-plan: docs/planning/1000_STAR_PLAN.md
prior-debate: docs/research/CODEX_RESPONSE_M17.md
---

# Codex response - M17 R1 pre-design review

## Verdict line

Verdict: accept-with-modifications. M17 implementation can begin from the R1 scope, but C6/C7 must lock the two details below before code lands: `preApproveAuditHook` needs an explicit event/sha source if it claims to mirror REVIEW, and the PLAN handoff must use the run's recorded profile, not whatever `.code-oz/config.yaml` says at continuation time.

No R2 design round is required if those changes are folded into the implementation plan.

## Per-closure verification

1. Closed - AUDIT-to-PLAN handoff slice.

R0 required approved AUDIT.md as PLAN input, Lead prompt update, SOURCE_CHECK source-id grammar update, parser updates, and tests (`docs/research/CODEX_RESPONSE_M17.md:73`). R1 adds exactly that narrow C7 slice: brownfield `runPlan` consumes AUDIT.md, Lead gets a brownfield mode, SOURCE_CHECK accepts `SC-AUDIT`, and the source section heading becomes profile-aware (`docs/research/CODEX_BRIEFING_M17_R1.md:35-44`, `docs/research/CODEX_BRIEFING_M17_R1.md:176`).

The source check against current code confirms this slice is necessary: `runPlan` currently refuses to run without SPEC.md (`src/phases/plan.ts:403-423`), Lead is SPEC-only (`src/agents/defaults/lead.md:31`), and SOURCE_CHECK has no AUDIT kind (`src/artifacts/source-check.ts:54-56`). This is still one rule-20 authority because the PLAN changes are compatibility reads and citation vocabulary for AUDIT output, not new PLAN, BUILD, VERIFY, or REVIEW behavior. Rule 20 allows one capability domain per milestone (`CLAUDE.md:48`); rule 22 requires the brownfield consumer path to be real (`CLAUDE.md:50`).

Modification: remove the R1 line that leaves "or include both" as an option for SOURCE_CHECK headings (`docs/research/CODEX_BRIEFING_M17_R1.md:40`). Q14 should be the lock: brownfield uses `## Audit sources`; greenfield uses `## Spec sources`.

2. Closed - C1 anti-stub strictness.

R0 required two spawned-CLI RED checks and explicit weaker-substitute bans (`docs/research/CODEX_RESPONSE_M17.md:75`). R1 now names both failure surfaces and requires event-log assertions, not state-shape assertions: fresh-run brownfield must not invoke BA/DEFINE, and active-run `currentPhase: audit` must not hit the generic fallback (`docs/research/CODEX_BRIEFING_M17_R1.md:48-53`).

Current code confirms both gaps exist: fresh run records `config.profile` but still calls `runDefine` (`src/commands/run.ts:318-366`), while active-run dispatch handles plan/build/verify/review and then falls through for audit (`src/commands/run.ts:951-1150`). The forbidden-import list is enough if the test also forbids manual `AUDIT.md` writes and synthetic event-log construction except for fixture setup that cannot be reached through public CLI before C2.

3. Closed - Auditor persona contract bullets.

R0 required removing the prompt-like body sketch (`docs/research/CODEX_RESPONSE_M17.md:77`). R1 replaces it with contract bullets for reads, writes, refusals, citations, and composition-time universal-rules injection (`docs/research/CODEX_BRIEFING_M17_R1.md:57-65`). These are contractual requirements, not persona body prose. Keep the final persona body out of design briefings and hand-author it in C4 per rule 16 (`CLAUDE.md:41-44`).

4. Closed - Auditor frontmatter.

R1's YAML uses `type: agent`, `phase: audit`, a valid provider/modelPolicy pair, required `permissions.read/write/bash`, and a locked `permissions.tool_use.repo_context` shape (`docs/research/CODEX_BRIEFING_M17_R1.md:69-103`). That matches current schema: `AGENT_TYPES` excludes `persona` (`src/agents/schema.ts:6`), `AgentPermissions` requires `read`, `write`, `bash`, and optional `tool_use` (`src/agents/schema.ts:239-243`), and the repo_context validator expects `tools`, `roots`, caps, and `network: 'none'` (`src/agents/schema.ts:816-924`).

The proposed frontmatter also matches the canonical Lead shape (`src/agents/defaults/lead.md:1-26`). No `symbol`, no boolean repo_context fields, no top-level `execute`, no misplaced `network`, and no `tool_use.debate` drift.

5. Closed - composition-time rule-16 enforcement.

R0 said the rule-16 test must target composition, not raw persona files (`docs/research/CODEX_RESPONSE_M17.md:81`). R1 adds `audit-system.md`, `composeAuditPrompt`, and a prompt-composition test proving universal rules appear before the Auditor persona body (`docs/research/CODEX_BRIEFING_M17_R1.md:105-127`). This is the right layer: current prompt code loads universal rules through `loadUniversalRules` (`src/prompts/index.ts:46-53`) and injects them in existing composers such as PLAN (`src/prompts/index.ts:275-290`) and BUILD (`src/prompts/index.ts:316-350`).

6. Closed - `docs/contracts/AUDIT.md` before parser/schema.

R0 required the contract file before `audit-schema.ts` and parser work (`docs/research/CODEX_RESPONSE_M17.md:83`). R1 splits C5 into C5a for `docs/contracts/AUDIT.md` and C5b for parser/schema code (`docs/research/CODEX_BRIEFING_M17_R1.md:129-140`, `docs/research/CODEX_BRIEFING_M17_R1.md:173-175`). That ordering is correct.

7. Partial - `preApproveAuditHook`.

R0 required approve-time AUDIT validation or a clear reason AUDIT would be the exception (`docs/research/CODEX_RESPONSE_M17.md:85`). R1 adds `preApproveAuditHook` with schema validation, canonical path loading, sha verification language, and Scientist sidecar validation (`docs/research/CODEX_BRIEFING_M17_R1.md:141-151`). Schema and sidecar validation close the main gap.

The partial part is the sha source. Existing REVIEW approval validates the on-disk REVIEW.md against a terminal `review_resolved` or panel event sha (`src/commands/approve.ts:694-758`). BUILD approval similarly validates BUILD_REPORT.md against `build_completed.buildReportSha256` and the prompt snapshot sha (`src/commands/approve.ts:474-529`). By contrast, the generic gate writer only computes or verifies the sha of the current on-disk artifact at gate-write time (`src/state/gates.ts:101-118`). That is useful, but it does not prove the artifact matches what AUDIT emitted.

Modification: C6 must choose one explicit contract. Preferred: add an `audit_completed` event carrying `auditReportSha256`, then have `preApproveAuditHook` validate AUDIT.md against that event plus `validateAuditMarkdown` plus Scientist sidecars. Acceptable fallback: state that AUDIT follows DEFINE-like user-editable semantics, remove the "mirrors preApproveReviewHook sha-verify" claim, and rely on schema/sidecar validation plus gate-writer sha binding. Do not leave the current ambiguous wording.

8. Closed - selected-path promotion defer.

R0 required aligning AUDIT docs, implementation, and events around repo_context promotion semantics (`docs/research/CODEX_RESPONSE_M17.md:87`). R1 explicitly defers selected-path promotion to M18+, records `selectedPaths: []`, and limits first-cut AUDIT to tool-result text from the same phase loop (`docs/research/CODEX_BRIEFING_M17_R1.md:153-163`). That is honest under rule 18 because REPO_CONTEXT already says selected paths enter the next `ProviderRequest.files`, never hidden context (`CLAUDE.md:46`; `docs/contracts/REPO_CONTEXT.md:7`, `docs/contracts/REPO_CONTEXT.md:83-90`), and current runner emits `selectedPaths: []` (`src/tools/repo-context/runner.ts:142-154`).

Wording modification only: avoid saying "single invocation" if the implementation uses provider tool-call continuations. Call it "single AUDIT phase loop with no selected-path promotion."

## Q11-Q17 answers

Q11 - Handoff slice size: yes, the four C7 sub-changes are the minimum for a non-dead-end brownfield path. None is its own authority if it remains profile-bound and only changes AUDIT consumption by PLAN.

Q12 - Lead dual-mode: use an inline brownfield section in `lead.md`, selected by profile. A forked `lead-brownfield.md` creates persona drift and duplicates the same task-planning authority. Add tests that greenfield still attaches SPEC.md and brownfield attaches AUDIT.md.

Q13 - SC-AUDIT grammar: use simple `SC-AUDIT-NNN`. Richer forms like `SC-AUDIT-LOC-NNN` create parser and coverage complexity before there is evidence that the extra taxonomy reduces defects.

Q14 - SOURCE_CHECK heading: brownfield replaces `## Spec sources` with `## Audit sources`. Do not allow both as optional in the same profile. The validator should receive profile context and enforce the matching heading.

Q15 - selected-path promotion defer: acceptable. First-cut AUDIT can produce useful bug localization from repo_context tool results, and promotion affects all phases that use repo_context. Deferring it preserves rule 20 as long as events honestly keep `selectedPaths: []`.

Q16 - live brownfield smoke: run one live code-oz historical-bug smoke before tagging if provider credentials and cost budget are available. It should not block implementation kickoff, but if it is skipped before tag, the closure note must say exactly why. If it runs and fails, do not tag until the failure is triaged.

Q17 - rule 20 boundary: acceptable as expanded: "AUDIT runtime + dispatch + persona + minimum PLAN consumption slice." Shipping AUDIT as a dead-end would violate rule 22 more than this narrow handoff risks rule 20.

## New findings R1 introduced

1. Medium - C6's sha contract is underspecified. R1 says `preApproveAuditHook` mirrors review-style sha verification, but it does not define the AUDIT terminal event or event field that supplies the expected sha (`docs/research/CODEX_BRIEFING_M17_R1.md:143-151`). Add `audit_completed.auditReportSha256` or downgrade the claim to DEFINE-like editable artifact validation.

2. Medium - C7 must bind to run-state profile, not mutable current config. The run state already records `profile` (`src/state/schemas.ts:1615-1620`), and approve uses `loaded.state.profile` for gate transitions (`src/commands/approve.ts:314-319`). Today `dispatchPlan` passes only the run id and config into `runPlan` (`src/commands/run.ts:1192-1204`), and `RunPlanOptions` has no explicit profile field (`src/phases/plan.ts:76-90`). Add `profile` to `RunPlanOptions` or derive it from the loaded run state before choosing SPEC vs AUDIT.

3. Low - SOURCE_CHECK heading ambiguity should be collapsed before C7 starts. R1 line 40 leaves an optional dual-heading path, while Q14 recommends replacement (`docs/research/CODEX_BRIEFING_M17_R1.md:40`, `docs/research/CODEX_BRIEFING_M17_R1.md:208`). Take Q14.

Risk register additions:

- Audit artifact provenance drift: if AUDIT.md is edited after AUDIT emits it, C6 must either detect drift with an `audit_completed` sha or deliberately allow edits and document that gate approval binds the edited version.
- Profile drift: changing `.code-oz/config.yaml` between AUDIT approval and PLAN must not make a brownfield run look greenfield. Use event-derived run state.
- Source-check profile split: parser/serializer tests need both greenfield SPEC and brownfield AUDIT fixtures so the C7 grammar change does not weaken existing 3-source verification.

## Hour estimate sanity check

The 10-commit sequence is the right shape (`docs/research/CODEX_BRIEFING_M17_R1.md:165-180`). The 28h estimate is optimistic. With the C6 event/sha decision, profile-plumbing tests, and the pre-tag smoke, I would budget 30-34h of implementation and local review time. If `audit_completed` event schema and tests are added cleanly inside C6, the commit count can stay at 10.

## Top-3 remaining concerns

1. `preApproveAuditHook` must not claim review-style sha verification without a review-style expected-sha event.
2. PLAN handoff must use the run's recorded profile, not live config, or resume can drift.
3. C7 must keep SOURCE_CHECK profile-aware without weakening greenfield SOURCE_CHECK validation.

## Probability

P(M17 ships on schedule with R1 scope, no rule violations, no tag-time tech debt): 60%.

With the modifications above applied during C1/C6/C7 and a pre-tag live smoke attempted, I would raise that to 65%. Without them, especially without the C6 sha-contract clarification, it drops back to 50-55%.
