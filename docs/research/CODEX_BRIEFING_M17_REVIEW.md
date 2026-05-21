# Briefing — M17 AUDIT runtime — implementation review (R1)

**Brief date:** 2026-05-21
**Author:** Claude (Sonnet 4.6, C9 docs commit)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule (implementation completion)
**Branch under review:** `feat/m17-audit-runtime`
**Base:** `main@7313571` (last commit before M17 branch)
**Commits ahead of main:** 16
**Suite:** 3742 pass / 2 skip / 0 fail

---

## What you are reviewing

16 commits on `feat/m17-audit-runtime`. M17 is the **brownfield AUDIT runtime** — the brownfield analog of DEFINE + SPEC + Lead-SPEC-read. Authority boundary (rule 20, single axis): **AUDIT runtime + dispatch + auditor persona + minimum PLAN consumption slice.**

Full commit list (oldest first):

| # | SHA | Subject |
|---|---|---|
| C1 | `2a9d5d6` | `test(m17): RED brownfield CLI e2e — two failure anchors` |
| C1-fix | `76917ec` | `test(m17): harden C1 anchors with positive auditor-invocation assertion` |
| C2 | `34aa0be` | `feat(m17): dispatchAudit branch in fresh + active run paths` |
| C3 | `4bd67c0` | `feat(m17): audit phase skeleton + event sequence` |
| C4-prep | `fea2b72` | `fix(m17): persist operator problemStatement on run_started + audit happy-path intervention` |
| C4-prep-fix | `66913f8` | `fix(m17): gate run_started problemStatement on brownfield profile` |
| C4-mach | `bbffd47` | `feat(m17): composeAuditPrompt + composition test + rule-16 CI guard + invocation wiring` |
| C4-mach-fix | `0f2ffdd` | `fix(m17): strengthen rule-16 leak guard — strip sentinel + multi-slice probe` |
| C5a | `943c540` | `docs(m17): AUDIT.md artifact contract` |
| C5b | `cb35b29` | `feat(m17): AUDIT.md schema + parser + scientist sidecar reuse` |
| C5b-fix | `d0358d1` | `fix(m17): tighten AUDIT validation — untagged/observed-citation/localization-anchor/section-dup` |
| C6 | `6cae769` | `feat(m17): audit_completed sha contract + preApproveAuditHook` |
| C7 | `f03e48c` | `feat(m17): AUDIT->PLAN handoff slice — profile-aware PLAN + SOURCE_CHECK` |
| C4-prose | `0ebbd37` | `feat(m17): auditor persona + audit-system prose + lead brownfield section (C4 prose)` |
| C8 | `026bb24` | `test(m17): brownfield AUDIT full-cycle e2e + greenfield regression (C8)` |
| C8-fix | `f88601e` | `fix(m17): strip AUDIT ready-signal + wire Scientist phase-tail into AUDIT (C8 bugs)` |

---

## Required reading

1. `docs/research/CODEX_BRIEFING_M17.md` — R0 design briefing
2. `docs/research/CODEX_RESPONSE_M17.md` — R0 verdict: `revise`; 10 findings, all addressed in R1
3. `docs/research/CODEX_BRIEFING_M17_R1.md` — R1 design briefing (canonical spec through C9 kickoff)
4. `docs/research/CODEX_RESPONSE_M17_R1.md` — R1 verdict: `accept-with-modifications`; two locked modifications (sha contract, profile source)
5. `docs/design/SESSION_M17_KICKOFF.md` — implementation plan; locked commit sequence; locked architectural decisions; risk register

---

## Required code reading (load-bearing paths)

Sample — do not deep-read everything. Load-bearing paths in implementation order:

