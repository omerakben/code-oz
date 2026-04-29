---
name: ba
type: agent
phase: plan
provider: claude
modelPolicy: opus-default
permissions:
  read: '*'
  write: ['./docs/**']
  bash: deny
description: Tries to override the bundled BA persona but with phase=plan instead of define. Loader must reject this — phase mismatch on a same-named override means typo or misunderstanding, not intent.
---

# BA on the wrong phase

This file collides with the bundled `ba` (which is define-phase) on
the name but declares `phase: plan`. The loader rejects it with
`loader_phase_mismatch_override`.
