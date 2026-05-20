# D0_FINDINGS — distribution channel proof (no code)

Date: 2026-05-20
Status: **D0 complete.** Verification done; D1 contracts frozen below.
Inputs: `DISTRIBUTION_PLAN_FINAL.md`, `SUPERPOWERS_BORROW_ANALYSIS.md` v3, `SESSION_DIST_D0_D1_KICKOFF.md`
Verified by: empirical npx test + `npm-wrapper/index.cjs` read + claude-code-guide doc check + superpowers v5.1.0 working reference

## 1. Verification results

### 1.1 npx bootstrap — VERIFIED working (with one caveat)

Empirical test, clean isolated cache (`CODE_OZ_NPM_CACHE_DIR=$(mktemp -d)`):

- `npx -y @tuel/code-oz --version` → downloaded the GH-release tarball, verified sha256 against `checksums.txt`, cached `code-oz` + `code-oz.sha256`, exec'd the binary, printed `0.20.3-alpha.0`, exit 0. First-run UX is clean: no extra prompts, completes well inside the 60s download timeout.
- Published npm version (`0.20.3-alpha.0`) matches the local `package.json` — npm publish is current.

**Caveat (the `@tuel` scope-routing trap, already known to memory).** On a default `npx -y @tuel/code-oz` the command 404s on this machine because `~/.npmrc` routes `@tuel` → `npm.pkg.github.com` (GitHub Packages), where the package is not published:
```
npm error 404 Not Found - GET https://npm.pkg.github.com/@tuel%2fcode-oz
```
Forcing `@tuel:registry=https://registry.npmjs.org/` resolves and the bootstrap works. **A clean external machine with default npm config resolves from public npm and works.** But any user who has `@tuel` scope routing (or copies a wrong recipe) breaks. → The bootstrap instruction must name this caveat and offer the Homebrew fallback (which bypasses npm scope routing entirely).

### 1.2 npm launcher contract (`npm-wrapper/index.cjs`) — fully documented

