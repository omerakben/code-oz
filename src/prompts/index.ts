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
import universalRulesPath from './universal-rules.md' with { type: 'file' }
import planSystemPath from './plan-system.md' with { type: 'file' }
import buildSystemPath from './build-system.md' with { type: 'file' }
import verifySystemPath from './verify-system.md' with { type: 'file' }
import reviewSystemPath from './review-system.md' with { type: 'file' }

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

/**
 * Load the universal rule sheet (CLAUDE.md rule 16). Every persona's
 * composed prompt must include this. Adding a new persona without injecting
 * universal-rules.md is a project-rule violation.
 */
export async function loadUniversalRules(): Promise<string> {
  return loadAsset(universalRulesPath)
}

export async function loadPlanSystemTemplate(): Promise<string> {
  return loadAsset(planSystemPath)
}

export async function loadBuildSystemTemplate(): Promise<string> {
  return loadAsset(buildSystemPath)
}

export async function loadVerifySystemTemplate(): Promise<string> {
  return loadAsset(verifySystemPath)
}

export async function loadReviewSystemTemplate(): Promise<string> {
  return loadAsset(reviewSystemPath)
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
const TOKEN_UNIVERSAL_RULES = '{{UNIVERSAL_RULES}}'

const REQUIRED_TOKENS = [
  TOKEN_AGENT_BODY,
  TOKEN_RATIONALIZATIONS,
  TOKEN_READY_SIGNAL,
  TOKEN_CONVERSATION,
] as const

/**
 * Pure composer (no I/O). Caller supplies the loaded assets so this function
 * stays trivially testable.
 *
 * universalRules is required per CLAUDE.md rule 16. Optional in the function
 * signature for a transitional period only — tests that pass nothing get an
 * empty injection but the canonical caller (`composeDefinePrompt`) loads the
 * bundled asset and passes it through. M5 templates that have no
 * `{{UNIVERSAL_RULES}}` token get the rules prepended to the agent body so
 * the rule's intent ("every persona's prompt imports these") survives.
 */
export function composeDefinePromptPure(args: {
  readonly templateBody: string
  readonly commonRationalizations: string
  readonly agentBody: string
  readonly history: readonly AskMeTurn[]
  readonly readySignal: string
  readonly universalRules?: string
}): string {
  for (const tok of REQUIRED_TOKENS) {
    if (!args.templateBody.includes(tok)) {
      throw new Error(`define-system.md is missing required token ${tok}`)
    }
  }
  const conversation = renderConversation(args.history)
  const rules = args.universalRules?.trim() ?? ''
  // Prepend rules to the agent body when the template has no
  // {{UNIVERSAL_RULES}} token (M5 transitional path — define-system.md
  // predates the token).
  const agentBodyWithRules =
    rules.length > 0 && !args.templateBody.includes(TOKEN_UNIVERSAL_RULES)
      ? `## Universal rules (apply to every persona)\n\n${rules}\n\n${args.agentBody.trim()}`
      : args.agentBody.trim()
  return args.templateBody
    .replaceAll(TOKEN_AGENT_BODY, agentBodyWithRules)
    .replaceAll(TOKEN_RATIONALIZATIONS, args.commonRationalizations.trim())
    .replaceAll(TOKEN_READY_SIGNAL, args.readySignal)
    .replaceAll(TOKEN_CONVERSATION, conversation)
    .replaceAll(TOKEN_UNIVERSAL_RULES, rules)
}

/**
 * Convenience wrapper: loads the bundled assets and composes the prompt.
 * Used by `src/phases/define.ts`. Tests typically call composeDefinePromptPure
 * directly with hand-crafted strings to avoid the cache.
 */
export async function composeDefinePrompt(input: ComposeDefinePromptInput): Promise<string> {
  const [templateBody, commonRationalizations, universalRules] = await Promise.all([
    loadDefineSystemTemplate(),
    loadCommonRationalizations(),
    loadUniversalRules(),
  ])
  return composeDefinePromptPure({
    templateBody,
    commonRationalizations,
    agentBody: input.agentBody,
    history: input.history,
    readySignal: input.readySignal,
    universalRules,
  })
}

// --- PLAN composer -------------------------------------------------

const TOKEN_AVAILABLE_TOOLS = '{{AVAILABLE_TOOLS}}'

const PLAN_REQUIRED_TOKENS = [
  TOKEN_AGENT_BODY,
  TOKEN_RATIONALIZATIONS,
  TOKEN_UNIVERSAL_RULES,
  TOKEN_AVAILABLE_TOOLS,
  TOKEN_CONVERSATION,
  TOKEN_READY_SIGNAL,
] as const

export interface ComposePlanPromptPureInput {
  readonly templateBody: string
  readonly universalRules: string
  readonly commonRationalizations: string
  readonly agentBody: string
  readonly history: readonly AskMeTurn[]
  readonly readySignal: string
  /** Names of tools the agent has access to via tool_use.repo_context.tools.
   *  When empty, the AVAILABLE_TOOLS slot says "(no tool_use scope declared)".
   *  The renderer only names tools the agent has permission to call (per
   *  Codex M6 "Where I agree" point 5). */
  readonly availableTools: readonly string[]
}

const TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  glob: '**glob** — list files matching a pattern. Args: `{ pattern, roots? }`. Returns paths relative to project root.',
  grep: '**grep** — search file contents. Args: `{ pattern, roots?, regex?, ignoreCase? }`. Returns `{ path, line, snippet }` per match (snippet capped at 200 chars).',
  read: '**read** — read a file slice. Args: `{ path, lineRange? }`. Returns content capped at 16 KB.',
  symbol: '**symbol** — LSP symbol search. Reserved for W3+; do not call in M6.',
})

