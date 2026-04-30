# code-oz — M4 Codex implementation review

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019ddbb7-f90a-7c20-a53a-5ef0f4cda7e6`
- **Branch reviewed:** `feat/m4-providers`
- **Commit range:** `main..1542c1f` (12 commits — 10 base feat + 2 docs)

Verbatim reply below.

---

Verdict: fix-first. The main implementation shape is good, but I found release-blocking issues in Claude subprocess privacy, global budget enforcement, version metadata, and the canonical provider contract.

## Where I agree

- Cross-family enforcement is implemented correctly in [src/tools/review-request.ts](../../src/tools/review-request.ts:60). It uses `ctx.registry.familyOf()` for both sides and takes `buildProvider` explicitly. I do not see event-log inference.

- The provider wrapper has the intended lock shape in [src/providers/invoke.ts](../../src/providers/invoke.ts:94): short pre-call lock, unlocked adapter stream, short post-call lock. `recordIntervention` writes the gate then appends `intervention` under one lock at [src/providers/invoke.ts](../../src/providers/invoke.ts:193).

- Manifest path safety and permission intersection are mostly right. [src/providers/manifest.ts](../../src/providers/manifest.ts:152) rejects empty paths, backslashes, and `..` before normalization, then realpath-checks symlink escape. [src/providers/manifest.ts](../../src/providers/manifest.ts:242) treats `permissions.read` as an upper-bound check, not a generator.

- Token provenance is right in [src/providers/invoke.ts](../../src/providers/invoke.ts:151): `tokensUsed` is only copied from `turn_completed.response.tokensUsed`. The FIFO estimate/actual pairing in [src/providers/cost.ts](../../src/providers/cost.ts:72) matches the locked M4 budget-accounting rule.

- Open event validation is right in [src/state/events.ts](../../src/state/events.ts:101): unknown v1 event types pass envelope validation, while known types still get strict per-type validation.

## Where I disagree

- `block-push` - `ClaudeProvider` inherits the caller's cwd, so the Claude subprocess can load project context outside the explicit manifest. [src/providers/claude.ts](../../src/providers/claude.ts:41) calls the runner with only `{ stdin }`; no empty temp cwd, no cleanup, no `--no-session-persistence`. [docs/contracts/PROVIDERS.md](../contracts/PROVIDERS.md:65) says Claude does not need analogous guards, but Anthropic's docs say Claude Code loads `CLAUDE.md` files from the working-directory hierarchy at session start, and the CLI supports `--no-session-persistence` for print mode: [memory docs](https://code.claude.com/docs/en/memory), [CLI reference](https://code.claude.com/docs/en/cli-reference). Specific fix: mirror the Codex adapter's temp-cwd pattern for Claude, pass `cwd`, clean it in `finally`, add `--no-session-persistence`, and add privacy tests proving no project cwd is used.

- `block-push` - Global budget caps are configured and documented but not enforced. [docs/references/provider-contract.md](../references/provider-contract.md:181) says global `maxTurns`, `maxProviderCalls`, and `maxTokensEstimate` are checked. [src/providers/cost.ts](../../src/providers/cost.ts:44) only tracks `perPhaseTurns` and `perPhaseProviderCalls`, and [src/providers/cost.ts](../../src/providers/cost.ts:154) only checks per-phase turns/calls plus global tokens. Specific fix: add `globalTurns` and `globalProviderCalls` to `BudgetCounts`, count all `phase_entered` and `agent_invoked` events, enforce `global.maxTurns` and `global.maxProviderCalls`, and add tests where per-phase caps pass but global caps fail.

- `block-push` - Release metadata is inconsistent. [src/cli.ts](../../src/cli.ts:7) and [src/config/schema.ts](../../src/config/schema.ts:51) say `0.4.0-alpha.0`, but [package.json](../../package.json:3) still says `0.3.0-alpha.0`. A `v0.4.0-alpha.0` tag with package metadata still on M3 is not release-clean. Specific fix: bump `package.json` and add a small version consistency test or release checklist check.

- `block-push` - The canonical provider contract still describes the pre-subprocess auth design. [docs/references/provider-contract.md](../references/provider-contract.md:14) says adapters read auth files opportunistically; [docs/references/provider-contract.md](../references/provider-contract.md:231) says `ClaudeProvider` and `CodexProvider` read `~/.claude/auth.json` / `~/.codex/auth.json`. That contradicts the locked Path A_revised and the actual adapters. Specific fix: rewrite that section to say v0.1 auth is delegated to the CLIs, health probes are `claude --version` and `codex login status`, and code-oz never reads CLI auth token files directly.

## What's missing

- `nit` - Codex does not pass `--color never`. [docs/design/CODEX_RESPONSE_M4_ADAPTERS.md](./CODEX_RESPONSE_M4_ADAPTERS.md:35) locked it, but [src/providers/codex.ts](../../src/providers/codex.ts:66) only passes `--skip-git-repo-check`, `--sandbox read-only`, and `--ephemeral`. Not a privacy blocker, but it is cheap to add and prevents ANSI noise in buffered stdout/stderr.

- `nit` - Doctor help text is stale. [src/commands/doctor.ts](../../src/commands/doctor.ts:171) says that without `.code-oz/`, required-provider gating is disabled and exit is always 0. The current implementation and test expectation load bundled defaults even without project init, so `claude` and `codex` are still required. Remove that paragraph or reword it to match [tests/commands-doctor.test.ts](../../tests/commands-doctor.test.ts:59).

- `fyi` - I could verify `bun run typecheck` and `bun run dev --version`; both are clean, and the version command prints `0.4.0-alpha.0`. I could not independently rerun the targeted M4 tests in this read-only sandbox because every temp-dir test hit `EPERM` on `mkdtemp`, which matches the prior review environment limitation.

## Verdict

fix-first. The core M4 shape is strong, but the Claude adapter currently violates the explicit-manifest privacy model, global budget caps are incomplete, and release/spec metadata are inconsistent. Those are not debate items.

**fix-first**

---

## Claude synthesis (post-review)

Per CLAUDE.md rule 9: Codex's verdict judged below. **Adopting all four block-push findings + both nits in a single fix commit.** Per `~/.claude/projects/.../memory/feedback_no_tech_debt.md` (no tech debt at milestone close): all block-push must close in-milestone, and the user explicitly prefers nits also close before tag rather than defer.

### Severity-by-severity action plan

| # | Finding | Severity | Adopted? | Action |
|---|---|---|---|---|
| 1 | Claude subprocess inherits cwd; can load CLAUDE.md outside manifest | block-push | Yes | Mirror Codex adapter: empty temp cwd via `mkdtemp` + cleanup in `finally` + add `--no-session-persistence` flag (verified in `claude --help`) + 3 new privacy tests |
| 2 | Global budget caps not enforced (only per-phase) | block-push | Yes | Extend `BudgetCounts` with `globalTurns` + `globalProviderCalls`; count phase_entered + agent_invoked across all phases; enforce in `assertWithinBudget` with named actionable suggestions; add 2 new tests |
| 3 | `package.json` version drift (0.3 vs 0.4) | block-push | Yes | Bump to `0.4.0-alpha.0`; add a tiny consistency test that asserts `package.json.version === DEFAULT_CONFIG.version === PKG_VERSION` |
| 4 | `provider-contract.md` describes pre-subprocess auth | block-push | Yes | Rewrite the auth + adapter sections to reflect Path A_revised: subprocess delegation; no auth-file reads; health via CLI's own status |
| 5 | Codex missing `--color never` flag | nit | Yes | Add the flag (cheap; locked in CODEX_RESPONSE_M4_ADAPTERS.md) |
| 6 | Doctor help text describes unreachable degraded mode | nit | Yes | Reword the paragraph to match observed behavior (bundled defaults always load) |

### Where I'd push back on Codex

None. Each finding is concrete, citable to a file:line, and the fix path is clear. The Claude privacy gap is the most embarrassing miss — I literally wrote in `PROVIDERS.md` that "the Claude adapter doesn't need analogous flags because `claude --print` operates on stdin only and doesn't recursively scan its cwd," which is wrong: Claude Code's CLAUDE.md hierarchy auto-discovery walks the cwd at session start. Codex caught it; I'd missed it.

### Plan

One fix commit per CLAUDE.md rule 8 + `feedback_no_tech_debt.md`:

**`fix(m4): close codex review block-push findings + nits`**

After the fix commit, re-invoke Codex review on the new commit only. If clean, present to Ozzy for tag/push approval.

Approval pending from Ozzy after fix commit lands and re-review is clean.

---

## Codex re-review — fix verification

- **Same thread:** `019ddbb7-f90a-7c20-a53a-5ef0f4cda7e6`
- **Date:** 2026-04-29
- **Commits reviewed:** `c4849ee` (review doc) + `6404c00` (fix bundle)
- **Verdict:** **`push`**

### Where I agree (fix verification — verbatim)

- Claude subprocess privacy is closed. [src/providers/claude.ts](../../src/providers/claude.ts:63) now includes `--no-session-persistence`, uses a `tempCwd` factory backed by `mkdtemp`, runs the subprocess with that cwd, and removes it in `finally` at [src/providers/claude.ts](../../src/providers/claude.ts:72). The ENOENT path still passes through that `finally`. The new assertions in [tests/providers-claude.test.ts](../../tests/providers-claude.test.ts:240) cover cwd isolation, the flag, success cleanup, and failure cleanup.

- Global budget caps are closed. [src/providers/cost.ts](../../src/providers/cost.ts:44) adds `globalTurns` and `globalProviderCalls`; [src/providers/cost.ts](../../src/providers/cost.ts:88) counts them across all phases; [src/providers/cost.ts](../../src/providers/cost.ts:177) and [src/providers/cost.ts](../../src/providers/cost.ts:193) enforce the global turn and provider-call caps with specific config suggestions. The new cost tests cover both counting and rejection paths.

- Version metadata consistency is closed. [package.json](../../package.json:3) is `0.4.0-alpha.0`, [src/cli.ts](../../src/cli.ts:7) exports `PKG_VERSION`, and [src/cli.ts](../../src/cli.ts:67) guards `main()` with `import.meta.main`. [tests/version-consistency.test.ts](../../tests/version-consistency.test.ts:11) now catches drift between package metadata, CLI metadata, and default config.

- Provider contract docs are closed. [docs/references/provider-contract.md](../references/provider-contract.md:14) now says adapters delegate auth to upstream CLIs and do not read or transmit OAuth tokens; [docs/references/provider-contract.md](../references/provider-contract.md:229) replaces the old auth-file framing with the subprocess delegation model. [docs/contracts/PROVIDERS.md](../contracts/PROVIDERS.md:50) now documents privacy guards for both Codex and Claude.

- Both nits are closed. [src/providers/codex.ts](../../src/providers/codex.ts:66) passes `--color never`, and [src/commands/doctor.ts](../../src/commands/doctor.ts:171) has the clearer provider-doctor help text.

### Where I disagree

No remaining `block-push` or `block-next-milestone` disagreements found in the fix commit.

### What's missing

No new milestone-blocking issues introduced by the fix. Validated in the read-only sandbox:

```text
bun run typecheck
bun test tests/providers-cost.test.ts tests/version-consistency.test.ts
bun run dev --version
```

Those passed, and `bun run dev --version` reports `0.4.0-alpha.0`.

### Final verdict

**`push`** — M4 is ready to tag.
