# GUARDRAILS (v0.1 draft, B2 from claude-code template comparison)

User-facing summary of the rule-9 enforcement layer that lets operators express
pattern-based deny/warn rules over runtime tool calls and persona output.
Authoritative for the contract slice that lands in `src/policy/guardrails.ts`.
Runtime wire-in into the tool-call wrapper is a separate slice.

## Why this exists

Non-negotiable rule 9 (`CLAUDE.md`): permission manifest required for any `.ts`
escape-hatch execution. Default-deny on commands / network / file-roots /
env-vars / timeout / secret access.

Rule 9 covers configuration scope. It does not cover **content-level**
patterns — for example "an agent attempted to write `console.log` into a
production file" or "an agent attempted a rm-style command nobody asked
for." The `claude-code` template's bundled `hookify` and `security-guidance`
plugins demonstrate the missing layer: pattern-matched rules that fire
before tool execution and either warn or block.

Per `docs/comparisons/claude-code/SYNTHESIS.md` §1.3 / §1.4 / §1.5, this
contract is the rule-9 enforcement layer authority boundary that closes
that gap. It is honestly named: pattern-blocking before tool execution is a
new authority plane, not "rule 9 gains pattern rules" syntactic sugar.

This contract is the **contract + parser + matcher** slice. Runtime
integration (wire into the tool-call wrapper, register event types, add
event-emit at the call site) is a separate slice gated on Codex's
post-implementation peer review of this contract.

## Authority scope (rule 20)

This contract introduces one new authority axis: **runtime content
inspection between persona output and tool execution.** It never:

- Rewrites prompts.
- Patches files.
- Auto-fixes commands.
- Mutates rule files.
- Suppresses other gate signals (gate file authority is unchanged).

Block decisions abort the tool call and surface as `NEEDS_INTERVENTION.json`
when the wire-in slice lands. Warn decisions log to `events.jsonl` and
proceed.

## Rule sheet location and scope

Operator-authored guardrail rules live at one of:

- `.code-oz/guardrails.md` (single-file form)
- `.code-oz/guardrails/<rule-name>.md` (per-file form)

Both forms are read at run start, parsed, and pre-compiled. A single rule
file is a Markdown document with a YAML frontmatter block and an
optional Markdown body that becomes the warn / block message. The body is
plain Markdown; pattern matching is performed only on the frontmatter
fields, never on the body or on the surrounding documentation.

## Rule schema (locked v0.1)

```yaml
---
name: <kebab-case unique id, required>
enabled: <bool, default true>
event: <one of: PreToolUse | PostToolUse | UserPromptSubmit | Stop | SubagentStop>
tool: <optional; one of: Edit | Write | MultiEdit | Bash | RepoContext | * — defaults to '*'>
scope: <required; one of: runtime-tool-call | artifact-authoring>
conditions:                # required (non-empty) for non-Stop events
  - field: <one of: file_path | new_content | command | prompt | tool_input>
    operator: <one of: equals | contains | prefix | suffix | glob>
                          # `regex` is deferred to v0.2 (see "Regex deferred" below)
    value: <non-empty string; glob pattern length ≤ 256>
action: <one of: warn | block — defaults to warn>
message: <optional; if absent, the Markdown body becomes the message>
dedupKey: <optional template; warn-action rules only — e.g., "{rule.name}:{file_path}">
maxMatchesPerRun: <optional int; default 100>
priority: <optional int; default 100; higher fires first when multiple rules match>
---

<optional Markdown body — used as the message when `message:` is absent>
```

### Regex deferred to v0.2

`operator: regex` is rejected at parse time in v0.1 with code
`guardrail_operator_deferred`. The reason is concrete: JavaScript's
synchronous `RegExp.test(input)` cannot be interrupted by a wall-time
timeout, so the documented 50 ms cap is decorative (a catastrophic
pattern blocks for seconds or minutes before any "timeout" is observed).
v0.2 reintroduces the operator with a worker-bounded evaluator that can
actually enforce the cap. v0.1 ships with deterministic operators only:
`equals`, `contains`, `prefix`, `suffix`, `glob`. These are sufficient
for the load-bearing use cases (block specific commands, warn on
specific substrings in specific glob paths).

### dedupKey is warn-only

Block rules cannot dedup. A saturated dedup ledger on a `block` rule
would silently downgrade the decision to `allow`, which is exactly the
failure mode this contract exists to prevent. The parser rejects
`dedupKey` on `action: block` with code
`guardrail_dedup_on_block_disallowed`. If you need a block rule plus
event-noise suppression, write two rules: one block (no dedup), one
warn with dedup.

### Allowed `field` values per `event`

| Event | Allowed `field` values | Rationale |
|---|---|---|
| `PreToolUse` | `file_path`, `new_content`, `command`, `tool_input` | Tool input fields by tool type |
| `PostToolUse` | `file_path`, `tool_input` | Limited to non-secret post-result fields |
| `UserPromptSubmit` | `prompt` | The prompt string itself |
| `Stop` | (none — match-all on event) | Stop is event-only |
| `SubagentStop` | (none — match-all on event) | SubagentStop is event-only |

