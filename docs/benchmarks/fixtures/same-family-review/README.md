# Fixture: same-family-review

- Type: Failure
- Expected `code-oz Fake` outcome: **Block**
- Single-agent columns (Claude Code alone, Codex CLI alone, Direct + manual): **n/a**

## Task prompt

Review a change where the reviewer is the same provider family as the builder.

## Repo state

A registry with two provider families (claude, codex). BUILD ran on `claude`;
the REVIEW request names a `claude` reviewer.

## Why single-agent columns are n/a

A single-agent workflow has no notion of cross-family review — the same model
both writes and "reviews." There is no separate reviewer to be same-family or
cross-family, so the cell is `n/a` for those three columns rather than a
fabricated value.

## Direct-agent risk

The same model rubber-stamps its own output as the reviewer; the review adds
no independent signal.

## What code-oz adds (the measured Fake cell)

The cross-family REVIEW policy refuses a same-family reviewer with
`provider_permissions_violation` BEFORE the reviewer is ever invoked.

- Production API exercised: `requestReview(ctx, { buildProvider: claude, reviewer: claude })` (`src/tools/review-request.ts`)
- Measured outcome: `provider_permissions_violation` raised pre-invocation → Block
