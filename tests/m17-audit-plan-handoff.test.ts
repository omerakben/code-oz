import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPlan, PLAN_READY_SIGNAL } from '../src/phases/plan.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import {
  parseSourceCheck,
  serializeSourceCheck,
  SOURCE_ID_PATTERN,
} from '../src/artifacts/source-check.ts'
import { SourceCheckLoadError } from '../src/artifacts/errors.ts'

// =========================================================================
// (a) Profile-aware PLAN reading — brownfield reads AUDIT.md, greenfield SPEC.md
// =========================================================================

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

const SPEC_BODY = `# SPEC

## Goals

- Help a parent name their newborn.

## Users

- New parents.

## Constraints

- Runs locally.

## Acceptance criteria

- Given a surname, the app produces 5 candidate given names.

## Open questions

- None known at define time.

## Explicit non-goals

- Not building a name registry.
`

const AUDIT_BODY = `# AUDIT

## Localization

- src/candidates/select.ts:10 — selector ignores empty surname.

## Reproduction

- Run with empty surname; observe a thrown error instead of 5 candidates.

## Constraints

- Must remain backwards-compatible with the existing CLI surface.

## Audit sources

- src/candidates/select.ts:10 — empty-surname branch is missing.
`

function leadAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/lead.md',
    name: 'lead',
    type: 'agent',
    phase: 'plan',
    provider: 'fake',
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: ['PLAN.md', 'SOURCE_CHECK.md'] as readonly string[],
      bash: 'deny' as const,
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.']),
          maxResults: 50,
          maxBytesPerResult: 16384,
          maxFilesForNextManifest: 20,
          timeoutMs: 5000,
          network: 'none' as const,
        }),
      }),
    }),
    description: 'lead stub',
    body: '## Lead persona\n\ndraft plan.',
  })
}

function scientistAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/scientist.md',
    name: 'scientist',
    type: 'agent',
    phase: 'plan',
    provider: 'fake',
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'] as readonly string[],
      bash: 'deny' as const,
    }),
    description: 'scientist stub',
    body: '## Scientist persona\n\nemit sidecars.',
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

// Greenfield Lead response — `## Spec sources` with SC-SPEC ids.
const GREENFIELD_LEAD_RESPONSE = `${PLAN_READY_SIGNAL}
# PLAN

## Goals

- Decompose SPEC into atomic tasks.

## Tasks

### T-001: Implement candidate selector

- Files: src/candidates/select.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: edge case on empty surname.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md AC-1.

## Out of scope

- Surname generation.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: Given a surname, the app produces 5 candidate given names.

## Reference sources

### SC-REF-NONE-001: No template adapter

- Searched: glob agents/templates/**/select-*.ts
- Result: no relevant pattern found.
- Why explicit: clean-room design from SPEC.

## Docs sources

### SC-DOC-NONE-001: No external library used

- Why explicit: scorer is hand-written, no API surface.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

// Brownfield Lead response — `## Audit sources` with SC-AUDIT ids.
const BROWNFIELD_LEAD_RESPONSE = `${PLAN_READY_SIGNAL}
# PLAN

## Goals

- Decompose AUDIT findings into atomic remediation tasks.

## Tasks

### T-001: Fix empty-surname branch

- Files: src/candidates/select.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: regression on populated surnames.
- Hypotheses: H-001
- Sources: SC-AUDIT-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- AUDIT.md Localization bullet 1.

## Out of scope

- Surname generation.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Audit sources

### SC-AUDIT-001: Empty-surname localization

- Audit: AUDIT.md ## Localization, bullet 1
- Quote: selector ignores empty surname.

## Reference sources

### SC-REF-NONE-001: No template adapter

- Searched: glob agents/templates/**/select-*.ts
- Result: no relevant pattern found.
- Why explicit: clean-room remediation from AUDIT.

## Docs sources

### SC-DOC-NONE-001: No external library used

- Why explicit: fix is hand-written, no API surface.

## Coverage

- T-001 -> SC-AUDIT-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

const SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: candidate selector handles empty surname

- Phase: plan
- Status: open
- Falsifier: empty surname returns five candidates without throwing.
- Evidence: source bullet 1.
- Risk if false: PLAN T-001 needs rework.

# OPEN QUESTIONS

## Q-001: gender-neutral filter?

- Phase: plan
- Status: open
- Importance: medium
- DueBy: 2026-12-31
- Context: deferred upstream.
- Resolution attempts: none yet.
`

