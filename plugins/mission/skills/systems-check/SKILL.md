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
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "systems-check" ] || { echo "Not in systems-check phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
BASE_SHA=$(echo "$STATE" | jq -r '.branch.base_sha_at_start')
ATTEMPT_CAP=$(echo "$STATE" | jq -r '.systems_check.attempt_cap')
DECLINED=$(echo "$STATE" | jq '.systems_check.declined_findings')
RUBRIC=$(cat "${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md")
```

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"systems-check\",\"event\":\"started\"}"
```

## Step 3: Systems check loop

Repeat until clean or cap reached.

**3a. Compute diff and bucket by language:**

```bash
DIFF=$(git diff "$BASE_SHA"...HEAD)
JS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(ts|tsx|js|jsx|mts|cts)$' || true)
PY_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.py$' || true)
GO_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.go$' || true)
RS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.rs$' || true)
SH_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(sh|bash|zsh)$' || true)
OTHER_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | \
  grep -Ev '\.(ts|tsx|js|jsx|mts|cts|py|go|rs|sh|bash|zsh)$' || true)
```

**3b. Dispatch Systems Inspectors in parallel — one per non-empty bucket (single message):**

```
Agent(systems-inspector, language=javascript, files=JS_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(systems-inspector, language=python,     files=PY_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(systems-inspector, language=go,         files=GO_FILES, ...)
Agent(systems-inspector, language=rust,       files=RS_FILES, ...)
Agent(systems-inspector, language=shell,      files=SH_FILES, ...)
Agent(systems-inspector, language=general,    files=OTHER_FILES, ...)
```

Omit any Agent call for an empty bucket.

**3c. Collect and deduplicate findings:**

Merge all FINDINGS blocks. Deduplicate by `(file, line, summary)`.

**3d. Check for clean:**

If `findings` contains no item with severity `blocker`, `major`, or `minor`:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"...\",\"phase\":\"systems-check\",\"event\":\"completed\"}"
echo "Systems check clear — no significant findings. Run /docking $ISSUE_NUM (or /mission $ISSUE_NUM)."
exit 0
```

Nits are listed in the mission log but do not block progress.

**3e. Promote findings to repair tasks:**

```bash
NEXT_IDX=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" | jq '.plan.next_alpha_index')
# For each finding of severity blocker/major/minor, create a repair task with
# the next crew name from the roster, origin="systems-check".
# Use references/crew-roster.md to look up name at index NEXT_IDX.
```

Add repair tasks to state via `plan_tasks_replace` (extend existing array).
Update `plan_next_alpha`.

**3f. Run repair round:**

Dispatch Astronauts and Flight Controllers using the same parallel round logic
as liftoff (see liftoff skill §Step 3). Repair tasks use the same 3-attempt
per-task cap.

After the round, commit any PASSed repair tasks with:
```
fix(<scope>): <name> — <finding summary>

Refs #$ISSUE_NUM
```

**3g. Increment systems-check attempt counter:**

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" systems_check_attempts_inc ""
```

Check cap:
```bash
ATTEMPTS=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" | jq '.systems_check.attempts')
if [ "$ATTEMPTS" -ge "$ATTEMPT_CAP" ]; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
    "Systems check attempt cap ($ATTEMPT_CAP) reached. Open findings remain."
  echo "🚨 ABORT SEQUENCE — systems-check halted"
  echo ""
  echo "  Reason: $ATTEMPT_CAP systems-check rounds ran; findings remain open."
  echo ""
  echo "  Open findings:"
  # List remaining open findings from state
  echo ""
  echo "  Your options:"
  echo "    [1] Decline specific findings and re-run (recommended)"
  echo "    [2] Fix findings manually and re-run /systems-check $ISSUE_NUM"
  echo "    [3] Proceed to docking despite open findings"
  echo "    [4] Abort mission (state preserved)"
  exit 0
fi
```

Loop back to Step 3a.
