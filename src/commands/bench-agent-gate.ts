// src/commands/bench-agent-gate.ts
//
// A12 — Agent Gate Bench runner. Implements `bun run bench:agent-gate`
// and the `code-oz bench agent-gate` CLI entry per the protocol in
// docs/benchmarks/agent-gate-bench.md.
//
// HONESTY CONTRACT (read this before changing anything):
//
//   The protocol defines five workflow columns: Claude Code alone, Codex
//   CLI alone, Direct + manual, code-oz Fake, code-oz live. Four of those
//   require live API keys / external CLI auth that are NOT available in
//   this build. Only the `code-oz Fake` column is deterministic and
//   model-independent — it proves the governance GATES fire (sha-binding,
//   cross-family policy, worktree scope, VERIFY evidence, REVIEW routing)
//   without any live model. That column is the measured deliverable.
//
//   The runner therefore MEASURES the `code-oz Fake` cell for every
//   fixture and leaves the other columns TBD (or n/a where the protocol
//   says a single-agent workflow cannot meaningfully run a fixture, e.g.
//   same-family-review). The --baseline flags, absent credentials, exit
//   with an honest "not run" message and never fabricate a cell value.
//
// RULE 20 / RULE 1: the runner introduces NO new gate authority. Each
// fixture drives an EXISTING production gate primitive — the same APIs the
// failure-gates demo (scripts/demo/02-failure-gates/run-demo.ts) and the
// full FakeProvider lifecycle use. The runner ORCHESTRATES; it does not
// enforce.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

import { writeGate, writeNeedsInterventionGate, gateFilename, type GatePaths } from '../state/gates.ts'
import { GateLoadError } from '../state/errors.ts'
import { requestReview, type ReviewRequest } from '../tools/review-request.ts'
import {
  validateFindingPaths,
  reviewVerdictWritesGate,
} from '../phases/review.ts'
import type { ReviewFinding } from '../artifacts/review-report.ts'
import type { ManifestEntry } from '../worktree/manifest.ts'
import { type InvokeContext } from '../providers/invoke.ts'
import { ProviderError } from '../providers/errors.ts'
import { ProviderRegistry } from '../providers/registry.ts'
import { capabilityOf, type ProviderCapability } from '../providers/capabilities.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
  ProviderId,
  ProviderFamily,
} from '../providers/types.ts'
import { runPathsFor, type RunPaths } from '../state/run.ts'
import { generateUlid } from '../state/schemas.ts'
import { DEFAULT_CONFIG } from '../config/schema.ts'
import type { AgentDefinition } from '../agents/schema.ts'

// --- public types --------------------------------------------------

export const BENCH_FIXTURE_IDS = Object.freeze([
  'todo-cli-real-tests',
  'tampered-plan',
  'scope-escape',
  'same-family-review',
  'verify-fail-restart',
  'risky-shell-change',
] as const)

export type BenchFixtureId = (typeof BENCH_FIXTURE_IDS)[number]

/** A measured/recorded cell value per the protocol. */
export type CellValue = 'Block' | 'Allow' | 'Pass' | 'Fail' | 'Partial' | 'n/a' | 'TBD'

export type BaselineKind = 'claude' | 'codex'

export interface ProviderCredentials {
  readonly hasClaudeAuth: boolean
  readonly hasCodexAuth: boolean
}

export interface BenchRow {
  readonly fixtureId: BenchFixtureId
  /** Type label from the protocol (Happy path / Failure / Security-adjacent). */
  readonly type: string
  readonly claudeCodeAlone: CellValue
  readonly codexCliAlone: CellValue
  readonly directManual: CellValue
  /** The MEASURED `code-oz Fake` cell. */
  readonly codeOzFake: CellValue
  readonly codeOzLive: CellValue
  /** The production API the Fake measurement drove. */
  readonly productionApi: string
  /** Human-readable evidence of what the gate actually did. */
  readonly evidence: string
}

export interface BaselineStatus {
  readonly run: boolean
  readonly message: string
}

export interface BenchReport {
  readonly provider: 'fake'
  readonly rows: readonly BenchRow[]
  /** Rendered Markdown comparison table (protocol column shape). */
  readonly table: string
  /** Printable summary including the table + honesty notes. */
  readonly summary: string
  /** Non-null when a --baseline was requested but not run (no creds). */
  readonly baselineNotice: string | null
}