async function setUp(profile: 'greenfield' | 'brownfield'): Promise<void> {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-m17-'))
  projectRoot = tmp
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
  await initRun({ paths, profile, runId: RUN, now: () => '2026-04-30T11:00:00.000Z' })
}

describe('runPlan — profile-aware artifact reading (M17 C7a)', () => {
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('greenfield run attaches SPEC.md to the Lead manifest', async () => {
    await setUp('greenfield')
    await writeFile(join(paths.artifactRoot, 'SPEC.md'), SPEC_BODY)
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: GREENFIELD_LEAD_RESPONSE })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      profile: 'greenfield',
      fsyncDir: false,
    })
    expect(result.status).toBe('complete')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const leadInvoked = events.find(
      (e) => e.type === 'agent_invoked' && 'agent' in e && e.agent === 'lead',
    )
    expect(leadInvoked).toBeDefined()
    if (leadInvoked && 'manifest' in leadInvoked && leadInvoked.type === 'agent_invoked') {
      const paths0 = leadInvoked.manifest.files.map((f) => f.path)
      expect(paths0.some((p) => p.endsWith('SPEC.md'))).toBe(true)
      expect(paths0.some((p) => p.endsWith('AUDIT.md'))).toBe(false)
    }
  })

  test('brownfield run attaches AUDIT.md (not SPEC.md) to the Lead manifest', async () => {
    await setUp('brownfield')
    await writeFile(join(paths.artifactRoot, 'AUDIT.md'), AUDIT_BODY)
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: BROWNFIELD_LEAD_RESPONSE })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      profile: 'brownfield',
      fsyncDir: false,
    })
    expect(result.status).toBe('complete')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const leadInvoked = events.find(
      (e) => e.type === 'agent_invoked' && 'agent' in e && e.agent === 'lead',
    )
    expect(leadInvoked).toBeDefined()
    if (leadInvoked && 'manifest' in leadInvoked && leadInvoked.type === 'agent_invoked') {
      const paths0 = leadInvoked.manifest.files.map((f) => f.path)
      expect(paths0.some((p) => p.endsWith('AUDIT.md'))).toBe(true)
      expect(paths0.some((p) => p.endsWith('SPEC.md'))).toBe(false)
      expect(leadInvoked.bytesSent).toBeGreaterThan(0)
    }
  })

  test('brownfield run with AUDIT.md absent returns plan_spec_missing keyed to AUDIT.md', async () => {
    await setUp('brownfield')
    // No AUDIT.md seeded.
    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      profile: 'brownfield',
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.rule).toBe('PLAN cannot run without an approved AUDIT.md')
    }
  })

  // Load-bearing rule-1 test: a brownfield run whose mutable config has been
  // edited to greenfield AFTER the run started still resolves brownfield from
  // the event-derived run state (loaded.state.profile from run_started). The
  // caller passes the event-derived profile, so editing .code-oz/config.yaml
  // mid-run cannot flip the run's profile. Here we model the caller by
  // re-deriving the profile from the loaded run state (NOT from config).
  test('resume-with-mutated-config: event-derived brownfield profile reads AUDIT.md even when config flipped to greenfield', async () => {
    await setUp('brownfield')
    await writeFile(join(paths.artifactRoot, 'AUDIT.md'), AUDIT_BODY)
    // Simulate the operator editing .code-oz/config.yaml to greenfield AFTER
    // the run started. The run state on disk (event-derived) is authoritative.
    await writeFile(join(tmp, '.code-oz/config.yaml'), 'profile: greenfield\n')

    // The caller (dispatchPlan) reads loaded.state.profile, NOT config.
    const { loadRun } = await import('../src/state/run.ts')
    const loaded = await loadRun(paths)
    expect(loaded).not.toBeNull()
    if (loaded === null) throw new Error('expected a loaded run state')
    expect(loaded.state.profile).toBe('brownfield')

    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: BROWNFIELD_LEAD_RESPONSE })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      profile: loaded.state.profile, // event-derived, NOT config
      fsyncDir: false,
    })
    expect(result.status).toBe('complete')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const leadInvoked = events.find(
      (e) => e.type === 'agent_invoked' && 'agent' in e && e.agent === 'lead',
    )
    if (leadInvoked && 'manifest' in leadInvoked && leadInvoked.type === 'agent_invoked') {
      const paths0 = leadInvoked.manifest.files.map((f) => f.path)
      expect(paths0.some((p) => p.endsWith('AUDIT.md'))).toBe(true)
      expect(paths0.some((p) => p.endsWith('SPEC.md'))).toBe(false)
    }
  })
})

// =========================================================================
// (c) + (d) SOURCE_CHECK SC-AUDIT grammar + profile-aware heading
// =========================================================================

