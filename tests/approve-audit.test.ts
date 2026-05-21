// preApproveAuditHook integration tests (M17 C6).
//
// Covers the AUDIT-phase pre-approval validation chain in
// `src/commands/approve.ts`. Each test drives the hook with real fs fixtures
// + real `appendEvent` writes — no mocks of the validator or the event reader.
// The harness mirrors `approve-build-hook.test.ts` (the closest precedent):
// mkdtemp tmp dir, runPathsFor, mkdir runDir/artifactRoot, then assert the
// hook passes / rejects.
//
// The brownfield e2e (tests/e2e/audit-brownfield-cli.test.ts) stays RED on the
// auditor persona anchor and cannot reach the approve step, so C6's RED tests
// are fixture-based: a hand-built valid AUDIT.md + matching Scientist sidecars
// + an `audit_completed` event whose sha matches (or deliberately diverges).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { preApproveAuditHook } from '../src/commands/approve.ts'
import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { appendEvent } from '../src/state/events.ts'
import type { PhaseEvent } from '../src/state/schemas.ts'

const RUN = '01J3Z89H5R8K3CZ8B0K4MZTGNH'
const TS = '2026-05-21T10:00:00.000Z'
const ARTIFACT = 'AUDIT.md'

// A structurally valid AUDIT.md (mirrors the parser-test FIXTURE_REGRESSION).
// `runId` does not need to match RUN — preApproveAuditHook does not pass
// expectedRunId (the gate's gate_required preflight already binds the run).
const VALID_AUDIT = `---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-c6-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T09:00:00Z
operatorStatement: gate approval silently succeeds on a PLAN.md that is missing the Tasks section
---

# AUDIT

## Localization

- src/artifacts/plan.ts:214-230 — validatePlanMarkdown; Tasks section check is absent from the required-sections array.
- src/commands/approve.ts:494-498 — preApprovePlanHook calls validatePlanMarkdown but does not assert Tasks presence separately.

## Reproduction

- Proposed: approving a PLAN.md with no ## Tasks section exits 0 and writes GATE_PLAN_PASSED.json.
- Observed: src/artifacts/plan.ts:214-230 — REQUIRED_SECTIONS array omits 'Tasks'. Confirmed by grep.

## Constraints

- Preserve: all existing plan validation tests must remain green.
- Require: the fix adds 'Tasks' to REQUIRED_SECTIONS in src/artifacts/plan.ts.

## Audit sources

- src/artifacts/plan.ts:214-230 — read REQUIRED_SECTIONS array.
- src/commands/approve.ts:494-498 — read preApprovePlanHook call chain.
`

const VALID_HYP = `# HYPOTHESES

## H-001: localized fix is sufficient

- Phase: audit
- Status: open
- Falsifier: a Tasks-absent PLAN.md still approves after the fix.
- Evidence: AUDIT.md Localization.
- Risk if false: silent gate bypass persists.
`

const VALID_OQ = `# OPEN QUESTIONS

## Q-001: are there other absent-section gaps?

- Phase: audit
- Status: open
- Importance: medium
- DueBy: 2026-12-31
- Context: H-001 falsifier.
- Resolution attempts: none yet.
`

let cwd: string
let paths: RunPaths
let artifactRoot: string
let auditPath: string

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function writeAudit(text: string): Promise<{ readonly text: string; readonly sha: string }> {
  await writeFile(auditPath, text, 'utf8')
  return { text, sha: sha256(text) }
}

async function writeSidecars(opts: { hyp?: string; oq?: string } = {}): Promise<void> {
  await writeFile(join(artifactRoot, 'HYPOTHESES.md'), opts.hyp ?? VALID_HYP, 'utf8')
  await writeFile(join(artifactRoot, 'OPEN_QUESTIONS.md'), opts.oq ?? VALID_OQ, 'utf8')
}

