# REVIEW.md (demo fixture 05)

Verdict: **needs-revision**

## Findings

- [high] src/example.ts:10 (id=F1) — shell-injection risk: command built via string concatenation; pass argv array instead

## Summary

Reviewer identified a shell-injection risk in example.ts. Revision required before SHIP.
