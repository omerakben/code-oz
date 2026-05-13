# Session handoff — Codex finalize distribution (A-to-Z first-run audit + polish)

**Session date:** 2026-05-13
**Session shape:** autonomous Codex CLI session in a separate terminal, run with OpenAI Codex Follow Goals
**Operator:** Codex (gpt-5.5, xhigh) with sub-task fan-out; Claude/Opus stays out of the loop until the PR opens
**Branch state at start:** `main` at `01cc6bd`, clean. Test baseline: 3366 pass / 2 skip / 0 fail.
**Branch state at exit:** `finalize/v0.20.1-first-run-polish` open as a PR against `main`, CI green.

## North star

A friend with zero priors types `npm i -g @tuel/code-oz`, sets one provider key, runs `code-oz init && code-oz run`, and reaches a successful run with zero friction. Anywhere the first-run path leaks a stack trace, a vague error, a broken link, a missing dependency hint, or a silent failure is a bug. Same bar for `code-oz-gui` from `bun install && bun run dev`. Failures here forfeit the 1000-star goal.

## TL;DR — what this session ships

- One PR on `finalize/v0.20.1-first-run-polish` containing every fix the audit finds.
- One `docs/handoffs/codex-finalize/FIRST_RUN_AUDIT.md` ranking every finding (block-ship / fix-soon / nit).
- One `docs/handoffs/codex-finalize/FIRST_RUN_FIXES.md` mapping each finding to its commit.
- One `docs/handoffs/codex-finalize/SMOKE_TRANSCRIPT.md` showing the npm-install-to-first-run path end-to-end.
- Test count holds at ≥3366. Type-check clean. Binary builds. GUI Playwright e2e green. axe-core baseline clean.

## Codex goal text — paste this verbatim into Codex Follow Goals

The block below is ≤4000 characters. It is the **only** thing you paste into Codex. Everything else is in this repo for Codex to read.

```text
Goal: Finalize @tuel/code-oz CLI + code-oz-gui for first-run distribution. North star: a friend runs `npm i -g @tuel/code-oz`, sets one provider key, runs `code-oz init && code-oz run`, and gets a clean success — zero stack traces, zero vague errors, zero broken links. Same bar for `code-oz-gui` from `bun install && bun run dev`. The 1000-star goal depends on this first-run experience.

Branch: finalize/v0.20.1-first-run-polish (off origin/main).

Read first (in order):
1. docs/handoffs/2026-05-13-codex-finalize-distribution.md  — your detailed playbook
2. CLAUDE.md  — non-negotiable rules; rules 6, 9, 20, 22 fire here
3. docs/design/CODEX_SYNTHESIS_W3A.md  — distribution surface contract
4. code-oz-gui/README.md  — GUI scope
5. README.md and docs/ABOUT.md

Pattern: fan-out → synthesize → fix → verify → PR.

Phase 1 — Parallel audit. Spawn 10 read-only sub-tasks (≤10 min wall time each). Each writes findings to docs/handoffs/codex-finalize/<id>.md with severity (block-ship | fix-soon | nit), evidence, and a proposed fix. Areas:
A1 CLI first-run UX (init, doctor, run, every prompt + every error)
A2 GUI first-run UX (bun install, dev server, every tab + drawer + composer)
A3 Distribution surfaces (curl|sh, npm-wrapper, Homebrew, SHA chain, fail-closed)
A4 Cross-platform binaries (darwin x64/arm64, linux x64/arm64)
A5 Documentation (README, CHANGELOG, ABOUT, every link, every command works)
A6 Error-path clarity (every NEEDS_INTERVENTION, every fail-closed message)
A7 Provider onboarding (Claude/Codex/Gemini/xAI key flow; missing-key UX)
A8 Visual polish + screenshot drift (GUI shots match reality)
A9 GUI a11y baseline (axe-core WCAG 2.2 AA on Board, Drawer, Composer)
A10 Code hygiene (dead code, leftover TODOs, type strictness, unused deps)

Phase 2 — Synthesis. Write docs/handoffs/codex-finalize/FIRST_RUN_AUDIT.md ranking every finding. Write FIRST_RUN_FIXES.md mapping each finding to its proposed fix.

Phase 3 — Fix application. Small commits, one logical fix per commit, ≤10-min Codex chunks each. For any behavior change, rule 22 fires: failing test first, run RED, then minimal fix, then GREEN. Never reduce test count. Never relax src/prompts/universal-rules.md. Never edit CLAUDE.md rule blocks — surface conflicts in the audit doc instead.

Phase 4 — Verification gates (all must pass):
- bun test green; total ≥3366
- bun run typecheck clean
- bun run build:binary produces a working dist/code-oz
- bun run scripts/smoke-test.ts passes
- code-oz-gui: bun test + Playwright e2e green
- npm-install smoke: `npm pack` + install in a temp dir under a fresh HOME + run init/doctor/run end-to-end; capture transcript at docs/handoffs/codex-finalize/SMOKE_TRANSCRIPT.md
- axe-core: zero serious/critical violations on Board, Drawer, Composer

Phase 5 — PR.
Title: "finalize(v0.20.1): first-run polish + a11y + distribution audit"
Body: link to FIRST_RUN_AUDIT.md, fix-matrix table, smoke transcript excerpt, before/after metric (findings filed vs fixed vs deferred with reason).
Command: `gh pr create --base main --head finalize/v0.20.1-first-run-polish`. DO NOT merge.

Hard constraints:
- Rebase on origin/main before every push; never push to main directly.
- Never delete tests; only add or refine.
- Never edit CLAUDE.md rule blocks (1–23). Flag conflicts in the audit doc.
- src/prompts/universal-rules.md is read-only this session.
- Each sub-task ≤10 min; chunk anything larger.
- If a stream is blocked twice in a row, write a NEEDS_DECISION.md note for that area and stop that stream. Keep the other streams running.
- Out of scope: M17 implementation, new milestones, new authorities, version bump beyond 0.20.1, Apple signing / GPG, Scoop, SWE-bench, Sentry/telemetry.

Exit criteria: PR open + CI green + audit doc + fix doc + smoke transcript committed + test count ≥3366 + GUI a11y baseline clean.
```

