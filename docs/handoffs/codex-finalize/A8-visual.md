# A8-visual findings

Sub-task: A8
Operator: codex-subtask-8
Started: 2026-05-13T22:19:00Z
Finished: 2026-05-13T22:33:30Z

## Summary

I found 3 findings: 1 block-ship and 2 fix-soon. The biggest risk is that the documented first-run GUI surface does not render under `bun run dev` in the current checkout: the dev server starts, but `/` returns the Next.js 404 page, so the README screenshots cannot be layout-faithful to the current GUI until that route is fixed. I did not reshoot screenshots. Screenshot files exist and are tracked, but live pixel comparison was blocked by the 404 render.

## Screenshot reference inventory

- `README.md` references remote badges only. No GUI screenshot paths.
- `docs/ABOUT.md` has no image references.
- `code-oz-gui/README.md:6` references `code-oz-gui/docs/screenshots/hero.png`.
- `code-oz-gui/README.md:27` references `code-oz-gui/docs/screenshots/hero.png`.
- `code-oz-gui/README.md:28` references `code-oz-gui/docs/screenshots/decisions-task.png`.
- `code-oz-gui/README.md:35` references `code-oz-gui/docs/screenshots/events-errors.png`.
- `code-oz-gui/README.md:36` references `code-oz-gui/docs/screenshots/workspace-form.png`.
- All four referenced PNG files exist and are tracked under `code-oz-gui/docs/screenshots/`.
- No root-level `docs/screenshots/` directory exists in this checkout.

## Findings

### F8.1 - GUI first screen renders Next.js 404 instead of the documented board

- **Severity:** block-ship
- **Where:** `code-oz-gui` dev server and current render at `http://localhost:3000/`
- **Evidence:**
  ```text
  command: cd code-oz-gui && bun run dev
  exit status: 0 after the dev server exited
  relevant output:
  Warning: Next.js inferred your workspace root, but it may not be correct.
  We detected multiple lockfiles and selected the directory of /Users/ozzy-mac/Projects/code-oz/bun.lock as the root directory.
  Watchpack Error (watcher): Error: EMFILE: too many open files, watch
  Ready in 1095ms
  GET / 404 in 2045ms

  command: cd code-oz-gui && env DISABLE_HMR=true bun run dev
  exit status: 0 after Ctrl-C
  relevant output:
  Warning: Next.js inferred your workspace root, but it may not be correct.
  Watchpack Error (watcher): Error: EMFILE: too many open files, watch
  Ready in 965ms
  GET / 404 in 1140ms
  GET / 404 in 33ms
  GET / 404 in 34ms

  command: curl -s -S -D - http://localhost:3000/ -o /dev/null
  exit status: 0
  relevant output:
  HTTP/1.1 404 Not Found

  Playwright MCP render snapshot at 1440x900:
  Page URL: http://localhost:3000/
  Page Title: code OZ
  Console: 1 errors, 0 warnings
  Snapshot:
  heading "404"
  heading "This page could not be found."
  ```
- **Why it matters for first-run UX:** The README sells a ready Kanban board and drawer, but a first-run user opening the documented dev URL gets a framework 404 instead.
- **Proposed fix:** First make `cd code-oz-gui && bun run dev` render `/` with the board. Treat the root warning and the missing route registration as the primary repro, and do not paper over it by changing screenshot docs. Add a tiny smoke check that starts the GUI and fails unless `curl -f http://localhost:3000/` returns 200 and Playwright sees `UNDERSTAND`, `Composer`, and at least one fixture card. Then address the watcher issue separately: the existing `DISABLE_HMR` path in `code-oz-gui/next.config.ts:24-31` did not prevent `EMFILE`, so verify the fix under that mode too.
- **Effort estimate:** m

### F8.2 - Hero alt text can claim a Gemini answer even when the capture script allows an error-state hero

