# A2-gui-first-run findings

Sub-task: A2
Operator: codex-subtask-A2
Started: 2026-05-13T22:13:00Z
Finished: 2026-05-13T22:35:04Z

## Summary

GUI fixture rendering is mostly intact under production start: the board, composer, drawer tabs, artifact/events/decisions path, and the existing Playwright happy path passed. The default first-run path is not clean, though. `bun run dev` hit `EMFILE` watcher errors and served `/` as a 404 in this audit environment, live fake-run start returned 503 because the GUI selected a stale local `dist/code-oz` binary, and live approval actions currently write to the fixture request directory rather than the active run. Severity mix: 3 block-ship, 4 fix-soon, 1 nit.

## Commands run

Commands were run from a temp copy at `/private/tmp/code-oz-a2-gui-Em5TI6/code-oz-gui` unless noted.

| Command | Exit | Notes |
|---|---:|---|
| `pwd && git status --short --branch` | 0 | Branch confirmed: `finalize/v0.20.1-first-run-polish...origin/main`; other A-worker untracked files existed and were not touched. |
| `rsync -a --exclude node_modules --exclude .next --exclude test-results --exclude playwright-report code-oz-gui/ /private/tmp/code-oz-a2-gui-Em5TI6/code-oz-gui/` | 0 | Temp copy for install/build/test artifacts. |
| `bun install > /private/tmp/code-oz-a2-gui-Em5TI6/bun-install.log 2>&1` | 1 | Failed before install: `bun is unable to write files to tempdir: PermissionDenied`. |
| `env TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp bun install > /private/tmp/code-oz-a2-gui-Em5TI6/bun-install-tmpdir.log 2>&1` | 1 | Same tempdir permission failure. |
| `env HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home XDG_CACHE_HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home/.cache TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun install > /private/tmp/code-oz-a2-gui-Em5TI6/bun-install-isolated.log 2>&1` | 0 | Installed 1030 packages in 33.96s. No install warnings besides `.env` load. |
| `env HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home XDG_CACHE_HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home/.cache TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun run dev > /private/tmp/code-oz-a2-gui-Em5TI6/dev.log 2>&1` | n/a | Server printed `Ready in 1109ms`, then repeated `EMFILE` watcher errors and served `GET / 404`. Killed after audit. |
| `env HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home XDG_CACHE_HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home/.cache TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun run build > /private/tmp/code-oz-a2-gui-Em5TI6/build.log 2>&1` | 0 | Production build clean. Route table includes `/` and API routes. |
| `env HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home XDG_CACHE_HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home/.cache TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun test > /private/tmp/code-oz-a2-gui-Em5TI6/bun-test.log 2>&1` | 1 | `No tests found!` |
| `env HOME=/private/tmp/code-oz-a2-gui-Em5TI6/home ... bun run test:e2e > /private/tmp/code-oz-a2-gui-Em5TI6/e2e.log 2>&1` | 1 | Isolated HOME lacked Playwright browser cache. |
| `env TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun run test:e2e > /private/tmp/code-oz-a2-gui-Em5TI6/e2e-default-home.log 2>&1` | 1 | Chromium launch blocked in sandbox: MachPort permission denied. |
| Same e2e command outside sandbox, while default dev server was running | 1 | Browser launched, but `/` was Next 404. |
| `env TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun run start > /private/tmp/code-oz-a2-gui-Em5TI6/start.log 2>&1` | n/a | Production server ready in 253ms with `next start` standalone warning. Killed after e2e. |
| `curl -s -o /private/tmp/code-oz-a2-gui-Em5TI6/root.html -w '%{http_code}\n' http://localhost:3000/` | 0 | Returned `200` against production start. |
| `env TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun run test:e2e > /private/tmp/code-oz-a2-gui-Em5TI6/e2e-prodstart-escalated.log 2>&1` | 0 | Existing Playwright happy path passed: `1 passed (7.6s)`. |
| `mv /private/tmp/code-oz-a2-gui-Em5TI6/code-oz-gui/.env /private/tmp/code-oz-a2-gui-Em5TI6/code-oz-gui/.env.audit-key-present` | 0 | Removed the copied local key file from the temp app before no-key AIHelper check. |
| `env NEXT_TELEMETRY_DISABLED=1 TMPDIR=/private/tmp/code-oz-a2-gui-Em5TI6/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a2-gui-Em5TI6/bun-cache bun run start -- -p 3012 > /private/tmp/code-oz-a2-gui-Em5TI6/start-no-key-3012.log 2>&1` | n/a | No-key production server printed `Ready in 257ms`. Still listening on PID 94334; kill requests were rejected. |
| `curl -s -w '\nHTTP_STATUS:%{http_code}\n' -H 'Content-Type: application/json' -d '{"runId":"r-2026-05-12-checkout-safari","cardId":"audit","currentTab":"artifact","prompt":"Explain this"}' http://localhost:3012/api/helper/ask > /private/tmp/code-oz-a2-gui-Em5TI6/helper-no-key-response.txt` | 0 | Returned 503 with `Gemini helper is not configured.` |
| `printf '{"name":"a2-smoke"}\n' > /private/tmp/code-oz-a2-live-repo-brown-HJKa9n/package.json` | 0 | Added a minimal marker file in the temp repo so `code-oz init` should detect brownfield. |
| `curl -s -w '\nHTTP_STATUS:%{http_code}\n' -H 'Content-Type: application/json' -d '{"description":"Audit this temp package repo for first-run GUI smoke","repoPath":"/private/tmp/code-oz-a2-live-repo-brown-HJKa9n","providerOverride":"fake"}' http://localhost:3012/api/run/start > /private/tmp/code-oz-a2-gui-Em5TI6/live-start-brown-response.txt` | 0 | API returned 503, while a run directory and active.json were still written. |
| `./dist/code-oz --version` from repo root | 0 | Printed `0.16.0-alpha.0`; current `package.json` is `0.20.0-alpha.0`. |

