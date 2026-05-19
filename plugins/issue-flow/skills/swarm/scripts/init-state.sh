#!/usr/bin/env bash
# Initialise a swarm state file for an issue.
# Usage: init-state.sh <ISSUE_NUMBER> <REPO> <TITLE> <BRANCH>
# Writes .claude/swarm-state/issue-<N>.json relative to the current working
# directory (the worktree root). Refuses to overwrite an existing state file
# unless SWARM_FORCE=1 is set.
set -euo pipefail

ISSUE="${1:-}"
REPO="${2:-}"
TITLE="${3:-}"
BRANCH="${4:-}"

if [ -z "$ISSUE" ] || [ -z "$REPO" ] || [ -z "$TITLE" ] || [ -z "$BRANCH" ]; then
  echo "Usage: init-state.sh <ISSUE_NUMBER> <REPO> <TITLE> <BRANCH>" >&2
  exit 1
fi

STATE_DIR=".claude/swarm-state"
STATE_FILE="${STATE_DIR}/issue-${ISSUE}.json"

mkdir -p "$STATE_DIR"

if [ -f "$STATE_FILE" ] && [ "${SWARM_FORCE:-0}" != "1" ]; then
  echo "$STATE_FILE already exists. Resume from it instead, or re-run with SWARM_FORCE=1." >&2
  echo "$STATE_FILE"
  exit 2
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

jq -n \
  --argjson issue "$ISSUE" \
  --arg repo "$REPO" \
  --arg title "$TITLE" \
  --arg branch "$BRANCH" \
  --arg now "$NOW" \
  '{
    issue: $issue,
    repo: $repo,
    title: $title,
    branch: $branch,
    started_at: $now,
    phase: "planning",
    plan: null,
    current_task: null,
    quartermaster_attempts: {},
    handoff_log: []
  }' > "$STATE_FILE"

echo "$STATE_FILE"
