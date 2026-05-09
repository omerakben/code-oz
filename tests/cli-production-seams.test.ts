// Tests for src/cli/production-seams.ts.
//
// Three seams under test:
//   1. productionInvokePersona — drains the invokeAgent stream into the
//      final turn_completed content; surfaces ProviderError; threads
//      phase/runId/role into the request; forwards content_chunk events
//      to the optional onChunk callback.
//   2. productionRunner — composes runValidationCommand; verified via
//      DI so we don't spawn real subprocesses in unit tests.
//   3. productionRevertSeam — snapshot/revert/restore against the
//      worktree; revert routing per `change` flag verified via DI;
//      one real-git integration test exercises the round-trip.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  productionInvokePersona,
  productionRevertSeam,
  productionRunner,
  type ProductionRevertSeamOptions,
} from '../src/cli/production-seams.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import { capabilityOf } from '../src/providers/capabilities.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
} from '../src/providers/types.ts'
import type {
  ChangedFileEntry,
  MutationRunnerInput,
} from '../src/cli/production-seams.ts'
import type { RunValidationCommandInput } from '../src/tools/test-runner.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_NOW = '2026-05-08T12:00:00.000Z'

let tmp: string
let projectRoot: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-prod-seams-'))
  projectRoot = join(tmp, 'project')
  const stateDir = join(tmp, 'state')
  const artifactRoot = join(tmp, 'artifacts')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
  await initRun({
    paths,
    profile: 'greenfield',
    runId: RUN,
    now: () => FIXED_NOW,
  })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function makeAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/builder.md',
    name: 'builder',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'fake' as const,
    modelPolicy: 'any' as const,
    permissions: {
      read: '*' as const,
      write: ['./out.md'] as readonly string[],
      bash: 'deny' as const,
    },
    description: 'builder stub',
    body: '## builder persona',
  })
}

function makeInvokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG,
    now: () => FIXED_NOW,
  }
}

// --- productionInvokePersona ---------------------------------------

describe('productionInvokePersona — drains invokeAgent stream', () => {
  test('returns the final turn_completed.response.content', async () => {
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({
      content: 'final answer',
    })
    const invoke = productionInvokePersona(makeInvokeCtx(), makeAgent(), {
      phase: 'build',
      runId: RUN,
    })
    const text = await invoke('the prompt')
    expect(text).toBe('final answer')
  })

  test('forwards every content_chunk to onChunk in order', async () => {
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({
      content: 'abcdef',
      chunks: ['abc', 'def'],
    })
    const observed: string[] = []
    const invoke = productionInvokePersona(makeInvokeCtx(), makeAgent(), {
      phase: 'build',
      runId: RUN,
      onChunk: (text) => observed.push(text),
    })
    const final = await invoke('p')
    expect(final).toBe('abcdef')
    expect(observed).toEqual(['abc', 'def'])
  })

  test('omits onChunk callback when the option is not set', async () => {
    // No onChunk; the stream should still drain and return content.
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({
      content: 'x',
      chunks: ['x'],
    })
    const invoke = productionInvokePersona(makeInvokeCtx(), makeAgent(), {
      phase: 'build',
      runId: RUN,
    })
    const text = await invoke('p')
    expect(text).toBe('x')
  })

  test('threads phase, runId, and role onto the ProviderRequest (verified via events.jsonl)', async () => {
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({
      content: 'ok',
    })
    const invoke = productionInvokePersona(makeInvokeCtx(), makeAgent(), {
      phase: 'build',
      runId: RUN,
      role: 'builder',
    })
    await invoke('the prompt')
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = events
      .filter(isKnownPhaseEvent)
      .find((e) => e.type === 'agent_invoked')
    expect(invoked).toBeDefined()
    if (invoked === undefined || invoked.type !== 'agent_invoked') return
    expect(invoked.phase).toBe('build')
    expect(invoked.runId).toBe(RUN)
    expect(invoked.agent).toBe('builder')
    expect(invoked.role).toBe('builder')
  })

  test('does not write a role field when opts.role is undefined', async () => {
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'ok' })
    const invoke = productionInvokePersona(makeInvokeCtx(), makeAgent(), {
      phase: 'build',
      runId: RUN,
    })
    await invoke('p')
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = events
      .filter(isKnownPhaseEvent)
      .find((e) => e.type === 'agent_invoked')
    expect(invoked).toBeDefined()
    if (invoked === undefined || invoked.type !== 'agent_invoked') return
    expect('role' in invoked ? invoked.role : undefined).toBeUndefined()
  })

  test('throws when the stream ends without turn_completed', async () => {
    // Custom adapter that yields turn_started but never turn_completed.
    class EmptyStreamProvider implements IAgentProvider {
      readonly id = 'fake' as const
      readonly family = 'fake' as const
      readonly capability = capabilityOf('fake')
      // eslint-disable-next-line require-yield
      async *invoke(_req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
        yield { type: 'turn_started', model: 'stub' }
        // intentionally end without turn_completed
      }
      async health(): Promise<ProviderHealth> {
        return {
          provider: 'fake',
          authStatus: 'ok',
          modelDefaultAvailable: true,
          latencyMs: 0,
        }
      }
    }
    const localRegistry = new ProviderRegistry({ providers: [new EmptyStreamProvider()] })
    const ctx: InvokeContext = {
      registry: localRegistry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
      now: () => FIXED_NOW,
    }
    const invoke = productionInvokePersona(ctx, makeAgent(), {
      phase: 'build',
      runId: RUN,
    })
    await expect(invoke('p')).rejects.toThrow(/stream ended without turn_completed/)
  })
})

