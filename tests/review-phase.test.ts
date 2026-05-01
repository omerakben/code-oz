// runReview orchestration tests (M9 commit 7).
//
// Mirrors tests/verify-phase.test.ts structure: entry-validation tests +
// happy-path tests for ready / needs-revision / block exits + cross-family
// invocation-time check + Scientist tail + per-round atomic resume.
//
// FakeProvider stubs the Scientist persona (provider=fake). The reviewer
// persona is invoked through the dependency-injected `invokePersona` shim
// — same pattern as runVerify.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runReview, REVIEW_READY_SIGNAL } from '../src/phases/review.ts'
import {
  reviewDraftPath,
  reviewDraftsDir,
} from '../src/phases/review-resume.ts'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { appendEvent, readEvents } from '../src/state/events.ts'
import { atomicWriteFile } from '../src/artifacts/atomic-write.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

const REVIEWER_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/reviewer.md',
  name: 'reviewer',
  type: 'agent',
  phase: 'review',
  provider: 'codex',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['.code-oz/artifacts/REVIEW.md']),
    bash: 'deny' as const,
    tool_use: Object.freeze({
      repo_context: Object.freeze({
        tools: Object.freeze(['glob', 'grep', 'read'] as const),
        roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
        maxResults: 50,
        maxBytesPerResult: 16384,
        maxFilesForNextManifest: 0,
        timeoutMs: 5000,
        network: 'none' as const,
      }),
      review_request: Object.freeze({
        tools: Object.freeze(['request-review'] as const),
        providers: Object.freeze(['codex' as const, 'gemini' as const]),
        maxRounds: 4,
        timeoutMsPerRound: 120_000,
        network: 'provider-only' as const,
      }),
    }),
  }),
  description: 'reviewer stub for orchestration smoke tests.',
  body: '# Reviewer\n\nTest reviewer persona body.\n',
})

// Reviewer agent variant with provider=claude (same family as BUILD =
// 'claude' default in our tests). Used to drive the cross-family violation
// path at invocation time.
const REVIEWER_AGENT_CLAUDE: AgentDefinition = Object.freeze({
  ...REVIEWER_AGENT,
  provider: 'claude',
})

const SCIENTIST_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/scientist.md',
  name: 'scientist',
  type: 'agent',
  phase: 'review',
  provider: 'fake',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['HYPOTHESES.md', 'OPEN_QUESTIONS.md']),
    bash: 'deny' as const,
  }),
  description: 'scientist stub.',
  body: '## Scientist\n\nstub body.',
})

const SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: REVIEW captured cross-family signal correctly

- Phase: review
- Status: open
- Falsifier: Re-run REVIEW with a same-family reviewer; the cross-family check fails.
- Evidence: REVIEW.md Reviewer section.
- Risk if false: Cross-family invariant becomes silently bypassable.

# OPEN QUESTIONS

## Q-001: Should reviewer-side caching apply across rounds?

- Phase: review
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: Out of M9 scope.
- Resolution attempts: none yet.
`

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

const NOW = '2026-04-30T19:00:00.000Z'

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-review-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => NOW })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot: tmp,
    config: DEFAULT_CONFIG,
    now: () => NOW,
  }
}

function buildOpts(
  overrides: Partial<Parameters<typeof runReview>[0]> = {},
): Parameters<typeof runReview>[0] {
  return {
    runPaths: paths,
    runId: RUN,
    cwd: tmp,
    reviewerAgent: REVIEWER_AGENT,
    scientistAgent: SCIENTIST_AGENT,
    taskId: 'T-001',
    invokeCtx: invokeCtx(),
    invokePersona: async () => makeReadyPersonaResponse({ score: 8 }),
    now: () => NOW,
    round: 1,
    ...overrides,
  }
}

// --- helpers --------------------------------------------------------

const PLAN_SHA = 'a'.repeat(64)
const BASE_COMMIT_SHA = 'b'.repeat(40)
const PATCH_SHA = 'c'.repeat(64)
const FILE_SHA = 'd'.repeat(64)

function makeBuildReport(opts: {
  readonly taskId?: string
  readonly attempt?: number
  readonly changedFile?: string
} = {}): string {
  const taskId = opts.taskId ?? 'T-001'
  const attempt = opts.attempt ?? 1
  const changed = opts.changedFile ?? 'src/foo.ts'
  const cf =
    attempt === 1
      ? `- None (attempt 1).`
      : [
          '- Source: verify-fail',
          `- Prior attempt: ${attempt - 1}`,
          '- Prior forensics: .code-oz/runs/01HX/forensics/1/',
          '- Prior validation command: bun test foo.test.ts',
          '- Prior verdict: fail (exit code 1, duration 100 ms)',
          '- Prior failure summary: x',
          '- Constraint: y',
        ].join('\n')
  return `# BUILD_REPORT

