# Hermes External-Operator Driving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an external autonomous agent (Hermes/OpenClaw) drive the existing `code-oz` CLI as a tool, with a fail-closed `--non-interactive` operator mode that bans the fake provider, blocks non-interactive SHIP approval, and records operator provenance — code-oz stays the gate authority.

**Architecture:** Two-flag engine surface (`--operator <id>`, `--non-interactive`) added at the CLI argument boundary of `run` and `approve` (NOT in `buildProviderRegistry`, which is the offline test seam). A text-only agentskills.io `SKILL.md` ports the existing `plugins/code-oz` boundary language so the external agent drives via documented commands. Companion design: `docs/design/HERMES_OPERATOR_DRIVER_DESIGN.md`.

**Tech Stack:** Bun + TypeScript. Tests with `bun test` (offline, FakeProvider). Conventional commits, no Co-Authored-By footer.

**Branch:** `feat/hermes-operator-driver` (already created off `main`; design doc committed as `d438436`).

---

## File map

- `src/commands/run.ts` — add `--operator`/`--non-interactive` to `parseRunArgs`, extend `ParsedOk`, add the non-interactive fake-fallback guard in `runCommand` via a new pure helper.
- `src/commands/approve.ts` — add `operator`/`non-interactive` to the `approveCommand` parser and `RunApproveOptions`; block SHIP + require explicit phase in non-interactive `runApprove`; route `approvedBy`.
- `src/state/schemas.ts` — add optional `operator` to `run_started`, optional `approvedBy` to `gate_written`.
- `src/state/run.ts` — emit `approvedBy` on the `gate_written` event from `completeTransitionForPhase`.
- `agent-skills/code-oz/SKILL.md` — new, text-only agentskills.io skill.
- `tests/operator-mode.test.ts` — new, unit tests for the parser + helper + approve guards.
- `tests/agent-skill-boundaries.test.ts` — new, asserts the SKILL.md contains the boundary prohibitions.

---

## Task 0: Revert the provider detour

**Files:**
- Modify: `src/providers/types.ts`, `src/providers/families.ts`, `src/providers/capabilities.ts`, `src/agents/schema.ts`, `src/cli/bootstrap.ts`, `src/commands/run.ts`, `tests/cli-provider-override.test.ts`, `package.json`
- Delete: `src/agents/defaults/hermes-builder.md`, `src/agents/defaults/hermes-reviewer.md`, `package-lock.json` (untracked), `template/` (untracked)

- [ ] **Step 1: Discard the tracked detour edits**

```bash
git restore src/providers/types.ts src/providers/families.ts src/providers/capabilities.ts src/agents/schema.ts src/cli/bootstrap.ts src/commands/run.ts tests/cli-provider-override.test.ts package.json
```

- [ ] **Step 2: Remove the untracked detour files**

```bash
rm -f src/agents/defaults/hermes-builder.md src/agents/defaults/hermes-reviewer.md package-lock.json
rm -rf template
```

- [ ] **Step 3: Add a .gitignore guard so the external clone never re-enters the branch**

Append to `.gitignore` (create the line if absent):

```
/template/
```

- [ ] **Step 4: Verify the tree is clean and types still pass**

Run: `git status --short && bun run typecheck`
Expected: only `.gitignore` modified (+ the committed design doc already in history); typecheck passes. `grep -rn "hermes" src/providers src/agents/schema.ts` returns nothing.

- [ ] **Step 5: Run the full suite to confirm the revert restored green**

Run: `bun test`
Expected: PASS (the pre-detour baseline; `tests/cli-provider-override.test.ts` asserts `"only accepts 'fake'"` again).

- [ ] **Step 6: Commit**

```bash
git add .gitignore src/providers/types.ts src/providers/families.ts src/providers/capabilities.ts src/agents/schema.ts src/cli/bootstrap.ts src/commands/run.ts tests/cli-provider-override.test.ts package.json
git commit -m "revert(hermes): drop the in-code-oz hermes-provider detour

Reverts the half-started 'hermes as 6th provider' direction (provider
enums, hermes-builder/reviewer personas, @tuel/code-oz self-dep). The
adopted direction is the reverse: an external agent DRIVES code-oz.
template/ is gitignored (carried a nested .git)."
```

---

## Task 1: RED — `run` parser flags (`--operator`, `--non-interactive`)

**Files:**
- Test: `tests/operator-mode.test.ts` (create)

