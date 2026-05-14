# A10-hygiene findings

Sub-task: A10
Operator: codex-subtask-10
Started: 2026-05-13T22:12:00Z
Finished: 2026-05-13T22:27:41Z

## Summary

Four findings. Severity mix: 0 block-ship, 3 fix-soon, 1 nit. Root CLI typecheck is clean, GUI manual `tsc` is clean, no committed real `.env` file was found, and no high-confidence secret pattern was found in JSON/JSONL fixtures. The main hygiene risks are GUI lint not being usable as a clean gate, GUI typecheck not being exposed as a script or covered by root typecheck, unresolved source TODOs without issue links, and stale GUI dependency/export surface.

## Findings

### F10.1 - GUI lint is not a usable hygiene gate

- **Severity:** fix-soon
- **Where:** `code-oz-gui/eslint.config.mjs:9`, `code-oz-gui/app/page.tsx:180`, `code-oz-gui/app/page.tsx:255`, `code-oz-gui/components/AIHelper.tsx:33`
- **Evidence:**
  ```text
  command: cd code-oz-gui && bun run lint
  exit: 1

  $ eslint .
  /code-oz-gui/.tmp/bun-cache/playwright-core@1.60.0@@@1/lib/utilsBundle.js
    error  React Hook "useColor" is called in function "getOutHasColors" ...

  /code-oz-gui/app/page.tsx
    180:19  error  React Hook "useWorkspacePath" cannot be called inside a callback
    255:17  error  React Hook "useWorkspacePath" cannot be called inside a callback

  /code-oz-gui/components/AIHelper.tsx
    33:5  error  Calling setState synchronously within an effect can trigger cascading renders

  result summary: 135 problems, 126 errors, 9 warnings

  code-oz-gui/eslint.config.mjs:
  9 export default defineConfig([{
  10     extends: [...next],
  11 }]);

  code-oz-gui/.gitignore:
  9 .tmp/
  ```
- **Why it matters for first-run UX:** A package-level `lint` script that fails on ignored cache files plus source files makes it hard to separate real GUI regressions from tool-noise before distribution.
- **Proposed fix:** Add explicit ESLint ignores for `.next/`, `.tmp/`, `node_modules/`, `playwright-report/`, and `test-results/`; rename the local `useWorkspacePath` callback to avoid hook-rule false positives; then address or intentionally configure the React lint rules for synchronous state resets in effects. No behavior change is required for the ignore/callback rename. If effect rewrites alter UI state timing, add a focused GUI test around switching cards/tabs.
- **Effort estimate:** s

### F10.2 - GUI typecheck is not exposed as a script and root typecheck excludes it

- **Severity:** fix-soon
- **Where:** `package.json:16`, `tsconfig.json:23`, `code-oz-gui/package.json:5`
- **Evidence:**
  ```text
  command: bun run typecheck
  cwd: /Users/ozzy-mac/Projects/code-oz
  exit: 0
  output: $ tsc --noEmit

  package.json:
  16 "typecheck": "tsc --noEmit",

  tsconfig.json:
  23 "include": ["src/**/*", "tests/**/*"],

  code-oz-gui/package.json:
  5 "scripts": {
  6   "dev": "next dev",
  7   "build": "NODE_ENV=production next build",
  8   "start": "next start",
  9   "lint": "eslint .",
  10  "clean": "next clean",
  11  "screenshots": "bun run scripts/capture-screenshots.ts",
  12  "test:e2e": "playwright test"
  13 }

  command: cd code-oz-gui && bun run typecheck
  exit: 1
  output: error: Script not found "typecheck"

  command: cd code-oz-gui && ./node_modules/.bin/tsc --noEmit --project tsconfig.json
  exit: 0
  ```
- **Why it matters for first-run UX:** The finalize checklist can report a clean root typecheck while GUI TypeScript is not checked by the same script surface.
- **Proposed fix:** Add `typecheck: "tsc --noEmit --project tsconfig.json"` to `code-oz-gui/package.json`. Consider a root script such as `typecheck:all` that runs the CLI and GUI checks without changing the existing root `typecheck` contract.
- **Effort estimate:** xs

### F10.3 - Source TODOs are unresolved and lack tracked issue links

- **Severity:** fix-soon
- **Where:** `src/state/events.ts:275`, `code-oz-gui/components/Card.tsx:7`
- **Evidence:**
  ```text
  command: git grep -nE 'TODO|FIXME|XXX' -- src tests code-oz-gui ':!code-oz-gui/bun.lock'
  exit: 0

  code-oz-gui/components/Card.tsx:7:
  // TODO(a11y): contrast - text-white/40 on #0a0a0a is about 3.77:1. Revisit subdued metadata colors in v0.2.

  src/state/events.ts:275:
  // TODO(run-start emitter follow-up): either widen this narrow payload

  tests/cost-by-parent-task.test.ts:12:
  const RUN = '01HXXXX0YYYY1ZZZZ22222'

  tests/guardrails.test.ts:
  fixture strings include TODO/FIX text intentionally
  ```
