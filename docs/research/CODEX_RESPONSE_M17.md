---
session: M17 AUDIT runtime — R0 pre-design review
thread: 019e1dd3-0d23-7b33-b18f-ceb4d87d2350
model: gpt-5.5
reasoning-effort: xhigh
sandbox: read-only
verdict: revise
briefing-under-review: docs/research/CODEX_BRIEFING_M17.md
parent-plan: docs/planning/1000_STAR_PLAN.md
prior-debate: docs/planning/CODEX_RESPONSE_1000_STAR_R0_REVISION_3_CLEANUP_2.md
---

# Codex response - M17 R0 pre-design review

## Verdict line

Verdict: revise. The AUDIT runtime gap is real, but the briefing overclaims that AUDIT can hand off to the existing PLAN runtime and misstates the locked agent-permission, repo_context, and rule-16 prompt-composition contracts.

## Per-question responses

Q1 - Anti-stub strictness: mostly right, not strict enough. C1 must explicitly forbid direct imports of `dispatchAudit`, `runAudit`, `initRun`, `emitGateRequired`, `approveGate`, `runApprove`, mocked reducers, synthetic events, and hand-written `AUDIT.md`. It must spawn the CLI path and assert no BA/DEFINE invocation occurs for a brownfield first run.

Q2 - Fresh-run dispatch: keep fresh-run and active-run dispatch in C2, but name both. `src/commands/run.ts:318-321` initializes with `config.profile`, then `run.ts:354-366` still calls `runDefine`; the active-run dispatcher also lacks `audit` at `run.ts:951-1150`. C1 should cover both failure surfaces.

Q3 - AUDIT.md schema: 1+ Localization/Reproduction/Constraints is the right floor, but too loose alone. Add `docs/contracts/AUDIT.md`, require file-line citations, distinguish observed reproduction from operator-proposed reproduction, reject fix proposals, and require canonical frontmatter. For M17, require a concrete problem statement; open-ended “audit this codebase” is a later product mode.

Q4 - Execute permission: accept no execute for first cut. With `execute: false`, reproduction is not “verified by AUDIT”; it is a command plan for the operator. The schema must say that plainly and route unverified runtime facts to OPEN_QUESTIONS.

Q5 - Cross-family AUDIT review: no new cross-family AUDIT pass in M17. REVIEW already enforces cross-family after BUILD. Adding parallel AUDIT would violate rule 20 unless future event data proves it reduces escaped defects.

Q6 - Scientist tail: reuse the existing Scientist phase-tail. Do not invent an AUDIT-specific embedded tail parser. Per `docs/contracts/SCIENTIST.md`, the primary artifact is written first, then `runScientistPhaseTail`, then `validateScientistSidecars`, then `requireGate`.

Q7 - Brownfield fixture: use a real temp repo with `git init`, an untracked source file, `.code-oz/config.yaml` or init output proving `profile: brownfield`, spawned `bun src/cli.ts run`, fake-scripted Auditor/Scientist/Lead turns, and no prewritten AUDIT.md.

Q8 - R1 provenance attestation: process-only, acceptable only if framed honestly. Add an R1 checklist item that fails review if missing. Do not claim CI proves human authorship. Also, the current project injects universal rules at prompt composition time, so the automated test should target `composeAuditPrompt`, not “auditor.md begins with universal-rules.”

Q9 - Persona ownership of manifests: the briefing’s “prefer single invocation” conflicts with `docs/contracts/REPO_CONTEXT.md`. Selected paths enter the next `ProviderRequest.files`, not hidden current context. M17 must either implement selected-path promotion for AUDIT or honestly log `selectedPaths: []` and treat tool-result text as the only returned context.

Q10 - Open question routing: blocking is right, but use the existing `OPEN_QUESTIONS.md` schema: `status=open` plus `Importance: blocking`, or overdue `DueBy`. The briefing’s `blocks: yes` shape does not match current parser semantics.

Codex pre-design ask 1 - Rule 20: not as written. AUDIT runtime + schema + persona + dispatch is one domain, but the required AUDIT-to-PLAN handoff touches PLAN, SOURCE_CHECK, Lead prompt, and parser grammar. Either include that as a narrow M17 compatibility sub-surface or M17 does not actually ship a working brownfield path.

Codex pre-design ask 2 - Rule 22: C1 is directionally correct. Add the weaker-substitute bans above and assert the spawned CLI event log, not just state shape.

