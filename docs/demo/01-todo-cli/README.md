# code-oz demo — greenfield todo CLI

A 5-minute walkthrough of `code-oz` running one full DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle on a greenfield TypeScript project. The example builds a tiny todo CLI with `add | list | done` subcommands, ~50 LOC of source code, atomic file persistence.

The cycle runs offline via the `FakeProvider` (scripted persona responses). Every artifact code-oz produces — `SPEC.md`, `PLAN.md`, gate files, the `events.jsonl` ledger — is real, written by the orchestrator and validated by the same parsers that ship in production.

## Quick start

```sh
# Run the cycle at default effort (balanced)
bun run demo:todo-cli

# Run at a different effort level (scales budget envelope; assurance unchanged)
bun run demo:todo-cli --effort lite
bun run demo:todo-cli --effort beast
```

The runner creates a fresh tmp project (under `$TMPDIR`), runs `code-oz init`, drives the 11-invocation cycle, then copies the produced `events.jsonl` + gate files + artifacts back to `docs/demo/01-todo-cli/output/<effort>/`.

Outputs from the most recent runs are committed in this repo — you can read them without running anything:

```sh
cat docs/demo/01-todo-cli/output/balanced/artifacts/SPEC.md
ls docs/demo/01-todo-cli/output/balanced/gates/
tail -20 docs/demo/01-todo-cli/output/balanced/events.jsonl | jq -c .type
```

## What the cycle does, phase by phase

| # | Phase | Provider invocations | What gets written |
|---|---|---|---|
| 1 | DEFINE | BA emits `<spec-ready/>` + SPEC.md draft | `artifacts/SPEC.md`, `GATE_DEFINE_PASSED.json` |
| 2 | PLAN | Lead emits PLAN.md + SOURCE_CHECK.md; scientist tail emits HYPOTHESES + OPEN_QUESTIONS | `artifacts/PLAN.md`, `artifacts/SOURCE_CHECK.md`, `artifacts/HYPOTHESES.md`, `artifacts/OPEN_QUESTIONS.md`, `GATE_PLAN_PASSED.json` |
| 3 | BUILD | Builder emits a git-apply-clean diff creating `src/todo.ts` + `tests/todo.test.ts` | `artifacts/BUILD_REPORT.md` (orchestrator-authored), worktree commit, `GATE_BUILD_PASSED.json` |
| 4 | VERIFY | Validation command runs in the worktree; mutation gate revert + replay; verifier emits ready + rationale | `artifacts/VERIFY.md`, `GATE_VERIFY_PASSED.json` |
| 5 | REVIEW | Reviewer emits ready + score 8 (cross-family — BUILD ran on Claude family, REVIEW on Codex family) | `artifacts/REVIEW.md`, `GATE_REVIEW_PASSED.json` |
| 6 | SHIP | Cursor advances to `phase_entered(ship)` after T-001 approve-review | n/a (terminal) |

Between every phase, an explicit `code-oz approve <phase>` invocation binds the canonical artifact's sha256 into the gate file. The orchestrator never approves a phase the operator hasn't explicitly accepted.

## Four highlights the demo surfaces

### 1. File-based gate signals (CLAUDE.md rule 1)

Phase pass/fail signals live on disk, not in LLM text. `GATE_PLAN_PASSED.json` is the entire authority that PLAN completed:

```json
{
  "version": 1,
  "runId": "01KRC8EGW6REW6Q40H64PVQ0D3",
  "phase": "plan",
  "artifact": "PLAN.md",
  "agent": "lead",
  "agentProvider": "claude",
  "approvedBy": "user",
  "approvedAt": "2026-05-11T19:32:58.575Z",
  "artifactSha256": "6713ca303c288195ba43207b28b64258808f668d7d8b6001212c4041ca06ed6d"
}
```

The orchestrator validates that file with a schema before letting BUILD start. If `artifactSha256` no longer matches the disk content (someone edited PLAN.md between approval and BUILD), BUILD fails fast with a typed error.

### 2. Cross-family REVIEW (CLAUDE.md rule 2)

In `output/balanced/artifacts/REVIEW.md`:

```
## Reviewer

- Provider family: codex
- Provider id: codex
- Model policy: any
- Cross-family check: passed (BUILD family: claude; reviewer family: codex)
```

BUILD ran on the Claude family; REVIEW ran on the Codex family. The orchestrator's `M14 Reviewer panel` enforcement requires the cross-family check before letting any `verdict: ready` close a task. Same-family panelists are advisory only.

### 3. The `--effort` flag

A single flag scales `budgets.global` and `budgets.perPhase` uniformly across the run. Run-shape envelope captured at run start; cannot drift mid-run.

```sh
$ grep effort_envelope_applied output/lite/events.jsonl | jq -c '{effort, multiplier, maxTurns: .effectiveBudgets.global.maxTurns}'
{"effort":"lite","multiplier":0.4,"maxTurns":40}

$ grep effort_envelope_applied output/balanced/events.jsonl | jq -c '{effort, multiplier, maxTurns: .effectiveBudgets.global.maxTurns}'
{"effort":"balanced","multiplier":1,"maxTurns":100}

$ grep effort_envelope_applied output/beast/events.jsonl | jq -c '{effort, multiplier, maxTurns: .effectiveBudgets.global.maxTurns}'
{"effort":"beast","multiplier":6,"maxTurns":600}
```