// --- productionRunner ----------------------------------------------

describe('productionRunner — RunnerSeam adapter over runValidationCommand', () => {
  function injectableInput(overrides: Partial<MutationRunnerInput> = {}): MutationRunnerInput {
    return {
      command: 'echo hi',
      cwd: '/tmp/cwd',
      timeoutMs: 60_000,
      stdoutLogPath: '/tmp/stdout.log',
      stderrLogPath: '/tmp/stderr.log',
      maxStdoutBytes: 1_000_000,
      maxStderrBytes: 1_000_000,
      ...overrides,
    }
  }

  test('forwards every input field to the underlying runner', async () => {
    let resolveCap!: (v: RunValidationCommandInput) => void
    const captured = new Promise<RunValidationCommandInput>((r) => {
      resolveCap = r
    })
    const runner = productionRunner({
      runner: async (input) => {
        resolveCap(input)
        return {
          terminationReason: 'exit',
          exitCode: 0,
          durationMs: 12,
          stdoutBytes: 0,
          stderrBytes: 0,
          truncated: { stdout: false, stderr: false },
          timedOut: false,
        }
      },
    })
    const input = injectableInput({
      command: 'bun test',
      cwd: '/var/runs/abc/worktree',
      timeoutMs: 30_000,
      stdoutLogPath: '/var/runs/abc/stdout.log',
      stderrLogPath: '/var/runs/abc/stderr.log',
      maxStdoutBytes: 524_288,
      maxStderrBytes: 524_288,
    })
    await runner(input)
    const cap = await captured
    expect(cap).toEqual({
      command: 'bun test',
      cwd: '/var/runs/abc/worktree',
      timeoutMs: 30_000,
      stdoutLogPath: '/var/runs/abc/stdout.log',
      stderrLogPath: '/var/runs/abc/stderr.log',
      maxStdoutBytes: 524_288,
      maxStderrBytes: 524_288,
    })
  })

  test('returns a RunnerResultShape-compatible result for a clean exit', async () => {
    const runner = productionRunner({
      runner: async () => ({
        terminationReason: 'exit',
        exitCode: 0,
        durationMs: 7,
        stdoutBytes: 12,
        stderrBytes: 0,
        truncated: { stdout: false, stderr: false },
        timedOut: false,
      }),
    })
    const result = await runner(injectableInput())
    expect(result.terminationReason).toBe('exit')
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBe(7)
    expect(result.truncated).toEqual({ stdout: false, stderr: false })
    expect(result.stdoutBytes).toBe(12)
    expect(result.stderrBytes).toBe(0)
  })

  test('propagates timeout terminationReason', async () => {
    const runner = productionRunner({
      runner: async () => ({
        terminationReason: 'timeout',
        exitCode: null,
        durationMs: 60_000,
        stdoutBytes: 100,
        stderrBytes: 0,
        truncated: { stdout: false, stderr: false },
        timedOut: true,
      }),
    })
    const result = await runner(injectableInput({ timeoutMs: 60_000 }))
    expect(result.terminationReason).toBe('timeout')
    expect(result.exitCode).toBeNull()
  })

  test('propagates stdout-cap terminationReason and truncated flag', async () => {
    const runner = productionRunner({
      runner: async () => ({
        terminationReason: 'stdout-cap',
        exitCode: null,
        durationMs: 200,
        stdoutBytes: 1000,
        stderrBytes: 0,
        truncated: { stdout: true, stderr: false },
        timedOut: false,
      }),
    })
    const result = await runner(injectableInput({ maxStdoutBytes: 1000 }))
    expect(result.terminationReason).toBe('stdout-cap')
    expect(result.truncated?.stdout).toBe(true)
  })

  test('propagates stderr-cap terminationReason', async () => {
    const runner = productionRunner({
      runner: async () => ({
        terminationReason: 'stderr-cap',
        exitCode: null,
        durationMs: 200,
        stdoutBytes: 0,
        stderrBytes: 1000,
        truncated: { stdout: false, stderr: true },
        timedOut: false,
      }),
    })
    const result = await runner(injectableInput({ maxStderrBytes: 1000 }))
    expect(result.terminationReason).toBe('stderr-cap')
    expect(result.truncated?.stderr).toBe(true)
  })

  test('propagates spawn-error with null exit code', async () => {
    const runner = productionRunner({
      runner: async () => ({
        terminationReason: 'spawn-error',
        exitCode: null,
        durationMs: 1,
        stdoutBytes: 0,
        stderrBytes: 0,
        truncated: { stdout: false, stderr: false },
        timedOut: false,
        spawnError: 'ENOENT: no such command',
      }),
    })
    const result = await runner(injectableInput({ command: 'no-such-bin' }))
    expect(result.terminationReason).toBe('spawn-error')
    expect(result.exitCode).toBeNull()
  })

  test('default constructor uses runValidationCommand (smoke test against /usr/bin/true if available)', async () => {
    // No DI override — production path. We only assert the seam returns
    // the structural shape; a deeper test would belong with the
    // runValidationCommand suite. Use `true` (POSIX no-op) so we are
    // compatible across CI environments.
    const runner = productionRunner()
    const stdoutLog = join(tmp, 'stdout.log')
    const stderrLog = join(tmp, 'stderr.log')
    const result = await runner({
      command: 'true',
      cwd: tmp,
      timeoutMs: 5_000,
      stdoutLogPath: stdoutLog,
      stderrLogPath: stderrLog,
      maxStdoutBytes: 4096,
      maxStderrBytes: 4096,
    })
    expect(result.terminationReason).toBe('exit')
    expect(result.exitCode).toBe(0)
  })
})

