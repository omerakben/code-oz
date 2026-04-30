# Response — M7 BUILD-lite implementation

**Thread:** `019ddeea-d94b-74e0-8d02-133f65a49d90`
**Date:** 2026-04-30
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** [`CODEX_BRIEFING_M7.md`](./CODEX_BRIEFING_M7.md)

---

## Verdict on the decisions

1. **accept-with-modifications.** Use the file-artifact path, not provider tool-call patching. Modification: do not ask the persona to precompute a full `BUILD_REPORT.md` with patch hash and post-patch file hashes before the patch is applied. Use a `<build-ready/>` protocol with exactly one fenced `diff` block plus a small report-input block for persona-owned text. The orchestrator writes the patch file, computes patch sha/byte count, applies it, computes the changed-file manifest, copies the validation command from the selected PLAN task, then serializes and validates canonical `BUILD_REPORT.md`. Persona-supplied base, patch hash, and manifest fields are claims to cross-check, not authority.

2. **accept-with-modifications.** Lazy creation on BUILD entry is right. Run the git version check immediately before worktree creation and from `doctor`; if it fails, preserve DEFINE/PLAN artifacts and write `NEEDS_INTERVENTION`. Do not create worktrees for runs that intentionally stop at PLAN.

3. **accept-with-modifications.** Defer `src/tools/test-runner.ts` to M8. Do not ship a parser-only runner. M7 still must strictly validate the `## Validation command` bullets inside `src/artifacts/build-report.ts`: command present, working directory is the run worktree, timeout is a positive bounded integer, expected exit code is an integer. That is artifact validation, not an execution abstraction.

4. **reject.** Unit-only forensics coverage is too weak. Add a synthetic integration test that creates a temp git repo/worktree, mutates it, calls the forensics writer with fake stdout/stderr/prompt constraints, removes the worktree, and asserts all required files survived. This does not require VERIFY runtime and catches the ordering bug where the worktree is destroyed before diff capture.

5. **accept.** Keep 3 new hypotheses and 3 new questions per BUILD attempt. Count only new IDs after diffing the prior sidecars, not total sidecar length. Do not add a config knob in M7.

6. **reject.** Keep `builder.md` closer to 3.5-4.5k and put the heavy output grammar in `build-system.md`. The composed prompt can be larger because it includes universal rules and the system template, but the persona body should not duplicate the whole BUILD contract. Include one compact worked output example instead of more prose.

7. **reject.** Use 2 total protocol/report attempts, not 3, and do not make it config-driven in M7. More important: do not let report repair become a hidden patch loop. If the patch fails `git apply --check`, M7 should fail the BUILD attempt with draft artifacts and `NEEDS_INTERVENTION`; M8 owns productive restart after VERIFY evidence.

8. **accept.** Version-only doctor scope is correct for M7. Orphan detection and cleanup belong to `code-oz prune` or W2. Adding age heuristics now is not worth the new policy surface.

9. **accept-with-modifications.** Extend the existing `greenfield-baby-name` path rather than creating `greenfield-web`. Keep BUILD-specific FakeProvider responses in the e2e test or a fixture helper; do not preempt M9's canonical fixture name.

10. **accept-with-modifications.** Trust `git apply --check` for hunk grammar, but implement a real header/path-safety scanner before git. It must inspect `diff --git`, `---`, `+++`, rename/copy headers, quoted paths, `/dev/null`, absolute paths, `..`, Windows separators, symlink mode `120000`, and binary markers. No full unified-diff parser, but path-bearing headers are not optional.

11. **reject.** Put BUILD failure drafts under `.code-oz/runs/<runId>/build-drafts/<T-NNN>-attempt-<N>/`, not `.code-oz/artifacts/BUILD_REPORT.draft.md`. BUILD drafts are attempt-scoped and patch-adjacent. Point `NEEDS_INTERVENTION` at that directory. Keep `.code-oz/artifacts/` for canonical phase artifacts.

12. **accept-with-modifications.** Do load-time and runtime validation. Load-time validation can only validate the templated declaration: tool is exactly `apply-patch`, root is exactly the worktree template, caps are within hard limits. Runtime validation must resolve `<runId>`, enforce the concrete absolute root, recompute size, and reject any path outside the worktree.

## Risks the proposing side missed

