# code-oz — M5 Codex response

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-30
- **Thread ID:** `019ddbdd-92d1-7051-9067-a0adec29fc37`
- **Briefing:** [`CODEX_BRIEFING_M5.md`](./CODEX_BRIEFING_M5.md)

Verbatim reply below.

---

Verdict: `proceed-with-modifications`. The M5 shape is mostly right, but I would flip or tighten five leans before code: event taxonomy, invalid `SPEC.md` handling, transcript fixture delimiters, prompt asset source of truth, and max-round repair semantics.

**Where I agree**

1. BA-persona-driven is the right default. It matches the roadmap's DEFINE contract, where the BA persona performs intent elicitation and outputs `SPEC.md` ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:102), [ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:66)). The orchestrator should enforce loop bounds, protocol parsing, validation, and artifact writes. It should not own the question sequence.

2. A structured ready signal is correct, but make it an exact line match, not substring grep. Use `^\s*<spec-ready/>\s*$` on the persona response only. User input may contain the token, especially if copied from docs or from an adversarial prompt. The token controls draft extraction only, not gate advancement. The gate still comes from `code-oz approve define`, per file-based gate rule ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:20), [file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:115)).

3. Persona-drafted SPEC is the right UX. Human-readable artifact contracts are a locked rule ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:26)). But the orchestrator should parse the draft into a typed `SpecArtifact` and serialize canonical Markdown. That keeps the BA voice inside bullets while making headings, order, and whitespace deterministic.

4. Required non-goals are correct. The acceptance explicitly includes non-goals ([SESSION_M5_KICKOFF.md](/Users/ozzy-mac/Projects/code-oz/docs/design/SESSION_M5_KICKOFF.md:64)). I would require at least one bullet. For open questions, require the section to be present and visible. If there are none, require a bullet like `- None known at define time.` rather than an empty section.

5. Out-of-process approval is correct. It preserves the existing M3 gate contract and sha256 binding. `approveGate()` computes and binds `artifactSha256` ([gates.ts](/Users/ozzy-mac/Projects/code-oz/src/state/gates.ts:101)), and resume integrity depends on that binding ([file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:142)).

6. Prompt-string history is better than sending a growing transcript file through `req.files`. The wrapper hashes and reloads every file in the manifest ([manifest.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/manifest.ts:67)), so a transcript file in `files` creates pointless file I/O and pollutes `filesSent` and `bytesSent`. But correct the complexity claim: stateless providers mean full history is resent each turn either way, so prompt transport is still O(N²) total provider input over N turns. It is just the smaller and cleaner O(N²).

7. The `--request`, `--request-file`, TTY-default trio is right. Only TTY blocks deterministic tests. Only `--request-file` is hostile to the core non-technical UX. Make `--request` and `--request-file` mutually exclusive, reject empty content, and fail non-TTY no-input with actionable text.

8. One shared Common Rationalizations table is right. The agent-skill spec explicitly carries that pattern ([agent-skill-format.md](/Users/ozzy-mac/Projects/code-oz/docs/references/agent-skill-format.md:54)). Keep it short. It will be injected every turn and counted in `tokensEstimate` because the estimator includes `req.prompt` ([cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:36)).

**Where I disagree**

1. Prompt 10 is wrong: `agent_invoked` plus `agent_completed` is not sufficient for replay. Current events do not log `req.prompt` or response content. `agent_invoked` records metrics and manifest only ([invoke.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/invoke.ts:100)), and `agent_completed` records only agent plus optional token usage ([schemas.ts](/Users/ozzy-mac/Projects/code-oz/src/state/schemas.ts:143)). If W2 replay matters, add ask-me events now. No version bump is needed because the event schema is open after `version: 1` ([file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:166)).

```ts
type AskMeUserInputEvent = {
  version: 1
  type: 'ask_me_user_input'
  ts: string
  runId: string
  phase: Phase
  turn: number
  input: string
}

type AskMePersonaReplyEvent = {
  version: 1
  type: 'ask_me_persona_reply'
  ts: string
  runId: string
  phase: Phase
  turn: number
  agent: string
  response: string
  ready: boolean
}
```

