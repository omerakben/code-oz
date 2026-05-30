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
  type ReviewReportPanelData,
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
import type { Panelist, CompanyConfig, CodeOzConfig } from '../config/schema.ts'
import type { ProviderId, ProviderFamily } from '../providers/types.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import { ProviderError } from '../providers/errors.ts'
import {
  assertPanelWithinBudget,
  detectPanelBudgetSoftWarnings,
} from '../providers/cost.ts'
import type { RunPaths } from '../state/run.ts'
import { appendEvent } from '../state/events.ts'
import type { PhaseEvent, LoggedEvent } from '../state/schemas.ts'

// --- public types --------------------------------------------------

export interface PanelistInvocationResult {
  /** The panelist id (matches panel config id; usually `reviewer-A`, etc.). */
  readonly panelistId: string
  /** The actual ProviderId the panelist invoked under. */
  readonly providerId: ProviderId
  /** ADVISORY ONLY. Provider family the invoker thinks the panelist ran
   *  under. The orchestrator IGNORES this field for verdict computation,
   *  staging artifacts, and panelist-completed events — runtime family is
   *  resolved exclusively via `opts.registry.familyOf(providerId)`
   *  (Codex M14 R1 finding #3 closure: "panelist-authored family must
   *  never reach quorum computation"). Kept on the type for invoker-side
   *  diagnostics and so existing fixtures continue to compile. */
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
   *  atomically to .code-oz/runs/<runId>/review-panel/round-<N>/panelist-<id>.md. */
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
  /** Provider registry used to resolve per-panelist provider family at
   *  runtime via `registry.familyOf(providerId)`. Per Codex M14 R1
   *  finding #3, the orchestrator MUST NOT trust invoker-supplied family
   *  values — every artifact, event, and verdict input records the
   *  registry-resolved family. Honors test seams + future
   *  routed-provider lineage (familyOverrides). */
  readonly registry: ProviderRegistry
  /** Active CodeOzConfig — read for budget caps in the aggregate panel
   *  preflight (Codex M14 R1 finding #6). */
  readonly config: CodeOzConfig
  /** Already-read events.jsonl entries used to compute cumulative
   *  budget spend before the panel preflight runs. The caller (runReview)
   *  reads events for the cross-family check and reuses them here so the
   *  orchestrator does not re-read the log. */
  readonly events: readonly LoggedEvent[]
  /** Conservative upper-bound estimate of the per-panelist token cost
   *  (prompt + manifest). Manifest equality means each panelist sees the
   *  same files; v0.1 uses one value broadcast across panel.length. */
  readonly perPanelistTokensEstimate: number
  /** Optional CompanyRole label for byRole budget routing. Defaults to
   *  'reviewer' since panel mode runs in the reviewer role today. Future
   *  M16+ may panel other roles. */
  readonly panelRole?: string
  /** Prior canonical panel REVIEW.md, parsed, when round > 1. The
   *  orchestrator carries forward synthesized findings (reusing F-NNN
   *  ids by fingerprint), extends the round timeline with the new
   *  entry, and marks prior fingerprints not raised this round as
   *  resolved-this-round. Codex M14 R2 finding #1 closure: panel mode
   *  must support multi-round lifecycle. */
  readonly priorPanelReport?: ReviewReportPanelData
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

/** Internal record pairing the invoker output with the registry-resolved
 *  provider family. The orchestrator never reads `result.providerFamily`
 *  past the invocation seam — every downstream surface uses
 *  `resolvedFamily`. Codex M14 R1 finding #3. */
interface ResolvedPanelistInvocation {
  readonly result: PanelistInvocationResult
  readonly resolvedFamily: ProviderFamily
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

  // Aggregate budget preflight (Codex M14 R1 finding #6). MUST run before
  // any panelist invokes — a partial panel has no valid quorum, so the
  // policy is "refuse the whole round" rather than "run until budget
  // exhausted mid-round." Soft warnings emit existing M13 budget_warning
  // events (no new vocabulary, per anti-pattern lock).
  const panelistTokenEstimates = Array.from<number>({
    length: opts.panel.length,
  }).fill(opts.perPanelistTokensEstimate)
  const panelPreflightInput = {
    phase: 'review' as const,
    role: opts.panelRole ?? 'reviewer',
    panelistTokenEstimates,
  }
  try {
    assertPanelWithinBudget(opts.config, panelPreflightInput, opts.events, new Date(now()))
  } catch (err) {
    if (err instanceof ProviderError) {
      const issue = err.issues[0]!
      return {
        status: 'intervention',
        code: 'panel_budget_exceeded',
        rule: issue.rule,
        ...(issue.detail !== undefined ? { detail: issue.detail } : {}),
      }
    }
    throw err
  }
  const softWarnings = detectPanelBudgetSoftWarnings(
    opts.config,
    panelPreflightInput,
    opts.events,
    new Date(now()),
  )
  for (const w of softWarnings) {
    await emitEvent(opts, {
      version: 1,
      type: 'budget_warning',
      ts: now(),
      runId: opts.runId,
      metric: w.metric,
      ratio: w.ratio,
      current: w.metric === 'maxWallTimeMinutes' ? Math.floor(w.current) : w.current,
      limit: w.limit,
      ...(w.role !== undefined ? { role: w.role } : {}),
    })
  }

