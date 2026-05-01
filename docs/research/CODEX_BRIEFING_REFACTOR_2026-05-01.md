# Codex planning briefing — code-oz refactor session (2026-05-01)

> **Post-session status (added 2026-05-01, after the round):** Audit Finding F1 (`agentic-coder` provenance) is **withdrawn**. Ozzy removed the folder in question from `~/Projects/agents/templates/` after the Codex implementation review and before push. CLAUDE.md no longer carries a leaked-source exclusion paragraph; the influence library is the 15 remaining open-source templates under the standard "no copy-paste, borrow patterns only" rule. The verbatim briefing below references the original state for audit completeness.

You are reviewing a deliberate inter-milestone refactor session between M12 (closed, `v0.12.0-alpha.0`) and PE-1 (xAI direct HTTP, deferred until this session ships). This is **not** a milestone planning round; it is a bug-hunt + verbosity-cleanup + tech-debt-visibility pass that must close cleanly before PE-1 starts.

You are Codex GPT-5.5 at xhigh effort, sandbox: read-only, full file access. Read the audit (`docs/research/REFACTOR_AUDIT_2026-05-01.md`), the template comparison (`docs/research/TEMPLATE_FOLDER_COMPARISON_2026-05-01.md`), and the contracts you need (`CLAUDE.md`, `docs/design/ROADMAP.md`, `docs/contracts/COMPANY.md`, `docs/contracts/PROVIDERS.md`, `docs/references/provider-contract.md`, `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md`, `docs/research/CODEX_REVIEW_M12.md`). The audit names exact files and line numbers; verify every claim against the live tree before agreeing.

Your job is to pressure-test the audit's findings, the proposed implementation order, and the anti-scope-creep boundaries. The session is bounded — Ozzy explicitly does not want PE-1 work, M13 role-cost, M14 panels, M15 debate scheduler, or M16+ patterns to bleed in.

## Live repo truth (verified from checkout)

- **Branch:** `main`, in sync with `origin/main`. Working tree clean except `?? TODO.md` (untracked session-launch prompt).
- **HEAD:** `88f8867 Merge feat/m12-company-roster: M12 Company roster (v0.12.0-alpha.0)`.
- **Tag state:** `v0.12.0-alpha.0` latest; `v0.{8..11}.0-alpha.0` precede.
- **Tests:** 1917 pass / 1 skip / 0 fail (offline). `bun run typecheck` clean.
- **M12 status:** functionally closed; tag pushed; six commits land the company roster contract per `docs/contracts/COMPANY.md`. Codex M12 review verdict was `push` with three nits closed in `e5919ae` and two risks deferred (this audit closes both).

## Whether M12 is functionally closed (regression check)

Yes, M12 is closed. Six commits cover the roster:

1. `b4a947d docs(m12): pin company roster contract surface`
2. `4744e06 feat(m12): config schema + loader for company:block`
3. `aabca16 feat(m12): apply company overrides at agent load + post-override checks`
4. `b485994 feat(m12): bootstrap loads config before registry`
5. `78609f5 feat(m12): model propagation through provider invoke`
6. `41d62fa docs(m12): close M12 + status bump v0.12.0-alpha.0`

Plus `e5919ae docs(m12): close round-1 Codex review nits` and `88f8867` merge to main.

The two risks Codex named in CODEX_REVIEW_M12.md round 1 are this session's targets:

- Risk #1 (frontmatter `model: ""` passes persona validation): confirmed in `src/agents/schema.ts:1065-1071`. Audit finding F2.
- Risk #2 (resume routing is config-current, not config-snapshotted): confirmed; `src/commands/run.ts:507` reloads config on every dispatch. The COMPANY.md prose at line 146 overstates "retains the same routing." Audit finding F3.

Codex round 1 also surfaced three nits — all closed in `e5919ae` — and several FYIs none of which are tag blockers.

## Template folder-by-folder comparison summary

Full matrix in `docs/research/TEMPLATE_FOLDER_COMPARISON_2026-05-01.md`. Sixteen folders surveyed in parallel by four `Explore` agents (4 each).

