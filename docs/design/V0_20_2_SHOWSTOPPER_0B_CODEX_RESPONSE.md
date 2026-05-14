# Codex response — v0.20.2 showstopper #0b debate

**Codex thread:** `019e2827-bd35-71a1-a93d-41ef2642dea4`
**Model:** gpt-5.5 xhigh
**Sandbox:** read-only
**Date:** 2026-05-14

## Verdict

**Ship corrected Option D for v0.20.2. Do not wire a BUILD/REVIEW tool-use loop in this patch.**

Codex's preference ordering: D first, then B, A, C.

## Two load-bearing corrections to the brief

1. **`src/providers/manifest.ts:196` rejects ENOENT before content loading.** A raw `{ path: 'src/version.ts' }` for an `added` file fails today. Implication: `change: 'add'` paths cannot be passed to `buildManifest` at all — they must remain visible to the builder only via #0a's TASK_BLOCK.

2. **`task.fileChanges` is not a context plan.** It is populated only from the PLAN's `Files:` bullet. `Bugfix:` and sibling-context paths are separate or absent (see `src/artifacts/plan.ts:793`). Implication: Rule 18 (`tool_use.repo_context`) cannot be claimed as realized in v0.20.2; it stays deferred to v0.21+.

A third subtle correction: `productionInvokePersona` captures `files: opts.files ?? []` in a closure at seam-build time (`src/cli/production-seams.ts:119`). Phase code currently cannot pass per-call files because the callback signature is `(prompt) => Promise<string>`. The signature must widen to `(prompt, { files }) => Promise<string>`.

## Prompt 1 — Which option ships?

**Recommendation:** D first, then B, A, C. Ship D only if it means "send existing task-touched files through the existing manifest path; keep missing add paths in TASK_BLOCK, not `agent_invoked.manifest`."

**Reasoning:** A/B are real authority expansions because current Claude and Codex CLI adapters do not surface usable structured tool calls. C violates the empty-cwd privacy guard. D closes the practical dogfood gap without changing provider authority, but only when the PLAN task enumerates the files the builder needs.

**Prevents:** A v0.20.2 patch turning into a multi-day provider/runtime redesign.

**Acceptance test:** Paused prdiff run `01KRKW0D94C3F80002CSAR29NT`, BUILD `T-001`, exits 0 and writes a patch under `.code-oz/runs/<runId>/patches/`. For the first modify task, `agent_invoked.manifest.files` includes the existing changed-file content.

## Prompt 2 — Where does derivation live?

**Recommendation:** Put derivation in a small helper, not directly in `build.ts`. Name it `src/runtime/provider-file-refs.ts` — NOT `file-manifest.ts` to avoid confusion with `src/providers/manifest.ts`.

**Reasoning:** BUILD derives refs from `PlanTask.fileChanges`; REVIEW derives refs from `BUILD_REPORT.md` changed files. The helper returns existing readable source-file refs only. Phase code passes them through a widened invocation callback because `productionInvokePersona` currently captures `files: opts.files ?? []` before `runBuild` loads the PLAN task.

**Prevents:** Duplicating PLAN parsing in dispatch code or accidentally reading the host checkout instead of the run worktree.

**Acceptance test:** `runBuild` calls `invokePersona(prompt, { files })` after selecting the task. Files resolve against the run worktree, not the user's dirty working tree.

## Prompt 3 — TASK_BLOCK preservation

**Recommendation:** Yes, corrected D preserves #0a's TASK_BLOCK.

**Reasoning:** D is still one provider invocation per BUILD attempt, so the composed prompt includes TASK_BLOCK each time. Missing `added` paths are visible there; existing file contents arrive through `ProviderRequest.files`.

**Prevents:** The add-file case failing just because no bytes exist yet.

**Acceptance test:** Captured BUILD prompt contains TASK_BLOCK with `T-001`, `src/version.ts`, `added`, validation, and risk.

## Prompt 4 — Missing-path handling

**Recommendation:** Do NOT make `buildManifest` accept missing paths as normal manifest entries in v0.20.2.

**Reasoning:** Current `AgentManifestEntry` requires `path`, `sha256`, and `sizeBytes`. `agent_invoked.manifest` means "files sent," not "files planned." A non-existent add path has no content hash and was not sent. Recording it there would weaken audit semantics. Keep `buildManifest` strict. The phase/helper skips missing `added` paths and relies on TASK_BLOCK for path intent.

**Prevents:** Fake zero-byte manifest entries that look like real provider context.

**Acceptance test:** Helper skips missing `added` files. Raw `buildManifest({ files: [{ path: missing }] })` still throws `provider_io_error`.

## Prompt 5 — REVIEW extension

**Recommendation:** Extend D to REVIEW, but only for existing changed files in the run worktree.

**Reasoning:** REVIEW currently builds `changedFilePaths` from `BUILD_REPORT.md` but invokes the reviewer with no file refs (see `src/phases/review.ts:935` and `:982`). For single-reviewer mode, pass `BUILD_REPORT.changedFiles` refs into the reviewer invocation. For deleted files, skip content and rely on the patch/build report — findings against deleted files are already rejected by REVIEW's validators.

**Prevents:** REVIEW rubber-stamping based on a changed-file list without source contents.

**Acceptance test:** REVIEW `agent_invoked.filesSent` equals the count of existing changed files. Reviewer stdin includes `=== src/... ===` content sections.

## Prompt 6 — Test discipline

**Recommendation:** Three minimum RED tests, not two:

1. BUILD derivation from `task.fileChanges`.
2. `added` missing-path skip behavior.
3. Worktree-root isolation.

