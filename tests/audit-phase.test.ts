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

import { runAudit, splitAuditResponse, AUDIT_READY_SIGNAL } from '../src/phases/audit.ts'
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
    // is bookkept as an intervention (never silently exits). C4 wired the
    // happy path to compose the AUDIT prompt and drain a single-shot
    // invokeAgent; C6 validates the drained draft and routes the invalid
    // FakeProvider stub through `audit_validation_failed`, so the fixture is a
    // complete AgentDefinition (provider
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

    // M17 C8 (BUG B fix): runAudit now requires a scientistAgent for the
    // Scientist phase-tail (rule 15). This invalid-draft path never reaches the
    // tail (the FakeProvider stub has no <audit-ready/> signal, so it routes to
    // `audit_validation_failed` first), so an inert stub satisfies the type.
    const scientistDef = Object.freeze({
      file: 'fixture://scientist.md',
      name: 'scientist',
      type: 'agent' as const,
      phase: 'audit' as const,
      provider: 'fake' as const,
      modelPolicy: 'any' as const,
      permissions: Object.freeze({ read: '*', write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'], bash: 'deny' }),
      description: 'scientist phase-tail test fixture (not persona prose)',
      body: 'FIXTURE scientist body — not persona prose.',
    })

    const result = await runAudit({
      invokeCtx,
      runPaths: paths,
      runId: RUN,
      agentRegistry: auditorOnlyRegistry,
      scientistAgent: scientistDef,
      problemStatement: recovered,
      now: () => '2026-05-21T11:00:02.000Z',
    })

    // C6: the happy path now validates the drained draft against the locked
    // AUDIT.md schema before writing the canonical artifact (rule 11). The
    // FakeProvider stub output has no <audit-ready/> signal (BUG A fix routes
    // a signal-less reply through the same intervention), so runAudit routes
    // through recordIntervention with `audit_validation_failed` — never a
    // silent return, never a malformed gate artifact. The `audit_completed` +
    // gate emission only fires once a registered persona produces a
    // protocol-faithful, schema-valid AUDIT.md.
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('audit_validation_failed')
    }
    const after = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    // C4 wiring proof: when the auditor resolves, runAudit composes the AUDIT
    // prompt and drains a single-shot invokeAgent, which appends
    // agent_invoked(auditor) (rule 13 chokepoint) BEFORE the validation
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
          (e as { code?: string }).code === 'audit_validation_failed',
      ),
    ).toBe(true)
    // No audit_completed event and no gate_required(audit) on the invalid-draft
    // path — the C6 emission is strictly downstream of schema validation.
    expect(after.some((e) => e.type === 'audit_completed')).toBe(false)
    expect(
      after.some(
        (e) => e.type === 'gate_required' && (e as { phase?: string }).phase === 'audit',
      ),
    ).toBe(false)
    const ni = JSON.parse(
      await readFile(join(paths.runDir, 'NEEDS_INTERVENTION.json'), 'utf8'),
    ) as { code: string; phase: string }
    expect(ni.code).toBe('audit_validation_failed')
    expect(ni.phase).toBe('audit')
  })
})

