// M16 C12 — helpers for the binary-spawn multi-task e2e test
// (`tests/e2e/cli-multi-task-cycle.test.ts`).
//
// Codex pre-design review pinned 4 block-push + 5 fix-soon mods; this
// helper module embodies them:
//
//   Mod 1: real source paths — dispatchers live in src/commands/run.ts;
//          locks under <runDir>/.{build,verify,review}.lock; lock module
//          is src/state/lock.ts.
//   Mod 2: per-spawn JSONL fixtures because FakeMatch only supports
//          phase + agent (src/providers/fake.ts:33). Each `code-oz run`
//          re-loads the script and resets the FIFO queue, so a single
//          static file cannot drive 3 different BUILD bodies.
//   Mod 3: spawn target is `bun run src/cli.ts` with stdin: 'ignore'
//          and pipe stdio (mirrors tests/define-fixture.test.ts:40).
//   Mod 4: lock-cleanup teardown — rm -rf the temp project after every
//          test plus an explicit "no dangling locks anywhere" assertion
//          on the success path.
//   Mod 5: ship oracle reads current.json + counts task_completed +
//          phase_entered(ship) events from events.jsonl. Doctor run
//          is exercised separately by tests/commands-doctor-run.test.ts.
//   Mod 6: validation command is `true` (resolves through PATH; no shell
//          metacharacters; argv-only grammar at src/tools/command-grammar.ts).
//          BUILDER patches touch non-test files so mutation status stays
//          'not-applicable' (src/phases/verify-mutation.ts).
//   Mod 7: single reviewer; no panel block in config so panel mode never
//          activates (src/phases/review-panel.ts:198).
//   Mod 8: coverage = T-001 happy + T-002 needs-revision-restart + T-003
//          happy. Exercises C8 needs_revision + review_remediation_recorded
//          + C9 review-remediation pre-route + C9 task-loop dispatch
//          + C9 worktree task-boundary recreate.
//   Mod 9: 120s timeouts (Bun default 5s) — the e2e drives ~24 spawns.
//   Mod 10: assert NO debate_scheduler_fired event (manual mode default
//           per src/config/schema.ts:214; src/policy/debate-scheduler.ts:197).

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import {
  PLAN_READY_SIGNAL,
} from '../../../src/phases/plan.ts'
import { BUILD_READY_SIGNAL } from '../../../src/phases/build.ts'
import { VERIFY_READY_SIGNAL } from '../../../src/phases/verify.ts'
import { REVIEW_READY_SIGNAL } from '../../../src/phases/review.ts'
import { runGit } from '../../../src/worktree/create-run-worktree.ts'
import { initProject } from '../../../src/commands/init.ts'

const REPO_ROOT = (() => {
  // tests/e2e/helpers -> tests/e2e -> tests -> repo root
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..')
})()

export const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')
export const FAKE_SCRIPT_ENV = 'CODE_OZ_TEST_FAKE_SCRIPT_OK' as const

// --- spawn ---------------------------------------------------------

export interface CliResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

/**
 * Spawn `bun run src/cli.ts` with the given args and collect stdout +
 * stderr + exit code. The harness mirrors tests/define-fixture.test.ts
 * (`stdin: 'ignore'`, `stdout/stderr: 'pipe'`) — production seams under
 * test ARE the binary's argv parsing + dispatch chain, NOT the in-process
 * dispatchers (Codex Mod #1 + Mod #3 + L4 in SESSION_M16_KICKOFF.md).
 */
