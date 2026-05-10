# SPEC.md contract — canonical spec for code-oz

This document is the **pinned spec** for the SPEC.md artifact written by the DEFINE phase, the ask-me intent-elicitation loop that produces it, the `<spec-ready/>` ready-token protocol, the new ask-me event types, and the draft-vs-canonical rule. It locks the M5 surface that M6+ phase logic and W2+ replay tooling will plug into.

The upstream templates are influence; this file is the authority for `code-oz`. When upstream and this file disagree, this file wins for `code-oz` purposes.

## Provenance

- **Upstream influences:**
  - `~/Projects/agents/templates/agent-skills` — the BA persona shape and the Common Rationalizations table pattern. The DEFINE → SHIP phase taxonomy `code-oz` adopted is from this template.
  - `~/Projects/agents/templates/Auto-claude-code-research-in-sleep` — bounded conversation runner (max-rounds + exit-on-confidence). Mirrors their loop discipline; the **structured ready-token** protocol is a `code-oz` extension that replaces their natural-language confidence detection.
- **No code dependency, no submodule, no copy-paste.** Patterns are borrowed; the implementation is `code-oz`.
- **Sync policy:** upstream changes do not auto-propagate. When upstream introduces a pattern `code-oz` should adopt, update this file and bump the influence references in `CLAUDE.md`.

## Why this exists

Three non-negotiable rules from `CLAUDE.md` collide at the DEFINE phase:

- **Rule 7** (artifact contracts in plain Markdown — never JSON for inter-phase handoffs) requires SPEC.md to be human-readable and editable.
- **Rule 1** (file-based gate signals only) requires the orchestrator to make pass/fail decisions on disk-resident files, not LLM text. The SPEC validator has to be deterministic.
- **Rule 13** (privacy by default; explicit file manifests) means the BA persona never silently absorbs the project tree — the orchestrator carries conversation state in `req.prompt`, the wrapper enforces `permissions.read`.

This spec pins the structure and validation rules so the rules above stay enforceable when M5's persona-driven ask-me loop produces the artifact.

## SPEC.md format

SPEC.md is plain Markdown. **No YAML frontmatter.** Gate metadata, run identity, and provenance live in `events.jsonl` and `GATE_DEFINE_PASSED.json`; the artifact itself is the user-facing spec.

### Canonical structure

```markdown
# SPEC

## Goals

- One-line bullet describing a goal.
- Another goal.

## Users

- One-line bullet naming a user role + what they care about.

## Constraints

- Technical, time, or scope constraint.

## Acceptance criteria

- Verifiable, evidence-based criterion.

## Open questions

- Question the user still needs to decide.

## Explicit non-goals

- Something this SPEC explicitly does not cover.
```

### Section requirements

| Section | Required | Min bullets | Notes |
|---|---|---|---|
| `# SPEC` (H1 title) | yes | n/a | Exact text `# SPEC` on the first non-empty line |
| `## Goals` | yes | ≥ 1 | Each bullet is a single line |
| `## Users` | yes | ≥ 1 | Naming a role + what they care about |
| `## Constraints` | yes | ≥ 1 | Technical, time, scope |
| `## Acceptance criteria` | yes | ≥ 1 | Each criterion is verifiable |
| `## Open questions` | yes | ≥ 1 | Use `- None known at define time.` if there are none |
| `## Explicit non-goals` | yes | ≥ 1 | Filler is acceptable; absence is not |

The H2 sections appear in **canonical order**. Out-of-order sections fail validation. Extra sections fail validation.

### Bullet syntax

- Lines starting with `- ` are bullets.
- Lines starting with `## ` are section headings.
- Empty lines are separators.
- Anything else inside a section body fails validation (e.g., paragraphs, code fences, sub-headings).

This is deliberately stricter than CommonMark. The persona is instructed via the protocol template to emit bulleted-only sections; the parser rejects anything else with a typed error so failure modes are crisp.

## The `<spec-ready/>` ready-token protocol

The BA persona signals "I have enough information to draft the SPEC" by emitting an exact line containing only `<spec-ready/>` (case-sensitive, surrounding whitespace allowed). The orchestrator detects the token, treats everything after that line as the SPEC.md draft, and validates.

### Token grammar

The orchestrator scans the persona's response (only the most recent persona reply, never the running conversation history or user input) for the first line matching:

```
^\s*<spec-ready/>\s*$
```

- Case-sensitive.
- Token must be alone on its line — `<spec-ready/>` embedded in prose does not count.
- The line itself is consumed (removed from the draft).
- Everything after that line, up to end-of-message, trimmed of leading/trailing whitespace, is the SPEC.md draft.

