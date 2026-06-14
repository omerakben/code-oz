#!/usr/bin/env bash
# scripts/release/fresh-clone-smoke.sh
#
# Pre-tag fresh-clone smoke check. Run this BEFORE tagging a release to
# catch the "your own docs contradict the README" class of HN-bait bugs
# Codex R0 flagged as the biggest HN-class risk.
#
# What it does:
#   1. Clone the current branch into a fresh tmp directory.
#   2. `bun install`.
#   3. `bun test`.
#   4. `bun run demo:todo-cli`.
#   5. `bun run demo:failure-gates`.
#   6. Lightweight drift checks against the publicly-claimed provider story
#      (no Gemini live; no 'simulation' word; README links resolve).
#
# Exits 0 on success; non-zero on the first failed step. Output prints each
# step's status so the failing step is obvious.
#
# Rule 9 exemption: this is a user-invoked release-prep script, not an
# orchestrator-spawned executable. Same exemption pattern as the demo
# scripts under scripts/demo/.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release/fresh-clone-smoke.sh

Runs a pre-tag smoke check from a fresh clone of the current branch:
  1. clone current branch into a temp directory
  2. install root and code-oz-gui dependencies
  3. run bun test
  4. run demo:todo-cli
  5. run demo:failure-gates
  6. run lightweight README/provider drift checks

Options:
  -h, --help   Show this help.
EOF
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  '')
    ;;
  *)
    printf 'fresh-clone-smoke: unknown argument: %s\n\n' "$1" >&2
    usage >&2
    exit 2
    ;;
esac

# ---------------------------------------------------------------------
# config
# ---------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD)"
TMPDIR_BASE="${TMPDIR:-/tmp}"
WORKDIR="$(mktemp -d "${TMPDIR_BASE}/code-oz-smoke.XXXXXXXX")"

