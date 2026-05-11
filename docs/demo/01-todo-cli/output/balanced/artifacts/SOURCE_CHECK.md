# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: todo CLI feature surface

- Spec: SPEC.md ## Acceptance criteria, bullets 1-6
- Quote: bun run src/todo.ts add "Write the demo" writes todos.json with one entry whose id is 1.

## Reference sources

### SC-REF-NONE-001: No reference patterns required

- Searched: src/**/*.ts
- Result: 0 hits
- Why explicit: greenfield project; no prior file persistence patterns to reuse.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: Bun built-ins only (node:fs/promises, node:crypto); no third-party APIs.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
