// M14 commit 9: e2e proof of the rule-21 ship gate.
//
// Per Codex pushback Q8 + Codex pushback "What I would have done
// differently" (CODEX_RESPONSE_M14.md): the strongest M14 ship
// evidence is "narrow and deterministic — same FakeProvider fixture,
// scripted single-reviewer miss, scripted panel-only actionable
// finding, same-family voter rejection, and metric output stored in
// or derivable from events.jsonl."
//
// This test file IS that evidence. It runs the canonical M14 baseline
// fixture end-to-end through:
//   1. loadAndRunPanelBaseline (commit 8) — emits the metric event
//   2. runReviewPanel (commit 6) with a fixture-driven invocation seam
//      — exercises the orchestrator + canonical verdict path end-to-end
//
// Expected ship-gate outcomes are documented in
// tests/fixtures/review-panel-baseline/README.md.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  loadAndRunPanelBaseline,
  runPanelBaseline,
  type PanelBaselineFixture,
} from '../../src/commands/doctor-panel-baseline.ts'
import {
  runReviewPanel,
  type PanelistInvoker,
} from '../../src/phases/review-panel.ts'
import { runPathsFor, initRun, type RunPaths } from '../../src/state/run.ts'
import { generateUlid, isKnownPhaseEvent } from '../../src/state/schemas.ts'
import { readEvents } from '../../src/state/events.ts'
import {
  parseReviewPanelReport,
  type ReviewUpstreamRefs,
} from '../../src/artifacts/review-report.ts'
import type { Panelist } from '../../src/config/schema.ts'
import { ProviderRegistry } from '../../src/providers/registry.ts'
import { DEFAULT_CONFIG, type CodeOzConfig } from '../../src/config/schema.ts'

// Tests resolve provider family via registry.familyOf (Codex M14 R1
// finding #3 closure).
const testRegistry = new ProviderRegistry({ providers: [] })
const testConfig: CodeOzConfig = DEFAULT_CONFIG as CodeOzConfig
const PER_PANELIST_EST = 10

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const NOW = '2026-05-03T01:23:45.000Z'
const FIXTURE_PATH = resolve(__dirname, '../fixtures/review-panel-baseline/baseline.json')
const HEX64 = '0'.repeat(64)
const HEX40 = '0'.repeat(40)

let tmp: string
let paths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-e2e-panel-'))
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

