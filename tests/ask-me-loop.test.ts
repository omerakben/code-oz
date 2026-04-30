import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runAskMe, extractDraft } from '../src/phases/ask-me.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents, type EventLogPaths } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG, type AskMeConfig } from '../src/config/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-askme-'))
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

function baAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
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
    body: '## BA persona\n\nI ask questions.',
    ...overrides,
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

function eventPaths(): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

function askMeConfig(overrides: Partial<AskMeConfig> = {}): AskMeConfig {
  return {
    ...DEFAULT_CONFIG.phases.define.askMe,
    ...overrides,
  }
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
  '- Given a surname, produces 5 candidates.',
  '',
  '## Open questions',
  '',
  '- None known at define time.',
  '',
  '## Explicit non-goals',
  '',
  '- Not building a registry.',
  '',
].join('\n')

function readyContent(draft: string = VALID_DRAFT): string {
  return `Got it.\n\n<spec-ready/>\n${draft}`
}

// --- extractDraft -------------------------------------------------

describe('extractDraft', () => {
  test('returns null when no ready signal is present', () => {
    expect(extractDraft('hello world', '<spec-ready/>')).toBeNull()
  })

  test('returns the trimmed draft when the signal is alone on a line', () => {
    const text = 'preamble\n\n<spec-ready/>\n# SPEC\n\n## Goals\n\n- a\n'
    const draft = extractDraft(text, '<spec-ready/>')
    expect(draft).not.toBeNull()
    expect(draft!.startsWith('# SPEC')).toBe(true)
  })

  test('does NOT match a token embedded in prose', () => {
    const text = 'I will emit `<spec-ready/>` when ready.'
    expect(extractDraft(text, '<spec-ready/>')).toBeNull()
  })

  test('does NOT match a token with content on the same line', () => {
    const text = '<spec-ready/> # SPEC\n\n## Goals\n- a'
    expect(extractDraft(text, '<spec-ready/>')).toBeNull()
  })

  test('matches with leading/trailing whitespace on the token line', () => {
    const text = 'reply\n   <spec-ready/>   \n# SPEC\n\n## Goals\n- a'
    const draft = extractDraft(text, '<spec-ready/>')
    expect(draft).not.toBeNull()
    expect(draft!.startsWith('# SPEC')).toBe(true)
  })

  test('uses the first occurrence (multiline regex)', () => {
    const text = 'a\n<spec-ready/>\nfirst draft\n<spec-ready/>\nsecond'
    const draft = extractDraft(text, '<spec-ready/>')
    expect(draft).toContain('first draft')
    expect(draft).toContain('second')
  })

  test('escapes regex metacharacters in custom signals', () => {
    const text = 'header\n[ READY+ ]\nbody'
    const draft = extractDraft(text, '[ READY+ ]')
    expect(draft).toBe('body')
  })
})

// --- runAskMe — success path -------------------------------------

describe('runAskMe — success on first persona reply', () => {
  test('valid draft on the very first turn returns success', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: readyContent(),
      model: 'fake-1',
    })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'I want a baby naming game',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.spec.goals.length).toBe(1)
      expect(result.spec.nonGoals.length).toBe(1)
    }
  })

  test('logs ask_me_user_input + ask_me_persona_reply on success', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: readyContent(),
      model: 'fake-1',
    })

    await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'I want a thing',
      readNextUserInput: async () => null,
    })

    const events = await readEvents(eventPaths())
    const userInputs = events.filter((e) => e.type === 'ask_me_user_input')
    const personaReplies = events.filter((e) => e.type === 'ask_me_persona_reply')
    expect(userInputs.length).toBe(1)
    expect(personaReplies.length).toBe(1)
    // First ask_me_persona_reply has ready: true
    const reply = personaReplies[0] as { ready: boolean }
    expect(reply.ready).toBe(true)
  })
})

// --- runAskMe — multi-turn conversation --------------------------

describe('runAskMe — multi-turn conversation', () => {
  test('asks N follow-up questions before signaling ready', async () => {
    // Turn 0: not ready
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: 'What age range is the game for?',
      model: 'fake-1',
    })
    // Turn 1: not ready
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: 'On what device?',
      model: 'fake-1',
    })
    // Turn 2: ready
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: readyContent(),
      model: 'fake-1',
    })

    const userInputs = ['toddlers', 'a phone']
    let inputIdx = 0
    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'I want a baby game',
      readNextUserInput: async () => userInputs[inputIdx++] ?? null,
    })

    expect(result.status).toBe('success')

    const events = await readEvents(eventPaths())
    const userInputEvents = events.filter((e) => e.type === 'ask_me_user_input')
    const personaReplies = events.filter((e) => e.type === 'ask_me_persona_reply')
    expect(userInputEvents.length).toBe(3) // turn 0, 1, 2
    expect(personaReplies.length).toBe(3)
  })
})

// --- runAskMe — repair turn --------------------------------------

