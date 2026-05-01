# code-oz refactor audit — 2026-05-01

Inter-milestone audit between M12 (closed) and PE-1 (xAI direct HTTP, deferred until this session ships). Goal: surface bugs, verbosity, and tech debt that hide between milestone reviews; keep the spine clean for PE-1 without scope creep.

## Current repo truth (at audit-write time, before this session's commits)

- **Branch:** `main`, in sync with `origin/main`. Working tree had `?? TODO.md` plus three untracked research artifacts produced this session (audit + briefing + comparison) — Codex flagged this in `CODEX_RESPONSE_REFACTOR_2026-05-01.md` "Blockers before code"; absorbed by committing this audit + the briefing + the comparison + the Codex response in commit 5 below.
- **HEAD before session:** `88f8867 Merge feat/m12-company-roster: M12 Company roster (v0.12.0-alpha.0)`.
- **Tag state:** `v0.12.0-alpha.0` is latest (annotated tag points at `e5919ae`, the round-1-nit-closure commit, not at the merge HEAD); `v0.{8..11}.0-alpha.0` precede.
- **Tests:** 1917 pass / 1 skip / 0 fail (offline, FakeProvider). `bun run typecheck` clean.
- **M12 status:** functionally and publicly closed. Codex M12 review (`docs/research/CODEX_REVIEW_M12.md`) verdict `push` (round 1, three nits closed in `e5919ae`). Two risks deferred by Codex are surfaced as findings #2 + #3 below.
- **Active milestone:** **none.** This session is a deliberate pause between M12 and PE-1. PE-1 (xAI direct HTTP) starts after this session closes per `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md`.
- **Companion artifacts written this session:** `TEMPLATE_FOLDER_COMPARISON_2026-05-01.md` (16 templates), this audit, and `CODEX_BRIEFING_REFACTOR_2026-05-01.md` (the planning briefing for the Codex round that follows).

## Findings (ranked by severity)

### Finding 1 — `agentic-coder` is the leaked Claude Code source under a renamed folder

- **Severity:** fix-soon
- **Evidence:** `~/Projects/agents/templates/agentic-coder/src/{Tool.ts,QueryEngine.ts,costHook.ts,dialogLaunchers.tsx,projectOnboardingState.ts}` exists; folder ships only `src/` — no `README`, no `LICENSE`, no `package.json`. `Tool.ts` imports `@anthropic-ai/sdk/resources/index.mjs`, internal `Command`, `CanUseToolFn`, `ThinkingConfig`. `QueryEngine.ts` imports `bun:bundle`, `src/bootstrap/state.js`, `accumulateUsage`, `EMPTY_USAGE`, `src/services/api/claude.js`, `src/services/api/logging.js`. The import surface, filename set, and bundler-internal references match the publicly leaked Claude Code source dated 2026-03-31.
- **Why it matters:** CLAUDE.md "Influence library" excludes `claude-code-main` by name; that folder is no longer in `templates/`. The same provenance has surfaced under a different folder name. Pattern borrow from `agentic-coder` would silently violate the project provenance policy (`memory/project_provenance_policy.md`: "ban borrowing from claude-code-main; clean-room only").
- **Recommended action:** Update CLAUDE.md influence-library exclusion to either name `agentic-coder` explicitly *and* state a forward-looking rule: "any folder whose source matches the 2026-03-31 .map leak is excluded regardless of folder name." Codex round below will choose between enumeration and durable rule.
- **Scope bucket:** this session.

### Finding 2 — Persona frontmatter `model: ""` passes validation

- **Severity:** fix-soon
- **Evidence:** `src/agents/schema.ts:1065-1071`:
  ```ts
  if ('model' in data && data.model !== undefined && typeof data.model !== 'string') {
    issues.push({ ..., rule: "'model' must be a string when present" })
  }
  ```
  Type-only check — no `length === 0` guard. Compare to:
  - `src/config/load.ts:252` (config side rejects empty: `if (typeof r.model !== 'string' || r.model.length === 0)`)
  - `src/agents/schema.ts:1085-1098` (description rejects empty: `data.description.trim().length === 0`)
  - `src/state/events.ts` event-schema rejects empty `build_provider_recorded.model` (verified by `tests/build-provider-recorded.test.ts:255` which currently asserts `rule.includes('build_provider_recorded.model')`).
  After M12, `src/providers/manifest.ts:127` defaults `req.model ?? req.agent.model`. A project-local persona declaring `model: ""` would forward an empty model to adapters — bundled defaults are safe (they omit `model`); project-local files are not.
