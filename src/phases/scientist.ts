// Scientist phase-tail runner.
//
// Contract pinned in docs/contracts/SCIENTIST.md. Runs after each primary
// phase produces its artifact, before the gate writes. Reads the primary
// artifact + prior sidecars, invokes the Scientist persona for a single
// turn, parses the response into updated HYPOTHESES.md / OPEN_QUESTIONS.md
// drafts, atomically writes both, and emits diff events
// (hypothesis_added / hypothesis_updated / question_added / question_resolved /
// question_deferred / science_emitted).
//
// Loose coupling: the gate-preflight (commit 10) is a separate helper the
// caller (PLAN orchestrator in commit 13) invokes after this runner. This
// module only owns the persona invocation + sidecar I/O + event emission.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { invokeAgent, type InvokeContext } from '../providers/invoke.ts'
import { withLock } from '../state/lock.ts'
import {
  appendEvent,
  type EventLogPaths,
} from '../state/events.ts'
import type { Phase } from '../state/schemas.ts'
import type { AgentDefinition } from '../agents/schema.ts'
import type { RunPaths } from '../state/run.ts'
import {
  parseHypotheses,
  serializeHypotheses,
  type HypothesesArtifact,
  type Hypothesis,
} from '../artifacts/hypotheses.ts'
import {
  parseOpenQuestions,
  serializeOpenQuestions,
  type OpenQuestionsArtifact,
  type OpenQuestion,
} from '../artifacts/open-questions.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'

// --- public API ----------------------------------------------------

export type ScientistTailStatus = 'complete' | 'intervention'

export interface ScientistTailComplete {
  readonly status: 'complete'
  readonly hypothesesPath: string
  readonly openQuestionsPath: string
  readonly hypothesesAdded: number
  readonly hypothesesUpdated: number
  readonly questionsAdded: number
  readonly questionsResolved: number
  readonly questionsDeferred: number
}

export interface ScientistTailIntervention {
  readonly status: 'intervention'
  readonly code: string
  readonly rule: string
  readonly draftPathHypotheses?: string
  readonly draftPathOpenQuestions?: string
}

export type ScientistTailResult = ScientistTailComplete | ScientistTailIntervention

export interface RunScientistTailOptions {
  readonly invokeCtx: InvokeContext
  readonly runPaths: RunPaths
  readonly runId: string
  readonly agent: AgentDefinition           // the Scientist persona
  readonly phase: Phase                     // 'plan' in M6
  readonly primaryArtifactPath: string
  readonly fsyncDir?: boolean
  readonly now?: () => string
}

export const SCIENTIST_READY_SIGNAL = '<scientist-ready/>'

// --- helpers -------------------------------------------------------

function eventPathsFor(paths: RunPaths): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

