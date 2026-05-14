# A5-docs findings

Sub-task: A5
Operator: codex-subtask-5
Started: 2026-05-13T22:10:00Z
Finished: 2026-05-13T22:19:24Z

## Summary

Found 4 documentation findings: 1 block-ship and 3 fix-soon. Biggest first-run risk: the GUI README tells users to clone a GitHub repo that returns 404, so the documented GUI quick start cannot begin. Link/path checks were light: local markdown links resolved, README release asset resolved, npm package version resolved, Homebrew tap resolved, and banned-vocabulary scan found no hits in the three requested docs. Screenshot files exist, but live GUI screenshot drift was not verified in this 10-minute pass.

## Findings

### F5.1 - GUI quick start clones a missing repository

- **Severity:** block-ship
- **Where:** code-oz-gui/README.md:79
- **Evidence:**
  ```text
  code-oz-gui/README.md:79:git clone https://github.com/omerakben/code-oz-gui.git

  Command:
  curl -fsSI -L https://github.com/omerakben/code-oz-gui

  Exit: 56
  Output:
  curl: (56) The requested URL returned error: 404
  HTTP/2 404
  ```
- **Why it matters for first-run UX:** A friend following the GUI README cannot clone the app, so `bun install && bun run dev` is unreachable from the documented path.
- **Proposed fix:** Update the quick start to clone the monorepo and enter the GUI subdirectory, for example `git clone https://github.com/omerakben/code-oz.git`, `cd code-oz/code-oz-gui`, `bun install`, `bun run dev`. If a split `code-oz-gui` repo is intended, create it before release and make the link resolve.
- **Effort estimate:** xs

### F5.2 - README presents brownfield AUDIT as usable even though M17 is still the gap

- **Severity:** fix-soon
- **Where:** README.md:38, docs/ABOUT.md:66, src/commands/run.ts:313-317
- **Evidence:**
  ```text
  README.md:38:Phases (brownfield): `AUDIT -> PLAN -> BUILD -> VERIFY -> REVIEW -> SHIP`. Auto-detected on boot.

  docs/ABOUT.md:66:The next milestone is M17 (AUDIT runtime), shipping to v0.21 ... M17 closes the brownfield workflow gap so `code-oz` can audit existing codebases before proposing fixes.

  src/commands/run.ts:313-317:
  M17's C2 will add the AUDIT dispatch branch ... until then the fresh-run path still calls runDefine below ... the real AUDIT dispatch gap.

  Command:
  test -f src/phases/audit.ts

  Exit: 1
  ```
- **Why it matters for first-run UX:** Users with an existing repo will expect the documented brownfield path to run, but the current codebase says AUDIT dispatch is not wired yet.
- **Proposed fix:** Reword README status around brownfield as "detected and represented in state, AUDIT runtime lands in M17/v0.21" and point users to the greenfield or fake-provider demo for v0.20.1. Keep docs/ABOUT as the deeper milestone note, but make the README first-run path honest.
- **Effort estimate:** s

### F5.3 - Provider/auth setup is split and contradictory

- **Severity:** fix-soon
- **Where:** README.md:36, code-oz-gui/README.md:83-87, docs/ABOUT.md:16, docs/references/provider-contract.md:14
- **Evidence:**
  ```text
  README.md:36 says no API keys are required for supported families and describes Claude/Codex/Gemini CLI subscription auth.

  code-oz-gui/README.md:83-87 tells users to set provider keys for live modes:
  GEMINI_API_KEY for the GUI helper, and ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY for real providers.

  docs/ABOUT.md:16 documents XaiProvider reading XAI_API_KEY.

  docs/references/provider-contract.md:14 says v0.1 supports two auth shapes:
  Claude/Codex subprocess delegation and xAI direct API-key transmission.
  ```
- **Why it matters for first-run UX:** The north star says the user sets one provider key, but the docs do not say which key is needed for CLI first-run, GUI helper, fake mode, xAI live mode, or Claude/Codex subscription mode.
- **Proposed fix:** Add one provider setup table and link to it from README, docs/ABOUT, and code-oz-gui/README. The table should distinguish: fake mode needs no key; Claude and Codex use `claude login` / `codex login status`; xAI uses `XAI_API_KEY`; GUI helper uses `GEMINI_API_KEY`; Anthropic/OpenAI env keys should not be documented for v0.20.1 unless direct HTTP adapters actually consume them.
- **Effort estimate:** s

