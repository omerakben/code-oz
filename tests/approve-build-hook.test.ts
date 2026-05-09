// preApproveBuildHook integration tests (M16 C5).
//
// Covers the BUILD-phase pre-approval validation chain in
// `src/commands/approve.ts`. Each test drives the hook with real
// fs fixtures + real `appendEvent` writes — no mocks of the parser
// or event reader. The harness mirrors `commands-approve.test.ts`'s
// preApproveVerifyHook block (canonical precedent) and the broader
// approve-command setup (mkdtemp tmp dir, runPathsFor, mkdir runDir).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { preApproveBuildHook } from '../src/commands/approve.ts'
import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { appendEvent } from '../src/state/events.ts'
import {
  serializeBuildReport,
  type BuildReportData,
} from '../src/artifacts/build-report.ts'
import { buildPromptSnapshotPath } from '../src/worktree/paths.ts'
import type { PhaseEvent } from '../src/state/schemas.ts'

const RUN = '01J3Z89H5R8K3CZ8B0K4MZTGNH'
const TS = '2026-04-30T10:00:00.000Z'
const TASK = 'T-001'
const PLAN_SHA = 'a'.repeat(64)
const BASE_SHA = '7'.repeat(40)
const PATCH_SHA = 'b'.repeat(64)
const FILE_SHA_A = '1'.repeat(64)
const FILE_SHA_B = '2'.repeat(64)
const ARTIFACT = 'BUILD_REPORT.md'

let cwd: string
let paths: RunPaths
let buildReportPath: string