> Character budget: the block above is ~3850 characters including the opening "Goal:" line and the closing exit criteria. Stays under the 4000-character Codex Follow Goals limit. If you trim, do not drop the read-list, the phase boundary list, or the hard constraints — those are load-bearing.

## Phase 1 — audit areas, in full

Codex spawns one sub-task per area below. Each sub-task is read-only (`sandbox: read-only`), ≤10 min wall time, and writes its findings to `docs/handoffs/codex-finalize/<id>.md` using the **Finding template** at the bottom of this doc.

> Every checklist item is mandatory. "A-to-Z" is the contract. If a sub-task cannot test an item (e.g. no Linux host available), it writes a `note:` line explaining the gap and proposes a synthetic check.

### A1 — CLI first-run UX

Sub-task ID: `A1-cli-first-run`.

Test on a clean working directory (`mktemp -d`). Use the actual published wrapper, not `bun run dev`.

- [ ] `npm pack` in repo root produces `tuel-code-oz-0.20.0-alpha.0.tgz`. No errors.
- [ ] In a fresh temp dir with empty `HOME=$(mktemp -d)` and `XDG_CACHE_HOME=$HOME/.cache`, run `npm i -g ./tuel-code-oz-0.20.0-alpha.0.tgz`. Capture stdout + stderr.
- [ ] First call: `code-oz --version` prints `0.20.0-alpha.0`. No prompts, no install spinner.
- [ ] Second call: `code-oz --help` lists every subcommand. Synopsis matches `docs/ABOUT.md`. No spelling errors. No banned vocabulary (delve, tapestry, vibrant, etc.).
- [ ] `code-oz doctor` runs with **no** env vars set. Output is human-readable. Every "missing" line includes a one-line "how to fix". Exit code is non-zero only if something is actually broken (Bun missing, FS unwritable).
- [ ] `code-oz doctor` runs with each provider key set in isolation (CLAUDE / OPENAI / GEMINI / XAI). Reports each correctly. Never logs the key.
- [ ] `code-oz init` in a fresh dir creates `.code-oz/` with the documented layout. README + ABOUT + init's own output agree on the layout.
- [ ] `code-oz init` in a non-empty dir refuses by default, prints `--force` instructions, does not write partial state.
- [ ] `code-oz init --force` in a non-empty dir succeeds, writes brownfield-shape state, emits an `audit_completed` placeholder note (M17 not yet implemented — but the path must not crash).
- [ ] `code-oz run` with `FakeProvider` reaches `GATE_SHIP_PASSED.json` without network. Run takes <30 s.
- [ ] `code-oz run` with no provider key configured prints a friendly setup prompt, not a stack trace. Mentions the supported providers and where to get keys.
- [ ] `code-oz run --resume` after a successful run is idempotent. No duplicate events.
- [ ] `code-oz run --resume` after killing mid-PLAN picks up at PLAN. No corrupted gate files.
- [ ] Every subcommand prints `--help` cleanly. Every flag is documented.
- [ ] Ctrl-C during any phase writes a clean `STOP.json`. No half-written gate files.
- [ ] Run with `--effort=low/medium/high/max`. Confirm `effort_envelope_applied` event fires at position 2 (per rule 23).

