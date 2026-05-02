# W3-lite dispatch contract

## Header

- **What this is:** Execution-template contract for Ralph-loop Codex sub-agent dispatches on W3-lite.
- **Status:** Execution template only. It defers to `docs/contracts/W3_LITE_SCOPE.md` for W3-lite scope and to `CLAUDE.md` for repo rules.
- **Date:** 2026-05-02.
- **Branch:** `feat/w3-lite-demo`.
- **Authority:** This file is not a new authority boundary.

## Codex sub-agent permissions

Codex sub-agents may read:

- Any file in this repo.

Codex sub-agents may write:

- `scripts/**`
- `dist/**`
- `tests/**`
- `docs/contracts/W3_LITE_*.md`
- `docs/research/CODEX_*W3_LITE*.md`
- `package.json`, only the specific keys named in the phase plan. For Phase 2 this means the `scripts.build:binaries` alias only.
- `.code-oz/state/ralph-state.md`

Codex sub-agents may run:

- `bun test`
- `bun run typecheck`
- `bun run build:binaries`
- `bun build --compile`
- `git status`
- `git diff`
- `git add`
- `git commit`
- `sh -n`
- `bash -n`
- `shellcheck`, if installed
- `file`
- `shasum`
- `chmod`
- `mkdir`
- `cp`
- `mv`
- `rm`, within `dist/**` only
- `tar`
- `xattr`

Codex sub-agents must not run:

- `git push`
- `git fetch`
- `git pull`
- `git tag`
- `git merge`
- `git checkout main`
- `gh *`
- `npm publish`
- `npm install <pkg>`, for any new production dependency
- `brew *`
- `scoop *`
- Any command that touches a network beyond what `bun build --compile` already does

Codex sub-agents must not write:

- `src/**`
- `CLAUDE.md`
- `docs/design/ROADMAP.md`
- `docs/design/SESSION_CYCLE.md`
- `.gitignore`, frozen after launch prep plus this commit
- Any contract under `docs/contracts/` other than `W3_LITE_*.md`
- Any persona prompt under `src/prompts/**`

Foreign-drift handling:

- `.claude/` Ralph host state is not foreign drift. This checkout ignores the Ralph host state files at `.gitignore` lines 32-34.
- `dist/` is ignored at `.gitignore` line 2. Local build artifacts under `dist/` are not drift.
- If `git status` shows files modified outside the allowed write set and not gitignored, halt and write `.code-oz/state/RALPH_HALT.md`. Do not write repo-root `RALPH_HALT.md`.

## Universal anti-slop import

Every dispatch prompt MUST quote (verbatim or by file reference) `src/prompts/universal-rules.md` per CLAUDE.md rule 16 (universal anti-slop, line 38). Sub-agents may add their own rules below; they may not relax the universal ones.

The orchestrator uses this exact wording in every Codex dispatch:

```text
Universal rule sheet import:
Read `src/prompts/universal-rules.md` before acting. This file is imported by reference under CLAUDE.md rule 16, universal anti-slop, at line 38. Your task-specific rules are additive only; they may not relax or override the universal rule sheet.
```

The file exists in this checkout at `src/prompts/universal-rules.md`. If a future checkout lacks that path, flag it as a separate fix-soon item for morning review before implementation continues.

## R1 review lens: behavioral correctness

Phase 6 R1 dispatch uses this exact prompt shape:

```text
You are Codex, dispatched for W3-lite Phase 6 R1 implementation review.

Universal rule sheet import:
Read `src/prompts/universal-rules.md` before acting. This file is imported by reference under CLAUDE.md rule 16, universal anti-slop, at line 38. Your task-specific rules are additive only; they may not relax or override the universal rule sheet.

Read first:
- `CLAUDE.md`
- `docs/contracts/W3_LITE_SCOPE.md`
- `docs/contracts/W3_LITE_DISPATCH.md`
- `docs/research/CODEX_RESPONSE_W3_LITE.md`
- Latest implementation diff on branch `feat/w3-lite-demo`

Review lens:
Focus on behavioral correctness. Check target mapping, partial build cleanup, executable bits, manifest hash accuracy, shell idempotency, PATH messages, tempdir isolation, and smoke-test failure behavior.

Do not focus on broad doc consistency. Defer doc-consistency and contract-drift review to R2 unless a doc mismatch directly causes a behavioral bug.

Return:
- Verdict: `push`, `fix-first`, or `debate-required`
- Findings grouped as `block-push`, `fix-soon`, `nit`, and `fyi`
- File and line references for every finding
- Exact verification commands you ran
```

## R2 review lens: contract drift and doc consistency

Phase 8 R2 dispatch uses this exact prompt shape. R2 runs even if R1 was clean.