## Checked coverage

- Checked: `bun install`, default `bun run dev`, production `bun run build`, production start, root render, Board columns, composer typing via e2e path, drawer open/close, Artifact/Events/Decisions tab switching, Events filters, AIHelper expand/collapse, no-key AIHelper API response, live fake-run start API.
- Partially checked: Artifact frontmatter rendering and Events filters passed through the existing e2e path; provider-family provenance/accents were checked by source inspection.
- Gaps: live Gemini response with a real `GEMINI_API_KEY` was not exercised to avoid spending external provider tokens; live SSE transition mirroring could not be validated because `/api/run/start` returned 503; axe/a11y is A9 scope and was not run here; default dev render could not be inspected after it served 404.

## Findings

### F2.1 - GUI live runs resolve a stale hardcoded CLI binary

- **Severity:** block-ship
- **Where:** `code-oz-gui/lib/code-oz-spawn.ts:73-118`, `/api/run/start`
- **Evidence:**
  ```text
  $ ./dist/code-oz --version
  0.16.0-alpha.0

  code-oz-gui/lib/code-oz-spawn.ts:
  73 const execFileAsync = promisify(execFile);
  74 const CODE_OZ_SOURCE_DIR = join(homedir(), 'Projects', 'code-oz');
  75 const CODE_OZ_DIST_BINARY = join(CODE_OZ_SOURCE_DIR, 'dist', 'code-oz');
  99 export async function resolveCodeOzBinary(): Promise<CodeOzBinaryResolution> {
 100   if (await pathExists(CODE_OZ_DIST_BINARY)) {
 101     return { kind: 'binary', command: CODE_OZ_DIST_BINARY, args: [] };
 102   }

  $ curl ... /api/run/start
  {"error":"spawn-failed","detail":"code-oz exited before a runId was detected (exit 1)."}
  HTTP_STATUS:503

  /private/tmp/code-oz-a2-live-repo-brown-HJKa9n/.code-oz/config.yaml:
  profile: brownfield

  /private/tmp/code-oz-a2-live-repo-brown-HJKa9n/.code-oz/state/runs/01KRHQGRFV24HHYJXRCH93WC5Y/events.jsonl:
  {"type":"run_started","runId":"01KRHQGRFV24HHYJXRCH93WC5Y","profile":"greenfield",...}
  ```
- **Why it matters for first-run UX:** A user can install and open the GUI successfully, then the first real `COMPOSE` run silently uses an old CLI from `~/Projects/code-oz/dist/code-oz` and fails before the GUI can register or mirror the run.
- **Proposed fix:** Resolve the CLI relative to the monorepo checkout first, or require an explicit `CODE_OZ_CLI` path in dev. Before accepting a binary, run `--version` and compare it to the repo package version; if it mismatches or is absent, fall back to `bun --cwd <repo-root> run src/cli.ts`. Add a failing e2e/API test with a deliberately stale fake binary ahead of source in the resolution order, then verify `/api/run/start` registers the current run.
- **Effort estimate:** m

