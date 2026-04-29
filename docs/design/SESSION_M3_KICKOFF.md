# code-oz — M3 session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else.

## State at start of M3

- **Repo:** `github.com/omerakben/code-oz`, branch `main`
- **Last release:** `v0.2.0-alpha.0` (M2 — Markdown agent loader + 5 default personas)
- **Tests:** 120 passing, offline, ~200ms
- **Binary:** `bun run build:binary` produces `dist/code-oz` (~61 MB), reports `0.2.0-alpha.0`
- **What works:**
  - `code-oz init` scaffolds `.code-oz/` with greenfield/brownfield auto-detection (M1)
  - `src/agents/` parses, validates, loads, and registers agent files; bundled defaults wired via Bun asset imports; cross-family REVIEW enforcement live at agent-load time (M2)
  - `src/agentpacks/schema.ts` ships the type-only forward-compat manifest surface
- **What's still stubbed:** `code-oz run` and `code-oz doctor` exit non-zero pointing at this milestone (run) or M4 (doctor).

## Template references (read-only via `/add-dir`)

M3 borrows patterns from `maestro` (file-based gate signals, intervention discipline) and continues to lean on `agent-skills` for the persona format from M2. **Code stays referenced; specs get pinned.**

**Pinned canonical specs (read these first):**

- [`docs/references/file-based-gates.md`](../references/file-based-gates.md) — full gate-class taxonomy (NEEDS_INTERVENTION, PAUSE, STOP, GATE_<PHASE>_PASSED, events.jsonl, current.json), schemas, validation rules, integrity bindings, and anti-patterns. **Authoritative for M3.**
- [`docs/references/agent-skill-format.md`](../references/agent-skill-format.md) — frontmatter + persona format from M2. M3 doesn't change it but reads it to know how `agent.provider` and `agent.permissions` thread into the event log.

**Live templates (read-only, `/add-dir` only when you need an example beyond the pinned specs):**

- `~/Projects/agents/templates/maestro` — pinned at upstream commit `3672a635e716338a2d89812ff1bfe6f7bc381824` (2026-04-29). Source for the file-based-gate discipline. Useful files: `orchestrator/orchestrator.sh` (lines 209–249 are the file-existence checks), `orchestrator/README.md` (intervention flow), `CLAUDE.md` (the v1-failure-mode story for why text parsing was rejected).
- `~/Projects/agents/templates/agent-skills` — same pin as M2 (`19e49a094d79540e635b107cb3490926ddeac7a3`).

**Rules for using templates** (carried over from M2):

1. Open via `/add-dir <path>`. Do not `cp`, do not symlink, do not add as a submodule.
2. Do not modify the upstream — they are different git repos with their own drift.
3. If you discover a contract worth pinning that isn't in the references docs yet, **extract it into `docs/references/` in the same commit.** Do not let the kickoff cite live template files for canonical decisions.

## Deep-dive: what maestro contributes to M3

