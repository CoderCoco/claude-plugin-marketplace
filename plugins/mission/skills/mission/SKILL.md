---
name: mission
description: Use when the user wants to start or advance the full end-to-end mission workflow for a GitHub issue. Trigger on "/mission <N>", "mission issue N", "continue mission", "/mission --status", "/mission --finish", or any signal that the user wants to orchestrate an issue through plan→build→review→PR→comments. This is the top-level orchestrator; it reads state and dispatches the correct phase skill.
---

# /mission — State Machine Dispatcher

Read mission state for the given issue and run the next phase. Resumable:
re-run after any restart to pick up where the mission left off.

**Key references:** `references/mission-state.md` (state schema) · `references/agent-contracts.md` (sub-agent contracts) · `references/crew-roster.md` (task name roster) · `references/halt-protocol.md` (halt banner format)

## Step 1: Parse arguments

```bash
# /mission <issue_number> [--auto] [--status] [--finish] [--abandon]
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"

# Infer issue number from current branch if not provided
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi
[ -n "$ISSUE_NUM" ] || { echo "Usage: /mission <issue_number>"; exit 1; }
```

## Step 2: Handle --status

If `$FLAG == "--status"`:
```bash
STATE=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || {
  echo "No mission state found for issue #$ISSUE_NUM. Run /mission $ISSUE_NUM to start."
  exit 0
}
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-print-log.sh" "$ISSUE_NUM"
exit 0
```

## Step 3: Handle --finish

If `$FLAG == "--finish"`:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-update.sh" "$ISSUE_NUM" phase "done"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"done\",\"event\":\"finished\"}"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-print-log.sh" "$ISSUE_NUM"
echo "Mission complete. Good work, Mission Control."
exit 0
```

## Step 4: Handle --abandon

If `$FLAG == "--abandon"`:
```bash
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUM}.json"
if [ -f "$STATE_FILE" ]; then
  TITLE=$(jq -r '.issue.title // "(unknown)"' "$STATE_FILE")
  echo "This will permanently remove all mission state for:"
  echo "  Issue #${ISSUE_NUM}: ${TITLE}"
  echo "  File: ${STATE_FILE}"
else
  echo "No state file found for issue #${ISSUE_NUM} — nothing to remove."
  exit 0
fi
```

Ask: "Type `yes` to confirm removal, or press Enter to cancel."

On `yes`:
```bash
rm "$STATE_FILE"
echo "Mission state removed."
exit 0
```

On anything else: print "Abandoned — state preserved." and `exit 0`.

## Step 5: Read or initialise state

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || STATE=""
```

If `STATE` is empty: this is a fresh mission. Print `"Starting mission for issue #$ISSUE_NUM…"` and dispatch `/pre-launch $ISSUE_NUM $FLAG`.

Otherwise print `"Resuming mission #$ISSUE_NUM — phase: $PHASE ($PHASE_STATUS)"` before dispatching.

## Step 6: Decide next phase

```bash
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
```

Decision table:

| phase | phase_status | Action |
|---|---|---|
| `pre-launch` | `pending` or `in_progress` | Dispatch `/pre-launch $ISSUE_NUM $FLAG` |
| `pre-launch` | `completed` | Advance phase to `liftoff`, dispatch `/liftoff $ISSUE_NUM` |
| `pre-launch` | `halted` | Print halt message, exit |
| `liftoff` | `pending` or `in_progress` | Dispatch `/liftoff $ISSUE_NUM` |
| `liftoff` | `completed` | Advance to `systems-check`, dispatch `/systems-check $ISSUE_NUM` |
| `liftoff` | `halted` | Print halt message, exit |
| `systems-check` | `pending` or `in_progress` | Dispatch `/systems-check $ISSUE_NUM` |
| `systems-check` | `completed` | Advance to `docking`, dispatch `/docking $ISSUE_NUM` |
| `systems-check` | `halted` | Print halt message, exit |
| `docking` | `pending` or `in_progress` | Dispatch `/docking $ISSUE_NUM` |
| `docking` | `completed` | Advance to `comms`, dispatch `/comms $ISSUE_NUM` |
| `docking` | `halted` | Print halt message, exit |
| `comms` | any | Dispatch `/comms $ISSUE_NUM` (idempotent — timestamp filter skips already-seen comments) |
| `done` | any | Print final log, exit |

**Advancing phase:** Before dispatching the next phase, update state:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "<next-phase>"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
```

Both updates must succeed. If the second update fails:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
  "Phase advance to <next-phase> failed — state may be partially updated."
echo "🚨 ABORT SEQUENCE — mission halted"
echo ""
echo "  Reason: Phase advance to <next-phase> failed (state write error)."
echo ""
echo "  Where we are:"
echo "    Issue #$ISSUE_NUM, phase may be partially advanced — check with /mission $ISSUE_NUM --status"
echo ""
echo "  Your options:"
echo "    [1] Re-run /mission $ISSUE_NUM to retry the advance (recommended)"
echo "    [2] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
echo ""
echo "  Enter a number, or describe what you want."
exit 1
```

**Halt message format:** Load `references/halt-protocol.md` for the exact
banner and option format. Always show the halted_reason from state.

**`--auto` flag:** Pass through to `/pre-launch` only (skips post-plan confirmation).

## Step 7: Done state

```bash
bash "$SCRIPT_DIR/mission-print-log.sh" "$ISSUE_NUM"
echo "Mission for issue #$ISSUE_NUM is complete. Good work, Mission Control."
```
