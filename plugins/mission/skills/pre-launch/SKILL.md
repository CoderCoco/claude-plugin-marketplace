---
name: pre-launch
description: Use when the user wants to start planning an issue in the mission workflow, or when /mission dispatches the pre-launch phase. Trigger on "pre-launch <N>", "/pre-launch", or when mission state shows phase=pre-launch and phase_status=pending. Reads the GitHub issue, creates a worktree, dispatches Flight Director, writes the flight plan to state, and asks for confirmation before liftoff.
---

# Phase 1 — Pre-Launch

Read issue #N, create a worktree, dispatch the Flight Director, write the
flight plan to the mission state file, and confirm with the user before liftoff.

## Step 1: Resolve issue number and repo

```bash
# Prefer argument, then branch name, then ask
ISSUE_NUM="${ARG1:-}"
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi
# If still empty, ask the user: "Which issue number?"
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

## Step 2: Read the issue

```bash
ISSUE_JSON=$(gh issue view "$ISSUE_NUM" --repo "$REPO" \
  --json number,title,body,labels,milestone \
  | tr -d '\000-\010\013\014\016-\037')
ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
```

## Step 3: Create branch and worktree

If a branch `claude/issue-<N>-*` already exists locally or remotely, check
it out. Otherwise create it:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null | sed 's|^origin/||')
BASE=${BASE:-main}
git fetch origin "$BASE"
BASE_SHA=$(git rev-parse "origin/$BASE")

SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | \
  sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-50 | sed 's/-$//')
BRANCH="claude/issue-${ISSUE_NUM}-${SLUG}"
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_PATH="${REPO_ROOT}/.claude/worktrees/issue-${ISSUE_NUM}-${SLUG}"

# Create branch from base if it doesn't exist
git show-ref --verify --quiet "refs/heads/$BRANCH" || \
  git branch "$BRANCH" "origin/$BASE"

# Create worktree if it doesn't exist
if [ ! -d "$WORKTREE_PATH" ]; then
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  # Guard: ensure an existing worktree is on the expected branch
  WT_BRANCH=$(git -C "$WORKTREE_PATH" branch --show-current 2>/dev/null)
  if [ "$WT_BRANCH" != "$BRANCH" ]; then
    echo "🚨 ABORT SEQUENCE — pre-launch halted"
    echo ""
    echo "  Reason: Worktree at $WORKTREE_PATH is on branch '$WT_BRANCH', expected '$BRANCH'."
    echo ""
    echo "  Where we are:"
    echo "    Issue #$ISSUE_NUM, pre-launch phase — worktree conflict (no state written yet)"
    echo ""
    echo "  Your options:"
    echo "    [1] Remove the stale worktree then re-run /pre-launch $ISSUE_NUM (recommended):"
    echo "          git worktree remove --force $WORKTREE_PATH"
    echo "    [2] Abort (no state written — safe to stop without using /mission)"
    echo ""
    echo "  Enter a number, or describe what you want."
    exit 1
  fi
fi
```

Call `EnterWorktree` with `path: $WORKTREE_PATH` to switch the session into the new worktree.

## Step 4: Initialise state file

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
bash "$SCRIPT_DIR/mission-state-init.sh" \
  "$ISSUE_NUM" "$ISSUE_TITLE" "$REPO" \
  "$BRANCH" "$WORKTREE_PATH" "$BASE" "$BASE_SHA"
```

If init returned without error (idempotent), read current state to check
if this phase was already completed:

```bash
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
if [ "$PHASE" != "pre-launch" ] || [ "$PHASE_STATUS" = "completed" ]; then
  echo "Pre-launch already complete. Run /liftoff $ISSUE_NUM to continue."
  exit 0
fi
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"pre-launch\",\"event\":\"started\"}"
```

## Step 5: Move project board card to In Progress

```bash
OWNER=$(echo "$REPO" | cut -d/ -f1)
PROJECT_NUMBER=$(gh issue view "$ISSUE_NUM" --repo "$REPO" \
  --json projectItems \
  --jq '.projectItems[0].projectV2.number // empty' 2>/dev/null)
if [ -n "$PROJECT_NUMBER" ]; then
  ITEM_ID=$(gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null \
    | jq -r ".items[] | select(.content.number == $ISSUE_NUM) | .id // empty")
  if [ -n "$ITEM_ID" ]; then
    FIELD_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null \
      | jq -r '.fields[] | select(.name == "Status") | .id // empty')
    OPTION_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null \
      | jq -r '.fields[] | select(.name == "Status") | .options[] | select(.name | test("(?i)progress")) | .id // empty')
    PROJECT_ID=$(gh project list --owner "$OWNER" --format json 2>/dev/null \
      | jq -r ".projects[] | select(.number == $PROJECT_NUMBER) | .id // empty")
    if [ -n "$FIELD_ID" ] && [ -n "$OPTION_ID" ] && [ -n "$PROJECT_ID" ]; then
      gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
        --field-id "$FIELD_ID" --single-select-option-id "$OPTION_ID" 2>/dev/null || true
    fi
  fi
