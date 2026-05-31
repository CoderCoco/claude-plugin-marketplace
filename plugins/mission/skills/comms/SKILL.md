---
name: comms
description: Use when the mission is in comms phase, or when /mission dispatches comms. Fetches PR comments since last visit, dispatches CAPCOM to categorise, dispatches Astronauts for actionable fixes, posts approved replies, and re-requests Copilot review after pushing fixes. Trigger on "comms <N>", "/comms", or when mission state shows phase=comms.
---

# Phase 5 — Comms

Handle incoming PR comments. Fix actionable items, answer questions (with
approval), and re-request Copilot review after any push.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "comms" ] || { echo "Not in comms phase"; exit 1; }
WORKTREE_PATH=$(echo "$STATE" | jq -r '.branch.worktree_path')
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
PR_NUM=$(echo "$STATE" | jq -r '.pr.number')
LAST_SEEN_AT=$(echo "$STATE" | jq -r '.pr.last_seen_at // "1970-01-01T00:00:00Z"')
```

Call `EnterWorktree` with `path: $WORKTREE_PATH` to switch the session into the mission worktree.

## Step 2: Fetch new comments

```bash
COMMENTS=$(gh pr view "$PR_NUM" --repo "$REPO" \
  --json comments,reviews --jq "
    [
      (.comments[] | {id: (.databaseId | tostring), author: .author.login, body, url, createdAt}),
      (.reviews[]? | select(.body != \"\" and .body != null)
        | {id: .id, author: .author.login, body, url, createdAt, isReview: true}),
      (.reviews[]? | .comments[]?
        | {id: (.databaseId | tostring), author: .author.login, body, url, createdAt})
    ] |
    map(select(.createdAt > \"$LAST_SEEN_AT\")) |
    sort_by(.createdAt)")
NEW_COUNT=$(echo "$COMMENTS" | jq length)
```

If `NEW_COUNT == 0`:
```
All systems nominal — no new comments since last comms check.
```
Exit 0.

## Step 3: Dispatch CAPCOM

```
Agent(capcom, context={
  comments: COMMENTS,
  pr_number: PR_NUM,
  repo: REPO
})
```

Parse the `### TRIAGE` / `### END TRIAGE` block.

If any comment has `category: "ambiguous"`:
```bash
AMBIGUOUS_COUNT=$(echo "$TRIAGE" | jq '[.comments[] | select(.category == "ambiguous")] | length')
if [ "$AMBIGUOUS_COUNT" -gt 0 ]; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
    "CAPCOM found ambiguous comments — Mission Control must classify them."
  echo "🚨 ABORT SEQUENCE — comms halted"
  echo ""
  echo "  Reason: CAPCOM could not classify these comments:"
  echo "$TRIAGE" | jq -r '.comments[] | select(.category == "ambiguous") | "    - \(.author): \(.reply_draft // "(no draft)")"'
  echo ""
  echo "  Your options:"
  echo "    [1] Tell me how to handle each ambiguous comment"
  echo "    [2] Ignore ambiguous comments and continue"
  echo "    [3] Abort mission (state preserved)"
  exit 0
fi
```

## Step 4: Handle actionable comments

Get actionable items from triage. Promote to repair tasks (origin="comms").
Run parallel Astronaut+Flight Controller round (same as liftoff).

After all PASSed:
```bash
git push origin "$BRANCH"
PUSH_SHA=$(git rev-parse HEAD)
```

Commit format for each comms fix:
```
fix(<scope>): <name> — <fix_hint summary>

Refs #$ISSUE_NUM
Co-Authored-By: <comment.author> (via PR comment)
```

## Step 5: Answer questions (with approval)

For each `category: "question"` item with a `reply_draft`:

```
Draft reply to <author>'s question:

"<reply_draft>"

Post this reply? [Y/edit/skip]
```

Wait for approval. On Y: `gh pr comment "$PR_NUM" --repo "$REPO" --body "<draft>" --reply-to <id>`
On edit: let user revise text, then post. On skip: move to next.

## Step 6: Re-request Copilot review

If `triage.copilot_present == true` AND commits were pushed this round:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" pr_copilot "true"
gh pr edit "$PR_NUM" --repo "$REPO" --add-reviewer Copilot 2>/dev/null || \
  echo "Note: Copilot re-request failed — re-request manually if needed."
```

## Step 7: Update last_comment_id_seen

```bash
MAX_AT=$(echo "$COMMENTS" | jq -r '[.[].createdAt] | max')
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" pr_last_seen_at "$MAX_AT"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"comms\",\"event\":\"round_complete\",\"fixed\":$(echo "$TRIAGE" | jq '[.comments[] | select(.category == "actionable")] | length')}"
```

Phase stays `comms`. Re-run `/comms <N>` or `/mission <N>` for the next batch.

## Step 8: Optional loop-back to systems-check

If >= 3 repair tasks were fixed and committed this round:
```
We pushed 3 fixes. Want the Systems Inspector to review them before the next
reviewer cycle? [y/N]
```
If yes: advance `phase` back to `systems-check`, reset `phase_status` to `pending`.
