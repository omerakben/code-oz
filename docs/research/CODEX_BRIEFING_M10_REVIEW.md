# Codex briefing — M10 + PLAN-extraction implementation review (CLAUDE.md rule 8)

**Branch:** `main` (M10 work merged via `--no-ff`; matches v0.7/v0.8/v0.9 pattern)
**Range:** `origin/main..HEAD` = 14 commits
**HEAD:** `b086387` (M9 nits cleanup; latest)
**M10 milestone tag:** `v0.10.0-alpha.0` at `19c3e6e`
**Tests:** 1795 pass / 1 skip / 0 fail (~12s)
**Typecheck:** clean

This briefing requests Codex's implementation review of:
1. The full M10 Debate runtime surface (commits 0–10 + milestone summary).
2. The PLAN orchestrator `<debate-request>` block-extraction (commit `b836228`).
3. The M9 audit-nit cleanup (commit `b086387`).

Per CLAUDE.md rule 8: "Codex review at implementation completion fires before tag." The M10 milestone tag is already cut locally (no GitHub push yet). The expected verdict is `push` or `fix-first`. Per the no-tech-debt-at-milestone-close memory, all `block-push` + `block-next-milestone` + `fix-soon` findings get closed in follow-up commits on `main` (no `v0.10.0-alpha.1` tag) before pushing to `origin/main`.

The M10 planning-convergence debate (thread `019de3ca-9641-7f83-b479-f65ad390c179`, captured as `docs/research/CODEX_RESPONSE_M10.md`) returned `accept-with-modifications` with five lock-before-code decisions (D1, D6, D9, D11, D4). All five were absorbed into `SESSION_M10_KICKOFF.md` before any code landed. This implementation review checks how those locks held up.

## Commit set

```
b086387 chore(comments)             M9 audit nit cleanup — drop stale milestone-commit citations
b836228 feat(phases)                PLAN orchestrator <debate-request> block-extraction
3f2b61c Merge feat/m10-debate       M10 Debate runtime + requestDebate() primitive (v0.10.0-alpha.0)
19c3e6e v0.10.0-alpha.0             milestone summary
65d0687 docs(contracts)             M10 commit 10 - DEBATE.md upgrade from process to runtime
f75c672 feat(agents)                M10 commit 8 - lead persona gets tool_use.debate
369c947 feat(tools)                 M10 commit 7 - requestDebate primitive
e501046 feat(prompts)               M10 commit 6 - debate opponent + synthesis prompts + composers
d2e6dbc feat(tools)                 M10 commit 5 - debate-permissions manifest preview
4571547 feat(artifacts)             M10 commit 4 - debate parser + serializer + canonicalizer
77419ae feat(tools)                 M10 commit 3 - ignore-policy module with fail-closed unsupported syntax
fe2036b feat(state)                 M10 commit 2 - debate event types + correlation metadata + validators
7edb178 feat(agents)                M10 commit 1 - tool_use.debate schema + load validation
94e8179 docs(design)                M10 commit 0 - synthesis (kickoff + Codex briefing/response)
```

## Authority boundary closed (CLAUDE.md rule 20)

M10 introduces exactly one new authority boundary: **Debate runtime authority** — the `requestDebate()` primitive plus the `tool_use.debate` permission sub-scope plus the two new events (`debate_started`, `debate_resolved`) plus the artifact contract (BRIEFING.md / RESPONSE.{side}.md / DECISION.md / MANIFEST.preview.md). Per rule 20, no other new authority surface lands in this milestone.

PLAN extraction (commit `b836228`) is a wiring-only change: it teaches the PLAN orchestrator to extract `<debate-request>` blocks and invoke the existing M10 runtime. It does not introduce a new authority boundary.

## What the M10 planning debate locked (D1–D12)

All twelve decisions from `CODEX_RESPONSE_M10.md` and how they landed:

| # | Lock | Landed |
|---|---|---|
| D1 | Two-turn debate primitive: opposing turn + synthesis turn. **Debate request is terminal**: trailing pre-decision phase output is discarded; phase continuation is via a fresh invocation receiving DECISION path/sha. | M10 commit 7 + PLAN extraction `b836228` |
| D2 | Tagged YAML (`<debate-request>`), not provider-native tool calls. **Multiple blocks fail fast** (no drop-with-warning). `files: []` valid; missing `files` is parse failure. | PLAN extraction `b836228` (`extractDebateRequest`) |
| D3 | Async-iterable `requestDebate` mirroring `requestReview`. **Strictly serial** (`maxConcurrent: 1` for bundled personas) until durable correlation lands. Optional `debateTopic` + `debateTurn` metadata on `agent_invoked` / `agent_completed` for forward-compat. | M10 commits 2 + 7 |
| D4 | Synthetic opposing `AgentDefinition` with **externalized prompt + scoped read** (= exactly the manifest paths). NEVER `permissions.read='*'`. No write/execute/repo_context/review_request/debate. | M10 commits 6 + 7 (`buildOpposingAgent`) |
| D5 | Calling persona authors DECISION.md; orchestrator validates shape. Same enum as opposing RESPONSE is normal (no warn). **Only block: exact-or-near-exact copied rationale** with no independent rationale → `debate_decision_no_rationale`. Record both verdicts for audit. | M10 commit 4 |
| D6 | Debate-only `.code-ozignore` parser **fails closed** on unsupported gitignore syntax. Module at `src/tools/ignore-policy.ts`. Subset documented in DEBATE.md. | M10 commit 3 |
| D7 | Per-run `<phase>-<topic>` uniqueness via events.jsonl AND artifact-directory check (a crash before `debate_started` cannot leave a collision trap). Fail fast; no auto-suffix. | M10 commit 7 (lines 188–209) |
| D8 | Per-debate sha-bound resume. Response validation on resume path: `BRIEFING + RESPONSE present + DECISION absent` parses + validates RESPONSE before re-invoking synthesis. Atomic-write-only semantics. | M10 commit 7 |
| D9 | Manifest preview is **non-interactive audit** in M10 (DEBATE.md language tightened: "writes a pre-send manifest preview artifact and blocks on policy violations; interactive approval is deferred"). `manifestPreviewSha256` in `debate_started`. | M10 commits 5 + 10 |
| D10 | RESPONSE first-line `Overall verdict: <enum>` grammar; `parseResponse` raises `debate_response_verdict_invalid` on miss. | M10 commit 4 |
| D11 | **Every provider invocation inside debate counts under `budgets.global` and the caller phase.** Opposing + synthesis + any post-decision continuation all flow through `invokeAgent` and increment `maxProviderCalls`. **No "+0" carve-out for synthesis.** | M10 commit 7 |
| D12 | Bundled defaults are **PLAN-only** in M10 (`tool_use.debate` granted only on `lead.md`). Primitive stays phase-agnostic. Negative-permission test for Builder/Reviewer defaults; positive test that a custom non-PLAN persona with valid `tool_use.debate` reaches the generic permission path. | M10 commit 8 |

## Files for review

In rough order of authority-density / load-bearing-ness:

### M10 runtime (the new authority)