- **Why it matters:** This is the latent half of the M12 frontmatter-model-drop bug Codex flagged (CODEX_REVIEW_M12.md "Risks the proposing side missed" #1). M12 closed the propagation half (model now reaches the adapter) but did not close the validation half (empty string still passes the persona schema). The asymmetry between three layers (config, persona, event) means the same value (`""`) surfaces three different errors at three different entry points — never a clean "rejected at load."
- **Recommended action:** Tighten `validateAgent` in `src/agents/schema.ts` to require non-empty when present, mirroring the description rule: `data.model.length === 0` → push `schema_invalid_value` issue. Add a unit test under `tests/agent-schema-frontmatter.test.ts` (or the existing schema test surface) covering empty-string and whitespace-only inputs.
- **Scope bucket:** this session.

### Finding 3 — `COMPANY.md` Bootstrap-order section overstates resume routing

- **Severity:** fix-soon
- **Evidence:** `docs/contracts/COMPANY.md:144-146` says: *"Both call sites — `src/commands/run.ts` (the entry point) and the active-run plan dispatch — flip together so resume retains the same routing as the initial run."* Implementation: `src/commands/run.ts:507` `dispatchPlan()` calls `loadConfig({cwd})` afresh. If the user edits `.code-oz/config.yaml` between DEFINE-approve and PLAN dispatch, the new `company:` block is honored — routing is **not** snapshotted at run start.
- **Why it matters:** The doc implies snapshotting; the runtime reads current config. A future user (or future-Ozzy) reading the contract would assume a snapshot guarantee that is not implemented. Codex M12 review risk #2 flagged this. Snapshot-on-init is M16+ if anyone needs it.
- **Recommended action:** Replace the misleading clause with prose that names the actual behavior: "Both call sites load config before bootstrap, so the resumed phase reflects current `company:` block; mid-run config edits take effect on the next phase dispatch. Snapshot-on-init is not implemented in v0.1." Two-sentence fix.
- **Scope bucket:** this session.

### Finding 4 — CLAUDE.md "Status" paragraph is one giant compound sentence

- **Severity:** nit (verbosity)
- **Evidence:** `CLAUDE.md` "Status:" line is a single sentence spanning seven clauses connected by `+`, with parenthetical Codex-risk references mixed into the surface description. Reads as a closure-of-record log, not a "what shipped" status.
- **Why it matters:** New sessions read CLAUDE.md first to orient. The status paragraph is the first signal-dense surface; today it requires parsing a 200-word sentence to find what M12 actually delivered. Subsequent milestones (PE-1, M13–M15) will each compound the structure if not corrected.
- **Recommended action:** Compress to two sentences max — one for the shipped surface (six bundled roles via `company:` block, `provider?/model?` only), one for the closed risks (reference the Codex review by file). Apply same shape going forward. Pin a project-rule comment at the top of the status line ("two-sentence cap") if needed.
- **Scope bucket:** this session.

### Finding 5 — `ROADMAP.md` § M12 row mirrors the same verbosity

- **Severity:** nit (verbosity)
- **Evidence:** `docs/design/ROADMAP.md:376` carries an even longer single-sentence M12-closed paragraph mixing the shipped surfaces with parenthetical risk-closure references and forward-compat notes. Same structural issue as finding #4.
- **Why it matters:** Two authoritative surfaces (CLAUDE.md + ROADMAP.md) drift together when verbosity creeps in tandem; either both compress or neither does.
- **Recommended action:** Compress in the same docs commit as finding #4. Each closed milestone in ROADMAP gets exactly one paragraph for the shipped surface and one parenthetical closure pointer.
- **Scope bucket:** this session.

### Finding 6 — `TODO.md` is untracked but not in `.gitignore`

- **Severity:** nit
- **Evidence:** `git status --short --branch` shows `?? TODO.md` on a clean tree. `.gitignore` does not list it. Each session's launch prompt is dropped at this path and pollutes status output.
- **Why it matters:** Untracked-file noise hides genuinely stray files (e.g., a half-edited new contract file) by training the eye to ignore the line. Adding `TODO.md` to `.gitignore` is a 1-line fix that restores `git status` as a true health signal.
- **Recommended action:** Append `TODO.md` to `.gitignore` under a "Session-launch prompts" comment. Also consider whether `docs/research/CODEX_BRIEFING_*REVIEW*.md` should be tracked or ignored — current state is tracked; leaving alone unless Codex round below recommends otherwise.
- **Scope bucket:** this session.

### Finding 7 — Stale M11 forward-compat prose still implies M12 ships budgets/permissions

- **Severity:** nit
- **Evidence:** Three archived briefings carry the pre-M12 lean phrasing:
  - `docs/research/CODEX_BRIEFING_M11.md:201`
  - `docs/design/SESSION_M11_KICKOFF.md:90`
  - `docs/design/SESSION_M12_KICKOFF.md:10` (quotes the M11 stale clause inside its own context)
  All read "M12 maps role → provider+model+budgets+permissions." M12 actually shipped provider+model only.
- **Why it matters:** Codex M12 review nit #2 flagged this; recommended path was "optional cleanup in a later docs pass." `COMPANY.md` and `ROADMAP.md` are the authoritative surfaces and are correct. Archived briefings are historical record.
- **Recommended action:** Defer per Codex. Record in tech-debt register so a later docs sweep catches it. Adding a single "Status" annotation at the top of each archived doc ("M12 actually shipped provider+model only — see COMPANY.md") is a 3-line change if Codex disagrees with deferring.
- **Scope bucket:** later (deferred per Codex M12 review).

### Finding 8 — Version-string drift is forward-looking, not present

- **Severity:** fyi
- **Evidence:** `0.12.0-alpha.0` appears in five places: `package.json:3`, `src/cli.ts:7` (`PKG_VERSION`), `src/config/schema.ts:154` (`DEFAULT_CONFIG.version`), `tests/cli-init.test.ts:56` (asserts `'0.12.0-alpha.0'`), `tests/m5-fix-first.test.ts:35` (`CURRENT = '0.12.0-alpha.0'`). All five consistent today.
- **Why it matters:** Each milestone bump must edit all five touchpoints. Drift would only surface as a test failure (cli-init.test.ts catches it), but the burden is forward — PE-1 close inherits it.
- **Recommended action:** Defer to a dedicated commit when convenient. Single-source via `import { version } from '../../package.json'` is a refactor that touches the test fixture surface; not regression. Never bundle into PE-1.
- **Scope bucket:** later (never-mix-into-PE-1).

### Finding 9 — Three dead config keys persist on the surface

- **Severity:** fyi
- **Evidence:** `src/config/schema.ts` declares `defaultProvider`, `models.primary`, `models.reviewer` as required keys with defaults `'claude'` / `'claude-opus-4-7'` / `'gpt-5.5'`. `docs/contracts/COMPANY.md:154-156` documents that these "are not active fallback paths in v0.1: persona frontmatter requires `provider`, so `defaultProvider` is effectively legacy."
- **Why it matters:** Schema + load + test surface persists for keys nothing reads. New contributors trying to "configure code-oz to use Codex by default" will edit `defaultProvider` and find no behavior change. Removing them or wiring them to actual fallback behavior is a config-cleanup decision, not a regression.
- **Recommended action:** Defer. Address in a config-cleanup milestone (or fold into M13 role-cost when it touches the same surface). Visible-tech-debt register entry.
- **Scope bucket:** safe-to-park.

### Finding 10 — byterover-cli is the only "first-time inclusion gate" candidate; verdict is defer

- **Severity:** fyi
- **Evidence:** Per `TEMPLATE_FOLDER_COMPARISON_2026-05-01.md`, byterover-cli surfaces a clean Elastic 2.0 multi-provider abstraction over 18 LLM providers (`@ai-sdk/*`). Its daemon architecture, bundled UI, and missing permission manifest conflict with code-oz's file-based-gates and single-binary discipline.
- **Why it matters:** PE-1 ships xAI direct HTTP — the simplest possible adapter. byterover-cli's pattern is interesting only if/when friend-survey demand surfaces routed retail access. Borrowing now would scope-creep PE-1.
- **Recommended action:** Defer. Re-evaluate after PE-1 ships and the post-PE-1 demand checkpoint runs (per `SESSION_XAI_EXPANSION_KICKOFF.md`).
- **Scope bucket:** borrow-later.

## Verbosity cleanup candidates (small targeted cuts)

1. `CLAUDE.md` "Status" paragraph — compress to two sentences (finding #4).
2. `docs/design/ROADMAP.md:376` M12 row — same compression as #1 (finding #5).
3. `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md` is 188 lines for a roadmap-only doc; PE-1's planning round will absorb most of it. Defer cleanup until PE-1 ships and the kickoff converts to a closed-milestone reference.
4. ROADMAP.md M8/M9 acceptance-criteria sections are very dense per-commit reference (60+ lines each); historical record. Defer until a later docs maintenance pass; not session scope.
5. M11 + M12 forward-compat prose in archived briefings (finding #7) — defer per Codex.

## Tech-debt register

### must-fix-now (this session)

- F1: agentic-coder exclusion in CLAUDE.md influence library (provenance hygiene).
- F2: Persona frontmatter `model: ""` validation (closes M12 latent risk #1).
- F3: COMPANY.md Bootstrap-order resume-routing precision (closes M12 latent risk #2).
- F4: CLAUDE.md status paragraph compression.
- F5: ROADMAP.md M12 row compression (bundled with F4).
- F6: TODO.md → .gitignore.

### safe-to-park (visible debt; tracked here)

- F7: Stale M11 forward-compat prose in three archived briefings.
- F9: Three dead config keys (`defaultProvider`, `models.primary`, `models.reviewer`).

### never-mix-into-PE-1

- F8: Version-string single-source refactor — touches test fixtures + package.json read pattern; scope-creep risk for PE-1.
- F10: byterover-cli multi-provider pattern absorption — wait for post-PE-1 friend-survey signal.

## Recommended implementation order

Four scoped commits — each landing one concern, with tests where applicable. Per CLAUDE.md and SESSION_CYCLE.md: validation per commit (`bun run typecheck` + targeted tests), full `bun test` before Codex implementation review.

1. **`feat(agents): require non-empty persona frontmatter model when present`** (F2). `src/agents/schema.ts` adds the empty-string check; new test in the schema test suite covers empty + whitespace-only. Targeted test: `bun test tests/agent-schema-frontmatter*`.
2. **`docs(refactor): close M12 deferred risk #2 — COMPANY.md resume-routing precision`** (F3). Single-section edit in `docs/contracts/COMPANY.md`. Docs only.
3. **`docs(refactor): tighten v0.12.0-alpha.0 status surfaces`** (F4 + F5). One-paragraph compression in CLAUDE.md and ROADMAP.md M12 row.
4. **`chore(provenance): exclude agentic-coder from influence library + ignore TODO.md`** (F1 + F6). CLAUDE.md influence-library exclusion update + `.gitignore` append. Bundled because both are repo-hygiene one-liners.

After commits 1–4: full `bun test` + Codex implementation review (`docs/research/CODEX_REVIEW_REFACTOR_2026-05-01.md`). Close any block-push or fix-soon findings in follow-up commits before final handoff.

## Session outcome (closure log)

Codex planning round (`docs/research/CODEX_RESPONSE_REFACTOR_2026-05-01.md`) returned `accept-with-modifications` on thread `019de514-0165-7eb3-8512-1eb9e8a645c3`. Modifications absorbed: implementation order flipped (provenance first), F2 broadened to whitespace-only across schema + config + events (three layers, not one), F3 wording revised to drop the version anchor and acknowledge the non-atomic-write race, F1 path B chosen (durable rule + named examples), tag precision fixed.

Five landed commits (per `git log`):

1. `531c28a chore(provenance): hard-exclude leaked-source relabels` — F1 + F6 (CLAUDE.md durable rule + .gitignore TODO.md).
2. `5f09dc7 feat(agents): reject blank model bindings across schema/config/events` — F2 + Codex widening (3-layer + 6 new tests; 1917 → 1923).
3. `3657e50 docs(refactor): clarify config-current resume routing in COMPANY.md` — F3.
4. `be9c0ed docs(refactor): tighten v0.12.0-alpha.0 status surfaces` — F4 + F5.
5. *(this commit)* `docs(refactor): commit inter-milestone research artifacts` — durable-register requirement from Codex Blockers.

Findings F7 (stale M11 prose), F8 (version-string drift), F9 (dead config keys), F10 (byterover-cli inclusion gate) remain in the tech-debt register above per Codex `What to defer`. Race-on-non-atomic-config-write (Codex Bugs missed #3) is added to the safe-to-park bucket — fix is an atomic-save discipline on the writer side, deferred per scope guard.

Validation after commit 4: `bun run typecheck` clean; `bun test` 1923 pass / 1 skip / 0 fail. Codex implementation review queued for the post-commit-5 state in `docs/research/CODEX_REVIEW_REFACTOR_2026-05-01.md`.