## Task

- Task: ${taskId}
- Title: stub title
- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: ${PLAN_SHA})
- Attempt: ${attempt}

## Base

- Worktree: .code-oz/runs/<runId>/worktree/
- Base commit: ${BASE_COMMIT_SHA}
- Dirty tree at base: false

## Patch

- Patch path: .code-oz/runs/<runId>/patches/attempt-${attempt}.patch
- Patch sha256: ${PATCH_SHA}
- Patch byte count: 100

## Changed files

- ${changed} | sha256: ${FILE_SHA} | change: modified

## Validation command

- Command: bun test tests/foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Failure carry-forward

${cf}

## Notes

- stub note.
`
}

function makeVerifyReport(opts: {
  readonly taskId?: string
  readonly attempt?: number
  readonly verdict?: 'pass' | 'fail'
} = {}): string {
  const taskId = opts.taskId ?? 'T-001'
  const attempt = opts.attempt ?? 1
  const verdict = opts.verdict ?? 'pass'
  const buildReportSha = 'e'.repeat(64)
  const fc =
    verdict === 'pass'
      ? '- None (verdict pass).'
      : [
          `- Attempt: ${attempt}`,
          `- Forensics: .code-oz/runs/${RUN}/forensics/${attempt}/`,
          '- Validation command: bun test',
          '- Verdict: fail (exit code 1, duration 100 ms)',
          '- Failure summary: tests failed',
          '- Constraint: do not regress test foo',
        ].join('\n')
  return `# VERIFY

## BUILD ref

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${buildReportSha})
- Task: ${taskId}
- Attempt: ${attempt}
- Base commit: ${BASE_COMMIT_SHA}
- Patch sha256: ${PATCH_SHA}

## Validation command

- Command: bun test tests/foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Evidence

- Exit code: ${verdict === 'pass' ? 0 : 1}
- Duration (ms): 100
- Stdout bytes: 0
- Stderr bytes: 0
- Stdout log: .code-oz/runs/${RUN}/forensics/${attempt}/stdout.log
- Stderr log: .code-oz/runs/${RUN}/forensics/${attempt}/stderr.log

## Verdict

- Verdict: ${verdict}
- Rationale: ${verdict === 'pass' ? 'tests passed' : 'tests failed'}

## Mutation

- Status: not-applicable
- Notes: only modifications

## Failure constraint

${fc}
`
}

interface PersonaPayload {
  readonly score: number
  readonly findings?: readonly {
    readonly id?: string
    readonly title: string
    readonly file: string
    readonly line: string
    readonly severity: 'block' | 'fix-first' | 'nit' | 'fyi'
    readonly recommendation: string
    readonly roundRaised?: number
    readonly roundResolved?: number | 'unresolved'
  }[]
}

function makeReadyPersonaResponse(p: PersonaPayload): string {
  const lines: string[] = [REVIEW_READY_SIGNAL, '', '## Findings', '']
  if (!p.findings || p.findings.length === 0) {
    lines.push('- None.')
  } else {
    for (const f of p.findings) {
      lines.push(`### ${f.id ?? 'F-NEW'}: ${f.title}`)
      lines.push(`- File: ${f.file}`)
      lines.push(`- Line: ${f.line}`)
      lines.push(`- Severity: ${f.severity}`)
      lines.push(`- Recommendation: ${f.recommendation}`)
      lines.push(`- Round raised: ${f.roundRaised ?? 1}`)
      lines.push(`- Round resolved: ${f.roundResolved ?? 'unresolved'}`)
      lines.push('')
    }
  }
  lines.push('', '## Score', '')
  lines.push(`- Final score: ${p.score}`)
  return lines.join('\n')
}

async function seedBuildAndVerifyArtifacts(opts: {
  readonly taskId?: string
  readonly attempt?: number
  readonly verifyVerdict?: 'pass' | 'fail'
  readonly changedFile?: string
} = {}): Promise<void> {
  await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), makeBuildReport(opts))
  await writeFile(
    join(paths.artifactRoot, 'VERIFY.md'),
    makeVerifyReport({
      taskId: opts.taskId,
      attempt: opts.attempt,
      verdict: opts.verifyVerdict,
    }),
  )
}

