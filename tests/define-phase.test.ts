import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runDefine } from '../src/phases/define.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG, type AskMeConfig } from '../src/config/schema.ts'
import { parseSpec } from '../src/artifacts/spec.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-define-'))
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
  // initRun seeds run_started + phase_entered events.
  await initRun({ paths, profile: 'greenfield', runId: RUN })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function baAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/ba.md',
    name: 'ba',
    type: 'agent' as const,
    phase: 'define' as const,
    provider: 'fake' as const,
    modelPolicy: 'any' as const,
    permissions: {
      read: '*' as const,
      write: ['./SPEC.md'] as readonly string[],
      bash: 'deny' as const,
    },
    description: 'ba stub',
    body: '## BA persona\n\nask questions.',
  })
}

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG,
    now: () => '2026-04-30T12:00:00.000Z',
  }
}

function askMeConfig(overrides: Partial<AskMeConfig> = {}): AskMeConfig {
  return { ...DEFAULT_CONFIG.phases.define.askMe, ...overrides }
}

const VALID_DRAFT = [
  '# SPEC',
  '',
  '## Goals',
  '',
  '- Help a parent name their newborn.',
  '',
  '## Users',
  '',
  '- New parents.',
  '',
  '## Constraints',
  '',
  '- Runs locally.',
  '',
  '## Acceptance criteria',
  '',
  '- 5 candidates per surname.',
  '',
  '## Open questions',
  '',
  '- None known at define time.',
  '',
  '## Explicit non-goals',
  '',
  '- Not a registry.',
  '',
].join('\n')

const READY_REPLY = `Got it.\n\n<spec-ready/>\n${VALID_DRAFT}`

describe('runDefine — success path', () => {
  test('writes canonical SPEC.md, calls requireGate, returns complete', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: READY_REPLY,
    })

    const result = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'I want a baby naming game',
      readNextUserInput: async () => null,
      fsyncDir: false,
    })

    expect(result.status).toBe('complete')
    if (result.status === 'complete') {
      const text = await readFile(result.specPath, 'utf8')
      // Round-trip through parseSpec to ensure canonical form.
      const reparsed = parseSpec(text)
      expect(reparsed.goals.length).toBe(1)
      expect(reparsed.nonGoals.length).toBe(1)
      // Path is under artifactRoot
      expect(result.specPath).toBe(join(paths.artifactRoot, 'SPEC.md'))
      // Trailing newline (canonical form)
      expect(text.endsWith('\n')).toBe(true)
    }

    const events = await readEvents({
      file: paths.eventsFile,
      lockDir: paths.lockDir,
    })
    const gateRequired = events.filter((e) => e.type === 'gate_required')
    expect(gateRequired.length).toBe(1)
  })

  test('does NOT write SPEC.draft.md on success', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: READY_REPLY,
    })

    await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
      fsyncDir: false,
    })

    let draftStatErr: unknown
    try {
      await stat(join(paths.artifactRoot, 'SPEC.draft.md'))
    } catch (e) {
      draftStatErr = e
    }
    expect(draftStatErr).toBeDefined()
    expect((draftStatErr as NodeJS.ErrnoException).code).toBe('ENOENT')
  })
})