- **Severity:** fix-soon
- **Where:** `code-oz-gui/README.md:6`, `code-oz-gui/README.md:31`, `code-oz-gui/scripts/capture-screenshots.ts:91-108`
- **Evidence:**
  ```text
  code-oz-gui/README.md:6:
  alt="code-oz-gui hero ... and a Gemini Flash answer explaining the audit to a non-developer"

  code-oz-gui/README.md:31:
  Board + Artifact tab + AI helper explaining the audit

  code-oz-gui/scripts/capture-screenshots.ts:99-107:
  waits for either /Approving|checkout/i or
  /Gemini helper is not configured|helper is unavailable|Helper unavailable/i,
  then saves hero.png either way.
  ```
- **Why it matters for first-run UX:** If `hero.png` was captured without a valid `GEMINI_API_KEY`, the image can show a helper error while the alt text and caption say it shows an explanatory answer.
- **Proposed fix:** Make the hero screenshot deterministic. Either seed the helper route with a fixture answer for screenshot capture, or fail the screenshot task before writing `hero.png` when the helper is unavailable. If the intended documented state is "helper not configured", change the alt text and caption to say that plainly. Reuse the existing screenshot names after the fix, but reshoot only in the later image-refresh phase.
- **Effort estimate:** s

### F8.3 - Card and drawer typography still hard-truncates title, subtitle, and status text

- **Severity:** fix-soon
- **Where:** `code-oz-gui/components/Card.tsx:78-83`, `code-oz-gui/components/Drawer.tsx:147-150`, `.remember/today-2026-05-13.md:1-2`
- **Evidence:**
  ```text
  code-oz-gui/components/Card.tsx:78:
  <h3 className="line-clamp-2 ...">{card.title}</h3>

  code-oz-gui/components/Card.tsx:79-80:
  <p className="... truncate ...">{card.subtitle}</p>
  <p className="... truncate ...">{stateDescriptor(card.state)}</p>

  code-oz-gui/components/Card.tsx:83:
  <span className="... max-w-full truncate ...">{stateDescriptor(card.state)}</span>

  code-oz-gui/components/Drawer.tsx:150:
  <p className="mt-2 truncate ...">{card.subtitle}</p>

  .remember/today-2026-05-13.md:1-2:
  prior visual review already called out title truncation, pill/status wrap, and subtitle issues.
  ```
- **Why it matters for first-run UX:** The A8 checklist explicitly asks for no title truncation, no pill wrap, no status wrap, and no subtitle drift; the source still encodes truncation for the exact text classes a user reads first.
- **Proposed fix:** Replace the hard truncation rules with stable wrapping rules. Suggested shape: allow card titles to wrap to the designed height with `break-words` and an explicit min-height, let subtitles/status wrap or clamp only with a visible `title` tooltip, and make the drawer subtitle wrap within the 520px drawer instead of truncating. Add a Playwright layout assertion for 1440x900 and 1280x800 that checks header, pill, status, and subtitle elements have `scrollWidth <= clientWidth` and no overlapped bounding boxes.
- **Effort estimate:** m

## Checked items and gaps

- Checked screenshot references in `README.md`, `docs/ABOUT.md`, and `code-oz-gui/README.md`.
- Checked that all referenced PNG files exist and are tracked.
- Checked current GUI render as far as feasible. It is blocked by F8.1.
- Checked dark/light parity. The design brief says dark only, and `code-oz-gui/app/layout.tsx:26` forces the `dark` class, so light-mode parity is not supported in this version.
- Did not reshoot images, per phase constraint.
- Did not perform pixel comparison against live board/drawer states because `/` rendered a Next.js 404.
- Did not audit root `docs/screenshots/` contents because that directory does not exist.

## Commands run

