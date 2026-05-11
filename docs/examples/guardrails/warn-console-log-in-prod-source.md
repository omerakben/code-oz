---
name: warn-console-log-in-prod-source
enabled: true
event: PreToolUse
tool: Write
scope: runtime-tool-call
action: warn
priority: 100
dedupKey: '{rule.name}:{file_path}'
maxMatchesPerRun: 5
conditions:
  - field: file_path
    operator: glob
    value: src/**/*.ts
  - field: new_content
    operator: contains
    value: console.log
---

A `console.log` was about to be written into a production source file.

Production code should use the project's logger (`src/logging/`) rather
than `console.log`. If this is intentional debug code that should not ship,
route through `LogLevel.debug` so the test environment can suppress it.

This rule de-duplicates per file path; you will see at most five warnings
per file in a single run.