export function composePlanPromptPure(args: ComposePlanPromptPureInput): string {
  for (const tok of PLAN_REQUIRED_TOKENS) {
    if (!args.templateBody.includes(tok)) {
      throw new Error(`plan-system.md is missing required token ${tok}`)
    }
  }
  const conversation = renderConversation(args.history)
  const availableTools = renderAvailableTools(args.availableTools)
  return args.templateBody
    .replaceAll(TOKEN_AGENT_BODY, args.agentBody.trim())
    .replaceAll(TOKEN_RATIONALIZATIONS, args.commonRationalizations.trim())
    .replaceAll(TOKEN_UNIVERSAL_RULES, args.universalRules.trim())
    .replaceAll(TOKEN_AVAILABLE_TOOLS, availableTools)
    .replaceAll(TOKEN_CONVERSATION, conversation)
    .replaceAll(TOKEN_READY_SIGNAL, args.readySignal)
}

function renderAvailableTools(tools: readonly string[]): string {
  if (tools.length === 0) return '(no tool_use scope declared on this persona)'
  const lines: string[] = []
  for (const t of tools) {
    const desc = TOOL_DESCRIPTIONS[t]
    if (desc !== undefined) {
      lines.push(`- ${desc}`)
    } else {
      lines.push(`- **${t}** — (no description registered)`)
    }
  }
  return lines.join('\n')
}

export interface ComposePlanPromptInput {
  readonly agentBody: string
  readonly history: readonly AskMeTurn[]
  readonly readySignal: string
  readonly availableTools: readonly string[]
}

export async function composePlanPrompt(input: ComposePlanPromptInput): Promise<string> {
  const [templateBody, commonRationalizations, universalRules] = await Promise.all([
    loadPlanSystemTemplate(),
    loadCommonRationalizations(),
    loadUniversalRules(),
  ])
  return composePlanPromptPure({
    templateBody,
    commonRationalizations,
    universalRules,
    agentBody: input.agentBody,
    history: input.history,
    readySignal: input.readySignal,
    availableTools: input.availableTools,
  })
}

