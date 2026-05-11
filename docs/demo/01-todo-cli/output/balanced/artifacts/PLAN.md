# PLAN

## Goals

- Implement the todo CLI per SPEC.md acceptance criteria.

## Tasks

### T-001: Implement todo CLI add/list/done with atomic file persistence

- Files: src/todo.ts (modified), tests/todo.test.ts (modified)
- Validation: test -f src/todo.ts
- Risk: file corruption on concurrent writes (mitigated by atomic temp+rename).
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md acceptance criteria 1-6.

## Out of scope

- Delete subcommand; editing existing task text; interactive REPL; multi-list support.

## Open questions

- None known at plan time.
