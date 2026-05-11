---
template: opencode
location: ~/Projects/agents/templates/opencode
session: 11
date: 2026-05-10
codeoz-version: v0.17.0-alpha.0 (M16 closed, 3108 tests)
opencode-version: install script targets 1.0.180 (Bun monorepo, 21+ providers, 323 test files)
verdict: YES — selective borrows; code-oz is ahead on the SDLC-runtime axis, opencode is ahead on substrate craft
codex-debate: pending (CODEX_BRIEFING.md → CODEX_RESPONSE.md)
---

# Code-oz vs opencode

## TL;DR

The two projects are **peers in substrate, not in product**. opencode is an interactive coding-assistant CLI in the same product category as Claude Code itself: one agent, one session, one chat surface, multiple deployment shells (TUI, desktop, web, Slack). It ships 21+ provider integrations through the Vercel `ai` SDK, an Effect-typed orchestration layer, a wildcard-matched permission grammar, and a working MCP consumer. It does **not** model phases, gates, cross-family review, debate, hard cost caps, or epistemic sidecars.

code-oz is an opinionated SDLC runtime. The product is the discipline pipeline: DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP, file-based gates, 3-source verification, cross-family panel review (M14), debate-policy scheduler (M15), role-cost budgets (M13), Scientist tails. We use opencode's substrate-quality choices as a reference for the parts of code-oz that are *not* the discipline pipeline — provider HTTP fixtures, MCP consumer scaffolding, install ergonomics, permission expression power.

**Decision: YES — selective borrows.** Five borrow candidates B1–B5 (one milestone each, ordered by leverage), three explicit no-borrows N1–N3, and one product-axis assertion code-oz keeps as differentiator (file-based SDLC discipline). All borrows respect rule 20 (one new authority boundary per milestone) and rule 21 (no parallel-provider surface without measurable risk reduction).

---

## 1. What opencode is (factual)

opencode is a Bun monorepo. The runtime CLI lives in `packages/opencode/` and `packages/llm/`. The remaining `packages/*` are deployment surfaces (`app`, `web`, `desktop`, `console`, `slack`, `function`) and infrastructure (`enterprise`, `extensions`, `containers`, `identity`, `http-recorder`).

**Provider abstraction (`packages/llm/src/provider.ts`):**

```ts
export type ModelFactory<Options extends ModelOptions = ModelOptions> = (
  id: string | ModelID,
  options?: Options,
) => ModelRef

export interface Definition<Factory extends AnyModelFactory = ModelFactory> {
  readonly id: ProviderID
  readonly model: Factory
  readonly apis?: Record<string, AnyModelFactory>
}
```

Anthropic, OpenAI, xAI, Google, Azure, Bedrock, Cloudflare AI Gateway, GitHub Copilot, OpenRouter, Perplexity, Cohere, Alibaba, Groq, Mistral, TogetherAI, DeepInfra, Cerebras, plus OpenAI-compatible profiles. Auth covers env API keys, OAuth (RFC 7591 dynamic client registration), and GitHub Copilot. **Zero subprocess delegation** — every provider is HTTP/SDK direct.

**Lifecycle (`packages/opencode/src/acp/`):**

`ACPSessionManager` creates and loads sessions; session state is `{ id, cwd, mcpServers, model, createdAt }` persisted in SQLite via Drizzle. There is no formal phase model: a session is a freeform chat loop with persistent state. No DEFINE / PLAN / BUILD / VERIFY / REVIEW / SHIP, no gate files, no SOURCE_CHECK requirement, no Scientist tails.

**Permission model (`packages/opencode/src/permission/evaluate.ts`):**

```ts
export const Action = Schema.Literals(["allow", "deny", "ask"])
export const Rule = Schema.Struct({
  permission: Schema.String,   // "shell" | "read" | "write" | "network" | …
  pattern: Schema.String,      // wildcard pattern
  action: Action,
})

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission)
            && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }   // default: ask
}
```

Two-dimensional matching, last-match-wins, with an `ask` default and a SQLite-backed `PermissionTable` that caches "always" responses across sessions. Rules live in `opencode.json` or in agent definitions.

**MCP (`packages/opencode/src/config/mcp.ts`):**

```ts
export const Local = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.mutable(Schema.Array(Schema.String)),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
  timeout: Schema.optional(PositiveInt),
})

export const Remote = Schema.Struct({
  type: Schema.Literal("remote"),
  url: Schema.String,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])),
  timeout: Schema.optional(PositiveInt),
})
```

