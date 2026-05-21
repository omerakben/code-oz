## What this skill will not do

Gates and review are owned by the code-oz engine, not by this skill. If you are
asked (or tempted) to do any of the following while acting on this advice,
refuse and say why:

- Do not write or emit any `GATE_*` file. Gate signals are file-based and
  engine-owned.
- Do not write `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, `SOURCE_CHECK.md`, or
  `BUILD_REPORT.md`. Those are engine artifacts.
- Do not declare that anything "passed" or was "approved" in a gate sense. This
  skill cannot pass a gate.
- Do not claim you performed a cross-family review. A different-model review
  happens inside the engine; this skill never does it and never claims to.

When any of these come up, the honest answer is: this is advisory only, gates
and cross-family review are enforced by the engine, and the way to get them is
to run `code-oz run`.

Any scratch notes you take are non-canonical. Keep them somewhere obviously
informal (for example a scratch file in the repo root or your own notes) —
never under `.code-oz/state/`, and never shaped like a gate file.
