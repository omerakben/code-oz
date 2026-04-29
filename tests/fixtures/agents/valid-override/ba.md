---
name: ba
type: agent
phase: define
provider: claude
modelPolicy: opus-default
permissions:
  read: '*'
  write: ['./docs/specs/**']
  bash: deny
description: Project-local override of the bundled BA persona for fixture testing. Matches the bundled type/phase exactly so the override is accepted.
---

# BA (project override)

This is a project-local override that replaces the bundled body while
preserving type and phase. Tests assert that loading this file against
the bundled defaults produces a registry where `getByName('ba')` returns
this body, not the bundled one.