- **`src/tools/debate-request.ts`** (498 lines, new) — the `requestDebate()` primitive. Async-iterable runner; D11 budget arithmetic via existing `invokeAgent`; D7 dual-uniqueness check (events + artifact dir); D9 manifest preview written before any provider call; D4 synthetic agent with scoped read (`buildOpposingAgent`); two-turn flow; `setResult` / `result()` post-completion API.
- **`src/artifacts/debate.ts`** (~700 lines, new) — parser + serializer + canonicalizer for BRIEFING / RESPONSE / DECISION. D5 dual-verdict frontmatter on DECISION (`caller_verdict` + `opposing_verdict`); D10 `Overall verdict: <enum>` first-line grammar; exact-copy heuristic (>200-char rationale that substring-matches opposing corpus → `debate_decision_no_rationale`); 50-char rationale minimum.
- **`src/tools/debate-permissions.ts`** (new) — `buildDebateManifestPreview` writing `MANIFEST.preview.md` non-interactive audit. Sha256 bound to `debate_started.manifestPreviewSha256`.
- **`src/tools/ignore-policy.ts`** (new) — D6 fail-closed `.code-ozignore` subset parser. Module boundary established for W4 expansion; debate is the only consumer in M10.
- **`src/agents/schema.ts`** (changed) — `tool_use.debate` sub-scope. Load-time `validateDebate` enforces cross-family invariant against `PROVIDER_FAMILIES`. `previewBeforeSend: true` literal-only.
- **`src/state/schemas.ts`** + **`src/state/events.ts`** (changed) — `debate_started` + `debate_resolved` event types + validators. Forward-compat correlation fields `debateTopic` + `debateTurn` on `agent_invoked` / `agent_completed`.
- **`src/prompts/debate-opponent-system.md`** (new) + **`src/prompts/debate-synthesis-system.md`** (new) + **`src/prompts/index.ts`** composers — externalized prompts per D4. Universal-rules injection per CLAUDE.md rule 16.
- **`src/agents/defaults/lead.md`** (changed) — `tool_use.debate` grant for PLAN persona. Not granted to ba / builder / verifier / reviewer / scientist (D12 lock).
- **`docs/contracts/DEBATE.md`** (changed) — process → runtime contract upgrade. D6 ignore-policy subset, D9 manifest-preview shape, D10 first-line grammar, D11 corrected budget arithmetic.

### PLAN extraction wiring (commit `b836228`)