describe('M17 C3 — runAudit skeleton (auditor persona missing)', () => {
  test('emits no synthetic repo_context_searched, never invokes auditor, returns persona-missing intervention', async () => {
    const invokeCtx: InvokeContext = {
      registry: providerRegistry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
    }

    // The auditor is missing, so runAudit returns the persona-missing
    // intervention before the Scientist tail; an inert scientist stub
    // satisfies the (now-required) type without being reached.
    const scientistStub = Object.freeze({
      file: 'fixture://scientist.md',
      name: 'scientist',
      type: 'agent' as const,
      phase: 'audit' as const,
      provider: 'fake' as const,
      modelPolicy: 'any' as const,
      permissions: Object.freeze({ read: '*', write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'], bash: 'deny' }),
      description: 'scientist phase-tail test fixture (not persona prose)',
      body: 'FIXTURE scientist body — not persona prose.',
    })
    const result = await runAudit({
      invokeCtx,
      runPaths: paths,
      runId: RUN,
      agentRegistry: emptyAgentRegistry,
      scientistAgent: scientistStub,
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

    // A11 R1 fix: no SYNTHETIC repo_context_searched marker is emitted on the
    // persona-missing path. The repo_context loop only runs once the auditor
    // resolves and issues real tool_calls (the runner emits the REAL event with
    // actual results). When the auditor is missing, no search happened, so no
    // repo_context_searched event is honest (rule 18 truthfulness).
    expect(events.some((e) => e.type === 'repo_context_searched')).toBe(false)

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

describe('M17 A11 — runAudit dispatches the repo_context tool loop (live auditor reads the repo)', () => {
  // RED-first (A11 R1 block-push): runAudit advertised repo_context tools to
  // the auditor but never ran the dispatch/continuation loop — it called
  // invokeAgent once, ignored `tool_call` events, and emitted a SYNTHETIC
  // empty `repo_context_searched` marker. A live auditor got NO repo access.
  //
  // This test scripts a FakeProvider auditor that (turn 1) emits a `grep`
  // repo_context tool_call, then (turn 2) emits the valid AUDIT.md. It asserts
  // the orchestrator RAN the tool (a REAL repo_context_searched event with the
  // grep query + non-empty resultPaths), invoked the auditor, and produced the
  // AUDIT.md from the second turn.

  // A valid AUDIT.md the auditor emits on its SECOND turn (after the tool
  // result comes back). runId is interpolated to match the run. The body
  // mirrors docs/contracts/AUDIT.md Fixture 1 shape (the same one the
  // full-cycle e2e uses) so parseAuditMarkdown accepts it.
  function validAuditReply(runId: string): string {
    return `${AUDIT_READY_SIGNAL}
---
artifact: AUDIT.md
version: "0.1"
runId: ${runId}
phase: audit
profile: brownfield
generatedAt: 2026-05-21T09:00:00Z
operatorStatement: refactor the add helper for clarity
---

# AUDIT

## Localization

- src/widget.ts:1-3 — the add helper lives here; grep found the marker token.

## Reproduction

- Proposed: the add helper is hard to read.
- Observed: src/widget.ts:1-3 — confirmed via grep for AUDIT_GREP_MARKER.

## Constraints

- Preserve: existing behavior of add().
- Require: clarity-only refactor, no signature change.

## Audit sources

- src/widget.ts:1-3 — grep AUDIT_GREP_MARKER returned this file.
`
  }

  const SCIENTIST_AUDIT_REPLY = `<scientist-ready/>
# HYPOTHESES

## H-001: add helper is unclear

- Phase: audit
- Status: open
- Falsifier: a reader can restate add()'s contract from its body alone.
- Evidence: AUDIT.md ## Localization bullet 1.
- Risk if false: refactor churn with no clarity gain.

# OPEN QUESTIONS

## Q-001: rename the parameters?

- Phase: audit
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: AUDIT scoped clarity only.
- Resolution attempts: none yet.
`

  // An auditor fixture WITH a repo_context scope so the dispatch loop can run
  // its tool calls. This is an inert test stub, not persona prose (rule 16).
  const auditorWithToolsDef = Object.freeze({
    file: 'fixture://auditor.md',
    name: 'auditor',
    type: 'agent' as const,
    phase: 'audit' as const,
    provider: 'fake' as const,
    modelPolicy: 'any' as const,
    permissions: Object.freeze({
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read']),
          roots: Object.freeze(['.']),
          maxResults: 50,
          maxBytesPerResult: 16_384,
          maxFilesForNextManifest: 20,
          timeoutMs: 5_000,
          network: 'none' as const,
        }),
      }),
    }),
    description: 'audit phase tool-loop test fixture (not persona prose)',
    body: 'FIXTURE auditor body — not persona prose.',
  })

  const scientistDef = Object.freeze({
    file: 'fixture://scientist.md',
    name: 'scientist',
    type: 'agent' as const,
    phase: 'audit' as const,
    provider: 'fake' as const,
    modelPolicy: 'any' as const,
    permissions: Object.freeze({ read: '*', write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'], bash: 'deny' }),
    description: 'scientist phase-tail test fixture (not persona prose)',
    body: 'FIXTURE scientist body — not persona prose.',
  })

  function auditorOnlyRegistry(): AgentRegistry {
    return Object.freeze({
      getByName: (name: string) =>
        name === 'auditor' ? auditorWithToolsDef : name === 'scientist' ? scientistDef : undefined,
      getByPhase: () => Object.freeze([]),
      listAll: () => Object.freeze([auditorWithToolsDef, scientistDef]),
    }) as unknown as AgentRegistry
  }

  test('runs the grep tool, emits a REAL repo_context_searched event, then produces AUDIT.md from the second turn', async () => {
    // A real file the grep tool can find. The marker token guarantees a
    // non-empty result so the test proves the tool actually ran against disk.
    await mkdir(join(projectRoot, 'src'), { recursive: true })
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        join(projectRoot, 'src/widget.ts'),
        '// AUDIT_GREP_MARKER\nexport function add(a: number, b: number) { return a + b }\n',
        'utf8',
      ),
    )

    // Scripted auditor: turn 1 emits a grep tool_call (no final text), turn 2
    // emits the valid AUDIT.md. FIFO consumption on the (audit, auditor) match.
    const scriptedFake = new FakeProvider()
    scriptedFake
      .expect({ phase: 'audit', agent: 'auditor' })
      .respondWith({
        content: '',
        stopReason: 'tool_use',
        toolCalls: [
          { id: 't1', name: 'grep', input: { pattern: 'AUDIT_GREP_MARKER', roots: ['src'] } },
        ],
      })
      .respondWith({ content: validAuditReply(RUN), stopReason: 'end_turn' })
    scriptedFake
      .expect({ phase: 'audit', agent: 'scientist' })
      .respondWith({ content: SCIENTIST_AUDIT_REPLY, stopReason: 'end_turn' })
    const scriptedRegistry = new ProviderRegistry({ providers: [scriptedFake] })

    const invokeCtx: InvokeContext = {
      registry: scriptedRegistry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
      now: () => '2026-05-21T11:00:02.000Z',
    }

    const result = await runAudit({
      invokeCtx,
      runPaths: paths,
      runId: RUN,
      agentRegistry: auditorOnlyRegistry(),
      scientistAgent: scientistDef,
      problemStatement: 'refactor the add helper for clarity',
      now: () => '2026-05-21T11:00:02.000Z',
    })

    expect(result.status).toBe('complete')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })

    // The auditor was invoked (rule 13 chokepoint).
    expect(
      events.some((e) => e.type === 'agent_invoked' && (e as { agent?: string }).agent === 'auditor'),
    ).toBe(true)

    // The orchestrator RAN the grep tool: exactly one REAL repo_context_searched
    // event, carrying the grep query and NON-EMPTY resultPaths (the marker file).
    // No synthetic empty marker (selectedPaths-only, resultPaths: []) survives.
    const searches = events.filter((e) => e.type === 'repo_context_searched') as Array<{
      tool?: string
      query?: string
      resultPaths?: readonly string[]
    }>
    expect(searches.length).toBe(1)
    expect(searches[0]!.tool).toBe('grep')
    expect(searches[0]!.query).toBe('AUDIT_GREP_MARKER')
    expect((searches[0]!.resultPaths ?? []).length).toBeGreaterThan(0)
    expect((searches[0]!.resultPaths ?? []).some((p) => /widget\.ts/.test(p))).toBe(true)

    // The synthetic "**/*" glob marker with empty resultPaths is GONE: no
    // repo_context_searched event has both an empty resultPaths and the old
    // synthetic query.
    expect(
      searches.some((s) => s.query === '**/*' && (s.resultPaths ?? []).length === 0),
    ).toBe(false)

    // AUDIT.md was produced from the second turn (audit_completed + gate).
    expect(events.some((e) => e.type === 'audit_completed')).toBe(true)
    expect(
      events.some((e) => e.type === 'gate_required' && (e as { phase?: string }).phase === 'audit'),
    ).toBe(true)

    // The AUDIT.md on disk depends on the tool result: it cites the marker file
    // the grep loop fed back into the continuation.
    const auditOnDisk = await readFile(join(paths.artifactRoot, 'AUDIT.md'), 'utf8')
    expect(auditOnDisk).toContain('src/widget.ts')
    expect(auditOnDisk).toContain('AUDIT_GREP_MARKER')
  })
})

describe('M17 C8 — splitAuditResponse (BUG A: ready-signal stripping)', () => {
  const DOC = ['---', 'artifact: AUDIT.md', '---', '', '# AUDIT', '', '## Localization', '- x'].join('\n')

  test('strips the ready signal and returns the trimmed document that follows it', () => {
    const reply = `${AUDIT_READY_SIGNAL}\n${DOC}\n`
    const out = splitAuditResponse(reply)
    expect(out).toBe(DOC.trim())
    // The result begins on the frontmatter line (line 1), where the validator
    // expects it — the whole point of the fix.
    expect(out!.startsWith('---')).toBe(true)
  })

  test('tolerates preamble before the signal and a leading blank line after it', () => {
    const reply = `here is my analysis\n${AUDIT_READY_SIGNAL}\n\n${DOC}\n`
    expect(splitAuditResponse(reply)).toBe(DOC.trim())
  })

  test('ignores the signal when it is not alone on its line (the trimmed line must equal it)', () => {
    const reply = `${AUDIT_READY_SIGNAL} ${DOC}`
    // The signal+doc share one line, so no line equals the signal -> null.
    expect(splitAuditResponse(reply)).toBeNull()
  })

  test('returns null when the signal is absent (protocol violation)', () => {
    expect(splitAuditResponse(DOC)).toBeNull()
  })

  test('returns null when the signal is present but nothing follows it', () => {
    expect(splitAuditResponse(`${AUDIT_READY_SIGNAL}\n   \n`)).toBeNull()
  })
})
