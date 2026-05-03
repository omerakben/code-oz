// M14 commit 8: doctor --panel-baseline command — rule-21 ship-gate
// metric event emission.
//
// Per Codex pushback Q8: rule-21 ship gate requires
//   panelOnlyActionableFindingCount > 0
//   sameFamilyVoteRejectionCount >= 1
//   manifestEqualityHeld === true
//   disagreementCount >= 1
// All four must hold for M14 to ship.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runPanelBaseline,
  loadAndRunPanelBaseline,
  type PanelBaselineFixture,
  type PanelistResponse,
} from '../src/commands/doctor-panel-baseline.ts'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { readEvents } from '../src/state/events.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const NOW = '2026-05-03T01:23:45.000Z'
const MANIFEST_HASH = 'a'.repeat(64)

let tmp: string
let paths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-baseline-'))
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

function panelistResp(overrides: Partial<PanelistResponse> = {}): PanelistResponse {
  return {
    providerId: overrides.providerId ?? 'codex',
    ...(overrides.providerFamily !== undefined ? { providerFamily: overrides.providerFamily } : {}),
    modelPolicy: overrides.modelPolicy ?? 'gpt-5.5',
    role: overrides.role ?? 'voter',
    score: overrides.score ?? 8,
    verdict: overrides.verdict ?? 'ready',
    findings: overrides.findings ?? [],
    manifestHash: overrides.manifestHash ?? MANIFEST_HASH,
  }
}

// Fixture that satisfies all four ship-gate thresholds.
function shipGateSatisfyingFixture(): PanelBaselineFixture {
  return Object.freeze({
    fixtureId: 'satisfying-fixture',
    buildFamily: 'claude',
    // Single-mode: no findings (the baseline that misses a real bug).
    singleReviewer: panelistResp({ providerId: 'codex', findings: [] }),
    // Panel-mode:
    //   - reviewer-A (codex voter): raises a fix-first finding the
    //     single-reviewer baseline missed → panelOnlyActionableFindingCount > 0
    //   - reviewer-B (gemini voter): raises the same finding with a
    //     DIFFERENT severity (block) → disagreementCount >= 1
    panelistResponses: [
      panelistResp({
        providerId: 'codex',
        role: 'voter',
        findings: [
          { file: 'src/x.ts', title: 'missing null check', line: '42', severity: 'fix-first', recommendation: 'guard' },
        ],
      }),
      panelistResp({
        providerId: 'gemini',
        role: 'voter',
        findings: [
          { file: 'src/x.ts', title: 'missing null check', line: '42', severity: 'block', recommendation: 'guard' },
        ],
      }),
    ],
    // Positive control: 1 same-family vote attempt was rejected at config-load
    sameFamilyVoteRejectionAttempts: 1,
  })
}

describe('runPanelBaseline — happy paths', () => {
  test('returns metric payload with all required fields', async () => {
    const report = await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      now: () => NOW,
    })
    expect(report.metric.fixtureId).toBe('satisfying-fixture')
    expect(report.metric.singleRunId).toBeDefined()
    expect(report.metric.panelRunId).toBeDefined()
    expect(report.metric.singleReviewArtifactHash).toMatch(/^[0-9a-f]{64}$/)
    expect(report.metric.panelReviewArtifactHash).toMatch(/^[0-9a-f]{64}$/)
    expect(report.metric.singleReviewArtifactHash).not.toBe(report.metric.panelReviewArtifactHash)
  })

  test('panelOnlyActionableFindingCount > 0 when panel raises fix-first single missed', async () => {
    const report = await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      now: () => NOW,
    })
    expect(report.metric.panelOnlyActionableFindingCount).toBeGreaterThan(0)
  })

  test('disagreementCount >= 1 when panelists disagree on severity', async () => {
    const report = await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      now: () => NOW,
    })
    expect(report.metric.disagreementCount).toBeGreaterThanOrEqual(1)
  })

  test('sameFamilyVoteRejectionCount comes from fixture', async () => {
    const report = await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      now: () => NOW,
    })
    expect(report.metric.sameFamilyVoteRejectionCount).toBe(1)
  })

  test('manifestEqualityHeld === true when all panelists share manifest hash', async () => {
    const report = await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      now: () => NOW,
    })
    expect(report.metric.manifestEqualityHeld).toBe(true)
  })

  test('manifestEqualityHeld === false when panelists have different manifest hashes', async () => {
    const fixture: PanelBaselineFixture = {
      ...shipGateSatisfyingFixture(),
      panelistResponses: [
        panelistResp({ providerId: 'codex', manifestHash: 'a'.repeat(64) }),
        panelistResp({ providerId: 'gemini', manifestHash: 'b'.repeat(64) }),
      ],
    }
    const report = await runPanelBaseline({ fixture, now: () => NOW })
    expect(report.metric.manifestEqualityHeld).toBe(false)
  })

  test('shipGate breakdown reflects each threshold', async () => {
    const report = await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      now: () => NOW,
    })
    expect(report.shipGate.panelOnlyActionable).toBe(true)
    expect(report.shipGate.sameFamilyVoteRejection).toBe(true)
    expect(report.shipGate.manifestEquality).toBe(true)
    expect(report.shipGate.disagreement).toBe(true)
    expect(report.shipGatePasses).toBe(true)
  })

  test('summary contains rule-21 ship gate breakdown', async () => {
    const report = await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      now: () => NOW,
    })
    expect(report.summary).toContain('Rule-21 ship gate')
    expect(report.summary).toContain('PASS')
    expect(report.summary).toContain('M14 ship gate satisfied')
  })

  test('emits review_panel_baseline_completed event when runPaths provided', async () => {
    await runPanelBaseline({
      fixture: shipGateSatisfyingFixture(),
      runPaths: paths,
      now: () => NOW,
    })
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const baselineEvent = events.find(
      (e) => isKnownPhaseEvent(e) && e.type === 'review_panel_baseline_completed',
    )
    expect(baselineEvent).toBeDefined()
    if (baselineEvent === undefined) return
    if (baselineEvent.type !== 'review_panel_baseline_completed') return
    expect(baselineEvent.fixtureId).toBe('satisfying-fixture')
    expect(baselineEvent.panelOnlyActionableFindingCount).toBeGreaterThan(0)
    expect(baselineEvent.manifestEqualityHeld).toBe(true)
  })
})

