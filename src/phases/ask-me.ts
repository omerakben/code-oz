// Bounded ask-me conversation runner for the DEFINE phase.
//
// Contract pinned in docs/references/spec-contract.md.
//
// Responsibilities:
//   - Drive a turn-by-turn conversation between user and BA persona
//   - Compose prompts via src/prompts/index.ts (protocol template + persona
//     body + Common Rationalizations + history)
//   - Invoke the persona via invokeAgent (M4 wrapper) once per turn
//   - Log ask_me_user_input + ask_me_persona_reply events for every turn
//   - Detect the readySignal (exact-line match on the persona response only)
//   - Parse the SPEC.md draft after the ready line via parseSpec
//   - Run up to maxRepairTurns repair turns when validation fails
//   - Run up to maxFinalizeTurns finalize turns when maxRounds is exhausted
//
// Returns a discriminated AskMeResult; the caller (src/phases/define.ts)
// decides what to do with each status (write SPEC.md, write SPEC.draft.md +
// NEEDS_INTERVENTION, etc.).
//
// The runner does NOT write artifacts. The runner does NOT write
// NEEDS_INTERVENTION.json or call requireGate — the caller owns gate I/O.
// The runner DOES write ask_me_* events because they belong to the audit
// trail of THIS conversation, not to the gate transition.

import { collectProviderResponse } from '../providers/fake.ts'
import { invokeAgent, type InvokeContext } from '../providers/invoke.ts'
import { ProviderError } from '../providers/errors.ts'
import { appendEvent, type EventLogPaths } from '../state/events.ts'
import { withLock } from '../state/lock.ts'
import { parseSpec } from '../artifacts/spec.ts'
import { SpecLoadError, type SpecLoadIssue } from '../artifacts/errors.ts'
import { composeDefinePrompt, type AskMeTurn } from '../prompts/index.ts'
import type { ProviderRequest } from '../providers/types.ts'
import { canonicalRoleFromAgent } from '../agents/role.ts'
import type { AgentDefinition } from '../agents/schema.ts'
import type { AskMeConfig } from '../config/schema.ts'
import type { SpecArtifact } from '../artifacts/spec.ts'

// --- public API ----------------------------------------------------

export type AskMeStatus =
  | 'success'                    // valid SPEC produced
  | 'validation_failed'          // ready signal seen, but draft (and any repair turns) failed parseSpec
  | 'truncated'                  // provider returned stopReason: 'max_tokens'
  | 'max_rounds_exhausted'       // reached maxRounds with no ready signal AND onMaxRounds: 'fail'
  | 'provider_error'             // ProviderError surfaced from invokeAgent

export interface AskMeSuccess {
  readonly status: 'success'
  readonly spec: SpecArtifact
  readonly history: readonly AskMeTurn[]
  readonly turnsUsed: number
}

export interface AskMeValidationFailed {
  readonly status: 'validation_failed'
  /** The unvalidated draft text (anything after the ready line on the last attempted turn). */
  readonly draft: string
  /** The issues from the last failed parse attempt. */
  readonly issues: readonly SpecLoadIssue[]
  readonly history: readonly AskMeTurn[]
  readonly turnsUsed: number
}

export interface AskMeTruncated {
  readonly status: 'truncated'
  /** Whatever draft text could be extracted before truncation, or empty if no ready signal. */
  readonly draft: string
  readonly history: readonly AskMeTurn[]
  readonly turnsUsed: number
}

export interface AskMeMaxRoundsExhausted {
  readonly status: 'max_rounds_exhausted'
  readonly history: readonly AskMeTurn[]
  readonly turnsUsed: number
}

export interface AskMeProviderError {
  readonly status: 'provider_error'
  readonly error: ProviderError
  readonly history: readonly AskMeTurn[]
  readonly turnsUsed: number
}

export type AskMeResult =
  | AskMeSuccess
  | AskMeValidationFailed
  | AskMeTruncated
  | AskMeMaxRoundsExhausted
  | AskMeProviderError

