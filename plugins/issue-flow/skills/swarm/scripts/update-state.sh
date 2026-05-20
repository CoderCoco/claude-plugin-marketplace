#!/usr/bin/env bash
# Apply a jq filter to a swarm state file atomically.
# Usage: update-state.sh <STATE_FILE> <JQ_FILTER>
# Example: update-state.sh "$STATE" '.phase = "building"'
set -euo pipefail

STATE_FILE="${1:-}"
FILTER="${2:-}"

if [ -z "$STATE_FILE" ] || [ -z "$FILTER" ]; then
  echo "Usage: update-state.sh <STATE_FILE> <JQ_FILTER>" >&2
  exit 1
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "State file not found: $STATE_FILE" >&2
  exit 1
fi

TMP=$(mktemp "${STATE_FILE}.XXXXXX")
trap 'rm -f "$TMP"' EXIT

jq "$FILTER" "$STATE_FILE" > "$TMP"
mv "$TMP" "$STATE_FILE"
trap - EXIT

echo "$STATE_FILE"
