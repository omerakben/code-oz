---
name: synthesis-comparison-prd-taskmaster
companion-docs: COMPARISON.md (original analysis), CODEX_BRIEFING.md (questions), CODEX_RESPONSE.md (Codex verdicts)
target: post-debate decisions and corrections from the prd-taskmaster comparison
status: closed
date: 2026-05-10
codex-thread: 019e12f0-43a3-7e31-bcf8-1e1bb4f83093
codex-verdict: accept-with-modifications
decision: YES — code-oz exceeds, two prompt-adjacent borrows under M-SPEC1 (revised per Codex)
---

# Synthesis: prd-taskmaster comparison, post-Codex debate

## What changed after the debate

Codex's verdict on the original borrow set was `accept-with-modifications`. Six findings survived the round trip and force changes to the comparison. The three I verified against source:

1. **The vague-language vocabulary list is 15 terms, not 14.** Verified at `script.py:95-99` — the implemented `VAGUE_WORDS` is `fast, quick, slow, good, bad, poor, user-friendly, easy, simple, secure, safe, scalable, flexible, performant, efficient`. The briefing dropped `poor` when listing the candidate vocabulary. The pinned vocabulary in code-oz's contract update must use all 15 terms.

2. **`SpecLoadError` is the hard-fail authority that gates `GATE_DEFINE_PASSED.json`.** Verified at `src/artifacts/errors.ts:5-15` (the `SpecLoadErrorCode` union) and `src/commands/approve.ts:213-215` (approval re-runs `parseSpec` and refuses the gate write on `SpecLoadError`). The borrow's "zero new authority" claim only holds if `spec_vague_language` and `spec_goals_underspecified` are *not* added to `SpecLoadErrorCode`. They must live in a parallel diagnostic surface (`SpecLintIssue` or similar), not in the parser-error path.

3. **The reference `validation-checklist.md` is stale relative to the implementation.** The checklist says executive-summary 50–200 words; `script.py:267-275` ships 20–500. The checklist scoring says `/60` with missing-detail penalties; the script computes `/57` with vague-only penalty. Treating the checklist as authoritative would import wrong heuristics. The borrow uses `script.py` as the only authoritative source.

Three findings I accepted on Codex's read without re-verification, because they are doc-consistency issues:

4. **prd-taskmaster's authority surface is larger than the briefing said.** The skill grants `Write`, `Edit`, `Bash` allowed-tools; defines four execution modes (Sequential / Parallel / Full Autonomous / Manual) up to 5 concurrent tasks; auto-completes USER-TEST tasks in Full Autonomous; runs `git reset --hard` in `rollback.sh`. Codex's reading is correct. This *strengthens* code-oz's "no-runtime borrow" stance — code-oz is rejecting a much larger runtime than the briefing acknowledged.

5. **`learn-accuracy.py` is not an adjustment-factor learner; it computes averages.** Verified at `script.py:795-825`. The original COMPARISON overstated the analytics. The rejection rationale stands but the description must be tightened.

6. **TaskMaster is required for the no-existing-PRD path, not optional.** SKILL.md says "Taskmaster Required" and "No proceeding without taskmaster detected". This does not change the borrow set; it tightens the description.

A nit Codex caught is real: the briefing has 7 open questions but the original COMPARISON listed only 5 different debate inputs. That drift is fixed in the corrected COMPARISON.md.

## Revised decision

**YES — code-oz exceeds, with two diagnostic-only prompt-adjacent borrows. Both bundle under M-SPEC1.**

The strategic call (code-oz exceeds; no runtime borrow; two narrow refinements) is unchanged. The implementation cadence is unchanged (one milestone, M-SPEC1). What changes is the *implementation discipline*: B1 and B2 must be diagnostic-only (warning-only), must live outside `SpecLoadError`, must not gate approval, must use 15 words not 14, and must follow Codex's recommended scope.

## Borrow set, revised

| Borrow | Status | Milestone | Scope |
|---|---|---|---|
| **B1 — Vague-language linter on SPEC.md** | Accepted with revisions | M-SPEC1 | Diagnostic-only `lintSpecQuality` helper in `src/artifacts/spec.ts`, separate from `parseSpec`. Pin all 15 terms in `docs/references/spec-contract.md`. Evaluate per SPEC bullet. Suppress when the same bullet contains an explicit metric or named control. Surface as `spec_vague_language` warning, not `SpecLoadErrorCode`. Log only term + section + bullet index — not surrounding sentence. |
| **B2 — Goals sufficiency diagnostic** | Accepted with revisions | M-SPEC1 | Diagnostic-only warning `spec_goals_underspecified`, fires only when Goals has *fewer than 2 bullets AND fewer than 15 total words* (AND, not OR). Hard contract stays at ≥1 bullet per section. No new minimum-content rule in the parser. |

