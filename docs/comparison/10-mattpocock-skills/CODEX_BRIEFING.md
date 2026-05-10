# Codex briefing — code-oz vs `mattpocock-skills` comparison

**Goal:** independently challenge the verdict and borrow set in `COMPARISON.md`.
**Sandbox:** read-only.
**Effort:** xhigh.
**Model:** `gpt-5.5` (fall back from `gpt-5.5-codex` / `gpt-5.1-codex-max` if account auth blocks them — see CLAUDE.md "Codex model fallback").

---

## Background

code-oz is at v0.17.0-alpha.0 (M16 closed, 3108 tests). The cross-model peer review rule (CLAUDE.md) requires a Codex round at every milestone and at every comparison decision. This is a comparison decision, not a milestone — but the rule still applies because borrow choices feed milestone planning.

The template under review is **Matt Pocock's `skills` repo** (`~/Projects/agents/templates/skills`, MIT). It's a 13-skill plugin with the **opposite** philosophy from code-oz: anti-process, composable, the user is the orchestrator, *"approaches like GSD, BMAD, Spec-Kit try to help by owning the process… they take away your control."* code-oz **explicitly owns the process**.

The full comparison is in `docs/comparison/08-mattpocock-skills/COMPARISON.md`. Read it first.

## The recommended verdict (to challenge)

> **YES, with selective borrows.** code-oz exceeds the template on 12 dimensions. Borrow set: 6 ranked candidates (B1-B6) + 7 explicit no-borrows (N1-N7). Suggested milestone target: M17 as a "vocabulary + operational discipline pass" bundling all six.

## The borrow set (to challenge)

| ID | Strength | Pattern | Authority cost (claimed) |
|---|---|---|---|
| B1 | strong | Project glossary as DEFINE artifact (`CONTEXT.md` equivalent) | 1 new artifact, 0 phases |
| B2 | strong | VERIFY's "build a feedback loop is *the* skill" rule | 0 — persona prompt edit |
| B3 | medium | Deep-modules architecture vocabulary in REVIEW | 0 — persona prompt + reference |
| B4 | medium | 3-true ADR gate (hard-to-reverse + surprising + real trade-off) | 0 — persona prompt edit |
| B5 | small | Tagged-and-grepped `[DEBUG-<runId>]` instrumentation | 0 — persona prompt edit |
| B6 | small | Provenance prefix (`> *AUDIT-<runId>:*`) on AUDIT findings | 0 — artifact contract edit |

## The no-borrows (to challenge)

| ID | Pattern | Reason recommended |
|---|---|---|
| N1 | `prototype` skill | Adding a prototype phase = rule-20 violation |
| N2 | `caveman` token-compression mode | High tokenization risk; defer to v0.2 measured experiment |
| N3 | `to-prd` user-stories template | SPEC.md already covers it |
| N4 | `zoom-out` skill | REPO_CONTEXT (rule 18) already covers it |
| N5 | `triage` 5-state issue-tracker state machine | Doesn't map cleanly to AUDIT |
| N6 | `setup-matt-pocock-skills` per-repo bootstrap | `code-oz init` already covers it |
| N7 | `write-a-skill` meta-skill | code-oz isn't a skills repo (note: persona-prompt authoring is a v0.2 affordance gap) |

## Debate prompts

Challenge each in turn. Cite specific files. **Do not defer to my ranking.** I want disagreement where it's earned.

### Q1 — Borrow count and authority budget

I claim 4 of 6 borrows are zero-cost persona-prompt edits. Pressure-test that.

- Does shipping B2 + B3 + B4 + B5 in one pass *actually* count as zero authority cost? Or does the cumulative behavioral change to multiple personas constitute a real authority shift, even though no new gate or artifact appears?
- Is the rule-20 "one new authority boundary per milestone" rule violated by bundling B1 (new artifact) with B2-B5 (prompt edits) in M17?
- If you'd split the borrows across two milestones, which ones go in M17 and which defer to M18?

### Q2 — B1 (project glossary) — is the artifact slot worth its weight?

The pattern: DEFINE persona maintains `state/GLOSSARY.md` updated inline during the alignment interview. Subsequent personas receive it in `ProviderRequest.files`.

