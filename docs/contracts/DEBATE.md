# DEBATE (v0.1)

User-facing contract for the cross-family debate-during-design pattern: the artifact layout, event names, permission sub-scope, and mandatory DECISION.md rationale. Authoritative for v0.1.

**Status:** runtime shipped in M10 (`v0.10.0-alpha.0`). The contract was authored as a *process contract* in M7 commit 2 (no runtime); M10 commit 7 (`src/tools/debate-request.ts`) implements the runtime primitive `requestDebate()` against this contract. Empirical practice from seven milestones (M2-M6 + synthesis + M7-M10 shape, all under `docs/research/CODEX_BRIEFING_*.md` + `CODEX_RESPONSE_*.md` pairs) shaped the format.

## Why this exists

Cross-family debate at planning convergence catches blind spots that single-model authoring misses. CLAUDE.md rule 7 names this as a non-negotiable: "Before starting implementation of any milestone, run a Codex debate round on the milestone scope." Empirically, every milestone since M2 has shipped a briefing/response pair. The M7-M10 shape debate (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`, thread `019ddea0`, 2026-04-30) flipped this from process discipline to product feature: cross-family debate is a runtime primitive, not just a session habit. M10 makes it programmatic. M7 (this commit) pins the format.

## Scope split: M7 vs M10

| Concern | M7 (this contract, process-only) | M10 (runtime) |
|---|---|---|
| Artifact layout | Names, paths, locked H2 sections | Atomic writers, parsers, gate-preflight checks |
| Event types | Names + when emitted | Schemas in `src/state/schemas.ts`, validators in `src/state/events.ts` |
| Permission sub-scope | `tool_use.debate` definition (TypeScript shape) | Manifest preview, file-set gating, runtime enforcement |
| DECISION.md mandatory | Documented as authoritative | Runtime gate rejects debates without DECISION.md |
| Invocation | Manual via `codex` MCP server (CLAUDE.md rule 7) | `requestDebate({ phase, topic, files, question, opposingProvider })` from any phase persona |
| Budget accounting | Documented (under `budgets.global`) | Implemented in `src/providers/cost.ts` |

Per CLAUDE.md rule 20 (one new authority boundary per milestone): M7's boundary is worktree + BUILD artifact. M10's boundary is Debate runtime. M7 must not ship debate runtime code; this contract is the seam.

## Empirical pattern (today, manual)

Debates are run via the `codex` MCP server. Every milestone since M2 follows the same five-step shape:

1. Claude (or the user) drafts `docs/research/CODEX_BRIEFING_<topic>.md` against the BRIEFING.md required sections below.
2. The user invokes `mcp__plugin_agent-codex_codex-native__codex` with the briefing path, model `gpt-5.5`, effort `xhigh`, sandbox `read-only` (per CLAUDE.md rule 10 model fallback).
3. Codex's reply is captured as `docs/research/CODEX_RESPONSE_<topic>.md`, including the thread id verbatim.
4. Resolution lands as either a dedicated `DECISION.md` for narrow debates, or — for thesis-level debates — folded into `CLAUDE.md` rules and `ROADMAP.md` rows with thread-id citations in the commit body.
5. Every commit that implements the resolution references the response file path.

The historical artifacts under `docs/research/` and `docs/design/` are the source-of-truth record. M10's runtime does not migrate them; it adds a structured path under `.code-oz/artifacts/debates/<phase>-<topic>/` for runtime-invoked debates from inside a phase persona.

## Artifact layout (M10 runtime path)

```
.code-oz/artifacts/debates/<phase>-<topic>/
├── BRIEFING.md             # the proposing party's framing
├── RESPONSE.codex.md       # Codex's verdict + rationale (when Codex is the opposing party)
├── RESPONSE.claude.md      # Claude's verdict + rationale (when Claude is the opposing party)
└── DECISION.md             # synthesized resolution + rationale; mandatory
```

- One or both `RESPONSE.*.md` files may be present. Asymmetric debate: one proposer, one opponent (one RESPONSE). Symmetric debate: both parties brief and respond (two RESPONSE files; the proposer's `BRIEFING.md` is the canonical brief regardless).
- Topic slug grammar: lowercase-kebab-case, descriptive, ≤ 48 characters (e.g., `m7-shape`, `repo-context-cap`, `clean-room-vs-leaked-source`). The phase prefix anchors the debate to a gate; cross-phase debates use `meta-` (e.g., `meta-provenance-leaked-source/`).

| Phase prefix | Use |
|---|---|
| `define-` / `plan-` / `build-` / `verify-` / `review-` | Phase-scoped debates invoked from a phase persona |
| `pre-<milestone>-` | Pre-milestone planning debates (e.g., `pre-m7-rules-15-19`) |
| `meta-` | Cross-phase / cross-milestone (e.g., provenance, governance) |

## BRIEFING.md required H2 sections

```markdown
# <topic title>

**Date:** ISO 8601 date
**Status:** thesis | implementation | review
**Caller:** Claude / Codex (which side authored this brief)
**Target:** opposing model + sandbox mode (e.g., `gpt-5.5 xhigh, sandbox: read-only`)
**Cycle:** session-cycle phase (boot | plan | implement | review | tag | handoff)

## What you are reading
## Where we stand
## What is locked
## What is up for debate
## The recommended path
## Decision prompts
## What I want from you
```

| Section | Min content |
|---|---|
| `## What you are reading` | 1 paragraph framing the debate's stakes |
| `## Where we stand` | Current project state (commits, tests, version, what works, what is stubbed) |
| `## What is locked` | Decisions the opposing party may not relitigate (with rule citations) |
| `## What is up for debate` | The questions inviting pushback |
| `## The recommended path` | The proposer's preferred resolution |
| `## Decision prompts` | Numbered prompts the opposing party should answer |
| `## What I want from you` | The shape of the response expected |

The locked-vs-open split is load-bearing: it prevents debates from rebottoming the entire project on every milestone (Codex thesis-debate observation, 2026-04-30: "without explicit locks, every Codex round becomes a re-litigation of v0.1 scope").

## RESPONSE.{codex,claude}.md required H2 sections

```markdown
# Response — <topic>

**Thread:** <provider thread id>
**Date:** ISO 8601 date
**Model:** model + effort
**Brief:** path to BRIEFING.md

## Verdict on the decisions
## Risks the proposing side missed
## Where I disagree
## What I would defer
## Recommended next step
```

### Locked first-line `Overall verdict:` grammar (M10)

Per `CODEX_RESPONSE_M10.md` D10 lock: the **first non-empty line under `## Verdict on the decisions`** in every RESPONSE.{codex,claude}.md MUST match:

```
Overall verdict: <enum>
```

Where `<enum>` is one of the planning-debate verdict values (below). Per-decision verdicts may follow on subsequent lines without parser interference. M10 commit 4 (`src/artifacts/debate.ts`) `parseResponse` enforces this; a RESPONSE missing the `Overall verdict:` line or with an enum value outside the allowed set raises `debate_response_verdict_invalid`.

The `debate-opponent-system.md` prompt template (commit 6) instructs the opposing party to emit this line as the first content under the H2.

### Verdict enum (locked)

For design / planning debates (rule 7 — debate at planning convergence):

| Verdict | Meaning |
|---|---|
| `accept` | Proceed with the recommended path verbatim |
| `accept-with-modifications` | Proceed with the recommended path plus the named modifications |
| `reject` | Do not proceed; reasoned alternative below |
| `feature-with-modifications` | The proposed direction is real but the scope or naming should change |

For code reviews (rule 8 — review at implementation completion):

| Verdict | Meaning |
|---|---|
| `push` | Tag and push the milestone |
| `fix-first` | Address findings before tag |
| `debate-required` | Pause; new design debate needed |

A response with a verdict outside these enums fails `debate_response_verdict_invalid` at runtime (M10) or fails synthesis review (today, manual).

## DECISION.md required H2 sections

```markdown
# Decision — <topic>

**Date:** ISO 8601 date
**Resolved by:** <human + model who synthesized>

## Verdict
## Rationale
## What changes (artifact deltas)
## What does not change
## Open follow-ups
```

| Section | Min content |
|---|---|
| `## Verdict` | One of the locked enum values, plus a one-line summary |
| `## Rationale` | Why this verdict; weighs both sides; no rubber-stamping |
| `## What changes (artifact deltas)` | Concrete file/section/rule deltas this decision triggers |
| `## What does not change` | Explicit non-changes (locked surfaces preserved) |
| `## Open follow-ups` | Hypotheses or questions the decision parks for later (cross-link to `OPEN_QUESTIONS.md` per `SCIENTIST.md`) |

DECISION.md is mandatory. A debate without DECISION.md becomes archived theater (Codex M7-M10 shape risk #4: "without DECISION.md, debate becomes archived theater"). The runtime in M10 will gate on its presence; today, the synthesis step (CLAUDE.md rule 7) is the human enforcement.

`Resolved by` cites both a human and a model when synthesis was AI-assisted (e.g., `Ozzy + Claude Opus 4.7`). Pure-human syntheses cite only the human.

## Event types (definition only; M10 implements)

Names listed here; canonical schemas land in `src/state/schemas.ts` during M10 alongside the existing event union.

| Event | Emitted when |
|---|---|
| `debate_started` | BRIEFING.md atomically written; opposing-party invocation begins |
| `debate_resolved` | DECISION.md atomically written; control returns to the calling phase |

Both events carry `runId`, `phase`, `topic`, and the absolute artifact directory path. `debate_resolved` additionally carries `verdict` (one of the locked enum values) and a one-line rationale summary capped at 200 characters.

A `debate_started` without a matching `debate_resolved` by run termination produces `intervention` with code `debate_unresolved`. M10 implements the runtime check; M7 documents the surface.

## Permission sub-scope (definition only; M10 implements)

`tool_use.debate` extends the existing `AgentPermissions.tool_use` umbrella (per [`REPO_CONTEXT.md`](./REPO_CONTEXT.md) and [`BUILD.md`](./BUILD.md)). Locked TypeScript shape:

```ts
interface AgentPermissions {
  read: '*' | readonly string[]
  write: '*' | readonly string[]
  bash: 'deny' | readonly string[]
  tool_use?: {
    repo_context?: { /* M6 — see REPO_CONTEXT.md */ }
    write?:        { /* M7 — see BUILD.md */ }
    debate?: {
      // Which providers this persona may debate against.
      // Cross-family enforced at load time (rule 2): cannot include the persona's own family.
      opposingProviders: readonly ('claude' | 'codex' | 'gemini')[]
      // Maximum concurrent open debates per phase invocation.
      maxConcurrent: number
      // Manifest preview gate: paths matching .code-ozignore are blocked at preview.
      // Fixed at true; the runtime presents the manifest to the user before send.
      previewBeforeSend: true
      // Maximum files surfaced into BRIEFING.md.
      maxFiles: number
      // Per-debate wall-time cap (one round-trip).
      timeoutMs: number
      // Network is implicit: debate is a provider call, not a remote tool.
    }
  }
}
```

- `previewBeforeSend` is fixed at `true`. The runtime (M10 commit 5, `src/tools/debate-permissions.ts`) writes a non-interactive `MANIFEST.preview.md` audit artifact before BRIEFING.md is sent to the opposing provider; the artifact's sha256 is bound to `debate_started.manifestPreviewSha256`. The runtime blocks on `.code-ozignore` matches (per CLAUDE.md rule 13) and on lexical path-safety violations (absolute, `..`, backslash). Operator review is post-hoc via `events.jsonl` and `code-oz doctor --bundle`. **Interactive operator approval (e.g., a `code-oz approve debate` command) is deferred to W2 / TUI work.** This addresses Codex's "Debate can violate privacy and budgets faster than REVIEW" risk.
- `opposingProviders` enforces cross-family at the permission layer (rule 2). A `claude` persona's debate sub-scope cannot include `claude`. The runtime rejects with `debate_opposing_provider_same_family` at load time (M2-style validation).
- The schema lands in `src/agents/schema.ts` during M10. M7 references this contract by name only.

## Budget accounting (under `budgets.global`)

Per CLAUDE.md rule 19: run-level budget enforcement is mandatory and lives under a single namespace. Debate calls are provider calls. They consume:

| Budget axis | Increment per debate |
|---|---|
| `maxProviderCalls` | **+1 per provider invocation inside the debate.** Asymmetric debate fires opposing + synthesis = +2 minimum; if the calling phase invokes a continuation turn after DECISION.md, that's +3 per debate. There is no "+0 synthesis" carve-out. (CODEX_RESPONSE_M10.md D11 lock; risk #2.) |
| `maxTokensEstimate` | BRIEFING.md body + RESPONSE body + DECISION authoring tokens, all estimated via existing `src/providers/cost.ts` `estimateTokens` (each `agent_invoked` event contributes its `tokensEstimate`). |
| `maxTurns` | 0 — a debate does not increment `phase_entered`; it is multiple provider calls under the calling phase, not a separate phase. |
| `maxWallTimeMinutes` | every provider invocation's wall time contributes to the run total. |

No parallel `budgets.debate` namespace (CLAUDE.md rule 19). M10 commit 7 ships the accounting via the existing `assertWithinBudget` chokepoint that every `invokeAgent` call goes through.

## What M10 did not change (and won't)

- DECISION.md remains mandatory. The runtime cannot bypass it; missing DECISION → `debate_decision_missing` intervention.
- Cross-family enforcement remains layered: load-time permission check + invocation-time runtime check + recorded post-condition (`debate_started.callerFamily` and `debate_started.opposingFamily` cite the family pair).
- Markdown remains canonical (rule 7); `events.jsonl` is audit-only, never the source-of-truth artifact.
- Codex remains a peer, not an authority (rule 9). The runtime does NOT auto-merge Codex verdicts. DECISION.md authority belongs to the calling persona; per D5 lock, exact-copy rationale text from the opposing RESPONSE raises `debate_decision_no_rationale`.
- Manual debates remain valid even after M10 ships. The runtime is convenience, not replacement.
- M10 ships single-opponent asymmetric only. Symmetric debate (both parties brief) and multi-opponent debate are deferred until measurable need (CLAUDE.md rule 21).

## Common errors (M10 will surface; documented now)

| Error | Meaning | Action |
|---|---|---|
| `debate_decision_missing` | `debate_started` emitted, run terminating, no `debate_resolved` | Author DECISION.md or mark debate explicitly abandoned |
| `debate_briefing_missing_section` | BRIEFING.md skips a required H2 | Author repair |
| `debate_response_verdict_invalid` | RESPONSE.*.md verdict outside the locked enum | Author repair |
| `debate_decision_no_rationale` | DECISION.md present but `## Rationale` empty | Author repair |
| `debate_opposing_provider_same_family` | `tool_use.debate.opposingProviders` includes the persona's own family | Permission validation; persona repair |
| `debate_manifest_blocked` | Manifest preview hit a `.code-ozignore` match | User reviews; either edits manifest or extends ignore policy |
| `debate_concurrent_limit_exceeded` | More than `maxConcurrent` debates open per phase invocation | Resolve open debates first |

## Ignore-policy subset (M10)

Per `CODEX_RESPONSE_M10.md` D6 lock: M10 ships a debate-only `.code-ozignore` parser at `src/tools/ignore-policy.ts`. The parser **fails closed** on unsupported syntax (no silent literal-fallback). Other phases (BUILD/VERIFY/REVIEW/PLAN-non-debate) ignore `.code-ozignore` until W4 hardening.

### Supported syntax

| Pattern shape | Example | Matches |
|---|---|---|
| Comment line (skipped) | `# comment` | (no match; line ignored) |
| Blank line (skipped) | (empty) | (no match; line ignored) |
| Plain literal | `.env` | exact project-root-relative path |
| Trailing-slash directory | `config/credentials/` | every file under `config/credentials/` |
| Single-segment glob | `config/*.yaml` | files in `config/` ending in `.yaml` (does not cross `/`) |
| Recursive prefix | `**/secrets.json` | matches `secrets.json` at any depth |
| Recursive prefix + glob | `**/*.key` | matches files ending in `.key` at any depth |

### Unsupported syntax (fails closed)

| Pattern shape | Example | Why rejected |
|---|---|---|
| Negation | `!exception.env` | gitignore re-include semantics; complex interaction with order |
| Rooted-absolute | `/pattern` | gitignore "anchored to root" — current parser uses project-root-relative |
| Bracket character class | `foo[abc].txt` | regex metacharacter ambiguity |
| Backslash escape | `foo\ bar.txt` | escape ambiguity |
| Trailing `**` | `vendor/**` | overlapping with directory-prefix; use `vendor/` instead |
| Mid-pattern `**` | `foo/**/bar` | only leading `**/` is supported |

Each unsupported line raises `ignore_policy_unsupported_syntax` with the offending text + line number; the IgnorePolicyError aggregates all issues across the file. The runtime in `src/tools/debate-permissions.ts` propagates the error to `requestDebate`, which emits a `debate_manifest_blocked` intervention before BRIEFING.md is sent.

### Manifest preview shape

Per D9 lock, the runtime atomically writes `MANIFEST.preview.md` to `.code-oz/artifacts/debates/<phase>-<topic>/MANIFEST.preview.md` BEFORE BRIEFING.md is sent and BEFORE any provider call. The preview includes the topic header, caller + opposing identification, ignore-policy status (`absent` or `present (N patterns)`), counts of allowed + blocked files, the structured allowed-files list, the structured blocked-files list with reason + matching pattern + line, and a Notes section pointing operators at `events.jsonl` + `code-oz doctor --bundle`. The preview's sha256 is bound to `debate_started.manifestPreviewSha256`.

## Reference

- **Linked contracts:** [`BUILD.md`](./BUILD.md), [`VERIFY.md`](./VERIFY.md), [`REVIEW.md`](./REVIEW.md) (debate is invokable from any phase persona granted `tool_use.debate`), [`REPO_CONTEXT.md`](./REPO_CONTEXT.md) (sibling sub-scope under `tool_use`), [`WORKTREE.md`](./WORKTREE.md), [`GATES.md`](./GATES.md), [`SCIENTIST.md`](./SCIENTIST.md) (open follow-ups in DECISION.md cross-link to `OPEN_QUESTIONS.md`)
- **Non-negotiable rules:** `CLAUDE.md` rules 2 (cross-family review), 7 (Codex debate at planning convergence — the empirical rule this contract codifies), 8 (review verdict enum), 9 (Codex's verdict is data, not authority), 13 (privacy by default), 19 (budget enforcement under `budgets.global`), 20 (one new authority boundary per milestone — Debate runtime is M10's boundary)
- **Design rationale:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30) — Decision 4 (Debate runtime is M10, not M7), thesis verdict (`feature-with-modifications`), risk #4 ("archived theater" → DECISION.md mandatory)
- **Roadmap:** [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § M7 commit 2 (this file), § M10 (Debate runtime; `src/tools/debate-request.ts`, `src/artifacts/debate.ts`, `src/agents/schema.ts`, `src/state/schemas.ts`, `src/state/events.ts`, `src/tools/debate-permissions.ts`, `src/providers/cost.ts`)
- **Empirical history:** `docs/research/CODEX_BRIEFING_*.md`, `docs/design/CODEX_BRIEFING_M*.md` and matching responses (M2-M6 + synthesis-round + M7-M10 shape) — the manual pattern this contract codifies