  // Emit review_panel_started. Per Codex M14 R1 finding #3: composition
  // uses registry.familyOf — even the declared composition derives the
  // family from the same authority that runtime resolution uses, so a
  // mistyped declaration cannot ever appear in this event.
  let composition: ReadonlyArray<{
    readonly id: string
    readonly providerId: ProviderId
    readonly providerFamily: ProviderFamily
    readonly role: 'voter' | 'advisory'
  }>
  try {
    composition = opts.panel.map((p, i) => ({
      id: panelistIdFor(p, i),
      providerId: p.provider as ProviderId,
      providerFamily: opts.registry.familyOf(p.provider as ProviderId),
      role: p.role,
    }))
  } catch (err) {
    return {
      status: 'intervention',
      code: 'panel_provider_family_unresolved',
      rule: 'runReviewPanel: registry.familyOf failed for declared panel composition',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
  await emitEvent(opts, {
    version: 1,
    type: 'review_panel_started',
    ts: now(),
    runId: opts.runId,
    phase: 'review',
    agent: opts.orchestratorAgent,
    attempt: opts.upstreamRefs.attempt,
    taskId: opts.upstreamRefs.taskId,
    panelComposition: composition,
    buildFamily: opts.buildFamily,
  })

  // 1. Sequential per-panelist invocation + staging writes.
  const stagingDir = join(opts.runPaths.runDir, 'review-panel', `round-${opts.round}`)
  await mkdir(stagingDir, { recursive: true })

  const invocations: ResolvedPanelistInvocation[] = []
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

    // Codex M14 R1 finding #3: resolve family via registry.familyOf, never
    // trust the invoker. The resolved value is what every downstream
    // surface (event, staging artifact, canonical artifact, verdict
    // input) records.
    let resolvedFamily: ProviderFamily
    try {
      resolvedFamily = opts.registry.familyOf(result.providerId)
    } catch (err) {
      return {
        status: 'intervention',
        code: 'panel_provider_family_unresolved',
        rule: `panelist '${id}' providerId=${result.providerId} has no registered family`,
        detail: err instanceof Error ? err.message : String(err),
      }
    }

    // Defense-in-depth: layer-1 (config-load) already rejects declared
    // same-family voters, but runtime familyOverrides could still launder
    // a voter into the same family as BUILD. Refuse the round before any
    // artifact is materialized — the canonical artifact grammar requires
    // voters to declare cross-family pass, and a same-family voter has no
    // gate authority anyway (rule 2).
    if (cfg.role === 'voter' && resolvedFamily === opts.buildFamily) {
      return {
        status: 'intervention',
        code: 'panel_voter_same_family_at_runtime',
        rule:
          `panelist '${id}' providerId=${result.providerId} resolves to family ` +
          `${resolvedFamily} which equals buildFamily=${opts.buildFamily}; ` +
          'voters must be cross-family at runtime (rule 2)',
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

    // Emit review_panelist_completed using the registry-resolved family.
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
      providerFamily: resolvedFamily,
      modelPolicy: result.modelPolicy,
      role: result.role,
      score: result.score,
      verdict: result.verdict,
      manifestHash: result.manifestHash,
      stagingPath,
      stagingSha256: SHA(result.stagingContent),
    })

    invocations.push({ result, resolvedFamily })
  }

  // 2. Canonical verdict computation (layer 4 of defense-in-depth).
  // Per Codex M14 R1 finding #3: providerFamily is sourced from the
  // registry-resolved value, never from the invoker output.
  const verdictInputs: PanelistInput[] = invocations.map(({ result: inv, resolvedFamily }) => ({
    id: inv.panelistId,
    providerFamily: resolvedFamily,
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

  // Observability hardening for PE-2 (OpenRouter) routed-provider lineage:
  // emit one `panel_voter_lineage_unknown` event per panelist the verdict
  // excluded for unknown lineage. The verdict-side rejection already exists
  // (computeCanonicalPanelVerdict step 1; see
  // tests/review-panel-canonical-verdict.test.ts T10); this is the
  // emission side so PE-2 operators can grep events.jsonl for "why did
  // my voter not count?". Walk verdict.excludedReasons because the
  // canonical exclusion reason text lives there — matching on the
  // 'lineage unknown' substring lets the verdict module own the reason
  // string while this emitter stays decoupled from the exact wording
  // beyond the discriminator. Behavior unchanged: this is a write-side
  // addition only.
  for (const excluded of verdict.excludedReasons) {
    if (!excluded.reason.includes('lineage unknown')) continue
    const inv = invocations.find(({ result: r }) => r.panelistId === excluded.id)
    await emitEvent(opts, {
      version: 1,
      type: 'panel_voter_lineage_unknown',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.orchestratorAgent,
      voterId: excluded.id,
      ...(inv !== undefined ? { voterProviderId: inv.result.providerId } : {}),
      panelistRole: inv !== undefined ? inv.result.role : 'voter',
      excludeReason: excluded.reason,
    })
  }

  // 3. Build canonical REVIEW.md. Reviewers and crossFamilyCheck likewise
  // derive from the registry-resolved family, so a miswired invoker
  // cannot launder authority into the canonical artifact.
  const reviewers: ReviewPanelist[] = invocations.map(({ result: inv, resolvedFamily }) => ({
    id: inv.panelistId,
    providerId: inv.providerId,
    providerFamily: resolvedFamily,
    modelPolicy: inv.modelPolicy,
    role: inv.role,
    score: inv.score,
    verdict: inv.verdict,
    crossFamilyCheck:
      inv.role === 'voter' && resolvedFamily !== opts.buildFamily
        ? CROSS_FAMILY_CHECK_VOTER
        : CROSS_FAMILY_CHECK_ADVISORY,
    buildFamily: opts.buildFamily,
    manifestHash: inv.manifestHash,
  }))

  // Synthesize findings: look up recommendation + line from the source
  // panelist's first occurrence of the fingerprint.
  const findingMap = new Map<string, { rec: string; line: string }>()
  for (const { result: inv } of invocations) {
    for (const f of inv.findings) {
      const key = fingerprintLocal(f.file, f.title)
      if (!findingMap.has(key)) {
        findingMap.set(key, { rec: f.recommendation, line: f.line })
      }
    }
  }

  // Codex M14 R2 finding #1 closure: when prior panel data is supplied,
  // carry forward F-NNN ids by fingerprint, continue numbering past the
  // highest prior id, and mark prior findings missing from the current
  // round as resolved-this-round. This lets a panel `needs_revision`
  // round 1 → BUILD attempt 2 → panel round 2 cycle preserve finding
  // ids, the round timeline, and ping-pong reopen semantics.
  const prior = opts.priorPanelReport
  const priorByFingerprint = new Map<string, ReviewSynthesizedFinding>()
  let nextNumber = 1
  if (prior) {
    for (const f of prior.findings) {
      priorByFingerprint.set(fingerprintLocal(f.file, f.title), f)
      const m = f.id.match(/^F-(\d+)$/)
      if (m) {
        const n = Number.parseInt(m[1]!, 10)
        if (n >= nextNumber) nextNumber = n + 1
      }
    }
  }
  const currentFingerprints = new Set<string>()
  const synthesizedCurrent: ReviewSynthesizedFinding[] = verdict.synthesizedFindings.map(
    (f) => {
      const fp = f.fingerprint
      currentFingerprints.add(fp)
      const detail = findingMap.get(fp) ?? { rec: '(no recommendation)', line: '0' }
      const priorMatch = priorByFingerprint.get(fp)
      let id: string
      let roundRaised: number
      let roundResolved: number | 'unresolved'
      if (priorMatch) {
        // Reuse prior id + roundRaised. If the prior was resolved and is
        // raised again now, that is a reopen — set to unresolved (the
        // panel verdict path will catch it via the unresolved-voter
        // block / fix-first invariants).
        id = priorMatch.id
        roundRaised = priorMatch.roundRaised
        roundResolved = 'unresolved'
      } else {
        id = `F-${String(nextNumber).padStart(3, '0')}`
        nextNumber++
        roundRaised = opts.round
        roundResolved = 'unresolved'
      }
      return {
        id,
        title: f.title,
        file: f.file,
        line: detail.line,
        severity: f.severity,
        authorityImpact: f.authorityImpact,
        sources: f.sources,
        recommendation: detail.rec,
        roundRaised,
        roundResolved,
      }
    },
  )
  // Carry forward prior findings whose fingerprint is NOT in the current
  // round — they are resolved this round (no panelist re-raised them).
  // Already-resolved prior findings keep their roundResolved value.
  const synthesizedFindings: ReviewSynthesizedFinding[] = [...synthesizedCurrent]
  if (prior) {
    for (const f of prior.findings) {
      const fp = fingerprintLocal(f.file, f.title)
      if (currentFingerprints.has(fp)) continue
      synthesizedFindings.push({
        ...f,
        roundResolved: f.roundResolved === 'unresolved' ? opts.round : f.roundResolved,
      })
    }
  }

  // Build the round timeline. When prior data is supplied, append the
  // current round's entry to the prior timeline (preserves the 4-round
  // cap semantics and makes the artifact self-describing across rounds).
  const newTimelineEntry: ReviewPanelTimelineEntry = {
    round: opts.round,
    timestamp: now(),
    findingsRaised: synthesizedCurrent.length,
    panelVerdict: verdict.panelVerdict,
  }
  const timeline: ReviewPanelTimelineEntry[] = prior
    ? [...prior.roundTimeline, newTimelineEntry]
    : [newTimelineEntry]

  const uniqueFindingsByReviewer: Record<string, number> = {}
  for (const { result: inv } of invocations) uniqueFindingsByReviewer[inv.panelistId] = 0
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
  const voterCountFinal = invocations.filter(({ result: inv }) => inv.role === 'voter').length
  const advisoryCountFinal = invocations.filter(({ result: inv }) => inv.role === 'advisory').length
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
