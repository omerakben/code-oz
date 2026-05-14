# Fixture 04 — Same-family REVIEW

## What this proves

The cross-family REVIEW policy is mechanical, not advisory. If a `requestReview()` call names a reviewer whose provider family equals the builder's provider family, the tool throws BEFORE the reviewer is invoked.

This is the load-bearing fixture for the project's central thesis: a builder model cannot be allowed to review its own output, even indirectly through a same-family sibling. The check at `src/tools/review-request.ts:60-78` uses the registry's `familyOf()` lookup to refuse same-family review at runtime, mirroring the load-time check at `src/agents/loader.ts`.

## Setup

1. Construct a minimal `RequestReviewParams` with:
   - `buildProvider: "claude"`
   - `reviewer: <agent declaring provider="claude">` (same family as the builder)
2. Invoke `requestReview()` with that input.

## Expected gate behavior

The tool throws `ProviderError("provider_permissions_violation", ...)`. Production code at `src/tools/review-request.ts:62-73` computes both families via `ctx.registry.familyOf()` and refuses when they match.

## Expected `events-sketch.jsonl` event sequence

```jsonl
{"type":"review_requested","buildProvider":"claude","reviewerId":"claude","ts":"..."}
{"type":"provider_permissions_violation","buildProvider":"claude","buildFamily":"claude","reviewerId":"claude","reviewerFamily":"claude","ts":"..."}
```

The reviewer is NEVER invoked. There is no `provider_invocation_started` event for the reviewer because the cross-family check fires before invocation.

## Expected exit state

A typed `ProviderError` with:

- `code: "provider_permissions_violation"`
- `message: "REVIEW provider must differ from BUILD provider family"`
- `suggestions: [ "pick a reviewer agent whose provider is in a different family than <buildFamily>", "loaded reviewer agent <reviewer.name> declares provider=<reviewerId> (family=<reviewerFamily>)" ]`
- `detail: "buildProvider=<buildProvider> (family=<buildFamily>), reviewer.provider=<reviewerId> (family=<reviewerFamily>)"`

The fixture's `actual.txt` records the caught error and confirms the reviewer was never invoked.

## Production code that enforces this

`src/tools/review-request.ts:60-78`:

```ts
const buildFamily = ctx.registry.familyOf(req.buildProvider)
const reviewerFamily = ctx.registry.familyOf(reviewerId)
if (buildFamily === reviewerFamily) {
  throw providerError(
    'provider_permissions_violation',
    'REVIEW provider must differ from BUILD provider family',
    [ ... ],
    ...
  )
}
```

The family lookup is sourced from `src/providers/families.ts` (default mapping) plus optional registry overrides. The load-time analog at `src/agents/loader.ts` catches misconfigured agents before any run starts.

## Why this matters

This is the mechanical artifact behind the project's most-quoted positioning: *"a different model family reviews the change."* Without this check, an operator could configure both BUILD and REVIEW on `claude` and silently lose the cross-family signal. The check refuses that configuration at invocation time.

The fixture pairs with `src/agents/loader.ts`'s load-time check (which would reject a misconfigured `agents/*.md` before any run starts). Belt-and-braces enforcement: load-time for static configs, runtime for dynamic routing.

## Captured output location

`docs/demo/02-failure-gates/output/04-same-family-review/`