### F5.4 - Release/changelog docs still read like tag-prep and disagree on test count

- **Severity:** fix-soon
- **Where:** CLAUDE.md:9, README.md:64, docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md:4,52,63,73, docs/handoffs/2026-05-13-codex-finalize-distribution.md:165
- **Evidence:**
  ```text
  gh release view v0.20.0-alpha.0 --json tagName,isDraft,isPrerelease,publishedAt,url
  Exit: 0
  {"isDraft":false,"isPrerelease":false,"publishedAt":"2026-05-12T03:24:58Z","tagName":"v0.20.0-alpha.0","url":"https://github.com/omerakben/code-oz/releases/tag/v0.20.0-alpha.0"}

  CLAUDE.md:9 says v0.19 shipped and v0.20 is preparing, with 3362 offline tests.
  README.md:64 says v0.20.0-alpha.0 is the first release and 3366 tests pass.
  docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md:4 says status: tag-prep.
  docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md:52 says bun test runs 3362 offline tests.
  docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md:63 and :73 still contain push/publish prerequisite sections.

  Command:
  rg --files | rg 'CHANGELOG|RELEASE_NOTES|release_notes|Release|release'

  Exit: 0
  Output:
  docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md
  ```
- **Why it matters for first-run UX:** The repo's orientation docs disagree on whether v0.20 is released and what the current verification baseline is, so release-readiness workers and users get mixed signals.
- **Proposed fix:** Update the v0.20 release notes from tag-prep to published state, make the test count match the verified branch baseline, and move old push/publish instructions into a historical/release-procedure note. Add a `v0.20.1-alpha.0` release-note stub for this first-run polish PR as requested by the playbook.
- **Effort estimate:** s

## Checks with no findings

- Local markdown and HTML image references in README.md, docs/ABOUT.md, code-oz-gui/README.md, and the v0.20 release notes resolved: `missing_local_links=0`.
- README release install asset resolved with HTTP 200 after redirect.
- `npm --cache /private/tmp/code-oz-npm-cache view @tuel/code-oz version` returned `0.20.0-alpha.0`.
- Homebrew tap URL returned HTTP 200.
- Banned-vocabulary scan across README.md, docs/ABOUT.md, and code-oz-gui/README.md returned no matches.
- GUI screenshot paths exist and are PNGs under `code-oz-gui/docs/screenshots/`.

## Gaps / not verified

- Did not execute the full README install commands end-to-end because this was the A5 lightweight pass and install would write outside the repo.
- Did not run `brew tap` or `brew install`; only checked the tap URL.
- Did not run the GUI or compare screenshots against a fresh render. Screenshot path/metadata only.
- `curl -fsSI -L https://www.npmjs.com/package/@tuel/code-oz` returned a Cloudflare 403 challenge, but `npm view` with an isolated cache verified the package version.
- Did not run a full HTTP link crawler. Checked the install asset, npm package via registry, Homebrew tap, GitHub Actions workflow links, and the GUI clone target.

## Commands run

