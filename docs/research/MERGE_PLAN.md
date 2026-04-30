# Research synthesis — merge plan after Codex round

**Authored:** 2026-04-30, on `docs/research-synthesis`
**Synthesis commit:** `e5191aa` ([SYNTHESIS.md](./SYNTHESIS.md))
**Codex round commit:** `9f6a8cf` ([CODEX_RESPONSE_SYNTHESIS.md](./CODEX_RESPONSE_SYNTHESIS.md))
**Verdict:** `proceed-with-modifications`

This is the third and final synthesis commit. It folds Codex's six push-backs and four agreements into a final-form recommendation the user reads to make the actual calls. CLAUDE.md, ROADMAP.md, and milestone kickoff docs are still NOT modified by this commit; the user applies the changes in follow-up sessions.

---

## What CLAUDE.md should add

Five rules, all `modified-per-codex` from the synthesis draft. Rule 15 reshape was the largest delta; rules 16–19 survive with minor tightening.

### Rule 15 — Epistemic sidecars at phase gates

`modified-per-codex`

**Final wording (one-line CLAUDE.md addition):**

> Every phase contract that produces a primary artifact must include the Scientist tail defined in `docs/contracts/SCIENTIST.md`; gate preflight validates HYPOTHESES.md and OPEN_QUESTIONS.md and blocks overdue open questions before writing GATE_<PHASE>_PASSED.json.

**What changed from synthesis draft:** Codex flagged the original three-sentence rule with embedded mechanics as too long for CLAUDE.md's 150–200 instruction budget. The reshape moves the schema, gate-preflight logic, hypothesis/question lifecycle, and rejection rules into a new contract doc `docs/contracts/SCIENTIST.md`. CLAUDE.md keeps a one-line pointer.

**New deliverables:**
- `docs/contracts/SCIENTIST.md` — full discipline (replaces what synthesis put inside CLAUDE.md).
- `docs/contracts/HYPOTHESES.md` — artifact contract for the file format.
- `docs/contracts/OPEN_QUESTIONS.md` — artifact contract for the file format.

### Rule 16 — Universal anti-slop rules ship inside every persona prompt

`accepted`

**Final wording:**

> Every persona's system prompt imports the universal rule sheet from `src/prompts/universal-rules.md`. The rule sheet is the 20-item list (10 prohibitions + 10 affirmations) defined in `docs/research/02-llm-failure-research.md`. Personas may add their own rules below; they may not relax the universal ones.

Codex did not push back on this rule. Survives unchanged.

### Rule 17 — The maestro discipline is named and authoritative

`accepted`

**Final wording:**

> The maestro discipline (rule-checker role + 9-family bug map + adversarial-review skills + four-layer file-system memory) is documented in `docs/research/01-maestro-rule-checker.md`. Personas reference it; the orchestrator implements its skills; the bundle dossier is the spec. Updates to the discipline land as commits on the dossier with a top-of-file "## Update <date>" annotation.

Codex did not push back. Survives unchanged.

### Rule 18 — Codebase context retrieval has its own permission scope

`modified-per-codex`

**Final wording (one-line CLAUDE.md addition):**

> Agentic codebase search is a `tool_use.repo_context` sub-scope on agent permissions, defined in `docs/contracts/REPO_CONTEXT.md`. Search results are audited via `repo_context_searched` events; selected paths enter the *next* invocation's `ProviderRequest.files`, never the search invocation's hidden context. The maestro's `repo-search-before-write` skill is the consumer; the search backend is the new piece. Network access is denied for repo_context tools.

**What changed from synthesis draft:** Codex flagged the original "tool_use" framing as too generic. The reshape pins it as a sub-scope (`tool_use.repo_context`) with a concrete TypeScript schema. The schema lives in:

```ts
interface AgentPermissions {
  read: '*' | readonly string[]
  write: '*' | readonly string[]
  bash: 'deny' | readonly string[]
  tool_use?: {
    repo_context?: {
      tools: readonly ('glob' | 'grep' | 'read' | 'symbol')[]
      roots: readonly string[]
      maxResults: number
      maxBytesPerResult: number
      maxFilesForNextManifest: number
      timeoutMs: number
      network: 'none'
    }
  }
}
```

**New deliverables:**
- `docs/contracts/REPO_CONTEXT.md` — the discipline doc (tool list, caps, event shape, manifest flow).
- New event type `repo_context_searched` with shape `{ phase, agent, tool, query, roots, resultPaths, selectedPaths }`. Lands in `src/state/schemas.ts` event taxonomy.
- Schema extension to `src/agents/schema.ts` `AgentPermissions` per Codex's TypeScript shape above.

### Rule 19 — Run-level budget enforcement is mandatory, not advisory

`modified-per-codex`

