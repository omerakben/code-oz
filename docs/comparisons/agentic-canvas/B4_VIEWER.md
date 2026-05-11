# B4 — Read-only `code-oz view <runId>` browser viewer (borrow from agentic-canvas)

## Status

Backlog. Target v0.3+, **depends on B2 (`RunSummary` derived read-model) being shipped first** (B4 is a B2 consumer, not a co-shipped pair — INDEX.md milestone ordering). Step 1 is concrete (the read-only viewer); step 2 (canvas-as-frontend integration) is a hypothesis tracked separately in `docs/comparisons/agentic-canvas/CANVAS_FRONTEND_HYPOTHESIS.md`. The hypothesis does not enter the implementing milestone; it is named here only to keep the boundary explicit.

## Source pattern

agentic-canvas pins a local browser surface as the human inspection layer. `canvasctl.mjs open <workflow.json>` boots a Node HTTP server on `127.0.0.1` (`~/Projects/agents/templates/agentic-canvas/scripts/canvasctl.mjs` `commandOpen`), and `canvas.html` (`~/Projects/agents/templates/agentic-canvas/canvas.html`) renders the DAG using vendored Drawflow + Dagre + ELK assets. Save / claim / review pass through `/api/*` endpoints — the canvas is read-write today, which is the part code-oz must NOT borrow.

The borrow is shape-only: a single workflow file becomes a single `RunSummary`; the DAG canvas becomes a phase-graph view; vendored vanilla JS becomes embedded binary assets. Save / claim / review endpoints stay out of scope for v0.3+.

## What ships in step 1 (concrete)

The minimum surface that earns a milestone slot under Rule 20:

- `code-oz view <runId>` subcommand boots a local HTTP server. `runId` is positional and required. No alternate "all runs" mode in step 1.
- 127.0.0.1-only bind. Port is configurable via `--port <n>`; default port reads from `viewer.defaultPort` in `.code-oz/config.yaml`. The bind address is **not** configurable (compile-time constant `127.0.0.1`).
- Renders the phase graph from B2's `RunSummary`. The viewer never re-derives state from `events.jsonl` directly — `RunSummary` is the single source of truth for the rendered shape.
- Shows current phase (`DEFINE` / `PLAN` / `BUILD` / `VERIFY` / `REVIEW` / `SHIP` or brownfield `AUDIT`), gate-passed badges per phase (read from `state/GATE_<PHASE>_PASSED.json` exists / does-not-exist via `RunSummary`), and the last 50 events from `events.jsonl` as a scrolling timeline.
- Auto-refresh on tail. **Step 1 ships polling only:** the client polls `GET /api/events?since=<seq>&limit=<n>` on a fixed interval (default 2 s). SSE is deferred to step 1.5 (see Cost estimate § "Step 1 vs step 1.5"). Either way, the underlying read pattern is `events.jsonl` tail with a sequence cursor.
- Read-only HTTP surface. `GET` is the only allowed method. The server actively rejects `POST` / `PUT` / `PATCH` / `DELETE` / `OPTIONS` (with the exception of CORS preflight if needed for a future trusted local origin) with `405 Method Not Allowed`.
- Embedded static assets in the binary. `index.html`, JS, and CSS are bundled at compile time via `bun build --compile`'s asset embedding. No `npm install` at runtime, no separate `node_modules`, no on-disk asset drop.
- Idle timeout. The server exits cleanly on `SIGINT` / `SIGTERM`, after a configurable idle window (default 600 seconds) with no `GET` requests from the client, or on receiving a `GET /api/shutdown` from `127.0.0.1` only.
- Single-run scope. Step 1 renders exactly one run at a time. No multi-run dashboard; no run-switching UI; no remembered prior runs. Re-launching with a different `runId` is the user-facing way to switch.
- Viewer taxonomy mapping (read-only labels). The 11 control-flow node types from agentic-canvas (`start`, `end`, `branch`, `merge`, `loop`, `parallel`, `trycatch`, `wait`, `subflow`, `generic`, `human`) become **display labels** for existing code-oz state shapes. See § "Architecture sketch" for the mapping. Labels are presentation only; they do not change runtime behavior.
- Secret redaction on the wire. The `RunSummary` and event payloads served by the viewer pass through the existing `.code-ozignore` redaction pipeline before serialization, identical to the redaction the agent file-manifest pipeline runs today.
- Process isolation. The viewer process never holds writable file descriptors for `events.jsonl`, gate files, or any artifact under `.code-oz/`. All reads are fresh-open / close per request, with a sequence cursor maintained in process memory only.

