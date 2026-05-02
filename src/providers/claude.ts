// ClaudeProvider — A_lite via Claude Code CLI subprocess. Subscription-first
// auth model: relies on `claude login` (Claude Max OAuth handled by the CLI),
// never reads or transmits ~/.claude/auth.json directly.
//
// Privacy guards (rule 13: privacy by default; explicit file manifests):
//   - Run from an empty temp working directory, NOT the project root.
//     Claude Code auto-discovers CLAUDE.md files up the cwd hierarchy at
//     session start (per https://code.claude.com/docs/en/memory). Without
//     an empty cwd, the subprocess would inherit project + parent +
//     ancestor CLAUDE.md context outside the wrapper's explicit manifest.
//   - Pass `--no-session-persistence` so the print-mode session isn't
//     written to disk and can't be resumed (no on-disk artifact to leak
//     manifest content).
//   - Manifest content goes through stdin only (never via path arguments
//     or --add-dir flags that would expand the cwd surface).
//
// v0.1 limitations (documented in docs/contracts/PROVIDERS.md):
//   - No streaming UX through code-oz (CLI streams to its own stderr)
//   - tokensUsed is reported only when --output-format=json returns a usage
//     block (Claude Code's JSON output includes it as of late April 2026)
//   - No mid-turn tool_call event surfacing — the CLI handles tools internally
//
// W3 upgrade path: drop the subprocess and reuse the IAgentProvider contract
// with a direct HTTP integration. Wrapper (commit 7) is unchanged.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { capabilityOf, type ProviderCapability } from './capabilities.ts'
import { providerError } from './errors.ts'
import { defaultRunner, type Runner, type RunnerResult } from './runner.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
} from './types.ts'

export interface ClaudeProviderOptions {
  /** Override the CLI binary (defaults to `claude` on PATH). */
  readonly cliPath?: string
  /** Inject a runner for testing — never spawns a real process when supplied. */
  readonly runner?: Runner
  /** Override the temp cwd factory for testing the privacy guard. */
  readonly tempCwd?: () => Promise<string>
}

export class ClaudeProvider implements IAgentProvider {
  readonly id = 'claude' as const
  readonly family = 'claude' as const
  readonly capability: ProviderCapability = capabilityOf('claude')
  private readonly cliPath: string
  private readonly runner: Runner
  private readonly tempCwd: () => Promise<string>

  constructor(opts: ClaudeProviderOptions = {}) {
    this.cliPath = opts.cliPath ?? 'claude'
    this.runner = opts.runner ?? defaultRunner
    this.tempCwd = opts.tempCwd ?? (() => mkdtemp(join(tmpdir(), 'code-oz-claude-')))
  }

  async *invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    const stdin = renderStdin(req)
    const args = ['--print', '--output-format', 'json', '--no-session-persistence']
    if (req.model !== undefined) args.push('--model', req.model)

    const cwd = await this.tempCwd()
    let result: RunnerResult
    try {
      result = await this.runner(this.cliPath, args, { stdin, cwd })
    } catch (err) {
      throw spawnFailure(err, 'claude', this.cliPath)
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
    }

    if (result.exitCode !== 0) {
      throw nonZeroExit(result, 'claude')
    }

    const parsed = parseClaudeOutput(result.stdout)
    const content = parsed?.content ?? result.stdout.trimEnd()
    const tokensUsed = parsed?.tokensUsed
    const model = parsed?.model ?? req.model ?? 'claude-default'

    yield { type: 'turn_started', model }
    if (content !== '') {
      yield { type: 'content_chunk', text: content }
    }
    yield {
      type: 'turn_completed',
      response: {
        content,
        ...(tokensUsed !== undefined ? { tokensUsed } : {}),
        model,
        stopReason: 'end_turn',
      },
    }
  }

  async health(): Promise<ProviderHealth> {
    let result: RunnerResult
    try {
      result = await this.runner(this.cliPath, ['--version'])
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return Object.freeze({
        provider: 'claude' as const,
        authStatus: code === 'ENOENT' ? ('missing' as const) : ('unknown' as const),
        modelDefaultAvailable: false,
        lastError: {
          code: 'provider_io_error',
          rule:
            code === 'ENOENT'
              ? 'claude CLI not found in PATH'
              : 'failed to probe claude CLI',
          detail: (err as Error).message,
        },
      })
    }

    if (result.exitCode === 0) {
      return Object.freeze({
        provider: 'claude' as const,
        authStatus: 'ok' as const,
        modelDefaultAvailable: true,
      })
    }
    return Object.freeze({
      provider: 'claude' as const,
      authStatus: 'unknown' as const,
      modelDefaultAvailable: false,
      lastError: {
        code: 'provider_io_error',
        rule: `claude --version exited with status ${result.exitCode}`,
        detail: result.stderr.trim() || result.stdout.trim(),
      },
    })
  }
}

// --- helpers --------------------------------------------------------

interface ClaudeJsonResult {
  readonly result?: string
  readonly model?: string
  readonly usage?: { readonly output_tokens?: number }
}

interface ParsedClaudeOutput {
  readonly content: string
  readonly model?: string
  readonly tokensUsed?: number
}

