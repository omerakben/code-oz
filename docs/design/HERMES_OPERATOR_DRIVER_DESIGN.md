# Hermes-drives-code-oz — external-operator driving (cut 1, Mid scope)

Status: design approved-in-shape (Ozzy, 2026-05-22); Codex planning debate converged
(thread `019e4fdf`, 3 rounds, R1 modify -> R2 modify -> R3 fix-first; all fix-first
edits folded in below). Target release: `v0.21.1-alpha.0`.

## Goal

Ozzy runs an agent-first assistant on his own machine (the OpenClaw ~300k-star /
Nous Hermes Agent class of tool). He wants to tell it "go use code-oz to build/fix X"
and have it pick up code-oz **as a tool and drive it**. The external agent is the
operator; code-oz stays the gated SDLC runtime. This is the reverse of the
half-started working-tree changes (which added `hermes` as a 6th provider *inside*
code-oz) — those are reverted (see Step 0).

Market context (2025-2026): autonomous self-hosted agents (OpenClaw, Hermes) drive
external tools three ways — bash/shell, the agentskills.io `SKILL.md` standard, and
MCP. Enterprises demand sandbox isolation, immutable audit logs, and
approval-before-execution (agent emits work, a human gates the irreversible step);
solo devs want autonomy. code-oz's file-gate + permission-manifest + event-log design
already speaks the enterprise dialect — the win is letting Hermes drive it *without*
letting an autonomous operator soften the gates.

## The authority boundary (rule 20)

This milestone introduces exactly one new authority boundary: **external-operator
driving authority** — who may drive the existing gate machine non-interactively, and
how that is recorded. It is NOT a new provider and NOT a new gate. SWE-bench remains
the separate v0.22 milestone. (Per Codex R2: this is a real boundary, not "hardening"
— it is named so rule 20 is not hollowed.)

## Non-goals / deferred (NOT this milestone)

- MCP server surface (`code-oz mcp serve`). Any MCP write path must route through the
  rule-1 advisory-request-file mechanism — real design work, deferred.
- Bundled executable resolver in the skill (supply-chain risk for auto-loading agents).
- Config-hash / assurance fingerprint across PLAN->REVIEW.
- `--request` cap/redact/delimit beyond existing rule-13 redaction; `--request-file`
  rejection; `approve --artifact` ban.
- Cross-run spend ledger (`.code-oz/state/operator-ledger.json`), per-operator quotas,
  cool-downs, concurrent-run refusal.

These are the Full-scope items; Mid deliberately excludes them. Residual risk for Mid
(weak-but-real provider, config drift, `--artifact` on non-SHIP gates, `--request-file`
surface) is **acceptable because SHIP is human-gated** and presents the full run
summary + review verdict before any irreversible action.

## Step 0 — Revert the provider detour (must precede Mid tests)

- Remove `hermes` from provider ids/families/capabilities: `src/providers/types.ts`,
  `src/providers/families.ts`, `src/providers/capabilities.ts`, `src/agents/schema.ts`.
- Remove `hermes` from `ProviderOverride` / `parseProviderOverride`:
  `src/cli/bootstrap.ts`, `src/commands/run.ts`; restore `tests/cli-provider-override.test.ts`.
- Delete `src/agents/defaults/hermes-builder.md`, `src/agents/defaults/hermes-reviewer.md`.
- Drop the `@tuel/code-oz` self-dependency from `package.json` (+ regenerate lockfile).
- Keep `template/hermes-agent/` out of the branch (gitignore or remove — it carries a
  nested `.git` and external/licensed material).

## Component 1 — Engine: external-operator mode

New flags on `run` and `approve`:
- `--operator <id>` — provenance. Validated as a bounded string `/^[A-Za-z0-9._:-]{1,64}$/`.
- `--non-interactive` — requires `--operator`. Fail-closed semantics below.

In `--non-interactive` mode:
1. **Ban fake** (the load-bearing REVIEW-softening guard). Reject explicit
   `--provider fake`, reject `--fake-script` (even with `CODE_OZ_TEST_FAKE_SCRIPT_OK`),
   reject the unregistered-provider path, AND reject the silent
   `defaultToFakeIfRequiredProvidersUnavailable()` fallback — fail with an actionable
   error rather than stubbing the reviewer. **Guard lives at the CLI external-operator
   boundary, NOT in `buildProviderRegistry`** (that function is the offline test seam —
   see rule-8 coexistence below).
2. **Block irreversible SHIP approval.** `approve --non-interactive ... ship` fails
   closed with "human approval required." Active-run continuation that lands on the
   SHIP phase under non-interactive emits the same message, not a generic
   "in progress." Push/merge are **skill-side prohibitions** in Mid — code-oz owns no
   push/merge command path today; any future engine SHIP/push command MUST inherit this
   guard.
3. **Approval surface is `approve`, never `run`.** `run` advances phases but NEVER
   writes an approval gate by itself (no hidden self-approval loop). The operator
   approves each reversible gate explicitly:
   `code-oz approve --non-interactive --operator <id> <phase>` may approve DEFINE/AUDIT,
   PLAN, BUILD, VERIFY, REVIEW **when the existing gate invariants pass**. The phase
   argument is **required** in non-interactive mode (no approving whatever phase is
   "current" against a stale operator view).
