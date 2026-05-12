# Briefing — M17 AUDIT runtime (R1 pre-design round)

**Brief date:** 2026-05-12
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Prior round:** R0 returned `revise` (thread `019e1dd3`) with 6 substantive findings; see `docs/research/CODEX_RESPONSE_M17.md`
**Branch base:** `main` at `b8a3b4d` (Phase 1 of 1000-star plan fully closed; R0 briefing + verdict pushed to origin)

## Trigger and ground

R0 verdict was `revise` with this top-line: "The AUDIT runtime gap is real, but the briefing overclaims that AUDIT can hand off to the existing PLAN runtime and misstates the locked agent-permission, repo_context, and rule-16 prompt-composition contracts."

R0 enumerated 8 changes required before R1 can converge. This R1 briefing addresses each. The single biggest scope shift: an **AUDIT-to-PLAN compatibility slice** lands as part of M17, otherwise the proposed `audit → approve → PLAN` e2e dead-ends because `runPlan` requires SPEC.md and `lead.md` is SPEC-only.

## Verification of R0 findings against current source

R0's findings were code-grounded. Re-checked each against the repo at `main@b8a3b4d`:

| R0 finding | Verification |
|---|---|
| `AGENT_TYPES` is `['agent', 'skill', 'phase', 'gate', 'hook']` — no `persona` | Confirmed at `src/agents/schema.ts:6` |
| `composeDefinePrompt` / `composePlanPrompt` etc. inject universal-rules at composition time via `src/prompts/index.ts` | Confirmed at `src/prompts/index.ts:51-53` (`loadUniversalRules`) — every composer loads it. Persona files do NOT begin with the rules |
| `runPlan` refuses to run without SPEC.md | Confirmed at `src/phases/plan.ts:403-423` — explicit error rule `'PLAN cannot run without an approved SPEC.md'` |
| Lead persona is SPEC-only | Confirmed at `src/agents/defaults/lead.md:31` — "You are a senior tech lead. Your job is to read `SPEC.md` and produce..." |
| SOURCE_CHECK grammar has no AUDIT source id | Confirmed at `src/artifacts/source-check.ts:56` — `SOURCE_ID_PATTERN = /^SC-(SPEC\|REF\|REF-NONE\|DOC\|DOC-NONE)-\d{3,}$/` |
| `preApproveBuildHook`, `preApproveVerifyHook`, `preApproveReviewHook` exist; no `preApproveAuditHook` | Confirmed at `src/commands/approve.ts:240-267, 369, 440, 607` |
| `runRepoContextTool` emits `selectedPaths: []` today | Acknowledged — selected-path promotion is partial; M17 must align docs + behavior |

All findings stand. R1 closes them below.

## R0 finding closures

### R0 Finding 1 — PLAN dead-end without AUDIT-to-PLAN handoff (block-approve)

**Closure:** M17 ships a **narrow AUDIT-to-PLAN compatibility slice** as part of the single "AUDIT runtime + dispatch + persona + handoff" authority. Rule 20 is preserved because the slice is the minimal byte-count required to make AUDIT useful, not a PLAN rewrite. Specifically:

1. **`runPlan` accepts AUDIT.md as the input artifact when `profile === 'brownfield'`.** The existing SPEC.md gate becomes an OR: `runPlan` requires `SPEC.md` for greenfield, `AUDIT.md` for brownfield. The error message at `src/phases/plan.ts:413,422` becomes `'PLAN cannot run without an approved <SPEC|AUDIT>.md'` (selected by profile).
2. **Lead persona `src/agents/defaults/lead.md` gains a brownfield mode.** The hand-edited persona body adds a second short section: "When `phase: plan` is invoked with `profile: brownfield`, read `AUDIT.md` instead of `SPEC.md`. Treat the Localization, Reproduction, and Constraints sections as the authoritative scope. Source IDs follow the extended grammar (SC-AUDIT-NNN for AUDIT citations)." Universal-rules injection unchanged (still at composition time via `composePlanPrompt`).
3. **SOURCE_CHECK grammar extends to include `SC-AUDIT`.** `SOURCE_ID_PATTERN` becomes `/^SC-(SPEC|REF|REF-NONE|DOC|DOC-NONE|AUDIT)-\d{3,}$/`. Allowed-kind mapping at `src/artifacts/source-check.ts:597-605` (the `sourceIdKind` switch) gets an `AUDIT` arm.
4. **SOURCE_CHECK section: brownfield runs replace `## Spec sources` with `## Audit sources`** (or include both — only one is required per profile; the off-profile section is optional). The validator at `src/artifacts/source-check.ts:418` allows the alternative heading when `profile: brownfield` flows through to validation.