**Reasoning:** The third test matters because passing `src/foo.ts` through the current `projectRoot: cwd` path would read the host project, not `.code-oz/runs/<runId>/worktree`. Without isolation coverage, the unit test could pass while production sends stale or dirty host files to the provider.

**Prevents:** A fix that appears green in unit tests but sends host-checkout content to the provider.

**Acceptance test:** Host file content differs from worktree content. Provider receives the worktree content.

## Prompt 7 — Future migration path

**Recommendation:** D is a clean stepping stone if it stays narrow.

**Reasoning:** Option A later can layer tool-use selected paths into the same `ProviderRequest.files` mechanism. D becomes debt only if it redefines manifest semantics to include non-sent planned files, or if it bakes BUILD-only file logic into large phase modules.

**Prevents:** Future Option A having to unwind a polluted audit contract.

## Prompt 8 — Risks I missed

**Recommendation:** Add two named risks to the implementation brief.

**Reasoning:**

1. `fileChanges` does not cover sibling/import context, optional `Bugfix.existingTest`, or "most relevant existing test" REVIEW context.
2. Current PLAN tool dispatch logs tool history but does not appear to update `extraFiles` from repo-context selected paths. Do not assume the existing tool runner already solves next-manifest selection for BUILD.

**Prevents:** Overclaiming Rule 18 as realized in v0.20.2.

## Rule status

- **Rule 13 (privacy by default):** honored if all provider bytes still pass through explicit `ProviderRequest.files` and no `--add-dir` or cwd expansion is introduced.
- **Rule 18 (repo-context permission scope):** **deferred** for BUILD/REVIEW under D. No `repo_context_searched` events are expected from this patch.
- **Rule 20 (one authority per milestone):** honored because D adds file refs to an existing provider request path, not a new tool-loop authority.

## Locked decisions (paste into implementation PR description)

```text
1. v0.20.2 ships corrected Option D, not A/B/C.
2. BUILD derives provider file refs from `PlanTask.fileChanges` after loading approved `PLAN.md`.
3. Missing `added` paths are NOT passed to `buildManifest`; they remain visible via #0a TASK_BLOCK.
4. `agent_invoked.manifest.files` remains "bytes actually sent," requiring `sha256` and `sizeBytes`.
5. Existing source files are read from the run worktree, not the host project checkout.
6. The production invocation callback is widened so phase code can pass per-call file refs.
7. REVIEW receives existing changed-file contents from `BUILD_REPORT.md` changed files.
8. Rule 18 repo-context tool-use remains deferred to v0.21+.
9. Acceptance: prdiff `T-001` BUILD applies a patch; first modify task records `filesSent > 0`.
```

## Combined locked decisions (#0a + #0b)

For the implementation PR description, both showstoppers consolidated:

```text
#0a (TASK_BLOCK injection):
- Add {{TASK_BLOCK}} to src/prompts/build-system.md and BUILD_REQUIRED_TOKENS.
- Insert ## Task between ## Your identity and ## Common rationalizations.
- Render TASK_BLOCK as PLAN-style Markdown: ### T-NNN: title, Files, Validation, Risk, optional Bugfix.
- Use task.fileChanges as the authoritative file surface (path + change kind).
- Do NOT render hypotheses, sources, startLine, or PLAN.md excerpt.
- Make task: PlanTask required for both pure and async BUILD prompt composers.
- Wire runBuild to pass planLoad.task into composeBuildPrompt.
- TRUST.md addendum: PLAN task fields (Validation, Risk) become provider prompt content.

#0b (File manifest for BUILD/REVIEW):
- New helper src/runtime/provider-file-refs.ts derives ProviderFileRef[] from a PlanTask (BUILD) or BUILD_REPORT.changedFiles (REVIEW).
- Helper skips paths that do not exist on the worktree (change: 'add', or deleted files).
- Phase code resolves paths against the run worktree, not the host cwd.
- productionInvokePersona callback signature widens to (prompt, { files? }) => Promise<string>.
- runBuild passes derived files into invokePersona.
- runReview passes BUILD_REPORT changed-file refs into invokePersona.
- buildManifest stays strict (sha256 + sizeBytes required); throws on missing paths.
- Three RED tests: BUILD derivation, added-skip, worktree-root isolation.
- Rule 18 (repo-context tool-use) explicitly deferred to v0.21+.
```

## Notes from this debate

1. Codex confirmed the brief's #0a + #0b coupling: TASK_BLOCK names the path (including `added` paths with no content), and the manifest carries only files with actual bytes. The two channels are complementary by design.

2. Codex pushed back on REVIEW's current behavior: REVIEW today invokes the reviewer with no file content. The brief identified BUILD as #0b's primary scope, but Codex named REVIEW as a symmetric beneficiary. The implementation PR should extend D to REVIEW in the same commit (one logical change: "phases pass derived file refs to invokePersona").

3. Codex named the helper file `src/runtime/provider-file-refs.ts` and explicitly flagged the naming clash if I had used `file-manifest.ts`. This is the kind of detail that prevents a code-review nit a week from now.

4. The third test (worktree-root isolation) is critical and easy to miss. A naive implementation would pass through `projectRoot: cwd` and silently read the host checkout instead of the run's worktree. The test verifies the bytes the provider receives come from the worktree, not the host.

5. Codex could not find `V0_20_2_SHOWSTOPPER_0A_CODEX_RESPONSE.md` because the #0a debate landed on the `debate/v0.20.2-showstopper-0a` branch, not on main. Same with the handoff. Self-contained briefs are essential when Codex runs in read-only sandbox on an isolated branch.
