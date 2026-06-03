---
name: systems-check
description: Use when the mission is in systems-check phase, or when /mission dispatches systems-check. Dispatches Systems Inspectors in parallel by language bucket on the full branch diff, promotes findings to repair tasks, loops Astronaut fixes until clean or attempt cap. Trigger on "systems-check <N>" or when mission state shows phase=systems-check.
---

# Phase 3 — Systems Check

Dispatch polyglot Systems Inspectors on the full branch diff. Findings become
repair tasks executed by Astronauts. Loop until clean or cap reached.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
ISSUE_NUM="${ARG1:-}"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
[ "$PHASE" = "systems-check" ] || { echo "Not in systems-check phase (current: $PHASE)"; exit 1; }
[ "$PHASE_STATUS" != "halted" ] || {
  echo "Mission halted. Reason: $(echo "$STATE" | jq -r '.halted_reason')"
  echo "Resolve the halt condition then re-run /systems-check $ISSUE_NUM."
  exit 1
}
WORKTREE_PATH=$(echo "$STATE" | jq -r '.branch.worktree_path')
[ -d "$WORKTREE_PATH" ] || {
  echo "ERROR: Worktree not found at $WORKTREE_PATH."
  echo "Re-run /pre-launch $ISSUE_NUM to recreate it."
  exit 1
}
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
BASE_SHA=$(echo "$STATE" | jq -r '.branch.base_sha_at_start')
ATTEMPT_CAP=$(echo "$STATE" | jq -r '.systems_check.attempt_cap // 3')
DECLINED=$(echo "$STATE" | jq '.systems_check.declined_findings')
RUBRIC=$(cat "${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md")
```

Call `EnterWorktree` with `path: $WORKTREE_PATH` to switch the session into the mission worktree before doing any work.

## Step 2: Mark phase in_progress

```bash
if [ "$PHASE_STATUS" != "in_progress" ]; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
    "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"systems-check\",\"event\":\"started\"}"
fi
ROUND=1
```

**Note on re-run:** `ROUND` is not persisted to state. If the skill is re-run after a crash, `ROUND` restarts at 1 while `systems_check.attempts` in state reflects the true attempt count. Use the state `attempts` as the authoritative cap guard; the printed round number is informational only.

## Step 3: Compute diff and bucket by language

This step begins a loop that repeats until the diff is clean or the attempt cap is reached.

```bash
DIFF=$(git diff "$BASE_SHA"...HEAD)
JS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(ts|tsx|js|jsx|mts|cts)$' || true)
PY_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.py$' || true)
GO_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.go$' || true)
RS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.rs$' || true)
SH_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(sh|bash|zsh)$' || true)
# Covers YAML, JSON, Markdown, SQL, config files, and anything else non-binary.
# Inspectors for this bucket should skip any binary files they encounter.
OTHER_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | \
  grep -Ev '\.(ts|tsx|js|jsx|mts|cts|py|go|rs|sh|bash|zsh)$' || true)
