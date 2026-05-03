// M14 commit 6 — runReviewPanel orchestrator tests.
//
// Sequential per-panelist invocation; per-panelist staging writes;
// manifest equality enforcement; canonical REVIEW.md atomic write only
// after synthesis; review_panel_started + review_panelist_completed +
// review_panel_completed events.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runReviewPanel,
  shouldUseReviewPanel,
  type PanelistInvoker,
  type PanelistInvocationResult,
} from '../src/phases/review-panel.ts'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { readEvents } from '../src/state/events.ts'
import {
  parseReviewPanelReport,
  type ReviewUpstreamRefs,
} from '../src/artifacts/review-report.ts'
import type { Panelist, CompanyConfig } from '../src/config/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const NOW = '2026-05-03T01:23:45.000Z'
const HEX64 = '0'.repeat(64)
const HEX40 = '0'.repeat(40)
const MANIFEST_HASH = 'a'.repeat(64)

let tmp: string
let paths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-review-panel-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => NOW })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const upstreamRefs = (): ReviewUpstreamRefs => ({
  buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
  buildReportSha256: HEX64,
  verifyReportPath: '.code-oz/artifacts/VERIFY.md',
  verifyReportSha256: HEX64,
  taskId: 'T-001',
  attempt: 1,
  baseCommitSha: HEX40,
  patchSha256: HEX64,
})

function stagingMd(id: string, content = 'staging body'): string {
  return `# panelist ${id}\n\n${content}\n`
}

function happyInvoker(opts?: {
  scoreA?: number
  scoreB?: number
  manifestHash?: string
}): PanelistInvoker {
  const a = opts?.scoreA ?? 8
  const b = opts?.scoreB ?? 7
  const mh = opts?.manifestHash ?? MANIFEST_HASH
  return async (cfg, _round) => {
    const result: PanelistInvocationResult = {
      panelistId: cfg.id,
      providerId: cfg.provider,
      providerFamily: cfg.provider,
      modelPolicy: cfg.model ?? 'any',
      role: cfg.role,
      score: cfg.id === 'reviewer-A' ? a : b,
      verdict: 'ready',
      findings: [],
      manifestHash: mh,
      stagingContent: stagingMd(cfg.id),
    }
    return result
  }
}

describe('shouldUseReviewPanel — dispatch helper', () => {
  test('returns false when company is undefined', () => {
    expect(shouldUseReviewPanel(undefined)).toBe(false)
  })

  test('returns false when reviewer is undefined', () => {
    const company: CompanyConfig = {}
    expect(shouldUseReviewPanel(company)).toBe(false)
  })

  test('returns false when reviewer.panel is absent (single-reviewer mode)', () => {
    const company: CompanyConfig = { reviewer: { provider: 'codex' } }
    expect(shouldUseReviewPanel(company)).toBe(false)
  })

  test('returns false when panel has 1 entry', () => {
    const company: CompanyConfig = {
      reviewer: { panel: [{ provider: 'codex', role: 'voter' }] },
    }
    expect(shouldUseReviewPanel(company)).toBe(false)
  })

  test('returns true when panel has 2+ entries', () => {
    const company: CompanyConfig = {
      reviewer: {
        panel: [
          { provider: 'codex', role: 'voter' },
          { provider: 'gemini', role: 'voter' },
        ],
      },
    }
    expect(shouldUseReviewPanel(company)).toBe(true)
  })

  test('returns true when panel has voters + advisory', () => {
    const company: CompanyConfig = {
      reviewer: {
        panel: [
          { provider: 'codex', role: 'voter' },
          { provider: 'gemini', role: 'voter' },
          { provider: 'claude', role: 'advisory' },
        ],
      },
    }
    expect(shouldUseReviewPanel(company)).toBe(true)
  })
})