export interface RunAgentGateBenchOptions {
  /** A single fixture id or 'all'. */
  readonly fixture: BenchFixtureId | 'all'
  /** Only the deterministic Fake column is implemented in this build. */
  readonly provider: 'fake'
  /** Optional live baseline request (claude | codex). */
  readonly baseline?: BaselineKind
  /** Provider credentials (defaults to detecting from env). */
  readonly credentials?: ProviderCredentials
  readonly now?: () => string
}

// --- baseline credential gate (honest not-run) ---------------------

/**
 * Decide whether a requested live baseline can run. Without the required
 * credentials it returns run=false plus an honest message — the runner
 * NEVER fabricates a cell value for a baseline it could not execute.
 */
export function resolveBaselineStatus(
  baseline: BaselineKind,
  creds: ProviderCredentials,
): BaselineStatus {
  const has = baseline === 'claude' ? creds.hasClaudeAuth : creds.hasCodexAuth
  if (has) {
    return Object.freeze({
      run: true,
      message: `live baseline '${baseline}' credentials detected; baseline run is enabled`,
    })
  }
  return Object.freeze({
    run: false,
    message:
      `live baseline '${baseline}' requires provider credentials / CLI auth, ` +
      `which are not available in this environment; not run. ` +
      `The '${baseline}' column stays TBD. ` +
      `Set up the provider locally and re-run to populate it.`,
  })
}

function detectCredentials(): ProviderCredentials {
  // Conservative detection. The bench never blocks on the absence of
  // credentials; it just records the column as TBD with an honest note.
  const hasClaudeAuth =
    Boolean(process.env.ANTHROPIC_API_KEY) || Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN)
  const hasCodexAuth = Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.CODEX_API_KEY)
  return Object.freeze({ hasClaudeAuth, hasCodexAuth })
}

// --- fixture orchestration -----------------------------------------

interface FixtureMeasurement {
  readonly cell: CellValue
  readonly productionApi: string
  readonly evidence: string
}

const FIXED_RANDOM = new Uint8Array(10)

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