### A2 — GUI first-run UX

Sub-task ID: `A2-gui-first-run`.

- [ ] `cd code-oz-gui && bun install` on a clean checkout. No warnings beyond known-acceptable. Capture install transcript.
- [ ] `bun run dev` starts within 10 s. No port conflicts. URL printed clearly.
- [ ] Open the dev URL. Initial render <2 s. No console errors. No hydration warnings.
- [ ] Board view: all 6 columns render. Each column header is correct. No fantasy/Gemini vocabulary leaked.
- [ ] Composer bar: typing a goal does not throw. Submit button is keyboard-reachable.
- [ ] Drawer: clicking a card opens it. Three tabs (Artifact / Events / Decisions). Tab switch is keyboard-reachable.
- [ ] ArtifactView: YAML frontmatter renders cleanly (not as raw text). No nav width wrapping. Provenance chip shows provider family.
- [ ] EventsView: filter chips work. Auto-scroll attaches on new events; pauses when user scrolls up. Provider-family color accents are visible.
- [ ] DecisionsView: 5 row-kinds render. Approve and Revise buttons fire the correct subprocess calls.
- [ ] Subprocess wiring: when no CLI run is active, GUI shows the documented empty state (no broken Spinner).
- [ ] Subprocess wiring: when a CLI run is active in the parent repo, GUI mirrors gate transitions within 1 SSE tick.
- [ ] AIHelper: with `GEMINI_API_KEY` set, returns Flash responses. Without the key, shows a one-line "set GEMINI_API_KEY to enable" hint, not a crash.
- [ ] `bun run build` produces a clean production build. No type errors.
- [ ] Playwright e2e: every test passes. No `.skip` added.

### A3 — Distribution surfaces

Sub-task ID: `A3-distribution`.

