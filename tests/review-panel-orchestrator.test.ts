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
  type ReviewReportPanelData,
} from '../src/artifacts/review-report.ts'
import type { Panelist, CompanyConfig } from '../src/config/schema.ts'
import { DEFAULT_CONFIG, type CodeOzConfig } from '../src/config/schema.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { ProviderFamily } from '../src/providers/types.ts'

// Tests resolve provider family via registry.familyOf (Codex M14 R1
// finding #3 closure). An empty provider list is sufficient — familyOf
// only consults DEFAULT_FAMILY_BY_ID + overrides.
const testRegistry = new ProviderRegistry({ providers: [] })

// Default config for orchestrator tests. Generous caps so the budget
// preflight (Codex M14 R1 finding #6 closure) does not refuse happy-path
// rounds; budget-specific tests below override these caps.
const testConfig: CodeOzConfig = DEFAULT_CONFIG as CodeOzConfig
const PER_PANELIST_EST = 10

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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
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

describe('runReviewPanel — registry-owned runtime family resolution (Codex M14 R1 finding #3)', () => {
  test('registry override that collapses voter to buildFamily → panel_voter_same_family_at_runtime intervention', async () => {
    // Build a registry that maps provider 'codex' to family 'claude'. With
    // buildFamily='claude' this would launder a same-family voter at
    // runtime even though config-load saw cross-family on declared values.
    // The orchestrator MUST refuse with a defense-in-depth intervention
    // rather than emit a malformed canonical artifact.
    const overrideRegistry = new ProviderRegistry({
      providers: [],
      familyOverrides: { codex: 'claude' },
    })
    const invokerLyingAboutFamily: PanelistInvoker = async (cfg) => ({
      panelistId: cfg.id,
      providerId: cfg.provider,
      // Invoker still claims declared family — irrelevant; the orchestrator
      // ignores this field after F3.
      providerFamily: cfg.provider,
      modelPolicy: 'any',
      role: cfg.role,
      score: 8,
      verdict: 'ready',
      findings: [],
      manifestHash: MANIFEST_HASH,
      stagingContent: stagingMd(cfg.id),
    })
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: invokerLyingAboutFamily,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      registry: overrideRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('panel_voter_same_family_at_runtime')
    expect(result.rule).toContain('claude')
  })

  test('review_panelist_completed event records registry-resolved family, not invoker-supplied', async () => {
    // gemini→fake override doesn't collapse voters into buildFamily=claude,
    // so the panel completes; the event payload must use the resolved
    // 'fake' family rather than the invoker-supplied 'gemini'.
    const overrideRegistry = new ProviderRegistry({
      providers: [],
      familyOverrides: { gemini: 'fake' },
    })
    const lyingInvoker: PanelistInvoker = async (cfg) => ({
      panelistId: cfg.id,
      providerId: cfg.provider,
      providerFamily: cfg.provider, // invoker says 'codex' / 'gemini'
      modelPolicy: 'any',
      role: cfg.role,
      score: 8,
      verdict: 'ready',
      findings: [],
      manifestHash: MANIFEST_HASH,
      stagingContent: stagingMd(cfg.id),
    })
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: lyingInvoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      registry: overrideRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    if (result.status === 'intervention') {
      throw new Error(`unexpected intervention: ${result.code} ${result.rule}`)
    }
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = events
      .filter((e) => isKnownPhaseEvent(e) && e.type === 'review_panelist_completed')
      .map((e) => e as Extract<typeof e, { readonly type: 'review_panelist_completed' }>)
    expect(completed.length).toBe(2)
    const geminiEvent = completed.find((e) => e.providerId === 'gemini')
    expect(geminiEvent).toBeDefined()
    // Registry override resolves gemini→fake. Event records 'fake'.
    expect(geminiEvent!.providerFamily).toBe('fake')

    // Canonical REVIEW.md likewise reflects 'fake', not 'gemini'.
    const reviewMd = await readFile(result.reviewReportPath, 'utf8')
    const parsed = parseReviewPanelReport(reviewMd)
    const geminiReviewer = parsed.reviewers.find((r) => r.providerId === 'gemini')
    expect(geminiReviewer).toBeDefined()
    expect(geminiReviewer!.providerFamily).toBe('fake')
  })

  test('aggregate budget refusal blocks the round before any panelist invokes (Codex M14 R1 finding #6)', async () => {
    // Tight per-phase review cap; the aggregate panel cost must exceed it.
    const tightConfig: CodeOzConfig = {
      ...testConfig,
      budgets: {
        ...testConfig.budgets,
        perPhase: {
          ...testConfig.budgets.perPhase,
          review: { maxTurns: 100, maxProviderCalls: 100, maxTokensEstimate: 50 },
        },
      },
    }
    let invokerCalls = 0
    const trackingInvoker: PanelistInvoker = async (cfg) => {
      invokerCalls++
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
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: trackingInvoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      registry: testRegistry,
      config: tightConfig,
      events: [],
      perPanelistTokensEstimate: 50, // 2 panelists × 50 = 100, exceeds cap of 50
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('panel_budget_exceeded')
    // No panelist was invoked — partial-panel-prevention invariant.
    expect(invokerCalls).toBe(0)
    // No staging directory was materialized either — the panelist loop
    // never started, and review_panel_started was never emitted.
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const panelStarted = events.filter(
      (e) => isKnownPhaseEvent(e) && e.type === 'review_panel_started',
    )
    expect(panelStarted.length).toBe(0)
  })

  test('soft-warning threshold emits budget_warning before panelist loop (Codex M14 R1 finding #6)', async () => {
    // Aggregate cost lands in the soft-warn band (>= 0.75 of cap, < 1.0).
    const warnConfig: CodeOzConfig = {
      ...testConfig,
      budgets: {
        ...testConfig.budgets,
        perPhase: {
          ...testConfig.budgets.perPhase,
          review: { maxTurns: 100, maxProviderCalls: 100, maxTokensEstimate: 100 },
        },
        global: {
          ...testConfig.budgets.global,
          maxTokensEstimate: 100,
          softWarnAtRatio: 0.75,
        },
      },
    }
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
      registry: testRegistry,
      config: warnConfig,
      events: [],
      perPanelistTokensEstimate: 40, // 2 × 40 = 80; 80/100 = 0.8 ≥ 0.75
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('resolved')
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const warnings = events.filter(
      (e) => isKnownPhaseEvent(e) && e.type === 'budget_warning',
    )
    // At least one budget_warning event was emitted before the panel ran.
    expect(warnings.length).toBeGreaterThan(0)
    // The warning is positioned before review_panel_started in the log.
    const warningIdx = events.findIndex(
      (e) => isKnownPhaseEvent(e) && e.type === 'budget_warning',
    )
    const startedIdx = events.findIndex(
      (e) => isKnownPhaseEvent(e) && e.type === 'review_panel_started',
    )
    expect(warningIdx).toBeLessThan(startedIdx)
  })

  test('unknown providerId from invoker → panel_provider_family_unresolved intervention', async () => {
    const evilInvoker: PanelistInvoker = async (cfg) => ({
      panelistId: cfg.id,
      // Lie about providerId entirely — registry has no family mapping for
      // this fake-id, so familyOf throws and the orchestrator surfaces an
      // intervention rather than crashing or trusting an invented value.
      providerId: 'not-a-real-provider' as never,
      providerFamily: 'codex',
      modelPolicy: 'any',
      role: cfg.role,
      score: 8,
      verdict: 'ready',
      findings: [],
      manifestHash: MANIFEST_HASH,
      stagingContent: stagingMd(cfg.id),
    })
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: evilInvoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('panel_provider_family_unresolved')
  })
})

describe('runReviewPanel — multi-round lifecycle (Codex M14 R2 finding #1)', () => {
  test('priorPanelReport extends timeline + carries F-NNN ids by fingerprint', async () => {
    // Round 1: voter A=5, voter B=8 → score below 6 → needs_revision.
    // The findings raised by reviewer-A get F-001, reviewer-B's get F-002.
    const round1Invoker: PanelistInvoker = async (cfg) => {
      const isA = cfg.id === 'reviewer-A'
      return {
        panelistId: cfg.id,
        providerId: cfg.provider,
        providerFamily: cfg.provider,
        modelPolicy: 'any',
        role: cfg.role,
        score: isA ? 5 : 8,
        verdict: 'needs-revision',
        findings: isA
          ? [
              {
                file: 'src/foo.ts',
                line: '1',
                title: 'null check missing',
                severity: 'fix-first',
                recommendation: 'guard',
              },
            ]
          : [
              {
                file: 'src/bar.ts',
                line: '5',
                title: 'shadow var',
                severity: 'nit',
                recommendation: 'rename',
              },
            ],
        manifestHash: MANIFEST_HASH,
        stagingContent: stagingMd(cfg.id),
      }
    }
    const round1 = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: round1Invoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(round1.status).toBe('needs_revision')
    if (round1.status === 'intervention') return
    const round1Md = await readFile(round1.reviewReportPath, 'utf8')
    const round1Data = parseReviewPanelReport(round1Md)
    expect(round1Data.findings).toHaveLength(2)
    const round1NullCheck = round1Data.findings.find((f) => f.title === 'null check missing')
    expect(round1NullCheck).toBeDefined()
    expect(round1NullCheck!.id).toMatch(/^F-\d{3}$/)
    expect(round1NullCheck!.roundRaised).toBe(1)
    const nullCheckId = round1NullCheck!.id
    const round1ShadowVar = round1Data.findings.find((f) => f.title === 'shadow var')
    expect(round1ShadowVar).toBeDefined()
    const shadowVarId = round1ShadowVar!.id

    // Round 2: A no longer raises null-check (resolved!), B keeps shadow-var
    // and adds a new fix-first finding. Now both voters score 8.
    const round2Invoker: PanelistInvoker = async (cfg) => {
      const isA = cfg.id === 'reviewer-A'
      return {
        panelistId: cfg.id,
        providerId: cfg.provider,
        providerFamily: cfg.provider,
        modelPolicy: 'any',
        role: cfg.role,
        score: 8,
        verdict: 'ready',
        findings: isA
          ? []
          : [
              {
                file: 'src/bar.ts',
                line: '5',
                title: 'shadow var',
                severity: 'nit',
                recommendation: 'rename',
              },
            ],
        manifestHash: MANIFEST_HASH,
        stagingContent: stagingMd(cfg.id),
      }
    }
    const round2 = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: round2Invoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      priorPanelReport: round1Data,
      upstreamRefs: upstreamRefs(),
      round: 2,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    expect(round2.status).not.toBe('intervention')
    if (round2.status === 'intervention') return
    const round2Md = await readFile(round2.reviewReportPath, 'utf8')
    const round2Data = parseReviewPanelReport(round2Md)
    // Timeline now has 2 entries (round 1 + round 2).
    expect(round2Data.roundTimeline).toHaveLength(2)
    expect(round2Data.roundTimeline[0]!.round).toBe(1)
    expect(round2Data.roundTimeline[1]!.round).toBe(2)
    // null-check is carried forward by id, marked resolved at round 2.
    const carriedNullCheck = round2Data.findings.find((f) => f.id === nullCheckId)
    expect(carriedNullCheck).toBeDefined()
    expect(carriedNullCheck!.title).toBe('null check missing')
    expect(carriedNullCheck!.roundResolved).toBe(2)
    // shadow-var keeps its id (re-raised), roundRaised stays at 1, still unresolved.
    const carriedShadowVar = round2Data.findings.find((f) => f.id === shadowVarId)
    expect(carriedShadowVar).toBeDefined()
    expect(carriedShadowVar!.title).toBe('shadow var')
    expect(carriedShadowVar!.roundResolved).toBe('unresolved')
    expect(carriedShadowVar!.roundRaised).toBe(1)
  })

  test('priorPanelReport with reopened fingerprint marks roundResolved=unresolved', async () => {
    // Round 1: A raises F-001 (severity fix-first), it gets resolved (mark
    // resolved manually via prior fixture data). Round 2: A re-raises the
    // same fingerprint — must reuse F-001 id and reset to unresolved.
    const priorPanelReport: ReviewReportPanelData = {
      mode: 'panel',
      upstreamRefs: upstreamRefs(),
      reviewers: [
        {
          id: 'reviewer-A',
          providerId: 'codex',
          providerFamily: 'codex',
          modelPolicy: 'any',
          role: 'voter',
          score: 8,
          verdict: 'ready',
          crossFamilyCheck: 'passed',
          buildFamily: 'claude',
          manifestHash: MANIFEST_HASH,
        },
        {
          id: 'reviewer-B',
          providerId: 'gemini',
          providerFamily: 'gemini',
          modelPolicy: 'any',
          role: 'voter',
          score: 8,
          verdict: 'ready',
          crossFamilyCheck: 'passed',
          buildFamily: 'claude',
          manifestHash: MANIFEST_HASH,
        },
      ],
      synthesis: {
        panelVerdict: 'ready',
        quorumReason: 'cross-family quorum reached: 2 of 2 voters from {codex, gemini}',
        eligibleVoterFamilies: ['codex', 'gemini'],
        excludedReviewerIds: [],
        excludedReasons: [],
        uniqueFindingsByReviewer: { 'reviewer-A': 1, 'reviewer-B': 0 },
        sharedFindings: 0,
      },
      roundTimeline: [
        {
          round: 1,
          timestamp: NOW,
          findingsRaised: 1,
          panelVerdict: 'ready',
        },
      ],
      findings: [
        {
          id: 'F-001',
          title: 'edge case bug',
          file: 'src/foo.ts',
          line: '42',
          severity: 'fix-first',
          authorityImpact: 'voter',
          sources: ['reviewer-A'],
          recommendation: 'fix',
          roundRaised: 1,
          roundResolved: 1, // resolved
        },
      ],
      score: {
        roundCount: 1,
        finalScore: 'panel',
        finalVerdict: 'ready',
        exitReason: 'cross-family quorum reached AND no unresolved voter actionable findings',
      },
      capStatus: { cap: 4, roundsUsed: 1, capExhausted: false },
    }
    const round2Invoker: PanelistInvoker = async (cfg) => ({
      panelistId: cfg.id,
      providerId: cfg.provider,
      providerFamily: cfg.provider,
      modelPolicy: 'any',
      role: cfg.role,
      score: 8,
      verdict: 'needs-revision',
      // Reviewer-A re-raises the SAME fingerprint that was previously resolved.
      findings:
        cfg.id === 'reviewer-A'
          ? [
              {
                file: 'src/foo.ts',
                line: '42',
                title: 'edge case bug',
                severity: 'fix-first',
                recommendation: 'fix harder',
              },
            ]
          : [],
      manifestHash: MANIFEST_HASH,
      stagingContent: stagingMd(cfg.id),
    })
    const round2 = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: round2Invoker,
      panel: [
        { provider: 'codex', role: 'voter' },
        { provider: 'gemini', role: 'voter' },
      ],
      buildFamily: 'claude',
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      priorPanelReport,
      upstreamRefs: upstreamRefs(),
      round: 2,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    if (round2.status === 'intervention') {
      throw new Error(`unexpected intervention: ${round2.code}`)
    }
    const round2Md = await readFile(round2.reviewReportPath, 'utf8')
    const round2Data = parseReviewPanelReport(round2Md)
    // F-001 is reused (id stable), now flipped back to unresolved (reopen).
    const reopened = round2Data.findings.find((f) => f.id === 'F-001')
    expect(reopened).toBeDefined()
    expect(reopened!.roundResolved).toBe('unresolved')
    expect(reopened!.roundRaised).toBe(1) // round raised stays at the original round
  })
})

// PE-2 (OpenRouter) observability hardening — emission side of the
// unknown-lineage exclusion. The verdict-side rejection already exists;
// see tests/review-panel-canonical-verdict.test.ts T10 ("routed-provider
// with unknown family is INELIGIBLE as voter (PE-2+ defense)"). This
// describe block tests the orchestrator emits a `panel_voter_lineage_unknown`
// event when the verdict surfaces a routed-provider exclusion so PE-2
// operators can debug "why did my voter not count?" by reading
// events.jsonl. Synthetic unknown lineage is injected via
// ProviderRegistry.familyOverrides — the static family registry
// (src/providers/families.ts) intentionally does NOT carry an `unknown`
// sentinel; routed providers acquire unknown lineage at runtime in PE-2.
describe('runReviewPanel — panel_voter_lineage_unknown emission (PE-2 observability)', () => {
  test('voter resolved to unknown family emits exactly one panel_voter_lineage_unknown event', async () => {
    // Inject unknown lineage via familyOverrides (cast required because
    // ProviderFamily is a strict 5-id union; PE-2 routed providers will
    // legitimately produce 'unknown' family at runtime via routed-provider
    // lineage gating). The same-family-at-runtime guard at line 398 is
    // bypassed because resolvedFamily ('unknown') !== buildFamily ('claude').
    const routedRegistry = new ProviderRegistry({
      providers: [],
      familyOverrides: { codex: 'unknown' as ProviderFamily },
    })
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
      registry: routedRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      upstreamRefs: upstreamRefs(),
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })
    // Verdict outcome unchanged — only 1 eligible voter (gemini), so
    // quorum count fails. This test specifically asserts the emission;
    // the verdict semantics are covered by T10.
    expect(result.status).toBe('needs_revision')
    if (result.status === 'intervention') return
    expect(result.panelVerdict).toBe('needs-revision')
    expect(result.quorumReason).toContain('required exactly 2 eligible voters, got 1')

    // Read events.jsonl from disk and filter for the new variant.
    const events = await readEvents({
      file: paths.eventsFile,
      lockDir: paths.lockDir,
    })
    const lineageEvents = events.filter(
      (e) => isKnownPhaseEvent(e) && e.type === 'panel_voter_lineage_unknown',
    )
    expect(lineageEvents).toHaveLength(1)
    const evt = lineageEvents[0]!
    if (evt.type !== 'panel_voter_lineage_unknown') {
      throw new Error('unreachable')
    }
    expect(evt.voterId).toBe('reviewer-A') // codex voter (first in panel)
    expect(evt.voterProviderId).toBe('codex')
    expect(evt.panelistRole).toBe('voter')
    expect(evt.excludeReason).toContain('lineage unknown')
    expect(evt.phase).toBe('review')
    expect(evt.agent).toBe('panel-orchestrator')
    expect(evt.runId).toBe(RUN)

    // Sanity: the cross-family voter (gemini) MUST NOT trigger the event.
    expect(events.find(
      (e) =>
        isKnownPhaseEvent(e) &&
        e.type === 'panel_voter_lineage_unknown' &&
        (e as { voterId: string }).voterId === 'reviewer-B',
    )).toBeUndefined()
  })
})