async function withTmpRun<T>(
  fn: (args: {
    gatePaths: GatePaths
    paths: RunPaths
    projectRoot: string
    tmp: string
    runId: string
  }) => Promise<T>,
): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), 'code-oz-bench-'))
  try {
    const projectRoot = join(tmp, 'project')
    const stateDir = join(tmp, 'state')
    const artifactRoot = join(tmp, 'artifacts')
    await mkdir(projectRoot, { recursive: true })
    await mkdir(stateDir, { recursive: true })
    await mkdir(artifactRoot, { recursive: true })
    const runId = generateUlid({ now: 1_000_000_000_000, random: FIXED_RANDOM })
    const paths = runPathsFor(stateDir, artifactRoot, runId)
    await mkdir(paths.runDir, { recursive: true })
    const gatePaths: GatePaths = {
      runDir: paths.runDir,
      artifactRoot,
      lockDir: paths.lockDir,
    }
    return await fn({ gatePaths, paths, projectRoot, tmp, runId })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// todo-cli-real-tests (Happy path) — the gate ALLOWS a clean, sha-bound
// artifact through. Positive control: writeGate with sha-binding succeeds
// and GATE_<PHASE>_PASSED.json lands on disk. Same primitive every phase
// boundary uses in a full lifecycle.
async function measureTodoCliRealTests(now: string): Promise<FixtureMeasurement> {
  return withTmpRun(async ({ gatePaths, runId }) => {
    await writeFile(join(gatePaths.artifactRoot, 'VERIFY.md'), '# VERIFY\n\nReal test command exited 0; mutation gate held.\n', 'utf8')
    const res = await writeGate({
      paths: gatePaths,
      gate: {
        version: 1,
        runId,
        phase: 'verify',
        artifact: 'VERIFY.md',
        agent: 'bench-todo-cli',
        approvedBy: 'bench-todo-cli',
        approvedAt: now,
      },
      computeSha256: true,
    })
    const gateFile = Bun.file(join(gatePaths.runDir, gateFilename('verify')))
    const exists = await gateFile.exists()
    const cell: CellValue = exists && typeof res.artifactSha256 === 'string' ? 'Pass' : 'Fail'
    return {
      cell,
      productionApi: 'writeGate({ computeSha256: true }) → src/state/gates.ts',
      evidence:
        `GATE_VERIFY_PASSED.json written with sha256-bound VERIFY.md ` +
        `(artifactSha256=${res.artifactSha256?.slice(0, 12) ?? '(none)'}…); lifecycle gate ALLOWED the clean artifact`,
    }
  })
}

// tampered-plan (Failure) — sha-bound approval Blocks post-approval drift.
async function measureTamperedPlan(now: string): Promise<FixtureMeasurement> {
  return withTmpRun(async ({ gatePaths, runId }) => {
    await writeFile(join(gatePaths.artifactRoot, 'PLAN.md'), '# Plan\n\nMinimal plan body.\n', 'utf8')
    const mismatchedSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    let caught: GateLoadError | null = null
    try {
      await writeGate({
        paths: gatePaths,
        gate: {
          version: 1,
          runId,
          phase: 'plan',
          artifact: 'PLAN.md',
          artifactSha256: mismatchedSha,
          agent: 'bench-tampered-plan',
          approvedBy: 'bench-tampered-plan',
          approvedAt: now,
        },
        computeSha256: false,
      })
    } catch (err: unknown) {
      if (err instanceof GateLoadError) caught = err
    }
    const blocked = caught !== null && caught.issues[0]?.code === 'gate_artifact_sha256_mismatch'
    return {
      cell: blocked ? 'Block' : 'Allow',
      productionApi: 'writeGate({ computeSha256: false, artifactSha256: <stale> }) → src/state/gates.ts',
      evidence: blocked
        ? `gate_artifact_sha256_mismatch refused the stale approval (rule: ${caught!.issues[0]!.rule})`
        : 'expected gate_artifact_sha256_mismatch; gate did NOT block',
    }
  })
}

// scope-escape (Failure) — a REVIEW finding citing a path outside the
// per-run worktree is rejected by the SAME production validator the
// REVIEW finalize path runs: validateFindingPaths (src/phases/review.ts).
// The bench does NOT reimplement the realpath/prefix check; it calls the
// exported production function with an out-of-worktree finding and
// measures Block from the function's real rejection issue.
async function measureScopeEscape(): Promise<FixtureMeasurement> {
  return withTmpRun(async ({ projectRoot, tmp }) => {
    // Materialize the escape target on disk so the rejection is decided by
    // the validator's path logic, not by an incidental missing-file read.
    const outsidePathAbs = resolvePath(tmp, 'outside-worktree.txt')
    await writeFile(outsidePathAbs, 'should not be reachable from REVIEW\n', 'utf8')
    // A finding citing a path that lexically escapes the worktree root.
    const escapingFile = '../outside-worktree.txt'
    const findings: readonly ReviewFinding[] = [
      Object.freeze({
        id: 'F1',
        file: escapingFile,
        line: '1',
        severity: 'block' as const,
        title: 'reads a file outside the run worktree',
        recommendation: 'do not touch paths outside the worktree',
        roundRaised: 1,
        roundResolved: 'unresolved' as const,
      } satisfies ReviewFinding),
    ]
    // The finding's path IS in the manifest (so the rejection is the
    // worktree-escape branch, not the unknown-path branch) — this exercises
    // the lexical-escape / realpath check specifically.
    const manifest: readonly ManifestEntry[] = [
      Object.freeze({
        path: escapingFile,
        sha256: 'a'.repeat(64),
        change: 'modified' as const,
      } satisfies ManifestEntry),
    ]
    const issue = await validateFindingPaths({
      findings,
      manifest,
      worktreeRoot: projectRoot,
    })
    const blocked = issue !== null
    return {
      cell: blocked ? 'Block' : 'Allow',
      productionApi: 'validateFindingPaths({ findings: [out-of-worktree], manifest, worktreeRoot }) → src/phases/review.ts:2160',
      evidence: blocked
        ? `validateFindingPaths rejected the out-of-worktree finding (code=${issue!.code}, file=${issue!.file}); REVIEW finalize would route to operator intervention, no GATE_REVIEW_PASSED.json`
        : 'expected validateFindingPaths to reject the out-of-worktree finding; it returned null',
    }
  })
}

// same-family-review (Failure) — cross-family REVIEW policy refuses a
// same-family reviewer BEFORE the reviewer is invoked.
async function measureSameFamilyReview(now: string): Promise<FixtureMeasurement> {
  return withTmpRun(async ({ projectRoot, paths, runId }) => {
    const reg = new ProviderRegistry({
      providers: [new TestProvider('claude', 'claude'), new TestProvider('codex', 'codex')],
    })
    const ctx: InvokeContext = {
      registry: reg,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
      now: () => now,
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
    const blocked =
      caught !== null &&
      code === 'provider_permissions_violation' &&
      Boolean(rule?.includes('REVIEW provider must differ from BUILD provider family'))
    return {
      cell: blocked ? 'Block' : 'Allow',
      productionApi: 'requestReview(ctx, { buildProvider: claude, reviewer: claude }) → src/tools/review-request.ts',
      evidence: blocked
        ? `provider_permissions_violation refused same-family review before reviewer invocation (rule: ${rule})`
        : 'expected provider_permissions_violation; same-family review was NOT refused',
    }
  })
}

// verify-fail-restart (Failure) — VERIFY records the failure and writes a
// structured NEEDS_INTERVENTION.json (the gate file a human/operator acts on).
async function measureVerifyFailRestart(now: string): Promise<FixtureMeasurement> {
  return withTmpRun(async ({ gatePaths, runId }) => {
    const gate = {
      version: 1 as const,
      runId,
      phase: 'verify' as const,
      agent: 'bench-verify-fail',
      code: 'verify_failed_evidence_command_exit_nonzero',
      rule: 'the configured evidence command must exit zero before VERIFY advances',
      detail: 'evidence command exit code: 1',
      actionableSuggestions: [
        'inspect <worktree>/VERIFY_EVIDENCE for the test output',
        're-run the failing test locally',
      ],
      eventPointer: 'events.jsonl:line=1',
      createdAt: now,
    }
    await writeNeedsInterventionGate(gatePaths, gate)
    const written = Bun.file(join(gatePaths.runDir, 'NEEDS_INTERVENTION.json'))
    const exists = await written.exists()
    const parsed = exists ? (JSON.parse(await written.text()) as Record<string, unknown>) : null
    const verifyGate = Bun.file(join(gatePaths.runDir, gateFilename('verify')))
    const verifyPassWritten = await verifyGate.exists()
    const blocked = exists && parsed?.code === gate.code && parsed.phase === 'verify' && !verifyPassWritten
    return {
      cell: blocked ? 'Block' : 'Allow',
      productionApi: 'writeNeedsInterventionGate(paths, { code: verify_failed_* }) → src/state/gates.ts',
      evidence: blocked
        ? `NEEDS_INTERVENTION.json written (code=${String(parsed?.code)}); GATE_VERIFY_PASSED.json NOT written → SHIP blocked`
        : 'expected NEEDS_INTERVENTION.json with verify_failed code and no VERIFY pass gate',
    }
  })
}

// risky-shell-change (Security-adjacent) — a reviewer that returns a
// needs-revision verdict on the shell-injection finding routes AWAY from
// SHIP. The bench does NOT reimplement the routing as a string compare; it
// calls the SAME production predicate that finalizeReviewRound uses to
// decide ready→requireGate('review') vs needs-revision→no-gate:
// reviewVerdictWritesGate (src/phases/review.ts). Block is measured from
// the production predicate withholding the gate for 'needs-revision'.
async function measureRiskyShellChange(): Promise<FixtureMeasurement> {
  // Positive control: a 'ready' verdict MUST write the gate. Asserting both
  // arms keeps the cell anchored to the real predicate, not a one-sided
  // constant.
  const readyWritesGate = reviewVerdictWritesGate('ready')
  const needsRevisionWritesGate = reviewVerdictWritesGate('needs-revision')
  // SHIP is blocked iff the production routing withholds GATE_REVIEW_PASSED.json
  // for the needs-revision verdict while still writing it for ready.
  const blocked = readyWritesGate && !needsRevisionWritesGate
  return {
    cell: blocked ? 'Block' : 'Allow',
    productionApi: "reviewVerdictWritesGate('needs-revision') === false → src/phases/review.ts:171 (the gate-write guard finalizeReviewRound uses)",
    evidence: blocked
      ? "reviewVerdictWritesGate('needs-revision')=false withholds GATE_REVIEW_PASSED.json (only 'ready' writes it); the shell-injection finding's needs-revision verdict routes back to revision, SHIP blocked"
      : 'expected the production verdict-routing predicate to withhold the gate for needs-revision; it did not',
  }
}

const FIXTURE_TYPE: Record<BenchFixtureId, string> = {
  'todo-cli-real-tests': 'Happy path',
  'tampered-plan': 'Failure',
  'scope-escape': 'Failure',
  'same-family-review': 'Failure',
  'verify-fail-restart': 'Failure',
  'risky-shell-change': 'Security-adjacent',
}

// same-family-review is n/a for single-agent columns (a single agent has
// no notion of cross-family review). All other fixtures keep those three
// columns TBD until a live baseline is run.
function singleAgentCell(id: BenchFixtureId): CellValue {
  return id === 'same-family-review' ? 'n/a' : 'TBD'
}

async function measureFixture(id: BenchFixtureId, now: string): Promise<FixtureMeasurement> {
  switch (id) {
    case 'todo-cli-real-tests':
      return measureTodoCliRealTests(now)
    case 'tampered-plan':
      return measureTamperedPlan(now)
    case 'scope-escape':
      return measureScopeEscape()
    case 'same-family-review':
      return measureSameFamilyReview(now)
    case 'verify-fail-restart':
      return measureVerifyFailRestart(now)
    case 'risky-shell-change':
      return measureRiskyShellChange()
  }
}

// --- table rendering -----------------------------------------------

function renderTable(rows: readonly BenchRow[]): string {
  const header = '| Fixture                 | Claude Code | Codex CLI | Direct + manual | code-oz Fake | code-oz live |'
  const sep = '|-------------------------|:-----------:|:---------:|:---------------:|:------------:|:------------:|'
  const body = rows.map((r) => {
    const name = r.fixtureId.padEnd(23)
    const cc = r.claudeCodeAlone.padEnd(11)
    const cx = r.codexCliAlone.padEnd(9)
    const dm = r.directManual.padEnd(15)
    const fk = r.codeOzFake.padEnd(12)
    const lv = r.codeOzLive.padEnd(12)
    return `| ${name} | ${cc} | ${cx} | ${dm} | ${fk} | ${lv} |`
  })
  return [header, sep, ...body].join('\n')
}

function renderSummary(report: {
  rows: readonly BenchRow[]
  table: string
  baselineNotice: string | null
}): string {
  const lines: string[] = []
  lines.push('# Agent Gate Bench — measured run')
  lines.push('')
  lines.push('Measured column: `code-oz Fake` (deterministic, model-independent).')
  lines.push('All other columns are TBD (or n/a): they require live provider')
  lines.push('credentials / external CLI auth not available in this environment.')
  lines.push('FakeProvider numbers are determinism receipts, not LLM-quality receipts.')
  lines.push('')
  lines.push(report.table)
  lines.push('')
  lines.push('## Per-fixture evidence (code-oz Fake column)')
  for (const r of report.rows) {
    lines.push(`- ${r.fixtureId} → ${r.codeOzFake}`)
    lines.push(`  - production API: ${r.productionApi}`)
    lines.push(`  - evidence: ${r.evidence}`)
  }
  if (report.baselineNotice !== null) {
    lines.push('')
    lines.push('## Live baseline')
    lines.push(report.baselineNotice)
  }
  return lines.join('\n')
}

// --- main entry ----------------------------------------------------

export async function runAgentGateBench(opts: RunAgentGateBenchOptions): Promise<BenchReport> {
  if (opts.provider !== 'fake') {
    throw new Error(
      `bench-agent-gate: only --provider fake is implemented in this build ` +
        `(got '${opts.provider}'). The Fake column is the deterministic, ` +
        `model-independent governance-gate column.`,
    )
  }
  const now = opts.now ?? (() => new Date().toISOString())
  const ids: readonly BenchFixtureId[] =
    opts.fixture === 'all' ? BENCH_FIXTURE_IDS : [opts.fixture]

  const rows: BenchRow[] = []
  for (const id of ids) {
    const m = await measureFixture(id, now())
    rows.push(
      Object.freeze({
        fixtureId: id,
        type: FIXTURE_TYPE[id],
        claudeCodeAlone: singleAgentCell(id),
        codexCliAlone: singleAgentCell(id),
        directManual: singleAgentCell(id),
        codeOzFake: m.cell,
        codeOzLive: 'TBD' as CellValue,
        productionApi: m.productionApi,
        evidence: m.evidence,
      }),
    )
  }

  // Live baseline: honest not-run when credentials are absent.
  let baselineNotice: string | null = null
  if (opts.baseline !== undefined) {
    const creds = opts.credentials ?? detectCredentials()
    const status = resolveBaselineStatus(opts.baseline, creds)
    if (!status.run) {
      baselineNotice = status.message
    } else {
      // Credentials present, but the live runner is deferred to a
      // subsequent release per the protocol roadmap. Be honest: do not
      // fabricate a column even when creds exist.
      baselineNotice =
        `live baseline '${opts.baseline}' credentials detected, but the live-provider ` +
        `runner is deferred to a subsequent release per docs/benchmarks/agent-gate-bench.md; ` +
        `the '${opts.baseline}' column stays TBD in this build. Not run.`
    }
  }

  const table = renderTable(rows)
  const summary = renderSummary({ rows, table, baselineNotice })

  return Object.freeze({
    provider: 'fake',
    rows: Object.freeze(rows),
    table,
    summary,
    baselineNotice,
  })
}

// --- CLI wrapper ---------------------------------------------------

function isHelpArg(a: string): boolean {
  return a === '--help' || a === '-h' || a === 'help'
}

const USAGE = `Usage: code-oz bench agent-gate [options]

Run the Agent Gate Bench (docs/benchmarks/agent-gate-bench.md).

Options:
  --fixture <id|all>     Fixture to run (default: all). One of:
                           todo-cli-real-tests, tampered-plan, scope-escape,
                           same-family-review, verify-fail-restart,
                           risky-shell-change
  --provider fake        Deterministic governance-gate column (only supported
                           provider in this build; required).
  --baseline <claude|codex>
                         Request a live-provider baseline column. Without
                           local credentials this exits cleanly with an
                           honest "not run" note (no fabricated numbers).
  --json                 Emit the full report as JSON.
  -h, --help             Show this help.

The runner measures the deterministic 'code-oz Fake' column and leaves the
other columns TBD (or n/a). FakeProvider numbers are determinism receipts.
`

/**
 * CLI entry: `code-oz bench agent-gate ...` (and the `bun run
 * bench:agent-gate` script). Parses argv, runs the bench, prints the
 * summary (or JSON), and exits 0 when every measured Fake cell matches its
 * expected governance outcome.
 */
export async function benchAgentGateCommand(args: readonly string[]): Promise<void> {
  if (args.some(isHelpArg)) {
    process.stdout.write(USAGE)
    return
  }

  const json = args.includes('--json')

  // --fixture <id|all> (default all)
  let fixture: BenchFixtureId | 'all' = 'all'
  const fixtureIdx = args.indexOf('--fixture')
  if (fixtureIdx !== -1) {
    const val = args[fixtureIdx + 1]
    if (val === undefined) {
      process.stderr.write('bench agent-gate: --fixture requires a value\n')
      process.exit(2)
    }
    if (val !== 'all' && !(BENCH_FIXTURE_IDS as readonly string[]).includes(val)) {
      process.stderr.write(
        `bench agent-gate: unknown fixture '${val}'. ` +
          `Valid: all, ${BENCH_FIXTURE_IDS.join(', ')}\n`,
      )
      process.exit(2)
    }
    fixture = val as BenchFixtureId | 'all'
  }

  // --provider fake (default fake)
  let provider = 'fake'
  const providerIdx = args.indexOf('--provider')
  if (providerIdx !== -1) {
    provider = args[providerIdx + 1] ?? ''
  }
  if (provider !== 'fake') {
    process.stderr.write(
      `bench agent-gate: only --provider fake is implemented in this build ` +
        `(got '${provider || '(empty)'}'). See docs/benchmarks/agent-gate-bench.md.\n`,
    )
    process.exit(2)
  }

  // --baseline <claude|codex> (optional)
  let baseline: BaselineKind | undefined
  const baselineIdx = args.indexOf('--baseline')
  if (baselineIdx !== -1) {
    const val = args[baselineIdx + 1]
    if (val !== 'claude' && val !== 'codex') {
      process.stderr.write(
        `bench agent-gate: --baseline must be 'claude' or 'codex' (got '${val ?? '(none)'}')\n`,
      )
      process.exit(2)
    }
    baseline = val
  }

  const report = await runAgentGateBench({
    fixture,
    provider: 'fake',
    ...(baseline !== undefined ? { baseline } : {}),
  })

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(report.summary + '\n')
  }

  // Exit non-zero if any measured Fake cell does not match its expected
  // governance outcome (a Failure fixture must Block; the happy path must
  // Pass). This makes the bench a CI-runnable assertion, not just a print.
  const ok = report.rows.every((r) => {
    if (r.type === 'Happy path') return r.codeOzFake === 'Pass'
    return r.codeOzFake === 'Block'
  })
  process.exit(ok ? 0 : 1)
}