async function emitAuditCompleted(auditReportSha256: string): Promise<void> {
  const event: PhaseEvent = {
    version: 1,
    type: 'audit_completed',
    ts: TS,
    runId: RUN,
    phase: 'audit',
    auditReportSha256,
  }
  await appendEvent({ file: paths.eventsFile, lockDir: paths.lockDir }, event)
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'code-oz-approve-audit-'))
  const stateDir = join(cwd, '.code-oz', 'state')
  artifactRoot = join(cwd, '.code-oz', 'artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  auditPath = join(artifactRoot, ARTIFACT)
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('preApproveAuditHook — happy path', () => {
  test('valid AUDIT.md + valid sidecars + matching audit_completed sha resolves', async () => {
    const { sha } = await writeAudit(VALID_AUDIT)
    await writeSidecars()
    await emitAuditCompleted(sha)

    await preApproveAuditHook({
      runId: RUN,
      runPaths: paths,
      artifactRoot,
      auditReportPath: auditPath,
      today: '2026-05-21',
    })
  })
})

describe('preApproveAuditHook — error paths', () => {
  test('missing AUDIT.md → refuses', async () => {
    await expect(
      preApproveAuditHook({
        runId: RUN,
        runPaths: paths,
        artifactRoot,
        auditReportPath: auditPath,
        today: '2026-05-21',
      }),
    ).rejects.toThrow(/does not exist/)
  })

  test('invalid AUDIT.md (fails validateAuditMarkdown) → refuses with parse summary', async () => {
    // Drop the frontmatter so validateAuditMarkdown rejects.
    await writeFile(auditPath, '# AUDIT\n\n## Localization\n\n- x.\n', 'utf8')
    await writeSidecars()
    await emitAuditCompleted(sha256('# AUDIT\n\n## Localization\n\n- x.\n'))

    await expect(
      preApproveAuditHook({
        runId: RUN,
        runPaths: paths,
        artifactRoot,
        auditReportPath: auditPath,
        today: '2026-05-21',
      }),
    ).rejects.toThrow(/is not a valid AUDIT\.md/)
  })

  test('no audit_completed event → refuses', async () => {
    await writeAudit(VALID_AUDIT)
    await writeSidecars()
    // events.jsonl absent — readEvents returns an empty list.

    await expect(
      preApproveAuditHook({
        runId: RUN,
        runPaths: paths,
        artifactRoot,
        auditReportPath: auditPath,
        today: '2026-05-21',
      }),
    ).rejects.toThrow(/no audit_completed event/)
  })

  test('AUDIT.md sha mismatch (edited after audit_completed) → refuses', async () => {
    await writeAudit(VALID_AUDIT)
    await writeSidecars()
    // Event records a sha that does NOT match the on-disk AUDIT.md bytes.
    await emitAuditCompleted('a'.repeat(64))

    await expect(
      preApproveAuditHook({
        runId: RUN,
        runPaths: paths,
        artifactRoot,
        auditReportPath: auditPath,
        today: '2026-05-21',
      }),
    ).rejects.toThrow(/sha256 .* does not match the audit_completed event sha/)
  })

  test('missing Scientist sidecars → refuses (rule 15)', async () => {
    const { sha } = await writeAudit(VALID_AUDIT)
    // No sidecars written.
    await emitAuditCompleted(sha)

    await expect(
      preApproveAuditHook({
        runId: RUN,
        runPaths: paths,
        artifactRoot,
        auditReportPath: auditPath,
        today: '2026-05-21',
      }),
    ).rejects.toThrow(/HYPOTHESES\.md is required|OPEN_QUESTIONS\.md is required/)
  })

  test('overdue Scientist open question → refuses (rule 15)', async () => {
    const { sha } = await writeAudit(VALID_AUDIT)
    const overdueOq = VALID_OQ.replace('- DueBy: 2026-12-31', '- DueBy: 2026-04-29')
    await writeSidecars({ oq: overdueOq })
    await emitAuditCompleted(sha)

    await expect(
      preApproveAuditHook({
        runId: RUN,
        runPaths: paths,
        artifactRoot,
        auditReportPath: auditPath,
        today: '2026-05-21',
      }),
    ).rejects.toThrow(/past their DueBy|open question/i)
  })
})
