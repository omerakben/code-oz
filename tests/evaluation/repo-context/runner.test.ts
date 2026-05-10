// CI wrapper for the three-case repo_context evaluation harness. Runs
// each case as a bun-test assertion so regressions surface in
// `bun test`. The same harness is used by `bun run eval:repo_context`
// for ad-hoc JSON reporting.
//
// Why these specific assertions:
//
//   - case-01 discovery: recall@k must be 1.0 — every expected file
//     should be returned by a single broad grep. If recall drops, the
//     grep tool is missing files (regression in tool implementation).
//
//   - case-02 usage: recall must hit every caller AND the call must
//     not saturate maxResults (proves the cap is not binding for a
//     normal call-site query at default caps).
//
//   - case-03 budget pressure: grep must SATURATE the cap
//     (anyTruncated === true) and the per-call byte envelope must
//     hold. Recall is intentionally NOT asserted because rg's
//     filesystem traversal order is platform-dependent. Precision is
//     the regression we catch instead: every returned path must start
//     with `src/match/` (no decoy paths leak through truncation).

import { describe, test, expect } from 'bun:test'

import { runEvalCase, RG_AVAILABLE } from './harness.ts'
import { CASE_01_DISCOVERY } from './case-01-discovery.ts'
import { CASE_02_USAGE } from './case-02-usage.ts'
import { CASE_03_BUDGET_PRESSURE } from './case-03-budget-pressure.ts'

describe.if(RG_AVAILABLE)('repo_context eval harness — three deterministic cases', () => {
  test('case-01 discovery: grep recovers every expected auth file at recall@4 = 1.0', async () => {
    const r = await runEvalCase('case-01-discovery', CASE_01_DISCOVERY)
    expect(r.metrics.recallAtK).toBe(1.0)
    expect(r.metrics.toolCallCount).toBe(1)
    expect(r.metrics.anyTruncated).toBe(false)
    // Audit invariant: at least one path returned per expected file.
    expect(r.metrics.orderedReturnedPaths.length).toBeGreaterThanOrEqual(
      CASE_01_DISCOVERY.expectedPaths.length,
    )
  })

  test('case-02 usage: every caller surfaces under default caps without saturation', async () => {
    const r = await runEvalCase('case-02-usage', CASE_02_USAGE)
    expect(r.metrics.recallAtK).toBe(1.0)
    expect(r.metrics.anyTruncated).toBe(false)
    // Default maxResults=50; the case has 6 expected paths, so the
    // distinct returned-path count should be well under the cap.
    expect(r.metrics.orderedReturnedPaths.length).toBeLessThan(50)
  })

  test('case-03 budget pressure: cap saturates, envelope honored, precision under truncation', async () => {
    const r = await runEvalCase('case-03-budget-pressure', CASE_03_BUDGET_PRESSURE)
    // Truncation actually fired — this is the load-bearing change from
    // the prior version of the case (Codex R1 finding 3): with 120
    // candidate matches (40 files × 3 lines/file) and maxResults=25,
    // grep MUST report truncation.
    expect(r.metrics.anyTruncated).toBe(true)
    // Per-call envelope: maxResults=25 × maxBytesPerResult=4096 = 102_400
    // bytes per grep call. < 150_000 leaves headroom for snippet/path
    // overhead while detecting regressions.
    expect(r.metrics.totalResultBytes).toBeLessThan(150_000)
    expect(r.metrics.toolCallCount).toBe(1)
    // Precision under truncation: every returned path must be a
    // matching file (`src/match/*`), never a decoy. This is the right
    // metric for case-03 — recall under truncation depends on rg's
    // filesystem traversal order which is platform-dependent. Precision
    // is the regression we actually want to catch: a tool change that
    // accidentally leaks decoys through cap saturation.
    for (const p of r.metrics.orderedReturnedPaths) {
      expect(p.startsWith('src/match/')).toBe(true)
    }
    // Sanity: at least some matching files survive truncation.
    expect(r.metrics.orderedReturnedPaths.length).toBeGreaterThan(0)
  })
})

describe.if(!RG_AVAILABLE)('repo_context eval harness — rg not installed', () => {
  test('runEvalCase throws actionable error when rg is missing', async () => {
    await expect(runEvalCase('case-01-discovery', CASE_01_DISCOVERY)).rejects.toThrow(
      /rg.*ripgrep/,
    )
  })
})
