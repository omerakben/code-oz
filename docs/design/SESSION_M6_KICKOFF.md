# code-oz — M6 session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else. The non-negotiable rules in there override anything that conflicts in this kickoff.

Read this kickoff in full, including the cross-cutting addendum at the end. The addendum captures synthesis-round and M6-Codex-round decisions that affect implementation; addendum wins on conflict.

## State at start of M6

- **Repo:** `github.com/omerakben/code-oz` (local-only; not yet pushed), branch `docs/research-synthesis` for M6 prep, `feat/m6` to be branched at start of implementation
- **Last release:** `v0.5.0-alpha.0` (M5 — DEFINE phase + SPEC contract + ask-me flow + Common Rationalizations)
- **Tests:** 542 passing, offline, ~2.2s
- **Binary:** `bun run build:binary` produces `dist/code-oz`, reports `0.5.0-alpha.0`
- **What works:**
  - `code-oz init` (M1) — scaffolds `.code-oz/` with greenfield/brownfield detection
  - `src/agents/` (M2) — parses, validates, loads, registers agent files; cross-family REVIEW enforcement live at agent-load time
  - `src/state/` (M3) — typed phase machine, append-only event log with per-event fsync, atomic gate writers with sha256 binding, run-level orchestration with cross-file recovery
  - `code-oz approve [PHASE]` (M3) — writes a success gate, emits the layered transition events, rebuilds `current.json`
  - `src/providers/` (M4) — IAgentProvider contract, ProviderRegistry with familyOf authority, four adapters, wrapper layer (`invokeAgent`) with budget enforcement + tool-call cap + NEEDS_INTERVENTION recovery
  - `src/tools/review-request.ts` (M4) — narrow cross-family REVIEW primitive (rule 2)
  - `code-oz doctor providers` (M4) — aggregate health probe with required-providers exit policy
  - `src/phases/define.ts` + `src/phases/ask-me.ts` (M5) — bounded ask-me loop with maxRounds + maxRepairTurns + maxFinalizeTurns; readySignal exact-line match; SPEC.md atomic write + gate
  - `src/artifacts/spec.ts` (M5) — SPEC.md parser + canonical serializer (6 sections, mandatory non-goals)
  - `src/prompts/{define-system,common-rationalizations}.md` (M5) — bundled assets injected per-turn
- **What's still stubbed:** `code-oz run` exits at the DEFINE gate awaiting approval; PLAN phase does not exist; full spine demo lands in M7.

## Synthesis-round artifacts (must read before planning)

Before doing anything M6-specific, read these in order. They contain the discipline this milestone implements.

1. **`docs/research/SYNTHESIS.md`** (commit `e5191aa`) — the proposed deltas after the 7-dossier research bundle landed.
2. **`docs/research/CODEX_RESPONSE_SYNTHESIS.md`** (thread `019ddc5f`) — Codex's `proceed-with-modifications` verdict on the synthesis. Reshaped rule 15 wording, banned leaked-source borrowing, defined the `tool_use.repo_context` schema, corrected budget namespace.
3. **`docs/research/MERGE_PLAN.md`** (commit `76f9845`) — final-form recommendation folding Codex's verdict in. Five user decisions resolved here.
4. **`docs/design/CODEX_BRIEFING_M6.md`** + **`docs/design/CODEX_RESPONSE_M6.md`** (commit `1dd4796`, thread `019ddc73`) — the M6 planning round. Codex returned `proceed-with-modifications` with eight specific lock-in decisions.

Then read the dossiers M6 implements:

5. **`docs/research/01-maestro-rule-checker.md`** — the maestro discipline (skill `repo-search-before-write` is M6's repo-context consumer; skill `requirement-restate` is the discipline at every gate; skill `state-handoff` is the inter-phase handoff schema).
6. **`docs/research/02-llm-failure-research.md`** — failure families. M6 directly addresses families 1 (API fabrication, caught by 3-source verification), 4 (project context conflict, caught by repo-context Glob/Grep + similarity check), 14 (assumption propagation, caught by HYPOTHESES.md), 17 (overconfidence, caught by mandatory falsifiers).
7. **`docs/research/05-scientist-and-open-questions-agent.md`** — Scientist meta-agent design. M6 ships substrate + PLAN phase-tail; M7 wires BUILD/VERIFY/REVIEW tails; W2 adds CLI commands and cross-run memory.

## Template references (read-only via `/add-dir`)

M6 borrows patterns from `claude-code` (public — Glob+Grep+filesystem-discovery patterns in their docs), `opencode` (permission UX), `agent-skills` (skill format the universal-rules.md follows), and `maestro` (the rule-checker discipline already cited in CLAUDE.md rule 17).

**Excluded:** `~/Projects/agents/templates/claude-code-main/` is the publicly leaked Anthropic source. **Do not reference it for any M6 code.** Pattern borrowing from this template is excluded per CLAUDE.md influence library and `docs/research/CODEX_RESPONSE_SYNTHESIS.md` (decision 2). The 4–6 working day clean-room cost is the accepted trade.

**Pinned canonical specs (read these first):**

- [`docs/references/agent-skill-format.md`](../references/agent-skill-format.md) — frontmatter format. M6 extends `AgentPermissions` with the new `tool_use.repo_context` sub-scope.
- [`docs/references/file-based-gates.md`](../references/file-based-gates.md) — § 4 (canonical phase → artifact map: `plan → PLAN.md`), § 5 (events.jsonl). M6 adds new event types via the open-type-union (validation rule 12).
- [`docs/references/provider-contract.md`](../references/provider-contract.md) — IAgentProvider, request DTO split. M6's repo-context tools live BETWEEN provider invocations; selected paths flow into next-invocation manifest.
- [`docs/references/spec-contract.md`](../references/spec-contract.md) — M5 SPEC contract pattern. M6's PLAN.md, SOURCE_CHECK.md, HYPOTHESES.md, OPEN_QUESTIONS.md, REPO_CONTEXT.md, SCIENTIST.md all follow the same pattern.

**M6 will create six new pinned references in commit 1 (per Codex):**

- `docs/contracts/PLAN.md`, `docs/contracts/SOURCE_CHECK.md`, `docs/contracts/REPO_CONTEXT.md`, `docs/contracts/SCIENTIST.md`, `docs/contracts/HYPOTHESES.md`, `docs/contracts/OPEN_QUESTIONS.md`

## Your task — M6: PLAN + repo-context MVP + Scientist substrate + budgets.global extension

Canonical scope: `docs/design/ROADMAP.md` § M6 (newly expanded by the synthesis round). Acceptance criteria:

- PLAN cannot pass without `SOURCE_CHECK.md` naming spec, reference (or explicit none-found rationale), and docs (or explicit no-library rationale)
- PLAN emits atomic tasks with file targets, validation commands, risk notes, hypotheses citations
- Repo-context tools (`glob`, `grep`, `read`; `symbol` optional in M6) callable by PLAN persona under `tool_use.repo_context` scope; results capped at locked defaults; selected paths flow into next-invocation `ProviderRequest.files`; `repo_context_searched` events log every call
- HYPOTHESES.md and OPEN_QUESTIONS.md atomic writes survive crashes; PLAN's gate preflight (loose-coupled, in `src/phases/scientist.ts` or `gate-preflight.ts`) validates both sidecars before `requireGate(plan, ...)`
- Cumulative `budgets.global` enforces wall-time + token + call caps with soft warnings at 75% and hard kills at 100%
- DEFINE retro-seed (HYPOTHESES.md / OPEN_QUESTIONS.md from SPEC.md) opt-in via `phases.scientist.retroSeedDefine: true`; never reopens M5
- Universal rule sheet ships in M6 (per Codex push-back on briefing prompt 12 — CLAUDE.md rule 16 already requires every persona to import it)
- Test: `tests/e2e/plan-greenfield.test.ts` runs DEFINE → PLAN end to end with FakeProvider, including repo-context search against a fixture repo

## Files to create per Codex's locked 14-commit sequence

The commit ordering is **substrate-first, persona-last** per Codex's reshape (`docs/design/CODEX_RESPONSE_M6.md` "Where I disagree" point 3). Every artifact has a contract before code, budget semantics exist before tool events, and the persona only lands after its prompt substrate is real.

```text
Commit 1 — docs(contracts): pin PLAN, SOURCE_CHECK, REPO_CONTEXT, SCIENTIST, HYPOTHESES, OPEN_QUESTIONS
  docs/contracts/PLAN.md
  docs/contracts/SOURCE_CHECK.md
  docs/contracts/REPO_CONTEXT.md
  docs/contracts/SCIENTIST.md
  docs/contracts/HYPOTHESES.md
  docs/contracts/OPEN_QUESTIONS.md

Commit 2 — feat(artifacts): PLAN + SOURCE_CHECK parsers and serializers
  src/artifacts/plan.ts        # parsePlan, serializePlan
  src/artifacts/source-check.ts # parseSourceCheck, serializeSourceCheck
  src/artifacts/errors.ts       # PlanLoadError, SourceCheckLoadError extending existing pattern
  tests/{plan-artifact,source-check-artifact}.test.ts

Commit 3 — feat(artifacts): HYPOTHESES + OPEN_QUESTIONS parsers, serializers, atomic writers
  src/artifacts/hypotheses.ts        # parseHypotheses, serializeHypotheses, allocateHypothesisId
  src/artifacts/open-questions.ts    # parseOpenQuestions, serializeOpenQuestions, allocateQuestionId
  tests/{hypotheses-artifact,open-questions-artifact}.test.ts

Commit 4 — feat(agents): AgentPermissions.tool_use.repo_context schema extension
  src/agents/schema.ts          # extend AgentPermissions per Codex's TypeScript shape
  tests/agents-permissions.test.ts # validates new sub-scope

Commit 5 — feat(state): event types and validators for repo_context, science, hypothesis, question, budget_warning
  src/state/schemas.ts          # add EVENT_TYPES entries
  src/state/events.ts           # validateEvent per-type cases
  tests/state-event-types.test.ts

Commit 6 — feat(config): budgets.global extension + budget_warning emission
  src/config/schema.ts          # add maxWallTimeMinutes, softWarnAtRatio, optional priceTable
  src/providers/cost.ts         # extend assertWithinBudget; emit budget_warning at softWarnAtRatio
  tests/{config-budgets,cost-wall-time}.test.ts

Commit 7 — feat(tools): repo-context glob, grep, read implementation (rg-backed)
  src/tools/repo-context/glob.ts
  src/tools/repo-context/grep.ts
  src/tools/repo-context/read.ts
  src/tools/repo-context/permissions.ts # intersect agent permissions with request scope
  src/tools/repo-context/runner.ts      # orchestration, timeout, repo_context_searched event emission
  tests/{repo-context-glob,repo-context-grep,repo-context-read,repo-context-permissions}.test.ts
  Update src/commands/doctor.ts to check `rg` is on PATH

Commit 8 — feat(sources): 3-source verification resolvers + offline docs cache
  src/sources/spec-source.ts        # reads SPEC.md, returns SC-SPEC-NNN ids
  src/sources/reference-source.ts   # uses repo-context tools to find references
  src/sources/docs-source.ts        # Context7 fetch with .code-oz/cache/docs/ fallback
  tests/{sources-spec,sources-reference,sources-docs}.test.ts

Commit 9 — feat(personas): scientist persona + phase-tail runner
  src/agents/defaults/scientist.md   # v0.1 persona body per dossier 05
  src/phases/scientist.ts            # phase-tail runner; reads prior artifact, writes/updates sidecars
  tests/scientist-phase-tail.test.ts

Commit 10 — feat(state): loose gate-preflight helper for sidecar validation
  src/phases/gate-preflight.ts       # validateScientistSidecars({ phase, artifactRoot })
  tests/gate-preflight.test.ts

Commit 11 — feat(prompts): universal rule sheet + composer injection (CLAUDE.md rule 16)
  src/prompts/universal-rules.md     # the 20-item ban/require list from dossier 02
  src/prompts/index.ts               # extend composeDefinePrompt + new composePlanPrompt to inject
  tests/prompts-universal-rules.test.ts
  Note: M5's BA persona retroactively inherits universal rules at next compose; no SPEC contract change

Commit 12 — feat(personas): expanded Lead persona body + plan-system.md prompt template
  src/agents/defaults/lead.md        # full PLAN persona (3-source verification, repo-context tool usage, hypothesis emission)
  src/prompts/plan-system.md         # protocol template with {{AGENT_BODY}}, {{COMMON_RATIONALIZATIONS}}, {{UNIVERSAL_RULES}}, {{AVAILABLE_TOOLS}}, {{CONVERSATION}}
  tests/prompts-plan-system.test.ts

Commit 13 — feat(plan): PLAN orchestrator + run.ts wiring
  src/phases/plan.ts                 # bounded loop runner mirrors define.ts; calls scientist phase-tail; calls gate-preflight before requireGate
  src/commands/run.ts                # advance to PLAN after DEFINE gate is approved
  tests/plan-phase.test.ts

Commit 14 — feat(spine): e2e test + CLI help + docs polish + tag v0.6.0-alpha.0
  tests/e2e/plan-greenfield.test.ts  # full DEFINE → approve → PLAN → approve flow with FakeProvider against fixture repo
  fixtures/greenfield-baby-name/     # toy repo with 2-3 reference files for repo-context to find
  src/cli.ts                         # update help text
  README.md / .code-oz/init README   # v0.6 highlights
  Tag: v0.6.0-alpha.0
```

**Plus, almost certainly:**

- `src/state/schemas.ts` adds new event types early (commit 5) but personas may reference them in commits 9, 12, 13.
- The FakeProvider may need a `--with-repo-context` flag or canned response shape that includes `tool_use` for repo-context tools. Decide in commit 7's planning.
- `phases.plan.askMe.{maxRounds, readySignal, maxRepairTurns}` config keys (mirroring `phases.define.askMe`).

## What's NOT in M6

- Actual M5 changes — M5 is closed (`v0.5.0-alpha.0` tagged). M6 only adds backward-compat: universal-rules.md retroactively injects into M5's BA persona at next compose; no SPEC contract change.
- BUILD-lite / VERIFY-lite / REVIEW-lite (M7).
- Worktree creation + patch application (M7).
- Iterative BUILD loop (M7).
- Mutation-test gate (M7 in VERIFY-lite).
- Phase-tail Scientist for BUILD/VERIFY/REVIEW (M7).
- DEFINE-0 / Prompter front door (W2, gated on M7 mini-experiment).
- TUI inspector / failure recovery UX (W2).
- `code-oz hypotheses list`, `code-oz questions list`, `code-oz questions resolve` CLI commands (W2).
- Cross-run `.codeoz/memory/scientist/` (W2).
- Designer / reflection loop (W2).
- AUDIT phase implementation (W4).
- Real Claude/Codex calls in tests — M6 spine tests are FakeProvider-only.
- `consult()` broad primitive (v0.3).
- Concurrent runs / multi-active-run pointer (W3).
- Multi-language LanguagePack (W3).
- Real-world `IIntegration` (W3).
- Optional `symbol` LSP integration (W3 if data justifies).
- JS fallback for missing `rg` (W3 polish).

## The eight Codex-locked decisions (no longer up for debate; bake into design)

These are the decisions Codex returned in `CODEX_RESPONSE_M6.md` "Decisions you must lock before code." User accepted Codex's leans on all eight (this kickoff bakes them in).

1. **Repo-context caps (locked):** `maxResults: 50`, `maxBytesPerResult: 16_384` (16KB, NOT 64KB), `maxFilesForNextManifest: 20`, `timeoutMs: 5000`, `network: 'none'`. No Lead override above 20 until fixture data justifies. Math: 20 × 16KB ÷ 4 chars/token ≈ 81,920 tokens, leaves headroom in PLAN's 300k phase cap (`src/config/schema.ts:103`).

2. **`repo_context_searched` accounting (locked):** NOT a `maxProviderCalls` increment (would conflate with `agent_invoked`). Counts against the existing tool-call cap when model-issued. Event records `resultBytes` and `resultTokensEstimate`. Selected files counted via next manifest (preserves audit invariant per `docs/references/file-based-gates.md:168`).

3. **PLAN.md task grammar (locked):** H3 task blocks ONLY under `## Tasks`; rest of H2 bodies stay bullet-only. Schema:
   ```
   # PLAN
   ## Goals
   - bullet
   ## Tasks
   ### T-001: <one-line title>
   - Files: a.ts, b.ts
   - Validation: bun test tests/x.test.ts
   - Risk: <one-line>
   - Hypotheses: H-001, H-002
   - Sources: SC-SPEC-001, SC-REF-001, SC-DOC-001
   ## Sources
   - bullet
   ## Out of scope
   - bullet
   ## Open questions
   - bullet
   ```
   No cross-cutting `## Risks` section (per-task Risk + OPEN_QUESTIONS.md is sufficient).

4. **SOURCE_CHECK.md ids + Coverage (locked):** Stable source ids per item: `SC-SPEC-001`, `SC-REF-001`, `SC-DOC-001`. None-found cases keep explicit rationale but get an id like `SC-REF-NONE-001`. Add `## Coverage` section mapping `T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-001`. Not aggregate-only sections.

5. **Loose gate-preflight (locked):** `validateScientistSidecars({ phase, artifactRoot })` lives in `src/phases/scientist.ts` or new `src/phases/gate-preflight.ts`. Phase code (`src/phases/plan.ts`) calls it BEFORE `requireGate(plan, ...)`. `src/state/run.ts` `requireGate` stays generic state orchestration. M7's three more call sites are mechanical.

6. **M6 inclusion of universal-rules + scientist persona + SCIENTIST.md (locked):** All three ship in M6, not deferred. CLAUDE.md rule 16 already requires every persona prompt to import `src/prompts/universal-rules.md`; shipping PLAN persona without it would violate the project's own rule.

7. **Docs-source offline behavior (locked):** Context7/live docs may populate `.code-oz/cache/docs/<library>.md`, but FakeProvider e2e uses local cached docs or explicit `No library` rationale. Never network in tests.

8. **Missing `rg` behavior (locked):** `code-oz doctor` detects it. Repo-context tools fail with actionable typed `ProviderError` (or new error class) when missing. No JS fallback in M6.

## Cross-cutting addendum from synthesis round (2026-04-30)

Five locked decisions from the synthesis round (`docs/research/MERGE_PLAN.md`) directly affect M6. Fold them in; do not re-debate.

1. **Rule 15 (Scientist) shape locked.** CLAUDE.md has the one-line pointer; `docs/contracts/SCIENTIST.md` has the mechanics. M6 ships SCIENTIST.md content (full discipline) + substrate + PLAN tail. Phase-tail wiring for BUILD/VERIFY/REVIEW lands in M7.

2. **Provenance ban on `claude-code-main`.** Codebase context retrieval is clean-room from public sources. Do NOT `/add-dir` claude-code-main. CLAUDE.md influence library section documents the exclusion.

3. **`tool_use.repo_context` schema locked.** Concrete TypeScript shape is in `docs/research/CODEX_RESPONSE_SYNTHESIS.md` "Where I disagree" point 3 and `MERGE_PLAN.md` rule 18 wording. AgentPermissions extension goes in commit 4.

4. **`budgets.global` is the only namespace.** No `budgets.run`. Add `maxWallTimeMinutes`, `softWarnAtRatio`, optional `priceTable` to `budgets.global`. Wall-time computed from `run_started.ts` event in `events.jsonl`.

5. **Scientist substrate vs. tail separability.** These MUST land together (Codex's "must land together" list, repeated for clarity): contract docs (commit 1), parsers/serializers (commits 2 + 3), atomic writers (existing pattern reused), event types (commit 5), one gate preflight (commit 10), Scientist persona + phase-tail runner (commit 9). These can land later (W2 territory): CLI commands, cross-run memory, older-than-N re-verification, primary-artifact H/Q citation requirement, designer loop.

## Cross-cutting addendum from M4 (still applies)

These M4-locked decisions remain durable in M6:

1. **Short-lock pattern is canonical.** Every provider call in M6 (PLAN persona invocations, scientist phase-tail invocations) goes through `invokeAgent(ctx, req)`. Never bypass.

2. **ProviderFamily is cross-family authority.** M6 doesn't fire REVIEW gate (M7 does). PLAN persona stays `provider: claude` per existing bundled defaults.

3. **agent_invoked events ALWAYS carry the four metrics.** M6 phase logic constructs `ProviderRequest` paths-only; wrapper computes `filesSent`/`bytesSent`/`tokensEstimate`/`fieldsRemovedByScope`. The new `repo_context_searched` event has its OWN fields (`resultBytes`, `resultTokensEstimate`), not the four-metric pattern.

4. **Conservative token estimator is the single shared estimator.** `src/providers/cost.ts:36` ~4 chars/token. M6 uses this for `repo_context_searched.resultTokensEstimate` too.

## Resume notes

If a session crashes mid-M6, the resume aid is:

- Branch `feat/m6` (or whichever branch the implementation is using) shows the last completed commit
- Each commit in the 14-commit sequence is independently testable; resume at `git log -1` and verify `bun test` passes before continuing
- The Codex rounds (synthesis + M6) are immutable history; do NOT re-run them unless the scope changes materially
- Mid-implementation Codex consultation is allowed (`mcp__plugin_agent-codex_codex-native__codex` for design questions inside a commit's scope), but commit-level Codex review is the post-implementation pattern (CLAUDE.md rule 8)

## Don't-do list

These are anti-scope-creep guardrails specific to M6:

- **Don't reference `~/Projects/agents/templates/claude-code-main/`** for any reason. The exclusion is durable.
- **Don't add new `tool_use` sub-scopes beyond `repo_context`** in M6. Adding e.g. `tool_use.web_search` is W3+ scope.
- **Don't extend the Scientist beyond substrate + PLAN tail** in M6. CLI commands, cross-run memory, designer loop = W2.
- **Don't relax CLAUDE.md rule 1** (file-based gates only). HYPOTHESES.md / OPEN_QUESTIONS.md sidecar validation produces typed errors and writes NEEDS_INTERVENTION.json on failure. No "soft" gate failures.
- **Don't break M5's existing tests.** All 542 tests must still pass after M6 lands. Universal rules retroactively injecting into BA persona must not change SPEC.md output for existing fixtures (test against the canned transcript in `tests/fixtures/transcripts/nontechnical-baby-game.md`).
- **Don't push to GitHub** without explicit user approval. Local commits only.
- **Don't amend or rebase commits.** Each commit in the 14-commit sequence stands alone for the implementation review trail.
- **Don't introduce JSON for inter-phase handoffs.** PLAN.md, SOURCE_CHECK.md, HYPOTHESES.md, OPEN_QUESTIONS.md are all plain Markdown per rule 7.
- **Don't add concurrent-run support.** Single-active-run pointer (M3) is sufficient. Concurrent runs = W3.
- **Don't ship a JS fallback for missing `rg`.** Doctor detects, tools fail with typed error. JS fallback = W3 polish.

## Acceptance gate (before tag)

After commit 14 lands, verify:

- All 542 M5 tests still pass plus the new M6 tests (target ~700+ total)
- `bun run typecheck` passes clean
- `bun run build:binary` produces a working `dist/code-oz` reporting `0.6.0-alpha.0`
- `code-oz init` + `code-oz run` against the fixture repo produces a complete DEFINE → PLAN trace stopping at PLAN gate
- `code-oz doctor` reports `rg` status
- A Codex implementation review (per CLAUDE.md rule 8) returns `push` or close all `block-push` / `block-next-milestone` findings before tagging
- `git log` shows 14 logically distinct commits in the locked order; no amends, no rebases
- `MEMORY.md` updated if any non-obvious lessons emerged

If any of the above fails, the milestone is not ready. Fix-first or debate-required per CLAUDE.md rule 8.

## Pointers to the round artifacts

For mid-implementation reference:

- **CLAUDE.md** — rules 1–19, all durable
- **`docs/design/ROADMAP.md`** § M6 — full scope and acceptance criteria
- **`docs/research/MERGE_PLAN.md`** — synthesis-merge plan, decisions 1–9
- **`docs/design/CODEX_BRIEFING_M6.md`** — twelve M6-specific debate prompts, leans, counter-arguments
- **`docs/design/CODEX_RESPONSE_M6.md`** — Codex's verdict, six push-backs with concrete alternatives, eight lock-in decisions
- **`docs/research/01-`** through **`07-`** — the seven research dossiers (the influence base)

End of M6 kickoff.
