# A1-cli-first-run findings

Sub-task: A1
Operator: codex-subtask-A1
Started: 2026-05-13T22:05:00Z
Finished: 2026-05-13T22:20:59Z

## Summary

Filed 6 findings: 2 block-ship, 3 fix-soon, 1 nit. Biggest risk: the packaged first-run smoke path cannot complete offline with `--provider fake`; it stops in DEFINE with `NEEDS_INTERVENTION.json` and never writes any gate, so the required `npm pack -> install -> init -> run --provider fake` transcript cannot reach SHIP. The explicit resume surfaces in the playbook/rules are also absent from the CLI.

## Findings

### F1.1 - Packaged `--provider fake` smoke cannot reach DEFINE completion

- **Severity:** block-ship
- **Where:** `src/providers/fake.ts:101`, `src/commands/run.ts:2358`, command `code-oz run --request "build a hello cli" --provider fake`
- **Evidence:**

  ```text
  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --request "build a hello cli" --provider fake
  exit: 1

  WARNING: --provider fake is active
  --- ba reply (turn 0) ---
  fake response
  --- ba reply (turn 1) ---
  fake response
  DEFINE phase reached the conversation cap without converging on a SPEC.

  command: find .code-oz/state/runs -name 'GATE_*_PASSED.json' -o -name 'NEEDS_INTERVENTION.json' -o -name 'STOP.json'
  exit: 0
  .code-oz/state/runs/01KRHPRFW3F0BC7QWGAZYTG24G/NEEDS_INTERVENTION.json
  ```

  `events.jsonl` confirms the run stopped after `ask_me_max_rounds_exceeded`; no `GATE_DEFINE_PASSED.json`, let alone `GATE_SHIP_PASSED.json`, was written. Source confirms the default FakeProvider response is the literal `fake response`, which cannot satisfy DEFINE's SPEC/ready-signal contract.
- **Why it matters for first-run UX:** The playbook smoke command is `code-oz run --provider fake`; a new user or CI cannot complete the advertised offline path without hidden fake-script machinery.
- **Proposed fix:** Add a package-spawn e2e that runs `code-oz init && code-oz run --provider fake` and expects a shipped run, then make the no-script FakeProvider path use a built-in first-run fixture that emits valid phase artifacts through SHIP. If fake-script remains the only full-lifecycle route, expose a first-run-safe command/fixture and update the smoke playbook, but do not leave plain `--provider fake` advertised as the offline run path.
- **Effort estimate:** m

### F1.2 - Explicit resume surfaces are missing

- **Severity:** block-ship
- **Where:** `src/cli.ts:58`, `src/commands/run.ts:427`, command `code-oz run --resume`
- **Evidence:**

  ```text
  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz resume --help
  exit: 1
  code-oz: unknown command 'resume'

  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --resume
  exit: 2
  code-oz run: unknown argument: --resume
  ```

  `CLAUDE.md` rule 12 names `code-oz resume`; the A1 checklist names `code-oz run --resume`. The current CLI implements neither explicit surface. It only continues active runs via bare `code-oz run`.
- **Why it matters for first-run UX:** A user recovering from terminal death will follow the documented/prompted resume wording and hit an unknown-command or unknown-argument error instead of a recovery path.
- **Proposed fix:** Pick one canonical explicit surface, preferably `code-oz resume` with `code-oz run --resume` as an alias if the playbook keeps that spelling. Add package-spawn tests for successful resume idempotency and mid-PLAN recovery, and make help text point at the chosen command.
- **Effort estimate:** m

### F1.3 - Doctor first-run UX is not an aggregate check and per-subcommand help runs probes

- **Severity:** fix-soon
- **Where:** `src/commands/doctor.ts:136`, `src/commands/doctor.ts:154`, `src/commands/doctor.ts:661`
- **Evidence:**

  ```text
  command: env HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor
  exit: 1
  Usage: code-oz doctor <subcommand> [options]

  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor providers --help
  exit: 1
  PROVIDER  AUTH     MODEL  LATENCY  REQ  ERROR
  claude    missing  no     1ms      yes  provider_io_error: claude CLI not found in PATH
  codex     missing  no     0ms      yes  provider_io_error: codex CLI not found in PATH
  Unhealthy required providers: claude (authStatus=missing), codex (authStatus=missing). Exiting 1.

  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor run --help
  exit: 0
  # code-oz doctor run
  ## Active run
    runId: 01KRHPRFW3F0BC7QWGAZYTG24G
  ```

  Provider failures show error codes but no one-line remediation for `claude` or `codex`. `doctor tools` does include install hints, so the provider path is inconsistent.