Specifying a `field` not allowed for the event is a parse-time error
(`guardrail_field_not_allowed_for_event`).

### Allowed `tool` values

`Edit | Write | MultiEdit | Bash | RepoContext | *`. The wildcard `*`
matches every tool. Specifying `tool:` for a `UserPromptSubmit` /
`Stop` / `SubagentStop` rule is a parse-time error
(`guardrail_tool_not_allowed_for_event`).

### Operator semantics

| Operator | Semantics | Notes |
|---|---|---|
| `equals` | Exact string equality after normalization | Newline-normalized |
| `contains` | Substring match after normalization | Newline-normalized |
| `prefix` | Input starts with `value` | |
| `suffix` | Input ends with `value` | |
| `glob` | POSIX-style glob match | Anchored; uses `bun-supported` glob library or hand-rolled equivalent |
| `regex` | RegExp match with timeout cap | Requires `maxLength` |

Operator preference order, lowest cost first: `equals`, `contains`,
`prefix`, `suffix`, `glob`, `regex`. The matcher does not rewrite rules,
but the validator emits `guardrail_regex_advisable_substring` when a
regex pattern reduces cleanly to a substring.

### Regex constraints

- `maxLength` is required and must be ≤ 65,536. Inputs longer than
  `maxLength` are not matched (no truncation, no false positives).
- Per-match wall-time cap: 50 ms. A timeout produces a
  `guardrail_match_timeout` event and the rule does not fire.
- The regex is compiled once at run start; compile errors are
  parse-time failures.

### Scope semantics

The `scope` field is required and decides where the rule fires.

- `runtime-tool-call` — the rule applies to PreToolUse / PostToolUse
  / UserPromptSubmit / Stop / SubagentStop events fired during the
  agentic runtime.
- `artifact-authoring` — the rule applies *only* when an agent's
  output is being persisted as an artifact (REVIEW.md, BUILD_REPORT.md,
  SPEC.md, etc.). It does not fire on persona output that is
  intermediate (debate transcripts, repo-context tool calls).

A rule that mentions a dangerous-API token in its `value` (necessary
for any rule that wants to flag the token) MUST be scoped to either:

- `runtime-tool-call` only — the rule will not fire on documentation
  written under `artifact-authoring`. This is the simplest defense.
- `artifact-authoring` with a positive `file_path` condition that
  restricts the rule to the actual artifact path you care about
  (for example, `file_path` `glob` `.code-oz/artifacts/**/*.md`).
  Adding a positive `file_path prefix docs/` condition would do the
  opposite of "exempt docs" under AND semantics — it would *limit
  the rule to docs paths only*. Use a positive include of the
  artifact path, not an attempt to exclude docs.

The empirical failure mode this guidance prevents is the comparison
document itself tripping the upstream `security-guidance` hook
(see `docs/comparisons/claude-code/COMPARISON.md` §4.6 correction
note + the tripwire described in `docs/comparisons/claude-code/SYNTHESIS.md`
§1.4). v0.1 does not provide a `not_prefix` / `exclude` operator;
exclusion is achieved by tightening the positive include or by
splitting the rule across `scope`s.

### Multi-condition AND semantics

When `conditions` has more than one entry, all conditions must match for
the rule to fire. There is no OR; encode disjunction by writing
multiple rules. This matches the influence library's `hookify`
multi-condition behavior (`plugins/hookify/core/rule_engine.py:120-125`)
without inheriting its single-pattern flat shape.

### Unknown fields rejected

The parser rejects any frontmatter key not in the schema above with
`guardrail_unknown_frontmatter_key`. This protects against operator
typos that would silently disable a rule (e.g., writing `actions:` instead
of `action:`).

### Read-only to agents

`.code-oz/guardrails.md` and `.code-oz/guardrails/**` are added to the
default-deny path set for *every* persona's `permissions.write` slot. An
agent that attempts to write a guardrail file is blocked by rule 9
configuration scope independent of any guardrail rule. Operators must
edit guardrail files outside the run.

## Decision flow

For each event, the matcher:

1. Selects rules whose `event` matches and (if applicable) `tool` matches,
   and whose `scope` matches the current runtime context.
2. Sorts by `priority` descending.
3. For each candidate rule, evaluates conditions (AND semantics).
4. On match, computes the dedup key (if any). If the dedup key is in the
   per-run dedup ledger and the rule has hit `maxMatchesPerRun`, the
   matcher emits `guardrail_skipped_dedup` and continues.
5. On match (and not deduped), the matcher returns `{ decision: 'warn' |
   'block', rule, reason }`.
6. The wire-in slice consumes the decision: `warn` logs and proceeds;
   `block` writes a `guardrail_blocked` event + `NEEDS_INTERVENTION.json`
   + aborts the tool call.

Multiple rules can fire on a single event. The first `block` decision
wins. If no rule blocks, all matching rules' warn outputs are logged in
priority order.

## Event vocabulary (defined; registered in the wire-in slice)