The `effort_envelope_applied` event lands at position 2 of `events.jsonl`, immediately after `run_started` and before any `phase_entered`. Per CLAUDE.md rule 23, the flag MUST NOT change `maxReviewRounds`, panel slot count, mutation gate threshold, or any other assurance invariant — only scalable budget knobs.

### 4. Budget and event telemetry

Every interesting moment in the run is an event. The cycle produces ~50–70 events depending on effort level:

```sh
$ jq -r .type output/balanced/events.jsonl | sort -u
agent_completed
agent_invoked
ask_me_persona_reply
ask_me_user_input
build_completed
build_patch_applied
build_provider_recorded
build_started
debate_scheduler_evaluated
debate_scheduler_skipped
effort_envelope_applied
fake_provider_warning_emitted
gate_required
gate_written
hypothesis_added
phase_entered
phase_exited
question_added
review_resolved
review_round_completed
review_started
run_started
science_emitted
task_completed
task_review_passed
task_started
verify_completed
verify_started
worktree_created
worktree_destroyed
worktree_patch_applied
```

Each event carries enough context for an operator (or a downstream tool) to reconstruct the run after the fact. The `fake_provider_warning_emitted` event records every time `--provider fake` is active, so production telemetry pipelines can flag demos in their dashboards.

## What's real and what's simulated

| Aspect | Status in this demo |
|---|---|
| Orchestrator phase machine | **works today** — same code as production |
| Gate file writes + sha256 binding | **works today** — same parsers + atomic writes as production |
| Cross-family REVIEW enforcement | **works today** — actual `providerFamily` mismatch check |
| `--effort` flag + envelope event | **works today** — same `applyEffort` + event-order lock as production |
| Mutation gate revert + replay | **works today** — actual `git apply` + revert + replay |
| Persona responses | **simulated** — FakeProvider returns scripted JSONL responses, not live LLM output |
| Provider HTTP calls | **simulated** — no outbound network |
| `bun test` on the built todo CLI | **not run in the cycle** — PLAN's validation command is `test -f src/todo.ts` so the cycle is reproducible offline without a real test runner |

The runner is honest about this trade-off: the FakeProvider's responses are pre-canned so the demo is deterministic and offline. The cycle, the gates, the cross-family check, the mutation gate, and the event log are all real. Swap the FakeProvider for a real Anthropic / xAI / OpenAI provider and the same orchestrator runs against live LLMs.

## MCP trust-boundary contract (not run in this demo)

The `docs/contracts/MCP_TRUST_BOUNDARY.md` contract on `main` defines how a future MCP consumer would land in `code-oz`. Demand-gated: the contract ships now so a future implementation milestone can budget against it; nothing in this demo invokes MCP.

## Recording an asciicast

To capture this walkthrough as an asciicast for a recorded demo:

```sh
# Install asciinema if needed
brew install asciinema

# Record the full cycle at default effort
asciinema rec docs/demo/01-todo-cli/cast.cast \
  --command 'bun run demo:todo-cli --rm-tmp' \
  --title 'code-oz demo — greenfield todo CLI' \
  --idle-time-limit 2

# Play it back
asciinema play docs/demo/01-todo-cli/cast.cast
```

The runner's output is structured for asciicast clarity — each phase has a header, each invocation is preceded by an arrow + the exact CLI command, and each success is marked with a check. Total run time at default effort is ~10–15 seconds (FakeProvider has zero network latency); idle-time-limit caps each pause at 2 seconds so the playback feels snappy.

## What's next (post-demo, per locked synthesis § "Demo prep")

- Codex retrospective on the full 3-session + demo sweep (`docs/design/CODEX_RETRO_3SESSION_SWEEP.md`).
- Tag `v0.19.0-alpha.0` with explicit Ozzy approval; bump all 5 version-bearing surfaces per the v0.18-residue lesson.
- Demand-gated milestone slots already on the roadmap from the opencode comparison: `Candidate slot — Deny-dominant wildcard permission expressions (opencode B2)` and `Candidate slot — Cancellation, timeout, and debate-recursion guard (opencode M-CANCEL)`.

## Files in this directory

```
docs/demo/01-todo-cli/
├── README.md           # this file
├── SPEC.md             # the would-be DEFINE output for the todo CLI example
├── output/
│   ├── balanced/       # captured cycle at default effort
│   │   ├── artifacts/  # SPEC, PLAN, SOURCE_CHECK, BUILD_REPORT, VERIFY, REVIEW, HYPOTHESES, OPEN_QUESTIONS
│   │   ├── gates/      # GATE_DEFINE_PASSED, GATE_PLAN_PASSED, GATE_BUILD_PASSED, GATE_VERIFY_PASSED, GATE_REVIEW_PASSED
│   │   └── events.jsonl
│   ├── lite/           # captured cycle at --effort lite (multiplier 0.4)
│   └── beast/          # captured cycle at --effort beast (multiplier 6.0)

scripts/demo/01-todo-cli/
├── ARCHITECTURE.md     # runner design notes (pre-implementation lock)
└── run-demo.ts         # the runner (~560 LOC)
```