- **Already borrowed (confirmed against CLAUDE.md influence-library):** 7 folders — agent-skills, opencode, Archon, pi-mono, maestro, Auto-claude-code-research-in-sleep, claude-code.
- **Borrow-now candidates:** zero. Every gap that would justify a borrow-now call already has a code-oz contract that fits the locked one-authority-per-milestone discipline.
- **Borrow-later (re-evaluate at the named milestone):** ARIS effort levels (M14 panel design); skills `CONTEXT.md` (M13 role-cost); claude-code hook event naming (M14 panel hooks); opencode Tab-switchable agent role (M14 panel UX); byterover-cli multi-provider abstraction (post-PE-1 demand checkpoint).
- **Reject:** claude-coder (IDE extension); agenticSeek (autonomous loop / no gates); codex template (Rust/Bazel mismatch); Mimir (heavy neo4j dep); byterover-cli daemon + UI (file-based-gates + single-binary conflicts); **agentic-coder** (provenance — see below).
- **Provenance hit (audit F1):** `agentic-coder/` ships only `src/` (no LICENSE/README/package.json). `Tool.ts` imports `@anthropic-ai/sdk/resources/index.mjs`, internal types like `Command`, `CanUseToolFn`, `ThinkingConfig`. `QueryEngine.ts` imports `bun:bundle`, `src/bootstrap/state.js`, `accumulateUsage`, `EMPTY_USAGE`, `src/services/api/claude.js`. The import surface and filename set match the publicly leaked Claude Code source (2026-03-31 .map leak). CLAUDE.md "Influence library" excludes only `claude-code-main` by name — that folder is no longer in `templates/`. The same provenance has resurfaced under a relabel.

## Patterns flagged borrow-now and needs-Codex-debate

- **Borrow-now:** none.
- **Needs-Codex-debate:** none earned in this round. Each post-M12 milestone (PE-1, M13, M14, M15) gets its own planning round where the borrow-later candidates are re-tested against measurable need.

## Patterns explicitly rejected (and why)

| Pattern | Source | Why rejected for code-oz |
|---|---|---|
| IDE extension paradigm + embedded OAuth | claude-coder | CLI-native and subscription-first auth (PROVIDERS.md) are locked. |
| Autonomous loop without approval gates | agenticSeek | CLAUDE.md rule 1 (file-based gates only) + rule 12 (resume / NEEDS_INTERVENTION) require explicit pause points. |
| Rust/Bazel build | codex template | Bun + TypeScript stack is locked (ROADMAP § Architecture locks). |
| Hard neo4j/Graphology runtime memory | Mimir | Single-binary distribution lock (`bun build --compile`); cross-run memory is M16+. |
| Daemon + bundled UI | byterover-cli | File-based-gates rule + single-binary distribution lock + permission manifest is non-negotiable (CLAUDE.md rule 9). |
| Pattern borrow from leaked source | agentic-coder | Provenance policy (`memory/project_provenance_policy.md`); same hard reject as `claude-code-main`. |

## Audit findings ranked by severity

Full text in `docs/research/REFACTOR_AUDIT_2026-05-01.md`. Summary:

- **Block-push:** 0.
- **Fix-soon (3):**
  - **F1.** `agentic-coder` is the leaked Claude Code source under a renamed folder; CLAUDE.md influence-library exclusion list is out of date.
  - **F2.** Persona frontmatter `model: ""` passes validation (`src/agents/schema.ts:1065-1071`). Closes M12 deferred risk #1.
  - **F3.** `COMPANY.md:146` overstates resume routing as "retains the same routing as the initial run"; runtime reloads config on every dispatch. Closes M12 deferred risk #2.
- **Nit (3):**
  - **F4.** `CLAUDE.md` Status paragraph is one giant compound sentence with parenthetical risk refs.
  - **F5.** `ROADMAP.md:376` M12 row mirrors the same verbosity.
  - **F6.** `TODO.md` is untracked but not in `.gitignore`.
