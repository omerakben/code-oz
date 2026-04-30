# Greenfield baby-name fixture

Toy repo used by `tests/e2e/plan-greenfield.test.ts` to exercise the full
DEFINE → approve → PLAN → approve spine with FakeProvider. Contains 2-3
reference files that PLAN's repo-context tools could find when searching
for adjacent patterns. The e2e test does NOT actually exercise the
tool_use protocol (FakeProvider returns canned PLAN.md + SOURCE_CHECK.md
directly); the fixture exists so a future M7+ live-provider e2e has a
realistic project to plan against.
