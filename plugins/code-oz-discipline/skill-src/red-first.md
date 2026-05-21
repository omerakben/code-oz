---
name: red-first
description: Use to plan a RED-first TDD ordering for a behavior change — advisory test-ordering guidance, not an enforced gate.
---

# RED-first test ordering

Use this when someone asks "what's a good RED-first test order here?" or is
about to change behavior and wants the test to come first. This is advice on
sequencing; it does not run anything for you.

## The ordering

1. **Write the failing test first.** Name the behavior you are about to add or
   change. Write the smallest test that asserts it.
2. **Run it and confirm it fails for the right reason.** A test that passes
   before the change, or fails for an unrelated reason (typo, missing import),
   proves nothing. Read the failure message and confirm it is the assertion you
   intended.
3. **Write the minimal implementation.** Just enough to make that test pass —
   no adjacent refactors, no "while I'm here" extras.
4. **Run again and confirm green.** The test you wrote now passes, and nothing
   that was green went red.
5. **Refactor under green.** Improve the code with the tests guarding you. Re-run
   to stay green.

## A useful check

A real RED test fails when the production change is reverted. If your test still
passes with the implementation removed, it mirrors the implementation instead of
pinning the behavior — rewrite it.

## What this is not

This skill advises the ordering. It does not run your tests, it does not verify
that anything passed, and it never claims a test suite is green on your behalf —
report only what you actually ran and saw. For an enforced VERIFY phase with
real evidence the engine records and gates on, run `code-oz run`.