function buildReportData(attempt: number): BuildReportData {
  // Per BUILD_REPORT.md grammar, attempt > 1 requires a populated
  // failureCarryForward block (the parser refuses `None` when attempt > 1).
  const failureCarryForward =
    attempt === 1
      ? null
      : {
          source: 'verify-fail' as const,
          priorAttempt: attempt - 1,
          priorForensicsPath: `.code-oz/runs/${RUN}/forensics/${attempt - 1}/`,
          priorValidationCommand: 'bun test tests/scoring-syllable.test.ts',
          priorVerdict: 'fail (exit code 1, duration 100 ms)',
          priorFailureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
          constraint: 'prefer last-syllable stress for two-syllable surnames.',
        }
  return Object.freeze({
    task: {
      taskId: TASK,
      title: 'Implement syllable scorer',
      planSha: PLAN_SHA,
      attempt,
    },
    base: {
      worktreePath: '.code-oz/runs/abc/worktree/',
      baseCommitSha: BASE_SHA,
      dirtyAtBase: false,
    },
    patch: {
      patchPath: `.code-oz/runs/abc/patches/${TASK}-attempt-${attempt}.patch`,
      patchSha256: PATCH_SHA,
      patchBytes: 4128,
    },
    changedFiles: [
      { path: 'src/scoring/syllable.ts', sha256: FILE_SHA_A, change: 'added' as const },
      { path: 'tests/scoring-syllable.test.ts', sha256: FILE_SHA_B, change: 'added' as const },
    ],
    validationCommand: {
      command: 'bun test tests/scoring-syllable.test.ts',
      workingDirectory: '.code-oz/runs/abc/worktree/',
      timeoutMs: 60000,
      expectedExitCode: 0,
    },
    failureCarryForward,
    notes: ['Prefer last-syllable stress for two-syllable surnames.'],
  })
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function writeReport(attempt: number): Promise<{ readonly text: string; readonly sha: string }> {
  const text = serializeBuildReport(buildReportData(attempt))
  await writeFile(buildReportPath, text, 'utf8')
  return { text, sha: sha256(text) }
}

async function writePromptSnapshot(attempt: number, body: string): Promise<string> {
  const promptPath = buildPromptSnapshotPath(cwd, RUN, attempt)
  // The snapshot lives at `.code-oz/runs/<runId>/build-attempt-<N>.prompt.txt`,
  // a directory parallel to `.code-oz/state/runs/<runId>/`. Ensure parent.
  await mkdir(join(cwd, '.code-oz', 'runs', RUN), { recursive: true })
  await writeFile(promptPath, body, 'utf8')
  return promptPath
}

async function emitBuildCompleted(opts: {
  readonly attempt: number
  readonly buildReportSha256: string
  readonly promptSnapshotSha256: string
}): Promise<void> {
  const event: PhaseEvent = {
    version: 1,
    type: 'build_completed',
    ts: TS,
    runId: RUN,
    phase: 'build',
    agent: 'builder',
    attempt: opts.attempt,
    taskId: TASK,
    changedFileCount: 2,
    buildReportSha256: opts.buildReportSha256,
    promptSnapshotSha256: opts.promptSnapshotSha256,
  }
  await appendEvent({ file: paths.eventsFile, lockDir: paths.lockDir }, event)
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'code-oz-approve-build-'))
  const stateDir = join(cwd, '.code-oz', 'state')
  const artifactRoot = join(cwd, '.code-oz', 'artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  buildReportPath = join(artifactRoot, ARTIFACT)
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('preApproveBuildHook — happy path', () => {
  test('valid report + prompt + matching event resolves without throwing', async () => {
    const { sha: reportSha } = await writeReport(1)
    const promptBody = 'composed BUILD prompt for attempt 1\n'
    await writePromptSnapshot(1, promptBody)
    const promptSha = sha256(promptBody)
    await emitBuildCompleted({
      attempt: 1,
      buildReportSha256: reportSha,
      promptSnapshotSha256: promptSha,
    })

    await preApproveBuildHook({
      cwd,
      runId: RUN,
      runPaths: paths,
      buildReportPath,
    })
  })
})

describe('preApproveBuildHook — error paths', () => {
  test('missing BUILD_REPORT.md → refuses', async () => {
    await expect(
      preApproveBuildHook({
        cwd,
        runId: RUN,
        runPaths: paths,
        buildReportPath,
      }),
    ).rejects.toThrow(/does not exist/)
  })

  test('unparsable BUILD_REPORT.md → refuses with parse summary', async () => {
    await writeFile(buildReportPath, 'not a valid build report\n', 'utf8')

    await expect(
      preApproveBuildHook({
        cwd,
        runId: RUN,
        runPaths: paths,
        buildReportPath,
      }),
    ).rejects.toThrow(/is not a valid BUILD_REPORT\.md/)
  })

  test('no build_completed event → refuses', async () => {
    await writeReport(1)
    // events.jsonl absent — readEvents returns an empty list.

    await expect(
      preApproveBuildHook({
        cwd,
        runId: RUN,
        runPaths: paths,
        buildReportPath,
      }),
    ).rejects.toThrow(/no build_completed event for taskId=T-001/)
  })

  test('stale attempt (report=1, latest event=2) → refuses', async () => {
    // Report on disk is for attempt 1; emit a build_completed for
    // attempt 2 last so it is the latest for the (runId, taskId).
    const { sha: report1Sha } = await writeReport(1)
    const promptBody = 'attempt 1 prompt\n'
    await writePromptSnapshot(1, promptBody)
    await emitBuildCompleted({
      attempt: 1,
      buildReportSha256: report1Sha,
      promptSnapshotSha256: sha256(promptBody),
    })
    // Second build_completed for attempt 2; values are unrelated to the
    // attempt-1 report on disk — the hook should refuse on the attempt
    // mismatch before it reaches sha cross-checks.
    await emitBuildCompleted({
      attempt: 2,
      buildReportSha256: 'd'.repeat(64),
      promptSnapshotSha256: 'e'.repeat(64),
    })

    await expect(
      preApproveBuildHook({
        cwd,
        runId: RUN,
        runPaths: paths,
        buildReportPath,
      }),
    ).rejects.toThrow(
      /task\.attempt is 1, but the latest build_completed event for taskId=T-001 is attempt=2/,
    )
  })

  test('BUILD_REPORT.md sha mismatch → refuses', async () => {
    await writeReport(1)
    const promptBody = 'attempt 1 prompt\n'
    await writePromptSnapshot(1, promptBody)
    // Event records a sha that does NOT match the on-disk report bytes.
    await emitBuildCompleted({
      attempt: 1,
      buildReportSha256: 'a'.repeat(64),
      promptSnapshotSha256: sha256(promptBody),
    })

    await expect(
      preApproveBuildHook({
        cwd,
        runId: RUN,
        runPaths: paths,
        buildReportPath,
      }),
    ).rejects.toThrow(/sha256 .* does not match the build_completed event sha/)
  })

  test('prompt snapshot missing → refuses', async () => {
    const { sha: reportSha } = await writeReport(1)
    // Skip writePromptSnapshot — file does not exist on disk.
    await emitBuildCompleted({
      attempt: 1,
      buildReportSha256: reportSha,
      // The recorded prompt sha is irrelevant to this branch (missing-file
      // throws before sha compare runs); use a syntactically valid 64-hex.
      promptSnapshotSha256: 'f'.repeat(64),
    })

    await expect(
      preApproveBuildHook({
        cwd,
        runId: RUN,
        runPaths: paths,
        buildReportPath,
      }),
    ).rejects.toThrow(/BUILD prompt snapshot .* does not exist/)
  })

  test('prompt snapshot sha mismatch → refuses', async () => {
    const { sha: reportSha } = await writeReport(1)
    const promptBody = 'attempt 1 prompt\n'
    await writePromptSnapshot(1, promptBody)
    // Event records a prompt sha that does not match the on-disk prompt.
    await emitBuildCompleted({
      attempt: 1,
      buildReportSha256: reportSha,
      promptSnapshotSha256: 'c'.repeat(64),
    })

    await expect(
      preApproveBuildHook({
        cwd,
        runId: RUN,
        runPaths: paths,
        buildReportPath,
      }),
    ).rejects.toThrow(
      /BUILD prompt snapshot sha256 .* does not match the build_completed event sha/,
    )
  })
})

describe('preApproveBuildHook — multi-attempt latest-wins', () => {
  test('hook validates against the LATEST build_completed event, not the first', async () => {
    // events.jsonl contains build_completed for attempt 1 AND attempt 2,
    // both for the same taskId. BUILD_REPORT.md + prompt snapshot are
    // both for attempt 2 with matching shas. The hook must compare
    // against the latest event (attempt 2) and resolve cleanly.
    //
    // Emit attempt 1 first with bogus shas (it must be ignored), then
    // attempt 2 with the canonical shas matching the on-disk fixtures.
    await emitBuildCompleted({
      attempt: 1,
      buildReportSha256: 'a'.repeat(64),
      promptSnapshotSha256: 'a'.repeat(64),
    })

    const { sha: report2Sha } = await writeReport(2)
    const promptBody = 'attempt 2 prompt\n'
    await writePromptSnapshot(2, promptBody)
    const prompt2Sha = sha256(promptBody)
    await emitBuildCompleted({
      attempt: 2,
      buildReportSha256: report2Sha,
      promptSnapshotSha256: prompt2Sha,
    })

    await preApproveBuildHook({
      cwd,
      runId: RUN,
      runPaths: paths,
      buildReportPath,
    })
  })
})
