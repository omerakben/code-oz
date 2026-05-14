# A7-providers findings

Sub-task: A7
Operator: codex-subtask-7
Started: 2026-05-13T22:10:00Z
Finished: 2026-05-13T22:26:37Z

## Summary

Filed 3 findings: 1 block-ship and 2 fix-soon. Biggest risk: the first-run provider contract says "set one provider key" and "no key falls back to FakeProvider", but the CLI source still routes default runs through Claude/Codex CLI OAuth unless `--provider fake` is passed explicitly. xAI redaction and mocked invalid-key coverage are strong; GUI Gemini no-key UX and subprocess expired-auth classification still need polish.

## Findings

### F7.1 - First-run provider-key contract does not match the implemented CLI surface

- **Severity:** block-ship
- **Where:** `src/commands/run.ts:274`, `src/commands/run.ts:621`, `src/cli/bootstrap.ts:159`, `README.md:36`, `code-oz-gui/README.md:85`
- **Evidence:**

  ```text
  $ rg -n "buildProviderRegistry\\(|parseProviderOverride|--provider only accepts|providerOverride === 'fake'|No API keys required|FakeProvider|Cost-free demo|GEMINI_API_KEY|Gemini helper is not configured|GEMINI_API_KEY is not set|console\\.error\\('AI helper request failed'|safeErrorDetail|ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY" src/commands/run.ts src/cli/bootstrap.ts README.md docs/ABOUT.md docs/contracts/PROVIDERS.md docs/references/provider-contract.md code-oz-gui/README.md code-oz-gui/app/api/helper/ask/route.ts code-oz-gui/lib/gemini-server.ts code-oz-gui/components/AIHelper.tsx
  src/commands/run.ts:274:  const { registry: providerRegistry, fakeProvider } = buildProviderRegistry({
  src/commands/run.ts:621:function parseProviderOverride(value: string): { kind: 'ok'; value: ProviderOverride } | ParsedError {
  src/commands/run.ts:625:    message: `--provider only accepts 'fake' in v0.1 (got ${JSON.stringify(value)})`,
  src/cli/bootstrap.ts:159:export function buildProviderRegistry(
  src/cli/bootstrap.ts:162:  if (opts.providerOverride === 'fake') {
  README.md:36:... No API keys required for the supported families.
  code-oz-gui/README.md:85:# Edit .env and add at least GEMINI_API_KEY for the in-GUI AI helper.
  code-oz-gui/README.md:86:# ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY are only required when
  ```

  ```text
  $ rg -n "ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY|GEMINI_API_KEY|process\\.env" src/providers src/commands code-oz-gui/lib code-oz-gui/app/api code-oz-gui/components
  src/providers/xai.ts:132:    const rawKey = (process.env.XAI_API_KEY ?? '').trim()
  src/providers/xai.ts:211:  const raw = (process.env.XAI_API_KEY ?? '').trim()
  code-oz-gui/lib/gemini-server.ts:8:  const apiKey = process.env.GEMINI_API_KEY;
  ```

  ```text
  $ rg -n "^provider:|^model:|name:" src/agents/defaults/*.md
  src/agents/defaults/ba.md:5:provider: claude
  src/agents/defaults/builder.md:5:provider: claude
  src/agents/defaults/lead.md:5:provider: claude
  src/agents/defaults/reviewer.md:5:provider: codex
  src/agents/defaults/scientist.md:5:provider: claude
  src/agents/defaults/verifier.md:5:provider: claude
  ```