### Why exact-line match

Substring grep is fragile to user prompt injection (a user pasting `<spec-ready/>` from another doc) and to the persona accidentally referencing the token in prose. Exact-line match is unambiguous and easy to enforce.

### Why "only the persona response"

Conversation history is part of `req.prompt`. If the orchestrator scanned the prompt for the token, a user could trigger SPEC extraction from their own input. The orchestrator scans only `turn_completed.response.content` from the most recent provider invocation.

## Draft-vs-canonical rule

There are two artifact paths under `.code-oz/artifacts/`:

- `SPEC.md` — the **canonical** approved-or-approvable artifact. Gate writers sha256-bind this file at approval time.
- `SPEC.draft.md` — the **draft** when validation fails. Never approved by the gate writer; useful for inspection.

### When the orchestrator writes which

| Scenario | What gets written | Run state |
|---|---|---|
| Persona signals `<spec-ready/>` and draft passes validation | `SPEC.md` only | DEFINE complete; gate awaits user approval |
| Persona signals `<spec-ready/>` but draft fails validation; one repair turn passes | `SPEC.md` only | Same as above |
| Persona signals `<spec-ready/>` but draft + repair both fail | `SPEC.draft.md` + `NEEDS_INTERVENTION.json` (`code: 'spec_validation_failed'`) | Run paused for inspection |
| Max rounds hit; one finalize turn produces a passing draft | `SPEC.md` only | DEFINE complete |
| Max rounds hit; finalize turn fails validation (and one repair turn fails too) | `SPEC.draft.md` + `NEEDS_INTERVENTION.json` | Run paused |
| Provider returns `stopReason: 'max_tokens'` mid-turn | `SPEC.draft.md` (if any draft was extractable) + `NEEDS_INTERVENTION.json` (`code: 'spec_truncated'`) | Run paused |
| Provider throws `ProviderError` (auth, budget, etc.) | None; wrapper writes its own `NEEDS_INTERVENTION.json` | Run paused per M4 contract |

**The orchestrator never writes an invalid `SPEC.md`.** This is load-bearing: `code-oz approve define` computes `artifactSha256` from `SPEC.md` and binds it into the gate file. An invalid canonical artifact would either bind invalid content (silent corruption class) or fail at approval time with no clean recovery.

`SPEC.draft.md` is **never** sha256-bound by a gate. A future approve flow that wants to promote a draft must explicitly copy or rename it to `SPEC.md` (and pass validation) — not happening in v0.1.

### Atomic write discipline

Both `SPEC.md` and `SPEC.draft.md` are written atomically:

1. Open temp file `<target>.tmp-<random>` for writing.
2. Write content; call `fsync` on the file handle.
3. Close the file handle.
4. `rename(temp, target)`.
5. Open the parent directory; call `fsync`; close.

This mirrors `src/state/gates.ts`. Artifacts must not be weaker than gates — a crashed orchestrator must not leave a half-written SPEC.md on disk.

## Ask-me event types

Two new event types extend the open-type-union (`docs/references/file-based-gates.md` § 5 validation rule 12). No `version: 1` bump required.

### `ask_me_user_input`

Logged once per turn, after reading user input but before invoking the persona.

```ts
{
  version: 1,
  type: 'ask_me_user_input',
  ts: '2026-04-30T12:00:00.000Z',
  runId: '01J3Z...',
  phase: 'define',
  turn: 0,                       // 0-indexed; turn 0 is the initial request
  input: 'Build me a baby naming game.'
}
```

### `ask_me_persona_reply`

Logged once per turn, after the persona's `turn_completed` event arrives.

```ts
{
  version: 1,
  type: 'ask_me_persona_reply',
  ts: '2026-04-30T12:00:01.234Z',
  runId: '01J3Z...',
  phase: 'define',
  turn: 0,
  agent: 'ba',
  response: 'What age range is the game for?',
  ready: false                   // true when the response contains <spec-ready/>
}
```

### Why log content verbatim

`agent_invoked` carries manifest + four metrics; `agent_completed` carries agent name + optional `tokensUsed`. Neither captures `req.prompt` or `response.content`. Without ask-me events, **W2+ replay would have nothing to replay from** — the only record of the conversation would be the running totals. Logging content costs disk space (events.jsonl is per-run, gitignored) and gains a forensics + replay capability.

### Event retention policy

Ask-me events store user input and persona replies verbatim in `state/runs/<runId>/events.jsonl`. The default scaffold gitignores `state/runs/` (see `src/commands/init.ts`), so this content does not leak into version control by default. `code-oz` documentation must surface that the local event log contains conversation content; users handling sensitive intent should know to inspect or rotate `state/runs/` before sharing logs.

