---
name: parley
description: Use when the voyage is in parley phase, or when /voyage dispatches parley. Fetches PR comments since last visit, dispatches Bosun to categorise, dispatches Crewmates for actionable fixes, posts approved replies, and re-requests Copilot review after pushing fixes. Trigger on "parley <N>", "/parley", or when voyage state shows phase=parley.
---

# Phase 5 — Parley

Handle incoming PR comments. Fix actionable items, answer questions (with
approval), and re-request Copilot review after any push.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "parley" ] || { echo "Not in parley phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
PR_NUM=$(echo "$STATE" | jq -r '.pr.number')
LAST_SEEN=$(echo "$STATE" | jq -r '.pr.last_comment_id_seen // 0')
```

## Step 2: Fetch new comments

```bash
COMMENTS=$(gh pr view "$PR_NUM" --repo "$REPO" \
  --json comments,reviews --jq "
    [.comments[], (.reviews[]? | .comments[]?)] |
    map(select(.databaseId > $LAST_SEEN)) |
    sort_by(.databaseId)")
NEW_COUNT=$(echo "$COMMENTS" | jq length)
```

If `NEW_COUNT == 0`:
```
Smooth seas — no new comments since last parley.
```
Exit 0.

## Step 3: Dispatch Bosun

```
Agent(bosun, context={
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
  bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" halted_reason \
    "Bosun found ambiguous comments — Captain must classify them."
  echo "⚓ HEAVY SEAS — parley halted"
  echo ""
  echo "  Reason: Bosun couldna classify these comments:"
  echo "$TRIAGE" | jq -r '.comments[] | select(.category == "ambiguous") | "    - \(.author): \(.reply_draft // "(no draft)")"'
  echo ""
  echo "  Yer options:"
  echo "    [1] Tell me how to handle each ambiguous comment"
  echo "    [2] Ignore ambiguous comments and continue"
  echo "    [3] Abandon voyage (state preserved)"
  exit 0
fi
```

## Step 4: Handle actionable comments

Get actionable items from triage. Promote to repair tasks (origin="parley").
Run parallel Crewmate+Quartermaster round (same as set-sail).

After all PASSed:
```bash
git push origin "$BRANCH"
PUSH_SHA=$(git rev-parse HEAD)
```

Commit format for each parley fix:
```
fix(<scope>): <name> — <fix_hint summary>

Refs #<ISSUE_NUM>
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
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" pr_copilot "true"
gh pr edit "$PR_NUM" --repo "$REPO" --add-reviewer Copilot 2>/dev/null || \
  echo "Note: Copilot re-request failed — re-request manually if needed."
```

## Step 7: Update last_comment_id_seen

```bash
MAX_ID=$(echo "$COMMENTS" | jq '[.[].databaseId] | max')
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" pr_last_comment "$MAX_ID"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"parley\",\"event\":\"round_complete\",\"fixed\":$(echo "$TRIAGE" | jq '[.comments[] | select(.category == "actionable")] | length')}"
```

Phase stays `parley`. Re-run `/parley <N>` or `/voyage <N>` for the next batch.

## Step 8: Optional loop-back to inspection

If >= 3 repair tasks were fixed and committed this round:
```
We pushed 3 fixes. Want the First Mate to review them before the next
reviewer cycle? [y/N]
```
If yes: advance `phase` back to `inspection`, reset `phase_status` to `pending`.