export interface RunAskMeOptions {
  readonly invokeCtx: InvokeContext
  readonly eventPaths: EventLogPaths
  readonly runId: string
  readonly agent: AgentDefinition
  readonly config: AskMeConfig
  /** First user input (turn 0); always required, never read from stdin. */
  readonly initialUserInput: string
  /**
   * Reads the next user input for turns 1+. The orchestrator (commit 8)
   * supplies a TTY reader or a fixture-replay reader. Returns null to
   * signal EOF — runner treats EOF as max_rounds_exhausted.
   */
  readonly readNextUserInput: (turn: number) => Promise<string | null>
  readonly now?: () => string
}

// --- runner --------------------------------------------------------

const READY_LINE_RE_CACHE = new Map<string, RegExp>()

function readyLineRegex(signal: string): RegExp {
  const cached = READY_LINE_RE_CACHE.get(signal)
  if (cached !== undefined) return cached
  const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Multiline mode so `^` and `$` anchor to line boundaries.
  const re = new RegExp(`^\\s*${escaped}\\s*$`, 'm')
  READY_LINE_RE_CACHE.set(signal, re)
  return re
}

interface ReadyMatch {
  readonly start: number
  readonly end: number
}

/**
 * Find the readySignal token alone on a line. Returns the index range
 * [tokenStart, tokenEnd) on the source string, or null if absent.
 *
 * Anchored to line boundaries: only an exact-line match counts. A token
 * embedded in prose ("emit `<spec-ready/>` when ready") does not.
 */
function findReadyLine(text: string, signal: string): ReadyMatch | null {
  const re = readyLineRegex(signal)
  const m = text.match(re)
  if (m === null || m.index === undefined) return null
  return { start: m.index, end: m.index + m[0].length }
}

/**
 * Extract the SPEC.md draft from a persona response that contains a ready
 * signal. The token line is consumed; everything after it (trimmed) is the
 * draft. Returns null if no ready signal is present.
 */
export function extractDraft(response: string, signal: string): string | null {
  const range = findReadyLine(response, signal)
  if (range === null) return null
  // Skip past the matched line + the following newline if present.
  let cursor = range.end
  if (response[cursor] === '\r') cursor++
  if (response[cursor] === '\n') cursor++
  return response.slice(cursor).trim()
}

/**
 * Build the repair-turn prompt — appended to the conversation as a synthetic
 * user message describing the validation issues from the failed draft.
 */
function buildRepairUserMessage(issues: readonly SpecLoadIssue[]): string {
  const lines: string[] = [
    'The SPEC.md draft you just produced failed structural validation. Fix the following issues and re-emit the ready signal followed by a complete SPEC.md draft. Do not change anything that was not flagged.',
    '',
  ]
  for (const i of issues) {
    const at = i.line !== undefined ? ` (around line ${i.line})` : ''
    lines.push(`- [${i.code}] ${i.rule}${i.detail ? `: ${i.detail}` : ''}${at}`)
  }
  return lines.join('\n')
}

/**
 * Build the finalize-turn prompt — synthetic user message asking the persona
 * to converge with current information.
 */
function buildFinalizeUserMessage(): string {
  return [
    'You have used all available conversation rounds without emitting the ready signal. Produce the best SPEC.md draft you can with the information gathered so far. Emit the ready signal alone on a line, then the complete SPEC.md draft. If a section is genuinely undecidable from the conversation, mark it with a single open-question bullet rather than guessing.',
  ].join('\n')
}

