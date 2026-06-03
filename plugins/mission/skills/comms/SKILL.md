---
name: comms
description: Use when the mission is in comms phase, or when /mission dispatches comms. Fetches PR comments since last visit, dispatches CAPCOM to categorise, dispatches Astronauts for actionable fixes, posts approved replies, and re-requests Copilot review after pushing fixes. Trigger on "comms <N>", "/comms", or when mission state shows phase=comms.
---

# Phase 5 — Comms

Handle incoming PR comments. Fix actionable items, answer questions (with
approval), resolve threads, and re-request Copilot review after any push.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
ISSUE_NUM="${ARG1:-}"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "comms" ] || { echo "Not in comms phase"; exit 1; }
[ "$(echo "$STATE" | jq -r '.phase_status')" = "halted" ] && {
  echo "Comms halted. Reason: $(echo "$STATE" | jq -r '.halted_reason')"
  echo "Resolve the halt condition then re-run /comms $ISSUE_NUM."
  exit 1
}
WORKTREE_PATH=$(echo "$STATE" | jq -r '.branch.worktree_path')
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
BRANCH=$(echo "$STATE" | jq -r '.branch.name')
PR_NUM=$(echo "$STATE" | jq -r '.pr.number')
LAST_SEEN_AT=$(echo "$STATE" | jq -r '.pr.last_seen_at // "1970-01-01T00:00:00Z"')
OWNER=$(echo "$REPO" | cut -d/ -f1)
REPO_NAME=$(echo "$REPO" | cut -d/ -f2)
```

If `$PWD != $WORKTREE_PATH`, call `EnterWorktree` with `path: $WORKTREE_PATH`.

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"comms\",\"event\":\"started\"}"
```

## Step 2: Fetch new comments

Use three separate REST calls — `gh pr view --json reviews` does not reliably
return inline comments, and Copilot review bodies have `submitted_at` not `created_at`.

```bash
# PR-level comments (plain comments on the PR thread)
PR_COMMENTS=$(gh api "repos/$REPO/issues/$PR_NUM/comments" --paginate \
  | jq '[.[] | {
      id,
      node_id,
      author: .user.login,
      body,
      url: .html_url,
      timestamp: .created_at,
      type: "pr_comment",
      in_reply_to_id: null,
      file: null,
      line: null
    }]')

# Review summary bodies — Copilot posts here; use submitted_at as the timestamp
REVIEW_BODIES=$(gh api "repos/$REPO/pulls/$PR_NUM/reviews" --paginate \
  | jq '[.[] | select(.body != "" and .body != null) | {
      id: (.id | tostring),
      node_id,
      author: .user.login,
      body,
      url: .html_url,
      timestamp: (.submitted_at // .created_at),
      type: "review_body",
      in_reply_to_id: null,
      file: null,
      line: null
    }]')

# Inline review comments — the REST endpoint that actually works
INLINE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUM/comments" --paginate \
  | jq '[.[] | {
      id,
      node_id,
      author: .user.login,
      body,
      url: .html_url,
      timestamp: .created_at,
      type: "inline_comment",
      in_reply_to_id: .in_reply_to_id,
      file: .path,
      line: (.line // .original_line)
    }]')

# Merge and filter to only unseen comments
COMMENTS=$(jq -n \
  --argjson pr "$PR_COMMENTS" \
  --argjson rb "$REVIEW_BODIES" \
  --argjson ic "$INLINE_COMMENTS" \
  --arg last "$LAST_SEEN_AT" \
  '($pr + $rb + $ic) | map(select(.timestamp > $last)) | sort_by(.timestamp)')

NEW_COUNT=$(echo "$COMMENTS" | jq length)
```

### Step 2b: Fetch review thread map (for resolution)

Read `${CLAUDE_PLUGIN_ROOT}/references/comms-queries.md` — **Thread Map Query**. Run that query with
`$OWNER`, `$REPO_NAME`, and `$PR_NUM` and store the result:

```bash
THREAD_MAP=$(gh api graphql \
  -f query='<Thread Map Query from comms-queries.md>' \
  -f owner="$OWNER" -f name="$REPO_NAME" -F number="$PR_NUM" \
  | jq '.data.repository.pullRequest.reviewThreads.nodes |
        map({
          key: (.comments.nodes[0].databaseId | tostring),
          value: {thread_id: .id, is_resolved: .isResolved}
        }) | from_entries')
```

If `NEW_COUNT == 0`:
```
All systems nominal — no new comments since last comms check.
```
Then check the done condition (Step 8) and exit.

## Step 3: Dispatch CAPCOM

Pass the full normalized comment list including `in_reply_to_id`, `file`, `line`,
and `type` so CAPCOM can detect duplicates and already-replied threads.

```
Agent(capcom, context={
  comments: COMMENTS,
  inline_comments_raw: INLINE_COMMENTS,
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
  echo "  Reason: CAPCOM could not classify $AMBIGUOUS_COUNT comment(s) — your input is needed."
  echo ""
  echo "  Where we are:"
  echo "    Issue #$ISSUE_NUM, comms phase — PR #$PR_NUM triage blocked"
  echo ""
  echo "  Ambiguous comments:"
  echo "$TRIAGE" | jq -r '.comments[] | select(.category == "ambiguous") | "    - \(.author): \(.body[:80])"'
  echo ""
  echo "  Your options:"
  echo "    [1] Tell me how to handle each ambiguous comment (recommended)"
  echo "    [2] Ignore ambiguous comments and continue"
  echo "    [3] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
  echo ""
  echo "  Enter a number, or describe what you want."
  exit 1
fi
```