- **Defer per Codex M12 nit #2 (1):**
  - **F7.** Stale M11 forward-compat prose in three archived briefings (`CODEX_BRIEFING_M11.md:201`, `SESSION_M11_KICKOFF.md:90`, `SESSION_M12_KICKOFF.md:10`) still says "M12 maps role → provider+model+budgets+permissions." M12 actually shipped provider+model only.
- **FYI (3):**
  - **F8.** Version-string drift is forward-looking (5 touchpoints all consistent today; PE-1 inherits the burden). Defer; never-mix-into-PE-1.
  - **F9.** `defaultProvider` / `models.primary` / `models.reviewer` are dead config keys per COMPANY.md backward-compat note. Safe-to-park.
  - **F10.** byterover-cli is the only "first-time inclusion gate" candidate; verdict defer / borrow-later.

## Two M12 deferred risks + any new ones surfaced

- **M12 risk #1** (Codex CODEX_REVIEW_M12.md): persona `model: ""` — addressed by F2 in this session.
- **M12 risk #2** (Codex CODEX_REVIEW_M12.md): resume routing wording — addressed by F3 in this session.
- **New risk (this session):** F1 — agentic-coder provenance issue. Not a runtime bug; a docs/policy hygiene gap. Closing it prevents future-Ozzy from absent-mindedly pattern-borrowing from it.

## Anti-scope-creep boundary (locked for this session)

The session ships **only** the four commits below. Out of scope:

- **PE-1 — xAI direct HTTP adapter.** Trust-boundary expansion + outbound HTTP. Deferred by user instruction; PE-1 has its own planning round and contract pre-locks per `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md`.
- **M13 — Role-cost policy under `budgets.global`.** No per-role budget surface change.
- **M14 — Reviewer panel v1.** No simultaneous-provider surface.
- **M15 — Debate-policy scheduler.** No automatic-trigger policy.
- **M16+ — Researcher / parallel builder candidates / multi-opponent debate / custom role routing.** No new role names in `M12_COMPANY_ROLES`.
- **Production dependencies.** No new package.json runtime deps. The audit findings are all pure code/docs/config edits.
- **Schema / event-shape changes.** No new event types; no new `tool_use` sub-scopes; no `ProviderCapability` field additions.

If you find a finding that requires any of these, return `debate-required` with the conflict named.

## Proposed implementation order with commit boundaries

Four commits, each landing one concern. Per CLAUDE.md + SESSION_CYCLE.md: validation per commit (`bun run typecheck` + targeted tests), full `bun test` before the Codex implementation review.

### Commit 1 — `feat(agents): require non-empty persona frontmatter model when present`

- File: `src/agents/schema.ts` — extend the existing `'model' in data` block with a non-empty check that mirrors the description rule at line 1085-1098.
- Tests: extend the schema test suite (probably `tests/agent-schema-frontmatter*` or the canonical schema test file) with two cases — empty string `""` and whitespace-only `"   "`.
- Validation: `bun test [the test file]` + `bun run typecheck`.

### Commit 2 — `docs(refactor): close M12 deferred risk #2 — COMPANY.md resume routing precision`

- File: `docs/contracts/COMPANY.md` § "Bootstrap order (M12 wiring fix)" — replace the misleading "retains the same routing" clause with prose that names current behavior (both call sites reload config on every dispatch; mid-run config edits take effect on next phase dispatch; snapshot-on-init is M16+).
- Tests: none (docs only).
- Validation: `bun run typecheck` (no-op for docs change but confirms no incidental code touch).

### Commit 3 — `docs(refactor): tighten v0.12.0-alpha.0 status surfaces`

- Files: `CLAUDE.md` (Status paragraph) and `docs/design/ROADMAP.md:376` (M12 row).
- Compress to two sentences each: one for the shipped surface, one for closure pointers (Codex round + risks).
- Tests: none.
- Validation: typecheck only.

### Commit 4 — `chore(provenance): exclude agentic-coder from influence library + ignore TODO.md`

