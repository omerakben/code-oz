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

    const parsed = tryParseJson(result.stdout)
    const content = parsed?.result ?? result.stdout.trimEnd()
    const tokensUsed = parsed?.usage?.output_tokens
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

function tryParseJson(raw: string): ClaudeJsonResult | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as ClaudeJsonResult
  } catch {
    return null
  }
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