export async function runCli(
  cwd: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string | undefined>> = {},
): Promise<CliResult> {
  const start = performance.now()
  const proc = Bun.spawn({
    cmd: ['bun', 'run', CLI_ENTRY, ...args],
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      [FAKE_SCRIPT_ENV]: '1',
      ...extraEnv,
    },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  const durationMs = Math.round(performance.now() - start)
  return Object.freeze({ exitCode, stdout, stderr, durationMs })
}

// --- per-spawn JSONL writer ----------------------------------------

export interface FakeScriptEntryLiteral {
  readonly matcher: { readonly phase?: string; readonly agent?: string }
  readonly response: { readonly content: string }
}

/**
 * Write a JSONL fake-script. One entry per line, FIFO order. The CLI
 * loads this on every spawn (src/commands/run.ts:142-159) and applies
 * it via applyFakeScript (src/providers/fake-script.ts) — a fresh
 * FakeProvider per process, so each spawn gets a clean queue.
 *
 * Codex Mod #2: script per spawn — FakeMatch supports only phase+agent.
 * A single static fixture cannot disambiguate T-001's BUILDER body from
 * T-002's because both match `{phase: 'build', agent: 'builder'}`.
 */
export async function writeFakeScript(
  path: string,
  entries: readonly FakeScriptEntryLiteral[],
): Promise<void> {
  const lines = entries.map((e) => JSON.stringify(e))
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
}

// --- project setup -------------------------------------------------

export interface MultiTaskProject {
  readonly tmpRoot: string
  readonly projectRoot: string
  readonly stateDir: string
  readonly artifactsDir: string
  readonly scriptDir: string
}

/**
 * Create a tmp project with the multi-task fixture sources, run
 * `code-oz init` programmatically, init git so worktree creation has a
 * base commit, return the path layout.
 */
export async function setupMultiTaskProject(): Promise<MultiTaskProject> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'code-oz-c12-'))
  const projectRoot = join(tmpRoot, 'project')
  await mkdir(projectRoot, { recursive: true })

  // Three source files — one per task. Non-test paths so the verify
  // mutation gate stays 'not-applicable' (Mod 6).
  await mkdir(join(projectRoot, 'src'), { recursive: true })
  await writeFile(
    join(projectRoot, 'src', 'alpha.ts'),
    `// Source for T-001.
export function alpha(): string {
  return 'alpha'
}
`,
    'utf8',
  )
  await writeFile(
    join(projectRoot, 'src', 'beta.ts'),
    `// Source for T-002.
export function beta(): string {
  return 'beta'
}
`,
    'utf8',
  )
  await writeFile(
    join(projectRoot, 'src', 'gamma.ts'),
    `// Source for T-003.
export function gamma(): string {
  return 'gamma'
}
`,
    'utf8',
  )
  await writeFile(
    join(projectRoot, 'README.md'),
    '# multi-task fixture\n',
    'utf8',
  )

  // initProject scaffolds .code-oz/ — same path the CLI would create.
  await initProject({ cwd: projectRoot, force: false })

  // Bug 8/11 closure — bump per-phase budgets so the e2e can drive 3
  // tasks × multiple BUILD/VERIFY/REVIEW spawns + a needs-revision
  // restart on T-002 without tripping the default caps in
  // src/config/schema.ts:297-305 (verify ships with maxProviderCalls=5,
  // build with 25, review with 10 — too tight for a 3-task lifecycle
  // with restart). The fixture YAML round-trip preserves formatting so
  // the rest of DEFAULT_CONFIG stays as initProject wrote it.
  const configPath = join(projectRoot, '.code-oz', 'config.yaml')
  const configRaw = await readFile(configPath, 'utf8')
  const cfg = parseYaml(configRaw) as Record<string, unknown>
  // Phase 1.6 (1000-star plan) — detector marks this fixture as
  // brownfield (populated `src/` directory triggers BROWNFIELD_SOURCE_DIRS),
  // but the multi-task lifecycle this helper drives is a greenfield
  // DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP flow. Force the
  // profile back to greenfield so `run_started.profile` matches the
  // phase sequence the tests assert on. Without this override, the
  // brownfield profile would route fresh runs to AUDIT (M17 work),
  // which is not what these greenfield e2es exercise.
  cfg.profile = 'greenfield'
  const budgets = (cfg.budgets ??= {}) as Record<string, unknown>
  budgets.perPhase = {
    define: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    plan: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    build: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    verify: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    review: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    ship: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    audit: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
  }
  await writeFile(configPath, stringifyYaml(cfg), 'utf8')

  // Verify the override actually wrote to disk (defensive — earlier
  // attempts claimed the override applied but it was missing from the
  // helper). Re-read and assert the verify maxProviderCalls is the
  // bumped value, not the schema default of 5.
  const writtenRaw = await readFile(configPath, 'utf8')
  const written = parseYaml(writtenRaw) as {
    budgets?: { perPhase?: { verify?: { maxProviderCalls?: number } } }
  }
  const writtenVerifyCalls = written.budgets?.perPhase?.verify?.maxProviderCalls
  if (writtenVerifyCalls !== 60) {
    throw new Error(
      `setupMultiTaskProject: budget override did not propagate to ${configPath}.` +
        ` budgets.perPhase.verify.maxProviderCalls=${String(writtenVerifyCalls)} (expected 60)`,
    )
  }

  // git init so the worktree wrapper has a base commit. Fail-fast on
  // git missing — the e2e cannot run without it.
  const requireGit = async (args: readonly string[]): Promise<void> => {
    const r = await runGit(projectRoot, args)
    if (!r.ok) {
      throw new Error(
        `git ${args.join(' ')} failed: exit=${String(r.exitCode)} stderr=${r.stderr}`,
      )
    }
  }
  await requireGit(['init', '-q', '-b', 'main'])
  await requireGit(['config', 'user.email', 'test@example.com'])
  await requireGit(['config', 'user.name', 'Test'])
  await requireGit(['config', 'commit.gpgsign', 'false'])
  await requireGit(['add', '-A'])
  await requireGit(['commit', '-q', '-m', 'init multi-task fixture'])

  // Per-spawn fake-script files live alongside the project so cleanup
  // is one rm -rf.
  const scriptDir = join(tmpRoot, 'scripts')
  await mkdir(scriptDir, { recursive: true })

  return Object.freeze({
    tmpRoot,
    projectRoot,
    stateDir: join(projectRoot, '.code-oz', 'state'),
    artifactsDir: join(projectRoot, '.code-oz', 'artifacts'),
    scriptDir,
  })
}

