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
import { initRun, requireGate } from '../src/state/run.ts'
import { runApprove } from '../src/commands/approve.ts'
import { PKG_VERSION } from '../src/cli.ts'
import type { ProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const REPO_ROOT = process.cwd()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')

// --- finding #1 — version bump ------------------------------------

describe('finding #1: versions report consistently across all surfaces', () => {
  // M5 finding #1 closed the divergence between PKG_VERSION,
  // DEFAULT_CONFIG.version, and package.json.version. The test now
  // pins the current version so every milestone close that bumps must
  // update all three together. M11 missed the bump (left at
  // `0.10.0-alpha.0`); M12 commit 6 catches up to `0.12.0-alpha.0`.
  // PE-1 (xAI direct HTTP adapter) bumps to `0.13.0-alpha.0`. M13
  // (Role-cost policy under budgets.global) shifts to `0.14.0-alpha.0`
  // per CODEX_RESPONSE_M13.md commit-7 lock. M14 and M15 BOTH shipped
  // tags (`v0.15.0-alpha.0`, `v0.16.0-alpha.0`) without bumping these
  // three sources — the post-M15 release-polish commit catches all
  // three up to `0.16.0-alpha.0` in one chore on `main`. The lesson:
  // bump these three together in the SAME milestone-close commit, not
  // in a separate post-tag chore. M16 (production CLI completion)
  // follows that lesson: this commit bumps to `0.17.0-alpha.0` together
  // with the C13 closure + R1 fix-first commits, in the same chore.
  // v0.20.1-alpha.0 first-run-polish C19.1 (Codex R2 B1 closure) and
  // v0.20.2-alpha.0 release prep (chore commit fb73128) both bumped the
  // trio together. The 'bump these three together' lesson holds.
  const CURRENT = '0.20.3-alpha.0'

  test('PKG_VERSION', () => {
    expect(PKG_VERSION).toBe(CURRENT)
  })

  test('DEFAULT_CONFIG.version', () => {
    expect(DEFAULT_CONFIG.version).toBe(CURRENT)
  })

  test('package.json.version', async () => {
    const pkg = JSON.parse(
      await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
    )
    expect(pkg.version).toBe(CURRENT)
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

  async function setup(opts: { withGateRequired?: boolean } = {}): Promise<RunPaths> {
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
    if (opts.withGateRequired !== false) {
      await requireGate({
        paths,
        runId: RUN,
        phase: 'define',
        blockedOn: 'test fixture',
        now: () => FIXED_TS,
      })
    }
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
    const paths = await setup() // emits gate_required(define) via fixture
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
    await requireGate({
      paths,
      runId: RUN,
      phase: 'plan',
      blockedOn: 'test fixture',
      now: () => FIXED_TS,
    })
    const result = await runApprove({ cwd, phase: 'plan', now: () => FIXED_TS })
    expect(result.approved).toBe(true)
  })
})

// --- round 2 finding A — --artifact path safety ------------------

describe('round 2 finding A: --artifact path-traversal rejected before readFile', () => {
  let cwd: string
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const FIXED_TS = '2026-04-30T18:00:00.000Z'

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'code-oz-fix-round2-A-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  test('rejects --artifact with `..` traversal before parseSpec runs', async () => {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
    await requireGate({
      paths,
      runId: RUN,
      phase: 'define',
      blockedOn: 'test fixture',
      now: () => FIXED_TS,
    })
    let err: unknown
    try {
      await runApprove({
        cwd,
        phase: 'define',
        artifact: '../../etc/passwd',
        now: () => FIXED_TS,
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    // Should fail with a path-safety code (gate_artifact_path_unsafe), not an
    // ENOENT or parseSpec error — proves we rejected before the readFile.
    const msg = (err as Error).message
    expect(
      msg.includes('gate_artifact_path_unsafe') ||
        msg.includes('must not contain') ||
        msg.includes('relative to'),
    ).toBe(true)
  })

  test('rejects absolute --artifact path', async () => {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
    await requireGate({
      paths,
      runId: RUN,
      phase: 'define',
      blockedOn: 'test fixture',
      now: () => FIXED_TS,
    })
    let err: unknown
    try {
      await runApprove({
        cwd,
        phase: 'define',
        artifact: '/etc/passwd',
        now: () => FIXED_TS,
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
  })
})

// --- round 2 finding B — stale cross-run SPEC.md cannot be approved -----

describe('round 2 finding B: cannot approve without current-run gate_required', () => {
  let cwd: string
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const FIXED_TS = '2026-04-30T18:00:00.000Z'

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'code-oz-fix-round2-B-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  test('refuses to approve when no gate_required event exists for the target phase', async () => {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
    // Write a perfectly valid SPEC.md (simulating a stale artifact from a
    // prior run) but DO NOT emit gate_required for the current run.
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
    await writeFile(join(artifactRoot, 'SPEC.md'), validSpec, 'utf8')

    let err: unknown
    try {
      await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('no `gate_required` event for define')
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

  test('empty content is allowed when stopReason is tool_use (M7+ tool turns)', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: '',
      stopReason: 'tool_use',
    })
    let lastEv: { type: string } | null = null
    for await (const ev of invokeAgent(invokeCtx(), request())) {
      lastEv = ev as { type: string }
    }
    expect(lastEv?.type).toBe('turn_completed')
  })

  test('empty content is allowed when toolCalls are non-empty (end_turn after tools)', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: '',
      stopReason: 'end_turn',
      toolCalls: [{ id: 'x', name: 'doit', input: {} }],
    })
    let lastEv: { type: string } | null = null
    for await (const ev of invokeAgent(invokeCtx(), request())) {
      lastEv = ev as { type: string }
    }
    expect(lastEv?.type).toBe('turn_completed')
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
