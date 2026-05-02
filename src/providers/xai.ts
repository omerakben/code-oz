// XaiProvider — direct HTTP adapter to xAI's chat-completions endpoint.
// First HTTP-based IAgentProvider in code-oz; first time the runtime reads
// an API key from env and transmits it directly to an upstream over HTTPS.
//
// Authority boundary (CLAUDE.md rule 20): outbound HTTP from code-oz +
// API-key trust-boundary expansion. Pinned in:
//   - docs/design/SESSION_PE1_KICKOFF.md
//   - docs/design/SESSION_XAI_EXPANSION_KICKOFF.md (Codex thread 019de497)
//   - docs/research/CODEX_RESPONSE_PE1.md (Codex thread 019de5df)
//
// Trust-boundary discipline (per provider-contract.md § "API-key
// transmission for HTTP adapters" + Codex Blocker #3):
//   - XAI_API_KEY read from env at INVOKE time, never construction time
//   - API key never appears in ProviderError.detail / err.message / events /
//     gates / doctor output / any artifact
//   - Authorization headers stripped from any logging
//   - Request body is STRICT ALLOWLIST: only model + messages + optional
//     max_tokens. NO `tools`, `tool_choice`, `parallel_tool_calls`,
//     `search_parameters`, `background`, `store`, `stream`. Built-in xAI
//     server-side tools (web_search, x_search, code_interpreter) are
//     disabled by field omission, not by `tools: []` (Codex Q3 + scope
//     correction)
//   - HTTP error detail is sanitized: status only, never raw body or headers
//
// Locked open-question resolutions (per CODEX_RESPONSE_PE1.md):
//   Q2: POST https://api.x.ai/v1/chat/completions, OpenAI-compatible
//       buffered subset (model + messages + optional max_tokens)
//   Q3: omit tool/search fields entirely
//   Q4: buffered (no streaming surface in PE-1)
//   Q5: tokensUsed populated from usage.completion_tokens when present
//   Q6: Bun.fetch (default fetch); injectable runner for tests
//
// xAI labels chat-completions as "legacy" in favor of /v1/responses.
// PE-1 stays on chat-completions because Responses introduces storage /
// tooling semantics that need their own contract decision (Codex scope
// correction). The forward path is documented in
// docs/design/SESSION_XAI_EXPANSION_KICKOFF.md "Open follow-ups".

import { capabilityOf, type ProviderCapability } from './capabilities.ts'
import { providerError } from './errors.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
} from './types.ts'

/** Default xAI API base URL. Internal constant; not a public config. */
const DEFAULT_BASE_URL = 'https://api.x.ai/v1'

/**
 * Fetch-like runner. Default uses globalThis fetch (Bun.fetch). Tests
 * inject a mock that returns canned Response objects, so the offline
 * suite never makes a real HTTP request (rule 8).
 */
export type FetchRunner = (input: string, init: RequestInit) => Promise<Response>

export interface XaiProviderOptions {
  /** Inject a fetch-like runner for testing — never makes a real request when supplied. */
  readonly runner?: FetchRunner
  /**
   * Override the xAI base URL. Test-only seam; not exposed in user-facing
   * config (Codex Q6 lock: "no public gateway/base-url config in PE-1").
   */
  readonly baseUrl?: string
}

export class XaiProvider implements IAgentProvider {
  readonly id = 'xai' as const
  readonly family = 'xai' as const
  readonly capability: ProviderCapability = capabilityOf('xai')
  private readonly runner: FetchRunner
  private readonly baseUrl: string

  constructor(opts: XaiProviderOptions = {}) {
    this.runner = opts.runner ?? defaultFetchRunner
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
  }

  async *invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    const apiKey = readApiKey()
    const requestedModel = requireExplicitModel(req)

    const body = buildRequestBody(req)
    const url = `${this.baseUrl}/chat/completions`