## What does NOT ship in step 1

Explicit non-goals — the viewer earns a small surface area precisely by refusing scope creep:

- No save endpoint. The viewer never writes `RunSummary`, gate files, events, or any artifact.
- No claim or review endpoint. Reviewers continue to use the file-based REVIEW gate per Rule 1; the viewer is for inspection, not gate participation.
- No edit endpoint. The plan, the spec, and per-task patches stay file-based and orchestrator-authoritative.
- No agent invocation. The viewer cannot spawn a provider call, request a debate, or trigger a phase transition.
- No multi-run dashboard. Single-run only. A future "run picker" surface is step 1.5 or later, gated on observed friction.
- No remote access. `127.0.0.1` is the trust boundary. No `0.0.0.0`, no `--host` flag, no LAN exposure, no reverse-proxy configuration shipped.
- No authentication. Locality is the trust boundary. Optional per-launch URL token (jupyter-style) is an open question; until resolved, no auth is shipped.
- No persistence. The viewer is stateless beyond what the binary already persists. Closing the viewer leaves no new files on disk.
- No DAG editor. The 11 node-type labels are display vocabulary; the viewer does not let users add, remove, rewire, or reorder nodes.
- No write-mode flag. There is no `--write` or `--repair` mode that turns on edit endpoints. The read-only constraint is compile-time, not runtime.
- No telemetry beacon. The viewer does not POST to any external service. All traffic stays on the loopback interface.
- No service-worker / PWA / offline cache layer. Nothing in the viewer registers for installation, push notifications, or background sync.

## Architecture sketch

The implementation is intentionally narrow:

- **New CLI subcommand:** `src/cli/commands/view.ts`, dispatched from `src/cli.ts` next to `init` / `run` / `approve` / `doctor`. Mirrors the existing flag-parsing convention of those commands (single-purpose argv parser; help via `code-oz view --help`).
- **Embedded HTTP server:** Bun's built-in `Bun.serve` (or `serve`) primitive. No Express, no Fastify, no h3 — the same decision Rule 8 already locks for the binary.
- **Static assets:** embedded at compile time via the existing `bun build --compile` pipeline. Asset registration lives in a small `src/cli/viewer/assets.ts` module that maps `/static/<name>` to the embedded byte buffer. No `bun install` step at runtime.
- **API surface (GET only):**
  - `GET /` → `index.html` (embedded)
  - `GET /static/<name>` → embedded JS / CSS / font bundle
  - `GET /api/run-summary` → `RunSummary` JSON for the `runId` the server was launched with (cached with a short TTL or invalidated on event-tail tick)
  - `GET /api/events?since=<seq>&limit=<n>` → up to N events from `events.jsonl` after the sequence cursor (default `n = 50`, capped at 200)
  - `GET /api/shutdown` → graceful exit (loopback-only, no token required because the bind is loopback)
  - **Step 1.5 (deferred follow-up milestone), not shipped in step 1:** `GET /api/events/stream?since=<seq>` → SSE stream of events as they land. The polling endpoint above is the step-1 alternative.
- **Frontend:** vanilla JS + minimal CSS. No React / Vue / Svelte. No bundler at viewer-runtime; the binary does the embedding so end users see no `node_modules`. The agentic-canvas no-build philosophy is borrowed *for the viewer surface only* — the rest of code-oz remains strict TypeScript with full test discipline.
- **Phase graph layout:** the six greenfield phases (`DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP`) and the brownfield `AUDIT` start are a fixed left-to-right layout. No general DAG layout engine; no Dagre / ELK dependency. The phase graph is a known shape, not a freeform DAG.
- **Viewer taxonomy mapping (read-only labels):**
  - `start` → DEFINE node (greenfield) or AUDIT node (brownfield)
  - `end` → SHIP node (terminal)
  - `parallel` → a worktree-isolated builder candidate set, when M-future ships parallel candidates. Until then, this label is dormant. (See `MEMORY.md` Rule 21 — the label exists in the viewer vocabulary even when the runtime feature is deferred.)
  - `wait` → any phase paused on a debate, a reviewer panel awaiting a synthesizer verdict, or a `NEEDS_INTERVENTION.json` waiting on operator action
  - `subflow` → a sub-orchestration step inside a phase (e.g., the per-task BUILD/VERIFY/REVIEW cycle inside a multi-task PLAN). Display only.
  - `human` → any phase carrying an outstanding `OPEN_QUESTIONS.md` row addressed to the operator (Rule 15)
  - `branch` / `merge` / `loop` / `trycatch` / `generic` → reserved labels. Documented in the viewer legend; not yet bound to runtime states. They enter the viewer vocabulary so future taxonomy work does not need a contract change.
