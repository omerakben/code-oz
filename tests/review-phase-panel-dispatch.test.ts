// runReview panel-mode dispatch tests (M14 fix-first F1).
//
// Codex M14 R1 finding #1: runReview must dispatch to runReviewPanel
// when company.reviewer.panel declares a 2-voter panel. This file is
// the lifecycle proof — it drives runReview end-to-end through the
// panel branch and asserts:
//   - canonical REVIEW.md exists with panel grammar (parseable by
//     parseReviewPanelReport, not parseReviewReport)
//   - review_panel_completed event fired for the round
//   - review_resolved event fired with matching reviewReportSha256 so
//     the existing approve.ts gate path works without contract change
//   - gate_required(review) emitted by requireGate('review')
//   - Scientist tail ran (rule 15)
//
// FakeProvider stubs only the Scientist persona (provider=fake). The
// panelist invocations go through a deterministic in-process
// PanelistInvoker — the same shape runReviewPanel exposes for testing.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runReview } from '../src/phases/review.ts'
import type { PanelistInvoker, PanelistInvocationResult } from '../src/phases/review-panel.ts'
import { parseReviewPanelReport } from '../src/artifacts/review-report.ts'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { DEFAULT_CONFIG, type CodeOzConfig } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { appendEvent, readEvents } from '../src/state/events.ts'
import { readFile } from 'node:fs/promises'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const NOW = '2026-05-03T19:00:00.000Z'
const PLAN_SHA = 'a'.repeat(64)
const BASE_COMMIT_SHA = 'b'.repeat(40)
const PATCH_SHA = 'c'.repeat(64)
const FILE_SHA = 'd'.repeat(64)
const MANIFEST_HASH = 'e'.repeat(64)

const REVIEWER_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/reviewer.md',
  name: 'panel-orchestrator',
  type: 'agent',
  phase: 'review',
  // The orchestrator agent is what fires events.agent in panel mode;
  // its provider is irrelevant since per-panelist providers come from
  // company.reviewer.panel config.
  provider: 'codex',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['.code-oz/artifacts/REVIEW.md']),
    bash: 'deny' as const,
    tool_use: Object.freeze({
      review_request: Object.freeze({
        tools: Object.freeze(['request-review'] as const),
        providers: Object.freeze(['codex' as const, 'gemini' as const]),
        maxRounds: 4,
        timeoutMsPerRound: 120_000,
        network: 'provider-only' as const,
      }),
    }),
  }),
  description: 'panel orchestrator stub for F1 dispatch tests.',
  body: '# Panel orchestrator stub\n',
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
  body: '## Scientist stub.',
})

const SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: panel REVIEW.md round-tripped through canonical grammar

- Phase: review
- Status: open
- Falsifier: A panel REVIEW.md serialized by runReviewPanel must be parseable by parseReviewPanelReport.
- Evidence: REVIEW.md Reviewers section.
- Risk if false: Panel artifact grammar drifts from parser contract.

# OPEN QUESTIONS

## Q-001: Should panel mode propagate per-panelist scores into review_resolved?

- Phase: review
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: M14 v1 sets finalScore=10 sentinel.
- Resolution attempts: deferred to M15+.
`

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-review-panel-dispatch-'))
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

function makeBuildReport(): string {
  return `# BUILD_REPORT

## Task

- Task: T-001
- Title: stub
- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: ${PLAN_SHA})
- Attempt: 1

## Base

- Worktree: .code-oz/runs/<runId>/worktree/
- Base commit: ${BASE_COMMIT_SHA}
- Dirty tree at base: false

## Patch

- Patch path: .code-oz/runs/<runId>/patches/attempt-1.patch
- Patch sha256: ${PATCH_SHA}
- Patch byte count: 100

## Changed files

- src/foo.ts | sha256: ${FILE_SHA} | change: modified

## Validation command

- Command: bun test tests/foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Failure carry-forward

- None (attempt 1).

## Notes

- stub note.
`
}

function makeVerifyReport(): string {
  const buildReportSha = 'f'.repeat(64)
  return `# VERIFY

## BUILD ref

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${buildReportSha})
- Task: T-001
- Attempt: 1
- Base commit: ${BASE_COMMIT_SHA}
- Patch sha256: ${PATCH_SHA}

## Validation command

- Command: bun test tests/foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Evidence

- Exit code: 0
- Duration (ms): 100
- Stdout bytes: 0
- Stderr bytes: 0
- Stdout log: .code-oz/runs/${RUN}/forensics/1/stdout.log
- Stderr log: .code-oz/runs/${RUN}/forensics/1/stderr.log

## Verdict

- Verdict: pass
- Rationale: tests passed

## Mutation

- Status: not-applicable
- Notes: only modifications

## Failure constraint