fi
# Silently skips if issue has no attached project.
```

## Step 6: Dispatch Flight Director

Read current `plan.next_alpha_index` from state (0 for a fresh mission).
Dispatch the Flight Director sub-agent:

```
Agent(flight-director, context={
  issue_number: ISSUE_NUM,
  issue_body: ISSUE_JSON.body,
  issue_title: ISSUE_TITLE,
  repo: REPO,
  worktree_path: WORKTREE_PATH,
  next_alpha_index: 0,
  instructions: "Load references/agent-contracts.md for the PLAN block format.
                 Load references/crew-roster.md for the task name roster.
                 Start naming tasks from index 0."
})
```

Parse the `### PLAN` / `### END PLAN` block from the Flight Director's response:
```bash
PLAN_BLOCK=$(echo "$FLIGHT_DIRECTOR_RESPONSE" | \
  sed -n '/^### PLAN$/,/^### END PLAN$/{ /^### /d; p; }')
```

If the Flight Director returns a non-empty `open_questions` list, surface them to
the user before proceeding:

```
The Flight Director has questions before finalising the plan:

  1. <question 1>
  2. <question 2>

Please answer these, then I'll re-dispatch the Flight Director with your answers.
```

Collect the user's answers, then re-dispatch the Flight Director with the answers
appended to the revision instructions. Do not proceed to Step 7 until all questions
are resolved.

## Step 7: Write flight plan to state

Convert the Flight Director's tasks into the state-file task schema and write:

```bash
# Verify PyYAML is available (required for PLAN block parsing)
python3 -c "import yaml" 2>/dev/null || {
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
    "PyYAML not installed. Install with: pip install pyyaml"
  echo "🚨 ABORT SEQUENCE — pre-launch halted"
  echo ""
  echo "  Reason: PyYAML is required to parse the flight plan but is not installed."
  echo ""
  echo "  Where we are:"
  echo "    Issue #$ISSUE_NUM, pre-launch phase — flight plan received but cannot be parsed"
  echo ""
  echo "  Your options:"
  echo "    [1] Install PyYAML and re-run /pre-launch $ISSUE_NUM (recommended): pip install pyyaml"
  echo "    [2] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
  echo ""
  echo "  Enter a number, or describe what you want."
  exit 1
}

# Build tasks JSON array from PLAN block
TASKS_JSON=$(echo "$PLAN_BLOCK" | python3 -c "
import sys, json, yaml
plan = yaml.safe_load(sys.stdin)
tasks = []
for t in plan['tasks']:
    tasks.append({
        'name': t['name'],
        'title': t['title'],
        'files': t['files'],
        'depends_on': t.get('depends_on', []),
        'status': 'pending',
        'crewmate_attempts': 0,
        'quartermaster_verdict': None,
        'commit_sha': None,
        'origin': 'plan',
        'notes': ''
    })
print(json.dumps(tasks))
")

bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_tasks_replace "$TASKS_JSON"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_next_alpha \
  "$(echo "$PLAN_BLOCK" | python3 -c "import sys,yaml; print(yaml.safe_load(sys.stdin)['next_alpha_index'])")"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"pre-launch\",\"event\":\"completed\",\"tasks\":$(echo "$TASKS_JSON" | jq length)}"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
```

## Step 8: Present flight plan and confirm

Print the flight plan in a readable table:

```
Flight plan ready for issue #N:

  Name          Title                                    Files
  ──────────────────────────────────────────────────────────────
  Apollo        Add exponential backoff helper           src/retry.ts
  Borman        Wire retry into webhook sender           src/webhook.ts  [->Apollo]
  Cassini       Add tests for retry logic                src/retry.test.ts

Ready for liftoff? [Y/n]  (or pass --auto to skip this confirmation)
```

If the user says `n` or provides feedback, re-dispatch the Flight Director with
the user's feedback as revision instructions, and repeat from Step 6.

If the user says `y` (or `--auto` was passed):

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "liftoff"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
```

Print:

```
All systems go — mission is ready for liftoff on issue #N.
```

Then immediately invoke the `mission:liftoff` skill with `$ISSUE_NUM` as the argument to begin liftoff.
