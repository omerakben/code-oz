// Three-case deterministic evaluation harness for the repo_context tool
// family (`glob`, `grep`, `read`). Borrowed from codegraph's
// SEARCH_QUALITY_LOOP methodology, narrowed per Codex Q4 in the codegraph
// comparison synthesis (thread 019e12ed): three cases, deterministic,
// recall@k + bytes/tokens + tool-call counts; no LLM-judged path in
// default CI.
//
// Cases:
//
//   case-01 discovery        → can grep+glob find expected files?
//   case-02 usage            → can grep find expected call-site files
//                              without saturating maxResults?
//   case-03 budget pressure  → with many candidates, do selected-path
//                              counts and result bytes stay below caps
//                              while keeping recall ≥ threshold?
//
// The harness drives `runRepoContextTool`, the same orchestrator used in
// the spine, so the metrics reflect the production code path including
// permission intersection and event emission.

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { runRepoContextTool } from '../../../src/tools/repo-context/runner.ts'
import { readEvents } from '../../../src/state/events.ts'
import type { AgentPermissions } from '../../../src/agents/schema.ts'
import type {
  RepoContextRequest,
  RepoContextResult,
} from '../../../src/tools/repo-context/types.ts'

export const RG_AVAILABLE: boolean = (() => {
  try {
    const r = spawnSync('rg', ['--version'], { stdio: 'pipe' })
    return r.status === 0
  } catch {
    return false
  }
})()

export interface CaseSetup {
  /** Files relative to project root, with full content. */
  readonly files: ReadonlyArray<readonly [string, string]>
  /** Tool requests to drive against the fixture, in order. */
  readonly requests: readonly RepoContextRequest[]
  /** Paths the case considers "expected" (the recall denominator). */
  readonly expectedPaths: readonly string[]
  /** Per-call permission caps for this case. Defaults to locked v0.1 caps. */
  readonly caps?: Partial<{
    maxResults: number
    maxBytesPerResult: number
    maxFilesForNextManifest: number
    timeoutMs: number
  }>
}

export interface CaseMetrics {
  /** Total `repo_context_searched` events emitted by the case. */
  readonly toolCallCount: number
  /** Sum of `resultBytes` across all events. */
  readonly totalResultBytes: number
  /** Sum of `resultTokensEstimate` across all events. */
  readonly totalResultTokensEstimate: number
  /** Distinct paths returned across all calls (the recall numerator
   *  ground truth before manifest promotion). */
  readonly distinctReturnedPaths: readonly string[]
  /**
   * recall@k where k = expectedPaths.length. The intersection of
   * distinctReturnedPaths with expectedPaths divided by expectedPaths.length.
   * 1.0 means every expected path was returned by some call.
   */
  readonly recallAtK: number
  /** Whether any call truncated against `maxResults`. */
  readonly anyTruncated: boolean
  /**
   * The maximum `selectedPaths.length` across emitted events. Always 0
   * in the harness (selection happens in the next-invocation manifest);
   * recorded so a future test that drives selection can assert its
   * behavior.
   */
  readonly maxSelectedPathCount: number
}

export interface CaseResult {
  readonly caseName: string
  readonly metrics: CaseMetrics
  readonly results: readonly RepoContextResult[]
}

/**
 * Run a single case end-to-end. Returns the typed metrics + raw tool
 * results so the bun-test wrapper can express assertions, and so the
 * `bun run eval:repo_context` runner can serialize a JSON report.
 */
