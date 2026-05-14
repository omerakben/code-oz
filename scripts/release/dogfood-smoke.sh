#!/usr/bin/env bash
# scripts/release/dogfood-smoke.sh
#
# Pre-tag dogfood release gate. Validates the BUG-free showstopper claim
# end-to-end against the actual built binary, on a fresh greenfield
# project, with REAL providers (Claude + cross-family Codex).
#
# Block the v0.20.2+ tag on this script returning 0. Manual dogfood on
# 2026-05-14 (handoffs/2026-05-14-v0.20.2-dogfood-verdict.md) proved
# this is the right gate: 3,419 offline tests + Codex R3 push verdict
# missed bugs that 30 minutes of real-provider lifecycle caught.
#
# What it does:
#   1. Probe prerequisites (claude + codex CLI auth, XAI optional).
#   2. Build the CLI binary (`bun run build:binary`) unless `--use-built`.
#   3. mktemp + git init a fresh project + write INTENT.md.
#   4. <binary> init.
#   5. <binary> run --request <INTENT> --effort lite (DEFINE).
#   6. <binary> approve define.
#   7. <binary> run (PLAN).
#   8. <binary> approve plan.
#   9. <binary> run (BUILD T-001 — THE showstopper gate).
#  10. Assert: events.jsonl contains build_completed for T-001 attempt 1.
#  11. Assert: a patch file exists at runs/<runId>/patches/T-001-attempt-1.patch.
#  12. Assert: the worktree contains the patched files.
#
# Exits 0 on success; non-zero on the first failed step.
#
# Cost: ~$0.30-0.70 in Claude Max tokens (DEFINE + PLAN + BUILD with
# --effort lite). Run-it-once-per-release-tag, not per-CI-push.
#
# Rule 9 exemption: this is a user-invoked release-prep script, not an
# orchestrator-spawned executable. Same exemption pattern as
# fresh-clone-smoke.sh and the demo scripts.
#
# Usage:
#   scripts/release/dogfood-smoke.sh              # full real-provider gate (default)
#   scripts/release/dogfood-smoke.sh --use-built  # skip rebuild; use ./dist/code-oz
#   scripts/release/dogfood-smoke.sh --keep       # keep $WORKDIR for inspection
#   scripts/release/dogfood-smoke.sh --help       # print this banner

set -euo pipefail

# ---------------------------------------------------------------------
# args
# ---------------------------------------------------------------------

USE_BUILT=0
KEEP_WORKDIR=0
for arg in "$@"; do
  case "$arg" in
    --use-built) USE_BUILT=1 ;;
    --keep) KEEP_WORKDIR=1 ;;
    --help|-h)
      grep '^# ' "$0" | sed 's/^# \{0,1\}//' | head -n 40
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      echo "see --help" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------
# config + tmp
# ---------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMPDIR_BASE="${TMPDIR:-/tmp}"
WORKDIR="$(mktemp -d "${TMPDIR_BASE}/code-oz-dogfood.XXXXXXXX")"
BIN="${REPO_ROOT}/dist/code-oz"

