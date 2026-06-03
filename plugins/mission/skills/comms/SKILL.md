---
name: comms
description: Use when the mission PR has review comments to address, or when starting a PR watcher. Discovers the PR info from git and GitHub, looks up any prior run for resumability, then invokes the comms workflow which polls for comments and addresses them in a loop until the PR is merged. Trigger on "comms <N>", "/comms", or when the user wants to watch or handle PR review comments.
---

# /comms — PR Comment Watcher

Discover the PR info for the issue, find any prior run, and invoke (or resume) the
comms workflow. The workflow polls for new comments every 5 minutes and addresses
them autonomously until the PR is merged or all threads are resolved.

## Step 1: Parse arguments

Supported invocations:
- `/comms 42` — start or resume watching
- `/comms 42 --status` — show run ID and last-seen timestamp
- `/comms 42 --abandon` — clear saved run state
- `/comms 42 --poll 120` — override poll interval in seconds (default 300)

```bash
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"
POLL_INTERVAL="${ARG3:-300}"

if [ -z "$ISSUE_NUM" ] || [[ "$ISSUE_NUM" == --* ]]; then
  FLAG="${ISSUE_NUM:-$FLAG}"
  ISSUE_NUM=""
fi

if [[ "$FLAG" == --poll ]]; then
  POLL_INTERVAL="$ARG3"
  FLAG=""
elif [[ "$FLAG" == --poll=* ]]; then
  POLL_INTERVAL="${FLAG#--poll=}"
  FLAG=""
fi

if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi

[ -n "$ISSUE_NUM" ] || { echo "Usage: /comms <issue_number> [--status|--abandon|--poll <secs>]"; exit 1; }
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
REPO_ROOT=$(git rev-parse --show-toplevel)
```

## Step 2: Discover branch, worktree, and PR

```bash
# Find the mission branch for this issue
BRANCH=$(git branch --list "claude/issue-${ISSUE_NUM}-*" | head -1 | tr -d ' *')
if [ -z "$BRANCH" ]; then
  # Check remotes too
  BRANCH=$(git branch -r --list "origin/claude/issue-${ISSUE_NUM}-*" | head -1 | tr -d ' ' | sed 's|^origin/||')
fi
[ -n "$BRANCH" ] || { echo "No branch found for issue #${ISSUE_NUM}. Has /mission run yet?"; exit 1; }

# Find the worktree path
WORKTREE_DIR="$REPO_ROOT/.claude/worktrees"
WORKTREE_PATH=$(ls -d "$WORKTREE_DIR"/issue-${ISSUE_NUM}-* 2>/dev/null | head -1)
if [ -z "$WORKTREE_PATH" ] || [ ! -d "$WORKTREE_PATH" ]; then
  # Worktree may have been removed after docking — that's fine, comms can work without it
  # Use a fresh worktree re-add
  SLUG=$(echo "$BRANCH" | sed "s|claude/issue-${ISSUE_NUM}-||")
  WORKTREE_PATH="$WORKTREE_DIR/issue-${ISSUE_NUM}-${SLUG}"
  mkdir -p "$WORKTREE_DIR"
  git worktree add "$WORKTREE_PATH" "$BRANCH" 2>/dev/null || true
fi

# Find the open PR for this branch
PR_JSON=$(gh pr list --repo "$REPO" --head "$BRANCH" --json number,url,state --jq '.[0] // empty')
[ -n "$PR_JSON" ] || { echo "No open PR found for branch $BRANCH. Has /mission docking completed?"; exit 1; }
PR_NUM=$(echo "$PR_JSON" | jq -r '.number')
PR_URL=$(echo "$PR_JSON" | jq -r '.url')
echo "Watching PR #${PR_NUM}: $PR_URL"
```

## Step 3: Handle --status

If `$FLAG == "--status"`:

```bash
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms-state.json"
RUN_ID_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms.runid"

echo "PR #${PR_NUM}: $PR_URL"
if [ -f "$RUN_ID_FILE" ]; then
  echo "Workflow run: $(cat "$RUN_ID_FILE")"
fi
if [ -f "$STATE_FILE" ]; then
  LAST_SEEN=$(jq -r '.last_seen_at // "never"' "$STATE_FILE")
  echo "Last seen: $LAST_SEEN"
fi
echo "View progress: /workflows"
exit 0
```

## Step 4: Handle --abandon

If `$FLAG == "--abandon"`:

Ask: "This will clear the comms run ID and last-seen timestamp for issue #${ISSUE_NUM}. Type `yes` to confirm."

On `yes`:
```bash
rm -f "${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms.runid"
rm -f "${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms-state.json"
echo "Comms state cleared for issue #${ISSUE_NUM}."
exit 0
```

## Step 5: Look up prior run ID and last-seen timestamp

```bash
mkdir -p "${CLAUDE_PLUGIN_DATA}/mission-runs"
RUN_ID_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms.runid"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms-state.json"

PRIOR_RUN_ID=""
[ -f "$RUN_ID_FILE" ] && PRIOR_RUN_ID=$(cat "$RUN_ID_FILE")

LAST_SEEN_AT="1970-01-01T00:00:00Z"
[ -f "$STATE_FILE" ] && LAST_SEEN_AT=$(jq -r '.last_seen_at // "1970-01-01T00:00:00Z"' "$STATE_FILE")
```

## Step 6: Invoke the comms workflow

Call the Workflow tool:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/comms.js",
  resumeFromRunId: <PRIOR_RUN_ID if non-empty, otherwise omit>,
  args: {
    issue_number:  <ISSUE_NUM as integer>,
    repo:          "<REPO>",
    pr_number:     <PR_NUM as integer>,
    branch:        "<BRANCH>",
    worktree_path: "<WORKTREE_PATH>",
    last_seen_at:  "<LAST_SEEN_AT>",
    poll_interval: <POLL_INTERVAL as integer>
  }
})
```

Save the returned `runId` and `last_seen_at` immediately:

```bash
echo "<runId>" > "$RUN_ID_FILE"
echo '{"last_seen_at":"<last_seen_at from return value>"}' > "$STATE_FILE"
```

## Step 7: Report result

If the workflow returns with PR merged or all threads resolved:
```
Comms complete for issue #<N>!
  PR #<pr_number> — <pr_url>
  Rounds: <rounds_completed>

Run /mission <N> --finish to close the mission.
```

If max rounds were reached (workflow exits cleanly but not done):
```
Comms watcher paused after <rounds_completed> rounds (approx <hours>h).
  Last seen: <last_seen_at>
  Re-run /comms <N> to continue watching.
```

If the workflow throws, the error message explains what failed. The run ID is saved —
re-run `/comms <N>` to resume from where it stopped.