describe('runPanelBaseline — ship gate failures (rule-21 negative cases)', () => {
  test('shipGatePasses === false when panelOnlyActionableFindingCount = 0', async () => {
    // Single-reviewer raises the same finding panel raises → no panel-only
    const fixture: PanelBaselineFixture = {
      fixtureId: 'no-panel-only-actionable',
      buildFamily: 'claude',
      singleReviewer: panelistResp({
        providerId: 'codex',
        findings: [
          { file: 'src/x.ts', title: 'bug', line: '1', severity: 'fix-first', recommendation: 'fix' },
        ],
      }),
      panelistResponses: [
        panelistResp({
          providerId: 'codex',
          role: 'voter',
          findings: [
            { file: 'src/x.ts', title: 'bug', line: '1', severity: 'fix-first', recommendation: 'fix' },
          ],
        }),
        panelistResp({ providerId: 'gemini', role: 'voter', findings: [] }),
      ],
      sameFamilyVoteRejectionAttempts: 1,
    }
    const report = await runPanelBaseline({ fixture, now: () => NOW })
    expect(report.shipGate.panelOnlyActionable).toBe(false)
    expect(report.shipGatePasses).toBe(false)
    expect(report.summary).toContain('M14 cannot ship')
  })

  test('shipGatePasses === false when sameFamilyVoteRejectionCount = 0', async () => {
    const fixture: PanelBaselineFixture = {
      ...shipGateSatisfyingFixture(),
      sameFamilyVoteRejectionAttempts: 0,
    }
    const report = await runPanelBaseline({ fixture, now: () => NOW })
    expect(report.shipGate.sameFamilyVoteRejection).toBe(false)
    expect(report.shipGatePasses).toBe(false)
  })

  test('shipGatePasses === false when manifest equality fails', async () => {
    const fixture: PanelBaselineFixture = {
      ...shipGateSatisfyingFixture(),
      panelistResponses: [
        panelistResp({
          providerId: 'codex',
          role: 'voter',
          findings: [
            { file: 'src/x.ts', title: 'panel-only', line: '1', severity: 'fix-first', recommendation: 'fix' },
          ],
          manifestHash: 'a'.repeat(64),
        }),
        panelistResp({
          providerId: 'gemini',
          role: 'voter',
          findings: [
            { file: 'src/x.ts', title: 'panel-only', line: '1', severity: 'block', recommendation: 'fix' },
          ],
          manifestHash: 'b'.repeat(64),
        }),
      ],
    }
    const report = await runPanelBaseline({ fixture, now: () => NOW })
    expect(report.shipGate.manifestEquality).toBe(false)
    expect(report.shipGatePasses).toBe(false)
  })
})

describe('loadAndRunPanelBaseline — JSON file ingestion', () => {
  test('loads JSON fixture from disk + runs baseline', async () => {
    const fixturePath = join(tmp, 'fixture.json')
    await writeFile(fixturePath, JSON.stringify(shipGateSatisfyingFixture()), 'utf8')
    const report = await loadAndRunPanelBaseline(fixturePath, { now: () => NOW })
    expect(report.shipGatePasses).toBe(true)
  })

  test('rejects malformed JSON', async () => {
    const fixturePath = join(tmp, 'malformed.json')
    await writeFile(fixturePath, '{not valid json', 'utf8')
    await expect(loadAndRunPanelBaseline(fixturePath)).rejects.toThrow(
      /not valid JSON/,
    )
  })

  test('rejects fixture with missing buildFamily', async () => {
    const fixturePath = join(tmp, 'incomplete.json')
    await writeFile(
      fixturePath,
      JSON.stringify({
        fixtureId: 'incomplete',
        singleReviewer: {},
        panelistResponses: [{}, {}],
      }),
      'utf8',
    )
    await expect(loadAndRunPanelBaseline(fixturePath)).rejects.toThrow(
      /buildFamily must be a non-empty string/,
    )
  })

  test('rejects fixture with < 2 panelist responses', async () => {
    const fixturePath = join(tmp, 'too-few.json')
    await writeFile(
      fixturePath,
      JSON.stringify({
        fixtureId: 'too-few',
        buildFamily: 'claude',
        singleReviewer: {},
        panelistResponses: [{}],
      }),
      'utf8',
    )
    await expect(loadAndRunPanelBaseline(fixturePath)).rejects.toThrow(
      /at least 2 entries/,
    )
  })
})
