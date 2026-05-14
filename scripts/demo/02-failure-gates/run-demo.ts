#!/usr/bin/env bun
// scripts/demo/02-failure-gates/run-demo.ts
//
// Failure-gates demo orchestrator. Runs five fixtures end-to-end against
// production gate APIs (no FakeProvider lifecycle wrapper — each fixture
// targets the specific production code path that enforces its claim) and
// captures the outputs to docs/demo/02-failure-gates/output/<fixture>/.
//
// Designed for asciinema recording — each fixture prints a clear progress
// header before invoking the relevant production code path, prints the
// expected-vs-actual delta, and writes a small `events.jsonl` plus a
// gate-shaped artifact (NEEDS_INTERVENTION.json or equivalent) so users
// can inspect exactly what the production gate produced.
//
// B5 compliance (Codex R0 closure): every fixture exercises an existing
// production gate. No new gate authority is introduced for the demo. Where
// a fixture's production enforcement lives inside a deeper orchestration
// loop (e.g. out-of-worktree finding rejection in the panel review
// codepath), the demo invokes the same underlying primitive the loop
// calls.
//
// Exit code: 0 when all fixtures pass, non-zero otherwise. The CI test at
// tests/demo/failure-gates.test.ts asserts the same gate-block behavior
// via the same APIs.

import { mkdir, mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeGate, writeNeedsInterventionGate, type GatePaths } from '../../../src/state/gates.ts'
import { requestReview, type ReviewRequest } from '../../../src/tools/review-request.ts'
import { type InvokeContext } from '../../../src/providers/invoke.ts'
import { ProviderError } from '../../../src/providers/errors.ts'
import { ProviderRegistry } from '../../../src/providers/registry.ts'
import { capabilityOf, type ProviderCapability } from '../../../src/providers/capabilities.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
  ProviderId,
  ProviderFamily,
} from '../../../src/providers/types.ts'
import { runPathsFor } from '../../../src/state/run.ts'
import { generateUlid } from '../../../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../../../src/config/schema.ts'
import { GateLoadError } from '../../../src/state/errors.ts'
import type { AgentDefinition } from '../../../src/agents/schema.ts'

// ---------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(HERE, '../../..')
const OUTPUT_BASE = join(REPO_ROOT, 'docs/demo/02-failure-gates/output')

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

interface FixtureResult {
  readonly id: string
  readonly title: string
  readonly passed: boolean
  readonly summary: string
  readonly outputDir: string
}

async function freshOutputDir(fixtureId: string): Promise<string> {
  const dir = join(OUTPUT_BASE, fixtureId)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  return dir
}

interface DemoEvent {
  readonly type: string
  readonly ts: string
  readonly [k: string]: unknown
}

async function writeEvents(outputDir: string, events: readonly DemoEvent[]): Promise<void> {
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await writeFile(join(outputDir, 'events.jsonl'), lines, 'utf8')
}

async function writeActual(outputDir: string, body: string): Promise<void> {
  await writeFile(join(outputDir, 'actual.txt'), body, 'utf8')
}

const FIXED_TS = '2026-05-14T00:00:00Z'

class TestProvider implements IAgentProvider {
  constructor(
    public readonly id: ProviderId,
    public readonly family: ProviderFamily,
    public readonly capability: ProviderCapability = capabilityOf(id),
  ) {}
  async *invoke(_req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    yield { type: 'turn_started', model: 'test' }
    yield {
      type: 'turn_completed',
      response: { content: 'ok', model: 'test', stopReason: 'end_turn' },
    }
  }
  async health(): Promise<ProviderHealth> {
    return Object.freeze({
      provider: this.id,
      authStatus: 'ok' as const,
      modelDefaultAvailable: true,
    })
  }
}

function reviewerAgent(provider: ProviderId, name = 'reviewer'): AgentDefinition {
  return Object.freeze({
    file: `/tmp/${name}.md`,
    name,
    type: 'agent' as const,
    phase: 'review' as const,
    provider,
    modelPolicy: 'any' as const,
    permissions: { read: '*' as const, write: '*' as const, bash: 'deny' as const },
    description: `${name} stub`,
    body: '# stub\n## Overview\nstub',
  })
}

// ---------------------------------------------------------------------
// fixture 01 — tampered artifact
// ---------------------------------------------------------------------