// --- run-id discovery ----------------------------------------------

/**
 * Read state/active.json and return the active runId. The DEFINE spawn
 * is the only one that creates this file; later spawns assume it.
 */
export async function readActiveRunId(stateDir: string): Promise<string> {
  const activeFile = join(stateDir, 'active.json')
  const raw = await readFile(activeFile, 'utf8')
  const parsed = JSON.parse(raw) as { runId?: string }
  if (typeof parsed.runId !== 'string' || parsed.runId.length === 0) {
    throw new Error(`active.json missing runId: ${raw}`)
  }
  return parsed.runId
}

export function runDirFor(stateDir: string, runId: string): string {
  return join(stateDir, 'runs', runId)
}

// --- events.jsonl ---------------------------------------------------

export interface RawEvent {
  readonly type?: string
  readonly phase?: string
  readonly taskId?: string
  readonly attempt?: number
  readonly reviewRound?: number
  readonly nextReviewRound?: number
  readonly remediationIntent?: string
  readonly providerAlias?: string
  readonly outcome?: string
  readonly [key: string]: unknown
}

export async function readEventsRaw(
  stateDir: string,
  runId: string,
): Promise<readonly RawEvent[]> {
  const eventsFile = join(runDirFor(stateDir, runId), 'events.jsonl')
  const raw = await readFile(eventsFile, 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as RawEvent)
}

export async function readCurrentJson(
  stateDir: string,
  runId: string,
): Promise<{ readonly currentPhase?: string; readonly [k: string]: unknown }> {
  const file = join(runDirFor(stateDir, runId), 'current.json')
  const raw = await readFile(file, 'utf8')
  return JSON.parse(raw) as { readonly currentPhase?: string }
}

// --- lock-leak audit (Mod 4) --------------------------------------

/**
 * Walk the project tree looking for any leftover lock dirs. Per Codex
 * Mod #4: success-path assertion — after the test completes, no
 * `<runDir>/.{build,verify,review}.lock` should exist anywhere. The
 * underlying lock primitive (src/state/lock.ts:18) only removes the
 * dir in finally, so a killed subprocess leaves them behind.
 */
export async function findDanglingLocks(
  projectRoot: string,
): Promise<readonly string[]> {
  const stateRuns = join(projectRoot, '.code-oz', 'state', 'runs')
  if (!existsSync(stateRuns)) return Object.freeze([])
  const fs = await import('node:fs/promises')
  const runs = await fs.readdir(stateRuns)
  const found: string[] = []
  for (const r of runs) {
    const runDir = join(stateRuns, r)
    for (const name of ['.build.lock', '.verify.lock', '.review.lock', '.worktree.lock', '.lock']) {
      const candidate = join(runDir, name)
      if (existsSync(candidate)) {
        try {
          if (statSync(candidate).isDirectory()) found.push(candidate)
        } catch {
          // raced disappearance — fine.
        }
      }
    }
  }
  return Object.freeze(found)
}

// --- canned response constants -------------------------------------

/**
 * Persona response constants. Authored once, reused across the per-spawn
 * scripts the test composes. Each constant is a complete persona reply
 * (signal + body) so we never assemble strings ad-hoc inside the test.
 */

