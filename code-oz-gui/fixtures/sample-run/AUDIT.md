---
runId: r-2026-05-12-checkout-safari
profile: brownfield
phase: audit
auditor: claude-opus-4-7
generatedAt: 2026-05-12T14:30:38.880Z
---

# Audit: Safari iOS checkout fails after entering shipping address

## Operator statement

> The checkout fails on Safari iOS after the user enters their shipping address. Chrome desktop works. The page either stalls on the "Continue" button or throws a generic error toast. Started after our 2026-04-22 release.

## Localization

Likely files (ranked by signal):

1. `src/payments/safari.ts:42-58` — `coalesceTouchTaps` helper. The 2026-04-22 release introduced this helper to reduce double-tap submits. It currently treats `touchend` and `pointerup` as duplicates within a 320ms window. Safari iOS dispatches `pointerup` before `touchend`, so the second event (which carries the form's `submitter` reference) is suppressed and `event.submitter` is `null` inside the form-submit handler.
2. `src/payments/checkout.ts:118-149` — `finalizeCart()`. When called with a `null` submitter, the function early-returns without a thrown error, which is why the UI stalls silently instead of surfacing the failure.
3. `src/ui/form/AddressForm.tsx:201-218` — `onSubmit` reads `e.nativeEvent.submitter?.dataset?.intent` and falls back to `"unknown"`, which `finalizeCart` rejects.

## Reproduction

### Observed

Operator reports: Safari iOS 17.4 user, after typing the shipping address fields and tapping the green "Continue" button, the button shows the spinner state for ~600ms, the spinner disappears, and nothing else visibly changes. The cart remains on the address step. No network request is dispatched.

### Operator-proposed (working but not full)

Operator tried to repro in Chrome DevTools with iOS Safari emulation; the bug did not reproduce. The bug requires a real iOS Safari runtime because Chrome's emulation does not implement the `pointerup`-before-`touchend` ordering quirk.

### To verify

Repro target: a real iOS 17.4 Safari device (Browserstack or local iPhone), Step-by-step:

1. Open `/checkout` while signed in with a populated cart.
2. Fill all required shipping fields.
3. Tap **Continue** with a single tap.
4. Expected: address validates and the cart advances to the payment step.
5. Actual: button spinner appears, then disappears, and the page does not advance. No network request in the address-finalize endpoint.

A failing Vitest browser-mode test that forces Safari user-agent + dispatches `pointerup` immediately before `touchend` reproduces the silent failure deterministically.

## Constraints

- Cannot regress Chrome desktop, Edge, or Firefox checkout. Existing 124 tests must continue to pass.
- Cannot break the double-tap-submit guard the 2026-04-22 release added (it was added to fix a real duplicate-charge bug in the Chrome flow).
- Cannot change the `/api/cart/finalize` contract (other consumers depend on the current shape).
- Patch must keep `coalesceTouchTaps` API stable for the 3 other call sites in `src/ui/form/*`.

## Hypotheses (ranked by likelihood)

1. **H-AUDIT-001 (most likely).** `coalesceTouchTaps` is suppressing the form-submit-bearing `touchend` event because it treats it as a duplicate of the earlier `pointerup` event. *Falsifier:* in a Safari 17.4 iOS simulator, log the coalescing flag at `safari.ts:42` during the failing checkout. If the flag is `false`, this hypothesis is falsified.

2. **H-AUDIT-002 (less likely).** The `/api/cart/finalize` request body differs between Safari iOS and Chrome desktop (perhaps a serialization quirk), causing server-side validation to silently 400. *Falsifier:* capture network traffic of both flows; if the request bodies are byte-identical, this is falsified.

3. **H-AUDIT-003 (unlikely).** The Formik validation in `AddressForm.tsx` is rejecting the form pre-submit under Safari's stricter parsing. *Falsifier:* render `AddressForm.tsx` under a forced Safari UA in Vitest browser mode; if formik validation passes deterministically, this is falsified.

## Open questions

- **Q-AUDIT-001 (medium, due 2026-05-19).** Does the failure also reproduce on Safari macOS desktop, or is it iOS-only? If macOS Safari also fails, the patch scope expands; if iOS-only, scope stays at `safari.ts`.

## Audit sources

- SC-AUDIT-001 — `src/payments/safari.ts:42-58` (commit `a3f1b89c`)
- SC-AUDIT-002 — `src/payments/checkout.ts:118-149` (commit `a3f1b89c`)
- SC-AUDIT-003 — `src/ui/form/AddressForm.tsx:201-218` (commit `a3f1b89c`)
- SC-AUDIT-004 — Release notes entry, 2026-04-22, "Add double-tap submit guard"
- SC-AUDIT-005 — Operator statement, transcribed 2026-05-12 14:29 UTC

## Recommended next step

Approve this audit and proceed to PLAN. The planner should write a small Vitest browser-mode RED test against H-AUDIT-001's falsifier first, then patch `coalesceTouchTaps` to distinguish `pointerup`-then-`touchend` ordering as a single tap rather than as duplicates.
