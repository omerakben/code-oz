# Codex M12 implementation review (round 1)

**Thread:** 019de4bb-9623-7340-98d7-dae01f5aa2d0
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** docs/research/CODEX_BRIEFING_M12_REVIEW.md
**HEAD reviewed:** 41d62fa (six commits on feat/m12-company-roster)

## Verdict on the decisions

Overall verdict: push

The six commits match the M12 locks. The implementation keeps the company roster to the six shipped roles, limits row shape to `{ provider?, model? }`, applies config-wins overrides before resolved-provider checks, re-runs the debate-family invariant after override, fixes bootstrap order at both `runCommand()` and `dispatchPlan()`, and propagates `req.model ?? req.agent.model` into adapter invocation plus `agent_invoked.model`.

I did not find a block-push or fix-first issue. The remaining items are doc precision and future hardening nits, not reasons to hold `v0.12.0-alpha.0`.

### block-push

None.

### fix-soon

None.

### nit

1. Where: `docs/contracts/COMPANY.md` agent-load validation table.
   Why it matters: The table says `loader_cross_family_violation` detail names both frontmatter and resolved providers, but the implementation reports resolved provider values only after `applyCompanyOverrides`.
   Remediation: Either trim the prose to "detail names resolved providers" or preserve pre-override provider metadata in a future diagnostic pass.

2. Where: `docs/references/provider-contract.md` and `docs/design/SESSION_M11_KICKOFF.md`.
   Why it matters: Older M11 forward-compat prose still says M12 maps role to provider+model+budgets+permissions. M12 correctly shipped provider+model only.
   Remediation: Optional cleanup in a later docs pass. `COMPANY.md` and `ROADMAP.md` are correct and should remain authoritative.

3. Where: `docs/contracts/COMPANY.md` worked example.
   Why it matters: The example is labeled like a full lifecycle override, but it intentionally trips the post-override debate-family check when `lead.provider` becomes `codex`.
   Remediation: Mark it as a failure example, or change the example to avoid that conflict.

### fyi

1. I verified branch shape: HEAD is `41d62fa`, `main` is `3078ac6`, and `main..HEAD` is exactly six commits.

2. `bun run typecheck` passed in the read-only sandbox.

3. Targeted M12 tests could not fully run in the read-only sandbox because the test files create temp directories with `mkdtemp`. The pure loader test file did run and passed 18 tests before sandbox-blocked suites failed on `EPERM`. An escalated rerun was not approved, so I am relying on the provided full result of 1917 pass / 1 skip / 0 fail.

4. Test interleaving is clean: commits 2 through 5 each carry their implementation tests, and commit 6 only updates docs/version fixtures.

5. Worktree note: `docs/research/CODEX_BRIEFING_M12_REVIEW.md` and `TODO.md` are untracked. I reviewed only the six committed M12 changes.

## Risks the proposing side missed

1. Frontmatter model validation is now more important because M12 makes `agent.model` operational. `company.<role>.model` rejects empty strings, but existing persona frontmatter only checks that `model` is a string. A project-local persona with `model: ""` can now forward an empty `--model` to adapters. This is not an M12 tag blocker because bundled personas omit `model` and the new company path is non-empty guarded, but it is worth hardening later.

2. Resume routing is config-current, not config-snapshotted. `dispatchPlan()` correctly loads config before bootstrap, but if the user edits `.code-oz/config.yaml` between DEFINE and PLAN, PLAN uses the new company roster. That appears consistent with existing config behavior, but docs should avoid implying the initial run's routing is frozen unless a future milestone persists config snapshots.

## Where I disagree

No substantive disagreement with the implementation decisions. The shipped code follows the planning synthesis from thread `019de4bb-9623-7340-98d7-dae01f5aa2d0`. My only disagreement is with small prose overstatements in older docs and the COMPANY example labeling, not with the runtime contract.

## What I would defer

Defer frontmatter `model` non-empty validation to the next schema-hardening pass unless a user hits it earlier. Defer stale M11 forward-compat prose cleanup to a docs maintenance commit. Do not add budgets, permissions, panels, debate-opponent routing, orchestrator rows, or xAI in M12.

## Recommended next step

Tag M12 as-is after your normal local full-suite confirmation. No closure commit is required for this review verdict. Do not push or publish without Ozzy's explicit approval per `CLAUDE.md`.
