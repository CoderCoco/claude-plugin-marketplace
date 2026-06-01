#!/usr/bin/env bash
# mission-print-log.sh <issue_number>
# Prints ASCII summary and markdown chronicle from state history.
set -euo pipefail
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/mission-codercoco-custom-plugin-marketplace}"

ISSUE_NUMBER="$1"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUMBER}.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "No mission state for issue #${ISSUE_NUMBER}" >&2; exit 1
fi

S=$(cat "$STATE_FILE")

TITLE=$(echo "$S" | jq -r '.issue.title')
PR_NUM=$(echo "$S" | jq -r '.pr.number // "—"')

# Phase completion check: look for completed event in history
phase_done() {
  echo "$S" | jq -e --arg p "$1" \
    '[.history[] | select(.phase == $p and .event == "completed")] | length > 0' \
    > /dev/null 2>&1 && echo "✓" || echo "·"
}

PLAN_COUNT=$(echo "$S" | jq '[.plan.tasks[] | select(.origin == "plan" or .origin == null)] | length')
PLAN_PASS=$(echo "$S" | jq '[.plan.tasks[] | select((.origin == "plan" or .origin == null) and .status == "completed")] | length')
INSPECT_COUNT=$(echo "$S" | jq '[.plan.tasks[] | select(.origin == "systems-check")] | length')
COMMS_COUNT=$(echo "$S" | jq '[.history[] | select(.phase == "comms" and .event == "round_complete")] | length')
TOTAL_COMMITS=$(echo "$S" | jq '[.plan.tasks[] | select(.commit_sha != null)] | length')

echo "═══════════════════════════════════════════════════════"
printf "  MISSION  🚀  issue #%s — %s\n" "$ISSUE_NUMBER" "$TITLE"
echo "═══════════════════════════════════════════════════════"
printf "  pre-launch      %s  (%s tasks planned)\n"        "$(phase_done pre-launch)" "$PLAN_COUNT"
printf "  liftoff         %s  (%s/%s passed)\n"            "$(phase_done liftoff)" "$PLAN_PASS" "$PLAN_COUNT"
printf "  systems-check   %s  (%s repairs)\n"              "$(phase_done systems-check)" "$INSPECT_COUNT"
printf "  docking         %s  (PR #%s)\n"                  "$(phase_done docking)" "$PR_NUM"
printf "  comms           %s  (%s rounds)\n"               "$(phase_done comms)" "$COMMS_COUNT"
echo "═══════════════════════════════════════════════════════"
printf "  Total: %s commits\n" "$TOTAL_COMMITS"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "## 🚀 Mission log — issue #${ISSUE_NUMBER}"
echo ""
echo "$S" | jq -r '
  .history[] |
  "- \(.at | split("T")[1] | split("Z")[0])  [\(.phase)]  \(.event)" +
  (if .task then "  task=\(.task)" else "" end) +
  (if .tasks then "  tasks=\(.tasks)" else "" end)
'
