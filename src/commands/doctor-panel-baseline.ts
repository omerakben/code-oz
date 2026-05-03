// M14 commit 8 — `code-oz doctor --panel-baseline <fixture>` command.
//
// Rule-21 ship-gate metric. Per Codex pushback Q8 + Q11: rule-21
// requires measurable risk reduction in events.jsonl, and the metric
// payload (review_panel_baseline_completed event) is the single source
// of truth for whether M14 actually catches what single-reviewer mode
// misses. Without this command + event, the rule-21 claim is
// unsubstantiated and M14 cannot ship.
//
// The command runs the same fixture in single-reviewer mode then panel
// mode, computes the metric counts (panel-only findings, actionable
// count, disagreement count, same-family-rejection count), and emits
// the review_panel_baseline_completed event. The e2e proof test in
// commit 9 builds the M14 baseline fixture and asserts the ship-gate
// thresholds hold.
//
// Per Codex pushback Q8: ship gate requires
//   panelOnlyActionableFindingCount > 0  (real risk reduction)
//   sameFamilyVoteRejectionCount >= 1    (positive control)
//   manifestEqualityHeld === true         (no context-difference confound)
//   disagreementCount >= 1                (supporting evidence)

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fingerprintFinding,
  serializeReviewPanelReport,
  serializeReviewReport,
  CROSS_FAMILY_CHECK_VOTER,
  CROSS_FAMILY_CHECK_ADVISORY,
  REVIEW_ROUND_CAP,
  type PanelVerdict,
  type PanelistRole,
  type PanelistVerdict,
  type ReviewPanelist,
  type ReviewPanelTimelineEntry,
  type ReviewReportData,
  type ReviewReportPanelData,
  type ReviewSeverity,
  type ReviewSynthesizedFinding,
  type ReviewUpstreamRefs,
} from '../artifacts/review-report.ts'
import {
  computeCanonicalPanelVerdict,
  type PanelistInput,
} from '../phases/review-panel-verdict.ts'
import { appendEvent, readEvents } from '../state/events.ts'
import {
  generateUlid,
  isKnownPhaseEvent,
  type PhaseEvent,
} from '../state/schemas.ts'
import type { ProviderFamily, ProviderId } from '../providers/types.ts'
import type { RunPaths } from '../state/run.ts'
import { familyOf } from '../providers/families.ts'
import { loadConfig, ConfigLoadError } from '../config/load.ts'

// --- fixture types -------------------------------------------------

export interface PanelistResponse {
  readonly providerId: ProviderId
  /** Optional explicit family (defaults to familyOf(providerId)). */
  readonly providerFamily?: ProviderFamily
  readonly modelPolicy: string
  readonly role: PanelistRole
  readonly score: number
  readonly verdict: PanelistVerdict
  readonly findings: readonly { readonly file: string; readonly title: string; readonly line: string; readonly severity: ReviewSeverity; readonly recommendation: string }[]
  readonly manifestHash: string
}

export interface PanelBaselineFixture {
  /** Identifier for this fixture (path or content hash). */
  readonly fixtureId: string
  /** Resolved BUILD family at the time of the baseline. */
  readonly buildFamily: ProviderFamily
  /** The single-reviewer-mode response (the M9 baseline). */
  readonly singleReviewer: PanelistResponse
  /** Panel composition for panel-mode (provider order = panelist order). */
  readonly panelistResponses: readonly PanelistResponse[]
  /**
   * Optional positive-control: a deliberate same-family-voter attempt
   * that should be rejected at config-load. Each entry contributes 1 to
   * sameFamilyVoteRejectionCount. The actual rejection happens in
   * src/config/load.ts (layer 1); this fixture field is the recorded
   * count for the metric event.
   */
  readonly sameFamilyVoteRejectionAttempts?: number
  /** Optional fixture-supplied wall-clock + cost overhead for the
   *  metric payload. v0.1 baselines use synthetic numbers; live
   *  measurement is post-M14. */
  readonly costOverheadRatio?: number
  readonly wallClockOverheadMs?: number
}