```text
rg -n "finalize/v0\\.20\\.1|codex-finalize|visual|screenshot|GUI|README|ABOUT" /Users/ozzy-mac/.codex/memories/MEMORY.md
exit status: 0

pwd && git status --short --branch
exit status: 0

sed -n '1,220p' /Users/ozzy-mac/.agents/skills/code-review/SKILL.md
exit status: 0

sed -n '1,260p' docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit status: 0

sed -n '1,260p' CLAUDE.md
exit status: 0

sed -n '1,260p' README.md
exit status: 0

sed -n '1,260p' docs/ABOUT.md
exit status: 0

sed -n '1,260p' code-oz-gui/README.md
exit status: 0

rg -n "Finding template|severity|block-ship|fix-soon|nit|## Finding|### Finding" docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit status: 0

find code-oz-gui -maxdepth 3 -type f | sort | sed -n '1,220p'
exit status: 0

find docs -path '*screenshots*' -o -path '*screenshot*' -maxdepth 4 -type f | sort
exit status: 0

rg -n "<img|!\\[|docs/screenshots|screenshots/|\\.png|\\.jpg|\\.webp|alt=|hero.png|decisions-task|events-errors|workspace-form" README.md docs/ABOUT.md code-oz-gui/README.md docs code-oz-gui --glob '!node_modules/**' --glob '!**/.next/**'
exit status: 0

sed -n '332,380p' docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit status: 0

file code-oz-gui/docs/screenshots/hero.png code-oz-gui/docs/screenshots/decisions-task.png code-oz-gui/docs/screenshots/events-errors.png code-oz-gui/docs/screenshots/workspace-form.png
exit status: 0

ls -lh code-oz-gui/docs/screenshots
exit status: 0

sed -n '1,220p' code-oz-gui/package.json
exit status: 0

sed -n '1,260p' code-oz-gui/app/globals.css
exit status: 0

sed -n '1,260p' code-oz-gui/app/page.tsx
exit status: 0

sed -n '1,260p' code-oz-gui/components/Board.tsx
exit status: 0

sed -n '1,260p' code-oz-gui/components/TopBar.tsx
exit status: 0

sed -n '1,260p' code-oz-gui/components/PhaseColumn.tsx
exit status: 0

sed -n '1,260p' code-oz-gui/components/Card.tsx
exit status: 0

sed -n '260,560p' code-oz-gui/app/page.tsx
exit status: 0

sed -n '1,300p' code-oz-gui/components/Composer.tsx
exit status: 0

sed -n '1,340p' code-oz-gui/components/Drawer.tsx
exit status: 0

sed -n '1,320p' code-oz-gui/components/ArtifactView.tsx
exit status: 0

sed -n '1,340p' code-oz-gui/components/EventsView.tsx
exit status: 0

sed -n '320,680p' code-oz-gui/components/ArtifactView.tsx
exit status: 0

sed -n '1,380p' code-oz-gui/components/DecisionsView.tsx
exit status: 0

sed -n '1,360p' code-oz-gui/components/AIHelper.tsx
exit status: 0

sed -n '1,300p' code-oz-gui/components/Sidebar.tsx
exit status: 0

sed -n '1,220p' code-oz-gui/components/Footer.tsx
exit status: 0

sed -n '1,240p' code-oz-gui/scripts/capture-screenshots.ts
exit status: 0

rg -n "title|subtitle|status|pill|tracking|truncate|line-clamp|whitespace-nowrap|Demo mode|code OZ|Cost-free demo|Real providers|Compose|Workspace|Ask|Events|Decisions|Artifact|UNDERSTAND|Natural-language" code-oz-gui/app code-oz-gui/components code-oz-gui/lib --glob '!node_modules/**'
exit status: 0

git log --oneline -- code-oz-gui/docs/screenshots code-oz-gui/README.md | sed -n '1,30p'
exit status: 0

git status --short code-oz-gui/docs/screenshots code-oz-gui/README.md code-oz-gui/app code-oz-gui/components code-oz-gui/scripts/capture-screenshots.ts
exit status: 0

lsof -iTCP:3000 -sTCP:LISTEN -n -P
exit status: 0 first run, exit status 1 after server stopped

rg -n "background-color|bg-\\[#050505\\]|bg-\\[#101010\\]|dark|theme|prefers-color-scheme|light|text-white|color-scheme" code-oz-gui/app code-oz-gui/components code-oz-gui/README.md code-oz-gui/docs/CLAUDE_DESIGN_BRIEF.md --glob '!node_modules/**'
exit status: 0

rg -n "screenshot|hero|decisions-task|events-errors|workspace-form|alt=|How it looks|section nav|Gemini Flash answer|Helper unavailable|Gemini helper is not configured" code-oz-gui/README.md code-oz-gui/scripts/capture-screenshots.ts code-oz-gui/docs/CLAUDE_DESIGN_BRIEF.md code-oz-gui/app code-oz-gui/components --glob '!node_modules/**'
exit status: 0

sed -n '1,80p' code-oz-gui/app/layout.tsx
exit status: 0

node -e "const { chromium } = require('./code-oz-gui/node_modules/@playwright/test'); (async()=>{ const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1440,height:900}}); const errors=[]; page.on('console',msg=>{ if(['error','warning'].includes(msg.type())) errors.push(msg.type()+': '+msg.text()); }); await page.goto('http://localhost:3000',{waitUntil:'networkidle',timeout:15000}); console.log('title='+await page.title()); console.log('columns='+await page.locator('section header h2').evaluateAll(nodes=>nodes.map(n=>n.textContent).join('|'))); console.log('console='+JSON.stringify(errors)); await browser.close(); })().catch(e=>{ console.error(e.stack||e); process.exit(1); });"
exit status: 1 in sandbox, blocked by Chromium MachPort permission

same node -e command with escalation
exit status: 1, net::ERR_CONNECTION_REFUSED because the prior server was gone

bun run dev
exit status: 0 after dev server exited

Playwright MCP browser_resize 1440x900
exit status: n/a

Playwright MCP browser_navigate http://localhost:3000
exit status: n/a, page rendered 404

Playwright MCP browser_snapshot with boxes
exit status: n/a, snapshot showed only the Next.js 404 headings

sed -n '1,200p' code-oz-gui/next.config.ts
exit status: 0

curl -s http://localhost:3000/ | sed -n '1,40p'
exit status: 0, but pipeline hid connection state

find . -maxdepth 2 -type d -name app -o -name pages | sort
exit status: 0

env DISABLE_HMR=true bun run dev
exit status: 0 after Ctrl-C

curl -s -S -D - http://localhost:3000/ -o /dev/null
exit status: 0, HTTP 404

curl -s -S http://localhost:3000/ | rg -n "404|This page|__next|code OZ|Composer|UNDERSTAND"
exit status: 0

find code-oz-gui/app -maxdepth 3 -type f -print | sort
exit status: 0

find code-oz-gui/app -maxdepth 1 -type f -print -exec ls -l {} \\;
exit status: 0

sed -n '1,80p' .playwright-mcp/console-2026-05-13T22-30-39-694Z.log
exit status: 0

sed -n '1,80p' .playwright-mcp/console-2026-05-13T22-29-52-090Z.log
exit status: 0

rg -n "step-4|visual review|title truncation|pill wrap|status wrap|subtitle drift|AI Studio|screenshot|wrap|trunc" .remember/today-2026-05-13.md .remember/today-2026-05-13.done.md
exit status: 0

sed -n '1,220p' .remember/today-2026-05-13.md
exit status: 0

sed -n '1,260p' .remember/today-2026-05-13.done.md
exit status: 0

nl -ba code-oz-gui/README.md | sed -n '1,45p'
exit status: 0

nl -ba code-oz-gui/components/Card.tsx | sed -n '60,90p'
exit status: 0

nl -ba code-oz-gui/components/Drawer.tsx | sed -n '140,155p'
exit status: 0

nl -ba code-oz-gui/scripts/capture-screenshots.ts | sed -n '88,110p'
exit status: 0

nl -ba code-oz-gui/next.config.ts | sed -n '1,32p'
exit status: 0

nl -ba .remember/today-2026-05-13.md | sed -n '1,12p'
exit status: 0

rg -n "<img|!\\[|docs/screenshots|screenshots/|\\.png|\\.jpg|\\.webp|alt=" README.md docs/ABOUT.md code-oz-gui/README.md
exit status: 0

file code-oz-gui/docs/screenshots/*.png
exit status: 0

git ls-files code-oz-gui/docs/screenshots && find code-oz-gui/docs/screenshots -maxdepth 1 -type f -print | sort
exit status: 0

rg -n "prefers-color-scheme|dark|light|theme|color-scheme" code-oz-gui/app code-oz-gui/components code-oz-gui/docs/CLAUDE_DESIGN_BRIEF.md --glob '!node_modules/**'
exit status: 0

date -u +%Y-%m-%dT%H:%M:%SZ
exit status: 0
```
