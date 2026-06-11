---
name: comms
description: Use when the mission PR has review comments to address. Runs a single-pass fetch→triage→fix→reply cycle and saves state. For continuous watching, guide the user to run `/loop 5m /comms <N>`. Trigger on "comms <N>", "/comms", or when the user wants to handle PR review comments.
---

# /comms — PR Comment Processor

Process all new PR comments in one pass — fetch, triage, fix actionable ones, reply to questions, respond to reviewers, re-request review. Saves `last_seen_at` so each invocation only processes truly new comments. For automatic polling, use `/loop 5m /comms <N>`.

## Step 1: Parse arguments

Supported invocations:
- `/comms 42` — process new comments (one pass)
- `/comms 42 --status` — show last-seen timestamp
- `/comms 42 --abandon` — clear saved state
- `/comms 42 --models capcom=opus` — model overrides for this run

```bash
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"

if [ -z "$ISSUE_NUM" ] || [[ "$ISSUE_NUM" == --* ]]; then
  FLAG="${ISSUE_NUM:-$FLAG}"
  ISSUE_NUM=""
fi

if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi

[ -n "$ISSUE_NUM" ] || { echo "Usage: /comms <issue_number> [--status|--abandon] [--models …]"; exit 1; }
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/comms-state.json"
# Migrate pre-0.7.0 state location
OLD_STATE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms-state.json"
[ -f "$OLD_STATE" ] && [ ! -f "$STATE_FILE" ] && mv "$OLD_STATE" "$STATE_FILE"
```

## Step 1b: Resolve models

Built-in defaults: `director=fable`, `astronaut=sonnet`, `controller=sonnet`, `inspector=fable`, `capcom=sonnet`, `docking=sonnet`, `utility=haiku`.

1. If `.claude/mission.local.md` exists at the repo root, Read it and take any entries under `models:` in its YAML frontmatter.
2. If the invocation included `--models role=value,...`, apply those entries on top.
3. Valid roles: `director`, `astronaut`, `controller`, `inspector`, `capcom`, `docking`, `utility`. Valid values: `haiku`, `sonnet`, `opus`, `fable`. Warn about and ignore any invalid entry — never abort over one.

The merged result is `MODELS`, passed to the workflow as `args.models`.

## Step 2: Discover branch, worktree, and PR

```bash
BRANCH=$(git branch --list "claude/issue-${ISSUE_NUM}-*" | head -1 | tr -d ' *')
if [ -z "$BRANCH" ]; then
  BRANCH=$(git branch -r --list "origin/claude/issue-${ISSUE_NUM}-*" | head -1 | tr -d ' ' | sed 's|^origin/||')
fi
[ -n "$BRANCH" ] || { echo "No branch found for issue #${ISSUE_NUM}. Has /mission run yet?"; exit 1; }

WORKTREE_DIR="$REPO_ROOT/.claude/worktrees"
WORKTREE_PATH=$(ls -d "$WORKTREE_DIR"/issue-${ISSUE_NUM}-* 2>/dev/null | head -1)
if [ -z "$WORKTREE_PATH" ] || [ ! -d "$WORKTREE_PATH" ]; then
  SLUG=$(echo "$BRANCH" | sed "s|claude/issue-${ISSUE_NUM}-||")
  WORKTREE_PATH="$WORKTREE_DIR/issue-${ISSUE_NUM}-${SLUG}"
  mkdir -p "$WORKTREE_DIR"
  git worktree add "$WORKTREE_PATH" "$BRANCH" 2>/dev/null || true
fi

PR_JSON=$(gh pr list --repo "$REPO" --head "$BRANCH" --json number,url,state --jq '.[0] // empty')
[ -n "$PR_JSON" ] || { echo "No open PR found for branch $BRANCH. Has /mission docking completed?"; exit 1; }
PR_NUM=$(echo "$PR_JSON" | jq -r '.number')
PR_URL=$(echo "$PR_JSON" | jq -r '.url')
echo "Processing PR #${PR_NUM}: $PR_URL"
```

## Step 3: Handle --status

If `$FLAG == "--status"`:

```bash
echo "PR #${PR_NUM}: $PR_URL"
if [ -f "$STATE_FILE" ]; then
  LAST_SEEN=$(jq -r '.last_seen_at // "never"' "$STATE_FILE")
  echo "Last processed: $LAST_SEEN"
else
  echo "No prior run found."
fi
exit 0
```

## Step 4: Handle --abandon

If `$FLAG == "--abandon"`:

Ask: "This will clear the last-seen timestamp for issue #${ISSUE_NUM}. Type `yes` to confirm."

On `yes`:
```bash
rm -f "$STATE_FILE"
echo "Comms state cleared for issue #${ISSUE_NUM}."
exit 0
```

## Step 5: Load last-seen timestamp

```bash
LAST_SEEN_AT="1970-01-01T00:00:00Z"
[ -f "$STATE_FILE" ] && LAST_SEEN_AT=$(jq -r '.last_seen_at // "1970-01-01T00:00:00Z"' "$STATE_FILE")
```

## Step 6: Invoke the comms workflow (single pass)

The comms workflow processes all new comments in one pass and returns immediately — no sleeping, no looping.

Call the Workflow tool with:
- `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/comms-workflow.js` (expand the env var — do NOT use import() or cat)
- `args`: {
    issue_number:  <ISSUE_NUM as integer>,
    repo:          "<REPO>",
    pr_number:     <PR_NUM as integer>,
    branch:        "<BRANCH>",
    worktree_path: "<WORKTREE_PATH>",
    last_seen_at:  "<LAST_SEEN_AT>",
    models:        <MODELS>,
    plugin_root:   "<value of $CLAUDE_PLUGIN_ROOT>"
  }

**Do not pass `resumeFromRunId`** — each comms run is a fresh single-pass invocation.

Save the new `last_seen_at` from the result immediately:
```bash
echo "{\"last_seen_at\":\"<result.last_seen_at>\"}" > "$STATE_FILE"
```

## Step 7: Report result

**If `result.status` is `'merged'`:**
```
PR #<pr_number> merged — mission complete!
Clean up when ready:  git worktree remove <worktree_path>
```

**If `result.status` is `'resolved'`:**
```
All threads resolved and CI green — ready to merge.
```

**If `result.status` is `'pending'` or anything else:**
```
Pass complete for PR #<pr_number>:
  Fixed: <items_fixed> comment(s)
  Replied: <items_replied> question(s)
  Last seen: <last_seen_at>
```

If `result.open_items` is non-empty, list them:
```
Ambiguous comments needing manual attention:
  @<author>: "<summary>"
  …
```

Always end with:
```
Run /comms <N> again to check for new comments, or:
  /loop 5m /comms <N>   — watch automatically every 5 minutes
```

If the workflow throws, the error message explains what failed. Re-run `/comms <N>` to retry.
