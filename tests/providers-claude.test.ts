import { describe, test, expect } from 'bun:test'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ClaudeProvider } from '../src/providers/claude.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { collectProviderResponse } from '../src/providers/fake.ts'
import type { Runner, RunnerOptions, RunnerResult } from '../src/providers/runner.ts'
import type { PreparedProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return Object.freeze({
    file: '/tmp/builder.md',
    name: 'builder',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'claude' as const,
    modelPolicy: 'opus-default' as const,
    permissions: {
      read: '*' as const,
      write: '*' as const,
      bash: 'deny' as const,
    },
    description: 'builder',
    body: '# stub\n## Overview\nstub',
    ...overrides,
  })
}

function preparedRequest(
  overrides: Partial<PreparedProviderRequest> = {},
): PreparedProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'do the thing',
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate: 0, fieldsRemovedByScope: 0 },
    ...overrides,
  }
}

interface Call {
  cmd: string
  args: readonly string[]
  options?: RunnerOptions
}

function makeRecordingRunner(result: RunnerResult): { runner: Runner; calls: Call[] } {
  const calls: Call[] = []
  const runner: Runner = async (cmd, args, options) => {
    calls.push({ cmd, args, options })
    return result
  }
  return { runner, calls }
}

function throwingRunner(err: Error): Runner {
  return async () => {
    throw err
  }
}

describe('ClaudeProvider — health', () => {
  test('--version exit 0 reports authStatus ok', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: '2.1.119 (Claude Code)',
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    const h = await c.health()
    expect(h.authStatus).toBe('ok')
    expect(h.modelDefaultAvailable).toBe(true)
    expect(calls[0]?.cmd).toBe('claude')
    expect(calls[0]?.args).toEqual(['--version'])
  })

  test('--version ENOENT reports authStatus missing', async () => {
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const c = new ClaudeProvider({ runner: throwingRunner(enoent) })
    const h = await c.health()
    expect(h.authStatus).toBe('missing')
    expect(h.lastError?.rule).toContain('not found in PATH')
  })

  test('--version non-zero exit reports authStatus unknown', async () => {
    const { runner } = makeRecordingRunner({
      stdout: '',
      stderr: 'broken install',
      exitCode: 7,
    })
    const c = new ClaudeProvider({ runner })
    const h = await c.health()
    expect(h.authStatus).toBe('unknown')
    expect(h.lastError?.rule).toContain('exited with status 7')
  })
})

