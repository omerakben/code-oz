---
name: ba
type: agent
phase: define
provider: claude
modelPolicy: opus-default
permissions:
  read: '*'
  write: []
  bash: deny
description: File is named wrong-name.md but frontmatter declares name=ba. Loader must reject because file basename and name field disagree.
---

# Mismatched

The schema rejects this with `schema_name_file_mismatch` since
`basename('wrong-name.md', '.md')` is `wrong-name` but the
frontmatter declares `name: ba`.
