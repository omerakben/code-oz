# Codex planning review — refactor session 2026-05-01

**Thread:** 019de514-0165-7eb3-8512-1eb9e8a645c3
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** docs/research/CODEX_BRIEFING_REFACTOR_2026-05-01.md
**Audit:** docs/research/REFACTOR_AUDIT_2026-05-01.md

## Verdict
accept-with-modifications

## Blockers before code
No runtime blocker, but the repo-truth claim is stale: `git status --short --branch` is not clean except `TODO.md`. It also shows these untracked files: `docs/research/CODEX_BRIEFING_REFACTOR_2026-05-01.md`, `docs/research/REFACTOR_AUDIT_2026-05-01.md`, and `docs/research/TEMPLATE_FOLDER_COMPARISON_2026-05-01.md`.

If `REFACTOR_AUDIT_2026-05-01.md` is the durable tech-debt register for F7/F8/F9/F10, it must be committed in this refactor session or explicitly replaced by another tracked surface. Otherwise the "visible debt" claim is not durable.

## Scope corrections
F2 should stay strict-minimal: require a non-empty model when present, using `trim().length > 0`. Do not add a model-name regex now. `xai-grok-*` is fine, but a regex like `^[a-z0-9._-]+$` will likely age badly once router/cloud model IDs with slashes, colons, or vendor prefixes appear.

F2 is under-scoped if it only touches `src/agents/schema.ts:1065-1071`. `src/config/load.ts:251-260` rejects `""` but allows whitespace-only `model: "   "`, which can still flow through `src/providers/manifest.ts:127-136` to adapters. Add the same trim-empty check and a config test.

Consider validating `agent_invoked.model` in `src/state/events.ts`. `build_provider_recorded.model` rejects empty values, but `agent_invoked` validation currently checks required fields and debate correlation only, not `model` (`src/state/events.ts:175-243`). Since `agent_invoked.model` is now a known M12 field (`src/state/schemas.ts:221-228`), rejecting empty/blank when present is not a schema expansion.

F3 should avoid "snapshot-on-init is not implemented in v0.1" unless the version anchor is doing real work. Better wording: both call sites load config before bootstrap; `runCommand()` does it at `src/commands/run.ts:61-62`, and PLAN dispatch does it at `src/commands/run.ts:507-508`. Saved config changes before the next dispatch can affect routing. Snapshot-on-init is not implemented; if needed, it is M16+ design space.

The four proposed commits do not sneak in PE-1, M13, M14, M15, or M16+ scope if the changes stay to validation/docs/provenance. The config whitespace fix and optional event-field validation are still M12 model-propagation hardening, not PE-1 vocabulary work.

## Template-pattern decisions
F1 is correctly characterized for project hygiene. The local evidence is strong: `agentic-coder` contains only `src/`; `Tool.ts:1-13` imports Anthropic SDK resource types plus internal `Command`, `CanUseToolFn`, and `ThinkingConfig`; `QueryEngine.ts:1-19` imports `bun:bundle`, `src/bootstrap/state.js`, `accumulateUsage`, `EMPTY_USAGE`, and Claude API/logging internals. `claude-code-main` is absent from the current 16-folder template list.

Treat `agentic-coder` as the same provenance class under a relabel, not as a clean independent overlap. I did not fetch an external leak copy, but the safe project decision is hard exclusion.

Use path B, with examples: exclude any folder whose source matches the 2026-03-31 npm `.map` leak regardless of folder name, and name both `claude-code-main` and current `agentic-coder` as examples in `CLAUDE.md:68`. This is more durable than enumerating only today's folder names.

Borrow-now remains zero. byterover-cli stays borrow-later after PE-1 demand evidence, not a PE-1 adapter pattern.

## Bugs or stale assumptions Claude missed
Whitespace-only model is the main missed bug. A project-local persona with `model: "   "` still passes today if F2 is implemented with raw `length`, and a company row with `model: "   "` passes today in `mergeCompanyRow`. The fix should be trim-empty across both surfaces.

`agent_invoked.model` is not read-validated even though `build_provider_recorded.model` is. Load-time validation should prevent normal bad writes, but the event reader should not silently accept a known empty model field.

There is a config-read race, but not specifically between `loadConfig` and `bootstrap` after `loadConfig` returns. The config object is stable once passed to `bootstrap({ cwd, config })`. The real race is `loadConfig()` reading `.code-oz/config.yaml` while a non-atomic writer truncates/rewrites it: `src/config/load.ts:68-102` can observe invalid YAML, partial YAML, or an empty file that resolves to `DEFAULT_CONFIG`. Do not fix this in the refactor unless you want to introduce a config-write/atomic-save contract. F3 should say "saved before dispatch," not imply deterministic behavior while the file is being written.

Tag precision: `HEAD` is `88f8867`, but `v0.12.0-alpha.0` points at `e5919ae`, the commit before the merge commit. That is fine, but wording should avoid implying the tag is on HEAD.

## Implementation order changes
Move provenance hygiene first. Recommended order:

1. `chore(provenance): hard-exclude leaked-source relabels`
   Update `CLAUDE.md` influence-library exclusion with the durable rule and current examples. Add `TODO.md` to `.gitignore`.

