// Regression tests for the four CODEX_REVIEW_M5 findings closed in the
// fix-first commits. Each section pins the bug + the fix.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeAgent, type InvokeContext } from '../src/providers/invoke.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import { initProject } from '../src/commands/init.ts'
import { initRun } from '../src/state/run.ts'
import { runApprove } from '../src/commands/approve.ts'
import { PKG_VERSION } from '../src/cli.ts'
import type { ProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const REPO_ROOT = process.cwd()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')

// --- finding #1 — version bump ------------------------------------

describe('finding #1: versions report 0.5.0-alpha.0 across all surfaces', () => {
  test('PKG_VERSION', () => {
    expect(PKG_VERSION).toBe('0.5.0-alpha.0')
  })

  test('DEFAULT_CONFIG.version', () => {
    expect(DEFAULT_CONFIG.version).toBe('0.5.0-alpha.0')
  })

  test('package.json.version', async () => {
    const pkg = JSON.parse(
      await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
    )
    expect(pkg.version).toBe('0.5.0-alpha.0')
  })
})

// --- finding #2 — approve define validates SPEC.md ----------------

describe('finding #2: approve define refuses to bind an invalid SPEC.md', () => {
  let cwd: string
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const FIXED_TS = '2026-04-30T18:00:00.000Z'

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'code-oz-fix2-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  async function setup(): Promise<RunPaths> {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await mkdir(artifactRoot, { recursive: true })
    await initRun({
      paths,
      profile: 'greenfield',
      runId: RUN,
      now: () => FIXED_TS,
    })
    return paths
  }

  test('rejects an invalid SPEC.md with parser issue summary', async () => {
    const paths = await setup()
    await writeFile(
      join(paths.artifactRoot, 'SPEC.md'),
      'this is not a valid spec',
      'utf8',
    )
    let err: unknown
    try {
      await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain('not a valid SPEC.md')
    expect(msg).toContain('spec_missing_title')
    expect(msg).toContain('Edit the file to satisfy the SPEC contract before approving.')
    // Gate file must NOT have been written.
    let gateErr: unknown
    try {
      await stat(join(paths.runDir, 'GATE_DEFINE_PASSED.json'))
    } catch (e) {
      gateErr = e
    }
    expect((gateErr as NodeJS.ErrnoException).code).toBe('ENOENT')
  })

  test('rejects when SPEC.md is missing entirely', async () => {
    await setup()
    let err: unknown
    try {
      await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('does not exist')
  })

  test('non-define phases are NOT pre-validated by the SPEC parser', async () => {
    // Build phase has its own future contract; the validator should not fire.
    const paths = await setup()
    // Approve define first (with a valid SPEC) so we can transition to plan.
    const validSpec = [
      '# SPEC',
      '',
      '## Goals',
      '',
      '- A goal.',
      '',
      '## Users',
      '',
      '- A user.',
      '',
      '## Constraints',
      '',
      '- A constraint.',
      '',
      '## Acceptance criteria',
      '',
      '- A criterion.',
      '',
      '## Open questions',
      '',
      '- None known at define time.',
      '',
      '## Explicit non-goals',
      '',
      '- A non-goal.',
      '',
    ].join('\n')
    await writeFile(join(paths.artifactRoot, 'SPEC.md'), validSpec, 'utf8')
    await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })
    // Plan artifact has placeholder content (no validator yet) — should approve.
    await writeFile(join(paths.artifactRoot, 'PLAN.md'), 'plan body', 'utf8')
    const result = await runApprove({ cwd, phase: 'plan', now: () => FIXED_TS })
    expect(result.approved).toBe(true)
  })
})

// --- finding #3 — preflight leaves no orphan active.json ----------

interface SubprocResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function runSubprocess(
  args: readonly string[],
  cwd: string,
): Promise<SubprocResult> {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', CLI_ENTRY, 'run', ...args],
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

describe('finding #3: failed preflight leaves no orphan active run', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'code-oz-fix3-'))
    await mkdir(join(tmp, '.code-oz', 'artifacts'), { recursive: true })
    await mkdir(join(tmp, '.code-oz', 'state'), { recursive: true })
    await mkdir(join(tmp, '.code-oz', 'agents'), { recursive: true })
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('missing --request-file path: no active.json created', async () => {
    const r = await runSubprocess(
      ['--request-file', join(tmp, 'does-not-exist.md')],
      tmp,
    )
    expect(r.exitCode).toBe(2)
    expect(existsSync(join(tmp, '.code-oz', 'state', 'active.json'))).toBe(false)
  })

  test('--request-file with no user blocks: no active.json created', async () => {
    const empty = join(tmp, 'empty.md')
    await writeFile(empty, '# nothing here\n', 'utf8')
    const r = await runSubprocess(['--request-file', empty], tmp)
    expect(r.exitCode).toBe(2)
    expect(existsSync(join(tmp, '.code-oz', 'state', 'active.json'))).toBe(false)
  })

  test('non-TTY no-input invocation: no active.json created', async () => {
    // Bun.spawn with stdin: 'ignore' means stdin is not a TTY.
    const r = await runSubprocess([], tmp)
    expect(r.exitCode).toBe(2)
    expect(existsSync(join(tmp, '.code-oz', 'state', 'active.json'))).toBe(false)
  })
})

// --- finding #4 — empty provider content ⇒ provider_malformed_response

describe('finding #4: invokeAgent rejects empty turn_completed content', () => {
  let tmp: string
  let projectRoot: string
  let paths: RunPaths
  let registry: ProviderRegistry
  let fake: FakeProvider
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'code-oz-fix4-'))
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
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  function agent(): AgentDefinition {
    return Object.freeze({
      file: '/tmp/x.md',
      name: 'ba',
      type: 'agent' as const,
      phase: 'define' as const,
      provider: 'fake' as const,
      modelPolicy: 'any' as const,
      permissions: { read: '*' as const, write: '*' as const, bash: 'deny' as const },
      description: 'x',
      body: 'x',
    })
  }

  function invokeCtx(): InvokeContext {
    return {
      registry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
      now: () => '2026-04-30T18:00:00.000Z',
    }
  }

  function request(): ProviderRequest {
    return {
      agent: agent(),
      phase: 'define',
      runId: RUN,
      prompt: 'p',
      files: [],
    }
  }

  test('throws ProviderError(provider_malformed_response) and writes NEEDS_INTERVENTION', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: '',
      stopReason: 'end_turn',
    })
    let err: unknown
    try {
      for await (const _ of invokeAgent(invokeCtx(), request())) {
        void _
      }
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ProviderError)
    const issues = (err as ProviderError).issues
    expect(issues[0]!.code).toBe('provider_malformed_response')

    const intervention = JSON.parse(
      await readFile(join(paths.runDir, 'NEEDS_INTERVENTION.json'), 'utf8'),
    )
    expect(intervention.code).toBe('provider_malformed_response')
  })

  test('non-empty content still completes successfully', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: 'a real reply',
      stopReason: 'end_turn',
    })
    let lastContent = ''
    for await (const ev of invokeAgent(invokeCtx(), request())) {
      if (ev.type === 'turn_completed') lastContent = ev.response.content
    }
    expect(lastContent).toBe('a real reply')
  })
})
