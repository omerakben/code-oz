---
name: block-rm-rf
enabled: true
event: PreToolUse
tool: Bash
scope: runtime-tool-call
action: block
priority: 500
conditions:
  - field: command
    operator: contains
    value: rm -rf
---

Block: a Bash command included `rm -rf`. This was rejected before execution.

If you genuinely need recursive deletion in a run, prefer:

- a tightly scoped `rm` over a single known directory,
- `rm` without `-r` and an explicit allowlist of files,
- or removing this rule entirely from `.code-oz/guardrails/` if your run
  legitimately needs `rm -rf` (and accepting the consequences).

Default-deny is intentional. The next reviewer should not have to reason
about whether the recursive delete was scoped correctly.
