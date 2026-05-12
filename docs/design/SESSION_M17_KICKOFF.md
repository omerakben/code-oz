# Session M17 implementation kickoff — AUDIT runtime (post-R1 lock)

**Locked:** 2026-05-12
**Branch:** `main` at HEAD with the M17 R0 + R1 briefings + verdicts pushed (Codex thread `019e1dd3` → `019e1de4`)
**Authority boundary (rule 20):** **AUDIT runtime + dispatch + persona + minimum PLAN consumption slice.** The brownfield analog of DEFINE + SPEC + Lead-SPEC-read. AUDIT phase reads a brownfield repo + operator problem statement, produces `AUDIT.md` (Localization + Reproduction + Constraints + Scientist tail), and hands off to PLAN via a narrow compatibility slice that lets `runPlan` consume `AUDIT.md` instead of `SPEC.md` when `profile: brownfield`.

## Trigger and ground

`v0.20.0-alpha.0` shipped to npm + Homebrew earlier today. Phase 1 of the 1000-star plan (`docs/planning/1000_STAR_PLAN.md`) is fully closed: all three install channels live, brownfield profile-detection prerequisite landed at `066724e`, and the Ozzy-approval gate is unlocked. M17 is Phase 2.

**Codex review chain:**

- R0 (thread `019e1dd3`) — verdict `revise`. 6 substantive findings + 8 changes required. Full response: `docs/research/CODEX_RESPONSE_M17.md`.
- R1 (thread `019e1de4`) — verdict **`accept-with-modifications`**. 7 of 8 R0 findings closed; 1 partial (C6 sha contract). Full response: `docs/research/CODEX_RESPONSE_M17_R1.md`.
- "No R2 design round is required if those changes are folded into the implementation plan."

This kickoff doc IS the implementation plan with the R1 modifications folded in.

## Locked scope (post-R0 + R1)

**M17 ships:**

1. Two-RED-check brownfield CLI e2e (C1)
2. `dispatchAudit` branch in `src/commands/run.ts` active-run dispatcher + fresh-run profile routing (C2)
3. `src/phases/audit.ts` skeleton + integration with dispatchAudit (C3)
4. Hand-authored `src/agents/defaults/auditor.md` + `src/prompts/audit-system.md` + `composeAuditPrompt` + composition-time universal-rules injection test + CI grep guard (C4)
5. `docs/contracts/AUDIT.md` contract file with schema + examples + rejection rules + handoff section (C5a)
6. `src/artifacts/audit-schema.ts` + `src/artifacts/audit-parser.ts` + Scientist sidecar reuse (C5b)
7. `preApproveAuditHook` with **explicit `audit_completed.auditReportSha256` event contract** (C6) + gate approval via generic `approveGate()` + audit-specific regression coverage
8. AUDIT-to-PLAN handoff slice: brownfield `runPlan` accepts `AUDIT.md` (reading **run-state profile, NOT mutable config**) + Lead persona inline brownfield section + SOURCE_CHECK `SC-AUDIT` grammar + `## Audit sources` heading (C7)
9. CLI e2e turns green + greenfield regression coverage (C8)
10. M17 closure synthesis + ROADMAP M17 entry + handoff doc + R1 packet template (C9)

**M17 explicitly excludes:**

- New gate authority surfaces (reuse generic `approveGate`; no `approveAuditGate`)
- Brownfield profile-detection (Phase 1.6 prerequisite, already landed)
- BUILD / VERIFY / REVIEW changes downstream of AUDIT
- Cross-family AUDIT review (single-provider AUDIT for first cut)
- Selected-path promotion for repo_context (deferred to M18+ with `selectedPaths: []` honest events per rule 18)
- Live brownfield smoke as a hard gate (OPTIONAL; if skipped before tag, closure note documents why)
- Rich SC-AUDIT taxonomy like SC-AUDIT-LOC-NNN (simple `SC-AUDIT-NNN` only)

## R1 modifications folded into the kickoff

Codex R1 verdict's two modifications PLUS one low + three risk-register items are locked here:

### M1 — `preApproveAuditHook` sha contract (medium, was partial closure)

**Decision:** AUDIT emits an `audit_completed` event carrying `auditReportSha256`. `preApproveAuditHook` validates AUDIT.md on disk against that event's sha PLUS runs `validateAuditMarkdown` PLUS runs `validateScientistSidecars`. This makes M17 mirror the BUILD/VERIFY/REVIEW pattern exactly (`src/commands/approve.ts:474-529, 694-758`).

**Rejected alternative:** "DEFINE-like editable" semantics would have worked as a fallback, but the R1 verdict marks it acceptable, and the M14-M16 pattern strongly favors event/sha contract over editable artifacts. Choosing the more disciplined path closes the partial.

