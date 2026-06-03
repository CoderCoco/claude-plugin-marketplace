---
name: liftoff
description: Use when the mission is in liftoff phase, or when /mission dispatches the liftoff phase. Executes the Flight Director's plan by dispatching Astronauts in parallel for ready tasks and verifying with the Flight Controller. Trigger on "liftoff <N>" or when mission state shows phase=liftoff.
---

# Phase 2 — Liftoff

Execute the Flight Director's plan. Dispatch Astronauts in parallel for tasks
whose dependencies are satisfied, verify with the Flight Controller, commit
on PASS, and loop until all tasks are complete.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
ISSUE_NUM="${ARG1:-}"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')

[ "$PHASE" = "liftoff" ] || { echo "Not in liftoff phase (current: $PHASE)"; exit 1; }
[ "$PHASE_STATUS" != "halted" ] || {
  echo "Mission halted. Resolve the halt condition first."
  echo "Halted reason: $(echo "$STATE" | jq -r '.halted_reason')"
  exit 1
}
[ "$PHASE_STATUS" = "completed" ] && {
  echo "Liftoff already complete. Run /mission $ISSUE_NUM to advance."
  exit 0
}

WORKTREE_PATH=$(echo "$STATE" | jq -r '.branch.worktree_path')
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
```

Check that the worktree path exists before entering:
```bash
[ -d "$WORKTREE_PATH" ] || {
  echo "ERROR: Worktree not found at $WORKTREE_PATH."
  echo "Re-run /pre-launch $ISSUE_NUM to recreate it."
  exit 1
}
```
Call `EnterWorktree` with `path: $WORKTREE_PATH` to switch the session into the mission worktree before doing any work.

## Step 2: Mark phase in_progress

```bash
ROUND=1
if [ "$PHASE_STATUS" != "in_progress" ]; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
    "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"liftoff\",\"event\":\"started\"}"
fi
```

## Step 3: Round dispatch loop

Repeat until all tasks are `completed` or a halt condition is triggered.

**Resumability:** At the start of each round, tasks already marked `status == "completed"` are unconditionally skipped. Re-running liftoff after a crash is safe — completed work is never re-dispatched.

**Computing the ready batch:** A task is ready if:
1. `status == "pending"`, AND
2. all tasks in `depends_on` have `status == "completed"`, AND
3. no other ready task in this batch shares a file in `files`.
   (Prevents concurrent Astronauts from racing to modify the same file and creating merge conflicts.)

If the ready batch is empty and any task is still `pending`, a deadlock
or unresolvable dependency exists: halt with reason.

Print: `"Liftoff round $ROUND — dispatching $(echo "${READY_BATCH[@]}" | wc -w) Astronauts: $(IFS=', '; echo "${READY_BATCH[*]}")…"`

**Dispatch (parallel — ALL in ONE message):**

For each task in the ready batch, send one `Agent` call to the Astronaut.
All calls in a single message so they execute concurrently:

```
Agent(astronaut, context={task: Apollo, files: [...], acceptance: "...", ...})
Agent(astronaut, context={task: Borman, ...})
Agent(astronaut, context={task: Cassini, ...})
```

Collect all CREW_REPORTs. If any has `status: plan_problem`:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
  "Task <name> reported plan_problem: <plan_problem_description>"
```
Load `references/halt-protocol.md` for the exact banner shape. Use options:
- [1] Re-dispatch Flight Director with the problem description (recommended)
- [2] Skip this task
- [3] Re-plan from scratch
- [4] Abort mission (state preserved)

**Verify (parallel — ALL in ONE message):**

For each completed CREW_REPORT, dispatch one Flight Controller:

```
Agent(flight-controller, context={task: Apollo, crew_report: ..., ...})
Agent(flight-controller, context={task: Borman, crew_report: ..., ...})
```

**Process verdicts:**

For each VERDICT:
- `PASS`:
  1. Stage and commit (sequential, one commit per task):
     ```bash
     git add <files from CREW_REPORT>
     # In this block, substitute <name>, <scope>, and <title> with values from the CREW_REPORT
     # (e.g. TASK_NAME=$(echo "$CREW_REPORT" | jq -r '.task_name'))
     if ! git commit -m "feat(<scope>): <name> — <title>

     Refs #$ISSUE_NUM"; then
       bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
         "git commit failed for task <name> (pre-commit hook or conflict). Fix the issue and re-run."
       bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
       echo "🚨 ABORT SEQUENCE — liftoff halted"
       echo ""
       echo "  Reason: git commit failed for task <name>."
       echo ""
       echo "  Where we are:"
       echo "    Issue #$ISSUE_NUM, liftoff phase — task <name> not yet committed"
       echo ""
       echo "  Your options:"
       echo "    [1] Resolve the pre-commit error above and re-run /liftoff $ISSUE_NUM (recommended)"
       echo "    [2] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
       echo ""
       echo "  Enter a number, or describe what you want."
       exit 1
     fi
     ```
  2. Record commit SHA:
     ```bash
     SHA=$(git rev-parse HEAD)
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_commit "<name>:$SHA"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:completed"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
       "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"liftoff\",\"event\":\"task_passed\",\"task\":\"<name>\"}"
     ```
- `FAIL`:
  1. Increment attempt counter:
     ```bash
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_attempts_inc "<name>"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:pending"
     ```
  2. If `crewmate_attempts < 3`: task re-enters the queue with `fixes_needed` attached.
  3. If `crewmate_attempts == 3`: halt.

**Halt format:** Load `references/halt-protocol.md` for the exact banner shape.
For a 3-attempt failure, use:
- **Reason**: "Task <name> failed 3 times. Last fixes_needed: <list>"
- **Options**: [1] Re-dispatch with fixes (recommended), [2] Skip task, [3] Re-plan, [4] Abort mission

Print: `"Round $ROUND complete — N tasks passed, M tasks queued for retry."`
Increment: `ROUND=$((ROUND + 1))`

## Step 4: All tasks complete — advance phase

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"liftoff\",\"event\":\"completed\"}"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "systems-check"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
echo "All crew reported in — liftoff complete."
```

Immediately invoke the `mission:systems-check` skill with `$ISSUE_NUM` as the argument to advance to systems-check.

## Parallelism cap

Dispatch at most **5 Astronauts per round** and at most **5 Flight Controllers per round**. If the ready batch exceeds 5, dispatch the first 5, collect verdicts, commit PASSed tasks, then compute the next ready batch for the next round.
