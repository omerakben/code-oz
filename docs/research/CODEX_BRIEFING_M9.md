# code-oz — M9 Codex briefing (REVIEW-lite + cross-family handoff)

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M8 has shipped (`v0.8.0-alpha.0`, 1325 tests passing offline, `feat/m8-verify-lite` → `main` merge with the Codex implementation review thread closed `push` after 5 fix-first commits landed). The M7-M10 shape thesis debate closed `accept-with-modifications` (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`, thread `019ddea0`, 2026-04-30); CLAUDE.md rule 20 is in force ("one new authority boundary per milestone"); ROADMAP locks M9 = **cross-family REVIEW authority**. The thesis pressure-test debate also closed (`docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`, thread `019de031`, 2026-04-30) and added CLAUDE.md rule 21 (no new parallel-provider surface without measurable risk-reduction effect). Rule 21 is forward-looking for M14+; M9's single-reviewer is the baseline future panels measure against.

The shared contract surface REVIEW consumes is fully pinned and richer than any prior milestone:

- `docs/contracts/REVIEW.md` (commit `d1cfb8e`, pre-M7) — REVIEW.md schema with six required H2 sections (Upstream refs, Reviewer, Round timeline, Findings, Score, Cap status), locked grammars (Round timeline bullet, Findings H3 block, Severity enum, Verdict enum), `tool_use.review_request` permission sub-scope, four event names (`review_started`, `review_round_completed`, `review_resolved`, `review_blocked`), Scientist tail spec, layered cross-family enforcement (load + invocation + recorded post-condition), 4-round loop cap with 3 exit-condition priorities, error taxonomy, M9 → SHIP handoff seam (W4).
- `docs/contracts/BUILD.md` (commit `d1cfb8e` + M7 commit 17 tightening) — what M9's REVIEW reads on entry: `Changed files` manifest (paths-only handoff per CLAUDE.md rule 2), `BUILD_REPORT.md` Patch sha256 + base commit + Task.Attempt.
- `docs/contracts/VERIFY.md` (commit `d1cfb8e` + M8) — what M9 reads: `BUILD ref.Patch sha256` (cross-checked with REVIEW's `Upstream refs.Patch sha256`), `Verdict.Verdict: pass` (precondition for REVIEW invocation).
- `docs/contracts/SCIENTIST.md` (commit `d1cfb8e`) — REVIEW runs Scientist phase-tail before writing `GATE_REVIEW_PASSED.json`; 3/3 cap matches M7/M8.
- `docs/contracts/DEBATE.md` (commit M7) — process-only contract; M10 territory; M9 does NOT preempt.
- `docs/research/SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md` (commit `b869f3b`, 2026-04-30) — Topic-1 sub-decisions for `review-system.md` plumbed in below as locked.

**M9 is now REVIEW-lite + cross-family handoff implementation only.** Acceptance per ROADMAP § M9:

> REVIEW receives changed file paths from BUILD's manifest (CLAUDE.md rule 2: never curated summaries). Cross-family enforcement at load time (M2): BUILD persona's `provider` family ≠ REVIEW persona's `provider` family. Loop capped at 4 rounds; exit on score ≥ 6 + verdict = ready (CLAUDE.md rule 6). Full v0.9 spine e2e test passes. All M8 tests still pass. Tag: `v0.9.0-alpha.0`.

You are not debating *what* to review (the contract pins that). You are not debating *what shape* the reviewer prompt takes (the synthesis doc pins that). You are debating **how to thread the multi-round REVIEW loop through the existing M7/M8 worktree + restart-policy substrate** — thirteen implementation decisions where my leans need pressure. Push back hard where the leans are wrong; sanity-check rather than rubber-stamp where they hold.

Ozzy's framing of why REVIEW discipline matters: cross-family REVIEW is the **product feature** that distinguishes `code-oz` from a single-model coding agent (per the thesis pressure-test, 2026-04-30). VERIFY caught the silent-corruption bug in M6; REVIEW catches the bugs the same family's blind spots can't see. M9's job is to ship that authority on top of M7's worktree + M8's restart-policy without inventing new authority surface area.

Mirror the verdict format from `CODEX_RESPONSE_M8.md`: numbered decisions, `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications` per the DEBATE.md verdict enum, "Where I agree", "Where I disagree (with specific alternative)", "Decisions you must lock before code".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1-21. Rules 1 (file-based gates), 2 (cross-family review at REVIEW gate — **M9's load-bearing rule**), 6 (4-round loop cap with score+verdict exit), 7 (Markdown contracts), 11 (`NEEDS_INTERVENTION.json` on cap), 13 (privacy by default — REVIEW receives file paths, never silent recursive context), 15 (Scientist tail at gates), 16 (universal-rules.md injection), 19 (`budgets.global` enforcement covers REVIEW's per-round provider calls), 20 (M9's authority boundary is **cross-family REVIEW authority** — strictly one boundary), 21 (no new parallel-provider surface without measurable risk-reduction effect — forward-looking for M14+; M9's single-reviewer is the baseline rule 21 measures against).

- **`docs/contracts/REVIEW.md`** (commit `d1cfb8e`) — REVIEW.md schema with six required H2 sections, locked Round timeline grammar (`Round <N>: <ISO> | findings raised: <count> | score: <0-10> | verdict: <ready | needs-revision | block>`), Findings H3 block grammar (`### F-NNN:` with File / Line / Severity / Recommendation / Round raised / Round resolved bullets), Severity enum (`block | fix-first | nit | fyi`), Verdict enum (`ready | needs-revision | block`), `tool_use.review_request` permission sub-scope, `tool_use.repo_context` REVIEW-side defaults (`maxFilesForNextManifest: 0` — REVIEW does not promote paths into a next manifest), four event names, Scientist tail with M7 3/3 cap, layered cross-family enforcement (load + invocation + recorded post-condition), 4-round loop cap with 3 exit-condition priorities, M9 → SHIP handoff seam (`Score.Final verdict` only — narrow on purpose), error table.

- **`docs/contracts/BUILD.md`** + **`docs/contracts/VERIFY.md`** + **`docs/contracts/WORKTREE.md`** — substrate REVIEW consumes: BUILD_REPORT.md `Changed files` manifest (paths-only handoff to REVIEW, rule 2), VERIFY.md `BUILD ref` (cross-checked at REVIEW's `Upstream refs`), worktree forensics layout (M7/M8 6+3 entries; M9 adds nothing new — REVIEW reads, does not preserve).

- **`docs/contracts/SCIENTIST.md`** — REVIEW runs Scientist tail before writing `GATE_REVIEW_PASSED.json`. Pass-side: reviewer-affirmed claims get `verified` annotations in HYPOTHESES.md. Fail-side: severity-`block` and `fix-first` findings that escaped a `ready` exit (which the schema forbids) seed `Q-NNN` open questions. 3/3 cap matches M7/M8.

- **`docs/contracts/DEBATE.md`** — process-only contract. M10 territory. M9 does **not** preempt the runtime; REVIEW persona may not invoke `requestDebate()` in v0.1.

- **`docs/research/SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md`** (commit `b869f3b`, 2026-04-30) — Topic-1 sub-decisions plumbed in below. Already-debated and resolved; do NOT relitigate.

- **`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`** (thread `019ddea0`) — your prior verdict naming M9 = cross-family REVIEW authority; risks #1 (worktree not a sandbox — applies to REVIEW's repo_context as much as VERIFY's runner), #2 (fake green gate — REVIEW is the last gate that can produce this if cross-family check is bypassable), #5 (Scientist tail gate noise — same 3/3 cap applies).

- **`docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`** (thread `019de031`) — added CLAUDE.md rule 21 (Agentless caution). M9 is the rule-21 baseline.

- **`docs/design/SESSION_M8_KICKOFF.md`** + **`docs/design/CODEX_RESPONSE_M8.md`** (thread `019ddf5f`) — empirical record of the 4-rejects-pattern Codex returned on M8. The lessons that generalize to M9: (a) **orchestrator owns binary verdicts**, persona owns rationale (M8 Decision 10 modification); (b) **gate-driven cleanup beats event-driven** (M8 Decision 7 modification); (c) **typed terminal-condition inputs** prevent attempt-cap leakage (M8 Decision 6 modification — `VerifiedFailedAttempt` typed input). All three apply to M9.

- **`docs/design/ROADMAP.md` § M9** — file list: `src/phases/review.ts`, `src/artifacts/review-report.ts`, `src/agents/defaults/reviewer.md`, `src/prompts/review-system.md`, REVIEW Scientist phase-tail, `src/tools/review-request.ts` consumed (M4 primitive — already shipped), tests, `tests/e2e/review-lite-greenfield.test.ts`, `tests/e2e/spine-greenfield.test.ts` (full DEFINE → REVIEW path), `fixtures/greenfield-web/` (extended), `docs/demo/v0.9-spine.md`.

You do not need to re-read every M2-M8 source file. Glance at:

- **`src/phases/verify.ts`** (906 lines, M8 final shape) — the canonical phase pattern after M8. REVIEW mirrors structure: orchestrator preflight → persona invocation → `repair → finalize` → atomic write → Scientist tail → gate-preflight. M8's authority-split discipline (orchestrator owns binary verdict + Round timeline; persona owns Findings + Score rationale) is the template.
- **`src/phases/build.ts`** (920 lines) — BUILD repair-loop pattern. The `repair → finalize` shape M9 mirrors per round.
- **`src/phases/restart-policy.ts`** + **`src/phases/schedule-attempt.ts`** (M8 final) — the substrate M9 *consumes*. REVIEW round needs-revision triggers BUILD attempt N+1 via `scheduleAttemptNPlus1` (M8 already wires this; M9 adds the REVIEW-side trigger path beyond VERIFY-fail).
- **`src/tools/review-request.ts`** (85 lines, M4) — the cross-provider primitive M9 consumes. Already enforces cross-family via `ctx.registry.familyOf()`. M9 does NOT modify this file; it calls into it from `src/phases/review.ts`.
- **`src/agents/loader.ts`** (207 lines) — load-time cross-family check already exists (`enforceCrossFamilyReview`). M2-shipped, M9 does NOT modify; M9 adds the *invocation-time* check in `src/phases/review.ts` and the *recorded post-condition* in `src/artifacts/review-report.ts`.
- **`src/artifacts/verify-report.ts`** (24 KB, M8) — the canonical artifact-parsing pattern. `parseReviewReport` follows the same BOM-strip, line-split, section-walk shape; orchestrator-owned `Round timeline` rows mirror VERIFY's orchestrator-owned `BUILD ref` discipline.
- **`src/agents/defaults/verifier.md`** (4.5k, M8 final post-Codex feedback) — the mid-size persona pattern. `reviewer.md` targets ~4-5k.
- **`src/agents/defaults/reviewer.md`** (1.9k stub from M2) — replaced wholesale in M9.
- **`src/prompts/verify-system.md`** (98 lines, M8 final) + **`src/prompts/index.ts`** `composeVerifyPromptPure` — the persona prompt template + composer pattern. M9 mirrors.
- **`src/state/schemas.ts`**, **`src/state/events.ts`** — event union pattern. M9 adds 4 `review_*` event types per REVIEW.md.
- **`src/agents/schema.ts`** + **`src/agents/load.ts`** — `AgentPermissions` shape. M9 adds `tool_use.review_request` per REVIEW.md (mirroring M8's `tool_use.execute` shape: only one provider tool, bounded `maxRounds: 4`, bounded `timeoutMsPerRound: 120000`, network = 'provider-only').

---

## Topic-1 sub-decisions (already locked, plumbed from synthesis 2026-04-30)

These four sub-decisions came out of the Codex agent-skills-borrow debate (thread `019de02f`) and the synthesis Claude wrote against it. Ozzy's user decision-points 1–4 in `SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md` § Topic 1 resolved as follows; Claude's leans match Codex. They are pinned for M9; do **not** relitigate.

1. **`src/prompts/review-system.md` is prompt-only scaffolding, not REVIEW.md schema change.** Universal rules first → reviewer identity → "review tests first" ordering directive → five axes (correctness / readability / architecture / security / performance) as internal review scaffolding. Severity enum unchanged. Findings H3 grammar unchanged. The five axes shape the reviewer's *thinking pass*; the orchestrator-owned outputs (Findings + Score + verdict) stay schema-conformant.
2. **"Review tests first" ordering directive is in `review-system.md`.** The reviewer reads tests before implementation; tests reveal intended behavior and verification gaps. This is the strongest single Codex addition from the borrow debate; it maps to a real failure mode (reviewers anchoring on implementation style and missing the verification gap).
3. **False-coverage caveat for the `security` axis is mandatory in `review-system.md`.** Verbatim language to include: *"the security axis flags surface-level concerns (input validation, secrets, hardcoded credentials, query parameterization, missing auth on a route); a full security audit is W4 SHIP scope."* This addresses Codex's "false coverage" pushback in the borrow debate.
4. **Per-phase Common Rationalizations table fork is rejected.** Universal `common-rationalizations.md` stays single. M9 may inline 2–3 REVIEW-specific rebuttals directly into `review-system.md` if needed (e.g., "I don't have time to read the tests" → "Reading tests first is the cheapest review you can do").

These shape decisions 11 and 12 below. They do not shape decisions 1–10, which are about loop orchestration and authority discipline.

---

## What's locked (not up for debate)

These come from CLAUDE.md, the pinned contracts, the M7-M10 shape thesis debate, and the Topic-1 synthesis above.

1. **REVIEW writes `REVIEW.md` with the six-section schema in `REVIEW.md`.** Section order, Round timeline grammar, Findings H3 grammar, Severity enum, Verdict enum, error codes are all pinned. Persona may not invent sections.
2. **`tool_use.review_request` is the only new sub-scope landing in M9.** Schema lands in `src/agents/schema.ts`; load-time + runtime validation per the M8 Decision 12 pattern: only one tool (`request-review`), bounded `maxRounds: 4`, bounded `timeoutMsPerRound: 120000`, `providers: ['codex', 'gemini']` (BUILD persona side — which families the BUILD persona may request reviewer from), `network: 'provider-only'`. REVIEW persona itself uses `tool_use.repo_context` (already shipped in M6) with `maxFilesForNextManifest: 0` (REVIEW does not promote paths into a next manifest, per REVIEW.md line 148).
3. **M4's `src/tools/review-request.ts` is consumed unchanged.** Already enforces cross-family via `ctx.registry.familyOf()`. M9 adds the *invocation-time* check in `src/phases/review.ts` and the *recorded post-condition* in REVIEW.md serialization.
4. **Loop hard cap is 4 rounds; exit on `score ≥ 6` AND `verdict: ready` AND no unresolved blocker.** Per CLAUDE.md rule 6 + REVIEW.md § Loop cap. Three exit conditions in priority order: (1) any round emits `verdict: block` → halt + `NEEDS_INTERVENTION.json`, (2) `score ≥ 6` + `verdict: ready` + no unresolved `block` or `fix-first` finding → exit ready, (3) round 4 ends without (1) or (2) → cap exhaustion + `NEEDS_INTERVENTION.json`.
5. **REVIEW persona is `codex` family in v0.1.** BUILD = claude (default), REVIEW = codex (default). Gemini stub. Cross-family enforcement is layered (load-time in `loader.ts` already, invocation-time in M9's `phases/review.ts`, recorded post-condition in REVIEW.md `Reviewer.Cross-family check: passed` bullet).
6. **REVIEW receives file paths only, never curated summaries** (CLAUDE.md rule 2; REVIEW.md § Reviewer cross-family check). The reviewer's prompt cites BUILD_REPORT.md's `Changed files` manifest verbatim; the reviewer's own `tool_use.repo_context` reads file contents from the worktree.
7. **REVIEW-lite stops before SHIP.** Pass writes `REVIEW.md` with `Final verdict: ready`, emits `review_resolved`, writes `GATE_REVIEW_PASSED.json` (after `code-oz approve review`), and the run terminates pending the still-stubbed SHIP phase.
8. **Scientist tail runs at REVIEW gate** per rule 15 + REVIEW.md § Scientist tail. Cap 3 new hypotheses + 3 new questions per REVIEW close. Pass-side: reviewer-affirmed claims (e.g., "the heuristic correctly handles hyphenated surnames after F-001 fix") get `verified` annotations. Block-side: `block` and `fix-first` findings that escaped a `ready` exit (schema forbids) seed `Q-NNN` — but since the schema forbids that path, the practical surface is cap-exhausted exits.
9. **Universal rules sheet (rule 16) injected into REVIEW persona prompt.** Imported from `src/prompts/universal-rules.md`; persona may add REVIEW-specific rules below but cannot relax universals.
10. **No DEBATE runtime in M9.** `requestDebate()` lands in M10. REVIEW persona's `tool_use` permissions in v0.1 cover only `repo_context` + `review_request`-receipt; explicitly NOT `debate`.
11. **All tests offline via FakeProvider with attempt-aware emission** (M8 pattern). REVIEW e2e tests use FakeProvider keyed by `(phase, taskId, attempt, reviewRound)`.
12. **`budgets.global` enforcement covers REVIEW's per-round provider calls.** Per CLAUDE.md rule 19: each REVIEW round increments `maxProviderCalls` by 1; round-driven BUILD re-attempts increment per their own M7/M8 accounting (no double-counting). Soft warn at 75%, hard kill at 100%. Re-uses the M6/M7/M8 `assertWithinBudget` shape; no parallel namespace.
13. **M9's authority boundary is single (CLAUDE.md rule 20): cross-family REVIEW authority.** This includes the loop discipline (4-round cap + score+verdict exit) because evidence is meaningless without the loop discipline that makes it authoritative — same shape as M8's "VERIFY evidence + restart-on-fail policy" inseparability.
14. **Topic-1 sub-decisions (above)** lock `review-system.md` to prompt-only scaffolding with five axes + tests-first + false-coverage caveat + REVIEW.md schema unchanged.
15. **CLAUDE.md rule 21 (Agentless-promoted-to-rule) is forward-looking for M14+, not a M9 surface.** M9's single-reviewer baseline is what rule 21's measurements (panel quorum vs single-reviewer) will compare against in M14. Do NOT preempt panel logic in M9.

---

## What's up for debate

Thirteen decisions. Numbered for your reply.

### Decision 1 — REVIEW round orchestration shape

**My lean: REVIEW is the *outer* loop; per-round orchestration is `review_round → (if needs-revision: BUILD attempt N+1 via `scheduleAttemptNPlus1`) → review_round+1`. A single REVIEW round consumes at most one BUILD attempt slot (which transitively may consume multiple BUILD attempts within M8's 4-attempt VERIFY-restart cap if the round-triggered BUILD fails VERIFY).**

Three paths considered:
- (a) **REVIEW-outer loop** (lean): round 1 reviews most recent BUILD/VERIFY pair; needs-revision → `scheduleAttemptNPlus1` (M8 path) with REVIEW-derived `Failure carry-forward` body → new BUILD attempt → if VERIFY passes, REVIEW round 2 fires; if VERIFY fails, M8 restart-policy fires within the REVIEW round (consuming BUILD attempts but not REVIEW rounds).
- (b) **Co-equal loops with explicit join**: BUILD-attempt loop and REVIEW-round loop maintained as separate counters; orchestrator joins them at gate transitions. More explicit, more code.
- (c) **REVIEW-as-callback**: REVIEW persona is invoked once per BUILD/VERIFY pair; the loop is implicit in the persona's verdict (the persona "decides" when to need-revise vs ready). Rejected — punts authority to the persona, contradicts M8 Decision 10 lesson (orchestrator owns terminal authority).

**Counter-cases to consider:**
- (a) means a *single* REVIEW round can consume up to 4 BUILD attempts under VERIFY-restart, and REVIEW.md line 209's "4 BUILD attempts × 4 REVIEW rounds = 16" math is wrong. The actual cap is **4 BUILD attempts AND 4 REVIEW rounds** with multiplicative composition only when each REVIEW round consumes exactly 1 BUILD attempt. See Decision 4.
- (a) also requires the orchestrator to track which BUILD attempt is "the one being reviewed in round N" — i.e., REVIEW round N's `Upstream refs.Patch sha256` binds to a specific BUILD attempt's patch hash.

**Question for you:** REVIEW-outer loop with explicit single-round-to-multiple-BUILD-attempts composition (lean), or co-equal loops with explicit join state?

### Decision 2 — Finding ID stability across rounds

**My lean: orchestrator mints `F-NNN` ids monotonically across the entire REVIEW loop (run-scoped, not round-scoped). Round 2's draft, when re-emitting findings raised in round 1, must reference existing ids; orchestrator validates id-stability in finalize. New findings raised in round 2 get the next monotonic id; resolved findings retain their original id with `Round resolved: 2` updated.**

Two paths considered:
- (a) **Run-scoped monotonic minting** (lean): `F-001`, `F-002`, ..., minted on first-raise; orchestrator owns the counter; persona references existing ids when re-emitting. Drift fails as `review_finding_id_collision`.
- (b) **Persona-authored ids with cross-check**: persona invents ids; orchestrator validates uniqueness and stability. Fragile — the persona could rename `F-001` → `F-007` accidentally.

**Counter-cases to consider:**
- (a) requires the orchestrator to feed round 2's persona the prior round's findings (with their `F-NNN` ids) as context. Mirrors BUILD's `Failure carry-forward` block pattern but content is structured findings, not free-form text.
- (a) also raises: if round 1 raised `F-001` (severity: fix-first) and round 2's BUILD attempt resolved it, who marks `Round resolved: 2` — the persona claims resolution, or the orchestrator validates against the new BUILD/VERIFY pair (e.g., does the new VERIFY.md show the fix-first concern is gone)?

**Question for you:** orchestrator-minted run-scoped ids with persona-claimed resolution validated by orchestrator (lean), or persona-authored with cross-check?

### Decision 3 — Verdict + Score authority split

**My lean: mirror M8 Decision 10. Orchestrator owns `Score.Final verdict` (binary `ready | needs-revision | block`) computed from `Findings` (any `block` severity → `block` verdict; any `block` or `fix-first` unresolved at exit → `needs-revision`; otherwise `ready` if score ≥ 6) and the round-final score. Persona owns `Findings` (severity, recommendation, file:line, rationale narrative inside Recommendation), `Score.Final score` (integer 0-10), and `Round timeline.<verdict>` per round. Orchestrator computes `Score.Final verdict` from these inputs at finalize time.**

Two paths considered:
- (a) **Orchestrator owns Final verdict** (lean): persona reasons about findings + score; orchestrator computes the binary verdict from those inputs deterministically. Removes the "fake green gate" surface (persona cannot claim `ready` while raising a `block` finding).
- (b) **Persona authors Final verdict with orchestrator cross-check**: persona declares `ready | needs-revision | block`; orchestrator validates against findings (rejects `ready` with unresolved blockers). M8 Decision 10's exact failure mode.

**Counter-cases to consider:**
- (a) is structurally cleaner but requires the persona's `Round timeline` per-round verdict to *also* be orchestrator-validated against per-round findings. Round timeline grammar names persona-authored verdict per round, but the same authority discipline applies.
- (b) is ergonomic for the persona (one less computation rule to learn) but reintroduces the M8 fake-green path.

**Question for you:** orchestrator owns Final verdict with persona-authored per-round verdict cross-checked (lean), or persona-authored with cross-check throughout?

### Decision 4 — REVIEW-round-to-BUILD-attempt cap composition

**My lean: BUILD attempts and REVIEW rounds are independent caps with multiplicative *worst case* but additive *typical case*. A single REVIEW round consumes 1+ BUILD attempts (1 if the round-triggered BUILD passes VERIFY first try; up to 4 if VERIFY-restart fires within the round). The 4-attempt BUILD cap is global per task; if a REVIEW round needs the 4th BUILD attempt and that attempt's VERIFY-restart exhausts attempts 4 → 5, M8's `NEEDS_INTERVENTION.json` fires before REVIEW round 2 can even start. Cap exhaustion can fire from either gate (REVIEW or VERIFY-restart) depending on which trips first. REVIEW.md line 209's "4 × 4 = 16" wording is loose; the actual cap is 4 BUILD attempts AND 4 REVIEW rounds, composing as a tree.**

Three paths considered:
- (a) **Independent caps with worst-case multiplicative composition** (lean): clearest accounting; matches existing M8 attempt-counter implementation (`events.jsonl` reduction over `(runId, taskId)`); no parallel state.
- (b) **Per-REVIEW-round BUILD-attempt counter reset**: each REVIEW round starts a fresh "BUILD-attempt tally" capped at 4 within that round. Total 16 worst case. Requires `(runId, taskId, reviewRound)` keyed counter.
- (c) **REVIEW round counts as a BUILD attempt slot**: only 4 *combined* BUILD/REVIEW iterations. Conservative; user-facing simplicity.

**Counter-cases to consider:**
- (a) means REVIEW round 4 is achievable only if BUILD attempts 1-3 each passed VERIFY first try (no restart). The probability of reaching round 4 in a real run is small — but the cap discipline must still cover the case.
- (b) introduces a third dimension to the attempt counter; M8 explicitly avoided that (Decision 2 ruled out `current.json` and separate `attempts.json` to avoid race conditions).
- (c) is the most user-friendly but conflates two distinct authority surfaces (BUILD-side patch quality vs REVIEW-side concern depth).

**Question for you:** independent caps with multiplicative worst-case (lean), per-round counter reset, or combined 4-iteration cap?

### Decision 5 — Cross-family check at invocation time

**My lean: load-time check stays in `src/agents/loader.ts` (M2-shipped, unchanged); invocation-time check fires in `src/phases/review.ts` immediately before invoking the M4 `requestReview` primitive, comparing the persistent run's BUILD provider (read from BUILD_REPORT.md `Provider`) against the configured REVIEW persona's provider. If the run's actual BUILD provider differs from the load-time-validated config (e.g., a config edit between BUILD and REVIEW), the invocation-time check fails with `review_cross_family_violation`. Recorded post-condition: `Reviewer.Cross-family check: passed` bullet in REVIEW.md.**

Two paths considered:
- (a) **Three-layer enforcement** (lean, REVIEW.md § Cross-family enforcement): load + invocation + recorded post-condition. Redundant by design — load-time prevents impossible runs from starting; invocation-time catches mid-run config drift; recorded post-condition is durable audit.
- (b) **Two-layer (load + recorded only)**: skip invocation-time. Simpler; assumes config is immutable mid-run. M2 already enforces immutability via the registry being built once at run start, but mid-run agent reload (which doesn't happen in v0.1) would bypass.

**Counter-cases to consider:**
- (a) is what REVIEW.md already pins — no real choice. The decision here is whether to *literalize* the contract or fold the invocation-time check into the M4 `requestReview` primitive's existing family check.
- M4's `requestReview` already does `ctx.registry.familyOf()`. The invocation-time check could just *be* that primitive's check. Then M9 adds "the recorded post-condition" only.

**Question for you:** literal three-layer (lean), or fold invocation-time into M4's existing family check (and add only recorded post-condition in M9)?

### Decision 6 — Round timeline writer

**My lean: orchestrator owns `Round timeline` writes. Persona authors per-round findings + score + verdict (round-level); orchestrator extends the timeline section atomically per round with the locked grammar. Persona never writes timeline text.**

Two paths considered:
- (a) **Orchestrator-only writer** (lean): orchestrator computes ISO timestamp, counts findings raised this round, accepts persona's score and verdict, formats per locked grammar, atomically appends. Mirrors VERIFY's BUILD-ref discipline.
- (b) **Persona authors timeline draft, orchestrator validates**: persona writes the timeline bullet; orchestrator validates grammar. Brittle — the persona could mis-format the timestamp, and reformatting would be a re-write not a rejection.

**Counter-cases to consider:**
- (a) means the persona never sees the prior rounds' timeline at draft time; the persona reasons over findings + history-of-findings only. Round 2's persona prompt includes round 1's findings (with `F-NNN` ids) but not round 1's timeline.
- (b) gives the persona explicit history but creates more grammar surface to validate.

**Question for you:** orchestrator-only timeline writer (lean), or persona-drafted with cross-check?

### Decision 7 — Findings file path validation

**My lean: orchestrator validates `File:` paths at finalize time (after persona produces a complete REVIEW.md draft) against BUILD_REPORT.md's `Changed files` manifest. Drafts that cite paths outside the patch fail with `review_finding_path_unknown` and trigger one repair round (Decision 9 cap). Validation does NOT fire during draft mid-stream — only at finalize.**

Two paths considered:
- (a) **Finalize-time validation** (lean): full draft → parse → check all File paths against manifest → reject as repair if any miss. Single validation pass, clean error semantics.
- (b) **Stream-time validation**: as the persona emits each finding, validate the path. Earlier feedback but more complex stream handling; the persona may revise mid-draft.

**Counter-cases to consider:**
- (a) is consistent with M8's parser pattern (parse-validate-then-repair-or-accept).
- (b) could provide incremental feedback that reduces repair rounds, but the persona would need a tool-call surface to query the manifest mid-draft, which we don't want to add.

**Question for you:** finalize-time validation (lean), or stream-time?

### Decision 8 — REVIEW-driven Failure carry-forward propagation

**My lean: when REVIEW round N emits `verdict: needs-revision`, the orchestrator constructs a `Failure constraint` from the round's findings (specifically the `block` and `fix-first` recommendations, joined as a single ≤ 200-char directive) and feeds it into BUILD attempt N+1's `Failure carry-forward` block. Mirrors M8's VERIFY-driven constraint construction but content-source is REVIEW findings, not VERIFY evidence. The summary field describes the round's findings ("REVIEW round 1 found 2 fix-first concerns and 1 block"); the constraint field is the imperative directive ("Add fixture for 'Ali-Khan' to scoring-syllable.test.ts; split on '-' before counting syllables").**

Two paths considered:
- (a) **Orchestrator constructs from findings** (lean): findings-to-constraint synthesis is a deterministic transform; no persona-authored carry-forward in the BUILD prompt.
- (b) **Persona authors carry-forward narrative**: REVIEW persona writes a `Carry-forward` field in REVIEW.md; orchestrator copies it into BUILD prompt. Adds another schema field; brittle.

**Counter-cases to consider:**
- (a) requires the orchestrator to pick which findings flow into the constraint. My lean: all `block` (verbatim) + first 2 `fix-first` (top by recommendation length, tied break by F-NNN order); ignore `nit` and `fyi` for carry-forward. This bounds the constraint to 200 chars.
- (b) gives the persona authoring control (it can synthesize more readable directives) but adds repair-cap surface.

**Question for you:** orchestrator-constructs from findings (lean), or persona-authors carry-forward narrative?

### Decision 9 — REVIEW persona repair cap per round

**My lean: 2 total drafts per round (initial + 1 repair), mirroring M8 Decision 9. Schema violation on draft 2 → `review_validation_failed` + intervention. Not config-driven in M9.**

Two paths considered:
- (a) **2 total drafts** (lean, mirror M8): tight discipline; structurally simpler output (Findings + Score + per-round verdict — orchestrator owns binary verdict, timeline, ids).
- (b) **3 total drafts**: consistency with PLAN/BUILD repair caps. Wider repair surface.

**Counter-cases to consider:**
- (a) requires per-round repair counting; cumulative across rounds means a 4-round REVIEW can have up to 8 persona drafts. `budgets.global` enforcement covers this transitively (each draft is a provider call).
- (b) eases the persona's repair surface but gives less authority to the orchestrator's grammar discipline.

**Question for you:** 2 total drafts per round (lean), or 3 total per round?

### Decision 10 — Round-resumption state for partial-failure mid-round

**My lean: round-resumption is per-round atomic. If the REVIEW orchestrator crashes mid-round (e.g., between persona draft completion and finalize), the partial REVIEW.md draft persists (e.g., as `REVIEW.draft-round-N.md` in `.code-oz/runs/<runId>/`) but the round is **not** considered complete. On resume, the orchestrator detects the partial draft, discards it (round restart with the same prior-rounds context), and re-invokes the persona. No mid-round state survives a crash; only completed rounds (REVIEW.md atomically written with full timeline through round N) survive.**

Two paths considered:
- (a) **Per-round atomic; discard partial drafts on resume** (lean): simplest crash semantics; no partial-state replay logic.
- (b) **Per-round atomic; persona-resumes-from-partial-draft on resume**: more efficient (no re-invocation cost) but introduces partial-state replay logic.

**Counter-cases to consider:**
- (a) wastes the partial draft's tokens but is crash-trivial.
- (b) requires the orchestrator to surgically merge partial-draft state with new persona output. Not worth the complexity for v0.1.

**Question for you:** per-round atomic with partial-discard on resume (lean), or partial-resume?

### Decision 11 — REVIEW persona size and content (Topic-1-shaped)

**My lean: target ~4-5k. Slightly larger than verifier's 4.5k because REVIEW has more reasoning surface (five-axis evaluation + tests-first ordering + finding-id stability + cross-round resolution-claim discipline). Includes universal-rules-import + reviewer-identity (cross-family framing) + tests-first directive + five-axis scaffolding (with the false-coverage caveat for `security`) + 2 worked examples (1 ready exit, 1 needs-revision exit) + 2-3 inline rebuttals to REVIEW-specific rationalizations (per Topic-1 sub-decision 4).**

The five-axis scaffolding is "scaffolding" not "schema" — the persona reasons through the axes internally, but the output stays in the locked Findings format. The axes don't appear as section headers in REVIEW.md.

**Counter-cases to consider:**
- ~5k is bigger than M8's verifier prompt; the Codex M8 review pushed back on the briefing's 5-6k lean and we landed at 4.5k. Same risk applies here.
- Could trim to ~3.5k by dropping one worked example (1 example total, not 2) and inlining only 1 rebuttal. Test in e2e: leaner prompt's repair rate vs lean+examples.

**Question for you:** ~4-5k with full Topic-1 scaffolding + 2 worked examples (lean), or ~3.5k with 1 example?

### Decision 12 — Topic-1 plumb-through into `review-system.md` template tokens

**My lean: `review-system.md` template has 6 required tokens, mirroring `verify-system.md`: `{{AGENT_BODY}}`, `{{COMMON_RATIONALIZATIONS}}`, `{{UNIVERSAL_RULES}}`, `{{AVAILABLE_TOOLS}}`, `{{READY_SIGNAL}}`, plus 1 new token specific to REVIEW: `{{PRIOR_ROUNDS_FINDINGS}}` for round 2+ context. Composer in `src/prompts/index.ts` mirrors `composeVerifyPromptPure` shape. Topic-1 sub-decisions 1, 2, 3 are baked into the template body verbatim (five axes + tests-first + false-coverage caveat). Topic-1 sub-decision 4 (no rationalizations fork) means the universal rationalizations file is unchanged; M9 may add 2-3 REVIEW-specific rebuttals inline in `review-system.md` body, NOT to a separate `review-rationalizations.md` file.**

The new `{{PRIOR_ROUNDS_FINDINGS}}` token is empty on round 1; populated on round 2+ with the prior rounds' findings list (F-NNN + severity + recommendation per finding) plus the prior round's verdict and score. Mirrors PLAN's `{{CONVERSATION}}` shape but for REVIEW-round history.

**Counter-cases to consider:**
- Adding a token = composer signature change. Acceptable; mirrors PLAN composer's `availableTools` slot extension pattern.
- Could pass prior findings as part of `{{AGENT_BODY}}` instead of a dedicated token. Less clean — `AGENT_BODY` is the persona file body, mixing in dynamic per-round content there blurs the asset/composer boundary.

**Question for you:** new `{{PRIOR_ROUNDS_FINDINGS}}` token in template (lean), or fold into existing slot?

### Decision 13 — REVIEW-lite e2e fixture strategy

**My lean: extend `tests/fixtures/greenfield-baby-name` with a third PLAN task `T-003` whose first BUILD attempt produces a patch that passes VERIFY but fails REVIEW round 1 (deliberately drafts code that triggers a `fix-first` finding the FakeProvider's reviewer is keyed to raise), and whose second BUILD attempt passes both VERIFY and REVIEW round 2 with `score: 7, verdict: ready`. Same fixture supports M9 e2e tests: `tests/e2e/review-lite-greenfield-pass.test.ts` (T-001 or T-002 — DEFINE → REVIEW one-round pass) and `tests/e2e/review-lite-greenfield-multi-round.test.ts` (T-003 — round 1 needs-revision → BUILD attempt 2 → round 2 ready). Plus the full-spine test `tests/e2e/spine-greenfield.test.ts` running DEFINE → PLAN → BUILD → VERIFY → REVIEW for the simplest task. FakeProvider keyed by `(phase, taskId, attempt, reviewRound)` extending M8's `(phase, taskId, attempt)` keying.**

Two paths considered:
- (a) **Extend `greenfield-baby-name` with T-003 + attempt-aware FakeProvider for REVIEW** (lean): reuses M5/M6/M7/M8 fixture; minimal new fixture surface; tests both pass and multi-round paths.
- (b) **Separate fixture `greenfield-review/`**: cleaner test isolation; duplicates SPEC.md, PLAN.md, agent configs.

**Counter-cases to consider:**
- (a) couples test isolation to FakeProvider state machine complexity (M8's complaint). Adding a 4th key dimension (reviewRound) deepens that.
- (a)'s reuse is a real value — the fixture has been validated through M5-M8.
- (b) avoids the 4-key complexity but bloats the fixture directory.

**Question for you:** extend with T-003 + 4-key FakeProvider (lean), or split fixtures?

---

## The recommended path (commit-by-commit, ~10 commits)

```
M9 commit 1:  src/agents/schema.ts adds tool_use.review_request; src/agents/load.ts validates;
              tests/agent-load-tool-use-review-request.test.ts (load-time + runtime)
M9 commit 2:  src/state/schemas.ts + src/state/events.ts add 4 review_* event types;
              tests/state-events-review.test.ts
M9 commit 3:  src/artifacts/review-report.ts (parse/serialize/atomic-write per REVIEW.md schema;
              orchestrator-owned Round timeline + Final verdict; persona-owned Findings + Score);
              tests/review-report-{parse,serialize,grammar,upstream-refs,timeline,findings,
              score,cap-status,verdict-authority}.test.ts
M9 commit 4:  src/prompts/review-system.md (universal-rules + tests-first + five axes +
              false-coverage caveat + 2 worked examples + 2 inline rebuttals);
              src/prompts/index.ts composeReviewPromptPure with {{PRIOR_ROUNDS_FINDINGS}} token;
              tests/prompts-review-{compose,tokens}.test.ts
M9 commit 5:  src/agents/defaults/reviewer.md (full ~4-5k persona with universal-rules-injection
              + cross-family framing; replaces M2 stub)
M9 commit 6:  src/phases/review-loop.ts (round orchestration: invoke persona → finalize draft →
              orchestrator computes binary verdict → check exit conditions → if needs-revision,
              build carry-forward and call scheduleAttemptNPlus1 → wait for new BUILD/VERIFY
              pair → loop back; if ready, exit; if block or cap, NEEDS_INTERVENTION);
              tests/review-loop-{round-1-pass,round-1-needs-revision,round-2-pass,
              round-1-block,cap-exhausted}.test.ts
M9 commit 7:  src/phases/review.ts (orchestrator: BUILD ref bind → cross-family invocation-time
              check → enter loop → Scientist tail at exit → gate-preflight); cleanup-on-approval
              hook in src/commands/approve.ts (M8 pattern: validate REVIEW.md + Scientist
              sidecars; remove worktree only at SHIP gate, NOT at REVIEW gate per WORKTREE.md);
              tests/review-phase-{pass,needs-revision-then-pass,block-halt,
              cap-exhausted-intervention,scientist-tail,cross-family-check}.test.ts
M9 commit 8:  src/phases/scientist.ts extension for REVIEW phase-tail (3/3 cap);
              tests/scientist-review-tail.test.ts
M9 commit 9:  Extend greenfield-baby-name fixture with T-003 (REVIEW-needs-revision-then-pass);
              extend FakeProvider keying to (phase, taskId, attempt, reviewRound);
              tests/e2e/review-lite-greenfield-pass.test.ts +
              tests/e2e/review-lite-greenfield-multi-round.test.ts
M9 commit 10: tests/e2e/spine-greenfield.test.ts (full DEFINE → PLAN → BUILD → VERIFY → REVIEW);
              docs/demo/v0.9-spine.md (the v0.9 demo trail)
```

Plus an eleventh Codex-review-fix commit if your verdict is `fix-first`.

Tag: `v0.9.0-alpha.0` after Codex review verdict = `push`.

---

## Decision prompts (numbered for your reply)

1. **Decision 1** — REVIEW orchestration shape: REVIEW-outer loop with explicit single-round-to-multiple-BUILD-attempts (lean), or co-equal loops with explicit join state?
2. **Decision 2** — Finding ID stability: orchestrator-minted run-scoped monotonic ids with persona-claimed resolution validated by orchestrator (lean), or persona-authored with cross-check?
3. **Decision 3** — Verdict + score authority: orchestrator owns Final verdict (lean), or persona-authored with cross-check?
4. **Decision 4** — Cap composition: independent caps with multiplicative worst-case (lean), per-round counter reset, or combined 4-iteration cap?
5. **Decision 5** — Cross-family invocation-time check: literal three-layer (lean), or fold into M4's existing family check?
6. **Decision 6** — Round timeline writer: orchestrator-only (lean), or persona-drafted with cross-check?
7. **Decision 7** — Findings path validation: finalize-time (lean), or stream-time?
8. **Decision 8** — REVIEW-driven carry-forward: orchestrator-constructs from findings (lean), or persona-authors carry-forward narrative?
9. **Decision 9** — REVIEW persona repair cap per round: 2 total drafts (lean), or 3?
10. **Decision 10** — Round-resumption: per-round atomic with partial-discard on resume (lean), or partial-resume?
11. **Decision 11** — Persona size: ~4-5k with full Topic-1 scaffolding + 2 worked examples (lean), or ~3.5k with 1 example?
12. **Decision 12** — Template tokens: new `{{PRIOR_ROUNDS_FINDINGS}}` token (lean), or fold into existing slot?
13. **Decision 13** — e2e fixture: extend with T-003 + 4-key FakeProvider (lean), or split fixtures?

---

## What I want from you

- Numbered verdict on each of the thirteen decisions: `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications` per the DEBATE.md verdict enum. For each `accept-with-modifications` or `reject`, the specific alternative — concrete enough that I can land it in a commit without further round-trips.
- Risks I'm not seeing. M9 is the first milestone where the gate is *cross-family*. Particular surfaces:
  - **"Fake green gate" via cross-family laundering.** What if the configured REVIEW persona has provider=`codex` (passes the family check) but routes its actual provider call to Claude via a misconfigured CLI OAuth? The runtime cross-family check trusts the registry's `familyOf()` lookup; can that lookup be tricked by config?
  - **"Authority overlap" between REVIEW round and BUILD/VERIFY restart.** A REVIEW round triggers BUILD attempt N+1; if VERIFY fails attempt N+1, M8's restart-policy fires (consuming attempts up to the 4-cap). What's the right user-facing intervention message — REVIEW round failure or BUILD-attempt-cap exhaustion? The M8 restart-policy emits its own intervention; does M9 need to suppress or chain?
  - **"Findings drift" across rounds.** Round 1 raises `F-001` (severity: fix-first). Round 2's BUILD attempt addresses `F-001` but introduces `F-005` (severity: fix-first). Round 2 verdict: needs-revision (because `F-005` exists). Round 3's BUILD attempt addresses `F-005` but reintroduces `F-001`. Cap exhaustion at round 4 — but the system addressed both findings at different points. Is the `Round resolved` tracking sufficient? Should the orchestrator detect the "ping-pong" pattern?
  - **"Persona prompt drift" via repair rounds.** Each persona repair adds context (failed draft + grammar error). Across 4 rounds × 2 drafts = up to 8 persona invocations per task. Token budget under `budgets.global` covers this transitively, but is the *per-round* prompt growing in a way that leaks reasoning state across rounds?
  - **"Topic-1 false-coverage drift."** The synthesis pinned the security-axis caveat. But the persona prompt is large; the caveat could be ignored in practice. Is there a runtime check (e.g., reviewing's findings cite the `security` axis disproportionately as a heuristic) that could catch drift, or is this a prompt-only discipline?
- Decisions you would defer. If any of the thirteen should be punted to M10 or a follow-up commit, name them. Particular candidates: decision 8 (REVIEW-driven carry-forward) is the most M8-substrate-coupled; if the carry-forward propagation needs more substrate work than M9 can fit, it could land as a M9-followup commit before tag.
- A recommended commit-order critique. The 10-commit path above mirrors M5/M6/M7/M8 cadence (schemas → events → artifacts → prompt template + composer → persona → loop algorithm → phase orchestrator → Scientist tail → e2e fixtures → spine e2e); if you see a better ordering (e.g., persona prompt before artifact parser, loop and phase fused into one commit), say so.

This is the M9 *implementation* briefing. The M7-M10 shape thesis debate is closed; the synthesis-round Topic-1 sub-decisions are closed; the rule-21 forward-look is closed. Stay inside the thirteen decisions.

---

## Reference

- **Pinned contracts:** [`REVIEW.md`](../contracts/REVIEW.md), [`BUILD.md`](../contracts/BUILD.md), [`VERIFY.md`](../contracts/VERIFY.md), [`WORKTREE.md`](../contracts/WORKTREE.md), [`SCIENTIST.md`](../contracts/SCIENTIST.md), [`PLAN.md`](../contracts/PLAN.md), [`DEBATE.md`](../contracts/DEBATE.md)
- **Roadmap:** [`docs/design/ROADMAP.md § M9`](../design/ROADMAP.md)
- **Synthesis:** [`docs/research/SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md`](./SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md) (commit `b869f3b`, 2026-04-30 — Topic-1 sub-decisions 1-4 plumbed)
- **Prior debates:** [`CODEX_RESPONSE_M7_M10_SHAPE.md`](./CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30 — risks #1 sandbox, #2 fake green gate, #5 Scientist gate noise), [`CODEX_RESPONSE_PRODUCT_THESIS.md`](./CODEX_RESPONSE_PRODUCT_THESIS.md) (thread `019de031`, 2026-04-30 — rule 21), [`CODEX_RESPONSE_AGENT_SKILLS_BORROW.md`](./CODEX_RESPONSE_AGENT_SKILLS_BORROW.md) (thread `019de02f`, 2026-04-30 — Topic-1 source)
- **Empirical history:** `docs/design/CODEX_BRIEFING_M{2..8}.md` + matching responses + reviews; M8 final at thread `019ddf5f` closed `push` after 5 fix-first commits
- **Non-negotiable rules:** `CLAUDE.md` rules 1-21, especially 2 (cross-family review at REVIEW gate — **M9's load-bearing rule**), 6 (4-round loop cap with score+verdict exit), 7 (this debate satisfies it), 11 (intervention codes), 19 (`budgets.global` covers REVIEW per-round calls), 20 (M9's authority boundary is **cross-family REVIEW authority**), 21 (forward-looking baseline; M9's single-reviewer is what panel-quorum-vs-baseline measurements compare against in M14)