### M2 — PLAN profile source (medium, R1 new finding #2)

**Decision:** `RunPlanOptions` gains a `profile: Profile` field. `dispatchPlan` resolves the profile from the loaded run state (event-derived per rule 1: file-based gate signals, no parallel state), NOT from the mutable `.code-oz/config.yaml`. The signature change is small (`src/phases/plan.ts:76-90` + `src/commands/run.ts:1192-1204`); the wiring change passes `loaded.state.profile` through.

**Why event-derived:** changing `.code-oz/config.yaml` between AUDIT approval and PLAN must NOT make a brownfield run look greenfield. Resume must read what the run started with, not whatever the file says now. Mirrors how `loaded.state.profile` is already used at `src/commands/approve.ts:314-319`.

### M3 — SOURCE_CHECK heading lock (low, R1 new finding #3)

**Decision:** Brownfield SOURCE_CHECK uses `## Audit sources` REPLACING `## Spec sources`. NOT optional both. NOT additive. The validator at `src/artifacts/source-check.ts:418` receives the profile (passed through from `runPlan`) and enforces the matching single heading.

**Drop the R1 briefing's line:** "or include both — only one is required per profile; the off-profile section is optional" — collapsed to "replaces."

### M4 — Risk register additions (3 new rows)

| Risk | Mitigation |
|---|---|
| AUDIT artifact provenance drift | C6's `audit_completed.auditReportSha256` event + preApproveAuditHook sha-binding catches drift between AUDIT emission and approve |
| Profile drift during resume | C7 plumbs `profile` from event-derived run state; tests cover the resume-with-mutated-config-file case |
| SOURCE_CHECK profile-split weakens greenfield | C5b/C7 parser/serializer tests cover BOTH greenfield SPEC + brownfield AUDIT fixtures; existing 3-source verification rules apply to both |

## Commit sequence (10 commits, 30-34h adjusted estimate)

Per R1 verdict's hour adjustment from 28h → 30-34h to account for the C6 sha contract + profile plumbing + optional pre-tag smoke:

| # | What | RED test (fails BEFORE, green AFTER) | Hours |
|---|---|---|---|
| C1 | Brownfield CLI e2e — two RED checks (fresh-run + active-run); explicit forbidden imports list; events.jsonl assertions; no manual `AUDIT.md` writes; no synthetic event-log construction except for fixture setup pre-C2 | (a) Fresh-run brownfield emits `phase_entered(audit)` and NOT `persona_invocation_started(ba)`; (b) Active-run `currentPhase: 'audit'` does NOT hit `run.ts:1134` fallback. Spawns CLI. | 4 |
| C2 | `dispatchAudit` branch in active-run dispatcher (between `run.ts:951` and `:1150` fallback) AND fresh-run profile routing (in fresh-run path at `run.ts:309-368` — call `dispatchAudit` when `config.profile === 'brownfield'`, else `runDefine` as today) | C1.a and C1.b both advance past dispatch; now fails on missing phase module | 3 |
| C3 | `src/phases/audit.ts` skeleton + integration with `dispatchAudit`; emits `phase_entered(audit)` → `repo_context_searched(*)` (0+) → `persona_invocation_started(auditor)` → `persona_invocation_completed(auditor)` → `artifact_recorded(AUDIT.md)` → `audit_completed` (new event with auditReportSha256) → `gate_required(audit)` | C1 advances past phase entry; now fails on missing persona | 3 |
| C4 | Hand-authored `src/agents/defaults/auditor.md` (frontmatter per R1 spec; body hand-authored by Ozzy + Claude, provenance attested in M17 R1 packet) + bundled-defaults wiring + hand-authored `src/prompts/audit-system.md` + `composeAuditPrompt` export from `src/prompts/index.ts` + composition-time test asserting universal-rules content before persona body + CI grep guard against LLM-drafted persona text in `docs/research/CODEX_*`, `docs/research/CLAUDE_*`, `docs/planning/CODEX_*`, `docs/planning/CLAUDE_*` artifacts | C1 advances past persona load; composition-time rule-16 test passes; now fails on artifact validation | 5 |
| C5a | `docs/contracts/AUDIT.md` contract file (schema + ≥ 5 fixture examples + rejection rules + handoff section + observed-vs-operator-proposed reproduction distinction + Scientist sidecar reuse note) | — (docs commit; no test) | 1 |
| C5b | `src/artifacts/audit-schema.ts` + `src/artifacts/audit-parser.ts` + Scientist sidecar reuse via existing `runScientistPhaseTail`; schema validates 1+ entries per required section + file:line citation format + canonical frontmatter | C1 advances past artifact validation; schema rejects malformed AUDIT.md; parser extracts likely-files + reproduction + constraints; now fails on approve hook | 5 |
| C6 | New `audit_completed` event type with `auditReportSha256` field (locked at C6 schema, mirrors `build_completed.buildReportSha256`); `preApproveAuditHook` in `src/commands/approve.ts` validates AUDIT.md sha against the `audit_completed` event + runs `validateAuditMarkdown` + runs `validateScientistSidecars`; gate approval via generic `approveGate()`; audit-specific regression coverage only (NO new authority) | C1 advances past approve into PLAN routing; rule 1 gate authority preserved; sha-binding verified | 4 |
| C7 | AUDIT-to-PLAN handoff slice. (a) `RunPlanOptions.profile` added; `runPlan` reads profile from loaded run state (event-derived per rule 1); brownfield reads `AUDIT.md` instead of `SPEC.md`; greenfield unchanged; error message becomes "PLAN cannot run without an approved <SPEC\|AUDIT>.md" with the profile-appropriate name. (b) Lead persona `src/agents/defaults/lead.md` gains an inline brownfield section explaining audit-mode reading; tests confirm greenfield Lead reads SPEC.md, brownfield Lead reads AUDIT.md. (c) `SOURCE_ID_PATTERN` extends to `/^SC-(SPEC\|REF\|REF-NONE\|DOC\|DOC-NONE\|AUDIT)-\d{3,}$/`; `sourceIdKind` switch adds `AUDIT` arm. (d) `## Spec sources` heading replaced by `## Audit sources` for brownfield (NOT optional; NOT additive); validator receives profile and enforces matching single heading. | C1 advances past PLAN entry; brownfield Lead reads AUDIT.md not SPEC.md; greenfield Lead still reads SPEC.md; SOURCE_CHECK accepts SC-AUDIT-NNN ids in brownfield AUDIT-sources section | 4 |
| C8 | Brownfield CLI e2e turns green; greenfield regression coverage; OPTIONAL live brownfield smoke against a small real bug from code-oz's own git history (Codex R1: run if credentials + budget available; if skipped, closure note documents why) | C1 passes end-to-end; existing greenfield e2e remains green | 4 |
| C9 | M17 closure synthesis + ROADMAP M17 entry + handoff doc + M17 R1 packet template (for the implementation review pass that follows this design loop) | — | 1 |

