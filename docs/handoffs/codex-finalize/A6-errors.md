# A6-errors findings

Sub-task: A6
Operator: codex-subtask-6
Started: 2026-05-13T22:06:00Z
Finished: 2026-05-13T22:18:28Z

## Summary

Static audit found five findings: one block-ship, three fix-soon, and one nit. The biggest risk is that BUILD can write `NEEDS_INTERVENTION.json` with an empty `actionableSuggestions` array, and the gate validator accepts it. That violates the first-run recovery contract because the CLI formatter then has no concrete recovery step to show. I also found a playbook/schema drift around the required `event_pointer`, missing production PAUSE/STOP sequencing, distribution fail-closed messages without recovery hints, and a few top-level stderr exits that still rely on raw messages instead of a consistent hint.

## Findings

### F6.1 - BUILD can write NEEDS_INTERVENTION with no actionable recovery step

- **Severity:** block-ship
- **Where:** `src/phases/build.ts:913`, `src/phases/build.ts:931`, `src/phases/build.ts:940`, `src/state/gates.ts:482`, `src/state/gates.ts:489`
- **Evidence:**
  ```text
  src/phases/build.ts:913-920 defines recordIntervention without any suggestion input.
  src/phases/build.ts:931-941 writes NEEDS_INTERVENTION.json with actionableSuggestions: [].
  src/state/gates.ts:482-490 checks Array.isArray and every string is non-empty, but does not check length > 0.
  src/providers/errors.ts:57-61 rejects ProviderError issues with zero suggestions, so this is inconsistent with the provider error contract.
  tests/build-phase.test.ts:461-466 only asserts the file exists, not that it contains suggestions.
  ```
- **Why it matters for first-run UX:** A user who hits a BUILD preflight, drift, persona, or patch failure can get a durable intervention file with no specific next action.
- **Proposed fix:** Make `validateNeedsIntervention` reject empty `actionableSuggestions`, then change BUILD's `recordIntervention` to accept suggestions or use a code-to-suggestions mapper like VERIFY/REVIEW. Failing-test sketch: first add a test that `writeNeedsInterventionGate` rejects `actionableSuggestions: []`, and a BUILD failure test that reads `NEEDS_INTERVENTION.json` and asserts `actionableSuggestions.length > 0` plus at least one concrete command or artifact path.
- **Effort estimate:** s

### F6.2 - Playbook-required event_pointer is absent from the gate schema and every writer

- **Severity:** fix-soon
- **Where:** `docs/handoffs/2026-05-13-codex-finalize-distribution.md:174`, `src/state/schemas.ts:1582`, `src/state/schemas.ts:1590`, `docs/references/file-based-gates.md:60`, `docs/references/file-based-gates.md:75`
- **Evidence:**
  ```text
  Playbook A6 requires every NEEDS_INTERVENTION writer to include phase, reason, suggestion, event_pointer.
  NeedsInterventionGate only has version, runId, phase, agent, code, rule, detail?, actionableSuggestions, createdAt.
  rg -n "event_pointer|eventPointer" found no implementation fields in src.
  The current reference schema also omits event_pointer.
  ```
- **Why it matters for first-run UX:** When a run halts, the user has a phase/code but no exact event-log pointer to the triggering `agent_invoked`, `build_failed`, `verify_failed`, or provider failure row.
- **Proposed fix:** Decide the field name and shape once, then update the schema, validator, writers, formatter, and tests. A minimal shape could be `eventPointer: { file: "events.jsonl", line?: number, type?: string, code?: string }`, or a string form such as `events.jsonl:<line>`. Failing-test sketch: create a provider failure and assert `NEEDS_INTERVENTION.json.eventPointer` points at the adjacent `intervention` event or the prior causal event.
- **Effort estimate:** m

### F6.3 - PAUSE/STOP have schema writers but no production event-order path to verify

