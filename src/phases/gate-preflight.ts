// Gate-preflight: loose-coupled validation that runs BEFORE `requireGate`.
//
// Per Codex M6 decision 5 (CODEX_RESPONSE_M6.md "Where I disagree" 7):
// `requireGate` in src/state/run.ts stays generic state machinery. Sidecar
// parsing and overdue-question semantics live here, in src/phases/, and the
// phase orchestrator calls them before `requireGate(phase, ...)`.
//
// validateScientistSidecars implements rule 15 mechanics: HYPOTHESES.md and
// OPEN_QUESTIONS.md must exist, parse, and have no overdue or blocking-
// impactance open questions before a gate can pass.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseHypotheses,
  type HypothesesArtifact,
} from '../artifacts/hypotheses.ts'
import {
  parseOpenQuestions,
  findGateBlockingQuestions,
  type OpenQuestionsArtifact,
} from '../artifacts/open-questions.ts'
import {
  HypothesesLoadError,
  OpenQuestionsLoadError,
} from '../artifacts/errors.ts'
import type { Phase } from '../state/schemas.ts'

export type GatePreflightCode =
  | 'scientist_sidecar_missing'
  | 'scientist_hypotheses_unparsable'
  | 'scientist_open_questions_unparsable'
  | 'open_question_blocking'
  | 'open_question_overdue'

export interface GatePreflightOk {
  readonly ok: true
  readonly hypotheses: HypothesesArtifact
  readonly openQuestions: OpenQuestionsArtifact
}

export interface GatePreflightFailure {
  readonly ok: false
  readonly code: GatePreflightCode
  readonly rule: string
  readonly detail?: string
  readonly actionableSuggestions: readonly string[]
}

export type GatePreflightResult = GatePreflightOk | GatePreflightFailure

export interface ValidateScientistSidecarsOptions {
  readonly phase: Phase
  readonly artifactRoot: string
  /** ISO YYYY-MM-DD. Defaults to today's date in UTC. */
  readonly today?: string
}

/**
 * Validate the Scientist sidecars before `requireGate(phase, ...)`. Returns
 * a discriminated union; the caller writes NEEDS_INTERVENTION on failure
 * and aborts the gate write.
 *
 * Validation order (first failure wins):
 *   1. HYPOTHESES.md exists.
 *   2. HYPOTHESES.md parses.
 *   3. OPEN_QUESTIONS.md exists.
 *   4. OPEN_QUESTIONS.md parses.
 *   5. No open question with `Importance: blocking`.
 *   6. No open question with `DueBy < today`.
 */
export async function validateScientistSidecars(
  opts: ValidateScientistSidecarsOptions,
): Promise<GatePreflightResult> {
  const today = opts.today ?? todayIso()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`validateScientistSidecars: today must be ISO YYYY-MM-DD; got ${today}`)
  }

  const hypPath = join(opts.artifactRoot, 'HYPOTHESES.md')
  const oqPath = join(opts.artifactRoot, 'OPEN_QUESTIONS.md')

  const hypText = await readIfExists(hypPath)
  if (hypText === null) {
    return {
      ok: false,
      code: 'scientist_sidecar_missing',
      rule: `HYPOTHESES.md is required at gate-preflight; not found at ${hypPath}`,
      actionableSuggestions: [
        `re-run the ${opts.phase} phase to regenerate the Scientist sidecars`,
        `set phases.scientist.retroSeedDefine: true if running in DEFINE`,
      ],
    }
  }
  let hypArt: HypothesesArtifact
  try {
    hypArt = parseHypotheses(hypText, hypPath)
  } catch (err) {
    return {
      ok: false,
      code: 'scientist_hypotheses_unparsable',
      rule: `HYPOTHESES.md failed validation`,
      detail:
        err instanceof HypothesesLoadError
          ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ')
          : (err as Error).message,
      actionableSuggestions: [
        `inspect ${hypPath} and fix the listed issues`,
        `or re-run the ${opts.phase} phase to regenerate the file`,
      ],
    }
  }

  const oqText = await readIfExists(oqPath)
  if (oqText === null) {
    return {
      ok: false,
      code: 'scientist_sidecar_missing',
      rule: `OPEN_QUESTIONS.md is required at gate-preflight; not found at ${oqPath}`,
      actionableSuggestions: [
        `re-run the ${opts.phase} phase to regenerate the Scientist sidecars`,
      ],
    }
  }
  let oqArt: OpenQuestionsArtifact
  try {
    oqArt = parseOpenQuestions(oqText, oqPath)
  } catch (err) {
    return {
      ok: false,
      code: 'scientist_open_questions_unparsable',
      rule: `OPEN_QUESTIONS.md failed validation`,
      detail:
        err instanceof OpenQuestionsLoadError
          ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ')
          : (err as Error).message,
      actionableSuggestions: [
        `inspect ${oqPath} and fix the listed issues`,
        `or re-run the ${opts.phase} phase to regenerate the file`,
      ],
    }
  }

  const blockers = findGateBlockingQuestions(oqArt, today)
  if (blockers.length > 0) {
    const blocking = blockers.filter((q) => q.importance === 'blocking')
    if (blocking.length > 0) {
      return {
        ok: false,
        code: 'open_question_blocking',
        rule: `${blocking.length} open question(s) marked Importance: blocking`,
        detail: blocking.map((q) => q.id).join(', '),
        actionableSuggestions: [
          'resolve the blocking questions, or downgrade their importance with documented rationale',
          `the offending ids: ${blocking.map((q) => q.id).join(', ')}`,
        ],
      }
    }
    return {
      ok: false,
      code: 'open_question_overdue',
      rule: `${blockers.length} open question(s) past their DueBy`,
      detail: blockers.map((q) => `${q.id} (DueBy ${q.dueBy})`).join(', '),
      actionableSuggestions: [
        'resolve the overdue questions, defer them with a new DueBy, or extend the date',
        `the offending ids: ${blockers.map((q) => q.id).join(', ')}`,
      ],
    }
  }

  return Object.freeze({ ok: true, hypotheses: hypArt, openQuestions: oqArt })
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function todayIso(): string {
  const d = new Date()
  const y = d.getUTCFullYear().toString().padStart(4, '0')
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = d.getUTCDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}