- [ ] **Step 1: Write the failing parser tests**

Create `tests/operator-mode.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { parseRunArgs } from '../src/commands/run.ts'

const OK_ENV = { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' } as const

describe('code-oz run --operator / --non-interactive parsing', () => {
  test('--operator <id> is captured', () => {
    const r = parseRunArgs(['--operator', 'hermes', '--request', 'hi'])
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.operator).toBe('hermes')
    expect(r.nonInteractive).toBe(false)
  })

  test('--non-interactive sets the flag and requires --operator', () => {
    const ok = parseRunArgs(['--operator', 'hermes', '--non-interactive', '--request', 'hi'])
    expect(ok.kind).toBe('ok')
    if (ok.kind === 'ok') expect(ok.nonInteractive).toBe(true)

    const bad = parseRunArgs(['--non-interactive', '--request', 'hi'])
    expect(bad.kind).toBe('error')
    if (bad.kind === 'error') expect(bad.message).toContain('--operator')
  })

  test('rejects malformed operator id', () => {
    const r = parseRunArgs(['--operator', 'bad id!', '--request', 'hi'])
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('--operator')
  })

  test('bans --provider fake in non-interactive mode', () => {
    const r = parseRunArgs(['--operator', 'hermes', '--non-interactive', '--provider', 'fake', '--request', 'hi'])
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('fake')
  })

  test('bans --fake-script in non-interactive mode (even with env)', () => {
    const r = parseRunArgs(
      ['--operator', 'hermes', '--non-interactive', '--provider', 'fake', '--fake-script', '/x.jsonl', '--request', 'hi'],
      OK_ENV,
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('fake')
  })

  test('fake still works WITHOUT --non-interactive (rule 8 preserved)', () => {
    const r = parseRunArgs(['--provider', 'fake', '--request', 'hi'])
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.providerOverride).toBe('fake')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/operator-mode.test.ts`
Expected: FAIL — `r.operator`/`r.nonInteractive` are undefined; the ban/require errors are not produced yet.

---

## Task 2: GREEN — implement the `run` parser surface

**Files:**
- Modify: `src/commands/run.ts` (`ParsedOk` interface ~564; `parseRunArgs` ~600-810)

- [ ] **Step 1: Extend the `ParsedOk` interface**

In `src/commands/run.ts`, add to the `ParsedOk` interface (after `resumeRequested`):

```typescript
  /** External-operator provenance (rule: external-operator driving).
   *  Bounded id; recorded on run_started.operator. */
  readonly operator?: string
  /** Fail-closed external-operator mode: bans fake, blocks SHIP approval,
   *  refuses silent fake fallback. Requires `operator` to be set. */
  readonly nonInteractive: boolean
```

- [ ] **Step 2: Add a validation constant near the other parse constants**

Add (top-level, beside `TASK_ID_PATTERN`):

```typescript
const OPERATOR_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/
```

- [ ] **Step 3: Parse the two flags inside the `parseRunArgs` arg loop**

Add these branches before the final `return { kind: 'error', message: \`unknown argument: ${a}\` ... }` line. Also declare `let operator: string | null = null` and `let nonInteractive = false` beside the other `let` locals at the top of `parseRunArgs`:

```typescript
    if (a === '--non-interactive') {
      nonInteractive = true
      continue
    }
    if (a === '--operator') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--operator requires an id', help: true }
      }
      operator = value
      i++
      continue
    }
    if (a.startsWith('--operator=')) {
      operator = a.slice('--operator='.length)
      continue
    }
```

- [ ] **Step 4: Add the post-loop validations**

After the `--task` validation block and before `const effortFlagPresent = ...`:

```typescript
  if (operator !== null && !OPERATOR_ID_PATTERN.test(operator)) {
    return {
      kind: 'error',
      message: `--operator must match ${OPERATOR_ID_PATTERN.source} (got ${JSON.stringify(operator)})`,
      help: false,
    }
  }
  if (nonInteractive && operator === null) {
    return {
      kind: 'error',
      message: '--non-interactive requires --operator <id> (external-operator mode must be attributable)',
      help: false,
    }
  }
  if (nonInteractive && providerOverride === 'fake') {
    return {
      kind: 'error',
      message: 'the fake provider is banned in --non-interactive operator mode (it would stub cross-family REVIEW)',
      help: false,
    }
  }
```