### F2.2 - Live Approve/Revise actions write fixture requests, not run-specific requests

- **Severity:** block-ship
- **Where:** `code-oz-gui/app/api/run/[runId]/approve/route.ts:93-121`, `code-oz-gui/lib/run-store.ts:423-440`
- **Evidence:**
  ```text
  code-oz-gui/app/api/run/[runId]/approve/route.ts:
   93 export async function POST(request: Request, context: RouteContext) {
   95   const runIdError = assertFixtureRunId(runId);
  115   const requestId = await writeApprovalRequest({
  116     phase: body.phase,
  117     decision: body.action,
  118     revisionNotes: body.feedback,
  119   });

  code-oz-gui/lib/run-store.ts:
  423 export async function writeApprovalRequest(input: {
  428   await mkdir(FIXTURE_REQUESTS_DIR, { recursive: true });
  431   const requestPath = join(FIXTURE_REQUESTS_DIR, `${requestId}.json`);
  439   await writeFile(requestPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  ```
- **Why it matters for first-run UX:** On a live run, clicking Approve or Ask for revisions appears to work but cannot reach the active CLI run directory, so the run can stall at a gate while the GUI shows no obvious control failure.
- **Proposed fix:** Make approval requests run-scoped: look up `getRunRecord(runId)`, write under that run's request/control directory, and include `runId`, `phase`, `taskId`, action, and feedback in the request file. If the intended control path is `code-oz approve`, call that subprocess explicitly and surface stdout/stderr. Add a test that registers a live run record, posts approve/revise, and asserts the request lands under the live run directory rather than `fixtures/sample-run/requests`.
- **Effort estimate:** m

### F2.3 - Default `bun run dev` reached Ready but served the app as 404

- **Severity:** block-ship
- **Where:** `code-oz-gui/package.json:5-12`, default dev startup
- **Evidence:**
  ```text
  $ bun run dev
  $ next dev
     ▲ Next.js 15.5.18
     - Local:        http://localhost:3000
   ✓ Starting...
  Watchpack Error (watcher): Error: EMFILE: too many open files, watch
  Watchpack Error (watcher): Error: EMFILE: too many open files, watch
   ✓ Ready in 1109ms
  ...
  ○ Compiling /_not-found ...
   ✓ Compiled /_not-found in 2.7s (605 modules)
  GET / 404 in 3062ms

  $ bun run test:e2e
  Error: expect(locator).toBeVisible() failed
  Locator: getByText('Workspace: ./fixtures/sample-run')
  Page snapshot:
  - heading "404"
  - heading "This page could not be found."
  ```
- **Why it matters for first-run UX:** The documented first run is `bun install && bun run dev`; printing a clean URL and then rendering a 404 is a hard stop for a new user.
- **Proposed fix:** Make the dev command resilient to watcher exhaustion. Options: set a dev-safe watcher mode by default, document and enforce `DISABLE_HMR=true` if that is the intended AI Studio path, or reduce watcher pressure in Next config. Add Playwright `webServer` coverage that starts `bun run dev` from a clean temp checkout and asserts `/` renders before tests begin.
- **Effort estimate:** s

### F2.4 - AIHelper no-key UX omits the setup hint and logs a server stack

- **Severity:** fix-soon
- **Where:** `code-oz-gui/app/api/helper/ask/route.ts:149-154`, `code-oz-gui/lib/gemini-server.ts:7-12`
- **Evidence:**
  ```text
  $ curl ... /api/helper/ask
  {"error":"helper-unavailable","detail":"Gemini helper is not configured."}
  HTTP_STATUS:503

  Server log:
  AI helper request failed Error: GEMINI_API_KEY is not set.
      at <unknown> (.next/server/app/api/helper/ask/route.js:17:52420)
  ```
- **Why it matters for first-run UX:** The A2 contract asks for a one-line `set GEMINI_API_KEY to enable` hint; the current copy hides the exact env var from the UI and prints a stack for an expected configuration state.
- **Proposed fix:** Treat missing `GEMINI_API_KEY` as a typed expected state. Return `detail: "Set GEMINI_API_KEY to enable the Gemini helper."` and avoid `console.error` for that case. Add an API test for no-key and a UI test that opens the helper, sends a prompt, and sees the exact hint.
- **Effort estimate:** xs

### F2.5 - Playwright e2e is not self-starting and can hit the wrong server