export const BA_READY_REPLY = `<spec-ready/>
# SPEC

## Goals

- Add light-weight identity stamps to the alpha, beta, and gamma helpers.
- Keep each helper deterministic and self-contained.

## Users

- Repository contributors maintaining the helpers.

## Constraints

- No new dependencies.
- Each helper continues to compile under Bun + TypeScript strict mode.

## Acceptance criteria

- alpha(), beta(), and gamma() each return a stable string identity.
- Future regressions in any one helper do not bleed into the others.

## Open questions

- None known at define time.

## Explicit non-goals

- Not adding tests in this milestone.
`

/**
 * PLAN.md with three tasks. Validation command is `true` (Mod 6) so
 * VERIFY's runner exits 0 with no shell metacharacters. Each task
 * touches a different non-test source file so mutation status stays
 * 'not-applicable' across the run.
 */
export const PLAN_RESPONSE = `${PLAN_READY_SIGNAL}
# PLAN

## Goals

- Decompose SPEC into three atomic helper-stamp tasks.

## Tasks

### T-001: Stamp alpha helper

- Files: src/alpha.ts
- Validation: true
- Risk: stamp drift if alpha is renamed.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

### T-002: Stamp beta helper

- Files: src/beta.ts
- Validation: true
- Risk: stamp drift if beta is renamed.
- Hypotheses: H-002
- Sources: SC-SPEC-002, SC-REF-NONE-001, SC-DOC-NONE-001

### T-003: Stamp gamma helper

- Files: src/gamma.ts
- Validation: true
- Risk: stamp drift if gamma is renamed.
- Hypotheses: H-003
- Sources: SC-SPEC-003, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md acceptance criteria 1-3.

## Out of scope

- Adding tests for the helpers.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: alpha identity stamp

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: alpha(), beta(), and gamma() each return a stable string identity.

### SC-SPEC-002: beta identity stamp

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: alpha(), beta(), and gamma() each return a stable string identity.

### SC-SPEC-003: gamma identity stamp

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: alpha(), beta(), and gamma() each return a stable string identity.

## Reference sources

### SC-REF-NONE-001: No reference patterns required

- Searched: src/**/*.ts
- Result: 0 hits
- Why explicit: each helper is a literal string return; no existing pattern to reuse.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: helpers are hand-written; no API surface.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
- T-002 -> SC-SPEC-002, SC-REF-NONE-001, SC-DOC-NONE-001
- T-003 -> SC-SPEC-003, SC-REF-NONE-001, SC-DOC-NONE-001
`

/** Scientist tail — phase value is interpolated. */
export function scientistResponse(phase: 'plan' | 'build' | 'verify' | 'review'): string {
  return `<scientist-ready/>
# HYPOTHESES

## H-001: alpha helper retains its identity

- Phase: ${phase}
- Status: open
- Falsifier: alpha() returns the wrong identity stamp.
- Evidence: SPEC.md AC-1.
- Risk if false: alpha helper drift.

## H-002: beta helper retains its identity

- Phase: ${phase}
- Status: open
- Falsifier: beta() returns the wrong identity stamp.
- Evidence: SPEC.md AC-1.
- Risk if false: beta helper drift.

## H-003: gamma helper retains its identity

- Phase: ${phase}
- Status: open
- Falsifier: gamma() returns the wrong identity stamp.
- Evidence: SPEC.md AC-1.
- Risk if false: gamma helper drift.

# OPEN QUESTIONS

## Q-001: should we add a CLI flag to print all stamps?

- Phase: ${phase}
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC open question carries forward.
- Resolution attempts: none yet.
`
}

/**
 * BUILDER response per task. Each task touches a different source file
 * with a docstring addition (modified, not added — keeps verify mutation
 * gate not-applicable) and a stamp constant.
 *
 * Attempt 1 transforms the pristine fixture (4 lines) into a 5-line file
 * by inserting a docstring and renaming the return value to
 * `<fnName>-stamp`.
 *
 * Attempt 2 (only T-002 in the e2e) is a DELTA on attempt 1's post-state.
 * Bug 5 closure: review-needs-revision restart preserves the worktree
 * (semantically distinct from verify-fail restart, which destroys it),
 * so attempt 2's pre-image must match what attempt 1 left behind. The
 * round-2 patch keeps the file at 5 lines and rewrites the docstring +
 * return value from `<fnName>-stamp` to `<fnName>-stamp-r2`. Without this
 * delta-shape attempt 2's `git apply --index` would fail with a context
 * mismatch and BUILD attempt 2 would never reach VERIFY/REVIEW.
 */
