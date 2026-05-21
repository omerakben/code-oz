// M17 C8 — brownfield AUDIT full-cycle e2e (the capstone deepening of C1).
//
// C1 (tests/e2e/audit-brownfield-cli.test.ts) proves the auditor persona is
// INVOKED on a brownfield run. It does NOT prove the full pipeline completes:
// the FakeProvider default reply is not a valid AUDIT.md, so a C1 run invokes
// the auditor then ends in an `audit_validation_failed` intervention.
//
// This file aims to drive the WHOLE brownfield chain green by feeding a VALID,
// protocol-faithful AUDIT.md reply through the spawned CLI via the
// `--fake-script` seam (gated behind `--provider fake` +
// CODE_OZ_TEST_FAKE_SCRIPT_OK=1), then assert the complete chain:
// AUDIT run → events → approve audit → PLAN reads AUDIT.md.
//
// ----------------------------------------------------------------------
// TWO SRC BUGS IN `src/phases/audit.ts` BLOCKED THE FULL CHAIN (C8 found them;
// both are now FIXED in src/phases/audit.ts + src/commands/run.ts).
//
//   BUG A — ready signal not stripped before validate/write. The auditor
//     persona emits `<audit-ready/>` on its own line, THEN the canonical
//     `# AUDIT` document. Every other phase strips its ready signal before
//     parsing (PLAN: `splitPlanResponse`, src/phases/plan.ts:231-250).
//     `runAudit` accumulated the raw reply and fed it DIRECTLY to
//     `parseAuditMarkdown` + `atomicWriteFile` WITHOUT stripping the signal,
//     so the signal line pushed the frontmatter off line 1 and the validator
//     rejected every protocol-faithful draft with `audit_missing_frontmatter`.
//     FIX: `splitAuditResponse` strips the signal before validate/write; an
//     absent signal is a protocol violation routed to `audit_validation_failed`.
//
//   BUG B — Scientist phase-tail never ran in AUDIT. AUDIT is a primary-artifact
//     phase, so rule 15 + docs/contracts/AUDIT.md § "Scientist tail" require
//     HYPOTHESES.md + OPEN_QUESTIONS.md. PLAN/BUILD/VERIFY/REVIEW all call
//     `runScientistPhaseTail`; AUDIT did not, so the sidecars were never written
//     and `code-oz approve audit` (validateScientistSidecars) could never pass.
//     FIX: dispatchAudit resolves the `scientist` persona and passes it to
//     runAudit, which runs `runScientistPhaseTail` for phase `audit` after
//     emitting `audit_completed` and before `gate_required(audit)`.
// ----------------------------------------------------------------------
//
// The behavior under test is driven exclusively by spawning the real CLI binary
// as a subprocess and asserting on events.jsonl / on-disk artifacts. The ONLY
// synthetic state this file constructs is the minimal precondition for the
// active-run continuation: a run legitimately at `currentPhase: 'audit'`,
// reached ONLY through the real state primitives `initRun` + `writeActiveRun`.
// No event line is hand-written; no gate file or artifact is faked. The valid
// AUDIT.md would be produced by the spawned CLI's AUDIT runtime from the
// fake-script reply, never written by this test.
//
// Why active-run continuation (not a fresh brownfield run): the AUDIT.md
// frontmatter `runId` MUST match the active run (validateAuditMarkdown's
// `expectedRunId`), and the auditor's reply is a STATIC fake-script string. A
// fresh run generates its ULID inside the spawn, so the fixture cannot pin it.
// Pre-creating the run with a known ULID via `initRun` lets the fixture embed
// the exact runId, then `code-oz run` (no --request) continues into AUDIT.

import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { initProject } from '../../src/commands/init.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'
import { runGit } from '../../src/worktree/create-run-worktree.ts'
import { initRun, runPathsFor, writeActiveRun } from '../../src/state/run.ts'
import { generateUlid } from '../../src/state/schemas.ts'
import { paths as codeOzPaths } from '../../src/paths.ts'
import { AUDIT_READY_SIGNAL, splitAuditResponse } from '../../src/phases/audit.ts'
import { validateAuditMarkdown } from '../../src/artifacts/audit-schema.ts'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')
const FAKE_SCRIPT_ENV = 'CODE_OZ_TEST_FAKE_SCRIPT_OK'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('M17 C8 brownfield full-cycle e2e requires git >= 2.40 on PATH')
  }
})