// --- BUILD composer ------------------------------------------------
//
// Single-shot per task — BUILD does not carry a conversation across
// turns; one initial draft + at most one repair round (per Codex M7
// implementation review reject of decision 7, thread 019ddeea).

const BUILD_REQUIRED_TOKENS = [
  TOKEN_AGENT_BODY,
  TOKEN_RATIONALIZATIONS,
  TOKEN_UNIVERSAL_RULES,
  TOKEN_AVAILABLE_TOOLS,
  TOKEN_READY_SIGNAL,
] as const

export interface ComposeBuildPromptPureInput {
  readonly templateBody: string
  readonly universalRules: string
  readonly commonRationalizations: string
  readonly agentBody: string
  readonly readySignal: string
  /** Names of tools the BUILD persona has access to. */
  readonly availableTools: readonly string[]
}

export function composeBuildPromptPure(args: ComposeBuildPromptPureInput): string {
  for (const tok of BUILD_REQUIRED_TOKENS) {
    if (!args.templateBody.includes(tok)) {
      throw new Error(`build-system.md is missing required token ${tok}`)
    }
  }
  const availableTools = renderAvailableTools(args.availableTools)
  return args.templateBody
    .replaceAll(TOKEN_AGENT_BODY, args.agentBody.trim())
    .replaceAll(TOKEN_RATIONALIZATIONS, args.commonRationalizations.trim())
    .replaceAll(TOKEN_UNIVERSAL_RULES, args.universalRules.trim())
    .replaceAll(TOKEN_AVAILABLE_TOOLS, availableTools)
    .replaceAll(TOKEN_READY_SIGNAL, args.readySignal)
}

export interface ComposeBuildPromptInput {
  readonly agentBody: string
  readonly readySignal: string
  readonly availableTools: readonly string[]
}

export async function composeBuildPrompt(input: ComposeBuildPromptInput): Promise<string> {
  const [templateBody, commonRationalizations, universalRules] = await Promise.all([
    loadBuildSystemTemplate(),
    loadCommonRationalizations(),
    loadUniversalRules(),
  ])
  return composeBuildPromptPure({
    templateBody,
    commonRationalizations,
    universalRules,
    agentBody: input.agentBody,
    readySignal: input.readySignal,
    availableTools: input.availableTools,
  })
}

// --- VERIFY composer (M8) -----------------------------------------
//
// Mirrors the BUILD composer pattern. Single-shot per attempt: one
// initial draft + at most one repair round (Codex M8 decision 9
// modification: two total VERIFY drafts, not two repairs).

const VERIFY_REQUIRED_TOKENS = [
  TOKEN_AGENT_BODY,
  TOKEN_RATIONALIZATIONS,
  TOKEN_UNIVERSAL_RULES,
  TOKEN_AVAILABLE_TOOLS,
  TOKEN_READY_SIGNAL,
] as const

export interface ComposeVerifyPromptPureInput {
  readonly templateBody: string
  readonly universalRules: string
  readonly commonRationalizations: string
  readonly agentBody: string
  readonly readySignal: string
  /** Names of tools the VERIFY persona has access to (e.g., glob/grep/read + test-runner). */
  readonly availableTools: readonly string[]
}

export function composeVerifyPromptPure(args: ComposeVerifyPromptPureInput): string {
  for (const tok of VERIFY_REQUIRED_TOKENS) {
    if (!args.templateBody.includes(tok)) {
      throw new Error(`verify-system.md is missing required token ${tok}`)
    }
  }
  const availableTools = renderAvailableTools(args.availableTools)
  return args.templateBody
    .replaceAll(TOKEN_AGENT_BODY, args.agentBody.trim())
    .replaceAll(TOKEN_RATIONALIZATIONS, args.commonRationalizations.trim())
    .replaceAll(TOKEN_UNIVERSAL_RULES, args.universalRules.trim())
    .replaceAll(TOKEN_AVAILABLE_TOOLS, availableTools)
    .replaceAll(TOKEN_READY_SIGNAL, args.readySignal)
}

