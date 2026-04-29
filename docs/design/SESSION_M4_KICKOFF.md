# code-oz — M4 session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else. The non-negotiable rules in there override anything that conflicts in this kickoff.

## State at start of M4

- **Repo:** `github.com/omerakben/code-oz`, branch `main`
- **Last release:** `v0.3.0-alpha.0` (M3 — phase machine + event log + gate writers)
- **Tests:** 266 passing, offline, ~690ms
- **Binary:** `bun run build:binary` produces `dist/code-oz` (~61 MB), reports `0.3.0-alpha.0`
- **What works:**
  - `code-oz init` scaffolds `.code-oz/` with greenfield/brownfield detection (M1)
  - `src/agents/` parses, validates, loads, and registers agent files; bundled defaults wired via Bun asset imports; cross-family REVIEW enforcement live at agent-load time (M2)
  - `src/state/` machinery: typed phase machine, append-only event log with per-event fsync and mkdir-locks, atomic gate writers with sha256 integrity binding and path safety, run-level orchestration with cross-file recovery, single-active-run pointer with dedicated lock (M3)
  - `code-oz approve [PHASE]` writes a success gate, emits the layered transition events, rebuilds `current.json`, all under one per-run lock acquisition (M3)
  - `src/cli/bootstrap.ts` keeps the bundled-defaults asset imports alive in the compiled binary
- **What's still stubbed:** `code-oz run` and `code-oz doctor` exit non-zero pointing at this milestone (run is M5; M4 fills `doctor providers`).

## Template references (read-only via `/add-dir`)

M4 borrows patterns from `pi-mono` (streaming event model + multi-provider abstraction), `Archon` (IAgentProvider interface shape + worktree-per-run discipline), and `Auto-claude-code-research-in-sleep` (cross-family review + Reviewer Memory + bounded retry loop). **Code stays referenced; specs get pinned.**

**Pinned canonical specs (read these first):**

- [`docs/references/file-based-gates.md`](../references/file-based-gates.md) — gate-class taxonomy and the `NEEDS_INTERVENTION.json` schema. Load-bearing for M4 because every provider failure (auth missing, rate limit, malformed response, budget exceeded) becomes a NEEDS_INTERVENTION gate, not an opaque SDK stack trace.
- [`docs/references/agent-skill-format.md`](../references/agent-skill-format.md) — especially the **"Permissions semantics: upper bound, not glob expansion"** section. M4 enforces this contract: every file in the manifest sent to a provider must be allowed by the agent's `permissions.read`. The runtime check is M4's responsibility; M3 designed the audit-trail slot (`agent_invoked.manifest`) for it.

