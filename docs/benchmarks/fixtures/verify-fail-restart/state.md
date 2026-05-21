# Seed repo state — verify-fail-restart

```
run reaches VERIFY
evidence command exit code: 1   # tests fail
```

The fixture writes the production `NEEDS_INTERVENTION.json` for a
`verify_failed_evidence_command_exit_nonzero` and asserts no
`GATE_VERIFY_PASSED.json` exists — SHIP is blocked.