- **Why it matters for first-run UX:** `code-oz doctor` is the natural first diagnostic command; today it exits as usage help, and `--help` on nested doctor commands can execute probes or inspect active run state.
- **Proposed fix:** Make bare `code-oz doctor` run a concise aggregate of providers/tools/git, or explicitly make it help with exit 0 and point to the exact subcommands. Honor `--help` after every doctor subcommand before executing probes. Add provider remediation strings such as install/login commands and expected CLI/OAuth/API-key source, without printing secrets.
- **Effort estimate:** s

### F1.4 - Brownfield init behavior does not match the A1 contract

- **Severity:** fix-soon
- **Where:** `src/commands/init.ts:123`, `src/commands/init.ts:147`, command `code-oz init --force`
- **Evidence:**

  ```text
  command: touch package.json
  exit: 0

  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init
  exit: 0
  code-oz: initialized brownfield project at /private/tmp/code-oz-a1-nonempty.F6RHMg/.code-oz

  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init --force
  exit: 0
  code-oz: initialized brownfield project at /private/tmp/code-oz-a1-nonempty.F6RHMg/.code-oz

  command: find .code-oz -maxdepth 3 -type f
  exit: 0
  .code-oz/config.yaml
  .code-oz/README.md
  .code-oz/.gitignore
  ```

  The A1 checklist says non-empty dirs should refuse by default and `--force` should write brownfield-shape state with an `audit_completed` placeholder note. Current code initializes brownfield by default and writes no run state or placeholder.
- **Why it matters for first-run UX:** Brownfield is a common first-run path; this contract mismatch means a user can initialize an existing repo but receives no clear indication that AUDIT runtime is still M17/deferred.
- **Proposed fix:** Reconcile the product contract. Either update the A1/playbook docs to bless auto-brownfield init, or implement the refusal/`--force` split. If M17 remains out of scope, print an explicit brownfield runtime note and add a non-crashing placeholder state only if the orchestrator will actually consume it.
- **Effort estimate:** m

### F1.5 - Ctrl-C STOP.json path appears unwired

- **Severity:** fix-soon
- **Where:** `src/state/gates.ts:304`, command `rg -n "SIGINT|SIGTERM|writeStopGate|STOP\\.json|stop" src tests | head -80`
- **Evidence:**

  ```text
  command: rg -n "SIGINT|SIGTERM|writeStopGate|STOP\\.json|stop" src tests | head -80
  exit: 0
  src/state/gates.ts:304:export function writeStopGate(
  tests/state-gates.test.ts:370:  test('writePauseGate / writeStopGate write valid files', async () => {
  ```

  The search found the gate writer and unit coverage, but no CLI-level `SIGINT` or `SIGTERM` handler wiring it during `run`.
- **Why it matters for first-run UX:** The checklist requires Ctrl-C during any phase to write a clean `STOP.json`; without signal handling, an interrupted run likely exits by default and leaves recovery ambiguous.
- **Proposed fix:** Add signal handlers once `runId` and current phase are known. On first signal, write `STOP.json` with reason, phase, and event pointer, append a stopped outcome event if that is the state contract, then exit with the conventional signal code. Add a spawn test that kills a packaged/dev CLI mid-phase and asserts `STOP.json`.
- **Effort estimate:** m

### F1.6 - Effort vocabulary is internally inconsistent, though event order is correct

- **Severity:** nit
- **Where:** `src/commands/run.ts:2376`, `docs/handoffs/2026-05-13-codex-finalize-distribution.md:110`
- **Evidence:**

  ```text
  command: env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --request "x" --effort low
  exit: 2
  code-oz run: --effort must be one of: lite | balanced | max | beast (got "low"; see code-oz run --help)

  command: nl -ba .code-oz/state/runs/01KRHPQ6YJMPN5KRW50KM9FJ1Y/events.jsonl | sed -n '1,12p'
  exit: 0
  1  {"type":"run_started",...}
  2  {"type":"effort_envelope_applied","effort":"balanced",...}
  3  {"type":"phase_entered","phase":"define",...}
  ```

  The current CLI supports `lite | balanced | max | beast`; the A1 checklist asks for `low/medium/high/max`. The required event position is correct for the tested default/balanced run.
