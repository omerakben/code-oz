---
title: I built an AI release gate. It just blocked my own release.
date: 2026-05
canonical: https://github.com/omerakben/code-oz/blob/main/docs/blog/2026-05-ai-release-gate.md
status: DRAFT for Ozzy review — personalize voice, add your own framing where marked [OZZY]
---

# I built an AI release gate. It just blocked my own release.

I was about to tag `v0.20.0-alpha.0` of code-oz and push it to npm, Homebrew, and a curl installer. The local test suite was green: 3361 pass, 0 fail, 2 skipped. Typecheck said nothing. Every check I could run on my machine was happy.

Then the release gate refused the release. It was right to.

[OZZY: a sentence or two of personal context here — why you were shipping that night, how close you were to just pushing. Your voice carries the hook.]

## What code-oz is

code-oz runs coding agents through a software delivery lifecycle with hard gates between phases: define, plan, build, verify, review, ship. Each phase writes a plain Markdown artifact, and the next phase cannot start until a schema-validated gate file approves the last one. The agents are Claude and Codex through their own CLI logins, and xAI through an API key; code-oz is the orchestrator around them, not a model itself.

One rule sits underneath all of it: the REVIEW phase must run on a different model family than the one that wrote the code. If Claude builds, Codex reviews. Same-family review tends to share the same blind spots, so code-oz treats cross-family review as a requirement, not a setting: the builder and reviewer families are written into the run's event log, so the pairing is auditable rather than assumed.

I hold the project to that rule twice. The product enforces it inside `code-oz run`. And I run code-oz's own development through it: before any milestone tag lands, a Codex review reads the diff and returns one of `push`, `fix-first`, or `debate-required`. No tag ships on a `fix-first` until the findings are closed. The v0.20.0 release was sitting in that gate.

## The bug

The first review round, R1, had already found six issues — one that would block the push, three to fix soon, two nits. All closed. I queued a second round, R2, expecting a clean `push`.

R2 found a new one. The release workflow built the binaries before installing dependencies.

`.github/workflows/release.yml` ran `bun build --compile` to produce the native binaries, but it never ran `bun install` first. On my laptop that is invisible: `node_modules` already exists from months of work. On a clean GitHub Actions runner there is no `node_modules` and no Bun cache. The build step would reach `src/config/schema.ts`, which imports the `yaml` package, fail to resolve it, and exit — before producing a single release asset.

The tag push triggers that workflow. So the moment I pushed the tag, the release would have failed in public, with no binaries, in front of whatever audience the launch brought. Nothing on my machine could see it, because the bug only exists in the one environment I never run: a checkout with nothing installed.

## The catch

Here is the finding, verbatim, from the review response file (`docs/design/CODEX_RESPONSE_W3A_R2.md`, thread `019e1a2c-9fbe-7742-88c7-7e9808434bd5`, model `gpt-5.5`, verdict `fix-first`):

```
### Block-push (new in R2)

`.github/workflows/release.yml:35` does not install dependencies
before the build step at `release.yml:53`. In a clean `git archive
HEAD` temp checkout, `bun build --compile --target=bun-linux-x64
src/cli.ts` fails with:

> Could not resolve: "yaml". Maybe you need to "bun install"?

A tag push would run this workflow and fail before release assets are
produced. Fix by adding `bun install --frozen-lockfile` after `Setup
Bun` in the `build` job, and add a workflow test for it.
```

A different model family, reading the diff with no stake in my deadline, traced an execution path that my green test suite could not reach.

## The fix

The fix is three lines (commit `1d520fe`):

```diff
+      - name: Install dependencies
+        run: bun install --frozen-lockfile
+
       - name: Resolve VERSION
```

The review also asked for a test, which matters more than the three lines. A one-line fix that nobody pins will rot back the next time the workflow is edited. So the same commit added `tests/ci-workflows.test.ts`, which parses the workflow, finds the install step and the build step, and asserts the build runs after the install:

```ts
const installIdx = steps.findIndex((step) => /\bbun install\b/.test(step.run))
expect(installIdx).toBeGreaterThan(-1)
const buildIdx = steps.findIndex((step) => /bun build/.test(step.run))
expect(buildIdx).toBeGreaterThan(installIdx)
```

Run that test against the pre-fix workflow and `installIdx` is `-1`. It fails for the right reason, which is the only way I trust a test. After the fix it passes, and it will fail again if anyone reorders those steps.

The release shipped a few commits later, with binaries that actually build.

## Why a second model caught what mine could not

This is not a story about a smart model. It is a story about a different one.

My loop — write code, run tests, read the diff myself — is one perspective applied repeatedly. It is good at the failure modes I already think about and blind to the ones I do not. A clean-checkout dependency ordering bug is squarely in my blind spot, because I have never had a dirty checkout in my life. More rounds of my own review would not have found it. The test suite could not, because the failure lives outside the environment the suite runs in.

A reviewer from another model family does not share that blind spot. Two models trained by different labs on different data tend to fail on different inputs, so their mistakes do not line up. It is not better at CI than I am; it is differently wrong, which is exactly what you want at a gate. The improvement came from the disagreement, not from the intelligence.

That is the whole bet code-oz makes. Model bias and provider bias are real. A single agent run to completion inherits one model's blind spots. Putting agent output through evidence gates and a cross-family reviewer trades some speed and tokens for a reviewer that fails differently than the builder. On this release that trade caught a bug that would have failed the launch in public.

A fair caveat, because it is the first question a careful reader should ask. code-oz also ships deterministic demos that run the full lifecycle offline with a built-in fake provider. Those demos prove the gate, worktree, and event machinery is real and replayable; they prove nothing about model quality, because no real model runs in them. The release-gate story above is the opposite kind of evidence: a real `gpt-5.5` read real code and found a real bug, and the fix is in git history. code-oz keeps those two kinds of evidence labeled and separate, on a [receipts page](../RECEIPTS.md) you can check.

## Try it

code-oz is MIT, open source, and runs on the CLI logins you already have for Claude and Codex (xAI needs a key).

```sh
# npm
npm install -g @tuel/code-oz

# Homebrew
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz

# curl
curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.21.1-alpha.0/install.sh | sh
```

Then `code-oz init` and `code-oz run`. The cross-family review is on by default at the REVIEW gate.

The receipts behind this post, plus the M14 and M15 review trails and the deterministic demo ledgers, are at [docs/RECEIPTS.md](../RECEIPTS.md). The full comparison against using Claude Code, Codex, Cursor, and Aider directly is at [docs/comparisons/ai-coding-agents.md](../comparisons/ai-coding-agents.md).

[OZZY: close in your own voice. The receipts carry the argument; the closer should be you.]