interface FixtureLayout {
  readonly tmpRoot: string
  readonly projectRoot: string
  readonly stateDir: string
  readonly artifactRoot: string
  readonly scriptDir: string
}

const OPERATOR_STATEMENT =
  'gate approval silently succeeds on a PLAN.md that is missing the Tasks section'

/**
 * Scaffold a git-initialized, brownfield-configured project. Mirrors the C1
 * setup (real git init, `initProject`, flip profile to brownfield) and adds a
 * scripts dir for per-spawn fake-script files. Per-phase budgets are bumped so
 * the chain (AUDIT + PLAN spawns) does not trip the default caps.
 */
async function setupBrownfieldProject(): Promise<FixtureLayout> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'code-oz-m17c8-'))
  const projectRoot = join(tmpRoot, 'project')
  await mkdir(projectRoot, { recursive: true })

  await writeFile(join(projectRoot, 'README.md'), '# fixture\n', 'utf8')
  await writeFile(
    join(projectRoot, 'index.ts'),
    'export function add(a: number, b: number): number {\n  return a + b\n}\n',
    'utf8',
  )
  await runGit(projectRoot, ['init', '-q', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.email', 'm17c8@test'])
  await runGit(projectRoot, ['config', 'user.name', 'M17C8'])
  await runGit(projectRoot, ['config', 'commit.gpgsign', 'false'])
  await runGit(projectRoot, ['add', '-A'])
  await runGit(projectRoot, ['commit', '-q', '-m', 'init fixture'])

  await initProject({ cwd: projectRoot, force: false })

  const configPath = join(projectRoot, '.code-oz', 'config.yaml')
  const cfg = parseYaml(await readFile(configPath, 'utf8')) as Record<string, unknown>
  cfg.profile = 'brownfield'
  const budgets = (cfg.budgets ??= {}) as Record<string, unknown>
  budgets.perPhase = {
    audit: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    plan: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    build: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    verify: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    review: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    ship: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
  }
  await writeFile(configPath, stringifyYaml(cfg), 'utf8')

  const cz = codeOzPaths(projectRoot)
  const scriptDir = join(tmpRoot, 'scripts')
  await mkdir(scriptDir, { recursive: true })
  return Object.freeze({
    tmpRoot,
    projectRoot,
    stateDir: cz.state,
    artifactRoot: cz.artifacts,
    scriptDir,
  })
}

interface ParsedEvent {
  readonly type?: string
  readonly phase?: string
  readonly agent?: string
  readonly auditReportSha256?: string
  // agent_invoked records the attached files under `manifest.files[].path`
  // (NOT a top-level `files` array) — see src/providers/invoke.ts and the
  // established assertion in tests/plan-phase.test.ts:252-254.
  readonly manifest?: { readonly files?: readonly { readonly path?: string }[] }
  readonly [key: string]: unknown
}

async function readEventsFromFile(eventsFile: string): Promise<readonly ParsedEvent[]> {
  const text = await readFile(eventsFile, 'utf8').catch(() => '')
  const out: ParsedEvent[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line) as ParsedEvent)
    } catch {
      // ignore malformed lines
    }
  }
  return out
}