### Reducer behavior

Both event types are no-ops in the state reducer (`reduceEvents` in `src/state/run.ts`). They do not advance phase state or affect derived `current.json`. They exist solely for the audit trail and future replay.

## Ask-me config shape

Added to `.code-oz/config.yaml` and `DEFAULT_CONFIG`:

```yaml
phases:
  define:
    askMe:
      maxRounds: 8                  # inclusive; round (maxRounds + 1) triggers onMaxRounds
      readySignal: '<spec-ready/>'  # literal token; orchestrator regex-matches alone-on-line
      onMaxRounds: 'finalize'       # 'finalize' | 'fail'
      maxFinalizeTurns: 1           # extra turns when onMaxRounds == 'finalize'
      maxRepairTurns: 1             # extra turns when validation fails after ready signal
```

### Field semantics

- **`maxRounds`**: cap on the number of `<user input> → <persona reply>` exchanges. The first user input is turn 0; turn `maxRounds - 1` is the last regular round.
- **`readySignal`**: the literal token the persona emits to signal readiness. The orchestrator builds the regex `^\s*<readySignal>\s*$` after escaping.
- **`onMaxRounds`**:
  - `'finalize'` (default): after `maxRounds` regular turns, the orchestrator runs up to `maxFinalizeTurns` extra turns with an explicit "produce the best SPEC.md you can with current information; emit `<spec-ready/>` and the draft" prompt. If finalize produces a valid draft, write `SPEC.md`. If finalize fails validation, fall through to the repair turn and then SPEC.draft.md + intervention.
  - `'fail'`: after `maxRounds` regular turns without a ready signal, write `NEEDS_INTERVENTION.json` (`code: 'ask_me_max_rounds_exceeded'`) and exit. No SPEC.md, no draft.
- **`maxFinalizeTurns`**: bounded extra turns for the finalize ritual (0 disables; 1 is the v0.1 default).
- **`maxRepairTurns`**: bounded extra turns when SPEC validation fails (0 disables; 1 is the v0.1 default). Repair turn prompt asks the persona to fix specific missing or malformed sections.

### Why config, not hardcoded

Different fixtures and use cases have different convergence profiles. A non-technical-parent fixture might need 12 rounds; a power-user fixture might converge in 3. Operators may want a different ready signal if a future persona conflicts with the default. Each ritual (regular, finalize, repair) is bounded by config; `invokeAgent` enforces global budgets on top.

## Wrapper integration

The DEFINE orchestrator constructs `ProviderRequest` objects with paths-only `files` and a composed `prompt` containing the protocol template, the agent's persona body, the Common Rationalizations table, and the rendered conversation history. The wrapper's `buildManifest` enforces `permissions.read`; `assertWithinBudget` refuses turns that would breach budgets; `invokeAgent` records the four metrics into `agent_invoked` events as usual.

### `fieldsRemovedByScope` stays 0 in v0.1

The orchestrator does not narrow any manifest entry. Prompt composition (assembling the system prompt from bundled assets) is not manifest narrowing — those bundled prompt assets are not in `req.files`. They live in the prompt string and count toward `tokensEstimate`, not `filesSent` or `bytesSent`.

### Bundled prompt asset liveness

Prompt assets ship via static Bun asset imports following the M2 pattern in `src/agents/bundled-defaults.ts`:

```ts
import defineSystemAsset from './define-system.md' with { type: 'file' }
import commonRationalizationsAsset from './common-rationalizations.md' with { type: 'file' }
```

The composer module (`src/prompts/index.ts`) loads the asset bytes via `Bun.file(...).text()` at run time. The composer is reached from `code-oz run → define.ts → composeDefinePrompt(...)`, so Bun's tree-shaker keeps the assets in the compiled binary. **A random unused keepalive import in `bootstrap.ts` is not sufficient** — the asset has to be reached from a live code path.

## Anti-patterns rejected by this spec