- **Why it matters for first-run UX:** A user who follows the playbook and sets only `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, or sets no key expecting FakeProvider, will not get the promised path; those env vars are ignored and bundled agents still invoke Claude/Codex CLI adapters.
- **Proposed fix:** Pick one product contract and make code/docs agree before release. If the A7 playbook is authoritative, add a RED test that a fresh run with no supported credential source routes through `buildProviderRegistry({ providerOverride: 'fake' })`, then implement a no-key fake fallback with the existing loud fake banner/event and update README. If subscription-first is authoritative, revise the first-run docs and GUI README to remove `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` for CLI runs and point users to `claude login`, `codex login`, `XAI_API_KEY`, and explicit `--provider fake`.
- **Effort estimate:** m

### F7.2 - GUI Gemini no-key hint is generic and the route logs the raw provider error object

- **Severity:** fix-soon
- **Where:** `code-oz-gui/app/api/helper/ask/route.ts:149`, `code-oz-gui/app/api/helper/ask/route.ts:197`, `code-oz-gui/lib/gemini-server.ts:8`
- **Evidence:**

  ```text
  $ rg -n "AIHelper|GEMINI_API_KEY|helper-unavailable|Gemini helper|askGemini|/api/helper/ask" code-oz-gui tests
  code-oz-gui/lib/gemini-server.ts:8:  const apiKey = process.env.GEMINI_API_KEY;
  code-oz-gui/lib/gemini-server.ts:11:    throw new Error('GEMINI_API_KEY is not set.');
  code-oz-gui/app/api/helper/ask/route.ts:149:function safeErrorDetail(error: unknown): string {
  code-oz-gui/app/api/helper/ask/route.ts:150:  if (error instanceof Error && error.message === 'GEMINI_API_KEY is not set.') {
  code-oz-gui/app/api/helper/ask/route.ts:151:    return 'Gemini helper is not configured.';
  code-oz-gui/app/api/helper/ask/route.ts:197:    console.error('AI helper request failed', error);
  code-oz-gui/components/AIHelper.tsx:57:      const response = await fetch('/api/helper/ask', {
  ```

- **Why it matters for first-run UX:** The GUI should tell a first-time user exactly how to enable the helper; "Gemini helper is not configured" does not name `GEMINI_API_KEY`, and raw SDK errors in server logs are the wrong default for the no-key/no-key-logging contract.
- **Proposed fix:** Change the no-key detail to a one-line setup hint such as `Set GEMINI_API_KEY to enable the Gemini helper.` Replace `console.error('AI helper request failed', error)` with sanitized structured logging that never includes provider SDK request/response objects or auth headers. Add a small route-level regression test by mocking `askGemini` to throw the no-key error and asserting the 503 detail contains `GEMINI_API_KEY` while logs stay sanitized.
- **Effort estimate:** s

### F7.3 - Expired auth is a typed contract value but subprocess providers do not classify it

- **Severity:** fix-soon
- **Where:** `src/providers/types.ts:175`, `src/providers/claude.ts:284`, `src/providers/codex.ts:156`, `docs/references/provider-contract.md:252`
- **Evidence:**

  ```text
  $ rg -n "provider_auth_expired|expired|401|invalid or expired|provider_auth_missing|actionableSuggestions|redact|Bearer|Authorization|XAI_API_KEY" src/providers tests/providers-xai.test.ts tests/providers-xai-redaction.test.ts tests/commands-doctor.test.ts docs/references/provider-contract.md
  src/providers/types.ts:175:export type AuthStatus = 'ok' | 'missing' | 'expired' | 'unsupported' | 'unknown'
  src/providers/claude.ts:296:      'provider_auth_missing',
  src/providers/codex.ts:156:          code: 'provider_auth_missing',
  src/providers/xai.ts:184:          rule: 'xai /v1/models returned 401 (invalid or expired API key)',
  src/providers/xai.ts:294:      'xai endpoint returned 401 (invalid or expired API key)',
  docs/references/provider-contract.md:252:  readonly authStatus: 'ok' | 'missing' | 'expired' | 'unsupported' | 'unknown'
  ```

  Targeted tests covered auth-missing and xAI 401 behavior but not expired Claude/Codex CLI auth text:

  ```text
  $ bun test tests/cli-provider-override.test.ts tests/providers-xai.test.ts tests/providers-xai-redaction.test.ts tests/providers-claude.test.ts tests/providers-codex.test.ts tests/providers-gemini.test.ts tests/commands-doctor.test.ts
  102 pass
  0 fail
  241 expect() calls
  Ran 102 tests across 7 files. [858.00ms]
  ```

- **Why it matters for first-run UX:** If an upstream Claude/Codex CLI returns "token expired" or similar, the current keyword path can surface a generic provider I/O failure instead of the expected re-auth instruction.
- **Proposed fix:** Add RED tests for ClaudeProvider and CodexProvider mocked stderr such as `token expired`, `session expired`, and `invalid api key`. Map explicit expiry text to `provider_auth_expired` with `run <provider> login` remediation, and map invalid/missing login text to `provider_auth_missing`. Keep xAI 401 behavior as-is unless the HTTP body can be safely classified without reading raw upstream content.
- **Effort estimate:** s

## Checked items

- `FakeProvider` itself remains deterministic and offline; the override path aliases every provider id to one shared fake instance while preserving family identity.
- xAI missing key, 401, 403, 429, 5xx, malformed JSON, and wrapper redaction paths have good offline coverage.
- Source search found no runtime reads of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; CLI env-key isolation is strict by absence, but this conflicts with first-run docs that mention those keys.
- GUI helper reads only `GEMINI_API_KEY`; CLI xAI reads only `XAI_API_KEY`.

## Gaps / unchecked

- No live provider calls were made. I did not validate real Claude, Codex, Gemini, or xAI credentials.
- `ANTHROPIC_API_KEY only`, `OPENAI_API_KEY only`, `GEMINI_API_KEY only`, and `XAI_API_KEY only` end-to-end live paths were not executed; source/tests were used instead.
- I did not run the full `code-oz run` lifecycle without keys because the source shows it would use bundled Claude/Codex providers unless `--provider fake` is passed, and live provider calls were out of scope.
- I did not run the GUI helper with a real `GEMINI_API_KEY`; the no-key behavior was audited from source.
- I did not inspect or rely on other workers' untracked handoff docs beyond incidental `rg` output; A1/A3/A4/A5/A6 files were left untouched.

## Commands run

All commands ran from `/Users/ozzy-mac/Projects/code-oz` unless an absolute path is shown.

```text
sed -n '1,220p' /Users/ozzy-mac/.agents/skills/code-review/SKILL.md -> exit 0
rg -n "code-oz|finalize|provider|FakeProvider|GEMINI|ANTHROPIC|OPENAI|XAI|v0\\.20\\.1" /Users/ozzy-mac/.codex/memories/MEMORY.md -> exit 0
git status --short --branch -> exit 0
sed -n '1,260p' CLAUDE.md -> exit 0
sed -n '1,240p' docs/design/ROADMAP.md -> exit 0
sed -n '1,260p' docs/handoffs/2026-05-13-codex-finalize-distribution.md -> exit 0
sed -n '1,220p' README.md -> exit 0
sed -n '1,220p' docs/ABOUT.md -> exit 0
rg -n "Finding template|severity|evidence|proposed fix|A7" docs/handoffs/2026-05-13-codex-finalize-distribution.md -> exit 0
rg --files docs src code-oz-gui | rg -i "provider|providers|anthropic|openai|gemini|xai|aihelper|ai-helper|route|run\\.ts|doctor\\.ts|README|ABOUT|contract" -> exit 0
rg -n "ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|XAI_API_KEY|FakeProvider|Provider|provider|invalid|expired|401|redact|secret|key" src docs code-oz-gui README.md -> exit 0
sed -n '332,360p' docs/handoffs/2026-05-13-codex-finalize-distribution.md -> exit 0
sed -n '1,220p' docs/contracts/PROVIDERS.md -> exit 0
sed -n '1,220p' docs/references/provider-contract.md -> exit 0
sed -n '1,180p' src/providers/types.ts -> exit 0
sed -n '1,260p' src/providers/registry.ts -> exit 0
sed -n '180,340p' src/providers/types.ts -> exit 0
sed -n '1,260p' src/providers/errors.ts -> exit 0
sed -n '1,260p' src/providers/claude.ts -> exit 0
sed -n '1,280p' src/providers/codex.ts -> exit 0
sed -n '1,260p' src/providers/gemini.ts -> exit 0
sed -n '260,520p' src/providers/claude.ts -> exit 0
sed -n '1,340p' src/providers/xai.ts -> exit 0
sed -n '1,260p' src/providers/fake.ts -> exit 0
sed -n '1,260p' src/providers/invoke.ts -> exit 0
sed -n '1,260p' src/cli/fake-provider-warning.ts -> exit 0
sed -n '260,560p' src/providers/invoke.ts -> exit 0
sed -n '260,560p' src/providers/xai.ts -> exit 0
sed -n '1,260p' src/commands/run.ts -> exit 0
sed -n '1,320p' src/commands/doctor.ts -> exit 0
rg -n "providerOverride|--provider|buildProviderRegistry|applyFakeScript|fake|ProviderOverride|parseRunArgs|initRun|runDefine|provider" src/commands/run.ts -> exit 0
rg -n "providers|runDoctorProviders|formatProviders|Provider health|authStatus|actionable|suggest|login|XAI_API_KEY|GEMINI|ANTHROPIC|OPENAI" src/commands/doctor.ts -> exit 0
sed -n '1,260p' src/cli/bootstrap.ts -> exit 0
sed -n '1,220p' src/providers/families.ts -> exit 0
sed -n '1,260p' src/providers/capabilities.ts -> exit 0
sed -n '260,380p' src/commands/run.ts -> exit 0
sed -n '427,640p' src/commands/run.ts -> exit 0
sed -n '640,730p' src/commands/doctor.ts -> exit 0
sed -n '340,380p' src/commands/doctor.ts -> exit 0
sed -n '2360,2385p' src/commands/run.ts -> exit 0
rg --files tests code-oz-gui | rg -i "provider|doctor|xai|gemini|fake|run|helper" -> exit 0
rg -n "ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|XAI_API_KEY|provider_auth_missing|provider_auth_expired|expired|invalid|401|redact|fake provider|--provider fake|no key|missing key|doctor providers|AIHelper" tests code-oz-gui src/providers src/commands docs/references docs/contracts README.md -> exit 0
sed -n '1,260p' code-oz-gui/app/api/helper/ask/route.ts -> exit 0
sed -n '1,260p' code-oz-gui/lib/gemini-server.ts -> exit 0
sed -n '1,260p' code-oz-gui/components/AIHelper.tsx -> exit 0
sed -n '1,340p' tests/providers-xai.test.ts -> exit 0
sed -n '340,520p' tests/providers-xai.test.ts -> exit 0
sed -n '1,260p' tests/providers-xai-redaction.test.ts -> exit 0
sed -n '1,300p' tests/commands-doctor.test.ts -> exit 0
sed -n '1,220p' tests/cli-provider-override.test.ts -> exit 0
sed -n '260,560p' tests/providers-xai-redaction.test.ts -> exit 0
sed -n '1,280p' tests/providers-claude.test.ts -> exit 0
sed -n '220,300p' tests/providers-codex.test.ts -> exit 0
sed -n '1,120p' code-oz-gui/README.md -> exit 0
rg -n "AIHelper|GEMINI_API_KEY|helper-unavailable|Gemini helper|askGemini|/api/helper/ask" code-oz-gui tests -> exit 0
sed -n '1,260p' code-oz-gui/app/api/run/start/route.ts -> exit 0
sed -n '1,260p' code-oz-gui/lib/code-oz-spawn.ts -> exit 0
sed -n '120,220p' code-oz-gui/scripts/capture-screenshots.ts -> exit 0
rg --files code-oz-gui | rg -i "test|spec|e2e" -> exit 0
sed -n '260,560p' code-oz-gui/lib/code-oz-spawn.ts -> exit 0
sed -n '1,260p' code-oz-gui/tests/e2e/happy-path.e2e.ts -> exit 0
rg -n "^provider:|^model:|name:" src/agents/defaults/*.md -> exit 0
rg -n "company:|provider:|xai|codex|claude|fake|GEMINI|ANTHROPIC|OPENAI|XAI" src/config docs contracts .code-oz README.md code-oz-gui/.env.example -> exit 2 (included a nonexistent path named contracts)
sed -n '245,360p' docs/references/provider-contract.md -> exit 0
sed -n '500,560p' docs/references/provider-contract.md -> exit 0
sed -n '280,345p' src/config/schema.ts -> exit 0
sed -n '223,520p' src/config/load.ts -> exit 0
bun test tests/cli-provider-override.test.ts tests/providers-xai.test.ts tests/providers-xai-redaction.test.ts tests/providers-claude.test.ts tests/providers-codex.test.ts tests/providers-gemini.test.ts tests/commands-doctor.test.ts -> exit 0
rg -n "buildProviderRegistry\\(|parseProviderOverride|--provider only accepts|providerOverride === 'fake'|No API keys required|FakeProvider|Cost-free demo|GEMINI_API_KEY|Gemini helper is not configured|GEMINI_API_KEY is not set|console\\.error\\('AI helper request failed'|safeErrorDetail|ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY" src/commands/run.ts src/cli/bootstrap.ts README.md docs/ABOUT.md docs/contracts/PROVIDERS.md docs/references/provider-contract.md code-oz-gui/README.md code-oz-gui/app/api/helper/ask/route.ts code-oz-gui/lib/gemini-server.ts code-oz-gui/components/AIHelper.tsx -> exit 0
rg -n "ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY|GEMINI_API_KEY|process\\.env" src/providers src/commands code-oz-gui/lib code-oz-gui/app/api code-oz-gui/components -> exit 0
rg -n "provider_auth_expired|expired|401|invalid or expired|provider_auth_missing|actionableSuggestions|redact|Bearer|Authorization|XAI_API_KEY" src/providers tests/providers-xai.test.ts tests/providers-xai-redaction.test.ts tests/commands-doctor.test.ts docs/references/provider-contract.md -> exit 0
git status --short --branch -> exit 0
date -u +%Y-%m-%dT%H:%M:%SZ -> exit 0
```