interface SpawnResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function spawnCli(
  cwd: string,
  args: readonly string[],
  fakeScriptPath?: string,
): Promise<SpawnResult> {
  const cmd = [
    'bun',
    'run',
    CLI_ENTRY,
    ...args,
    ...(fakeScriptPath !== undefined ? ['--fake-script', fakeScriptPath] : []),
  ]
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0', [FAKE_SCRIPT_ENV]: '1' },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

interface FakeScriptEntry {
  readonly matcher: { readonly phase?: string; readonly agent?: string }
  readonly response: { readonly content: string }
}

async function writeFakeScript(path: string, entries: readonly FakeScriptEntry[]): Promise<void> {
  await writeFile(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8')
}

// --- valid AUDIT.md reply (based on docs/contracts/AUDIT.md Fixture 1) ----
//
// runId is interpolated so the frontmatter matches the active run (the
// validator's `expectedRunId` check). The body is the contract's Fixture 1
// (regression), which is a known-valid AUDIT.md.
function auditReply(runId: string): string {
  return `${AUDIT_READY_SIGNAL}
---
artifact: AUDIT.md
version: "0.1"
runId: ${runId}
phase: audit
profile: brownfield
generatedAt: 2026-05-21T09:00:00Z
operatorStatement: ${OPERATOR_STATEMENT}
---

# AUDIT

## Localization

- src/artifacts/plan.ts:214-230 — validatePlanMarkdown; Tasks section check is absent from the required-sections array.
- src/commands/approve.ts:494-498 — preApprovePlanHook calls validatePlanMarkdown but does not assert Tasks presence separately.
- tests/artifacts/plan.test.ts:88-102 — existing test suite has no fixture for a Tasks-absent PLAN.md.

## Reproduction

- Proposed: approving a PLAN.md with no ## Tasks section exits 0 and writes GATE_PLAN_PASSED.json.
- Observed: src/artifacts/plan.ts:214-230 — REQUIRED_SECTIONS array is ['Goals', 'Sources', 'Out of scope', 'Open questions']; 'Tasks' is absent. Confirmed by grep.
- Observed: tests/artifacts/plan.test.ts:88-102 — no test exercises a Tasks-absent fixture. Confirmed by read.

## Constraints

- Preserve: all existing plan validation tests must remain green.
- Preserve: PLAN.md files generated before this fix that contain Tasks are unaffected; the fix adds a check, not a structural change.
- Require: the fix adds 'Tasks' to REQUIRED_SECTIONS in src/artifacts/plan.ts; no schema changes elsewhere.

## Audit sources

- src/artifacts/plan.ts:214-230 — read REQUIRED_SECTIONS array.
- src/commands/approve.ts:494-498 — read preApprovePlanHook call chain.
- tests/artifacts/plan.test.ts:88-102 — read existing fixture coverage.
`
}

// Scientist phase-tail reply for the AUDIT phase (rule 15). The Scientist tail
// runs after the Auditor and writes HYPOTHESES.md + OPEN_QUESTIONS.md before the
// gate. Mirrors tests/e2e/helpers/multi-task-cli.ts:scientistResponse, retagged
// to phase `audit`.
const SCIENTIST_AUDIT_REPLY = `<scientist-ready/>
# HYPOTHESES

## H-001: REQUIRED_SECTIONS omits Tasks

- Phase: audit
- Status: open
- Falsifier: a PLAN.md with no ## Tasks section is rejected by validatePlanMarkdown.
- Evidence: AUDIT.md ## Localization bullet 1.
- Risk if false: gate approves a malformed PLAN.md.

# OPEN QUESTIONS

## Q-001: should the fix also cover empty Tasks sections?

- Phase: audit
- Status: open
- Importance: medium
- DueBy: 2026-12-31
- Context: AUDIT scoped only an absent Tasks section.
- Resolution attempts: none yet.
`

// Lead reply for the brownfield PLAN handoff (C7). SOURCE_CHECK.md uses the
// `## Audit sources` heading (NOT `## Spec sources`) and SC-AUDIT-NNN ids.
const LEAD_BROWNFIELD_REPLY = `<plan-ready/>
# PLAN

## Goals

- Add a Tasks-section presence check to validatePlanMarkdown.

## Tasks

### T-001: Require ## Tasks in PLAN.md

- Files: src/artifacts/plan.ts
- Validation: true
- Risk: existing PLAN.md files that omit Tasks now fail validation.
- Hypotheses: H-001
- Sources: SC-AUDIT-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- AUDIT.md ## Localization and ## Constraints.

## Out of scope

- Empty-Tasks-section handling (tracked as Q-001).

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Audit sources

### SC-AUDIT-001: Tasks section absent from REQUIRED_SECTIONS

- Audit: AUDIT.md \`## Localization\`, bullet 1
- Quote: validatePlanMarkdown; Tasks section check is absent from the required-sections array.

## Reference sources

### SC-REF-NONE-001: No reference pattern required

- Searched: src/artifacts/plan.ts
- Result: 0 hits
- Why explicit: the fix extends an existing array; no new pattern to reuse.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: validatePlanMarkdown is hand-written; no API surface.

## Coverage

- T-001 -> SC-AUDIT-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

async function findRunEventsFile(stateDir: string): Promise<string | null> {
  const runsDir = join(stateDir, 'runs')
  try {
    const runIds = await readdir(runsDir)
    if (runIds.length === 0) return null
    return join(runsDir, runIds[0]!, 'events.jsonl')
  } catch {
    return null
  }
}

describe('M17 C8 — brownfield AUDIT full-cycle e2e', () => {
  let fixture: FixtureLayout | null = null

  afterEach(async () => {
    if (fixture !== null) {
      await rm(fixture.tmpRoot, { recursive: true, force: true }).catch(() => {})
      fixture = null
    }
  })

  // GREEN (C8 bugs fixed): the AUDIT runtime now (1) strips the ready signal
  // before validate/write (splitAuditResponse) and (2) runs the Scientist
  // phase-tail. This drives the whole brownfield chain end-to-end:
  //   phase_entered(audit) → agent_invoked(auditor) →
  //   agent_completed(auditor) → audit_completed(sha) → gate_required(audit),
  // with AUDIT.md + HYPOTHESES.md + OPEN_QUESTIONS.md on disk, then
  // approve audit writes GATE_AUDIT_PASSED.json, then PLAN reads AUDIT.md.
  //
  // A11 R1: this e2e's fake auditor returns the AUDIT.md DIRECTLY (no
  // tool_calls), so the bounded repo_context dispatch loop breaks on turn 1 —
  // the no-tool-call path. No `repo_context_searched` event is emitted because
  // no search ran (honest under rule 18; the synthetic empty marker that used
  // to fire here is removed). The WITH-tool-call path (loop runs grep, emits a
  // REAL repo_context_searched event, then produces AUDIT.md on the next turn)
  // is covered at the unit level in tests/audit-phase.test.ts.
  test('AUDIT → approve → PLAN reads AUDIT.md (full brownfield chain)', async () => {
    fixture = await setupBrownfieldProject()
    const fx = fixture

    // --- minimal precondition: a run legitimately at currentPhase audit ----
    // initRun with profile 'brownfield' emits run_started + phase_entered(audit)
    // through the orchestrator primitive; we pin the runId so the fixture's
    // AUDIT.md frontmatter can match it. The operator problem statement is
    // recorded on run_started (read back by dispatchAudit per rule 1).
    const runId = generateUlid()
    const runPaths = runPathsFor(fx.stateDir, fx.artifactRoot, runId)
    await initRun({
      paths: runPaths,
      profile: 'brownfield',
      runId,
      problemStatement: OPERATOR_STATEMENT,
    })
    await writeActiveRun(runPaths.activeFile, runId)

    const eventsFile = runPaths.eventsFile

    // --- spawn 1: AUDIT (active-run continuation) -------------------------
    const auditScript = join(fx.scriptDir, 'audit.jsonl')
    await writeFakeScript(auditScript, [
      { matcher: { phase: 'audit', agent: 'auditor' }, response: { content: auditReply(runId) } },
      { matcher: { phase: 'audit', agent: 'scientist' }, response: { content: SCIENTIST_AUDIT_REPLY } },
    ])
    const auditRun = await spawnCli(fx.projectRoot, ['run', '--provider', 'fake'], auditScript)
    expect(auditRun.exitCode).toBe(0)

    // --- assert the AUDIT event chain in events.jsonl --------------------
    const afterAudit = await readEventsFromFile(eventsFile)
    const has = (pred: (e: ParsedEvent) => boolean): boolean => afterAudit.some(pred)

    expect(has((e) => e.type === 'phase_entered' && e.phase === 'audit')).toBe(true)
    // A11 R1: no-tool-call path — the fake auditor returns AUDIT.md directly, so
    // the repo_context dispatch loop breaks on turn 1 and emits NO
    // repo_context_searched event (the synthetic empty marker is removed).
    expect(has((e) => e.type === 'repo_context_searched' && e.phase === 'audit')).toBe(false)
    expect(has((e) => e.type === 'agent_invoked' && e.agent === 'auditor')).toBe(true)
    expect(has((e) => e.type === 'agent_completed' && e.agent === 'auditor')).toBe(true)
    // NOTE: the engine has no `artifact_recorded` event (the M17 kickoff doc
    // anticipated one, but EVENT_TYPES never added it). The canonical
    // "AUDIT.md was written" signal is `audit_completed`, which carries the
    // artifact sha256 (asserted just below) — mirroring how DEFINE/BUILD record
    // their artifacts. The AUDIT.md on-disk existence is also asserted below.

    const auditCompleted = afterAudit.find((e) => e.type === 'audit_completed')
    expect(auditCompleted).toBeDefined()
    expect(typeof auditCompleted!.auditReportSha256).toBe('string')
    expect((auditCompleted!.auditReportSha256 ?? '').length).toBeGreaterThan(0)

    expect(has((e) => e.type === 'gate_required' && e.phase === 'audit')).toBe(true)

    // Ordering sanity: audit_completed precedes gate_required(audit) (sha is
    // bound before the gate is requested), mirroring build.ts.
    const idxCompleted = afterAudit.findIndex((e) => e.type === 'audit_completed')
    const idxGate = afterAudit.findIndex((e) => e.type === 'gate_required' && e.phase === 'audit')
    expect(idxCompleted).toBeGreaterThanOrEqual(0)
    expect(idxGate).toBeGreaterThan(idxCompleted)

    // AUDIT.md + sidecars exist on disk.
    const auditPath = join(fx.artifactRoot, 'AUDIT.md')
    expect((await stat(auditPath)).isFile()).toBe(true)
    expect(existsSync(join(fx.artifactRoot, 'HYPOTHESES.md'))).toBe(true)
    expect(existsSync(join(fx.artifactRoot, 'OPEN_QUESTIONS.md'))).toBe(true)

    // No greenfield artifact and no BA invocation leaked into the brownfield run.
    expect(existsSync(join(fx.artifactRoot, 'SPEC.md'))).toBe(false)
    expect(has((e) => e.type === 'agent_invoked' && e.agent === 'ba')).toBe(false)

    // --- spawn 2: approve audit ------------------------------------------
    const approve = await spawnCli(fx.projectRoot, ['approve', 'audit'])
    expect(approve.exitCode).toBe(0)

    // The generic phase-approval gate file is written, and the sha-binding
    // (preApproveAuditHook) passed (the approve exited 0 above).
    const gatePassed = join(runPaths.runDir, 'GATE_AUDIT_PASSED.json')
    expect(existsSync(gatePassed)).toBe(true)

    // --- spawn 3: PLAN (continue the run) --------------------------------
    const planScript = join(fx.scriptDir, 'plan.jsonl')
    await writeFakeScript(planScript, [
      { matcher: { phase: 'plan', agent: 'lead' }, response: { content: LEAD_BROWNFIELD_REPLY } },
      { matcher: { phase: 'plan', agent: 'scientist' }, response: { content: SCIENTIST_AUDIT_REPLY } },
    ])
    const planRun = await spawnCli(fx.projectRoot, ['run', '--provider', 'fake'], planScript)

    const afterPlan = await readEventsFromFile(eventsFile)

    // The Lead must be invoked, and its manifest must carry AUDIT.md (NOT
    // SPEC.md): this is the C7 brownfield handoff — PLAN reads AUDIT.md.
    const leadInvoked = afterPlan.find((e) => e.type === 'agent_invoked' && e.agent === 'lead')
    expect(leadInvoked).toBeDefined()
    // The attached files live under `manifest.files[].path` (see ParsedEvent).
    const leadFiles = (leadInvoked!.manifest?.files ?? []).map((f) => String(f.path ?? ''))
    expect(leadFiles.some((f) => /AUDIT\.md/.test(f))).toBe(true)
    expect(leadFiles.some((f) => /SPEC\.md/.test(f))).toBe(false)

    // The brownfield PLAN completes and produces PLAN.md + SOURCE_CHECK.md
    // (SOURCE_CHECK uses ## Audit sources + SC-AUDIT ids). This proves the
    // full "AUDIT.md → approve → PLAN reads AUDIT.md" chain end-to-end.
    expect(planRun.exitCode).toBe(0)
    const planPath = join(fx.artifactRoot, 'PLAN.md')
    const sourceCheckPath = join(fx.artifactRoot, 'SOURCE_CHECK.md')
    expect(existsSync(planPath)).toBe(true)
    expect(existsSync(sourceCheckPath)).toBe(true)
    const scText = await readFile(sourceCheckPath, 'utf8')
    expect(scText).toContain('## Audit sources')
    expect(scText).toContain('SC-AUDIT-001')
    expect(scText).not.toContain('## Spec sources')
  }, 120_000)

  // --- BUG A regression (validator isolation) ---------------------------
  // Retained from the C8 RED anchors: proves the un-stripped ready signal was
  // the SOLE defect behind BUG A. The protocol-faithful reply (signal on its
  // own line, THEN the document) is rejected by the validator with
  // `audit_missing_frontmatter`; the SAME document WITHOUT the leading signal
  // validates cleanly. `splitAuditResponse` (the fix) is what removes the
  // signal in the runtime, and the full-cycle test above proves the chain is
  // green end-to-end. This unit-level isolation guards against a regression
  // that re-introduces the raw-text feed.
  test('the un-stripped ready signal is the sole BUG A defect (validator isolation)', async () => {
    const runId = generateUlid()

    const faithful = auditReply(runId)
    const rejected = validateAuditMarkdown(faithful, { expectedRunId: runId })
    expect(rejected.ok).toBe(false)
    expect(rejected.issues.some((i) => i.code === 'audit_missing_frontmatter')).toBe(true)

    const signalLine = `${AUDIT_READY_SIGNAL}\n`
    expect(faithful.startsWith(signalLine)).toBe(true)
    const stripped = faithful.slice(signalLine.length)
    const accepted = validateAuditMarkdown(stripped, { expectedRunId: runId })
    expect(accepted.ok).toBe(true)

    // splitAuditResponse strips exactly the signal: its output validates and
    // matches the manually-stripped document.
    const split = splitAuditResponse(faithful)
    expect(split).not.toBeNull()
    expect(validateAuditMarkdown(split!, { expectedRunId: runId }).ok).toBe(true)
    expect(split).toBe(stripped.trim())

    // A reply with no signal is a protocol violation: splitAuditResponse
    // returns null so the runtime routes it to `audit_validation_failed`
    // rather than silently parsing the raw text.
    expect(splitAuditResponse(stripped)).toBeNull()
  })

  // --- greenfield regression (explicit) ---------------------------------
  // The greenfield path must be UNTOUCHED by M17: a greenfield `code-oz run`
  // routes DEFINE → ba persona → SPEC.md (NOT audit, NOT auditor), and never
  // produces AUDIT.md. Driven through the same spawned-CLI seam.
  test('greenfield run still routes DEFINE → ba → SPEC.md (no audit, no auditor)', async () => {
    fixture = await setupBrownfieldProject()
    const fx = fixture

    // Flip the fixture back to greenfield (the brownfield detector would
    // otherwise route a populated repo to AUDIT).
    const configPath = join(fx.projectRoot, '.code-oz', 'config.yaml')
    const cfg = parseYaml(await readFile(configPath, 'utf8')) as Record<string, unknown>
    cfg.profile = 'greenfield'
    await writeFile(configPath, stringifyYaml(cfg), 'utf8')

    const baReply = `<spec-ready/>
# SPEC

## Goals

- Add an identity helper to the fixture.

## Users

- Repository contributors.

## Constraints

- No new dependencies.

## Acceptance criteria

- add() returns the sum of its two arguments.

## Open questions

- None known at define time.

## Explicit non-goals

- Not adding tests in this milestone.
`
    const defineScript = join(fx.scriptDir, 'define.jsonl')
    await writeFakeScript(defineScript, [
      { matcher: { phase: 'define', agent: 'ba' }, response: { content: baReply } },
    ])
    const run = await spawnCli(
      fx.projectRoot,
      ['run', '--provider', 'fake', '--request', 'tidy up the add helper'],
      defineScript,
    )
    expect(run.exitCode).toBe(0)

    const eventsFile = await findRunEventsFile(fx.stateDir)
    expect(eventsFile).not.toBeNull()
    const events = await readEventsFromFile(eventsFile!)

    // DEFINE, not AUDIT; ba, not auditor.
    expect(events.some((e) => e.type === 'phase_entered' && e.phase === 'define')).toBe(true)
    expect(events.some((e) => e.type === 'phase_entered' && e.phase === 'audit')).toBe(false)
    expect(events.some((e) => e.type === 'agent_invoked' && e.agent === 'ba')).toBe(true)
    expect(events.some((e) => e.type === 'agent_invoked' && e.agent === 'auditor')).toBe(false)

    // SPEC.md produced; no AUDIT.md.
    expect(existsSync(join(fx.artifactRoot, 'SPEC.md'))).toBe(true)
    expect(existsSync(join(fx.artifactRoot, 'AUDIT.md'))).toBe(false)
  }, 120_000)
})
