---
name: work-on
description: Use when the user wants to start working on a GitHub issue. Trigger whenever the user says "work on issue #N", "start issue N", "/work-on #N", "pick up issue N", or indicates they are about to implement a specific GitHub issue by number. Automatically loads the issue body, creates a git branch and worktree, moves the issue to In Progress on the project board, tracks checkbox progress, loops until all checklist items are complete, and does a final evaluation. Use proactively whenever an issue number appears alongside intent to implement.
---

# Work On Issue

When the user wants to start working on a GitHub issue, follow these steps in order. They automate the mechanical setup so you can focus on implementation immediately.

## Step 1: Extract the issue number

Parse the issue number from the user's message. If it's ambiguous or missing, ask: "Which issue number?"

## Step 2: Read the issue (and discover its project membership)

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
gh issue view <number> --repo "$REPO" \
  --json number,title,body,labels,comments,projectItems
```

Summarize the issue in 2–3 sentences — title, what needs to be built, and any notable constraints. This gives the user confidence you've understood the scope before you start.

Also extract the project info from `projectItems[0]` — you'll need it in Step 4:
- `projectItems[0].id` → the item's node ID
- `projectItems[0].project.number` → the project number

**Identify acceptance criteria and checkboxes:** Scan the issue body for any `- [ ]` items and any acceptance criteria stated in prose. List them explicitly before starting — these are the definition of done. If any items conflict with each other (e.g., two checkboxes that would require contradictory implementations), flag the conflict to the user immediately and ask how to resolve it before proceeding.

## Step 3: Create a branch and worktree

Derive a short slug from the issue title: 3–5 lowercase hyphenated words, no punctuation. Then:

```bash
ISSUE_NUM=<number>
SLUG=<derived-slug>
BRANCH="claude/issue-${ISSUE_NUM}-${SLUG}"

git worktree add ".worktrees/${BRANCH}" -b "${BRANCH}"
```

If the worktree or branch already exists, note it and reuse it — don't error out. The `.worktrees/` directory should be gitignored; add it if it isn't.

## Step 4: Move to "In Progress" on the project board

Using the item ID and project number extracted in Step 2, discover the field and option IDs dynamically:

```bash
ITEM_ID=<from projectItems[0].id>
PROJECT_NUMBER=<from projectItems[0].project.number>
REPO_OWNER=$(gh repo view --json owner --jq '.owner.login')

# Discover the Status field ID and "In Progress" option ID
FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json)
STATUS_FIELD_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .id')
IN_PROGRESS_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .options[] | select(.name == "In Progress") | .id')

# Update the status
gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_NUMBER" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$IN_PROGRESS_ID"
```

If `ITEM_ID` or `PROJECT_NUMBER` is empty, the issue isn't on any project board — mention it and continue.

## Step 5: Implement, tracking progress as you go

Tell the user concisely:
- Issue title + scope summary
- The full list of checkboxes / acceptance criteria you identified (numbered for reference)
- Worktree path (`.worktrees/<branch>`)
- That the issue is now "In Progress" on the board

Then begin implementation. As you complete each checkbox item, mark it done immediately — don't batch updates until the end. Fetch the current issue body, replace the matching `- [ ]` line with `- [x]`, and push the edit back:

```bash
# Fetch current body (do this fresh each time to avoid clobbering concurrent edits)
BODY=$(gh issue view <number> --json body --jq '.body')

# Replace the specific unchecked item — match the exact text of the task you just completed
UPDATED=$(echo "$BODY" | sed 's/- \[ \] <exact task text>/- [x] <exact task text>/')
gh issue edit <number> --body "$UPDATED"
```

Checking items off as you go makes progress visible and creates a clear audit trail of what's been done.

## Step 6: Completion check and loop

After finishing what feels like all the work, verify nothing was missed:

```bash
gh issue view <number> --json body --jq '.body' | grep -c '- \[ \]'
```

If the count is greater than zero, there are still open items. Don't stop — read each remaining `- [ ]` item, implement what's needed, and check it off. Repeat this loop until the count reaches zero.

If a remaining item turns out to conflict with work already done (e.g., it asks for something that directly contradicts a decision already made), surface the conflict clearly to the user rather than silently skipping it or making an arbitrary choice. Describe exactly what conflicts and why, and ask for direction.

## Step 7: Final evaluation

Once all checkboxes are checked (or if there were none), step back from implementation mode and evaluate the work as if you're a reviewer seeing it for the first time:

1. **Coverage** — Re-read the original issue title and body. Does the implementation address the stated goal, not just the individual checkboxes? Sometimes the checklist is a means to an end, and you should verify the end was actually achieved.
2. **Quality** — Are there obvious gaps, missing tests, unhandled edge cases, or rough edges that should be addressed before handoff?
3. **Conflicts** — Were any acceptance criteria impossible to satisfy simultaneously? If you made a judgment call to resolve a conflict, say so explicitly so the user can decide if they agree.
4. **Summary** — List each acceptance criterion with a brief note on how it was satisfied (or why it wasn't, if there was a conflict).
5. **Next steps** — Suggest concrete next actions: open a PR, request review, add follow-up issues, etc.