function hypothesesPathFor(paths: RunPaths): string {
  return join(paths.artifactRoot, 'HYPOTHESES.md')
}
function openQuestionsPathFor(paths: RunPaths): string {
  return join(paths.artifactRoot, 'OPEN_QUESTIONS.md')
}
function hypothesesDraftPathFor(paths: RunPaths): string {
  return join(paths.artifactRoot, 'HYPOTHESES.draft.md')
}
function openQuestionsDraftPathFor(paths: RunPaths): string {
  return join(paths.artifactRoot, 'OPEN_QUESTIONS.draft.md')
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function emptyHypotheses(): HypothesesArtifact {
  return Object.freeze({ title: 'HYPOTHESES', hypotheses: Object.freeze<Hypothesis[]>([]) })
}
function emptyOpenQuestions(): OpenQuestionsArtifact {
  return Object.freeze({ title: 'OPEN QUESTIONS', questions: Object.freeze<OpenQuestion[]>([]) })
}

interface HypothesisDiff {
  readonly added: readonly Hypothesis[]
  readonly updated: readonly { hyp: Hypothesis; prevStatus: Hypothesis['status']; changedFields: readonly string[] }[]
}

function diffHypotheses(prior: HypothesesArtifact, next: HypothesesArtifact): HypothesisDiff {
  const priorMap = new Map(prior.hypotheses.map((h) => [h.id, h]))
  const added: Hypothesis[] = []
  const updated: { hyp: Hypothesis; prevStatus: Hypothesis['status']; changedFields: string[] }[] = []
  for (const h of next.hypotheses) {
    const p = priorMap.get(h.id)
    if (p === undefined) {
      added.push(h)
      continue
    }
    const fields: string[] = []
    if (p.status !== h.status) fields.push('status')
    if (p.falsifier !== h.falsifier) fields.push('falsifier')
    if (p.evidence !== h.evidence) fields.push('evidence')
    if (p.riskIfFalse !== h.riskIfFalse) fields.push('riskIfFalse')
    if (p.title !== h.title) fields.push('title')
    if (fields.length > 0) updated.push({ hyp: h, prevStatus: p.status, changedFields: fields })
  }
  return { added, updated }
}

interface QuestionDiff {
  readonly added: readonly OpenQuestion[]
  readonly resolved: readonly OpenQuestion[]
  readonly deferred: readonly OpenQuestion[]
}

function diffQuestions(prior: OpenQuestionsArtifact, next: OpenQuestionsArtifact): QuestionDiff {
  const priorMap = new Map(prior.questions.map((q) => [q.id, q]))
  const added: OpenQuestion[] = []
  const resolved: OpenQuestion[] = []
  const deferred: OpenQuestion[] = []
  for (const q of next.questions) {
    const p = priorMap.get(q.id)
    if (p === undefined) {
      added.push(q)
    } else {
      if (p.status !== 'resolved' && q.status === 'resolved') resolved.push(q)
      else if (p.status !== 'deferred' && q.status === 'deferred') deferred.push(q)
    }
  }
  return { added, resolved, deferred }
}

// --- response parser -----------------------------------------------

export function parseScientistResponse(
  response: string,
): { hypothesesText: string; openQuestionsText: string } | null {
  const lines = response.split(/\r?\n/)
  let readyIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === SCIENTIST_READY_SIGNAL) {
      readyIdx = i
      break
    }
  }
  if (readyIdx === -1) return null
  const after = lines.slice(readyIdx + 1).join('\n').trim()
  if (after.length === 0) return null
  const oqIdx = after.search(/^# OPEN QUESTIONS\b/m)
  if (oqIdx === -1) return null
  const hypothesesText = after.slice(0, oqIdx).trim()
  const openQuestionsText = after.slice(oqIdx).trim()
  return { hypothesesText, openQuestionsText }
}

// --- prompt composer (minimal; commit 11 will inject universal rules) ---

export function composeScientistPromptPure(args: {
  readonly agentBody: string
  readonly phase: Phase
  readonly primaryArtifactName: string
  readonly primaryArtifactText: string
  readonly priorHypothesesText: string | null
  readonly priorOpenQuestionsText: string | null
  readonly readySignal: string
  /** Optional universal-rules content; commit 11 will pass this in. */
  readonly universalRules?: string
  /** Optional Common Rationalizations content. */
  readonly commonRationalizations?: string
}): string {
  const sections: string[] = []
  sections.push('# Scientist phase-tail prompt')
  sections.push('')
  sections.push('## Persona body')
  sections.push('')
  sections.push(args.agentBody.trim())
  if (args.universalRules !== undefined && args.universalRules.trim().length > 0) {
    sections.push('')
    sections.push('## Universal rules')
    sections.push('')
    sections.push(args.universalRules.trim())
  }
  if (args.commonRationalizations !== undefined && args.commonRationalizations.trim().length > 0) {
    sections.push('')
    sections.push('## Common Rationalizations')
    sections.push('')
    sections.push(args.commonRationalizations.trim())
  }
  sections.push('')
  sections.push(`## Phase: ${args.phase}`)
  sections.push('')
  sections.push(`## Primary artifact (${args.primaryArtifactName})`)
  sections.push('')
  sections.push(args.primaryArtifactText.trim())
  sections.push('')
  sections.push('## Prior HYPOTHESES.md')
  sections.push('')
  sections.push(args.priorHypothesesText?.trim() ?? '(none — no prior file)')
  sections.push('')
  sections.push('## Prior OPEN_QUESTIONS.md')
  sections.push('')
  sections.push(args.priorOpenQuestionsText?.trim() ?? '(none — no prior file)')
  sections.push('')
  sections.push('## Output protocol')
  sections.push('')
  sections.push(
    `Emit a single line containing only \`${args.readySignal}\` (no surrounding backticks), then the full canonical \`# HYPOTHESES\` block, then the full canonical \`# OPEN QUESTIONS\` block.`,
  )
  return sections.join('\n') + '\n'
}

// --- runner --------------------------------------------------------