describe('ClaudeProvider — invoke', () => {
  test('happy path: JSON response parses content + tokensUsed + model', async () => {
    const json = JSON.stringify({
      id: 'msg_claude_test',
      result: 'the answer',
      model: 'claude-opus-4-7',
      usage: { output_tokens: 17 },
    })
    const { runner, calls } = makeRecordingRunner({
      stdout: json,
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    const response = await collectProviderResponse(c.invoke(preparedRequest()))
    expect(response.content).toBe('the answer')
    expect(response.tokensUsed).toBe(17)
    expect(response.model).toBe('claude-opus-4-7')
    expect(response.responseId).toBe('msg_claude_test')
    expect(calls[0]?.args).toContain('--print')
    expect(calls[0]?.args).toContain('--output-format')
    expect(calls[0]?.args).toContain('json')
  })

  test('plain text stdout (not JSON) is returned as content', async () => {
    const { runner } = makeRecordingRunner({
      stdout: 'plain answer\n',
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    const response = await collectProviderResponse(c.invoke(preparedRequest()))
    expect(response.content).toBe('plain answer')
  })

  test('omits tokensUsed when JSON has no usage block', async () => {
    const { runner } = makeRecordingRunner({
      stdout: JSON.stringify({ result: 'hi' }),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    const response = await collectProviderResponse(c.invoke(preparedRequest()))
    expect(response.content).toBe('hi')
    expect('tokensUsed' in response).toBe(false)
  })

  test('passes --model when req.model is set', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: JSON.stringify({ result: 'ok' }),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    await collectProviderResponse(c.invoke(preparedRequest({ model: 'claude-opus-4-7' })))
    expect(calls[0]?.args).toContain('--model')
    expect(calls[0]?.args).toContain('claude-opus-4-7')
  })

  test('renders prompt + files into stdin', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: JSON.stringify({ result: 'ok' }),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    await collectProviderResponse(
      c.invoke(
        preparedRequest({
          prompt: 'analyze this',
          files: [
            {
              path: 'data.txt',
              content: Buffer.from('hello world', 'utf8'),
              sha256: 'a'.repeat(64),
              sizeBytes: 11,
            },
          ],
        }),
      ),
    )
    const stdin = calls[0]?.options?.stdin ?? ''
    expect(stdin).toContain('analyze this')
    expect(stdin).toContain('=== data.txt ===')
    expect(stdin).toContain('hello world')
  })

  test('non-zero exit with auth-related stderr → provider_auth_missing', async () => {
    const { runner } = makeRecordingRunner({
      stdout: '',
      stderr: 'Error: Not logged in. Please run claude login.',
      exitCode: 1,
    })
    const c = new ClaudeProvider({ runner })
    let caught: ProviderError | null = null
    try {
      await collectProviderResponse(c.invoke(preparedRequest()))
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_auth_missing')
    expect(caught?.issues[0]?.actionableSuggestions[0]).toContain('claude login')
  })

  test('non-zero exit otherwise → provider_io_error', async () => {
    const { runner } = makeRecordingRunner({
      stdout: '',
      stderr: 'unexpected internal error',
      exitCode: 2,
    })
    const c = new ClaudeProvider({ runner })
    let caught: ProviderError | null = null
    try {
      await collectProviderResponse(c.invoke(preparedRequest()))
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_io_error')
    expect(caught?.issues[0]?.rule).toContain('non-zero status 2')
  })

  test('ENOENT during invoke → provider_io_error with CLI-not-found rule', async () => {
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const c = new ClaudeProvider({ runner: throwingRunner(enoent) })
    let caught: ProviderError | null = null
    try {
      await collectProviderResponse(c.invoke(preparedRequest()))
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_io_error')
    expect(caught?.issues[0]?.rule).toContain('not found in PATH')
  })

  // Bug fix: Claude Code 2.1+ returns a stream-array under --output-format=json
  // instead of a single object. Without array handling, `tryParseJson` rejected
  // arrays and the wrapper fell back to raw stdout — assigning the entire
  // stream JSON (system init, tool list, rate-limit events) as content.
  // ask_me_persona_reply.response carried this raw stream string into the event
  // log, and any stdout print of `text` would surface unreadable JSON instead of
  // the assistant's actual reply.
  test('stream-array format: extracts assistant text from result event', async () => {
    const streamArray = [
      { type: 'system', subtype: 'init', cwd: '/tmp', session_id: 'abc', model: 'claude-opus-4-7' },
      {
        type: 'assistant',
        message: { id: 'msg_stream_test', content: [{ type: 'text', text: 'hello world' }] },
      },
      { type: 'result', subtype: 'success', result: 'hello world', usage: { output_tokens: 5 } },
    ]
    const { runner } = makeRecordingRunner({
      stdout: JSON.stringify(streamArray),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    const response = await collectProviderResponse(c.invoke(preparedRequest()))
    expect(response.content).toBe('hello world')
    expect(response.tokensUsed).toBe(5)
    expect(response.model).toBe('claude-opus-4-7')
    expect(response.responseId).toBe('msg_stream_test')
  })

  test('stream-array without result event: falls back to assistant text concatenation', async () => {
    const streamArray = [
      { type: 'system', subtype: 'init', model: 'claude-opus-4-7' },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'first chunk' }] },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'second chunk' }] },
      },
    ]
    const { runner } = makeRecordingRunner({
      stdout: JSON.stringify(streamArray),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    const response = await collectProviderResponse(c.invoke(preparedRequest()))
    expect(response.content).toBe('first chunk\nsecond chunk')
  })

  test('stream-array with modelUsage but no usage.output_tokens sums per-model output tokens', async () => {
    const streamArray = [
      { type: 'system', subtype: 'init', model: 'claude-opus-4-7' },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'reply' }] },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'reply',
        modelUsage: {
          'claude-opus-4-7': { outputTokens: 12 },
          'claude-haiku-4-5': { outputTokens: 3 },
        },
      },
    ]
    const { runner } = makeRecordingRunner({
      stdout: JSON.stringify(streamArray),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    const response = await collectProviderResponse(c.invoke(preparedRequest()))
    expect(response.content).toBe('reply')
    expect(response.tokensUsed).toBe(15)
  })

  test('stream-array with no result event AND no assistant text falls back to raw stdout', async () => {
    const streamArray = [
      { type: 'system', subtype: 'init' },
      { type: 'rate_limit_event', tier: '5h' },
    ]
    const stdout = JSON.stringify(streamArray)
    const { runner } = makeRecordingRunner({ stdout, stderr: '', exitCode: 0 })
    const c = new ClaudeProvider({ runner })
    const response = await collectProviderResponse(c.invoke(preparedRequest()))
    expect(response.content).toBe(stdout)
  })
})

describe('ClaudeProvider — privacy guards (M4 Codex review block-push fix)', () => {
  test('PRIVACY GUARD: cwd is a temp dir, NOT inherited from caller', async () => {
    let observedCwd: string | undefined
    const runner: Runner = async (_cmd, _args, options) => {
      observedCwd = options?.cwd
      return { stdout: JSON.stringify({ result: 'ok' }), stderr: '', exitCode: 0 }
    }
    const c = new ClaudeProvider({ runner })
    await collectProviderResponse(c.invoke(preparedRequest()))
    expect(observedCwd).toBeDefined()
    // Bun's tmpdir is /var/folders/... or /tmp/... — never under our cwd.
    expect(observedCwd?.startsWith(tmpdir())).toBe(true)
    expect(observedCwd).toContain('code-oz-claude-')
  })

  test('PRIVACY GUARD: --no-session-persistence is passed (no on-disk session file)', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: JSON.stringify({ result: 'ok' }),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner })
    await collectProviderResponse(c.invoke(preparedRequest()))
    expect(calls[0]?.args).toContain('--no-session-persistence')
  })

  test('temp cwd is cleaned up after invoke (success path)', async () => {
    let createdCwd: string | undefined
    const tempCwd = async (): Promise<string> => {
      createdCwd = await mkdtemp(join(tmpdir(), 'code-oz-claude-test-'))
      return createdCwd
    }
    const { runner } = makeRecordingRunner({
      stdout: JSON.stringify({ result: 'ok' }),
      stderr: '',
      exitCode: 0,
    })
    const c = new ClaudeProvider({ runner, tempCwd })
    await collectProviderResponse(c.invoke(preparedRequest()))
    expect(createdCwd).toBeDefined()
    let exists = true
    try {
      await stat(createdCwd!)
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  test('temp cwd is cleaned up even on subprocess failure (ENOENT)', async () => {
    let createdCwd: string | undefined
    const tempCwd = async (): Promise<string> => {
      createdCwd = await mkdtemp(join(tmpdir(), 'code-oz-claude-test-'))
      return createdCwd
    }
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const c = new ClaudeProvider({ runner: throwingRunner(enoent), tempCwd })
    try {
      await collectProviderResponse(c.invoke(preparedRequest()))
    } catch {
      // expected
    }
    let exists = true
    try {
      await stat(createdCwd!)
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
    if (createdCwd) await rm(createdCwd, { recursive: true, force: true }).catch(() => undefined)
  })
})
