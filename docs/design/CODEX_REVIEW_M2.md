# code-oz — M2 Codex review

- **Round:** Implementation review (CLAUDE.md rule 8)
- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019dda83-de73-7410-92c6-7df0fa27e9f8`
- **Branch reviewed:** `feat/m2-agent-loader` (head `ce733c0`, seven commits)
- **Verdict:** `fix-first`

Verbatim reply below.

---

## Findings

- `block-push` Cross-family review is not enforced by the loader. The pinned spec says the loader enforces REVIEW being a different provider family from BUILD, but `buildRegistry()` only rejects same-name overrides when `type` or `phase` changes, not `provider`: [src/agents/loader.ts](/Users/ozzy-mac/Projects/code-oz/src/agents/loader.ts:63). The tests also explicitly allow provider changes on overrides: [tests/agents-loader.test.ts](/Users/ozzy-mac/Projects/code-oz/tests/agents-loader.test.ts:124). I reproduced `builder=claude` and `reviewer=claude` loading successfully.

- `block-push` If the next action is tagging `v0.2.0-alpha.0`, release metadata still reports `0.1.0-alpha.0`: [package.json](/Users/ozzy-mac/Projects/code-oz/package.json:3), [src/cli.ts](/Users/ozzy-mac/Projects/code-oz/src/cli.ts:6), [src/config/schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:36). Tagging v0.2 with a binary/config that self-identifies as v0.1 is a release-blocking mismatch.

- `block-m3` Per-file I/O failures inside `.code-oz/agents` can escape as raw filesystem errors instead of typed `AgentLoadError`. `lstat`, `realpath`, and `readFile` are outside a wrapping `try/catch`: [src/agents/loader.ts](/Users/ozzy-mac/Projects/code-oz/src/agents/loader.ts:118). Broken symlinks or unreadable files would violate the "typed error citing file path/rule" contract.

- `block-m3` Privacy rule 13 is not broken in M2 because no provider context is sent yet, but all bundled personas declare `read: '*'` while the durable rule requires explicit file manifests, not silent recursive context. M3 must interpret permissions as an upper bound, not as "send the repo": [CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:31), [src/agents/defaults/builder.md](/Users/ozzy-mac/Projects/code-oz/src/agents/defaults/builder.md:8).

## Confirmations

- `AgentLoadError` in `src/agents/errors.ts` is the right departure. It keeps commit 1 self-contained and preserves the single typed error path with machine-readable issues.

- Asset imports in `src/agents/bundled-defaults.ts` are the right departure. `loader.ts` stays pure, and the Bun-specific embedding path is isolated. Official Bun docs still support `with { type: "file" }` returning a path readable through `Bun.file()`, and Bun's bundler performs tree shaking, so the M3 liveness deferral is acceptable if M3 imports `loadBundledDefaults()` from a CLI path. Sources: https://bun.sh/docs/bundler/executables and https://bun.sh/docs/bundler.

- The planning pushbacks are mostly implemented: no `Bun.embeddedFiles` registry, missing project dir becomes empty overrides, invalid project-local files fail fast, same-name override rejects phase/type mismatch, BOM and CRLF are covered, duplicate YAML keys are rejected, and defaults are validated through the same schema.

- The five default personas meet the schema, are clearly marked as v0.1 stubs, and set default BUILD/REVIEW providers to different families. `permissions.bash: deny` honors rule 9 for M2.

- `bun run typecheck` passed. `bun test` could not be fully verified in this read-only sandbox: 87 tests passed, then all temp-dir tests failed with `EPERM` on `mkdtemp()`. That is sandbox interference, not a code failure signal.

## Verdict

fix-first

Land the two `block-push` fixes before tag: enforce cross-family BUILD/REVIEW provider separation in the loader or update the pinned spec deliberately, and bump release metadata if tagging `v0.2.0-alpha.0`.

---

## Re-review (after fix commits 9283271 and 325a57c)

- **Date:** 2026-04-29
- **Thread ID:** `019dda93-3892-78d3-8c97-1c20ec5e77ca`
- **Verdict:** `push`

Verbatim reply below.

### Confirmations

- #1 cross-family: Confirmed, `enforceCrossFamilyReview()` runs after merge, rejects every same-provider BUILD/REVIEW pair, and the direct `builder=claude`/`reviewer=claude` repro returns `loader_cross_family_violation`.
- #2 version: Confirmed, `package.json`, `src/cli.ts`, `src/config/schema.ts`, and `./dist/code-oz --version` all report `0.2.0-alpha.0`; no live runtime/config version surface still self-identifies as `0.1.0-alpha.0`.
- #3 I/O wrapping: Confirmed, `readdir`, `lstat`, `realpath`, and `readFile` are wrapped through `wrapIO`, with cwd-relative paths and specific rule messages; the broken-symlink test exists, though full temp-dir execution is sandbox-blocked.
- #4 permissions doc: Confirmed, the permissions section is unambiguous that `read`/`write` are upper bounds, not context generators, and `src/agents/schema.ts` cross-references the spec.

### Remaining issues

None found. `fyi`: full `bun test` still hits read-only sandbox `EPERM` on `mkdtemp` after 92 passes; `bun run typecheck`, `./dist/code-oz --version`, and targeted cross-family tests passed.

### Verdict

push

The four prior findings are closed, and the only validation gap is the expected read-only temp-dir sandbox limitation.
