// case-01-discovery.ts — "given a task prompt, can the agent find the
// expected files?" (Codex Q4 case 1).
//
// Synthetic repo with 12 files spread across 3 subdirectories. The
// "task" is "modify the user-authentication module"; the expected
// discovery set is the 4 files whose names contain `auth` plus the
// canonical entry point (`src/index.ts`). The harness exercises a
// single broad `grep` for the symbol `authenticate` to model how a
// LEAD persona would start exploration.

import type { CaseSetup } from './harness.ts'

export const CASE_01_DISCOVERY: CaseSetup = {
  files: Object.freeze([
    ['src/index.ts', `import { authenticate } from './auth/login'\nexport { authenticate }\n`],
    ['src/auth/login.ts', `export function authenticate(token: string): boolean {\n  return token.length > 0\n}\n`],
    ['src/auth/session.ts', `import { authenticate } from './login'\nexport function startSession(t: string) {\n  return authenticate(t)\n}\n`],
    ['src/auth/middleware.ts', `import { authenticate } from './login'\nexport const authMiddleware = (req: any) => authenticate(req.token)\n`],
    ['src/auth/types.ts', `export interface AuthToken { value: string }\n`],
    ['src/users/profile.ts', `export interface Profile { id: string; name: string }\n`],
    ['src/users/list.ts', `export const list = () => []\n`],
    ['src/users/index.ts', `export * from './profile'\nexport * from './list'\n`],
    ['src/billing/invoice.ts', `export const newInvoice = () => ({ amount: 0 })\n`],
    ['src/billing/charge.ts', `export const charge = (cents: number) => cents > 0\n`],
    ['src/billing/index.ts', `export * from './invoice'\n`],
    // README intentionally does NOT contain the trigger word — only
    // source files should match `grep authenticate`. Keeping README in
    // the fixture proves the tool ignores irrelevant docs.
    ['README.md', `# project\n\nLogin via the auth module.\n`],
  ] as ReadonlyArray<readonly [string, string]>),
  requests: Object.freeze([
    { tool: 'grep', args: { pattern: 'authenticate' } },
  ] as const),
  // The auth/* files plus the index that re-exports the symbol.
  expectedPaths: Object.freeze([
    'src/index.ts',
    'src/auth/login.ts',
    'src/auth/session.ts',
    'src/auth/middleware.ts',
  ]),
}
