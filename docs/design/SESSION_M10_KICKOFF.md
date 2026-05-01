# Session M10 kickoff — Debate runtime + `requestDebate()` primitive

**Branch:** `feat/m10-debate` (off `main` at commit `43c53de`).
**Tag target:** `v0.10.0-alpha.0`.
**Authority boundary (CLAUDE.md rule 20):** Debate runtime authority — exactly one new boundary.
**Status:** Synthesis after Codex planning-convergence debate (`019de3ca`, accept-with-modifications). Locked decisions table + commit sequence below.

## Synthesis at a glance

Codex returned 12 accept-with-modifications + a top-level `accept-with-modifications` on the recommended commit sequence with five **lock-before-code** decisions: D11 (budget arithmetic), D1 (debate request is terminal), D6/D9 (`.code-ozignore` + non-interactive preview), D4 (synthetic opponent read-scope + externalized prompt), D3 (concurrency event correlation OR strictly serial). Two of those five (D11 + D1) are real bugs in my pre-Codex lean; the other three tighten language and surface area.

The substrate sequence shifts: Codex's two adjustments — (a) move M9 cleanup commit **after** M10 substrate goes green, (b) add an early correlation/budget substrate commit before `requestDebate` — are folded in. Commit count: 13 (M9 was 24; M10 has narrower runtime scope).

`★ Insight ─────────────────────────────────────`
- The cross-family debate caught two design holes my single-model lean missed: D11's "+0 synthesis" budget math (would have undercounted real provider spend by 50-67%) and D1's "phase resumes from after the original block" (would have used pre-debate persona output to drive post-debate phase decisions — exactly the "archived theater" failure mode DEBATE.md was designed to prevent).
- D4's read-scope correction (`'*'` → exact-manifest-only) is the same defense-in-depth pattern as M5's `manifest.ts`. When in doubt, narrower upper bounds. Codex caught this because the M5 pattern is consistent across the codebase and `'*'` reads as a regression.
- The "no new warning events" feedback (D2, D5) is Codex enforcing CLAUDE.md rule 1 + DEBATE.md's two-event surface. Adding `debate_multiple_requests_dropped` and `debate_decision_rubberstamp_warning` would have been contract drift — the M9 lesson "stale 'M9 commit X' citations rot the codebase" generalized.
`─────────────────────────────────────────────────`

## Locked decisions (final, after synthesis)

These freeze before commit 1. Any code that lands inconsistent with this table is wrong.

### D1 — Debate request is terminal (LOCKED)

The persona's `<debate-request>` block is a **terminal directive** for that provider turn. The PLAN orchestrator extracts the first occurrence and **discards all trailing original-response text** (optionally persisted under `.code-oz/runs/<runId>/discarded-drafts/<topic>/pre-debate.md` for forensics). Multiple `<debate-request>` blocks → fail fast (not warn-and-drop) with `debate_multiple_requests_in_turn` parse failure (existing intervention plumbing — NO new event type). After DECISION.md is written, PLAN continues via a **fresh continuation invocation** with DECISION.md path + sha + the original BRIEFING context as inputs. The pre-debate prose is never used to drive post-debate phase decisions.

Why: Codex's risk #1 (stale phase output). Pre-debate prose was authored without access to the opposing party's RESPONSE; reusing it after DECISION would defeat the debate. Per CLAUDE.md rule 7's "the prompts you are prompting Codex with" framing, the *post-decision* turn is a different prompt and a different turn.

### D11 — Three provider calls per debate (LOCKED)

A debate produces **three** `agent_invoked`/`agent_completed` pairs under the calling phase's existing budget accounting:
1. **Opponent turn** — the opposing-provider call. +1 to `maxProviderCalls`; tokens-estimate contributes via existing `manifest.ts`/`cost.ts`.
2. **Synthesis turn** — the calling persona's DECISION-authoring turn. +1 to `maxProviderCalls`; tokens contribute.
3. **Continuation turn** — the calling persona's post-decision phase-continuation invocation. +1 to `maxProviderCalls`; tokens contribute.

The pre-debate phase turn (the one that emitted the `<debate-request>` block) was already counted under the phase's normal accounting; that's the same `agent_invoked` the wrapper would emit for any phase turn. So a single debate inside a phase turn = +3 provider calls beyond the phase's pre-debate baseline. There is **no "+0 synthesis"** carve-out. Both opposing and synthesis flow through `invokeAgent`; both produce `agent_invoked` events; both increment `globalProviderCalls`.