const BROWNFIELD_SC = `# SOURCE_CHECK

## Audit sources

### SC-AUDIT-001: Empty-surname localization

- Audit: AUDIT.md ## Localization, bullet 1
- Quote: selector ignores empty surname.

## Reference sources

### SC-REF-NONE-001: No template adapter

- Searched: glob agents/templates/**/select-*.ts
- Result: no relevant pattern found.
- Why explicit: clean-room remediation.

## Docs sources

### SC-DOC-NONE-001: No external library used

- Why explicit: fix is hand-written.

## Coverage

- T-001 -> SC-AUDIT-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

const GREENFIELD_SC = `# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: Given a surname, the app produces 5 candidate given names.

## Reference sources

### SC-REF-NONE-001: No template adapter

- Searched: glob agents/templates/**/select-*.ts
- Result: no relevant pattern found.
- Why explicit: clean-room design.

## Docs sources

### SC-DOC-NONE-001: No external library used

- Why explicit: scorer is hand-written.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

const FILE = '<m17-fixture>'

function expectScLoadError(fn: () => unknown): SourceCheckLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(SourceCheckLoadError)
    return err as SourceCheckLoadError
  }
  throw new Error('expected SourceCheckLoadError to be thrown')
}

describe('SOURCE_ID_PATTERN — SC-AUDIT grammar (M17 C7c)', () => {
  test('accepts SC-AUDIT-NNN ids', () => {
    expect(SOURCE_ID_PATTERN.test('SC-AUDIT-001')).toBe(true)
    expect(SOURCE_ID_PATTERN.test('SC-AUDIT-123')).toBe(true)
  })
  test('still accepts the existing kinds', () => {
    for (const id of ['SC-SPEC-001', 'SC-REF-001', 'SC-REF-NONE-001', 'SC-DOC-001', 'SC-DOC-NONE-001']) {
      expect(SOURCE_ID_PATTERN.test(id)).toBe(true)
    }
  })
})

describe('parseSourceCheck — profile-aware heading enforcement (M17 C7d)', () => {
  test('brownfield accepts `## Audit sources` with SC-AUDIT ids', () => {
    const sc = parseSourceCheck(BROWNFIELD_SC, FILE, 'brownfield')
    expect(sc.specSources.length).toBe(1)
    expect(sc.specSources[0]!.id).toBe('SC-AUDIT-001')
    expect(sc.specSources[0]!.kind).toBe('AUDIT')
  })

  test('brownfield rejects `## Spec sources`', () => {
    const err = expectScLoadError(() => parseSourceCheck(GREENFIELD_SC, FILE, 'brownfield'))
    expect(err.issues.some((i) => /Audit sources|Spec sources/.test(i.rule ?? ''))).toBe(true)
  })

  test('greenfield accepts `## Spec sources` (unchanged) and rejects `## Audit sources`', () => {
    const sc = parseSourceCheck(GREENFIELD_SC, FILE, 'greenfield')
    expect(sc.specSources[0]!.id).toBe('SC-SPEC-001')
    const err = expectScLoadError(() => parseSourceCheck(BROWNFIELD_SC, FILE, 'greenfield'))
    expect(err.issues.some((i) => /Audit sources|Spec sources/.test(i.rule ?? ''))).toBe(true)
  })

  test('default profile (omitted) keeps greenfield behavior', () => {
    const sc = parseSourceCheck(GREENFIELD_SC, FILE)
    expect(sc.specSources[0]!.id).toBe('SC-SPEC-001')
    expectScLoadError(() => parseSourceCheck(BROWNFIELD_SC, FILE))
  })
})

describe('serializeSourceCheck — profile-aware heading (M17 C7d)', () => {
  test('brownfield serializes `## Audit sources` and round-trips', () => {
    const sc = parseSourceCheck(BROWNFIELD_SC, FILE, 'brownfield')
    const out = serializeSourceCheck(sc, 'brownfield')
    expect(out).toContain('## Audit sources')
    expect(out).not.toContain('## Spec sources')
    // Round-trips back through the brownfield parser.
    const reparsed = parseSourceCheck(out, FILE, 'brownfield')
    expect(reparsed.specSources[0]!.id).toBe('SC-AUDIT-001')
  })

  test('greenfield serializes `## Spec sources` (default unchanged)', () => {
    const sc = parseSourceCheck(GREENFIELD_SC, FILE, 'greenfield')
    const out = serializeSourceCheck(sc)
    expect(out).toContain('## Spec sources')
    expect(out).not.toContain('## Audit sources')
  })
})
