// M14 commit 6 — runtime panel orchestrator.
//
// Sequential multi-provider Reviewer panel runtime. Each panelist
// produces a per-panelist staging draft; once all complete, the
// orchestrator synthesizes one canonical REVIEW.md via
// computeCanonicalPanelVerdict (commit 5) and writes it atomically.
//
// Per Codex pushbacks (CODEX_RESPONSE_M14.md):
//   Q4 — sequential, not parallel ("simultaneous-provider" = multiple
//        independent provider outputs feed one orchestrator decision,
//        not literal wall-clock concurrency).
//   Q9 — staging files; canonical REVIEW.md only after synthesis (no
//        partial-but-authoritative artifacts).
//   Q12 — manifest equality + routed-provider lineage gating.
//
// Layered relationship (per docs/contracts/REVIEW_PANEL.md
// § "Five-layer defense-in-depth"):
//   - Layer 1 (config-load) + Layer 2 (agent loader) ensure config
//     declares no same-family voters.
//   - Layer 3 (artifact parser) recomputes verdict from REVIEW.md.
//   - Layer 4 (THIS orchestrator) is the runtime authority. It calls
//     computeCanonicalPanelVerdict on resolved providerFamily values
//     from registry.familyOf(), NOT pure familyOf() — runtime
//     resolution honors test seams + future routed-provider lineage.
//   - Layer 5 (event validator) backstop on review_panel_completed.

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  serializeReviewPanelReport,
  type ReviewSynthesizedFinding,
  type ReviewPanelist,
  type ReviewPanelTimelineEntry,
  type ReviewSeverity,
  type ReviewUpstreamRefs,
  CROSS_FAMILY_CHECK_VOTER,
  CROSS_FAMILY_CHECK_ADVISORY,
  REVIEW_ROUND_CAP,
} from '../artifacts/review-report.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import {
  computeCanonicalPanelVerdict,
  type PanelistInput,
} from './review-panel-verdict.ts'
import type { Panelist, CompanyConfig } from '../config/schema.ts'
import type { ProviderId, ProviderFamily } from '../providers/types.ts'
import type { RunPaths } from '../state/run.ts'
import { appendEvent } from '../state/events.ts'
import type { PhaseEvent } from '../state/schemas.ts'

// --- public types --------------------------------------------------

export interface PanelistInvocationResult {
  /** The panelist id (matches panel config id; usually `reviewer-A`, etc.). */
  readonly panelistId: string
  /** The actual ProviderId the panelist invoked under. */
  readonly providerId: ProviderId
  /** Resolved provider family at invocation time (from registry.familyOf,
   *  honors test seams + future routed-provider lineage). MUST be the value
   *  the orchestrator passes to the canonical verdict computation. */
  readonly providerFamily: ProviderFamily
  /** Model policy / model id used for this panelist. */
  readonly modelPolicy: string
  /** Voter or advisory; mirrors panel config role. */
  readonly role: 'voter' | 'advisory'
  /** Persona-authored score, 0..10. */
  readonly score: number
  /** Persona-authored self-verdict. Orchestrator computes the canonical
   *  panel verdict separately. */
  readonly verdict: 'ready' | 'needs-revision' | 'block'
  /** Findings raised by this panelist. */
  readonly findings: readonly {
    readonly file: string
    readonly line: string
    readonly title: string
    readonly severity: ReviewSeverity
    readonly recommendation: string
  }[]
  /** sha256 of the canonical PreparedProviderRequest.files manifest the
   *  panelist saw. Used for the manifest equality invariant: all panelists
   *  in the same round must report the same hash. */
  readonly manifestHash: string
  /** Full Markdown text of the per-panelist staging draft to be written
   *  atomically to state/review-panel/round-N/panelist-<id>.md. */
  readonly stagingContent: string
}

export type PanelistInvoker = (
  panelistConfig: {
    readonly id: string
    readonly provider: ProviderId
    readonly role: 'voter' | 'advisory'
    readonly model?: string
  },
  round: number,
) => Promise<PanelistInvocationResult>

export interface RunReviewPanelOptions {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly cwd: string
  /** Per-panelist invocation seam. The orchestrator calls this for each
   *  configured panelist in declaration order. */
  readonly panelistInvoker: PanelistInvoker
  /** Panel composition (from `company.reviewer.panel`). */
  readonly panel: readonly Panelist[]
  /** Resolved BUILD family (from build_provider_recorded or registry). */
  readonly buildFamily: ProviderFamily
  /** Upstream refs (paths + sha256s + task + attempt + commit + patch). */
  readonly upstreamRefs: ReviewUpstreamRefs
  /** REVIEW round being driven (1..4). */
  readonly round: number
  /** Orchestrator agent name (the panel runner; not a panelist persona).
   *  Used for event.agent field. */
  readonly orchestratorAgent: string
  readonly now?: () => string
  /** Test seam: skip directory fsync (sandboxes that forbid opendir). */
  readonly fsyncDir?: boolean
}

