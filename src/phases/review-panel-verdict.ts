// M14 commit 5 — pure canonical panel verdict computation.
//
// Authority: orchestrator-owned panel verdict (CLAUDE.md rule 8 lesson;
// M9 single-reviewer baseline reaffirms). Persona prompts cannot
// override this; even malformed REVIEW.md inputs are rejected by
// parser recomputation that calls into this same algorithm.
//
// Layered relationship to other defense layers (per
// docs/contracts/REVIEW_PANEL.md § "Five-layer defense-in-depth"):
//   - Layer 1 (config-load) rejects same-family voters at YAML parse
//   - Layer 2 (agent loader) re-checks against the resolved BUILD agent
//   - Layer 3 (artifact parser) recomputes verdict from artifact bytes
//   - Layer 4 (THIS MODULE) is the runtime authority — every panel
//     orchestrator round computes the canonical verdict here
//   - Layer 5 (event validator) backstop on review_panel_completed
//
// All five layers must agree. Layer 3's recomputation in
// src/artifacts/review-report.ts is a private mirror that calls into
// the same algorithm; both implementations track this module as the
// source of truth.
//
// Per Codex pushback Q7 (CODEX_RESPONSE_M14.md):
//   "Same-family advisory may record real severity, but canonical
//    verdict ignores it unless an eligible cross-family voter
//    corroborates."
// Advisory findings have NO gate authority — positive OR negative —
// unless an eligible cross-family voter independently raises the same
// fingerprint. Severity is recorded faithfully; canonical verdict
// computation filters by authorityImpact.

import {
  REVIEW_SCORE_MIN,
  type AuthorityImpact,
  type PanelistRole,
  type PanelistVerdict,
  type PanelVerdict,
  type ReviewSeverity,
  type ReviewSynthesizedFinding,
} from '../artifacts/review-report.ts'

// REVIEW_SCORE_MIN is the minimum score required for a 'ready' verdict
// (M9 rule 6: score >= 6 AND verdict = ready). Re-export the literal so
// downstream callers can reference it without importing both files.
export const PANEL_VOTER_SCORE_MIN = REVIEW_SCORE_MIN

/**
 * One panelist's recorded scoring + verdict + identity. Inputs come from
 * each panelist's draft; the orchestrator passes them in canonical order.
 */
export interface PanelistInput {
  /** Stable per-panelist id (matches REVIEW.md Reviewers H3 heading). */
  readonly id: string
  /** Resolved at runtime via registry.familyOf(providerId), NOT the pure
   *  familyOf — registry resolution honors test seams + future routed-
   *  provider lineage. */
  readonly providerFamily: string
  /** Voter or advisory; declared in config. */
  readonly role: PanelistRole
  /** 0..10 from panelist persona. */
  readonly score: number
  /** Panelist's self-reported verdict; orchestrator computes the
   *  canonical panel verdict separately via computeCanonicalPanelVerdict. */
  readonly verdict: PanelistVerdict
  /** All findings raised by this panelist (file + title + severity). */
  readonly findings: readonly { readonly file: string; readonly title: string; readonly severity: ReviewSeverity }[]
}

export interface PanelVerdictInput {
  /** Resolved BUILD family at the time of REVIEW. Same value across all
   *  panelists in the round. */
  readonly buildFamily: string
  /** Canonical-order panelist inputs. */
  readonly panelists: readonly PanelistInput[]
}

/** Reason a reviewer was excluded from cross-family quorum eligibility. */
export interface PanelExcludedReason {
  readonly id: string
  readonly reason: string
}

/** Synthesized finding with attribution + authority-impact classification. */
export interface PanelSynthesizedFinding extends Omit<ReviewSynthesizedFinding, 'id' | 'recommendation' | 'roundRaised' | 'roundResolved' | 'line'> {
  /** fingerprint(file, title) — orchestrator assigns F-NNN ids downstream. */
  readonly fingerprint: string
  /** Panelist ids that raised this fingerprint (≥ 1). */
  readonly sources: readonly string[]
  /** 'voter' if at least one eligible cross-family voter raised it;
   *  'advisory' if only advisory or same-family panelists raised it. */
  readonly authorityImpact: AuthorityImpact
  /** Strictest severity among eligible voter sources, OR strictest among
   *  advisory sources if no eligible voter raised it. The recorded value
   *  preserves what the panelist said (Codex pushback Q7: "do not
   *  coerce same-family advisory findings down to nit or fyi"). */
  readonly severity: ReviewSeverity
}

export interface PanelVerdictResult {
  readonly panelVerdict: PanelVerdict
  readonly quorumReason: string
  /** Resolved families of the eligible cross-family voters (length 0..2). */
  readonly eligibleVoterFamilies: readonly string[]
  /** Panelists excluded from quorum (advisory + same-family voters). */
  readonly excludedReviewerIds: readonly string[]
  /** Why each excluded panelist was excluded (advisory role / same-family voter rejected). */
  readonly excludedReasons: readonly PanelExcludedReason[]
  /** Findings deduped by fingerprint(file, title), classified by authority impact. */
  readonly synthesizedFindings: readonly PanelSynthesizedFinding[]
}

