// Redaction coverage for XaiProvider. PE-1 introduces API-key transmission
// from code-oz itself; redaction must hold across every artifact path.
//
// Codex Blocker #3 (CODEX_RESPONSE_PE1.md): redaction cannot be adapter-only.
// `ProviderError.message` includes `detail` in the thrown message
// (src/providers/errors.ts:56), and the wrapper writes `issue.detail` into
// `NEEDS_INTERVENTION.json` (src/providers/invoke.ts:249). Tests must
// cover err.message, issues[].detail, NEEDS_INTERVENTION.json, events.jsonl,
// and any other artifact that touches an HTTP-adapter error path.
//
// Codex Risk #2: raw upstream error bodies can leak more than API keys
// (prompt or file-content echoes). The adapter sanitizes by sending only
// status into detail — never raw response body or headers. This file
// asserts that discipline holds for the practical leak vectors.
//
// Test recipe: drive the adapter through every error path with a
// recognizable API-key sentinel and recognizable response-body sentinel,
// then check every error surface for the absence of those sentinels.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { XaiProvider, type FetchRunner } from '../src/providers/xai.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { collectProviderResponse } from '../src/providers/fake.ts'
import { invokeAgent } from '../src/providers/invoke.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { capabilityOf } from '../src/providers/capabilities.ts'
import { initRun, runPathsFor } from '../src/state/run.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { PreparedProviderRequest, ProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN_ULID = '01J0000000000000000000000A'

// Recognizable sentinels: long, distinctive substrings that would never
// appear in a normal error message accidentally. If a leak happens, the
// sentinel is what surfaces in the failed assertion.
const KEY_SENTINEL = 'sk-xai-LEAK-CANARY-MUST-NOT-APPEAR-IN-ANY-OUTPUT-9X8Z'
const BODY_SENTINEL = 'UPSTREAM-ECHO-LEAK-CANARY-9Y7W-PROMPT-CONTENT-HERE'

function agent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/xai-redaction-builder.md',
    name: 'builder',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'xai' as const,
    modelPolicy: 'any' as const,
    permissions: { read: '*' as const, write: '*' as const, bash: 'deny' as const },
    description: 'xai builder under redaction test',
    body: '# stub\n## Overview\nstub',
  })
}

function preparedRequest(
  overrides: Partial<PreparedProviderRequest> = {},
): PreparedProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN_ULID,
    prompt: 'do the thing',
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate: 0, fieldsRemovedByScope: 0 },
    model: 'grok-4-1-fast-reasoning',
    ...overrides,
  }
}

function makeFixedResponseRunner(buildResponse: () => Response): FetchRunner {
  const runner: FetchRunner = async () => buildResponse()
  return runner
}

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.XAI_API_KEY
  process.env.XAI_API_KEY = KEY_SENTINEL
})

afterEach(() => {
  if (savedKey === undefined) {
    delete process.env.XAI_API_KEY
  } else {
    process.env.XAI_API_KEY = savedKey
  }
})

// --- adapter-layer redaction --------------------------------------