Consumer-only. Local stdio servers and remote HTTP servers, with optional OAuth for remotes. Tools are surfaced to the model in `LLMRequest.tools` after session creation.

**Distribution:** the `install` script (461 lines) detects platform variants (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64` with musl/baseline) and patches `~/.zshrc`, `~/.bashrc`, `~/.profile`, `~/.config/fish/config.fish`. The build itself uses a custom `bun run script/build.ts` rather than `bun build --compile`.

**Tests:** 323 `.test.ts` / `.spec.ts` files. The pattern that matters is in `packages/llm/test/`: a `dynamicResponse` / `scriptedResponses` HTTP mock layer plus `recorded-*.ts` files that replay captured provider responses (a VCR pattern). Tool execution is wrapped in `Effect.gen`, so async retries, timeouts, and concurrency limits are typed at the function level.

**Cost / budget:** opencode parses `x-ratelimit-*` (OpenAI) and `anthropic-ratelimit-*` headers and exposes a `max_thinking_budget` knob for Anthropic. There is **no enforcement code** that kills a run when a budget is exceeded — informational tracking only.

**Multi-agent:** none. The `agent.ts` schema has a `mode: "subagent" | "primary" | "all"` classification but no orchestration of multiple agents on a shared artifact, no cross-family review, no debate.

---

## 2. What code-oz is (factual snapshot)

v0.17.0-alpha.0, M16 closed, 3108 tests. `bun build --compile` ships native Mach-O binaries via `scripts/build-binaries.ts` + a manifest-driven `scripts/install.sh` (W3-lite tarball validated 2026-05-02).

**Providers (`src/providers/`):** Claude (subprocess via `claude` CLI, OAuth), Codex (subprocess via `codex` CLI with `--sandbox read-only --ephemeral`, OAuth), XAI (HTTP-direct, `XAI_API_KEY`, OpenAI-compatible subset, strict allowlist), Gemini (stub, refused at invoke), Fake (offline, scripted, 3108 tests).

```ts
// src/providers/types.ts
export interface IAgentProvider {
  readonly id: ProviderId
  readonly family: ProviderFamily
  readonly capability: ProviderCapability
  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent>
  health(): Promise<ProviderHealth>
}
```

**Phase/gate model:** `state/GATE_<PHASE>_PASSED.json` files validated by `src/state/gates.ts`; FSM bookkeeping in `src/state/run.ts`; phases under `src/phases/` (define, plan, build, verify, review + satellites, restart policy, debate scheduler).

**Permissions:** `src/agents/schema.ts` agent frontmatter declares `permissions.read` (file paths) and `permissions.tool_use` (`repo_context`, `execute`). `src/tools/repo-context/permissions.ts` enforces an intersection: request roots ⊆ agent.roots ⊆ permissions.read, with `tool_root_outside_permissions` thrown on violation.

**Budgets (rule 19):** single `budgets.global` namespace; `assertWithinBudget()` in `src/providers/cost.ts` reads cumulative spend from `events.jsonl` per call and pairs `agent_invoked.tokensEstimate` with `agent_completed.tokensUsed`. Soft warnings at `softWarnAtRatio` (default 0.75); hard kills at 1.0; `NEEDS_INTERVENTION.json` carries the actionable suggestion.

**Cross-family review (M14):** `src/phases/review-panel.ts` orchestrates sequential multi-provider voting. Five layers of cross-family defense: config-load + agent loader reject same-family voters; runtime `computeCanonicalPanelVerdict()` requires exactly two eligible cross-family voters for quorum; advisory-only findings cannot gate the verdict without corroboration.

**Debate (M10 + M15):** `src/tools/debate-request.ts` exposes the `requestDebate()` primitive with debate-validator + persona re-invocation under the outer `.review.lock`. M15 scheduler (`src/phases/review-scheduler-hook.ts`) decides post-verdict whether to fire a debate, emits telemetry events, and runs without nested lock acquisition.

**MCP:** documented as W3+ future. **Not wired in v0.17.0-alpha.0.**

---

## 3. Side-by-side mechanic mapping

| Mechanic | opencode | code-oz | Note |
|---|---|---|---|
| Runtime shell | TUI / desktop / web / Slack / CLI | CLI only | code-oz is intentionally headless; opencode wraps a chat experience |
| Provider integration | 21+ via Vercel `ai` SDK, all HTTP | Claude+Codex (subprocess), XAI (HTTP), Gemini stub, Fake | code-oz subprocess choice is a privacy/auth boundary, not a maturity gap |
| Provider capability contract | implicit (each adapter reports what `ai` SDK exposes) | explicit (M11 `ProviderCapability`) | code-oz ahead — capability advertisement gates phase use |
| Auth | API key / OAuth (RFC 7591) / Copilot | OAuth via host CLI (Claude, Codex), env API key (XAI) | parity at the auth-source level; different trust boundary |
| Lifecycle unit | session (chat loop) | run (phased FSM) | different products |
| Phase gates | none | file-based, schema-validated, idempotent | code-oz exclusive |
| 3-source verification | none | required at PLAN gate (`SOURCE_CHECK.md`) | code-oz exclusive |
| Permission grammar | wildcard 2D `(permission, pattern) → allow|deny|ask`, last-match-wins | intersection guarantee on declared roots; no wildcard | opencode more expressive; code-oz more conservative |
| Permission default | `ask` | denied at intersection violation | different threat models |
| Permission cache | SQLite `PermissionTable` (always-allow across sessions) | none — every invocation re-checks intersection | code-oz favors auditability over ergonomics |
| MCP | consumer (local stdio + remote HTTP + OAuth) | not wired (W3+ deferred) | gap; borrow candidate B3 |
| Cross-family review | none | M14 panel, 5-layer defense | code-oz exclusive |
| Debate | none | M10 primitive + M15 scheduler | code-oz exclusive |
| Cost enforcement | soft (header parsing, thinking-budget knob) | hard (`assertWithinBudget` kills mid-run; `NEEDS_INTERVENTION` produced) | code-oz exclusive |
| Role-cost policy | none | M13 `budgets.global.byRole` + per-role event log | code-oz exclusive |
| Scientist tails | none | `HYPOTHESES.md` / `OPEN_QUESTIONS.md` per phase, gate-preflight blocks overdue | code-oz exclusive |
| Async typing | Effect (`Effect<Success, Error>`) at every async boundary | `AsyncIterable<ProviderEvent>` | opencode richer; code-oz simpler |
| Test offline | recorded HTTP fixtures (`packages/llm/test/recorded-*.ts`) + scripted mocks | `FakeProvider` covers full lifecycle (3108 tests) | parity in coverage; opencode richer for HTTP-direct providers |
| Build | custom `bun run script/build.ts` | `bun build --compile` + `scripts/build-binaries.ts` (multi-target) | parity, code-oz simpler |
| Install | 461-line shell script with auto-PATH for zsh/bash/fish/profile | `scripts/install.sh` (manifest-driven, macOS quarantine strip) | opencode richer; borrow candidate B5 |
| Distribution channels | curl-pipe-bash + GitHub releases (per-platform) | local tarball + `~/.local/bin`; npm/brew/scoop deferred to W3+ | parity at v0.17 alpha; W3+ catches up |
| Plugin system | Discord, Slack, GitHub, Codex, Cloudflare, Copilot — first-party | none | not a current need |
| Brownfield | none | `AUDIT` phase + AUDIT.md artifact | code-oz exclusive |
| Anti-slop | none | universal-rules.md imported into every persona prompt (rule 16) | code-oz exclusive |
| Maestro discipline | none | rule 17 — named, authoritative, dossier-anchored | code-oz exclusive |

---

## 4. Where code-oz is already ahead (rule-anchored)

The non-negotiable rules from CLAUDE.md are the score sheet. Mapping each to opencode:

| Rule | Status vs opencode |
|---|---|
| 1. File-based gate signals only | opencode has no gates → code-oz exclusive |
| 2. Cross-family review at REVIEW gate | not present in opencode → code-oz exclusive |
| 3. 3-source verification before code | not present in opencode → code-oz exclusive |
| 4. Opus default + downgrade warning | opencode is provider-agnostic, no opinion on model class → code-oz exclusive (and opinionated) |
| 5. Wave-based execution + grep verification | not present → code-oz exclusive |
| 6. Hard cap on review loops (4 rounds) | no review loop concept → code-oz exclusive |
| 7. Plain-Markdown artifact contracts | opencode persists session state in SQLite via Drizzle → different model |
| 8. FakeProvider offline lifecycle | opencode has recorded fixtures + scripted mocks; covers HTTP-direct providers but not a "full lifecycle" because there is no lifecycle to fake → parity for what each project simulates |
| 9. Permission manifest required for escape-hatch execution | opencode defaults to `ask`, with a SQLite cache that escalates "always-allow" silently → code-oz stricter |
| 10. Cost budgets are config, not vibes | opencode has no enforcement → code-oz exclusive |
| 11. Provider failures → `NEEDS_INTERVENTION.json` | opencode surfaces SDK errors → code-oz exclusive |
| 12. Resume is v0.1 (idempotent gate writes) | opencode resumes via session SQLite restore → different model |
| 13. Privacy by default (`.code-ozignore`, redaction, file manifest) | opencode passes `cwd` and lets the agent walk the tree → code-oz stricter |
| 14. Brownfield AUDIT artifact | not present → code-oz exclusive |
| 15. Epistemic sidecars (Scientist tails) | not present → code-oz exclusive |
| 16. Universal anti-slop rules in every persona | opencode prompts agents directly without a universal rule sheet → code-oz exclusive |
| 17. Maestro discipline named + authoritative | not present → code-oz exclusive |
| 18. Codebase context retrieval has its own permission scope | opencode allows the agent to read freely under `cwd` → code-oz stricter |
| 19. Run-level budget enforcement is mandatory | not present → code-oz exclusive |
| 20. One new authority boundary per milestone | not relevant — opencode has no milestone-discipline concept → code-oz governance exclusive |
| 21. No parallel-provider surface without measurable risk reduction | not relevant → code-oz governance exclusive |

**Score: code-oz alone on 18 of 21 non-negotiable rules.** The three that don't apply (12, 7, 8) are different-model rather than missing-feature gaps.

---

## 5. Borrow candidates

Each entry is one milestone, one new sub-surface, ordered by **leverage / risk** ratio. Risk is measured against rule 20 (one new authority boundary per milestone) and rule 21 (no parallel-provider surface without measurable risk reduction).

### B1. Recorded HTTP fixtures for HTTP-direct providers (high leverage, low risk)

**What.** Adopt opencode's `recorded-*.ts` pattern in `tests/providers/recorded/` so XAI (and the next 1–3 HTTP-direct providers) get deterministic, "live-shape" coverage without burning live API budget.

**Where it would land.** A new `tests/providers/recorded/` directory. The runtime change is small: an HTTP client seam in `src/providers/xai.ts` that swaps to a fixture replayer when `CODE_OZ_REPLAY_FIXTURE` is set. PE-1 already opted into a strict request-body allowlist, which makes fixture matching cleanly hashable.

**Authority surface.** **None new.** This is offline test infrastructure for an existing provider seam. Does not violate rule 20.

**Why now.** PE-1 closed with a single live integration test gated behind two env flags. As PE-2+ adds more HTTP-direct providers, the live-test budget grows linearly and the test surface starts to depend on third-party uptime. Recorded fixtures convert that into a deterministic offline test, with a quarterly re-record cadence to catch shape drift.

**Risk.** Fixture rot if no one re-records. Mitigation: a `bun run record-fixtures` script gated on `CODE_OZ_LIVE_PROVIDER_TESTS=1`, plus a ROADMAP cadence note ("re-record once per Ring").

**Codex pressure point.** Is this premature given only one HTTP-direct provider exists today? Counter: the fixture cost is ~1 hour for XAI; the recorded shape becomes a reference for PE-2 onwards.

### B2. Wildcard permission expressions, *inside* the existing intersection guarantee (medium leverage, medium risk)

**What.** Keep the intersection invariant (request roots ⊆ agent.roots ⊆ permissions.read). Inside `permissions.tool_use.execute` and `permissions.tool_use.repo_context.patterns`, accept wildcard expressions evaluated by a borrowed `Wildcard.match` from opencode. This widens the *expression* power without weakening the *enforcement* model.

**Where it would land.** `src/agents/schema.ts` schema field; `src/tools/repo-context/permissions.ts` evaluator; `src/tools/execute/permissions.ts` evaluator. New tests covering the intersection-vs-wildcard interaction.

**Authority surface.** Refinement of an existing surface (permission enforcement) rather than a new one. Borderline rule-20 — a strict reading would say "permission grammar" is one axis already, and wildcards don't introduce a second. Codex should pressure-test that read.

**Why now.** Agents that need to read multiple file globs under one declared root currently have to enumerate them. Wildcards remove the enumeration tax without changing what's enforceable. opencode's `evaluate.ts` is a 30-line implementation with `findLast` semantics (last-match-wins) — well-bounded.

**Risk.** Wildcard semantics are a foot-gun for `**` traversal. Mitigation: ban `**` outside the leaf segment; require an explicit anchor.

**Codex pressure point.** Is "last-match-wins" the right semantics for code-oz, given our default is deny rather than ask? First-match-deny might be safer in a deny-default world.

### B3. MCP consumer scaffolding (high leverage, high risk under rule 20)

**What.** Wire an MCP consumer that reads `Local` and `Remote` server definitions from `.code-oz/config.yaml`, spawns local stdio servers, and surfaces remote HTTP servers (with optional OAuth) as tools advertised to the agent in the existing `ProviderRequest.tools` shape.

**Where it would land.** New `src/tools/mcp/` directory; new `mcp` field in the config schema; new `tool_use.mcp` permission scope in agent frontmatter; new `mcp_server_invoked` / `mcp_tool_called` events.

**Authority surface.** **A new authority boundary** — MCP is a new tool family with its own permission scope and event types. This is a milestone slot, not a side-quest. Rule 20 says it earns its own milestone.

**Why now.** The Researcher role (rule 17 dossier, future M-tier) needs Sentry / GitHub / web-fetch. Each is an MCP server today. Wiring MCP once, well, is cheaper than coding three bespoke connectors. opencode's `Local` / `Remote` schema is the cleanest reference in the influence library, including OAuth handling.

**Why later.** Post-M16 priority depends on demand. If the next demand checkpoint says "we need Researcher with web fetch," MCP becomes the enabling milestone. If the next checkpoint stays inside the spine, MCP can wait for v0.2.

**Codex pressure point.** Does code-oz's privacy-by-default rule (13) survive wiring a class of tools that, by definition, makes outbound calls? The scope `tool_use.mcp` would have to deny network by default and require explicit allowlist per-server.

### B4. Install script ergonomics (low leverage, near-zero risk)

**What.** Borrow opencode's auto-PATH-patching across `~/.zshrc`, `~/.bashrc`, `~/.profile`, `~/.config/fish/config.fish`. Borrow the platform-detection and quarantine-stripping logic — opencode's variant has been hardened by community use (1.0.180 release tag).

**Where it would land.** `scripts/install.sh`. No runtime change.

**Authority surface.** None. Install ergonomics live entirely outside the spine.

**Why now.** W3 (npm/brew/scoop) hasn't started. The friend-handoff during W3-lite confirmed that a one-shot install is a measurable adoption gate.

**Risk.** Editing user shell rc files is invasive — opencode's pattern is to append a guarded block, not modify existing entries. Mirror that exactly.

**Codex pressure point.** Should we just wait for npm/brew/scoop in W3 instead, since those tools handle PATH for us? Counter: source-of-truth install via `curl | bash` has lower friction than asking adopters to install Node first.

### B5. Provider-error → actionable structured payload (medium leverage, low risk)

**What.** opencode's `ai` SDK responses map cleanly to a typed error shape with provider-specific guidance (token-limit hit, OAuth expired, model not available). Code-oz already wraps provider errors in `NEEDS_INTERVENTION.json` (rule 11) but the *content* of the suggestion is hand-written per call site. Borrow opencode's error-classification table as a reference for filling in actionable suggestions.

**Where it would land.** `src/providers/errors.ts` — a small classification table mapped to suggestion templates. Used by all providers when constructing `NEEDS_INTERVENTION` payloads.

**Authority surface.** None — refinement of an existing rule (11).

**Why now.** v0.17.0-alpha.0 has 1 HTTP-direct provider. Adding the table now is cheap and forces every new HTTP provider (PE-2+) to slot its errors into the table at boot.

**Risk.** Table rot when providers change error shapes. Mitigation: every recorded fixture (B1) for an error response double-validates the table.

---

## 6. Explicit no-borrows

### N1. Effect-typed orchestration

**What opencode has.** Every async boundary in `packages/llm/` and `packages/opencode/` is typed as `Effect<Success, Error>`. Provides fiber-aware concurrency, retry semantics, typed errors, and a single composable seam for testing.

**Why we are not borrowing.** Adopting Effect would be a rewrite of `src/providers/`, `src/phases/`, `src/state/`, and the entire test surface. The current `AsyncIterable<ProviderEvent>` model is small, well-tested, and Bun-idiomatic. The cost of the rewrite is large; the bug class it would close is not visible in our 3108-test surface.

**When we'd revisit.** If a future milestone surfaces a class of async-coordination bug (timeout cascades, retry loops, fiber leaks) that the current model can't model cleanly. Empirical, not aspirational.

### N2. Plugin system (Discord / Slack / GitHub / Cloudflare / Copilot)

**What opencode has.** A `packages/plugin/` directory with first-party plugins for chat surfaces and CI integrations. Each plugin gets a lifecycle hook into the session.

**Why we are not borrowing.** code-oz is a CLI runtime, not a chat-surface platform. The closest analogue we'd want is the Researcher MCP scope (B3) or the future GitHub Actions CI hook (W4+). A plugin loader with lifecycle hooks is a category opencode lives in (chat assistant) and code-oz does not.

**When we'd revisit.** If the demand checkpoint asks for a CI integration that doesn't fit the W4+ Action shape. Unlikely.

### N3. SQLite-persisted session + permission cache

**What opencode has.** Drizzle + SQLite for session state, `PermissionTable` for cached "always-allow" decisions across sessions.

**Why we are not borrowing.** Rule 7 (plain-Markdown artifact contracts) and rule 9 (permission manifest required) are deliberately the opposite of what opencode caches. Persistent session state is the opencode product; idempotent gate files are the code-oz product. Mixing the two would dilute both.

**When we'd revisit.** Never for the spine. A future telemetry layer might use SQLite for query convenience, but that lives outside the gate model.

---

## 7. Milestone insertion recommendation

Under rule 20 (one new authority boundary per milestone) the borrow set maps as:

- **B1 (recorded fixtures).** Fits inside the next PE-tier milestone or a free-floating test-discipline commit. **Not its own milestone.**
- **B2 (wildcard permissions).** Borderline — recommend a single-commit refinement of `src/tools/repo-context/permissions.ts` and `src/tools/execute/permissions.ts` rather than a new milestone. Codex should pressure-test whether this is a refinement or a new authority.
- **B3 (MCP consumer).** **Its own milestone.** Slot recommendation: post-M16, when the demand checkpoint signals Researcher need. Could be M18 or M19 depending on intervening milestones.
- **B4 (install ergonomics).** Fits inside W3 install milestone. **Not its own milestone.**
- **B5 (error classification table).** Single-commit refinement of `src/providers/errors.ts`. **Not its own milestone.**

**Net new milestone slots from this comparison: one (MCP consumer, demand-gated).** All other borrows are sub-milestone refinements that respect rule 20.

---

## 8. Open questions for Codex

1. **Wildcard permissions.** Is B2 a refinement of an existing axis (permission enforcement), or a second authority surface that triggers rule 20? Defend with reference to M11 / M14's interpretation of "axis."
2. **MCP timing.** Should B3 be locked to demand-checkpoint signal, or pre-loaded as the next milestone slot regardless? The Researcher role is in the rule-17 dossier but not in any committed roadmap row.
3. **Recorded fixtures vs. live tests.** Is B1 actually load-bearing for PE-2+, or is the better answer "stay live-only and gate the test budget"? Rule 21's "measurable risk reduction" lens applies — what would we measure?
4. **Effect rejection.** Is N1 the right call, or are we underestimating a bug class we haven't surfaced because the FakeProvider doesn't exercise it (timeouts under load, fiber leaks under cancellation)?
5. **SQLite rejection.** Is N3 the right call, or does code-oz at v1 need a query-friendly secondary index over `events.jsonl` that SQLite would naturally provide?
6. **Permission cache.** opencode caches "always-allow" decisions in SQLite and replays them across sessions. code-oz re-checks every invocation. Is the latter actually right, or is there an audit-friendly middle ground (signed cache entries with TTL)?
7. **Cross-family enforcement.** opencode has no concept of provider families. code-oz's M14 panel hard-codes the family classification. If we ever borrow opencode's 21-provider integration breadth, does the family table scale? Where is the M14 reviewer-family registry's failure mode?

The Codex briefing pulls these into a structured debate prompt. Synthesis lands in `SYNTHESIS.md` after Codex responds.