- File: `CLAUDE.md` — update "Excluded from the influence library" paragraph. Two paths to consider:
  - **A.** Enumerate `agentic-coder` alongside (or replacing) `claude-code-main` since the latter is no longer in `templates/`.
  - **B.** Replace folder enumeration with a forward-looking durable rule: "Any folder whose source matches the 2026-03-31 npm `.map` leak is excluded regardless of folder name." Names `agentic-coder` as the current example.
  - Codex round below should pick A vs B.
- File: `.gitignore` — append `TODO.md` under a "Session-launch prompts" comment.
- Tests: none.
- Validation: typecheck only.

After commits 1–4: full `bun test` (expect 1919+ pass / 1 skip / 0 fail given two new schema tests). Then Codex implementation review (`docs/research/CODEX_REVIEW_REFACTOR_2026-05-01.md`). Close any block-push or fix-soon findings in follow-up commits before handoff. Per Ozzy's instruction, no push, no tag, no PR until explicit approval.

## Questions Codex must answer

1. **F1 framing.** Should CLAUDE.md "Influence library" exclude `agentic-coder` by name (path A in commit 4), or should the rule pivot to a forward-looking "any folder matching the 2026-03-31 .map leak" formulation (path B)? Which is more durable against future relabels?
2. **F2 scope.** Is "non-empty when present" the right discipline, or should the persona schema also enforce a minimum format (e.g., `^[a-z0-9._-]+$`) on `model`? PE-1 will introduce `xai-grok-*` model names; M11's strict-minimal lean argues against pre-locking format until measurable need.
3. **F3 wording.** The proposed prose says "snapshot-on-init is not implemented in v0.1." Is that overspecific given v0.1 is the only versioned release? Acceptable alternatives: "not implemented" (no version anchor), "currently not implemented" (forward-looking), "M16+ if needed" (locked-sequence anchor).
4. **F7 cleanup.** Codex M12 review nit #2 recommended deferring stale-prose cleanup to a "later docs pass." Concur with deferring through this session, or land a 3-line annotation per archived doc now? The cost is ~5 minutes; the value is preventing future-Ozzy mis-quoting M11 prose into a new milestone briefing.
5. **F8 / F9 visibility.** Tech-debt entries are recorded in `REFACTOR_AUDIT_2026-05-01.md` under "Tech-debt register." Is this a sufficient durable surface, or should code-oz introduce `docs/research/PATTERNS_PARKING_LOT.md` (recurring-debt + borrow-later candidates) so future sessions don't re-discover them?
6. **Implementation-order ordering.** Should commit 4 (provenance hygiene) come first because it is the only finding that touches the project's trust-boundary surface, even though it is a docs/config-only commit? Or is the proposed order (code-first → docs-only → cleanup) right because commit 1 is the only one with test impact and shipping it last would make the full-test run cleaner?
7. **Anti-scope-creep risk.** Are any of the four commits I proposed sneaking in PE-1 / M13 / M14 / M15 / M16+ scope by accident? Pattern: a finding that "feels small" but actually requires a new authority boundary. Specifically: does F2 (non-empty model check) imply anything about PE-1's xAI model-name vocabulary? Does F3 (resume routing precision) preempt any M16+ snapshot-on-init design space?
8. **Bugs Claude missed (priority field).** Independent reads of `src/agents/schema.ts`, `src/agents/loader.ts`, `src/config/load.ts`, `src/providers/manifest.ts`, `src/cli/bootstrap.ts`, `src/commands/run.ts`, and `src/state/schemas.ts` — are there finding-grade issues this audit didn't surface? Specifically: any latent bug behind the M12 model-propagation fix that a project-local persona could trigger that the empty-string check doesn't address? Any race between `loadConfig` and `bootstrap` if the YAML file is being written when run starts?

## Response shape

Return your reply in this exact shape:

```markdown
# Codex planning review

## Verdict
accept | accept-with-modifications | reject | debate-required

## Blockers before code

## Scope corrections

## Template-pattern decisions

## Bugs or stale assumptions Claude missed

## Implementation order changes

## What to defer

## Final recommendation
```

Per CLAUDE.md rule 9, your verdict is data, not authority — Ozzy weighs disagreement and decides. Be direct, name files and lines, push back on overstatements, and surface anything in the audit that doesn't hold under independent verification.
