# Codex M10 planning-convergence response

**Thread:** `019de3ca-9641-7f83-b479-f65ad390c179`
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh
**Brief:** [`docs/research/CODEX_BRIEFING_M10.md`](./CODEX_BRIEFING_M10.md)

## Verdict on the decisions

1. **accept-with-modifications.** Use the two-turn debate primitive, but do not claim the phase can "resume from after the original `<debate-request>` block" unless all trailing original output is discarded. The debate request must be a terminal directive for that provider turn: once extracted, the orchestrator ignores any text after it. After DECISION.md is written, the calling phase should continue through a fresh continuation invocation that receives the DECISION path/sha as context, or the synthesis turn must explicitly return both DECISION.md and a validated phase-continuation payload. Do not reuse pre-decision PLAN prose.

2. **accept-with-modifications.** Use tagged YAML, not provider-native tool calls. Multiple `<debate-request>` blocks in one phase turn should fail fast, not drop with a warning. Dropping later requests hides model intent and adds a warning event not pinned in DEBATE.md. The repair prompt should name the duplicate-block error and ask for exactly one terminal block. `files: []` is fine, but missing `files` should remain a parse failure.

3. **accept-with-modifications.** Keep `requestDebate()` as an async iterable mirroring `requestReview`, but add durable correlation before allowing any `maxConcurrent > 1` behavior. Either add optional debate metadata to `agent_invoked` / `agent_completed` in `src/state/schemas.ts` (`debateTopic`, `debateTurn`) or keep M10 defaults and runtime behavior strictly serial (`maxConcurrent: 1` for bundled personas). Relying on event ordering between `debate_started` and `debate_resolved` is not enough once concurrent open debates exist.

4. **accept-with-modifications.** Use an internal synthetic `AgentDefinition`, but not with `permissions.read: '*'` and not with a hardcoded source prompt. Ship `src/prompts/debate-opponent-system.md`, compose it with `src/prompts/universal-rules.md`, and synthesize an agent whose read scope is exactly the debate file manifest plus any canonical debate artifact paths needed by the prompt. The opponent should have no write, execute, repo_context, review_request, or debate permission.

5. **accept-with-modifications.** Calling persona authors DECISION.md; orchestrator validates shape. Reject the proposed rubberstamp heuristic as written. Same enum verdict as the opposing RESPONSE is normal and should not warn. The only safe blocking heuristic is exact or near-exact copied rationale text with no independent rationale. Treat that as `debate_decision_no_rationale` with detail, not as a new warning event. Record opposing and decision verdicts for audit, but do not pollute the authority model.

6. **accept-with-modifications.** Implement debate-only `.code-ozignore` now, because ROADMAP M10 acceptance requires it. Do not defer entirely. Do not expand project-wide now. The required modification: the subset parser must fail closed on unsupported gitignore syntax instead of silently treating unsupported patterns as literals. Put the parser in `src/tools/ignore-policy.ts`, document the supported subset in `docs/contracts/DEBATE.md`, and test negation / escaped / malformed patterns explicitly.

7. **accept-with-modifications.** Per-run `<phase>-<topic>` uniqueness is right. Also check the artifact directory, not only `events.jsonl`, so a crash before `debate_started` cannot leave a collision trap. Fail fast with repair. Do not auto-suffix. Auto-suffix makes the artifact trail harder to read and weakens the topic discipline this feature depends on.

8. **accept-with-modifications.** Use per-debate sha-bound resume. Add response validation to the resume path: BRIEFING present + RESPONSE present + DECISION absent should parse and validate RESPONSE before re-invoking synthesis. If RESPONSE is invalid or its expected provider suffix does not match the started opposing provider, intervention beats replay. Keep atomic-write-only semantics.

9. **accept-with-modifications.** Audit artifact without an interactive gate is acceptable for M10, but only if the contract language is tightened. DEBATE.md currently says the runtime "presents the manifest to the user before send"; audit-only does not do that in the ordinary meaning. Update M10 runtime docs to say "writes a pre-send manifest preview artifact and blocks on policy violations; interactive approval is deferred." Also include `manifestPreviewSha256` in `debate_started`.

