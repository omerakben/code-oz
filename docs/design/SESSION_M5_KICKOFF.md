# code-oz — M5 session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else. The non-negotiable rules in there override anything that conflicts in this kickoff.

Read this kickoff in full, including the cross-cutting addendum at the end. The addendum captures M4-locked decisions that affect M5; addendum wins on conflict.

## State at start of M5

- **Repo:** `github.com/omerakben/code-oz`, branch `main`
- **Last release:** `v0.4.0-alpha.0` (M4 — provider contract + 4 adapters + wrapper + requestReview + doctor)
- **Tests:** 391 passing, offline, ~1.2s
- **Binary:** `bun run build:binary` produces `dist/code-oz`, reports `0.4.0-alpha.0`
- **What works:**
  - `code-oz init` (M1) — scaffolds `.code-oz/` with greenfield/brownfield detection
  - `src/agents/` (M2) — parses, validates, loads, registers agent files; cross-family REVIEW enforcement live at agent-load time; bundled defaults wired via Bun asset imports; `bootstrap()` returns the AgentRegistry
  - `src/state/` (M3) — typed phase machine, append-only event log with per-event fsync, atomic gate writers with sha256 binding + path safety, run-level orchestration with cross-file recovery, single-active-run pointer
  - `code-oz approve [PHASE]` (M3) — writes a success gate, emits the layered transition events, rebuilds `current.json`, all under one per-run lock
  - `src/providers/` (M4) — IAgentProvider contract, ProviderRegistry with familyOf authority, four adapters (Fake, Claude, Codex, Gemini), wrapper layer (`invokeAgent`) with budget enforcement + tool-call cap + NEEDS_INTERVENTION recovery, manifest builder with permissions intersection + path safety
  - `src/tools/review-request.ts` (M4) — narrow cross-family REVIEW primitive (rule 2)
  - `code-oz doctor providers` (M4) — aggregate health probe with required-providers exit policy; `--json` output
  - `getProviderRegistry()` keepalive in `src/cli/bootstrap.ts` for compiled-binary tree-shake survival
- **What's still stubbed:** `code-oz run` exits non-zero pointing at this milestone (M5 starts wiring DEFINE; full spine demo lands in M7).

## Template references (read-only via `/add-dir`)

M5 borrows patterns from `agent-skills` (BA persona shape + Common Rationalizations table) and `Auto-claude-code-research-in-sleep` (ask-me flow shape + bounded conversation rounds). **Code stays referenced; specs get pinned.**

**Pinned canonical specs (read these first):**

- [`docs/references/agent-skill-format.md`](../references/agent-skill-format.md) — frontmatter format, permissions semantics, Common Rationalizations integration. The `ba` persona M2 shipped under `bundled/personas/define/ba.md` is the M5 starting point.
- [`docs/references/file-based-gates.md`](../references/file-based-gates.md) — § 4 (canonical phase → artifact map: `define → SPEC.md`).
- [`docs/references/provider-contract.md`](../references/provider-contract.md) — IAgentProvider, request DTO split, ProviderFamily, error codes. M5 phase logic constructs `ProviderRequest` (paths-only) and calls `invokeAgent(ctx, req)`.