- **Severity:** fix-soon
- **Where:** `src/state/gates.ts:296`, `src/state/gates.ts:304`, `tests/state-gates.test.ts:370`, `docs/references/file-based-gates.md:81`, `docs/references/file-based-gates.md:98`, `docs/references/file-based-gates.md:160`
- **Evidence:**
  ```text
  rg found writePauseGate/writeStopGate only in src/state/gates.ts and tests/state-gates.test.ts.
  No production caller was found under src.
  No SIGINT/SIGTERM handler was found under src.
  docs/references/file-based-gates.md lists run_ended outcome "stopped" | "paused", but no current production helper sequences PAUSE.json/STOP.json with run_ended.
  ```
- **Why it matters for first-run UX:** Ctrl-C or user-requested stop behavior cannot be audited for the required gate/event order because the orchestrator path is not present.
- **Proposed fix:** Add an orchestrator-owned pause/stop helper in `src/state/run.ts` or the CLI boundary that writes `PAUSE.json`/`STOP.json`, appends the corresponding `run_ended` event, and rebuilds current state under one lock. Add tests that assert exact order for pause and stop. If stop/pause are intentionally out of scope for this release, document that in the A6 synthesis so A1 does not assume Ctrl-C durability exists.
- **Effort estimate:** m

### F6.4 - Distribution fail-closed errors often omit recovery hints

- **Severity:** fix-soon
- **Where:** `scripts/install.sh:3`, `scripts/install.sh:219`, `scripts/install.sh:231`, `scripts/install.sh:260`, `scripts/install.sh:265`, `npm-wrapper/index.cjs:27`, `npm-wrapper/index.cjs:139`, `npm-wrapper/index.cjs:150`, `npm-wrapper/index.cjs:154`, `npm-wrapper/index.cjs:160`
- **Evidence:**
  ```text
  scripts/install.sh uses fail() to print only "install.sh: <message>" and exit 1.
  Some failures have hints, for example no SHA tool or no downloader, but checksum mismatch, missing manifest row, missing binary, and download failures do not include a one-line recovery hint.
  npm-wrapper/index.cjs die() prints only "code-oz launcher: <message>" and exits 1.
  npm wrapper download, checksum, and extracted-binary failures throw raw messages that are passed directly to die().
  ```
- **Why it matters for first-run UX:** A friend installing from npm or curl can hit a network, tag, cache, or checksum failure and see what failed without seeing what to do next.
- **Proposed fix:** Give `fail`/`die` an optional hint argument and add hints for download, checksum, missing checksum entry, missing binary, unsupported platform, and cache corruption paths. Example hints: check the release tag, retry with a stable network, remove `~/.cache/code-oz/<version>/`, or set `CODE_OZ_NPM_BASE_URL` only for local testing. Failing-test sketch: tamper `checksums.txt` and assert stderr contains both "checksum mismatch" and a "try" or "remove cache/retry" line.
- **Effort estimate:** s

### F6.5 - Top-level CLI stderr fallback hides stacks but does not add a recovery hint

- **Severity:** nit
- **Where:** `src/cli.ts:79`, `src/cli.ts:81`, `src/cli.ts:82`, `src/commands/approve.ts:971`, `src/commands/approve.ts:974`, `src/commands/run.ts:270`
- **Evidence:**
  ```text
  src/cli.ts catches any thrown error, prints only `code-oz: ${msg}`, and exits 1.
  approveCommand converts GateLoadError to a bare Error message, then the global catch prints it without command-specific recovery guidance.
  code-oz run with no initial input prints "code-oz run: no initial user input provided." and exits 2 without suggesting --request, --request-file, or running from a TTY.
  Static search found no `.stack` printing, so raw stack traces appear hidden in the audited paths.
  ```
- **Why it matters for first-run UX:** Unknown command and many phase-specific paths have hints, but the global fallback can still produce a dead-end message for parse, gate, and input failures.
- **Proposed fix:** Add a small fatal-error formatter that accepts `command`, `message`, `hint`, and `exitCode`, and use it for global catch and simple command exits. Keep stack traces hidden unless a future debug flag explicitly requests them. Failing-test sketch: spawn `code-oz run` without input in non-TTY mode and assert stderr includes a concrete next action such as `code-oz run --request "..."`.
- **Effort estimate:** s

