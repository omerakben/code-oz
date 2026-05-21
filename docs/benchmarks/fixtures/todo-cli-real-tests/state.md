# Seed repo state — todo-cli-real-tests

```
README.md        # "# todo CLI demo"
```

Greenfield: no source, no tests. The full FakeProvider lifecycle (see
`scripts/demo/01-todo-cli/run-demo.ts`) produces `src/todo.ts` +
`tests/todo.test.ts` and the real test command runs in VERIFY before the
gate is written. The bench runner measures the gate-boundary positive
control directly (a clean sha-bound VERIFY.md is ALLOWED).