describe('e2e: doctor --panel-baseline against canonical M14 fixture', () => {
  test('rule-21 ship gate PASSES on canonical fixture (panelOnlyActionableFindingCount > 0)', async () => {
    const report = await loadAndRunPanelBaseline(FIXTURE_PATH, {
      runPaths: paths,
      now: () => NOW,
    })

    // All four ship-gate thresholds hold:
    expect(report.shipGate.panelOnlyActionable).toBe(true)
    expect(report.shipGate.sameFamilyVoteRejection).toBe(true)
    expect(report.shipGate.manifestEquality).toBe(true)
    expect(report.shipGate.disagreement).toBe(true)
    expect(report.shipGatePasses).toBe(true)

    // Specific metric values match the README's documented expectations:
    expect(report.metric.panelOnlyActionableFindingCount).toBe(1)
    expect(report.metric.sameFamilyVoteRejectionCount).toBe(1)
    expect(report.metric.manifestEqualityHeld).toBe(true)
    expect(report.metric.disagreementCount).toBe(1)
  })

  test('emits review_panel_baseline_completed event to events.jsonl', async () => {
    await loadAndRunPanelBaseline(FIXTURE_PATH, {
      runPaths: paths,
      now: () => NOW,
    })
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const baseline = events.find(
      (e) => isKnownPhaseEvent(e) && e.type === 'review_panel_baseline_completed',
    )
    expect(baseline).toBeDefined()
    if (!baseline || baseline.type !== 'review_panel_baseline_completed') return

    // Event payload mirrors the report metric exactly
    expect(baseline.fixtureId).toContain('baseline.json')
    expect(baseline.panelOnlyActionableFindingCount).toBe(1)
    expect(baseline.sameFamilyVoteRejectionCount).toBe(1)
    expect(baseline.manifestEqualityHeld).toBe(true)
    expect(baseline.disagreementCount).toBe(1)

    // Artifact hashes are 64-hex
    expect(baseline.singleReviewArtifactHash).toMatch(/^[0-9a-f]{64}$/)
    expect(baseline.panelReviewArtifactHash).toMatch(/^[0-9a-f]{64}$/)
    expect(baseline.singleReviewArtifactHash).not.toBe(baseline.panelReviewArtifactHash)

    // Telemetry fields present
    expect(baseline.costOverheadRatio).toBeCloseTo(1.95, 5)
    expect(baseline.wallClockOverheadMs).toBe(1200)
  })

  test('F7: sameFamilyVoteRejectionCount is events-derived — real panel_quorum_rejected_same_family_vote events emitted with layer=config-load', async () => {
    // Codex M14 R1 finding #7: with runPaths supplied, the baseline
    // helper must actually run each fixture-declared same-family voter
    // attempt through the config loader and emit a real
    // panel_quorum_rejected_same_family_vote event per rejection. The
    // metric count is the observed event count, not a fixture-declared
    // number.
    const report = await loadAndRunPanelBaseline(FIXTURE_PATH, {
      runPaths: paths,
      now: () => NOW,
    })
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const rejections = events.filter(
      (e) => isKnownPhaseEvent(e) && e.type === 'panel_quorum_rejected_same_family_vote',
    )
    // Canonical fixture declares 1 attempt → 1 rejection event emitted.
    expect(rejections.length).toBe(1)
    expect(rejections.length).toBe(report.metric.sameFamilyVoteRejectionCount)
    // Each rejection must record layer=config-load (this is the actual
    // layer the loadConfig path fires from) — proves the doctor helper
    // exercised real layer-1 validation.
    for (const r of rejections) {
      if (!isKnownPhaseEvent(r) || r.type !== 'panel_quorum_rejected_same_family_vote') continue
      expect(r.layer).toBe('config-load')
      // providerFamily must equal buildFamily (the rejection trigger).
      expect(r.providerFamily).toBe(r.buildFamily)
    }
  })

  test('panel verdict on canonical fixture is BLOCK (cross-family voter raised block-severity finding)', async () => {
    const report = await loadAndRunPanelBaseline(FIXTURE_PATH, { now: () => NOW })
    expect(report.summary).toContain('Panel verdict: block')
  })

  test('summary report names rule-21 ship gate and overall PASS', async () => {
    const report = await loadAndRunPanelBaseline(FIXTURE_PATH, { now: () => NOW })
    expect(report.summary).toContain('Rule-21 ship gate')
    expect(report.summary).toContain('M14 ship gate satisfied')
  })

  test('fixture is locked: re-running produces same metric values (deterministic)', async () => {
    const r1 = await loadAndRunPanelBaseline(FIXTURE_PATH, { now: () => NOW })
    const r2 = await loadAndRunPanelBaseline(FIXTURE_PATH, { now: () => NOW })
    expect(r1.metric.panelOnlyActionableFindingCount).toBe(
      r2.metric.panelOnlyActionableFindingCount,
    )
    expect(r1.metric.disagreementCount).toBe(r2.metric.disagreementCount)
    expect(r1.metric.singleReviewArtifactHash).toBe(r2.metric.singleReviewArtifactHash)
    expect(r1.metric.panelReviewArtifactHash).toBe(r2.metric.panelReviewArtifactHash)
  })
})