**Adjusted total: 34h** at the safer planning estimate. The implementation budget (`budgets.global.maxTokensEstimate ≤ 600k tokens/round` × R1 + R2 review rounds) stays as locked in R1.

## Cadence — R0 design → R1 design → implementation → R1 impl review → R2 impl review

To avoid round-number collisions: the design rounds are R0 design + R1 design (both closed). The implementation review rounds at the END of M17 will be R1 impl + R2 impl (matching M14/M15/M16 cadence). C9's closure handoff seeds the M17 R1 packet template.

## Locked architectural decisions (do not relitigate)

1. **Rule 20:** M17 is one authority — "AUDIT runtime + dispatch + persona + minimum PLAN consumption slice." Rule 22 (consumer-first) makes the handoff slice mandatory.
2. **Rule 16:** universal-rules injected at composition time via `composeAuditPrompt`, NOT by embedding in persona files. Three best-effort guardrails: composition-time test (catches concat drift); R1 packet provenance attestation (process evidence); CI grep guard over `docs/research/` + `docs/planning/` CODEX_*/CLAUDE_* artifacts (catches post-authorship leakage).
3. **Rule 18:** `tool_use.repo_context` only (glob/grep/read at locked caps; no symbol; no network). No execute, no write, no debate for AUDIT. Selected-path promotion explicitly deferred to M18+; events.jsonl records `selectedPaths: []` honestly.
4. **Rule 1:** all gate writes route through generic `approveGate()`. No `approveAuditGate`. AUDIT-specific work is `preApproveAuditHook` + `audit_completed` event + sha-binding.
5. **Rule 22(a):** consumer-first ordering — C1 is the failing brownfield CLI e2e RED test scaffolding; C2-C8 each advance one consumer-test failure mode at a time. Anti-stub strictness applies: no state-level construction; no manual AUDIT.md writes; spawned CLI only.
6. **Rule 22(b):** RED-first TDD per behavior change. Every commit writes its failing test BEFORE the implementation.
7. **Profile source for PLAN handoff (R1 M2):** event-derived run state, NOT mutable config. `RunPlanOptions.profile` plumbed through; `dispatchPlan` resolves from `loaded.state.profile`.
8. **SOURCE_CHECK profile heading (R1 M3):** brownfield REPLACES `## Spec sources` with `## Audit sources`. Not optional; not additive. Validator receives profile context.
9. **Hand-authored persona (rule 16):** `auditor.md` body hand-authored by Ozzy + Claude collaboratively; no LLM-generated draft. Provenance attested in M17 R1 packet (post-impl); CI grep guard catches generation-pass leakage.
10. **Cost:** Codex via ChatGPT subscription auth = $0 incremental; Claude API ≤ 600k tokens/round enforced via `assertWithinBudget()`; $30 advisory dollar target tracked externally; abort + replan if token-budget warning fires twice in one round.

