# Seed repo state — scope-escape

```
project/                  # the per-run worktree root
outside-worktree.txt      # sibling file OUTSIDE the worktree
```

The fixture resolves `outside-worktree.txt` with `realpath` and checks it
against the worktree root. The production worktree-prefix check refuses any
path that does not start with the worktree root.
