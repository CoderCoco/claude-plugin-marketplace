#!/usr/bin/env bash
# Append a handoff entry to the state file's handoff_log.
# Usage: append-handoff.sh <STATE_FILE> <FROM> <TO> <CTX> [OUTCOME]
#
# Values are passed to jq via --arg, so embedded quotes, backslashes,
# newlines, and other characters that would break a string-interpolated
# jq filter are safe.
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

if [ ! -f "$STATE_FILE" ]; then
  echo "State file not found: $STATE_FILE" >&2
  exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

TMP=$(mktemp "${STATE_FILE}.XXXXXX")
trap 'rm -f "$TMP"' EXIT

jq \
  --arg ts "$NOW" \
  --arg from "$FROM" \
  --arg to "$TO" \
  --arg ctx "$CTX" \
  --arg outcome "$OUTCOME" \
  '.handoff_log += [{ts: $ts, from: $from, to: $to, ctx: $ctx, outcome: $outcome}]' \
  "$STATE_FILE" > "$TMP"

mv "$TMP" "$STATE_FILE"
trap - EXIT

echo "$NOW $FROM -> $TO ($OUTCOME)"
