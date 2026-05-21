#!/usr/bin/env bash
# resolve-code-oz.sh — thin launcher for the code-oz engine.
#
# Usage: resolve-code-oz.sh <subcommand> [args...]
#   e.g. resolve-code-oz.sh run
#        resolve-code-oz.sh doctor
#        resolve-code-oz.sh init
#        resolve-code-oz.sh resume
#
# Resolution order (frozen — D0_FINDINGS §2.1):
#   1. Windows detection  -> hard-stop (v0.21+)
#   2. code-oz on PATH    -> exec binary directly
#   3. npx on PATH        -> exec npx -y @tuel/code-oz@<pinned> <args>
#      on npx exit != 0   -> print scope-routing caveat, exit non-zero
#   4. neither present    -> hard-stop with install instructions
#
# The pinned version is read from the sibling plugin.json — no second
# version literal lives here.
#
# Test seam: set CODE_OZ_FAKE_UNAME to override the real `uname -s` output.
# This lets the Windows-rejection branch be exercised on macOS/Linux in CI.

set -euo pipefail

# ---------------------------------------------------------------------------
# Locate plugin.json relative to this script's own directory.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_JSON="${SCRIPT_DIR}/../.claude-plugin/plugin.json"

# ---------------------------------------------------------------------------
# Read pinned version from plugin.json using grep + sed (no jq dependency).
# The version line looks like:  "version": "0.20.3-alpha.0",
# ---------------------------------------------------------------------------
if [[ ! -f "${PLUGIN_JSON}" ]]; then
  printf 'resolve-code-oz: plugin.json not found at %s\n' "${PLUGIN_JSON}" >&2
  exit 1
fi

PINNED_VERSION="$(grep '"version"' "${PLUGIN_JSON}" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)"

if [[ -z "${PINNED_VERSION}" ]]; then
  printf 'resolve-code-oz: could not parse version from %s\n' "${PLUGIN_JSON}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Platform check — reject Windows before any PATH resolution.
# CODE_OZ_FAKE_UNAME overrides uname output for testing.
# ---------------------------------------------------------------------------
if [[ -n "${CODE_OZ_FAKE_UNAME:-}" ]]; then
  OS_NAME="${CODE_OZ_FAKE_UNAME}"
else
  OS_NAME="$(uname -s 2>/dev/null || echo '')"
fi

case "${OS_NAME}" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT*)
    printf 'Windows is not supported until v0.21+. The code-oz engine binary is darwin/linux only.\n' >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 2. code-oz found on PATH — exec directly, forwarding all args.
# ---------------------------------------------------------------------------
if command -v code-oz >/dev/null 2>&1; then
  exec code-oz "$@"
fi

# ---------------------------------------------------------------------------
# 3. npx available — exec via npx with the pinned package version.
# If npx exits non-zero, print the scope-routing caveat and propagate the
# exit code. (We cannot use exec here because we need to capture the result.)
# Trade-off: without exec the bash wrapper sits between the host and the npx
# child, so OS signals (SIGTERM/SIGINT) are not forwarded to the child process
# on this branch — unlike branch 2 which uses exec for direct signal delivery.
# ---------------------------------------------------------------------------
if command -v npx >/dev/null 2>&1; then
  # Use a subshell so set -e does not abort us before we can print the caveat.
  if npx -y "@tuel/code-oz@${PINNED_VERSION}" "$@"; then
    exit 0
  else
    NPX_EXIT=$?
    printf '\n' >&2
    printf 'resolve-code-oz: npx invocation of @tuel/code-oz@%s failed (exit %s).\n' \
      "${PINNED_VERSION}" "${NPX_EXIT}" >&2
    printf 'A @tuel scope-routing trap may be 404ing on npm.pkg.github.com.\n' >&2
    printf 'To fix:\n' >&2
    printf '  Option A — install via Homebrew (bypasses npm scope routing):\n' >&2
    printf '    brew install omerakben/tap/code-oz\n' >&2
    printf '  Option B — set the @tuel registry in your .npmrc:\n' >&2
    printf '    @tuel:registry=https://registry.npmjs.org/\n' >&2
    exit "${NPX_EXIT}"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Neither code-oz nor npx/npm available — hard-stop.
# ---------------------------------------------------------------------------
printf 'code-oz is not installed. Install:\n' >&2
printf '  npm i -g @tuel/code-oz\n' >&2
printf '  OR\n' >&2
printf '  brew install omerakben/tap/code-oz\n' >&2
exit 1