2. Do not write an invalid `SPEC.md`. That poisons the approval path because `code-oz approve define` binds the canonical artifact hash. The gate writer requires the artifact to exist ([gates.ts](/Users/ozzy-mac/Projects/code-oz/src/state/gates.ts:93)), and the gate is append-only once approved ([file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:119)). If finalization plus repair still fails, write `.code-oz/artifacts/SPEC.draft.md`, write `NEEDS_INTERVENTION.json` with code `spec_validation_failed`, append `intervention`, and exit non-zero. Refuse to create `SPEC.md` until validation passes.

3. The Markdown fixture format should not use `## user` and `## ba` blocks. The final BA response contains `## Goals`, `## Users`, etc., so an H2-delimited parser will split inside the SPEC draft. Use HTML comment turn delimiters instead:

```md
---
persona: ba
userRole: non-technical-parent
maxRounds: 8
---

<!-- turn:user -->
Build me a baby game for my phone.
<!-- /turn -->

<!-- turn:ba -->
What age range is this for?
<!-- /turn -->

<!-- turn:user -->
A one-year-old.
<!-- /turn -->

<!-- turn:ba -->
<spec-ready/>
# SPEC

## Goals
- ...
<!-- /turn -->
```

4. The prompt asset plan risks duplication. `ba.md` is already the bundled persona and its frontmatter is locked ([ba.md](/Users/ozzy-mac/Projects/code-oz/src/agents/defaults/ba.md:1)). If `src/prompts/define-system.md` also contains the full BA persona, the two will drift. Make `define-system.md` a protocol template, not a second persona. Compose it with `agent.body`, Common Rationalizations, and the ready signal:

```ts
const prompt = defineSystemTemplate
  .replace('{{AGENT_BODY}}', agent.body)
  .replace('{{COMMON_RATIONALIZATIONS}}', commonRationalizations)
  .replace('{{READY_SIGNAL}}', config.phases.define.askMe.readySignal)
  .replace('{{CONVERSATION}}', renderTurns(history))
```

5. The config should not say `confidenceThreshold` unless there is a numeric confidence field. M5 is a ready-token protocol. Also, `best-effort` is too vague if it can write invalid canonical artifacts. Prefer:

```yaml
phases:
  define:
    askMe:
      maxRounds: 8
      readySignal: '<spec-ready/>'
      onMaxRounds: 'finalize'   # 'finalize' | 'fail'
      maxFinalizeTurns: 1
      maxRepairTurns: 1
```

Finalization and repair are provider calls, so they still go through `invokeAgent` and budgets. If finalization or repair fails validation, draft plus intervention, not canonical `SPEC.md`.

6. Do not auto-write `STOP.json` for a mid-DEFINE resume gap. STOP is terminal ([file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:100)). Merely discovering an active run in DEFINE without a gate should not destroy it. For M5: if `SPEC.md` exists and no gate exists, print the approve instruction. If no valid SPEC exists, say mid-DEFINE resume is not implemented and offer a new-run path. Leave STOP for explicit user intent.

7. The briefing's "prompt assets visible in manifest" claim is false under the current contract. `manifest.files` is only `ProviderRequest.files` after wrapper loading and hashing ([provider-contract.md](/Users/ozzy-mac/Projects/code-oz/docs/references/provider-contract.md:41), [manifest.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/manifest.ts:105)). Prompt assets injected into `req.prompt` are counted in `tokensEstimate`, not `filesSent` or `bytesSent`. Do not include bundled prompt assets in `files` just to make the manifest look busy.

8. Pin the SPEC contract before the parser, not at commit 7. M4 could distill provider behavior after implementation because the wrapper was the design object. M5's design object is the artifact contract itself. Put `docs/references/spec-contract.md` and `docs/contracts/SPEC.md` in commit 1, then implement parser and serializer against them. Polish later if needed.

**Decisions you must lock before code**

1. Exact SPEC syntax: I recommend no YAML frontmatter in `SPEC.md` for M5. Use plain Markdown only: `# SPEC`, then the six required H2 sections in canonical order. Gate metadata already lives in events and gate files.

2. Exact extraction rule: the ready token must be alone on a line in the persona response; the draft is everything after that line, trimmed. No fenced-code extraction and no "next blank line" heuristic.

3. Event retention policy: ask-me events will store user input and BA replies in `.code-oz/state/runs/<runId>/events.jsonl`. That is acceptable because `state/runs/` is already gitignored by scaffold ([init.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/init.ts:146)), but the docs should say those logs may contain request details.

