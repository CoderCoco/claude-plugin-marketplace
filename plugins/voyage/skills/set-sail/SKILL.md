---
name: set-sail
description: Use when the voyage is in set-sail phase, or when /voyage dispatches the set-sail phase. Executes the Navigator's plan by dispatching Crewmates in parallel for ready tasks and verifying with the Quartermaster. Trigger on "set-sail <N>" or when voyage state shows phase=set-sail.
---

# Phase 2 — Set Sail

Execute the Navigator's plan. Dispatch Crewmates in parallel for tasks
whose dependencies are satisfied, verify with the Quartermaster, commit
on PASS, and loop until all tasks are complete.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')

[ "$PHASE" = "set-sail" ] || { echo "Not in set-sail phase (current: $PHASE)"; exit 1; }
[ "$PHASE_STATUS" != "halted" ] || {
  echo "Voyage halted. Resolve the halt condition first."
  echo "Halted reason: $(echo "$STATE" | jq -r '.halted_reason')"
  exit 1
}

cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
```

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"set-sail\",\"event\":\"started\"}"
```

## Step 3: Round dispatch loop

Repeat until all tasks are `completed` or a halt condition is triggered.

**Computing the ready batch:** A task is ready if:
1. `status == "pending"`, AND
2. all tasks in `depends_on` have `status == "completed"`, AND
3. no other ready task in this batch shares a file in `files`.

The third condition serialises tasks that touch the same file even when
they have no explicit dependency — prevents Crewmates from racing on the
same file.

If the ready batch is empty and any task is still `pending`, a deadlock
or unresolvable dependency exists: halt with reason.

**Dispatch (parallel — ALL in ONE message):**

For each task in the ready batch, send one `Agent` call to the Crewmate.
All calls in a single message so they execute concurrently:

```
Agent(crewmate, context={task: Anne, files: [...], acceptance: "...", ...})
Agent(crewmate, context={task: Blackbeard, ...})
Agent(crewmate, context={task: Drake, ...})
```

Collect all CREW_REPORTs. If any has `status: plan_problem`, halt with the
plan problem description and ask user whether to re-plan, skip, or abort.

**Verify (parallel — ALL in ONE message):**

For each completed CREW_REPORT, dispatch one Quartermaster:

```
Agent(quartermaster, context={task: Anne, crew_report: ..., ...})
Agent(quartermaster, context={task: Blackbeard, crew_report: ..., ...})
```

**Process verdicts:**

For each VERDICT:
- `PASS`:
  1. Stage and commit (sequential, one commit per task):
     ```bash
     cd "$WORKTREE_PATH"
     git add <files from CREW_REPORT>
     git commit -m "feat(<scope>): <name> — <title>

     Refs #$ISSUE_NUM"
     ```
  2. Record commit SHA:
     ```bash
     SHA=$(git rev-parse HEAD)
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_commit "<name>:$SHA"
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:completed"
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
       "{\"at\":\"...\",\"phase\":\"set-sail\",\"event\":\"task_passed\",\"task\":\"<name>\"}"
     ```
- `FAIL`:
  1. Increment attempt counter:
     ```bash
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_attempts_inc "<name>"
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:pending"
     ```
  2. If `crewmate_attempts < 3`: task re-enters the queue with `fixes_needed` attached.
  3. If `crewmate_attempts == 3`: halt.

**Halt format (load `references/halt-protocol.md`):**
```
HEAVY SEAS — set-sail halted

  Reason: Task <name> failed 3 times. Last Quartermaster fixes_needed:
    - <fix 1>
    - <fix 2>

  Where we are:
    Issue #<N>, set-sail phase. <X>/<total> tasks completed.

  Yer options:
    [1] Re-dispatch Crewmate with the fixes above (recommended)
    [2] Skip this task and continue
    [3] Re-plan (re-dispatch Navigator with current constraints)
    [4] Abandon voyage (state preserved)
```

## Step 4: All tasks complete — advance phase

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"set-sail\",\"event\":\"completed\"}"
echo "All hands reported in — set-sail complete. Run /inspection $ISSUE_NUM (or /voyage $ISSUE_NUM) to review."
```

## Parallelism cap

Dispatch at most **5 Crewmates per round** and at most **5 Quartermasters per round**. If the ready batch exceeds 5, dispatch the first 5, collect verdicts, commit PASSed tasks, then compute the next ready batch for the next round. This prevents rate-limit issues and keeps context manageable.
