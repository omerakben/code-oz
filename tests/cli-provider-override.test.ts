import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildProviderRegistry } from '../src/cli/bootstrap.ts'
import { PROVIDER_IDS, type ProviderId } from '../src/providers/types.ts'

const REPO_ROOT = process.cwd()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')

describe('buildProviderRegistry', () => {
  // PE-1 commit 1 added 'xai' to PROVIDER_IDS but does not yet register the
  // adapter — that ships in commit 4 when src/cli/bootstrap.ts grows the
  // `new XaiProvider(...)` call. Until then, the production registry
  // contains only these four adapters. familyOf() still answers correctly
  // for `xai` because it reads from DEFAULT_FAMILY_BY_ID, which the
  // substrate already populated.
  const REGISTERED_IDS: readonly ProviderId[] = ['claude', 'codex', 'gemini', 'fake']

  test('without override, returns the registry of bootstrap-registered adapters', () => {
    const { registry, fakeProvider } = buildProviderRegistry()
    expect(fakeProvider).toBeUndefined()
    for (const id of REGISTERED_IDS) {
      expect(registry.has(id)).toBe(true)
    }
    // Family lookups still answer correctly for every PROVIDER_ID, including
    // ids whose adapter has not landed yet — familyOf() reads the family
    // table directly.
    for (const id of PROVIDER_IDS) {
      expect(registry.familyOf(id)).toBe(id)
    }
  })

  test('--provider fake registers a single shared FakeProvider under every id', () => {
    const { registry, fakeProvider } = buildProviderRegistry({
      providerOverride: 'fake',
    })
    expect(fakeProvider).toBeDefined()
    for (const id of PROVIDER_IDS) {
      expect(registry.has(id)).toBe(true)
    }
  })

  test('per-id family is preserved (claude→claude, codex→codex, ...) even with shared FakeProvider', () => {
    const { registry } = buildProviderRegistry({ providerOverride: 'fake' })
    for (const id of PROVIDER_IDS) {
      expect(registry.familyOf(id)).toBe(id)
    }
  })

  test('shared FakeProvider receives invokes from every id', async () => {
    const { registry, fakeProvider } = buildProviderRegistry({
      providerOverride: 'fake',
    })
    expect(fakeProvider).toBeDefined()
    fakeProvider!.expect({}).respondWith({ content: 'shared response' })
    fakeProvider!.expect({}).respondWith({ content: 'shared response 2' })

    // Invoke through different ids — both should consume the FIFO queue.
    const ids: ProviderId[] = ['claude', 'codex']
    for (const id of ids) {
      const adapter = registry.get(id)
      // Build a minimal PreparedProviderRequest stub matching IAgentProvider.invoke
      const stream = adapter.invoke({
        agent: {
          file: '/tmp/x.md',
          name: 'ba',
          type: 'agent',
          phase: 'define',
          provider: id,
          modelPolicy: 'any',
          permissions: { read: '*', write: '*', bash: 'deny' },
          description: 'x',
          body: 'x',
        },
        phase: 'define',
        runId: '01J3Z000000000000000000000',
        prompt: 'p',
        files: [],
        manifest: { files: [] },
        metrics: { filesSent: 0, bytesSent: 0, tokensEstimate: 0, fieldsRemovedByScope: 0 },
      })
      let last = ''
      for await (const ev of stream) {
        if (ev.type === 'turn_completed') last = ev.response.content
      }
      expect(last.length).toBeGreaterThan(0)
    }
  })

  test('health() reports the per-id provider name even though backed by FakeProvider', async () => {
    const { registry } = buildProviderRegistry({ providerOverride: 'fake' })
    const claudeHealth = await registry.get('claude').health()
    expect(claudeHealth.provider).toBe('claude')
    const codexHealth = await registry.get('codex').health()
    expect(codexHealth.provider).toBe('codex')
  })
})

// --- subprocess assertions -----------------------------------------

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

describe('code-oz run --provider <id>', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'code-oz-provider-cli-'))
    await mkdir(join(tmp, '.code-oz'), { recursive: true })
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('rejects unknown provider value', async () => {
    const r = await runSubprocess(['--provider', 'bogus', '--request', 'hi'], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("only accepts 'fake'")
  })

  test('rejects --provider without a value', async () => {
    const r = await runSubprocess(['--provider'], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('requires a value')
  })

  test('--provider=fake form accepted (parsed without subsequent error)', async () => {
    // Use no .code-oz/ scaffold so the run errors at the .code-oz/ check —
    // proves the flag was accepted by the parser before that point.
    const r = await runSubprocess(['--provider=fake', '--request', 'hi'], tmp)
    // We expect the .code-oz/ check to pass (we created it), then hit the
    // ask-me runner; the FakeProvider default reply has no <spec-ready/>,
    // so the runner ends with max_rounds_exhausted (intervention status, exit 1).
    expect([1, 2]).toContain(r.exitCode)
    // If exit was 2, it should NOT be due to provider parsing.
    if (r.exitCode === 2) {
      expect(r.stderr).not.toContain('--provider only accepts')
    }
  })

  test('--help mentions --provider', async () => {
    const r = await runSubprocess(['--help'], tmp)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('--provider')
    expect(r.stdout).toContain('fake')
  })
})