/**
 * M9 commit 13 bp#3: runReview validates that finding-cited line ranges
 * exist in the run worktree. Tests that include findings citing
 * `src/foo.ts:1-3` need that file to exist in the worktree with at
 * least 3 lines. This helper stages a 10-line file under the canonical
 * worktree path.
 */
async function seedWorktreeFile(relPath: string = 'src/foo.ts', lines: number = 10): Promise<void> {
  const worktreeRoot = join(tmp, '.code-oz/runs', RUN, 'worktree')
  const fileAbs = join(worktreeRoot, relPath)
  await mkdir(join(fileAbs, '..'), { recursive: true })
  const text = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  await writeFile(fileAbs, text)
}

async function seedBuildProviderEvent(opts: {
  readonly taskId?: string
  readonly attempt?: number
  readonly family?: string
} = {}): Promise<void> {
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1,
      type: 'build_provider_recorded',
      ts: NOW,
      runId: RUN,
      phase: 'build',
      attempt: opts.attempt ?? 1,
      taskId: opts.taskId ?? 'T-001',
      provider: opts.family ?? 'claude',
      family: opts.family ?? 'claude',
    },
  )
}

function expectScientistResponse(): void {
  fake
    .expect({ phase: 'review', agent: 'scientist' })
    .respondWith({ content: SCIENTIST_RESPONSE })
}

// --- entry-validation tests ----------------------------------------

describe('runReview — entry validation', () => {
  test('round out of range → review_round_out_of_range', async () => {
    const result = await runReview(buildOpts({ round: 0 }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_round_out_of_range')
    }
  })

  test('round above cap → review_round_out_of_range', async () => {
    const result = await runReview(buildOpts({ round: 5 }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_round_out_of_range')
    }
  })

  test('missing BUILD_REPORT.md → review_build_report_missing', async () => {
    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_build_report_missing')
    }
  })

  test('malformed BUILD_REPORT.md → review_build_report_invalid', async () => {
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), 'not a build report\n')
    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_build_report_invalid')
    }
  })

  test('BUILD_REPORT taskId mismatch → review_build_ref_mismatch', async () => {
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), makeBuildReport({ taskId: 'T-999' }))
    const result = await runReview(buildOpts({ taskId: 'T-001' }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_build_ref_mismatch')
    }
  })

  test('missing VERIFY.md → review_verify_report_missing', async () => {
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), makeBuildReport())
    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_verify_report_missing')
    }
  })

  test('VERIFY.md baseCommitSha mismatch (bp#2) → review_upstream_mismatch', async () => {
    // BUILD_REPORT.md uses BASE_COMMIT_SHA = 'b'.repeat(40); craft a
    // VERIFY.md whose buildRef.baseCommitSha is different.
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), makeBuildReport())
    const verifyText = makeVerifyReport().replace(BASE_COMMIT_SHA, 'f'.repeat(40))
    await writeFile(join(paths.artifactRoot, 'VERIFY.md'), verifyText)
    await seedBuildProviderEvent()

    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_upstream_mismatch')
      expect(result.rule).toContain('baseCommitSha')
    }
  })

  test('VERIFY.md patchSha256 mismatch (bp#2) → review_upstream_mismatch', async () => {
    // PATCH_SHA = 'c'.repeat(64); craft a VERIFY.md with a different
    // patch sha but matching base + task + attempt.
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), makeBuildReport())
    const verifyText = makeVerifyReport().replace(PATCH_SHA, 'f'.repeat(64))
    await writeFile(join(paths.artifactRoot, 'VERIFY.md'), verifyText)
    await seedBuildProviderEvent()

    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_upstream_mismatch')
      expect(result.rule).toContain('patchSha256')
    }
  })

  test('VERIFY.md verdict=fail → review_verify_not_passed', async () => {
    await seedBuildAndVerifyArtifacts({ verifyVerdict: 'fail' })
    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_verify_not_passed')
    }
  })

  test('no build_provider_recorded event → review_no_build_provider', async () => {
    await seedBuildAndVerifyArtifacts()
    // Intentionally no build_provider_recorded event.
    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_no_build_provider')
    }
  })

  test('cross-family invariant violated (build=codex, reviewer=codex) → review_cross_family_violation', async () => {
    await seedBuildAndVerifyArtifacts()
    // BUILD recorded as 'codex' family; reviewer is also codex → violation.
    await seedBuildProviderEvent({ family: 'codex' })
    const result = await runReview(buildOpts({ reviewerAgent: REVIEWER_AGENT }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_cross_family_violation')
    }
  })

  test('reviewer claude vs build claude → review_cross_family_violation', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent({ family: 'claude' })
    const result = await runReview(buildOpts({ reviewerAgent: REVIEWER_AGENT_CLAUDE }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_cross_family_violation')
    }
  })

  test('M9 commit 18 bp#4 follow-up: cross-family check uses registry.familyOf (registry override surfaces in REVIEW.md)', async () => {
    // Register an override that remaps codex→claude family. With
    // registry-backed familyOf, the reviewer (provider=codex) is now in
    // family=claude — same as the BUILD agent. The cross-family check
    // must fire even though the static familyOf would have said codex.
    // This locks the bp#4 phase-level wiring: regressing
    // opts.invokeCtx.registry.familyOf back to the static familyOf
    // would let this test pass when it should fail.
    fake = new FakeProvider()
    registry = new ProviderRegistry({
      providers: [fake],
      familyOverrides: { codex: 'claude' },
    })
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent({ family: 'claude' })

    const result = await runReview(buildOpts({ reviewerAgent: REVIEWER_AGENT }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_cross_family_violation')
      // The intervention message should name "claude" twice — once for
      // BUILD and once for the registry-resolved reviewer family.
      expect(result.rule).toContain('claude')
    }
  })
})