export async function runEvalCase(
  caseName: string,
  setup: CaseSetup,
): Promise<CaseResult> {
  if (!RG_AVAILABLE) {
    throw new Error(
      `eval-repo-context: 'rg' (ripgrep) not on PATH; install ripgrep before running the harness`,
    )
  }
  const project = await mkdtemp(join(tmpdir(), `codeoz-eval-${caseName}-`))
  for (const [rel, content] of setup.files) {
    const abs = join(project, rel)
    const dir = abs.slice(0, abs.lastIndexOf('/'))
    if (dir.length > project.length) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(abs, content)
  }
  const eventsFile = join(project, 'events.jsonl')
  const lockDir = join(project, '.lock')

  const caps = {
    maxResults: setup.caps?.maxResults ?? 50,
    maxBytesPerResult: setup.caps?.maxBytesPerResult ?? 16_384,
    maxFilesForNextManifest: setup.caps?.maxFilesForNextManifest ?? 20,
    timeoutMs: setup.caps?.timeoutMs ?? 5_000,
  }

  const perms: AgentPermissions = Object.freeze({
    read: '*',
    write: '*',
    bash: 'deny',
    tool_use: Object.freeze({
      repo_context: Object.freeze({
        tools: Object.freeze(['glob', 'grep', 'read'] as const),
        roots: Object.freeze(['.']),
        maxResults: caps.maxResults,
        maxBytesPerResult: caps.maxBytesPerResult,
        maxFilesForNextManifest: caps.maxFilesForNextManifest,
        timeoutMs: caps.timeoutMs,
        network: 'none',
      }),
    }),
  })

  // Fixed Crockford-ULID per case run (26 chars, no I/L/O/U). One runId
  // per case mirrors production: a phase has a single runId across all
  // its tool calls. ULID reused from existing repo-context-runner test
  // fixture for consistency.
  const runId = '01J3Z89H5R8K3CZ8B0K4MZTGNH'

  const results: RepoContextResult[] = []
  for (const [i, req] of setup.requests.entries()) {
    const ts = new Date(Date.UTC(2026, 4, 10, 0, 0, i)).toISOString()
    const out = await runRepoContextTool(
      {
        agentName: 'eval-harness',
        agentPermissions: perms,
        phase: 'plan',
        runId,
        projectRoot: project,
        eventPaths: { file: eventsFile, lockDir },
        now: () => ts,
      },
      req,
    )
    if (out.status !== 'ok') {
      throw new Error(
        `eval-repo-context: case '${caseName}' request ${i} failed: ${out.error.message}`,
      )
    }
    results.push(out.result)
  }

  // Derive metrics from the events the runner emitted (the production
  // audit trail). The harness reads its own audit log to prove the
  // production code path actually emits what we expect.
  const events = await readEvents({ file: eventsFile, lockDir })
  const searchEvents = events.filter((e) => e.type === 'repo_context_searched')

  const distinctReturnedPaths = new Set<string>()
  let totalResultBytes = 0
  let totalResultTokensEstimate = 0
  let maxSelectedPathCount = 0
  for (const ev of searchEvents) {
    if (ev.type !== 'repo_context_searched') continue
    const evx = ev as unknown as {
      resultPaths: readonly string[]
      resultBytes: number
      resultTokensEstimate: number
      selectedPaths: readonly string[]
    }
    for (const p of evx.resultPaths) distinctReturnedPaths.add(p)
    totalResultBytes += evx.resultBytes
    totalResultTokensEstimate += evx.resultTokensEstimate
    if (evx.selectedPaths.length > maxSelectedPathCount) {
      maxSelectedPathCount = evx.selectedPaths.length
    }
  }

  const expectedSet = new Set(setup.expectedPaths)
  let hits = 0
  for (const p of distinctReturnedPaths) {
    if (expectedSet.has(p)) hits += 1
  }
  const recallAtK = expectedSet.size === 0 ? 1.0 : hits / expectedSet.size

  const anyTruncated = results.some((r) =>
    r.tool === 'glob' || r.tool === 'grep' ? r.truncated : false,
  )

  return Object.freeze({
    caseName,
    metrics: Object.freeze({
      toolCallCount: searchEvents.length,
      totalResultBytes,
      totalResultTokensEstimate,
      distinctReturnedPaths: Object.freeze([...distinctReturnedPaths].sort()),
      recallAtK,
      anyTruncated,
      maxSelectedPathCount,
    }),
    results: Object.freeze([...results]),
  })
}

/** Pretty-printable serialization for `bun run eval:repo_context`. */
export function caseResultToJson(r: CaseResult): unknown {
  return {
    case: r.caseName,
    metrics: {
      toolCallCount: r.metrics.toolCallCount,
      totalResultBytes: r.metrics.totalResultBytes,
      totalResultTokensEstimate: r.metrics.totalResultTokensEstimate,
      distinctReturnedPathCount: r.metrics.distinctReturnedPaths.length,
      recallAtK: r.metrics.recallAtK,
      anyTruncated: r.metrics.anyTruncated,
      maxSelectedPathCount: r.metrics.maxSelectedPathCount,
    },
  }
}
