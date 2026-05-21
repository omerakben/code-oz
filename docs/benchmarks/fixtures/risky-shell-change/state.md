# Seed repo state — risky-shell-change

```
change under REVIEW: shell command built via string concatenation
reviewer verdict:    needs_revision (shell-injection finding)
```

The fixture models the reviewer recording a `needs_revision` verdict. Only a
`resolved` verdict writes `GATE_REVIEW_PASSED.json`; `needs_revision` routes
back to revision and the SHIP gate is withheld.
