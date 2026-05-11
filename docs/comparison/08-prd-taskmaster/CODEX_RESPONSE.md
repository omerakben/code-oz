---
name: codex-response-prd-taskmaster
companion-docs: CODEX_BRIEFING.md (input), COMPARISON.md (analysis), SYNTHESIS.md (post-debate locks)
target: Codex's verdict on the prd-taskmaster comparison and borrow set
status: closed
date: 2026-05-10
codex-thread: 019e12f0-43a3-7e31-bcf8-1e1bb4f83093
codex-model: gpt-5.5
codex-effort: xhigh
codex-sandbox: read-only
verdict: accept-with-modifications
---

# Codex response — prd-taskmaster comparison

**Verdict: accept-with-modifications.**

## Open questions

1. **Cadence:** Bundle B1 and B2 under one M-SPEC1 milestone. They touch the same DEFINE artifact, same parser/writer boundary, and same contract family, so this fits Rule 20 as long as they remain diagnostics and do not introduce a new gate, event type, config authority, or approval step. The SPEC contract is already the pinned authority for six ordered H2 sections with bullet-only bodies in `docs/references/spec-contract.md:31-80`, and Rule 20 permits one coherent boundary per milestone in `CLAUDE.md:42`.

2. **Vocabulary authority:** Use contract, not config. I agree with the briefing's direction, but the contract must be source-corrected: prd-taskmaster's implemented `VAGUE_WORDS` list includes `poor` and has 15 terms, not 14, at `/Users/ozzy-mac/Projects/agents/templates/prd-taskmaster/script.py:95-105`. Putting this in `.code-oz/config.yaml` would create a project-local knob that can weaken deterministic validation behavior over time. Pin the list in `docs/references/spec-contract.md` and mirror it in code.

3. **USER-TEST resurrection:** Reject it for M-SPEC1. A `cumulative_checkpoint_due.json` gate could be a valid future product idea, but it is not a small prd-taskmaster borrow and it is a new approval authority. prd-taskmaster inserts USER-TEST tasks every 5 implementation tasks in `script.py:514-563`, while code-oz already has run-level budget intervention policy under Rule 19 and Rule 21 measurement discipline in `CLAUDE.md:41-43`. If cumulative checkpoints ever land, they need their own milestone and measurable trigger, not a hidden add-on to SPEC linting.

4. **Generalization:** Keep the first implementation in `src/artifacts/spec.ts`, but do not wire it into `parseSpec` as a throwing error. The existing parser is the structural contract and throws only hard validation failures in `src/artifacts/spec.ts:275-514`; approval reuses that hard parse before sha256 binding in `src/commands/approve.ts:193-224`. Add a local `lintSpecQuality` or equivalent diagnostic helper in the same module, then extract to a shared `lint-vagueness.ts` only after PLAN, REVIEW, or another artifact actually needs it.

5. **Vocabulary validity:** Disagree with shipping prd-taskmaster's list "verbatim" as described in the briefing, because the briefing did not quote the implemented list verbatim. The source includes `poor`, and the regex does not implement the "unless accompanied by a number or specific criterion" exception; it flags all matches in requirements and all matches in the full document for warnings at `script.py:340-350` and `script.py:451-459`. For v1, pin the 15-term source-corrected list, evaluate per SPEC bullet, and suppress only when the same bullet contains an explicit metric or named control. Do not add `robust`, `seamless`, `intuitive`, or `minimal` until code-oz has false-negative evidence.

6. **Cross-rule check:** Partly disagree with "zero hidden authority" as currently worded. B1 and B2 have zero new authority only if they are diagnostics outside `SpecLoadError`. The proposed names `spec_vague_language` and `spec_goals_underspecified` must not be added to `SpecLoadErrorCode` as hard parser issues, because `SpecLoadError` is used to block canonical SPEC writes and define approval, per `src/artifacts/errors.ts:5-15` and `src/commands/approve.ts:213-224`. If they become config-driven, event-persisted, or approval-blocking, that is a new authority footprint.

7. **Privacy footprint:** Partly disagree with logging the surrounding sentence. The source prd-taskmaster warning records only the matched term and suggestion in `script.py:454-459`; code-oz should do the same plus section and bullet index. code-oz already logs ask-me user input and persona replies verbatim in local `events.jsonl` with gitignored retention guidance in `docs/references/spec-contract.md:181-187`, so there is no need to add more local sensitive content for a linter warning.

