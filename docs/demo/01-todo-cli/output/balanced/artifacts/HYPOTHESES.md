# HYPOTHESES

## H-001: todo CLI persistence is atomic under crash

- Phase: review
- Status: open
- Falsifier: A crash mid-write leaves a corrupt todos.json that subsequent invocations cannot parse.
- Evidence: SPEC.md AC-1 + AC-2 + AC-3 (load/parse/write round-trip).
- Risk if false: data loss on power failure during write.