- **Evidence-kind rendering (B1 consumption):** the viewer renders `EvidenceClaim` (B1) entries from VERIFY/REVIEW sidecars with one render strategy per kind. The mapping is presentation-only; the discriminator field stays `kind` (B1 contract).
  - `command` → collapsed code block; expand reveals `command`, `cwd`, `exitCode`, `durationMs`. `stdoutLogPath`/`stderrLogPath` render as `file://` links (click-to-open, server never serves the file).
  - `file_diff` → **step 1:** header-only badge with added/removed line counts; the full patch is not loaded into the viewer. The user clicks through to the file via the `file://` link (browser opens the worktree file directly). **Step 1.5 (deferred):** lazy full-patch panel on expand, fetched from the worktree path and redacted via the `.code-ozignore` pipeline.
  - `test_result` → green/red badge on the row; expand reveals failed-test list and total counts.
  - `lint_result` → yellow/green icon; expand reveals violation count and the highest-severity rule.
  - `url` → external link with the URL host as the visible label; never auto-fetched.
  - `human_note` → blockquote with author + timestamp; rendered as Markdown using a sandboxed renderer (no script execution).
  - `mutation_gate` → checkpoint glyph; expand reveals mutation score + threshold.
  Reserved kinds added in future B1 minor versions render as a generic "kind: <name>" stub with a `payload` JSON pretty-print; the viewer never errors on an unknown kind, it degrades gracefully. This degrade-to-stub behavior is a load-bearing test (the viewer must not crash on a `RunSummary` produced by a slightly-newer binary).
- **Event projection:** the timeline panel renders events with the same kind taxonomy as `events.jsonl` (no new event kinds; no derived synthetic events). Each event row links to a forensics path when one exists, but the link opens via `file://` in the browser only on explicit click — the server itself never serves arbitrary file paths.

## Security boundaries (load-bearing)

The viewer is one of the rare code-oz surfaces that exposes process state over HTTP. The boundary discipline is non-negotiable:

- **Bind 127.0.0.1 ONLY.** The bind address is a compile-time constant in `src/cli/viewer/server.ts`. There is no flag, environment variable, or config knob that flips it to `0.0.0.0` or a routable address. A future LAN-mode surface, if ever needed, would be a separate feature gated by its own milestone and authority review.
- **Read-only HTTP methods.** The server's request dispatcher enforces a `GET`-only allowlist. Any other method returns `405`. There is no write endpoint to forget about; the dispatcher is structurally read-only.
- **No file writes from the server.** The viewer process opens `events.jsonl`, gate files, and `RunSummary` reads with read-only file descriptors. The capability is enforced by the file-system call sites, not by convention.
- **Secret redaction before serialization.** `RunSummary` and event payloads pass through the existing `.code-ozignore` redaction pipeline before the response body is composed. The redaction runs in-process; the viewer does not import a separate redactor.
- **Gate immutability through the viewer.** Phase transitions remain file-based per Rule 1. The viewer cannot write `GATE_<PHASE>_PASSED.json`, cannot delete a gate file, and cannot synthesize one. Operators who want to advance a phase use the existing CLI subcommands.
- **Process boundary on `runId`.** The viewer is launched with one `runId` and only ever serves that `runId`. There is no `?runId=other` parameter on the API endpoints. A second run requires a second viewer process on a second port.
- **Loopback-only shutdown.** `GET /api/shutdown` only accepts the request when the remote address is loopback. The check runs in-process before the handler.
- **No CORS for cross-origin.** The server does not set permissive CORS headers. The only origin that talks to the API is the embedded `index.html` served from the same loopback bind.
- **Open question — Unix domain socket.** Binding to a Unix domain socket (instead of TCP loopback) tightens the trust boundary further (file-system permissions instead of network ACLs). Costs cross-platform support: Bun's UDS support and Windows compatibility need verification. Tracked as open question 4.
- **Browser http:// -> file:// navigation is blocked.** Modern browsers refuse to navigate from an http:// origin to a file:// URL even on explicit click; the file:// link strategy in § "Evidence-kind rendering" cannot land as-is. B4 implementation must replace plain file:// anchors with a click handler that either (a) calls a loopback-only `/api/reveal?path=<repo-relative>` endpoint that returns the path text for clipboard, (b) emits an OS `open` via a custom protocol handler (defer; requires per-platform install), or (c) renders the absolute path and a "copy to clipboard" affordance. Option (c) is the v0.1 default — it preserves "server never serves the file" while accepting the browser constraint. Open question 5.