## New findings

- **fix-soon — prd-taskmaster validator mechanics are misread in multiple places.** The reference checklist says executive summary 50-200 words in `validation-checklist.md:11-14`, but the implemented script passes 20-500 words in `script.py:267-275`. The reference scoring says `/60` and mentions missing-detail penalties in `validation-checklist.md:290-308`, but the script computes max score from 45 + 12 = 57 and only deducts vague-language penalty in `script.py:469-498`. Fix the comparison to treat `script.py` as implementation truth and the checklist as stale or aspirational.

- **fix-soon — prd-taskmaster authority surface is understated.** The briefing says authority ends at PRD creation plus USER-TEST insertion, but the skill allows autonomous execution, Write/Edit/Bash tools, branch creation, merge to main, checkpoint tags, parallel execution, and full autonomous mode that auto-completes USER-TEST tasks in `SKILL.md:9-16` and `SKILL.md:259-288`. The generated rollback script also runs `git reset --hard` in `script.py:762-786`. Fix the docs to say code-oz rejects a much larger runtime authority surface, which strengthens the no-runtime decision.

- **fix-soon — B2 is underspecified as logic.** The briefing says Goals must have at least N bullets and at least M total words in `CODEX_BRIEFING.md:44`, while the comparison says the warning fires only when both thresholds fail in `COMPARISON.md:117-120`. Pick one. I recommend warning only when both fail for v1, because the current SPEC contract allows one-goal specs in `docs/references/spec-contract.md:62-70`.

- **fyi — `learn-accuracy.py` is not an adjustment-factor learner in the current source.** It only calculates average duration, total minutes, and per-task durations from `.taskmaster/state/time-tracking.json` in `script.py:795-825`. Update the rejection rationale so it does not claim a stronger analytics loop than the template implements.

- **fyi — TaskMaster is not merely optional for the normal no-existing-PRD path.** The skill says "Taskmaster Required" and "No proceeding without taskmaster detected" in `SKILL.md:34-39` and `SKILL.md:76-85`. This does not change the borrow set, but the comparison should avoid describing TaskMaster handoff as optional without that caveat.

- **nit — briefing and comparison open-question sets drifted.** The briefing asks seven questions in `CODEX_BRIEFING.md:55-69`, but the comparison still lists five different debate inputs in `COMPARISON.md:141-151`. After synthesis, update COMPARISON so the debate trace is internally consistent.

## Revised borrow set

**B1, M-SPEC1.** Add a warning-only SPEC quality diagnostic for vague language. Contract-pin the 15 implemented source terms: `fast`, `quick`, `slow`, `good`, `bad`, `poor`, `user-friendly`, `easy`, `simple`, `secure`, `safe`, `scalable`, `flexible`, `performant`, `efficient`. Implement outside hard `SpecLoadError` flow, with a diagnostic code such as `spec_vague_language`, and report only term, section, and bullet index. No config knob, no new gate, no new event unless explicitly scoped.

**B2, M-SPEC1.** Add a warning-only Goals sufficiency diagnostic, not an "executive summary" mirror. Suggested v1: `spec_goals_underspecified` warns when Goals has fewer than 2 bullets and fewer than 15 total words. Document that this is a quality heuristic under the existing SPEC contract, not a new minimum content rule. Keep the hard contract at >=1 bullet per section.

**No borrow:** USER-TEST checkpoints, cumulative checkpoint gates, helper scripts, TaskMaster delegation, CLAUDE.md generation, runtime execution modes, rollback tagging, security audit regex, or learn-accuracy analytics. Anything in that set needs its own future milestone under Rule 20.

## What I would do differently if I owned this milestone

I would first correct the comparison docs to match the source, then ship M-SPEC1 as a small diagnostic-only patch: add `lintSpecQuality` in `src/artifacts/spec.ts`, unit-test the vocabulary, qualifier suppression, and Goals floor, surface warnings in the DEFINE completion output, and leave gate approval semantics untouched. I would not add config, event schema, or generalized lint modules until a second artifact needs the same behavior.
