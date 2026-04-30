# code-oz — M5 Codex implementation review

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-30
- **Thread ID:** `019ddc1d-d8ec-7032-966d-62679dd035ed`
- **Briefing context:** [`CODEX_BRIEFING_M5.md`](./CODEX_BRIEFING_M5.md), [`CODEX_RESPONSE_M5.md`](./CODEX_RESPONSE_M5.md)
- **HEAD reviewed:** `97a5ca2` on `feat/m5-define`

Verbatim reply below.

---

Implementation review result: `fix-first`. The main DEFINE implementation follows the locked M5 shape, but current HEAD is not tag-ready.

1. Severity: `block-push`
Location: [src/cli.ts](/Users/ozzy-mac/Projects/code-oz/src/cli.ts:7), [package.json](/Users/ozzy-mac/Projects/code-oz/package.json:3), [src/config/schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:85)
Issue: The release surfaces still report `0.4.0-alpha.0`. Tagging this commit as `v0.5.0-alpha.0` would ship a binary/config/package that self-identifies as M4. This is the same class M4 review blocked.
Recommendation: Bump `PKG_VERSION`, `package.json.version`, `DEFAULT_CONFIG.version`, and any fixed test expectations to `0.5.0-alpha.0` before tagging.

2. Severity: `block-push`
Location: [src/commands/approve.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/approve.ts:126), [src/commands/run.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/run.ts:415), [src/phases/define.ts](/Users/ozzy-mac/Projects/code-oz/src/phases/define.ts:187)
Issue: `runDefine` itself does not write invalid `SPEC.md`, but approval can still bind an invalid or stale `SPEC.md`. `approve define` never runs `parseSpec` before `approveGate`, while `SPEC.md` is intentionally user-editable before approval. Also, `run` treats bare existence of global `.code-oz/artifacts/SPEC.md` as proof the active DEFINE run is awaiting approval, even if that file is stale from an older run or a failed restart.
Recommendation: Before approving `define`, validate the target artifact with `parseSpec`. Also make "awaiting DEFINE approval" depend on current-run state, for example a `gate_required` event for `define`, not just `SPEC.md` existence. Failure/intervention paths should not leave a stale canonical artifact looking approvable for the current run.

3. Severity: `block-push`
Location: [src/commands/run.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/run.ts:104), [src/commands/run.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/run.ts:115), [src/commands/run.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/run.ts:305), [src/commands/run.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/run.ts:330)
Issue: `code-oz run` initializes a run and writes `active.json` before validating the input source. Missing `--request-file`, empty transcript fixtures, and non-TTY no-input paths can exit with code 2 after creating an active DEFINE run with no useful user input and no `SPEC.md`. That pollutes state on a CLI preflight error and blocks the next run.
Recommendation: Build and validate the input source, including turn 0, before `initRun`. Only create `active.json` after all CLI/input preflights pass. Add regression tests that assert failed preflight leaves no active run.

4. Severity: `block-next-milestone`
Location: [src/providers/claude.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/claude.ts:80), [src/providers/codex.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/codex.ts:94), [src/phases/ask-me.ts](/Users/ozzy-mac/Projects/code-oz/src/phases/ask-me.ts:434), [src/state/events.ts](/Users/ozzy-mac/Projects/code-oz/src/state/events.ts:291)
Issue: Empty provider content can escape as a successful `turn_completed`, then `ask_me_persona_reply` validation rejects the empty `response` and throws a state/event error instead of producing actionable `NEEDS_INTERVENTION`. That violates the provider-failure discipline for a malformed provider response.
Recommendation: In `invokeAgent` or each adapter, convert empty successful provider output into `ProviderError` with `provider_malformed_response`, so the wrapper writes `NEEDS_INTERVENTION` consistently.

No blocker found in the exact-line ready-token extraction, prompt-only conversation transport, fake provider family aliasing, `fieldsRemovedByScope` behavior, ask-me event validators, or `requireGate` idempotency.

Validation: `bun run typecheck` passed. I could not rerun the targeted temp-dir tests in this read-only sandbox because `mkdtemp` fails with `EPERM`, so I did not use those failures as implementation evidence.

Verdict: `fix-first` - must close findings 1, 2, 3, and 4 before tagging `v0.5.0-alpha.0`.

---

## Round 2 (re-review of `0246039`)

- **Thread ID:** `019ddc2a-f30c-7db0-b562-cba164da4180`
- **Date:** 2026-04-30
- **HEAD reviewed:** `0246039`

Round 1 findings 1, 3, and 4 confirmed closed. Three new block-* findings surfaced:

A. `block-push` — `approve define --artifact` reads the artifact before the gate path-safety checks. A malicious `--artifact ../../etc/passwd` would be read+parsed before approveGate's later realpath check.
   Recommendation: reuse / export gates.ts's path resolver so approve.ts validates the path before readFile.

B. `block-push` — Direct `approve define` can still bind a stale valid SPEC.md from another run. `runApprove` only checks the current phase + parseSpec; if a new DEFINE run fails before runDefine reaches requireGate while an old valid `.code-oz/artifacts/SPEC.md` exists, approve will parse and bind the old artifact for the new run.
   Recommendation: require a current-run `gate_required` event for the target phase before approval.

C. `block-next-milestone` — The empty-content guard at src/providers/invoke.ts:151 is too broad. The provider contract models `stopReason: 'tool_use'`, `tool_call` events, and optional `response.toolCalls`; a legitimate tool-only turn has empty assistant prose. M5 DEFINE is text-only but M7 BUILD/tool orchestration will need this.
   Recommendation: allow empty content when `stopReason === 'tool_use'` or `toolCalls` is non-empty.

Verdict: `fix-first`.

Closed in `c31fe0e`:
- A: `_validateArtifactSyncPath` reused in approve.ts before readFile
- B: gate_required event check added before parseSpec validation; all test fixtures emit one
- C: carve-out for stopReason 'tool_use' OR non-empty toolCalls

542 / 542 tests passing after the round-2 fix.
