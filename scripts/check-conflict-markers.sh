#!/usr/bin/env bash
set -e

echo "Checking tracked files for leftover merge conflict markers..."

# Perform git grep search for conflict markers
CONFLICTS=$(git grep -n -E "^(<<<<<<<|=======|>>>>>>>)" -- ':!scripts/check-conflict-markers.sh' || true)

if [ -n "$CONFLICTS" ]; then
  echo "Error: Unresolved merge conflict markers detected in tracked files:"
  echo "$CONFLICTS"
  exit 1
fi

echo "Clean! No conflict markers detected."
exit 0
