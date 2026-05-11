// case-03-budget-pressure.ts — "fixture should prove the cap actually
// saturates under pressure, the per-call byte envelope is honored, and
// no decoy paths leak through truncation" (Codex Q4 case 3, R1 finding
// 3 remediation).
//
// Synthetic repo: 40 matching files (each containing three lines that
// match the pattern, so grep emits 120 candidate match-lines) plus 12
// decoys. The pattern matches 120 lines but `maxResults=25` truncates
// — this is the genuine cap-saturation that previous case design did
// not exercise. The case asserts:
//
//   1. anyTruncated === true                    (grep cap actually bit)
//   2. cumulative bytes < 150_000               (per-call envelope)
//   3. every returned path begins with `src/match/`
//                                                (precision under
//                                                 truncation — no
//                                                 decoys leaked)
//
// recall@k is intentionally NOT asserted here. rg's traversal order is
// platform-dependent (filesystem inode order on macOS, sorted on Linux
// only with `--sort path`), so a recall floor on the encounter-ordered
// first-k window is fragile. Precision is the regression we actually
// want to catch: a tool change that accidentally returns decoy files
// after cap saturation must fail. Recall under truncation depends on
// invariants the production tool does not currently provide and would
// require a new authority surface (rule 20) to add.
//
// Per-call envelope: `maxResults=25 × maxBytesPerResult=4096 = 102_400`
// bytes per call. The case issues exactly one grep call so cumulative
// bytes are bounded by that envelope. Asserting < 150_000 leaves
// headroom for snippet/path overhead without concealing regressions.
//
// Selected-path saturation (`maxFilesForNextManifest`) is NOT exercised
// here — `selectedPaths` is populated in the next-invocation manifest,
// which the harness does not drive yet. A future case can extend the
// harness to simulate selection. Avoiding the false claim of testing
// `maxFilesForNextManifest` was the second half of R1 finding 3.

import type { CaseSetup } from './harness.ts'

const HEADER = `// Pattern match: TARGET_SYMBOL\n`

function matching(name: string): readonly [string, string] {
  // Three TARGET_SYMBOL occurrences per file (HEADER + return-line +
  // guard-line) ⇒ 120 grep match-lines for 40 files. With
  // maxResults=25 this guarantees grep truncates.
  return [
    `src/match/${name}.ts`,
    `${HEADER}export const ${name.replaceAll('-', '_')} = () => 'TARGET_SYMBOL'\n// guard: TARGET_SYMBOL must be set\n`,
  ] as const
}

function decoy(name: string): readonly [string, string] {
  return [
    `src/decoy/${name}.ts`,
    `// Decoy — does not contain the target.\nexport const ${name.replaceAll('-', '_')} = () => 'unrelated'\n`,
  ] as const
}

// 40 matching files (>> maxResults=25 lines). With 3 match-lines per
// file the cap saturates after roughly 8-9 files survive truncation
// (rg's traversal order is platform-dependent). The full match-name
// list serves as the expected set for the harness's recallAtK metric;
// the case does not assert recall (see file header).
const matchNames = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
  'mike',
  'november',
  'oscar',
  'papa',
  'quebec',
  'romeo',
  'sierra',
  'tango',
  'uniform',
  'victor',
  'whiskey',
  'xray',
  'yankee',
  'zulu',
  'aurora',
  'borealis',
  'cosmos',
  'delphi',
  'eclipse',
  'fjord',
  'galaxy',
  'horizon',
  'invent',
  'jasper',
  'kepler',
  'luna',
  'mantis',
  'nebula',
] as const

const decoyNames = [
  'red',
  'green',
  'blue',
  'magenta',
  'cyan',
  'amber',
  'rose',
  'pearl',
  'jade',
  'ruby',
  'topaz',
  'opal',
] as const

// expectedPaths covers ALL matching files. recallAtK in the JSON
// metrics then reports the fraction of matching files that survived
// truncation — a useful diagnostic value (always < 1.0 under
// saturation) but NOT asserted because rg's filesystem traversal
// order is platform-dependent.
const expectedAll = matchNames.map((n) => `src/match/${n}.ts`)

export const CASE_03_BUDGET_PRESSURE: CaseSetup = {
  files: Object.freeze([
    ...matchNames.map(matching),
    ...decoyNames.map(decoy),
  ] as ReadonlyArray<readonly [string, string]>),
  // Single grep call — case-03's job is to prove the cap saturates,
  // the byte envelope is honored, and decoys do not leak through.
  requests: Object.freeze([
    { tool: 'grep', args: { pattern: 'TARGET_SYMBOL' } },
  ] as const),
  expectedPaths: Object.freeze(expectedAll),
  caps: {
    maxResults: 25,
    maxBytesPerResult: 4_096,
    maxFilesForNextManifest: 10,
    timeoutMs: 5_000,
  },
}
