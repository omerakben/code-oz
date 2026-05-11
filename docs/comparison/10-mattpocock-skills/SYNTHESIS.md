# Synthesis - code-oz vs `mattpocock-skills`

**Date:** 2026-05-10
**Authors:** Claude Opus 4.7 (xhigh) — original comparison; Codex `gpt-5.5` (xhigh) — fix-first review (`019e12f3-1324-7e82-b238-f541128ad77f`).
**Codex verdict:** `fix-first`. All material findings accepted. This synthesis is the corrected record.

## 1. What changed between COMPARISON.md and this synthesis

Codex challenged four load-bearing claims. I verified each against the repo and accept all four:

1. **M17 is not free.** `docs/design/SESSION_M16_KICKOFF.md` Q12 already locks M17 = SHIP.md + runShip + resume + intervention-resolve, tagging `v0.18.0-alpha.0`. The borrow milestone cannot land at M17 without reopening that plan. **Correction:** retarget to **M18 or later**.

2. **VERIFY persona owns only rationale + failure constraint.** `docs/contracts/VERIFY.md:8-16` confirms the orchestrator computes command, evidence, verdict, and mutation notes; the persona authors `Verdict.Rationale` always and `Failure constraint.{Failure summary, Constraint}` when verdict=fail. **Correction:** B2 (feedback-loop primacy) is a contract change in PLAN/BUILD task metadata, not a VERIFY prompt edit. Same logic for B5.

3. **SPEC.md does not include user stories.** `docs/contracts/SPEC.md:73-87` lists six fixed sections (Goals / Users / Constraints / Acceptance criteria / Open questions / Explicit non-goals) — bullets only, no paragraphs, no sub-headings. **Correction:** N3 cannot be rejected on "SPEC.md already covers it." The right rationale is that issue/PRD-export is out of scope at v0.17 and the synthesize-don't-interview pattern defers to a future GitHub/Linear export milestone.

4. **`docs/contracts/AUDIT.md` does not exist.** Only `src/state/schemas.ts:28-39` registers AUDIT as a future artifact map entry; ROADMAP `:406-408` defers full AUDIT depth to W4. **Correction:** B6 (provenance prefix on AUDIT findings) is a borrow against a non-existent contract. Drop until W4 lands AUDIT.

## 2. Final verdict

**YES, with selective borrows — modified.**

code-oz exceeds the template on the same 12 dimensions COMPARISON.md listed. The borrow set shrinks from 6 to 5, the rankings change, and the milestone target moves to **M18+** with an explicit split across two milestones.

## 3. Final ranked borrow set

| Rank | ID | Pattern | Authority shape (corrected) | Suggested milestone |
|---|---|---|---|---|
| 1 | B1' | Durable project glossary at `.code-oz/artifacts/GLOSSARY.md` with opt-in promotion to root `CONTEXT.md` | New artifact + DEFINE/PLAN prompt edits | M18 |
| 2 | B2' | Feedback-loop declaration in PLAN/BUILD/VERIFY contracts | **Contract change** (PLAN task metadata + BUILD validation command + VERIFY check) | M19 |
| 3 | B4' | 3-true ADR offer gate in DEFINE/PLAN prompts | Persona prompt edit only | M18 (bundled with B1') |
| 4 | B5' | `[CODEOZ-DEBUG-<runId>]` prefix in BUILD + changed-file residue check in VERIFY | **Contract change** (BUILD persona instruction + VERIFY orchestrator step) | M19 (bundled with B2') |
| 5 | B3' | Architecture vocabulary as advisory REVIEW reference | Persona prompt + reference file, advisory only | M18 (bundled with B1') |

**Dropped from borrow set:**
- B6 (AUDIT provenance prefix) — defer until `docs/contracts/AUDIT.md` exists; revisit in W4.