(Pre-extracted by the prior session so M3 doesn't re-discover.)

| Maestro pattern | M3 adopts directly | M3 extends |
|---|---|---|
| File-based gates only — never parse LLM text | ✓ rule 1 | — |
| Three intervention gates: `NEEDS_INTERVENTION`, `PAUSE`, `STOP` | ✓ same names | Structured JSON schemas instead of plain text |
| `.claudeignore` isolation — agents don't read orchestration internals | ✓ as `.code-ozignore` | Default template ships in M1; M3 adds runtime enforcement |
| Implicit phase sequence in shell | — | `code-oz` uses a typed FSM in `src/state/machine.ts` |
| Per-cycle session logs (separate JSON files) | — | `code-oz` uses a single append-only `events.jsonl` |
| Cycle-based "fresh start" resume | — | `code-oz` resumes at the last passed gate (rule 12) |
| `state.json` mutable single source of truth | — | `code-oz` derives `current.json` from `events.jsonl` |

The columns matter: M3 inherits the **discipline** from maestro (the no-text-parsing pattern, the intervention gate names) and **departs** on the storage model (event log + derived state vs. mutable `state.json`). Departures are documented in `docs/references/file-based-gates.md`.

## Your task — M3: phase machine, event log, and gate files

Canonical scope: `docs/design/ROADMAP.md` § M3. ADR alignment: `docs/adr/0001-mvp-option-e.md`.

**Files to create (per the ROADMAP):**

```text
src/state/
  machine.ts       # typed FSM owning legal phase transitions
  events.ts       # append-only events.jsonl writer + reader, schema-validated
  gates.ts        # GATE_<PHASE>_PASSED.json + intervention gate schemas
  run.ts          # runId + current.json reducer over events
  schemas.ts      # shared types (PhaseEvent, GateFile, RunState)
src/commands/
  approve.ts      # `code-oz approve <PHASE>` writes GATE_<PHASE>_PASSED.json
docs/contracts/
  GATES.md        # human-readable contract reference linking to docs/references/file-based-gates.md
tests/
  state-machine.test.ts
  gates.test.ts
```

Plus, almost certainly:

- `tests/events.test.ts` — append-only invariants, atomic write behavior, schema validation
- `tests/run.test.ts` — current.json reducer correctness across event sequences
- `tests/commands-approve.test.ts` — `code-oz approve` end-to-end
- `tests/fixtures/state/` — sample event logs and gate files for the regression suite

**Acceptance criteria (from the ROADMAP):**

- No phase advances by parsing LLM text. Gate files are the only source of truth.
- `code-oz approve DEFINE` writes a schema-valid `state/GATE_DEFINE_PASSED.json` and emits a `gate_written` event.
- The event log records all transitions and (when M4 lands) provider calls. The schema must accommodate provider-call events even though M3 doesn't generate them.
- Resume works: terminal death after PLAN must not restart DEFINE. The next `code-oz run --runId <id>` reads gate files and `events.jsonl`, picks up where the run left off.
- `bun test` passes offline. `bun run typecheck` clean. M1 + M2 regression suites unchanged.

**What's NOT in M3:**

- Provider integration (M4). M3 leaves a clean integration point — the event types support `agent_invoked` / `agent_completed` — but no `IAgentProvider` implementation lands in M3.
- DEFINE phase logic (M5). M3 must let `code-oz approve DEFINE` write the gate, but it does not implement BA persona invocation, ask-me flow, or `SPEC.md` generation.
- `requestReview()` (M7).
- Worktree creation, patch application (M7).

## Open design questions (input for `CODEX_BRIEFING_M3.md`)

These are the high-leverage decisions the planning round must converge on. Each is a debate prompt structured the same way as M2's: **lean + reasoning + counter-argument I'm aware of**.

1. **State machine: typed FSM library or hand-rolled discriminated union?** XState is the idiomatic choice but ships a runtime; a hand-rolled `type Phase = 'define' | ... ` plus a `transition()` function is ~40 lines and adds zero deps. Mirrors M2's zod-vs-hand-rolled trade. Lean: hand-rolled, same reasons as M2 (single-file binary weight, simple shape, custom diagnostics).

2. **Event log atomicity: append + fsync per event, or buffered batches?** Per-event fsync is safe but slow if M5+ generates 100s of events per phase. Batched is fast but a crash mid-batch loses recent events. Lean: per-event fsync for v0.1 (correctness over throughput; agentic flows are bounded turn-counts, not high-frequency).

3. **`runId` generation: ULID, UUIDv7, or timestamped slug?** ULID has lexicographic time-ordering and a fixed length — useful for `state/runs/01J3Z.../` directory naming. Lean: ULID. Counter: an extra dep (`ulid` package). Counter to the counter: `Bun.randomUUIDv7()` is built in — switch to UUIDv7 if it's there.

4. **`code-oz approve <PHASE>` UX: positional arg, interactive prompt, or auto-detect from current.json?** Lean: positional with auto-detect fallback. `code-oz approve` (no arg) reads `current.json`, infers the next phase to approve, and prompts the user to confirm; `code-oz approve PLAN` skips the inference. Counter: too magic — explicit-only is easier to reason about.

5. **Gate file integrity binding via `artifactSha256`: required or optional?** Required catches the "I edited SPEC.md after approving" silent-corruption class. Optional makes manual gate-writing tests easier. Lean: required for the success gates `GATE_<PHASE>_PASSED.json`; optional for `current.json` (which is derived). Counter: required will fail on `mtime`-only-changed files in editors that touch the file without changing content — but sha256 is content-only, so this isn't a real concern.

6. **Resume granularity: at the gate (phase boundary) or at any event?** Resume-at-gate is simpler (replay events from the last `GATE_<PHASE>_PASSED.json`). Resume-at-event is finer-grained (replay every event since the last write). Lean: gate-boundary for v0.1. Phases are cheap enough to re-enter; finer resume is a v0.2 optimization. Counter: long BUILD phases (M7 has worktree+patch ops) might benefit from sub-phase resume.

7. **`current.json` rebuild: on every event, or on phase boundary only?** Lean: on phase boundary only — at every `phase_entered` and `phase_exited` event. Reduces I/O. Counter: stale `current.json` between events confuses `code-oz status`. Counter to the counter: events.jsonl is authoritative; status can scan recent events if the user wants the live view.

These six prompts are the substance of `CODEX_BRIEFING_M3.md`. Add them; the planning round adds verdicts.

## Cross-model peer review (rules 7–10 in CLAUDE.md, non-negotiable)

Same process as M2 — `gpt-5.5` at `xhigh` effort, `sandbox: read-only`, via `mcp__plugin_agent-codex_codex-native__codex`. Three rounds.

### Step 1 — Planning (before any code)

1. Read `CLAUDE.md`, `docs/design/ROADMAP.md` § M3, `docs/adr/0001-mvp-option-e.md`, `docs/references/file-based-gates.md`, `docs/references/agent-skill-format.md`.
2. Sketch the M3 design (state machine module shape, event types, gate writer logic, run resume algorithm, fixture strategy, test plan).
3. Write `docs/design/CODEX_BRIEFING_M3.md` with the six debate prompts above plus any new ones the design surfaces.
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
   Capture Codex's reply, save as `docs/design/CODEX_RESPONSE_M3.md`.
5. Synthesize. Append the synthesis to the response file (mirrors M2 pattern). Present to Ozzy. **Do not start coding until Ozzy approves the synthesis.**

### Step 2 — Implementation

1. Create branch `feat/m3-state-machine` from `main`.
2. Implement per the synthesized plan in atomic commits (M2 had 7; M3 will probably be 6–8).
3. `bun test` and `bun run typecheck` clean before each commit.
4. Don't expand scope: M4 (providers), M5 (DEFINE), M7 (build/verify/review) are not in M3.

### Step 3 — Codex review

1. Once tests pass and typecheck is clean, invoke Codex review with `sandbox: read-only` against the new commits.
2. Codex returns one of `push` / `fix-first` / `debate-required`.
3. **Per the durable rule (`feedback_no_tech_debt.md`): all `block-push` AND `block-next-milestone` findings get addressed in the same milestone before tag, never deferred.** Only `nit` and `fyi` severity findings can defer without explicit approval.
4. Re-review on the fix commits.

### Step 4 — Tag and push (after Ozzy explicit approval)

1. Merge `feat/m3-state-machine` to `main` with `--no-ff`.
2. Tag `v0.3.0-alpha.0` with annotated message + Codex audit trail link.
3. Push main and tag.
4. `gh release create v0.3.0-alpha.0` with M3-themed release notes.

## Don't

- Don't bypass the Codex rounds. The rule is durable, not optional.
- Don't push to `main` without a tag.
- Don't implement M4+ scope (provider calls, DEFINE/PLAN/BUILD phase machinery).
- Don't parse agent stdout for gate transitions. Read `state/GATE_*` files only.
- Don't use mutable `state.json` as the source of truth (maestro's pattern). Use `events.jsonl` as canonical and derive `current.json`.
- Don't introduce live-provider deps. M3 is pure orchestration state.
- Don't use `git add -A` or `git add .` — stage specific files.
- Don't `git commit --amend` — global rule requires new commits for fixes.
- Don't push without explicit user approval.
- **Don't carry tech debt across the milestone tag.** Per `feedback_no_tech_debt.md`: close every Codex review finding except `nit`/`fyi` before tag.

