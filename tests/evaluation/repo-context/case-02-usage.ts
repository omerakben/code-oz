// case-02-usage.ts — "broad symbol query should return the expected
// call-site files without hitting maxResults" (Codex Q4 case 2).
//
// Synthetic repo with 5 caller files of one symbol (`renderToString`),
// plus 5 unrelated files. The harness runs a single broad grep and
// asserts: every caller is returned, no truncation, no max-results
// saturation.

import type { CaseSetup } from './harness.ts'

const RENDER = `import { renderToString } from './renderer'\n`

export const CASE_02_USAGE: CaseSetup = {
  files: Object.freeze([
    ['src/renderer.ts', `export function renderToString(node: unknown): string {\n  return String(node)\n}\n`],
    // Five callers — the recall denominator
    ['src/views/home.ts', `${RENDER}export const home = (n: any) => renderToString(n)\n`],
    ['src/views/about.ts', `${RENDER}export const about = (n: any) => renderToString(n)\n`],
    ['src/views/contact.ts', `${RENDER}export const contact = (n: any) => renderToString(n)\n`],
    ['src/views/settings.ts', `${RENDER}export const settings = (n: any) => renderToString(n)\n`],
    ['src/cli/main.ts', `${RENDER}export const main = (n: any) => console.log(renderToString(n))\n`],
    // Decoys — same shape, different symbol
    ['src/views/admin.ts', `import { adminize } from './adminize'\nexport const admin = (n: any) => adminize(n)\n`],
    ['src/lib/adminize.ts', `export const adminize = (n: unknown) => String(n)\n`],
    ['src/lib/format.ts', `export const format = (s: string) => s.trim()\n`],
    ['src/lib/parse.ts', `export const parse = (s: string) => JSON.parse(s)\n`],
    ['src/lib/util.ts', `export const noop = () => undefined\n`],
  ] as ReadonlyArray<readonly [string, string]>),
  requests: Object.freeze([
    { tool: 'grep', args: { pattern: 'renderToString' } },
  ] as const),
  expectedPaths: Object.freeze([
    'src/renderer.ts',
    'src/views/home.ts',
    'src/views/about.ts',
    'src/views/contact.ts',
    'src/views/settings.ts',
    'src/cli/main.ts',
  ]),
}