4. FakeProvider routing: M5 tests need a real way to drive bundled BA through FakeProvider. Either add `code-oz run --provider fake` now, or use a project-local `ba.md` fixture override with `provider: fake`. I prefer `--provider fake` as a runtime override because ROADMAP already names that shape for M7 ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:76)).

5. Gate-required event helper: after valid `SPEC.md`, append `gate_required` and rebuild `current.json` through `run.ts`, not by ad hoc event writes. `current.json` is derived and should only be written by the state reducer path ([file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:186)).

6. Artifact writes must be atomic: write `SPEC.md` and `SPEC.draft.md` via temp file, fsync, rename, and ideally directory fsync. Gate writes already follow that discipline ([gates.ts](/Users/ozzy-mac/Projects/code-oz/src/state/gates.ts:1)); artifacts should not be weaker.

7. Prompt asset liveness: use static Bun asset imports in a production-reachable module, then call them from `run -> define`. The existing bundled default pattern is `import ... with { type: 'file' }` plus `Bun.file(path).text()` ([bundled-defaults.ts](/Users/ozzy-mac/Projects/code-oz/src/agents/bundled-defaults.ts:1)). A random unused keepalive import in bootstrap is not enough if tree shaking sees no side effect.

8. Active-run behavior: `code-oz run` should require an initialized `.code-oz/` rather than silently creating partial state. `code-oz init` owns scaffold creation ([init.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/init.ts:132)).

**Commit sequence I'd recommend**

1. `docs(define): pin SPEC and ask-me contracts`
   Add `docs/references/spec-contract.md`, `docs/contracts/SPEC.md`, exact ready-token grammar, event retention policy, draft-vs-canonical rule.

2. `feat(artifacts): add SPEC parser and serializer`
   `src/artifacts/spec.ts`, typed issues, canonical serializer, duplicate/out-of-order/missing-section tests.

3. `feat(config): add define ask-me config`
   Add `phases.define.askMe`, deep-merge validation in `loadConfig`, defaults, config tests.

4. `feat(prompts): add define protocol and rationalizations assets`
   Static asset loader, prompt composition, Common Rationalizations table, BA body update without frontmatter churn.

5. `feat(state): record ask-me turns and gate-required transitions`
   Add ask-me event types, validators, reducer no-op behavior, helper for `gate_required` plus current rebuild.

6. `feat(phases): implement bounded ask-me runner`
   In-memory history transport, event recording, finalization on max rounds, exact ready extraction, one repair turn, ProviderError propagation through wrapper.

7. `feat(define): write validated SPEC artifacts`
   Atomic artifact writer, `SPEC.draft.md` on failure, `NEEDS_INTERVENTION` for validation failure, no invalid canonical `SPEC.md`.

8. `feat(commands): wire code-oz run for DEFINE`
   `--request`, `--request-file`, optional `--provider fake`, TTY handling, active-run behavior, actionable exits.

9. `test(define): add transcript fixture integration`
   Comment-delimited transcript fixture, FakeProvider replay, structural snapshot, binary smoke for prompt asset liveness if feasible.

10. `docs(m5): update help and release metadata`
    Update run help, fix any approve artifact wording if touched, bump versions only when tagging `v0.5.0-alpha.0`.

**Open risks I'd flag**

1. Prompt history is still O(N²) provider input. Max rounds keeps it bounded, but Common Rationalizations plus full BA body every turn can make the DEFINE budget look surprisingly high.

2. Provider `stopReason: 'max_tokens'` should be treated as invalid/incomplete output. Do not try to parse and approve a truncated SPEC.

3. User prompt injection can target the ready token. Delimit user turns clearly and parse only the final persona response.

4. Structural tests can hide serializer bugs if parser and serializer share the same mistaken assumptions. Add parser rejection tests plus one canonical serializer golden test.

5. `fieldsRemovedByScope` should stay `0` in M5 unless phase logic truly narrows a manifest entry. Prompt composition is not manifest narrowing.

6. The briefing says thirteen prompts, but the file has Prompt 14. Treat Prompt 14 as process/meta, but don't let that mismatch survive into the synthesized M5 plan.

proceed-with-modifications: add ask-me content events, never write invalid `SPEC.md`, replace H2 transcript delimiters, make `define-system.md` a protocol template instead of a duplicate BA persona, tighten ask-me config, pin SPEC before parser code, fix prompt asset liveness through static production imports, and do not auto-STOP mid-DEFINE runs.