**This is the slice.** It does NOT touch BUILD/VERIFY/REVIEW. It does NOT add new gate authority (PLAN gate works the same). It's the minimal change to make `runPlan` consume AUDIT.md instead of SPEC.md for brownfield runs.

**Rule 20 boundary recheck:** M17's authority is now "AUDIT runtime + dispatch + persona + minimum PLAN consumption slice." Codex, push back if this still reads as two axes — the alternative is "AUDIT ships but is unusable until M18 adds the handoff," which violates rule 22 (consumer-first: the consumer is the brownfield CLI e2e that goes audit → approve → PLAN, which needs both).

### R0 Finding 2 — C1 anti-stub strictness (block-approve)

**Closure:** C1 is now **two RED checks** in a single CLI e2e test file:

1. **First-run brownfield must not route to DEFINE.** A fresh `code-oz run --request "<problem>"` in a brownfield fixture (`.git/` + untracked source + `.code-oz/config.yaml` with `profile: brownfield`) MUST emit `phase_entered(audit)` and MUST NOT emit `persona_invocation_started(ba)`. Asserts the fresh-run path at `src/commands/run.ts:309-368` routes via `dispatchAudit`, not via `runDefine`.
2. **Active-run `currentPhase=audit` must not fall through.** A run already at `currentPhase: 'audit'` (constructed via `code-oz run`, the test re-spawns the binary in active-run mode) MUST NOT hit the generic active-run "phase in progress" fallback at `src/commands/run.ts:1134`. It MUST emit a `dispatchAudit_started` event or successor.

Anti-stub forbidden imports in the test file: `dispatchAudit`, `runAudit`, `initRun`, `emitGateRequired`, `approveGate`, `runApprove`, `composeAuditPrompt`, and any phase-or-audit module. The test MUST `Bun.spawn` the CLI; state-level construction is not allowed. The test MUST inspect `events.jsonl` for the assertion (not state shape, not state.json), so the contract is event-shaped per rule 1.

### R0 Finding 3 — Auditor persona contract bullets, not body sketch (block-approve)

