---
name: docking
description: Use when the mission is in docking phase, or when /mission dispatches docking. Pushes the branch, discovers PR conventions, opens a PR with Closes #N, moves the project board card to In Review, and offers to schedule a comms watcher. Trigger on "docking <N>" or when mission state shows phase=docking.
---

# Phase 4 — Docking

Push the branch, open the PR, move the project board card, and offer to
schedule a comms watcher.

## Step 1: Load state and pre-flight checks

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
ISSUE_NUM="${ARG1:-}"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
[ "$PHASE" = "docking" ] || { echo "Not in docking phase (current: $PHASE)"; exit 1; }
[ "$PHASE_STATUS" != "halted" ] || {
  echo "Mission halted. Reason: $(echo "$STATE" | jq -r '.halted_reason')"
  echo "Resolve the halt condition then re-run /docking $ISSUE_NUM."
  exit 1
}
[ "$PHASE_STATUS" = "completed" ] && {
  echo "Docking already complete. Run /mission $ISSUE_NUM to advance."
  exit 0
}
WORKTREE_PATH=$(echo "$STATE" | jq -r '.branch.worktree_path')
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
ISSUE_TITLE=$(echo "$STATE" | jq -r '.issue.title')
BRANCH=$(echo "$STATE" | jq -r '.branch.name')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
BASE=$(echo "$STATE" | jq -r '.branch.base')
```

Check that the worktree path exists before entering:
```bash
[ -d "$WORKTREE_PATH" ] || {
  echo "ERROR: Worktree not found at $WORKTREE_PATH."
  echo "Re-run /pre-launch $ISSUE_NUM to recreate it."
  exit 1
}
```

Call `EnterWorktree` with `path: $WORKTREE_PATH` to switch the session into the mission worktree.

```bash
# Verify clean working tree
DIRTY=$(git status --porcelain | grep -v '^??' || true)
if [ -n "$DIRTY" ]; then
  echo "Uncommitted changes found. Commit or stash before docking."
  echo "$DIRTY"
  exit 1
fi

bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"docking\",\"event\":\"started\"}"
```

## Step 2: Push branch

```bash
if ! git push -u origin "$BRANCH"; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
    "git push failed on branch $BRANCH. Resolve the conflict then re-run /docking $ISSUE_NUM."
  echo "🚨 ABORT SEQUENCE — docking halted"
  echo ""
  echo "  Reason: git push failed on branch $BRANCH."
  echo ""
  echo "  Where we are:"
  echo "    Issue #$ISSUE_NUM, docking phase — branch not yet pushed"
  echo ""
  echo "  Your options:"
  echo "    [1] Resolve the push conflict (e.g. git pull --rebase) and re-run /docking $ISSUE_NUM (recommended)"
  echo "    [2] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
  echo ""
  echo "  Enter a number, or describe what you want."
  exit 1
fi
```

## Step 3: Discover PR conventions

Look for conventions in order; use the first match:
1. `.github/PULL_REQUEST_TEMPLATE.md` or `.github/pull_request_template.md`
2. Recent PRs in the repo (`gh pr list --repo "$REPO" --limit 5 --json body`)
3. `CLAUDE.md` sections mentioning PR or pull request
4. Fall back to the mission default template

## Step 4: Build PR body

Construct the body and assign to `$PR_BODY`. Use `$ISSUE_TITLE` for the PR title.

```
## Summary
<1–3 bullets derived from issue body and commits since base_sha>

## Changes
<bulleted file-by-file summary from git diff --stat>

## Test plan
- [x] Unit tests pass
- [x] Lint passes
- [x] Types pass
- [ ] Manual verification: <issue acceptance criteria>

## Closes
Closes #<ISSUE_NUM>

<details>
<summary>🚀 Mission log</summary>

<output of mission-print-log.sh ISSUE_NUM>

</details>

🤖 Generated via /mission
```

## Step 5: Open PR

```bash
EXISTING_PR=$(gh pr list --repo "$REPO" --head "$BRANCH" \
  --json number,url --jq '.[0] // empty' 2>/dev/null)
if [ -n "$EXISTING_PR" ]; then
  PR_NUM=$(echo "$EXISTING_PR" | jq -r '.number')
  PR_URL=$(echo "$EXISTING_PR" | jq -r '.url')
  echo "PR #$PR_NUM already exists for this branch — skipping creation."
else
  PR_URL=$(gh pr create \
    --repo "$REPO" \
    --title "$ISSUE_TITLE" \
    --body "$PR_BODY" \
    --base "$BASE" \
    --head "$BRANCH") || {
    bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
    bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
      "gh pr create failed. Check credentials and repo access."
    echo "🚨 ABORT SEQUENCE — docking halted"
    echo ""
    echo "  Reason: gh pr create failed — check credentials and repo access."
    echo ""
    echo "  Where we are:"
    echo "    Issue #$ISSUE_NUM, docking phase — branch pushed but PR creation failed"
    echo ""
    echo "  Your options:"
    echo "    [1] Check credentials (gh auth status) and re-run /docking $ISSUE_NUM (recommended)"
    echo "    [2] Open the PR manually on GitHub, then re-run /docking $ISSUE_NUM"
    echo "    [3] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
    echo ""
    echo "  Enter a number, or describe what you want."
    exit 1
  }
  PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
fi
```

## Step 6: Write PR info to state

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" pr_number "$PR_NUM"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" pr_url "$PR_URL"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"docking\",\"event\":\"pr_opened\",\"pr\":$PR_NUM}"
```

## Step 7: Move project board card to In Review

```bash
OWNER=$(echo "$REPO" | cut -d/ -f1)
PROJECT_NUMBER=$(gh issue view "$ISSUE_NUM" --repo "$REPO" \
  --json projectItems \
  --jq '.projectItems[0].projectV2.number // empty' 2>/dev/null)
if [ -n "$PROJECT_NUMBER" ]; then
  ITEM_ID=$(gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null \
    | jq -r ".items[] | select(.content.number == $ISSUE_NUM) | .id // empty")
  FIELD_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null \
    | jq -r '.fields[] | select(.name == "Status") | .id // empty')
  OPTION_ID=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null \
    | jq -r '.fields[] | select(.name == "Status") | .options[] | select(.name | test("(?i)review")) | .id // empty')
  PROJECT_ID=$(gh project list --owner "$OWNER" --format json 2>/dev/null \
    | jq -r ".projects[] | select(.number == $PROJECT_NUMBER) | .id // empty")
  if [ -n "$ITEM_ID" ] && [ -n "$FIELD_ID" ] && [ -n "$OPTION_ID" ] && [ -n "$PROJECT_ID" ]; then
    gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
      --field-id "$FIELD_ID" --single-select-option-id "$OPTION_ID" 2>/dev/null || true
  fi
fi
# Silently skips if issue has no attached project or no "Status" field with a review-like option.
```

## Step 8: Ask about watcher (single user-touch point)

```
🚀 Docking complete! PR #<N> is open: <PR_URL>

Want me to schedule a comms watcher that checks for new PR comments
every 30 minutes? [y/N]
```

If yes:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" pr_watcher "true"
```
Run the following to schedule the watcher:
```
/schedule "Run /comms $ISSUE_NUM" --every 30m
```
Print the schedule command to the user so they can confirm it was registered.

## Step 9: Advance phase

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"docking\",\"event\":\"completed\"}"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "comms"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
echo "Run /comms $ISSUE_NUM when PR comments arrive (or /mission $ISSUE_NUM)."
```