2. `feat(agents): reject blank model bindings`
   Update `src/agents/schema.ts`, `src/config/load.ts`, and optionally `src/state/events.ts`; add tests for empty and whitespace-only persona/config models, plus `agent_invoked.model` if the event validator is touched.

3. `docs(refactor): clarify config-current resume routing`
   Fix `docs/contracts/COMPANY.md:146` with config-current, not snapshot, wording.

4. `docs(refactor): tighten M12 status surfaces`
   Compress `CLAUDE.md:9` and `docs/design/ROADMAP.md:376`.

Also decide where the three untracked research docs land. If the audit remains the tech-debt register, include it in a docs commit.

## What to defer
Defer F7 archived-doc annotations if the audit is committed and searchable. The authoritative surfaces are already `COMPANY.md` and `ROADMAP.md`.

Defer F8 version-string single-sourcing. It touches fixtures and package/version import policy, and should not be bundled into PE-1.

Defer F9 dead config keys. Removing or repurposing `defaultProvider` / `models.primary` / `models.reviewer` is a config-contract decision, not a cleanup nit.

Do not create `docs/research/PATTERNS_PARKING_LOT.md` yet. Commit the audit first; add a parking-lot document only if repeated sessions prove the audit files are too fragmented.

## Final recommendation
Proceed, but with the modified order and broadened F2 hardening. The clean close condition should be: provenance rule updated first, blank model rejected consistently, COMPANY wording made config-current, verbosity compressed, untracked research docs either committed or intentionally excluded, then full validation outside this read-only sandbox.

Validation I could run here: `bun run typecheck` passed, and `bun test tests/agents-schema.test.ts` passed 37/0. The temp-dir test targets were blocked by sandbox `EPERM`, not by code behavior.

---

## Synthesis (Claude, 2026-05-01)

**Verdict absorbed:** accept-with-modifications. Codex's modifications make the audit materially stronger and close two real holes I missed. Adopting all five.

### Locks (revised plan, in landing order)

1. **Implementation order flipped:** provenance first, blank-model second, COMPANY wording third, verbosity compression fourth, research-docs commit last (so the audit IS the durable register Codex flagged).

2. **F2 broadened to three layers** (Codex Bugs Claude missed #1 + #2):
   - `src/agents/schema.ts` — non-empty + trim check on persona frontmatter `model`.
   - `src/config/load.ts` — extend `mergeCompanyRow` to reject whitespace-only (`trim().length === 0`) in addition to empty string.
   - `src/state/events.ts` — `agent_invoked.model` validator rejects empty/blank when present (mirrors `build_provider_recorded.model`).
   - Tests cover empty + whitespace-only on all three layers.

3. **F2 stays strict-minimal:** non-empty + non-blank only. No format regex (`^[a-z0-9._-]+$` would age badly with router/cloud model IDs that include slashes/colons/vendor prefixes).

4. **F3 wording revised** (Codex Scope corrections + Bugs missed #3): name the actual line numbers (`src/commands/run.ts:61-62` and `src/commands/run.ts:507-508`); replace "snapshot-on-init is not implemented in v0.1" with config-current wording without the version anchor. Acknowledge "saved before dispatch" — does not promise deterministic behavior during a non-atomic write.

5. **F1 path B chosen with examples:** durable rule ("any folder whose source matches the 2026-03-31 npm `.map` leak is excluded regardless of folder name") + name both `claude-code-main` and `agentic-coder` as current examples.

6. **Audit precision fixes** (Codex Blockers + Tag precision):
   - "Current repo truth" line in REFACTOR_AUDIT_2026-05-01.md will be updated to acknowledge the four newly untracked artifacts (audit + briefing + comparison + Codex response) as session-product, committed in commit 5.
   - Tag wording adjusted: `v0.12.0-alpha.0` points at `e5919ae`, not HEAD; HEAD is the merge commit `88f8867`.

7. **Defer-list confirmed:** F7 (archived M11 prose), F8 (version single-source), F9 (dead config keys), no parking-lot doc yet.

### Out-of-scope confirmed by Codex

- PE-1 / M13 / M14 / M15 / M16+ — confirmed not preempted by any of the six commits.
- Config-write race — Codex flagged it as a real bug but explicitly said "Do not fix this in the refactor." Recorded as a new tech-debt entry under safe-to-park.

### Six commits (revised)

1. `chore(provenance): hard-exclude leaked-source relabels` — CLAUDE.md durable rule + TODO.md gitignore.
2. `feat(agents): reject blank model bindings` — three-layer fix + tests.
3. `docs(refactor): clarify config-current resume routing` — COMPANY.md.
4. `docs(refactor): tighten M12 status surfaces` — CLAUDE.md + ROADMAP.md.
5. `docs(refactor): commit refactor session research artifacts` — TEMPLATE_FOLDER_COMPARISON + REFACTOR_AUDIT + CODEX_BRIEFING_REFACTOR + this CODEX_RESPONSE_REFACTOR (durable tech-debt register).

(Five commits, not six; commit 5 absorbs the docs-commit step Codex flagged.)
