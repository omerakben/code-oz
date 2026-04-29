# code-oz — M3 Codex briefing

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M2 shipped (`v0.2.0-alpha.0`, seven commits + two fix commits, 120 tests passing offline). M3 is the next milestone: the typed phase machine, append-only event log, and file-based gate writers.

The scope is locked by the kickoff doc. You are not debating *what* to build — you are debating *how* to build it. I have leans on nine decisions. Push back hard where my leans are wrong; confirm fast where they are fine. Where you confirm, sanity-check rather than rubber-stamp.

---

## What you should already have read

- `CLAUDE.md` — non-negotiable rules 1–14 plus the cross-model peer review rules 7–10. Rules 1, 7, 12 are the tightest constraints on M3.
- `docs/design/ROADMAP.md` § M3 (lines 94–96) — files to create + acceptance criteria.
- `docs/design/SESSION_M3_KICKOFF.md` — full M3 task description, the deep-dive table on what maestro contributes, and the seven pre-drafted debate prompts I am extending here.
- `docs/references/file-based-gates.md` — the **authoritative pinned spec** for gate-class taxonomy, JSON schemas, validation rules, the integrity binding via `artifactSha256`, and the append-only `events.jsonl` contract. M3 implements this spec verbatim.
- `docs/references/agent-skill-format.md` — the M2 frontmatter spec, especially the "Permissions semantics: upper bound, not glob expansion" section. Load-bearing for M3's `agent_invoked` event design.
- `docs/adr/0001-mvp-option-e.md` — the MVP scope decision M3 implements the next slice of (state machine + event log + gates per refinement #3 of the ADR).
- `docs/design/CODEX_RESPONSE_M2.md` — the M2 response file. Useful as format reference for what your reply should look like.

You do not need to read the M2 source. M3 is additive.

---

## What's locked (not up for debate)

These come from the kickoff and the non-negotiable rules. Do not reopen them.

1. **Gate-file taxonomy is locked.** Five gate-class files: `NEEDS_INTERVENTION.json`, `PAUSE.json`, `STOP.json`, `GATE_<PHASE>_PASSED.json`, `events.jsonl`, plus the derived `current.json`. Schemas are pinned in `docs/references/file-based-gates.md`. M3 implements those schemas; it does not redesign them.
2. **Event log is canonical; `current.json` is derived.** Maestro's mutable `state.json` pattern is explicitly rejected by the spec (rule 1 + ADR refinement #3). M3 must use `events.jsonl` as the source of truth.
3. **No phase advances by parsing LLM text.** Rule 1, hard fail. The orchestrator advances only by reading and validating gate files.
4. **File layout is locked.** Files to create are exactly what the kickoff lists: `src/state/{machine,events,gates,run,schemas}.ts`, `src/commands/approve.ts`, `docs/contracts/GATES.md`, plus the four test files.
5. **No live provider deps in M3.** Pure orchestration state. M4 lands `IAgentProvider`; M3 does not.
6. **Tests must be offline.** `bun test` cannot touch network or real provider auth. M3 is pure state — no provider calls anywhere.
7. **Bun + TypeScript stack.** Don't propose Node, Deno, or pnpm.
8. **Hand-rolled validation pattern from M2 carries forward.** M2 chose hand-rolled YAML/schema validation over `zod`/`valibot` (single-file binary weight, custom diagnostics, future `NEEDS_INTERVENTION.json` shape). M3 uses the same pattern — typed errors with `{ file, code, rule, detail }` issue arrays. Don't propose `zod` for M3's JSON schemas.

---

## M3 acceptance summary (from kickoff)

- No phase advances by parsing LLM text. Gate files are the only source of truth.
- `code-oz approve DEFINE` writes a schema-valid `state/.../GATE_DEFINE_PASSED.json` and emits a `gate_written` event.
- The event log records all transitions and (when M4 lands) provider calls. The schema must accommodate provider-call events even though M3 doesn't generate them.
- Resume works: terminal death after PLAN must not restart DEFINE. The next `code-oz run --runId <id>` reads gate files and `events.jsonl`, picks up where the run left off.
- `bun test` passes offline. `bun run typecheck` clean. M1 + M2 regression suites unchanged (120 tests stay green).
- The compiled binary `dist/code-oz` continues to embed bundled persona defaults (M2 deferred liveness — M3 must wire `loadBundledDefaults()` into a CLI path so Bun's tree-shaker doesn't drop the asset imports). `code-oz approve` is a candidate hook — see prompt 4.

---

## My proposed design (the thing to debate)

### Module shape

```text
src/state/
  schemas.ts        # shared types: Phase, Profile, PhaseEvent, GateFile, RunState, ULID guard
  machine.ts        # typed FSM: legalTransition(from, profile) -> Phase | null; isTerminal()
  events.ts         # EventLog class: append (per-event fsync), readAll, validateOnAppend
  gates.ts          # writeGate / readGate; sha256 artifact integrity binding; GateLoadError
  run.ts            # Run class: runId, writeEvent, loadCurrent (reduce events -> RunState)
  errors.ts         # GateLoadError, EventLogError shaped like AgentLoadError from M2
src/commands/
  approve.ts        # `code-oz approve <PHASE>`; uses registry (keeps loadBundledDefaults alive)
docs/contracts/
  GATES.md          # human-readable summary linking to docs/references/file-based-gates.md
tests/
  state-machine.test.ts
  events.test.ts
  gates.test.ts
  run.test.ts
  commands-approve.test.ts
  fixtures/state/
    valid/
      greenfield-define-passed/    # events.jsonl + GATE_DEFINE_PASSED.json
      brownfield-audit-passed/
      mid-plan-resume/
    invalid/
      sha256-mismatch.json
      malformed-event-line.jsonl
      illegal-phase-jump.jsonl
      missing-runid.json
```

### On-disk layout

```text
.code-oz/state/
  active.json                       # { runId } pointer to active run (single-active-run for v0.1)
  runs/
    01J3Z...ULID/
      events.jsonl
      current.json                  # derived; rebuilt on phase boundary only
      GATE_DEFINE_PASSED.json
      GATE_PLAN_PASSED.json
      ...
      NEEDS_INTERVENTION.json       # optional
      PAUSE.json                    # optional
      STOP.json                     # optional
```

Per-run subdirectory (prompt 8 below) — keeps multi-run history clean and mirrors how worktrees-per-run will work in M7.

### Type sketches

```ts
// schemas.ts
export type Phase = 'define' | 'plan' | 'build' | 'verify' | 'review' | 'ship' | 'audit';
export type Profile = 'greenfield' | 'brownfield';

export const GREENFIELD_SEQUENCE = ['define','plan','build','verify','review','ship'] as const;
export const BROWNFIELD_SEQUENCE = ['audit','plan','build','verify','review','ship'] as const;

export type PhaseEvent =
  | { type: 'run_started';     ts: string; runId: string; profile: Profile }
  | { type: 'phase_entered';   ts: string; runId: string; phase: Phase }
  | { type: 'phase_exited';    ts: string; runId: string; phase: Phase; outcome: 'passed'|'failed'|'paused' }
  | { type: 'agent_invoked';   ts: string; runId: string; phase: Phase; agent: string; provider: string; manifest?: readonly string[] }
  | { type: 'agent_completed'; ts: string; runId: string; phase: Phase; agent: string; tokensUsed?: number }
  | { type: 'gate_written';    ts: string; runId: string; phase: Phase; file: string }
  | { type: 'gate_required';   ts: string; runId: string; phase: Phase; blockedOn: string }
  | { type: 'intervention';    ts: string; runId: string; code: string; phase?: Phase }
  | { type: 'run_ended';       ts: string; runId: string; outcome: 'shipped'|'stopped'|'paused' };

export type GateFile = {
  version: 1;
  runId: string;
  phase: Phase;
  artifact: string;
  artifactSha256?: string;          // optional in spec; prompt 5 asks if M3 should require for success gates
  agent: string;
  agentProvider?: string;
  approvedBy: string;
  approvedAt: string;
  notes?: string;
};

export type RunState = {
  version: 1;
  runId: string;
  profile: Profile;
  currentPhase: Phase;
  phasesCompleted: readonly Phase[];
  lastEventAt: string;
};
```

`AgentRegistry` from M2 is consumed read-only by `approve.ts` to look up the agent that produced the artifact (so the gate file can record `agentProvider`). This keeps the bundled-defaults asset imports alive in the compiled binary (closes the M2 commit `fae4064` deferred-liveness loose thread).

### My nine leans (the prompts)

For each: lean + reasoning + counter-argument I'm aware of. You either agree with sanity-check, disagree with a specific better path, or flag a third option.

#### 1. State machine: typed FSM library or hand-rolled discriminated union?

**Lean: hand-rolled.** XState is the idiomatic choice but ships a runtime; a hand-rolled `type Phase = 'define' | ...` plus a `transition(current, profile)` function is ~40 lines, adds zero deps, and mirrors the M2 zod-vs-hand-rolled trade. The compiled binary already pays for the bundled defaults; we don't need another runtime in there.

**Counter:** XState gives you visualization, parallel states, history nodes, and a community of patterns. Hand-rolling means no diagrams, no introspection, no community-supplied edge cases. If M5+ gets complex (sub-phase loops in REVIEW with bounded retries), we'll wish we had it.

**Push back if** XState's runtime cost is overstated for `bun build --compile`, or if there's a third option (e.g., `robot3` at ~2 KB, or a pure-data transition table validated at boot).

#### 2. Event log atomicity: append + fsync per event, or buffered batches?

**Lean: per-event fsync for v0.1.** Correctness over throughput. Agentic flows are bounded turn-counts (tens to low hundreds of events per run), not high-frequency telemetry. A crash mid-batch would lose events that may include `gate_written` — the resume-correctness blast radius is too high to optimize prematurely.

**Counter:** even bounded turn-counts hit IO if M5+ generates 100+ events per long phase; per-event fsync on macOS HFS+/APFS is single-digit-millisecond per call but compounds. Batched writes with a `process.on('exit')` flush handler give you near-write throughput with bounded loss windows.

**Push back if** there's a Bun-specific atomic-append primitive that gives durability without the fsync cost (e.g., `Bun.write` with append flag — does it fsync?), or if batched-with-flush-on-phase-boundary is the right v0.1 default.

#### 3. `runId` generation: ULID, UUIDv7, or timestamped slug?

**Lean: UUIDv7 via `Bun.randomUUIDv7()`.** Bun has it built in, no dep. Lexicographic time-ordering for free. 36-char hyphenated string is fine for directory names. No `ulid` package tax.

**Counter:** ULID's 26-char Crockford base32 is shorter, case-insensitive-friendly for filesystems, and the lexicographic ordering is the same property. UUIDv7 is widely supported but newer; some downstream tooling (loggers, dashboards) handle UUIDv4 better than v7. ULID is the more battle-tested choice for human-readable run identifiers.

**Push back if** `Bun.randomUUIDv7()` has a known gotcha (e.g., availability in compiled binaries, monotonicity guarantees), or if 36-char directory names will bite us in `state/runs/<runId>/` paths.

#### 4. `code-oz approve <PHASE>` UX and validation depth

**Lean: positional with auto-detect fallback, plus FSM legality check.** `code-oz approve` (no arg) reads `current.json`, infers the next phase to approve, prompts the user to confirm; `code-oz approve PLAN` skips the inference. Either way, `approve` calls `machine.transition()` to verify the user is approving the *current* phase (not skipping ahead, not approving a prior gate twice). On illegal transition, throw a typed `GateLoadError` with a rule message naming the expected phase.

**Counter:** explicit-only is easier to reason about; the auto-detect adds magic that some users won't trust. And the FSM check couples `approve.ts` tightly to `machine.ts` — should `approve` be a thin file writer, with FSM enforcement living in the `run` orchestration that consumes the gate file (M5+)?

**Push back if** auto-detect is footgun-prone, or if the FSM check belongs in `run` not `approve`. Also: where does the registry-keepalive happen — in `approve` directly, or in a shared CLI bootstrap that all commands import (so M5+ commands inherit the keepalive)?

#### 5. Gate file integrity binding via `artifactSha256`: required or optional?

**Lean: required for the success gates `GATE_<PHASE>_PASSED.json`; optional for `current.json` (which is derived).** Required catches the "I edited SPEC.md after approving" silent-corruption class. The spec doc has `artifactSha256` listed as optional — M3 tightens this to required for the durable success gates while keeping the spec wording intact (the spec describes what the schema accepts; M3's runtime can enforce stricter rules at write time).

**Counter:** required will hurt manual gate-writing in tests (every fixture must compute and pin a sha256) and on user systems where editors `touch` files without changing content. But sha256 is content-only, not mtime-based — the editor-touch concern is a non-issue.

**Push back if** required is too rigid for v0.1 ergonomics (especially for fixture authoring), or if the spec doc itself should be updated to make `artifactSha256` required (rather than M3 enforcing strictness over a permissive spec — clean spec/runtime alignment).

#### 6. Resume granularity: at the gate (phase boundary) or at any event?

**Lean: gate-boundary for v0.1.** Replay events from the last `GATE_<PHASE>_PASSED.json`. Phases are cheap enough to re-enter; finer-grained resume is a v0.2 optimization. M5–M7 phases are bounded (one ask-me transcript, one PLAN.md, one BUILD-lite atomic task) — resuming mid-phase doesn't save meaningful work in v0.1.

**Counter:** long BUILD phases in M7 (worktree creation + patch application) might benefit from sub-phase resume — if BUILD crashes after the worktree exists but before the patch applies, gate-boundary resume re-creates the worktree from scratch. Sub-phase markers (e.g., `phase_checkpoint` events) are cheap to add to the schema now.

**Push back if** event-level resume is cheap to design now and saves a v0.2 schema bump, or if there's a halfway design (gate-boundary resume + a discrete `phase_checkpoint` event type) that closes the gap.

#### 7. `current.json` rebuild: on every event, or on phase boundary only?

**Lean: on phase boundary only — rebuild at every `phase_entered` and `phase_exited` event.** Reduces I/O. The event log is authoritative; `current.json` is the convenience read for `code-oz status`. If a user wants the live in-phase view, status can scan recent events.

**Counter:** stale `current.json` between events confuses `code-oz status` and any external tool watching the file (a future TUI, a Slack bot polling the run). Writing `current.json` on every event is one extra `Bun.write` per event — cheap relative to the fsync on `events.jsonl`.

**Push back if** the cost calculus flips when fsync is per-event (since `current.json` write cost is now small relative to events.jsonl), or if there's a cleaner pattern (write-on-every-event but to a shadow file, atomic-rename only on phase boundary).

#### 8. On-disk layout: `state/runs/<runId>/` per-run subdirectory, or flat `state/` with runId in filename?

**Lean: per-run subdirectory.** Multi-run history is clean (`ls state/runs/` shows all past runs). Gate, event, intervention, and current files for a single run live together (good for forensics and zip-and-share telemetry bundles in W4). Mirrors how worktrees-per-run will work in M7. `state/active.json` (or a symlink) names the active run.

**Counter:** flat layout with runId-in-filename (`state/01J3Z...events.jsonl`, `state/01J3Z...GATE_DEFINE_PASSED.json`) is simpler — no directory scaffolding, fewer mkdir calls, easier `find`/`grep` across runs. The reference spec doc uses generic `state/GATE_<PHASE>_PASSED.json` paths, leaving multi-run layout undefined.

**Push back if** flat is the right v0.1 default (single-active-run is the dominant use case), or if there's a hybrid (flat for active, archive to `runs/` on completion).

#### 9. `agent_invoked` schema slot for M4 file manifest: include in M3, or defer?

**Lean: include `manifest?: readonly string[]` as an optional field on `agent_invoked` events in M3.** The M2 Codex review's `block-m3` finding flagged that M3 establishes the audit trail M4 will fill: "M3 design choices that matter here: the `agent_invoked` event should carry the file manifest (paths sent), so M4's permission check has an audit trail." Adding the optional slot now means M4 doesn't need a schema migration. Mirrors the M2 pattern of forward-compat types in `agentpacks/schema.ts`.

**Counter:** YAGNI — leaving `manifest` out keeps M3 minimal and forces M4 to think about it deliberately. If we get the field shape wrong in M3 (e.g., should it be `manifest: { read: string[]; write: string[] }` instead of a flat array?), M4 has to either live with the wrong shape or do the migration anyway.

**Push back if** the optional slot's shape is wrong (flat vs. typed-by-permission-axis vs. {path, sha256} entries for content integrity), or if the `agentpacks/schema.ts` pattern from M2 doesn't actually generalize to event schemas (where forward-compat is harder because old events live forever in the log).

---

## How to reply

Four sections. Be terse. No hedging. If you'd recommend a different structure, say so first.

1. **Where I agree (sanity-checked).** For each lean you confirm: one sentence on why my reasoning holds up under scrutiny, not just that you agree. If you only nod without checking, you are not earning your seat at this round.

2. **Where I disagree (with specific alternative).** For each lean you reject: the better path, concretely. Naming a library, a code shape, a rule, an API surface.

3. **What's missing.** Categories I haven't asked about that the M3 state machine + event log + gate writers still have to get right. Candidates I'm aware I haven't thought hard about:
   - Concurrency: two `code-oz` processes writing to the same `events.jsonl` (advisory file lock? nothing? rely on single-active-run invariant?)
   - Clock skew on `ts` fields: `Date.now()` is fine for ordering within a process but cross-process replay sorts by insertion order in the log, not `ts` — should the reducer use insertion order?
   - Schema versioning: `version: 1` is on every gate and `current.json` but not on individual `events.jsonl` lines — should it be?
   - Reading `events.jsonl` mid-write: is partial-line-tolerance a feature (return last N complete events) or a hard fail?
   - Crash during gate-file write: temp-file + atomic rename, or accept that a half-written `GATE_<PHASE>_PASSED.json` is detectable on next read via JSON parse failure?
   - `code-oz approve` emitting the `gate_written` event: who appends to `events.jsonl` — `approve.ts` or the gate-writer in `gates.ts`? Layering question.
   - Deletion semantics: `NEEDS_INTERVENTION.json` is "deleted by user to resume" per maestro; the spec doc says `code-oz` treats gate files as append-only artifacts of decisions ("To redo a phase, increment the runId"). Is delete-to-resume a contradiction or a special case for intervention gates only?
   - `.gitignore` policy for `.code-oz/state/runs/`: should generated state be git-ignored by default, or committed (so a team member can resume someone else's run)?
   - Test fixtures: how to author multi-event `events.jsonl` fixtures without hand-rolling sha256 hashes for every artifact reference (helper function in test util?).

   Tell me which of these matter for v0.1 and which can defer, and what I missed.

4. **Concrete M3 implementation order.** Six-to-eight file commits in the order you'd land them. Each commit self-contained, `bun test` + `bun run typecheck` clean before next. M2 had seven; M3 likely six to eight. Ground in the locked acceptance: gate writes are atomic, FSM rejects illegal transitions, events.jsonl is append-only, resume reads gate files and replays events, M1+M2 regression suites stay green.

The verdict at the end: `proceed-with-leans`, `proceed-with-modifications`, or `reopen-design`. Use the strongest verdict you can defend.
