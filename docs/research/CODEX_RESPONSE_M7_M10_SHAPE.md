# Codex response — M7-M10 shape and the debate-agent thesis

**Thread:** `019ddea0-f1a6-78c1-9357-d1711a14af65`
**Date:** 2026-04-30
**Model:** `gpt-5.5` xhigh, sandbox: read-only
**Brief:** [`CODEX_BRIEFING_M7_M10_SHAPE.md`](./CODEX_BRIEFING_M7_M10_SHAPE.md)

---

## Verdict on the four decisions

Decision 1 - accept-with-modifications. Split M7/M8/M9 as implementation milestones, but do not split the shared contract surface. BUILD, VERIFY, and REVIEW are separate enough to deserve separate Codex microscope passes, especially because the current M7 bundle includes too much: BUILD/VERIFY/REVIEW core, iterative loop, mutation gate, Scientist tails, universal rules, and Prompter experiment all in one milestone ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:142)). The missing trade is that BUILD's output is not meaningful unless M7 already defines the data VERIFY and REVIEW will consume: changed files, patch provenance, command expectations, and failure carry-forward. So: split code delivery, but write the BUILD/VERIFY/REVIEW artifact interface before M7 code.

Decision 2 - accept-with-modifications. Worktree-per-run must land with BUILD because BUILD is the first phase that mutates code, and the roadmap already says BUILD-lite runs in an isolated worktree through a patch contract ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:68)). But do not treat "worktree" as a small helper. It needs a contract first. Existing docs only reserve `.code-oz/runs/` for M7+ worktrees ([GATES.md](/Users/ozzy-mac/Projects/code-oz/docs/contracts/GATES.md:83), [paths.ts](/Users/ozzy-mac/Projects/code-oz/src/paths.ts:16)); they do not yet define base commit binding, dirty-tree behavior, cleanup, forensic preservation, changed-file manifests, or path escape rules. I would not make worktree a standalone release, but I would make it M7 commit 1 and block BUILD on it.

Decision 3 - accept-with-modifications. Reject a VERIFY-to-patch soft loop, but do not literally throw away the failed BUILD as if it never happened. The right model is: failed VERIFY invalidates promotion, preserves the failed worktree/diff/report for forensics, destroys it as the active candidate, and starts attempt N+1 from the same approved PLAN plus a compact failure constraint. That keeps VERIFY authoritative while still borrowing the useful part of Aider/Devin/SWE-agent style iteration: compiler and test feedback is data. The hard cap should apply to clean BUILD attempts, not hidden patch rounds, and attempt 5 should produce `NEEDS_INTERVENTION.json` as the brief proposes ([CODEX_BRIEFING_M7_M10_SHAPE.md](/Users/ozzy-mac/Projects/code-oz/docs/research/CODEX_BRIEFING_M7_M10_SHAPE.md:63)).

Decision 4 - accept-with-modifications. One implementation milestone per Claude session is correct for M7-M9. The M6 catch was a data-flow violation hiding behind passing tests, and that kind of bug is exactly what gets missed when review spans three phases at once ([CODEX_BRIEFING_M7_M10_SHAPE.md](/Users/ozzy-mac/Projects/code-oz/docs/research/CODEX_BRIEFING_M7_M10_SHAPE.md:47)). The modification: allow one shared "contract convergence" document before M7 that names the BUILD/VERIFY/REVIEW handoff once, then keep code sessions separate. Separate context is discipline; duplicated interface debate is waste.

## Verdict on the debate-agent thesis

feature-with-modifications. The feature is real, but the feature is not broad `consult()` yet. Current locks deliberately rejected v0.1 `consult()` in favor of REVIEW-only `requestReview()` ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:27), [CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:47)), and that was still correct. What has changed is that the manual Claude+Codex debate artifact has become an empirical product primitive: decision pressure before code, not just review after code ([CODEX_BRIEFING_M7_M10_SHAPE.md](/Users/ozzy-mac/Projects/code-oz/docs/research/CODEX_BRIEFING_M7_M10_SHAPE.md:83)). Timing: write `docs/contracts/DEBATE.md` during M7 as a process contract, then implement runtime support after REVIEW-lite, as M10. Naming: product term `Debate`, runtime primitive `requestDebate()`, not `consult()`. Artifact shape: hybrid α+γ, with canonical Markdown files plus event audit. Use `.code-oz/artifacts/debates/<phase>-<topic>/BRIEFING.md`, `RESPONSE.codex.md`, `RESPONSE.claude.md` when applicable, and `DECISION.md`; emit `debate_started` and `debate_resolved` to `events.jsonl`, but do not make JSON the canonical artifact because rule 7 keeps phase contracts in Markdown ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:26)).