## Risk register (M17, R0 + R1 + impl)

(Combined from R0 briefing + R1 briefing + R1 verdict additions; deduplicated; locked.)

| Risk | Mitigation |
|---|---|
| AUDIT scope creep beyond "runtime + dispatch + persona + handoff" | This kickoff doc locks the handoff slice at C7's 4 sub-changes; M17 R1 impl review verifies |
| Handoff slice breaks existing greenfield runs | C7 RED tests assert greenfield still routes via SPEC.md; C8 regression coverage explicit |
| Lead persona dual-mode drift | Inline brownfield section in `lead.md`; provenance attested; rule-16 grep guard covers Lead persona body |
| AUDIT artifact provenance drift (between emission and approve) | C6 `audit_completed.auditReportSha256` event + preApproveAuditHook sha-binding |
| Profile drift during resume | C7 plumbs profile from event-derived run state; tests cover resume-with-mutated-config-file |
| SOURCE_CHECK profile-split weakens greenfield | C5b/C7 parser/serializer tests cover both greenfield SPEC + brownfield AUDIT fixtures |
| `composeAuditPrompt` injects universal-rules wrong | C4 composition-time test asserts verbatim universal-rules content before persona body |
| Persona regenerated by LLM mid-development (rule 16 leak) | Three best-effort guardrails: composition-time test + R1 packet provenance attestation + CI grep guard over docs/research/ + docs/planning/ CODEX_*/CLAUDE_* |
| AUDIT requires runtime access AUDIT doesn't have | `audit-system.md` instructs distinguishing observed-vs-operator-proposed reproduction; unresolved runtime facts route to OPEN_QUESTIONS.md per rule 15 |
| AUDIT.md schema too strict | C5b validator tests cover ≥ 5 valid AUDIT.md fixtures (regression, feature gap, "audit this codebase" deferred-to-future, operator-runtime-required, multi-file localization) |
| M17 cross-family review exceeds token budget | `budgets.global.maxTokensEstimate ≤ 600k tokens/round` enforced by `assertWithinBudget()`; abort + replan if warning fires twice |
| Selected-path promotion absent from AUDIT (deferred to M18+) | `audit-system.md` limits Auditor to single-AUDIT-phase-loop citations; events record `selectedPaths: []` honestly |
| AUDIT persona regresses greenfield demo | C1 + C8 e2e fixtures assert both paths stay green |
| `preApproveAuditHook` validates incomplete AUDIT.md (operator-edited mid-flow) | Hook validates sha against `audit_completed` event; matches BUILD/REVIEW pre-approval pattern |

## Pre-implementation checklist

Before C1 starts, confirm:

- [ ] R1 briefing pushed to origin/main ✅ (this commit)
- [ ] R1 verdict committed and read by Ozzy ✅ (this commit pushes it)
- [ ] R1 modifications M1 + M2 + M3 folded into this kickoff (above) ✅
- [ ] Risk register has 14 rows covering R0 + R1 + impl risks ✅
- [ ] Commit sequence locked at 10 commits, 34h adjusted estimate ✅
- [ ] Pre-tag live brownfield smoke decision: deferred to C8 owner choice; documented in closure note either way

## Next session work

This kickoff doc + the R1 briefing + R1 verdict form the canonical M17 implementation spec. Next session:

1. Start C1: write the two-RED-check brownfield CLI e2e test (no implementation; pure test scaffolding). Confirm both checks fail today for the right reasons (fresh-run routes to BA via `runDefine`; active-run hits `run.ts:1134` fallback).
2. C2: add `dispatchAudit` to both fresh-run and active-run paths. Confirm C1 advances exactly one failure mode.
3. Continue C3-C9 in the consumer-first sequence locked above.
4. After C9 closes, run M17 R1 impl review (post-implementation) for fix-first / push verdict.
5. After R2 impl review push, tag `v0.21.0-alpha.0`.

P(M17 ships on schedule with R1 scope, R1 mods applied, no rule violations, no tag-time tech debt): 65% per Codex R1.