cleanup() {
  if [[ -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------

step() {
  echo ""
  echo "=== $1 ==="
}

pass() {
  echo "  ✓ PASS — $1"
}

fail() {
  echo "  ✗ FAIL — $1"
  echo ""
  echo "Smoke check FAILED at step: $1"
  exit 1
}

# ---------------------------------------------------------------------
# 1. clone
# ---------------------------------------------------------------------

step "1/6  clone $BRANCH into $WORKDIR/repo"

git clone --quiet --branch "$BRANCH" "$REPO_ROOT" "$WORKDIR/repo" || fail "clone failed"
pass "cloned to $WORKDIR/repo"

cd "$WORKDIR/repo"

# ---------------------------------------------------------------------
# 2. bun install
# ---------------------------------------------------------------------

step "2/6  bun install (root + code-oz-gui sub-project if present)"

bun install --silent 2>&1 | tail -5 || fail "bun install (root) failed"
pass "root deps installed"

# code-oz-gui is a sibling sub-project with its own package.json. Tests
# under tests/ import from code-oz-gui/lib/, so a fresh clone needs its
# deps installed too — otherwise tests fail with "Cannot find module"
# errors that look like bugs but are really missing sub-project deps.
if [[ -f "code-oz-gui/package.json" ]]; then
  (cd code-oz-gui && bun install --silent 2>&1 | tail -5) || fail "bun install (code-oz-gui) failed"
  pass "code-oz-gui sub-project deps installed"
fi

# ---------------------------------------------------------------------
# 3. bun test
# ---------------------------------------------------------------------

step "3/6  bun test"

if bun test 2>&1 | tee "$WORKDIR/test.out" | tail -10; then
  TEST_PASS_COUNT=$(awk '$2 == "pass" { pass=$1 } END { print pass + 0 }' "$WORKDIR/test.out")
  TEST_FAIL_COUNT=$(awk '$2 == "fail" { fail=$1 } END { print fail + 0 }' "$WORKDIR/test.out")
  if [[ "$TEST_FAIL_COUNT" != "0" ]]; then
    fail "tests failed: $TEST_FAIL_COUNT failures"
  fi
  pass "bun test green ($TEST_PASS_COUNT pass)"
else
  fail "bun test reported errors"
fi

# ---------------------------------------------------------------------
# 4. demo:todo-cli (happy path)
# ---------------------------------------------------------------------

step "4/6  bun run demo:todo-cli (happy path)"

if bun run demo:todo-cli > "$WORKDIR/demo-todo.out" 2>&1; then
  pass "demo:todo-cli exit 0"
else
  echo "  (last 30 lines of output:)"
  tail -30 "$WORKDIR/demo-todo.out"
  fail "demo:todo-cli failed"
fi

# ---------------------------------------------------------------------
# 5. demo:failure-gates
# ---------------------------------------------------------------------

step "5/6  bun run demo:failure-gates (5 fixtures)"

if bun run demo:failure-gates > "$WORKDIR/demo-failure.out" 2>&1; then
  PASS_LINE="$(grep -E '^[0-9]+/[0-9]+ fixtures passed' "$WORKDIR/demo-failure.out" || true)"
  if [[ "$PASS_LINE" == "5/5 fixtures passed." ]]; then
    pass "demo:failure-gates 5/5"
  else
    echo "  (last 20 lines of output:)"
    tail -20 "$WORKDIR/demo-failure.out"
    fail "demo:failure-gates expected 5/5; got: $PASS_LINE"
  fi
else
  echo "  (last 30 lines of output:)"
  tail -30 "$WORKDIR/demo-failure.out"
  fail "demo:failure-gates failed"
fi

# ---------------------------------------------------------------------
# 6. drift checks (public claims vs reality)
# ---------------------------------------------------------------------

step "6/6  drift checks (public claims vs reality)"

# Drift check A: 'simulation' word must NOT appear in package.json description
# or in README.
if grep -q 'simulation' package.json; then
  fail "'simulation' word found in package.json (should be removed per GPT Pro audit #19)"
fi
if grep -qi 'software-company simulation' README.md; then
  fail "'software-company simulation' phrase found in README.md (should be in ABOUT.md historical context only)"
fi
pass "no 'simulation' overclaim in package.json or README"

# Drift check B: Gemini must NOT be claimed as a live provider in README.
# We look for specific overclaim phrasings only; the README is allowed to
# mention Gemini in a "stub" or "not working" context (it does so explicitly
# in the "What is simulated" table).
if grep -E '"gemini".*live|Gemini SDK|Gemini.*OAuth' README.md > /dev/null 2>&1; then
  fail "Gemini overclaim phrasing found in README"
fi
# Also: if README mentions Gemini at all, there should be a clear "stub" or
# "not v0.1" qualifier somewhere nearby in the same file.
if grep -q 'Gemini' README.md; then
  if grep -E 'Stub provider|not a working invocation adapter|not v0\.1|stub' README.md > /dev/null 2>&1; then
    pass "Gemini mentioned with explicit stub qualifier elsewhere in README"
  else
    fail "Gemini mentioned but no stub qualifier present anywhere in README"
  fi
else
  pass "Gemini not mentioned in README"
fi

# Drift check C: package.json keywords must NOT include 'gemini'.
if grep -q '"gemini"' package.json; then
  fail "'gemini' is still in package.json keywords (Codex R0 N4)"
fi
pass "package.json keywords clean of gemini"

# Drift check D: 'AI software company' must NOT appear in README hero region.
# We check the first 25 lines (above-fold).
if head -25 README.md | grep -q 'AI software company'; then
  fail "'AI software company' appears in README hero region (above-fold); should be ABOUT.md historical only"
fi
pass "no 'AI software company' active tagline in README hero"

# Drift check E: package.json description matches the README hero positioning.
DESC=$(grep -oE '"description"[^,]*' package.json | sed 's/"description": "\(.*\)"/\1/' | head -1)
if echo "$DESC" | grep -q 'CI-style gates'; then
  pass "package.json description aligned with README hero"
else
  fail "package.json description '$DESC' does not contain 'CI-style gates'"
fi

# Drift check F: SECURITY, CONTRIBUTING, COC, TRUST, ROADMAP links from README
# all resolve to existing files.
for path in SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md docs/TRUST.md docs/design/ROADMAP.md docs/contracts/PROVIDERS.md docs/comparisons/ai-coding-agents.md docs/benchmarks/agent-gate-bench.md docs/demo/02-failure-gates/README.md; do
  if [[ ! -f "$path" ]]; then
    fail "README links target $path but the file does not exist"
  fi
done
pass "all README-linked current public files exist"

# ---------------------------------------------------------------------
# done
# ---------------------------------------------------------------------

echo ""
echo "================================================================"
echo "  ALL CHECKS PASSED."
echo "  Repository is ready to tag at the current HEAD."
echo "================================================================"