## Cost estimate

Sub-surfaces touched (counted per the Rule 20 sharper-application discipline from `MEMORY.md`):

1. `src/cli/commands/view.ts` — new subcommand + flag parsing
2. `src/cli/viewer/server.ts` — embedded HTTP server, request dispatcher, read-only enforcement
3. `src/cli/viewer/assets.ts` — embedded asset registration
4. `src/cli/viewer/static/` — vanilla JS + CSS + `index.html` source files (compiled into the binary)
5. `src/cli/viewer/taxonomy.ts` — viewer-label mapping from `RunSummary` + event shapes to the 11 node-type labels
6. `src/cli/viewer/redact.ts` — thin wrapper that calls the existing `.code-ozignore` redactor before the response is composed
7. `docs/contracts/VIEWER.md` — new canonical contract for the viewer surface (one page; security boundaries + GET-only API + taxonomy mapping)
8. `.code-oz/config.yaml` schema addition — `viewer.defaultPort`, `viewer.idleTimeoutSeconds`

Eight sub-surfaces; one new authority domain (read-only inspection HTTP surface). The borderline-Rule-20 argument: all eight sub-surfaces are read-only and gate-neutral, so the authority count is one even if the file count is eight. **Codex round 2 pressure-test:** that argument is *not* a free pass — read-only does not erase sub-surface count. To stay honest, B4 step 1 ships a deliberately *minimal* viewer; richer features defer to a B4 follow-up sub-step (see "Step 1 vs step 1.5" below).

**Step 1 (this milestone): minimal viewer.** Includes: subcommand, server, GET-only dispatcher, `RunSummary` consumption, phase-graph render, basic evidence-kind rendering (counts/badges only, no lazy full-payload loading), polling-only events tail (`GET /api/events?since=<seq>` paginated), idle timeout + shutdown, redactor wrapper, `VIEWER.md` canonical contract, config schema. Viewer-taxonomy mapping ships in step 1 because it is presentation-only and gate-neutral.

**Step 1.5 (follow-up sub-step, separate milestone if pursued): rich rendering.** Includes: SSE stream for live event tail, lazy full-payload loading for `file_diff` (full patch fetched on click; redaction roundtrip on the wire), expanded `command` payload reveal with stdout/stderr log file streaming, multi-run dashboard. Each addition is read-only and additive to the step 1 contract; they ship in a follow-up because bundling them in step 1 would push the sub-surface count to ~12 and trigger the same Rule 20 sharper-application warning that the M16 C9 incident codified (`feedback_rule20_sharper_application.md`).

The implementing milestone for B4 step 1 ships **B4 alone**, depending on B1+B2 already shipped (B1 evidence schema and B2 `RunSummary` derivation are pre-conditions, not co-shipped). No other authority changes bundled.

Estimated commits for step 1: 3–5. C1 = subcommand skeleton + GET-only dispatcher + 405 enforcement. C2 = `RunSummary` consumption + phase-graph render. C3 = polling-only events tail + viewer taxonomy mapping + label legend. C4 = config schema + idle timeout + shutdown handler + redactor wrapper. Optional C5 = doc + screenshot fixtures for `docs/contracts/VIEWER.md`.

Test count delta for step 1: ~40–60 tests. Unit tests for the dispatcher (GET-only enforcement, loopback-only shutdown, secret redaction roundtrip), integration tests for the polling endpoint against a `FakeProvider` run, and a binary-spawn e2e per `MEMORY.md`'s milestone-level e2e rule (launch the viewer, hit each endpoint, verify GET-only, verify shutdown).

Risk profile: low. Read-only and additive. Dominant risks are the ones listed in § "Anti-pattern to avoid" — write-endpoint creep, bind drift, and `RunSummary` re-derivation.

## Rule check