(Note: banning `--provider fake` in non-interactive also bans `--fake-script`, which already requires `--provider fake`.)

- [ ] **Step 5: Thread the new fields into the `base` builder**

In the `base` function's frozen return object, add:

```typescript
      ...(operator !== null ? { operator } : {}),
      nonInteractive,
```

(Insert alongside the existing `...(taskOverride !== null ? { taskOverride } : {})` spread; `nonInteractive` is always present.)

- [ ] **Step 6: Run the tests**

Run: `bun test tests/operator-mode.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 7: Typecheck and commit**

Run: `bun run typecheck` → PASS

```bash
git add src/commands/run.ts tests/operator-mode.test.ts
git commit -m "feat(operator): parse --operator/--non-interactive on run; ban fake in non-interactive"
```

---

## Task 3: RED — non-interactive fake-fallback guard helper

**Files:**
- Test: `tests/operator-mode.test.ts` (append)

- [ ] **Step 1: Append the helper test**

The runtime fake fallback (`run.ts:153`) silently routes to fake when a real provider is unhealthy. In non-interactive mode that must fail closed. Extract a pure helper so it is unit-testable. Append to `tests/operator-mode.test.ts`:

```typescript
import { assertNonInteractiveProviderOk } from '../src/commands/run.ts'

describe('assertNonInteractiveProviderOk', () => {
  test('throws when fallback would use fake in non-interactive mode', () => {
    expect(() => assertNonInteractiveProviderOk(true, 'fake')).toThrow(/non-interactive/i)
  })

  test('allows fake fallback when NOT non-interactive (rule 8)', () => {
    expect(() => assertNonInteractiveProviderOk(false, 'fake')).not.toThrow()
  })

  test('allows a real (undefined) override in non-interactive mode', () => {
    expect(() => assertNonInteractiveProviderOk(true, undefined)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/operator-mode.test.ts`
Expected: FAIL — `assertNonInteractiveProviderOk` is not exported.

---

## Task 4: GREEN — wire the fallback guard into `runCommand`

**Files:**
- Modify: `src/commands/run.ts` (new export + the resolution site at ~153)

- [ ] **Step 1: Add the pure helper (top-level export)**

```typescript
/**
 * External-operator guard (rule: external-operator driving). In
 * --non-interactive mode the silent fake fallback must fail closed —
 * a stubbed reviewer would void cross-family REVIEW. Pure so it is
 * unit-testable without bootstrap.
 */
export function assertNonInteractiveProviderOk(
  nonInteractive: boolean,
  resolvedOverride: ProviderOverride | undefined,
): void {
  if (nonInteractive && resolvedOverride === 'fake') {
    throw new Error(
      'code-oz run: --non-interactive operator mode requires healthy real providers; ' +
        'refusing silent fake fallback. Run `code-oz doctor` and fix provider auth.',
    )
  }
}
```

- [ ] **Step 2: Call it at the resolution site**

Replace the resolution block at `run.ts:153-157`:

```typescript
  const runtimeProviderOverride =
    parsed.providerOverride ?? (await defaultToFakeIfRequiredProvidersUnavailable(ctx))
  assertNonInteractiveProviderOk(parsed.nonInteractive, runtimeProviderOverride)
  if (runtimeProviderOverride === 'fake' && parsed.providerOverride !== 'fake') {
    printFakeProviderBanner()
  }
```

- [ ] **Step 3: Record operator provenance on the run**

Find where `runCommand` emits / passes data into `run_started` (the DEFINE/AUDIT entry that creates the run). Pass `parsed.operator` through to the `run_started` event payload as `operator`. (The event schema field is added in Task 5; if Task 5 is done first per the sequence below, the field already exists. If implementing strictly in order, add the schema field in Task 5 then return here — see Task 5 note.)

- [ ] **Step 4: Run helper tests + full suite**

Run: `bun test tests/operator-mode.test.ts && bun test`
Expected: PASS. No existing offline test passes `--non-interactive`, so rule-8 fake lifecycle tests stay green.

- [ ] **Step 5: Commit**

```bash
git add src/commands/run.ts tests/operator-mode.test.ts
git commit -m "feat(operator): refuse silent fake fallback in non-interactive mode"
```

---

## Task 5: RED+GREEN — `approve` operator flags, SHIP block, provenance

**Files:**
- Modify: `src/state/schemas.ts` (`run_started` ~470, `gate_written` ~590)
- Modify: `src/state/run.ts` (`completeTransitionForPhase` `gate_written` emit ~1533)
- Modify: `src/commands/approve.ts` (`RunApproveOptions` ~67, `runApprove` ~110-302, `approveCommand` parser ~1072)
- Test: `tests/operator-mode.test.ts` (append)

- [ ] **Step 1: Add schema fields (do this first so types compile)**

In `src/state/schemas.ts`, add to the `run_started` event object (near line 470, beside the M17 problem-statement field):

```typescript
      /** External-operator provenance: the agent id that drove this run. */
      readonly operator?: string
```

And extend the `gate_written` event (line 590) to include an optional approver:

```typescript
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'gate_written'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly file: string; readonly approvedBy?: string }>
```

- [ ] **Step 2: Emit `approvedBy` on the gate_written event**

In `src/state/run.ts` `completeTransitionForPhase` (~1533), where the `gate_written` event is constructed, copy the gate file's `approvedBy` onto the event when present:

```typescript
        ...(gate.approvedBy !== undefined ? { approvedBy: gate.approvedBy } : {}),
```

(The gate file schema already carries `approvedBy: string` — see `schemas.ts:1632`.)

- [ ] **Step 3: Write the failing approve tests**

Append to `tests/operator-mode.test.ts`:

```typescript
import { runApprove } from '../src/commands/approve.ts'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Helper: scaffold a run paused at a given phase using the fake lifecycle.
// (Reuse the project's existing e2e/run-fixture helper if present; otherwise
// drive `runCommand` with --provider fake to reach the target gate.)
async function runPausedAt(phase: 'plan' | 'ship'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'code-oz-op-'))
  // ... use the same fixture path tests/e2e/cli-multi-task-cycle.test.ts uses
  // to advance a fake run to `phase`. Return the cwd.
  return dir
}

describe('runApprove external-operator mode', () => {
  test('non-interactive approve requires an explicit phase', async () => {
    const cwd = await runPausedAt('plan')
    await expect(
      runApprove({ cwd, nonInteractive: true, operator: 'hermes' }),
    ).rejects.toThrow(/explicit phase/i)
  })

  test('blocks SHIP approval in non-interactive mode', async () => {
    const cwd = await runPausedAt('ship')
    await expect(
      runApprove({ cwd, nonInteractive: true, operator: 'hermes', phase: 'ship' }),
    ).rejects.toThrow(/human approval required/i)
  })

  test('records approvedBy=operator:<id> on a reversible gate', async () => {
    const cwd = await runPausedAt('plan')
    const r = await runApprove({ cwd, nonInteractive: true, operator: 'hermes', phase: 'plan' })
    expect(r.approved).toBe(true)
    // Assert the gate file / gate_written event carries approvedBy 'operator:hermes'
    // (read GATE_PLAN_PASSED.json under the run dir).
  })
})
```

(Implementer note: wire `runPausedAt` to the existing fake-run fixture helper used by `tests/e2e/cli-multi-task-cycle.test.ts`. The non-interactive fixture must NOT pass `--non-interactive` when advancing with fake — it uses fake without operator mode — then `runApprove` is called directly with the operator options. This preserves rule-8 separation.)

- [ ] **Step 4: Run to verify failure**

Run: `bun test tests/operator-mode.test.ts`
Expected: FAIL — `RunApproveOptions` has no `nonInteractive`/`operator`; no SHIP block; no explicit-phase requirement.

- [ ] **Step 5: Extend `RunApproveOptions`**

In `src/commands/approve.ts` (~67) add:

```typescript
  readonly operator?: string
  readonly nonInteractive?: boolean
```

- [ ] **Step 6: Add the guards in `runApprove`**

At the start of phase resolution in `runApprove` (just after `loaded` is confirmed, before line 110's `let targetPhase`):

```typescript
  if (opts.nonInteractive === true && (opts.phase === undefined || opts.phase.length === 0)) {
    throw new Error(
      'non-interactive approve requires an explicit phase argument ' +
        '(an external operator must name the phase, not approve whatever is current against a stale view).',
    )
  }
```

After `targetPhase` is resolved (after line 141, before agent resolution at 146):

```typescript
  if (opts.nonInteractive === true && targetPhase === 'ship') {
    throw new Error(
      'human approval required: SHIP cannot be approved in --non-interactive operator mode. ' +
        'A human must run `code-oz approve ship` interactively, then push manually.',
    )
  }
```

- [ ] **Step 7: Route `approvedBy` from the operator**

At the gate write (line 302, `approvedBy: opts.approvedBy ?? 'user'`), the value already flows from `opts.approvedBy`. In `approveCommand` (Step 8) set `approvedBy` to `operator:<id>` when an operator is supplied, so no change is needed here.

- [ ] **Step 8: Add the flags to the `approveCommand` parser**

In `src/commands/approve.ts` (~1072), extend the `parseArgs` options and pass through:

```typescript
    options: {
      help: { type: 'boolean', short: 'h' },
      artifact: { type: 'string' },
      notes: { type: 'string' },
      operator: { type: 'string' },
      'non-interactive': { type: 'boolean' },
    },
```

```typescript
    const operator = values.operator
    if (operator !== undefined && !/^[A-Za-z0-9._:-]{1,64}$/.test(operator)) {
      throw new Error('--operator must match /^[A-Za-z0-9._:-]{1,64}$/')
    }
    if (values['non-interactive'] === true && operator === undefined) {
      throw new Error('--non-interactive requires --operator <id>')
    }
    const result = await runApprove({
      phase: positionals[0],
      artifact: values.artifact,
      notes: values.notes,
      operator,
      nonInteractive: values['non-interactive'] === true,
      ...(operator !== undefined ? { approvedBy: `operator:${operator}` } : {}),
    })
```

- [ ] **Step 9: Record operator on `run_started`**

Complete Task 4 Step 3 if deferred: pass `parsed.operator` into the `run_started` event payload in `runCommand`.

- [ ] **Step 10: Run tests + typecheck**

Run: `bun test tests/operator-mode.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/commands/approve.ts src/state/schemas.ts src/state/run.ts src/commands/run.ts tests/operator-mode.test.ts
git commit -m "feat(operator): approve flags, SHIP block, and operator provenance"
```

---

## Task 6: The agentskills.io skill + boundary check

**Files:**
- Create: `agent-skills/code-oz/SKILL.md`
- Create: `agent-skills/code-oz/README.md` (install guidance)
- Test: `tests/agent-skill-boundaries.test.ts` (create)

- [ ] **Step 1: Write the failing boundary test**

Create `tests/agent-skill-boundaries.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL = readFileSync(join(import.meta.dir, '..', 'agent-skills', 'code-oz', 'SKILL.md'), 'utf8')

describe('code-oz agent skill boundaries', () => {
  test('has agentskills.io frontmatter (name + description)', () => {
    expect(SKILL).toMatch(/^---/)
    expect(SKILL).toMatch(/\nname:\s*code-oz/)
    expect(SKILL).toMatch(/\ndescription:\s*\S/)
  })

  for (const phrase of [
    '--operator',
    '--non-interactive',
    '.code-oz/', // names the dir it must not write
    'fake', // must forbid fake
    'NEEDS_INTERVENTION',
  ]) {
    test(`mentions the boundary token: ${phrase}`, () => {
      expect(SKILL).toContain(phrase)
    })
  }

  test('forbids writing .code-oz and deciding pass/fail', () => {
    expect(SKILL.toLowerCase()).toContain('never write')
    expect(SKILL.toLowerCase()).toMatch(/pass\/fail|pass or fail/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/agent-skill-boundaries.test.ts`
Expected: FAIL — `agent-skills/code-oz/SKILL.md` does not exist.

- [ ] **Step 3: Write the skill**

Create `agent-skills/code-oz/SKILL.md`:

````markdown
---
name: code-oz
description: Drive the code-oz agentic SDLC runtime to build or fix code with enforced gates and cross-family review. Use when the user asks to build, implement, or fix something in a code repository and wants gated, reviewed delivery rather than ad-hoc edits.
---

# Driving code-oz

code-oz is a gated SDLC runtime. YOU are the operator; code-oz owns the gates,
the event log, and cross-family review. You drive it through its CLI. You never
write its state.

## Preconditions

1. Check it is installed: run `code-oz --version` (or `code-oz doctor`).
2. If it is missing, STOP and tell the user to install it:
   `npm i -g @tuel/code-oz`  OR  `brew install omerakben/tap/code-oz`.
   Do NOT auto-run `curl`, `npx`, or `bunx` to install it yourself.

## How to drive it

Always pass `--operator <your-agent-name> --non-interactive`:

- Start/advance a run:
  `code-oz run --operator <agent> --non-interactive --request "<the task>"`
- Approve a reversible gate when the engine asks for it (name the phase):
  `code-oz approve --operator <agent> --non-interactive <phase>`
  (phases: define, audit, plan, build, verify, review)
- Check or continue: `code-oz status`, `code-oz resume`, `code-oz doctor`.

Read the engine's stdout and the run's `state/` gate files + `events.jsonl` as
the only source of truth for what happened.

## Hard boundaries (do not cross)

- Never write under `.code-oz/`, never create or edit gate files (`GATE_*`),
  `events.jsonl`, artifacts, or config.
- Never decide pass/fail yourself. The engine decides; you relay it.
- Never simulate or claim to perform cross-family review. The engine owns it.
- Never use the fake provider, `--fake-script`, or `--artifact`. They are
  rejected in `--non-interactive` mode anyway.
- Never `git push`, merge, or publish. SHIP is human-only: when the engine says
  human approval is required, surface that and stop.
- Run one code-oz run at a time.

## When the engine stops

If the engine writes `NEEDS_INTERVENTION.json`, `PAUSE.json`, or `STOP.json`, or
prints "human approval required", surface the file path / message verbatim to the
user and stop. Do not open the file to decide a verdict, and do not start a fresh
run to retry unless the user asks.
````

- [ ] **Step 4: Write the install README**

Create `agent-skills/code-oz/README.md`:

```markdown
# code-oz agent skill (Hermes / OpenClaw)

Text-only agentskills.io skill that teaches a self-hosted agent to drive the
`code-oz` CLI safely. No bundled executable — the agent calls an installed
`code-oz` directly.

## Install

Copy this `code-oz/` folder into your agent's skills directory:

- Hermes: `~/.hermes/skills/code-oz/`  (or `hermes skills add <path>`)
- OpenClaw: your personal/project skills dir.

Then ensure the engine is installed: `npm i -g @tuel/code-oz` or
`brew install omerakben/tap/code-oz`.

The skill drives code-oz in `--non-interactive --operator <agent>` mode, which
fails closed: it bans the fake provider, blocks SHIP/push, and records operator
provenance. code-oz remains the only writer of gates, events, and reviews.
```

- [ ] **Step 5: Run the boundary tests**

Run: `bun test tests/agent-skill-boundaries.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck + commit**

Run: `bun test && bun run typecheck` → PASS

```bash
git add agent-skills/code-oz/SKILL.md agent-skills/code-oz/README.md tests/agent-skill-boundaries.test.ts
git commit -m "feat(operator): text-only agentskills.io skill for Hermes/OpenClaw"
```

---

## Task 7: Docs truth-sync + help text

**Files:**
- Modify: `src/commands/run.ts` (`RUN_HELP`), `src/commands/approve.ts` (`printHelp`)
- Modify: `docs/contracts/PROVIDERS.md` or the relevant CLI reference (note external-operator mode)

- [ ] **Step 1: Add the flags to `RUN_HELP` and approve `printHelp`**

Document `--operator <id>` and `--non-interactive` in both help strings, including the fail-closed semantics (bans fake, blocks SHIP).

- [ ] **Step 2: Note external-operator mode in the CLI/contract docs**

Add a short subsection where the run/approve flags are documented, pointing to `docs/design/HERMES_OPERATOR_DRIVER_DESIGN.md` and the `agent-skills/code-oz/` skill.

- [ ] **Step 3: Full suite + commit**

Run: `bun test` → PASS

```bash
git add -A
git commit -m "docs(operator): document --operator/--non-interactive + agent-skill"
```

---

## Self-review notes (coverage vs spec)

- Step 0 revert → Task 0. Engine fake-ban → Tasks 2+4. SHIP block → Task 5. Operator provenance (run_started + gate_written) → Tasks 4 Step 3 + 5. Explicit-phase requirement → Task 5 Step 6. Skill (text-only) → Task 6. Rule-8 coexistence preserved by scoping every ban to `nonInteractive` and never touching `buildProviderRegistry` (Tasks 2/4).
- Deferred items (config-hash, request cap/redact, `--request-file` rejection, `--artifact` ban, concurrent-run engine refusal, MCP, bundled resolver) are intentionally NOT tasks — they are the documented Full-scope follow-up.
- Per-commit cross-model review: run a Codex review after each `feat(operator)` commit (project rule), and a final pre-tag Codex review before merge.
```
