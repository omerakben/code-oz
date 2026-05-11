---
session: 06-codex
template: openai/codex
date: 2026-05-10
codex-thread: 019e12ec-1f53-7982-90f1-9b07ce8eab05
codex-model: gpt-5.5
codex-effort: xhigh
codex-sandbox: read-only
final-verdict: push
companion: ./COMPARISON.md, ./CODEX_BRIEFING.md, ./SYNTHESIS.md
---

# Codex response — code-oz vs codex (session 06)

Verdict: **push** (proceed with B1, B2, B4, B6 with modifications; keep B3 and B5 demand-gated; accept R1, R2, R3 rejections; tighten L1 wording). No architectural miss requires another debate round before merging the comparison.

## Verdict table

| Item | Verdict | Rule/doc tie | Modification |
|---|---|---|---|
| B1 | accept-with-modifications | Rule 16 allows scope-specific rules only if universal rules remain first; Rule 19/21 push against multiplying reviewer calls without measured signal. | Start as prompt/checklist decomposition inside each reviewer, not 12-15 nested provider calls by default. Escalate to specialist sub-passes only for high-risk diffs or after events show missed-review patterns. |
| B2 | accept-with-modifications | Rule 9 cannot stay `.ts`-only once `scripts/*.py` exists. | Generalize rule 9 to any executable runner. Put `exec` permissions in `SKILL.md` frontmatter or the code-oz manifest, with command, interpreter, cwd, file roots, network, env, secrets, timeout, and output caps. |
| B3 | accept-with-modifications | Rule 20 makes WATCH a new authority boundary; Rule 21 requires measurable value before new agentic surfaces. | Pin the pattern, but do not call it a phase yet. Reopen as a PR-steward/GitHub integration milestone only after real SHIP/PR usage exists. |
| B4 | accept-with-modifications | Rule 19 says budgets are config, not vibes. | Presets must expand to explicit resolved config and be logged/auditable. Avoid hidden semantic modes; explicit keys override preset values. |
| B5 | accept | Rule 19 makes `events.jsonl` the canonical run accounting source. | No change now. Future OTEL must be one-way export from persisted events, never a second event authority. |
| B6 | accept-with-modifications | Rule 3 requires PLAN before code; the current PLAN prompt forbids writing artifacts but not all mutation drift. | Add it to `src/prompts/plan-system.md`, not the non-existent `src/prompts/personas/plan.md`. Include installs, formatters, migrations, codegen, and tracked-file edits as forbidden in PLAN. |
| R1 | accept | Rule 20 and W4 roadmap defer real OS/container sandboxing; code-oz currently delegates runner sandboxing. | Keep rejection, but document exact execution surfaces under L1. |
| R2 | accept | Provider contract + Rule 2 make multi-provider/cross-family first-class. | None. |
| R3 | accept | Rules 1 and 7 lock phase graph + Markdown artifacts over free-form interaction. | None. |
| L1 | accept-with-modifications | Provider contract is the right doc, but the proposed wording is too broad. | Replace "Code-Oz never spawns shells directly" with "Code-Oz does not provide general shell execution; code-oz-owned execution is limited to no-shell argv runners or manifest-gated skill scripts, while provider CLIs own their subprocess sandbox/approval model." |

## Per-item rationales

**B1.** Sharpens rule 16 rather than diluting it if the universal sheet stays first, but the comparison underprices the cost of nested specialist prompts inside a 3-reviewer panel. Make the first borrow a structured specialist review rubric plus optional targeted sub-pass, all counted under `budgets.global`.

**B2.** A real borrow. Codex's `SKILL.md + references/ + scripts/ + agents/` layout is better than code-oz's current single-file model, but any executable script is an escape hatch. Do not leave the rule scoped to `.ts`.

**B3.** Should stay demand-gated. A WATCH/PR steward loop is valuable, but it introduces continuing authority after SHIP, GitHub write behavior, retry policy, and possibly auto-push. That is not a trailing-edge tweak.

**B4.** Useful only if it reduces operator config burden without hiding policy. Treat presets as config templates or aliases that expand to visible budget and permission fields.

**B5.** Correctly deferred. OTEL is useful when there is a dashboard or support workflow; before that, it risks creating telemetry ceremony. The canonical source remains `events.jsonl`.

**B6.** Worth adding. PLAN already owns `PLAN.md` and `SOURCE_CHECK.md`, but the current prompt does not fully block "one quick mutation while planning" drift.

**R1, R2, R3.** Correct rejections. Code-oz should not import Codex's sandbox crates, single-primary provider shape, or free-form interaction model.

**L1.** Should land, but with narrower language. Code-oz does spawn provider CLIs and runs no-shell validation commands; the lock should prohibit unmanifested/general shell authority, not pretend no subprocesses exist.

## Missed borrows

1. **M1 — PR-body discipline (`codex-pr-body` skill).** Worth absorbing for future SHIP/GitHub integration: explain why first, then net change, preserve existing body content, include intentional verification, avoid local absolute paths. Was not in the comparison.

2. **M2 — High-touch module size / core-bloat review sub-skill.** Codex AGENTS.md has a useful rule on this. Code-oz should turn that into a review sub-skill for large phase/orchestrator files, especially after M16's C9 coupling bugs.

3. **M3 — Agent bill-of-materials (lightweight, parked).** Don't mirror the `agent-identity` crate, but the bill-of-materials idea is worth parking: `agent_version`, `agent_harness_id`, and `running_location` as provenance metadata for future doctor bundles or integration traces.

## Rule-violation flags

- B1 as written can violate Rule 19/21 if it blindly multiplies provider calls under panel review without measured signal.
- B2 violates the spirit of Rule 9 unless `scripts/*.py`, shell scripts, and future runners are covered by the same manifest discipline.
- B2's `agents/` subdirectory can violate Rule 16 unless every subagent prompt imports universal rules first and cannot override them.
- B3 would violate Rule 20 if scheduled now as a post-M16 milestone without a single, explicit new authority boundary.
- B5 would violate the event-log authority model if OTEL becomes a live parallel event plane rather than a derived export.
- L1's proposed "never spawns shells directly" wording is inaccurate enough to become policy debt.

## Final overall verdict

**push.** Proceed with B1, B2, B4, and B6, but record the modifications above in the synthesis. Keep B3 and B5 demand-gated. No architectural miss requires another debate round before merging the comparison.
