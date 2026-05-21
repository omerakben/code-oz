# Seed repo state — same-family-review

```
provider registry: [claude (family=claude), codex (family=codex)]
BUILD provider:     claude
REVIEW reviewer:    claude   # same family as BUILD — must be refused
```

The fixture issues a `requestReview` with a same-family reviewer. The
cross-family policy throws before the reviewer is invoked.