## Unverified gaps

- I did not execute the CLI, installers, npm wrapper, or provider SDKs. This is a static source audit within the requested time box.
- I enumerated direct `writeNeedsInterventionGate` call sites with `rg` and inspected those snippets, but I did not read every line of every large phase file.
- Raw SDK stack trace behavior was checked by static search for `.stack` and error formatting. I did not force live Claude/Codex/Gemini/xAI failures.
- PAUSE/STOP event order is unverified because no production writer path was found.

## Commands run

All commands below were run from `/Users/ozzy-mac/Projects/code-oz` unless an absolute memory or skill path is shown.

```text
rg -n "code-oz|finalize|v0\\.20\\.1|NEEDS_INTERVENTION|first-run" /Users/ozzy-mac/.codex/memories/MEMORY.md
exit 0

sed -n '1,220p' /Users/ozzy-mac/.agents/skills/code-review/SKILL.md
exit 0

git status --short --branch
exit 0

sed -n '1,260p' CLAUDE.md
exit 0

sed -n '1,240p' docs/design/ROADMAP.md
exit 0

sed -n '1,260p' docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit 0

rg -n "Finding template|severity|block-ship|fix-soon|A6|playbook" docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit 0

sed -n '250,380p' docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit 0

rg --files src/phases src/commands
exit 0

rg -n "NEEDS_INTERVENTION|writeNeedsIntervention|needs_intervention|writePauseGate|writeStopGate|PAUSE|STOP|console\\.error|process\\.exit|exitCode|throw new Error|stack|provider_failed|provider" src/state src/phases src/providers src/commands src/cli.ts scripts/install.sh npm-wrapper/index.cjs
exit 0

rg -n "fail|error|unsupported|checksum|sha|curl|download|exit 1|die\\(|fatal|recovery|hint|try|install" scripts/install.sh npm-wrapper/index.cjs
exit 0

rg -n "writeNeedsInterventionGate\\(|writePauseGate\\(|writeStopGate\\(|writeControlGate\\(" src scripts npm-wrapper tests docs
exit 0

nl -ba src/state/gates.ts | sed -n '1,360p'
exit 0

nl -ba src/state/run.ts | sed -n '1,360p'
exit 0

nl -ba src/providers/invoke.ts | sed -n '1,380p'
exit 0

nl -ba src/state/gates.ts | sed -n '312,620p'
exit 0

rg -n "interface NeedsInterventionGate|type NeedsInterventionGate|event_pointer|eventPointer|actionableSuggestions|PauseGate|StopGate|control" src/state/schemas.ts src/state/gates.ts docs/contracts docs/references
exit 0

nl -ba src/state/schemas.ts | sed -n '1,180p'
exit 0

nl -ba tests/state-gates.test.ts | sed -n '340,420p'
exit 0

nl -ba src/phases/define.ts | sed -n '90,160p'
exit 0

nl -ba src/phases/plan.ts | sed -n '110,160p'; nl -ba src/phases/plan.ts | sed -n '540,590p'
exit 0

nl -ba src/phases/build.ts | sed -n '900,970p'
exit 0

nl -ba src/phases/verify.ts | sed -n '150,230p'
exit 0

nl -ba src/phases/schedule-attempt.ts | sed -n '60,110p'
exit 0

nl -ba src/worktree/load-or-create-run-worktree.ts | sed -n '380,430p'
exit 0

rg -n "recordIntervention\\(|build_failed|return Object.freeze\\(\\{ status: 'intervention'|actionableSuggestions" src/phases/build.ts
exit 0

nl -ba src/phases/build.ts | sed -n '340,395p'; nl -ba src/phases/build.ts | sed -n '960,1005p'
exit 0

nl -ba src/phases/review.ts | sed -n '300,420p'; nl -ba src/phases/review.ts | sed -n '450,490p'; nl -ba src/phases/review.ts | sed -n '820,875p'
exit 0

nl -ba src/cli.ts | sed -n '1,120p'
exit 0

rg -n "console\\.error|process\\.exit|exitCode|throw new Error|catch \\(err|catch \\(error" src/commands src/cli.ts
exit 0

nl -ba src/commands/run.ts | sed -n '1,220p'; nl -ba src/commands/run.ts | sed -n '850,1040p'
exit 0

nl -ba src/commands/init.ts | sed -n '1,260p'
exit 0

rg -n "\.stack|stack trace|console\.error|stderr\.write\(`.*\$\{\(err as Error\)\.message|err\.message|String\(err\)" src/providers src/commands src/cli.ts
exit 1

rg -n '(\\.stack|stack trace|console\\.error|err\\.message|String\\(err\\)|\\(err as Error\\)\\.message)' src/providers src/commands src/cli.ts
exit 0

nl -ba src/providers/claude.ts | sed -n '80,135p'; nl -ba src/providers/claude.ts | sed -n '250,290p'
exit 0

nl -ba src/providers/codex.ts | sed -n '80,180p'
exit 0

nl -ba src/providers/gemini.ts | sed -n '1,80p'
exit 0

nl -ba src/providers/xai.ts | sed -n '280,370p'
exit 0

rg -n "writePauseGate|writeStopGate|PAUSE\\.json|STOP\\.json|pause|stop|SIGINT|SIGTERM|SIGINT|AbortSignal" src tests docs/contracts docs/references
exit 0

nl -ba src/commands/approve.ts | sed -n '1,160p'; nl -ba src/commands/approve.ts | sed -n '940,990p'
exit 0

nl -ba src/commands/doctor.ts | sed -n '120,210p'; nl -ba src/commands/doctor.ts | sed -n '220,380p'
exit 0

nl -ba src/commands/dispatch-build-helpers.ts | sed -n '590,635p'
exit 0

nl -ba src/cli/exit-codes.ts | sed -n '1,120p'
exit 0

nl -ba src/commands/run.ts | sed -n '220,390p'
exit 0

nl -ba src/commands/run.ts | sed -n '1040,1160p'; nl -ba src/commands/run.ts | sed -n '1160,1230p'
exit 0

nl -ba src/commands/run.ts | sed -n '1240,1410p'; nl -ba src/commands/run.ts | sed -n '1860,2035p'; nl -ba src/commands/run.ts | sed -n '2190,2285p'
exit 0

nl -ba src/phases/define.ts | sed -n '160,290p'; nl -ba src/phases/define.ts | sed -n '290,390p'
exit 0

ls -la docs/handoffs/codex-finalize
exit 0

rg -n "event_pointer|eventPointer|NEEDS_INTERVENTION\\.json|actionableSuggestions: \\[\\]|writeNeedsInterventionGate\\(" src tests docs/handoffs docs/contracts docs/references
exit 0

rg -n "process\\.on\\('SIGINT|process\\.on\\(\"SIGINT|SIGTERM|writeStopGate|writePauseGate|run_ended.*stopped|run_ended.*paused" src tests
exit 0

rg -n "A6-errors|A6" docs/handoffs/codex-finalize docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit 0

nl -ba tests/build-phase.test.ts | sed -n '440,475p'; nl -ba tests/providers-types.test.ts | sed -n '55,75p'
exit 0

nl -ba src/providers/errors.ts | sed -n '45,85p'
exit 0

nl -ba docs/references/file-based-gates.md | sed -n '52,105p'; nl -ba docs/references/provider-contract.md | sed -n '160,190p'
exit 0

nl -ba docs/references/file-based-gates.md | sed -n '104,170p'
exit 0

date -u +%Y-%m-%dT%H:%M:%SZ
exit 0

nl -ba src/state/schemas.ts | sed -n '1580,1608p'
exit 0

git status --short --branch
exit 0

LC_ALL=C rg -n $'\xE2\x80\x94' docs/handoffs/codex-finalize/A6-errors.md
exit 1

sed -n '1,260p' docs/handoffs/codex-finalize/A6-errors.md
exit 0

tail -n 90 docs/handoffs/codex-finalize/A6-errors.md
exit 0
```