- `src/commands/run.ts` (C2) — fresh-run brownfield fork at profile check; active-run `dispatchAudit` branch between the existing phase handlers and the generic fallback
- `src/phases/audit.ts` (C3 + C4-prep + C6 + C8-fix) — `runAudit` full pipeline: `composeAuditPrompt` → `invokeProvider` → artifact persistence → `audit_completed` sha event → `runScientistPhaseTail` → `emitGateRequired('audit')`
- `src/prompts/index.ts` (C4-machinery) — `composeAuditPrompt` export; universal-rules injection at composition time (NOT in persona body); `AUDITOR_PERSONA_BODY_BEGIN` sentinel for CI guard
- `src/agents/defaults/auditor.md` (C4-prose) — auditor persona body; frontmatter fields match current `AGENT_TYPES` schema; body hand-authored by Ozzy + Claude (see provenance attestation section below)
- `src/prompts/audit-system.md` (C4-prose) — system template; READY_SIGNAL substitution token and stripping (C8-fix closed the strip bug)
- `docs/contracts/AUDIT.md` (C5a) — artifact contract; schema; rejection rules; handoff section
- `src/artifacts/audit-schema.ts` + `src/artifacts/audit-parser.ts` (C5b + C5b-fix) — Zod schema; parser; Scientist sidecar reuse via existing `runScientistPhaseTail`; validator tests cover 5+ valid AUDIT.md fixtures + rejection cases
- `src/commands/approve.ts` (C6) — `preApproveAuditHook`; sha-binding against `audit_completed` event; `validateAuditMarkdown`; `validateScientistSidecars`; routes to generic `approveGate()`
- `src/phases/plan.ts` (C7) — `RunPlanOptions.profile` field; brownfield fork reads `AUDIT.md` instead of `SPEC.md`; error message updated; profile source is `loaded.state.profile` (event-derived per rule 1)
- `src/agents/defaults/lead.md` (C7 + C4-prose) — inline brownfield section added
- `src/artifacts/source-check.ts` (C7) — `SOURCE_ID_PATTERN` extended with `AUDIT` arm; `sourceIdKind` switch `AUDIT` case; validator accepts `## Audit sources` for brownfield profile
- `tests/e2e/audit-brownfield-full-cycle.test.ts` (C8 + C8-fix) — full brownfield lifecycle via spawned CLI binary; `events.jsonl` assertions; greenfield regression coverage

---

## Rule-16 provenance attestation (mandatory checklist item)

The `auditor.md` persona body (`src/agents/defaults/auditor.md`), `src/prompts/audit-system.md`, and the brownfield section of `src/agents/defaults/lead.md` are **hand-authored prose**. The author-of-record for all three is Ozzy (omerakben), collaborating with Claude line-by-line. These files were NOT produced by an automated LLM generation pass.

**Evidence:**

1. **CI grep guard** — `scripts/check-rule16.sh` (or inline in CI) contains the sentinel `AUDITOR_PERSONA_BODY_BEGIN`. The guard scans `docs/research/CODEX_*.md`, `docs/research/CLAUDE_*.md`, `docs/planning/CODEX_*.md`, `docs/planning/CLAUDE_*.md` for verbatim overlap with the auditor persona body. If any LLM-generated artifact in those directories reproduced the persona body, the guard fails. Introduced in C4-machinery; tightened in C4-machinery fix-first to strip the sentinel from the search and add a multi-slice probe.

2. **Commit authorship** — C4-prose commit `0ebbd37` (`feat(m17): auditor persona + audit-system prose + lead brownfield section (C4 prose)`) is a separate standalone commit with Ozzy as author, distinct from the composition-machinery commit. The commit message explicitly labels it "hand-authored by Ozzy + Claude per rule 16."

3. **No persona body text appears in any CODEX_BRIEFING or CODEX_RESPONSE file** — the R1 design briefing (`CODEX_BRIEFING_M17_R1.md`) replaced the R0 body sketch with contract bullets only, per R0 finding 3 ("Auditor persona contract bullets, not body sketch"). The implementation briefing you are now reading does not reproduce the persona body.

**What Codex should verify:** confirm that `src/agents/defaults/auditor.md` contains a `## Roles and responsibilities` or equivalent section that is role-specific prose (not a template fill-in), and that the CI guard sentinel appears in the composition-time test at `tests/prompts/compose-audit-prompt.test.ts`.

**What Codex must NOT accept:** any claim that CI proves human authorship. The guard proves non-overlap with known generated artifacts; it does not prove the file was not generated by a tool outside those directories. The provenance claim here is a process claim, not a technical proof. Codex should flag if the guard is absent or trivially bypassed.

---

## Two e2e-caught bugs — assess adequacy of fix

C8's full-cycle e2e surfaced two bugs that 15 prior commits + 10 Codex per-commit/seam review rounds missed. Assess whether the C8-fix closures are sufficient or whether additional regression coverage is needed.

**Bug A — un-stripped AUDIT ready-signal**

The `audit-system.md` template contained the `{{READY_SIGNAL}}` substitution token, and the token replacement left a literal `<audit-ready/>` marker in the artifact body text. The `validateAuditMarkdown` call in `preApproveAuditHook` should have caught this — check whether the validator was updated in C8-fix to explicitly reject artifact text containing the ready-signal sentinel, or whether the fix only removed it from the template rendering path.

**Bug B — Scientist phase-tail never wired**