// --- happy paths ---------------------------------------------------

describe('runReview — round 1 ready', () => {
  test('persona returns ready response → resolved + REVIEW.md + review_resolved + Scientist tail + gate_required', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent() // family=claude (default), reviewer=codex
    expectScientistResponse()

    const result = await runReview(buildOpts())
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.verdict).toBe('ready')
    expect(result.score).toBe(8)
    expect(result.round).toBe(1)
    expect(result.findings).toEqual([])

    // REVIEW.md exists and has the canonical fields.
    const reviewText = await readFile(result.reviewReportPath, 'utf8')
    expect(reviewText).toContain('# REVIEW')
    expect(reviewText).toContain('## Upstream refs')
    expect(reviewText).toContain('## Reviewer')
    expect(reviewText).toContain('- Provider family: codex')
    expect(reviewText).toContain('- Cross-family check: passed')
    expect(reviewText).toContain('## Round timeline')
    expect(reviewText).toContain('| score: 8 | verdict: ready')
    expect(reviewText).toContain('- Final verdict: ready')
    expect(reviewText).toContain('- Cap exhausted: false')

    // events
    const events = (await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })).filter(
      isKnownPhaseEvent,
    )
    expect(events.some((e) => e.type === 'review_started')).toBe(true)
    expect(events.some((e) => e.type === 'review_round_completed')).toBe(true)
    expect(events.some((e) => e.type === 'review_resolved')).toBe(true)

    // cross-family pair recorded on review_started
    const started = events.find((e) => e.type === 'review_started')
    expect(started).toBeDefined()
    if (started && started.type === 'review_started') {
      expect(started.buildFamily).toBe('claude')
      expect(started.reviewerFamily).toBe('codex')
    }

    // Scientist tail ran: HYPOTHESES.md + OPEN_QUESTIONS.md exist (access throws on missing).
    await access(join(paths.artifactRoot, 'HYPOTHESES.md'))
    await access(join(paths.artifactRoot, 'OPEN_QUESTIONS.md'))

    // gate_required event for review present
    expect(
      events.some(
        (e) => e.type === 'gate_required' && e.phase === 'review',
      ),
    ).toBe(true)
  })

  test('drafts directory cleaned up after canonical write', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    const result = await runReview(buildOpts())
    expect(result.status).toBe('resolved')

    const draftPath1 = reviewDraftPath(paths.runDir, 1, 1)
    let draftStillExists = true
    try {
      await access(draftPath1)
    } catch {
      draftStillExists = false
    }
    expect(draftStillExists).toBe(false)
  })
})