- Platforms: `darwin`/`linux` × `arm64`/`x64` only. **Windows is rejected at the launcher** ("deferred to v0.21+"). The binary itself is not built for Windows.
- Cache: `$CODE_OZ_NPM_CACHE_DIR` or `~/.cache/code-oz/<version>/code-oz` (+ `.sha256` sidecar).
- Assets: `code-oz-v<version>-<os>-<arch>.tar.gz` + `checksums.txt` from `github.com/omerakben/code-oz/releases/download/v<version>`.
- Integrity: sha256 verify on download AND on cache reuse; corrupted cache is purged and re-downloaded (file:// can't re-download → hard error).
- Overrides (test-only): `CODE_OZ_NPM_BASE_URL`, `CODE_OZ_NPM_CACHE_DIR`. `file://` supported.
- No `postinstall`; runs on first invocation; survives `npm ci --ignore-scripts`. Argv passed through, stdio inherited, exit code/signal propagated.

### 1.3 Claude Code plugin mechanics — confirmed

- **plugin.json** at `.claude-plugin/plugin.json`; required `name`/`version`/`description`; optional component pointers: `skills` (dir), `commands` (array), `hooks` (object or file), `agents`, `mcpServers`.
- **marketplace.json** at marketplace repo root; install flow `claude plugin marketplace add <github/source>` then `claude plugin install <plugin>@<marketplace>`. An official `claude-plugins-official` marketplace exists; third-party publication mechanics are not publicly documented (→ D-stage F1 item; pursue listing process separately).
- **Namespace = plugin name.** A skill `bar` in plugin `foo` resolves under the plugin's namespace (`foo:bar` in the Skill tool surface; `/foo-bar` as a slash command). Two surfaces in one plugin cannot occupy separate namespaces. **Confirms the sibling-plugin decision: `code-oz` and `code-oz-discipline` must be two plugins.**
- **Hooks run with the user's shell permissions — no sandbox.** **Confirms B3 must be a host-exec *declaration*, not enforcement.**
- **SessionStart output contract** = `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<text>" } }`. Confirmed by the working superpowers v5.1.0 `hooks/session-start` and by this session's own bootstrap. Matchers seen: `startup|clear|compact` (superpowers) and `.*`. `${CLAUDE_PLUGIN_ROOT}` expands to the plugin root at runtime.

### 1.4 Two corrections to the borrow analysis (fold into D1)

- **No `SubagentStart` hook exists.** Hook events are SessionStart / PreToolUse / PostToolUse / Stop / SubagentStop. The subagent-skip must be a **prose directive inside the injected router card** (superpowers' `<SUBAGENT-STOP>` pattern), NOT an `agent_id` hook-input check. Correct B1's subagent clause accordingly.
- **Windows is double-blocked.** The launcher rejects Windows AND the polyglot hook is Windows-only complexity. The entire Windows plugin story waits for v0.21+ binary support. **D1a is darwin/linux only.** B3's polyglot variant does not even have a binary to launch on Windows yet — defer the whole Windows arm.

### 1.5 B3 prior art (`docs/comparisons/agentic-canvas/B3_SKILL_WRAPPERS.md`) — carry-forward vs stale

- **Carry forward:** the Claude plugin shape (declarative manifest + ~30-line `SKILL.md` exec shells), the boundaries section ("binary is the only writer; never write `.code-oz/`; surface `NEEDS_INTERVENTION` path and stop"), the 5-skill set (init/run/status/resume/view), and the Codex `AGENTS.md` variant for D2.
- **Stale / superseded:** B3 proposes a SINGLE plugin `code-oz-skills` mixing everything. Superseded by the two-plugin split (D1a `code-oz` wrapper/router + D1b `code-oz-discipline` advisory). B3 also predates the engine-first vs advisory distinction. Use its skill bodies; drop its single-plugin packaging.

### 1.6 Commands vs skills — decision

Ship **both** in D1a: slash commands for explicit invocation (`/code-oz-run`, `/code-oz-init`, `/code-oz-doctor`, `/code-oz-resume`) AND the SessionStart router card for discovery/auto-route. Skills/cards drive discovery; commands drive explicit user action.

## 2. Frozen D1 contracts

### 2.1 Bootstrap contract (what every wrapper surface depends on)

```
1. If `command -v code-oz` resolves        → run the binary directly.
2. Else if npm is available                → `npx -y @tuel/code-oz@<pinned> <args>`
   - CAVEAT: if this 404s with npm.pkg.github.com, the user has @tuel scope
     routing. Tell them to install via Homebrew (bypasses npm scope routing)
     or set @tuel:registry=https://registry.npmjs.org/.
3. Else                                     → hard-stop with: "code-oz is not
   installed. Install: npm i -g @tuel/code-oz  OR  brew install omerakben/tap/code-oz".
```
`<pinned>` = the plugin's released version (the plugin and the engine version-lock together). Never silently float to `@latest`.
Platforms: darwin/linux only in D1; Windows hard-stops with the v0.21+ note.

### 2.2 B1 router card (literal D1a content, ≤1500 tokens)

Injected at SessionStart via `hookSpecificOutput.additionalContext`. Idempotent marker `<!-- code-oz-router v1 -->`. Draft body:

```
<!-- code-oz-router v1 -->
This repo can use code-oz, a runtime that puts enforced gates and a
different-model review around AI coding work. You (the host agent) do the
building; code-oz enforces the process and leaves an audit trail.

When to route to the engine:
- The user wants to build or change production-bound or shared code → propose
  running `code-oz run` (the /code-oz-run command). Confirm before running.
- Setup / health / continuation → `code-oz doctor` (read-only, run freely),
  `code-oz init`, `code-oz run` to resume after NEEDS_INTERVENTION.
- Throwaway scripts, questions, or read-only exploration → do NOT route to code-oz.

Boundaries (load-bearing):
- You never declare a gate passed, never write under `.code-oz/`, never parse
  engine output into pass/fail, never simulate review. The engine owns all of that.
- `code-oz run` spawns providers and may cost money — run it only on explicit
  request or after the user confirms.
- This card defers to the user's instructions and to CLAUDE.md. If another
  skills system (e.g. superpowers) is installed, it keeps its own routing; this
  card only adds the engine-routing pointer.

If you were dispatched as a subagent for a specific task, ignore this card.
```

### 2.3 B3 host-exec declaration (D1a Unix hook)

A rule-9-shaped manifest committed alongside the hook, validated in CI/review (not runtime sandbox): `command` (argv), `interpreter: bash`, `cwd: ${CLAUDE_PLUGIN_ROOT}`, `file_roots: read plugin dir only`, `network: deny`, `env: allowlist (no secret inheritance)`, `timeout`, `output_caps`. D1a ships the Unix bash hook only; degrade silently if no bash (matches superpowers). Windows polyglot deferred (no Windows binary anyway).

### 2.4 D1b parameters (sibling plugin `code-oz-discipline`)

Locked in `SUPERPOWERS_BORROW_ANALYSIS.md` v3 §"D1b parameters" + the E1-E9 adversarial corpus. Restated: distinct plugin; advisory banner on every skill; denylist (`GATE_*`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, gate-sense `passed`/`approved`, cross-family-review claims); no canonical writes; mandatory engine upsell; deterministic `universal-rules.md` import (rule 16).

### 2.5 `code-oz` plugin manifest shape (D1a)

```json
{
  "name": "code-oz",
  "description": "Enforced SDLC gates + cross-family review for AI coding agents. Discovers and invokes the code-oz engine; the binary is the only writer of gates, events, and reviews.",
  "version": "<engine-version-locked>",
  "author": { "name": "Ozzy (Omer Akben)", "url": "https://github.com/omerakben/code-oz" },
  "homepage": "https://github.com/omerakben/code-oz",
  "repository": "https://github.com/omerakben/code-oz",
  "license": "MIT",
  "keywords": ["code-oz", "agentic-sdlc", "gates", "cross-family-review", "orchestrator"],
  "commands": ["./commands/code-oz-run.md", "./commands/code-oz-init.md", "./commands/code-oz-doctor.md", "./commands/code-oz-resume.md"],
  "hooks": "./hooks/hooks.json"
}
```

## 3. Open items handed to D1 (not blockers)

1. Third-party marketplace publication mechanics for the Claude official marketplace + OpenAI Codex plugins repo (F1) — pursue the listing process; not needed to build/test D1 locally via `--plugin-dir`.
2. Pin-vs-float version policy for the `npx` bootstrap (lean: pin to plugin release).
3. Whether `code-oz doctor` should gain a machine-readable `--json` mode to make the B4 harness assertions cleaner (nice-to-have; the harness can parse stream-json without it).