**Reclassified from no-borrow to deferred-with-trigger:**
- N4 (zoom-out as map affordance) — defer; revisit when AUDIT/PLAN need a module-map intent.
- N5 (triage state machine) — defer; revisit at W3 issue export or W4 AUDIT. Future state names should be `needs-info / plan-ready / human-required / out-of-scope / accepted-risk`, not Matt's verbatim labels.

**No-borrows that stay no-borrow:**
- N1 (prototype phase) — would violate rule 20.
- N2 (caveman) — never on canonical Markdown; measured POC acceptable on non-authority summaries only, contract: token delta + parser failures + artifact validation failures + reviewer score + semantic-equivalence rating.
- N3 (to-prd template) — synthesize-don't-interview pattern defers to future issue/PRD export; not "already covered by SPEC.md."
- N6 (per-repo bootstrap) — `code-oz init` sufficient until project-scoped glossary or issue integration lands.
- N7 (write-a-skill meta) — defer to a `docs/contracts/PERSONA_AUTHORING.md` guide; out of runtime scope. Two specific borrowable nuggets if/when authored: "the description is the only thing the agent sees when deciding to load a skill" and "split files when SKILL.md exceeds 100 lines."

## 4. Milestone shape (replanned per Codex Q1)

Per Codex's recommendation and rule 20, split the borrow set across two milestones:

### M18 candidate — "domain language + decision recording"
- B1' durable project glossary (`.code-oz/artifacts/GLOSSARY.md` with opt-in promotion path to root `CONTEXT.md`)
- B4' 3-true ADR offer gate in DEFINE/PLAN prompts (no SOURCE_CHECK coupling)
- B3' advisory architecture vocabulary reference for REVIEW (no parser strictness, no finding-schema impact)

**Authority surface:** one new artifact (GLOSSARY.md), three persona prompt edits (DEFINE for ADR gate + glossary update, PLAN for glossary + ADR gate, REVIEW for advisory vocabulary). Single new authority boundary: project-scoped vocabulary as a cross-phase shared artifact.

**Risk-reduction effect (rule 21):** measurable on `events.jsonl` as reduced terminology drift across phases (counted by repeated-different-term-for-same-concept events) plus reduced ADR over-production (counted by ADR creation events vs. PLAN decision count).

### M19 candidate — "validation-loop discipline"
- B2' feedback-loop declaration in PLAN/BUILD/VERIFY contracts. PLAN task metadata gains `feedback_loop` (string, the fastest deterministic loop and why it is enough); BUILD validation command records what loop the builder ran; VERIFY checks both fields agree.
- B5' `[CODEOZ-DEBUG-<runId>]` prefix in BUILD + VERIFY orchestrator step that uses `repo_context` to grep changed files and fail if residue remains.

**Authority surface:** two contract changes (PLAN.md feedback_loop field + VERIFY orchestrator residue-check step), three persona prompt edits (PLAN, BUILD, VERIFY rationale). Single new authority boundary: validation-loop provenance.

