# Demo runner architecture — 01-todo-cli

Pre-implementation design for `scripts/demo/01-todo-cli/run-demo.ts`. Written at the end of the push + step-1 session so the next session boots into authoring with a locked architecture.

## Goal

A single Bun TypeScript script that drives `code-oz` through one full DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle for the todo CLI example in `docs/demo/01-todo-cli/SPEC.md`. Shell-driven (asciinema can record it). Output captured to `docs/demo/01-todo-cli/output/`.

## Phase plan (10 CLI invocations)

| # | Command | Fake-script agents | Notes |
|---|---|---|---|
| 1 | `code-oz init` | — | Scaffold `.code-oz/` in tmp project |
| 2 | `code-oz run --request "<intent>" --provider fake --fake-script <path>` | `ba` | DEFINE — BA emits `<spec-ready/>` + SPEC.md (read from `docs/demo/01-todo-cli/SPEC.md`) |
| 3 | `code-oz approve define` | — | Gate writer binds SPEC.md sha256 |
| 4 | `code-oz run --provider fake --fake-script <path>` | `lead`, `scientist` | PLAN — Lead emits PLAN.md + SOURCE_CHECK.md; scientist tail |
| 5 | `code-oz approve plan` | — | Gate writer binds PLAN.md + SOURCE_CHECK.md sha256 |
| 6 | `code-oz run --provider fake --fake-script <path>` | `builder`, `scientist` | BUILD T-001 — Builder emits new-file diff for src/todo.ts + tests/todo.test.ts |
| 7 | `code-oz approve build` | — | Gate writer binds BUILD_REPORT.md sha256 |
| 8 | `code-oz run --provider fake --fake-script <path>` | `verifier`, `scientist` | VERIFY — runs validation command (`test -f src/todo.ts` in this demo), mutation gate revert+replay, verifier emits ready + rationale |
| 9 | `code-oz approve verify` | — | Gate writer binds VERIFY.md sha256 |
| 10 | `code-oz run --provider fake --fake-script <path>` | `reviewer`, `scientist` | REVIEW — reviewer emits ready + score 8 |
| 11 | `code-oz approve review` | — | Advances to SHIP, cursor.allCompleted=true |

(11 invocations total when counting `init` as #1; the body lists 11.)

Optional ascii-cast-friendly extras:
- `code-oz doctor run` after PLAN approval — shows projected state without provider invocation
- `cat .code-oz/state/runs/<runId>/GATE_PLAN_PASSED.json | jq` — surfaces a gate file
- `tail -10 .code-oz/state/runs/<runId>/events.jsonl | jq` — surfaces the event log

## Canned response authoring

Five custom canned responses tailored to the todo CLI SPEC (not the alpha/beta/gamma fixture). Each response must satisfy the parser at its target phase.

### 1. BA → SPEC.md

`<spec-ready/>\n` + content of `docs/demo/01-todo-cli/SPEC.md`. Already validated against `parseSpec`.

### 2. Lead → PLAN.md + SOURCE_CHECK.md

`<plan-ready/>\n` (`PLAN_READY_SIGNAL` from `src/phases/plan.ts`) followed by:

```markdown
# PLAN

## Goals

- Implement the todo CLI per SPEC.md acceptance criteria.

## Tasks

### T-001: Implement todo CLI add/list/done with atomic file persistence

- Files: src/todo.ts, tests/todo.test.ts
- Validation: true
- Risk: file corruption on concurrent writes (mitigated by atomic temp+rename).
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md acceptance criteria 1-6.

## Out of scope

- Delete subcommand; editing existing task text; interactive REPL; multi-list support.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: todo CLI feature surface

- Spec: SPEC.md ## Acceptance criteria, bullets 1-6
- Quote: bun run src/todo.ts add "Write the demo" writes todos.json with one entry whose id is 1...

## Reference sources

### SC-REF-NONE-001: No reference patterns required

- Searched: src/**/*.ts
- Result: 0 hits
- Why explicit: greenfield project; no prior file persistence patterns to reuse.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: Bun built-ins only (node:fs/promises, node:crypto); no third-party APIs.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
```

Validation note: must pass `parsePlan` and `parseSourceCheck`. Run `bun -e "..."` validation against current code before authoring further phases.

### 3. Builder → BUILD diff for src/todo.ts + tests/todo.test.ts

`<build-ready/>` (`BUILD_READY_SIGNAL`) + a fenced diff block + Title + Notes. Diff is a NEW-FILE diff (file does not exist in project):

```diff
diff --git a/src/todo.ts b/src/todo.ts
new file mode 100644
--- /dev/null
+++ b/src/todo.ts
@@ -0,0 +1,N @@
+import ...
+...
```

Plus a similar new-file diff for `tests/todo.test.ts`.

Diff generator helper (inside the runner):

```typescript
function newFileDiff(path: string, content: string): string {
  const lines = content.split('\n')
  const lineCount = lines.length
  const body = lines.map(l => `+${l}`).join('\n')
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lineCount} @@\n${body}`
}
```

The actual `src/todo.ts` and `tests/todo.test.ts` content live as string constants in the runner. The CLI implementation is ~45 LOC, tests ~30 LOC. Both target the SPEC.md acceptance criteria.

### 4. Verifier → VERIFY.md

`<verify-ready/>\n## Rationale\nvalidation command \`test -f src/todo.ts\` exited 0; mutation gate passed (reverted code fails the file check).\n` — short single-line rationale per `VERIFY_RATIONALE_MAX_CHARS = 200`.

