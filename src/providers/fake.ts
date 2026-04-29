// FakeProvider — deterministic, offline. Used by every spine test in M5-M7
// (and any future test that exercises phase logic without spending real
// tokens). Scripted expectations let tests pre-stage exact responses for
// specific (phase, agent) pairs; the fallback default response makes broad
// integration tests easy to author without staging every call.
//
// Two modes:
//   - strict: false (default) — unscripted (phase, agent) pairs return the
//     fallback default response. Lets a test set up the one or two specific
//     calls it cares about and rely on defaults elsewhere.
//   - strict: true — unscripted calls throw. Use when a test must assert
//     "exactly these calls and no others happened."
//
// Failure-mode injection: fake.expect({...}).fail({...}) queues a
// ProviderError for that (phase, agent) pair, exercising the wrapper
// layer's NEEDS_INTERVENTION + intervention event path.

import { ProviderError, providerError, type ProviderErrorIssue } from './errors.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
  ProviderResponse,
  ProviderToolCall,
  StopReason,
} from './types.ts'
import type { Phase } from '../state/schemas.ts'

// --- public scripting types ---------------------------------------

export interface FakeMatch {
  /** When set, only requests for this phase match. */
  readonly phase?: Phase
  /** When set, only requests for this agent name match. */
  readonly agent?: string
}

export interface FakeResponse {
  readonly content?: string
  readonly tokensUsed?: number
  readonly model?: string
  readonly stopReason?: StopReason
  readonly toolCalls?: readonly ProviderToolCall[]
  /**
   * Optional pre-completion chunks. Each yields a content_chunk event in
   * order before the final turn_completed event. Useful for tests that need
   * to assert streaming behavior; defaults to a single chunk equal to
   * `content` if non-empty.
   */
  readonly chunks?: readonly string[]
}

export interface FakeProviderOptions {
  /**
   * When true, unscripted (phase, agent) pairs throw rather than falling
   * back to the default response. Per-test override; defaults to false so
   * spine tests can author broad integration scenarios without staging
   * every call.
   */
  readonly strict?: boolean
  /**
   * Default response for unscripted calls when strict is false. Defaults to
   * a generic stub if not supplied.
   */
  readonly defaultResponse?: FakeResponse
}

// --- internal state ----------------------------------------------

type QueuedAction =
  | { readonly kind: 'respond'; readonly response: FakeResponse }
  | { readonly kind: 'fail'; readonly issues: readonly ProviderErrorIssue[] }

interface QueuedExpectation {
  readonly match: FakeMatch
  readonly queue: QueuedAction[]
}

// --- the builder API ---------------------------------------------

export interface FakeExpectationBuilder {
  /** Queue a successful response for this match. */
  respondWith(response: FakeResponse): FakeExpectationBuilder
  /** Queue a ProviderError for this match. */
  fail(issue: ProviderErrorIssue | readonly ProviderErrorIssue[]): FakeExpectationBuilder
}

// --- the provider -----------------------------------------------

export class FakeProvider implements IAgentProvider {
  readonly id = 'fake' as const
  readonly family = 'fake' as const

  private readonly expectations: QueuedExpectation[] = []
  private readonly strict: boolean
  private readonly defaultResponse: FakeResponse

  constructor(opts: FakeProviderOptions = {}) {
    this.strict = opts.strict ?? false
    this.defaultResponse = opts.defaultResponse ?? {
      content: 'fake response',
      tokensUsed: 50,
      model: 'fake-default',
      stopReason: 'end_turn',
    }
  }

  /**
   * Register an expectation. Returns a builder that queues responses (or
   * failures) for that match. Multiple calls on the same builder enqueue
   * additional responses; a subsequent invoke() consumes them FIFO until
   * the queue is empty, then returns the fallback default response (or
   * throws in strict mode).
   *
   * Most-specific match wins: phase + agent > phase-only > agent-only.
   * Within a single expectation, responses are consumed FIFO. Failure
   * matches are not lookahead-ed; the first matching expectation with a
   * non-empty queue returns its head action.
   */
  expect(match: FakeMatch): FakeExpectationBuilder {
    const expectation: QueuedExpectation = { match, queue: [] }
    this.expectations.push(expectation)
    const builder: FakeExpectationBuilder = {
      respondWith: (response) => {
        expectation.queue.push({ kind: 'respond', response })
        return builder
      },
      fail: (issue) => {
        const issues = Array.isArray(issue) ? issue : [issue as ProviderErrorIssue]
        expectation.queue.push({ kind: 'fail', issues })
        return builder
      },
    }
    return builder
  }

