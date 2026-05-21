// M17 C3 — focused RED test for the AUDIT phase skeleton (runAudit).
//
// Asserts the C3 failure endpoint: with NO auditor persona registered,
// runAudit on a brownfield run
//   - emits `repo_context_searched` (honest `selectedPaths: []` per rule 18;
//     promotion deferred to M18),
//   - does NOT emit `agent_invoked(auditor)` (the auditor cannot be invoked
//     because `src/agents/defaults/auditor.md` does not exist until C4),
//   - returns an intervention with the persona-missing code and writes
//     NEEDS_INTERVENTION.json (rule 11: actionable signal, never a stack trace).
//
// `phase_entered(audit)` is emitted by `initRun` (initialPhase('brownfield')
// === 'audit'), so the fixture seeds it; the test asserts it is present in the
// final event log.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runAudit } from '../src/phases/audit.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { AgentRegistry } from '../src/agents/loader.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths
let providerRegistry: ProviderRegistry

// An agent registry with no `auditor` (and no other persona). Mirrors the
// real state at C3: the bundled defaults do not yet include auditor.md.
const emptyAgentRegistry: AgentRegistry = Object.freeze({
  getByName: () => undefined,
  getByPhase: () => Object.freeze([]),
  listAll: () => Object.freeze([]),
})

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-audit-'))
  projectRoot = tmp
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  providerRegistry = new ProviderRegistry({ providers: [new FakeProvider()] })
  // Brownfield: initRun emits run_started + phase_entered(audit). The operator
  // problem statement is persisted on run_started (event-derived, rule 1).
  await initRun({
    paths,
    profile: 'brownfield',
    runId: RUN,
    problemStatement: 'refactor the add helper for clarity',
    now: () => '2026-05-21T11:00:00.000Z',
  })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('M17 C4-prep — operator problemStatement persisted on run_started (event-derived)', () => {
  test('initRun(brownfield, problemStatement) records it on the run_started event', async () => {
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const runStarted = events.find((e) => e.type === 'run_started')
    expect(runStarted).toBeDefined()
    // beforeEach seeded initRun with this problemStatement; it must persist
    // on the run_started event (rule 1: event-derived, not current.json).
    expect((runStarted as { problemStatement?: string }).problemStatement).toBe(
      'refactor the add helper for clarity',
    )
  })

  test('greenfield run_started omits problemStatement when none is given', async () => {
    const gfPaths = runPathsFor(
      join(tmp, '.code-oz/state-gf'),
      join(tmp, '.code-oz/artifacts-gf'),
      RUN,
    )
    await mkdir(gfPaths.runDir, { recursive: true })
    await initRun({ paths: gfPaths, profile: 'greenfield', runId: RUN, now: () => '2026-05-21T11:00:00.000Z' })
    const events = await readEvents({ file: gfPaths.eventsFile, lockDir: gfPaths.lockDir })
    const runStarted = events.find((e) => e.type === 'run_started') as Record<string, unknown>
    expect(runStarted).toBeDefined()
    // The key is absent (not present-but-empty) so greenfield run_started
    // shape is byte-for-byte unchanged.
    expect('problemStatement' in runStarted).toBe(false)
  })

  test('runAudit consumes the problemStatement it is handed (the event-derived value)', async () => {
    // Resume case: dispatchAudit recovers problemStatement from the event log
    // (the in-memory --request is gone) and hands it to runAudit. Here we
    // simulate that recovery by reading run_started ourselves and passing the
    // value through, asserting runAudit uses it rather than re-deriving ''.
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const runStarted = events.find((e) => e.type === 'run_started') as {
      problemStatement?: string
    }
    const recovered = runStarted.problemStatement ?? ''
    expect(recovered).toBe('refactor the add helper for clarity')

    const invokeCtx: InvokeContext = {
      registry: providerRegistry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
      // C4: the wired happy path now drains a real invokeAgent against
      // FakeProvider, so the wrapper's wall-time budget check needs a clock
      // consistent with the run_started timestamp (seeded at 11:00:00Z).
      now: () => '2026-05-21T11:00:02.000Z',
    }
    // Register an auditor so the happy-path fallback is reachable; assert it
    // is bookkept as an intervention (Fix 2: never silently exits). C4 wired
    // the happy path to compose the AUDIT prompt and drain a single-shot
    // invokeAgent before falling through to the not-yet-implemented
    // intervention, so the fixture is a complete AgentDefinition (provider
    // `fake`, no repo_context tools) and the invocation runs against
    // FakeProvider. The real bundled `auditor.md` (frontmatter + co-authored
    // body) lands in the human co-authoring step (rule 16); this fixture body
    // is NOT persona prose, it is an inert test stub.
    const auditorDef = Object.freeze({
      file: 'fixture://auditor.md',
      name: 'auditor',
      type: 'agent' as const,
      phase: 'audit' as const,
      provider: 'fake' as const,
      modelPolicy: 'any' as const,
      permissions: Object.freeze({}),
      description: 'audit phase test fixture (not persona prose)',
      body: 'FIXTURE auditor body — not persona prose.',
    })
    const auditorOnlyRegistry: AgentRegistry = Object.freeze({
      getByName: (name: string) => (name === 'auditor' ? auditorDef : undefined),
      getByPhase: () => Object.freeze([]),
      listAll: () => Object.freeze([auditorDef]),
    }) as unknown as AgentRegistry

    const result = await runAudit({
      invokeCtx,
      runPaths: paths,
      runId: RUN,
      agentRegistry: auditorOnlyRegistry,
      problemStatement: recovered,
      now: () => '2026-05-21T11:00:02.000Z',
    })

    // Fix 2: the not-yet-complete happy path routes through recordIntervention
    // (writes the intervention event + NEEDS_INTERVENTION.json), never a
    // silent return (rule 11).
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('audit_runtime_not_yet_complete')
    }
    const after = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    // C4 wiring proof: when the auditor resolves, runAudit composes the AUDIT
    // prompt and drains a single-shot invokeAgent, which appends
    // agent_invoked(auditor) (rule 13 chokepoint) BEFORE the not-yet-complete
    // intervention. The bundled persona is still unregistered in production
    // (rule 16), so the brownfield e2e stays RED until the human registers it.
    expect(
      after.some(
        (e) => e.type === 'agent_invoked' && (e as { agent?: string }).agent === 'auditor',
      ),
    ).toBe(true)
    expect(
      after.some(
        (e) =>
          e.type === 'intervention' &&
          (e as { code?: string }).code === 'audit_runtime_not_yet_complete',
      ),
    ).toBe(true)
    const ni = JSON.parse(
      await readFile(join(paths.runDir, 'NEEDS_INTERVENTION.json'), 'utf8'),
    ) as { code: string; phase: string }
    expect(ni.code).toBe('audit_runtime_not_yet_complete')
    expect(ni.phase).toBe('audit')
  })
})