```

If all six bucket variables are empty:
```bash
echo "No changes since base — nothing to inspect."
```
Then advance to docking (see Step 6 done path).

## Step 4: Dispatch Systems Inspectors in parallel

Print: `"Systems check round $ROUND: dispatching inspectors…"`

Dispatch one Agent per non-empty bucket in a single message:

```
Agent(systems-inspector, language=javascript, files=JS_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(systems-inspector, language=python,     files=PY_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(systems-inspector, language=go,         files=GO_FILES, ...)
Agent(systems-inspector, language=rust,       files=RS_FILES, ...)
Agent(systems-inspector, language=shell,      files=SH_FILES, ...)
Agent(systems-inspector, language=general,    files=OTHER_FILES, ...)
```

Omit any Agent call for an empty bucket.

## Step 5: Collect and deduplicate findings

Merge all FINDINGS blocks from the Inspector responses. Deduplicate:

```bash
ALL_FINDINGS=$(jq -n '$JS + $PY + $GO + $RS + $SH + $OTHER' \
  --argjson JS "$JS_FINDINGS" --argjson PY "$PY_FINDINGS" \
  --argjson GO "$GO_FINDINGS" --argjson RS "$RS_FINDINGS" \
  --argjson SH "$SH_FINDINGS" --argjson OTHER "$OTHER_FINDINGS")

FINDINGS=$(echo "$ALL_FINDINGS" | jq '
  unique_by(.file + ":" + (.line|tostring) + ":" + .summary)')

bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" systems_check_findings \
  "$(echo "$FINDINGS" | jq -c '.')"
```

Print: `"Round $ROUND: $(echo "$FINDINGS" | jq '[.[] | select(.severity != "nit")] | length') significant findings, $(echo "$FINDINGS" | jq '[.[] | select(.severity == "nit")] | length') nits"`

## Step 6: Check for clean

If `findings` contains no item with severity `blocker`, `major`, or `minor`:

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"systems-check\",\"event\":\"completed\"}"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "docking"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
echo "Systems check clear — no significant findings."
```

Immediately invoke the `mission:docking` skill with `$ISSUE_NUM` as the argument to advance to docking.

Nits are listed in the mission log but do not block progress.

## Step 7: Promote findings to repair tasks

```bash
STEP7_STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
NEXT_IDX=$(echo "$STEP7_STATE" | jq '.plan.next_alpha_index')
# For each finding of severity blocker/major/minor, create a repair task with
# the next crew name from the roster (references/crew-roster.md), origin="systems-check".
```

Extend the existing task list — read current tasks (from the same snapshot), append repair tasks, then replace:

```bash
EXISTING_TASKS=$(echo "$STEP7_STATE" | jq '.plan.tasks')
# Each repair task uses the same schema as pre-launch Step 7 tasks, with origin="systems-check".
# Required fields: name (from crew-roster at next_alpha_index), title, files, depends_on,
# status="pending", crewmate_attempts=0, quartermaster_verdict=null, commit_sha=null,
# origin="systems-check", notes=""
REPAIR_TASKS='[<array of new repair task objects>]'
NEW_COUNT=$(echo "$REPAIR_TASKS" | jq length)
MERGED_TASKS=$(jq -n --argjson e "$EXISTING_TASKS" --argjson r "$REPAIR_TASKS" '$e + $r')
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_tasks_replace "$MERGED_TASKS"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_next_alpha "$((NEXT_IDX + NEW_COUNT))"
```

## Step 8: Run repair round

**Resumability:** Skip any repair task that already has `status == "completed"` in state — re-running systems-check after a crash does not re-execute completed repairs.

Dispatch Astronauts and Flight Controllers using the same parallel round logic as liftoff (see liftoff skill §Step 3). Repair tasks use the same 3-attempt per-task cap.

After the round, commit any PASSed repair tasks with:
```
fix(<scope>): <name> — <finding summary>

Refs #$ISSUE_NUM
```

## Step 9: Increment attempt counter and check cap

Load `references/halt-protocol.md` for the exact banner shape if the cap is reached.

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" systems_check_attempts_inc ""
ATTEMPTS=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" | jq '.systems_check.attempts')
if [ "$ATTEMPTS" -ge "$ATTEMPT_CAP" ]; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
    "Systems check attempt cap ($ATTEMPT_CAP) reached. Open findings remain."
  echo "🚨 ABORT SEQUENCE — systems-check halted"
  echo ""
  echo "  Reason: $ATTEMPT_CAP repair rounds completed; findings remain open."
  echo ""
  echo "  Where we are:"
  echo "    Issue #$ISSUE_NUM, systems-check phase — $ATTEMPT_CAP rounds attempted"
  echo ""
  echo "  Open findings:"
  bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" \
    | jq -r '.systems_check.findings[] | select(.severity != "nit") | "    - [\(.severity)] \(.file):\(.line) — \(.summary)"' 2>/dev/null || true
  echo ""
  echo "  Your options:"
  echo "    [1] Decline specific findings and re-run /systems-check $ISSUE_NUM (recommended)"
  echo "    [2] Fix findings manually and re-run /systems-check $ISSUE_NUM"
  echo "    [3] Proceed to docking despite open findings"
  echo "    [4] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
  echo ""
  echo "  Enter a number, or describe what you want."
  exit 1
fi
ROUND=$((ROUND + 1))
```

Loop back to Step 3.
