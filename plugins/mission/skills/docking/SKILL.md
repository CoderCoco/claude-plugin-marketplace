---
name: docking
description: Use when the mission is in docking phase, or when /mission dispatches docking. Pushes branch, opens PR with Closes #N, moves board card, asks about scheduling a watcher. Trigger on "docking <N>" or when mission state shows phase=docking.
---

# Phase 4 — Docking

Push the branch, open the PR, move the project board card, and offer to
schedule a comms watcher.

## Step 1: Load state and pre-flight checks

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "docking" ] || { echo "Not in docking phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
BRANCH=$(echo "$STATE" | jq -r '.branch.name')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
BASE=$(echo "$STATE" | jq -r '.branch.base')

# Verify clean working tree
DIRTY=$(git status --porcelain | grep -v '^??' || true)
if [ -n "$DIRTY" ]; then
  echo "Uncommitted changes found. Commit or stash before docking."
  echo "$DIRTY"
  exit 1
fi
```

## Step 2: Push branch

```bash
git push -u origin "$BRANCH"
```

## Step 3: Discover PR conventions

Look for conventions in order; use the first match:
1. `.github/PULL_REQUEST_TEMPLATE.md` or `.github/pull_request_template.md`
2. Recent PRs in the repo (`gh pr list --repo "$REPO" --limit 5 --json body`)
3. `CLAUDE.md` sections mentioning PR or pull request
4. Fall back to the mission default template

## Step 4: Build PR body

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
PR_URL=$(gh pr create \
  --repo "$REPO" \
  --title "<ISSUE_TITLE>" \
  --body "$PR_BODY" \
  --base "$BASE" \
  --head "$BRANCH")
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
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
# Discover project field using gh project (same pattern as issue-flow open-pr)
# Attempt to move card; silently skip if project/field not found.
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
# Use /schedule to create: "Run /comms <ISSUE_NUM> if there are new comments"
# every 30 minutes. Show user the schedule command.
```

## Step 9: Advance phase

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"docking\",\"event\":\"completed\"}"
echo "Run /comms $ISSUE_NUM when PR comments arrive (or /mission $ISSUE_NUM)."
```