/**
 * Parse `claude --print --output-format json` stdout. Two formats observed:
 *
 * 1. Single object (older CLI versions, ~2025): `{result, model, usage}`.
 * 2. Stream array (Claude Code 2.1+, late 2025 and current): an array of
 *    stream events including `{type:'system'/'init'}`, `{type:'assistant'}`,
 *    `{type:'rate_limit_event'}`, and a final `{type:'result', subtype, result, usage, modelUsage}`.
 *
 * Returns null when the raw text is not parseable JSON of either shape, so
 * the caller can fall back to the raw stdout for diagnostic visibility.
 */
export function parseClaudeOutput(raw: string): ParsedClaudeOutput | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null) return null

  if (Array.isArray(parsed)) return extractFromStreamArray(parsed)

  if (typeof parsed === 'object') {
    const obj = parsed as ClaudeJsonResult
    if (typeof obj.result !== 'string') return null
    const out: ParsedClaudeOutput = {
      content: obj.result,
      ...(obj.model !== undefined ? { model: obj.model } : {}),
      ...(obj.usage?.output_tokens !== undefined
        ? { tokensUsed: obj.usage.output_tokens }
        : {}),
    }
    return out
  }

  return null
}

/** Extract assistant text + usage from a stream-array stdout shape. */
function extractFromStreamArray(events: readonly unknown[]): ParsedClaudeOutput | null {
  let resultEvent: { result?: string; usage?: { output_tokens?: number }; modelUsage?: Record<string, { outputTokens?: number }> } | null = null
  let initModel: string | undefined
  const assistantTexts: string[] = []

  for (const ev of events) {
    if (ev === null || typeof ev !== 'object') continue
    const e = ev as { type?: string; subtype?: string; model?: string; message?: { content?: unknown[] }; result?: string; usage?: { output_tokens?: number }; modelUsage?: Record<string, { outputTokens?: number }> }
    if (e.type === 'system' && e.subtype === 'init' && typeof e.model === 'string') {
      initModel = e.model
    }
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const block of e.message.content) {
        if (block !== null && typeof block === 'object') {
          const b = block as { type?: string; text?: string }
          if (b.type === 'text' && typeof b.text === 'string') {
            assistantTexts.push(b.text)
          }
        }
      }
    }
    if (e.type === 'result' && typeof e.result === 'string') {
      resultEvent = e
    }
  }

  // Prefer the result event's `result` string (canonical end-of-turn text).
  // Fall back to concatenated assistant text blocks if no result event present
  // (e.g., truncated stream, error path).
  let content: string
  if (resultEvent !== null) {
    content = resultEvent.result ?? ''
  } else if (assistantTexts.length > 0) {
    content = assistantTexts.join('\n')
  } else {
    return null
  }

  let tokensUsed: number | undefined
  if (resultEvent?.usage?.output_tokens !== undefined) {
    tokensUsed = resultEvent.usage.output_tokens
  } else if (resultEvent?.modelUsage !== undefined) {
    let total = 0
    let any = false
    for (const v of Object.values(resultEvent.modelUsage)) {
      if (v?.outputTokens !== undefined) {
        total += v.outputTokens
        any = true
      }
    }
    if (any) tokensUsed = total
  }

  const out: ParsedClaudeOutput = {
    content,
    ...(initModel !== undefined ? { model: initModel } : {}),
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
  }
  return out
}

function renderStdin(req: PreparedProviderRequest): string {
  if (req.files.length === 0) return req.prompt
  const parts: string[] = [req.prompt, '', 'Files in scope:']
  for (const f of req.files) {
    parts.push('', `=== ${f.path} ===`, f.content.toString('utf8'))
  }
  return parts.join('\n')
}

function spawnFailure(err: unknown, providerName: string, cliPath: string): Error {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') {
    return providerError(
      'provider_io_error',
      `${providerName} CLI not found in PATH`,
      [
        `install ${providerName === 'claude' ? 'Claude Code' : providerName} and ensure ${cliPath} is on PATH`,
        `verify \`${cliPath} --version\` runs successfully`,
      ],
      (err as Error).message,
    )
  }
  return providerError(
    'provider_io_error',
    `failed to spawn ${providerName} CLI subprocess`,
    [`check that ${cliPath} is installed and executable`],
    (err as Error).message,
  )
}

function nonZeroExit(result: RunnerResult, providerName: string): Error {
  const stderr = result.stderr.toLowerCase()
  if (
    stderr.includes('not logged in') ||
    stderr.includes('please log in') ||
    stderr.includes('authentication failed') ||
    stderr.includes('login required')
  ) {
    return providerError(
      'provider_auth_missing',
      `${providerName} CLI reported an authentication failure`,
      [`run \`${providerName} login\` to authenticate`],
      result.stderr.trim(),
    )
  }
  return providerError(
    'provider_io_error',
    `${providerName} CLI exited with non-zero status ${result.exitCode}`,
    [
      `check \`${providerName} --version\` and \`${providerName} --help\``,
      'inspect the CLI stderr for diagnostics',
    ],
    result.stderr.trim() || result.stdout.trim(),
  )
}

// Exported so codex.ts can reuse the same auth-stderr detection without
// duplicating the keyword list.
export { spawnFailure as _spawnFailure, nonZeroExit as _nonZeroExit, renderStdin as _renderStdin }