describe('XaiProvider — adapter never embeds the API key in any error surface', () => {
  // Helper: every recorded surface code-oz might persist or surface to a user.
  function errorSurfaces(err: ProviderError): readonly string[] {
    const issue = err.issues[0]!
    return [
      err.message,
      err.name,
      issue.code,
      issue.rule,
      issue.detail ?? '',
      ...issue.actionableSuggestions,
    ]
  }

  function expectNoSentinel(surfaces: readonly string[], sentinel: string, label: string): void {
    for (const s of surfaces) {
      if (s.includes(sentinel)) {
        throw new Error(`${label} leaked into error surface: ${s.slice(0, 200)}`)
      }
    }
  }

  test('401 response: no API key in any error surface', async () => {
    const runner = makeFixedResponseRunner(() => new Response(BODY_SENTINEL, { status: 401 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, KEY_SENTINEL, 'API key sentinel')
      expectNoSentinel(surfaces, BODY_SENTINEL, 'response-body sentinel')
    }
  })

  test('403 response: no API key, no body content in any error surface', async () => {
    const runner = makeFixedResponseRunner(() => new Response(BODY_SENTINEL, { status: 403 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, KEY_SENTINEL, 'API key sentinel')
      expectNoSentinel(surfaces, BODY_SENTINEL, 'response-body sentinel')
    }
  })

  test('429 with arbitrary body: no leak', async () => {
    const runner = makeFixedResponseRunner(() => new Response(BODY_SENTINEL, { status: 429 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, KEY_SENTINEL, 'API key sentinel')
      expectNoSentinel(surfaces, BODY_SENTINEL, 'response-body sentinel')
    }
  })

  test('500 with HTML body (Cloudflare-shape edge node): no leak', async () => {
    const cloudflareLike =
      `<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1>` +
      `<p>${BODY_SENTINEL}</p></body></html>`
    const runner = makeFixedResponseRunner(() =>
      new Response(cloudflareLike, {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, KEY_SENTINEL, 'API key sentinel')
      expectNoSentinel(surfaces, BODY_SENTINEL, 'response-body sentinel')
      // and the detail is sanitized to status only
      expect((err as ProviderError).issues[0]?.detail).toBe('HTTP 502')
    }
  })

  test('400 (invalid model echo): no body content in surfaces', async () => {
    const upstream4xxBody = JSON.stringify({
      error: { message: `model not found: ${BODY_SENTINEL}`, type: 'invalid_request_error' },
    })
    const runner = makeFixedResponseRunner(() =>
      new Response(upstream4xxBody, {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, BODY_SENTINEL, 'response-body sentinel')
    }
  })

  test('network failure (TypeError): no API key in sanitized detail', async () => {
    const runner: FetchRunner = async () => {
      const e = new Error(`fetch failed: ${BODY_SENTINEL}`)
      e.name = 'TypeError'
      throw e
    }
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      // The KEY sentinel must never leak.
      expectNoSentinel(surfaces, KEY_SENTINEL, 'API key sentinel')
      const issue = (err as ProviderError).issues[0]!
      expect(issue.detail).toBeDefined()
      expect((issue.detail ?? '').length).toBeLessThanOrEqual(220)
    }
  })

  test('network failure with literal API key in fetch-error message: key is redacted', async () => {
    // Codex review round-1 block-push #2 (thread 019de60e): the
    // sanitization helper must redact secret patterns, not just truncate.
    // Bun.fetch errors today do not embed the API key in their messages,
    // but a future fetch-layer change could — defense-in-depth.
    const runner: FetchRunner = async () => {
      const e = new Error(`fetch failed at api.x.ai (key=${KEY_SENTINEL})`)
      e.name = 'TypeError'
      throw e
    }
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, KEY_SENTINEL, 'API key sentinel')
      const issue = (err as ProviderError).issues[0]!
      // Defense-in-depth: redaction marker should appear, proving the
      // pattern-replace path executed (not just length truncation).
      expect(issue.detail).toContain('[REDACTED-API-KEY]')
    }
  })

  test('network failure with Bearer token in fetch-error message: token is redacted', async () => {
    const tokenLike = 'sk-bearer-token-pattern-LMNO-PQRS'
    const runner: FetchRunner = async () => {
      const e = new Error(`fetch failed; sent Authorization: Bearer ${tokenLike}`)
      e.name = 'TypeError'
      throw e
    }
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, tokenLike, 'bearer-token-like value')
      const issue = (err as ProviderError).issues[0]!
      expect(issue.detail).toContain('[REDACTED]')
    }
  })

  test('malformed JSON 200 body: no leak in error', async () => {
    const runner = makeFixedResponseRunner(() =>
      new Response(`not JSON ${BODY_SENTINEL}`, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const surfaces = errorSurfaces(err as ProviderError)
      expectNoSentinel(surfaces, KEY_SENTINEL, 'API key sentinel')
      expectNoSentinel(surfaces, BODY_SENTINEL, 'response-body sentinel')
    }
  })

  test('missing-key path (XAI_API_KEY blank): error message does not echo whatever blank value was', async () => {
    process.env.XAI_API_KEY = '   ' // whitespace
    const runner = makeFixedResponseRunner(() => new Response('unused', { status: 200 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const issue = (err as ProviderError).issues[0]!
      expect(issue.code).toBe('provider_auth_missing')
      // Detail/rule must not embed the literal env value (whitespace here,
      // but a future variant could be a real-but-bogus key the user typo'd).
      expect(issue.detail).toBeUndefined()
      expect(issue.rule).not.toContain('   ')
    }
  })
})

// --- model-missing surface ----------------------------------------

describe('XaiProvider — provider_model_missing surface is well-formed', () => {
  test('error fires before any network call when req.model is undefined', async () => {
    let networkCalls = 0
    const runner: FetchRunner = async () => {
      networkCalls++
      return new Response('{}', { status: 200 })
    }
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest({ model: undefined })))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect(networkCalls).toBe(0)
      expect((err as ProviderError).issues[0]?.code).toBe('provider_model_missing')
    }
  })

  test('actionableSuggestions name both fix paths', async () => {
    const runner: FetchRunner = async () => new Response('{}', { status: 200 })
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest({ model: undefined })))
      throw new Error('expected ProviderError')
    } catch (err) {
      const suggestions = (err as ProviderError).issues[0]?.actionableSuggestions ?? []
      const joined = suggestions.join(' || ')
      expect(joined).toMatch(/persona frontmatter/)
      expect(joined).toMatch(/company\.<role>\.model/)
    }
  })
})

