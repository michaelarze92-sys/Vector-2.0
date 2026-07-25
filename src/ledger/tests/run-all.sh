#!/usr/bin/env bash
# Regression suite for the Estates Ledger. Run from the repo root:
#     python3 src/ledger/build.py && bash src/ledger/tests/run-all.sh
# Requires playwright (npm i playwright) — Chromium is preinstalled at
# /opt/pw-browsers/chromium in Claude Code web sessions.
set -uo pipefail
cd "$(dirname "$0")"
fail=0
for t in test_*.js; do
  out=$(node "$t" 2>&1)
  if grep -qE "PAGE ERROR|CONSOLE ERROR|FAILED:" <<<"$out"; then
    echo "FAIL  $t"; echo "$out" | sed 's/^/      /'; fail=1
  else
    echo "ok    $t"
  fi
done
exit $fail
