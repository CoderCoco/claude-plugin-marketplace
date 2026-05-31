#!/usr/bin/env bash
# mission-state-read.sh <issue_number>
# Prints full state JSON to stdout. Exits 1 if file does not exist.
set -euo pipefail

ISSUE_NUMBER="$1"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUMBER}.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: No mission state found for issue #${ISSUE_NUMBER}" >&2
  exit 1
fi

cat "$STATE_FILE"