export interface PanelBaselineReport {
  readonly fixtureId: string
  readonly singleReviewArtifactHash: string
  readonly panelReviewArtifactHash: string
  /** The full metric payload (matches review_panel_baseline_completed). */
  readonly metric: {
    readonly fixtureId: string
    readonly singleRunId: string
    readonly panelRunId: string
    readonly singleFindingCount: number
    readonly panelFindingCount: number
    readonly panelOnlyFindingCount: number
    readonly panelOnlyActionableFindingCount: number
    readonly disagreementCount: number
    readonly sameFamilyVoteRejectionCount: number
    readonly manifestEqualityHeld: boolean
    readonly singleReviewArtifactHash: string
    readonly panelReviewArtifactHash: string
    readonly costOverheadRatio: number
    readonly wallClockOverheadMs: number
    readonly expectedFindingRecallDelta?: number
  }
  /** Markdown summary; printable to stdout. */
  readonly summary: string
  /** Whether the rule-21 ship gate passes (all 4 thresholds hold). */
  readonly shipGatePasses: boolean
  /** Per-threshold pass/fail breakdown for actionable error reporting. */
  readonly shipGate: {
    readonly panelOnlyActionable: boolean
    readonly sameFamilyVoteRejection: boolean
    readonly manifestEquality: boolean
    readonly disagreement: boolean
  }
}

export interface RunPanelBaselineOptions {
  readonly fixture: PanelBaselineFixture
  /** Optional events.jsonl + lock paths. When present, the baseline
   *  emits a review_panel_baseline_completed event. */
  readonly runPaths?: RunPaths
  readonly now?: () => string
  readonly ulidGen?: () => string
}

const SHA = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const HEX64_ZERO = '0'.repeat(64)
const HEX40_ZERO = '0'.repeat(40)

/**
 * Run one baseline measurement. Returns the metric payload + summary
 * report; optionally appends a review_panel_baseline_completed event
 * to events.jsonl. The function is pure relative to the fixture (same
 * fixture in produces same metric out, modulo run-id generation) so
 * the e2e proof test can assert exact thresholds.
 *
 * Algorithm:
 *   1. Synthesize a single-mode REVIEW.md from fixture.singleReviewer.
 *      Hash it.
 *   2. Build the panel-mode REVIEW.md by:
 *      - calling computeCanonicalPanelVerdict on fixture.panelistResponses
 *      - serializing to canonical REVIEW.md via serializeReviewPanelReport
 *      Hash it.
 *   3. Compute metric counts:
 *      - singleFindingCount = single response findings count
 *      - panelFindingCount = panel synthesized findings count
 *      - panelOnlyFindingCount = panel fingerprints not in single's
 *      - panelOnlyActionableFindingCount = panel-only AND voter impact
 *        AND severity ∈ {block, fix-first}
 *      - disagreementCount = fingerprints where panel sources disagree
 *        on severity, OR some raised + some didn't
 *      - sameFamilyVoteRejectionCount = fixture.sameFamilyVoteRejectionAttempts
 *      - manifestEqualityHeld = all panelist responses share manifestHash
 *   4. Compose report + (if runPaths) emit event.
 */
