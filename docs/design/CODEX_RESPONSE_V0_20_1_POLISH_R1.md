# Codex R1 response: failure-gates demo code track

> **Thread:** `019e26f6-be21-7971-bf44-c65c949b0a17`
> **Model:** `gpt-5.5` xhigh, sandbox: read-only
> **Briefing:** Codex R1 review on commits `c5fd9ab` (C14 scaffolding) and `1f35104` (C15 implementation)
> **Date:** 2026-05-14

## 1. Verdict: `fix-first`

The B5 closure is satisfied (`git diff --stat src/` is empty across the two commits). The demo's underlying *behavior* exercises real production gate APIs and the tests pass. The *framing* overstates what readers will see, however, in ways that a skeptical HN commenter would catch within minutes of inspecting the captured outputs.

Block-push findings must close before tag. Medium findings should close before tag if cheap. Nits can defer.

## 2. Per-prompt response (summary)

1. **Rule 22 RED-first**: framing is wrong. These are characterization tests of existing primitives, not RED-first behavior changes. Rename the framing.

2. **B5 closure proof**: clean. `git diff --stat src/` empty across `c5fd9ab^..1f35104`. No path for the demo to smuggle new production behavior.

3. **Fixture honesty**:
   - 01-tampered-artifact: exercises the right primitive but does NOT model the SPEC's "approved artifact edited, next phase preflight refuses" flow, and does NOT write the SPEC's claimed `NEEDS_INTERVENTION.json`.
   - 02-scope-escape: too simplified. Production review-finding validation (`src/phases/review.ts:2133`) checks manifest membership + absolute paths + lexical escape + symlink realpath + readability and returns `review_finding_path_unknown`, not the demo's event names.
   - 03-verify-fail: **wrong semantics**. A normal evidence command exit 1 in `runVerify` writes `worktree_forensics_preserved` + `verify_failed` + returns restart for attempts 1-3. It does NOT immediately write `NEEDS_INTERVENTION.json`. That only happens for durable interventions or restart-cap exhaustion. See `src/phases/verify.ts:599`.
   - 04-same-family-review: honest. SPEC update to `provider_permissions_violation` is correct.
   - 05-reviewer-blocks-risk: too weak. Asserting string constants dodges the actual `runReview` routing.

4. **Captured-output trustworthiness**: not trustworthy under current framing.
   - Event names in committed `events.jsonl` are NOT production event types (e.g., `review_finding_out_of_worktree`, `review_requested`, `review_provider_same_family`, `review_routed_to_revision` do not exist in `src/state/events.ts`).
   - `run-demo.ts` writes events via a custom `writeEvents()` helper, not via the production `appendEvent` API.
   - The README claims "same events.jsonl ledger" and "FakeProvider fixtures" — both are false.
   - Fixture 02 records `mkdtemp` paths into committed output, which will not match byte-for-byte across local runs.

5. **HN-class objections**: all three I called out are fair. Plus a fourth: running the demo dirties the repo because committed outputs embed nondeterministic temp paths.

## 3. Block-push findings (must close before tag)

- **B1**: The demo overclaims production ledger proof. Either generate schema-valid production events via existing event APIs, or reframe these files as "event sketches" and remove the ledger-replay claim. Current `events.jsonl` naming is misleading.
- **B2**: Fixture 03 semantics are wrong for a normal verify failure. Should demonstrate actual `verify_failed` + restart, or cap-exhausted intervention, not a synthetic `verify_failed_evidence_command_exit_nonzero` NEEDS_INTERVENTION write.
- **B3**: README/SPEC/output mismatch on fixture 01. Walkthrough tells readers to inspect a `NEEDS_INTERVENTION.json` for fixture 01, but the demo does not produce one.

## 4. Medium findings (close before tag if cheap)

- **M1**: Rename/reframe "RED-first" to "characterization tests" in the test file and commit message context. Unless a failing demo-output test existed first, the RED-first framing is wrong.
- **M2**: Fix "FakeProvider" wording in README. `run-demo.ts` uses a local `TestProvider`, not `FakeProvider`. Either import the real `FakeProvider` or correct the README to say "deterministic test providers."
- **M3**: Fixture 05 should either call `runReview` in the same style as `tests/review-phase.test.ts:620`, or be explicitly labeled as a status-shape illustration (not a routing proof).
- **M4**: Correct stale/wrong source references, especially `review.ts:237-244` for fixture 05.

## 5. Nits

- **N1**: Use production event names where possible: `intervention`, `review_round_completed`, `review_remediation_recorded`, `verify_failed`, etc.
- **N2**: Avoid writing nondeterministic temp paths into committed outputs if snapshot matching remains a claim.

## 6. What the demo proves better than my framing

- B5 in the narrow sense: these commits exercise existing production primitives without adding production authority.
- Fixture 04 is solid as a direct proof of runtime cross-family refusal.
- Fixture 01 is useful as a low-level SHA-binding proof, once the docs stop calling it a full next-phase preflight + intervention scenario.

## Read-only note

Codex did not run `bun run demo:failure-gates`. The demo rewrites tracked output files, which would be a write inside a read-only sandbox. Verification was by reading the listed files and production paths.