| Event | Fields | Fires when |
|---|---|---|
| `guardrail_evaluated` | `eventName, rulesConsidered, durationMs` | Every guarded event, regardless of match |
| `guardrail_warned` | `ruleName, conditionsMatched, dedupKey?, message` | A warn-action rule matched and was not deduped |
| `guardrail_blocked` | `ruleName, conditionsMatched, message, interventionPath` | A block-action rule matched |
| `guardrail_skipped_dedup` | `ruleName, dedupKey, hitCount` | A rule matched but the dedup ledger silenced it |
| `guardrail_match_timeout` | `ruleName, operator, durationMs, maxMs` | A regex evaluation hit the per-match timeout |
| `guardrail_parse_error` | `ruleFile, code, detail` | Run-start parse rejected a rule file |

These events are append-only; the dedup ledger is the projection of
`guardrail_warned` + `guardrail_skipped_dedup` events grouped by
`dedupKey`. There is no hidden state file. There is no env-var bypass.
Disable a rule by editing the rule file and setting `enabled: false`
before the next run, which is itself recorded at run start as
`guardrail_disabled_at_run_start`.

## Failure mode posture

- **Fail-closed on malformed block rules.** A rule with `action: block`
  that fails to parse is treated as a parse error (run does not
  start). This contrasts with `hookify`'s permissive parse fallback.
- **Fail-open on malformed warn rules.** A warn rule that fails to
  parse logs a `guardrail_parse_error` event and the run proceeds with
  that rule disabled. Operator visibility comes from the event log,
  not from a fatal exit.
- **Fail-open on regex timeout.** The rule does not fire; the event log
  records the timeout for operator review.
- **Fail-closed on a matcher exception** (any error not classified
  above). The decision becomes `block` with reason `matcher_error`,
  which surfaces as `NEEDS_INTERVENTION.json`.

## Validator rules (parse-time)

The parser raises one issue per violation, accumulates them, and throws
on first parse if any issue is `block`-class:

| Code | Severity | Rule |
|---|---|---|
| `guardrail_unknown_frontmatter_key` | block | unknown YAML key in frontmatter |
| `guardrail_missing_required_field` | block | required field absent |
| `guardrail_field_not_allowed_for_event` | block | field name disallowed for event |
| `guardrail_tool_not_allowed_for_event` | block | tool field on event-only rule |
| `guardrail_invalid_operator` | block | operator name not in enum |
| `guardrail_invalid_event` | block | event name not in enum |
| `guardrail_invalid_action` | block | action not warn or block |
| `guardrail_invalid_scope` | block | scope not runtime-tool-call or artifact-authoring |
| `guardrail_regex_missing_max_length` | block | regex operator without maxLength |
| `guardrail_regex_max_length_too_large` | block | maxLength > 65536 |
| `guardrail_regex_compile_error` | block | regex source invalid |
| `guardrail_duplicate_name` | block | two rules share `name` |
| `guardrail_priority_out_of_range` | warn | priority outside [0, 1000] |
| `guardrail_dedup_template_invalid` | warn | dedupKey template references unknown placeholder |

## Examples (deferred to docs/examples/guardrails/)

Three example rules ship under `docs/examples/guardrails/`:

- `block-rm-rf.md` — block-action runtime rule on `Bash` tool.
- `warn-console-log-in-prod-source.md` — warn-action runtime rule with
  multi-condition (file_path glob + new_content contains).
- `artifact-authoring-secret-leak.md` — artifact-authoring scope rule
  guarding REVIEW.md / BUILD_REPORT.md / SPEC.md against accidental
  inline secrets.

Examples are inert until the rule files are placed under `.code-oz/`.

## Out of scope for v0.1

- Auto-fix actions (only warn / block; no rewrite, no patch).
- Cross-file matching (each event evaluates one input).
- Aggregation across runs (dedup is per-run).
- Operator overrides via env var (intentionally absent — disable in the
  rule file and re-run).
- Plugin marketplace integration of rules (rule-9 boundary stays inside
  the project).
- Wire-in to the tool-call wrapper (separate slice; gated on Codex's
  post-implementation review of this contract).

## Predecessors and references

- `~/Projects/agents/templates/claude-code/plugins/hookify/core/{config_loader.py,rule_engine.py}`
  — typed-condition matcher engine, source of the multi-condition AND
  pattern (`plugins/hookify/core/config_loader.py:15-73`,
  `plugins/hookify/core/rule_engine.py:120-253`).
- `~/Projects/agents/templates/claude-code/plugins/security-guidance/hooks/security_reminder_hook.py`
  — block-capable PreToolUse hook (lines 271-273), source of the
  fail-closed posture rather than the hidden state file.
- `docs/comparisons/claude-code/COMPARISON.md` §4.2 / §4.6.
- `docs/comparisons/claude-code/CODEX_RESPONSE.md` §2 B2, §3.4, §3.5,
  §4.1, §4.2.
- `docs/comparisons/claude-code/SYNTHESIS.md` §1.3, §1.4, §1.5.
- `CLAUDE.md` rule 9 (default-deny configuration), rule 20 (one new
  authority boundary per milestone), rule 13 (privacy by default), rule
  19 (run-level budget enforcement — guardrail evaluation cost is
  bounded per the per-rule timeout and `maxMatchesPerRun` cap).