export function builderResponse(taskId: 'T-001' | 'T-002' | 'T-003', attempt: 1 | 2): string {
  const file = taskMap[taskId].file
  const fnName = taskMap[taskId].fnName
  const stampLabel = attempt === 1 ? `${fnName}-stamp` : `${fnName}-stamp-r2`
  const note =
    attempt === 1
      ? `- Risk: stamp drift if ${fnName} is renamed.`
      : `- Risk: stamp drift addressed by stable suffix on round-2 attempt.`
  const diffBody =
    attempt === 1
      ? `@@ -1,4 +1,5 @@
 // Source for ${taskId}.
+/** Identity stamp: ${stampLabel}. */
 export function ${fnName}(): string {
-  return '${fnName}'
+  return '${stampLabel}'
 }`
      : `@@ -1,5 +1,5 @@
 // Source for ${taskId}.
-/** Identity stamp: ${fnName}-stamp. */
+/** Identity stamp: ${stampLabel}. */
 export function ${fnName}(): string {
-  return '${fnName}-stamp'
+  return '${stampLabel}'
 }`
  return `${BUILD_READY_SIGNAL}

\`\`\`diff
diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
${diffBody}
\`\`\`

## Title
Stamp ${fnName} helper${attempt === 2 ? ' (round 2)' : ''}

## Notes
${note}
`
}

const taskMap: Readonly<Record<'T-001' | 'T-002' | 'T-003', { file: string; fnName: 'alpha' | 'beta' | 'gamma' }>> = Object.freeze({
  'T-001': { file: 'src/alpha.ts', fnName: 'alpha' },
  'T-002': { file: 'src/beta.ts', fnName: 'beta' },
  'T-003': { file: 'src/gamma.ts', fnName: 'gamma' },
})

/** Verifier response — short rationale; runner exits 0 against `true`. */
export const VERIFIER_RESPONSE = `${VERIFY_READY_SIGNAL}

## Rationale
validation command \`true\` exited 0; no test files added so mutation gate is not-applicable.
`

/** Reviewer response — round 1 ready (T-001, T-003). */
export const REVIEWER_READY_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

- None.

## Score

- Final score: 8
`

/**
 * Reviewer response — round 1 needs-revision (T-002 round 1). One
 * fix-first finding at score 4 → canonical verdict needs-revision.
 */
export const REVIEWER_NEEDS_REVISION_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

### F-NEW: stamp label could be more descriptive

- File: src/beta.ts
- Line: 1-5
- Severity: fix-first
- Recommendation: extend the stamp suffix so future regressions are recognisable.
- Round raised: 1
- Round resolved: unresolved

## Score

- Final score: 4
`

/**
 * Reviewer response — round 2 ready (T-002 round 2). The previously
 * raised F-001 is marked resolved.
 */
export const REVIEWER_ROUND_2_READY_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

### F-001: stamp label could be more descriptive

- File: src/beta.ts
- Line: 1-5
- Severity: fix-first
- Recommendation: extend the stamp suffix so future regressions are recognisable.
- Round raised: 1
- Round resolved: 2

## Score

- Final score: 8
`

// --- script builders -----------------------------------------------

export const buildBuilderEntry = (
  taskId: 'T-001' | 'T-002' | 'T-003',
  attempt: 1 | 2,
): FakeScriptEntryLiteral =>
  Object.freeze({
    matcher: { phase: 'build', agent: 'builder' },
    response: { content: builderResponse(taskId, attempt) },
  })

export const buildScientistEntry = (
  phase: 'plan' | 'build' | 'verify' | 'review',
): FakeScriptEntryLiteral =>
  Object.freeze({
    matcher: { phase, agent: 'scientist' },
    response: { content: scientistResponse(phase) },
  })

export const buildVerifierEntry = (): FakeScriptEntryLiteral =>
  Object.freeze({
    matcher: { phase: 'verify', agent: 'verifier' },
    response: { content: VERIFIER_RESPONSE },
  })

export const buildReviewerEntry = (
  outcome: 'ready' | 'needs-revision' | 'round2-ready',
): FakeScriptEntryLiteral => {
  let content: string
  if (outcome === 'ready') content = REVIEWER_READY_RESPONSE
  else if (outcome === 'needs-revision') content = REVIEWER_NEEDS_REVISION_RESPONSE
  else content = REVIEWER_ROUND_2_READY_RESPONSE
  return Object.freeze({
    matcher: { phase: 'review', agent: 'reviewer' },
    response: { content },
  })
}

// --- teardown helpers ----------------------------------------------

export async function rmTmp(tmp: string): Promise<void> {
  await rm(tmp, { recursive: true, force: true })
}
