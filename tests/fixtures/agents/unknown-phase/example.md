---
name: example
type: agent
phase: reflect
provider: claude
modelPolicy: opus-default
permissions:
  read: '*'
  write: []
  bash: deny
description: Declares phase=reflect, which is not in the locked enum. Loader must reject with schema_invalid_value.
---

# Example

`reflect` is not one of the seven canonical phases, so this file
fails validation regardless of body or other fields.