// --- productionRevertSeam ------------------------------------------

describe('productionRevertSeam — snapshot / revert / restore', () => {
  let worktreeRoot: string

  beforeEach(async () => {
    worktreeRoot = join(tmp, 'worktree')
    await mkdir(worktreeRoot, { recursive: true })
  })

  test('snapshot reads existing file contents and stores null for missing files', async () => {
    await writeFile(join(worktreeRoot, 'present.txt'), 'hello', 'utf8')
    const seam = productionRevertSeam(worktreeRoot)
    const snap = (await seam.snapshot(['present.txt', 'absent.txt'])) as Map<string, Buffer | null>
    expect(snap instanceof Map).toBe(true)
    const presentAbs = join(worktreeRoot, 'present.txt')
    const absentAbs = join(worktreeRoot, 'absent.txt')
    expect(snap.get(presentAbs)?.toString('utf8')).toBe('hello')
    expect(snap.get(absentAbs)).toBeNull()
  })

  test("revert with change='added' deletes the file (it did not exist at base)", async () => {
    await writeFile(join(worktreeRoot, 'new.txt'), 'post-build', 'utf8')
    const calls: Array<{ path: string; sha: string }> = []
    const opts: ProductionRevertSeamOptions = {
      gitCheckout: async (input) => {
        calls.push({ path: input.path, sha: input.baseCommitSha })
      },
    }
    const seam = productionRevertSeam(worktreeRoot, opts)
    const files: ChangedFileEntry[] = [
      { path: 'new.txt', sha256: 'a'.repeat(64), change: 'added' },
    ]
    await seam.revert(files, 'basesha')
    expect(existsSync(join(worktreeRoot, 'new.txt'))).toBe(false)
    expect(calls).toEqual([]) // 'added' never invokes git
  })

  test("revert with change='modified' calls git checkout", async () => {
    await writeFile(join(worktreeRoot, 'mod.txt'), 'modified', 'utf8')
    const calls: Array<{ path: string; sha: string }> = []
    const seam = productionRevertSeam(worktreeRoot, {
      gitCheckout: async (input) => {
        calls.push({ path: input.path, sha: input.baseCommitSha })
      },
    })
    const files: ChangedFileEntry[] = [
      { path: 'mod.txt', sha256: 'b'.repeat(64), change: 'modified' },
    ]
    await seam.revert(files, 'basesha-mod')
    expect(calls).toEqual([{ path: 'mod.txt', sha: 'basesha-mod' }])
  })

  test("revert with change='deleted' calls git checkout (re-creates from base)", async () => {
    const calls: Array<{ path: string; sha: string }> = []
    const seam = productionRevertSeam(worktreeRoot, {
      gitCheckout: async (input) => {
        calls.push({ path: input.path, sha: input.baseCommitSha })
      },
    })
    const files: ChangedFileEntry[] = [
      { path: 'gone.txt', sha256: 'c'.repeat(64), change: 'deleted' },
    ]
    await seam.revert(files, 'basesha-del')
    expect(calls).toEqual([{ path: 'gone.txt', sha: 'basesha-del' }])
  })

  test('revert dispatches a mixed manifest correctly', async () => {
    await writeFile(join(worktreeRoot, 'a.txt'), 'aa', 'utf8')
    await writeFile(join(worktreeRoot, 'b.txt'), 'bb', 'utf8')
    const calls: Array<{ path: string; sha: string }> = []
    const seam = productionRevertSeam(worktreeRoot, {
      gitCheckout: async (input) => {
        calls.push({ path: input.path, sha: input.baseCommitSha })
      },
    })
    const files: ChangedFileEntry[] = [
      { path: 'a.txt', sha256: '0'.repeat(64), change: 'added' },
      { path: 'b.txt', sha256: '1'.repeat(64), change: 'modified' },
      { path: 'c.txt', sha256: '2'.repeat(64), change: 'deleted' },
    ]
    await seam.revert(files, 'sha-mix')
    expect(existsSync(join(worktreeRoot, 'a.txt'))).toBe(false)
    expect(calls).toEqual([
      { path: 'b.txt', sha: 'sha-mix' },
      { path: 'c.txt', sha: 'sha-mix' },
    ])
  })

  test('restore writes back snapshot contents and unlinks paths whose snapshot was null', async () => {
    await writeFile(join(worktreeRoot, 'present.txt'), 'original', 'utf8')
    // 'absent.txt' does not exist at snapshot time.
    const seam = productionRevertSeam(worktreeRoot)
    const snap = await seam.snapshot(['present.txt', 'absent.txt'])
    // Mutate worktree as if revert+replay happened: delete present.txt
    // and create absent.txt.
    await rm(join(worktreeRoot, 'present.txt'))
    await writeFile(join(worktreeRoot, 'absent.txt'), 'reverted-into-existence', 'utf8')
    // Restore should put the world back to snapshot state.
    await seam.restore(snap)
    expect(await readFile(join(worktreeRoot, 'present.txt'), 'utf8')).toBe('original')
    expect(existsSync(join(worktreeRoot, 'absent.txt'))).toBe(false)
  })

  test('restore creates missing parent directories', async () => {
    await mkdir(join(worktreeRoot, 'sub'), { recursive: true })
    await writeFile(join(worktreeRoot, 'sub', 'nested.txt'), 'nested', 'utf8')
    const seam = productionRevertSeam(worktreeRoot)
    const snap = await seam.snapshot(['sub/nested.txt'])
    // Wipe the nested directory.
    await rm(join(worktreeRoot, 'sub'), { recursive: true })
    await seam.restore(snap)
    expect(await readFile(join(worktreeRoot, 'sub', 'nested.txt'), 'utf8')).toBe('nested')
  })

  test('restore throws when given a non-Map argument (defends against contract violation)', async () => {
    const seam = productionRevertSeam(worktreeRoot)
    await expect(seam.restore('not-a-map' as unknown)).rejects.toThrow(/snapshot is not the value/)
    await expect(seam.restore(null as unknown)).rejects.toThrow(/snapshot is not the value/)
  })

  test('snapshot rejects relative paths that escape the worktree', async () => {
    const seam = productionRevertSeam(worktreeRoot)
    await expect(seam.snapshot(['../escape.txt'])).rejects.toThrow(/escapes worktree root/)
  })

  test('snapshot rejects absolute paths outside the worktree', async () => {
    const seam = productionRevertSeam(worktreeRoot)
    await expect(seam.snapshot(['/etc/passwd'])).rejects.toThrow(/escapes worktree root/)
  })

  test('revert rejects paths that escape the worktree', async () => {
    const seam = productionRevertSeam(worktreeRoot, {
      gitCheckout: async () => {
        throw new Error('should not be reached')
      },
    })
    const files: ChangedFileEntry[] = [
      { path: '../outside.txt', sha256: 'd'.repeat(64), change: 'modified' },
    ]
    await expect(seam.revert(files, 'sha')).rejects.toThrow(/escapes worktree root/)
  })

  test('default git checkout: real-git happy path round-trip (snapshot → revert → restore)', async () => {
    // Build a real git repo so the default gitCheckout is exercised.
    const repo = join(tmp, 'real-repo')
    await mkdir(repo, { recursive: true })
    const git = async (...args: string[]): Promise<void> => {
      const proc = Bun.spawn(['git', '-C', repo, ...args], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const code = await proc.exited
      if (code !== 0) {
        const err = await new Response(proc.stderr as ReadableStream<Uint8Array>).text()
        throw new Error(`git ${args.join(' ')} failed (exit=${code}): ${err}`)
      }
    }
    await git('init', '-q', '-b', 'main')
    await git('config', 'user.email', 'test@example.com')
    await git('config', 'user.name', 'Test')
    await git('config', 'commit.gpgsign', 'false')
    await writeFile(join(repo, 'foo.txt'), 'v1', 'utf8')
    await writeFile(join(repo, 'gone.txt'), 'will-be-deleted', 'utf8')
    await git('add', 'foo.txt', 'gone.txt')
    await git('commit', '-q', '-m', 'initial')
    // Capture base sha.
    const shaProc = Bun.spawn(['git', '-C', repo, 'rev-parse', 'HEAD'], {
      stdin: 'ignore',
      stdout: 'pipe',
    })
    await shaProc.exited
    const baseSha = (
      await new Response(shaProc.stdout as ReadableStream<Uint8Array>).text()
    ).trim()
    // Mutate worktree: modify foo, add bar, delete gone.
    await writeFile(join(repo, 'foo.txt'), 'v2', 'utf8')
    await writeFile(join(repo, 'bar.txt'), 'newly-added', 'utf8')
    await rm(join(repo, 'gone.txt'))

    const seam = productionRevertSeam(repo)
    const snap = await seam.snapshot(['foo.txt', 'bar.txt', 'gone.txt'])

    // Revert.
    const files: ChangedFileEntry[] = [
      { path: 'foo.txt', sha256: 'a'.repeat(64), change: 'modified' },
      { path: 'bar.txt', sha256: 'b'.repeat(64), change: 'added' },
      { path: 'gone.txt', sha256: 'c'.repeat(64), change: 'deleted' },
    ]
    await seam.revert(files, baseSha)
    expect(await readFile(join(repo, 'foo.txt'), 'utf8')).toBe('v1')
    expect(existsSync(join(repo, 'bar.txt'))).toBe(false)
    expect(await readFile(join(repo, 'gone.txt'), 'utf8')).toBe('will-be-deleted')

    // Restore.
    await seam.restore(snap)
    expect(await readFile(join(repo, 'foo.txt'), 'utf8')).toBe('v2')
    expect(await readFile(join(repo, 'bar.txt'), 'utf8')).toBe('newly-added')
    expect(existsSync(join(repo, 'gone.txt'))).toBe(false)
  })

  test('default git checkout: throws GitCheckoutError on missing commit', async () => {
    // Build a minimal git repo with one commit but no path 'missing.txt'.
    const repo = join(tmp, 'fail-repo')
    await mkdir(repo, { recursive: true })
    const git = async (...args: string[]): Promise<void> => {
      const proc = Bun.spawn(['git', '-C', repo, ...args], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      await proc.exited
    }
    await git('init', '-q', '-b', 'main')
    await git('config', 'user.email', 'test@example.com')
    await git('config', 'user.name', 'Test')
    await git('config', 'commit.gpgsign', 'false')
    await writeFile(join(repo, 'a.txt'), 'a', 'utf8')
    await git('add', 'a.txt')
    await git('commit', '-q', '-m', 'init')

    const seam = productionRevertSeam(repo)
    await expect(
      seam.revert(
        [{ path: 'never-existed.txt', sha256: '0'.repeat(64), change: 'modified' }],
        'no-such-sha-1234567890',
      ),
    ).rejects.toThrow(/git checkout failed/)
  })

  test('snapshot accepts an empty path list and returns an empty map', async () => {
    const seam = productionRevertSeam(worktreeRoot)
    const snap = (await seam.snapshot([])) as Map<string, Buffer | null>
    expect(snap.size).toBe(0)
  })

  test('worktreeRoot itself is not a writable target (path resolves to root)', async () => {
    // A path of '' or '.' resolves to worktreeRoot itself; reject it so
    // restore never overwrites the directory entry.
    const seam = productionRevertSeam(worktreeRoot)
    await expect(seam.snapshot([''])).rejects.toThrow(/escapes worktree root/)
    await expect(seam.snapshot(['.'])).rejects.toThrow(/escapes worktree root/)
  })

  test('snapshot map is freshly returned per call (mutation safety)', async () => {
    await writeFile(join(worktreeRoot, 'a.txt'), 'a', 'utf8')
    const seam = productionRevertSeam(worktreeRoot)
    const snap1 = (await seam.snapshot(['a.txt'])) as Map<string, Buffer | null>
    const snap2 = (await seam.snapshot(['a.txt'])) as Map<string, Buffer | null>
    expect(snap1).not.toBe(snap2)
    // Mutating one doesn't affect the other.
    snap1.delete(join(worktreeRoot, 'a.txt'))
    expect(snap2.has(join(worktreeRoot, 'a.txt'))).toBe(true)
  })

  test('readFile + restore preserves binary content (no UTF-8 corruption)', async () => {
    const binary = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x7f, 0x01])
    await writeFile(join(worktreeRoot, 'bin.dat'), binary)
    const seam = productionRevertSeam(worktreeRoot)
    const snap = await seam.snapshot(['bin.dat'])
    await rm(join(worktreeRoot, 'bin.dat'))
    await seam.restore(snap)
    const restored = await readFile(join(worktreeRoot, 'bin.dat'))
    expect(Buffer.compare(restored, binary)).toBe(0)
  })

  test('the seam object itself is frozen (defends against mutation)', () => {
    const seam = productionRevertSeam(worktreeRoot)
    expect(Object.isFrozen(seam)).toBe(true)
  })

  test('the worktree directory is created lazily via ensureParentDir on restore', async () => {
    await writeFile(join(worktreeRoot, 'leaf.txt'), 'leaf', 'utf8')
    const seam = productionRevertSeam(worktreeRoot)
    const snap = await seam.snapshot(['leaf.txt'])
    // Wipe the entire worktree.
    await rm(worktreeRoot, { recursive: true })
    await mkdir(worktreeRoot, { recursive: true })
    await seam.restore(snap)
    const st = await stat(join(worktreeRoot, 'leaf.txt'))
    expect(st.isFile()).toBe(true)
  })
})