export interface ComposeVerifyPromptInput {
  readonly agentBody: string
  readonly readySignal: string
  readonly availableTools: readonly string[]
}

export async function composeVerifyPrompt(input: ComposeVerifyPromptInput): Promise<string> {
  const [templateBody, commonRationalizations, universalRules] = await Promise.all([
    loadVerifySystemTemplate(),
    loadCommonRationalizations(),
    loadUniversalRules(),
  ])
  return composeVerifyPromptPure({
    templateBody,
    commonRationalizations,
    universalRules,
    agentBody: input.agentBody,
    readySignal: input.readySignal,
    availableTools: input.availableTools,
  })
}

// --- REVIEW composer (M9) ----------------------------------------
//
// Mirrors VERIFY's composer with one extra dynamic slot: {{REVIEW_CONTEXT}}
// for the round-specific block (round number, upstream refs, changed-file
// manifest, VERIFY pass summary, prior scores/verdicts/findings). Per
// kickoff Decision 12: {{AGENT_BODY}} stays static across rounds; only
// {{REVIEW_CONTEXT}} changes per invocation.

const TOKEN_REVIEW_CONTEXT = '{{REVIEW_CONTEXT}}'

const REVIEW_REQUIRED_TOKENS = [
  TOKEN_AGENT_BODY,
  TOKEN_RATIONALIZATIONS,
  TOKEN_UNIVERSAL_RULES,
  TOKEN_AVAILABLE_TOOLS,
  TOKEN_READY_SIGNAL,
  TOKEN_REVIEW_CONTEXT,
] as const

export interface ComposeReviewPromptPureInput {
  readonly templateBody: string
  readonly universalRules: string
  readonly commonRationalizations: string
  readonly agentBody: string
  readonly readySignal: string
  /** Names of tools the REVIEW persona has access to (typically glob/grep/read). */
  readonly availableTools: readonly string[]
  /** Pre-rendered run-specific context block: round number, upstream refs,
   *  changed-file manifest, VERIFY pass summary, prior round digests. The
   *  caller (M9 commit 7 runReview) renders this from durable state; the
   *  composer treats it as opaque text. */
  readonly reviewContext: string
}

export function composeReviewPromptPure(args: ComposeReviewPromptPureInput): string {
  for (const tok of REVIEW_REQUIRED_TOKENS) {
    if (!args.templateBody.includes(tok)) {
      throw new Error(`review-system.md is missing required token ${tok}`)
    }
  }
  const availableTools = renderAvailableTools(args.availableTools)
  return args.templateBody
    .replaceAll(TOKEN_AGENT_BODY, args.agentBody.trim())
    .replaceAll(TOKEN_RATIONALIZATIONS, args.commonRationalizations.trim())
    .replaceAll(TOKEN_UNIVERSAL_RULES, args.universalRules.trim())
    .replaceAll(TOKEN_AVAILABLE_TOOLS, availableTools)
    .replaceAll(TOKEN_READY_SIGNAL, args.readySignal)
    .replaceAll(TOKEN_REVIEW_CONTEXT, args.reviewContext.trim())
}

export interface ComposeReviewPromptInput {
  readonly agentBody: string
  readonly readySignal: string
  readonly availableTools: readonly string[]
  readonly reviewContext: string
}

export async function composeReviewPrompt(input: ComposeReviewPromptInput): Promise<string> {
  const [templateBody, commonRationalizations, universalRules] = await Promise.all([
    loadReviewSystemTemplate(),
    loadCommonRationalizations(),
    loadUniversalRules(),
  ])
  return composeReviewPromptPure({
    templateBody,
    commonRationalizations,
    universalRules,
    agentBody: input.agentBody,
    readySignal: input.readySignal,
    availableTools: input.availableTools,
    reviewContext: input.reviewContext,
  })
}
