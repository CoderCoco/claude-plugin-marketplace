---
name: voyage
description: Use when the user wants to start or advance the full end-to-end voyage workflow for a GitHub issue. Trigger on "/voyage <N>", "voyage issue N", "continue voyage", "/voyage --status", "/voyage --finish", or any signal that the user wants to orchestrate an issue through plan→build→review→PR→comments. This is the top-level orchestrator; it reads state and dispatches the correct phase skill.
---

# /voyage — State Machine Dispatcher

Read voyage state for the given issue and run the next phase. Resumable:
re-run after any restart to pick up where the voyage left off.

## Step 1: Parse arguments

```bash
# /voyage <issue_number> [--auto] [--status] [--finish] [--abandon]
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"

# Infer issue number from current branch if not provided
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi
[ -n "$ISSUE_NUM" ] || { echo "Usage: /voyage <issue_number>"; exit 1; }
```

## Step 2: Handle --status

If `$FLAG == "--status"`:
```bash
STATE=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || {
  echo "No voyage state found for issue #$ISSUE_NUM. Run /voyage $ISSUE_NUM to start."
  exit 0
}
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-print-log.sh" "$ISSUE_NUM"
exit 0
```

## Step 3: Handle --finish

If `$FLAG == "--finish"`:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-update.sh" "$ISSUE_NUM" phase "done"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"done\",\"event\":\"finished\"}"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-print-log.sh" "$ISSUE_NUM"
echo "Voyage complete. Fair winds, Captain."
exit 0
```

## Step 4: Handle --abandon

If `$FLAG == "--abandon"`:
```
Are ye sure ye want to abandon the voyage for issue #$ISSUE_NUM?
State file will be removed. [y/N]
```
On y: `rm "${CLAUDE_PLUGIN_DATA}/voyage-state/issue-${ISSUE_NUM}.json"`

## Step 5: Read or initialise state

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || STATE=""
```

If `STATE` is empty: this is a fresh voyage. Dispatch `/chart-course $ISSUE_NUM $FLAG`.

## Step 6: Decide next phase

```bash
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
```

Decision table:

| phase | phase_status | Action |
|---|---|---|
| `chart-course` | `pending` or `in_progress` | Dispatch `/chart-course $ISSUE_NUM $FLAG` |
| `chart-course` | `completed` | Advance phase to `set-sail`, dispatch `/set-sail $ISSUE_NUM` |
| `chart-course` | `halted` | Print halt message, exit |
| `set-sail` | `pending` or `in_progress` | Dispatch `/set-sail $ISSUE_NUM` |
| `set-sail` | `completed` | Advance to `inspection`, dispatch `/inspection $ISSUE_NUM` |
| `set-sail` | `halted` | Print halt message, exit |
| `inspection` | `pending` or `in_progress` | Dispatch `/inspection $ISSUE_NUM` |
| `inspection` | `completed` | Advance to `make-port`, dispatch `/make-port $ISSUE_NUM` |
| `inspection` | `halted` | Print halt message, exit |
| `make-port` | `pending` or `in_progress` | Dispatch `/make-port $ISSUE_NUM` |
| `make-port` | `completed` | Advance to `parley`, dispatch `/parley $ISSUE_NUM` |
| `make-port` | `halted` | Print halt message, exit |
| `parley` | any | Dispatch `/parley $ISSUE_NUM` (idempotent) |
| `done` | any | Print final log, exit |

**Advancing phase:** Before dispatching the next phase, update state:
```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase "<next-phase>"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "pending"
```

**Halt message format:** Load `references/halt-protocol.md` for the exact
banner and option format. Always show the halted_reason from state.

**`--auto` flag:** Pass through to `/chart-course` only (skips post-plan confirmation).

## Step 7: Done state

```bash
bash "$SCRIPT_DIR/voyage-print-log.sh" "$ISSUE_NUM"
echo "The voyage for issue #$ISSUE_NUM is complete. Fair winds, Captain."
```