**M5 will likely create one new pinned reference:** `docs/references/spec-contract.md` (the SPEC.md schema + Common Rationalizations table + non-goals discipline). Decide during planning whether the reference is worth pinning before code or can be deferred to commit 8 of M5 (mirrors M4's `provider-contract.md` decision).

**Live templates (read-only, `/add-dir` only when you need an example beyond the pinned specs):**

- `~/Projects/agents/templates/agent-skills` — BA persona patterns; Common Rationalizations format; the DEFINE → SHIP phase taxonomy this project adopted; ask-me-style intent elicitation prompts in their `examples/` directory
- `~/Projects/agents/templates/Auto-claude-code-research-in-sleep` — bounded conversation loops (max-rounds + score-based exit); transcript fixtures for non-technical users; how their Reviewer Memory pattern handled multi-turn context

**Rules for using templates** (carried over from M2/M3/M4):

1. Open via `/add-dir <path>`. Do not `cp`, do not symlink, do not add as a submodule.
2. Do not modify the upstream — those are different git repos with their own drift.
3. If you discover a contract worth pinning that isn't in the references docs yet, **extract it into `docs/references/` in the same commit.** Do not let the kickoff cite live template files for canonical decisions.

## Deep-dive: what each template contributes to M5

(Pre-extracted by the M4 session so M5 doesn't re-discover.)

| Template pattern | M5 adopts directly | M5 extends |
|---|---|---|
| `agent-skills` BA persona | The 5 bundled personas already include `ba` (define-phase) and `lead` (plan-phase). M5's job is to *exercise* the `ba` persona, not redesign it. | M5 wires `ba` into a real ask-me flow; the persona's body becomes the system prompt; user input drives a multi-turn conversation that produces `SPEC.md` |
| `agent-skills` Common Rationalizations table | The "Common Rationalizations" pattern (avoiding scope creep, premature optimization, etc.) is a load-bearing UX feature for non-technical users. M5 lands the table as a Markdown asset, injected into the BA system prompt. | The table is per-phase; M6 reuses it for plan; M7 reuses it for build/verify/review |
| `Auto-claude-code` bounded conversation | Max conversation rounds + exit-on-confidence pattern. M5's ask-me flow caps at N rounds (per `.code-oz/config.yaml`, default 8) and exits when the BA persona reports confidence ≥ threshold. | M5 only handles the DEFINE-phase loop; M6 reuses the pattern for PLAN's source-discovery loop |
| `Auto-claude-code` transcript fixtures | Test fixture format: a JSON/Markdown transcript of a non-technical user's responses, replayed deterministically against `FakeProvider`. M5 ships at least one fixture (`tests/fixtures/transcripts/nontechnical-baby-game.md` per ROADMAP). | The fixture format becomes the test-data shape for M6+ phases too; one fixture per representative use case |

The columns matter: M5 inherits the **shape** (persona-driven ask-me flow + Common Rationalizations + bounded loop) and **departs** on the artifact contract (SPEC.md is plain Markdown with explicit sections, not the upstream's free-form summary).

## Your task — M5: implement DEFINE phase + SPEC contract

Canonical scope: `docs/design/ROADMAP.md` § M5. Acceptance criteria from the ROADMAP:

- DEFINE writes `.code-oz/artifacts/SPEC.md`
- SPEC includes goals / users / constraints / acceptance criteria / open questions / non-goals
- Gate waits for user approval before PLAN
- Test: deterministic transcript fixture replays via FakeProvider and produces a snapshot-matched SPEC.md

**Files to create (per the ROADMAP):**

```text
src/phases/
  define.ts                # the phase implementation; the ask-me loop
src/artifacts/
  spec.ts                  # SPEC.md serializer + parser + schema validator
src/prompts/
  define-system.md         # bundled-asset system prompt for the ba persona
  common-rationalizations.md  # the Common Rationalizations table; injected into
                              # all phase system prompts
docs/contracts/
  SPEC.md                  # user-facing spec for the artifact
docs/references/
  spec-contract.md         # pinned reference (probably; decide in planning)
tests/
  define-phase.test.ts
  fixtures/transcripts/
    nontechnical-baby-game.md  # at least one canned transcript
```

Plus, almost certainly:

- `src/phases/ask-me.ts` — the bounded conversation runner shared between DEFINE (M5) and the PLAN source-discovery loop (M6+). Or kept private to define.ts in v0.1 and extracted later if M6 needs it.
- `src/artifacts/markdown-frontmatter.ts` — shared YAML-frontmatter + Markdown body serializer (SPEC.md, AUDIT.md, PLAN.md, etc. all share this shape). Extract once, reuse in M6/W4.
- An update to `src/commands/run.ts` so `code-oz run` actually does *something* (kick off DEFINE on a fresh run); even if it stops at the DEFINE gate awaiting approval, that's the v0.1 entry point.

**What's NOT in M5:**

- PLAN phase machinery + 3-source verification (M6).
- BUILD-lite, VERIFY-lite, REVIEW-lite (M7).
- Worktree creation + patch application (M7).
- AUDIT phase implementation (W4).
- Real Claude/Codex calls in tests — M5 spine tests are FakeProvider-only per the kickoff offline-test discipline.
- `consult()` broad primitive (v0.3).
- Streaming UI through code-oz (the wrapper layer streams ProviderEvent; M5 just produces them).
- Persona files for `ship` and `audit` phases (W4).

## Open design questions (input for `CODEX_BRIEFING_M5.md`)

These are the high-leverage decisions the planning round must converge on. Each is structured the same way as M2/M3/M4: **lean + reasoning + counter-argument I'm aware of**.

1. **Ask-me loop shape: BA-persona-driven or orchestrator-driven?**
   Lean: BA-persona-driven. The persona's system prompt instructs it to ask one focused question per turn, then signal confidence when ready. The orchestrator (define.ts) just relays user input back to the persona and detects the "ready" signal in the persona's structured response.
   Counter: orchestrator-driven (define.ts hardcodes the question sequence; the persona is just a stylist) is more deterministic and easier to test. But it forecloses future personas with different elicitation strategies.

2. **Confidence signal: structured field in persona response, or natural-language detection?**
   Lean: structured field. Define a `<spec-ready/>` or `[SPEC_READY]` token the persona emits when it has enough; the orchestrator greps for it. Natural-language detection ("I have enough information now...") is fragile.
   Counter: structured tokens require persona discipline. If the persona forgets, the loop runs forever. A max-rounds cap protects against that, but it's a UX cliff.

3. **SPEC.md generation: persona writes the draft or orchestrator templates it from extracted facts?**
   Lean: persona writes the draft, orchestrator validates. The persona's last response is a complete SPEC.md draft; orchestrator checks it has all required sections (goals, users, constraints, acceptance, open-questions, non-goals) and rejects if not. If validation fails, orchestrator asks the persona to fix the missing sections (one repair turn).
   Counter: orchestrator templating is more reliable but constrains the persona's voice. SPEC.md is for non-technical users — the persona's voice matters.

4. **Non-goals discipline: optional or required section?**
   Lean: required. Non-goals is the most underused-but-important section for scope discipline. M5 enforces non-empty `non-goals` in SPEC.md validation; persona system prompt asks for at least one explicit non-goal.
   Counter: forced non-goals can produce filler. But filler is better than scope creep.

5. **Transcript fixture format: JSON or Markdown-with-frontmatter?**
   Lean: Markdown-with-frontmatter. Mirrors the agent-skill format. Frontmatter declares scenario metadata (`{ persona, user_role, expected_spec_path }`); body is alternating `## user` and `## ba` blocks. Easy to author by hand.
   Counter: JSON is easier to parse and lint. But fixture authoring is the bottleneck, not parsing.

6. **Snapshot testing: full SPEC.md text match or structural match?**
   Lean: structural — parse the SPEC.md sections and assert each section is non-empty + matches a schema (goals.length > 0, etc.). Full text match is too brittle to LLM output drift even with FakeProvider canned responses.
   Counter: full text match catches regressions in the BA persona's voice. But voice changes are intentional in M5 → W2 polish; brittleness slows iteration.

7. **Approval flow: in-process prompt or out-of-process via `code-oz approve define`?**
   Lean: out-of-process via existing M3 `approve` command. DEFINE writes SPEC.md, then exits 0 with a message instructing the user to review SPEC.md and run `code-oz approve define`. Keeps the M3 approval contract (file-based gate) intact.
   Counter: in-process is faster UX but requires a TTY check + interactive prompt + still a way to run unattended (CI). Out-of-process is the simpler v0.1 contract.

8. **Where does Common Rationalizations table live?**
   Lean: bundled asset at `src/prompts/common-rationalizations.md`, injected into every phase persona's system prompt by the orchestrator (via a `{{COMMON_RATIONALIZATIONS}}` template token). One source of truth; M6/M7 reuse the same template.
   Counter: per-phase tables (define-rationalizations.md, plan-rationalizations.md) are tailored. But tailoring drifts; one table covers 80% of cases and the persona body adds phase-specific nuance.

9. **Resume mid-DEFINE: replay the conversation or restart?**
   Lean: restart. v0.1 idempotent gate writes (M3) handle resume after DEFINE completes; mid-conversation resume is W2+ scope. Document the limitation in DEFINE phase code: terminal death mid-conversation requires `code-oz run` from a fresh state.
   Counter: replaying the conversation from `events.jsonl` (each user input + each persona response logged as new event types) is the "right" v0.1 answer. But it expands M5 scope into event-schema work; defer.

These nine prompts are the substance of `CODEX_BRIEFING_M5.md`. Add them; the planning round adds verdicts.

## Cross-cutting addendum from M4 (2026-04-29)

M4 locked five decisions that directly affect M5. Fold them into the M5 design before the planning round; do not re-debate.

1. **Short-lock pattern is the canonical wrapper-layer discipline.** Every code-oz module that talks to a provider goes through `invokeAgent(ctx, req)` from `src/providers/invoke.ts`. The pattern: short pre-call lock (read events + budget check + append agent_invoked) → unlocked adapter stream → short post-call lock (append agent_completed OR write NEEDS_INTERVENTION + intervention). M5's DEFINE phase logic must NEVER bypass invokeAgent and call adapters directly.

2. **ProviderFamily is the cross-family authority.** REVIEW orchestration (M5+) compares `registry.familyOf(buildProvider) !== registry.familyOf(reviewer.provider)` via the registry, never `provider !== other.provider`. M5 doesn't fire the REVIEW gate yet (M7 does), but persona-pair design choices should already respect family-awareness: the `ba` persona uses `provider: claude`, the `reviewer` persona uses `provider: codex`, and the family check is computed at call time, not at agent-load.

3. **agent_invoked events ALWAYS carry the four metrics.** When M5 phase logic constructs a `ProviderRequest` for the ask-me loop, it passes paths-only; the wrapper computes `filesSent` / `bytesSent` / `tokensEstimate` / `fieldsRemovedByScope`. M5 phase logic just needs to populate `droppedFields: string[]` on each `ProviderFileRef` when it intentionally narrows the manifest (e.g., omitting low-relevance fields from a persona body for the ask-me prompt). The wrapper sums these into `fieldsRemovedByScope`.

4. **Conservative token estimator is the single shared estimator.** M5+ phase logic that needs to estimate prompt cost uses `estimateTokens` from `src/providers/cost.ts` (~4 chars/token upper bound). Per-provider overrides land later (W3+) without changing this contract.

5. **Codex stays subprocess-backed in v0.1.** The W3 milestone may add HTTP-based adapters (opencode-style OAuth+PKCE for Codex) per `docs/design/CODEX_RESPONSE_M4_ADAPTERS.md`, but M5 does not need to anticipate the upgrade. The IAgentProvider contract is stable across both shapes; M5's REVIEW persona just declares `provider: codex` and the registry routes correctly.

**Authority:** if any M5 prompt above conflicts with this addendum, the addendum wins (it is the more recent locked decision). If the M5 planning round wants to challenge an addendum item, do it explicitly in `CODEX_BRIEFING_M5.md` with a citation to the source M4 doc so the cross-reference is auditable.

## Cross-model peer review (rules 7–10 in CLAUDE.md, non-negotiable)

Same process as M2/M3/M4 — `gpt-5.5` at `xhigh` effort, `sandbox: read-only`, via `mcp__plugin_agent-codex_codex-native__codex`. See [`docs/design/SESSION_CYCLE.md`](./SESSION_CYCLE.md) phase 2 for the full ritual. M4 needed two Codex rounds (planning + impl review + re-review); M5 should expect at least one re-review given the persona-driven loop is novel surface.

## Don't

- Don't bypass the Codex rounds. The rule is durable, not optional.
- Don't push to `main` without a tag.
- Don't push to `origin` without explicit user approval.
- Don't implement M6+ scope (PLAN phase, source verification, BUILD/VERIFY/REVIEW machinery, worktrees).
- Don't bypass `invokeAgent` and call adapters directly.
- Don't write SPEC.md from inside the persona prompt (orchestrator is the only writer).
- Don't use `git add -A` or `git add .` — stage specific files.
- Don't `git commit --amend` — global rule requires new commits for fixes.
- **Don't carry tech debt across the milestone tag.** Per `feedback_no_tech_debt.md`: close every Codex review finding except `nit`/`fyi` before tag. M3 closed 7 in-milestone, M4 closed 6 in-milestone — same bar for M5.

## First commands to run

```bash
cd ~/Projects/code-oz
git status                       # confirm clean tree on main
git log --oneline -5             # confirm v0.4.0-alpha.0 is HEAD
bun test                         # confirm 391/391 still pass
bun run dev --version            # should report 0.4.0-alpha.0
bun run dev doctor providers     # claude + codex should show authStatus=ok
git switch -c feat/m5-define     # only after planning + Codex debate approved
```

Resume reading from `CLAUDE.md` rules 1, 2, 3, 4, 9, 13 (file-based gates, cross-family REVIEW, 3-source verification — relevant for M6 but worth knowing now, Opus default, permission manifests, privacy / file-manifest discipline), `docs/references/file-based-gates.md` § 4 (canonical phase → artifact map), and `docs/design/ROADMAP.md` § M5.

## Loose threads from M4 to remember

These are noted in commit messages but worth surfacing here so the M5 session catches them:

- **`runDoctorProviders` is the library entry point; `doctorCommand` is the CLI shim.** M5+ commands that want to inspect provider health programmatically should call `runDoctorProviders({ cwd })` and inspect the report — never spawn `code-oz doctor providers` as a subprocess from inside code-oz itself.
- **Wrapper invokeAgent is a generator.** Phase logic consumes via `for await (const ev of invokeAgent(ctx, req))`. The wrapper yields ProviderEvent variants in order; phase logic decides what to do with each (typically: collect content from `content_chunk` + `turn_completed`, surface `tool_call` events for orchestration, treat `turn_completed` as "ready to evaluate"). If a phase needs the final response only, use `collectProviderResponse()` from `src/providers/fake.ts` (despite living in fake.ts, the helper is provider-agnostic; if more callers emerge, move it to a shared module).
- **InvokeContext requires `projectRoot`.** When phase logic constructs the InvokeContext, it must supply `projectRoot` (the project root used by `buildManifest` for path-safety checks). M5+ phase code typically resolves this from `bootstrap()`'s `cwd` or `paths.root`. The wrapper rejects manifest paths outside this root via realpath check.
- **Subprocess adapters spawn from empty temp cwd; this is a hard privacy guarantee.** M5 phase logic that constructs ProviderRequests must NOT assume the adapter will see project files implicitly. Every file the persona needs goes through `req.files` (paths-only); the wrapper loads the bytes after permissions intersection.
- **`fieldsRemovedByScope` is M5 phase logic's responsibility.** When the M5 ask-me orchestrator narrows the manifest sent to the BA persona (e.g., omitting fields from the persona's own body to reduce prompt size), it records the count via `ProviderFileRef.droppedFields`. The wrapper sums into `agent_invoked.fieldsRemovedByScope`. Currently zero across all M4 callers (no narrowing happens yet); M5 is when this metric starts moving.
- **`ConfigLoadError` is exported from `src/config/load.ts`** but not from a top-level barrel — M5 commands that load config will need to import directly. Consider a `src/config/index.ts` re-export if more callers emerge.
- **`PKG_VERSION` is exported from `src/cli.ts`** as of M4 commit 6404c00 (was const-internal until then). The version-consistency test asserts package.json.version === PKG_VERSION === DEFAULT_CONFIG.version. M5 doesn't need to bump versions until tag time.
- **`invokeAgent` re-throws ProviderError after writing NEEDS_INTERVENTION + intervention.** Callers catch and decide whether to surface to the user or retry. M5's ask-me loop should catch ProviderError on each turn and either (a) report to the user and exit, or (b) retry once with a more constrained prompt — TBD in the planning round.
- **`requestReview` does NOT swallow its own ProviderError.** When `requestReview` throws `provider_permissions_violation` (same-family REVIEW), the orchestrator catches and surfaces as an orchestration bug, not a provider failure. M5 doesn't fire REVIEW yet (M7 does), but the contract is locked.

## Estimated session shape (rough planning, not commitments)

Based on M2/M3/M4 actuals:

- ~30 min: read kickoff + references, refine the 9 prompts
- ~5 min: invoke Codex planning round
- ~20 min: synthesize the response, present to Ozzy for approval
- ~3.5–5 hours: implement 7–10 atomic commits per the synthesized plan
- ~10 min: Codex implementation review
- ~30–60 min: address any block-push and block-next-milestone findings (no tech debt rule)
- ~5 min: re-review (possibly two rounds)
- ~10 min: merge, tag `v0.5.0-alpha.0`
- ~5 min: push + release (after Ozzy explicit approval)

Likely shorter than M4 because:
- Surface area is narrower (one phase + one artifact + one set of prompts vs. four adapters + wrapper + tools + commands)
- The wrapper, registry, and gate writers already exist — M5 plugs into them
- No subprocess management; no OAuth model decisions

Possibly longer than expected because:
- Persona-driven ask-me loop is novel UX surface (not directly borrowed from a single template)
- Snapshot testing strategy needs to be flexible enough to survive prompt iteration
- Common Rationalizations table needs first-pass content
