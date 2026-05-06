#!/usr/bin/env bash
# Move a GitHub project item to "In Progress".
# Usage: move-to-in-progress.sh <ITEM_ID> <PROJECT_NUMBER> <OWNER>
set -euo pipefail

ITEM_ID="${1:-}"
PROJECT_NUMBER="${2:-}"
OWNER="${3:-}"

if [ -z "$ITEM_ID" ] || [ -z "$PROJECT_NUMBER" ]; then
  echo "Issue is not on any project board — skipping status update."
  exit 0
fi

FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json)
STATUS_FIELD_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .id')
IN_PROGRESS_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .options[] | select(.name == "In Progress") | .id')

if [ -z "$IN_PROGRESS_ID" ]; then
  echo "No 'In Progress' column found on project board — skipping."
  exit 0
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_NUMBER" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$IN_PROGRESS_ID"

echo "Moved to 'In Progress'."