**As-built note (post-Codex retro fix-first #1):** PLAN's validation command is `test -f src/todo.ts` (not `true` or `bun test`). The file-existence check makes the mutation gate non-tautological: when the BUILDER's patch is reverted, src/todo.ts is gone, the command exits non-zero, the gate concludes 'pass' (validation correctly detected the source-change). With the old `Validation: true` draft, mutation status was 'fail-tautological' because the no-op command passed even on reverted source. This forced `computedVerdict='fail'`, which required the verifier response to include `## Failure summary` + `## Constraint` (per `parseVerifyPersonaResponse`); the draft failed parse1 and the repair turn got the FakeProvider default fallback. One-line PLAN fix unblocked the cycle.

### 5. Reviewer → REVIEW.md

`<review-ready/>\n## Findings\n\n- None.\n\n## Score\n\n- Final score: 8\n` — same as `REVIEWER_READY_RESPONSE`. Reusable verbatim.

### 6. Scientist (per phase)

Per-phase scientist tail with H-001 hypothesis tied to T-001:

```markdown
<scientist-ready/>
# HYPOTHESES

## H-001: todo CLI persistence is atomic under crash

- Phase: <phase>
- Status: open
- Falsifier: A crash mid-write leaves a corrupt todos.json that subsequent invocations cannot parse.
- Evidence: SPEC.md AC-1 + AC-2 + AC-3 (load/parse/write round-trip).
- Risk if false: data loss on power failure during write.

# OPEN QUESTIONS

## Q-001: Should ids be reusable after a future delete subcommand?

- Phase: <phase>
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC.md non-goal explicitly excludes delete; reservation policy carries forward.
- Resolution attempts: none yet.
```

## Project setup (inlined into the runner)

The runner does NOT import from `tests/e2e/helpers/multi-task-cli.ts` (avoiding test-tree coupling). Instead it inlines the setup logic:

1. `mkdtemp` a fresh tmp dir
2. `mkdir -p <tmpRoot>/project`
3. Write `<tmpRoot>/project/README.md` ("# todo CLI demo\n")
4. Run `initProject({ cwd, force: false })` via direct import from `src/commands/init.ts` (programmatic, not subprocess)
5. Bump per-phase budgets in `.code-oz/config.yaml` (write all 7 phases at 60/60/1M like the helper)
6. `git init -q -b main && git config user.email/name + commit.gpgsign false && git add -A && git commit -q -m "init"`
7. Per-spawn fake-script dir at `<tmpRoot>/scripts/`

Output preservation:
- After SHIP gate fires, copy `<tmpRoot>/project/.code-oz/state/runs/<runId>/events.jsonl` → `docs/demo/01-todo-cli/output/<effort>.events.jsonl`
- Copy `<tmpRoot>/project/.code-oz/artifacts/SPEC.md`, `PLAN.md`, `SOURCE_CHECK.md`, etc. → `docs/demo/01-todo-cli/output/<effort>/`
- Copy each `GATE_*_PASSED.json` → `docs/demo/01-todo-cli/output/<effort>/gates/`
- Don't `rm -rf` the tmp dir if running interactively (leave for inspection)

## CLI flag plumbing

Runner takes a single optional `--effort <level>` flag, default `balanced`:

```
bun run scripts/demo/01-todo-cli/run-demo.ts                # default (balanced)
bun run scripts/demo/01-todo-cli/run-demo.ts --effort lite
bun run scripts/demo/01-todo-cli/run-demo.ts --effort beast
```

Outputs go to `docs/demo/01-todo-cli/output/<effort>/`.

For the asciicast (step 4), the operator runs all three levels back-to-back. Asciinema records the full sequence.

## Package.json entry

Add to `scripts`:

```
"demo:todo-cli": "bun run scripts/demo/01-todo-cli/run-demo.ts"
```

## Acceptance criteria for step 2 closure

- `bun run demo:todo-cli` exits 0 at default effort.
- `docs/demo/01-todo-cli/output/balanced/events.jsonl` exists and has a `phase_entered` event with `phase: 'ship'` at the tail.
- All five gate files (`GATE_DEFINE_PASSED.json` through `GATE_REVIEW_PASSED.json`) are present in `docs/demo/01-todo-cli/output/balanced/gates/`.
- `docs/demo/01-todo-cli/output/balanced/SPEC.md` is byte-identical to `docs/demo/01-todo-cli/SPEC.md`.
- No dangling locks (`.build.lock`, `.verify.lock`, `.review.lock`, `.worktree.lock`) in the run dir.

## Acceptance criteria for step 3 closure

- `bun run demo:todo-cli --effort lite` exits 0; `docs/demo/01-todo-cli/output/lite/events.jsonl` contains `effort_envelope_applied` with multiplier 0.4 (`EFFORT_MULTIPLIERS.lite`) and scaled `effectiveBudgets` (maxTurns 40, maxTokens 800k).
- `bun run demo:todo-cli --effort beast` exits 0; `docs/demo/01-todo-cli/output/beast/events.jsonl` contains `effort_envelope_applied` with multiplier 6.0 and scaled `effectiveBudgets` (maxTurns 600, maxTokens 12M).

## Notes for the next session

- The PLAN.md content above is a draft and MUST be validated against `parsePlan` from `src/artifacts/plan.ts` before authoring the runner. Run a quick bun -e validation like we did for SPEC.md.
- The new-file diff format may need an `index 0000000..1234567` line before the `--- /dev/null` line — some `git apply` versions require it. Test with a minimal new-file diff first.
- The scientist response includes H-001 referenced in the PLAN's Hypotheses: line. The two must stay in sync.
- The order of agents in each fake-script JSONL matters: scientist is matched separately, so the FakeProvider's matcher (phase + agent) routes each call to its entry. Order within the file is FIFO per `applyFakeScript`.
- `code-oz approve` with explicit phase argument skips the TTY prompt; the runner can safely pipe `stdin: 'ignore'` to spawn calls.

## Open questions for the user

- Should the runner clean up the tmp dir on success or leave it for inspection? Recommend: leave it; print the path; user can `rm -rf` later.
- Should the runner support `--keep-tmp` flag explicitly? Recommend: yes (default true; `--rm-tmp` to clean up).
- Should we add `code-oz doctor run` invocations between phases as visual eye-candy for the asciicast? Recommend: yes, after PLAN approval (shows projected state).
