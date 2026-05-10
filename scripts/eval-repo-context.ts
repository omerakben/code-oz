// `bun run eval:repo_context` — standalone JSON reporter for the
// three-case repo_context evaluation harness.
//
// Usage:
//
//   bun run eval:repo_context           # human-readable summary + JSON
//   bun run eval:repo_context --json    # JSON only (machine-readable)
//   bun run eval:repo_context --strict  # exit code 1 if any case fails
//                                       # the regression thresholds in
//                                       # tests/evaluation/repo-context/
//                                       # runner.test.ts
//
// The harness imports the same case fixtures the bun-test wrapper uses,
// so this script and `bun test tests/evaluation/repo-context/` execute
// the identical code path.

import { runEvalCase, caseResultToJson, RG_AVAILABLE } from '../tests/evaluation/repo-context/harness.ts'
import { CASE_01_DISCOVERY } from '../tests/evaluation/repo-context/case-01-discovery.ts'
import { CASE_02_USAGE } from '../tests/evaluation/repo-context/case-02-usage.ts'
import { CASE_03_BUDGET_PRESSURE } from '../tests/evaluation/repo-context/case-03-budget-pressure.ts'

interface CaseEntry {
  readonly name: string
  readonly setup: import('../tests/evaluation/repo-context/harness.ts').CaseSetup
  /** Inline thresholds — kept in sync with the bun-test wrapper. */
  readonly thresholds: {
    /**
     * Recall floor on the encounter-ordered top-k window. Skip (set
     * undefined) for cases where recall depends on rg's filesystem
     * traversal order — those cases use `precisionPathPrefix` instead.
     */
    readonly minRecall?: number
    readonly maxToolCalls?: number
    readonly maxTotalBytes?: number
    readonly mustNotTruncate?: boolean
    readonly mustTruncate?: boolean
    /**
     * If set, every returned path must start with this prefix. Used in
     * case-03 to assert "no decoys leaked through truncation" without
     * depending on rg's traversal order.
     */
    readonly precisionPathPrefix?: string
  }
}

const CASES: readonly CaseEntry[] = Object.freeze([
  {
    name: 'case-01-discovery',
    setup: CASE_01_DISCOVERY,
    thresholds: { minRecall: 1.0, maxToolCalls: 1, mustNotTruncate: true },
  },
  {
    name: 'case-02-usage',
    setup: CASE_02_USAGE,
    thresholds: { minRecall: 1.0, mustNotTruncate: true },
  },
  {
    name: 'case-03-budget-pressure',
    setup: CASE_03_BUDGET_PRESSURE,
    // case-03 asserts truncation + envelope + precision-under-truncation
    // (no decoy paths leak through). Recall is intentionally NOT a
    // threshold here because it depends on rg's filesystem traversal
    // order. Precision is the regression-detection signal: a tool change
    // that accidentally returns decoys after cap saturation must fail.
    // Kept in sync with tests/evaluation/repo-context/runner.test.ts.
    thresholds: {
      maxTotalBytes: 150_000,
      maxToolCalls: 1,
      mustTruncate: true,
      precisionPathPrefix: 'src/match/',
    },
  },
])

interface CaseFinding {
  readonly case: string
  readonly passed: boolean
  readonly failures: readonly string[]
  readonly metrics: ReturnType<typeof caseResultToJson>
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const jsonOnly = argv.includes('--json')
  const strict = argv.includes('--strict')

  if (!RG_AVAILABLE) {
    process.stderr.write(
      "eval:repo_context: 'rg' (ripgrep) not on PATH. Install ripgrep and rerun.\n",
    )
    process.exit(strict ? 1 : 0)
  }

  const findings: CaseFinding[] = []
  for (const c of CASES) {
    if (!jsonOnly) {
      process.stdout.write(`Running ${c.name}...\n`)
    }
    const r = await runEvalCase(c.name, c.setup)
    const failures: string[] = []
    if (
      c.thresholds.minRecall !== undefined &&
      r.metrics.recallAtK < c.thresholds.minRecall
    ) {
      failures.push(
        `recallAtK ${r.metrics.recallAtK.toFixed(3)} < threshold ${c.thresholds.minRecall.toFixed(
          3,
        )}`,
      )
    }
    if (c.thresholds.precisionPathPrefix !== undefined) {
      const offenders = r.metrics.orderedReturnedPaths.filter(
        (p) => !p.startsWith(c.thresholds.precisionPathPrefix!),
      )
      if (offenders.length > 0) {
        failures.push(
          `precision violation: ${offenders.length} returned paths outside prefix '${c.thresholds.precisionPathPrefix}': ${offenders.slice(0, 3).join(', ')}${offenders.length > 3 ? '...' : ''}`,
        )
      }
    }
    if (
      c.thresholds.maxToolCalls !== undefined &&
      r.metrics.toolCallCount > c.thresholds.maxToolCalls
    ) {
      failures.push(
        `toolCallCount ${r.metrics.toolCallCount} > maxToolCalls ${c.thresholds.maxToolCalls}`,
      )
    }
    if (
      c.thresholds.maxTotalBytes !== undefined &&
      r.metrics.totalResultBytes > c.thresholds.maxTotalBytes
    ) {
      failures.push(
        `totalResultBytes ${r.metrics.totalResultBytes} > maxTotalBytes ${c.thresholds.maxTotalBytes}`,
      )
    }
    if (c.thresholds.mustNotTruncate === true && r.metrics.anyTruncated) {
      failures.push('anyTruncated=true (mustNotTruncate)')
    }
    if (c.thresholds.mustTruncate === true && !r.metrics.anyTruncated) {
      failures.push('anyTruncated=false (mustTruncate — fixture not exercising cap)')
    }
    findings.push({
      case: c.name,
      passed: failures.length === 0,
      failures: Object.freeze(failures),
      metrics: caseResultToJson(r),
    })
  }

  const allPassed = findings.every((f) => f.passed)
  const report = { allPassed, findings }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')

  if (!jsonOnly) {
    process.stdout.write('\n')
    for (const f of findings) {
      const tag = f.passed ? 'PASS' : 'FAIL'
      process.stdout.write(`${tag} ${f.case}\n`)
      for (const r of f.failures) {
        process.stdout.write(`     - ${r}\n`)
      }
    }
    process.stdout.write(allPassed ? '\nAll cases passed.\n' : '\nOne or more cases failed.\n')
  }

  if (strict && !allPassed) {
    process.exit(1)
  }
}

main().catch((e) => {
  process.stderr.write(`eval:repo_context: ${(e as Error).stack ?? (e as Error).message}\n`)
  process.exit(1)
})