- [ ] `scripts/install.sh --version v0.20.0-alpha.0` in a clean `HOME` downloads the correct asset, SHA-verifies, installs to `~/.local/bin/code-oz`. Captured.
- [ ] `scripts/install.sh` with tampered `checksums.txt` (test fixture) fails closed. Exit code non-zero. Clear error message.
- [ ] `scripts/install.sh` on Linux x64 (use Docker or remote runner if local Mac) — same fail-closed contract. If no Linux host, write a synthetic check that the SHA chain `sha256sum → shasum → openssl` falls through cleanly.
- [ ] `npm-wrapper/index.cjs` downloads the correct per-arch binary on first run. SHA-verifies. Caches under `~/.cache/code-oz/<version>/`.
- [ ] `npm-wrapper/index.cjs` second run reuses cache, no network. Verified.
- [ ] `npm-wrapper/index.cjs` with corrupted cache (tamper a byte): re-downloads or fails clearly.
- [ ] Homebrew formula at `docs/homebrew/code-oz.rb.template` renders correctly. `brew audit --strict --online` clean on the rendered version.
- [ ] `checksums.txt` matches the actual asset SHAs in the latest `gh release view v0.20.0-alpha.0` output.
- [ ] `.github/workflows/release.yml` has an explicit `bun install` upstream of every build step (this session's known-good shape per the canonical doc precedence rule).
- [ ] `.github/workflows/test.yml` matrix covers darwin + linux. Bun pinned. No skipped jobs.

### A4 — Cross-platform binaries

Sub-task ID: `A4-binaries`.

- [ ] `bun run scripts/build-binaries.ts` produces all four targets. Sizes recorded.
- [ ] Each binary's `--version` matches `package.json#version`.
- [ ] Each binary's `--help` is identical (modulo platform-specific notes).
- [ ] darwin-arm64: smoke-runs `init` and `doctor` in a temp dir.
- [ ] darwin-x64: smoke (if available; otherwise synthetic SHA check + size sanity).
- [ ] linux-x64 + linux-arm64: synthetic checks if no Linux host. Document the gap.
- [ ] No native dependency drift: `bun run scripts/smoke-test.ts` passes against each available target.

### A5 — Documentation

Sub-task ID: `A5-docs`.

- [ ] `README.md` install commands work, in order, copy-paste. Each command tested in a temp dir.
- [ ] Every link in `README.md` resolves (HTTP 200 or local-file-exists). Includes badges, docs links, release links.
- [ ] `docs/ABOUT.md` matches reality: every milestone mentioned has shipped or is flagged as upcoming.
- [ ] `CHANGELOG.md` (or release notes) has a `0.20.0-alpha.0` section. If preparing `0.20.1`, add a stub with this PR's findings.
- [ ] No banned vocabulary across `README.md`, `docs/ABOUT.md`, `code-oz-gui/README.md`. List under writing rules in `~/.claude/CLAUDE.md` — banned list copied below for offline reference.
- [ ] Provider-key setup is documented in one place and referenced from every other place that mentions providers.
- [ ] Hero screenshots in README and ABOUT match the current GUI (no drift since `67d77e4 feat(gui): bring code-oz-gui into the monorepo`). Re-shoot if stale.

### A6 — Error path clarity

Sub-task ID: `A6-errors`.

- [ ] Enumerate every code path that writes `NEEDS_INTERVENTION.json`. Confirm each writes: `phase`, `reason`, `suggestion`, `event_pointer`. Suggestion is actionable, not "investigate".
- [ ] Enumerate every fail-closed message in `scripts/install.sh` and `npm-wrapper/index.cjs`. Each has a one-line recovery hint.
- [ ] No raw SDK stack traces in user-facing CLI output. All wrapped through the orchestrator's error contract.
- [ ] All `console.error` paths in `src/cli.ts` and subcommand modules are reviewed. Each ends with an exit code and a hint.
- [ ] `PAUSE.json` and `STOP.json` write paths produce the expected event order.

### A7 — Provider onboarding

Sub-task ID: `A7-providers`.

- [ ] No provider key set: `code-oz run` chooses `FakeProvider` automatically. README mentions this for first-time users.
- [ ] `ANTHROPIC_API_KEY` only: end-to-end run completes with Claude as default.
- [ ] `OPENAI_API_KEY` only: REVIEW phase routes to Codex correctly.
- [ ] `GEMINI_API_KEY` only: GUI AIHelper works; CLI still uses default if Anthropic also set.
- [ ] `XAI_API_KEY` only: PE-1 path works.
- [ ] Invalid key: clear 401 message with key-source hint (env var name, not the key itself).
- [ ] Expired key: same. No retry loop. No PII or partial keys logged.

### A8 — Visual polish + screenshot drift

Sub-task ID: `A8-visual`.

- [ ] Every screenshot referenced in `README.md`, `docs/ABOUT.md`, `code-oz-gui/README.md`, and `docs/screenshots/` matches the current GUI render. Compare pixel-imperfect but layout-faithful.
- [ ] Re-shoot any stale image. Filename + alt-text consistent.
- [ ] GUI typography: heading scale matches AI Studio mockup. No title truncation, no pill wrap, no status wrap, no subtitle drift (the four issues caught in the step-4 visual review per `today-2026-05-13.md`).
- [ ] GUI light/dark mode parity (if both are supported).

### A9 — GUI a11y baseline

Sub-task ID: `A9-a11y`.

- [ ] `axe-core` run against `/` (Board) — zero serious/critical violations.
- [ ] `axe-core` against Drawer open state — zero serious/critical.
- [ ] `axe-core` against Composer focused state — zero serious/critical.
- [ ] Keyboard nav: every interactive element reachable. Focus rings visible.
- [ ] ARIA labels present on icon-only buttons.
- [ ] Reduced-motion media query respected on animations.

### A10 — Code hygiene

Sub-task ID: `A10-hygiene`.

- [ ] `bun run typecheck` clean (no `// @ts-ignore` added).
- [ ] `git grep -nE 'TODO|FIXME|XXX'` reviewed. Each one either closed or moved to a tracked issue with a link in the comment.
- [ ] `bun pm ls --depth=0` reviewed. No unused dependencies. No duplicate versions of the same package across CLI + GUI.
- [ ] Dead exports: any module exporting symbols nothing imports gets removed (or marked with one-line comment explaining the public-API reason).
- [ ] No `.env*` files committed. No keys in `events.jsonl` test fixtures.

## Phase 2 — Synthesis contract

Codex writes two docs from the 10 area reports:

1. `docs/handoffs/codex-finalize/FIRST_RUN_AUDIT.md` — single table, columns: `id | area | severity | finding | evidence-link | proposed-fix-link`. Sort by severity then area. Block-ship findings at the top.
2. `docs/handoffs/codex-finalize/FIRST_RUN_FIXES.md` — table mapping each finding to its commit SHA once landed. Empty SHA cells fill in as Phase 3 progresses.

A finding can be marked `defer` only if it is out of scope (see "Out of scope" below) or if it requires a new authority axis (rule 20 prohibits this session). Each defer entry has a one-line reason.

## Phase 3 — Fix application rules

- **Small commits.** One logical fix per commit. Commit subject: `fix(<scope>): <what>` (conventional commits).
- **Rule 22 TDD ordering.** Behavior change → write the failing test first, run it, watch it fail for the right reason, then land the minimal fix.
- **No CLAUDE.md edits.** Rule conflicts are findings, not fixes. Surface in the audit doc; let the next session re-pin.
- **No `universal-rules.md` edits.** Same reason.
- **No new authorities.** Rule 20. If a fix needs a new gate, new phase, new role, new provider surface — that is out of scope, defer with a reason.
- **No test deletions.** Refactors that move tests are fine; the count must stay ≥3366.
- **Never push to `main` directly.** Always push to the feature branch.
- **Rebase on `origin/main` before every push** in case Ozzy or anyone else lands something parallel.

## Phase 4 — Verification gates

All gates must pass before opening the PR:

| Gate              | Command                                          | Pass condition                  |
| ----------------- | ------------------------------------------------ | ------------------------------- |
| Test count        | `bun test`                                       | total ≥3366, 0 fail             |
| Type-check        | `bun run typecheck`                              | exit 0                          |
| Smoke             | `bun run scripts/smoke-test.ts`                  | exit 0                          |
| Binary build      | `bun run build:binary`                           | `dist/code-oz` runs `--version` |
| GUI tests         | `cd code-oz-gui && bun test`                     | 0 fail                          |
| GUI e2e           | `cd code-oz-gui && bun run e2e`                  | 0 fail                          |
| a11y              | axe-core via Playwright on Board/Drawer/Composer | 0 serious/critical              |
| npm-install smoke | per playbook below                               | transcript captured             |

### npm-install smoke playbook

```bash
WORK=$(mktemp -d)
cd "$WORK"
HOME_TMP=$(mktemp -d)
export HOME="$HOME_TMP" XDG_CACHE_HOME="$HOME_TMP/.cache"
(cd /Users/ozzy-mac/Projects/code-oz && npm pack)
cp /Users/ozzy-mac/Projects/code-oz/tuel-code-oz-*.tgz .
npm i -g ./tuel-code-oz-*.tgz
code-oz --version
code-oz --help
code-oz doctor
mkdir demo && cd demo
code-oz init
code-oz run --provider fake
ls -la .code-oz/state/runs/
# Capture every byte of stdout + stderr to:
# docs/handoffs/codex-finalize/SMOKE_TRANSCRIPT.md
```

## Phase 5 — PR contract

Branch: `finalize/v0.20.1-first-run-polish`.
Base: `main`.
Command:

```bash
gh pr create \
  --base main \
  --head finalize/v0.20.1-first-run-polish \
  --title "finalize(v0.20.1): first-run polish + a11y + distribution audit" \
  --body-file docs/handoffs/codex-finalize/PR_BODY.md
```

PR body (Codex generates `PR_BODY.md`) must include:

- One-paragraph summary of the audit shape.
- Fix matrix (severity × area, counts of filed vs fixed vs deferred).
- Link to `FIRST_RUN_AUDIT.md`, `FIRST_RUN_FIXES.md`, `SMOKE_TRANSCRIPT.md`.
- Three-line smoke transcript excerpt (init → run → first gate passed).
- Acknowledgment that CLAUDE.md was not edited.
- Acknowledgment that universal-rules.md was not edited.
- Explicit "DO NOT MERGE" line so Ozzy approves before merging.

## Hard constraints (project rule references)

- **Rule 1** — File-based gate signals. Codex must not change gate-writer paths.
- **Rule 6** — Max 4 review rounds. If Codex self-reviews any sub-stream, exit on score≥6 + ready.
- **Rule 9** — Permission manifest for any executable runner. If a fix introduces a new runner, add the manifest.
- **Rule 16** — Universal anti-slop rules are imported by every persona prompt. Read-only this session.
- **Rule 18** — Codebase context retrieval has its own permission scope. Search backend changes are out of scope.
- **Rule 20** — One new authority boundary per milestone. This is **not** a new milestone — it is polish. Zero new authorities allowed.
- **Rule 22** — Consumer-first + RED-first TDD for behavior changes.
- **Rule 23** — `--effort` scales budgets only. Don't repurpose it for any other axis.

## Out of scope (defer + reason)

- M17 implementation (C1–C10). The next session does this.
- New milestones beyond M17.
- Version bump beyond `0.20.1`. This PR is `v0.20.1-alpha.0` if a release happens, but the release itself is Ozzy's call after merge.
- Apple Developer signing, GPG-signed checksums (deferred to v0.x stable per `CODEX_SYNTHESIS_W3A.md` scope amendment).
- Scoop + Windows binaries (deferred to v0.20.1 in the W3a sense, but **not** this PR — those are their own milestone).
- SWE-bench harness (v0.22 M18).
- Sentry / telemetry instrumentation.
- New provider integrations.

## Progress tracker (Codex fills in)

Codex appends one line per checkpoint. Format: ISO-8601 timestamp + area-id + status + one-line note.

```
2026-05-13T00:00:00Z  session  start  initial state captured, branch created
```

## Finding template (each sub-task uses this)

```markdown
# A<N>-<area> findings

Sub-task: A<N>
Operator: codex-subtask-<N>
Started: <iso>
Finished: <iso>

## Summary

<one paragraph: how many findings, severity mix, biggest risk>

## Findings

### F<N>.1 — <short title>

- **Severity:** block-ship | fix-soon | nit
- **Where:** <file path:line> or <command>
- **Evidence:**
  ```

  <command output, stack trace, screenshot link>

  ```
- **Why it matters for first-run UX:** <one sentence>
- **Proposed fix:** <one paragraph; if it changes behavior, include the failing-test sketch>
- **Effort estimate:** xs | s | m | l

### F<N>.2 — ...
```

## Banned vocabulary (offline reference)

Codex must not introduce any of these in commits, doc edits, PR body, commit messages, or any user-facing string: delve, tapestry, vibrant, pivotal, crucial, intricate, landscape, testament, underscore (as a verb), meticulous, garner, bolstered, fostering, enhance, showcase, interplay, enduring, valuable, boasts, nestled, "in the heart of", groundbreaking, renowned, "diverse array", "indelible mark", "deeply rooted", "evolving landscape", "focal point", "setting the stage for", "rich cultural heritage". Never start a sentence with Additionally, Furthermore, or Moreover.

## Sub-agent dispatch suggestion for Codex

In Codex CLI, the recommended pattern is:

1. Read this doc end-to-end first.
2. Create the branch and the `docs/handoffs/codex-finalize/` directory.
3. Spawn the 10 audit sub-tasks **in parallel** using Codex's task-spawning primitive (each with `sandbox: read-only`, model `gpt-5.5`, effort `xhigh`, prompt template = "Run audit area A<N> per the playbook at docs/handoffs/2026-05-13-codex-finalize-distribution.md and write findings to docs/handoffs/codex-finalize/A<N>-<area>.md"). Do not wait between dispatches.
4. As each sub-task returns, log its checkpoint in the progress tracker.
5. After all 10 return, synthesize. After synthesizing, apply fixes one commit at a time.
6. After each commit, re-run the verification gates that the commit touches.
7. Before pushing, run the full verification suite.
8. Open the PR.

If Codex's spawning primitive is not available, run the areas sequentially in the same session — but enforce the ≤10-minute chunk rule per area to avoid the silent-hang pattern documented in `feedback_small_codex_chunks.md`.

## End of playbook

Open the PR. Stop. Wait for Ozzy or Claude/Opus to review and merge.
