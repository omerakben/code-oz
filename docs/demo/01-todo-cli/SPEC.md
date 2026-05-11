# SPEC

## Goals

- Provide a single-binary command-line todo manager that stores tasks in a JSON file on disk.
- Support three operations: add a task, list tasks, mark a task done.
- Keep the implementation under 50 lines of source code, excluding tests.
- Run on any POSIX shell with the Bun runtime; no third-party packages beyond Bun built-ins.

## Users

- Solo developer who wants a zero-config personal todo list usable from the terminal between coding sessions.

## Constraints

- Source lives at `src/todo.ts`; one file, no submodules, no external packages.
- Persistence file is `./todos.json` in the current working directory; file format is `{ "todos": [{ "id": number, "text": string, "done": boolean }] }`.
- Each task has a stable integer `id` assigned monotonically on add; ids are never reused even after a future delete subcommand lands.
- CLI invocation is `bun run src/todo.ts <subcommand> [arg]`; behavior is identical whether `todos.json` pre-exists or not.
- All writes are atomic via temp-file + rename so a crash mid-write cannot leave a corrupted `todos.json`.

## Acceptance criteria

- `bun run src/todo.ts add "Write the demo"` writes `todos.json` with one entry whose `id` is 1, `text` is `Write the demo`, `done` is false; exit code 0.
- `bun run src/todo.ts list` against a `todos.json` containing two tasks prints exactly two lines in the format `<id>. [<x|space>] <text>` ordered by id ascending; exit code 0.
- `bun run src/todo.ts done 1` flips the `done` flag on the task with id 1 in `todos.json` and exits 0; a subsequent `list` shows that task with `[x]`.
- `bun run src/todo.ts done 99` against a file without id 99 exits non-zero and writes a one-line error to stderr; `todos.json` is unchanged.
- `bun run src/todo.ts add ""` exits non-zero and writes a one-line error to stderr; `todos.json` is not created or modified.
- A test file at `tests/todo.test.ts` covers all five scenarios above plus the no-file-yet bootstrap; `bun test` returns 0 with all tests passing.

## Open questions

- None known at define time.

## Explicit non-goals

- No delete subcommand; deletion is out of scope for this demo.
- No editing of existing task text; out of scope for this demo.
- No interactive REPL or watch mode; only one-shot subcommand invocations.
- No multi-list, project, or tag support; single flat list only.
- No remote sync, multi-user, or concurrent-write handling; single-user single-machine only.
