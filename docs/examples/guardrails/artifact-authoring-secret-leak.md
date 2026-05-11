---
name: artifact-authoring-secret-leak-api-key
enabled: true
event: PreToolUse
tool: Write
scope: artifact-authoring
action: block
priority: 700
conditions:
  - field: file_path
    operator: glob
    value: '.code-oz/artifacts/**/*.md'
  - field: new_content
    operator: contains
    value: 'API_KEY='
---

Block: an artifact write looked like it was inlining an API key.

Artifact files (`.code-oz/artifacts/**/*.md`) become part of the run's audit
trail and must not contain real secrets. This rule catches the common
`API_KEY=<value>` shape using a deterministic substring match. To cover
other secret-name patterns, copy this rule and change the
`new_content.value` (for example, `SECRET=`, `TOKEN=`, `PASSWORD=`,
`CREDENTIAL=`).

If the artifact legitimately needs to reference a secret name (without the
value), write it as `${ENV_NAME}` or `<redacted>` instead of embedding the
value. If you cannot meaningfully avoid the substring (e.g., your artifact
has the literal text `API_KEY=` inside a code block describing a feature),
narrow the rule with a more specific second condition or move the example
to `docs/examples/` (which the `artifact-authoring` scope does not cover by
design).

This rule is `artifact-authoring` scope: it never fires on runtime tool
calls that are not persisting an artifact.

Note on regex: an earlier draft of this rule used a regex pattern. v0.1
defers the regex operator (synchronous `RegExp.test` in JS cannot be
interrupted, so the documented timeout cap is not enforceable; v0.2
adds it back with a worker-bounded matcher). For v0.1, ship one
deterministic-substring rule per secret-name shape.