describe('M17 C3 — runAudit skeleton (auditor persona missing)', () => {
  test('emits repo_context_searched, never invokes auditor, returns persona-missing intervention', async () => {
    const invokeCtx: InvokeContext = {
      registry: providerRegistry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
    }

    const result = await runAudit({
      invokeCtx,
      runPaths: paths,
      runId: RUN,
      agentRegistry: emptyAgentRegistry,
      problemStatement: 'tidy up the add helper',
      now: () => '2026-05-21T11:00:01.000Z',
    })

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })

    // phase_entered(audit) (from initRun) is present.
    expect(
      events.some(
        (e) => e.type === 'phase_entered' && (e as { phase?: string }).phase === 'audit',
      ),
    ).toBe(true)

    // repo_context_searched emitted with honest empty selectedPaths (rule 18).
    const repoSearch = events.find((e) => e.type === 'repo_context_searched')
    expect(repoSearch).toBeDefined()
    expect((repoSearch as { selectedPaths: readonly string[] }).selectedPaths).toEqual([])

    // The auditor persona is NOT invoked (it does not exist until C4).
    expect(
      events.some((e) => e.type === 'agent_invoked' && (e as { agent?: string }).agent === 'auditor'),
    ).toBe(false)

    // Intervention with the persona-missing code.
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('auditor_persona_not_registered')
    }

    // NEEDS_INTERVENTION.json written under the run dir.
    const niPath = join(paths.runDir, 'NEEDS_INTERVENTION.json')
    const ni = JSON.parse(await readFile(niPath, 'utf8')) as {
      code: string
      phase: string
      agent: string
    }
    expect(ni.code).toBe('auditor_persona_not_registered')
    expect(ni.phase).toBe('audit')

    // An intervention event landed in the log.
    expect(
      events.some(
        (e) => e.type === 'intervention' && (e as { code?: string }).code === 'auditor_persona_not_registered',
      ),
    ).toBe(true)
  })
})
