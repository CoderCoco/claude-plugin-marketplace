#!/usr/bin/env bash
# voyage-state-update.sh <issue_number> <key> <value>
#
# Keys:
#   phase               <phase-name>
#   phase_status        pending|in_progress|completed|halted
#   halted_reason       <string>
#   pr_number           <integer as string>
#   pr_url              <url string>
#   pr_last_comment     <integer as string>
#   pr_copilot          true|false
#   pr_watcher          true|false
#   plan_next_alpha     <integer as string>
#   plan_tasks_replace  <json array string>
#   plan_task_status    <name>:<status>
#   plan_task_verdict   <name>:PASS|FAIL
#   plan_task_commit    <name>:<sha>
#   plan_task_attempts_inc <name>
#   history_append      <json object string>
#   inspection_attempts_inc  (value ignored)
set -euo pipefail

ISSUE_NUMBER="$1"
KEY="$2"
VALUE="${3:-}"

STATE_FILE="${CLAUDE_PLUGIN_DATA}/voyage-state/issue-${ISSUE_NUMBER}.json"
TMP="${STATE_FILE}.tmp"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: No state file for issue #${ISSUE_NUMBER}" >&2
  exit 1
fi

case "$KEY" in
  phase)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.phase = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  phase_status)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.phase_status = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  halted_reason)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.halted_reason = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_number)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.number = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_url)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.pr.url = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_last_comment)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.last_comment_id_seen = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_copilot)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.copilot_was_requested = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_watcher)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.watcher_scheduled = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  plan_next_alpha)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.plan.next_alpha_index = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  plan_tasks_replace)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.plan.tasks = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  plan_task_status)
    NAME="${VALUE%%:*}"; STATUS="${VALUE#*:}"
    jq --arg name "$NAME" --arg status "$STATUS" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .status) = $status | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  plan_task_verdict)
    NAME="${VALUE%%:*}"; VERDICT="${VALUE#*:}"
    jq --arg name "$NAME" --arg v "$VERDICT" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .quartermaster_verdict) = $v | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  plan_task_commit)
    NAME="${VALUE%%:*}"; SHA="${VALUE#*:}"
    jq --arg name "$NAME" --arg sha "$SHA" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .commit_sha) = $sha | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  plan_task_attempts_inc)
    jq --arg name "$VALUE" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .crewmate_attempts) += 1 | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  history_append)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.history += [$v] | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  inspection_attempts_inc)
    jq --arg now "$NOW" \
      '.inspection.attempts += 1 | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  *)
    echo "ERROR: Unknown key: $KEY" >&2; exit 1 ;;
esac

mv "$TMP" "$STATE_FILE"
