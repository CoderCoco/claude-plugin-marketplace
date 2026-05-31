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
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')

[ "$PHASE" = "liftoff" ] || { echo "Not in liftoff phase (current: $PHASE)"; exit 1; }
[ "$PHASE_STATUS" != "halted" ] || {
  echo "Mission halted. Resolve the halt condition first."
  echo "Halted reason: $(echo "$STATE" | jq -r '.halted_reason')"
  exit 1
}

WORKTREE_PATH=$(echo "$STATE" | jq -r '.branch.worktree_path')
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
```

Call `EnterWorktree` with `path: $WORKTREE_PATH` to switch the session into the mission worktree before doing any work.

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"liftoff\",\"event\":\"started\"}"
```

## Step 3: Round dispatch loop

Repeat until all tasks are `completed` or a halt condition is triggered.

**Computing the ready batch:** A task is ready if:
1. `status == "pending"`, AND
2. all tasks in `depends_on` have `status == "completed"`, AND
3. no other ready task in this batch shares a file in `files`.

The third condition serialises tasks that touch the same file even when
they have no explicit dependency — prevents Astronauts from racing on the
same file.

If the ready batch is empty and any task is still `pending`, a deadlock
or unresolvable dependency exists: halt with reason.

**Dispatch (parallel — ALL in ONE message):**

For each task in the ready batch, send one `Agent` call to the Astronaut.
All calls in a single message so they execute concurrently:

```
Agent(astronaut, context={task: Apollo, files: [...], acceptance: "...", ...})
Agent(astronaut, context={task: Borman, ...})
Agent(astronaut, context={task: Cassini, ...})
```

Collect all CREW_REPORTs. If any has `status: plan_problem`, halt with the
plan problem description and ask user whether to re-plan, skip, or abort.

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
     git commit -m "feat(<scope>): <name> — <title>

     Refs #$ISSUE_NUM"
     ```
  2. Record commit SHA:
     ```bash
     SHA=$(git rev-parse HEAD)
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_commit "<name>:$SHA"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:completed"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
       "{\"at\":\"...\",\"phase\":\"liftoff\",\"event\":\"task_passed\",\"task\":\"<name>\"}"
     ```
- `FAIL`:
  1. Increment attempt counter:
     ```bash
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_attempts_inc "<name>"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:pending"
     ```
  2. If `crewmate_attempts < 3`: task re-enters the queue with `fixes_needed` attached.
  3. If `crewmate_attempts == 3`: halt.

**Halt format (load `references/halt-protocol.md`):**
```
🚨 ABORT SEQUENCE — liftoff halted

  Reason: Task <name> failed 3 times. Last Flight Controller fixes_needed:
    - <fix 1>
    - <fix 2>

  Where we are:
    Issue #<N>, liftoff phase. <X>/<total> tasks completed.

  Your options:
    [1] Re-dispatch Astronaut with the fixes above (recommended)
    [2] Skip this task and continue
    [3] Re-plan (re-dispatch Flight Director with current constraints)
    [4] Abort mission (state preserved)
```

## Step 4: All tasks complete — advance phase

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"liftoff\",\"event\":\"completed\"}"
echo "All crew reported in — liftoff complete."
```

Immediately invoke the `mission:systems-check` skill with `$ISSUE_NUM` as the argument to advance to systems-check.

## Parallelism cap

Dispatch at most **5 Astronauts per round** and at most **5 Flight Controllers per round**. If the ready batch exceeds 5, dispatch the first 5, collect verdicts, commit PASSed tasks, then compute the next ready batch for the next round.
