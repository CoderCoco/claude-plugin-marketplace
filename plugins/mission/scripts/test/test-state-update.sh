#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR=$(mktemp -d)
export CLAUDE_PLUGIN_DATA="$TMPDIR"

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== test-state-update.sh ==="

# Seed a state file
"$SCRIPT_DIR/voyage-state-init.sh" 42 "Test issue" "owner/repo" \
  "claude/issue-42-test" "$TMPDIR/wt" "main" "abc123"

# --- Test: voyage-state-read.sh returns valid JSON ---
JSON=$("$SCRIPT_DIR/voyage-state-read.sh" 42)
echo "$JSON" | jq -e '.phase == "chart-course"' > /dev/null \
  && ok "read returns valid state JSON" || fail "read returns valid state JSON"

# --- Test: read on missing file exits 1 ---
"$SCRIPT_DIR/voyage-state-read.sh" 999 2>/dev/null && fail "should exit 1 for missing" \
  || ok "read exits 1 for missing state file"

# --- Test: update phase ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 phase "set-sail"
jq -e '.phase == "set-sail"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update phase" || fail "update phase"

# --- Test: update phase_status ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 phase_status "in_progress"
jq -e '.phase_status == "in_progress"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update phase_status" || fail "update phase_status"

# --- Test: update pr_number (integer) ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 pr_number "128"
jq -e '.pr.number == 128' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update pr_number as integer" || fail "update pr_number as integer"

# --- Test: update pr_url (string) ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 pr_url "https://github.com/owner/repo/pull/128"
jq -e '.pr.url == "https://github.com/owner/repo/pull/128"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update pr_url" || fail "update pr_url"

# --- Test: update plan_next_alpha ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 plan_next_alpha "5"
jq -e '.plan.next_alpha_index == 5' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update plan_next_alpha" || fail "update plan_next_alpha"

# --- Test: plan_tasks_replace ---
TASKS='[{"name":"Anne","title":"test task","files":["src/a.ts"],"depends_on":[],"status":"pending","crewmate_attempts":0,"quartermaster_verdict":null,"commit_sha":null,"origin":"plan","notes":""}]'
"$SCRIPT_DIR/voyage-state-update.sh" 42 plan_tasks_replace "$TASKS"
jq -e '.plan.tasks | length == 1' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan_tasks_replace sets tasks" || fail "plan_tasks_replace sets tasks"
jq -e '.plan.tasks[0].name == "Anne"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan_tasks_replace task name is Anne" || fail "plan_tasks_replace task name is Anne"

# --- Test: plan_task_status ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 plan_task_status "Anne:completed"
jq -e '.plan.tasks[0].status == "completed"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan_task_status update" || fail "plan_task_status update"

# --- Test: history_append ---
EVENT='{"at":"2026-05-23T21:00:00Z","phase":"set-sail","event":"task_passed","task":"Anne"}'
"$SCRIPT_DIR/voyage-state-update.sh" 42 history_append "$EVENT"
jq -e '.history | length == 2' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "history_append adds entry" || fail "history_append adds entry"

# --- Test: updated_at is refreshed on every update ---
OLD_TS=$(jq -r '.updated_at' "$TMPDIR/voyage-state/issue-42.json")
sleep 1
"$SCRIPT_DIR/voyage-state-update.sh" 42 phase "inspection"
NEW_TS=$(jq -r '.updated_at' "$TMPDIR/voyage-state/issue-42.json")
[ "$OLD_TS" != "$NEW_TS" ] \
  && ok "updated_at refreshed on update" || fail "updated_at refreshed on update"

# --- Test: inspection_attempts_inc ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 inspection_attempts_inc ""
jq -e '.inspection.attempts == 1' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "inspection_attempts_inc" || fail "inspection_attempts_inc"

# --- Test: atomic write (no partial state file on error) ---
ls "$TMPDIR/voyage-state/"*.tmp 2>/dev/null && fail "stale .tmp file found" \
  || ok "no stale .tmp files"

echo ""
echo "Results: $PASS passed, $FAIL failed"
rm -rf "$TMPDIR"
[ "$FAIL" -eq 0 ]