**Final wording:**

> Cumulative budget enforcement is mandatory: `budgets.global.maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`, and optional `priceTable` for dollar telemetry. The wrapper layer's `assertWithinBudget` reads cumulative spend from `events.jsonl` per-call (no parallel state). Soft warnings fire at `budgets.global.softWarnAtRatio` (default 0.75); hard kills at 1.0. NEEDS_INTERVENTION carries the actionable suggestion when budget triggers a kill.

**What changed from synthesis draft:** Codex pushed back hard on the synthesis's `budgets.run` namespace. The existing `budgets.global` already has cumulative caps; adding parallel `budgets.run` keys creates two sources of truth. Reshape extends `budgets.global` with the new fields instead.

**New deliverables:**
- Extension to `src/config/schema.ts` `budgets.global` with `maxWallTimeMinutes`, `softWarnAtRatio`, optional `priceTable` for dollar estimates.
- Extension to `src/providers/cost.ts` `assertWithinBudget` to compute wall-time delta from `run_started.ts` and to emit soft-warning events at the configured ratio.
- New event type `budget_warning` with shape `{ phase, ratio, dimension }` (where `dimension` is one of `turns | providerCalls | tokensEstimate | wallTimeMinutes`).

---

## Milestone scope deltas to ROADMAP

### M6 — PLAN phase + 3-source verification

`accepted` with Codex modifications.

**Existing scope (unchanged from ROADMAP.md):** PLAN persona; 3-source verification; outputs PLAN.md and SOURCE_CHECK.md; gate before BUILD-lite.

**Additions (final, after Codex):**

