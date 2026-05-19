#!/usr/bin/env bash
# Persist a Navigator-produced plan into a swarm state file.
# Usage: set-plan.sh <STATE_FILE> <PLAN_JSON_FILE>
#
# PLAN_JSON_FILE is the path to a file containing the plan object the
# Navigator returned, e.g.:
#
#   {
#     "created_by": "Navigator",
#     "revision": 1,
#     "summary": "...",
#     "tasks": [
#       {"id": "T1", "desc": "...", "files": ["..."], "acceptance": "..."},
#       {"id": "T2", "desc": "...", "files": ["..."], "acceptance": "..."}
#     ],
#     "open_questions": [],
#     "constraints": []
#   }
#
# Side effects on the state file:
#   - .plan = <the plan, with .status defaulted to "pending" on each task>
#   - .phase = "building"
#   - .current_task = the first task's id (or null if no tasks)
#
# The plan JSON is fed to jq via --slurpfile, so it is read directly from
# disk rather than passed through argv. This keeps the script safe for
# plans of any size (no ARG_MAX limit) and preserves embedded quotes,
# backslashes, newlines, and shell metacharacters verbatim — the filter
# is never constructed via string interpolation.
set -euo pipefail

STATE_FILE="${1:-}"
PLAN_FILE="${2:-}"

if [ -z "$STATE_FILE" ] || [ -z "$PLAN_FILE" ]; then
  echo "Usage: set-plan.sh <STATE_FILE> <PLAN_JSON_FILE>" >&2
  exit 1
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "State file not found: $STATE_FILE" >&2
  exit 1
fi

if [ ! -f "$PLAN_FILE" ]; then
  echo "Plan JSON file not found: $PLAN_FILE" >&2
  exit 1
fi

# Validate the plan file is JSON before touching the state file.
if ! jq -e . "$PLAN_FILE" >/dev/null 2>&1; then
  echo "Plan file is not valid JSON: $PLAN_FILE" >&2
  exit 1
fi

TMP=$(mktemp "${STATE_FILE}.XXXXXX")
trap 'rm -f "$TMP"' EXIT

# --slurpfile reads the entire plan file into an array of parsed JSON values
# (the file always contains a single object, so $plan[0] is the plan itself).
# This avoids putting the plan body onto the command line via --argjson.
jq --slurpfile plan "$PLAN_FILE" '
  .plan = (
    $plan[0]
    | .tasks |= map(.status //= "pending")
  )
  | .phase = "building"
  | .current_task = (.plan.tasks[0].id // null)
' "$STATE_FILE" > "$TMP"

mv "$TMP" "$STATE_FILE"
trap - EXIT

echo "$STATE_FILE"