describe('runReviewPanel — happy paths', () => {
  test('2-voter cross-family panel produces resolved + canonical REVIEW.md', async () => {
    const panel: readonly Panelist[] = [
      { provider: 'codex', role: 'voter' },
      { provider: 'gemini', role: 'voter' },
    ]
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker(),
      panel,
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.panelVerdict).toBe('ready')
    expect(result.stagingPaths).toHaveLength(2)
    expect(result.quorumReason).toContain('cross-family quorum reached')

    // Canonical REVIEW.md exists + parses + has expected shape
    const reviewMd = await readFile(result.reviewReportPath, 'utf8')
    const parsed = parseReviewPanelReport(reviewMd)
    expect(parsed.reviewers).toHaveLength(2)
    expect(parsed.synthesis.panelVerdict).toBe('ready')
    expect(parsed.score.finalScore).toBe('panel')

    // Staging files exist
    for (const sp of result.stagingPaths) {
      await access(sp) // throws if missing
    }
  })

  test('panel emits review_panel_started + 2× review_panelist_completed + review_panel_completed', async () => {
    const panel: readonly Panelist[] = [
      { provider: 'codex', role: 'voter' },
      { provider: 'gemini', role: 'voter' },
    ]
    await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker(),
      panel,
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const panelEvents = events.filter(
      (e) =>
        isKnownPhaseEvent(e) &&
        (e.type === 'review_panel_started' ||
          e.type === 'review_panelist_completed' ||
          e.type === 'review_panel_completed'),
    )
    expect(panelEvents.length).toBe(4) // 1 started + 2 panelist completed + 1 panel completed
    expect(panelEvents[0]!.type).toBe('review_panel_started')
    expect(panelEvents[1]!.type).toBe('review_panelist_completed')
    expect(panelEvents[2]!.type).toBe('review_panelist_completed')
    expect(panelEvents[3]!.type).toBe('review_panel_completed')
    const completed = panelEvents[3]!
    if (completed.type !== 'review_panel_completed') throw new Error('unreachable')
    expect(completed.panelVerdict).toBe('ready')
    expect(completed.eligibleVoterFamilies).toEqual(['codex', 'gemini'])
    expect(completed.voterCount).toBe(2)
    expect(completed.advisoryCount).toBe(0)
  })

  test('panel with advisory entry passes layer-5 + records in synthesis', async () => {
    const panel: readonly Panelist[] = [
      { provider: 'codex', role: 'voter' },
      { provider: 'gemini', role: 'voter' },
      { provider: 'claude', role: 'advisory' },
    ]
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker(),
      panel,
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    const reviewMd = await readFile(result.reviewReportPath, 'utf8')
    const parsed = parseReviewPanelReport(reviewMd)
    expect(parsed.reviewers).toHaveLength(3)
    expect(parsed.reviewers[2]?.role).toBe('advisory')
    expect(parsed.synthesis.excludedReviewerIds).toContain('reviewer-C')
  })

  test('staging written under runDir/review-panel/round-N/panelist-<id>.md', async () => {
    const panel: readonly Panelist[] = [
      { provider: 'codex', role: 'voter' },
      { provider: 'gemini', role: 'voter' },
    ]
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker(),
      panel,
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 2,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    if (result.status !== 'resolved') throw new Error('expected resolved')
    expect(result.stagingPaths[0]).toContain('review-panel/round-2/panelist-reviewer-A.md')
    expect(result.stagingPaths[1]).toContain('review-panel/round-2/panelist-reviewer-B.md')
  })

  test('panelists invoked sequentially (call order matches panel order)', async () => {
    const callOrder: string[] = []
    const invoker: PanelistInvoker = async (cfg) => {
      callOrder.push(cfg.id)
      return {
        panelistId: cfg.id,
        providerId: cfg.provider,
        providerFamily: cfg.provider,
        modelPolicy: 'any',
        role: cfg.role,
        score: 8,
        verdict: 'ready',
        findings: [],
        manifestHash: MANIFEST_HASH,
        stagingContent: stagingMd(cfg.id),
      }
    }
    const panel: readonly Panelist[] = [
      { provider: 'codex', role: 'voter' },
      { provider: 'gemini', role: 'voter' },
      { provider: 'claude', role: 'advisory' },
    ]
    await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: invoker,
      panel,
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(callOrder).toEqual(['reviewer-A', 'reviewer-B', 'reviewer-C'])
  })

  test('voter score below 6 → needs_revision (canonical verdict drives result.status)', async () => {
    const panel: readonly Panelist[] = [
      { provider: 'codex', role: 'voter' },
      { provider: 'gemini', role: 'voter' },
    ]
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker({ scoreA: 5, scoreB: 8 }),
      panel,
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('needs_revision')
    if (result.status === 'intervention') return
    expect(result.panelVerdict).toBe('needs-revision')
  })

  test('voter raising block finding → blocked', async () => {
    const panel: readonly Panelist[] = [
      { provider: 'codex', role: 'voter' },
      { provider: 'gemini', role: 'voter' },
    ]
    const blockingInvoker: PanelistInvoker = async (cfg) => ({
      panelistId: cfg.id,
      providerId: cfg.provider,
      providerFamily: cfg.provider,
      modelPolicy: 'any',
      role: cfg.role,
      score: 8,
      verdict: cfg.id === 'reviewer-A' ? 'block' : 'ready',
      findings:
        cfg.id === 'reviewer-A'
          ? [{ file: 'src/x.ts', line: '1', title: 'critical', severity: 'block', recommendation: 'fix' }]
          : [],
      manifestHash: MANIFEST_HASH,
      stagingContent: stagingMd(cfg.id),
    })
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: blockingInvoker,
      panel,
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('blocked')
    if (result.status === 'intervention') return
    expect(result.panelVerdict).toBe('block')
  })
})

describe('runReviewPanel — interventions', () => {
  test('round out of range → intervention', async () => {
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker(),
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 5,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('review_round_out_of_range')
  })

  test('panel with < 2 entries → intervention', async () => {
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker(),
      panel: [{ provider: 'codex', role: 'voter' }],
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('panel_voter_count_invalid')
  })

  test('panel with !== 2 voters → intervention', async () => {
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: happyInvoker(),
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
        { provider: 'xai', role: 'voter' },
      ],
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('panel_voter_count_invalid')
    expect(result.detail).toContain('3 voters')
  })

  test('manifest hash mismatch across panelists → intervention', async () => {
    let counter = 0
    const inconsistentInvoker: PanelistInvoker = async (cfg) => ({
      panelistId: cfg.id,
      providerId: cfg.provider,
      providerFamily: cfg.provider,
      modelPolicy: 'any',
      role: cfg.role,
      score: 8,
      verdict: 'ready',
      findings: [],
      manifestHash: counter++ === 0 ? 'a'.repeat(64) : 'b'.repeat(64),
      stagingContent: stagingMd(cfg.id),
    })
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: inconsistentInvoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('review_panelist_manifest_mismatch')
  })

  test('panelist invocation throwing → intervention', async () => {
    const throwingInvoker: PanelistInvoker = async () => {
      throw new Error('provider connection failed')
    }
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: throwingInvoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('panel_invocation_failed')
    expect(result.detail).toContain('provider connection failed')
  })
})