describe('runDefine — validation_failed path', () => {
  test('writes SPEC.draft.md and NEEDS_INTERVENTION; never writes canonical SPEC.md', async () => {
    const badDraft = VALID_DRAFT.replace(/## Explicit non-goals[\s\S]*$/, '').trimEnd() + '\n'
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: `<spec-ready/>\n${badDraft}`,
    })
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: `<spec-ready/>\n${badDraft}`,
    })

    const result = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({ maxRepairTurns: 1 }),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
      fsyncDir: false,
    })

    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('spec_validation_failed')
      expect(result.draftPath).toBe(join(paths.artifactRoot, 'SPEC.draft.md'))
      const draft = await readFile(result.draftPath!, 'utf8')
      expect(draft.length).toBeGreaterThan(0)
    }

    // SPEC.md must NOT exist
    let canonStatErr: unknown
    try {
      await stat(join(paths.artifactRoot, 'SPEC.md'))
    } catch (e) {
      canonStatErr = e
    }
    expect((canonStatErr as NodeJS.ErrnoException).code).toBe('ENOENT')

    // NEEDS_INTERVENTION exists
    const intervention = await readFile(
      join(paths.runDir, 'NEEDS_INTERVENTION.json'),
      'utf8',
    )
    const parsed = JSON.parse(intervention)
    expect(parsed.code).toBe('spec_validation_failed')
    expect(parsed.phase).toBe('define')

    // intervention event recorded
    const events = await readEvents({
      file: paths.eventsFile,
      lockDir: paths.lockDir,
    })
    const interventions = events.filter((e) => e.type === 'intervention')
    expect(interventions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('runDefine — truncated path', () => {
  test('writes SPEC.draft.md if there is extractable draft + NEEDS_INTERVENTION (spec_truncated)', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: '<spec-ready/>\n# SPEC\n\n## Goals\n\n- partial',
      stopReason: 'max_tokens',
    })

    const result = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
      fsyncDir: false,
    })

    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('spec_truncated')
      expect(result.draftPath).toBeDefined()
      const draft = await readFile(result.draftPath!, 'utf8')
      expect(draft).toContain('# SPEC')
    }
  })

  test('writes NO draft when truncated reply lacks ready signal', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: 'still talking',
      stopReason: 'max_tokens',
    })

    const result = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
      fsyncDir: false,
    })

    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('spec_truncated')
      expect(result.draftPath).toBeUndefined()
    }
    let draftErr: unknown
    try {
      await stat(join(paths.artifactRoot, 'SPEC.draft.md'))
    } catch (e) {
      draftErr = e
    }
    expect((draftErr as NodeJS.ErrnoException).code).toBe('ENOENT')
  })
})

describe('runDefine — max_rounds_exhausted path', () => {
  test('writes NEEDS_INTERVENTION (ask_me_max_rounds_exceeded), no draft, no canonical SPEC', async () => {
    // Two regular non-ready replies; onMaxRounds: fail blocks finalize.
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q1?' })
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q2?' })

    const userInputs = ['answer 1']
    let i = 0
    const result = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({ maxRounds: 2, onMaxRounds: 'fail' }),
      initialUserInput: 'help',
      readNextUserInput: async () => userInputs[i++] ?? null,
      fsyncDir: false,
    })

    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('ask_me_max_rounds_exceeded')
      expect(result.draftPath).toBeUndefined()
    }
  })
})

describe('runDefine — provider_error path', () => {
  test('does NOT write a second NEEDS_INTERVENTION (the wrapper already wrote one)', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).fail({
      code: 'provider_auth_missing',
      rule: 'fake auth missing',
      actionableSuggestions: ['log in'],
    })

    const result = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
      fsyncDir: false,
    })

    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('provider_auth_missing')
      expect(result.providerError).toBeDefined()
    }

    // The intervention event count should be exactly 1 — written by the
    // wrapper, NOT a second one from runDefine.
    const events = await readEvents({
      file: paths.eventsFile,
      lockDir: paths.lockDir,
    })
    const interventions = events.filter((e) => e.type === 'intervention')
    expect(interventions.length).toBe(1)
  })
})

describe('runDefine — atomic write', () => {
  test('SPEC.md write is durable: re-readable after the call returns', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: READY_REPLY })

    const result = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
      fsyncDir: false,
    })

    expect(result.status).toBe('complete')
    if (result.status === 'complete') {
      const stat1 = await stat(result.specPath)
      const stat2 = await stat(result.specPath)
      expect(stat1.size).toBe(stat2.size)
      expect(stat1.size).toBeGreaterThan(0)
    }
  })
})