export type RunReviewPanelStatus = 'resolved' | 'needs_revision' | 'blocked' | 'intervention'

export interface RunReviewPanelOk {
  readonly status: 'resolved' | 'needs_revision' | 'blocked'
  readonly panelVerdict: 'ready' | 'needs-revision' | 'block'
  readonly reviewReportPath: string
  readonly reviewReportSha256: string
  readonly stagingPaths: readonly string[]
  readonly round: number
  readonly quorumReason: string
}

export interface RunReviewPanelIntervention {
  readonly status: 'intervention'
  readonly code: string
  readonly rule: string
  readonly detail?: string
}

export type RunReviewPanelResult = RunReviewPanelOk | RunReviewPanelIntervention

const SHA = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

// --- dispatch helper -----------------------------------------------

/** Returns true when the company config declares a panel with at least
 *  two panelists (i.e., panel mode should be used in place of M9 single-
 *  reviewer mode). The single-reviewer fallback is ANY panel.length < 2,
 *  including absent / undefined panel. */
export function shouldUseReviewPanel(company: CompanyConfig | undefined): boolean {
  const panel = company?.reviewer?.panel
  if (panel === undefined) return false
  return panel.length >= 2
}

// --- main orchestrator ---------------------------------------------

/** Run one panel round. Sequential per-panelist invocation; per-panelist
 *  staging draft written atomically + review_panelist_completed event;
 *  manifest equality enforced; canonical REVIEW.md atomic-write only after
 *  synthesis; review_panel_completed event with canonical panel verdict.
 *
 *  Returns intervention when:
 *    - Round number is out of range
 *    - Panel size violates v0.1 invariants (handled in commit 2 at config
 *      load, but defended here too)
 *    - A panelist invocation throws
 *    - Manifest equality is violated across panelists
 *    - Atomic write fails for staging or canonical
 */
