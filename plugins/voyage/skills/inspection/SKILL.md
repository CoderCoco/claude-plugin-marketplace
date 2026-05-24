---
name: inspection
description: Use when the voyage is in inspection phase, or when /voyage dispatches inspection. Dispatches First Mates in parallel by language bucket on the full branch diff, promotes findings to repair tasks, loops Crewmate fixes until clean or attempt cap. Trigger on "inspection <N>" or when voyage state shows phase=inspection.
---

# Phase 3 — Inspection

Dispatch polyglot First Mates on the full branch diff. Findings become
repair tasks executed by Crewmates. Loop until clean or cap reached.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "inspection" ] || { echo "Not in inspection phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
BASE_SHA=$(echo "$STATE" | jq -r '.branch.base_sha_at_start')
ATTEMPT_CAP=$(echo "$STATE" | jq -r '.inspection.attempt_cap')
DECLINED=$(echo "$STATE" | jq '.inspection.declined_findings')
RUBRIC=$(cat "${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md")
```

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"inspection\",\"event\":\"started\"}"
```

## Step 3: Inspection loop

Repeat until clean or cap reached.

**3a. Compute diff and bucket by language:**

```bash
DIFF=$(git diff "$BASE_SHA"...HEAD)
# Bucket files by extension
JS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(ts|tsx|js|jsx|mts|cts)$' || true)
PY_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.py$' || true)
GO_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.go$' || true)
RS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.rs$' || true)
SH_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(sh|bash|zsh)$' || true)
OTHER_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | \
  grep -Ev '\.(ts|tsx|js|jsx|mts|cts|py|go|rs|sh|bash|zsh)$' || true)
```

**3b. Dispatch First Mates in parallel — one per non-empty bucket (single message):**

```
Agent(first-mate, language=javascript, files=JS_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(first-mate, language=python,     files=PY_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(first-mate, language=go,         files=GO_FILES, ...)
Agent(first-mate, language=rust,       files=RS_FILES, ...)
Agent(first-mate, language=shell,      files=SH_FILES, ...)
Agent(first-mate, language=general,    files=OTHER_FILES, ...)
```

Omit any Agent call for an empty bucket.

**3c. Collect and deduplicate findings:**

Merge all FINDINGS blocks. Deduplicate by `(file, line, summary)`.

**3d. Check for clean:**

If `findings` contains no item with severity `blocker`, `major`, or `minor`:
```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"...\",\"phase\":\"inspection\",\"event\":\"completed\"}"
echo "Inspection clear — no significant findings. Run /make-port $ISSUE_NUM (or /voyage $ISSUE_NUM)."
exit 0
```

Nits are listed in the voyage log but do not block progress.

**3e. Promote findings to repair tasks:**

```bash
NEXT_IDX=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM" | jq '.plan.next_alpha_index')
# For each finding of severity blocker/major/minor, create a repair task with
# the next pirate name from the roster, origin="inspection".
# Use references/pirate-lexicon.md to look up name at index NEXT_IDX.
```

Add repair tasks to state via `plan_tasks_replace` (extend existing array).
Update `plan_next_alpha`.

**3f. Run repair round:**

Dispatch Crewmates and Quartermasters using the same parallel round logic
as set-sail (see set-sail skill §Step 3). Repair tasks use the same 3-attempt
per-task cap.

After the round, commit any PASSed repair tasks with:
```
fix(<scope>): <name> — <finding summary>

Refs #<ISSUE_NUM>
```

**3g. Increment inspection attempt counter:**

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" inspection_attempts_inc ""
```

Check cap:
```bash
ATTEMPTS=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM" | jq '.inspection.attempts')
if [ "$ATTEMPTS" -ge "$ATTEMPT_CAP" ]; then
  # Halt — present open findings for user triage
  bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" halted_reason \
    "Inspection attempt cap ($ATTEMPT_CAP) reached. Open findings remain."
  # Print halt using halt-protocol.md format
  echo "⚓ HEAVY SEAS — inspection halted"
  echo ""
  echo "  Reason: $ATTEMPT_CAP inspection rounds ran; findings remain open."
  echo ""
  echo "  Open findings:"
  # List remaining open findings from state
  echo ""
  echo "  Yer options:"
  echo "    [1] Decline specific findings and re-run (recommended)"
  echo "    [2] Fix findings manually and re-run /inspection $ISSUE_NUM"
  echo "    [3] Proceed to make-port despite open findings"
  echo "    [4] Abandon voyage (state preserved)"
  exit 0
fi
```

Loop back to Step 3a.