## Authority footprint, finalized

| Surface | Before M-SPEC1 | After M-SPEC1 | Rule 20 verdict |
|---|---|---|---|
| Phase taxonomy | DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP | unchanged | OK |
| Gate files | `GATE_DEFINE_PASSED.json` etc. | unchanged | OK |
| Artifact: SPEC.md | six bullet-only sections, sha256-bound | unchanged | OK |
| Hard parser errors | `SpecLoadErrorCode` (10 codes) | unchanged | OK — diagnostics live elsewhere |
| Diagnostic surface | none for SPEC | new `SpecLintIssue` parallel surface | new authority? **No** — diagnostics do not gate writes or approvals |
| Approval flow | `parseSpec` → sha256 → `GATE_DEFINE_PASSED.json` | unchanged | OK |
| Events | as defined in `state/schemas.ts` | unchanged | OK |
| Config | `.code-oz/config.yaml` budgets/phases | unchanged | OK — vocabulary is contract, not config |

Net Rule 20 footprint: zero new authority. M-SPEC1 ships under the existing DEFINE authority as a refinement of the SPEC contract, with one new diagnostic surface that does *not* feed the gate writer or `SpecLoadError`.

## What did not change

- Cross-family REVIEW remains code-oz's strongest gate, far stronger than prd-taskmaster's scoreboard.
- File-based gates with sha256 binding remain pinned per Rule 1.
- Run-level budgets remain pinned per Rule 19.
- Privacy by default remains pinned per Rule 13; the linter logs term + section + bullet index, never surrounding prose.
- Eight prd-taskmaster mechanics remain rejected: USER-TEST checkpoints, datetime tracking, learn-accuracy, security-audit regex, rollback tagging, TaskMaster delegation, CLAUDE.md generation, calc-tasks heuristic.

## Implementation order for M-SPEC1 (when scheduled)

The milestone is not yet on the roadmap — it is a recorded intent. When it lands the order will be:

1. Update `docs/references/spec-contract.md` with the pinned 15-term vocabulary list and the Goals-sufficiency heuristic. Doc-only commit.
2. Add `SpecLintIssue` and `lintSpecQuality` to `src/artifacts/spec.ts`. Helper is pure: `(spec: ParsedSpec) → readonly SpecLintIssue[]`.
3. Wire the linter into the DEFINE completion message so users see warnings *after* `GATE_DEFINE_PASSED.json` is written. Approval semantics untouched.
4. Unit tests:
   - all 15 vocabulary terms trigger
   - qualifier suppression: bullet containing a number or named control silences the match in that bullet
   - Goals fires only on AND condition (≥2 bullets satisfies, ≥15 words satisfies, both fail required)
   - lint output has no content beyond term + section + bullet index
5. No event schema change. No config change. No new gate file.

If at any point the implementation drifts toward `SpecLoadError`, a new event type, or a config knob — stop and re-debate. Those are new authority footprints.

## Doc updates that ship now (this synthesis session)

- `docs/comparison/08-prd-taskmaster/COMPARISON.md` — corrected to use the 15-term vocabulary, restate prd-taskmaster's wider runtime authority, tighten the `learn-accuracy` claim, mark TaskMaster as required-for-default-path, and align debate inputs with the seven briefing questions.
- `docs/comparison/README.md` — add the session 08 row with date and decision; remove `prd-taskmaster` from the unaudited backlog.

## Implementation closure

- Branch: `worktree-m-spec1-prd-taskmaster-borrow`
- Commits:
  - `0f160835ef6b3c014c7875a6442e879202a36301` docs(spec-contract): pin M-SPEC1 vague-language vocabulary + Goals sufficiency heuristic
  - `080b01a9b0aa1d372ad9a4b4e9062f8202872bdc` feat(spec): add lintSpecQuality diagnostic helper (M-SPEC1 B1+B2)
  - `5f27f056f22d6f84615b1abe27137156c2f21e3f` feat(define): surface lintSpecQuality warnings in DEFINE completion (M-SPEC1)
  - `a1fc14ff47a213104d1cc480b150905cde807c94` test(spec): add lintSpecQuality coverage (M-SPEC1)
- Test count delta: 3109 total before (3108 pass, 1 skip) to 3119 total after (3118 pass, 1 skip).
- Confirmation: no `SpecLoadErrorCode`, no event schema, no config knob, and no new gate file was added.
