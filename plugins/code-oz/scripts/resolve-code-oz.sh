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
# Read pinned version from plugin.json. Prefer jq for correct JSON parsing;
# fall back to a line-anchored grep + sed when jq is not installed. The loose
# `grep '"version"'` of earlier revisions could match a nested or dependency
# "version" key, so the fallback anchors the key to the start of the line.
# The version line looks like:  "version": "0.20.3-alpha.0",
# ---------------------------------------------------------------------------
if [[ ! -f "${PLUGIN_JSON}" ]]; then
  printf 'resolve-code-oz: plugin.json not found at %s\n' "${PLUGIN_JSON}" >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  PINNED_VERSION="$(jq -r '.version // empty' "${PLUGIN_JSON}" 2>/dev/null || true)"
else
  PINNED_VERSION="$(grep -E '^[[:space:]]*"version"[[:space:]]*:' "${PLUGIN_JSON}" | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' || true)"
fi

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
# Drop empty-string positional arguments before resolution. A plugin command
# card renders `<subcommand> "$ARGUMENTS"`; with no user arguments Claude Code
# substitutes an empty $ARGUMENTS, leaving a literal "" that the engine's
# subcommand dispatcher (0.21.1+) rejects as an unknown subcommand. An empty
# positional is never meaningful to code-oz, so the launcher strips it before
# both the PATH-exec and npx branches. The array form preserves args that
# contain spaces; ${a[@]+"${a[@]}"} is the bash-3.2 + `set -u`-safe way to
# expand a possibly-empty array.
# ---------------------------------------------------------------------------
filtered_args=()
for arg in "$@"; do
  [ -n "${arg}" ] && filtered_args+=("${arg}")
done
set -- ${filtered_args[@]+"${filtered_args[@]}"}

# ---------------------------------------------------------------------------
# 2. code-oz found on PATH — exec directly, forwarding all args.
# ---------------------------------------------------------------------------
if command -v code-oz >/dev/null 2>&1; then
  exec code-oz "$@"
fi

# ---------------------------------------------------------------------------
# 3. npx available — run npx with the pinned package version.
# We cannot use exec here because we must print the scope-routing caveat after
# npx returns. Without exec the bash wrapper sits between the host and the npx
# child, so we run npx in the background and install a trap that forwards
# SIGTERM/SIGINT to the child — otherwise Ctrl-C / a host kill would terminate
# the wrapper but orphan the npx (and engine) process. Branch 2 needs no such
# trap because exec replaces this shell and signals reach the binary directly.
# ---------------------------------------------------------------------------
if command -v npx >/dev/null 2>&1; then
  npx -y "@tuel/code-oz@${PINNED_VERSION}" "$@" &
  NPX_PID=$!
  # Forward termination signals to the npx child, then let `wait` reap it.
  trap 'kill -TERM "${NPX_PID}" 2>/dev/null || true' TERM INT
  # `wait` returns the child's exit status; with set -e a non-zero status would
  # abort before we can print the caveat, so capture it with `|| NPX_EXIT=$?`.
  NPX_EXIT=0
  wait "${NPX_PID}" || NPX_EXIT=$?
  trap - TERM INT
  if [[ "${NPX_EXIT}" -eq 0 ]]; then
    exit 0
  fi
  printf '\n' >&2
  printf 'resolve-code-oz: npx invocation of @tuel/code-oz@%s failed (exit %s).\n' \
    "${PINNED_VERSION}" "${NPX_EXIT}" >&2
  printf 'A @tuel scope-routing trap may be 404ing on npm.pkg.github.com.\n' >&2
  printf 'To fix:\n' >&2
  printf '  Option A — install via Homebrew (bypasses npm scope routing):\n' >&2
  printf '    brew install omerakben/code-oz/code-oz\n' >&2
  printf '  Option B — set the @tuel registry in your .npmrc:\n' >&2
  printf '    @tuel:registry=https://registry.npmjs.org/\n' >&2
  exit "${NPX_EXIT}"
fi

# ---------------------------------------------------------------------------
# 4. Neither code-oz nor npx/npm available — hard-stop.
# ---------------------------------------------------------------------------
printf 'code-oz is not installed. Install:\n' >&2
printf '  npm i -g @tuel/code-oz\n' >&2
printf '  OR\n' >&2
printf '  brew install omerakben/code-oz/code-oz\n' >&2
exit 1