## Risks we are not seeing

- Critical - Worktree isolation is not a security sandbox. It protects the user's working tree from accidental file mutation; it does not protect secrets, network, shell execution, spawned processes, or destructive commands. Rule 9's permission-manifest requirement must be extended to BUILD/VERIFY execution before real user code runs ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:28)).

- Critical - A BUILD-only M7 can create a fake green gate. If M7 writes `BUILD_REPORT.md` without a pinned changed-file manifest, base commit, patch id, and expected validation command shape, M8 will either rewrite M7 or VERIFY the wrong abstraction.

- High - Cleanup-on-success and preserve-on-failure are underspecified. The brief names Archon-style cleanup/preservation ([CODEX_BRIEFING_M7_M10_SHAPE.md](/Users/ozzy-mac/Projects/code-oz/docs/research/CODEX_BRIEFING_M7_M10_SHAPE.md:55)), but failed VERIFY needs preserved diff, logs, artifact hashes, and prompt constraints, not just a leftover worktree.

- High - Debate can violate privacy and budgets faster than REVIEW. A phase-level `requestDebate()` will be tempting to call with "all relevant context." That collides with explicit manifests and run-level budget enforcement ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:32), [CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:38)). Debate must have its own manifest preview and budget accounting.

- High - The Scientist tail may become gate noise in BUILD/VERIFY/REVIEW. The contract says every primary-artifact phase runs Scientist before gate write and blocks on missing sidecars, overdue questions, or missing falsifiers ([SCIENTIST.md](/Users/ozzy-mac/Projects/code-oz/docs/contracts/SCIENTIST.md:40)). Three new call sites can turn one small BUILD into three epistemic interruptions unless severity thresholds are tight.

- Medium - Docs truth drift is already visible. `CLAUDE.md` still says v0.1/M1 status ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:9)), while the new brief says v0.6 is locally tagged with 783 passing tests ([CODEX_BRIEFING_M7_M10_SHAPE.md](/Users/ozzy-mac/Projects/code-oz/docs/research/CODEX_BRIEFING_M7_M10_SHAPE.md:17)). A trust product cannot let orientation docs lag milestone reality.

- Medium - "Prompts as artifacts" is incomplete. The valuable artifact is not the prompt alone; it is prompt, response, rejected alternatives, final decision, and later outcome. Without `DECISION.md`, debate becomes archived theater.

## Recommended M7 first action

Write `docs/contracts/WORKTREE.md` before touching `src/phases/build.ts`. It should pin: `.code-oz/runs/<runId>` layout, base commit and dirty-tree policy, `git --version >= 2.40` doctor check, worktree creation/removal commands, cleanup-on-success, preserve-on-failure, changed-file manifest format, patch application boundary, artifact hash binding, allowed roots, and failure events. Then update the M7 row to remove VERIFY/REVIEW/mutation/Prompter from M7 and define M7 acceptance as: BUILD applies one atomic PLAN task into an isolated worktree, writes `BUILD_REPORT.md`, records changed files, runs Scientist tail, and stops before VERIFY.

## What you would have done differently if you were Claude

I would not have let the synthesis success inflate M7. The roadmap took a correct spine-first idea and packed five different authorities into one milestone: mutation testing, iterative build loop, three new phases, Scientist tails, and a Prompter experiment ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:144)). That is the exact pattern the Codex process is supposed to prevent. I would have frozen one rule after M6: each milestone may introduce one new authority boundary. M7 gets isolation plus BUILD artifact authority. M8 gets VERIFY evidence authority. M9 gets cross-family REVIEW authority. Separately, I would have recognized the debate-agent thesis earlier as a product artifact, but I would have named it `Debate`, documented it in `docs/contracts/DEBATE.md`, and kept it out of runtime until REVIEW exists.
