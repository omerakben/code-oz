// CodexProvider — A_lite via OpenAI Codex CLI subprocess. Subscription-first
// auth model: relies on `codex login` (ChatGPT Plus/Pro OAuth handled by the
// CLI), never reads or transmits ~/.codex/auth.json directly. Health probe
// is `codex login status`, not auth-file parsing — Codex CLI tokens may
// refresh during use and may live in the OS credential store on some
// platforms, so the CLI's own status command is the canonical authority.
//
// Privacy guards (rule 13: privacy by default; explicit file manifests):
//   - Run from an empty temp working directory, NOT the project root.
//     Without this, Codex would recursively scan its cwd and bypass the
//     wrapper's permission-intersected manifest.
//   - Pass manifest content via stdin, not via path arguments or `-C` flag.
//   - Pass `--skip-git-repo-check` (empty temp dir is not a git repo) and
//     `--sandbox read-only` (no shell mutations, no network from inside the
//     sandbox) and `--ephemeral` (no session files persisted).
//
// v0.1 limitations (documented in docs/contracts/PROVIDERS.md):
//   - No streaming UX through code-oz (CLI streams to stderr in interactive
//     mode; exec mode buffers final answer to stdout).
//   - No tool_call event surfacing — Codex's internal tool use is opaque to
//     the wrapper. The streaming tool-call cap in src/providers/invoke.ts
//     is a no-op for Codex calls in v0.1.
//   - No tokensUsed provenance (codex exec text output doesn't expose it).
//
// W3 upgrade path: drop the subprocess and adopt opencode's pattern (OAuth+
// PKCE → chatgpt.com/backend-api/codex/responses) for native streaming +
// tool-call capture. IAgentProvider contract is unchanged.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { capabilityOf, type ProviderCapability } from './capabilities.ts'
import { defaultRunner, type Runner, type RunnerResult } from './runner.ts'
import { _renderStdin, _nonZeroExit, _spawnFailure } from './claude.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
} from './types.ts'

export interface CodexProviderOptions {
  /** Override the CLI binary (defaults to `codex` on PATH). */
  readonly cliPath?: string
  /** Inject a runner for testing — never spawns a real process when supplied. */
  readonly runner?: Runner
  /** Override the temp cwd factory for testing the privacy guard. */
  readonly tempCwd?: () => Promise<string>
}

export class CodexProvider implements IAgentProvider {
  readonly id = 'codex' as const
  readonly family = 'codex' as const
  readonly capability: ProviderCapability = capabilityOf('codex')
  private readonly cliPath: string
  private readonly runner: Runner
  private readonly tempCwd: () => Promise<string>

  constructor(opts: CodexProviderOptions = {}) {
    this.cliPath = opts.cliPath ?? 'codex'
    this.runner = opts.runner ?? defaultRunner
    this.tempCwd = opts.tempCwd ?? (() => mkdtemp(join(tmpdir(), 'code-oz-codex-')))
  }

  async *invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    const stdin = _renderStdin(req)
    const args: string[] = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--color',
      'never',
      '-', // read prompt from stdin
    ]
    if (req.model !== undefined) {
      args.splice(args.length - 1, 0, '--model', req.model)
    }

    const cwd = await this.tempCwd()
    let result: RunnerResult
    try {
      result = await this.runner(this.cliPath, args, { stdin, cwd })
    } catch (err) {
      throw _spawnFailure(err, 'codex', this.cliPath)
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
    }

    if (result.exitCode !== 0) {
      throw _nonZeroExit(result, 'codex')
    }

    const content = result.stdout.trimEnd()
    const model = req.model ?? 'codex-default'
    const responseId = extractCodexResponseId(result.stdout)

    yield { type: 'turn_started', model }
    if (content !== '') {
      yield { type: 'content_chunk', text: content }
    }
    yield {
      type: 'turn_completed',
      response: {
        content,
        model,
        ...(responseId !== undefined ? { responseId } : {}),
        stopReason: 'end_turn',
        // tokensUsed deliberately omitted — codex exec text mode doesn't
        // expose token counts, and the wrapper falls back to the recorded
        // tokensEstimate for budget accounting.
      },
    }
  }

  async health(): Promise<ProviderHealth> {
    let result: RunnerResult
    try {
      result = await this.runner(this.cliPath, ['login', 'status'])
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return Object.freeze({
        provider: 'codex' as const,
        authStatus: code === 'ENOENT' ? ('missing' as const) : ('unknown' as const),
        modelDefaultAvailable: false,
        lastError: {
          code: 'provider_io_error',
          rule:
            code === 'ENOENT'
              ? 'codex CLI not found in PATH'
              : 'failed to probe codex CLI',
          detail: (err as Error).message,
        },
      })
    }

    if (result.exitCode === 0) {
      // codex login status writes "Logged in using ChatGPT" to stderr (as of
      // codex-cli ~0.125.0). Some future version might switch to stdout, so
      // check both streams to be drift-tolerant.
      const out = (result.stdout + ' ' + result.stderr).toLowerCase()
      if (out.includes('logged in')) {
        return Object.freeze({
          provider: 'codex' as const,
          authStatus: 'ok' as const,
          modelDefaultAvailable: true,
        })
      }
      // Zero exit but no "logged in" string — treat as missing rather than
      // ok, since the user may need to run `codex login`.
      return Object.freeze({
        provider: 'codex' as const,
        authStatus: 'missing' as const,
        modelDefaultAvailable: false,
        lastError: {
          code: 'provider_auth_missing',
          rule: 'codex login status did not report `logged in`',
          detail: (result.stderr.trim() + ' ' + result.stdout.trim()).trim(),
        },
      })
    }

    // Non-zero exit — typically means CLI is installed but not logged in.
    const stderr = (result.stderr + ' ' + result.stdout).toLowerCase()
    const looksLikeAuth =
      stderr.includes('not logged in') ||
      stderr.includes('please log in') ||
      stderr.includes('login')
    return Object.freeze({
      provider: 'codex' as const,
      authStatus: looksLikeAuth ? ('missing' as const) : ('unknown' as const),
      modelDefaultAvailable: false,
      lastError: {
        code: 'provider_io_error',
        rule: `codex login status exited with status ${result.exitCode}`,
        detail: result.stderr.trim() || result.stdout.trim(),
      },
    })
  }
}

function extractCodexResponseId(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  return findResponseId(parsed)
}

function findResponseId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findResponseId(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  const responseId = stringField(obj, 'response_id')
  if (responseId !== undefined) return responseId
  const response = obj.response
  if (response !== null && typeof response === 'object' && !Array.isArray(response)) {
    const nested = stringField(response as Record<string, unknown>, 'id')
    if (nested !== undefined) return nested
  }
  const id = stringField(obj, 'id')
  if (id !== undefined && looksLikeCodexMetadata(obj)) return id
  return undefined
}

function looksLikeCodexMetadata(obj: Readonly<Record<string, unknown>>): boolean {
  return (
    stringField(obj, 'object') === 'response' ||
    stringField(obj, 'type') === 'response' ||
    (obj.usage !== null && typeof obj.usage === 'object') ||
    typeof obj.model === 'string'
  )
}

function stringField(obj: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = obj[key]
  return typeof value === 'string' ? value : undefined
}