// --- wrapper-path redaction (NEEDS_INTERVENTION + events) ---------

describe('XaiProvider — wrapper-path redaction (NEEDS_INTERVENTION + events.jsonl)', () => {
  test('failed invocation through wrapper does NOT leak API key into gate or event log', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'code-oz-xai-redaction-'))
    try {
      const stateDir = join(projectRoot, '.code-oz', 'state')
      const artifactRoot = join(projectRoot, '.code-oz', 'artifacts')
      const runPaths = runPathsFor(stateDir, artifactRoot, RUN_ULID)
      await initRun({ paths: runPaths, profile: 'greenfield', runId: RUN_ULID })

      // Adapter that throws a 401 — exercises the wrapper's
      // recordIntervention path which writes NEEDS_INTERVENTION.json
      // and appends the intervention event.
      const runner = makeFixedResponseRunner(() => new Response(BODY_SENTINEL, { status: 401 }))
      const xai = new XaiProvider({ runner })
      const registry = new ProviderRegistry({ providers: [xai] })

      const req: ProviderRequest = {
        agent: agent(),
        phase: 'build',
        runId: RUN_ULID,
        prompt: 'do the thing',
        files: [],
        model: 'grok-4-1-fast-reasoning',
      }

      // Drain the wrapper stream — it should yield agent_invoked, then the
      // adapter throws on the network call, which the wrapper catches and
      // converts to NEEDS_INTERVENTION + intervention event.
      let caught: ProviderError | null = null
      try {
        for await (const _ev of invokeAgent(
          { registry, runPaths, config: DEFAULT_CONFIG, projectRoot },
          req,
        )) {
          /* drain */
        }
      } catch (err) {
        caught = err as ProviderError
      }
      expect(caught).not.toBeNull()
      expect(caught!.issues[0]?.code).toBe('provider_auth_missing')

      // Verify the persisted artifacts have no key / body sentinel.
      const eventsFileContent = await readFile(runPaths.eventsFile, 'utf8')
      expect(eventsFileContent.includes(KEY_SENTINEL)).toBe(false)
      expect(eventsFileContent.includes(BODY_SENTINEL)).toBe(false)

      const gatePath = join(runPaths.runDir, 'NEEDS_INTERVENTION.json')
      const gateContent = await readFile(gatePath, 'utf8')
      expect(gateContent.includes(KEY_SENTINEL)).toBe(false)
      expect(gateContent.includes(BODY_SENTINEL)).toBe(false)
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })
})

// --- forward-compat: capability surface for xai unchanged ---------

describe('XaiProvider — capability surface is the M11 strict-minimal shape', () => {
  test('capability has authSource + eligiblePhases only (no transport field)', () => {
    const cap = capabilityOf('xai')
    const keys = Object.keys(cap).sort()
    // M11 strict-minimal: authSource + eligiblePhases, optional cost/rate.
    // PE-1 lock (Codex Decision D): NO `transport` field.
    expect(keys.includes('transport' as never)).toBe(false)
    expect(cap.authSource).toBe('xai-api-key')
    expect(cap.eligiblePhases.length).toBeGreaterThan(0)
  })
})
