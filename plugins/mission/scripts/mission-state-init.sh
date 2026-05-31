#!/usr/bin/env bash
# mission-state-init.sh <issue_num> <title> <repo> <branch> <worktree> <base> <base_sha>
# Creates $CLAUDE_PLUGIN_DATA/mission-state/issue-<N>.json
# Idempotent: exits 0 immediately if file already exists.
set -euo pipefail

ISSUE_NUMBER="$1"
ISSUE_TITLE="$2"
REPO="$3"
BRANCH_NAME="$4"
WORKTREE_PATH="$5"
BASE_BRANCH="$6"
BASE_SHA="$7"

STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-state"
STATE_FILE="${STATE_DIR}/issue-${ISSUE_NUMBER}.json"

[ -f "$STATE_FILE" ] && exit 0

mkdir -p "$STATE_DIR"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP="${STATE_FILE}.tmp"

jq -n \
  --argjson num "$ISSUE_NUMBER" \
  --arg title "$ISSUE_TITLE" \
  --arg repo "$REPO" \
  --arg branch "$BRANCH_NAME" \
  --arg worktree "$WORKTREE_PATH" \
  --arg base "$BASE_BRANCH" \
  --arg sha "$BASE_SHA" \
  --arg now "$NOW" \
'{
  schema_version: 2,
  issue: {
    number: $num,
    title: $title,
    repo: $repo,
    url: ("https://github.com/" + $repo + "/issues/" + ($num | tostring))
  },
  branch: {
    name: $branch,
    worktree_path: $worktree,
    base: $base,
    base_sha_at_start: $sha
  },
  phase: "pre-launch",
  phase_status: "pending",
  halted_reason: null,
  plan: {
    navigator_attempts: 0,
    next_alpha_index: 0,
    tasks: []
  },
  systems_check: {
    attempts: 0,
    attempt_cap: 3,
    findings: [],
    fixed_findings: [],
    declined_findings: []
  },
  pr: {
    number: null,
    url: null,
    opened_at: null,
    last_comment_id_seen: null,
    copilot_was_requested: false,
    watcher_scheduled: false
  },
  history: [{at: $now, phase: "pre-launch", event: "initialized"}],
  created_at: $now,
  updated_at: $now
}' > "$TMP"

mv "$TMP" "$STATE_FILE"