export async function runAskMe(opts: RunAskMeOptions): Promise<AskMeResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const history: AskMeTurn[] = []

  // Turn 0 — initial user input.
  await pushUserTurn(opts, history, 0, opts.initialUserInput, now)

  let turn = 0
  let providerError: ProviderError | null = null

  // Regular rounds. `turn` indexes the user inputs (turn 0 already pushed).
  for (; turn < opts.config.maxRounds; turn++) {
    const personaTurn = turn // pair with the user turn just pushed
    const reply = await invokePersona(opts, history, personaTurn, now).catch((err: unknown) => {
      if (err instanceof ProviderError) {
        providerError = err
        return null
      }
      throw err
    })
    if (providerError !== null) break
    if (reply === null) break // safety; not reachable

    if (reply.stopReason === 'max_tokens') {
      // Truncated — we still try to extract a draft so the caller can show it.
      const draft = extractDraft(reply.text, opts.config.readySignal) ?? ''
      return {
        status: 'truncated',
        draft,
        history: Object.freeze([...history]),
        turnsUsed: personaTurn + 1,
      }
    }

    const draft = extractDraft(reply.text, opts.config.readySignal)
    if (draft !== null) {
      // Persona signaled readiness — try to parse + repair if needed.
      const result = await parseWithRepair(opts, history, personaTurn, draft, now)
      return result
    }

    // Not ready yet — read next user input.
    const nextTurnIndex = personaTurn + 1
    if (nextTurnIndex >= opts.config.maxRounds) {
      // The next loop iteration would exit on the for-condition anyway, but
      // handling it explicitly makes the finalize transition clean: we exit
      // the regular loop here without ever asking the user for an extra
      // input we would not consume.
      break
    }
    const nextInput = await opts.readNextUserInput(nextTurnIndex)
    if (nextInput === null) {
      // EOF on stdin / fixture exhausted — treat as max-rounds exhausted.
      break
    }
    await pushUserTurn(opts, history, nextTurnIndex, nextInput, now)
  }

  if (providerError !== null) {
    return {
      status: 'provider_error',
      error: providerError,
      history: Object.freeze([...history]),
      turnsUsed: turn,
    }
  }

  // Finalize ritual or fail.
  if (opts.config.onMaxRounds === 'fail' || opts.config.maxFinalizeTurns === 0) {
    return {
      status: 'max_rounds_exhausted',
      history: Object.freeze([...history]),
      turnsUsed: turn,
    }
  }

  // Append the finalize synthetic user input and run up to maxFinalizeTurns.
  const finalizeUserInput = buildFinalizeUserMessage()
  // Use a turn index continuing from the regular loop so events stay ordered.
  const finalizeStartTurn = history.filter((t) => t.role === 'user').length
  await pushUserTurn(opts, history, finalizeStartTurn, finalizeUserInput, now)

  for (let f = 0; f < opts.config.maxFinalizeTurns; f++) {
    const personaTurn = finalizeStartTurn + f
    const reply = await invokePersona(opts, history, personaTurn, now).catch((err: unknown) => {
      if (err instanceof ProviderError) {
        providerError = err
        return null
      }
      throw err
    })
    if (providerError !== null || reply === null) break

    if (reply.stopReason === 'max_tokens') {
      const draft = extractDraft(reply.text, opts.config.readySignal) ?? ''
      return {
        status: 'truncated',
        draft,
        history: Object.freeze([...history]),
        turnsUsed: personaTurn + 1,
      }
    }

    const draft = extractDraft(reply.text, opts.config.readySignal)
    if (draft !== null) {
      return await parseWithRepair(opts, history, personaTurn, draft, now)
    }
    // Finalize attempt did not include the ready signal — repeat the
    // synthetic user prompt for any remaining attempts.
    if (f + 1 < opts.config.maxFinalizeTurns) {
      const reminderTurn = finalizeStartTurn + f + 1
      await pushUserTurn(opts, history, reminderTurn, finalizeUserInput, now)
    }
  }

  if (providerError !== null) {
    return {
      status: 'provider_error',
      error: providerError,
      history: Object.freeze([...history]),
      turnsUsed: history.filter((t) => t.role === 'ba').length,
    }
  }

  return {
    status: 'max_rounds_exhausted',
    history: Object.freeze([...history]),
    turnsUsed: history.filter((t) => t.role === 'ba').length,
  }
}

// --- internal helpers ----------------------------------------------