/** Severity strictness order (more strict first). Used to take "strictest among sources". */
const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  block: 4,
  'fix-first': 3,
  nit: 2,
  fyi: 1,
}

function strictestSeverity(severities: readonly ReviewSeverity[]): ReviewSeverity {
  let best: ReviewSeverity = 'fyi'
  let bestRank = 0
  for (const s of severities) {
    const rank = SEVERITY_RANK[s]
    if (rank > bestRank) {
      best = s
      bestRank = rank
    }
  }
  return best
}

/** Mirror of src/artifacts/review-report.ts fingerprintFinding — kept here
 *  to avoid the cross-module import cycle. Both implementations must agree:
 *  lowercase + collapse whitespace + drop trailing punctuation. */
function fp(file: string, title: string): string {
  const t = title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
  return `${file}|${t}`
}

/**
 * Compute the canonical panel verdict from raw panelist inputs.
 *
 * Algorithm (must match the parser-side recompute in
 * src/artifacts/review-report.ts):
 *
 *   1. Eligibility: voter AND providerFamily !== buildFamily AND
 *      providerFamily !== 'unknown' (routed-provider lineage gating).
 *   2. Synthesis: dedup findings by fingerprint(file, title); attribute
 *      sources; classify authorityImpact ('voter' if any eligible voter
 *      source raised it; 'advisory' otherwise); take strictest severity
 *      from the dominant source group (voters first, fall back to
 *      advisory if no voter raised it).
 *   3. If any voter-impact unresolved 'block' finding → 'block'.
 *      (Inputs do not carry roundResolved; the runtime treats all input
 *      findings as "current round, unresolved". Resolved findings from
 *      prior rounds are filtered out by the orchestrator before calling.)
 *   4. If any voter-impact 'fix-first' finding → 'needs-revision'.
 *   5. Eligible voters !== 2 → 'needs-revision' with explanatory reason.
 *   6. Any eligible voter score < 6 OR verdict !== 'ready' → 'needs-revision'.
 *   7. Otherwise → 'ready'.
 *
 * Per Codex authority-laundering construction proof (CODEX_RESPONSE_M14.md
 * § "Authority-laundering construction proof"):
 *   - Same-family voter: rejected at config-load (layer 1) + agent loader
 *     (layer 2). If it slips through, eligibleForQuorum filters it out
 *     here, and quorum count check (step 5) fails.
 *   - Same-family advisory raising 'block': captured in synthesized
 *     findings with authorityImpact='advisory'; canonical verdict ignores
 *     it (step 3 only checks voter-impact findings). Visible in synthesis
 *     for human review.
 *   - Cross-family voter ratification: if a voter ALSO raises the same
 *     fingerprint as the same-family advisory's block, authorityImpact
 *     becomes 'voter' (step 2 picks voter-source group when present), and
 *     step 3 fires.
 */
