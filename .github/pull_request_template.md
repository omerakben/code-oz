<!--
Thanks for opening a PR. Please fill in this template so reviewers can move quickly.

If your PR is a small doc fix, typo, or dependency bump, you can delete sections that do not apply — but please keep the test confirmation checkbox.
-->

## Summary

<!-- One or two sentences. What changes? Why? -->

## Files changed

<!-- Bullet list of the files touched and what each one does. Helps reviewers skim. -->

## Testing

- [ ] `bun test` passes locally (paste the pass/fail/skip count below).

```
$ bun test
... pass / ... fail / ... skip
```

- [ ] Any new behavior change has a RED-first test (per rule 22 in `CLAUDE.md`).
- [ ] If this touches an HTTP provider adapter, a redaction test is included.

## Cross-model peer review

The project enforces a cross-model peer review discipline for changes that touch the orchestrator spine, the provider contract, the gate machinery, the CLI surface, or the release workflow. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for details.

- [ ] This PR does NOT need cross-model review (doc-only / typo / dep bump that passes existing tests).
- [ ] This PR DOES need cross-model review. Codex briefing + response linked below.

If the second box is checked, link the briefing and response:

- Briefing: `docs/design/CODEX_BRIEFING_<topic>.md`
- Response: `docs/design/CODEX_RESPONSE_<topic>_R<n>.md`
- Verdict: `push` / `fix-first` / `debate-required`

## Breaking changes

- [ ] No breaking changes.
- [ ] Yes, breaking changes (describe below; user-facing impact must be in the description).

## Related

<!-- Link any related issues, design docs, milestone identifiers, or prior PRs. -->