export async function runScientistPhaseTail(
  opts: RunScientistTailOptions,
): Promise<ScientistTailResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  // Load primary artifact (fail loud if missing — caller bug)
  let primaryText: string
  try {
    primaryText = await readFile(opts.primaryArtifactPath, 'utf8')
  } catch (err) {
    return {
      status: 'intervention',
      code: 'scientist_primary_missing',
      rule: `primary artifact not found: ${opts.primaryArtifactPath}`,
    }
  }

  // Load prior sidecars (best-effort)
  const hypPath = hypothesesPathFor(opts.runPaths)
  const oqPath = openQuestionsPathFor(opts.runPaths)
  const priorHypText = await readIfExists(hypPath)
  const priorOqText = await readIfExists(oqPath)
  let priorHypothesesArt: HypothesesArtifact = emptyHypotheses()
  let priorOpenQuestionsArt: OpenQuestionsArtifact = emptyOpenQuestions()
  if (priorHypText !== null) {
    try {
      priorHypothesesArt = parseHypotheses(priorHypText, hypPath)
    } catch {
      // Treat unparsable prior as empty; the new sidecar overwrites it.
    }
  }
  if (priorOqText !== null) {
    try {
      priorOpenQuestionsArt = parseOpenQuestions(priorOqText, oqPath)
    } catch {
      // same fallback as above
    }
  }

  // Compose prompt
  const prompt = composeScientistPromptPure({
    agentBody: opts.agent.body,
    phase: opts.phase,
    primaryArtifactName: opts.primaryArtifactPath.split('/').pop() ?? 'PRIMARY.md',
    primaryArtifactText: primaryText,
    priorHypothesesText: priorHypText,
    priorOpenQuestionsText: priorOqText,
    readySignal: SCIENTIST_READY_SIGNAL,
  })

  // Invoke persona — single turn
  let responseText = ''
  let stopReason = 'end' as string
  try {
    for await (const event of invokeAgent(opts.invokeCtx, {
      runId: opts.runId,
      phase: opts.phase,
      agent: opts.agent,
      files: [],
      prompt,
    })) {
      if (event.type === 'content_chunk') responseText += event.text
      else if (event.type === 'turn_completed') {
        stopReason = event.response.stopReason
        if (responseText.length === 0) responseText = event.response.content
      }
    }
  } catch (err) {
    return {
      status: 'intervention',
      code: 'scientist_provider_error',
      rule: `Scientist persona invocation failed: ${(err as Error).message}`,
    }
  }

  if (stopReason === 'max_tokens') {
    // The response is likely truncated; bail to draft.
    await writeDraftAndIntervention(opts, hypPath, oqPath, responseText, now, 'scientist_truncated', 'Scientist response was truncated by the model')
    return {
      status: 'intervention',
      code: 'scientist_truncated',
      rule: 'Scientist response was truncated by the model',
      draftPathHypotheses: hypothesesDraftPathFor(opts.runPaths),
      draftPathOpenQuestions: openQuestionsDraftPathFor(opts.runPaths),
    }
  }

  const parsed = parseScientistResponse(responseText)
  if (parsed === null) {
    await writeDraftAndIntervention(
      opts,
      hypPath,
      oqPath,
      responseText,
      now,
      'scientist_no_ready_token',
      `Scientist response missing ${SCIENTIST_READY_SIGNAL} or # OPEN QUESTIONS marker`,
    )
    return {
      status: 'intervention',
      code: 'scientist_no_ready_token',
      rule: `Scientist response missing ${SCIENTIST_READY_SIGNAL} or # OPEN QUESTIONS marker`,
      draftPathHypotheses: hypothesesDraftPathFor(opts.runPaths),
      draftPathOpenQuestions: openQuestionsDraftPathFor(opts.runPaths),
    }
  }

  let nextHyp: HypothesesArtifact
  let nextOq: OpenQuestionsArtifact
  try {
    nextHyp = parseHypotheses(parsed.hypothesesText, 'HYPOTHESES.md.draft')
  } catch (err) {
    await writeDraftAndIntervention(
      opts,
      hypPath,
      oqPath,
      responseText,
      now,
      'scientist_hypotheses_invalid',
      `Scientist HYPOTHESES draft failed validation: ${(err as Error).message}`,
    )
    return {
      status: 'intervention',
      code: 'scientist_hypotheses_invalid',
      rule: `Scientist HYPOTHESES draft failed validation: ${(err as Error).message}`,
      draftPathHypotheses: hypothesesDraftPathFor(opts.runPaths),
    }
  }
  try {
    nextOq = parseOpenQuestions(parsed.openQuestionsText, 'OPEN_QUESTIONS.md.draft')
  } catch (err) {
    await writeDraftAndIntervention(
      opts,
      hypPath,
      oqPath,
      responseText,
      now,
      'scientist_open_questions_invalid',
      `Scientist OPEN_QUESTIONS draft failed validation: ${(err as Error).message}`,
    )
    return {
      status: 'intervention',
      code: 'scientist_open_questions_invalid',
      rule: `Scientist OPEN_QUESTIONS draft failed validation: ${(err as Error).message}`,
      draftPathOpenQuestions: openQuestionsDraftPathFor(opts.runPaths),
    }
  }

  // Atomic write the canonical sidecars.
  const hypText = serializeHypotheses(nextHyp)
  const oqText = serializeOpenQuestions(nextOq)
  await atomicWriteFile(hypPath, hypText, { fsyncDir: opts.fsyncDir })
  await atomicWriteFile(oqPath, oqText, { fsyncDir: opts.fsyncDir })

  // Diff and emit events.
  const hypDiff = diffHypotheses(priorHypothesesArt, nextHyp)
  const qDiff = diffQuestions(priorOpenQuestionsArt, nextOq)

  await withLock(opts.runPaths.lockDir, async () => {
    const eventPaths = eventPathsFor(opts.runPaths)
    for (const h of hypDiff.added) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'hypothesis_added',
          ts: now(),
          runId: opts.runId,
          phase: opts.phase,
          id: h.id,
          status: h.status,
          falsifier: h.falsifier,
        },
        { skipLock: true },
      )
    }
    for (const u of hypDiff.updated) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'hypothesis_updated',
          ts: now(),
          runId: opts.runId,
          phase: opts.phase,
          id: u.hyp.id,
          prevStatus: u.prevStatus,
          nextStatus: u.hyp.status,
          changedFields: Object.freeze([...u.changedFields]),
        },
        { skipLock: true },
      )
    }
    for (const q of qDiff.added) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'question_added',
          ts: now(),
          runId: opts.runId,
          phase: opts.phase,
          id: q.id,
          status: q.status,
          importance: q.importance,
          dueBy: q.dueBy,
        },
        { skipLock: true },
      )
    }
    for (const q of qDiff.resolved) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'question_resolved',
          ts: now(),
          runId: opts.runId,
          phase: opts.phase,
          id: q.id,
          resolvedAt: q.resolved?.date ?? now().slice(0, 10),
          resolution: q.resolved?.note ?? '',
        },
        { skipLock: true },
      )
    }
    for (const q of qDiff.deferred) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'question_deferred',
          ts: now(),
          runId: opts.runId,
          phase: opts.phase,
          id: q.id,
          deferredAt: now().slice(0, 10),
        },
        { skipLock: true },
      )
    }
    await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'science_emitted',
        ts: now(),
        runId: opts.runId,
        phase: opts.phase,
        hypothesesCount: nextHyp.hypotheses.length,
        openQuestionsCount: nextOq.questions.length,
      },
      { skipLock: true },
    )
  })

  return {
    status: 'complete',
    hypothesesPath: hypPath,
    openQuestionsPath: oqPath,
    hypothesesAdded: hypDiff.added.length,
    hypothesesUpdated: hypDiff.updated.length,
    questionsAdded: qDiff.added.length,
    questionsResolved: qDiff.resolved.length,
    questionsDeferred: qDiff.deferred.length,
  }
}

async function writeDraftAndIntervention(
  opts: RunScientistTailOptions,
  _hypPath: string,
  _oqPath: string,
  responseText: string,
  now: () => string,
  code: string,
  rule: string,
): Promise<void> {
  // Write the raw response as a draft for forensics.
  if (responseText.length > 0) {
    await atomicWriteFile(
      hypothesesDraftPathFor(opts.runPaths),
      responseText,
      { fsyncDir: opts.fsyncDir },
    )
  }
  // Append intervention event (NEEDS_INTERVENTION gate written by caller's
  // gate-preflight in commit 10; the runner's intervention code is enough
  // for the orchestrator to surface).
  await withLock(opts.runPaths.lockDir, async () => {
    await appendEvent(
      eventPathsFor(opts.runPaths),
      {
        version: 1,
        type: 'intervention',
        ts: now(),
        runId: opts.runId,
        code,
        phase: opts.phase,
      },
      { skipLock: true },
    )
  })
  // Suppress unused-var warning while keeping the signature stable.
  void rule
}