10. **accept-with-modifications.** RESPONSE verdict is data; DECISION verdict is authority. Add one parser rule before implementation: RESPONSE must expose a single machine-readable overall verdict, for example the first non-empty line under `## Verdict on the decisions` must be `Overall verdict: <enum>`. Per-decision verdicts can follow. Without that, `responseVerdict` in events will be guesswork.

11. **accept-with-modifications.** Caller-phase accounting is right; the arithmetic is wrong. Every provider invocation must go through `invokeAgent`, so every invocation increments `maxProviderCalls` and contributes tokens. The opposing turn counts. The synthesis turn counts. Any post-decision phase-continuation turn also counts. Do not special-case synthesis as "+0" unless you bypass `invokeAgent`, which would violate the wrapper discipline. Debate is not a sub-phase, but it is multiple provider calls under the caller phase.

12. **accept-with-modifications.** Bundled defaults should be PLAN-only in M10, but the primitive must stay phase-agnostic. ROADMAP says any phase persona with `tool_use.debate` permission can invoke `requestDebate`; satisfy that by implementing generic runtime checks and granting the permission only to `src/agents/defaults/lead.md` for v0.1. Add a negative permission test for Builder/Reviewer defaults and at least one unit test proving a custom non-PLAN persona with valid `tool_use.debate` reaches the generic permission path.

Top-level verdict on the recommended commit sequence: **accept-with-modifications.** The sequence is directionally right, but it must lock D1, D6, D9, D11, and D4 before code lands. Otherwise the implementation will bake in stale phase output, undercount provider calls, or ship a privacy surface whose docs overpromise what the runtime actually does.

## Risks the proposing side missed

1. **Stale phase output after the debate request.** A model can emit `<debate-request>` and then keep writing PLAN content in the same response. That content was authored before seeing the opposing RESPONSE and DECISION. `src/phases/plan.ts` must treat the debate request as terminal and discard trailing text, or the debate becomes decorative.

2. **Budget undercounting.** `src/providers/invoke.ts` appends `agent_invoked` for every call and `src/providers/cost.ts` counts those events. The synthesis turn cannot be free. If M10 tries to hide it from budget accounting, it creates a second provider-call path outside the wrapper.

3. **Event correlation is underdesigned for concurrency.** D3 adds `debateTurn` but D11 allows `maxConcurrent`. If two debates overlap in one phase, sequence alone cannot pair provider calls to debate dirs. Either log debate metadata on provider-call events or keep M10 effectively serial.

4. **The proposed warning events are contract drift.** `debate_multiple_requests_dropped` and `debate_decision_rubberstamp_warning` are not in DEBATE.md's two-event surface. M10 should use parse failures, existing intervention plumbing, or fields on `debate_started` / `debate_resolved`, not invent audit event names casually.

5. **`.code-ozignore` subset parsing can leak by omission.** A minimal parser that silently ignores negation, escaped spaces, rooted patterns, or bracket syntax gives users false confidence. Unsupported syntax must fail closed with an actionable error.

6. **Synthetic opponent read scope is too broad.** `permissions.read: '*'` is not expanded by `buildManifest`, but it removes the last defense if `requestDebate` accidentally includes the wrong file. The synthetic agent should permit only the files already approved by `debate-permissions.ts`.

7. **Manifest preview timing matters.** The ignore-policy check must happen before BRIEFING.md is sent and before any provider call. Ideally it also happens before loading ignored file contents into a `ProviderRequest.files` payload. Reuse or extract the path-safety logic from `src/providers/manifest.ts` so debate preview and provider invocation normalize paths the same way.

8. **RESPONSE verdict parsing is not defined tightly enough.** The H2 section name is locked, but the machine-readable verdict location is not. That is fine for manual research files and fragile for runtime validation.

9. **Resume can reanimate corrupted artifacts.** The resume path should not assume a present RESPONSE is valid. Parse it, validate the verdict enum and sections, and intervention on mismatch rather than synthesizing from malformed opponent output.