export function computeCanonicalPanelVerdict(input: PanelVerdictInput): PanelVerdictResult {
  // Step 1: eligibility.
  const eligibility = input.panelists.map((p) => {
    const eligibleForQuorum =
      p.role === 'voter' && p.providerFamily !== input.buildFamily && p.providerFamily !== 'unknown'
    const excludeReason = !eligibleForQuorum
      ? p.role === 'voter' && p.providerFamily === input.buildFamily
        ? `same-family voter rejected (build=${input.buildFamily}, reviewer=${p.providerFamily})`
        : p.role === 'voter' && p.providerFamily === 'unknown'
          ? `routed-provider lineage unknown (cannot be eligible voter)`
          : 'advisory role'
      : undefined
    return { panelist: p, eligibleForQuorum, excludeReason }
  })
  const eligibleVoters = eligibility.filter((e) => e.eligibleForQuorum).map((e) => e.panelist)
  const excludedReasons: PanelExcludedReason[] = eligibility
    .filter((e) => e.excludeReason !== undefined)
    .map((e) => ({ id: e.panelist.id, reason: e.excludeReason! }))
  const excludedReviewerIds = excludedReasons.map((r) => r.id)
  const eligibleVoterFamilies = eligibleVoters.map((v) => v.providerFamily)

  // Step 2: synthesize findings (group by fingerprint; classify authority impact).
  const eligibleVoterIds = new Set(eligibleVoters.map((v) => v.id))
  const fingerprintMap = new Map<
    string,
    {
      sources: string[]
      voterSeverities: ReviewSeverity[]
      advisorySeverities: ReviewSeverity[]
      file: string
      title: string
    }
  >()
  for (const panelist of input.panelists) {
    const isVoter = eligibleVoterIds.has(panelist.id)
    for (const f of panelist.findings) {
      const key = fp(f.file, f.title)
      let entry = fingerprintMap.get(key)
      if (entry === undefined) {
        entry = {
          sources: [],
          voterSeverities: [],
          advisorySeverities: [],
          file: f.file,
          title: f.title,
        }
        fingerprintMap.set(key, entry)
      }
      entry.sources.push(panelist.id)
      if (isVoter) entry.voterSeverities.push(f.severity)
      else entry.advisorySeverities.push(f.severity)
    }
  }
  const synthesizedFindings: PanelSynthesizedFinding[] = []
  for (const [fingerprint, entry] of fingerprintMap) {
    const hasVoterSource = entry.voterSeverities.length > 0
    const authorityImpact: AuthorityImpact = hasVoterSource ? 'voter' : 'advisory'
    const severity = hasVoterSource
      ? strictestSeverity(entry.voterSeverities)
      : strictestSeverity(entry.advisorySeverities)
    synthesizedFindings.push(
      Object.freeze({
        fingerprint,
        title: entry.title,
        file: entry.file,
        severity,
        authorityImpact,
        sources: Object.freeze([...entry.sources]),
      }) as PanelSynthesizedFinding,
    )
  }
  // Stable order: by fingerprint string for determinism.
  synthesizedFindings.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))

  // Step 3: voter-impact unresolved block → 'block'.
  if (
    synthesizedFindings.some(
      (f) => f.authorityImpact === 'voter' && f.severity === 'block',
    )
  ) {
    return Object.freeze({
      panelVerdict: 'block' as const,
      quorumReason: `voter-impact unresolved block finding (${
        synthesizedFindings.find((f) => f.authorityImpact === 'voter' && f.severity === 'block')!.fingerprint
      })`,
      eligibleVoterFamilies: Object.freeze(eligibleVoterFamilies),
      excludedReviewerIds: Object.freeze(excludedReviewerIds),
      excludedReasons: Object.freeze(excludedReasons),
      synthesizedFindings: Object.freeze(synthesizedFindings),
    })
  }
  // Step 4: voter-impact unresolved fix-first → 'needs-revision'.
  if (
    synthesizedFindings.some(
      (f) => f.authorityImpact === 'voter' && f.severity === 'fix-first',
    )
  ) {
    return Object.freeze({
      panelVerdict: 'needs-revision' as const,
      quorumReason: `voter-impact unresolved fix-first finding (${
        synthesizedFindings.find((f) => f.authorityImpact === 'voter' && f.severity === 'fix-first')!.fingerprint
      })`,
      eligibleVoterFamilies: Object.freeze(eligibleVoterFamilies),
      excludedReviewerIds: Object.freeze(excludedReviewerIds),
      excludedReasons: Object.freeze(excludedReasons),
      synthesizedFindings: Object.freeze(synthesizedFindings),
    })
  }
  // Step 5: quorum count.
  if (eligibleVoters.length !== 2) {
    return Object.freeze({
      panelVerdict: 'needs-revision' as const,
      quorumReason: `cross-family quorum NOT met: required exactly 2 eligible voters, got ${eligibleVoters.length}`,
      eligibleVoterFamilies: Object.freeze(eligibleVoterFamilies),
      excludedReviewerIds: Object.freeze(excludedReviewerIds),
      excludedReasons: Object.freeze(excludedReasons),
      synthesizedFindings: Object.freeze(synthesizedFindings),
    })
  }
  // Step 6: voter score + verdict checks.
  const failedVoter = eligibleVoters.find(
    (v) => v.score < PANEL_VOTER_SCORE_MIN || v.verdict !== 'ready',
  )
  if (failedVoter !== undefined) {
    return Object.freeze({
      panelVerdict: 'needs-revision' as const,
      quorumReason: `eligible voter '${failedVoter.id}' not ready (score=${failedVoter.score} verdict=${failedVoter.verdict})`,
      eligibleVoterFamilies: Object.freeze(eligibleVoterFamilies),
      excludedReviewerIds: Object.freeze(excludedReviewerIds),
      excludedReasons: Object.freeze(excludedReasons),
      synthesizedFindings: Object.freeze(synthesizedFindings),
    })
  }
  // Step 7: ready.
  return Object.freeze({
    panelVerdict: 'ready' as const,
    quorumReason: `cross-family quorum reached: 2 of 2 voters from {${eligibleVoterFamilies.join(', ')}}`,
    eligibleVoterFamilies: Object.freeze(eligibleVoterFamilies),
    excludedReviewerIds: Object.freeze(excludedReviewerIds),
    excludedReasons: Object.freeze(excludedReasons),
    synthesizedFindings: Object.freeze(synthesizedFindings),
  })
}