**Closure:** R1 briefing replaces the body sketch with contract bullets only. The actual `auditor.md` body is hand-authored at C4 time by Ozzy + Claude collaboratively, with provenance recorded in the M17 R1 packet (this round's review packet, not the implementation R1). The R1 briefing names the contract; the implementation lands the body.

**Auditor persona contract** (what `auditor.md` MUST do, no body text proposed):

- **Reads.** Brownfield repo + operator problem statement (provided via initial user input or `--request`). Searches via `repo_context` tools (glob, grep, read) per rule 18.
- **Writes.** Nothing directly. Persona returns text content; orchestrator persists `AUDIT.md` via the existing artifact-recording primitive (mirrors how `runDefine` persists SPEC.md).
- **Refuses.** Proposing fixes (those belong in PLAN), modifying files, fabricating file:line references.
- **Cites.** Every Localization entry includes a file:line range from a read the Auditor actually performed. Every Reproduction entry is derivable from in-repo evidence. Every Constraint references an actual contract, test, or invariant the Auditor read.
- **Imports universal-rules at composition time.** Composer is the new `composeAuditPrompt` in `src/prompts/index.ts`; system template lives at `src/prompts/audit-system.md`. The Auditor persona body itself does NOT embed universal-rules (consistent with DEFINE/PLAN/BUILD/VERIFY/REVIEW personas, which inject at composition time).

### R0 Finding 4 — Auditor frontmatter to match current AGENT_TYPES + locked repo_context shape (block-approve)

**Closure:** Updated frontmatter to match the existing locked schema (cross-checked against `src/agents/defaults/lead.md:1-26` as the canonical example):

```yaml
---
name: auditor
type: agent
phase: audit
provider: claude
modelPolicy: opus-default
permissions:
  read: '*'
  write: ['./docs/**', 'AUDIT.md']
  bash: deny
  tool_use:
    repo_context:
      tools: ['glob', 'grep', 'read']
      roots: ['.']
      maxResults: 50
      maxBytesPerResult: 16384
      maxFilesForNextManifest: 20
      timeoutMs: 5000
      network: 'none'
description: Audits a brownfield repository against an operator problem statement. Produces AUDIT.md with Localization (file:line citations), Reproduction (commands + observed-vs-expected), and Constraints (contracts the fix must honor). Does not propose fixes — that's PLAN's job. Reads source via repo_context tools (glob, grep, read), produces AUDIT.md per the locked schema in docs/contracts/AUDIT.md.
---
```

**Key fixes from R0:**

- `type: agent` (not `type: persona` — there is no `persona` AgentType per `src/agents/schema.ts:6`)
- `permissions.read: '*'`, `permissions.write: ['./docs/**', 'AUDIT.md']`, `permissions.bash: deny` (matches Lead/BA/etc. canonical shape)
- `permissions.tool_use.repo_context.tools` is a string array, not boolean fields (matches `src/agents/defaults/lead.md:13`)
- No `symbol` declaration (reserved per rule 18)
- No `network` outside `repo_context.network: 'none'` (consistent placement)
- No top-level `write: false` / `execute: false` invented fields
- No `tool_use.debate` for AUDIT (single-provider phase; cross-family REVIEW is the cross-family axis, not AUDIT)

### R0 Finding 5 — `audit-system.md` + `composeAuditPrompt` + composition-time universal-rules injection (block-approve)

**Closure:** C4 adds three modules:

1. **`src/prompts/audit-system.md`** — phase-system template (~3-5kb), parallel to `define-system.md` / `plan-system.md` / etc. Hand-authored. Contains the AUDIT phase-specific rule: "no fix proposals; localization MUST cite file:line; constraints MUST reference an observed contract; reproduction MUST distinguish observed (Auditor verified by reading) from operator-proposed (commands for the operator to run if execute is denied)."
2. **`composeAuditPrompt` exported from `src/prompts/index.ts`.** Composer signature mirrors `composePlanPrompt`:

   ```ts
   export interface ComposeAuditPromptInput {
     auditorPersonaBody: string         // src/agents/defaults/auditor.md (post-frontmatter)
     repoSummary: string                // Glob-result summary, ~1kb
     problemStatement: string           // Operator brief
     constraints?: string               // Optional retry-context
   }
   export async function composeAuditPrompt(input: ComposeAuditPromptInput): Promise<string>
   ```
3. **Prompt-composition test** in `tests/prompts-audit-compose.test.ts`: asserts the composed prompt contains universal-rules content (loaded via `loadUniversalRules`) BEFORE the Auditor persona body, AND that universal-rules content is verbatim (no edits, no relaxations). This is the rule-16 enforcement layer Codex pointed at — at COMPOSITION time, not in persona files.

**Rule-16 enforcement layers (now properly targeted, per R0):**

- **(a) `composeAuditPrompt` test:** universal-rules content appears before the persona body in the composed prompt; mechanical concat preserved. Failure blocks the commit. (Replaces the misplaced "persona body begins with universal-rules" check from R0 briefing.)
- **(b) M17 R1 review-packet persona-provenance attestation:** unchanged from R0 briefing — one-line attestation in `docs/handoffs/2026-05-M17-R1-PACKET.md` listing who authored what in `auditor.md` and `audit-system.md`. Process-only; no false claim that CI proves human authorship.
- **(c) CI grep guard** against LLM-drafted persona text leaking into committed `docs/research/CODEX_*`, `docs/research/CLAUDE_*`, `docs/planning/CODEX_*`, `docs/planning/CLAUDE_*` artifacts. Catches generation-pass leakage after the fixed persona exists; does NOT prevent original LLM authorship.

### R0 Finding 6 — `docs/contracts/AUDIT.md` contract file before parser/schema work (block-approve)

**Closure:** C5 is split: a new C5a lands `docs/contracts/AUDIT.md` BEFORE C5b adds the schema/parser code. Contract file structure mirrors existing phase contracts (SPEC.md, PLAN.md, BUILD.md, VERIFY.md, REVIEW.md):

- AUDIT.md schema (all required sections, frontmatter shape, citation requirements)
- Examples of well-formed AUDIT.md (regression fixture + feature-gap fixture + observed-vs-operator-proposed reproduction distinction)
- Rejection rules (what makes an AUDIT.md invalid; explicit list)
- Scientist tail integration (reuses existing parser; no AUDIT-specific tail format)
- AUDIT-to-PLAN handoff: how AUDIT.md flows as PLAN's input artifact when `profile: brownfield`

C5b lands `src/artifacts/audit-schema.ts` + `src/artifacts/audit-parser.ts` referencing the contract file by path.

### R0 Finding 7 — `preApproveAuditHook` for approve-time validation (block-approve)

**Closure:** New `preApproveAuditHook` in `src/commands/approve.ts`, mirroring `preApproveBuildHook` / `preApproveVerifyHook` / `preApproveReviewHook`:

- Loads AUDIT.md from canonical path (`.code-oz/artifacts/AUDIT.md`).
- Runs the schema validator (C5b's `validateAuditMarkdown`).
- If validation fails, throws with the same error class shape as the other preApprove hooks; surfaces structured error to the operator.
- Verifies the sha256 in the gate writer matches the on-disk AUDIT.md (mirrors the sha contract Codex flagged for build/verify/review).
- Runs the Scientist sidecar validator (per `docs/contracts/SCIENTIST.md`: `validateScientistSidecars` after primary artifact).

This lands as C6 (formerly the "C6 gate reuse" — now becomes "C6 preApproveAuditHook + gate reuse" since the hook lives in the same approve.ts file).

### R0 Finding 8 — `repo_context` selected-path promotion semantics (block-approve)

**Closure:** R1 briefing locks the AUDIT decision explicitly: **selected-path promotion is DEFERRED to a follow-on milestone.** AUDIT's first cut emits `selectedPaths: []` consistent with current behavior, AND `audit-system.md` instructs the Auditor that tool-result text is the only returned context. AUDIT.md citations are limited to files the Auditor read in the SAME invocation; multi-invocation file-promotion is not implemented in M17.

**Rationale for defer:**

- Implementing path promotion is a separate authority surface that affects all phases using repo_context, not just AUDIT (rule 20 violation if bundled into M17).
- AUDIT works fine in single-invocation mode for the bug-localization use case: read up to 50 files (per the `maxResults` cap in the locked permissions schema), produce AUDIT.md.
- M17 events.jsonl will record `selectedPaths: []` honestly; rule 18 invariant (manifest is the only source of truth for what bytes a provider call sent) stays intact because nothing is silently promoted.

**Deferred to a future milestone (M18+):** if AUDIT.md quality data shows multi-invocation search would meaningfully improve diagnoses, ship selected-path promotion as its own authority axis with a measurable risk-reduction effect per rule 21.

## Revised commit sequence (10 commits, ~28h)

| # | What | RED test (fails BEFORE the commit, green AFTER) | Hours |
|---|---|---|---|
| C1 | brownfield CLI e2e fixture + failing test (no implementation; pure test scaffolding) | **Two RED checks** in one test file: (a) fresh-run brownfield emits `phase_entered(audit)` and NOT `persona_invocation_started(ba)`; (b) active-run `currentPhase: 'audit'` does NOT hit fallback at `run.ts:1134`. Spawns CLI binary; asserts on `events.jsonl`. Forbidden imports listed in the test file. | 4 |
| C2 | `dispatchAudit` branch in `run.ts` active-run dispatcher AND fresh-run profile-routing | C1.a + C1.b advance past dispatch; now fails on missing phase module | 3 |
| C3 | `src/phases/audit.ts` skeleton + integration with `dispatchAudit` | C1 advances past phase entry; now fails on missing persona | 3 |
| C4 | `src/agents/defaults/auditor.md` (hand-authored, frontmatter matching locked AGENT_TYPES/repo_context shape) + bundled-defaults wiring + `src/prompts/audit-system.md` + `composeAuditPrompt` + composition-time universal-rules injection test + CI grep guard | C1 advances past persona load; rule-16 composition test passes; now fails on artifact validation | 5 |
| C5a | `docs/contracts/AUDIT.md` contract file (schema + examples + rejection rules + handoff section) | — (docs commit; no test) | 1 |
| C5b | `src/artifacts/audit-schema.ts` + `src/artifacts/audit-parser.ts` + Scientist sidecar reuse | C1 advances past artifact validation; schema rejects malformed AUDIT.md; parser extracts likely-files + reproduction + constraints; now fails on approve hook | 5 |
| C6 | `preApproveAuditHook` in `src/commands/approve.ts` + gate approval via generic `approveGate()` + audit-specific regression coverage | C1 advances past approve into PLAN routing; rule 1 gate authority preserved | 3 |
| C7 | AUDIT-to-PLAN handoff slice: `runPlan` accepts AUDIT.md for brownfield + Lead persona brownfield section + SOURCE_CHECK SC-AUDIT grammar + section-heading variant | C1 advances past PLAN entry; brownfield Lead reads AUDIT.md not SPEC.md; existing greenfield Lead still reads SPEC.md | 4 |
| C8 | brownfield CLI e2e turns green; add greenfield regression coverage to confirm no path divergence; live brownfield smoke optional | C1 passes end-to-end; existing greenfield e2e remains green | 3 |
| C9 | M17 closure synthesis + ROADMAP M17 entry + handoff doc + M17 R1 packet template | — | 1 |

**Total: 28h across 10 commits.** Up from R0's 24h × 8 commits because the AUDIT-to-PLAN handoff slice (C7) + the C5a/C5b split for the contract file + composition-time prompt infrastructure (C4 grew) all landed. Still single-axis under rule 20: every commit advances one consumer-test failure mode.

## Revised risk register (M17 R1)

| Risk | Mitigation |
|---|---|
| AUDIT scope creep beyond "runtime + dispatch + persona + handoff" | R1 briefing locks the handoff at the minimum byte-count slice (C7 only touches lead.md + plan.ts SPEC/AUDIT gate + SOURCE_CHECK grammar + section heading variant; nothing else); R1 review (this round) verifies; M17 R1 implementation review re-verifies |
| AUDIT-to-PLAN handoff change breaks existing greenfield runs | C7 RED tests assert greenfield path still routes via SPEC.md; C8 regression coverage explicit |
| Lead persona double-authoring (greenfield + brownfield modes) drifts | Lead persona hand-edited; M17 R1 packet provenance attestation covers Lead diff too; rule-16 grep guard covers Lead persona body |
| `preApproveAuditHook` validates incomplete AUDIT.md (operator-edited mid-flow) | Hook reads from canonical path, runs full schema validator, AND validates sha256 matches the gate writer's claim — same pattern as preApproveReviewHook |
| `composeAuditPrompt` injects universal-rules wrong | C4 composition-time prompt test asserts verbatim universal-rules content appears before persona body; failure blocks commit |
| Persona regenerated by LLM mid-development (rule 16 leak) | Three best-effort guardrails (composition-time test + R1 packet provenance + CI grep guard over docs/research/ + docs/planning/ CODEX_*/CLAUDE_* artifacts); rule itself is policy commitment verified at authorship time |
| AUDIT requires runtime access AUDIT doesn't have | `audit-system.md` instructs Auditor to distinguish observed-by-AUDIT reproduction from operator-proposed reproduction; unresolved runtime facts route to OPEN_QUESTIONS.md per rule 15 |
| AUDIT.md schema too strict | C5b schema validator tests cover ≥ 5 valid AUDIT.md fixtures (regression, feature gap, "audit this codebase" deferred-to-future-product-mode, operator-runtime-required, multi-file localization) |
| M17 cross-family review exceeds token budget | `budgets.global.maxTokensEstimate` ≤ 600k tokens/round enforced by `assertWithinBudget()`; $30 advisory dollar target tracked externally; abort + replan if token warning fires twice in one round |
| Selected-path promotion absent from AUDIT (deferred to M18+) | `audit-system.md` explicitly limits Auditor to single-invocation citations; events.jsonl records `selectedPaths: []` honestly per rule 18 invariant |
| AUDIT persona regresses greenfield demo | C1 + C8 e2e fixtures assert both greenfield and brownfield paths stay green |

## Open questions for Codex R1

These are the questions R1 must close. R0 answered most of Q1-Q10; the R1-new questions:

**Q11 — Handoff slice size:** Is the AUDIT-to-PLAN slice (4 sub-changes in C7: plan.ts SPEC/AUDIT gate; Lead persona brownfield section; SOURCE_CHECK grammar; section heading variant) genuinely the minimum required for AUDIT to flow into PLAN? Or does any of those open a second authority axis?

**Q12 — Lead persona dual-mode authorship:** The current Lead persona is SPEC-only. M17 adds a brownfield section. Should this be a fork (separate `lead-brownfield.md`) or an inline section in `lead.md` selected by `profile`? My view: inline section, because (a) the bulk of Lead's job is the same in both modes (atomic task production, traceability, falsifiability, risk visibility), (b) forking creates persona-drift risk between greenfield and brownfield, (c) profile is already in scope per Phase 1.6.

**Q13 — SC-AUDIT grammar shape:** Should AUDIT citations be `SC-AUDIT-NNN` (parallel to SC-SPEC-NNN, SC-REF-NNN) or richer (e.g., `SC-AUDIT-LOC-NNN` for localization vs. `SC-AUDIT-REPRO-NNN` for reproduction)? My view: simple `SC-AUDIT-NNN` to match existing grammar; richness is a future iteration if needed.

**Q14 — SOURCE_CHECK section heading variant:** When `profile: brownfield`, does SOURCE_CHECK have `## Audit sources` instead of `## Spec sources`, or both as optional? My view: `## Audit sources` replaces `## Spec sources` for brownfield; the validator accepts only the appropriate heading per profile. Simpler than dual headings.

**Q15 — Selected-path promotion defer:** Codex R0 flagged the `selectedPaths: []` ambiguity. R1 explicitly defers to M18+. Is this acceptable, or does AUDIT.md quality genuinely require multi-invocation search?

**Q16 — Live brownfield smoke as part of M17:** R0 briefing had this OPTIONAL post-tag. R1 keeps it OPTIONAL but recommends running it once before tagging v0.21.0-alpha.0 — pick a small real bug fixed in code-oz's own git history, drive M17 against it end-to-end with real Claude BUILD + Codex REVIEW. Useful confidence signal. Codex view?

**Q17 — Rule 20 boundary acceptance:** Does the expanded scope ("AUDIT runtime + dispatch + persona + minimum PLAN consumption slice") read as a single capability domain to you, or is the handoff slice a separate axis? If separate, the alternative is "AUDIT ships dead-end and M18 ships handoff" which violates rule 22 consumer-first.

## R0-→-R1 changes summary

For Codex review convenience, here's a delta-only summary of what changed from R0 to R1:

1. **Scope** expanded to include AUDIT-to-PLAN handoff slice (4 narrow sub-changes in C7); rule 20 boundary statement updated.
2. **C1** is now two RED checks (fresh-run + active-run) in one CLI e2e test, with explicit forbidden-imports list.
3. **Auditor frontmatter** rewritten to match `src/agents/defaults/lead.md` canonical shape (type: agent, repo_context.tools as string array, no invented fields).
4. **Persona contract** replaces the R0 body sketch with bullets only; actual body is hand-authored at C4.
5. **Rule-16 enforcement** retargeted from "persona file begins with universal-rules" to "composeAuditPrompt test verifies composition-time injection."
6. **C5** split into C5a (docs/contracts/AUDIT.md contract file) + C5b (schema + parser).
7. **C6** now includes `preApproveAuditHook` in addition to gate-reuse coverage.
8. **C7** is new: AUDIT-to-PLAN handoff slice (the biggest scope addition).
9. **Selected-path promotion** explicitly deferred to M18+ with rationale and rule 18 honesty.
10. **Commit count** 8 → 10; estimated hours 24 → 28.
11. **Risk register** adds 3 new rows (handoff scope creep; Lead dual-mode drift; preApproveAuditHook validation gaps).

## Codex R1 pre-design ask

Codex, return verdict `accept` / `accept-with-modifications` / `revise` / `debate`. Specifically:

1. **R0 closure 1 (PLAN dead-end):** does the AUDIT-to-PLAN handoff slice (C7) stay within rule 20, or is it a second axis?
2. **R0 closure 2 (C1 anti-stub):** do the two RED checks + forbidden-imports list adequately lock C1 to a real CLI e2e?
3. **R0 closure 3 (persona contract bullets):** are the contract bullets specific enough to commit, or do they still leak prompt-like body text?
4. **R0 closure 4 (frontmatter):** does the YAML match the locked agent + repo_context schema?
5. **R0 closure 5 (composition-time rule-16):** is `composeAuditPrompt` + composition-time test the right enforcement layer?
6. **R0 closure 6 (contract file):** is C5a → C5b the right ordering?
7. **R0 closure 7 (preApproveAuditHook):** does it mirror existing preApprove hooks cleanly?
8. **R0 closure 8 (path promotion defer):** is the defer-to-M18+ honest under rule 18, or does AUDIT need promotion for the first cut?
9. **Q11-Q17:** answer each.
10. **Risk register additions:** complete enough, or missing risks?
11. **Hour estimate:** 28h realistic for 10 commits + R1 + R2 review rounds at the M14-M16 cadence?

Return verdict at `docs/research/CODEX_RESPONSE_M17_R1.md` with the standard frontmatter (session, thread, model, reasoning-effort, sandbox, verdict, briefing-under-review, prior-debate).

If `revise-again`: list the specific blocks. The M17 R0 → R1 history shows the iteration produces value; iterating to R2 is fine if needed. If `accept` or `accept-with-modifications`, the M17 implementation can begin with this R1 briefing as the canonical scope spec; M17 R1 review (post-implementation) closes the milestone.