  /**
   * Drop every expectation. Useful between test cases sharing one
   * FakeProvider instance.
   */
  reset(): void {
    this.expectations.length = 0
  }

  async *invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    const action = this.consumeAction(req)
    if (action.kind === 'fail') {
      throw new ProviderError(action.issues)
    }

    const response = mergeResponse(action.response, this.defaultResponse)

    yield { type: 'turn_started', model: response.model }

    const chunks = response.chunks ?? (response.content !== '' ? [response.content] : [])
    for (const text of chunks) {
      yield { type: 'content_chunk', text }
    }

    if (response.toolCalls !== undefined) {
      for (const call of response.toolCalls) {
        yield { type: 'tool_call', call }
      }
    }

    yield {
      type: 'turn_completed',
      response: {
        content: response.content,
        ...(response.tokensUsed !== undefined ? { tokensUsed: response.tokensUsed } : {}),
        ...(response.toolCalls !== undefined ? { toolCalls: response.toolCalls } : {}),
        model: response.model,
        stopReason: response.stopReason,
      },
    }
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: 'fake',
      authStatus: 'ok',
      modelDefaultAvailable: true,
      latencyMs: 0,
    }
  }

  // --- internals -----------------------------------------------

  private consumeAction(req: PreparedProviderRequest): QueuedAction {
    const candidate = this.matchExpectation(req)
    if (candidate !== null) {
      const action = candidate.queue.shift()
      if (action !== undefined) return action
    }
    if (this.strict) {
      throw providerError(
        'provider_io_error',
        `FakeProvider in strict mode and no expectation matched (phase=${req.phase}, agent=${req.agent.name})`,
        [
          'register a fake.expect({...}).respondWith({...}) for this combination',
          'or construct FakeProvider({ strict: false }) to fall back to a default',
        ],
      )
    }
    return { kind: 'respond', response: this.defaultResponse }
  }

  private matchExpectation(req: PreparedProviderRequest): QueuedExpectation | null {
    // Score each expectation by specificity; highest score wins. Ties
    // break on insertion order so tests can stage replacements explicitly
    // (a later expect() with the same match wins after the earlier queue
    // is drained).
    let best: QueuedExpectation | null = null
    let bestScore = -1
    for (const e of this.expectations) {
      if (e.queue.length === 0) continue
      if (e.match.phase !== undefined && e.match.phase !== req.phase) continue
      if (e.match.agent !== undefined && e.match.agent !== req.agent.name) continue
      const score = (e.match.phase !== undefined ? 2 : 0) + (e.match.agent !== undefined ? 1 : 0)
      if (score > bestScore) {
        best = e
        bestScore = score
      }
    }
    return best
  }
}

// --- helpers -----------------------------------------------------

function mergeResponse(
  override: FakeResponse,
  fallback: FakeResponse,
): {
  content: string
  tokensUsed?: number
  model: string
  stopReason: StopReason
  toolCalls?: readonly ProviderToolCall[]
  chunks?: readonly string[]
} {
  return {
    content: override.content ?? fallback.content ?? '',
    tokensUsed: override.tokensUsed ?? fallback.tokensUsed,
    model: override.model ?? fallback.model ?? 'fake-default',
    stopReason: override.stopReason ?? fallback.stopReason ?? 'end_turn',
    toolCalls: override.toolCalls,
    chunks: override.chunks,
  }
}

/**
 * Test helper: drain a ProviderEvent stream into the final ProviderResponse.
 * Lets tests assert on the completed turn without manually consuming chunks.
 * Throws when the stream ends without a turn_completed event.
 */
export async function collectProviderResponse(
  stream: AsyncIterable<ProviderEvent>,
): Promise<ProviderResponse> {
  let response: ProviderResponse | null = null
  for await (const ev of stream) {
    if (ev.type === 'turn_completed') {
      response = ev.response
    }
  }
  if (response === null) {
    throw new Error('collectProviderResponse: stream ended without turn_completed event')
  }
  return response
}