- **`src/tools/debate-request-extract.ts`** (new, pure no-I/O) — `extractDebateRequest` parses one terminal `<debate-request>` block; returns `{ kind: 'none' | 'one' | 'multiple' | 'parse-error' }`. Validates topic (kebab + ≤48), opposingProvider, question, files, status (default `thesis`), cycle (default `plan`), target, all seven required H2 sections. Captures trailing prose into `block.trailingDraft` for D1 forensics.
- **`src/phases/plan.ts`** (changed) — outer "debate-rounds" loop wrapping the existing tool-dispatch loop:
  - 0 blocks → existing happy path unchanged.
  - ≥2 blocks → `plan_multiple_debate_requests` intervention (D2 fail-fast).
  - parse error → `plan_debate_request_invalid` intervention.
  - 1 block → permission-clamp (`opposingProvider` must be in caller's declared `tool_use.debate.opposingProviders`); persona-without-debate-scope intervention; persist `trailingDraft` to `<runDir>/discarded-drafts/plan-<topic>.draft.md` (D1); call `requestDebate`; drain iterable; on success, set up continuation context (DECISION.md added to `extraFiles`; new `userTurn` referencing decision sha + path); reset dispatch state for next round.
  - `MAX_DEBATE_ROUNDS = 1` for v0.1 (rule 21: prove risk-reduction before scaling).

### Tests

- **`tests/agent-load-tool-use-debate.test.ts`** — schema validation: cross-family invariant, hard caps, `previewBeforeSend: true` literal, `opposingProviders` subset of `PROVIDER_FAMILIES`.
- **`tests/state-events-debate.test.ts`** — event validators + forward-compat correlation fields.
- **`tests/debate-artifact.test.ts`** — parse / serialize / canonicalize for all three artifacts; verdict enum; first-line grammar; exact-copy heuristic.
- **`tests/debate-permissions.test.ts`** — manifest preview shape; sha binding; ignore-policy filter; path-safety.
- **`tests/prompts-debate.test.ts`** — opponent + synthesis prompt composer + universal-rules injection.
- **`tests/debate-request.test.ts`** — end-to-end `requestDebate` with FakeProvider + ProxyAdapter (claude+codex via single backing fake): happy path, cross-family rejection, topic collision, manifest blocked, decision validation, response parse failure.
- **`tests/lead-debate-permission.test.ts`** — D12 negative tests for builder/verifier/reviewer/scientist.
- **`tests/debate-request-extract.test.ts`** (new with PLAN-extraction commit) — 27 unit tests covering happy path, terminal-directive trailing capture, multiple blocks, missing keys (each of the seven sections), invalid status, files-key-required, topic format.
- **`tests/plan-debate-extract.test.ts`** (new with PLAN-extraction commit) — 7 integration tests with FakeProvider: happy path (PLAN turn 1 emits block → debate runs → continuation produces final PLAN+SOURCE_CHECK); terminal-directive (stale T-999 prose lands in discarded-drafts and NOT in final PLAN); multiple blocks → fail-fast; YAML parse-error → intervention; persona-without-debate-scope → intervention; opposingProvider not in declared list → intervention; second debate request in continuation → `plan_debate_round_exceeded`.

## Specific review-pass requests

### A. D1 lock (terminal-directive) — the load-bearing claim of PLAN extraction

1. `src/phases/plan.ts` outer loop: when extraction returns `kind: 'one'`, the orchestrator persists `trailingDraft` to `discarded-drafts/plan-<topic>.draft.md` THEN runs the debate THEN sets up continuation. Is that order correct? Specifically: should the discarded-draft persist run **before** the permission clamp (so we can forensically see what the persona authored even when we reject the block)? Or only on the success path?
2. The continuation user-turn message says "The orchestrator discarded any pre-decision PLAN content the prior turn emitted." This relies on the *persona* honoring "do not reuse pre-decision PLAN prose" (Codex D1 wording). The orchestrator cannot enforce this without re-extracting from the continuation response. Is the prompt-only enforcement sufficient, or is there a stronger guarantee available?
3. `extractDebateRequest` captures `trailingDraft` as the substring after `</debate-request>`, trimmed. Does the trim mask leading whitespace that, in a real persona response, would carry meaningful content (e.g., a leading newline before a YAML-formatted plan)?

### B. D2 lock (fail-fast on multiple) — and the close-tag mismatch case

1. `extractDebateRequest` counts opening tags by `indexOf` advancing past the needle. Does this handle tags inside YAML scalars correctly? Concretely: if the persona wrote `question: "we have <debate-request> in this question"`, the parser would count two opens. Is that acceptable, or should the parser strip code-fence regions / quoted strings before counting?
2. The "close tag before open tag" branch returns `parse-error`. But if a persona writes `</debate-request>` as a literal example in `## What is locked`, then later opens a real `<debate-request>...</debate-request>` block, we'd see openCount=1, closeCount=2, which currently fails as "expected exactly one </debate-request>". Worth fixing now or accepting as edge case?

### C. D11 lock (budget arithmetic)

1. `requestDebate` runs opposing turn + synthesis turn through `invokeAgent`, both with `phase: req.phase`. PLAN's continuation turn after `runPlanDebate` returns ALSO runs through `invokeAgent` (the outer dispatch loop). So a PLAN-with-debate run charges: `agent_invoked × (initial dispatch turns + opposing + synthesis + continuation dispatch turns)`. Is this what D11 locked, or should the continuation be accounted separately?
2. `assertWithinBudget` reads cumulative spend from `events.jsonl` per call. Is there a race where two concurrent turns inside the debate (opposing + synthesis are sequential but `agent_invoked` is appended atomically) could double-charge? No — they're sequential in the async-iterable. Just confirm.
3. Does the `debate_started` event itself count against any budget axis? It's a state-write, not a provider call, but it does write bytes. The `maxTokensEstimate` axis is provider-invocation-only; `events.jsonl` writes are unbounded. Is that consistent with rule 19's wording?

### D. D7 lock (topic-uniqueness dual check)

1. The artifact-dir check uses `existsSync(debateDirPath)`. Race: between `existsSync` returning false and `mkdir(debateDirPath, { recursive: true })`, another process could mkdir the same dir. M10 documents single-writer semantics for the run lock, but is there an explicit mutex around `requestDebate`? Or is single-writer enforced only by the runId-scoped run lock?
2. PLAN extraction caps `MAX_DEBATE_ROUNDS = 1`. The collision test in `tests/debate-request.test.ts` exercises *re-firing the same topic* in the same run; in PLAN-extraction land, the persona could emit a different topic each round but rule 21 is the gate. Is `MAX_DEBATE_ROUNDS = 1` the right v0.1 default, or should it be 2 to allow one follow-up debate after seeing the first DECISION?

### E. D5 lock (rubberstamp / no-rationale)

1. `parseDecision`'s exact-copy heuristic: rationale > 200 chars that substring-matches a sentence in the opposing RESPONSE corpus → `debate_decision_no_rationale`. The 200-char threshold and substring-match are heuristic; what's the false-positive profile? Specifically: a decision that legitimately quotes a 250-char passage from RESPONSE in `## Rationale` and then explains *why* the calling persona accepts it.
2. The matching uses substring, not normalized comparison. Quote-style differences (smart quotes vs. straight) or whitespace-only differences could evade detection. Is a normalized check worth the complexity in v0.1?

### F. PLAN extraction permission-clamp (the new escape-hatch closure)

1. The permission clamp in `runPlanDebate` checks `block.opposingProvider` is in `caller.permissions.tool_use.debate.opposingProviders`. If the persona's permissions allow `['codex', 'gemini']` and the YAML names `gemini`, but no `gemini` adapter is registered in the registry, what happens? The clamp passes; `requestDebate` calls `registry.familyOf('gemini')` which throws "no family registered". Does the throw flow through to `plan_debate_runtime_error` correctly, or does it surface as something more useful?
2. The clamp runs AFTER the parse and BEFORE the discarded-drafts persist. If the YAML parses but the persona's chosen opposingProvider is unauthorized, the trailing prose is NOT persisted (we return intervention before reaching the persist step). Is that the right ordering, or should we still capture forensics on permission rejection?

### G. PLAN extraction continuation context

1. The continuation user-turn says "Re-author PLAN.md + SOURCE_CHECK.md per the locked schemas, integrating the decision." It does NOT explicitly instruct the persona to AVOID emitting another `<debate-request>`. The orchestrator's `MAX_DEBATE_ROUNDS = 1` cap is the structural enforcement. Should the continuation prompt also explicitly forbid re-debate?
2. The continuation block adds `DECISION.md` to `extraFiles` but does NOT add `BRIEFING.md` or `RESPONSE.{side}.md`. Is that correct? The persona's synthesis turn already saw both via `requestDebate`'s synthesis prompt, but the continuation turn is a fresh invocation. The DECISION should be the load-bearing artifact (it carries the canonical resolution); the briefing + response are inputs to the synthesis. Confirm this is the right framing.
3. `debateContext` carries DECISION.md sha256 + caller verdict + opposing verdict. The persona sees this as a `## Continuation context` block in the user turn. Is the sha256 useful to the persona, or is it just operator-facing forensics that should NOT pollute the prompt?

### H. M9 nits cleanup (commit `b086387`)

1. The cleanup dropped 11 inline citations across 8 source files + 6 test files, preserving the substantive technical content. Did any cleanup accidentally drop *necessary* context (e.g., the "Codex review bp#4" attribution that, when removed, makes the surrounding code-block unreadable)?
2. M1 + M2 (duplicate parsing helpers) were deferred per the M9 audit's "DRY at 3x not yet triggered". Should this Codex review re-evaluate that deferral now, or accept the deferral?

### I. The debate-runtime-vs-PLAN-extraction split

1. M10 ships the runtime primitive in commits 0–10 with full tests via `requestDebate` + FakeProvider. The PLAN-extraction commit lands separately. Is the split coherent? Specifically: did the M10 primitive bake in any PLAN-specific assumption that PLAN-extraction would later need to subvert, or did the runtime stay generic as D12 required?
2. `requestDebate`'s synthesis turn re-invokes `req.caller` with a synthesis prompt. The caller persona sees BRIEFING.md + RESPONSE.{side}.md and must produce a DECISION. The PLAN persona's `body` (`src/agents/defaults/lead.md`) does NOT mention how to author DECISION.md — it's about producing PLAN.md + SOURCE_CHECK.md. Does the synthesis prompt template (`src/prompts/debate-synthesis-system.md`) carry enough scaffolding to override the persona body's instructions for the synthesis turn? Or is there a risk the persona conflates "produce PLAN + SOURCE_CHECK" with "produce DECISION"?

### J. The discarded-drafts artifact

1. PLAN extraction writes trailing prose to `<runDir>/discarded-drafts/plan-<topic>.draft.md`. What if `<topic>` collides with a previous discarded draft from the same run? The current implementation overwrites via atomic-write. Is that acceptable, or should we add a turn counter to the filename?
2. The runDir is `.code-oz/state/runs/<runId>/`. The discarded-drafts subdir lives alongside `events.jsonl` and `current.json`. The handoff sketched `.code-oz/runs/<runId>/discarded-drafts/` (under the worktree subsystem's run dir, not the state subsystem's). I chose the state subsystem because that's where the orchestrator's run-scoped artifacts naturally live. Is this the right call?

### K. Test coverage gaps

1. `tests/plan-debate-extract.test.ts` covers 7 scenarios with FakeProvider. Missing: a case where `requestDebate` ITSELF throws a ProviderError (e.g., topic-collision after the first round, or budget-exceeded). The current orchestrator code path would convert that to intervention via the `try/catch` in `runPlanDebate`, but there's no test for it.
2. There's no test for the case where extraction returns `kind: 'one'` BUT the YAML's opposingProvider is the persona's OWN family (e.g., persona is `claude`, YAML names `claude`). The permission clamp would catch it (claude isn't in `['codex']` for the lead persona), but if someone configured a persona with `opposingProviders: ['claude', 'codex']` (which would itself fail load-time validation), the runtime cross-family check in `requestDebate` would catch it. The double-defense is tested via separate paths but not end-to-end.
3. Does the existing `tests/plan-phase.test.ts` regression coverage prove that the *un*modified PLAN happy path (no debate) still works correctly? Yes — all 7 tests pass after the wiring. Confirm the tests adequately exercise the non-debate code path.