Codex pre-design ask 3 - Rule 16: inadequate as phrased. Existing prompts import `src/prompts/universal-rules.md` via `src/prompts/index.ts`, not by embedding the rules at the top of each persona file. Add `audit-system.md`, `composeAuditPrompt`, and tests proving universal rules precede the Auditor body.

Codex pre-design ask 4 - AUDIT.md schema: floor is acceptable after the additions in Q3. Without a real contract file and approve-time validation, it is not enough.

Codex pre-design ask 5 - Permissions: repo_context-only is right, but the proposed YAML shape is invalid. Current schema requires `type: agent`, `permissions.read`, `permissions.write`, `bash: deny`, and `tool_use.repo_context.tools/roots/caps/network`. Do not declare `symbol`; it is reserved.

Codex pre-design ask 6 - AUDIT vs PLAN handoff: insufficient. Current `runPlan` refuses to run without `SPEC.md` (`src/phases/plan.ts:403-423`), Lead is SPEC-only, and SOURCE_CHECK ids only allow `SC-SPEC|SC-REF|SC-DOC`. Brownfield PLAN needs an explicit AUDIT input mode and source-id grammar.

Codex pre-design ask 7 - Risk register: missing the PLAN dead-end, invalid persona schema, rule-16 test-at-wrong-layer, repo_context manifest ambiguity, and approve-time AUDIT validation gap.

Codex pre-design ask 8 - Q1-Q10: answered above; no debate is required unless the owner rejects adding the AUDIT-to-PLAN compatibility slice to M17.

## New findings the briefing missed

1. PLAN cannot consume AUDIT today. `runPlan` requires `SPEC.md`; `lead.md` says it translates SPEC.md; SOURCE_CHECK grammar has no AUDIT source id. The proposed `audit -> approve -> PLAN` e2e cannot go green honestly without changing that handoff.

2. The proposed Auditor frontmatter is not loadable. `type: persona` is not in `AGENT_TYPES`; boolean `repo_context.glob/read` is not the locked schema; `symbol` is reserved; top-level `write: false` / `execute: false` is not the existing permissions model.

3. Rule-16 guardrails target the wrong layer. Existing defaults do not begin with universal-rules text; prompt composers inject it. Auditor should follow that pattern unless M17 intentionally migrates all personas, which would be out of scope.

4. `docs/contracts/AUDIT.md` does not exist, but the briefing cites it as the schema target. C5 needs a contract file before parser/schema work.

5. `approve.ts` has pre-approval validation for define/build/verify/review, not audit. Generic `approveGate()` accepting `audit` is necessary but not sufficient after AUDIT.md becomes user-editable before approval.

6. `runRepoContextTool` currently emits `selectedPaths: []`; selected-path promotion into the next manifest is not implemented in the visible PLAN loop. AUDIT cannot claim file-manifest ownership without either implementing or explicitly deferring that behavior.

## Changes required before R0 convergence

1. Add an explicit brownfield PLAN handoff design: approved AUDIT.md as PLAN input, Lead prompt update, `SOURCE_CHECK.md` source-id grammar update, parser updates, and tests.

2. Rewrite C1 as two spawned-CLI RED checks: first-run brownfield must not route to DEFINE; active-run `currentPhase=audit` must not fall through to the generic active-run message.

3. Replace the Auditor persona sketch with contract bullets only, or mark it non-authoritative and remove prompt-like generated body text before implementation.

4. Correct the Auditor frontmatter to the current agent schema and locked repo_context shape.

5. Add `audit-system.md` + `composeAuditPrompt` + prompt tests proving universal-rules injection before Auditor-specific rules.

6. Add `docs/contracts/AUDIT.md` before `src/artifacts/audit-schema.ts` / parser work.

7. Add audit approve-time validation, or explicitly document why AUDIT is the only schema-validated artifact without a `preApprove*Hook`.

8. Clarify repo_context path-promotion semantics for AUDIT and align implementation, docs, and events.

## Top-3 risks the briefing under-weighted

1. Brownfield path dead-ends after AUDIT approval because PLAN is still SPEC-only.

2. Rule-16 leakage or false confidence from testing raw persona files instead of composed prompts.

3. Permission/manifest drift: invalid Auditor YAML or unaudited file bytes would undermine rule 18 and rule 13 at the first AUDIT runtime.

## Probability-adjusted estimate

P(M17 ships on the current 24h scope, with no rule violations and no tag-time tech debt): 25-35%.

If the revisions above are made before kickoff and the estimate is expanded to include the AUDIT-to-PLAN compatibility work, I would raise that to 50-60%.