export async function runPanelBaseline(
  opts: RunPanelBaselineOptions,
): Promise<PanelBaselineReport> {
  const fixture = opts.fixture
  const now = opts.now ?? (() => new Date().toISOString())
  const ulidGen =
    opts.ulidGen ??
    ((): string => generateUlid({ now: Date.now(), random: randomBytes(10) }))

  const singleRunId = ulidGen()
  const panelRunId = ulidGen()
  const ts = now()

  // Build the synthetic upstream refs (shared between single + panel runs).
  const upstreamRefs: ReviewUpstreamRefs = {
    buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
    buildReportSha256: HEX64_ZERO,
    verifyReportPath: '.code-oz/artifacts/VERIFY.md',
    verifyReportSha256: HEX64_ZERO,
    taskId: 'T-001',
    attempt: 1,
    baseCommitSha: HEX40_ZERO,
    patchSha256: HEX64_ZERO,
  }

  // 1. Synthesize single-mode REVIEW.md.
  const singleMd = synthesizeSingleReviewMd(fixture, upstreamRefs, ts)
  const singleReviewArtifactHash = SHA(singleMd)

  // 2. Compute panel-mode synthesized findings + verdict.
  const verdictInputs: PanelistInput[] = fixture.panelistResponses.map((r, i) => ({
    id: `reviewer-${String.fromCharCode('A'.charCodeAt(0) + i)}`,
    providerFamily: r.providerFamily ?? familyOf(r.providerId),
    role: r.role,
    score: r.score,
    verdict: r.verdict,
    findings: r.findings.map((f) => ({ file: f.file, title: f.title, severity: f.severity })),
  }))
  const verdict = computeCanonicalPanelVerdict({
    buildFamily: fixture.buildFamily,
    panelists: verdictInputs,
  })

  // Build canonical panel REVIEW.md.
  const panelMd = synthesizePanelReviewMd({
    fixture,
    upstreamRefs,
    verdictInputs,
    verdict,
    ts,
  })
  const panelReviewArtifactHash = SHA(panelMd)

  // 3. Compute metric counts.
  const singleFingerprints = new Set(
    fixture.singleReviewer.findings.map((f) => fingerprintFinding(f.file, f.title)),
  )
  const singleFindingCount = fixture.singleReviewer.findings.length
  const panelFindingCount = verdict.synthesizedFindings.length

  let panelOnlyFindingCount = 0
  let panelOnlyActionableFindingCount = 0
  for (const f of verdict.synthesizedFindings) {
    if (!singleFingerprints.has(f.fingerprint)) {
      panelOnlyFindingCount++
      if (
        f.authorityImpact === 'voter' &&
        (f.severity === 'block' || f.severity === 'fix-first')
      ) {
        panelOnlyActionableFindingCount++
      }
    }
  }

  // Disagreement: fingerprint where panelists report different severities,
  // OR fingerprint raised by some but not all in the panel that touched
  // the underlying file. Conservative count: only severity disagreements
  // among recorded sources.
  const disagreementCount = countSeverityDisagreements(fixture.panelistResponses)

  // F7 (Codex M14 R1 finding #7): events-derived positive control. When
  // runPaths is supplied, actually run each fixture-declared
  // same-family-voter attempt through the config loader; each rejection
  // emits a real `panel_quorum_rejected_same_family_vote` event. The
  // metric then counts those events from the run-local log, so the
  // value is observed-from-events instead of fixture-declared.
  // Without runPaths (legacy library callers / isolated tests), fall
  // back to the fixture's recorded attempt count and treat it as
  // metadata only — the metric event still records the count, but the
  // doctor CLI path is the only production route, and that path now
  // always passes runPaths.
  let sameFamilyVoteRejectionCount: number
  const rejectionAttempts = fixture.sameFamilyVoteRejectionAttempts ?? 0
  if (opts.runPaths !== undefined && rejectionAttempts > 0) {
    sameFamilyVoteRejectionCount = await emitSameFamilyVoteRejectionEvents({
      runPaths: opts.runPaths,
      panelRunId,
      buildFamily: fixture.buildFamily,
      attempts: rejectionAttempts,
      ts,
    })
  } else {
    sameFamilyVoteRejectionCount = rejectionAttempts
  }

  const firstHash = fixture.panelistResponses[0]?.manifestHash
  const manifestEqualityHeld = fixture.panelistResponses.every(
    (r) => r.manifestHash === firstHash,
  )

  const costOverheadRatio = fixture.costOverheadRatio ?? 1.0
  const wallClockOverheadMs = fixture.wallClockOverheadMs ?? 0

  // 4. Build report + ship-gate breakdown.
  const shipGate = {
    panelOnlyActionable: panelOnlyActionableFindingCount > 0,
    sameFamilyVoteRejection: sameFamilyVoteRejectionCount >= 1,
    manifestEquality: manifestEqualityHeld,
    disagreement: disagreementCount >= 1,
  }
  const shipGatePasses =
    shipGate.panelOnlyActionable &&
    shipGate.sameFamilyVoteRejection &&
    shipGate.manifestEquality &&
    shipGate.disagreement

  const metric = {
    fixtureId: fixture.fixtureId,
    singleRunId,
    panelRunId,
    singleFindingCount,
    panelFindingCount,
    panelOnlyFindingCount,
    panelOnlyActionableFindingCount,
    disagreementCount,
    sameFamilyVoteRejectionCount,
    manifestEqualityHeld,
    singleReviewArtifactHash,
    panelReviewArtifactHash,
    costOverheadRatio,
    wallClockOverheadMs,
  }

  const summary = renderSummary({ metric, shipGate, shipGatePasses, panelVerdict: verdict.panelVerdict })

  // Emit event when runPaths provided.
  if (opts.runPaths !== undefined) {
    const event: PhaseEvent = {
      version: 1,
      type: 'review_panel_baseline_completed',
      ts,
      runId: panelRunId,
      ...metric,
    }
    await appendEvent(
      { file: opts.runPaths.eventsFile, lockDir: opts.runPaths.lockDir },
      event,
    )
  }

  return Object.freeze({
    fixtureId: fixture.fixtureId,
    singleReviewArtifactHash,
    panelReviewArtifactHash,
    metric: Object.freeze(metric),
    summary,
    shipGatePasses,
    shipGate: Object.freeze(shipGate),
  })
}