## Verdict format

Per the M1 + M2 + M3 + M4 + M5 + M6 + M7 + M8 + M9 review precedent, please return one of:

- **`push`** — implementation is sound; safe to push `main` (with M10 tag) to GitHub.
- **`fix-first`** — at least one block-push or block-next-milestone or fix-soon finding; address before push. List findings by severity.
- **`debate-required`** — a fundamental design decision needs a fresh round of debate; describe the alternative.

For each finding, include: id (e.g., bp#1, fs#2, n#3), severity (`block-push` / `block-next-milestone` / `fix-soon` / `nit` / `fyi`), file:line citation, what's wrong, why it matters, and a concrete remediation.

The CLAUDE.md no-tech-debt-at-milestone-close rule is in effect: close ALL findings (incl. block-next-milestone + fix-soon) before pushing. Only `nit` and `fyi` can defer.

## Configuration

- Model: `gpt-5.5` xhigh
- Sandbox: `workspace-write` with `approval-policy: never` (per Ozzy's "give Codex more access" directive; the M9 commit 20 cleanup pass set the precedent — Codex applies behavior-preserving fixes directly when warranted).
- Branch: `main` at HEAD `b086387`. Inspect any file directly via `git show <sha>:<path>` or by reading the working tree.
- The relevant decision documents are `docs/research/CODEX_BRIEFING_M10.md` (the planning-convergence brief), `docs/research/CODEX_RESPONSE_M10.md` (the planning-convergence verdict + 12 locks), `docs/contracts/DEBATE.md` (the runtime contract), and `CLAUDE.md` (rules 7, 8, 9, 13, 19, 20, 21).

End of briefing.