10. **PLAN-only defaults can accidentally become PLAN-only runtime.** Keep permission grants narrow, but do not put PLAN-specific assumptions in `src/tools/debate-request.ts` or `src/artifacts/debate.ts`.

## Where I disagree

The biggest disagreement is D11's "+0 synthesis" budget model. The concrete alternative is simple: `requestDebate()` calls `invokeAgent()` for the opponent and for synthesis, with both using `phase: req.phase`. `src/providers/cost.ts` needs little or no debate-specific code because it already counts `agent_invoked` events. Update `docs/contracts/DEBATE.md § Budget accounting` from "+1 per debate" to "+1 per provider invocation inside the debate; no new phase turn."

I also disagree with "phase resumes from after the original block." In `src/phases/plan.ts`, implement extraction as a pause point: parse one terminal `<debate-request>`, run `requestDebate()`, write DECISION.md, then re-invoke PLAN continuation with the decision context. If the original response contains anything after `</debate-request>`, ignore it and optionally persist it as a discarded draft for debugging.

I disagree with drop-with-warning on multiple debate requests. Fail fast. A persona asking two design questions is not a streaming optimization; it is ambiguous orchestration. The repair prompt should ask the persona to choose the highest-risk question or merge the framing into one topic.

I disagree with the rubberstamp warning as framed. Matching the opponent's enum verdict is not suspicious. Exact copied rationale is suspicious. Block exact-copy rationale as no independent rationale; otherwise leave semantic disagreement to human/model synthesis and audit.

I disagree with any hardcoded opponent prompt. A synthetic AgentDefinition is fine, but the prompt should be an in-tree Markdown template under `src/prompts/`, snapshot-tested like M9's review prompt, and composed with universal rules.

I disagree with treating `.code-ozignore` as "gitignore-format subset" unless unsupported gitignore features fail closed. If the runtime cannot support full gitignore semantics, it must say exactly what it supports and stop on the rest.

## What I would defer

Defer interactive approval (`code-oz approve debate ...`) to W2/TUI work. M10 should write `MANIFEST.preview.md`, hash it, block on policy violations, and document that the preview is non-interactive.

Defer project-wide `.code-ozignore` enforcement to W4 hardening. M10 should land the shared `ignore-policy` module and use it only from `src/tools/debate-permissions.ts`.

Defer BUILD default debate permission. Builder debates will involve live worktree state, patch ownership, and possible VERIFY restart interactions. PLAN-only bundled defaults are the right v0.1 measurement baseline.

Defer symmetric and multi-opponent debate. Single-opponent asymmetric debate is already enough new runtime surface for M10 and aligns with rule 21.

Defer sophisticated anti-rubberstamp scoring. Exact-copy and rationale-length checks are enough for v0.1. Semantic independence should stay a review concern until real event data shows a failure pattern.

Defer full gitignore parity. The M10 requirement is privacy-safe behavior, not perfect compatibility. A conservative subset with fail-closed unsupported syntax is safer than a broad but subtly wrong parser.

Defer `code-oz doctor --bundle` visualization for debate warnings unless it already falls out naturally from existing intervention/event rendering. The canonical artifacts and events are the M10 deliverable.

## Recommended next step

Lock these decisions before any implementation commit:

1. D11: every provider invocation inside debate counts under `budgets.global` and the caller phase. No free synthesis turn.
2. D1: debate request is terminal; trailing original phase output is ignored; post-decision continuation is explicit.
3. D6/D9: `.code-ozignore` debate-only parser fails closed, and manifest preview is documented as non-interactive in M10.
4. D4: synthetic opponent uses an externalized prompt and exact read scope, not `'*'`.
5. D3: either add durable debate correlation to provider-call events or force M10 bundled/runtime concurrency to one open debate.

Then proceed with the commit sequence, with two adjustments:

- Add an early substrate/design commit for event correlation and budget tests before `requestDebate`.
- Move the M9 cleanup commit after the M10 runtime substrate is green, unless the cleanup touches the exact files being edited.

The first code commit should be `feat(agents): tool_use.debate schema + load validation`, but do not start it until the budget and pause/resume semantics above are reflected in `SESSION_M10_KICKOFF.md`.