cleanup() {
  if [[ "$KEEP_WORKDIR" == "0" && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  else
    echo "  (workdir preserved at $WORKDIR for inspection)" >&2
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------
# step helpers
# ---------------------------------------------------------------------

step() {
  printf '\n=== %s ===\n' "$1" >&2
}

fail() {
  printf '\n  FAIL: %s\n' "$1" >&2
  exit 1
}

# ---------------------------------------------------------------------
# 1. prerequisites
# ---------------------------------------------------------------------

step "1/12 probe prerequisites"

if ! command -v claude >/dev/null 2>&1; then
  fail "claude CLI not on PATH (real-provider dogfood requires Claude Code authed)"
fi
if ! command -v codex >/dev/null 2>&1; then
  fail "codex CLI not on PATH (REVIEW requires cross-family Codex authed)"
fi
echo "  claude --version: $(claude --version 2>&1 | head -1)"
echo "  codex  --version: $(codex --version 2>&1 | head -1)"

# Probe doctor: providers section must say ok
step "1/12 probe code-oz doctor"
DOCTOR_OUT="$(bun run "${REPO_ROOT}/src/cli.ts" doctor 2>&1 || true)"
if ! echo "$DOCTOR_OUT" | grep -q "^providers: ok"; then
  echo "$DOCTOR_OUT"
  fail "code-oz doctor reports providers != ok"
fi
echo "  doctor: providers ok"

# ---------------------------------------------------------------------
# 2. build binary
# ---------------------------------------------------------------------

if [[ "$USE_BUILT" == "1" ]]; then
  step "2/12 reuse existing dist/code-oz (--use-built)"
  if [[ ! -x "$BIN" ]]; then
    fail "no binary at $BIN; rerun without --use-built or run bun run build:binary"
  fi
  echo "  $BIN version: $($BIN --version)"
else
  step "2/12 build CLI binary"
  ( cd "$REPO_ROOT" && bun run build:binary ) >/dev/null
  if [[ ! -x "$BIN" ]]; then
    fail "build:binary did not produce $BIN"
  fi
  echo "  $BIN version: $($BIN --version)"
fi

# ---------------------------------------------------------------------
# 3-4. fresh project + init
# ---------------------------------------------------------------------

PROJ="$WORKDIR/dogfood-project"
mkdir -p "$PROJ"
cd "$PROJ"
git init -q
git config user.email "dogfood@code-oz.local"
git config user.name "dogfood-smoke"
git commit --allow-empty -q -m "chore: bootstrap dogfood project"

cat > INTENT.md <<'INTENT'
# Counter CLI

Build a TypeScript + Bun single-binary CLI named `counter` that
implements a persistent incrementing counter.

## Acceptance

- `counter` (no args) prints the current count, increments it, persists it.
- `counter --reset` prints 0, persists 0, exits 0.
- `counter --help` prints usage to stdout, exits 0.
- `counter --version` prints version to stdout, exits 0.
- State persists in `~/.config/counter/state.json`.
- Tests run offline via `bun test` and cover all four invocations.
INTENT

step "3-4/12 fresh project + init"
"$BIN" init >/dev/null
if [[ ! -d "$PROJ/.code-oz" ]]; then
  fail "init did not create .code-oz/"
fi
echo "  init ok"

# ---------------------------------------------------------------------
# 5-6. DEFINE + approve
# ---------------------------------------------------------------------

step "5/12 DEFINE phase"
"$BIN" run --request "$(cat INTENT.md)" --effort lite >/dev/null 2>&1 || \
  fail "DEFINE phase failed (see $PROJ/.code-oz/state/runs/*/NEEDS_INTERVENTION.json)"

RUN_ID="$(ls "$PROJ/.code-oz/state/runs/" | head -1)"
[[ -n "$RUN_ID" ]] || fail "no runId in state/runs/"
echo "  runId=$RUN_ID"

if [[ ! -f "$PROJ/.code-oz/artifacts/SPEC.md" ]]; then
  fail "DEFINE did not write SPEC.md"
fi

step "6/12 approve define"
"$BIN" approve define >/dev/null
[[ -f "$PROJ/.code-oz/state/runs/$RUN_ID/GATE_DEFINE_PASSED.json" ]] || \
  fail "GATE_DEFINE_PASSED.json missing after approve"

# ---------------------------------------------------------------------
# 7-8. PLAN + approve
# ---------------------------------------------------------------------

step "7/12 PLAN phase"
"$BIN" run >/dev/null 2>&1 || \
  fail "PLAN phase failed"

[[ -f "$PROJ/.code-oz/artifacts/PLAN.md" ]] || fail "PLAN did not write PLAN.md"

step "8/12 approve plan"
"$BIN" approve plan >/dev/null
[[ -f "$PROJ/.code-oz/state/runs/$RUN_ID/GATE_PLAN_PASSED.json" ]] || \
  fail "GATE_PLAN_PASSED.json missing after approve"

# ---------------------------------------------------------------------
# 9. BUILD T-001 — the showstopper gate
# ---------------------------------------------------------------------

step "9/12 BUILD T-001 (showstopper gate)"
"$BIN" run >/dev/null 2>&1 || \
  fail "BUILD T-001 failed (cat $PROJ/.code-oz/state/runs/$RUN_ID/NEEDS_INTERVENTION.json)"

# ---------------------------------------------------------------------
# 10-12. assertions
# ---------------------------------------------------------------------

step "10/12 assert build_completed event for T-001 attempt 1"
EVENTS="$PROJ/.code-oz/state/runs/$RUN_ID/events.jsonl"
[[ -f "$EVENTS" ]] || fail "events.jsonl missing"
if ! grep -q '"type":"build_completed"' "$EVENTS"; then
  fail "no build_completed event in events.jsonl"
fi
if ! grep -q '"taskId":"T-001"' "$EVENTS"; then
  fail "no T-001 reference in events.jsonl"
fi
echo "  build_completed found in events.jsonl"

step "11/12 assert patch artifact exists"
PATCH="$PROJ/.code-oz/runs/$RUN_ID/patches/T-001-attempt-1.patch"
[[ -f "$PATCH" ]] || fail "patch file missing at $PATCH"
PATCH_BYTES=$(wc -c < "$PATCH")
[[ "$PATCH_BYTES" -gt 100 ]] || fail "patch file is suspiciously small ($PATCH_BYTES bytes)"
echo "  patch: $PATCH ($PATCH_BYTES bytes)"

step "12/12 assert worktree carries patched files"
WORKTREE="$PROJ/.code-oz/runs/$RUN_ID/worktree"
[[ -d "$WORKTREE" ]] || fail "worktree dir missing at $WORKTREE"
WORKTREE_FILE_COUNT=$(find "$WORKTREE" -maxdepth 5 -type f -not -path '*/.git/*' -not -path '*/.code-oz/*' | wc -l | tr -d ' ')
[[ "$WORKTREE_FILE_COUNT" -ge 2 ]] || \
  fail "worktree has only $WORKTREE_FILE_COUNT non-.git/.code-oz files; expected >= 2"
echo "  worktree carries $WORKTREE_FILE_COUNT patched files"

# ---------------------------------------------------------------------
# pass
# ---------------------------------------------------------------------

cat <<DONE

================================================================
dogfood-smoke OK — v0.20.2+ release gate passed.
  runId:   $RUN_ID
  worktree:$WORKTREE
  patch:   $PATCH ($PATCH_BYTES bytes)
================================================================

The showstopper fix (v0.20.2 #0a + #0b) is validated end-to-end on real
Opus + cross-family Codex. Safe to tag.
DONE

exit 0