4. **Provenance.** `run_started.operator?: string`; gate file `approvedBy = "operator:<id>"`;
   `gate_written.approvedBy?: string` copied from the gate. Event `actor` stays
   `"orchestrator"` (rule 1 — writes remain orchestrator-owned).

### Chokepoints (where the guards live)

- Arg surface: `parseRunArgs` (`src/commands/run.ts`) and the `approve` parser
  (`src/commands/approve.ts`) — parse `--operator`/`--non-interactive`, require operator
  when non-interactive, reject explicit fake/fake-script when non-interactive, require
  explicit phase for non-interactive approve.
- Provider resolution: `runCommand` provider resolution (`src/commands/run.ts`) — reject
  if the fake fallback would fire in non-interactive mode. (Do NOT touch
  `buildProviderRegistry` in `src/cli/bootstrap.ts`.)
- SHIP block: `runApprove` (`src/commands/approve.ts`) after target-phase resolution,
  before gate validation; plus the active-run continuation paths in `src/commands/run.ts`.
- Provenance: optional `operator` on `run_started` and optional `approvedBy` on
  `gate_written` in `src/state/schemas.ts`, emitted from `completeTransitionForPhase`
  (`src/state/run.ts`); `actor` unchanged (`src/state/events.ts`).

## Component 2 — Skill: agentskills.io `SKILL.md` (text-only, no bundled script)

Ports the boundary language + workflow from the existing `plugins/code-oz` Claude Code
plugin into the agentskills.io standard so Hermes/OpenClaw can load it. Behavior:
- Prefer an installed `code-oz` on PATH; run `code-oz doctor` / `--version` first; if
  missing, stop with pinned install guidance. No `curl`/`npx`/`bunx` auto-install.
- Drive only via `code-oz run --operator <agent> --non-interactive --request "..."`,
  `code-oz approve --operator <agent> --non-interactive <phase>`,
  `code-oz resume` / `status` / `doctor`.
- Never write `.code-oz/`, gates, events, artifacts, or config. Never decide pass/fail.
  Never simulate cross-family review. Never use fake provider/script/`--artifact`,
  never push/merge/publish.
- Surface `NEEDS_INTERVENTION.json` / `PAUSE.json` / `STOP.json` / SHIP-required-human
  messages verbatim and stop.
- One active run at a time (advisory in Mid).

## Component 3 — Tests (RED-first, rule 22)

Offline (CI gate):
- `--non-interactive` without `--operator` is rejected.
- `--provider fake` rejected only in non-interactive; fake still works WITHOUT
  non-interactive (rule-8 guarantee preserved).
- `--fake-script` rejected in non-interactive even with the env flag set.
- Non-interactive provider resolution fails (no silent fake fallback) when required
  providers are unhealthy.
- `approve --non-interactive` requires operator, requires explicit phase, refuses
  `ship`, sets gate `approvedBy = "operator:<id>"`, emits `gate_written.approvedBy`.
- `run_started.operator` recorded.
- SKILL.md text contains the core prohibitions (mirrors the existing
  `tests/plugins/b4-acceptance.test.ts` pattern that asserts the wrapper forbids
  `.code-oz/` writes).

Live (on-demand, opt-in): a real Hermes/OpenClaw smoke driving a real code-oz run,
skipped by default (mirrors the existing `b4-trigger-eval` opt-in pattern).

### Rule-8 coexistence (the subtlety)

Rule 8 (FakeProvider runs the full lifecycle offline) and the fake ban coexist ONLY
because the ban is scoped to `--non-interactive`. Existing offline tests pass
`--provider fake` / `--fake-script` WITHOUT `--non-interactive`
(`tests/cli-run-args.test.ts`, `tests/e2e/cli-multi-task-cycle.test.ts`,
`tests/cli-provider-override.test.ts`) and must keep working. This is why the guard
lives at the CLI external-operator boundary, never in `buildProviderRegistry`.

## Commit sequence (RED-first)

1. Revert the detour (Step 0) — provider ids, personas, bootstrap/run/provider edits,
   override test, self-dep, lockfile; exclude `template/hermes-agent/`.
2. RED parser tests for `run` (the four V1 cases above).
3. Implement the `run` parser surface (`--operator`, `--non-interactive`, fake reject).
4. RED runtime-fallback test (non-interactive must fail, not silently use fake).
5. Implement the runtime fallback ban.
6. RED `approve` tests (requires operator + explicit phase, refuses ship, sets
   `approvedBy`, emits `gate_written.approvedBy`).
7. Implement `approve` + event provenance.
8. Add the text-only agentskills `SKILL.md` + the boundary-text check.

## Error handling

Every refusal is an actionable error (rule 11), not an opaque trace. Non-interactive
SHIP attempt -> "human approval required" + non-zero exit. Fake-in-non-interactive ->
names the banned flag and the reason (REVIEW assurance). Required-provider-unhealthy ->
names the unhealthy provider and the fix.

## Data flow

```text
Hermes -> code-oz run --operator hermes --non-interactive --request "..."
  -> engine runs phase, writes gates/events (actor:orchestrator, run_started.operator=hermes)
  -> Hermes reads stdout + gate files/events (read-only)
Hermes -> code-oz approve --operator hermes --non-interactive plan   (reversible: ok)
  ... repeat through REVIEW ...
Hermes -> code-oz approve --operator hermes --non-interactive ship   (FAILS CLOSED)
  -> "human approval required"
Human  -> code-oz approve ship   (interactive) + manual push
```