- **Severity:** fix-soon
- **Where:** `code-oz-gui/playwright.config.ts:3-18`
- **Evidence:**
  ```text
  code-oz-gui/playwright.config.ts:
   3 export default defineConfig({
  10   use: {
  11     baseURL: 'http://localhost:3000',
  17   projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  18 });

  $ bun run test:e2e
  1 failed
  Page snapshot:
  - heading "404"
  - heading "This page could not be found."

  $ bun run test:e2e  # against production start
  1 passed (7.6s)
  ```
- **Why it matters for first-run UX:** A verification gate that depends on a pre-existing server can pass or fail based on whatever is already bound to port 3000, so it is weak evidence for the GUI first-run path.
- **Proposed fix:** Add `webServer` to the Playwright config using the intended command, URL, timeout, and `reuseExistingServer: false` in CI. If dev remains flaky, add a separate production-start e2e command and keep the first-run dev e2e as the release gate.
- **Effort estimate:** s

### F2.6 - Drawer provenance and event accents do not show provider family

- **Severity:** fix-soon
- **Where:** `code-oz-gui/components/ArtifactView.tsx:79-106`, `code-oz-gui/components/ArtifactView.tsx:354-360`, `code-oz-gui/components/EventsView.tsx:121-130`, `code-oz-gui/components/EventsView.tsx:237-243`
- **Evidence:**
  ```text
  Artifact provenance shape:
   79 function findProvenance(input: {
   85   if (input.cardKind === 'audit') {
   88     return event && sha ? { artifactName: input.artifactName, sha, ts: event.ts } : null;

  Rendered chip:
  359 {provenance.artifactName} · sha: {shortSha(provenance.sha)}

  Event row coloring:
  121 function severityFor(eventType: string): Severity {
  126   if (eventType === 'intervention' || eventType === 'budget_warning') {
  239 className={cn(
  241   severity === 'warn' && 'border-l-2 border-l-amber-400/60 ...',
  242   severity === 'fail' && 'border-l-2 border-l-red-400/60 ...',
  ```
- **Why it matters for first-run UX:** The GUI's cross-family thesis is supposed to be visible in the first drawer interaction; the current artifact chip shows SHA only, and events color by severity rather than provider family.
- **Proposed fix:** Derive provider family from the relevant completion/invocation events and include it in the provenance chip, for example `Claude family · AUDIT.md · sha`. Add a provider-family color map for event rows while preserving warning/failure emphasis. Cover with a fixture assertion for audit, review, and task cards.
- **Effort estimate:** s

### F2.7 - Fixture/demo does not render all five decision row kinds

- **Severity:** fix-soon
- **Where:** `code-oz-gui/fixtures/sample-run/events.jsonl:13-52`, `code-oz-gui/components/DecisionsView.tsx`
- **Evidence:**
  ```text
  $ rg 'question_added|gate_required|review_round_completed|budget_warning|debate_resolved' code-oz-gui/fixtures/sample-run/events.jsonl
  13: question_added
  17: gate_required
  25: gate_required
  41: review_round_completed
  52: budget_warning

  No `debate_resolved` event exists in the fixture.
  The fixture `budget_warning` has no phase or taskId, while DecisionsView matches budget rows by taskId or phase.
  ```
- **Why it matters for first-run UX:** The Decisions tab claims five row kinds, but the first-run sample cannot demonstrate all five, and at least the unscoped budget warning is unlikely to render on any card.
- **Proposed fix:** Add fixture events for `debate_resolved` and a phase-scoped or task-scoped `budget_warning`, or teach `DecisionsView` to show run-scope budget warnings in the active phase/sidebar. Extend the e2e test to assert all five labels are visible across cards.
- **Effort estimate:** s

### F2.8 - `bun test` has no GUI tests

- **Severity:** nit
- **Where:** `code-oz-gui/package.json:5-13`
- **Evidence:**
  ```text
  $ bun test
  bun test v1.3.9 (cf6cdbbb)
  No tests found!
  Tests need ".test", "_test_", ".spec" or "_spec_" in the filename

  package.json scripts include `test:e2e` but no `test`.
  ```
- **Why it matters for first-run UX:** The distribution playbook names `cd code-oz-gui && bun test` as a GUI gate; today that command fails because no unit/component tests exist.
- **Proposed fix:** Either add a `test` script that delegates to the intended GUI gate, or add focused component/API tests for `run-store`, `code-oz-spawn` resolution, AIHelper no-key handling, and Decisions row projection.
- **Effort estimate:** xs