- **Repo-context MVP for codebase search.** `accepted-with-codex-shape`. Tool set: `glob`, `grep`, `read` required; `symbol` optional in M6 (deeper LSP integration deferred to M7/W3). Implementation: `rg`-backed glob/grep wrapper, capped targeted reads. `repo_context_searched` event lands in M6. `tool_use.repo_context` permissions schema lands in M6. Selected paths flow into next-invocation `ProviderRequest.files`. Clean-room from public `claude-code` docs/patterns + `opencode` permissions + `agent-skills`; budget 4–6 working days (Codex's estimate).

- **Budget extensions to `budgets.global`.** `accepted-with-codex-shape`. New fields: `maxWallTimeMinutes`, `softWarnAtRatio`, optional `priceTable`. Wrapper extended; `budget_warning` event added. Per Codex point 6, no `budgets.run` namespace.

- **Tool-use permission schema extension.** `accepted-with-codex-shape`. `AgentPermissions` gains `tool_use.repo_context` sub-scope per Codex's TypeScript schema. `network: 'none'` is the default and only allowed value in M6; remote tools are W3+.

- **Phase-tail Scientist for PLAN.** `accepted-with-codex-shape`. M6 lands the substrate (parsers, serializers, atomic writers, event types, one gate preflight) plus PLAN's phase-tail. Codex's exact "must land together" list:
  - `docs/contracts/HYPOTHESES.md` and `docs/contracts/OPEN_QUESTIONS.md`
  - parsers/serializers in `src/artifacts/{hypotheses,open-questions}.ts`
  - atomic writers (existing `atomic-write.ts` reused)
  - new event types: `science_started`, `science_completed`, `hypothesis_added`, `hypothesis_falsified`, `question_opened`, `question_resolved`
  - gate preflight that validates the sidecars before `requireGate(plan, ...)` writes the gate file
- **Scientist bits explicitly deferred to W2:**
  - `src/agents/defaults/scientist.md` polish beyond v0.1
  - CLI commands `code-oz hypotheses list`, `code-oz questions list`, `code-oz questions resolve <Q-NNN>`
  - Cross-run `.codeoz/memory/scientist/`
  - Older-than-N re-verification
  - Primary-artifact H-NNN/Q-NNN citation requirement
  - Designer/reflection loop

**M6 commit budget:** Grows from 10 commits in ROADMAP.md to ~14. Budget estimate: 6–8 working days.

### M7 — BUILD-lite + VERIFY-lite + REVIEW-lite

`accepted` with synthesis additions intact.

**Existing scope:** Builder runs one atomic task in a worktree; Verifier runs configured commands; Reviewer cross-family review with `requestReview`; outputs BUILD_REPORT.md, VERIFY.md, REVIEW.md.

**Additions:**

- Iterative BUILD loop (Voyager pattern: write → run → see-error → patch → self-verify-before-commit). `accepted`. Bounded `maxBuildPatchRounds` in config.

- Mutation-test gate in VERIFY-lite. `accepted`. Required for new tests; advisory for legacy. Source: dossier 02 family 8.

- Phase-tail Scientist for BUILD, VERIFY, REVIEW. `accepted`. Same shape as M6's PLAN tail.

- DEFINE-0 / Prompter mini-experiment. `accepted`. Replays M5 canned transcripts with hand-written INTENT.md. Result feeds the W2 Prompter decision (Decision 4 below). Lives in `docs/research/M7_PROMPTER_EXPERIMENT.md`.

- Universal rule sheet (rule 16) shipped. `accepted`. New file `src/prompts/universal-rules.md`; prompt-compose updated to inject it into every persona prompt.

- Optional `symbol` LSP integration. `deferred-per-codex`. M6 ships `glob/grep/read`; deeper LSP `symbol` lookup moves to M7 or W3 if value/cost data warrants.

- DEFINE retro-seed from SPEC. `pending-decision-4-below`. Codex flagged the question of whether DEFINE gets retro-seeded with HYPOTHESES.md derived from SPEC.md without reopening M5.

### W2 — Non-expert workflow

`accepted` unchanged from synthesis. The reshaped W2 bundles Prompter + TUI inspector + onboarding + designer/reflection loop.

### W3+ — Production extension and W4 — AUDIT depth

`accepted` unchanged from synthesis.

### M-Scientist as a separate milestone

`rejected-per-codex`. Codex confirmed the synthesis's recommendation against a separate milestone. Phase-tail in M6/M7 is the path.

### Cross-cutting: telemetry feedback (`RunOutcome` events) + memory architecture

`accepted` unchanged from synthesis. Hooks land in M6/M7; full integration is W2/W3.

---

## Open questions still requiring user decision

Codex's five lock-in decisions, plus the synthesis's original five user decisions, deduplicated.

### Decision 1 (Codex #1) — Rule 15 wording

**Lean (mine + Codex):** Approve the short CLAUDE.md pointer (one line) plus `docs/contracts/SCIENTIST.md` for the mechanics. Synthesis's three-sentence rule with embedded mechanics is too detailed for CLAUDE.md's instruction budget.

**Alternative:** Explicitly accept detailed Scientist mechanics inside CLAUDE.md. Cost: each future evolution of the Scientist requires a CLAUDE.md edit. Future personas may not see the discipline if they read CLAUDE.md and skip the dossier.

**Why not auto-resolved:** This is a CLAUDE.md style choice. Both are defensible; the lean is more maintainable.

### Decision 2 (Codex #2 + Synthesis Decision 1) — Provenance policy on `claude-code-main`

**Lean (Codex's):** Ban leaked-source borrowing. Document the exclusion in CLAUDE.md's Influence library section. The 4–6 day clean-room timeline is acceptable for M6 because rule 3 (3-source verification before code) makes the codebase context retrieval mandatory, not a velocity question.

**Alternative (synthesis lean):** Accept the provenance risk with explicit "leaked-source" annotation. Save 4–6 days of M6 work.

**Why not auto-resolved:** This is a values + risk call the user owns. Codex made the conservative case; synthesis made the velocity case. The 1000-star ambition is sensitive to provenance signals; the spine demo timeline is sensitive to weeks of M6 work.

**My recommendation:** Take Codex's lean. The 4–6 days are buyable; the provenance asterisk is not unbuyable but is irrecoverable. The clean-room patterns are public anyway (`claude-code` docs, `opencode`, `agent-skills` template). Code-oz's differentiator is cross-family review, not Glob+Grep+LSP — building those clean-room is engineering, not innovation.

### Decision 3 (Codex #3) — M6 repo-context MVP lock-ins

**Lean:** Lock the tool set as `glob`, `grep`, `read`; mark `symbol` as optional in M6, default to deferred. Lock result caps with conservative defaults: `maxResults: 50`, `maxBytesPerResult: 64KB`, `maxFilesForNextManifest: 20`, `timeoutMs: 5000`, `network: 'none'`. Lock the `repo_context_searched` event shape per Codex point 4. Lock that selected results enter only via the next manifest (no hidden context bleed).

**Alternative:** Defer the cap-locking to M6 implementation; let the planning round refine.

**Why not auto-resolved:** Codex asked for explicit pre-merge locks because changing them mid-implementation invalidates the discipline. Pre-locking saves an M6 re-planning iteration.

**My recommendation:** Lock the tool set + event shape + manifest flow now. Defer specific cap numbers to the M6 Codex briefing where Codex can argue for tighter or looser based on the M6 fixture set.

### Decision 4 (Codex #4) — Scientist landing package: M6 only PLAN tail vs. all M6+M7 phases at once

**Lean:** M6 lands substrate + PLAN tail only. M7 wires BUILD/VERIFY/REVIEW tails (incremental adoption). DEFINE retro-seed is `optional in M6, recommended for completeness, opt-in via config flag`. Retro-seed never reopens M5: it generates HYPOTHESES.md / OPEN_QUESTIONS.md from SPEC.md sections without modifying SPEC.md.

**Alternative:** Land all four phase tails at once in M6 (PLAN + DEFINE retro-seed) + M7 (BUILD + VERIFY + REVIEW). Risk: under-shipping; benefit: complete discipline from day one.

**Why not auto-resolved:** Phase-tail wiring per phase is mechanical once substrate exists. The question is whether the user wants discipline-first (all-at-once) or spine-first (incremental). Option E favors spine-first.

**My recommendation:** Take the lean. Substrate + PLAN tail in M6; per-phase wiring lands in M7. DEFINE retro-seed is opt-in via `phases.scientist.retroSeedDefine: true` so it's available but doesn't pressure M6's commit budget.

### Decision 5 (Codex #5) — Budget naming: `budgets.global` extension vs. `budgets.run` parallel

**Lean (Codex's):** Keep cumulative run caps under `budgets.global`. Add `maxWallTimeMinutes`, `softWarnAtRatio`, optional `priceTable` there. No `budgets.run` namespace.

**Alternative (synthesis original):** New `budgets.run` namespace for run-level caps; `budgets.global` stays per-phase.

**Why not auto-resolved:** Codex pointed out the existing schema treats `budgets.global` as the cumulative scope (`maxTurns`, `maxProviderCalls`, `maxTokensEstimate` are already cumulative across phases). Adding `budgets.run` creates two sources of truth.

**My recommendation:** Take Codex's lean. Verified via `src/config/schema.ts:11` and `src/providers/cost.ts:67` — the existing `budgets.global` is cumulative-by-design.

### Decision 6 (Synthesis Decision 2 — superseded by Decision 4) — Adopt rule 15 (Scientist) before W2 or wait?

**Resolved.** Decision 4's lean covers this: substrate + PLAN tail in M6, per-phase wiring in M7. Rule 15 lands in CLAUDE.md alongside the M6 substrate commits.

### Decision 7 (Synthesis Decision 3) — DEFINE-0 / Prompter at all?

**Lean:** Run the M7 mini-experiment first; decide based on data. Synthesis recommended this; Codex did not push back.

**Why not auto-resolved:** The Prompter's worth depends on ask-me round-count delta on real friend-shaped inputs. The mini-experiment is a Friday afternoon; data-then-decision is the auditable path.

### Decision 8 (Synthesis Decision 4) — Push to GitHub now or wait for v1.0?

**Lean:** Push after M7 closes the spine. Synthesis recommended this; Codex did not address it (out of scope for the synthesis round).

**Why not auto-resolved:** Project-strategy decision. Memory says the user's bar is 1000+ stars with cross-family review as visible product; cross-family review becomes demonstrable at M7 spine close, not before.

### Decision 9 (Synthesis Decision 5) — File-system memory vs. knowledge graph

**Lean:** File-system for v0.1 + W2. Synthesis recommended this; Codex did not address it (out of scope).

**Why not auto-resolved:** Architecture choice with long-tail consequences. File-system is the conservative path; knowledge graph is W3+ if it justifies itself.

---

## Recommended next session

If the user accepts Decisions 1–5 with the leans above, the recommended next session is:

**Write `CODEX_BRIEFING_M6.md` with the Bucket B items baked in.** That is, M6's existing PLAN-phase scope plus:

- Repo-context MVP (Codex's clean-room build)
- `budgets.global` extensions
- `tool_use.repo_context` permissions schema
- Phase-tail Scientist substrate (HYPOTHESES.md / OPEN_QUESTIONS.md contracts, parsers, gate preflight, PLAN tail wiring)

The briefing's prompts debate trade-offs at the M6 implementation layer. Examples worth pre-loading:

- Cap-locking for `repo_context.maxResults` / `maxBytesPerResult` / `maxFilesForNextManifest` against the M6 fixture set.
- DEFINE retro-seed default (off vs. opt-in vs. on).
- Whether `repo_context_searched` events are subject to budget caps (probably yes for `tokensEstimate` since search results are bytes that will land in the next manifest).
- Whether `assertWithinBudget` extends to read `repo_context_searched` events for forward-looking cost projection (probably yes).

If the user rejects Decision 2 (provenance policy goes the other way — accept leaked-source borrowing), the M6 briefing changes: drop the clean-room timeline, lift patterns from `claude-code-main` directly, credit explicitly. M6 commit budget shrinks back toward 12 commits.

If the user rejects any of Decisions 1, 3, 5 (style-and-mechanics), the synthesis itself can be revised with one follow-up Codex round on the rejected items only; this is cheaper than re-running the whole synthesis.

Decisions 7, 8, 9 do not block M6; they shape later milestones and can be revisited at the end of M6.

End of merge plan.