/**
 * CLI entry: load fixture from disk + run baseline + return report.
 * The CLI wrapper writes the summary to stdout and exits 0/1 based on
 * shipGatePasses. The library entry runPanelBaseline is the testable
 * core; this helper handles I/O.
 */
export async function loadAndRunPanelBaseline(
  fixturePath: string,
  opts: { runPaths?: RunPaths; now?: () => string; ulidGen?: () => string } = {},
): Promise<PanelBaselineReport> {
  const raw = await readFile(fixturePath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`fixture at ${fixturePath} is not valid JSON: ${(err as Error).message}`)
  }
  const fixture = validateFixture(parsed, fixturePath)
  return runPanelBaseline({ fixture, ...opts })
}

// --- helpers -------------------------------------------------------

/**
 * F7 (Codex M14 R1 finding #7): events-derived positive control. For
 * each requested attempt, build a synthetic same-family panel YAML in
 * an ephemeral cwd and run it through `loadConfig`. The loader's layer
 * 1 validation throws ConfigLoadError with a `panel_voter_same_family_as_build`
 * issue; we catch it and emit a real `panel_quorum_rejected_same_family_vote`
 * event into the run-local log. The metric then counts those events.
 *
 * Returns the number of events successfully emitted (which equals
 * `attempts` whenever layer 1 still rejects same-family voters — a real
 * regression in the loader would surface as a count below `attempts`).
 */