export async function runReviewPanel(
  opts: RunReviewPanelOptions,
): Promise<RunReviewPanelResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  if (
    !Number.isInteger(opts.round) ||
    opts.round < 1 ||
    opts.round > REVIEW_ROUND_CAP
  ) {
    return {
      status: 'intervention',
      code: 'review_round_out_of_range',
      rule: `RunReviewPanelOptions.round must be an integer in [1, ${REVIEW_ROUND_CAP}], got ${opts.round}`,
    }
  }

  if (opts.panel.length < 2) {
    return {
      status: 'intervention',
      code: 'panel_voter_count_invalid',
      rule:
        'runReviewPanel: panel must have at least 2 entries (M14 fixed-quorum)',
      detail: `got panel.length=${opts.panel.length}`,
    }
  }
  const voterCount = opts.panel.filter((p) => p.role === 'voter').length
  if (voterCount !== 2) {
    return {
      status: 'intervention',
      code: 'panel_voter_count_invalid',
      rule:
        'runReviewPanel: panel must have exactly 2 voters (M14 fixed-quorum)',
      detail: `got ${voterCount} voter${voterCount === 1 ? '' : 's'}`,
    }
  }

  // Emit review_panel_started.
  await emitEvent(opts, {
    version: 1,
    type: 'review_panel_started',
    ts: now(),
    runId: opts.runId,
    phase: 'review',
    agent: opts.orchestratorAgent,
    attempt: opts.upstreamRefs.attempt,
    taskId: opts.upstreamRefs.taskId,
    panelComposition: opts.panel.map((p, i) => ({
      id: panelistIdFor(p, i),
      providerId: p.provider,
      // Note: composition uses the pure family — runtime registry resolution
      // happens at panelistInvoker invocation. The composition event records
      // declared family; per-panelist completed events record resolved family.
      providerFamily: p.provider, // Pre-runtime; family === id in v0.1 default mapping
      role: p.role,
    })),
    buildFamily: opts.buildFamily,
  })

  // 1. Sequential per-panelist invocation + staging writes.
  const stagingDir = join(opts.runPaths.runDir, 'review-panel', `round-${opts.round}`)
  await mkdir(stagingDir, { recursive: true })

  const invocations: PanelistInvocationResult[] = []
  const stagingPaths: string[] = []
  let manifestHash: string | null = null

  for (let i = 0; i < opts.panel.length; i++) {
    const cfg = opts.panel[i]!
    const id = panelistIdFor(cfg, i)
    let result: PanelistInvocationResult
    try {
      result = await opts.panelistInvoker(
        {
          id,
          provider: cfg.provider as ProviderId,
          role: cfg.role,
          ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        },
        opts.round,
      )
    } catch (err) {
      return {
        status: 'intervention',
        code: 'panel_invocation_failed',
        rule: `panelist '${id}' invocation threw`,
        detail: err instanceof Error ? err.message : String(err),
      }
    }

    // Manifest equality invariant.
    if (manifestHash === null) {
      manifestHash = result.manifestHash
    } else if (result.manifestHash !== manifestHash) {
      return {
        status: 'intervention',
        code: 'review_panelist_manifest_mismatch',
        rule:
          'runReviewPanel: all panelists in the same round must share the same manifest hash ' +
          '(M14 manifest equality invariant; REVIEW_PANEL.md § "Manifest equality invariant")',
        detail: `panelist '${id}' manifest=${result.manifestHash} differs from prior=${manifestHash}`,
      }
    }

    // Atomic-write staging draft.
    const stagingPath = join(stagingDir, `panelist-${id}.md`)
    await atomicWriteFile(stagingPath, result.stagingContent, {
      ...(opts.fsyncDir !== undefined ? { fsyncDir: opts.fsyncDir } : {}),
    })
    stagingPaths.push(stagingPath)

    // Emit review_panelist_completed.
    await emitEvent(opts, {
      version: 1,
      type: 'review_panelist_completed',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.orchestratorAgent,
      attempt: opts.upstreamRefs.attempt,
      taskId: opts.upstreamRefs.taskId,
      round: opts.round,
      panelistId: id,
      providerId: result.providerId,
      providerFamily: result.providerFamily,
      modelPolicy: result.modelPolicy,
      role: result.role,
      score: result.score,
      verdict: result.verdict,
      manifestHash: result.manifestHash,
      stagingPath,
      stagingSha256: SHA(result.stagingContent),
    })

    invocations.push(result)
  }

  // 2. Canonical verdict computation (layer 4 of defense-in-depth).
  const verdictInputs: PanelistInput[] = invocations.map((inv) => ({
    id: inv.panelistId,
    providerFamily: inv.providerFamily,
    role: inv.role,
    score: inv.score,
    verdict: inv.verdict,
    findings: inv.findings.map((f) => ({
      file: f.file,
      title: f.title,
      severity: f.severity,
    })),
  }))
  const verdict = computeCanonicalPanelVerdict({
    buildFamily: opts.buildFamily,
    panelists: verdictInputs,
  })

  // 3. Build canonical REVIEW.md.
  const reviewers: ReviewPanelist[] = invocations.map((inv) => ({
    id: inv.panelistId,
    providerId: inv.providerId,
    providerFamily: inv.providerFamily,
    modelPolicy: inv.modelPolicy,
    role: inv.role,
    score: inv.score,
    verdict: inv.verdict,
    crossFamilyCheck:
      inv.role === 'voter' && inv.providerFamily !== opts.buildFamily
        ? CROSS_FAMILY_CHECK_VOTER
        : CROSS_FAMILY_CHECK_ADVISORY,
    buildFamily: opts.buildFamily,
    manifestHash: inv.manifestHash,
  }))

  // Synthesize findings: assign F-NNN ids, look up recommendation + line
  // from the source panelist's first occurrence of the fingerprint.
  const findingMap = new Map<string, { rec: string; line: string; roundResolved: number | 'unresolved' }>()
  for (const inv of invocations) {
    for (const f of inv.findings) {
      const key = fingerprintLocal(f.file, f.title)
      if (!findingMap.has(key)) {
        findingMap.set(key, { rec: f.recommendation, line: f.line, roundResolved: 'unresolved' })
      }
    }
  }
  const synthesizedFindings: ReviewSynthesizedFinding[] = verdict.synthesizedFindings.map(
    (f, i) => {
      const detail = findingMap.get(f.fingerprint) ?? { rec: '(no recommendation)', line: '0', roundResolved: 'unresolved' as const }
      return {
        id: `F-${String(i + 1).padStart(3, '0')}`,
        title: f.title,
        file: f.file,
        line: detail.line,
        severity: f.severity,
        authorityImpact: f.authorityImpact,
        sources: f.sources,
        recommendation: detail.rec,
        roundRaised: opts.round,
        roundResolved: detail.roundResolved,
      }
    },
  )

  const timeline: ReviewPanelTimelineEntry[] = [
    {
      round: opts.round,
      timestamp: now(),
      findingsRaised: synthesizedFindings.length,
      panelVerdict: verdict.panelVerdict,
    },
  ]

  const uniqueFindingsByReviewer: Record<string, number> = {}
  for (const inv of invocations) uniqueFindingsByReviewer[inv.panelistId] = 0
  for (const f of synthesizedFindings) {
    if (f.sources.length === 1) {
      uniqueFindingsByReviewer[f.sources[0]!] = (uniqueFindingsByReviewer[f.sources[0]!] ?? 0) + 1
    }
  }
  const sharedFindings = synthesizedFindings.filter((f) => f.sources.length > 1).length

  const canonicalReviewMd = serializeReviewPanelReport({
    mode: 'panel',
    upstreamRefs: opts.upstreamRefs,
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
    findings: synthesizedFindings,
    score: {
      roundCount: opts.round,
      finalScore: 'panel',
      finalVerdict: verdict.panelVerdict,
      exitReason: exitReasonFor(verdict.panelVerdict, verdict.quorumReason),
    },
    capStatus: {
      cap: REVIEW_ROUND_CAP,
      roundsUsed: opts.round,
      capExhausted: opts.round >= REVIEW_ROUND_CAP && verdict.panelVerdict !== 'ready',
    },
  })

  const reviewReportPath = join(opts.runPaths.artifactRoot, 'REVIEW.md')
  const reviewReportSha256 = SHA(canonicalReviewMd)
  await atomicWriteFile(reviewReportPath, canonicalReviewMd, {
    ...(opts.fsyncDir !== undefined ? { fsyncDir: opts.fsyncDir } : {}),
  })

  // Emit review_panel_completed.
  const voterCountFinal = invocations.filter((inv) => inv.role === 'voter').length
  const advisoryCountFinal = invocations.filter((inv) => inv.role === 'advisory').length
  await emitEvent(opts, {
    version: 1,
    type: 'review_panel_completed',
    ts: now(),
    runId: opts.runId,
    phase: 'review',
    agent: opts.orchestratorAgent,
    attempt: opts.upstreamRefs.attempt,
    taskId: opts.upstreamRefs.taskId,
    finalRound: opts.round,
    panelVerdict: verdict.panelVerdict,
    reviewReportSha256,
    eligibleVoterFamilies: verdict.eligibleVoterFamilies,
    panelistCount: invocations.length,
    voterCount: voterCountFinal,
    advisoryCount: advisoryCountFinal,
  })

  return {
    status:
      verdict.panelVerdict === 'ready'
        ? 'resolved'
        : verdict.panelVerdict === 'block'
          ? 'blocked'
          : 'needs_revision',
    panelVerdict: verdict.panelVerdict,
    reviewReportPath,
    reviewReportSha256,
    stagingPaths,
    round: opts.round,
    quorumReason: verdict.quorumReason,
  }
}

