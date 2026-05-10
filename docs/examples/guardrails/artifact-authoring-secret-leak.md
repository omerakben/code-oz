---
name: artifact-authoring-secret-leak
enabled: true
event: PreToolUse
tool: Write
scope: artifact-authoring
action: block
priority: 700
conditions:
  - field: file_path
    operator: regex
    value: '\.code-oz/artifacts/.+\.md$'
    maxLength: 256
  - field: new_content
    operator: regex
    value: '(?:^|[^A-Z0-9_])(?:[A-Z][A-Z0-9_]{2,}_(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL))\s*[=:]\s*[^\s]'
    maxLength: 8192
---

Block: an artifact write looked like it was inlining a secret-shaped value.

Artifact files (`.code-oz/artifacts/*.md`) become part of the run's audit
trail and must not contain real secrets. The pattern above flags
all-caps tokens ending in `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`, or
`_CREDENTIAL` followed by an `=` or `:` and a non-empty value.

If the artifact legitimately needs to reference a secret name (without
the value), write it as `${ENV_NAME}` or `<redacted>` instead of
embedding the value. If this rule fires on a literal example that is
not actually a secret, narrow the rule's regex with a more specific
prefix or move the example to `docs/examples/` (which the
`artifact-authoring` scope does not cover by design).

This rule is `artifact-authoring` scope: it never fires on runtime tool
calls that are not persisting an artifact.