async function parseWithRepair(
  opts: RunAskMeOptions,
  history: AskMeTurn[],
  personaTurnAtReady: number,
  initialDraft: string,
  now: () => string,
): Promise<AskMeSuccess | AskMeValidationFailed | AskMeProviderError | AskMeTruncated> {
  // Try the initial draft.
  let lastDraft = initialDraft
  let lastIssues: readonly SpecLoadIssue[] = []
  try {
    const spec = parseSpec(initialDraft)
    return {
      status: 'success',
      spec,
      history: Object.freeze([...history]),
      turnsUsed: personaTurnAtReady + 1,
    }
  } catch (err) {
    if (!(err instanceof SpecLoadError)) throw err
    lastIssues = err.issues
  }

  // Repair turns.
  for (let r = 0; r < opts.config.maxRepairTurns; r++) {
    const repairUserMessage = buildRepairUserMessage(lastIssues)
    const userTurnIndex = history.filter((t) => t.role === 'user').length
    await pushUserTurn(opts, history, userTurnIndex, repairUserMessage, now)

    const personaTurn = personaTurnAtReady + 1 + r
    let providerError: ProviderError | null = null
    const reply = await invokePersona(opts, history, personaTurn, now).catch((err: unknown) => {
      if (err instanceof ProviderError) {
        providerError = err
        return null
      }
      throw err
    })
    if (providerError !== null) {
      return {
        status: 'provider_error',
        error: providerError,
        history: Object.freeze([...history]),
        turnsUsed: personaTurn,
      }
    }
    if (reply === null) break

    if (reply.stopReason === 'max_tokens') {
      const draft = extractDraft(reply.text, opts.config.readySignal) ?? ''
      return {
        status: 'truncated',
        draft,
        history: Object.freeze([...history]),
        turnsUsed: personaTurn + 1,
      }
    }

    const draft = extractDraft(reply.text, opts.config.readySignal)
    if (draft === null) {
      // Repair attempt didn't include a fresh ready signal; treat as
      // continued failure with no new draft to parse.
      lastIssues = [
        {
          file: 'SPEC.md',
          code: 'spec_missing_title',
          rule: 'repair turn did not include the ready signal followed by a SPEC draft',
        },
      ]
      continue
    }
    lastDraft = draft
    try {
      const spec = parseSpec(draft)
      return {
        status: 'success',
        spec,
        history: Object.freeze([...history]),
        turnsUsed: personaTurn + 1,
      }
    } catch (err) {
      if (!(err instanceof SpecLoadError)) throw err
      lastIssues = err.issues
    }
  }

  return {
    status: 'validation_failed',
    draft: lastDraft,
    issues: Object.freeze([...lastIssues]),
    history: Object.freeze([...history]),
    turnsUsed: history.filter((t) => t.role === 'ba').length,
  }
}

interface CollectedReply {
  readonly text: string
  readonly stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'budget_exceeded' | 'error'
}

async function invokePersona(
  opts: RunAskMeOptions,
  history: AskMeTurn[],
  personaTurn: number,
  now: () => string,
): Promise<CollectedReply> {
  const prompt = await composeDefinePrompt({
    agentBody: opts.agent.body,
    history,
    readySignal: opts.config.readySignal,
  })
  const req: ProviderRequest = {
    agent: opts.agent,
    phase: 'define',
    runId: opts.runId,
    prompt,
    files: [],
    // M13 (Codex Q9): bundled-role identity for per-role gating. BA is
    // the canonical DEFINE persona; project-local overrides keep the
    // name `ba` and continue to gate as `ba`.
    ...(canonicalRoleFromAgent(opts.agent) !== undefined
      ? { role: canonicalRoleFromAgent(opts.agent) }
      : {}),
  }
  const response = await collectProviderResponse(invokeAgent(opts.invokeCtx, req))
  const text = response.content
  const ready = findReadyLine(text, opts.config.readySignal) !== null
  // Log the persona reply event under the per-run lock.
  await withLock(opts.eventPaths.lockDir, async () => {
    await appendEvent(
      opts.eventPaths,
      {
        version: 1,
        type: 'ask_me_persona_reply',
        ts: now(),
        runId: opts.runId,
        phase: 'define',
        turn: personaTurn,
        agent: opts.agent.name,
        response: text,
        ready,
      },
      { skipLock: true },
    )
  })
  history.push({ role: 'ba', text })
  return { text, stopReason: response.stopReason }
}

async function pushUserTurn(
  opts: RunAskMeOptions,
  history: AskMeTurn[],
  turn: number,
  input: string,
  now: () => string,
): Promise<void> {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new Error('runAskMe: user input must be non-empty after trim')
  }
  await withLock(opts.eventPaths.lockDir, async () => {
    await appendEvent(
      opts.eventPaths,
      {
        version: 1,
        type: 'ask_me_user_input',
        ts: now(),
        runId: opts.runId,
        phase: 'define',
        turn,
        input: trimmed,
      },
      { skipLock: true },
    )
  })
  history.push({ role: 'user', text: trimmed })
}
