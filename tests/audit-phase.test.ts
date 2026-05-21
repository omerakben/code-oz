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
  // Brownfield: initRun emits run_started + phase_entered(audit).
  await initRun({ paths, profile: 'brownfield', runId: RUN, now: () => '2026-05-21T11:00:00.000Z' })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
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