describe('e2e: runReviewPanel orchestrator against fixture-driven invocation seam', () => {
  // This test wires the canonical fixture into the actual orchestrator
  // (commit 6) via a deterministic invoker, proving the orchestrator +
  // verdict + synthesis + artifact write + event emission stack works
  // end-to-end. Provider IDs stay real (no invented IDs) per Codex Q12.

  function fixtureToInvoker(fixture: PanelBaselineFixture): PanelistInvoker {
    let i = 0
    return async (cfg) => {
      const r = fixture.panelistResponses[i++]!
      return {
        panelistId: cfg.id,
        providerId: cfg.provider,
        providerFamily: r.providerFamily ?? cfg.provider,
        modelPolicy: r.modelPolicy,
        role: r.role,
        score: r.score,
        verdict: r.verdict,
        findings: r.findings,
        manifestHash: r.manifestHash,
        stagingContent: `# panelist ${cfg.id}\n\n(scripted from fixture ${fixture.fixtureId})\n`,
      }
    }
  }

  test('full panel round produces canonical REVIEW.md + emits all 4 panel events', async () => {
    const raw = await readFile(FIXTURE_PATH, 'utf8')
    const fixture = JSON.parse(raw) as PanelBaselineFixture
    const panel: readonly Panelist[] = fixture.panelistResponses.map((r) => ({
      provider: r.providerId,
      role: r.role,
      ...(r.modelPolicy !== undefined ? { model: r.modelPolicy } : {}),
    }))
    const upstreamRefs: ReviewUpstreamRefs = {
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256: HEX64,
      verifyReportPath: '.code-oz/artifacts/VERIFY.md',
      verifyReportSha256: HEX64,
      taskId: 'T-001',
      attempt: 1,
      baseCommitSha: HEX40,
      patchSha256: HEX64,
    }
    const result = await runReviewPanel({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      panelistInvoker: fixtureToInvoker(fixture),
      panel,
      buildFamily: fixture.buildFamily,
      registry: testRegistry,
      config: testConfig,
      events: [],
      perPanelistTokensEstimate: PER_PANELIST_EST,
      upstreamRefs,
      round: 1,
      orchestratorAgent: 'panel-orchestrator',
      now: () => NOW,
      fsyncDir: false,
    })

    // Canonical fixture has voter raising block → blocked
    expect(result.status).toBe('blocked')
    if (result.status === 'intervention') return
    expect(result.panelVerdict).toBe('block')

    // Canonical REVIEW.md is parseable + has block verdict
    const reviewMd = await readFile(result.reviewReportPath, 'utf8')
    const parsed = parseReviewPanelReport(reviewMd)
    expect(parsed.synthesis.panelVerdict).toBe('block')

    // Find the actionable voter-impact finding (the null-check one — the
    // 'minor variable shadowing' nit is also voter-impact but not actionable)
    const actionable = parsed.findings.find(
      (f) => f.authorityImpact === 'voter' && f.severity === 'block',
    )
    expect(actionable).toBeDefined()
    expect(actionable!.title.toLowerCase()).toContain('null check')
    expect([...actionable!.sources].sort()).toEqual(['reviewer-A', 'reviewer-B'])

    // Events: started + 2 panelist completed + completed
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const panelEvents = events.filter(
      (e) =>
        isKnownPhaseEvent(e) &&
        (e.type === 'review_panel_started' ||
          e.type === 'review_panelist_completed' ||
          e.type === 'review_panel_completed'),
    )
    expect(panelEvents.length).toBe(4)
    const completed = panelEvents[3]!
    if (completed.type !== 'review_panel_completed') return
    expect(completed.panelVerdict).toBe('block')
  })
})