    let res: Response
    try {
      res = await this.runner(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      })
    } catch (err: unknown) {
      throw networkFailure(err)
    }

    if (!res.ok) {
      throw mapHttpError(res.status)
    }

    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      throw providerError(
        'provider_malformed_response',
        'xai response body was not valid JSON',
        ['rerun; if persistent, the upstream API may have changed shape'],
      )
    }

    const { content, tokensUsed, model } = extractResponseFields(parsed, requestedModel)

    yield { type: 'turn_started', model }
    yield { type: 'content_chunk', text: content }
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
    const rawKey = (process.env.XAI_API_KEY ?? '').trim()
    if (rawKey === '') {
      return Object.freeze({
        provider: 'xai' as const,
        authStatus: 'missing' as const,
        modelDefaultAvailable: false,
        lastError: {
          code: 'provider_auth_missing',
          rule: 'XAI_API_KEY env var is missing or empty',
        },
      })
    }

    let res: Response
    try {
      res = await this.runner(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${rawKey}` },
      })
    } catch (err: unknown) {
      return Object.freeze({
        provider: 'xai' as const,
        authStatus: 'unknown' as const,
        modelDefaultAvailable: false,
        lastError: {
          code: 'provider_io_error',
          rule: 'failed to reach xai /v1/models endpoint',
          detail: sanitizeFetchError(err),
        },
      })
    }

    if (res.status === 200) {
      // /v1/models 200 means the API key can list models; it does NOT
      // prove the configured role model is valid (per Codex Risk #4).
      // The first invocation that uses an invalid model will fail at
      // runtime with provider_io_error 400. modelDefaultAvailable: true
      // here means "at least some model is available," consistent with
      // existing claude / codex semantics.
      return Object.freeze({
        provider: 'xai' as const,
        authStatus: 'ok' as const,
        modelDefaultAvailable: true,
      })
    }
    if (res.status === 401) {
      return Object.freeze({
        provider: 'xai' as const,
        authStatus: 'missing' as const,
        modelDefaultAvailable: false,
        lastError: {
          code: 'provider_auth_missing',
          rule: 'xai /v1/models returned 401 (invalid or expired API key)',
        },
      })
    }
    return Object.freeze({
      provider: 'xai' as const,
      authStatus: 'unknown' as const,
      modelDefaultAvailable: false,
      lastError: {
        code: 'provider_io_error',
        rule: `xai /v1/models returned HTTP ${res.status}`,
      },
    })
  }
}

// --- helpers --------------------------------------------------------

const defaultFetchRunner: FetchRunner = (input, init) => fetch(input, init)

/**
 * Read XAI_API_KEY from env. Throws provider_auth_missing on absence or
 * blank-after-trim. Read at invoke time, not construction time, so a
 * test runner that constructs the adapter without the env still passes
 * (the wrapper layer surfaces the missing-key error, not the import path).
 */
function readApiKey(): string {
  const raw = (process.env.XAI_API_KEY ?? '').trim()
  if (raw === '') {
    throw providerError(
      'provider_auth_missing',
      'XAI_API_KEY env var is missing or empty',
      ['export XAI_API_KEY=<your-xai-api-key> and rerun'],
    )
  }
  return raw
}

/**
 * xAI's chat-completions endpoint requires `model`. Persona frontmatter
 * `model` is optional, so a config that names xAI without an explicit
 * model would otherwise produce an upstream 400 with leaky body content.
 * Surface this as a typed error before the network call (Codex Blocker #2).
 */
function requireExplicitModel(req: PreparedProviderRequest): string {
  if (req.model === undefined) {
    throw providerError(
      'provider_model_missing',
      'xai provider requires an explicit model binding (the upstream endpoint mandates `model` in the request)',
      [
        'set persona frontmatter `model: <grok-variant>` in the agent declaring `provider: xai`',
        'or set company.<role>.model in .code-oz/config.yaml when overriding role routing via the company:block',
      ],
    )
  }
  return req.model
}

/**
 * STRICT ALLOWLIST request body. Only the v0.1 PE-1 fields land in the
 * outbound request (Codex Q3 lock + scope correction). Sending an
 * exhaustive allowlist instead of an opt-out is what keeps built-in
 * server-side tools (web_search, x_search, code_interpreter) disabled
 * by field omission rather than by an empty array a future change might
 * mutate.
 */
function buildRequestBody(req: PreparedProviderRequest): string {
  const messages = renderMessages(req)
  const allowlistedBody: Record<string, unknown> = {
    model: req.model,
    messages,
  }
  if (req.maxOutputTokens !== undefined) {
    allowlistedBody.max_tokens = req.maxOutputTokens
  }
  return JSON.stringify(allowlistedBody)
}

interface ChatMessage {
  readonly role: 'user'
  readonly content: string
}

/**
 * Render the prompt + manifest files into a single user-message body.
 * Mirrors claude.ts's `_renderStdin`: phase code composes the persona
 * body into `req.prompt` upstream, so a single user message is correct
 * for v0.1.
 */
function renderMessages(req: PreparedProviderRequest): readonly ChatMessage[] {
  if (req.files.length === 0) {
    return [{ role: 'user', content: req.prompt }]
  }
  const fileBlocks: string[] = ['Files in scope:']
  for (const f of req.files) {
    fileBlocks.push('', `=== ${f.path} ===`, f.content.toString('utf8'))
  }
  return [{ role: 'user', content: `${req.prompt}\n\n${fileBlocks.join('\n')}` }]
}

/**
 * Map an HTTP status code (non-2xx response) to a typed ProviderError.
 * Detail field carries ONLY the status — never the response body, never
 * any header. Per Codex Risk #2: raw upstream bodies can echo prompts
 * or file content; sanitized status-only detail is the safe form.
 */
function mapHttpError(status: number): Error {
  if (status === 401) {
    return providerError(
      'provider_auth_missing',
      'xai endpoint returned 401 (invalid or expired API key)',
      ['export a fresh XAI_API_KEY=<value> and rerun'],
      `HTTP ${status}`,
    )
  }
  if (status === 403) {
    return providerError(
      'provider_permissions_violation',
      'xai endpoint returned 403 (key lacks required scopes or models)',
      ['check API-key scopes and enabled models on the xai account'],
      `HTTP ${status}`,
    )
  }
  if (status === 429) {
    return providerError(
      'provider_rate_limit',
      'xai endpoint returned 429 (rate limit exceeded)',
      [
        'wait and retry',
        'or raise budgets.global.maxProviderCalls in .code-oz/config.yaml if the cap is the cause',
      ],
      `HTTP ${status}`,
    )
  }
  if (status >= 500) {
    return providerError(
      'provider_io_error',
      `xai endpoint returned HTTP ${status} (upstream transient error)`,
      ['retry; if persistent, file an issue with the upstream'],
      `HTTP ${status}`,
    )
  }
  // 400 and other 4xx — likely a malformed request (invalid model name,
  // unsupported field, etc.). Map to provider_io_error rather than
  // provider_malformed_response: the latter is reserved for "upstream
  // API shape changed."
  return providerError(
    'provider_io_error',
    `xai endpoint returned HTTP ${status}`,
    [
      'verify the configured model name is a valid Grok variant',
      'rerun; if persistent, inspect the request shape',
    ],
    `HTTP ${status}`,
  )
}

/**
 * Network-layer failure (DNS, connect, TLS, abort, etc.). Detail is
 * sanitized to the error class name and the FIRST 200 chars of the
 * message. Bun.fetch errors do not carry headers or response body in
 * their messages, but the truncation is defense-in-depth against any
 * future error shape that might.
 */
function networkFailure(err: unknown): Error {
  return providerError(
    'provider_io_error',
    'failed to reach xai endpoint',
    [
      'check network connectivity',
      'verify https://api.x.ai is reachable from this machine',
    ],
    sanitizeFetchError(err),
  )
}

function sanitizeFetchError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name || 'Error'
    const message = (err.message || '').slice(0, 200)
    return `${name}: ${message}`
  }
  return 'fetch failed'
}

interface ParsedFields {
  readonly content: string
  readonly tokensUsed: number | undefined
  readonly model: string
}

/**
 * Pull the response fields code-oz cares about out of the parsed JSON.
 * Tolerant of upstream variants but rejects any shape that doesn't
 * expose a non-empty content string (PE-1 doesn't request tools, so a
 * tool-only stop is not expected and would be malformed).
 */
function extractResponseFields(parsed: unknown, requestedModel: string): ParsedFields {
  if (parsed === null || typeof parsed !== 'object') {
    throw providerError(
      'provider_malformed_response',
      'xai response root was not a JSON object',
      ['rerun; if persistent, the upstream API may have changed shape'],
    )
  }
  const root = parsed as Record<string, unknown>
  const choices = root.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw providerError(
      'provider_malformed_response',
      'xai response had no choices array',
      ['rerun; if persistent, the upstream API may have changed shape'],
    )
  }
  const message = (choices[0] as { message?: unknown }).message
  const messageContent =
    message !== null && typeof message === 'object'
      ? (message as { content?: unknown }).content
      : undefined
  if (typeof messageContent !== 'string' || messageContent.length === 0) {
    throw providerError(
      'provider_malformed_response',
      'xai response had empty or missing choices[0].message.content',
      ['rerun; if persistent, the upstream API may have changed shape'],
    )
  }
  const usage = root.usage
  const tokensUsed =
    usage !== null &&
    typeof usage === 'object' &&
    typeof (usage as { completion_tokens?: unknown }).completion_tokens === 'number'
      ? ((usage as { completion_tokens: number }).completion_tokens)
      : undefined
  const responseModel = typeof root.model === 'string' ? root.model : requestedModel

  return { content: messageContent, tokensUsed, model: responseModel }
}

// Exports for tests that need to assert the request-body allowlist or
// the sanitization helpers without going through invoke().
export { buildRequestBody as _buildRequestBody, sanitizeFetchError as _sanitizeFetchError }