describe('runReview — round 1 needs-revision', () => {
  test('score < 6 → needs_revision; no review_resolved; no review_blocked', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    // Scientist tail does NOT run on needs-revision (only resolve + block).
    // Don't register a Scientist response; the test will fail loudly if the
    // orchestrator invokes it.

    const result = await runReview(
      buildOpts({
        invokePersona: async () => makeReadyPersonaResponse({ score: 4 }),
      }),
    )
    expect(result.status).toBe('needs_revision')
    if (result.status !== 'needs_revision') return
    expect(result.verdict).toBe('needs-revision')
    expect(result.score).toBe(4)

    const events = (await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })).filter(
      isKnownPhaseEvent,
    )
    expect(events.some((e) => e.type === 'review_round_completed')).toBe(true)
    expect(events.some((e) => e.type === 'review_resolved')).toBe(false)
    expect(events.some((e) => e.type === 'review_blocked')).toBe(false)
  })

  test('unresolved fix-first finding → needs_revision regardless of score', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    await seedWorktreeFile('src/foo.ts', 10)

    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 9,
            findings: [
              {
                title: 'broken naming',
                file: 'src/foo.ts',
                line: '1-3',
                severity: 'fix-first',
                recommendation: 'rename foo to bar',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('needs_revision')
    if (result.status !== 'needs_revision') return
    expect(result.verdict).toBe('needs-revision')
    expect(result.findings.length).toBe(1)
    expect(result.findings[0]?.id).toBe('F-001')
    expect(result.findings[0]?.severity).toBe('fix-first')
  })
})

describe('runReview — round 1 block', () => {
  test('block-severity finding → blocked + review_blocked(reason=block) + NEEDS_INTERVENTION', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    await seedWorktreeFile('src/foo.ts', 10)
    expectScientistResponse()

    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 9,
            findings: [
              {
                title: 'security regression',
                file: 'src/foo.ts',
                line: '1',
                severity: 'block',
                recommendation: 'do not merge',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.verdict).toBe('block')
    expect(result.findings.length).toBe(1)
    expect(result.findings[0]?.severity).toBe('block')

    const events = (await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })).filter(
      isKnownPhaseEvent,
    )
    const blocked = events.find((e) => e.type === 'review_blocked')
    expect(blocked).toBeDefined()
    if (blocked && blocked.type === 'review_blocked') {
      expect(blocked.reason).toBe('block')
    }

    // NEEDS_INTERVENTION written with code=review_block_terminal
    const needsPath = join(paths.runDir, 'NEEDS_INTERVENTION.json')
    const txt = await readFile(needsPath, 'utf8')
    expect(txt).toContain('review_block_terminal')

    // intervention event also emitted
    expect(
      events.some(
        (e) => e.type === 'intervention' && e.code === 'review_block_terminal',
      ),
    ).toBe(true)
  })
})

// --- persona-response failures -------------------------------------