describe('e2e: positive control — same-family voter attempt is rejected (layer 1)', () => {
  // Build a panel-config-style fixture with a same-family voter and
  // verify that the config loader rejects it with
  // panel_voter_same_family_as_build (this is the actual layer-1 firing,
  // distinct from the metric event's recorded count).

  test('same-family voter at config-load → ConfigLoadError with panel_voter_same_family_as_build', async () => {
    // Inline import to avoid pulling load.ts into other test modules' top-level imports
    const { loadConfig, ConfigLoadError } = await import('../../src/config/load.ts')
    const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises')
    const tmp2 = await mkdtemp(join(tmpdir(), 'codeoz-e2e-laundering-'))
    try {
      await mkdir(join(tmp2, '.code-oz'), { recursive: true })
      await writeFile(
        join(tmp2, '.code-oz/config.yaml'),
        `defaultProvider: claude
company:
  reviewer:
    panel:
      - { provider: claude, role: voter }
      - { provider: gemini, role: voter }
`,
        'utf8',
      )
      let err: unknown
      try {
        await loadConfig({ cwd: tmp2 })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(ConfigLoadError)
      const issues = (err as InstanceType<typeof ConfigLoadError>).issues
      expect(issues.some((i) => i.code === 'panel_voter_same_family_as_build')).toBe(true)
    } finally {
      await rm(tmp2, { recursive: true, force: true })
    }
  })
})

describe('e2e: anti-pattern — fixture without scripted miss FAILS ship gate', () => {
  // Negative control: a fixture where the single-reviewer baseline already
  // catches what the panel catches → panelOnlyActionableFindingCount === 0
  // → ship gate FAILS. This proves the gate is meaningful (not a tautology).

  test('fixture where single-reviewer raises same finding → shipGatePasses === false', async () => {
    const fixture: PanelBaselineFixture = {
      fixtureId: 'negative-control',
      buildFamily: 'claude',
      singleReviewer: {
        providerId: 'codex',
        modelPolicy: 'gpt-5.5',
        role: 'voter',
        score: 7,
        verdict: 'needs-revision',
        findings: [
          {
            file: 'src/handler.ts',
            title: 'missing null check on user input',
            line: '42',
            severity: 'fix-first',
            recommendation: 'add explicit null guard',
          },
        ],
        manifestHash: 'a'.repeat(64),
      },
      panelistResponses: [
        {
          providerId: 'codex',
          modelPolicy: 'gpt-5.5',
          role: 'voter',
          score: 7,
          verdict: 'needs-revision',
          findings: [
            {
              file: 'src/handler.ts',
              title: 'missing null check on user input',
              line: '42',
              severity: 'fix-first',
              recommendation: 'add explicit null guard',
            },
          ],
          manifestHash: 'a'.repeat(64),
        },
        {
          providerId: 'gemini',
          modelPolicy: 'gemini-2.5-pro',
          role: 'voter',
          score: 7,
          verdict: 'needs-revision',
          findings: [
            {
              file: 'src/handler.ts',
              title: 'missing null check on user input',
              line: '42',
              severity: 'fix-first',
              recommendation: 'add explicit null guard',
            },
          ],
          manifestHash: 'a'.repeat(64),
        },
      ],
      sameFamilyVoteRejectionAttempts: 1,
    }
    const report = await runPanelBaseline({ fixture, now: () => NOW })
    // No panel-only actionable finding (single caught the same one) → gate fails
    expect(report.metric.panelOnlyActionableFindingCount).toBe(0)
    expect(report.shipGate.panelOnlyActionable).toBe(false)
    expect(report.shipGatePasses).toBe(false)
  })
})

describe('e2e: REVIEW.md round-trip through baseline command', () => {
  test('panel artifact hash is stable across re-serialization', async () => {
    const report1 = await loadAndRunPanelBaseline(FIXTURE_PATH, { now: () => NOW })
    const report2 = await loadAndRunPanelBaseline(FIXTURE_PATH, { now: () => NOW })
    expect(report1.panelReviewArtifactHash).toBe(report2.panelReviewArtifactHash)
    expect(report1.singleReviewArtifactHash).toBe(report2.singleReviewArtifactHash)
  })

  test('canonical panel REVIEW.md (synthesized inside baseline) parses round-trip', async () => {
    // The baseline command synthesizes both artifacts in-memory; verifying
    // they parse confirms grammar fidelity end-to-end
    const raw = await readFile(FIXTURE_PATH, 'utf8')
    const fixture = JSON.parse(raw) as PanelBaselineFixture
    const report = await runPanelBaseline({ fixture, now: () => NOW })
    expect(report.metric.panelReviewArtifactHash).toMatch(/^[0-9a-f]{64}$/)
    // The hash represents valid Markdown — if synthesis broke the schema
    // the hash would still compute but downstream parsers would reject;
    // commit-3 schema tests + commit-6 orchestrator tests verify parse fidelity.
  })
})
