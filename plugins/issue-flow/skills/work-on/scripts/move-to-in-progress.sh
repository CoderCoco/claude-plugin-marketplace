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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOOKUP=$(bash "${SCRIPT_DIR}/get-project-status-option.sh" "$PROJECT_NUMBER" "$OWNER" --status "in progress" 2>&1) || {
  echo "No 'In Progress' column found on project board — skipping."
  exit 0
}
STATUS_FIELD_ID=$(echo "$LOOKUP" | head -1)
IN_PROGRESS_ID=$(echo "$LOOKUP" | tail -1)

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_NUMBER" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$IN_PROGRESS_ID"

echo "Moved to 'In Progress'."
