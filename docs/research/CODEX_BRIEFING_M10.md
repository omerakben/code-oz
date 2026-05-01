# code-oz — M10 Codex briefing (Debate runtime + `requestDebate()` primitive)

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M9 has shipped (`v0.9.0-alpha.0`, 1578 tests passing offline, `feat/m9-review` → `main` merged locally with three Codex review rounds closing `push` after fix-first cycles). The thesis pressure-test debate closed `accept-with-modifications` (`docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`, thread `019de031`, 2026-04-30). The M7-M10 shape thesis closed `feature-with-modifications` (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`, thread `019ddea0`, 2026-04-30); CLAUDE.md rule 20 is in force ("one new authority boundary per milestone"); ROADMAP locks M10 = **Debate runtime authority**. The post-M10 productization sequence is locked: M11 = Provider capability contract; M12 = Company roster (shipped roles only); M13 = Role-cost policy; M14 = Reviewer panel v1 (first simultaneous-provider surface); M15 = Debate-policy scheduler v1.

The shared contract surface M10 implements against was authored in M7 commit 2 and is fully pinned:

- `docs/contracts/DEBATE.md` (15k, M7-shipped, process-only) — artifact layout (`.code-oz/artifacts/debates/<phase>-<topic>/{BRIEFING,RESPONSE.codex,RESPONSE.claude,DECISION}.md`); BRIEFING.md required H2 sections (`What you are reading`, `Where we stand`, `What is locked`, `What is up for debate`, `The recommended path`, `Decision prompts`, `What I want from you`); RESPONSE.{codex,claude}.md required H2 sections (`Verdict on the decisions`, `Risks the proposing side missed`, `Where I disagree`, `What I would defer`, `Recommended next step`); DECISION.md required H2 sections (`Verdict`, `Rationale`, `What changes (artifact deltas)`, `What does not change`, `Open follow-ups`); two verdict enums (planning: `accept | accept-with-modifications | reject | feature-with-modifications`; review: `push | fix-first | debate-required`); event names (`debate_started`, `debate_resolved`); `tool_use.debate` TypeScript shape (opposingProviders, maxConcurrent, previewBeforeSend, maxFiles, timeoutMs); budget accounting under `budgets.global` (no parallel namespace); seven runtime errors (`debate_decision_missing`, `debate_briefing_missing_section`, `debate_response_verdict_invalid`, `debate_decision_no_rationale`, `debate_opposing_provider_same_family`, `debate_manifest_blocked`, `debate_concurrent_limit_exceeded`).
- `docs/contracts/REVIEW.md` (M9-shipped) — names `tool_use.review_request` as the M9 sub-scope and the only existing cross-provider primitive (`requestReview`). M10's `requestDebate` is the second cross-provider primitive; M9's loop-discipline+evidence pattern is the template.
- `docs/contracts/SCIENTIST.md` (M6-shipped, M7/M8/M9 consumed) — `Open follow-ups` in DECISION.md cross-link to `OPEN_QUESTIONS.md`.
- `CLAUDE.md` rules 7 (Codex debate at planning convergence — the empirical rule M10 codifies), 9 (Codex's verdict is data, not authority — DECISION.md cannot rubber-stamp), 13 (privacy by default — manifest preview), 19 (`budgets.global` enforcement, no parallel namespace), 20 (one new authority boundary per milestone — Debate runtime is M10's), 21 (no new parallel-provider surface without measurable risk-reduction effect — M10 ships a single-opponent surface; multi-opponent debate is M16+ deferred until measurable need).

**M10 is now Debate runtime + `requestDebate()` primitive implementation only.** Acceptance per ROADMAP § M10:

> Any phase persona with `tool_use.debate` permission can invoke `requestDebate`; events recorded; artifacts written. DECISION.md is mandatory; debate without recorded DECISION → `NEEDS_INTERVENTION.json` per Codex's "archived theater" risk. Manifest preview blocks before send if any file would violate `.code-ozignore`. Budget accounting under `budgets.global` (no parallel namespace). Hybrid artifact: canonical Markdown + `events.jsonl` audit trail; never JSON as canonical artifact (rule 7). e2e: PLAN persona hits a design question, invokes `requestDebate`, both providers respond, DECISION.md authored, PLAN continues; full audit in `events.jsonl`. All M9 tests still pass. Tag: `v0.10.0-alpha.0`.

You are not debating *what* the debate artifacts look like (DEBATE.md pins that). You are not debating *whether* DECISION.md is mandatory (DEBATE.md + CLAUDE.md rule 7 pin that). You are debating **how to thread the runtime primitive through the existing M9 phase + persona + provider substrate without inventing new authority surface area** — twelve implementation decisions where my leans need pressure. Push back hard where the leans are wrong; sanity-check rather than rubber-stamp where they hold.

Ozzy's framing of why Debate runtime matters (user, 2026-04-30): *"the prompts you are prompting Codex with — this is what we find the most valuable things."* Cross-family debate at planning convergence has been the empirical practice for every milestone since M2 (M2-M9: nine briefing/response pairs, three of which produced architectural flips: MVP option C → E at M1, BUILD-VERIFY-REVIEW splitting at M7-shape, product thesis at the synthesis round). M10 makes the manual practice programmatic — invokable from inside any phase persona on any design question, with the same artifact discipline and the same authority-data distinction (rule 9).

Mirror the verdict format from `CODEX_RESPONSE_M9.md`: numbered decisions, `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications` per the DEBATE.md verdict enum; "Where I agree", "Where I disagree (with specific alternative)", "Risks the proposing side missed", "Decisions you must lock before code".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1-21. Especially:
  - Rule 1 (file-based gates): debate artifacts are file-based; debate verdicts are *not* gate signals; the calling phase's gate file does not advance based on debate verdict.
  - Rule 2 (cross-family review): M10 generalizes from REVIEW-gate cross-family to phase-internal cross-family debate; the same family invariant applies.
  - Rule 7 (Codex debate at planning convergence): the empirical rule M10 implements as runtime.
  - Rule 9 (Codex's verdict is data, not authority): DECISION.md cannot auto-merge Codex verdicts; calling persona authors with mandatory rationale.
  - Rule 13 (privacy by default): manifest preview is the M10 enforcement of "files sent to provider" preview per phase.
  - Rule 16 (universal-rules.md injection): debate-issuing personas import the universal rule sheet; M10 does not relax this.
  - Rule 19 (`budgets.global` enforcement): debate calls are provider calls under the existing budgets namespace; no parallel `budgets.debate`.
  - Rule 20 (one new authority boundary per milestone): M10's authority is **Debate runtime authority**. Strictly one boundary.
  - Rule 21 (no new parallel-provider surface without measurable risk-reduction effect): M10 ships single-opponent only. Multi-opponent debate is M16+ deferred until measurable need.

- **`docs/contracts/DEBATE.md`** (M7 commit 2, ~15k) — process-only contract M10 implements against. Read in full. Especially: § Artifact layout, § BRIEFING.md required H2 sections, § RESPONSE.{codex,claude}.md required H2 sections, § DECISION.md required H2 sections, § Verdict enum (locked), § Event types (definition only; M10 implements), § Permission sub-scope (definition only; M10 implements), § Budget accounting (under `budgets.global`), § Common errors (M10 will surface; documented now).

- **`docs/contracts/REVIEW.md`** (M9 commit 1) — M9's pattern that M10 mirrors. Especially: how `tool_use.review_request` schema is shaped; how the cross-provider primitive's family check is layered (load + invocation + recorded post-condition); how multi-turn orchestration is keyed in the event log.

- **`docs/contracts/SCIENTIST.md`** — DECISION.md `## Open follow-ups` cross-links to `OPEN_QUESTIONS.md`.

- **`docs/design/ROADMAP.md` § M10** — file list: `src/tools/debate-request.ts`, `src/artifacts/debate.ts`, `src/agents/schema.ts` (sub-scope add), `src/state/schemas.ts` (event types add), `src/state/events.ts` (validators add), `src/tools/debate-permissions.ts`, `src/providers/cost.ts` (debate accounting), `docs/contracts/DEBATE.md` (upgrade from process to runtime), tests, `tests/e2e/debate-from-plan.test.ts`.

You do not need to re-read every M2-M9 source file. Glance at:

- **`src/tools/review-request.ts`** (85 lines, M4) — the existing cross-provider primitive M10 mirrors. Already enforces cross-family via `ctx.registry.familyOf()`. Single-call shape (no loop) — M10's debate is also single-call (asymmetric, see Decision 9).
- **`src/phases/review.ts`** (1769 lines, M9 final) — the orchestration pattern. Especially: the cross-family invocation-time check at line 567 (`registry.familyOf` against recorded BUILD family); the persona shim with bounded repair prompt; the per-round atomic resume in `review-resume.ts`. M10's debate orchestration is structurally simpler (one round-trip, no loop) but mirrors the family-check + atomic-resume + bounded-repair shape.
- **`src/artifacts/review-report.ts`** (48k, M9 final) — the canonical artifact-parsing pattern. `parseDebateBriefing`, `parseDebateResponse`, `parseDebateDecision` follow the same BOM-strip, line-split, section-walk shape; orchestrator-owned shape (header parsing, section presence, enum validation) and persona-owned content (rationale text, recommendation prose).
- **`src/tools/repo-context/`** (M6) + **`src/tools/test-runner.ts`** (M8) — sibling tool patterns. M10's `debate-request.ts` and `debate-permissions.ts` mirror the same shape: typed input, providerError on permission/family violations, async iterable of provider events, no caching of provider state.
- **`src/agents/schema.ts`** (922 lines) + **`src/agents/load.ts`** — `AgentPermissions.tool_use` shape with four existing sub-scopes (`repo_context`, `write`, `execute`, `review_request`). M10 adds the fifth: `debate`. Mirrors M9's `validateReviewRequest` shape: tools, opposingProviders (vs review_request's `providers` — same families enum), bounded numeric caps, network is implicit (provider-only).
- **`src/state/schemas.ts`** + **`src/state/events.ts`** — event union pattern. M10 adds 2 `debate_*` event types per DEBATE.md (M9 added 4 `review_*`; M10 adds 2 — debate is single-round, REVIEW is multi-round).
- **`src/providers/cost.ts`** (`assertWithinBudget`, `summarizeBudgetUse`) — already handles per-phase + global tokens/turns/calls via reduction over `events.jsonl`. M10's debate calls flow through `invokeAgent` like every other provider call; no new accounting code unless the lean is wrong (see Decision 11).
- **`src/providers/manifest.ts`** (264 lines) — the existing manifest builder enforces path-safety + `permissions.read` upper-bound + symlink-escape rejection. M10's manifest preview reuses this; the new piece is `.code-ozignore` filtering OR explicit deferral (see Decision 6).
- **`src/agents/defaults/{lead,reviewer}.md`** — the M2-stub-replaced personas. M10 extends `lead.md` (the PLAN persona) with `tool_use.debate` permission; persona body adds a "you may invoke a debate" instruction. No new persona files; no replacement of M9's reviewer.
- **`src/prompts/index.ts`** `composeReviewPromptPure` (M9 commit 5) — the prompt-composer pattern. M10's `composeDebateBriefingPromptPure` and `composeDebateSynthesisPromptPure` mirror the same `{{TOKEN}}` template structure.

