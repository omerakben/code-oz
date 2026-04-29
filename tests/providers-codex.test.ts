import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CodexProvider } from '../src/providers/codex.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { collectProviderResponse } from '../src/providers/fake.ts'
import type { Runner, RunnerOptions, RunnerResult } from '../src/providers/runner.ts'
import type { PreparedProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'

function agent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/reviewer.md',
    name: 'reviewer',
    type: 'agent' as const,
    phase: 'review' as const,
    provider: 'codex' as const,
    modelPolicy: 'any' as const,
    permissions: {
      read: '*' as const,
      write: '*' as const,
      bash: 'deny' as const,
    },
    description: 'reviewer',
    body: '# stub\n## Overview\nstub',
  })
}

function preparedRequest(
  overrides: Partial<PreparedProviderRequest> = {},
): PreparedProviderRequest {
  return {
    agent: agent(),
    phase: 'review',
    runId: RUN,
    prompt: 'review this',
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

describe('CodexProvider — health', () => {
  test('login status with "Logged in" → authStatus ok', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: 'Logged in using ChatGPT',
      stderr: '',
      exitCode: 0,
    })
    const c = new CodexProvider({ runner })
    const h = await c.health()
    expect(h.authStatus).toBe('ok')
    expect(h.modelDefaultAvailable).toBe(true)
    expect(calls[0]?.cmd).toBe('codex')
    expect(calls[0]?.args).toEqual(['login', 'status'])
  })

  test('login status with non-"logged in" stdout → authStatus missing', async () => {
    const { runner } = makeRecordingRunner({
      stdout: 'No credentials found',
      stderr: '',
      exitCode: 0,
    })
    const c = new CodexProvider({ runner })
    const h = await c.health()
    expect(h.authStatus).toBe('missing')
    expect(h.lastError?.rule).toContain('did not report `logged in`')
  })

  test('login status ENOENT → authStatus missing', async () => {
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const c = new CodexProvider({ runner: throwingRunner(enoent) })
    const h = await c.health()
    expect(h.authStatus).toBe('missing')
    expect(h.lastError?.rule).toContain('not found in PATH')
  })

  test('login status non-zero with auth-keyword stderr → authStatus missing', async () => {
    const { runner } = makeRecordingRunner({
      stdout: '',
      stderr: 'Error: please log in first',
      exitCode: 1,
    })
    const c = new CodexProvider({ runner })
    const h = await c.health()
    expect(h.authStatus).toBe('missing')
  })
})

describe('CodexProvider — invoke', () => {
  test('happy path: stdout becomes content; turn_started + content_chunk + turn_completed', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: 'reviewed: looks good\n',
      stderr: '',
      exitCode: 0,
    })
    const c = new CodexProvider({ runner })
    const events: string[] = []
    let content = ''
    for await (const ev of c.invoke(preparedRequest())) {
      events.push(ev.type)
      if (ev.type === 'content_chunk') content = ev.text
      if (ev.type === 'turn_completed') content = ev.response.content
    }
    expect(events).toEqual(['turn_started', 'content_chunk', 'turn_completed'])
    expect(content).toBe('reviewed: looks good')
    expect(calls[0]?.cmd).toBe('codex')
    expect(calls[0]?.args[0]).toBe('exec')
  })

  test('PRIVACY GUARD: cwd is a temp dir, NOT the projectRoot', async () => {
    let observedCwd: string | undefined
    const runner: Runner = async (_cmd, _args, options) => {
      observedCwd = options?.cwd
      return { stdout: 'ok', stderr: '', exitCode: 0 }
    }
    const c = new CodexProvider({ runner })
    await collectProviderResponse(c.invoke(preparedRequest()))
    expect(observedCwd).toBeDefined()
    // Bun's tmpdir is /var/folders/... or /tmp/... — never under our cwd.
    expect(observedCwd?.startsWith(tmpdir())).toBe(true)
    expect(observedCwd).toContain('code-oz-codex-')
  })

  test('PRIVACY GUARD: --skip-git-repo-check + --sandbox read-only + --ephemeral are passed', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    })
    const c = new CodexProvider({ runner })
    await collectProviderResponse(c.invoke(preparedRequest()))
    const args = calls[0]?.args ?? []
    expect(args).toContain('--skip-git-repo-check')
    expect(args).toContain('--sandbox')
    const sandboxIdx = args.indexOf('--sandbox')
    expect(args[sandboxIdx + 1]).toBe('read-only')
    expect(args).toContain('--ephemeral')
    expect(args).toContain('-') // read prompt from stdin
  })

  test('PRIVACY GUARD: prompt + manifest go through stdin (not args)', async () => {
    const { runner, calls } = makeRecordingRunner({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    })
    const c = new CodexProvider({ runner })
    await collectProviderResponse(
      c.invoke(preparedRequest({ prompt: 'sensitive prompt' })),
    )
    const stdin = calls[0]?.options?.stdin ?? ''
    expect(stdin).toContain('sensitive prompt')
    // Confirm prompt is NOT in args (which would be visible in `ps`).
    expect(calls[0]?.args.join(' ')).not.toContain('sensitive prompt')
  })

  test('temp cwd is cleaned up after invoke (success path)', async () => {
    let createdCwd: string | undefined
    const tempCwd = async (): Promise<string> => {
      createdCwd = await mkdtemp(join(tmpdir(), 'code-oz-codex-test-'))
      return createdCwd
    }
    const { runner } = makeRecordingRunner({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    })
    const c = new CodexProvider({ runner, tempCwd })
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

  test('temp cwd is cleaned up even on subprocess failure', async () => {
    let createdCwd: string | undefined
    const tempCwd = async (): Promise<string> => {
      createdCwd = await mkdtemp(join(tmpdir(), 'code-oz-codex-test-'))
      return createdCwd
    }
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const c = new CodexProvider({ runner: throwingRunner(enoent), tempCwd })
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
    // Clean up just in case.
    if (createdCwd) await rm(createdCwd, { recursive: true, force: true }).catch(() => undefined)
  })

  test('non-zero exit with auth keyword → provider_auth_missing', async () => {
    const { runner } = makeRecordingRunner({
      stdout: '',
      stderr: 'Error: please log in (codex login)',
      exitCode: 1,
    })
    const c = new CodexProvider({ runner })
    let caught: ProviderError | null = null
    try {
      await collectProviderResponse(c.invoke(preparedRequest()))
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_auth_missing')
  })

  test('non-zero exit otherwise → provider_io_error', async () => {
    const { runner } = makeRecordingRunner({
      stdout: '',
      stderr: 'sandbox violation',
      exitCode: 3,
    })
    const c = new CodexProvider({ runner })
    let caught: ProviderError | null = null
    try {
      await collectProviderResponse(c.invoke(preparedRequest()))
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_io_error')
    expect(caught?.issues[0]?.rule).toContain('non-zero status 3')
  })
})
