---
name: chart-course
description: Use when the user wants to start planning an issue in the voyage workflow, or when /voyage dispatches the chart-course phase. Trigger on "chart-course <N>", "/chart-course", or when voyage state shows phase=chart-course and phase_status=pending. Reads the GitHub issue, creates a worktree, dispatches Navigator, writes the plan to state, and asks for confirmation before set-sail.
---

# Phase 1 — Chart Course

Read issue #N, create a worktree, dispatch the Navigator, write the plan to
the voyage state file, and confirm with the user before setting sail.

## Step 1: Resolve issue number and repo

```bash
# Prefer argument, then branch name, then ask
ISSUE_NUM="${ARGS:-}"
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
  --json number,title,body,labels,milestone)
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
WORKTREE_PATH="${HOME}/wt/issue-${ISSUE_NUM}"

# Create branch from base if it doesn't exist
git show-ref --verify --quiet "refs/heads/$BRANCH" || \
  git branch "$BRANCH" "origin/$BASE"

# Create worktree if it doesn't exist
[ -d "$WORKTREE_PATH" ] || \
  git worktree add "$WORKTREE_PATH" "$BRANCH"
```

## Step 4: Initialise state file

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
bash "$SCRIPT_DIR/voyage-state-init.sh" \
  "$ISSUE_NUM" "$ISSUE_TITLE" "$REPO" \
  "$BRANCH" "$WORKTREE_PATH" "$BASE" "$BASE_SHA"
```

If init returned without error (idempotent), read current state to check
if this phase was already completed:

```bash
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
if [ "$PHASE" != "chart-course" ] || [ "$PHASE_STATUS" = "completed" ]; then
  echo "Chart course already complete. Run /set-sail $ISSUE_NUM to continue."
  exit 0
fi
```

## Step 5: Move project board card to In Progress

```bash
PROJECT_ID=$(gh issue view "$ISSUE_NUM" --repo "$REPO" \
  --json projectItems --jq '.projectItems[0].id // empty')
if [ -n "$PROJECT_ID" ]; then
  # Find the "In Progress" field option id and update
  gh issue edit "$ISSUE_NUM" --repo "$REPO" 2>/dev/null || true
  # gh project item-edit --id "$PROJECT_ID" --field-id <STATUS_FIELD> \
  #   --project-id <PROJECT_NUM> --single-select-option-id <IN_PROGRESS_ID>
  # Discovery pattern: match issue-flow's existing move-to-in-progress logic.
fi
```

## Step 6: Dispatch Navigator

Read current `plan.next_alpha_index` from state (0 for a fresh voyage).
Dispatch the Navigator sub-agent:

```
Agent(navigator, context={
  issue_number: ISSUE_NUM,
  issue_body: ISSUE_JSON.body,
  issue_title: ISSUE_TITLE,
  repo: REPO,
  worktree_path: WORKTREE_PATH,
  next_alpha_index: 0,
  instructions: "Load references/agent-contracts.md for the PLAN block format.
                 Load references/pirate-lexicon.md for the task name roster.
                 Start naming tasks from index 0."
})
```

Parse the `### PLAN` / `### END PLAN` block from the Navigator's response.
If the Navigator returns an `open_questions` list, surface them to the user
before proceeding.

## Step 7: Write plan to state

Convert the Navigator's tasks into the state-file task schema and write:

```bash
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

bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_tasks_replace "$TASKS_JSON"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_next_alpha \
  "$(echo "$PLAN_BLOCK" | grep '^next_alpha_index:' | awk '{print $2}')"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"chart-course\",\"event\":\"completed\",\"tasks\":$(echo "$TASKS_JSON" | jq length)}"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
```

## Step 8: Present plan and confirm

Print the plan in a readable table:

```
Ahoy! The Navigator has charted the course for issue #N:

  Name          Title                                    Files
  ──────────────────────────────────────────────────────────────
  Anne          Add exponential backoff helper           src/retry.ts
  Blackbeard    Wire retry into webhook sender           src/webhook.ts  [->Anne]
  Calico        Add tests for retry logic                src/retry.test.ts

Set sail? [Y/n]  (or pass --auto to skip this confirmation)
```

If the user says `n` or provides feedback, re-dispatch the Navigator with
the user's feedback as revision instructions, and repeat from Step 6.

If the user says `y` (or `--auto` was passed), print:

```
All hands on deck — setting sail for issue #N. Run /set-sail N (or /voyage N) to build.
```

The phase is already marked `completed` in state. `/voyage N` will advance
to `set-sail` on the next invocation.