- **Why it matters for first-run UX:** The A10 checklist requires each TODO/FIXME/XXX to be closed or linked to a tracked issue; the two source TODOs have no issue link or owner.
- **Proposed fix:** For `src/state/events.ts`, either close the telemetry contract mismatch or replace the TODO with a tracked issue link and a one-line owner/scope. For `Card.tsx`, either fix the low-contrast metadata color now or link it to the A9 accessibility follow-up. Leave test fixture strings alone.
- **Effort estimate:** xs

### F10.4 - GUI has stale dependency and export surface

- **Severity:** fix-soon
- **Where:** `code-oz-gui/package.json:16`, `code-oz-gui/package.json:18`, `code-oz-gui/package.json:40`, `code-oz-gui/lib/oz-bridge.ts:60`, `code-oz-gui/lib/types.ts:17`, `code-oz-gui/lib/types.ts:23`, `code-oz-gui/hooks/use-mobile.ts:5`
- **Evidence:**
  ```text
  command: rg -n "@hookform/resolvers|class-variance-authority|firebase-tools" code-oz-gui/app code-oz-gui/components code-oz-gui/hooks code-oz-gui/lib code-oz-gui/tests code-oz-gui/scripts code-oz-gui/*.ts code-oz-gui/*.mjs code-oz-gui/*.json --glob '!code-oz-gui/bun.lock'
  exit: 0

  code-oz-gui/package.json:16: "@hookform/resolvers": "^5.2.1",
  code-oz-gui/package.json:18: "class-variance-authority": "^0.7.1",
  code-oz-gui/package.json:40: "firebase-tools": "^15.0.0",

  command: rg -n "\\b(LogEntry|SavedAction|ProjectStatus|ozBridge|useIsMobile)\\b" code-oz-gui/app code-oz-gui/components code-oz-gui/hooks code-oz-gui/lib code-oz-gui/tests code-oz-gui/scripts --glob '*.{ts,tsx}'
  exit: 0

  code-oz-gui/lib/oz-bridge.ts:60:export const ozBridge = OzBridge.getInstance();
  code-oz-gui/lib/types.ts:17:export interface SavedAction {
  code-oz-gui/lib/types.ts:23:export type ProjectStatus = 'idle' | 'running' | 'warning' | 'processing';
  code-oz-gui/hooks/use-mobile.ts:5:export function useIsMobile() {
  ```
- **Why it matters for first-run UX:** Unused dependencies increase install size and lockfile churn; dead exported GUI helpers make the current CLI bridge harder to audit.
- **Proposed fix:** Remove `@hookform/resolvers`, `class-variance-authority`, and `firebase-tools` unless another worker confirms a hidden deployment path needs them. Remove or quarantine `lib/oz-bridge.ts`, `SavedAction`, `ProjectStatus`, and `useIsMobile`; if any are intentional public API, add a one-line comment explaining the public-API reason.
- **Effort estimate:** s

### F10.5 - One TS suppression remains, but it is scoped to a negative type test

- **Severity:** nit
- **Where:** `tests/providers-types.test.ts:50`
- **Evidence:**
  ```text
  command: rg -n '@ts-(ignore|expect-error)|ts-ignore|ts-expect-error' src tests code-oz-gui --glob '!code-oz-gui/.next/**' --glob '!**/node_modules/**'
  exit: 0

  tests/providers-types.test.ts:50:
  // @ts-expect-error: issues is readonly

  No // @ts-ignore was found.
  ```
- **Why it matters for first-run UX:** TS suppressions can hide real type drift; this one is a narrow compile-time assertion, but it should stay intentional.
- **Proposed fix:** No immediate code change. Keep this as `@ts-expect-error`, not `@ts-ignore`, and leave the explanatory comment in place.
- **Effort estimate:** xs

## Checked without findings

- Root `bun run typecheck` passed with exit 0.
- GUI direct TypeScript check passed with exit 0 via `./node_modules/.bin/tsc --noEmit --project tsconfig.json`.
- Root dependency list is small: `@types/bun`, `typescript`, `yaml`. GUI and root share only `typescript`; installed versions both resolve to `5.9.3`.
- `yaml` is used by CLI source, tests, and demo scripts.
- `.env` and `code-oz-gui/.env` exist locally but are ignored. `git ls-files` only reports `code-oz-gui/.env.example`.
- High-confidence secret scan over `code-oz-gui/fixtures` and `tests/fixtures` returned no matches.
- Broad secret scan hits in `events.jsonl` were provider/model names and token budget fields, not API keys.
- No committed real `.env` file found.

