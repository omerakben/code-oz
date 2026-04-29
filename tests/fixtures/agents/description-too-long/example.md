---
name: example
type: agent
phase: define
provider: claude
modelPolicy: opus-default
permissions:
  read: '*'
  write: []
  bash: deny
description: This description is deliberately stretched past the 1024-character maximum to verify that the schema rejects oversized descriptions with the schema_description_too_long error code. Repeating filler so the validator sees a string longer than 1024 characters. Filler one. Filler two. Filler three. Filler four. Filler five. Filler six. Filler seven. Filler eight. Filler nine. Filler ten. Filler eleven. Filler twelve. Filler thirteen. Filler fourteen. Filler fifteen. Filler sixteen. Filler seventeen. Filler eighteen. Filler nineteen. Filler twenty. Filler twenty-one. Filler twenty-two. Filler twenty-three. Filler twenty-four. Filler twenty-five. Filler twenty-six. Filler twenty-seven. Filler twenty-eight. Filler twenty-nine. Filler thirty. Filler thirty-one. Filler thirty-two. Filler thirty-three. Filler thirty-four. Filler thirty-five. Filler thirty-six. Filler thirty-seven. Filler thirty-eight. Filler thirty-nine. Filler forty. Filler forty-one. Filler forty-two. Filler forty-three. Filler forty-four. Filler forty-five. Filler forty-six. Filler forty-seven. Filler forty-eight. Filler forty-nine. Filler fifty. Filler fifty-one. Filler fifty-two.
---

# Example

Body content irrelevant — the description length triggers rejection
before body validation.