```text
You are Codex, dispatched for W3-lite Phase 8 R2 implementation review.

Universal rule sheet import:
Read `src/prompts/universal-rules.md` before acting. This file is imported by reference under CLAUDE.md rule 16, universal anti-slop, at line 38. Your task-specific rules are additive only; they may not relax or override the universal rule sheet.

Read first:
- `CLAUDE.md`
- `docs/contracts/W3_LITE_SCOPE.md`
- `docs/contracts/W3_LITE_DISPATCH.md`
- `docs/research/CODEX_RESPONSE_W3_LITE.md`
- `feedback_canonical_doc_precedence_chain.md`, if present in repo memory or project docs
- Latest implementation diff on branch `feat/w3-lite-demo`

Review lens:
Focus on contract drift and doc consistency. Check `W3_LITE_SCOPE.md` against the shipped layout, manifest writer fields against install and smoke reader fields, bundle README text against actual install behavior, rule-number references against current `CLAUDE.md` using rule names plus line numbers instead of stale numeric shorthand, no accidental W3.1 claims, and the canonical doc precedence chain per `feedback_canonical_doc_precedence_chain.md`.

Return:
- Verdict: `push`, `fix-first`, or `debate-required`
- Findings grouped as `block-push`, `fix-soon`, `nit`, and `fyi`
- File and line references for every finding
- Exact verification commands you ran
```

## Implementation iteration template

Phase 2, Phase 3, Phase 4, and Phase 5 implementation dispatches use this shape:

```text
You are Codex, dispatched as a W3-lite Ralph-loop sub-agent for {{phase}}.

Universal rule sheet import:
Read `src/prompts/universal-rules.md` before acting. This file is imported by reference under CLAUDE.md rule 16, universal anti-slop, at line 38. Your task-specific rules are additive only; they may not relax or override the universal rule sheet.

Goal:
{{goal}}

Read before editing:
- `CLAUDE.md`
- `docs/contracts/W3_LITE_SCOPE.md`
- `docs/contracts/W3_LITE_DISPATCH.md`
- `docs/research/CODEX_RESPONSE_W3_LITE.md`
- Any file you will edit

Files to create:
{{files_to_create}}

Files to modify:
{{files_to_modify}}

Tests to add:
{{tests_to_add}}

Verification command:
{{verify_command}}

Commit subject:
{{commit_subject}}

Constraints:
- Stay inside the W3-lite write set from `docs/contracts/W3_LITE_DISPATCH.md`.
- Do not edit `src/**`, `CLAUDE.md`, `docs/design/ROADMAP.md`, `docs/design/SESSION_CYCLE.md`, `.gitignore`, or persona prompts.
- Do not push, fetch, pull, tag, merge, run `gh`, publish packages, install new production dependencies, or start network installer work.
- If a requested fix crosses those boundaries, stop and write `.code-oz/state/RALPH_HALT.md`.
```

## Halt-and-iterate triage rules

The orchestrator iterates with a next sub-agent dispatch when the failure is closeable inside W3-lite:

- Test expectation mismatch in new W3-lite tests.
- `sh -n` or `shellcheck` failure.
- Manifest parser bug.
- README mismatch.
- Missing executable bit.
- Smoke tempdir cleanup.
- R1 or R2 fix-first finding with no block-push.

The orchestrator halts and writes `.code-oz/state/RALPH_HALT.md` when the failure crosses a locked boundary:

- New production dependency request.
- `src/` change request.
- Tag, merge, push, or `gh` use.
- External repo or account work.
- Version bump.
- Package publish.
- Linux or Windows target work.
- Network installer work.
- 2086 baseline regression.
- `debate-required`.
- Unresolved block-push after the fix path.
- Foreign uncommitted drift, excluding gitignored host state.
- Bun darwin-x64 toolchain failure that is not a script bug.

## `.code-oz/state/RALPH_HALT.md` schema

When the loop halts, write `.code-oz/state/RALPH_HALT.md` with this schema:

````markdown
# Ralph halt

- Phase reached: <phase number and name>
- Command that failed: `<full command>`
- Halt classification: <scope | toolchain | test regression | review | state drift>
- Latest commit SHA: `<sha>`
- Morning-action-required: <yes | no> - <short action>

## Last output

```text
<last 20-50 lines of output>
```

## Files changed since launch

- <path>
````

Use the `.code-oz/state/RALPH_HALT.md` path only. Do not write repo-root `RALPH_HALT.md`.

## Closing

`docs/contracts/W3_LITE_SCOPE.md` remains canonical for W3-lite in-scope and out-of-scope boundaries. `CLAUDE.md` remains canonical for all 21 repo rules. This execution template does not claim authority over either file.