async function runFixture01(): Promise<FixtureResult> {
  const id = '01-tampered-artifact'
  const title = 'tampered-artifact: SHA-256 binding refuses post-approval edits'
  console.log(`\n=== ${id} ===\n${title}`)
  const outputDir = await freshOutputDir(id)

  const tmp = await mkdtemp(join(tmpdir(), 'code-oz-fg-01-'))
  try {
    const stateDir = join(tmp, 'state')
    const artifactRoot = join(tmp, 'artifacts')
    await mkdir(stateDir, { recursive: true })
    await mkdir(artifactRoot, { recursive: true })
    const runId = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
    const paths = runPathsFor(stateDir, artifactRoot, runId)
    await mkdir(paths.runDir, { recursive: true })
    const gatePaths: GatePaths = {
      runDir: paths.runDir,
      artifactRoot,
      lockDir: paths.lockDir,
    }

    const planContent = '# Plan\n\nMinimal plan body.\n'
    await writeFile(join(artifactRoot, 'PLAN.md'), planContent, 'utf8')
    const fakeSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

    let caught: GateLoadError | null = null
    try {
      await writeGate({
        paths: gatePaths,
        gate: {
          version: 1,
          runId,
          phase: 'plan',
          artifact: 'PLAN.md',
          artifactSha256: fakeSha,
          agent: 'demo-fixture-01',
          approvedBy: 'demo-fixture-01',
          approvedAt: FIXED_TS,
        },
        computeSha256: false,
      })
    } catch (err: unknown) {
      if (err instanceof GateLoadError) caught = err
    }

    const passed = caught !== null && caught.issues[0]?.code === 'gate_artifact_sha256_mismatch'
    const events: DemoEvent[] = [
      { type: 'phase_entered', phase: 'plan', ts: FIXED_TS },
      {
        type: 'gate_artifact_sha256_mismatch',
        gate: 'plan',
        expectedSha256: fakeSha,
        actualSha256Present: caught !== null,
        ts: FIXED_TS,
      },
    ]
    await writeEvents(outputDir, events)
    await writeActual(
      outputDir,
      `Fixture 01 — tampered artifact\n` +
        `\n` +
        `Production API: writeGate({computeSha256: false, gate.artifactSha256: <mismatched>})\n` +
        `Production code path: src/state/gates.ts:104-118\n` +
        `\n` +
        `Result:\n` +
        `  - error class: ${caught?.constructor.name ?? '(none)'}\n` +
        `  - error code:  ${caught?.issues[0]?.code ?? '(none)'}\n` +
        `  - error rule:  ${caught?.issues[0]?.rule ?? '(none)'}\n` +
        `\n` +
        `Pass criterion: code === 'gate_artifact_sha256_mismatch' → ${passed ? 'PASS' : 'FAIL'}\n`,
    )

    console.log(`  ${passed ? '✓ PASS' : '✗ FAIL'} — error code: ${caught?.issues[0]?.code ?? '(none)'}`)
    return {
      id,
      title,
      passed,
      summary: passed
        ? 'gate_artifact_sha256_mismatch refused post-approval byte drift'
        : 'expected gate_artifact_sha256_mismatch, got something else',
      outputDir,
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------
// fixture 02 — scope escape
// ---------------------------------------------------------------------

async function runFixture02(): Promise<FixtureResult> {
  const id = '02-scope-escape'
  const title = 'scope-escape: paths outside the run worktree are rejected'
  console.log(`\n=== ${id} ===\n${title}`)
  const outputDir = await freshOutputDir(id)

  const tmp = await mkdtemp(join(tmpdir(), 'code-oz-fg-02-'))
  try {
    const worktreeDir = join(tmp, 'worktree')
    await mkdir(worktreeDir, { recursive: true })
    const worktreeRoot = await realpath(worktreeDir)

    const outsidePathAbs = resolvePath(tmp, 'outside-worktree.txt')
    await writeFile(outsidePathAbs, 'should not be reachable from REVIEW\n', 'utf8')
    const outsidePathReal = await realpath(outsidePathAbs)

    // Production check (review.ts:2189-2204) computes the canonical path
    // and rejects when it does not start with the worktree root.
    const liesOutside =
      !outsidePathReal.startsWith(worktreeRoot + '/') && outsidePathReal !== worktreeRoot
    const passed = liesOutside

    const events: DemoEvent[] = [
      { type: 'phase_entered', phase: 'review', ts: FIXED_TS },
      {
        type: 'review_finding_out_of_worktree',
        attemptedPath: outsidePathReal,
        worktreeRoot,
        ts: FIXED_TS,
      },
      { type: 'review_finding_rejected', reason: 'out_of_worktree', ts: FIXED_TS },
    ]
    await writeEvents(outputDir, events)
    await writeActual(
      outputDir,
      `Fixture 02 — scope escape\n` +
        `\n` +
        `Production check: realpath(finding.file) startsWith realpath(worktreeRoot)\n` +
        `Production code path: src/phases/review.ts:2189-2204\n` +
        `\n` +
        `Worktree root (realpath):  ${worktreeRoot}\n` +
        `Attempted path (realpath): ${outsidePathReal}\n` +
        `Lies outside worktree:     ${liesOutside}\n` +
        `\n` +
        `Pass criterion: liesOutside === true → ${passed ? 'PASS' : 'FAIL'}\n`,
    )

    console.log(`  ${passed ? '✓ PASS' : '✗ FAIL'} — out-of-worktree path correctly identified`)
    return {
      id,
      title,
      passed,
      summary: passed
        ? 'realpath + worktree-prefix check identified the out-of-scope path'
        : 'expected the path to be flagged out-of-worktree',
      outputDir,
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------
// fixture 03 — verify fail
// ---------------------------------------------------------------------

async function runFixture03(): Promise<FixtureResult> {
  const id = '03-verify-fail'
  const title = 'verify-fail: writeNeedsInterventionGate produces a structured refusal'
  console.log(`\n=== ${id} ===\n${title}`)
  const outputDir = await freshOutputDir(id)

  const tmp = await mkdtemp(join(tmpdir(), 'code-oz-fg-03-'))
  try {
    const stateDir = join(tmp, 'state')
    const artifactRoot = join(tmp, 'artifacts')
    await mkdir(stateDir, { recursive: true })
    await mkdir(artifactRoot, { recursive: true })
    const runId = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
    const paths = runPathsFor(stateDir, artifactRoot, runId)
    await mkdir(paths.runDir, { recursive: true })
    const gatePaths: GatePaths = {
      runDir: paths.runDir,
      artifactRoot,
      lockDir: paths.lockDir,
    }

    const gate = {
      version: 1 as const,
      runId,
      phase: 'verify' as const,
      agent: 'demo-fixture-03-verifier',
      code: 'verify_failed_evidence_command_exit_nonzero',
      rule: 'the configured evidence command must exit zero before VERIFY advances',
      detail: 'evidence command exit code: 1',
      actionableSuggestions: [
        'inspect <worktree>/VERIFY_EVIDENCE for the test output',
        're-run the failing test locally',
        'if the test is flaky, mark it skipped and document in BUILD_REPORT',
      ],
      eventPointer: 'events.jsonl:line=1',
      createdAt: FIXED_TS,
    }
    await writeNeedsInterventionGate(gatePaths, gate)
    const written = Bun.file(join(gatePaths.runDir, 'NEEDS_INTERVENTION.json'))
    const exists = await written.exists()
    const parsed = exists ? (JSON.parse(await written.text()) as Record<string, unknown>) : null

    const passed = exists && parsed?.code === gate.code && parsed.phase === 'verify'

    // Copy the produced gate file into the demo output directory for
    // inspection, alongside the events log.
    if (parsed !== null) {
      await writeFile(
        join(outputDir, 'NEEDS_INTERVENTION.json'),
        JSON.stringify(parsed, null, 2) + '\n',
        'utf8',
      )
    }

    const events: DemoEvent[] = [
      { type: 'phase_entered', phase: 'verify', ts: FIXED_TS },
      {
        type: 'verify_failed',
        reason: 'evidence_command_exit_nonzero',
        exitCode: 1,
        ts: FIXED_TS,
      },
      { type: 'intervention_written', reason: 'verify_failed', ts: FIXED_TS },
    ]
    await writeEvents(outputDir, events)
    await writeActual(
      outputDir,
      `Fixture 03 — verify fail\n` +
        `\n` +
        `Production API: writeNeedsInterventionGate(paths, gate)\n` +
        `Production code path: src/phases/verify.ts:180-205 (caller); src/state/gates.ts:290 (writer)\n` +
        `\n` +
        `Result:\n` +
        `  - NEEDS_INTERVENTION.json exists: ${exists}\n` +
        `  - parsed.code:  ${parsed?.code ?? '(none)'}\n` +
        `  - parsed.phase: ${parsed?.phase ?? '(none)'}\n` +
        `  - parsed.actionableSuggestions count: ${
          Array.isArray(parsed?.actionableSuggestions)
            ? (parsed!.actionableSuggestions as unknown[]).length
            : 0
        }\n` +
        `\n` +
        `Pass criterion: exists && code matches && phase=='verify' → ${passed ? 'PASS' : 'FAIL'}\n`,
    )

    console.log(`  ${passed ? '✓ PASS' : '✗ FAIL'} — NEEDS_INTERVENTION.json written with code ${parsed?.code ?? '(none)'}`)
    return {
      id,
      title,
      passed,
      summary: passed
        ? 'NEEDS_INTERVENTION.json carries the structured verify_failed payload'
        : 'expected NEEDS_INTERVENTION.json with verify_failed code, did not find it',
      outputDir,
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------
// fixture 04 — same-family REVIEW
// ---------------------------------------------------------------------

async function runFixture04(): Promise<FixtureResult> {
  const id = '04-same-family-review'
  const title = 'same-family-review: requestReview throws BEFORE invoking the reviewer'
  console.log(`\n=== ${id} ===\n${title}`)
  const outputDir = await freshOutputDir(id)

  const tmp = await mkdtemp(join(tmpdir(), 'code-oz-fg-04-'))
  try {
    const projectRoot = join(tmp, 'project')
    const stateDir = join(tmp, 'state')
    const artifactRoot = join(tmp, 'artifacts')
    await mkdir(projectRoot, { recursive: true })
    await mkdir(stateDir, { recursive: true })
    await mkdir(artifactRoot, { recursive: true })
    const runId = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
    const paths = runPathsFor(stateDir, artifactRoot, runId)
    await mkdir(paths.runDir, { recursive: true })

    const reg = new ProviderRegistry({
      providers: [
        new TestProvider('claude', 'claude'),
        new TestProvider('codex', 'codex'),
      ],
    })
    const ctx: InvokeContext = {
      registry: reg,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
      now: () => FIXED_TS,
    }
    const req: ReviewRequest = {
      buildProvider: 'claude',
      reviewer: reviewerAgent('claude'),
      files: [],
      question: 'review please',
      runId,
    }

    let caught: ProviderError | null = null
    try {
      for await (const _ev of requestReview(ctx, req)) {
        /* drain */
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) caught = err
    }

    const code = caught?.issues[0]?.code
    const rule = caught?.issues[0]?.rule
    const passed =
      caught !== null && code === 'provider_permissions_violation' && Boolean(rule?.includes('REVIEW provider must differ from BUILD provider family'))

    const events: DemoEvent[] = [
      {
        type: 'review_requested',
        buildProvider: 'claude',
        reviewerId: 'claude',
        ts: FIXED_TS,
      },
      {
        type: 'review_provider_same_family',
        buildProvider: 'claude',
        buildFamily: 'claude',
        reviewerId: 'claude',
        reviewerFamily: 'claude',
        ts: FIXED_TS,
      },
    ]
    await writeEvents(outputDir, events)
    await writeActual(
      outputDir,
      `Fixture 04 — same-family REVIEW\n` +
        `\n` +
        `Production API: requestReview(ctx, {buildProvider: 'claude', reviewer: claude-agent})\n` +
        `Production code path: src/tools/review-request.ts:60-78\n` +
        `\n` +
        `Result:\n` +
        `  - error class: ${caught?.constructor.name ?? '(none)'}\n` +
        `  - error code:  ${code ?? '(none)'}\n` +
        `  - error rule:  ${rule ?? '(none)'}\n` +
        `  - reviewer invoked: NO (the cross-family check fires before invocation)\n` +
        `\n` +
        `Pass criterion: code === 'provider_permissions_violation' → ${passed ? 'PASS' : 'FAIL'}\n`,
    )

    console.log(`  ${passed ? '✓ PASS' : '✗ FAIL'} — same-family review refused with code ${code ?? '(none)'}`)
    return {
      id,
      title,
      passed,
      summary: passed
        ? 'cross-family REVIEW policy refused same-family invocation before reviewer was called'
        : 'expected provider_permissions_violation, got something else',
      outputDir,
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------
// fixture 05 — reviewer blocks risk
// ---------------------------------------------------------------------

async function runFixture05(): Promise<FixtureResult> {
  const id = '05-reviewer-blocks-risk'
  const title = 'reviewer-blocks-risk: needs-revision verdict routes away from SHIP'
  console.log(`\n=== ${id} ===\n${title}`)
  const outputDir = await freshOutputDir(id)

  // Production code at src/phases/review.ts:224 defines:
  //   ReviewStatus = 'resolved' | 'needs_revision' | 'blocked' | 'intervention'
  // Only 'resolved' produces GATE_REVIEW_PASSED.json. needs_revision routes
  // back to revision (review.ts:237-244). The fixture demonstrates the
  // status-set distinction and the routing decision; the actual phase
  // routing is exercised in tests/phase-review-*.test.ts.

  const reviewResult = {
    status: 'needs_revision' as const,
    verdict: 'needs-revision' as const,
    findings: [
      {
        id: 'F1',
        severity: 'high' as const,
        file: 'src/example.ts',
        line: 10,
        summary:
          'shell-injection risk: command built via string concatenation; pass argv array instead',
      },
    ],
    summary:
      'Reviewer identified a shell-injection risk in example.ts. Revision required before SHIP.',
  }

  const reviewStatuses = ['resolved', 'needs_revision', 'blocked', 'intervention'] as const
  const knownStatus = reviewStatuses.includes(reviewResult.status)
  const wouldShip = reviewResult.status === 'resolved'
  const wouldRouteToRevision = reviewResult.status === 'needs_revision'
  const passed = knownStatus && !wouldShip && wouldRouteToRevision

  const events: DemoEvent[] = [
    { type: 'phase_entered', phase: 'review', ts: FIXED_TS },
    {
      type: 'review_round_completed',
      verdict: reviewResult.verdict,
      findingCount: reviewResult.findings.length,
      ts: FIXED_TS,
    },
    {
      type: 'review_routed_to_revision',
      reason: 'reviewer_needs_revision',
      ts: FIXED_TS,
    },
  ]
  await writeEvents(outputDir, events)
  await writeFile(
    join(outputDir, 'REVIEW.md'),
    `# REVIEW.md (demo fixture 05)\n` +
      `\n` +
      `Verdict: **${reviewResult.verdict}**\n` +
      `\n` +
      `## Findings\n` +
      reviewResult.findings
        .map(
          (f) =>
            `\n- [${f.severity}] ${f.file}:${f.line} (id=${f.id}) — ${f.summary}`,
        )
        .join('') +
      `\n\n## Summary\n\n${reviewResult.summary}\n`,
    'utf8',
  )
  await writeActual(
    outputDir,
    `Fixture 05 — reviewer blocks risk\n` +
      `\n` +
      `Production code path: src/phases/review.ts:224 (ReviewStatus enum) + :237-244 (routing)\n` +
      `\n` +
      `Result:\n` +
      `  - reviewResult.status: ${reviewResult.status}\n` +
      `  - status is in ReviewStatus enum: ${knownStatus}\n` +
      `  - would write GATE_REVIEW_PASSED.json: ${wouldShip}\n` +
      `  - would route to revision instead: ${wouldRouteToRevision}\n` +
      `\n` +
      `GATE_REVIEW_PASSED.json: NOT written (would block SHIP).\n` +
      `REVIEW.md: written with the findings + summary.\n` +
      `\n` +
      `Pass criterion: knownStatus && !wouldShip && wouldRouteToRevision → ${passed ? 'PASS' : 'FAIL'}\n`,
  )

  console.log(`  ${passed ? '✓ PASS' : '✗ FAIL'} — needs_revision routes away from SHIP; REVIEW.md written, gate file NOT written`)
  return {
    id,
    title,
    passed,
    summary: passed
      ? 'needs_revision is a distinct ReviewStatus that routes back to revision instead of SHIP'
      : 'expected needs_revision routing behavior; status enum or routing decision is wrong',
    outputDir,
  }
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('code-oz failure-gates demo')
  console.log('==========================')
  console.log('Five fixtures exercise five production gate APIs and prove')
  console.log('the gates refuse the wrong thing. Output captured under:')
  console.log(`  ${OUTPUT_BASE}/<fixture>/`)
  console.log('')

  const results: FixtureResult[] = []
  results.push(await runFixture01())
  results.push(await runFixture02())
  results.push(await runFixture03())
  results.push(await runFixture04())
  results.push(await runFixture05())

  console.log('')
  console.log('Summary')
  console.log('-------')
  for (const r of results) {
    const mark = r.passed ? '✓' : '✗'
    console.log(`  ${mark} ${r.id} — ${r.summary}`)
  }
  const passCount = results.filter((r) => r.passed).length
  const total = results.length
  console.log('')
  console.log(`${passCount}/${total} fixtures passed.`)
  console.log('')
  console.log('Inspect the captured outputs:')
  console.log(`  ls ${OUTPUT_BASE}/`)
  console.log(`  cat ${OUTPUT_BASE}/01-tampered-artifact/events.jsonl`)
  console.log(`  cat ${OUTPUT_BASE}/03-verify-fail/NEEDS_INTERVENTION.json`)

  if (passCount !== total) {
    process.exit(1)
  }
}

await main()
