# code-oz — M5 Codex briefing

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M4 shipped (`v0.4.0-alpha.0`, 391 tests passing offline, ~1.2s, the IAgentProvider contract + ProviderRegistry + four adapters + wrapper layer with budget enforcement + `requestReview` cross-family primitive + `code-oz doctor providers`). M5 is the next milestone: the **DEFINE phase implementation**, the **SPEC.md artifact contract**, the **ask-me intent-elicitation flow**, and the **Common Rationalizations table** as a bundled prompt asset.

The scope is locked by `docs/design/SESSION_M5_KICKOFF.md`. You are not debating *what* to build — you are debating *how* to build it. I have leans on **thirteen decisions**: nine from the kickoff's pre-drafted prompts, plus four I'm adding here that the kickoff names but does not lock (event taxonomy for ask-me turns, conversation-history transport, initial-request input source, confidence-threshold + repair-turn config shape).

Push back hard where my leans are wrong. Confirm fast where they hold up. Where you confirm, sanity-check rather than rubber-stamp. Mirror the verdict format from `CODEX_RESPONSE_M4.md` — "Where I agree", "Where I disagree (with specific alternative)", "Decisions you must lock before code".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1–14 plus cross-model peer review rules 7–10. Rules 1 (file-based gates), 4 (Opus default), 8 (FakeProvider runs full lifecycle offline), 13 (privacy by default, explicit file manifests, `.code-ozignore`), and the durable rule 7 (Codex debate at planning convergence — that's this session) are the tightest constraints on M5.
- **`docs/design/ROADMAP.md` § M5** — files to create + acceptance criteria. M5 ships DEFINE-only; PLAN (M6), BUILD/VERIFY/REVIEW-lite (M7), worktrees + patches (M7), AUDIT (W4) are explicit non-goals.
- **`docs/design/SESSION_M5_KICKOFF.md`** — full M5 task description, the deep-dive table on what `agent-skills` and `Auto-claude-code-research-in-sleep` contribute, the nine pre-drafted prompts I am extending here, and the cross-cutting addendum from M4 at the end. **Addendum wins on conflict** with anything I propose below.
- **`docs/references/agent-skill-format.md`** — the M2 frontmatter spec. The "Permissions semantics: upper bound, not glob expansion" section is load-bearing for M5: every file the BA persona receives must be allowed by `permissions.read` at the wrapper layer (which the wrapper already enforces — M5 phase logic just constructs `ProviderFileRef[]`).
- **`docs/references/file-based-gates.md`** — § 4 (canonical phase → artifact map: `define → SPEC.md`), § 5 (events.jsonl), § 9 (cross-file recovery — a mid-DEFINE crash with `SPEC.md` written but no `gate_written` event must recover deterministically when `code-oz approve define` runs).
- **`docs/references/provider-contract.md`** — IAgentProvider, request DTO split, `ProviderFamily`, error codes. M5 phase logic constructs `ProviderRequest` (paths-only) and calls `invokeAgent(ctx, req)`. Phase code never loads file content — the wrapper does, after permissions intersection.
- **`docs/design/CODEX_RESPONSE_M4.md`** and **`docs/design/CODEX_RESPONSE_M4_ADAPTERS.md`** — format references for what your reply should look like, plus the locked auth model M5 inherits.
- **`docs/design/CODEX_REVIEW_M4.md`** — the M4 implementation review (fix-first → push verdict). The discipline carries forward: M5 closes block-push and block-next-milestone severities before tag.

You do not need to read M2/M3/M4 source in depth. Glance at:

- **`src/agents/defaults/ba.md`** — the existing BA persona (M2-shipped stub). M5 expands its body with the full ask-me prompt, but the frontmatter (provider: claude, modelPolicy: opus-default, write permissions: `./docs/specs/**`, `./specs/**`, `SPEC.md`) is locked.
- **`src/providers/invoke.ts`** — the `invokeAgent` wrapper M5 phase logic plugs into. Streaming generator; phase code consumes via `for await (const ev of invokeAgent(ctx, req))`.
- **`src/state/run.ts`** — `initRun`, `loadRun`, `approveGate`. M5's `code-oz run` calls `initRun` on first turn and then drives the ask-me loop.
- **`src/state/schemas.ts`** — `EVENT_TYPES`, `PhaseEvent`, `LoggedEvent`. Validation rule 12 (open-type-union) means new event types can land without bumping `version: 1`. M5 needs to decide whether to use that headroom (prompt 10 below).
- **`src/state/events.ts`** — `validateEvent`. Already accepts unknown event types (open-type-union); M5 may rely on this if we add ask-me-specific event types.
- **`src/commands/run.ts`** — currently exits 2 with a stub message. M5 wires it to actually do something.
- **`src/config/schema.ts`** — current budgets shape. M5 adds `define.askMe.{maxRounds, confidenceSignal, maxRepairTurns}` (or equivalent — prompt 13).

---

## What's locked (not up for debate)

These come from CLAUDE.md, the kickoff, the ADR, the pinned references, and the M4 cross-cutting addendum. Do not reopen.

1. **DEFINE writes `.code-oz/artifacts/SPEC.md`** — canonical phase → artifact mapping from gates spec § 4. The artifact is plain Markdown (rule 7 — never JSON for inter-phase handoffs). The orchestrator writes it; the persona never writes it directly (rule: phase logic owns artifact I/O).

2. **SPEC.md sections, in order:** Goals, Users, Constraints, Acceptance criteria, Open questions, **Explicit non-goals** (kickoff acceptance + ROADMAP § M5). All six required; non-goals MUST be non-empty (prompt 4 below). Section format is Markdown headings (`## Goals`, etc.) with bulleted bodies.

3. **Approval gate is out-of-process via `code-oz approve define`** — kickoff prompt 7 lean, also matches M3's existing approval contract. DEFINE writes SPEC.md, then exits 0 with a message instructing the user to review and run `code-oz approve define`. No in-process TTY approval prompt in v0.1.

4. **Wrapper invokeAgent is the only path to a provider** — rule from M4 cross-cutting addendum item 1. M5's ask-me loop calls `invokeAgent(ctx, req)` for every turn. Never bypass to call adapters directly.

5. **`ProviderRequest` is paths-only** — wrapper loads bytes after permissions intersection (provider-contract.md § "Request DTO split"). M5 phase logic constructs `ProviderFileRef[]` and the prompt string; never opens files.

6. **agent_invoked events ALWAYS carry `manifest`, `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`** — M4 addendum item 3. M5 phase logic populates `ProviderFileRef.droppedFields` only when intentionally narrowing a manifest entry.

7. **Conservative token estimator is the single shared estimator** (`src/providers/cost.ts`, ~4 chars/token upper bound) — M4 addendum item 4. M5 phase logic doesn't introduce a new estimator.

8. **FakeProvider runs the full lifecycle offline.** Every M5 spine test uses `FakeProvider` only. Live-provider tests are opt-in and gated behind env flags. (rule 8)

9. **No M6+ scope creep.** No PLAN parser, no SOURCE_CHECK.md, no 3-source verification, no worktrees, no patches, no REVIEW orchestration, no AUDIT phase, no `consult()` broad primitive. (kickoff "What's NOT in M5".)

10. **No tech debt at milestone close.** Per `feedback_no_tech_debt.md` and the kickoff "Don't" list: every Codex review finding except `nit`/`fyi` closes before tag. M3 closed 7 in-milestone, M4 closed 6 in-milestone — same bar.

11. **Bun + TypeScript + hand-rolled validation** (no zod). M5 mirrors M2/M3/M4 patterns: typed errors with `{ file, code, rule, detail? }` issue arrays; pure I/O modules; orchestration above I/O.

12. **Common Rationalizations table is bundled at `src/prompts/common-rationalizations.md`** and template-injected into phase persona system prompts via a `{{COMMON_RATIONALIZATIONS}}` token (kickoff prompt 8 lean is locked here — single source of truth, M6/M7 reuse). The table content itself is M5's first-pass authoring; debate the *shape*, not the entries.

13. **Build-time constants (CLI version, package.json version, DEFAULT_CONFIG.version) stay aligned** — M4 added a version-consistency test; M5 doesn't bump versions until tag time, but any new bundled assets land via Bun asset imports following the M2 pattern (`bundled/personas/define/ba.md` precedent).

---

## M5 acceptance summary (from kickoff + ROADMAP)

- DEFINE writes `.code-oz/artifacts/SPEC.md` with all six required sections.
- `code-oz run` (no args) initializes a fresh run, enters DEFINE, runs the ask-me loop with the BA persona via `invokeAgent`, writes SPEC.md when the persona signals confidence (or hits the round cap), and exits 0 instructing the user to `code-oz approve define`.
- `code-oz approve define` (M3-shipped) writes `GATE_DEFINE_PASSED.json` and advances the run to PLAN (which is still stubbed in v0.1; the gate just sits there until M6 lands the next phase).
- A deterministic transcript fixture (`tests/fixtures/transcripts/nontechnical-baby-game.md`) replays via `FakeProvider` and produces a snapshot-matched SPEC.md (structural snapshot per prompt 6 — section schema + non-empty-bullets, not full text).
- The Common Rationalizations table is injected into the BA persona's system prompt at run time and is visible in the persona's manifest (`droppedFields: []` since nothing is omitted in v0.1).
- All 391 pre-M5 tests still pass; M5 lands ~30–50 new tests (estimate: phase orchestration, SPEC.md serializer/parser, ask-me bounded loop, fixture replay, repair-turn validation, gate-write integration, config schema). Final count probably in the 420–445 range.
- `bun run typecheck` clean. `bun run build:binary` produces a binary that reports `0.5.0-alpha.0` (version bump at tag time, mirrors M3/M4).
- The compiled binary's tree-shaker keeps the new bundled assets (`define-system.md`, `common-rationalizations.md`); the `bootstrap()` keepalive pattern from M4 (`getProviderRegistry()`) extends to phase imports if needed.

---

## My proposed module shape (the thing to debate first)

```text
src/phases/
  define.ts                # phase orchestrator: ULID + initRun, ask-me loop, validate SPEC, write artifact, exit
  ask-me.ts                # bounded conversation runner (max-rounds + confidence-signal + repair-turn). Maybe private to define.ts in v0.1; extract if M6 needs it
src/artifacts/
  spec.ts                  # SPEC.md serializer + parser + section validator
  markdown-frontmatter.ts  # shared YAML-frontmatter + Markdown body shape (SPEC.md, AUDIT.md, PLAN.md will all share). Extract once, reuse later
src/prompts/
  define-system.md         # bundled asset; the BA persona's system prompt body (replaces the M2 stub); contains {{COMMON_RATIONALIZATIONS}} injection token
  common-rationalizations.md  # bundled asset; the cross-phase table, injected into every phase persona's system prompt
src/commands/
  run.ts                   # extended from stub to actually orchestrate DEFINE on a fresh run
docs/contracts/
  SPEC.md                  # user-facing artifact contract (mirrors PROVIDERS.md from M4 in shape)
docs/references/
  spec-contract.md         # NEW pinned spec — SPEC.md schema + Common Rationalizations integration + non-goals discipline. (Maybe deferred to commit 7 of M5; mirrors M4's provider-contract.md decision — see prompt 14 below)
tests/
  define-phase.test.ts                   # orchestrator integration: full run produces SPEC.md
  artifacts-spec.test.ts                 # serializer + parser + validator
  ask-me-loop.test.ts                    # bounded-loop unit tests: max-rounds, confidence, repair
  define-fixture.test.ts                 # replay nontechnical-baby-game fixture, snapshot SPEC.md sections
  fixtures/transcripts/
    nontechnical-baby-game.md            # at least one canned transcript
src/agents/defaults/ba.md                # body expanded with full ask-me persona prompt; frontmatter unchanged
src/cli/bootstrap.ts                     # if extracting `runInit({ profile, runId? })` helper makes sense — TBD in planning
```

Plus, almost certainly: a wired keepalive for the new bundled prompt assets so the compiled binary doesn't tree-shake them, mirroring `getProviderRegistry()` from M4.

Test count target: ~30–50 new tests, mostly in `define-phase.test.ts`, `artifacts-spec.test.ts`, `ask-me-loop.test.ts`, `define-fixture.test.ts`. Plus a handful of config-schema, run-command, and integration tests.

---

## Prompts to debate

Each follows the same shape as M4: **lean + reasoning + counter-argument I'm aware of**. Confirm the lean, push back with a specific alternative, or open new locks I missed.

---

### Prompt 1 — Ask-me loop shape: BA-persona-driven or orchestrator-driven?

**Lean: BA-persona-driven.** The persona's system prompt instructs it to ask one focused question per turn, then signal confidence when ready. The orchestrator (`define.ts`) just relays user input back to the persona, counts turns, and detects the "ready" signal in the persona's structured response.

**Reasoning:** The kickoff's deep-dive table commits M5 to *exercising* the ba persona, not redesigning it. Persona-driven keeps the elicitation strategy in the persona body, where future personas (different domains, different elicitation styles) can be swapped in without touching the orchestrator. Orchestrator just enforces the loop bounds and parses the structured output.

**Counter:** Orchestrator-driven (define.ts hardcodes the question sequence; the persona is just a stylist) is more deterministic and easier to test. But it forecloses future personas with different elicitation strategies and contradicts the agent-skills design philosophy of "process in the persona body, mechanics in the orchestrator."

---

### Prompt 2 — Confidence signal: structured token, structured JSON block, or natural-language detection?

**Lean: structured token (`<spec-ready/>` literal in the persona's output).** The persona's system prompt instructs it to emit `<spec-ready/>` on the line *before* the SPEC.md draft when it has enough information. Orchestrator greps for the literal substring on each turn; if found, treats the rest of the response as the draft.

**Reasoning:** Natural-language detection ("I have enough information now…") is fragile to phrasing drift. Structured JSON adds parsing surface and brittleness if the persona forgets braces. A literal HTML-style empty tag is unambiguous, easy to grep, easy for humans to read, and the persona is unlikely to emit it accidentally during the conversation.

**Counter:** A token requires persona discipline. If the persona forgets, the loop runs forever. The max-rounds cap protects against that, but it's a UX cliff — the user gets the partial-data SPEC after N rounds with no warning. Mitigation: when max-rounds triggers, the orchestrator runs one explicit "you've used all rounds — produce the best SPEC you can with what we have, prefixed with `<spec-ready/>`" turn before validating.

---

### Prompt 3 — SPEC.md generation: persona writes the draft or orchestrator templates from extracted facts?

**Lean: persona writes the draft, orchestrator validates.** The persona's last response (the one with `<spec-ready/>`) contains a complete SPEC.md draft inline. Orchestrator parses sections, checks each is non-empty + matches schema, writes to disk if valid. If validation fails, orchestrator runs **one repair turn** asking the persona to fix specific missing sections.

**Reasoning:** The persona's voice matters for non-technical users — orchestrator-templated SPECs read like form-filled bureaucracy. Persona-drafted with one bounded repair turn keeps voice and gives the orchestrator a clean exit if the persona can't satisfy schema after one retry.

**Counter:** Orchestrator templating is more reliable. If the persona consistently produces malformed sections, the loop wastes a turn before failing. But: SPEC.md is for humans, not machines; voice pays for itself.

---

### Prompt 4 — Non-goals discipline: optional or required section?

**Lean: required + non-empty.** The orchestrator's SPEC.md validator rejects drafts where the `## Explicit non-goals` section is empty or has zero bullets. The persona system prompt asks for at least one explicit non-goal.

**Reasoning:** Non-goals is the single most-underused-but-important section for scope discipline. M5 enforces it by validation; if the persona forgets, the repair turn re-asks with explicit instruction.

**Counter:** Forced non-goals can produce filler ("Not building a SaaS platform"). But filler is *visible filler* — easy to identify and discuss with the user — whereas absent non-goals are invisible and let scope creep happen unconsciously.

---

### Prompt 5 — Transcript fixture format: JSON or Markdown-with-frontmatter?

**Lean: Markdown-with-frontmatter.** Frontmatter declares scenario metadata (`{ persona: 'ba', userRole: 'non-technical-parent', expectedSpecPath: 'tests/fixtures/specs/nontechnical-baby-game.md', maxRounds: 8, confidenceThreshold: '<spec-ready/>' }`); body is alternating `## user` and `## ba` H2 blocks. FakeProvider's expectation queue is built from the fixture.

**Reasoning:** Mirrors the agent-skill format the project already commits to. Easy to author by hand; easy to read in PR diffs; the format scales naturally to PLAN/BUILD/REVIEW fixtures in M6/M7.

**Counter:** JSON is easier to parse and lint mechanically. But fixture authoring is the bottleneck (writing realistic non-technical-user replies), not parsing. The Markdown shape is friendlier to humans and the parser is ~30 lines.

---

### Prompt 6 — Snapshot testing: full SPEC.md text match or structural match?

**Lean: structural.** Parse the produced SPEC.md, assert:
- All six sections present in canonical order
- Each section non-empty (`length > 0` for the body text after the heading)
- `goals`, `users`, `constraints`, `acceptance`, `nonGoals` each have ≥ 1 bullet
- `openQuestions` may be empty if the persona signals "no open questions"
- The full SPEC.md text matches a regex shape: `^# .+\n\n## Goals\n.+\n\n## Users\n.+\n\n## Constraints\n.+\n\n## Acceptance criteria\n.+\n\n## Open questions\n.+\n\n## Explicit non-goals\n.+\n*$` (give or take whitespace tolerance)

**Reasoning:** Full text snapshot is too brittle to LLM output drift, even with `FakeProvider` canned responses (whitespace, list-marker variants). Structural assertions catch the regressions that matter (missing sections, empty bullets) without false-positiving on cosmetic drift.

**Counter:** Full text match would catch BA persona voice regressions in W2 polish. But voice changes are intentional in M5 → W2; brittleness slows iteration. If voice regression detection becomes valuable, add a separate W2-era test that compares against a canonical "voice-quality" sample.

---

### Prompt 7 — Approval flow: in-process prompt or out-of-process via `code-oz approve define`?

**Lean: out-of-process via existing M3 `approve` command.** DEFINE writes SPEC.md, exits 0, prints:

```
DEFINE phase complete. Review .code-oz/artifacts/SPEC.md, then run:
  code-oz approve define
```

The user reviews, runs the approve command, and the M3 gate writer advances the run to PLAN.

**Reasoning:** Keeps the M3 approval contract intact (file-based gate, schema-validated). In-process would require TTY detection + interactive prompt + a non-interactive opt-out for CI — three more code paths. Out-of-process is the simpler v0.1 contract and matches the kickoff lean.

**Counter:** In-process is faster UX for interactive users. But the user has to read SPEC.md anyway (it's the whole point); reading + running one approve command is less friction than reading + answering an interactive prompt.

---

### Prompt 8 — Common Rationalizations table: per-phase tables or one shared table?

**Lean: one shared table at `src/prompts/common-rationalizations.md`** injected into every phase persona's system prompt via `{{COMMON_RATIONALIZATIONS}}` template token. The orchestrator reads the bundled asset, replaces the token, and passes the composed prompt to `invokeAgent`.

**Reasoning:** One source of truth. M6/M7 reuse the same asset. The persona body adds phase-specific nuance after the shared table. Drift is avoided.

**Counter:** Per-phase tables (e.g., `define-rationalizations.md`, `plan-rationalizations.md`) could be tailored to phase-specific scope-creep modes. But: the audit-derived rationalizations (premature optimization, scope creep, "just one more feature", LLM-output trust without verification) are the same in every phase. Phase-specific nuance lives in the persona body, not the table.

**Concrete first-pass content for the table** (to debate the shape; entries themselves are M5 authoring):

| Rationalization | Reality |
|---|---|
| "We can leave that for later" | Open questions become irrecoverable scope creep three phases downstream. Capture them in `## Open questions` even if they're vague. |
| "The user will tell us if it's wrong" | Non-technical users don't know what they don't know. Surface assumptions explicitly so the user has something to disagree with. |
| "This is too small to need acceptance criteria" | Without acceptance criteria, REVIEW has nothing to verify against and falls back to LLM judgment. Always specify a verifiable check. |
| "Non-goals are obvious" | Implicit non-goals are how scope creeps. Always state at least one explicit non-goal. |
| "The persona's draft looks good enough" | Structural validation is mechanical; voice is human. Validate the structure, edit the voice. |

---

### Prompt 9 — Resume mid-DEFINE: replay or restart?

**Lean: restart.** v0.1 idempotent gate writes (M3) handle resume *after* DEFINE completes; mid-conversation resume is W2+ scope. DEFINE phase code documents the limitation and surfaces a clear message: "DEFINE phase requires a full conversation to complete. Run `code-oz run` again to start over." If `loadRun` finds an active run in DEFINE without `GATE_DEFINE_PASSED.json`, the resume command writes `STOP.json` (run terminated) and instructs the user to start fresh.

**Reasoning:** Replay requires storing the conversation in the event log (or a scratch transcript) AND reconstructing prompt context AND ensuring the FakeProvider/real provider produces the same continuation — three compounding sources of nondeterminism. Defer to W2.

**Counter:** Restart is bad UX if the user invested 5 turns and lost network mid-call. Mitigation: M5 logs every user input + persona response as `agent_invoked`/`agent_completed` pairs (already required by the schema), so a future W2 replay can rebuild from the event log without schema changes. Today, restart; the durable cost is just one config change (max-rounds reset) when W2 lands.

---

### Prompt 10 — New event types for ask-me turns? (NEW — not in kickoff prompts)

**Lean: NO new event types in v0.1.** Each turn of the ask-me loop is one `agent_invoked` + `agent_completed` pair (already in `EVENT_TYPES`). The user's input is part of `req.prompt` (constructed by the orchestrator from the running conversation history). The persona's reply is in `turn_completed.response.content`.

**Reasoning:** Validation rule 12 (open-type-union — `validateEvent` accepts unknown event types as long as version + ts + runId are valid) means we *could* add `define_user_input` / `define_persona_reply` events. But: introducing new event types tightens the contract for future readers (test fixtures, status command, replay). M5 doesn't need finer granularity than `agent_invoked`/`agent_completed` per turn; treating the prompt string as the carrier of conversation history is simpler.

**Counter:** Adding event types now would let the future W2 replay feature reconstruct conversation without re-parsing prompt strings. But: that reparsing is ~20 lines of code, and event-type proliferation has a tax (test fixtures, validators, reducers). Defer until W2 has a concrete requirement.

---

### Prompt 11 — Conversation history transport across turns (NEW — not in kickoff prompts)

**Lean: orchestrator concatenates conversation history into `req.prompt` each turn.** The orchestrator maintains an in-memory `Turn[]` array (`{ role: 'user' | 'ba'; text: string }`). Each turn:

1. Orchestrator reads next user input.
2. Appends `{ role: 'user', text: input }` to history.
3. Composes prompt as `<system-instructions>{{persona body}}\n\n{{COMMON_RATIONALIZATIONS}}</system-instructions>\n\n<conversation>{{turns rendered}}</conversation>\n\nRespond as the BA persona.`
4. Calls `invokeAgent(ctx, { agent: ba, prompt, files: [] })`.
5. Reads `turn_completed.response.content`, appends to history.
6. Loops until `<spec-ready/>` token or max-rounds hit.

**Reasoning:** Stateless adapter calls (M4 contract) mean the persona has no memory across calls. Either the orchestrator carries history in the prompt, or the orchestrator writes a scratch transcript file and includes it in `files`. The prompt route is simpler, mirrors how Claude/Codex CLI subscriptions work in their default modes, and avoids transient-file lifecycle questions.

**Counter:** Putting conversation history in the prompt grows prompt size linearly with turns. The wrapper's tokensEstimate metric will reflect this (good — observable). At max-rounds=8, total accumulation is bounded; the conservative estimator catches budget breaches before catastrophic spend. Alternative — write `transcript.md` to `state/runs/<id>/` and include in `files` — adds disk I/O per turn, complicates resume, and the wrapper would re-hash + re-load every turn.

---

### Prompt 12 — Initial user request input source (NEW — not in kickoff prompts)

**Lean: TTY prompt by default, with `--request-file <path>` and `--request <inline>` flags for non-interactive use.**

- `code-oz run` (no args, attached TTY): prints "Describe what you want to build:" and reads first line from stdin. That becomes turn 0 user input.
- `code-oz run --request "build me X"`: skips the TTY prompt; the inline string is turn 0 user input.
- `code-oz run --request-file path.md`: reads turn 0 user input from a Markdown file (fixture-friendly for non-interactive tests; CI use case).
- `code-oz run` (no args, non-TTY): exits non-zero with `actionableSuggestions: ['provide --request "..." or --request-file path']`.

**Reasoning:** Non-technical users get the friendly interactive prompt; scripts and tests get explicit non-interactive entry. Mirrors how `git commit` handles message: TTY editor by default, `-m` flag for inline, `-F` flag for file.

**Counter:** A TTY prompt is one more code path. But M5's ask-me loop already needs TTY-aware stdin reading for turns 1+ (the user's responses to the persona's questions). The turn-0 prompt is just a special case of that machinery. Three flags = simple, well-scoped.

**Sub-question to lock:** are turns 1+ also TTY-only by default, with `--transcript-file <path>` for fixture replay? My lean: yes, identical mechanism. FakeProvider tests don't need stdin (they replay scripted fixtures); real-provider use needs TTY.

---

### Prompt 13 — Confidence threshold + repair turn count config shape (NEW — not in kickoff prompts)

**Lean:** add the following to `.code-oz/config.yaml` schema:

```yaml
phases:
  define:
    askMe:
      maxRounds: 8                     # inclusive; round 9 triggers max-round-cap repair
      confidenceSignal: '<spec-ready/>' # literal token; orchestrator greps for it
      maxRepairTurns: 1                 # extra turns after a SPEC validation failure
      maxRoundsBehavior: 'best-effort'  # 'best-effort' | 'fail'; v0.1 default best-effort
```

`DEFAULT_CONFIG` in `src/config/schema.ts` provides defaults. M5 surfaces them via the standard config-loading mechanism M4 already wired.

**Reasoning:** Bounds are config because users may need to tune (a non-technical-user fixture might need 12 rounds; a power-user fixture might converge in 3). Confidence signal is config too because operators may want a different token if the default conflicts with persona output. Repair turn count = 1 in v0.1 is conservative; bumping it to 2 in W2 is a one-line config change.

**Counter:** Hardcoded in v0.1 is simpler. But: the kickoff explicitly references `.code-oz/config.yaml` for ask-me config (default 8); that's the contract.

**Sub-question to lock:** does `maxRoundsBehavior: 'best-effort'` (the default) cause the orchestrator to (a) inject one final "produce best SPEC with current data" turn, or (b) fail with `provider_budget_exceeded`-style NEEDS_INTERVENTION? My lean: (a) — the user gets a SPEC they can inspect, even if it's incomplete; user retains agency via the explicit gate-approval step. (b) feels like punishing the user for the persona's failure to converge.

---

### Prompt 14 — Pin the spec contract reference now or at commit 7? (META — process question)

**Lean: pin at commit 7 (after the SPEC.md serializer/parser/validator stabilize).** Mirrors M4's decision to write `provider-contract.md` *after* the wrapper landed (M4 commit 8). Writing the reference too early invites churn; writing it too late risks shipping a contract that's just code and tests.

**Reasoning:** The pinned spec describes the contract *as implemented and tested*. M4 found that pinning the contract after implementation surfaced 2-3 ambiguities that early-pinning would have missed. Same approach for M5.

**Counter:** Some teams want the spec written before code (test-first / spec-first discipline). For code-oz the discipline lives in the kickoff doc and the briefings/responses; a pinned reference is post-implementation distillation, not the design.

---

## Format ask for your reply

Mirror `CODEX_RESPONSE_M4.md`:

1. **"Where I agree"** — sanity-checked confirmations, numbered. Don't rubber-stamp; if the lean is correct, name *why* it's correct (which constraint or rule it satisfies).
2. **"Where I disagree"** — alternatives with concrete code/config snippets.
3. **"Decisions you must lock before code"** — anything you push back on plus anything I missed (your call). New locks are welcome; explicit citations to source M4/M3/M2 docs are appreciated.
4. **"Commit sequence I'd recommend"** — your suggested ordering. M4 was 10 commits; M3 was 9 base + 4 review-fix; M5 likely 7–10 base.
5. **"Open risks I'd flag"** — anything the briefing didn't surface.

Aim for ~5000–10000 words. M3 was 9.4K, M4 was 32K. M5 sits between — narrower scope (one phase + one artifact + the prompt assets) but novel UX surface (persona-driven ask-me loop, SPEC.md schema authoring).

Verdict format at the end:

- `proceed-as-proposed` (rare; only if every lean confirms)
- `proceed-with-modifications` (most common; numbered list of binding changes)
- `block-and-rebrief` (the proposal misses a constraint; new briefing needed)

Cite back to specific files/lines or rules where useful. Your verdict is data, not authority — but specific is better than gestural.

---

## Don't (cross-cutting)

- Don't redesign the M2 BA persona frontmatter. The body is M5's; the frontmatter is locked.
- Don't propose a new event taxonomy that bumps `version: 1`. The open-type-union (rule 12) is the extension path.
- Don't propose anything that bypasses `invokeAgent`. The wrapper is the only path.
- Don't propose adding a second persona for DEFINE in v0.1 (e.g., "user-modeler" + "spec-writer" as separate personas). One persona, one phase, in v0.1. Persona splits are W4+ scope.
- Don't propose loading SPEC.md from the persona's response by parsing fenced code blocks (` ```markdown ... ``` `). The full response after `<spec-ready/>` is the draft; orchestrator extracts everything between the token line and the next blank line + the rest of the message body.
- Don't propose a new gate file type. M3's GATE_DEFINE_PASSED.json + the existing intervention/PAUSE/STOP files cover M5.
- Don't reopen the cross-cutting addendum locks (items 1–5 in the kickoff).

---

## Estimated session shape

For your awareness (not a commitment):

- ~30 min reading + drafting (this briefing)
- ~5–10 min Codex planning round (you)
- ~20–30 min synthesizing into final M5 plan
- ~3.5–5 hr implementation across 7–10 atomic commits
- ~10 min Codex implementation review
- ~30–60 min addressing review findings
- ~5 min re-review (possibly two rounds)
- ~10 min merge + tag `v0.5.0-alpha.0` + release prep

---

End of briefing. Reply when ready.
