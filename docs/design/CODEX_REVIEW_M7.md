# Review — M7 BUILD-lite implementation

**Thread:** `019ddf20-8fad-7f82-8e32-5932bd460d63`
**Prior thread:** `019ddeea-d94b-74e0-8d02-133f65a49d90` (implementation briefing)
**Date:** 2026-04-30
**Model:** gpt-5.5 xhigh, sandbox: read-only

## Verdict

`fix-first`

The implementation lands a lot of the M7 substrate cleanly, but it does not yet satisfy the M7 BUILD gate contract. Two parts are fake or missing at the gate boundary: BUILD never runs the Scientist phase-tail before requiring BUILD approval, and the PLAN-to-BUILD binding/preflight is caller-supplied rather than enforced from the approved `PLAN.md`. Those are actual contract defects, not polish.

## Findings

1. **block-push — BUILD gate skips the required Scientist tail.**
   `BUILD.md` says BUILD writes `BUILD_REPORT.md`, runs Scientist, then gates; `build_completed` is defined as report written + Scientist sidecars updated + preflight passed. In `src/phases/build.ts`, the code writes `BUILD_REPORT.md`, checks worktree existence, emits `build_completed`, then calls `requireGate`; there is no `runScientistPhaseTail` call, no 3/3 cap enforcement, and no BUILD-side sidecar preflight. The e2e only invokes the Scientist during PLAN, not BUILD. Fix before tag: wire BUILD to the Scientist tail using `BUILD_REPORT.md` as the primary artifact, gate only after sidecars parse and cap checks pass, and add `tests/build-scientist-tail.test.ts` or equivalent coverage.

2. **block-push — PLAN binding and C2 drift preflight are not real.**
   `runBuild` accepts `planSha`, `task.validationCommand`, and `task.referencedFiles` from the caller rather than parsing and cross-checking the approved `PLAN.md`. The actual drift check only rejects parent-directory collisions and explicitly allows absent referenced files as "added" without any added-file marker. But `PLAN.md` task grammar has only `- Files:` and no `change: added` field. So the failure mode from C2 still passes: PLAN can reason over a file that is absent in the worktree base, and BUILD will proceed. Fix before tag: parse `PLAN.md` at BUILD entry, verify the selected task exists, verify the current PLAN sha, derive files from the parsed task, and either extend PLAN with add/modify intent or fail absent task files conservatively.

3. **block-push — M2 validation-command authority is only by convention.**
   BUILD_REPORT uses `opts.task.validationCommand`, and the e2e manually supplies that object. There is no cross-check against the approved PLAN task's `Validation:` bullet, so a future caller can substitute `echo ok` and BUILD will serialize it as canonical. Fix before tag with the same PLAN-binding work above: command text comes from `PlanTask.validation`; working directory/timeout/expected exit code must be orchestrator-owned defaults or explicitly added to the PLAN contract.

4. **block-next-milestone — BUILD_REPORT validation-command shape is under-validated for M8.**
   The parser checks command presence, positive timeout, and integer exit code, but it does not check that `Working directory` is the run worktree or that timeout is bounded. That leaves VERIFY to reject or execute a bad shape later. Fix before M8, preferably now while touching the PLAN binding.

5. **fix-soon — Authority split is enforced more by code shape than adversarial tests.**
   C1 is implemented in the happy path, but tests mostly assert that orchestrator-supplied fields round-trip. Add tests where the persona emits forged `Patch sha256`, `Changed files`, and `Validation command` sections after `## Notes`, and assert the canonical report still uses orchestrator-computed values. Add a drift test where `referencedFiles` names a missing base file and BUILD fails.

6. **fix-soon — `tool_use.write.roots` load validation is looser than the prior decision.**
   `builder.md` frontmatter is correctly scoped to `.code-oz/runs/<runId>/worktree/`, but schema validation accepts any non-empty root. Decision 12 said load-time validation should require the exact templated worktree root. Add that check and a rejection test for host-root or `*`.

7. **nit — BUILD prompt still promises repair behavior the orchestrator does not provide.**
   `build-system.md` says failed `git apply --check` gets one repair round and mentions forensics under build drafts, while `runBuild` records failure/intervention immediately. Align the prompt with the implemented no-patch-loop policy.

## What landed cleanly

- C1 mostly landed: persona output is parsed as one diff plus Title/Notes, while patch sha, byte count, manifest, base, and validation fields are computed in `src/phases/build.ts`.
- C3 landed: BUILD does not call `removeRunWorktree`, and it explicitly asserts the worktree still exists before `build_completed`.
- H1 default persona scoping is correct in `builder.md`: both repo-context and write roots point at `.code-oz/runs/<runId>/worktree/`.
- H2 landed well: `writeForensicsBundle` accepts `extras`, rejects shadowing required entries, and rejects unsafe names.
- H3 is mostly covered: the scanner rejects absolute paths, `..`, Windows separators, drive letters, binaries, symlink create/delete modes, and `a//`-style escapes; it intentionally handles `/dev/null` and quoted paths for normal add/delete and spaces.
- Typecheck is clean: `bun run typecheck` passed. `bun test` could not be confirmed in this read-only sandbox because temp-dir creation fails with `EPERM`; the run stopped with sandbox-caused `mkdtemp` failures, not a clean 995/1/0 signal. (Note: 995 pass / 1 skip / 0 fail confirmed in our session before invoking the review.)

## Suggested follow-ups (post-tag, M8 territory)

- VERIFY runner execution, restart-on-fail, and cleanup-on-VERIFY-pass.
- Full forensics population from real VERIFY failure, including frozen `VERIFY.md`, patch copy, and prompt snapshot.
- Review-side changed-file scoping and cross-family REVIEW enforcement.
- `code-oz prune` / orphan worktree cleanup.
- Binary patch support, symlink support, and broader patch formats only if real usage demands them.