- `rg -n "finalize|v0\\.20|0\\.20|first-run|changelog|provider|key|screenshot|banned|vocabulary|playbook" /Users/ozzy-mac/.codex/memories/MEMORY.md` -> exit 0
- `git status --short --branch` -> exit 0
- `pwd` -> exit 0
- `rg --files -g 'CHANGELOG*' -g '*RELEASE*' -g '*release*' -g 'docs/handoffs/**' -g 'CLAUDE.md' -g 'README.md' -g 'docs/ABOUT.md' -g 'code-oz-gui/README.md'` -> exit 0
- `wc -l docs/handoffs/2026-05-13-codex-finalize-distribution.md CLAUDE.md README.md docs/ABOUT.md code-oz-gui/README.md CHANGELOG.md` -> exit 1
- `rg -n "<A5 terms plus playbook terms>" docs/handoffs/2026-05-13-codex-finalize-distribution.md CLAUDE.md README.md docs/ABOUT.md code-oz-gui/README.md CHANGELOG.md` -> exit 2
- `sed -n '1,220p' docs/handoffs/2026-05-13-codex-finalize-distribution.md` -> exit 0
- `sed -n '221,420p' docs/handoffs/2026-05-13-codex-finalize-distribution.md` -> exit 0
- `sed -n '1,180p' CLAUDE.md` -> exit 0
- `sed -n '1,180p' README.md` -> exit 0
- `sed -n '1,180p' docs/ABOUT.md` -> exit 0
- `sed -n '1,220p' code-oz-gui/README.md` -> exit 0
- `sed -n '1,220p' docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md` -> exit 0
- `find docs/handoffs/codex-finalize -maxdepth 1 -type f -print` -> exit 0
- `rg -n "<provider auth terms>" README.md docs/ABOUT.md code-oz-gui/README.md docs docs/reference src package.json code-oz-gui/.env.example` -> exit 2
- `rg -n "<playbook banned vocabulary pattern>" README.md docs/ABOUT.md code-oz-gui/README.md` -> exit 1
- `rg -n "\\[[^\\]]+\\]\\([^)]*\\)|<img src=|https?://" README.md docs/ABOUT.md code-oz-gui/README.md docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md` -> exit 0
- `rg --files docs/screenshots code-oz-gui/docs/screenshots` -> exit 2
- `rg --files docs src tests code-oz-gui | rg 'provider|references|reference|env|example|screenshot|CLAUDE_DESIGN_BRIEF|ROADMAP|demo/01-todo-cli/README|homebrew/README'` -> exit 0
- `sed -n '1,220p' docs/references/provider-contract.md` -> exit 0
- `cat code-oz-gui/.env.example` -> exit 0
- `cat package.json` -> exit 0
- `sed -n '1,240p' src/providers/registry.ts` -> exit 0
- `sed -n '1,220p' src/providers/gemini.ts` -> exit 0
- `sed -n '1,220p' src/providers/xai.ts` -> exit 0
- `sed -n '1,180p' src/commands/doctor.ts` -> exit 0
- `sed -n '180,380p' src/commands/doctor.ts` -> exit 0
- `sed -n '1,260p' src/cli/bootstrap.ts` -> exit 0
- `sed -n '1,220p' src/providers/claude.ts` -> exit 0
- `sed -n '1,220p' src/providers/codex.ts` -> exit 0
- `sed -n '1,220p' scripts/demo/01-todo-cli/run-demo.ts` -> exit 0
- `sed -n '1,220p' docs/demo/01-todo-cli/README.md` -> exit 0
- `bun run dev --help` -> exit 0
- `bun run dev doctor --help` -> exit 0
- `rg -n "brownfield|AUDIT|Auto-detected|audit_completed|currentPhase|phase: 'audit'|phase.*audit|M17" README.md docs/ABOUT.md src tests code-oz-gui/README.md` -> exit 0
- `sed -n '1,260p' src/commands/init.ts` -> exit 0
- `sed -n '1,140p' src/state/schemas.ts` -> exit 0
- `rg -n "runAskMe|currentPhase|audit|define" src/commands/run.ts src/phases/audit.ts src/phases/ask-me.ts src/phases/define.ts` -> exit 2
- `node -e 'const fs=require("fs"),path=require("path"); const files=["README.md","docs/ABOUT.md","code-oz-gui/README.md","docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md"]; let bad=0; for (const f of files){const text=fs.readFileSync(f,"utf8"); const links=[...text.matchAll(/\\[[^\\]]+\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)/g)].map(m=>m[1]).concat([...text.matchAll(/<img\\s+[^>]*src="([^"]+)"/g)].map(m=>m[1])); for (const raw of links){ if (/^(https?:|mailto:|#)/.test(raw)) continue; const clean=raw.split("#")[0]; if (!clean) continue; const p=path.resolve(path.dirname(f),clean); if (!fs.existsSync(p)){ console.log(`${f}: missing local link ${raw} -> ${path.relative(process.cwd(),p)}`); bad++; } } } console.log(`missing_local_links=${bad}`); process.exit(bad?1:0);'` -> exit 0
- `test -f docs/planning/1000_STAR_PLAN.md` -> exit 0
- `test -f CHANGELOG.md` -> exit 1
- `test -f src/phases/audit.ts` -> exit 1
- `curl -fsSI -L https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/install.sh` -> exit 0
- `npm view @tuel/code-oz version` -> exit 1
- `curl -fsSI -L https://github.com/omerakben/homebrew-code-oz` -> exit 0
- `curl -fsSI -L https://github.com/omerakben/code-oz-gui` -> exit 56
- `npm --cache /private/tmp/code-oz-npm-cache view @tuel/code-oz version` -> exit 0
- `curl -fsSI -L https://www.npmjs.com/package/@tuel/code-oz` -> exit 56
- `curl -fsSI -L https://github.com/omerakben/code-oz/actions/workflows/test.yml` -> exit 0
- `curl -fsSI -L https://github.com/omerakben/code-oz/actions/workflows/release.yml` -> exit 0
- `cat code-oz-gui/package.json` -> exit 0
- `test -f code-oz-gui/bun.lock` -> exit 0
- `rg -n "code-oz-gui\\.git|bun dev|bun run dev|git clone|cd code-oz-gui|README|Quick start|install" code-oz-gui/README.md README.md docs/ABOUT.md` -> exit 0
- `bun --version` -> exit 0
- `ls -l code-oz-gui/docs/screenshots` -> exit 0
- `file code-oz-gui/docs/screenshots/hero.png code-oz-gui/docs/screenshots/decisions-task.png code-oz-gui/docs/screenshots/events-errors.png code-oz-gui/docs/screenshots/workspace-form.png` -> exit 0
- `rg -n "screenshots|hero\\.png|decisions-task|events-errors|workspace-form|capture-screenshots|67d77e4" README.md docs/ABOUT.md code-oz-gui/README.md code-oz-gui/scripts/capture-screenshots.ts docs/handoffs/2026-05-13-codex-finalize-distribution.md` -> exit 0
- `git log --oneline -- code-oz-gui/docs/screenshots code-oz-gui/README.md | head -20` -> exit 0
- `rg --files | rg 'CHANGELOG|RELEASE_NOTES|release_notes|Release|release'` -> exit 0
- `rg -n "0\\.20\\.1|v0\\.20\\.1|0\\.20\\.0-alpha\\.0|v0\\.20\\.0-alpha\\.0|CHANGELOG" README.md docs/ABOUT.md code-oz-gui/README.md docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md docs/handoffs/2026-05-13-codex-finalize-distribution.md` -> exit 0
- `rg -n "No API keys required|provider keys|GEMINI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY|Sync policy|subscription-first|direct API-key|API-key transmission" README.md docs/ABOUT.md code-oz-gui/README.md docs/references/provider-contract.md code-oz-gui/.env.example` -> exit 0
- `rg -n "git clone https://github.com/omerakben/code-oz-gui.git|cd code-oz-gui|bun install|bun dev|code-oz-gui" code-oz-gui/README.md` -> exit 0
- `rg -n "Phases \\(brownfield\\)|Auto-detected|M17 closes the brownfield|AUDIT dispatch gap|currentPhase === 'audit'|no v0\\.1 default personas|src/phases/audit" README.md docs/ABOUT.md src/commands/run.ts tests/agents-defaults.test.ts tests/e2e/cli-fresh-profile-propagation.test.ts` -> exit 0
- `rg -n "0\\.20\\.1|v0\\.20\\.1|RELEASE_NOTES|CHANGELOG|0\\.20\\.0-alpha\\.0" docs/handoffs/2026-05-13-codex-finalize-distribution.md docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md README.md docs/ABOUT.md` -> exit 0
- `awk 'NR>=306&&NR<=318{print NR ":" $0}' src/commands/run.ts` -> exit 0
- `awk 'NR>=45&&NR<=56{print NR ":" $0}' tests/agents-defaults.test.ts` -> exit 0
- `awk 'NR>=8&&NR<=16{print NR ":" $0}' tests/e2e/cli-fresh-profile-propagation.test.ts` -> exit 0
- `find src/phases -maxdepth 1 -type f -print` -> exit 0
- `rg -n "OpenCode|Roo Code|Gemini|xAI|favorite coding agents|ProviderId|PROVIDER_IDS" README.md docs/ABOUT.md src/providers/types.ts src/providers/gemini.ts src/cli/bootstrap.ts` -> exit 0
- `sed -n '1,80p' src/providers/types.ts` -> exit 0
- `rg -n "v0\\.19\\.0-alpha\\.0 shipped|preparing v0\\.20\\.0-alpha\\.0|3362|3366|status: tag-prep|Push prerequisites|Publish sequence|first release|tag-prep|release:" CLAUDE.md README.md docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md docs/handoffs/2026-05-13-codex-finalize-distribution.md` -> exit 0
- `gh release view v0.20.0-alpha.0 --json tagName,isDraft,isPrerelease,publishedAt,url` -> exit 0
- `git tag -l 'v0.20.0-alpha.0'` -> exit 0
- `date -u +%Y-%m-%dT%H:%M:%SZ` -> exit 0