- Does this overlap with the existing `SPEC.md` artifact in a way that wastes tokens (the same vocabulary lives in both)?
- Should the glossary be a *section* of SPEC.md instead of a separate artifact?
- Is the schema scope I proposed (term, one-sentence definition, avoid-aliases) correct, or should v1 also include relationships/example dialogues?
- Risk I may have missed: terminology drift across runs. If GLOSSARY.md is run-scoped (lives in `state/`), it doesn't carry across runs. Should it be project-scoped (lives at repo root, like CLAUDE.md)?

### Q3 — B2 (VERIFY Phase-1-as-the-skill) — prompt edit or contract change?

Matt's `diagnose` skill puts feedback-loop construction as Phase 1 and explicitly says: *"Do not proceed to Phase 2 until you have a loop you believe in."*

- If VERIFY's contract changes so that VERIFY.md cannot be produced without an explicit feedback-loop description, that *is* a contract change, not a prompt edit. Which is correct?
- Should the borrow include a new contract field (`VERIFY.md.feedback_loop_description`) or stay as a prompt-only nudge?
- Does enshrining "10 ways to construct a loop" in a reference appendix risk persona-prompt bloat, or is it the right shape (similar to how universal-rules.md is referenced)?

### Q4 — B3 (deep-modules vocabulary) — does it constrain reviewer-panel models inconsistently?

Matt's `LANGUAGE.md` has 8 architecture terms (Module / Interface / Implementation / Depth / Seam / Adapter / Leverage / Locality) plus 3 principles (deletion test, interface = test surface, 1-adapter-hypothetical / 2-adapter-real).

- M14 reviewer panel runs simultaneous reviews across provider families. If the vocabulary is non-standard (e.g., "seam" instead of "boundary"), do non-OpenAI / non-Anthropic models choke on it?
- Should this borrow defer until M14.1 (reviewer-isolation) lands so we can measure cross-family vocabulary acceptance?
- Or is the vocabulary *strict* enough that constraining the reviewer is a feature, not a bug?

### Q5 — N2 (`caveman`) — should we run the experiment?

The recommendation is "defer to v0.2 measured experiment." But M13 role-cost policy gives us the telemetry now.

- Is the right call to run a small POC at M17 measuring inter-agent token reduction with caveman vs full prose, then decide?
- What's the measurement contract (per-role token delta on identical task fixtures)?
- Or is the tokenization risk fatal enough that the POC isn't worth running?

### Q6 — N5 (`triage`) — does code-oz need an issue/finding state machine?

I rejected this because code-oz isn't an issue-tracker integration. But:

- AUDIT.md (brownfield) currently has freeform findings. A 5-state classification (`needs-info`, `ready-for-plan`, `ready-for-human`, `wontfix`, `out-of-scope`) might be load-bearing.
- Should AUDIT findings be classified into a state machine, even though the issue tracker integration is out-of-scope?
- Or does the existing AUDIT contract already encode this implicitly?

### Q7 — Strategic risk: does the philosophical disagreement matter?

Matt's thesis is *"approaches that own the process take away your control."* code-oz **explicitly owns the process**.

- Is there a missed risk in code-oz's design that this template's anti-process stance reveals?
- Does code-oz need an "escape hatch" mode where the process is voluntary (e.g., a `--ad-hoc` flag that skips gates)?
- Or is the AFK-runtime thesis (autonomous, gate-driven) intrinsically incompatible with the IDE-resident-developer thesis (manual, composable), and the only honest answer is "they're different products"?

## Output format

Write `CODEX_RESPONSE.md` in `docs/comparison/08-mattpocock-skills/`. Structure:

1. **Independent verdict.** Agree / partially-agree / disagree on YES-with-selective-borrows. Cite specifics.
2. **Per-borrow review.** For each of B1-B6 + N1-N7: keep / modify / reject, with rationale.
3. **Per-debate-prompt review.** For Q1-Q7 above: your answer, with citations into `~/Projects/agents/templates/skills/skills/<skill>/SKILL.md` where relevant.
4. **Missed risks.** What did I miss that you'd flag block-now / block-next-milestone / nit?
5. **Final ranking.** Re-rank the borrow set if you disagree with mine.
6. **Push verdict.** `push` / `fix-first` / `debate-required` (per CLAUDE.md cross-model peer review rule).

## Constraints

- Read-only sandbox. No writes outside `docs/comparison/08-mattpocock-skills/CODEX_RESPONSE.md`.
- Cite the file paths you read (the template under review is at `~/Projects/agents/templates/skills/`).
- Don't defer to my ranking. Disagree where earned.
- Keep your response under ~3500 words.
