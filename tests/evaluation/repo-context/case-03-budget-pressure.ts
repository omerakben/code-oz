// case-03-budget-pressure.ts — "selected files and result bytes stay
// below caps while preserving recall" (Codex Q4 case 3).
//
// Synthetic repo with 30 candidate files. A pattern matches 12 of them.
// The harness drives a single broad grep, then 12 follow-up reads of
// the matching files (modeling LEAD's "find-then-read" loop). It
// asserts: total result bytes stay below `maxResults * maxBytesPerResult`,
// recall@expected ≥ 0.8 even though the cap could in principle truncate.

import type { CaseSetup } from './harness.ts'

const HEADER = `// Auto-generated fixture. Pattern match: TARGET_SYMBOL\n`

function matching(name: string): readonly [string, string] {
  return [
    `src/match/${name}.ts`,
    `${HEADER}export const ${name.replaceAll('-', '_')} = () => 'TARGET_SYMBOL'\n`,
  ] as const
}

function decoy(name: string): readonly [string, string] {
  return [
    `src/decoy/${name}.ts`,
    `// Decoy — does not contain the target.\nexport const ${name.replaceAll('-', '_')} = () => 'unrelated'\n`,
  ] as const
}

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
] as const

const decoyNames = [
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
  'alfa-decoy',
  'bravo-decoy',
  'charlie-decoy',
  'delta-decoy',
] as const

const requests: readonly import('./harness.ts').CaseSetup['requests'][number][] = [
  { tool: 'grep', args: { pattern: 'TARGET_SYMBOL' } },
  ...matchNames.map((n) => ({
    tool: 'read' as const,
    args: { path: `src/match/${n}.ts` },
  })),
]

export const CASE_03_BUDGET_PRESSURE: CaseSetup = {
  files: Object.freeze([
    ...matchNames.map(matching),
    ...decoyNames.map(decoy),
  ] as ReadonlyArray<readonly [string, string]>),
  requests: Object.freeze(requests),
  expectedPaths: Object.freeze(matchNames.map((n) => `src/match/${n}.ts`)),
  // Budget pressure: tighter caps so the case actually exercises the
  // truncation behavior.
  caps: {
    maxResults: 25,
    maxBytesPerResult: 4_096,
    maxFilesForNextManifest: 10,
    timeoutMs: 5_000,
  },
}