- **Rule 1** (file-based gate signals only): compatible. The viewer reads gate files; it never writes them. Phase transitions remain file-based.
- **Rule 7** (artifact contracts in plain Markdown): compatible. The viewer renders Markdown artifacts as HTML for display; the canonical artifact stays Markdown on disk.
- **Rule 8** (`FakeProvider` runs the full lifecycle offline): compatible. The viewer launches against any run, including `FakeProvider` runs. Embedded assets keep the binary single-file; no runtime install step breaks offline determinism.
- **Rule 13** (privacy by default): load-bearing-compatible. `127.0.0.1`-only bind plus secret redaction on the response wire match the existing privacy contract. The redactor is the same module the agent file-manifest pipeline already uses.
- **Rule 19** (run-level budget enforcement): not affected. The viewer makes no provider calls, consumes no token budget, and does not appear in `events.jsonl`.
- **Rule 20** (one new authority per milestone): one new domain (read-only inspection HTTP surface). The implementing milestone bundles **B4 step 1 alone**; B2 is a *pre-condition* (already shipped in the v0.2 milestone A), not a co-shipped pair. Step 1 is intentionally trimmed (polling-only events tail; no SSE; no lazy full-payload loading; header-only `file_diff` rendering) to keep sub-surface count honest under sharper application. Rich rendering — SSE stream, lazy `file_diff` full-patch panel, multi-run dashboard — defers to step 1.5 in a separate follow-up milestone with its own Rule 20 budget.
- **Rule 21** (no new parallel-provider surface without measurable risk-reduction effect): not applicable. The viewer is single-user inspection, not a provider surface. It does not add parallel-provider capacity.

## Open questions

1. **Polling cadence and step-1.5 SSE evaluation.** Step 1 ships polling at a 2 s default interval. Open question for step 1.5: does adding SSE pay off in user-visible UX (timeline freshness, reduced wakeups) given the binary-embed cost and the vanilla-JS client implementation complexity? If SSE in vanilla JS needs a polyfill or the implementation footprint pushes step 1.5 over its own Rule 20 budget, the step-1.5 follow-up may keep polling and instead invest in a faster interval or smarter diffing.
2. **Long-running runs (>10 MiB events).** The default `?limit=50` and the `?since=<seq>` cursor cap the wire size per request, but the in-memory cursor state on the server can drift if the client reconnects far in the past. Proposed default for step 1: cap any single response at the most recent 1000 events; older events require an explicit `?since=<seq>` cursor with a smaller window per request. Step 1.5 SSE (if pursued) inherits the same cap on backfill.
3. **Multi-run dashboard in step 1, or step 1.5.** Step 1.5 — the viewer ships single-run only. The dashboard surface earns its own milestone slot once friction is observed in real use.
4. **Unix domain socket vs. TCP loopback.** UDS tightens the trust boundary (file-system permissions, not network ACLs). Costs Windows compatibility and Bun UDS verification. Proposed default: TCP loopback for v0.3+, UDS as a follow-up if Bun support is solid on all three platforms (`bun build --compile` targets) at that time.
5. **URL-token defense-in-depth.** Jupyter-style tokens (`?token=<random>` on first launch, embedded in the URL the CLI prints) protect against same-host malicious processes that scan loopback ports. The cost is a small UX friction (the user copies the URL the CLI prints, not just the port). Proposed default: token off in v0.3+, on by default in v0.4+ once the friction is measured.
6. **Asset pipeline mechanics.** `bun build --compile` asset embedding works for binary blobs; the question is whether the viewer ships per-asset (`index.html`, `app.js`, `app.css` separately embedded) or one bundled JS file with HTML + CSS inlined. Proposed default: per-asset, because debugging a single inlined blob is harder for end users who file viewer bugs.

## Anti-pattern to avoid