- **YAML frontmatter on SPEC.md.** Plain Markdown only. Run metadata lives in events and gate files.
- **Writing an invalid `SPEC.md`.** If validation fails, write `SPEC.draft.md` + `NEEDS_INTERVENTION.json`. Never the canonical artifact.
- **Substring grep for the ready token.** Exact-line regex match against the persona response only.
- **Scanning the conversation history or user input for the ready token.** Only the most recent persona response.
- **Per-phase Common Rationalizations tables.** One shared `src/prompts/common-rationalizations.md` injected into every phase persona.
- **Bundling the persona body into `define-system.md`.** The persona is `src/agents/defaults/ba.md`. The protocol template in `define-system.md` references the persona body via `{{AGENT_BODY}}` token.
- **Duplicating the rationalizations into the persona body.** The composer injects them via `{{COMMON_RATIONALIZATIONS}}` token at run time.
- **H2-section transcript fixtures.** The BA's final response contains H2 sections inside the SPEC draft; H2 splitters would split inside the draft. Use HTML comment delimiters (`<!-- turn:user -->...<!-- /turn -->`) instead.
- **Mid-DEFINE STOP on resume gap.** Discovering a run in DEFINE without `GATE_DEFINE_PASSED.json` must NOT auto-write `STOP.json`. Print actionable instructions; let the user decide.
- **Manifest narrowing of bundled prompt assets.** The prompt assets are not in `req.files`. They contribute to `tokensEstimate`, not `filesSent`.
- **Approving a draft.** `SPEC.draft.md` is never sha256-bound by `code-oz approve define`. Promoting a draft requires explicit `code-oz` invocation (not in v0.1).
- **Treating `stopReason: 'max_tokens'` as a complete response.** A truncated persona reply must not be parsed for the ready token; orchestrator writes `SPEC.draft.md` (if extractable) + `NEEDS_INTERVENTION` (`code: 'spec_truncated'`).

## Validation rules summary

1. SPEC.md begins with `# SPEC` on the first non-empty line.
2. Six required H2 sections in canonical order: Goals, Users, Constraints, Acceptance criteria, Open questions, Explicit non-goals.
3. Each section has ≥ 1 bullet (open-questions accepts `- None known at define time.` as the canonical empty-bullet).
4. Section bodies contain only bullets and blank lines; no paragraphs, code fences, or sub-headings.
5. Out-of-order sections, missing sections, extra sections all fail validation.
6. The orchestrator never writes an invalid SPEC.md; on validation failure, write SPEC.draft.md + NEEDS_INTERVENTION.
7. Both SPEC.md and SPEC.draft.md are written atomically (temp + fsync + rename + dir fsync).
8. Ask-me events log user input and persona replies verbatim; reducer treats them as no-ops.
9. Ready-token detection is exact-line regex against the most recent persona response only.
10. `fieldsRemovedByScope` stays 0 unless the phase logic narrows a manifest entry (does not happen in M5).
11. Bundled prompt assets are reached via static Bun asset imports in production-reachable code paths.

## Quality heuristics (diagnostic-only)

These checks are warnings only. They do not block `GATE_DEFINE_PASSED.json`, `code-oz approve define`, or any other gate write.

### Vague-language vocabulary (rule QH1)

The pinned vocabulary is:

```text
fast
quick
slow
good
bad
poor
user-friendly
easy
simple
secure
safe
scalable
flexible
performant
efficient
```

The matching pattern is:

```regex
\b(?:should\s+be\s+|must\s+be\s+|needs?\s+to\s+be\s+)?(fast|quick|slow|good|bad|poor|user-friendly|easy|simple|secure|safe|scalable|flexible|performant|efficient)\b
```

The optional lead-in is `should be`, `must be`, or `need(s) to be`. Warnings are suppressed for any bullet containing an explicit metric (digits plus a unit-like token) or a named-control reference (an uppercase/control identifier like `OAuth`, `RBAC`, `SOC2`, `bcrypt`).

### Goals sufficiency (rule QH2)

Warn when Goals has fewer than 2 bullets AND fewer than 15 total words across all Goals bullets. The hard contract remains unchanged: Goals must have at least 1 bullet.

### Diagnostic output discipline

Each `SpecLintIssue` carries `code`, `section`, `bulletIndex`, and, for QH1, `term`. No surrounding text is logged. Counters are 0-N issues per SPEC, with no aggregation.

## What this file is not

- **Not the M5 implementation plan.** See `docs/design/SESSION_M5_KICKOFF.md` and `docs/design/CODEX_RESPONSE_M5.md`.
- **Not a substitute for the agent-skills upstream.** The BA persona body shape is borrowed from `agents/code-reviewer.md`-style persona files in agent-skills; read those for shape, then add the `code-oz` extensions from `docs/references/agent-skill-format.md`.
- **Not the marketplace contract.** Agent-pack manifests (W3+) extend SPEC.md authoring with packaging metadata; not in scope here.
- **Not the PLAN contract.** PLAN.md is M6's surface and gets its own pinned reference (`docs/references/plan-contract.md`) when M6 lands.
- **Not the AUDIT contract.** AUDIT.md (W4 brownfield) gets its own contract.
