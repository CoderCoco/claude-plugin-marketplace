#!/usr/bin/env bash
# Append a handoff entry to the state file's handoff_log.
# Usage: append-handoff.sh <STATE_FILE> <FROM> <TO> <CTX> [OUTCOME]
set -euo pipefail

STATE_FILE="${1:-}"
FROM="${2:-}"
TO="${3:-}"
CTX="${4:-}"
OUTCOME="${5:-pending}"

if [ -z "$STATE_FILE" ] || [ -z "$FROM" ] || [ -z "$TO" ] || [ -z "$CTX" ]; then
  echo "Usage: append-handoff.sh <STATE_FILE> <FROM> <TO> <CTX> [OUTCOME]" >&2
  exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "${SCRIPT_DIR}/update-state.sh" "$STATE_FILE" \
  ".handoff_log += [{ts: \"$NOW\", from: \"$(echo "$FROM" | sed 's/"/\\"/g')\", to: \"$(echo "$TO" | sed 's/"/\\"/g')\", ctx: \"$(echo "$CTX" | sed 's/"/\\"/g')\", outcome: \"$(echo "$OUTCOME" | sed 's/"/\\"/g')\"}]" > /dev/null

echo "$NOW $FROM -> $TO ($OUTCOME)"
