---
name: mission
description: Use when the user wants to start or advance the full end-to-end mission workflow for a GitHub issue. Trigger on "/mission <N>", "mission issue N", "continue mission", "/mission --status", "/mission --finish", or any signal that the user wants to orchestrate an issue through plan→build→review→PR→comments. This is the top-level orchestrator; it reads state and dispatches the correct phase skill.
---

# /mission — State Machine Dispatcher

Read mission state for the given issue and run the next phase. Resumable:
re-run after any restart to pick up where the mission left off.

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
```
Are you sure you want to abort the mission for issue #$ISSUE_NUM?
State file will be removed. [y/N]
```
On y: `rm "${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUM}.json"`

## Step 5: Read or initialise state

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || STATE=""
```

If `STATE` is empty: this is a fresh mission. Dispatch `/pre-launch $ISSUE_NUM $FLAG`.

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
| `comms` | any | Dispatch `/comms $ISSUE_NUM` (idempotent) |
| `done` | any | Print final log, exit |

**Advancing phase:** Before dispatching the next phase, update state:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "<next-phase>"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
```

**Halt message format:** Load `references/halt-protocol.md` for the exact
banner and option format. Always show the halted_reason from state.

**`--auto` flag:** Pass through to `/pre-launch` only (skips post-plan confirmation).

## Step 7: Done state

```bash
bash "$SCRIPT_DIR/mission-print-log.sh" "$ISSUE_NUM"
echo "Mission for issue #$ISSUE_NUM is complete. Good work, Mission Control."
```
