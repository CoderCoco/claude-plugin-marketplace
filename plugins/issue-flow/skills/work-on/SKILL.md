---
name: work-on
description: Use when the user wants to start working on a GitHub issue. Trigger whenever the user says "work on issue #N", "start issue N", "/work-on #N", "pick up issue N", or indicates they are about to implement a specific GitHub issue by number. Automatically loads the issue body, creates a git branch and worktree, and moves the issue to In Progress on the project board. Use proactively whenever an issue number appears alongside intent to implement.
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

## Step 5: Confirm and start

Tell the user concisely:
- Issue title + scope summary
- Worktree path (`.worktrees/<branch>`)
- That the issue is now "In Progress" on the board

Then immediately lay out your first 2–3 implementation steps and begin.