describe('runReview — persona response handling', () => {
  test('persona invoke throws → review_persona_invoke_failed', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()

    const result = await runReview(
      buildOpts({
        invokePersona: async () => {
          throw new Error('persona crashed')
        },
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_persona_invoke_failed')
    }
  })

  test('initial draft missing ready signal, repair fixes it → resolved', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    let callCount = 0
    const result = await runReview(
      buildOpts({
        invokePersona: async () => {
          callCount++
          if (callCount === 1) {
            return 'no ready marker here'
          }
          return makeReadyPersonaResponse({ score: 8 })
        },
      }),
    )
    expect(callCount).toBe(2)
    expect(result.status).toBe('resolved')
  })

  test('both drafts missing ready signal → review_persona_missing_ready_signal', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()

    const result = await runReview(
      buildOpts({
        invokePersona: async () => 'no ready marker',
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      // Both initial AND repair fail → terminal intervention. Code must be
      // either review_persona_missing_ready_signal or review_validation_failed
      // depending on which violation surfaced last; the parser groups missing
      // marker under the missing_ready_signal code.
      expect([
        'review_persona_missing_ready_signal',
        'review_validation_failed',
      ]).toContain(result.code)
    }
  })

  test('M9 commit 13 bp#3: finding cites a deleted-file path → review_finding_path_deleted', async () => {
    // Hand-craft a BUILD_REPORT.md with a deleted-file manifest entry.
    const taskId = 'T-001'
    const attempt = 1
    const buildText = makeBuildReport({ taskId, attempt }).replace(
      'change: modified',
      'change: deleted',
    )
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), buildText)
    await writeFile(
      join(paths.artifactRoot, 'VERIFY.md'),
      makeVerifyReport({ taskId, attempt }),
    )
    await seedBuildProviderEvent()
    // No worktree file needed for this test — the deleted-file check
    // fires before line-range existence.

    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 8,
            findings: [
              {
                title: 'orphan ref',
                file: 'src/foo.ts',
                line: '1',
                severity: 'fix-first',
                recommendation: 'orphaned reference; deleted-file findings forbidden',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_finding_path_deleted')
    }
  })

  test('M9 commit 13 bp#3: finding cites a line range past the worktree file end → review_finding_line_out_of_range', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    // Worktree file has only 5 lines; persona cites 10-12.
    await seedWorktreeFile('src/foo.ts', 5)

    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 8,
            findings: [
              {
                title: 'phantom line',
                file: 'src/foo.ts',
                line: '10-12',
                severity: 'fix-first',
                recommendation: 'cite an existing line',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_finding_line_out_of_range')
    }
  })

  test('M9 commit 18 bp#3 follow-up: rejects Line: 0 (1-indexed lower bound)', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    await seedWorktreeFile('src/foo.ts', 10)

    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 8,
            findings: [
              {
                title: 'impossible line',
                file: 'src/foo.ts',
                line: '0',
                severity: 'fix-first',
                recommendation: 'cite a 1-indexed line',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_finding_line_out_of_range')
      expect(result.rule).toContain('start at 1')
    }
  })

  test('M9 commit 23 (QA 5.2): rejects reversed line range "10-5"', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    await seedWorktreeFile('src/foo.ts', 20)

    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 8,
            findings: [
              {
                title: 'reversed range',
                file: 'src/foo.ts',
                line: '10-5',
                severity: 'fix-first',
                recommendation: 'cite a forward range',
              },
            ],
          }),
      }),
    )
    // The persona-response parser already rejects this via parseFindingsBlock's
    // round-resolved check, so the actual code surfaced may be from earlier
    // in the pipeline. Either way: status=intervention, no canonical REVIEW.md.
    expect(result.status).toBe('intervention')
  })

  test('M9 commit 18 bp#3 follow-up: rejects symlink escape via realpath check', async () => {
    await seedBuildAndVerifyArtifacts({ changedFile: 'src/foo.ts' })
    await seedBuildProviderEvent()
    // Create the worktree with a symlink at src/foo.ts that points to a
    // file OUTSIDE the worktree. Lexical resolve+relative would pass
    // (the path is "src/foo.ts", which resolves under the worktree),
    // but realpath dereferences the symlink and reveals the escape.
    const { symlink } = await import('node:fs/promises')
    const worktreeRoot = join(tmp, '.code-oz/runs', RUN, 'worktree')
    const escapeTargetDir = join(tmp, 'outside-worktree')
    await mkdir(escapeTargetDir, { recursive: true })
    await writeFile(
      join(escapeTargetDir, 'evil.ts'),
      Array.from({ length: 10 }, (_, i) => `evil ${i + 1}`).join('\n') + '\n',
    )
    await mkdir(join(worktreeRoot, 'src'), { recursive: true })
    await symlink(join(escapeTargetDir, 'evil.ts'), join(worktreeRoot, 'src/foo.ts'))

    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 8,
            findings: [
              {
                title: 'symlink escape',
                file: 'src/foo.ts',
                line: '1',
                severity: 'fix-first',
                recommendation: 'will not be read',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_finding_path_unknown')
      expect(result.rule).toContain('symlink')
    }
  })

  test('M9 commit 13 bp#3: finding cites a worktree file that does not exist → review_finding_file_unreadable', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    // Manifest says src/foo.ts modified, but no file exists in the
    // worktree (e.g., worktree was cleaned up before REVIEW or
    // misconfigured runId).
    const result = await runReview(
      buildOpts({
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 8,
            findings: [
              {
                title: 'real-looking finding',
                file: 'src/foo.ts',
                line: '1',
                severity: 'fix-first',
                recommendation: 'fix it',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_finding_file_unreadable')
    }
  })

  test('finding cites file outside BUILD_REPORT.changed manifest → review_finding_path_unknown', async () => {
    await seedBuildAndVerifyArtifacts({ changedFile: 'src/foo.ts' })
    await seedBuildProviderEvent()

    const result = await runReview(
      buildOpts({
        // Both drafts cite an unknown file → terminal.
        invokePersona: async () =>
          makeReadyPersonaResponse({
            score: 8,
            findings: [
              {
                title: 'something off',
                file: 'src/bar.ts',
                line: '1',
                severity: 'fix-first',
                recommendation: 'fix bar',
              },
            ],
          }),
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_finding_path_unknown')
    }
  })
})

// --- M9 commit 13 fs#1: canonicalizeFindings throw caught -----------

describe('runReview — canonicalizeFindings throw caught (fs#1)', () => {
  test('persona draft causes duplicate-id collision after canonicalization → review_validation_failed (no crash)', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    await seedWorktreeFile('src/foo.ts', 10)

    // priorReport has F-001 unresolved at fingerprint (src/foo.ts, "Same title").
    // Persona drafts two findings with the same fingerprint: one with
    // explicit id F-001, one with F-NEW. The canonicalizer assigns
    // F-001 to the explicit one (priorById) AND reuses F-001 for the
    // F-NEW (fingerprint match) → duplicate id throw.
    const { serializeReviewReport: serialize } = await import('../src/artifacts/review-report.ts')
    const priorReviewMd = serialize({
      upstreamRefs: {
        buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
        buildReportSha256: 'a'.repeat(64),
        verifyReportPath: '.code-oz/artifacts/VERIFY.md',
        verifyReportSha256: 'b'.repeat(64),
        taskId: 'T-001', attempt: 1,
        baseCommitSha: 'b'.repeat(40),
        patchSha256: 'c'.repeat(64),
      },
      reviewer: {
        providerFamily: 'codex', providerId: 'codex', modelPolicy: 'any',
        crossFamilyCheck: 'passed' as const, buildFamily: 'claude',
      },
      roundTimeline: [{
        round: 1, timestamp: NOW, findingsRaised: 1,
        score: 4, verdict: 'needs-revision' as const,
      }],
      findings: [{
        id: 'F-001',
        title: 'Same title',
        file: 'src/foo.ts',
        line: '1',
        severity: 'fix-first' as const,
        recommendation: 'still unresolved',
        roundRaised: 1,
        roundResolved: 'unresolved' as const,
      }],
      score: {
        roundCount: 1, finalScore: 4,
        finalVerdict: 'needs-revision' as const,
        exitReason: 'needs-revision (round 1)',
      },
      capStatus: { cap: 4, roundsUsed: 1, capExhausted: false },
    })

    const collidingResponse = `${REVIEW_READY_SIGNAL}

## Findings

### F-001: Same title
- File: src/foo.ts
- Line: 1
- Severity: fix-first
- Recommendation: still unresolved
- Round raised: 1
- Round resolved: unresolved

### F-NEW: Same title
- File: src/foo.ts
- Line: 1
- Severity: fix-first
- Recommendation: same fingerprint causes collision
- Round raised: 2
- Round resolved: unresolved

## Score

- Final score: 4
`
    const result = await runReview(
      buildOpts({
        invokePersona: async () => collidingResponse,
        round: 2,
        priorReviewMd,
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_validation_failed')
      expect(result.rule).toContain('canonicalizeFindings threw')
      // M9 commit 23 (QA 4.1) tightened the canonicalizer: duplicate
      // fingerprints are now caught BEFORE id collision. Both error
      // paths surface the same intervention code; rule string mentions
      // either "duplicate id" or "same fingerprint".
      expect(/duplicate id|same fingerprint/.test(result.rule)).toBe(true)
    }
  })
})

// --- resume-mismatch detection -------------------------------------

describe('runReview — resume-mismatch detection', () => {
  test('partial draft on disk + no review_round_completed → review_resume_mismatch', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()

    // Stage a stale draft from a "prior session" without the matching event.
    const draftDir = reviewDraftsDir(paths.runDir)
    await mkdir(draftDir, { recursive: true })
    const stalePath = reviewDraftPath(paths.runDir, 1, 1)
    await atomicWriteFile(stalePath, 'partial draft from prior session\n')

    const result = await runReview(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('review_resume_mismatch')
      expect(result.draftPath).toBe(stalePath)
    }

    // The orchestrator must NOT have invoked the persona (no review_started
    // event for this aborted run — we already had no invocations beyond the
    // initial run_started + phase_entered).
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    expect(events.some((e) => e.type === 'review_started')).toBe(false)
  })

  test('M9 commit 18 fs#2 follow-up: runReview surfaces sha_mismatch reason in intervention message (not a generic "no event" string)', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()
    // First produce a real round 1 ready exit so the run has a canonical
    // REVIEW.md + matching review_round_completed event.
    const result1 = await runReview(buildOpts())
    expect(result1.status).toBe('resolved')
    // Tamper REVIEW.md so the recorded sha no longer matches.
    const reviewPath = join(paths.artifactRoot, 'REVIEW.md')
    await writeFile(reviewPath, (await readFile(reviewPath, 'utf8')) + '\n# tamper\n')
    // Stage a stale draft for round 1 and re-run runReview round 1.
    const draftPath = reviewDraftPath(paths.runDir, 1, 1)
    await mkdir(reviewDraftsDir(paths.runDir), { recursive: true })
    await atomicWriteFile(draftPath, 'partial draft\n')

    const result2 = await runReview(buildOpts())
    expect(result2.status).toBe('intervention')
    if (result2.status === 'intervention') {
      expect(result2.code).toBe('review_resume_mismatch')
      // The message must specifically call out the sha mismatch, NOT
      // the "no review_round_completed event" branch (which is what
      // the bug surfaced before this fix).
      expect(result2.rule).toContain('reviewReportSha256 does not match')
    }
  })

  test('M9 commit 13 fs#2: partial draft + matching event but sha mismatch → mismatched (sha_mismatch)', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    // First produce a real round 1 ready exit so the run has a canonical
    // REVIEW.md + matching review_round_completed event.
    const result = await runReview(buildOpts())
    expect(result.status).toBe('resolved')

    // Now tamper with REVIEW.md so its sha no longer matches the
    // recorded event's reviewReportSha256.
    const reviewPath = join(paths.artifactRoot, 'REVIEW.md')
    const tampered = (await readFile(reviewPath, 'utf8')) + '\n# tamper\n'
    await writeFile(reviewPath, tampered)

    // Stage a stale draft + run probe.
    const draftPath = reviewDraftPath(paths.runDir, 1, 1)
    await mkdir(reviewDraftsDir(paths.runDir), { recursive: true })
    await atomicWriteFile(draftPath, 'partial draft\n')
    const { probeReviewResume } = await import('../src/phases/review-resume.ts')
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const probe = await probeReviewResume({
      runDir: paths.runDir,
      events,
      taskId: 'T-001',
      attempt: 1,
      round: 1,
      reviewReportPath: reviewPath,
    })
    expect(probe.mismatched).toBe(true)
    expect(probe.reason).toBe('sha_mismatch')
  })

  test('partial draft + matching review_round_completed event → no mismatch (replay-safe)', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    // Run round 1 to completion to land a real review_round_completed event.
    // Then leave a "draft" on disk to simulate a partial-write residue from
    // a session that DID complete the round; the runner must not raise
    // resume_mismatch.
    const result1 = await runReview(buildOpts())
    expect(result1.status).toBe('resolved')

    // Re-stage a draft after the canonical write (the cleanup removed it).
    // The canonical write already succeeded, the round_completed event is in
    // the log — a fresh runReview() on the same round (round=1) would race,
    // but the resume detector must not fire because the event exists.
    // Probe is what the orchestrator runs; we just need to confirm no
    // intervention if a residual draft re-appears.
    const draftPath = reviewDraftPath(paths.runDir, 1, 1)
    await atomicWriteFile(draftPath, 'residual draft text\n')

    // We don't re-run runReview here (idempotency of round=1 isn't M9 c7's
    // contract). What we are asserting is that the resume probe is keyed on
    // the round_completed event, not on the draft alone. The probe is
    // exported; verify it directly.
    const { probeReviewResume } = await import('../src/phases/review-resume.ts')
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const probe = await probeReviewResume({
      runDir: paths.runDir,
      events,
      taskId: 'T-001',
      attempt: 1,
      round: 1,
    })
    expect(probe.mismatched).toBe(false)
  })
})

// --- M9 commit 22: concurrency lock (QA 1.1) -----------------------

describe('runReview — concurrency lock (QA 1.1)', () => {
  test('concurrent invocations: second call gets review_already_in_flight, first runs to completion', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    // Pre-create the lock directory to simulate an in-flight runReview.
    const lockDir = join(paths.runDir, '.review.lock')
    await mkdir(lockDir, { recursive: false })
    try {
      const result = await runReview(buildOpts())
      expect(result.status).toBe('intervention')
      if (result.status === 'intervention') {
        expect(result.code).toBe('review_already_in_flight')
        expect(result.rule).toContain('.review.lock')
      }
    } finally {
      // Cleanup so afterEach's tmp wipe is consistent.
      const { rmdir } = await import('node:fs/promises')
      await rmdir(lockDir).catch(() => undefined)
    }
  })

  test('lock is released on success; subsequent runReview can run another round', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    // First call succeeds and releases the lock.
    const result1 = await runReview(buildOpts())
    expect(result1.status).toBe('resolved')

    // The lock must NOT exist on disk after the call returns.
    const lockDir = join(paths.runDir, '.review.lock')
    let lockStillExists = true
    try {
      await access(lockDir)
    } catch {
      lockStillExists = false
    }
    expect(lockStillExists).toBe(false)
  })
})

// --- exposed REVIEW_READY_SIGNAL ----------------------------------

describe('runReview — exposed REVIEW_READY_SIGNAL constant', () => {
  test('matches the persona prompt template token', () => {
    expect(REVIEW_READY_SIGNAL).toBe('<review-ready/>')
  })
})
