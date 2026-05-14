# First-run fix matrix

Date: 2026-05-13
Branch: `finalize/v0.20.1-first-run-polish`

## Matrix

| id | severity | fix owner | planned change | status | commit |
|---|---|---|---|---|---|
| F1.1 | block-ship | CLI | No-key fake fallback plus first-run fake fixture for smoke. | fixed | 634a288 |
| F1.2 | block-ship | CLI | Add `resume` command and `run --resume`. | fixed | 634a288 |
| F2.1 | block-ship | GUI | Resolve current monorepo CLI first and reject stale binaries. | fixed | ee160c6 |
| F2.2 | block-ship | GUI | Write live approval requests to live run directory. | fixed | ee160c6 |
| F2.3 | block-ship | GUI | Pin Next dev root and self-start e2e. | fixed | 70f5cee |
| F3.1 | block-ship | Distribution | Verify cached npm binary SHA before exec. | fixed | 13e48a1 |
| F4.1 | block-ship | Release | Smoke binaries before release upload. | fixed | 13e48a1 |
| F5.1 | block-ship | Docs | Fix GUI clone path. | fixed | 0d4e25d |
| F6.1 | block-ship | Errors | Reject empty intervention suggestions and fix BUILD suggestions. | fixed | 293f33e |
| F7.1 | block-ship | Providers | Default no-key first-run to fake. | fixed | 634a288 |
| F8.1 | block-ship | GUI | Covered by F2.3. | fixed | 70f5cee |
| F9.1 | block-ship | A11y | Add axe Playwright gate. | fixed | 70f5cee |
| F9.2 | block-ship | A11y | Fix drawer focus trap. | fixed | 70f5cee |
| F1.3 | fix-soon | CLI | Aggregate bare doctor and early help handling. | fixed | 634a288 |
| F1.4 | fix-soon | Docs | Make brownfield/AUDIT M17 gap explicit. | fixed | 0d4e25d |
| F1.5 | fix-soon | CLI | Write `STOP.json` on Ctrl-C during run. | fixed | 634a288 |
| F2.4 | fix-soon | GUI | Exact `GEMINI_API_KEY` no-key hint. | fixed | ee160c6 |
| F2.5 | fix-soon | GUI | Playwright `webServer`. | fixed | 70f5cee |
| F2.6 | fix-soon | GUI | Provider-family provenance and accents. | fixed | ee160c6, 70f5cee |
| F2.7 | fix-soon | GUI | Fixture all five decision row kinds. | fixed | 70f5cee |
| F3.2 | fix-soon | Distribution | Enforce HTTPS production downloads and safe redirects. | fixed | 13e48a1 |
| F3.3 | fix-soon | Docs | Update Homebrew audit recipe. | fixed | 13e48a1 |
| F4.2 | fix-soon | Binaries | Rename aggregate local tarball or emit release tarballs. | fixed | 13e48a1 |
| F4.3 | fix-soon | CLI | Covered by F1.3. | fixed | 634a288 |
| F5.2 | fix-soon | Docs | Clarify brownfield detection versus AUDIT runtime. | fixed | 0d4e25d |
| F5.3 | fix-soon | Docs | Single provider setup table. | fixed | 0d4e25d |
| F5.4 | fix-soon | Docs | Update release notes and v0.20.1 stub. | fixed | 0d4e25d |
| F6.2 | fix-soon | Errors | Add `eventPointer` to new intervention gates. | fixed | 293f33e |
| F6.3 | fix-soon | CLI | STOP in scope, PAUSE deferred. | fixed-with-defer | 634a288 |
| F6.4 | fix-soon | Distribution | Add fail-closed recovery hints. | fixed | 13e48a1 |
| F7.2 | fix-soon | GUI | Covered by F2.4. | fixed | ee160c6 |
| F7.3 | fix-soon | Providers | Classify expired Claude/Codex auth messages. | fixed | 85afcdf |
| F8.2 | fix-soon | Visual | Make screenshot helper state deterministic or honest. | fixed | 70f5cee |
| F8.3 | fix-soon | Visual | Stable wrapping and no hard truncation. | fixed | 70f5cee |
| F9.3 | fix-soon | A11y | Restore visible focus outlines. | fixed | 70f5cee |
| F9.4 | fix-soon | A11y | Respect reduced motion. | fixed | 70f5cee |
| F10.1 | fix-soon | Hygiene | Make GUI lint usable. | fixed | 70f5cee |
| F10.2 | fix-soon | Hygiene | Add GUI typecheck script. | fixed | 70f5cee |
| F10.3 | fix-soon | Hygiene | Resolve or issue-link source TODOs. | fixed | 0d4e25d |
| F10.4 | fix-soon | Hygiene | Remove unused GUI deps/exports. | fixed | 70f5cee |
| F1.6 | nit | CLI | Add effort aliases. | fixed | 634a288 |
| F4.4 | nit | Docs | Document Rosetta AVX warning as synthetic limitation. | fixed | 13e48a1 |
| F6.5 | nit | CLI | Add hints to common fatal errors. | fixed | 634a288 |
| F10.5 | nit | Hygiene | No change; keep scoped `@ts-expect-error`. | no-change-recorded | 7d6491e |

## Deferred rows

| id | reason |
|---|---|
| F6.3 | STOP now handles Ctrl-C and SIGTERM. PAUSE has no user-facing command in v0.20.1 and is deferred to a future control-surface milestone. |
| F10.5 | The only TypeScript suppression is a negative compile-time assertion using `@ts-expect-error`, not `@ts-ignore`. |
