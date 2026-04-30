// Bundled prompt assets + composer.
//
// Static Bun asset imports keep the Markdown files alive in the compiled
// binary (rule from docs/references/spec-contract.md § "Bundled prompt asset
// liveness"). The composer is reached from `code-oz run -> phases/define.ts`,
// so tree-shaking sees a live use of the assets and keeps them.
//
// Mirror src/agents/bundled-defaults.ts pattern.

import defineSystemPath from './define-system.md' with { type: 'file' }
import commonRationalizationsPath from './common-rationalizations.md' with { type: 'file' }

const ASSET_CACHE = new Map<string, string>()

async function loadAsset(path: string): Promise<string> {
  const cached = ASSET_CACHE.get(path)
  if (cached !== undefined) return cached
  const text = await Bun.file(path).text()
  ASSET_CACHE.set(path, text)
  return text
}

/**
 * Test-only seam to clear the cache between fixture-driven runs that mutate
 * asset content. Production code never calls this.
 */
export function _resetPromptAssetCache(): void {
  ASSET_CACHE.clear()
}

export async function loadDefineSystemTemplate(): Promise<string> {
  return loadAsset(defineSystemPath)
}

export async function loadCommonRationalizations(): Promise<string> {
  return loadAsset(commonRationalizationsPath)
}

// --- conversation rendering ----------------------------------------

export type AskMeRole = 'user' | 'ba'

export interface AskMeTurn {
  readonly role: AskMeRole
  readonly text: string
}

/**
 * Render the conversation history into a deterministic block the persona can
 * read. Format: H3 header per turn (`### user (turn 0)` / `### ba (turn 0)`)
 * followed by the trimmed text, separated by blank lines.
 *
 * H3 headers (not H2) so the block can never collide with a SPEC section
 * heading inside the persona's reply if the conversation includes one.
 */
export function renderConversation(history: readonly AskMeTurn[]): string {
  if (history.length === 0) return '(no conversation yet)'
  const lines: string[] = []
  let userTurn = 0
  let baTurn = 0
  for (const t of history) {
    const turnNo = t.role === 'user' ? userTurn++ : baTurn++
    lines.push(`### ${t.role} (turn ${turnNo})`)
    lines.push('')
    lines.push(t.text.trim())
    lines.push('')
  }
  // Drop the trailing blank line so the rendered block doesn't bloat the
  // composed prompt.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

// --- composition ---------------------------------------------------

export interface ComposeDefinePromptInput {
  /** The BA persona body (the file body of `src/agents/defaults/ba.md`). */
  readonly agentBody: string
  /** Conversation history, in turn order. */
  readonly history: readonly AskMeTurn[]
  /** The literal ready-signal token from config. */
  readonly readySignal: string
}

const TOKEN_AGENT_BODY = '{{AGENT_BODY}}'
const TOKEN_RATIONALIZATIONS = '{{COMMON_RATIONALIZATIONS}}'
const TOKEN_READY_SIGNAL = '{{READY_SIGNAL}}'
const TOKEN_CONVERSATION = '{{CONVERSATION}}'

const REQUIRED_TOKENS = [
  TOKEN_AGENT_BODY,
  TOKEN_RATIONALIZATIONS,
  TOKEN_READY_SIGNAL,
  TOKEN_CONVERSATION,
] as const

/**
 * Pure composer (no I/O). Caller supplies the loaded assets so this function
 * stays trivially testable.
 */
export function composeDefinePromptPure(args: {
  readonly templateBody: string
  readonly commonRationalizations: string
  readonly agentBody: string
  readonly history: readonly AskMeTurn[]
  readonly readySignal: string
}): string {
  for (const tok of REQUIRED_TOKENS) {
    if (!args.templateBody.includes(tok)) {
      throw new Error(`define-system.md is missing required token ${tok}`)
    }
  }
  const conversation = renderConversation(args.history)
  return args.templateBody
    .replaceAll(TOKEN_AGENT_BODY, args.agentBody.trim())
    .replaceAll(TOKEN_RATIONALIZATIONS, args.commonRationalizations.trim())
    .replaceAll(TOKEN_READY_SIGNAL, args.readySignal)
    .replaceAll(TOKEN_CONVERSATION, conversation)
}

/**
 * Convenience wrapper: loads the bundled assets and composes the prompt.
 * Used by `src/phases/define.ts`. Tests typically call composeDefinePromptPure
 * directly with hand-crafted strings to avoid the cache.
 */
export async function composeDefinePrompt(input: ComposeDefinePromptInput): Promise<string> {
  const [templateBody, commonRationalizations] = await Promise.all([
    loadDefineSystemTemplate(),
    loadCommonRationalizations(),
  ])
  return composeDefinePromptPure({
    templateBody,
    commonRationalizations,
    agentBody: input.agentBody,
    history: input.history,
    readySignal: input.readySignal,
  })
}