**critical** — Persona-authored computed fields can forge a fake BUILD gate. Base commit, dirty-base flag, patch sha, patch byte count, changed-file hashes, manifest membership, and validation command binding must be orchestrator-owned or mechanically cross-checked before canonical write.

**critical** — PLAN and BUILD can drift. PLAN repo-context reads the host tree, but lazy BUILD creates from `HEAD` later. If the branch moved or PLAN saw dirty files that `clean-base` hides, BUILD may implement against a different substrate. M7 needs a BUILD-entry drift check or at minimum a hard failure when the selected PLAN task references files absent from the bound base.

**critical** — Do not destroy the worktree at `build_completed`. M7 stops before VERIFY, so the worktree must survive the BUILD gate. Cleanup-on-success can only mean after VERIFY pass in M8, not after BUILD report write.

**high** — Reusing M6 repo-context tooling can leak the host repo into BUILD. BUILD repo-context roots must resolve against `.code-oz/runs/<runId>/worktree/`, not the project root, or the builder can read and cite files that are not in the candidate worktree.

**high** — Forensics contracts are already close to drifting. WORKTREE lists six files, while VERIFY also names `VERIFY.md`, the patch file, and the BUILD prompt/constraint. Implement `writeForensicsBundle` with optional extra entries now so M8 does not have to break the layout.

**high** — Patch path safety is harder than "scan for `..`". Symlink patches, rename headers, quoted paths with spaces, `/dev/null`, and `a/`/`b/` prefixes all need explicit handling before `git apply`.

**medium** — Event payloads can become decorative. `worktree_created`, `worktree_patch_applied`, `build_patch_applied`, and `build_completed` should carry enough binding data to audit base SHA, patch SHA, and changed paths. The existing open read-side event validator should not let thin write-side events pass as complete.

**medium** — Validation command substitution is an M8 bug seeded in M7. If BUILD can replace `bun test tests/x.test.ts` with `echo ok`, VERIFY will faithfully execute a lie. Copy the command from the selected PLAN task unless a later contract explicitly allows override.

## Where I disagree

I disagree with "one patch block plus one full BUILD_REPORT draft" as the core protocol. The report has facts the persona cannot reliably know until after apply. Freeze the patch first, then let the orchestrator compute and serialize the report.

I disagree with unit-only forensics. The failure-preserve ordering is exactly the sort of filesystem bug unit tests miss.

I disagree with a 6-7k builder persona body. Put grammar in `build-system.md`; keep the persona concise and example-driven.

I disagree with 3 BUILD repair attempts. In BUILD, repeated repair turns can become an untracked patch loop. Keep format repair tight and make patch apply failure explicit.

I disagree with `.code-oz/artifacts/BUILD_REPORT.draft.md` for failed BUILD attempts. Attempt-scoped evidence belongs under the run directory.

## What I would defer

- The test runner implementation to M8.
- Provider tool-call style `apply-patch` to a later tool-runtime milestone. M7 can keep the permission schema without exposing patch application as a provider tool call.
- Scientist cap configurability until there is data from M7/M8 runs.
- Orphan-worktree warnings and cleanup to `code-oz prune` or W2.
- Full unified-diff parsing, binary patch support, symlink support, and canonical `greenfield-web` fixture work.

## Recommended next step

The 9-commit path is mostly sane, but I would reorder it:

1. Land event types, path helpers, and the git-version doctor parser before worktree code.
2. Land worktree create/remove/inspect with base, dirty-tree, and path tests.
3. Land manifest and forensics together, including the populated synthetic preserve test.
4. Land patch validation/apply with header path-safety, binary rejection, symlink rejection, and `git apply --check`.
5. Land `tool_use.write` schema/load validation once the actual root and caps are proven by worktree tests.
6. Land `build-report.ts` parser/serializer, including validation-command shape checks and manifest drift checks.
7. Land `build-system.md` plus the compact builder persona, with prompt-composer tests. Do not leave the prompt commit untested.
8. Land `src/phases/build.ts`: patch extraction, patch freeze, apply, manifest, report write, Scientist tail, gate preflight. Assert the worktree still exists at BUILD completion.
9. Land the FakeProvider e2e last, using the existing `greenfield-baby-name` fixture path.

Add a thirteenth review-fix commit only if the implementation review finds real blockers.
