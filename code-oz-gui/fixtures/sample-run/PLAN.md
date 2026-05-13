---
runId: r-2026-05-12-checkout-safari
profile: brownfield
phase: plan
lead: claude-opus-4-7
generatedAt: 2026-05-12T14:32:42.880Z
inputArtifact: AUDIT.md
---

# Plan: Fix Safari iOS checkout touch-coalescing bug

## Goal

Restore working checkout on Safari iOS 17.x without regressing the double-tap-submit guard that ships in `coalesceTouchTaps`.

## Tasks

### T-001 — Write failing RED test for the Safari iOS bug

**Why first:** rule 22b requires the failing test before any production change.

**Scope:**
- Add `src/payments/__tests__/coalesce-touch.safari.test.ts` (Vitest browser-mode).
- Force user-agent to Safari iOS 17.4.
- Dispatch `pointerup` immediately before `touchend` on a mock submit button.
- Assert that the form-submit handler receives a non-null `submitter`.

**Done when:** the test exists, runs, and fails for the documented reason.

### T-002 — Patch coalesceTouchTaps to handle Safari iOS ordering

**Scope:**
- Modify `src/payments/safari.ts:42-58` to distinguish `pointerup`-then-`touchend` as one tap (not duplicates).
- Keep behavior identical for `touchstart`-then-`touchend` (existing double-tap guard intact).
- Add inline comment naming the Safari iOS quirk.

**Done when:** T-001 passes. Existing 124 tests pass. No public API changes to `coalesceTouchTaps`.

### T-003 — Surface failure instead of silently swallowing in finalizeCart

**Scope:**
- Modify `src/payments/checkout.ts:118-149` to throw a typed `CheckoutAbortedError` when `submitter` is null, instead of early-return.
- Add error-toast wiring at `src/ui/form/AddressForm.tsx:201-218` to display "Could not submit. Try tapping Continue again." when the error fires.
- Add a regression test ensuring this never silently early-returns again.

**Done when:** silent early-return path is gone; the new test passes; existing tests pass.

### T-004 — Add Safari iOS smoke to the CI matrix

**Scope:**
- Wire a Browserstack Safari iOS 17.4 row into `.github/workflows/test.yml`.
- Run the full payments suite on it.
- Gate is non-blocking for v0.21.x; promotes to blocking in v0.22.x.

**Done when:** the CI row runs on PRs and posts pass/fail status.

## Acceptance

Checkout completes on Safari iOS 17.4 after entering shipping address with a single tap. All 124 existing tests pass. The new T-001 RED test passes after T-002. The new T-003 regression test passes. The new T-004 CI row reports green on a clean PR.

## Out of scope

- Refactoring the broader Formik form (deferred).
- Migrating off `coalesceTouchTaps` toward Pointer Events native flow (deferred).
- Server-side defensive validation in `/api/cart/finalize` (deferred — Formik+client-side fix is sufficient).

## Plan sources

- SC-AUDIT-001 — `AUDIT.md` § Localization
- SC-AUDIT-002 — `AUDIT.md` § Hypotheses § H-AUDIT-001
- SC-AUDIT-003 — `AUDIT.md` § Constraints