**M4 will likely create one new pinned reference:** `docs/references/provider-contract.md` (the IAgentProvider interface, ProviderRegistry, ProviderHealth, and the `requestReview` primitive). Decide during planning whether the reference is worth pinning before code or can be deferred to commit 8 of M4 (mirrors M3's commit 1 spec amendment vs. commit 9 user-facing doc).

**Live templates (read-only, `/add-dir` only when you need an example beyond the pinned specs):**

- `~/Projects/agents/templates/pi-mono` — streaming event model, multi-provider abstraction. Useful files: any provider/adapter modules — borrow shape, not code.
- `~/Projects/agents/templates/Archon` — `IAgentProvider`-style interface and worktree-per-run isolation. Useful for the function-like provider shape (no shared mutable state, each call self-contained).
- `~/Projects/agents/templates/Auto-claude-code-research-in-sleep` — cross-family review structure, Reviewer Memory pattern, bounded retry-loop with score≥6 + verdict=ready exit. M4 implements `requestReview` primitive only; broader Reviewer Memory is v0.3+.

**Rules for using templates** (carried over from M2/M3):

1. Open via `/add-dir <path>`. Do not `cp`, do not symlink, do not add as a submodule.
2. Do not modify the upstream — those are different git repos with their own drift.
3. If you discover a contract worth pinning that isn't in the references docs yet, **extract it into `docs/references/` in the same commit.** Do not let the kickoff cite live template files for canonical decisions.

## Deep-dive: what each template contributes to M4

(Pre-extracted by the prior session so M4 doesn't re-discover.)

| Template pattern | M4 adopts directly | M4 extends |
|---|---|---|
| `pi-mono` streaming events | Streaming `IAgentProvider.invoke()` — yields `agent_invoked` / chunked output / `agent_completed` events | Streams are typed against M3's `PhaseEvent` union; FakeProvider replays canned sequences |
| `pi-mono` multi-provider abstraction | Single `IAgentProvider` interface; `claude.ts`, `codex.ts`, `gemini.ts` are concrete impls behind a `ProviderRegistry` | `provider` field in agent frontmatter is the registry key; runtime never imports adapters by name |
| `Archon` function-like provider shape | Stateless adapters; each `invoke()` call reads OAuth token fresh, builds the request, returns a stream | code-oz adds a wrapper layer (permissions check + cost budgets + manifest hashing) above the raw adapter |
| `Auto-claude-code` cross-family review | `requestReview({ reviewer, files, question })` enforces reviewer.provider !== buildAgent.provider | Enforcement lives in `src/tools/review-request.ts`, not inside any single adapter; uses M3's `agent_invoked.manifest` shape |
| `Auto-claude-code` bounded retry | M4 designs the `maxReviewRounds` config slot; M7 wires the actual loop | Hard cap of 4, exit on score≥6 + verdict=ready (per non-negotiable rule 6) |

The columns matter: M4 inherits the **discipline** from these templates (stateless adapters, registry indirection, narrow cross-family primitive) and **departs** on the wrapper-layer pattern (permissions + cost + manifest are not the adapter's responsibility).

## Your task — M4: provider contract + FakeProvider + Claude/Codex/Gemini adapters

Canonical scope: `docs/design/ROADMAP.md` § M4. ADR alignment: `docs/adr/0001-mvp-option-e.md` refinement #1 ("FakeProvider ships on day 1 alongside ClaudeProvider").

**Files to create (per the ROADMAP):**

```text
src/providers/
  types.ts             # IAgentProvider interface + ProviderId types + ProviderHealth
  fake.ts              # FakeProvider — deterministic, offline; scripted expectations
  claude.ts            # ClaudeProvider — CLI OAuth at ~/.claude/auth.json
  codex.ts             # CodexProvider — CLI OAuth at ~/.codex/auth.json
  gemini.ts            # GeminiProvider — stub behind experimental: true flag
  registry.ts          # ProviderRegistry — typed lookup by ProviderId
  health.ts            # health checks per provider; aggregate runner
src/tools/
  review-request.ts    # requestReview({ reviewer, files, question }); cross-family enforced
src/commands/
  doctor.ts            # `code-oz doctor providers` becomes real (was stub since M1)
tests/
  provider-contract.test.ts
  provider-health.test.ts
  providers-fake.test.ts
  providers-claude.test.ts        # mocked auth file
  providers-codex.test.ts         # mocked auth file
  tools-review-request.test.ts
docs/contracts/
  PROVIDERS.md                    # user-facing summary
```

Plus, almost certainly:

- `src/providers/permissions.ts` — the wrapper-layer check that every file in the manifest matches the agent's `permissions.read` upper bound (load-bearing for non-negotiable rule 13).
- `src/providers/cost.ts` — the wrapper-layer pre-call check that the next call won't exceed `maxTurns` / `maxProviderCalls` / `maxTokensEstimate`. Reads running totals from `events.jsonl`. Refusal becomes `NEEDS_INTERVENTION` with `actionableSuggestions`.
- `tests/providers-permissions.test.ts`
- `tests/providers-cost.test.ts`
- A new pinned reference `docs/references/provider-contract.md` if the planning round decides the contract is durable enough to lock before code.

**Acceptance criteria (from the ROADMAP):**

- `FakeProvider` runs the whole lifecycle offline. Every spine test (M5–M7) uses `FakeProvider` by default; live-provider tests are opt-in only and gated behind env flags.
- Real adapters fail with actionable `NEEDS_INTERVENTION.json` if auth is missing — never an opaque SDK stack trace. The `code` field is machine-readable (`provider_auth_missing`, `provider_rate_limit`, `provider_budget_exceeded`, `provider_malformed_response`, etc.); `actionableSuggestions` always includes a concrete shell command.
- `consult()` is **deliberately not added** in v0.1. Only `requestReview()` is callable, and only from REVIEW gate orchestration. Broad consult ships in v0.3.
- Cross-family enforcement: `requestReview` rejects `reviewer.provider === buildAgent.provider` before invoking. Test fixture: builder=claude + reviewer=claude must fail; builder=claude + reviewer=codex must succeed.
- `code-oz doctor providers` returns structured per-provider health: each row reports `{ provider, authStatus, modelDefaultAvailable, latencyMs?, lastError? }`. Failed health checks do not crash the command — they aggregate.
- M3's `agent_invoked.manifest` slot is populated with real `{ path, sha256, sizeBytes }` entries by M4's wrapper layer.
- Permissions check happens in the wrapper: every file in the manifest must match `agent.permissions.read`. A file outside the upper bound surfaces a typed error (`provider_permissions_violation`) and refuses the call.
- Cost-budget pre-call check: refusal produces `NEEDS_INTERVENTION` with `code: 'provider_budget_exceeded'` and an `actionableSuggestions` field naming the budget that would be exceeded and how to raise it.
- `bun test` passes offline (FakeProvider only; no network for the test suite). `bun run typecheck` clean. M1+M2+M3 regression suites stay green (266 tests pre-M4 → ~340 post-M4 estimate).

**What's NOT in M4:**

- DEFINE phase implementation (M5). M4 leaves a clean integration point — any phase logic can call `provider.invoke({ agent, manifest, prompt })` — but the BA persona's ask-me flow doesn't land here.
- PLAN phase machinery and SOURCE_CHECK contract (M6).
- BUILD-lite, VERIFY-lite, REVIEW-lite phase implementations (M7). M4 ships the `requestReview` primitive but doesn't wire the bounded retry loop yet.
- Worktree creation and patch application (M7).
- Persona files for `ship` and `audit` phases. M2 shipped 5 personas (ba, lead, builder, verifier, reviewer); M5+/W4 add the rest. M4 doesn't add personas; it adds the providers those personas will eventually invoke.
- Streaming UI (a future TUI consumes the event stream; M4 just produces it).

## Open design questions (input for `CODEX_BRIEFING_M4.md`)

These are the high-leverage decisions the planning round must converge on. Each is structured the same way as M2/M3: **lean + reasoning + counter-argument I'm aware of**.

1. **`IAgentProvider.invoke()` shape: streaming events or batch response?**
   Lean: streaming. Yields a typed event sequence (turn_started, content_chunk, tool_call, tool_result, turn_completed). Claude SDK is stream-native; Codex too. FakeProvider emits canned sequences. Aligns with M3's event-log discipline.
   Counter: stream complexity for v0.1. A batch shape (one Promise resolves to the full response) is far simpler to mock and write tests against. Streaming can be retrofitted in v0.2 when a TUI needs it.

2. **OAuth token reading: read on every call, or cache with mtime invalidation?**
   Lean: read on every call. Simple, no staleness, no cache-invalidation bugs. ~10ms file IO per call is acceptable at v0.1 turn counts.
   Counter: long-running phases (BUILD-lite in M7) may issue dozens of calls; the cumulative IO matters. Cache with `fs.stat(mtime)` invalidation is straightforward.

3. **Manifest assembly: provider computes sha256+sizeBytes, or caller pre-computes?**
   Lean: caller (the wrapper layer) pre-computes. The phase logic that decides what to send already has the file content in memory; computing the hash there avoids re-reading.
   Counter: ergonomic to put it in the provider — every adapter would do the same hash computation otherwise. But a shared helper in `providers/permissions.ts` or `providers/manifest.ts` resolves that without coupling adapters.

4. **Permissions check location: in the provider, or in a wrapper layer above the providers?**
   Lean: wrapper layer (`src/providers/permissions.ts`). Every adapter gets the same check via a shared `withPermissionsCheck(agent, manifest, fn)` wrapper. No risk of one adapter forgetting. Mirrors M3's run.ts wrapping gates+events under one lock.
   Counter: providers see the API key and the actual request — they could reject more efficiently. But the file-list check happens before the API call anyway; wrapper is the right place.

5. **NEEDS_INTERVENTION discipline: provider throws typed error → wrapper writes the gate file. Or: provider writes the gate directly.**
   Lean: typed error + wrapper writes. Adapter throws `ProviderError({ code, rule, detail, actionableSuggestions })`; the wrapper catches and writes `NEEDS_INTERVENTION.json`. Adapter focuses on talking to LLMs; gate-writing is uniform across providers.
   Counter: providers know more about their failure modes (rate limits with retry-after, malformed responses with specific parsing context). But that information goes into the typed error's `detail` field — no information lost.

6. **`FakeProvider` determinism: scripted expectations, or pure function on input?**
   Lean: scripted with deterministic-default fall-through. Tests register expectations: `fake.expect({ phase: 'define', agent: 'ba' }).respondWith('canned output')`. Untestered combos return a default `{ ok: true, content: 'fake response' }`. Lets specific tests be precise without forcing every test to set up every call.
   Counter: pure (input → output deterministic by hash) makes broader integration tests easier to author. But pure is less expressive — tests can't easily simulate "first call returns retry-required, second call succeeds."

7. **Cross-family enforcement location: at provider call time, or at orchestrator/run.ts time?**
   Lean: orchestrator-level check in `src/tools/review-request.ts`. The review-request tool reads the build agent's provider from event log + the reviewer agent's provider from the registry, compares families, refuses if equal. Provider doesn't know about families.
   Counter: providers have the family info implicitly (claude.ts is family=claude). They could enforce internally. But that scatters the rule across adapters — easier to keep it in one place.

8. **Cost-budget enforcement: pre-call (refuses calls that would exceed budget) or post-call (records and surfaces breach later)?**
   Lean: pre-call. Wrapper reads running totals from `events.jsonl` (sum of `agent_completed.tokensUsed`), estimates the next call's cost (rough heuristic per provider), refuses if it would exceed the configured budget. Refusal becomes `NEEDS_INTERVENTION` with `code: 'provider_budget_exceeded'`.
   Counter: pre-call estimates are imprecise (we don't know output token count until after). Post-call accounting with a soft warning at 80% of budget is friendlier UX. But hard cap > soft warning when the user is paying real money.

9. **`GeminiProvider` stub contract: throw `not_yet_supported`, or accept `experimental: true` and execute via Gemini SDK?**
   Lean: throw `provider_gemini_not_yet_supported` from `gemini.ts.invoke()`. The `experimental: true` flag in agent frontmatter prevents loader-level rejection but doesn't unlock the adapter. Honest stub.
   Counter: `experimental: true` could mean "I accept the risk — try it." A real attempt with the Gemini SDK gives users a path forward. But the SDK isn't audited, no NEEDS_INTERVENTION discipline on its errors, and we'd be supporting a half-working surface. Stub is honest; flip to real adapter in W3.

These nine prompts are the substance of `CODEX_BRIEFING_M4.md`. Add them; the planning round adds verdicts.

## Cross-cutting addendum from `CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md` (2026-04-29)

A separate forward-looking design round happened just before M4 kickoff: planning + memory borrow strategy from two new templates (`agentic-canvas`, `Mimir`). The synthesis is locked in [`CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md`](./CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md). Three decisions from that round directly affect M4 — fold them into the M4 design before the planning round, do not re-debate.

1. **Context metrics on `agent_invoked` events.** The wrapper layer must record per-call telemetry that proves the manifest narrowing is doing real work. Extend the existing `agent_invoked.manifest` shape (or add sibling fields on the event) with:
   - `filesSent: number` — count of files in the manifest sent to the provider
   - `bytesSent: number` — total content bytes across the manifest
   - `tokensEstimate: number` — wrapper-layer token estimate (the same heuristic used by the cost-budget pre-call check)
   - `fieldsRemovedByScope: number` — count of fields the phase-owned manifest builder dropped relative to the upper-bound `permissions.read` (zero if no narrowing happened)

   Surface in `code-oz status` only when verbose. Validator in `src/state/events.ts` must accept these as required-when-`agent_invoked` (not optional) so the audit trail is complete from M4 onward.

2. **No `contextScope` field in agent frontmatter.** The synthesis explicitly rejected user-editable persona-level context narrowing. Scope enforcement happens in code: M4 ships a **provider-request DTO + phase-owned manifest builders** (per phase, per persona pair) that intersect the explicit phase logic with `permissions.read` (upper bound). Persona files describe identity, not runtime narrowing. Do not add a `contextScope` block to `src/agents/schema.ts`. The narrowing-evidence is the `fieldsRemovedByScope` metric on `agent_invoked` (item 1), not a frontmatter declaration.

3. **Tool-call circuit-breaker is config-only, not PLAN-encoded.** The pre-call cost-budget check (M4 prompt 8) is the **only** place a multiplier lives. Read it from `.code-oz/config.yaml` (`maxToolCallsPerTurn`, optional `toolCallBudgetMultiplier`). PLAN.md tasks (M6) will carry an advisory `estimatedToolCalls` field but the runtime ignores it for budget enforcement — the cap is policy, not per-task estimate. (Mimir contradicts itself between 1.5x in its docs and 10x in `task-executor.ts`; we don't inherit either number — we pick our own at config-load time.)

Items 4–10 from the synthesis affect M5+/M6/M7/W3/v0.3+ and are out of scope for M4. Two are worth keeping in mind so M4's design doesn't paint future milestones into a corner:

- M7 will add a `failure_recorded` event type. M4's event-schema validator must already tolerate unknown event types via the existing `version: 1` versioning rule (no allow-list of types). Confirm during planning that the validator doesn't lock the type union.
- W3+ may add a project memory directory at `.code-oz/memory/project/`. M4 doesn't need to reserve the path, but the `.gitignore` policy in M4's tests should not write rules that would later block memory files.

**Authority:** if any M4 prompt above conflicts with this addendum, the addendum wins (it is the more recent locked decision). If the M4 planning round wants to challenge an addendum item, do it explicitly in `CODEX_BRIEFING_M4.md` with a citation to `CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md` so the cross-reference is auditable.

## Cross-model peer review (rules 7–10 in CLAUDE.md, non-negotiable)

Same process as M2/M3 — `gpt-5.5` at `xhigh` effort, `sandbox: read-only`, via `mcp__plugin_agent-codex_codex-native__codex`. Three rounds (planning + implementation + re-review) is the M3 pattern; M4 should expect at least one re-review cycle given the surface area is comparable.

### Step 1 — Planning (before any code)

1. Read `CLAUDE.md`, `docs/design/ROADMAP.md` § M4, `docs/adr/0001-mvp-option-e.md`, `docs/references/file-based-gates.md` (the NEEDS_INTERVENTION schema), `docs/references/agent-skill-format.md` (the permissions semantics section).
2. Sketch the M4 design (provider interface, wrapper layer, FakeProvider scripting API, OAuth file format expectations, cost-budget pre-call check, requestReview shape, doctor command structure, fixture strategy, test plan).
3. Write `docs/design/CODEX_BRIEFING_M4.md` with the nine debate prompts above plus any new ones the design surfaces.
4. Invoke Codex:
   ```
   mcp__plugin_agent-codex_codex-native__codex(
     model: 'gpt-5.5',
     config: { model_reasoning_effort: 'xhigh' },
     sandbox: 'read-only',
     approval-policy: 'never',
     cwd: '/Users/ozzy-mac/Projects/code-oz',
     prompt: '<the briefing path + structured response request>',
   )
   ```
   Capture Codex's reply, save as `docs/design/CODEX_RESPONSE_M4.md`.
5. Synthesize. Append the synthesis to the response file (mirrors M2/M3 pattern). Present to Ozzy. **Do not start coding until Ozzy approves the synthesis.**

### Step 2 — Implementation

1. Create branch `feat/m4-providers` from `main`.
2. Implement per the synthesized plan in atomic commits (M2 had 7, M3 had 10 base + 4 review-fix; M4 likely 8–10 base + 2–4 review-fix).
3. `bun test` and `bun run typecheck` clean before each commit.
4. Don't expand scope: M5 (DEFINE), M6 (PLAN), M7 (BUILD/VERIFY/REVIEW machinery) are not in M4.

### Step 3 — Codex review

1. Once tests pass and typecheck is clean, invoke Codex review with `sandbox: read-only` against the new commits.
2. Codex returns one of `push` / `fix-first` / `debate-required`.
3. **Per the durable rule (`feedback_no_tech_debt.md`): all `block-push` AND `block-next-milestone` findings get addressed in the same milestone before tag, never deferred.** Only `nit` and `fyi` severity findings can defer without explicit approval.
4. Re-review on the fix commits.

### Step 4 — Tag and push (after Ozzy explicit approval)

1. Merge `feat/m4-providers` to `main` with `--no-ff`.
2. Tag `v0.4.0-alpha.0` with annotated message + Codex audit trail link.
3. Push main and tag (only after explicit user approval).
4. `gh release create v0.4.0-alpha.0` with M4-themed release notes.

## Don't

- Don't bypass the Codex rounds. The rule is durable, not optional.
- Don't push to `main` without a tag.
- Don't push to `origin` without explicit user approval.
- Don't implement M5+ scope (DEFINE/PLAN/BUILD phase machinery, `consult()`, worktrees).
- Don't add Gemini support beyond the stub. The frontmatter rejection rule and the stub adapter are the v0.1 contract.
- Don't write provider stubs that silently succeed on auth failure. Provider failures become `NEEDS_INTERVENTION.json` with `actionableSuggestions`, period.
- Don't put the permissions check inside individual adapters. Wrapper layer only — closes the audit-trail loop M3 designed for.
- Don't put cost-budget enforcement post-call. Pre-call refusal is the v0.1 contract.
- Don't use `git add -A` or `git add .` — stage specific files.
- Don't `git commit --amend` — global rule requires new commits for fixes.
- **Don't carry tech debt across the milestone tag.** Per `feedback_no_tech_debt.md`: close every Codex review finding except `nit`/`fyi` before tag. M3 closed 7 in-milestone, zero deferred — same bar for M4.

## First commands to run

```bash
cd ~/Projects/code-oz
git status                       # confirm clean tree on main
git log --oneline -5             # confirm v0.3.0-alpha.0 is HEAD
bun test                         # confirm 266/266 still pass
bun run dev --version            # should report 0.3.0-alpha.0
git switch -c feat/m4-providers  # only after planning + Codex debate approved
```

Resume reading from `CLAUDE.md` rules 1, 2, 4, 9, 10, 11, 13 (file-based gates, cross-family REVIEW, Opus default, permission manifests, cost budgets, actionable NEEDS_INTERVENTION, privacy/file-manifest discipline), `docs/references/file-based-gates.md` (the NEEDS_INTERVENTION schema), and `docs/design/ROADMAP.md` § M4.

## Loose threads from M3 to remember

These are noted in commit messages but worth surfacing here so the M4 session catches them:

- **`agent_invoked.manifest` slot is ready, M4 populates it.** M3 designed the typed shape `{ files: { path, sha256, sizeBytes }[] }` in `src/state/schemas.ts` and validated it strictly in `src/state/events.ts`. M4's wrapper layer computes the hashes and sizes when assembling the manifest before each `provider.invoke()`. The audit trail Codex insisted on in M3 review #3 (block-m3 finding on permissions-as-upper-bound) becomes real in M4.
- **Cost budget enforcement is M4's responsibility (rule 10).** Config keys (`maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxReviewRounds`) exist in `src/config/schema.ts` since M1 but aren't enforced anywhere yet. M4's wrapper-layer pre-call check is where they get teeth. Refusal must be a typed `NEEDS_INTERVENTION` gate, not a thrown JS Error.
- **Persona-phase coverage gap.** M2 shipped 5 personas (ba, lead, builder, verifier, reviewer) for define/plan/build/verify/review. `ship` and `audit` have no bundled personas; `code-oz approve` for those phases currently fails with "no agent registered." M4 doesn't fix this — M5+/W4 do. Test fixtures should stick to the 5 supported phases.
- **fyi from M3 final Codex review (non-blocking):** the global mixed-run-runId invariant in `validateRunIntegrity` runs after `completeIncompleteTransitions` in `loadRun`. A pre-existing malicious `gate_written` event with a foreign runId is still rejected before `reduceEvents` and `current.json` rebuild — so it never silently advances the run. But the recovery step would have appended its transition events first. M4 doesn't extend `loadRun`'s recovery surface, so the issue stays scoped to v0.1's tolerance window. Worth keeping in mind if M5+ ever changes recovery ordering.
- **`code-oz doctor` becomes real in M4.** Since M1 it's been a stub that exits non-zero. M4's `src/commands/doctor.ts` wires `code-oz doctor providers` to the per-provider health checks. Update the help text in `src/cli.ts` accordingly.
- **`requestReview` is the only cross-provider primitive in v0.1.** The synthesis (`docs/design/CODEX_RESPONSE.md`) explicitly chose this over the broader `consult()`. Keep that scope locked. v0.3 may add `consult()` if there's evidence the narrow primitive is insufficient.

## Estimated session shape (rough planning, not commitments)

Based on M2 and M3 actuals:

- ~30 min: read kickoff + references, refine the 9 prompts
- ~5 min: invoke Codex planning round
- ~20 min: synthesize the response, present to Ozzy for approval
- ~3.5–5 hours: implement 8–10 atomic commits per the synthesized plan
- ~10 min: Codex implementation review
- ~30–60 min: address any block-push and block-next-milestone findings (no tech debt rule)
- ~5 min: re-review (possibly two rounds)
- ~10 min: merge, tag `v0.4.0-alpha.0`
- ~5 min: push + release (after Ozzy explicit approval)

Slightly longer than M3 because:
- More distinct surfaces (provider abstraction + wrapper layer + 4 adapters + tools/review-request + doctor command)
- OAuth handling has more edge cases than gate file IO
- Cost-budget logic is novel work without a strong upstream reference

Slightly shorter than M3 might be because:
- The patterns are now familiar (typed errors with issue arrays, atomic writes with temp+rename, mkdir-locks, hand-rolled validators)
- M3's run.ts is the integration point M4 plugs into — no new orchestration to design
