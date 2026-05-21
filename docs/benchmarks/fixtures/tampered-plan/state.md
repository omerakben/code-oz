# Seed repo state — tampered-plan

```
.code-oz/artifacts/PLAN.md   # minimal approved plan body
```

The fixture writes a PLAN.md, then attempts a gate approval whose recorded
`artifactSha256` does not match the on-disk bytes — modeling a post-approval
edit. The sha-binding check refuses it.
