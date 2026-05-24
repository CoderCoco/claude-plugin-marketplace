#!/usr/bin/env bash
# voyage-print-log.sh <issue_number>
# Prints ASCII summary and markdown chronicle from state history.
set -euo pipefail

ISSUE_NUMBER="$1"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/voyage-state/issue-${ISSUE_NUMBER}.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "No voyage state for issue #${ISSUE_NUMBER}" >&2; exit 1
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
INSPECT_COUNT=$(echo "$S" | jq '[.plan.tasks[] | select(.origin == "inspection")] | length')
PARLEY_COUNT=$(echo "$S" | jq '[.history[] | select(.phase == "parley" and .event == "round_complete")] | length')
TOTAL_COMMITS=$(echo "$S" | jq '[.plan.tasks[] | select(.commit_sha != null)] | length')

echo "═══════════════════════════════════════════════════════"
printf "  VOYAGE  ⚓  issue #%s — %s\n" "$ISSUE_NUMBER" "$TITLE"
echo "═══════════════════════════════════════════════════════"
printf "  chart-course   %s  (%s tasks plotted)\n"         "$(phase_done chart-course)" "$PLAN_COUNT"
printf "  set-sail        %s  (%s/%s passed)\n"             "$(phase_done set-sail)" "$PLAN_PASS" "$PLAN_COUNT"
printf "  inspection      %s  (%s repairs)\n"               "$(phase_done inspection)" "$INSPECT_COUNT"
printf "  make-port       %s  (PR #%s)\n"                   "$(phase_done make-port)" "$PR_NUM"
printf "  parley          %s  (%s rounds)\n"                "$(phase_done parley)" "$PARLEY_COUNT"
echo "═══════════════════════════════════════════════════════"
printf "  Total: %s commits\n" "$TOTAL_COMMITS"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "## ⚓ Voyage log — issue #${ISSUE_NUMBER}"
echo ""
echo "$S" | jq -r '
  .history[] |
  "- \(.at | split("T")[1] | split("Z")[0])  [\(.phase)]  \(.event)" +
  (if .task then "  task=\(.task)" else "" end) +
  (if .tasks then "  tasks=\(.tasks)" else "" end)
'