- **Why it matters for first-run UX:** A smoke script or doc using `low`, `medium`, or `high` will fail before any run starts, even though rule 23 event order is otherwise implemented.
- **Proposed fix:** Pick one vocabulary and align docs, help, tests, and playbook. If old names may exist in user snippets, add aliases with deprecation text (`low -> lite`, `medium -> balanced`, `high -> max`) and keep `max` unambiguous.
- **Effort estimate:** xs

## Positive checks

- `npm --cache /private/tmp/code-oz-a1-pack.3k9StN/npm-cache pack --pack-destination /private/tmp/code-oz-a1-pack.3k9StN` exited 0 and produced `tuel-code-oz-0.20.0-alpha.0.tgz`.
- Temp-prefix install exited 0: `npm --cache /private/tmp/code-oz-a1-home.hZDZ5v/.npm-cache --prefix /private/tmp/code-oz-a1-prefix.7SFpZf install -g /private/tmp/code-oz-a1-pack.3k9StN/tuel-code-oz-0.20.0-alpha.0.tgz`.
- First packaged invocation succeeded after including Node on PATH: `code-oz --version` printed `0.20.0-alpha.0` with exit 0.
- `code-oz --help`, `code-oz run --help`, `code-oz init --help`, and `code-oz approve --help` exited 0 and printed readable help.
- Missing default provider during `run --request` did not print a raw stack trace; it wrote `NEEDS_INTERVENTION.json` and actionable Claude CLI suggestions. It does not yet mention all supported setup routes.
- `effort_envelope_applied` landed at event position 2 in the tested packaged run.

## Commands run

Read and orientation commands:

```text
git status --short --branch  # exit 0
sed -n '1,260p' docs/handoffs/2026-05-13-codex-finalize-distribution.md  # exit 0
sed -n '260,370p' docs/handoffs/2026-05-13-codex-finalize-distribution.md  # exit 0
sed -n '1,260p' CLAUDE.md  # exit 0
sed -n '1,220p' docs/design/CODEX_SYNTHESIS_W3A.md  # exit 0
sed -n '1,240p' README.md  # exit 0
sed -n '1,220p' docs/ABOUT.md  # exit 0
sed -n '1,220p' docs/design/ROADMAP.md  # exit 0
rg --files src tests npm-wrapper scripts docs/contracts docs/demo | rg '(cli|commands|provider|fake|run|init|doctor|resume|effort|package|smoke|wrapper|events|gates)'  # exit 0
sed -n '1,220p' package.json  # exit 0
sed -n '1,260p' npm-wrapper/index.cjs  # exit 0
sed -n '1,280p' src/cli.ts  # exit 0
sed -n '1,280p' src/commands/init.ts  # exit 0
sed -n '1,340p' src/commands/run.ts  # exit 0
sed -n '320,760p' src/commands/run.ts  # exit 0
sed -n '2350,2395p' src/commands/run.ts  # exit 0
sed -n '1,320p' src/commands/doctor.ts  # exit 0
sed -n '320,700p' src/commands/doctor.ts  # exit 0
sed -n '700,860p' src/commands/doctor.ts  # exit 0
sed -n '1,260p' src/providers/fake.ts  # exit 0
rg -n "SIGINT|SIGTERM|writeStopGate|STOP\\.json|stop" src tests | head -80  # exit 0
```

Pack/install/smoke commands:

```text
mktemp -d /private/tmp/code-oz-a1-pack.XXXXXX  # exit 0 -> /private/tmp/code-oz-a1-pack.3k9StN
npm pack --pack-destination /private/tmp/code-oz-a1-pack.3k9StN  # exit 1, npm tried to write logs under real HOME
npm --cache /private/tmp/code-oz-a1-pack.3k9StN/npm-cache pack --pack-destination /private/tmp/code-oz-a1-pack.3k9StN  # exit 0
mktemp -d /private/tmp/code-oz-a1-home.XXXXXX  # exit 0 -> /private/tmp/code-oz-a1-home.hZDZ5v
mktemp -d /private/tmp/code-oz-a1-prefix.XXXXXX  # exit 0 -> /private/tmp/code-oz-a1-prefix.7SFpZf
npm --cache /private/tmp/code-oz-a1-home.hZDZ5v/.npm-cache --prefix /private/tmp/code-oz-a1-prefix.7SFpZf install -g /private/tmp/code-oz-a1-pack.3k9StN/tuel-code-oz-0.20.0-alpha.0.tgz  # exit 0
env HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz --version  # exit 127, node not on sanitized PATH
which node  # exit 0 -> /Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin/node
env HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz --version  # exit 0
env HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz --help  # exit 0
env HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor  # exit 1
env HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --help  # exit 0
env HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init --help  # exit 0
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor providers  # exit 1
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor tools  # exit 1
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor git  # exit 0
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz approve --help  # exit 0
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor run --help  # exit 0, executed inspector instead of help
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz doctor providers --help  # exit 1, executed probe instead of help
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --resume  # exit 2
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz resume --help  # exit 1
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --request "x" --effort low  # exit 2
```

Temp project commands:

```text
mktemp -d /private/tmp/code-oz-a1-work.XXXXXX  # exit 0 -> /private/tmp/code-oz-a1-work.JBuP38
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init  # exit 0
find .code-oz -maxdepth 2 -type f -o -type d  # exit 0
sed -n '1,180p' .code-oz/README.md  # exit 0
sed -n '1,220p' .code-oz/config.yaml  # exit 0
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --request "build a hello cli"  # exit 1
find .code-oz/state -maxdepth 4 -type f -name 'NEEDS_INTERVENTION.json' -o -name 'events.jsonl' -o -name 'current.json' -o -name 'active.json'  # exit 0
nl -ba .code-oz/state/runs/01KRHPQ6YJMPN5KRW50KM9FJ1Y/events.jsonl | sed -n '1,12p'  # exit 0
mktemp -d /private/tmp/code-oz-a1-nonempty.XXXXXX  # exit 0 -> /private/tmp/code-oz-a1-nonempty.F6RHMg
touch package.json  # exit 0
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init  # exit 0
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init  # exit 1, existing .code-oz refusal
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init --force  # exit 0
find .code-oz -maxdepth 3 -type f  # exit 0
mktemp -d /private/tmp/code-oz-a1-fake.XXXXXX  # exit 0 -> /private/tmp/code-oz-a1-fake.LPMsFh
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz init  # exit 0
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --request "build a hello cli" --provider fake  # exit 1
env -i HOME=/private/tmp/code-oz-a1-home.hZDZ5v XDG_CACHE_HOME=/private/tmp/code-oz-a1-home.hZDZ5v/.cache PATH=/private/tmp/code-oz-a1-prefix.7SFpZf/bin:/Users/ozzy-mac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /private/tmp/code-oz-a1-prefix.7SFpZf/bin/code-oz run --provider fake  # exit 1
find .code-oz/state/runs -name 'GATE_*_PASSED.json' -o -name 'NEEDS_INTERVENTION.json' -o -name 'STOP.json'  # exit 0
nl -ba .code-oz/state/runs/01KRHPRFW3F0BC7QWGAZYTG24G/events.jsonl | sed -n '1,24p'  # exit 0
```

## Unchecked items and gaps

- Did not test provider keys in isolation for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `XAI_API_KEY`; no live-provider credentials were used.
- Did not complete a successful packaged DEFINE->SHIP run, successful resume, successful idempotency replay, or mid-PLAN kill/resume because the plain FakeProvider path blocks in DEFINE and explicit resume surfaces are missing.
- Did not dynamically send Ctrl-C during a live provider phase. Source search found no CLI signal handler wiring to `writeStopGate`; this remains a source-evidence finding, not a runtime transcript.
- Did not exhaustively run every nested doctor baseline command help variant. Tested top-level help plus `init`, `run`, `approve`, `doctor`, `doctor providers --help`, and `doctor run --help`.
- Did not run full `bun test`, `bun run typecheck`, or binary build; this was a read-only audit plus packaged smoke, and no product code was changed.