**Risk-reduction effect (rule 21):** measurable as reduced VERIFY restarts (BUILD declares the loop it ran; VERIFY repeats it deterministically) plus zero debug-residue gates passed (currently uncountable; after B5' it becomes a hard fail).

## 5. Strategic risk re-examined (Codex Q7)

Codex's refinement of the philosophical disagreement is precise:

> *"The risk Matt exposes is not 'too much process'; it is **opaque process** that users cannot debug. The right mitigation is preview, pause, intervention, artifact editability, and explicit escape points. A gate-skipping mode would blur the category and weaken the proof story."*

This is the right framing. code-oz's product thesis is process ownership (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`); a `--ad-hoc` gate-skip flag would weaken it. The mitigation surfaces are already partially in place:

- Preview / pause: `code-oz run` is phase-aware; intervention check at top of `dispatchBuild/Verify/Review` (M16 Q7).
- Artifact editability: every artifact is plain Markdown the user can edit before approving the gate.
- Explicit escape points: `NEEDS_INTERVENTION.json` is the recovery surface (rule 11).

What's missing per Codex's framing is a cleaner *user-visible* expression of these escape points. That's a documentation/UX surface, not a runtime change. Capture this as a v0.2 doc-track item, not a milestone.

## 6. Closure

- **Per rule 19 (no tech debt at milestone close):** all material Codex findings (M17 collision, B2/B5 contract authority, B6 missing contract, B1 cross-run scope, N3 SPEC.md misclaim) accepted and applied in this synthesis. No open block-now or block-next-milestone findings.
- **Per cross-model peer review rule (CLAUDE.md):** Codex's `fix-first` verdict honored; this synthesis is the fix.
- **Per rule 20 (one authority boundary per milestone):** the borrow set is split across M18 (vocabulary) and M19 (validation-loop). Each milestone introduces exactly one new authority boundary.
- **Per rule 21 (measurable risk-reduction):** both M18 and M19 candidates have `events.jsonl`-counted measurement contracts.

**Index update:** appending this comparison to `docs/comparison/README.md` sessions table as session 10. Folder slot 08 was taken by `pi-mono` mid-session (parallel comparison closed concurrently); the folder was renamed to `10-mattpocock-skills` for cleanliness.

---

## Appendix A — Where Codex's challenges are recorded

| Codex finding | COMPARISON.md location it corrects | Synthesis section |
|---|---|---|
| M17 already scoped for SHIP/runShip/resume/intervention-resolve | §5 "Suggested milestone target: M17" | §1.1, §4 |
| VERIFY persona owns only rationale + failure constraint | §6 Q3 framing of B2 | §1.2, §3 (B2'), §4 (M19) |
| SPEC.md has no user stories | §3 row 11 + N3 rationale | §1.3, §3 (N3 footnote) |
| `docs/contracts/AUDIT.md` does not exist | §3 row 22 + B6 | §1.4, §3 (B6 dropped) |
| B1 run-scoped artifact loses cross-run value | §5 B1 placement at `state/GLOSSARY.md` | §3 (B1' at `.code-oz/artifacts/GLOSSARY.md` with opt-in promotion) |
| B4 in SOURCE_CHECK mixes evidence with decision recording | §5 B4 "Where it lands" | §3 (B4' in DEFINE/PLAN prompts only) |
| B3 strict vocabulary risks parser-rule constraint | §5 B3 "Where it lands" | §3 (B3' advisory only) |
| N3 wrong rationale (SPEC ≠ user stories) | §5 N3 reason | §3 (N3 corrected to "issue/PRD export deferred") |
| N4/N5 reclassified deferred-with-trigger | §5 N4/N5 | §3 (N4/N5 reclassified) |

## Appendix B — Verdict matrix

| Question | Comparison.md said | Synthesis says | Source of correction |
|---|---|---|---|
| Verdict | YES, with selective borrows | YES, with selective borrows — modified | Codex agreement |
| Borrow count | 6 | 5 (B6 dropped) | Codex Q3, AUDIT contract absence |
| Strong borrows | B1, B2 | B1', B2' | Codex per-borrow review |
| Medium borrows | B3, B4 | B3' (advisory only), B4' (DEFINE/PLAN only) | Codex per-borrow review |
| Small borrows | B5, B6 | B5' (BUILD prefix + VERIFY residue check), B6 dropped | Codex Q1, AUDIT absence |
| Milestone target | M17 (single bundled) | M18 (vocabulary) + M19 (validation-loop) | Codex Q1, M17 collision |
| No-borrow N3 reason | "SPEC.md already covers user stories" | "issue/PRD export deferred to future milestone" | Codex Q3.N3 |
| No-borrow N4 status | rejected | deferred-with-trigger (AUDIT/PLAN module-map intent) | Codex Q4.N4 |
| No-borrow N5 status | rejected | deferred-with-trigger (W3 issue export or W4 AUDIT) | Codex Q4.N5 |
| Strategic risk Q7 | "products are different" | "process must not be opaque; escape points are the mitigation" | Codex Q7 framing |

End of synthesis.