---

## Where we stand

```
$ git log --oneline -3
43c53de docs(research): M9 overnight summary for Ozzy's morning review
20aacd6 Merge feat/m9-review: M9 REVIEW-lite + cross-family handoff (v0.9.0-alpha.0)
644f39b v0.9.0-alpha.0 — M9 REVIEW-lite + cross-family handoff (...)

$ bun test
1578 pass / 1 skip / 0 fail (3978 expects, 121 files)

$ git tag -l v0.*
v0.1.0-alpha.0 ... v0.9.0-alpha.0  (10 tags)

$ git branch --show-current
feat/m10-debate
```

What works:
- DEFINE → PLAN → BUILD → VERIFY → REVIEW spine end-to-end (offline FakeProvider + live Claude+Codex providers).
- Cross-family REVIEW with M9's loop discipline (4-round cap; orchestrator-owned binary verdict; per-round atomic resume; cross-family invocation-time check; recorded post-condition).
- `tool_use` umbrella with four sub-scopes: `repo_context` (M6), `write` (M7), `execute` (M8), `review_request` (M9).
- `requestReview` as the only existing cross-provider primitive (M4-shipped, M9-consumed).
- Universal manifest builder with path-safety + permissions.read + symlink-escape (M5-shipped).
- Budget enforcement under `budgets.global` (M6 substrate; M9 confirmed unchanged for REVIEW's per-round provider calls).

What's stubbed or deferred:
- SHIP phase: stub.
- AUDIT phase (brownfield): stub but with `AUDIT.md` artifact contract pinned.
- `consult()` broad primitive: v0.3 only; not M10.
- Multi-opponent debate: M16+ deferred per CLAUDE.md rule 21.
- Debate skill marketplace: W5+.
- Debate UI surfaces: W2 TUI inspector.
- `.code-ozignore` file: NOT yet implemented in v0.1. CLAUDE.md rule 13 names it; no source code parses it. DEBATE.md § Permission sub-scope mentions it. M10 must decide whether to ship it now or treat it as deferred (see Decision 6).

---

## What is locked (not up for debate)

These come from CLAUDE.md, DEBATE.md (M7), the M7-M10 shape thesis debate, and the M9 closure overnight (audit findings closure-by-closure).

1. **Debate writes BRIEFING.md + RESPONSE.{codex,claude}.md + DECISION.md to `.code-oz/artifacts/debates/<phase>-<topic>/`.** Section order, H2 grammars, verdict enums, error codes are all pinned in DEBATE.md. Persona may not invent sections.
2. **`tool_use.debate` is the only new sub-scope landing in M10.** Schema lands in `src/agents/schema.ts`; load-time + runtime validation per the M9 `validateReviewRequest` pattern: bounded `maxConcurrent` (≤ 4 hard cap), bounded `maxFiles` (≤ 50 hard cap, mirroring repo_context), bounded `timeoutMs` (≤ 600_000 / 10 minutes, mirroring review_request), `previewBeforeSend: true` (fixed; cannot be configured false), `opposingProviders: ProviderFamily[]` (non-empty subset of `claude | codex | gemini`). Cross-family at load time: cannot include the persona's own family.
3. **DECISION.md is mandatory; debate without DECISION.md → `NEEDS_INTERVENTION.json` with code `debate_decision_missing`** (per CLAUDE.md rule 7 + DEBATE.md "archived theater" risk + Codex's M7-M10 shape risk #4). The runtime emits `debate_resolved` only when DECISION.md is atomically written.
4. **Two events: `debate_started` (BRIEFING.md atomically written; opposing-party invocation begins) and `debate_resolved` (DECISION.md atomically written; control returns).** Event schemas land in `src/state/schemas.ts` mirroring the M9 review_* event shape: `runId`, `phase`, `topic`, `debateDirPath`, `briefingSha256`. `debate_resolved` additionally carries `verdict` (one of the locked enum values) and a one-line rationale summary capped at 200 characters and `decisionSha256`.
5. **Budget accounting under `budgets.global`** per CLAUDE.md rule 19. Each opposing-party turn increments `maxProviderCalls` by 1; tokens contribute to `maxTokensEstimate`. Soft warn at 75%; hard kill at 100%. Re-uses M6/M9 `assertWithinBudget`. No parallel namespace.
6. **Markdown remains canonical (rule 7); `events.jsonl` is audit-only.** DECISION.md/BRIEFING.md/RESPONSE.md are the source-of-truth artifacts; events index them via sha256.
7. **Cross-family enforcement layered: load-time, invocation-time, recorded post-condition.** Mirrors M9's three-layer pattern. Load-time: `tool_use.debate.opposingProviders` cannot contain caller persona's own family. Invocation-time: `ctx.registry.familyOf(opposingProvider)` ≠ `ctx.registry.familyOf(callerProvider)`. Recorded post-condition: BRIEFING.md and DECISION.md frontmatter cite both family ids.
8. **Asymmetric debate only in v0.1.** One proposer, one opponent, one RESPONSE file (`RESPONSE.codex.md` or `RESPONSE.claude.md` depending on the opposing provider). Symmetric debate (two RESPONSE files) is deferred. DEBATE.md allows both; M10 ships only asymmetric.
9. **Single-opponent only in v0.1.** Multi-opponent debate is M16+ deferred per CLAUDE.md rule 21 (no new parallel-provider surface without measurable risk-reduction effect; single-opponent is the rule-21 baseline that future multi-opponent measures against).
10. **No new authority surfaces.** M10 introduces exactly one authority boundary: Debate runtime authority. M10 does NOT preempt M11 (provider capability contract), M12 (company roster), M13 (role-cost policy), M14 (Reviewer panel), or M15 (debate-policy scheduler).
11. **All tests offline via FakeProvider.** Debate e2e tests use FakeProvider keyed by `(phase, agent, debateTopic, side)` where `side ∈ {opponent, synthesis}` to distinguish the two persona turns of a single debate (see Decision 1).
12. **Topic slug grammar:** lowercase-kebab-case, ≤ 48 characters, descriptive. Phase prefix anchors to a gate: `define-`, `plan-`, `build-`, `verify-`, `review-` for phase-scoped debates; `meta-` for cross-phase. M10 implements load-time validation of the topic slug regex; collisions on `<phase>-<topic>` within a single run fail fast (see Decision 12).
13. **Universal rules sheet (rule 16) injected into debate-issuing persona prompts.** Imported from `src/prompts/universal-rules.md`; persona may add debate-specific rules below but cannot relax universals.
14. **CLAUDE.md rule 9 (Codex's verdict is data, not authority) constrains DECISION.md authorship.** The calling persona authors DECISION.md with mandatory `## Rationale` section; the orchestrator validates section presence + non-empty rationale; the orchestrator does NOT auto-merge the opposing party's verdict. Empty rationale → `debate_decision_no_rationale` intervention.

---

## What is up for debate

Twelve decisions. Numbered for your reply.

### Decision 1 — Two-turn vs three-turn debate flow

**My lean: two-turn flow. Turn 1: calling persona emits a `<debate-request>` block in its primary phase response (mirroring M7's patch-extraction pattern). Orchestrator extracts, validates, atomically writes BRIEFING.md, emits `debate_started`, invokes opposing provider via `invokeAgent` (one provider call), atomically writes RESPONSE.{codex,claude}.md. Turn 2 (synthesis turn): orchestrator re-invokes the calling persona with a `composeDebateSynthesisPrompt` that injects (BRIEFING + RESPONSE) and asks for DECISION.md content. Persona returns DECISION.md body; orchestrator validates required H2 sections + non-empty rationale + verdict-in-enum, atomically writes DECISION.md, emits `debate_resolved`. Phase resumes from after the original `<debate-request>` block.**

Three paths considered:

- (a) **Two-turn flow** (lean): persona-extract-block → opposing-call → persona-synthesis. One opposing-provider call, two calling-persona turns (the original phase turn + the synthesis turn). Counts as +1 provider call (opposing) + 0 calling-turn budget overhead beyond what the phase already spends (the synthesis turn is part of the original phase invocation budget; see Decision 11).
- (b) **Three-turn flow with explicit acknowledgment**: persona requests → orchestrator confirms BRIEFING is parseable → opposing-call → orchestrator delivers RESPONSE → persona confirms it received the response → persona authors DECISION. The "confirm" turns add safety against persona drift between turns. +1 calling-turn budget overhead.
- (c) **Single-turn flow with deferred DECISION**: persona requests, opposing replies, DECISION is *not* written in the same flow; the calling persona authors DECISION in a later phase turn (or never, with `debate_decision_missing` intervention catching the failure at run termination). Simpler primitive but pushes DECISION authorship out of the single requestDebate cycle and risks "archived theater".

**Counter-cases to consider:**
- (a) requires the synthesis-turn prompt to fully serialize BRIEFING + RESPONSE for the persona's context. Token cost: ~2x of the original phase turn. But because debate is rare (per rule 21, on-demand only) the cost is bounded.
- (a) also raises: what if the persona's synthesis-turn output is grammatically broken (missing `## Rationale`, missing `## Verdict`, verdict outside enum)? Lean: bounded one-shot repair (mirroring M9's bounded repair prompt pattern in `runReview`); two attempts max, then intervention.
- (c) would let the persona "save" the debate response to artifacts and decide later, but rule-7 + rule-9 demand the *resolution* be tied to the *invocation* — no archived theater.

**Question for you:** two-turn flow with bounded one-shot repair on synthesis (lean), three-turn with explicit acknowledgments, or single-turn with deferred DECISION?

### Decision 2 — Persona's `<debate-request>` block grammar

**My lean: a fenced code block with locked YAML frontmatter, mirroring the M7 patch-extraction pattern but smaller.**

```
<debate-request>
topic: plan-source-priority
opposing_provider: codex
question: |
  Should we prefer Anthropic docs over OpenAI docs when both
  describe the same API surface?
files:
  - path: src/providers/types.ts
  - path: src/providers/registry.ts
</debate-request>
```

Required keys: `topic`, `opposing_provider`, `question`, `files` (array; may be empty for purely-design debates with no codebase context). The orchestrator's parser tolerates the persona omitting the explicit list-of-paths if `files: []` is provided; absence of the `files` key fails parse (`debate_briefing_files_missing`).

Three paths considered:
- (a) **YAML-in-fenced-block** (lean): regex-extractable, robust, mirrors M7. The persona can emit it anywhere in its response; the orchestrator extracts the first occurrence per phase turn.
- (b) **Tool-call surface**: the persona uses a structured tool-call (Anthropic-tools-API style). Cleaner but couples to provider tool-call protocol; FakeProvider would need to fake tool-calls; M9's review-request used the prompt-extraction approach because it kept the contract provider-agnostic.
- (c) **JSON block**: same as (a) but JSON. Less ergonomic for the question text (which contains newlines + quotes); YAML's literal-block scalar is a better fit.

**Counter-cases to consider:**
- (a) demands a strict regex for the fenced block; persona drift (typo in `</debate-request>`, missing closing fence) fails parse. Lean: one bounded repair attempt with the exact error code + violated rule + offending lines (mirroring M9's bounded repair).
- (a) also raises: what if the persona emits two `<debate-request>` blocks in one phase turn? Lean: orchestrator processes the first and ignores the rest; emits `debate_multiple_requests_dropped` warning event. Or fail fast — same-phase-turn multiplexing isn't supported in v0.1.

**Question for you:** YAML-in-fenced-block with first-only-processed (lean), tool-call surface, or JSON block? And: drop-with-warning vs fail-fast on multiple blocks?

### Decision 3 — `requestDebate()` callable shape

**My lean: async iterable of provider events, mirroring `requestReview` from M4.**

```ts
export interface DebateRequest {
  /** Phase prefix in the topic slug (matches caller's invocation phase). */
  readonly phase: AgentPhase
  /** Topic slug; lowercase-kebab-case ≤ 48 chars; not yet collision-checked. */
  readonly topic: string
  /** The proposing persona's question to the opposing party. */
  readonly question: string
  /** Files surfaced into BRIEFING.md (paths-only handoff; runtime loads). */
  readonly files: readonly ProviderFileRef[]
  /** Opposing provider id. Must be in caller's tool_use.debate.opposingProviders. */
  readonly opposingProvider: ProviderId
  /** The calling persona (for synthesis turn). */
  readonly caller: AgentDefinition
  /** Run id. */
  readonly runId: string
}

export async function* requestDebate(
  ctx: InvokeContext,
  req: DebateRequest,
): AsyncIterable<ProviderEvent> { ... }
```

Three paths considered:
- (a) **Async iterable of provider events** (lean): yields opposing-party events first, then synthesis-turn events. Caller (the orchestrator running the calling phase) consumes both streams transparently. Mirrors M4 `requestReview` (M9-consumed unchanged) and M9 `runReview`.
- (b) **Two separate calls**: `prepareDebate(req) → BRIEFING+RESPONSE persisted` and `concludeDebate(req, persona) → DECISION persisted`. More explicit phase boundaries but requires the caller (phase orchestrator) to maintain mid-flight state between the two calls.
- (c) **Single Promise<DebateResult>**: returns a typed result with all four artifact paths populated. Hides streaming; loses budget-soft-warn-mid-flight signaling.

**Counter-cases to consider:**
- (a) requires the async iterable to interleave events from two distinct provider invocations (opposing + synthesis). Manageable if event types include a `debateTurn: 'opposing' | 'synthesis'` discriminator. Otherwise the consumer can't tell which turn produced each event. Lean: add `debateTurn` to `agent_invoked` events emitted from inside `requestDebate`. (This is a small schema add.)
- (b) is what `runReview` shape is *not* — M9 runs a single multi-round generator. Splitting requestDebate into two functions would break the M4/M9 pattern.

**Question for you:** async iterable mirroring requestReview (lean), two-call shape, or single-Promise return?

### Decision 4 — Where does the opposing-party turn run?

**My lean: opposing party runs as a one-shot `invokeAgent` call with a synthetic `AgentDefinition` for the opposing reviewer-style persona — i.e., M10 ships an internal `debate-opponent` persona definition (not exposed in `src/agents/defaults/`) generated at runtime per opposing-provider id, scoped to read-only on the BRIEFING + manifest files. This avoids requiring users to author a separate "opposing persona" file and matches the way `runReview` already constructs its provider request.**

Three paths considered:
- (a) **Internal synthetic AgentDefinition** (lean): orchestrator builds a frozen AgentDefinition with `provider: opposingProvider`, `phase: caller.phase`, `permissions: { read: '*', write: 'deny', bash: 'deny', tool_use: { repo_context: { ... read-only with the manifest files } } }`, `body: a fixed system prompt requiring the opposing party to author the RESPONSE.md per DEBATE.md schema`. No file on disk; constructed in `src/tools/debate-request.ts`.
- (b) **User-authored `debate-opponent.md` persona files** (one per opposing family, e.g., `agents/defaults/debate-opponent-codex.md`): users see the prompts and can customize them. More configuration surface; more user burden; more drift risk between proposing and opposing personas.
- (c) **Reuse the calling persona's body as the opposing persona's body**: opposing party gets the same prompt as the caller. Conceptually elegant ("debate yourself") but defeats the cross-family value (the opposing model gets a prompt tuned for the calling family's conventions).

**Counter-cases to consider:**
- (a) means the opposing party's prompt is hardcoded in M10 source and cannot be tuned without a code change. Lean: ship the opposing-party prompt as a Markdown file under `src/prompts/debate-opponent-system.md` (still single-source, still in-tree, but editable without TypeScript edits — same shape as M9's `review-system.md`).
- (a) also raises: do we need the opposing party to use `tool_use.repo_context` to read the BRIEFING manifest, or do we inline the manifest content into the BRIEFING.md body? Lean: inline the manifest content; opposing party gets BRIEFING.md only, no separate tool-use surface in v0.1. This matches CLAUDE.md rule 13 (privacy by default — explicit file manifest, never silent recursive context).

**Question for you:** internal synthetic AgentDefinition with externalized prompt file (lean), user-authored persona files per opposing family, or reuse-caller-persona body?

### Decision 5 — DECISION.md verdict authority

**My lean: calling persona authors verdict; orchestrator validates verdict-in-enum; orchestrator does NOT auto-merge opposing party's verdict (rule 9). Empty `## Rationale` (whitespace-only or below a 50-char minimum) → `debate_decision_no_rationale` intervention.**

Three paths considered:
- (a) **Calling persona authors, orchestrator validates** (lean): persona writes `## Verdict: accept-with-modifications` (or rejected/feature-with-modifications) + `## Rationale` text; orchestrator validates verdict ∈ enum AND rationale non-empty AND verdict ≠ verbatim copy of opposing party's verdict (a heuristic hint that the persona is rubber-stamping; emit `debate_decision_rubberstamp_warning` event but do not block).
- (b) **Orchestrator computes verdict from a deterministic rule** (e.g., if opposing said `accept` and caller's response says `accept`, verdict is `accept`; if either said `reject`, verdict is `reject` unless caller explicitly disagrees with `feature-with-modifications`). Removes persona authority but adds a brittle heuristic that can produce wrong verdicts when both parties agree-but-with-different-modifications.
- (c) **Persona authors verdict; opposing party also names a verdict in RESPONSE; orchestrator records the disagreement explicitly** in DECISION.md frontmatter (`opposing_verdict: reject`, `caller_verdict: accept-with-modifications`). Gives audit value but doesn't change who *decides*.

**Counter-cases to consider:**
- (a) is consistent with CLAUDE.md rule 9 ("Codex's verdict is data, not authority"). The persona has authority; the orchestrator validates shape.
- (a) raises: what is the rubberstamp heuristic? Lean: warn-only when DECISION.md verbatim-copies the opposing RESPONSE's verdict text (case-insensitive match); never block. The warning event surfaces in the `events.jsonl` audit and `code-oz doctor --bundle`.
- (c) is independently useful (audit value) and compatible with (a). Lean: do (a) AND record both verdicts in DECISION.md frontmatter for audit, regardless of whether they agree.

**Question for you:** calling-persona-authors with rubberstamp warning + dual-verdict frontmatter (lean), orchestrator-computed deterministic verdict, or persona-authored without warning?

### Decision 6 — Manifest preview and `.code-ozignore` enforcement

**My lean: M10 implements minimum-viable `.code-ozignore` parsing (gitignore-format subset) for the debate manifest preview path only; expands later milestones bring it to other phases. The preview file is `.code-oz/artifacts/debates/<phase>-<topic>/MANIFEST.preview.md` written before BRIEFING.md is sent. If any file in `req.files` matches a `.code-ozignore` pattern, the runtime emits `debate_manifest_blocked` intervention BEFORE BRIEFING.md is written and BEFORE the opposing-party call. The check is opt-in: if `.code-ozignore` is absent from the project root, the check is a no-op (not an error).**

Three paths considered:
- (a) **Minimum-viable `.code-ozignore` for debate only** (lean): `src/tools/debate-permissions.ts` contains a small gitignore-subset parser (literal patterns + leading `**/` + trailing `/`); used only by debate; other phases (BUILD/VERIFY/REVIEW) ignore `.code-ozignore` until W4 hardening. Manifest preview written as audit. Blocked files → intervention. Absence of `.code-ozignore` is not an error.
- (b) **Defer `.code-ozignore` to W4 entirely**: the manifest preview just enforces `permissions.read` (already done by `manifest.ts`). DEBATE.md's "blocked at preview" semantics become "out-of-bounds files trigger `debate_manifest_blocked` via the existing manifest builder." No new code; no `.code-ozignore` parser.
- (c) **Implement full `.code-ozignore` semantics across all phases now**: add `.code-ozignore` to BUILD/VERIFY/REVIEW manifest paths too. Larger scope; pollutes M10's authority boundary (rule 20 violation — debate runtime is the boundary, not "ignore-policy across all phases").

**Counter-cases to consider:**
- (a) has a wedge problem: only debate gets `.code-ozignore` enforcement, leading to a confusing user experience where the same file leaks via REVIEW but is blocked via debate. Codex's M7-M10 risk #1 ("worktree not a sandbox") applies similarly.
- (a)'s lean: make the gitignore-subset parser its own module (`src/tools/ignore-policy.ts`) so W4 can extend to other phases without rewriting. Module boundary now; coverage expansion later.
- (b) is less work but bakes in the wedge — DEBATE.md surfaces `.code-ozignore` semantics that the runtime does not honor; documentation lies.
- (c) violates rule 20 (one new authority boundary per milestone — adding a project-wide ignore policy would be a second boundary).

**Question for you:** debate-only minimum-viable with module-boundary-now (lean), defer `.code-ozignore` to W4 entirely, or implement project-wide now?

### Decision 7 — Topic slug uniqueness within a run

**My lean: topic slug `<phase>-<topic>` must be unique per `runId`. The orchestrator scans `events.jsonl` for prior `debate_started` events with matching `topic`; on collision, the new requestDebate fails fast with `debate_topic_collision` intervention. Persona-authored topic must be specific enough; "rebottoming the same topic" is a bug, not a feature.**

Three paths considered:
- (a) **Fail fast on collision** (lean): one debate per topic per run. The persona must pick a more specific topic on retry (e.g., `plan-source-priority-anthropic-vs-openai` after `plan-source-priority`).
- (b) **Auto-suffix on collision**: `<phase>-<topic>-2`, `<phase>-<topic>-3`, etc. Allows the persona to debate the same topic twice with different framing.
- (c) **Cross-run uniqueness**: topic must be unique across all runs in the project. Too restrictive; design intent is per-run scope.

**Counter-cases to consider:**
- (a) raises a real failure mode: a persona with bad topic discipline could collide on every retry, halting the phase. Lean: the bounded one-shot repair on the original `<debate-request>` block (Decision 2) catches this — repair prompt names the existing topic and asks for a more specific one.
- (b) makes the artifact directory listing harder to skim (`plan-source-priority`, `plan-source-priority-2`, ... — which one was the canonical?). The audit story is muddier.

**Question for you:** fail-fast-with-repair (lean), auto-suffix, or cross-run uniqueness?

### Decision 8 — Atomic resume semantics

**My lean: per-debate atomic resume (mirroring M9's per-round resume). On resume, orchestrator scans `events.jsonl` for `debate_started` without matching `debate_resolved`; for each open debate, probe the artifact directory: BRIEFING.md present + RESPONSE present + DECISION absent → re-invoke calling persona's synthesis turn; BRIEFING present + RESPONSE absent → re-invoke opposing party; nothing present → first-time invocation. Sha-bound: BRIEFING.md sha must match `debate_started.briefingSha256`.**

Three paths considered:
- (a) **Per-debate sha-bound resume** (lean): mirrors M9's `probeReviewResume` shape (returns reason: `'no_response' | 'no_decision' | 'briefing_sha_mismatch'`). Calling phase passes through `runDebate` orchestrator that handles resume internally before the new requestDebate call enters its main path.
- (b) **No resume in v0.1**: a crashed debate becomes intervention; user re-runs the phase from clean (loses prior phase progress). Simpler implementation; worse UX.
- (c) **Coarse-grained resume**: detect any open `debate_started`; re-write everything from scratch (BRIEFING + opposing call + synthesis). Loses the existing artifacts; wastes provider calls.

**Counter-cases to consider:**
- (a) requires the orchestrator to compare on-disk BRIEFING.md sha against the `debate_started.briefingSha256` event field. Mismatch → intervention with a clear "operator has edited the BRIEFING.md mid-debate; abort and re-run cleanly" message.
- (a) also raises: what if the opposing party's RESPONSE.md is partially written (crash mid-write)? Lean: atomic-write only. The artifact is either fully present or absent; tmpfile-rename pattern. No partial-RESPONSE state to handle.

**Question for you:** per-debate sha-bound resume (lean), no resume in v0.1, or coarse-grained resume?

### Decision 9 — Privacy preview as audit artifact vs interactive gate

**My lean: the manifest preview is an audit artifact, not an interactive gate. The runtime writes `MANIFEST.preview.md` synchronously before BRIEFING.md is sent; if no `.code-ozignore` blocks fire, the run proceeds. Operator review of MANIFEST.preview.md is post-hoc (via `events.jsonl` + `code-oz doctor --bundle`); no synchronous "y/n" prompt blocks the flow.**

Three paths considered:
- (a) **Audit artifact, no interactive gate** (lean): runtime is non-interactive (matches v0.1 design — phase personas have no console). Preview file is a forensic record; blocking is only on policy match (`.code-ozignore`).
- (b) **Interactive gate via `code-oz approve debate <runId> <topic>`**: like `code-oz approve verify`. Operator must run the command for each debate before BRIEFING.md is sent. Larger CLI surface; breaks the streaming-debate-flow that runs without operator presence (e.g., overnight runs).
- (c) **Hybrid: interactive gate by config** (`debate.previewMode: 'audit' | 'interactive'`): operator chooses per project. Larger config surface; one more knob in the v0.1 cookbook.

**Counter-cases to consider:**
- (a) means the operator has no veto on a debate's manifest before send. The veto is `permissions.read` upper bound + `.code-ozignore`; both are pre-configured. Insufficient for a sensitive run? Lean: rule 13 ("privacy by default") is honored by the policy + audit; interactive gating is a W2 TUI feature, not M10.
- (b) is fully aligned with CLAUDE.md rule 13's "files sent to provider preview per phase" but pushes operator UX work into M10 that belongs in W2.

**Question for you:** audit artifact (lean), interactive gate, or hybrid via config?

### Decision 10 — Authority of the opposing-party RESPONSE verdict

**My lean: the opposing party's RESPONSE includes a verdict in `## Verdict on the decisions` (per DEBATE.md schema), but that verdict is data, not authority. The orchestrator validates verdict-in-enum on the RESPONSE; it does not propagate the RESPONSE verdict into `debate_resolved.verdict` (which is owned by DECISION.md). DECISION.md's verdict can disagree with RESPONSE's verdict; rule 9 demands so.**

Three paths considered:
- (a) **RESPONSE verdict is data; DECISION verdict is authority** (lean): orchestrator validates RESPONSE shape (verdict-in-enum, all 5 H2 sections) but does not gate on its content. `debate_resolved.verdict` reads from DECISION.md.
- (b) **Co-equal: orchestrator records both verdicts; gate fires on disagreement**: e.g., if opposing says `reject` and caller says `accept`, the orchestrator emits a special `debate_disagreement` event that requires explicit user resolution before phase continuation. Larger surface; turns rule 9 ("data, not authority") into a synchronization point.
- (c) **Opposing verdict propagates if caller's verdict is missing**: heuristic fallback. Defeats rule 9.

**Counter-cases to consider:**
- (a) means the RESPONSE's verdict is *audit* (recorded in events + RESPONSE.md frontmatter for review later) but does not change the run's flow.
- (a) raises: does the `debate_resolved` event need a `responseVerdict` field for audit, or is "read RESPONSE.md sha + parse" enough? Lean: include `responseVerdict` in the event for fast scan; it's a cheap field.

**Question for you:** RESPONSE-data + DECISION-authority with audit field (lean), co-equal-with-disagreement-event, or opposing-verdict-fallback?

### Decision 11 — Budget accounting boundaries

**My lean: debate is a +1 turn of the calling phase, not a sub-phase. Per DEBATE.md: `maxTurns: 0` for the debate itself (the debate doesn't increment phase turns; `phase_entered` fires once for the calling phase regardless of how many debates fire inside). `maxProviderCalls: +1` per opposing-party turn (the synthesis turn is part of the calling persona's existing budget). `maxTokensEstimate: +sum-of-tokens` for opposing-party call only (the synthesis turn counts under the calling persona's existing accounting via `assertWithinBudget` on the persona's next provider call).**

Three paths considered:
- (a) **Caller-phase accounting** (lean): the opposing call is one extra `agent_invoked`/`agent_completed` pair under the caller's phase. The synthesis turn is the calling persona's own turn (already budgeted by the phase invocation). No new budget knobs.
- (b) **Sub-phase accounting**: a new `phase: 'debate'` value (or special `subPhase` field) so debates are bookkept separately. Lets users cap "max 5 debates per run" via `budgets.perPhase.debate`. Adds a phase to the FSM (CLAUDE.md rule 1 — every phase has a gate; debates have no gates, so this would be a non-gating phase, which contradicts the FSM model).
- (c) **Per-run debate-cap config** (`debates.maxPerRun: 4`): independent of `budgets.global` namespace. Adds a parallel namespace, contradicting CLAUDE.md rule 19.

**Counter-cases to consider:**
- (a) means a runaway persona could request many debates within a single phase invocation; only `budgets.perPhase[phase].maxProviderCalls` and `budgets.global.maxProviderCalls` cap it. Lean: this is correct discipline — debate is a provider call, capped under existing rule 19 accounting.
- (a) raises: should there be a per-phase-invocation `maxConcurrent` enforcement at runtime (not just at schema)? DEBATE.md pins `tool_use.debate.maxConcurrent`. Lean: yes — the orchestrator's `requestDebate` checks `events.jsonl` for the current phase's open debates (started without resolved); if `≥ maxConcurrent`, fail fast with `debate_concurrent_limit_exceeded`. M10 implements this.
- (b) over-engineers; rule 1 says phases have gates. Debates do not have gates.

**Question for you:** caller-phase accounting (lean) with `maxConcurrent` runtime enforcement, sub-phase accounting, or per-run debate-cap?

### Decision 12 — Opening up debate to which personas in v0.1

**My lean: only the Lead persona (PLAN phase) gets `tool_use.debate` in M10's `src/agents/defaults/lead.md` extension. BA, Builder, Verifier, Reviewer, Scientist personas do NOT get `tool_use.debate` in v0.1. Rationale: PLAN is where source-verification disagreements naturally surface (Codex's strength); BUILD-time debate is bigger surface (worktree state introduces concurrency questions); REVIEW-time debate is M14 panel territory, not M10 single-opponent. Limiting M10's surface keeps the rule-21 baseline measurement clean.**

Three paths considered:
- (a) **PLAN-only** (lean): Lead persona only. Single-phase rollout; clean measurement against rule-21 baseline.
- (b) **PLAN + BUILD**: Lead + Builder. Adds worktree-state questions that builders genuinely face. Larger surface area; doubles the e2e tests.
- (c) **All phases**: every persona gets `tool_use.debate`. Maximum flexibility; minimum focus; rule 20 risk (one new authority surface, not five).

**Counter-cases to consider:**
- (a) means W2-onward can extend debate to additional phases without rewriting M10's primitive (the primitive is phase-agnostic; only the persona permission-grants change).
- (a) also raises: ROADMAP § M10 acceptance has "e2e: PLAN persona hits a design question, invokes requestDebate". This is consistent with PLAN-only.
- (c) immediately collides with REVIEW persona — should REVIEW persona invoke debate from inside REVIEW phase? Lean: explicitly NO in v0.1 — REVIEW's authority is the cross-family review at the gate; introducing intra-REVIEW debate confuses M14 panel scope.

**Question for you:** PLAN-only with primitive phase-agnostic (lean), PLAN + BUILD, or all phases?

---

## The recommended path

The twelve leans above synthesize into this commit sequence (~10 commits + milestone summary):

| # | Subject | Files |
|---|---|---|
| 0 | docs(design): synthesis (kickoff + Codex briefing/response) | `docs/research/CODEX_BRIEFING_M10.md` (this file), `docs/research/CODEX_RESPONSE_M10.md`, `docs/design/SESSION_M10_KICKOFF.md` |
| 1 | feat(agents): tool_use.debate schema + load validation | `src/agents/schema.ts`, `tests/agent-load-tool-use-debate.test.ts` |
| 2 | feat(state): debate event types + validators | `src/state/schemas.ts`, `src/state/events.ts`, `tests/state-events-debate.test.ts` |
| 3 | feat(artifacts): debate parser + serializer + canonicalizer | `src/artifacts/debate.ts`, `tests/debate-artifact-{parse,serialize,grammar,verdict-enum,decision-required-rationale,topic-slug}.test.ts` |
| 4 | feat(tools): ignore-policy module (debate-only consumer in M10) | `src/tools/ignore-policy.ts`, `tests/ignore-policy.test.ts` |
| 5 | feat(tools): debate-permissions manifest preview | `src/tools/debate-permissions.ts`, `tests/debate-permissions-{preview,blocked,empty-ignore}.test.ts` |
| 6 | feat(prompts): debate opponent + synthesis prompts | `src/prompts/debate-opponent-system.md`, `src/prompts/debate-synthesis-system.md`, `src/prompts/index.ts` (composers), `tests/prompts-debate-{compose,tokens}.test.ts` |
| 7 | feat(tools): requestDebate primitive | `src/tools/debate-request.ts`, `tests/debate-request-{cross-family,opposing-call,synthesis-turn,decision-validation,collision,resume,concurrent-limit}.test.ts` |
| 8 | feat(agents): lead persona gets tool_use.debate; phase orchestrator parses block | `src/agents/defaults/lead.md`, `src/phases/plan.ts` (block extraction), `tests/lead-debate-extraction.test.ts` |
| 9 | feat(e2e): PLAN debate end-to-end | `tests/e2e/debate-from-plan.test.ts`, FakeProvider keying extension |
| 10 | docs(contracts): DEBATE.md upgrade from process to runtime | `docs/contracts/DEBATE.md` (replace § "M10 will not change" with implemented surface) |
| 11 | chore(m9-cleanup): close deferred M9 audit nits | (M1, M2, M4 from M9 code-reviewer; one-pass) |
| 12 | v0.10.0-alpha.0 milestone summary | CLAUDE.md status line, version bumps, ROADMAP.md status |

Authority-boundary check: every commit lands within "Debate runtime authority". No new phases. No new gate types. No new provider primitives beyond `requestDebate`. No new budget namespaces. No new persona files (lead.md is *extended*, not replaced).

Test budget: ~250-300 net new tests (M9 added ~250). After M10: ~1850 tests passing offline.

---

## Decision prompts

For each numbered decision (1-12), give:

1. **Verdict**: `accept` | `accept-with-modifications` | `reject` | `feature-with-modifications` (per DEBATE.md verdict enum for planning debates).
2. **If accept-with-modifications or feature-with-modifications**: name the specific modification(s).
3. **If reject**: name the alternative path with concrete file/function/contract changes.
4. **Risks the proposing side missed**: anything I haven't surfaced. Especially: privacy holes, budget runaways, persona drift, atomicity failures, misalignment with M11+ post-M10 sequence.

After the per-decision verdicts, give:

- **Top-level verdict on the recommended commit sequence**: same enum.
- **Decisions that must be locked before any code lands** (numbered list, in order of severity).
- **Decisions that can be deferred to mid-implementation reconsideration** (with thresholds: e.g., "if the opposing party's prompt grows past 5k tokens, revisit Decision 4").

---

## What I want from you

A response file at `docs/research/CODEX_RESPONSE_M10.md` mirroring `CODEX_RESPONSE_M9.md` shape:

```markdown
# Codex M10 planning-convergence response

**Thread:** <thread id verbatim>
**Date:** <ISO 8601>
**Model:** gpt-5.5 xhigh
**Brief:** docs/research/CODEX_BRIEFING_M10.md

## Verdict on the decisions
[per-decision verdicts 1-12]

## Risks the proposing side missed
[numbered risks, severity-ordered]

## Where I disagree
[specific alternatives]

## What I would defer
[items to revisit during implementation]

## Recommended next step
[lock these N decisions; block-on these M risks; proceed to commit X]
```

Please push back hard on Decisions 1, 4, 5, 6, 9, 11, 12 — these are the design tensions where the lean could be wrong:

- **D1** (two-turn flow): am I underestimating the synthesis-turn drift risk?
- **D4** (synthetic opposing AgentDefinition): am I privatizing too much into M10 source vs surfacing as configurable persona files?
- **D5** (DECISION authority + rubberstamp warning): is the rubberstamp heuristic too soft? Should it block?
- **D6** (`.code-ozignore` minimum-viable): is the wedge too painful — should I defer entirely or expand now?
- **D9** (audit artifact, not interactive gate): is rule 13 honored in practice without an interactive gate?
- **D11** (caller-phase budget accounting): am I missing a runaway-debate failure mode?
- **D12** (PLAN-only): is BUILD-debate genuinely deferrable, or does Builder's worktree-state question demand it now?

Sanity-check Decisions 2, 3, 7, 8, 10 (mostly mechanical) but flag if the leans are wrong.

Default to one strong recommendation per decision. The synthesis round (between this response and the implementation kickoff) will weigh your verdicts against my leans, lock the resolved decisions in `SESSION_M10_KICKOFF.md`, and produce the final commit sequence. Per CLAUDE.md rule 9, your verdict is data, not authority — Ozzy and I will weigh and lock.

---

End of briefing.