`runAudit` did not call `runScientistPhaseTail`. The C8-fix added that call. Check that `validateScientistSidecars` in `preApproveAuditHook` would now pass on a valid run (HYPOTHESES.md + OPEN_QUESTIONS.md present and schema-valid), and confirm the full-cycle e2e (`tests/e2e/audit-brownfield-full-cycle.test.ts`) asserts that both sidecar files are written before `gate_required(audit)` fires.

---

## R1 design modification closure verification

The R1 design verdict (`CODEX_RESPONSE_M17_R1.md`) required two locked modifications before code landed:

**M1 — `preApproveAuditHook` sha contract.** Verify that C6's `preApproveAuditHook` reads the sha from the `audit_completed` event (event-log traversal, not from the artifact file directly), computes the sha of the current AUDIT.md on disk, and rejects a mismatch. Confirm the event field name is `auditReportSha256` (mirrors `build_completed.buildReportSha256` at `src/commands/approve.ts:474-529`).

**M2 — PLAN profile source.** Verify that `runPlan` reads `profile` from `loaded.state.profile` (event-derived run state), not from the current `.code-oz/config.yaml`. Check that the test in C7 covers a resume scenario where `config.yaml` has been mutated between AUDIT approval and `code-oz run` (PLAN phase).

**M3 — SOURCE_CHECK heading lock.** Verify that brownfield SOURCE_CHECK uses `## Audit sources` and that the validator rejects a brownfield run that uses `## Spec sources`. Confirm the validator receives profile context from `runPlan` (not from config).

---

## Known deferred items (not blocking R1)

These are documented in `docs/handoffs/2026-05-21-m17-closure.md`. Codex should note them but should NOT block on them:

1. **Live brownfield smoke skipped.** Confirmed optional by `docs/design/SESSION_M17_KICKOFF.md` line 41. FakeProvider full-cycle e2e is the proof. Codex: assess whether this is sufficient coverage for an R1 push verdict, or whether a live smoke run is a prerequisite.

2. **Two `SOURCE_ID_PATTERN` copies** (`src/artifacts/source-check.ts` + `src/artifacts/plan.ts`). Both in sync; both covered by tests. Deferred extraction to next artifact-contract touch. FYI only.

3. **Stale kickoff event names.** `docs/design/SESSION_M17_KICKOFF.md` and `docs/research/CODEX_BRIEFING_M17.md` anticipated `artifact_recorded(AUDIT.md)` and `persona_invocation_started/_completed(auditor)` — never implemented. Implementation used `agent_invoked`/`agent_completed` + `audit_completed`. Doc divergence only; no runtime impact. FYI only.

4. **Auditor not in `M12_COMPANY_ROLES`.** No per-role budget gating for auditor; global budgets apply (rule 19). Separate rule-20 authority change to add it to the roster. FYI only.

5. **`lead.md` brownfield section not covered by CI leak guard.** The guard covers `auditor.md` body; the lead brownfield section is also rule-16 prose. Small follow-up. FYI only.

---

## Questions for Codex

Q1 — **Ready-signal fix completeness.** Is the C8-fix for Bug A (ready-signal in artifact body) a complete fix, or does it also require a validator-level rejection for artifacts containing the signal sentinel? If the fix is template-side only, a modified template in a future PR could reintroduce the bug silently.

Q2 — **Scientist tail wiring.** Is calling `runScientistPhaseTail` inside `runAudit` sufficient, or does `preApproveAuditHook` also need to call `validateScientistSidecars` independently of `preApproveAuditHook`'s existing flow? (The kickoff doc says `preApproveAuditHook` runs `validateScientistSidecars`; confirm both the wiring in `runAudit` AND the hook-level validation are present.)

Q3 — **Live brownfield smoke decision.** Given that the FakeProvider full-cycle e2e exercises the full pipeline through the spawned CLI binary, is this sufficient for an R1 push verdict? Or is a live brownfield smoke run (against the `code-oz` repo itself or a minimal fixture repo with real provider credentials) a prerequisite for the tag?

Q4 — **Rule-16 guard adequacy.** The CI grep guard targets `docs/research/CODEX_*` + `docs/planning/CODEX_*` artifacts. The `auditor.md` body could also be leaked into `docs/design/SESSION_M17_KICKOFF.md` or `docs/handoffs/` files. Is the current guard scope sufficient, or should it extend to `docs/design/SESSION_*.md`?

Q5 — **Two `SOURCE_ID_PATTERN` copies.** Both copies were updated in C7. Confirm they are in sync. No action required this milestone, but a finding if they diverge.

---

## Verdict format

Return one of: `push` | `fix-first` | `debate-required`. Format your response as `docs/research/CODEX_REVIEW_M17.md` (mirroring M15/M16 review files). List findings as: block-push (required before tag), fix-soon (required before next milestone), nit (advisory).
