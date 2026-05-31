#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR=$(mktemp -d)
export CLAUDE_PLUGIN_DATA="$TMPDIR"

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== test-state-init.sh ==="

# --- Test 1: creates state file ---
"$SCRIPT_DIR/mission-state-init.sh" 42 "Add retry" "owner/repo" \
  "claude/issue-42-add-retry" "$TMPDIR/wt" "main" "abc123"
[ -f "$TMPDIR/mission-state/issue-42.json" ] \
  && ok "creates state file" || fail "creates state file"

# --- Test 2: correct schema_version ---
jq -e '.schema_version == 2' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "schema_version == 2" || fail "schema_version == 2"

# --- Test 3: correct issue number (integer, not string) ---
jq -e '.issue.number == 42' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "issue.number == 42" || fail "issue.number == 42"

# --- Test 4: initial phase is pre-launch ---
jq -e '.phase == "pre-launch"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "phase == pre-launch" || fail "phase == pre-launch"

# --- Test 5: initial phase_status is pending ---
jq -e '.phase_status == "pending"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "phase_status == pending" || fail "phase_status == pending"

# --- Test 6: plan.tasks is empty array ---
jq -e '.plan.tasks == []' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "plan.tasks == []" || fail "plan.tasks == []"

# --- Test 7: plan.next_alpha_index is 0 ---
jq -e '.plan.next_alpha_index == 0' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "plan.next_alpha_index == 0" || fail "plan.next_alpha_index == 0"

# --- Test 8: idempotency — second call does not overwrite ---
"$SCRIPT_DIR/mission-state-init.sh" 42 "Different title" "owner/repo" \
  "claude/issue-42-add-retry" "$TMPDIR/wt" "main" "abc123"
TITLE=$(jq -r '.issue.title' "$TMPDIR/mission-state/issue-42.json")
[ "$TITLE" = "Add retry" ] \
  && ok "idempotent (title not overwritten)" || fail "idempotent (title not overwritten)"

# --- Test 9: different issues get separate files ---
"$SCRIPT_DIR/mission-state-init.sh" 99 "Other issue" "owner/repo" \
  "claude/issue-99-other" "$TMPDIR/wt2" "main" "def456"
[ -f "$TMPDIR/mission-state/issue-99.json" ] \
  && ok "separate file for issue 99" || fail "separate file for issue 99"
[ -f "$TMPDIR/mission-state/issue-42.json" ] \
  && ok "issue 42 file still exists" || fail "issue 42 file still exists"

echo ""
echo "Results: $PASS passed, $FAIL failed"
rm -rf "$TMPDIR"
[ "$FAIL" -eq 0 ]