## First commands to run

```bash
cd ~/Projects/code-oz
git status                       # confirm clean tree on main
git log --oneline -5             # confirm v0.2.0-alpha.0 is HEAD
bun test                         # confirm 120/120 still pass
bun run dev --version            # should report 0.2.0-alpha.0
git switch -c feat/m3-state-machine   # only after planning + Codex debate approved
```

Resume reading from `CLAUDE.md` rules 1, 7–10 (the gate-mechanism rule and the cross-model peer review rules), `docs/references/file-based-gates.md` (the canonical contract), and `docs/design/ROADMAP.md` § M3.

## Loose threads from M2 to remember

These are noted in commit messages but worth surfacing here so the M3 session catches them:

- **Tree-shaking of `loadBundledDefaults`.** M2 commit `fae4064` flagged that `src/agents/bundled-defaults.ts` is not yet imported by the CLI, so Bun's tree-shaking will drop the asset imports from the compiled binary. M3 needs at least one CLI command that calls `loadBundledDefaults()` to keep the embed alive. `code-oz approve` is a candidate (it uses the registry to look up the agent that produced the artifact). Verify after M3 builds: `dist/code-oz` size should grow slightly to reflect the embedded markdown.
- **Permissions semantics during M4 wiring.** `docs/references/agent-skill-format.md` §"Permissions semantics" pins that `read: '*'` is an upper bound, not a glob expansion. M3 establishes the event log; M4 will issue provider calls and must check file manifests against `permissions.read` before sending. M3 design choices that matter here: the `agent_invoked` event should carry the file manifest (paths sent), so M4's permission check has an audit trail.