async function emitSameFamilyVoteRejectionEvents(args: {
  readonly runPaths: RunPaths
  readonly panelRunId: string
  readonly buildFamily: ProviderFamily
  readonly attempts: number
  readonly ts: string
}): Promise<number> {
  // Pick a same-family voter pair for the build family. v0.1 default
  // mapping has family === id, so the buildFamily string IS the
  // ProviderId we need to use as the voter to force a rejection.
  const sameFamilyProvider = args.buildFamily as ProviderId
  // The other voter must be cross-family so the loader's voter-count
  // rule doesn't fire first; we want the same-family-voter rule to
  // be the failure that fires.
  const crossFamilyProvider: ProviderId =
    sameFamilyProvider === 'gemini' ? 'codex' : 'gemini'

  let emitted = 0
  for (let i = 0; i < args.attempts; i++) {
    const tmp = await mkdtemp(join(tmpdir(), 'codeoz-doctor-rej-'))
    try {
      await mkdir(join(tmp, '.code-oz'), { recursive: true })
      // The config loader's defaultProvider sets the resolved BUILD
      // family that the panel validation cross-checks against. Setting
      // it to args.buildFamily ensures the same-family-voter trigger
      // matches what the M14 fixture is targeting.
      const yaml = `defaultProvider: ${args.buildFamily}
company:
  reviewer:
    panel:
      - { provider: ${sameFamilyProvider}, role: voter }
      - { provider: ${crossFamilyProvider}, role: voter }
`
      await writeFile(join(tmp, '.code-oz/config.yaml'), yaml, 'utf8')
      let rejected = false
      try {
        await loadConfig({ cwd: tmp })
      } catch (err) {
        if (
          err instanceof ConfigLoadError &&
          err.issues.some((iss) => iss.code === 'panel_voter_same_family_as_build')
        ) {
          rejected = true
        } else {
          throw err
        }
      }
      if (!rejected) {
        // Layer 1 did not reject the same-family voter — this is a real
        // regression. Surface it as a typed error so the doctor command
        // exits non-zero rather than silently underreporting.
        throw new Error(
          `doctor --panel-baseline: same-family voter attempt ${i + 1} was NOT rejected by ` +
            `loadConfig (buildFamily=${args.buildFamily}, voter=${sameFamilyProvider}). ` +
            'Layer-1 panel validation may have regressed.',
        )
      }
      const event: PhaseEvent = {
        version: 1,
        type: 'panel_quorum_rejected_same_family_vote',
        ts: args.ts,
        runId: args.panelRunId,
        phase: 'review',
        panelistId: `attempt-${String(i + 1).padStart(2, '0')}`,
        providerId: sameFamilyProvider,
        providerFamily: args.buildFamily,
        buildFamily: args.buildFamily,
        layer: 'config-load',
      }
      await appendEvent(
        { file: args.runPaths.eventsFile, lockDir: args.runPaths.lockDir },
        event,
      )
      emitted++
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }

  // Sanity: read the run-local log and count the events we just
  // emitted, scoped to this panelRunId. The metric value comes from
  // this observed count (NOT from `emitted`), so a downstream caller
  // that bypasses appendEvent would still surface as 0.
  const events = await readEvents({
    file: args.runPaths.eventsFile,
    lockDir: args.runPaths.lockDir,
  })
  let observed = 0
  for (const e of events) {
    if (
      isKnownPhaseEvent(e) &&
      e.type === 'panel_quorum_rejected_same_family_vote' &&
      e.runId === args.panelRunId
    ) {
      observed++
    }
  }
  return observed
}

function synthesizeSingleReviewMd(
  fixture: PanelBaselineFixture,
  upstreamRefs: ReviewUpstreamRefs,
  ts: string,
): string {
  const r = fixture.singleReviewer
  const family = r.providerFamily ?? familyOf(r.providerId)
  const findings = r.findings.map((f, i) => ({
    id: `F-${String(i + 1).padStart(3, '0')}`,
    title: f.title,
    file: f.file,
    line: f.line,
    severity: f.severity,
    recommendation: f.recommendation,
    roundRaised: 1,
    roundResolved: 'unresolved' as const,
  }))
  // Single-mode score / verdict: use the panelist's reported values.
  // For the baseline measurement we don't apply the M9 canonical verdict
  // rule (this is just a synthetic comparison artifact).
  const data: ReviewReportData = {
    upstreamRefs,
    reviewer: {
      providerFamily: family,
      providerId: r.providerId,
      modelPolicy: r.modelPolicy,
      crossFamilyCheck: 'passed',
      buildFamily: fixture.buildFamily,
    },
    roundTimeline: [
      {
        round: 1,
        timestamp: ts,
        findingsRaised: findings.length,
        score: r.score,
        verdict: r.verdict,
      },
    ],
    findings,
    score: {
      roundCount: 1,
      finalScore: r.score,
      finalVerdict: r.verdict,
      exitReason: 'baseline-synthetic single-mode comparison',
    },
    capStatus: { cap: REVIEW_ROUND_CAP, roundsUsed: 1, capExhausted: false },
  }
  return serializeReviewReport(data)
}

function synthesizePanelReviewMd(args: {
  fixture: PanelBaselineFixture
  upstreamRefs: ReviewUpstreamRefs
  verdictInputs: readonly PanelistInput[]
  verdict: ReturnType<typeof computeCanonicalPanelVerdict>
  ts: string
}): string {
  const { fixture, upstreamRefs, verdict, ts } = args

  // Build per-panelist Reviewers blocks.
  const reviewers: ReviewPanelist[] = fixture.panelistResponses.map((r, i) => {
    const id = `reviewer-${String.fromCharCode('A'.charCodeAt(0) + i)}`
    const family = r.providerFamily ?? familyOf(r.providerId)
    return {
      id,
      providerId: r.providerId,
      providerFamily: family,
      modelPolicy: r.modelPolicy,
      role: r.role,
      score: r.score,
      verdict: r.verdict,
      crossFamilyCheck:
        r.role === 'voter' && family !== fixture.buildFamily
          ? CROSS_FAMILY_CHECK_VOTER
          : CROSS_FAMILY_CHECK_ADVISORY,
      buildFamily: fixture.buildFamily,
      manifestHash: r.manifestHash,
    }
  })

  // Look up recommendation + line for each synthesized fingerprint from
  // its first source's response.
  const findingDetails = new Map<string, { rec: string; line: string }>()
  for (const r of fixture.panelistResponses) {
    for (const f of r.findings) {
      const key = fingerprintFinding(f.file, f.title)
      if (!findingDetails.has(key)) {
        findingDetails.set(key, { rec: f.recommendation, line: f.line })
      }
    }
  }

  const synthesized: ReviewSynthesizedFinding[] = verdict.synthesizedFindings.map(
    (f, i) => {
      const detail = findingDetails.get(f.fingerprint) ?? { rec: '(no recommendation)', line: '0' }
      return {
        id: `F-${String(i + 1).padStart(3, '0')}`,
        title: f.title,
        file: f.file,
        line: detail.line,
        severity: f.severity,
        authorityImpact: f.authorityImpact,
        sources: f.sources,
        recommendation: detail.rec,
        roundRaised: 1,
        roundResolved: 'unresolved' as const,
      }
    },
  )

  const timeline: ReviewPanelTimelineEntry[] = [
    {
      round: 1,
      timestamp: ts,
      findingsRaised: synthesized.length,
      panelVerdict: verdict.panelVerdict,
    },
  ]

  const uniqueFindingsByReviewer: Record<string, number> = {}
  for (const r of reviewers) uniqueFindingsByReviewer[r.id] = 0
  for (const f of synthesized) {
    if (f.sources.length === 1) {
      uniqueFindingsByReviewer[f.sources[0]!] = (uniqueFindingsByReviewer[f.sources[0]!] ?? 0) + 1
    }
  }
  const sharedFindings = synthesized.filter((f) => f.sources.length > 1).length

  const data: ReviewReportPanelData = {
    mode: 'panel',
    upstreamRefs,
    reviewers,
    synthesis: {
      panelVerdict: verdict.panelVerdict,
      quorumReason: verdict.quorumReason,
      eligibleVoterFamilies: verdict.eligibleVoterFamilies,
      excludedReviewerIds: verdict.excludedReviewerIds,
      excludedReasons: verdict.excludedReasons,
      uniqueFindingsByReviewer,
      sharedFindings,
    },
    roundTimeline: timeline,
    findings: synthesized,
    score: {
      roundCount: 1,
      finalScore: 'panel',
      finalVerdict: verdict.panelVerdict,
      exitReason: 'baseline-synthetic panel-mode comparison',
    },
    capStatus: { cap: REVIEW_ROUND_CAP, roundsUsed: 1, capExhausted: false },
  }
  return serializeReviewPanelReport(data)
}

function countSeverityDisagreements(
  responses: readonly PanelistResponse[],
): number {
  // For each fingerprint, collect severities from all sources. Disagree
  // if not all the same.
  const map = new Map<string, Set<ReviewSeverity>>()
  for (const r of responses) {
    for (const f of r.findings) {
      const key = fingerprintFinding(f.file, f.title)
      let set = map.get(key)
      if (!set) {
        set = new Set()
        map.set(key, set)
      }
      set.add(f.severity)
    }
  }
  let count = 0
  for (const set of map.values()) {
    if (set.size > 1) count++
  }
  return count
}

function renderSummary(args: {
  metric: PanelBaselineReport['metric']
  shipGate: PanelBaselineReport['shipGate']
  shipGatePasses: boolean
  panelVerdict: PanelVerdict
}): string {
  const m = args.metric
  const lines: string[] = []
  lines.push(`# Panel baseline report — ${m.fixtureId}`)
  lines.push('')
  lines.push(`Panel verdict: ${args.panelVerdict}`)
  lines.push(`Single run id: ${m.singleRunId}`)
  lines.push(`Panel run id: ${m.panelRunId}`)
  lines.push('')
  lines.push('## Findings')
  lines.push(`- Single-reviewer findings: ${m.singleFindingCount}`)
  lines.push(`- Panel findings: ${m.panelFindingCount}`)
  lines.push(`- Panel-only findings: ${m.panelOnlyFindingCount}`)
  lines.push(`- Panel-only ACTIONABLE findings (rule-21 gate): ${m.panelOnlyActionableFindingCount}`)
  lines.push('')
  lines.push('## Cross-family signal')
  lines.push(`- Disagreement count: ${m.disagreementCount}`)
  lines.push(`- Same-family vote rejection count (positive control): ${m.sameFamilyVoteRejectionCount}`)
  lines.push(`- Manifest equality held: ${m.manifestEqualityHeld ? 'yes' : 'NO (panelist context drift)'}`)
  lines.push('')
  lines.push('## Telemetry (non-gating)')
  lines.push(`- Cost overhead ratio: ${m.costOverheadRatio.toFixed(3)}`)
  lines.push(`- Wall-clock overhead ms: ${m.wallClockOverheadMs}`)
  lines.push('')
  lines.push('## Rule-21 ship gate')
  lines.push(`- panelOnlyActionableFindingCount > 0: ${args.shipGate.panelOnlyActionable ? 'PASS' : 'FAIL'}`)
  lines.push(`- sameFamilyVoteRejectionCount >= 1: ${args.shipGate.sameFamilyVoteRejection ? 'PASS' : 'FAIL'}`)
  lines.push(`- manifestEqualityHeld === true: ${args.shipGate.manifestEquality ? 'PASS' : 'FAIL'}`)
  lines.push(`- disagreementCount >= 1: ${args.shipGate.disagreement ? 'PASS' : 'FAIL'}`)
  lines.push('')
  lines.push(`Overall: ${args.shipGatePasses ? 'PASS — M14 ship gate satisfied' : 'FAIL — M14 cannot ship'}`)
  return lines.join('\n')
}

function validateFixture(parsed: unknown, fixturePath: string): PanelBaselineFixture {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`fixture at ${fixturePath} must be a JSON object`)
  }
  const f = parsed as Record<string, unknown>
  const fixtureId = typeof f.fixtureId === 'string' ? f.fixtureId : fixturePath
  if (typeof f.buildFamily !== 'string' || f.buildFamily.length === 0) {
    throw new Error(`fixture.buildFamily must be a non-empty string`)
  }
  if (typeof f.singleReviewer !== 'object' || f.singleReviewer === null) {
    throw new Error(`fixture.singleReviewer must be an object`)
  }
  if (!Array.isArray(f.panelistResponses) || f.panelistResponses.length < 2) {
    throw new Error(`fixture.panelistResponses must be an array with at least 2 entries`)
  }
  return Object.freeze({
    fixtureId,
    buildFamily: f.buildFamily as ProviderFamily,
    singleReviewer: f.singleReviewer as PanelistResponse,
    panelistResponses: f.panelistResponses as readonly PanelistResponse[],
    ...(typeof f.sameFamilyVoteRejectionAttempts === 'number'
      ? { sameFamilyVoteRejectionAttempts: f.sameFamilyVoteRejectionAttempts }
      : {}),
    ...(typeof f.costOverheadRatio === 'number' ? { costOverheadRatio: f.costOverheadRatio } : {}),
    ...(typeof f.wallClockOverheadMs === 'number' ? { wallClockOverheadMs: f.wallClockOverheadMs } : {}),
  })
}
