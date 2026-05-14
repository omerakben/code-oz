# Codex R2 response: public-claims bundle review

> **Thread:** `019e2706-2f95-77e1-b4f3-40eebc02bb56`
> **Model:** `gpt-5.5` xhigh, sandbox: read-only
> **Briefing:** Codex public-claims bundle review on commits C1-C5 + C11-C13 + C15.1 + C16-C18
> **Date:** 2026-05-14

## 1. Verdict: `fix-first`

Current HEAD is not tag-ready. The public story is much better than R0/R1 framing, but four block-push issues an HN reader or installer could catch within minutes.

## 2. Per-prompt response

1. **HN-class objections**: strongest is **version drift** — README + release notes say `v0.20.1-alpha.0`, but `package.json:3`, `src/cli.ts:7`, `src/config/schema.ts:308` (DEFAULT_CONFIG.version) all still say `0.20.0-alpha.0`. The npm wrapper at `npm-wrapper/index.cjs:230` reads that version and downloads `v${version}` from GitHub.
2. **Cross-doc consistency**: provider story aligned (Claude/Codex/xAI/Fake live, Gemini stub, OpenCode/Roo future). Release scope story NOT aligned: release notes claim no engineering/source surface changed, but `git diff origin/main..HEAD -- src/` is NOT empty.
3. **Comparison table**: no material 2-day drift. Aider docs still show installer + uv + pipx + pip. Continue still ships shell installer + npm. Claude Code, Cursor, Devin docs still support partial-credit framing. All footnotes valid.
4. **Benchmark framing**: strong enough. `agent-gate-bench.md:3` says protocol not proof. README points to it as "Benchmark protocol".
5. **Trust posture honesty**: mostly honest, but `docs/TRUST.md:18` overclaims `.gitignore`-matched files are not sent. Production at `src/providers/manifest.ts:72` only enforces explicit requested paths, path safety, and `permissions.read`. There is no universal `.gitignore` filter on the provider-send path.
6. **Comparison ↔ PROVIDERS.md alignment**: no contradiction. `partial⁷` for "Runs on CLI auth" is consistent with xAI's `XAI_API_KEY` requirement.
7. **Release notes**: NOT ready.
   - Claim "without changing the engineering surface" is false — branch has src/ changes.
   - Tells Ozzy to run `gh release create`, but `release.yml` already creates the release on tag push. Should use `gh release edit --notes-file` instead.
8. **Block-tag findings**: yes, four below.

## 3. Block-push findings

- **B1**: Version bump missing across release-critical surfaces. `package.json`, `src/cli.ts`, and `DEFAULT_CONFIG.version` in `src/config/schema.ts` still say `0.20.0-alpha.0`. Fix everywhere; add a release check that asserts tag, package version, binary `--version`, npm wrapper URL, and manifest version agree.
- **B2**: v0.20.1 release notes + CHANGELOG falsely say no production source changes. Branch has 3 src/ fix commits ahead of origin/main (`85afcdf` provider-auth classification, `293f33e` intervention-pointer specificity, `634a288` CLI first-run-fake + resume-paths fixes) totaling 643 insertions / 174 deletions across 18 files. Either retarget the release scope or honestly include those src/ fixes in the release narrative.
- **B3**: TRUST.md overclaims `.gitignore` protection for provider sends. Either implement universal ignore-policy enforcement, or reword TRUST to the actual contract: explicit `ProviderRequest.files`, path safety, `permissions.read`, repo-context `.gitignore` behavior where applicable, `.code-ozignore` only where wired.
- **B4**: Release publishing path is contradictory. `release.yml` creates the release with thin notes when the tag is pushed. Release-notes drafts say `gh release create ... --notes-file`, which would race or fail. Decide: either embed the rich notes into `release.yml`, or have Ozzy use `gh release edit --notes-file ...` after the workflow finishes.

## 4. Medium findings

- **M1**: Test count drift. README and SECURITY/CONTRIBUTING/CLAUDE still say `3390`, while release notes say `3395`. Current `bun test` reports 3395 pass / 0 fail / 2 skip. Update the stale references.
- **M2**: `scripts/release/fresh-clone-smoke.sh` comments claim test-count badge drift check, but the script does not compare the captured test count to the README badge. Either implement or remove the comment.
- **M3**: `install.sh`, `npm-wrapper/index.cjs:58`, and `scripts/build-binaries.ts:89` still say Windows is deferred to `v0.20.1`. For a v0.20.1 tag, that should become "v0.21+" or "a future distribution milestone."
- **M4**: SECURITY/TRUST reference `src/providers/xai.ts:redact`, but the actual helper is `redactSecrets` (line 383).

## 5. What I would change

I'd ship this as a slightly broader **"first-run polish + public truth sync"** release, not a docs-only truth release. Say plainly that v0.20.1 includes no new gate authority, but does include first-run runtime/distribution hardening (the 3 pre-existing src/ commits) plus public-claim cleanup (this session's work). That story matches the branch and is more defensible than claiming no engineering change.

## Read-only note

Codex did not rerun tests or the smoke script (read-only sandbox; those commands write outputs/tmp files). Reviewed live files and command-readable git state only.