## Gaps

- I did not run a full dead-export tool such as Knip or ts-prune. The dead-export finding is based on fast `rg` checks only.
- I did not run `bun test`, GUI Playwright e2e, or `code-oz-gui` production build; those are outside this A10 timebox and covered by other finalize gates.
- I did not inspect ignored local `.env` contents.
- I did not prove whether `firebase-tools` is needed by an external deployment flow; it is unused by tracked GUI scripts and source.

## Commands run

| Command | Cwd | Exit |
| --- | --- | --- |
| `git status --short --branch` | repo root | 0 |
| `pwd` | repo root | 0 |
| `sed -n '1,240p' docs/handoffs/2026-05-13-codex-finalize-distribution.md` | repo root | 0 |
| `sed -n '240,520p' docs/handoffs/2026-05-13-codex-finalize-distribution.md` | repo root | 0 |
| `sed -n '1,240p' CLAUDE.md` | repo root | 0 |
| `sed -n '1,220p' package.json` | repo root | 0 |
| `sed -n '1,220p' tsconfig.json` | repo root | 0 |
| `find code-oz-gui -maxdepth 2 -name 'package*.json' -o -name 'tsconfig*.json'` | repo root | 0 |
| `sed -n '1,240p' code-oz-gui/package.json` | repo root | 0 |
| `sed -n '1,220p' code-oz-gui/tsconfig.json` | repo root | 0 |
| `sed -n '1,200p' code-oz-gui/.next/package.json` | repo root | 0 |
| `sed -n '1,220p' code-oz-gui/README.md` | repo root | 0 |
| `rg --files src tests code-oz-gui \| sed -n '1,220p'` | repo root | 0 |
| `bun run typecheck` | repo root | 0 |
| `git grep -nE 'TODO|FIXME|XXX'` | repo root | 0 |
| `git grep -nE 'TODO|FIXME|XXX' -- src tests code-oz-gui ':!code-oz-gui/bun.lock'` | repo root | 0 |
| `bun pm ls --depth=0` | repo root | 0 |
| `bun pm ls --depth=0` | `code-oz-gui` | 0 |
| `rg -n '@ts-(ignore\|expect-error)\|ts-ignore\|ts-expect-error' src tests code-oz-gui --glob '!code-oz-gui/.next/**' --glob '!**/node_modules/**'` | repo root | 0 |
| `git ls-files \| rg '(^\|/)\\.env($\|\\.)'` | repo root | 0 |
| `find . -name '.env*' -not -path './node_modules/*' -not -path './code-oz-gui/node_modules/*' -not -path './code-oz-gui/.next/*' -not -path './.git/*'` | repo root | 0 |
| `rg -n -i '(api[_-]?key\|secret\|token\|bearer\|sk-[A-Za-z0-9]\|AIza\|anthropic\|openai\|gemini\|xai\|GEMINI_API_KEY\|OPENAI_API_KEY\|ANTHROPIC_API_KEY\|XAI_API_KEY)' code-oz-gui/fixtures tests/fixtures --glob '*.jsonl' --glob '*.json' --glob '!**/node_modules/**'` | repo root | 0 |
| `rg -n "(sk-[A-Za-z0-9]{20,}\|AIza[0-9A-Za-z_-]{20,}\|xai-[A-Za-z0-9_-]+\|anthropic_[A-Za-z0-9_-]+\|Bearer\\s+[A-Za-z0-9._-]{20,}\|[A-Z_]*API_KEY[\\\"=:[:space:]]+[^\\\"[:space:],]+)" code-oz-gui/fixtures tests/fixtures --glob '*.jsonl' --glob '*.json' --glob '!**/node_modules/**'` | repo root | 1 |
| `git grep -nE '(sk-[A-Za-z0-9]{20,}\|AIza[0-9A-Za-z_-]{20,}\|xai-[A-Za-z0-9_-]+\|anthropic_[A-Za-z0-9_-]+\|Bearer[[:space:]]+[A-Za-z0-9._-]{20,}\|[A-Z_]*API_KEY[=:\"][^\"[:space:],]+)' -- '*.env*' '*.json' '*.jsonl'` | repo root | 0 |
| `rg -n '^\\s*export\\s+(async\\s+)?(function\|const\|class\|type\|interface\|enum)\\s+\|^\\s*export\\s+\\{' src code-oz-gui --glob '*.{ts,tsx}' --glob '!code-oz-gui/.next/**' --glob '!**/node_modules/**'` | repo root | 0 |
| `bun -e "const fs=require('fs'); const root=JSON.parse(fs.readFileSync('package.json','utf8')); const gui=JSON.parse(fs.readFileSync('code-oz-gui/package.json','utf8')); const all=n=>Object.assign({}, n.dependencies\|\|{}, n.devDependencies\|\|{}); const a=all(root), b=all(gui); for (const k of Object.keys(a).filter(k=>k in b).sort()) console.log(k+' root='+a[k]+' gui='+b[k]);"` | repo root | 0 |
| `git status --short -- .env code-oz-gui/.env code-oz-gui/.env.example` | repo root | 0 |
| `git ls-files -- .env code-oz-gui/.env code-oz-gui/.env.example` | repo root | 0 |
| `git check-ignore -v .env code-oz-gui/.env code-oz-gui/.env.example` | repo root | 0 |
| `rg -n 'from ["\\''](@hookform/resolvers\|class-variance-authority\|lucide-react\|motion\|react-markdown\|remark-frontmatter\|remark-gfm\|tailwind-merge\|tw-animate-css\|@google/genai)["\\'']\|from ["\\''](@hookform/resolvers/\|class-variance-authority/\|lucide-react/\|motion/\|react-markdown/\|remark-frontmatter/\|remark-gfm/\|tailwind-merge/\|tw-animate-css/\|@google/genai/)' code-oz-gui --glob '*.{ts,tsx,js,jsx,mjs}' --glob '!code-oz-gui/.next/**' --glob '!code-oz-gui/node_modules/**'` | repo root | 2 |
| `rg -n "(@hookform/resolvers\|class-variance-authority\|lucide-react\|motion\|react-markdown\|remark-frontmatter\|remark-gfm\|tailwind-merge\|tw-animate-css\|@google/genai)" code-oz-gui --glob '*.{ts,tsx,js,jsx,mjs}' --glob '!code-oz-gui/.next/**' --glob '!code-oz-gui/node_modules/**'` | repo root | 0 |
| `rg -n "from ['\\\"]yaml['\\\"]\|from ['\\\"]yaml/" src tests scripts npm-wrapper --glob '*.{ts,tsx,js,cjs,mjs}'` | repo root | 0 |
| `rg -n "(autoprefixer\|postcss\|tailwindcss\|@tailwindcss/postcss\|@tailwindcss/typography\|firebase-tools)" code-oz-gui --glob '*.{ts,tsx,js,jsx,mjs,json,css}' --glob '!code-oz-gui/.next/**' --glob '!code-oz-gui/node_modules/**'` | repo root | 0 |
| `rg -n "\\b(cn\|LogType\|SavedAction\|ProjectStatus\|ozBridge\|useIsMobile)\\b" code-oz-gui --glob '*.{ts,tsx}' --glob '!code-oz-gui/.next/**' --glob '!code-oz-gui/node_modules/**'` | repo root | 0 |
| `rg -n "\\b(validateArtifactSyncPath\|_validateArtifactSyncPath\|BUILD_READY_SIGNAL\|PLAN_READY_SIGNAL\|REVIEW_READY_SIGNAL)\\b" src tests --glob '*.{ts,tsx}'` | repo root | 0 |
| `rg -n "@hookform/resolvers\|class-variance-authority\|tw-animate-css" code-oz-gui --glob '!code-oz-gui/.next/**' --glob '!code-oz-gui/node_modules/**' --glob '!code-oz-gui/bun.lock'` | repo root | 0 |
| `rg -n "firebase" code-oz-gui --glob '!code-oz-gui/.next/**' --glob '!code-oz-gui/node_modules/**' --glob '!code-oz-gui/bun.lock'` | repo root | 0 |
| `rg -n "SavedAction\|ProjectStatus\|ozBridge\|useIsMobile" code-oz-gui --glob '*.{ts,tsx}' --glob '!code-oz-gui/.next/**' --glob '!code-oz-gui/node_modules/**'` | repo root | 0 |
| `bun run typecheck` | `code-oz-gui` | 1 |
| `./node_modules/.bin/tsc --noEmit --project tsconfig.json` | `code-oz-gui` | 0 |
| `bun run lint` | `code-oz-gui` | 1 |
| `git status --short -- code-oz-gui/.tmp` | repo root | 0 |
| `git check-ignore -v code-oz-gui/.tmp code-oz-gui/.tmp/bun-cache` | repo root | 0 |
| `date -u +%Y-%m-%dT%H:%M:%SZ` | repo root | 0 |