- None (verdict pass).
`
}

async function seedBuildAndVerifyArtifacts(): Promise<void> {
  await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), makeBuildReport())
  await writeFile(join(paths.artifactRoot, 'VERIFY.md'), makeVerifyReport())
  // Worktree file the panel persona prompts will reference.
  const worktreeRoot = join(tmp, '.code-oz/runs', RUN, 'worktree')
  await mkdir(join(worktreeRoot, 'src'), { recursive: true })
  await writeFile(join(worktreeRoot, 'src/foo.ts'), 'x\n'.repeat(10))
}

async function seedBuildProviderEvent(): Promise<void> {
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1,
      type: 'build_provider_recorded',
      ts: NOW,
      runId: RUN,
      phase: 'build',
      attempt: 1,
      taskId: 'T-001',
      provider: 'claude',
      family: 'claude',
    },
  )
}

function configWithPanel(): CodeOzConfig {
  return {
    ...DEFAULT_CONFIG,
    company: {
      reviewer: {
        panel: [
          { provider: 'codex', role: 'voter' },
          { provider: 'gemini', role: 'voter' },
        ],
      },
    },
  } as CodeOzConfig
}

function invokeCtxWithPanel(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot: tmp,
    config: configWithPanel(),
    now: () => NOW,
  }
}

function happyPanelistInvoker(): PanelistInvoker {
  return async (cfg, _round) => {
    const result: PanelistInvocationResult = {
      panelistId: cfg.id,
      providerId: cfg.provider,
      providerFamily: cfg.provider,
      modelPolicy: cfg.model ?? 'any',
      role: cfg.role,
      score: 8,
      verdict: 'ready',
      findings: [],
      manifestHash: MANIFEST_HASH,
      stagingContent: `# panelist ${cfg.id}\n\nstub draft.\n`,
    }
    return result
  }
}

function expectScientistResponse(): void {
  fake.expect({ phase: 'review', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
}

describe('runReview panel-mode dispatch (M14 F1)', () => {
  test('panel-configured runReview produces canonical panel REVIEW.md + review_panel_completed + review_resolved + gate_required', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    const result = await runReview({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      reviewerAgent: REVIEWER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      invokeCtx: invokeCtxWithPanel(),
      // Single-reviewer invokePersona is irrelevant in panel mode but
      // remains required by the type — pass a never-called stub.
      invokePersona: async () => {
        throw new Error('invokePersona must not be called in panel mode')
      },
      panelistInvoker: happyPanelistInvoker(),
      now: () => NOW,
      round: 1,
    })

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.verdict).toBe('ready')

    // Canonical REVIEW.md exists with PANEL grammar (must parse via
    // parseReviewPanelReport, not parseReviewReport).
    const reviewMd = await readFile(result.reviewReportPath, 'utf8')
    const panelData = parseReviewPanelReport(reviewMd)
    expect(panelData.reviewers).toHaveLength(2)
    expect(panelData.synthesis.panelVerdict).toBe('ready')
    expect(panelData.score.finalScore).toBe('panel')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.filter(isKnownPhaseEvent).map((e) => e.type)
    // Panel-specific lifecycle events emitted by runReviewPanel:
    expect(types).toContain('review_panel_started')
    expect(types).toContain('review_panelist_completed')
    expect(types).toContain('review_panel_completed')
    // F1-emitted compatibility event so approve.ts works:
    expect(types).toContain('review_resolved')
    // Gate signal that requireGate('review') emits:
    expect(types).toContain('gate_required')

    // review_resolved sha256 must match the canonical artifact.
    const resolved = events.find(
      (e) => isKnownPhaseEvent(e) && e.type === 'review_resolved',
    )
    expect(resolved).toBeDefined()
    if (resolved && isKnownPhaseEvent(resolved) && resolved.type === 'review_resolved') {
      expect(resolved.reviewReportSha256).toBe(result.reviewReportSha256)
    }
  })

  test('panel-mode runReview without panelistInvoker → review_panel_invoker_missing intervention', async () => {
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()

    const result = await runReview({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      reviewerAgent: REVIEWER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      invokeCtx: invokeCtxWithPanel(),
      invokePersona: async () => '',
      // panelistInvoker intentionally omitted
      now: () => NOW,
      round: 1,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('review_panel_invoker_missing')
  })

  test('panel-mode dispatch uses registry.familyOf, not opts.reviewerAgent.provider — same-family reviewer agent does not block panel branch', async () => {
    // Single-reviewer path rejects buildFamily===reviewerFamily. Panel
    // mode must not run that check (per F1 design): the panel orchestrator
    // owns its own per-panelist family resolution. Even with a "claude"
    // reviewerAgent (same family as buildFamily), panel mode runs.
    await seedBuildAndVerifyArtifacts()
    await seedBuildProviderEvent()
    expectScientistResponse()

    const sameFamilyReviewerAgent: AgentDefinition = {
      ...REVIEWER_AGENT,
      provider: 'claude',
    }

    const result = await runReview({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      reviewerAgent: sameFamilyReviewerAgent,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      invokeCtx: invokeCtxWithPanel(),
      invokePersona: async () => {
        throw new Error('must not invoke single-reviewer persona in panel mode')
      },
      panelistInvoker: happyPanelistInvoker(),
      now: () => NOW,
      round: 1,
    })

    // Single-mode would have returned review_cross_family_violation.
    // Panel mode resolves via the panel's own cross-family voters.
    expect(result.status).toBe('resolved')
  })
})