describe('runAskMe — repair turn', () => {
  test('valid draft after one repair turn returns success', async () => {
    // Turn 0: ready signal but draft missing the non-goals section
    const badDraft = VALID_DRAFT.replace(/## Explicit non-goals[\s\S]*$/, '').trimEnd() + '\n'
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: `<spec-ready/>\n${badDraft}`,
      model: 'fake-1',
    })
    // Repair turn: full valid draft
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: readyContent(),
      model: 'fake-1',
    })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({ maxRepairTurns: 1 }),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('success')
    const events = await readEvents(eventPaths())
    const userInputEvents = events.filter((e) => e.type === 'ask_me_user_input')
    // Initial user input + one synthetic repair user input
    expect(userInputEvents.length).toBe(2)
  })

  test('validation_failed when both initial draft and repair draft fail parse', async () => {
    const badDraft = VALID_DRAFT.replace(/## Explicit non-goals[\s\S]*$/, '').trimEnd() + '\n'
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: `<spec-ready/>\n${badDraft}`,
    })
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: `<spec-ready/>\n${badDraft}`,
    })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({ maxRepairTurns: 1 }),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('validation_failed')
    if (result.status === 'validation_failed') {
      expect(result.draft.length).toBeGreaterThan(0)
      expect(result.issues.length).toBeGreaterThan(0)
    }
  })

  test('maxRepairTurns: 0 short-circuits — first failure becomes validation_failed', async () => {
    const badDraft = VALID_DRAFT.replace(/## Explicit non-goals[\s\S]*$/, '').trimEnd() + '\n'
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: `<spec-ready/>\n${badDraft}`,
    })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({ maxRepairTurns: 0 }),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('validation_failed')
  })
})

// --- runAskMe — truncation ---------------------------------------

describe('runAskMe — truncated stop reason', () => {
  test('returns truncated when stopReason is max_tokens (with extractable draft)', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: readyContent('# SPEC\n\n## Goals\n\n- partial goal'),
      stopReason: 'max_tokens',
    })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('truncated')
    if (result.status === 'truncated') {
      expect(result.draft).toContain('# SPEC')
    }
  })

  test('truncated with no ready signal yields empty draft', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: 'still talking',
      stopReason: 'max_tokens',
    })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('truncated')
    if (result.status === 'truncated') {
      expect(result.draft).toBe('')
    }
  })
})

// --- runAskMe — max-rounds + finalize ----------------------------

describe('runAskMe — max-rounds finalize behavior', () => {
  test('finalize ritual produces a SPEC after maxRounds without ready signal', async () => {
    // Two regular turns without ready
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q1?' })
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q2?' })
    // Finalize turn produces a valid draft
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: readyContent(),
    })

    const userInputs = ['answer 1']
    let i = 0
    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({ maxRounds: 2, maxFinalizeTurns: 1 }),
      initialUserInput: 'help',
      readNextUserInput: async () => userInputs[i++] ?? null,
    })

    expect(result.status).toBe('success')
  })

  test('onMaxRounds: fail — exhausts loop and returns max_rounds_exhausted', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q1?' })
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q2?' })

    const userInputs = ['answer 1']
    let i = 0
    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({
        maxRounds: 2,
        onMaxRounds: 'fail',
        maxFinalizeTurns: 1,
      }),
      initialUserInput: 'help',
      readNextUserInput: async () => userInputs[i++] ?? null,
    })

    expect(result.status).toBe('max_rounds_exhausted')
  })

  test('onMaxRounds: finalize but maxFinalizeTurns: 0 falls through to max_rounds_exhausted', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q1?' })
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q2?' })

    const userInputs = ['answer 1']
    let i = 0
    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({
        maxRounds: 2,
        onMaxRounds: 'finalize',
        maxFinalizeTurns: 0,
      }),
      initialUserInput: 'help',
      readNextUserInput: async () => userInputs[i++] ?? null,
    })

    expect(result.status).toBe('max_rounds_exhausted')
  })

  test('readNextUserInput returning null during regular loop ends with max_rounds_exhausted', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'q1?' })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig({
        maxRounds: 5,
        onMaxRounds: 'fail',
      }),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('max_rounds_exhausted')
  })
})

// --- runAskMe — provider error -----------------------------------

describe('runAskMe — provider error propagation', () => {
  test('ProviderError surfaces as provider_error status with the original error', async () => {
    fake.expect({ phase: 'define', agent: 'ba' }).fail({
      code: 'provider_auth_missing',
      rule: 'fake auth missing',
      actionableSuggestions: ['log in'],
    })

    const result = await runAskMe({
      invokeCtx: invokeCtx(),
      eventPaths: eventPaths(),
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'help',
      readNextUserInput: async () => null,
    })

    expect(result.status).toBe('provider_error')
    if (result.status === 'provider_error') {
      expect(result.error.issues[0]!.code).toBe('provider_auth_missing')
    }
  })
})

// --- runAskMe — empty input rejection ----------------------------

describe('runAskMe — input validation', () => {
  test('throws when initialUserInput is whitespace-only', async () => {
    let err: unknown
    try {
      await runAskMe({
        invokeCtx: invokeCtx(),
        eventPaths: eventPaths(),
        runId: RUN,
        agent: baAgent(),
        config: askMeConfig(),
        initialUserInput: '   \n  ',
        readNextUserInput: async () => null,
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('non-empty')
  })
})
