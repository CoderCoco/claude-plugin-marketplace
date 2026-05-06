#!/usr/bin/env bash
# Look up a GitHub Projects v2 Status option by name.
# Usage: get-project-status-option.sh <PROJECT_NUMBER> <OWNER> --status <NAME>
# Output (two lines): STATUS_FIELD_ID then OPTION_ID
# Exit 1 if the option is not found.
set -euo pipefail

PROJECT_NUMBER="${1:-}"
OWNER="${2:-}"
shift 2

STATUS_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --status) STATUS_NAME="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$PROJECT_NUMBER" ] || [ -z "$OWNER" ] || [ -z "$STATUS_NAME" ]; then
  echo "Usage: get-project-status-option.sh <PROJECT_NUMBER> <OWNER> --status <NAME>" >&2
  exit 1
fi

FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json)

STATUS_FIELD_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .id')
OPTION_ID=$(echo "$FIELD_JSON" | jq -r --arg name "$STATUS_NAME" \
  '.fields[] | select(.name == "Status") | .options[] | select(.name | ascii_downcase == ($name | ascii_downcase)) | .id')

if [ -z "$OPTION_ID" ]; then
  echo "No status option matching '$STATUS_NAME' found on project $PROJECT_NUMBER." >&2
  exit 1
fi

echo "$STATUS_FIELD_ID"
echo "$OPTION_ID"