// --- helpers -------------------------------------------------------

/** Mirror of fingerprintFinding from src/artifacts/review-report.ts —
 *  duplicated locally to avoid pulling in the larger artifact module's
 *  imports for a one-line helper. Both must agree. */
function fingerprintLocal(file: string, title: string): string {
  const t = title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
  return `${file}|${t}`
}

function panelistIdFor(_p: Panelist, index: number): string {
  // Default id naming when config doesn't supply explicit ids:
  // reviewer-A, reviewer-B, reviewer-C, ...
  // (Future extension: allow explicit `id` field on Panelist.)
  const letter = String.fromCharCode('A'.charCodeAt(0) + index)
  return `reviewer-${letter}`
}

function exitReasonFor(verdict: 'ready' | 'needs-revision' | 'block', quorumReason: string): string {
  switch (verdict) {
    case 'ready':
      return 'cross-family quorum reached AND no unresolved voter actionable findings'
    case 'block':
      return `panel verdict block: ${quorumReason}`
    case 'needs-revision':
      return `panel verdict needs-revision: ${quorumReason}`
  }
}

async function emitEvent(opts: RunReviewPanelOptions, evt: PhaseEvent): Promise<void> {
  await appendEvent(
    {
      file: opts.runPaths.eventsFile,
      lockDir: opts.runPaths.lockDir,
    },
    evt,
  )
}