## Step 4: Handle actionable comments

Get actionable items from triage. Promote to repair tasks (origin="comms").
Run parallel Astronaut+Flight Controller round (same as liftoff).

After all PASSed, set `COMMENT_ID=$(echo "$COMMENT" | jq -r '.id')` for each actioned comment before running the thread-resolution snippet below:
```bash
if ! git push origin "$BRANCH"; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
    "git push failed after comms fixes. Resolve the conflict then re-run /comms $ISSUE_NUM."
  echo "🚨 ABORT SEQUENCE — comms halted"
  echo ""
  echo "  Reason: git push failed after comms fixes."
  echo ""
  echo "  Where we are:"
  echo "    Issue #$ISSUE_NUM, comms phase — PR #$PR_NUM fixes committed but not pushed"
  echo ""
  echo "  Your options:"
  echo "    [1] Resolve the push conflict and re-run /comms $ISSUE_NUM (recommended)"
  echo "    [2] Abort mission (state preserved — run /mission $ISSUE_NUM to resume)"
  echo ""
  echo "  Enter a number, or describe what you want."
  exit 1
fi
PUSH_SHA=$(git rev-parse HEAD)
```

Commit format for each comms fix:
```
fix(<scope>): <name> — <fix_hint summary>

Refs #$ISSUE_NUM
Co-Authored-By: <comment.author> (via PR comment)
```

After pushing, resolve the thread for each inline comment that was actioned:
```bash
# For each actioned inline comment id:
THREAD_ID=$(echo "$THREAD_MAP" | jq -r --argjson cid "$COMMENT_ID" '.[$cid | tostring].thread_id // empty')
if [ -n "$THREAD_ID" ]; then
  gh api graphql \
    -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \
    -f tid="$THREAD_ID" > /dev/null
fi
```

## Step 5: Answer questions (with approval)

For each `category: "question"` item with a `reply_draft`, set
`COMMENT_ID=$(echo "$COMMENT" | jq -r '.id')` before running the reply or
thread-resolution snippet below:

```
Draft reply to <author>'s question:

"<reply_draft>"

Post this reply? [Y/edit/skip]
```

Wait for approval. On Y:
```bash
# For inline question comments (type == "inline_comment"), reply in-thread instead:
if [ "$(echo "$COMMENT" | jq -r '.type')" = "inline_comment" ]; then
  gh api "repos/$REPO/pulls/$PR_NUM/comments" \
    -X POST \
    -f body="<draft>" \
    -F in_reply_to="$(echo "$COMMENT" | jq -r '.id')" > /dev/null
else
  gh pr comment "$PR_NUM" --repo "$REPO" --body "<draft>"
fi
```

For inline question comments, also resolve the thread immediately after posting:
```bash
THREAD_ID=$(echo "$THREAD_MAP" | jq -r --argjson cid "$COMMENT_ID" '.[$cid | tostring].thread_id // empty')
if [ -n "$THREAD_ID" ]; then
  gh api graphql \
    -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \
    -f tid="$THREAD_ID" > /dev/null
fi
```

On edit: let user revise text, then post and resolve. On skip: move to next.

## Step 6: Re-request Copilot review

If `triage.copilot_present == true` AND commits were pushed this round:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" pr_copilot "true"
gh pr edit "$PR_NUM" --repo "$REPO" --add-reviewer Copilot 2>/dev/null || \
  echo "Note: Copilot re-request failed — re-request manually if needed."
```

## Step 7: Update last seen timestamp

```bash
MAX_AT=$(echo "$COMMENTS" | jq -r '[.[].timestamp] | max')
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" pr_last_seen_at "$MAX_AT"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"comms\",\"event\":\"round_complete\",\"fixed\":$(echo "$TRIAGE" | jq '[.comments[] | select(.category == "actionable")] | length')}"
```

## Step 8: Done check

```bash
# Re-fetch after this round's resolutions. first:100 limit — see comms-queries.md.
UPDATED_THREAD_MAP=$(gh api graphql \
  -f query='query($owner:String!,$name:String!,$number:Int!){
    repository(owner:$owner,name:$name){
      pullRequest(number:$number){
        reviewThreads(first:100){nodes{isResolved}}
      }
    }
  }' \
  -f owner="$OWNER" -f name="$REPO_NAME" -F number="$PR_NUM" \
  | jq '.data.repository.pullRequest.reviewThreads.nodes')

ALL_RESOLVED=$(echo "$UPDATED_THREAD_MAP" | jq 'length == 0 or all(.isResolved == true)')

CI_PASSING=$(gh pr checks "$PR_NUM" --repo "$REPO" --json state \
  | jq 'length == 0 or all(.state == "SUCCESS")')
```

If `ALL_RESOLVED == true` AND `CI_PASSING == true`:
```
✅ All threads resolved and CI is green.
   Run /mission $ISSUE_NUM --finish to close the mission.
```

Otherwise, print a status summary:
```
Comms round complete.
  Threads: X resolved, Y open
  CI: pass | fail | pending
  Re-run /comms $ISSUE_NUM when new comments arrive.
```

## Step 9: Optional loop-back to systems-check

If >= 3 repair tasks were fixed and committed this round:
```
We pushed 3 fixes. Want the Systems Inspector to review them before the next
reviewer cycle? [y/N]
```
If yes:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "systems-check"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
```
Immediately invoke the `mission:systems-check` skill with `$ISSUE_NUM` as the argument.