Update `docs/contracts/DEBATE.md § Budget accounting`:
- Old: "+1 per opposing-party turn (1 for asymmetric, 2 for symmetric)"
- New: "+1 per provider invocation inside the debate (3 for asymmetric: opponent + synthesis + continuation; symmetric is deferred); no new `phase_entered`."

`maxConcurrent` runtime enforcement: orchestrator scans `events.jsonl` for the calling phase's open debates (`debate_started` without matching `debate_resolved`). At limit → fail fast with `debate_concurrent_limit_exceeded` (existing intervention plumbing). M10 default `maxConcurrent: 1`.

### D4 — Synthetic opponent: externalized prompt + exact-manifest read scope (LOCKED)

The opposing party runs as an internal synthetic `AgentDefinition` constructed at runtime in `src/tools/debate-request.ts`. Modifications:
- **Externalized prompt body:** `src/prompts/debate-opponent-system.md` (universal-rules composed in via `composeDebateOpponentPrompt` in `src/prompts/index.ts`); snapshot-tested. NOT hardcoded TypeScript strings.
- **Read scope:** `permissions.read = exact list of paths in the BRIEFING manifest (after ignore-policy filter)`. NEVER `'*'`. The `buildManifest` upper-bound check then redundantly enforces.
- **Other permissions:** `write: 'deny'`, `bash: 'deny'`, no `tool_use.repo_context`, no `tool_use.write`, no `tool_use.execute`, no `tool_use.review_request`, no `tool_use.debate`. The opponent is single-shot read-only; no agentic surface.
- **Provider:** `req.opposingProvider`. **Phase:** `req.phase` (mirrors caller; debate is not a sub-phase).
- **modelPolicy:** `'opus-default'` (matches the rest of the runtime's default; specific model can be overridden via `req.opposingModel` if added later).

### D6 — `.code-ozignore` debate-only with fail-closed parser (LOCKED)

M10 ships `.code-ozignore` enforcement scoped to the debate path only. Module:
- **`src/tools/ignore-policy.ts`** — gitignore-subset parser. Supported: literal patterns (relative to project root), trailing-slash directories, leading `**/` recursive prefix, leading `*` wildcard within a single segment.
- **Fail-closed unsupported syntax:** negation (`!pattern`), escaped spaces (`pattern\ name`), rooted patterns (`/pattern`), bracket character classes (`[abc]`), trailing `**` patterns. Each unsupported pattern → `ignore_policy_unsupported_syntax` parse error with the offending line + line number. M10 does NOT silently treat them as literals.
- **Empty `.code-ozignore` or absent file:** the policy is "no ignore rules"; the check is a no-op (not an error).
- **Documented subset:** `docs/contracts/DEBATE.md` adds a new § "Ignore-policy subset (M10)" listing supported and unsupported syntax verbatim.
- **Consumer in M10:** only `src/tools/debate-permissions.ts`. Other phases (BUILD/VERIFY/REVIEW/PLAN-non-debate) ignore `.code-ozignore` until W4 hardening. The module is self-contained so the W4 expansion is mechanical.

### D9 — Manifest preview is non-interactive audit; tighten DEBATE.md language (LOCKED)

The manifest preview is a forensic audit artifact written to `.code-oz/artifacts/debates/<phase>-<topic>/MANIFEST.preview.md` **before BRIEFING.md is sent and before any provider call**. If the policy filter (D6) blocks any file → `debate_manifest_blocked` intervention before BRIEFING.md is written. There is no interactive gate. Operator review is post-hoc via `events.jsonl` and `code-oz doctor --bundle`.

Add `manifestPreviewSha256` to `debate_started` event payload.

Update `docs/contracts/DEBATE.md § Permission sub-scope` from:
- Old: "the runtime presents the manifest to the user before BRIEFING.md is sent"
- New: "the runtime writes a pre-send manifest preview artifact, hashes it, blocks on policy violations, and emits `debate_manifest_blocked` intervention if the ignore-policy filter rejects any file. Interactive approval is deferred to W2."

### D3 — Strictly serial in v0.1; correlation metadata is forward-compat (LOCKED)

`tool_use.debate.maxConcurrent` is bounded `≤ 4` in the schema (DEBATE.md unchanged), but bundled `lead.md` declares `maxConcurrent: 1`. Runtime enforcement uses event-log scan over the calling phase. Concurrency >1 in v0.1 fails the runtime concurrent-limit check; even if a custom persona declares `maxConcurrent: 2`, the runtime per-phase event-log scan blocks the second open debate with `debate_concurrent_limit_exceeded`.

For forward-compat (M14+ panel territory), add **optional** `debateTopic` + `debateTurn` fields to `agent_invoked` and `agent_completed` schemas (both optional, present only when the call is inside a debate). M10 emits them; consumers ignore them. This way M14 can lift the serial cap without an event-log migration.

### D2 — `<debate-request>` block is YAML-in-fenced-block; multiple blocks fail fast

Tagged YAML grammar:
```
<debate-request>
topic: <slug>
opposing_provider: <provider-id>
question: |
  <multi-line question text>
files:
  - path: <relative path>
  - path: <relative path>
</debate-request>
```

Rules:
- `topic`, `opposing_provider`, `question`, `files` all required keys. Missing key → `debate_briefing_missing_key` parse failure.
- `files: []` is valid (purely-design debate, no codebase context).
- Multiple `<debate-request>` blocks in one phase turn → `debate_multiple_requests_in_turn` parse failure (NOT warn-and-drop). Repair prompt names the duplicate-block error and asks for exactly one terminal block.

### D5 — DECISION authority + exact-copy rationale heuristic (final shape)

Calling persona authors DECISION.md; orchestrator validates:
1. All 5 H2 sections present (`Verdict`, `Rationale`, `What changes (artifact deltas)`, `What does not change`, `Open follow-ups`).
2. Verdict is in the planning-debate enum.
3. Rationale section non-empty (≥ 50 characters of non-whitespace content after stripping headers).
4. **Rationale is not exact-copy of opposing RESPONSE's rationale paragraphs** (case-insensitive substring match against the opposing RESPONSE's `## Where I disagree` and `## Recommended next step` text, with shorter-than-200-char rationales given a pass since they're inherently brief and may legitimately echo phrasings).

(4) failure → `debate_decision_no_rationale` intervention (existing error code from DEBATE.md § Common errors). NO new `debate_decision_rubberstamp_warning` event. Same enum verdict as opposing party is **not** suspicious — that's expected when both parties agree on substance.

DECISION.md frontmatter MUST include:
```
opposing_verdict: <enum>
caller_verdict: <enum>
```
Both verdicts captured for audit regardless of agreement.

### D7 — Topic uniqueness checked against artifact dir AND events.jsonl

Per-run `<phase>-<topic>` uniqueness checked at requestDebate entry by:
1. `events.jsonl` scan for prior `debate_started.topic`.
2. Filesystem scan of `.code-oz/artifacts/debates/` for an existing directory.
Either match → `debate_topic_collision` parse failure with bounded one-shot repair (the persona retries with a more specific topic).

Cross-run uniqueness: explicitly NOT enforced (the same topic in different runs is fine).

### D8 — Per-debate sha-bound resume with response validation

`probeDebateResume(runDir, runId)` → `{ status: 'no_resume' | 'no_response' | 'no_decision' | 'briefing_sha_mismatch' | 'response_invalid' | 'response_provider_mismatch', topic, briefingPath?, responsePath? }`.

- BRIEFING + RESPONSE + DECISION present → `no_resume` (already complete; just emit `debate_resolved` if missing from events).
- BRIEFING + RESPONSE present + DECISION absent → parse + validate RESPONSE shape (5 H2 sections, verdict-in-enum, `Overall verdict:` first line). On valid → re-invoke synthesis turn. On invalid → `response_invalid` intervention.
- BRIEFING present + RESPONSE absent → re-invoke opposing party.
- BRIEFING sha mismatch with `debate_started.briefingSha256` → `briefing_sha_mismatch` intervention (operator edited mid-flight).
- RESPONSE filename suffix doesn't match `debate_started.opposingProvider` family (e.g., `RESPONSE.codex.md` for a debate started against `claude`) → `response_provider_mismatch` intervention.

Atomic-write only: tmpfile-rename for all four artifacts; no partial-write resume state.

### D10 — RESPONSE.md `Overall verdict:` first-line locked grammar

The opposing party's RESPONSE.md must structure `## Verdict on the decisions` such that **the first non-empty line under that H2** is exactly:

```
Overall verdict: <accept | accept-with-modifications | reject | feature-with-modifications>
```

Per-decision verdicts may follow on subsequent lines. Parser validates the first non-empty line; verdict outside enum → `debate_response_verdict_invalid`. The `debate-opponent-system.md` prompt instructs the opponent to emit this line as the first content under the H2.

Update `docs/contracts/DEBATE.md § RESPONSE.{codex,claude}.md required H2 sections` accordingly.

### D12 — PLAN-only bundled defaults; primitive phase-agnostic

`src/agents/defaults/lead.md` (PLAN persona) gets `tool_use.debate` with `opposingProviders: ['codex']`, `maxConcurrent: 1`, `previewBeforeSend: true`, `maxFiles: 20`, `timeoutMs: 600_000`.

`src/agents/defaults/{ba,builder,verifier,reviewer,scientist}.md` get NO `tool_use.debate`.

The runtime primitive (`src/tools/debate-request.ts`, `src/artifacts/debate.ts`, `src/state/schemas.ts` event types, `src/agents/schema.ts` schema validation) stays phase-agnostic. Tests must include:
- Negative-permission tests: Builder/Reviewer personas cannot invoke `requestDebate`; the schema-level + runtime-level rejection both fire.
- A custom non-PLAN persona test fixture that declares `tool_use.debate` and successfully reaches the generic permission path. This proves the primitive isn't accidentally PLAN-coupled.

---

## Commit sequence (final, 13 commits + summary)

| # | Subject | Files | Test delta |
|---|---|---|---|
| 0 | docs(design): synthesis (kickoff + Codex briefing/response, thread `019de3ca`) | `docs/research/CODEX_BRIEFING_M10.md`, `docs/research/CODEX_RESPONSE_M10.md`, `docs/design/SESSION_M10_KICKOFF.md` | 0 |
| 1 | feat(agents): tool_use.debate schema + load validation | `src/agents/schema.ts`, `tests/agent-load-tool-use-debate.test.ts` | +12 |
| 2 | feat(state): debate event types + correlation metadata + validators | `src/state/schemas.ts`, `src/state/events.ts`, `tests/state-events-debate.test.ts` (incl. forward-compat correlation fields on agent_invoked/agent_completed) | +18 |
| 3 | feat(tools): ignore-policy module with fail-closed unsupported syntax | `src/tools/ignore-policy.ts`, `tests/ignore-policy-{supported,fail-closed,empty,no-file}.test.ts` | +20 |
| 4 | feat(artifacts): debate parser + serializer + canonicalizer | `src/artifacts/debate.ts`, `tests/debate-artifact-{parse-briefing,parse-response,parse-decision,serialize,grammar,verdict-enum,decision-rationale-non-empty,topic-slug,response-overall-verdict-first-line}.test.ts` | +35 |
| 5 | feat(tools): debate-permissions manifest preview | `src/tools/debate-permissions.ts`, `tests/debate-permissions-{preview-content,policy-blocked,empty-ignore,timing-before-load,manifest-preview-sha-event}.test.ts` | +18 |
| 6 | feat(prompts): debate opponent + synthesis prompts + composers | `src/prompts/debate-opponent-system.md`, `src/prompts/debate-synthesis-system.md`, `src/prompts/index.ts` (composeDebateOpponentPrompt + composeDebateSynthesisPrompt + composeDebateContinuationPrompt), `tests/prompts-debate-{compose-opponent,compose-synthesis,compose-continuation,opponent-snapshot,synthesis-snapshot,universal-rules-injected}.test.ts` | +18 |
| 7 | feat(tools): requestDebate primitive | `src/tools/debate-request.ts`, `tests/debate-request-{cross-family,opposing-call,synthesis-turn,continuation-turn,three-call-budget,decision-validation-shape,exact-copy-rationale-blocks,collision-events,collision-dir,resume-no-response,resume-no-decision,resume-briefing-sha-mismatch,resume-response-invalid,resume-response-provider-mismatch,concurrent-limit,scoped-read,terminal-directive}.test.ts` | +50 |
| 8 | feat(agents): lead persona gets tool_use.debate; PLAN orchestrator parses block | `src/agents/defaults/lead.md`, `src/phases/plan.ts` (block extraction with terminal-directive semantics + post-decision continuation invocation), `tests/lead-debate-{permission,extraction,terminal-directive,trailing-text-discarded,post-decision-continuation,negative-permission-builder,negative-permission-reviewer,custom-non-plan-persona}.test.ts` | +32 |
| 9 | feat(e2e): PLAN debate end-to-end | `tests/e2e/debate-from-plan.test.ts`, FakeProvider keying extension `(phase, agent, debateTopic, debateTurn, ...)` | +8 |
| 10 | docs(contracts): DEBATE.md upgrade from process to runtime | `docs/contracts/DEBATE.md` (rewrite §§ Budget accounting + Permission sub-scope + Manifest preview + add § Ignore-policy subset (M10) + § RESPONSE Overall-verdict-line) | 0 |
| 11 | chore(m9-cleanup): close deferred M9 audit nits | M1, M2 (duplicate parsing helpers — DRY at 3x evaluated), M4 (stale "M9 commit X" comments) | 0 |
| 12 | v0.10.0-alpha.0 milestone summary | `CLAUDE.md` status line, `package.json` version, `docs/design/ROADMAP.md` status note | 0 |

Total net new tests: ~211 (M9 added ~250). After M10: ~1789 tests.

Test discipline: `bun test` + `bun run typecheck` after every commit. Never land a red commit. No co-authored-by footers, no emojis.

## Authority-boundary check (CLAUDE.md rule 20)

Every commit lands within "Debate runtime authority":
- No new phases. (No `phase: 'debate'` enum value.)
- No new gate types. (Debate is invoked from inside a phase; the phase's gate continues to be the only gate signal.)
- No new provider primitives beyond `requestDebate`. (Adapters unchanged.)
- No new budget namespaces. (`budgets.global` enforces; no `budgets.debate`.)
- No new persona files. (`lead.md` is **extended**, not replaced; `debate-opponent-system.md` is a prompt template, not a persona.)

## Risk register (carry-forward to mid-implementation)

From Codex's response, with my acknowledgments:

| Risk | Source | Mitigation in commit sequence |
|---|---|---|
| Stale phase output after debate | Codex risk #1 | Commit 8: terminal-directive extraction in `plan.ts`; trailing text persisted to `discarded-drafts/` for forensics |
| Budget undercounting | Codex risk #2 | Commit 7: three-call budget test; reuses existing `assertWithinBudget` |
| Concurrency event correlation | Codex risk #3 | Commit 2: optional `debateTopic`+`debateTurn` on agent_invoked/completed; commit 7: `maxConcurrent: 1` runtime enforcement |
| Warning event drift | Codex risk #4 | Commits 2, 7: only 2 events (`debate_started`, `debate_resolved`) + reuse existing intervention plumbing |
| Ignore-policy leak by omission | Codex risk #5 | Commit 3: fail-closed parser; tests for negation/escaped/bracket/rooted patterns |
| Synthetic opponent read scope | Codex risk #6 | Commit 7: read=manifest paths only; commit 7 test `scoped-read` |
| Manifest preview timing | Codex risk #7 | Commit 5: preview written before any provider call; test `timing-before-load` |
| RESPONSE verdict parsing | Codex risk #8 | Commit 4: `Overall verdict:` first-line grammar; commit 6: opponent prompt instructs |
| Resume reanimating corrupted artifacts | Codex risk #9 | Commit 7: parse+validate RESPONSE on resume; intervention on invalid |
| PLAN-only runtime coupling | Codex risk #10 | Commit 8: negative-permission tests + custom non-PLAN persona test |

## Pre-implementation checklist

Before commit 1:
- [x] `feat/m10-debate` branch off `main` at `43c53de`
- [x] CODEX_BRIEFING_M10.md written (commit 0)
- [x] CODEX_RESPONSE_M10.md captured with thread id (commit 0)
- [x] SESSION_M10_KICKOFF.md (this file) synthesizes the locked-decisions table (commit 0)
- [ ] Commit 0 lands: `docs(design): M10 commit 0 — synthesis (kickoff + Codex briefing/response, thread 019de3ca)`

Then proceed commit-by-commit per the sequence above.

---

End of session kickoff.