1. **Adding write endpoints "just for repair."** The temptation: the operator opens the viewer, sees a stuck phase, and the obvious affordance is a button that writes a gate file or amends `events.jsonl`. This conflicts with Rule 1 — gates are file-based, not API-driven, and the viewer would become a shadow gate path that bypasses orchestrator-recorded provenance. Repair stays in CLI subcommands (`code-oz approve`, future `code-oz repair`), where it is auditable through the same file artifacts the orchestrator already governs.
2. **Binding to `0.0.0.0` for "remote access."** The viewer is a debugging surface for a single operator on a single machine. The moment the bind drifts to `0.0.0.0` or a routable address, the privacy contract (Rule 13) breaks: secrets in `RunSummary` payloads cross the network, no auth is in place, and the GET-only constraint is no longer the only thing standing between attackers and the run state. Make the bind a compile-time constant; do not accept a flag that overrides it.
3. **Re-implementing `RunSummary` derivation in the viewer.** The viewer is tempted to re-parse `events.jsonl` directly to render the phase graph, because `RunSummary` is one extra layer. The cost is two sources of truth: the orchestrator's `RunSummary` derivation and the viewer's parallel derivation drift the moment a new event kind lands. The discipline: the viewer consumes `RunSummary` and only `RunSummary` for the phase-graph render; the events panel renders raw events from `events.jsonl` for transparency, but the rendered shape (nodes, edges, status badges) is always derived through B2.

## Acceptance criteria for the implementing milestone

- [ ] `code-oz view <runId>` subcommand ships and is dispatched from `src/cli.ts` alongside `init` / `run` / `approve` / `doctor`. `code-oz view --help` prints flags.
- [ ] The HTTP server binds to `127.0.0.1` only. A unit test verifies the bind address is the loopback constant; a binary-spawn e2e verifies the server is unreachable from a non-loopback interface.
- [ ] Only `GET` requests succeed. A test sends `POST` / `PUT` / `PATCH` / `DELETE` and confirms `405 Method Not Allowed` for each.
- [ ] `GET /api/run-summary` returns a `RunSummary` JSON shape consumed from B2. A test verifies the same `RunSummary` content the orchestrator would emit.
- [ ] `GET /api/events?since=<seq>&limit=<n>` returns up to N events from `events.jsonl` after the cursor; default `n = 50`, max `n = 200`.
- [ ] The timeline refreshes as new events land via client-side polling against `GET /api/events?since=<seq>&limit=<n>` (default 2 s interval). SSE streaming is explicitly deferred to step 1.5 (see Cost estimate split); step 1 acceptance verifies only the polling path.
- [ ] The viewer taxonomy renders at least three node-type variants (e.g., `start`, `wait`, `human`) against fixture runs. The legend documents the full label set, including dormant labels.
- [ ] Idle timeout fires and exits the process cleanly after the configurable window with no active connections.
- [ ] Embedded assets load offline. A binary-spawn e2e confirms `code-oz view` runs with no network access.
- [ ] Secret redaction is verified end-to-end: a fixture run that records a secret in an event payload renders the redacted form in the viewer response. The redactor under test is the same `.code-ozignore` pipeline used elsewhere.
- [ ] No file writes from the viewer process. A test asserts that `events.jsonl`, gate files, and `RunSummary` files are byte-identical before and after the viewer runs against the run.
- [ ] `docs/contracts/VIEWER.md` ships as the canonical contract (security boundaries, GET-only API, viewer taxonomy mapping).
- [ ] `.code-oz/config.yaml` documents `viewer.defaultPort` and `viewer.idleTimeoutSeconds` with sane defaults.
- [ ] Codex round-1 debate completed before implementation; Codex round-2 review completed before tag, both per the cross-model peer review rule.
- [ ] B4 step 1 ships **alone** as one milestone; B2 (`RunSummary`) is a strict pre-condition shipped earlier in v0.2 milestone A. Step 1 is trimmed (polling-only, header-only `file_diff`, no SSE, no lazy full-payload, no multi-run dashboard) so the sub-surface count stays under Rule 20 sharper-application thresholds.

## Relationship to step 2 (canvas-as-frontend hypothesis)

Step 2 is tracked separately in `docs/comparisons/agentic-canvas/CANVAS_FRONTEND_HYPOTHESIS.md` and is not part of the B4 implementing milestone. The hypothesis is: a canvas-style frontend that consumes `RunSummary` and offers human-edit-the-plan affordances *before* the next BUILD attempt could be the UX moat the §3.4 convergence-path discussion (and §5 adoption-vs-architecture risk note) in `COMPARISON.md` flagged. That is a hypothesis, not a commit. Rule 21's measurable-risk-reduction discipline applies: until friction with the read-only viewer in real use produces a signal that human-in-the-loop plan editing reduces a measurable failure class, step 2 stays in the research doc. B4 is deliberately scoped narrow so that the future hypothesis, if it ever lands, has a clean read-only base to extend from rather than a half-baked write surface to retrofit.
