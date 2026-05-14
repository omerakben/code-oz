# Homebrew tap setup

The `code-oz` Homebrew formula lives in a separate tap repository:
`omerakben/homebrew-code-oz`. Users install via `brew install omerakben/code-oz/code-oz` once the tap is published.

This directory holds the formula source-of-truth (`code-oz.rb.template`)
so changes ride alongside the code that produces the release assets.
The rendered `Formula/code-oz.rb` is copied into the tap repo per
release.

## One-time tap-repo creation

Run once when the v0.20.0-alpha.0 sweep ships:

```sh
gh repo create omerakben/homebrew-code-oz \
  --public \
  --description "Homebrew tap for the code-oz CLI"
git clone git@github.com:omerakben/homebrew-code-oz.git ~/Projects/homebrew-code-oz
cd ~/Projects/homebrew-code-oz
mkdir Formula
```

The tap repo conventionally only contains the `Formula/` directory and a
short README. No CI is required for v0.20; auto-bumping via GitHub
Actions is a v0.21 polish item.

## Per-release formula bump

For each tagged release, the four per-arch tarball SHA256 values come
from the release's `checksums.txt`. After `release.yml` publishes the
release, fetch the checksums and render the formula:

```sh
VERSION=0.20.0-alpha.0
TAG="v${VERSION}"
TAP=~/Projects/homebrew-code-oz

# 1. Fetch the per-arch SHA256s from the published checksums.txt.
curl -fsSL "https://github.com/omerakben/code-oz/releases/download/${TAG}/checksums.txt" \
  -o /tmp/checksums.txt

SHA_DA="$(awk -v f="code-oz-${TAG}-darwin-arm64.tar.gz" '$2==f{print $1}' /tmp/checksums.txt)"
SHA_DX="$(awk -v f="code-oz-${TAG}-darwin-x64.tar.gz" '$2==f{print $1}' /tmp/checksums.txt)"
SHA_LA="$(awk -v f="code-oz-${TAG}-linux-arm64.tar.gz" '$2==f{print $1}' /tmp/checksums.txt)"
SHA_LX="$(awk -v f="code-oz-${TAG}-linux-x64.tar.gz" '$2==f{print $1}' /tmp/checksums.txt)"

# 2. Substitute placeholders into the formula.
sed -e "s/__VERSION__/${VERSION}/g" \
    -e "s/__SHA256_DARWIN_ARM64__/${SHA_DA}/" \
    -e "s/__SHA256_DARWIN_X64__/${SHA_DX}/" \
    -e "s/__SHA256_LINUX_ARM64__/${SHA_LA}/" \
    -e "s/__SHA256_LINUX_X64__/${SHA_LX}/" \
    docs/homebrew/code-oz.rb.template > "${TAP}/Formula/code-oz.rb"

# 3. Audit locally before pushing. Use Homebrew's tap/name form so the
# formula is evaluated the same way users install it.
cd "${TAP}"
brew tap omerakben/code-oz "${TAP}" 2>/dev/null || true
brew audit --formula --strict --online omerakben/code-oz/code-oz
brew test omerakben/code-oz/code-oz

# 4. Commit + push.
git add Formula/code-oz.rb
git commit -m "code-oz ${VERSION}"
git push
```

## Verifying install end-to-end

After the tap is updated:

```sh
brew untap omerakben/code-oz 2>/dev/null || true
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz
code-oz --version  # should print 0.20.0-alpha.0
code-oz init /tmp/code-oz-brew-smoke
```

Uninstall + re-tap:

```sh
brew uninstall code-oz
brew untap omerakben/code-oz
```

## Why a template instead of the rendered file?

The four SHA256 values only exist after the binaries are built and
uploaded to the GitHub release. Keeping the formula as a template in
this repo lets the source-of-truth ride with the build pipeline; the
substituted output lives in the tap repo where Homebrew expects to find
it. The substitution step is the manual hand-off in the v0.20 release
flow.
