---
name: work-on
description: Use when the user wants to start working on a GitHub issue. Trigger whenever the user says "work on issue #N", "start issue N", "/work-on #N", "pick up issue N", or indicates they are about to implement a specific GitHub issue by number. Automatically loads the issue body, creates a git branch and worktree, moves the issue to In Progress on the project board, tracks checkbox progress, loops until all checklist items are complete, and does a final evaluation. Use proactively whenever an issue number appears alongside intent to implement.
allowed-tools: EnterWorktree ExitWorktree Bash(gh repo view:*) Bash(bash *move-to-in-progress.sh*)
compatibility: Requires the GitHub MCP plugin (mcp__plugin_github_github) for structured issue reads and edits. Falls back to gh CLI if unavailable. Project board operations always use gh CLI.
---

# Work On Issue

When the user wants to start working on a GitHub issue, follow these steps in order. They automate the mechanical setup so you can focus on implementation immediately.

## Environment Information

OWNER: !`gh repo view --json owner | jq -r .owner.login`
REPO: !`gh repo view --json name | jq -r .name`

## Step 0: Check GitHub MCP availability

Before proceeding, check whether `mcp__plugin_github_github__issue_read` is available in your tool list.

**If available:** use the MCP tool calls noted at each step throughout this skill. They give structured data and avoid shell auth issues.

**If not available:** inform the user:

> The GitHub MCP plugin isn't installed — it provides richer issue access via tool calls. I can still work using the `gh` CLI if you have it installed.
>
> To install the GitHub MCP plugin, run:
> ```
> claude mcp add github
> ```
>
> Would you like to install it first, or continue with the `gh` CLI fallback?

Wait for their answer. If they want to install first, stop here. Otherwise proceed using the CLI fallback noted at each step.

## Step 1: Read the issue

**MCP:** Call `mcp__plugin_github_github__issue_read` with `method: "get"`, `owner`, `repo`, and `issue_number`. This returns the issue title, body, labels, state, and comments.

**CLI fallback:**
```bash
gh issue view <number> --repo "$OWNER/$REPO" \
  --json number,title,body,labels,comments,projectItems
```

Summarize the issue in 2–3 sentences — title, what needs to be built, and any notable constraints. This gives the user confidence you've understood the scope before you start.

**Project membership:** The MCP `issue_read` response may not include GitHub Projects v2 data. To reliably get project item IDs for the board move in Step 4, use the CLI regardless of MCP availability:

```bash
gh issue view <number> --repo "$OWNER/$REPO" --json projectItems
```

Extract from `projectItems[0]`:
- `.id` → item node ID (needed in Step 4)
- `.project.number` → project number (needed in Step 4)

**Identify acceptance criteria and checkboxes:** Scan the issue body for any `- [ ]` items and any acceptance criteria stated in prose. List them explicitly before starting — these are the definition of done. If any items conflict with each other (e.g., two checkboxes requiring contradictory implementations), flag the conflict and ask how to resolve it before proceeding.

## Step 2: Create a branch and worktree

Derive a short slug from the issue title: 3–5 lowercase hyphenated words, no punctuation. Then call the `EnterWorktree` tool directly — it creates the worktree and branch automatically and switches the session into it:

- `path`: `.claude/worktrees/claude/issue-<N>-<slug>`
- `branch`: `claude/issue-<N>-<slug>` (new branch off the current HEAD)

If the worktree or branch already exists, pass the same path to `EnterWorktree` and it will reuse it. All subsequent file reads, edits, and shell commands operate inside the isolated worktree rather than the main checkout.

## Step 3: Move to "In Progress" on the project board

Run the bundled script with the item ID, project number, and owner extracted in Step 1:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/move-to-in-progress.sh" "$ITEM_ID" "$PROJECT_NUMBER" "$OWNER"
```

The script handles the field/option ID discovery, updates the project item status, and prints a confirmation. If the issue isn't on a project board or there's no "In Progress" column, it exits cleanly with a message — just relay that to the user and continue.

## Step 4: Implement, tracking progress as you go

Tell the user concisely:
- Issue title + scope summary
- The full list of checkboxes / acceptance criteria you identified (numbered for reference)
- That you've entered the worktree at `.claude/worktrees/<branch>` (the session is now scoped there)
- That the issue is now "In Progress" on the board

Then begin implementation. As you complete each checkbox item, mark it done immediately — don't batch updates until the end. Fetch the current issue body, replace the matching `- [ ]` line with `- [x]`, and push the edit back:

**MCP:** Call `mcp__plugin_github_github__issue_read` with `method: "get"` to get the current body. Update the relevant `- [ ]` line to `- [x]`. Then call `mcp__plugin_github_github__issue_write` with `method: "update"`, `issue_number`, and the updated `body`. Always re-read the body fresh before writing to avoid clobbering concurrent edits.

**CLI fallback:**
```bash
# Fetch current body fresh each time to avoid clobbering concurrent edits
BODY=$(gh issue view <number> --json body --jq '.body')

# Replace the specific unchecked item — match the exact text of the task you just completed
UPDATED=$(echo "$BODY" | sed 's/- \[ \] <exact task text>/- [x] <exact task text>/')
gh issue edit <number> --body "$UPDATED"
```

Checking items off as you go makes progress visible and creates a clear audit trail of what's been done.

## Step 5: Completion check and loop

After finishing what feels like all the work, verify nothing was missed:

**MCP:** Call `mcp__plugin_github_github__issue_read` with `method: "get"` and count `- [ ]` occurrences in the returned body.

**CLI fallback:**
```bash
gh issue view <number> --json body --jq '.body' | grep -c '- \[ \]'
```

If the count is greater than zero, there are still open items. Don't stop — read each remaining `- [ ]` item, implement what's needed, and check it off. Repeat this loop until the count reaches zero.

If a remaining item turns out to conflict with work already done (e.g., it asks for something that directly contradicts a decision already made), surface the conflict clearly to the user rather than silently skipping it or making an arbitrary choice. Describe exactly what conflicts and why, and ask for direction.

## Step 6: Final evaluation

Once all checkboxes are checked (or if there were none), step back from implementation mode and evaluate the work as if you're a reviewer seeing it for the first time:

1. **Coverage** — Re-read the original issue title and body. Does the implementation address the stated goal, not just the individual checkboxes? Sometimes the checklist is a means to an end, and you should verify the end was actually achieved.
2. **Quality** — Are there obvious gaps, missing tests, unhandled edge cases, or rough edges that should be addressed before handoff?
3. **Conflicts** — Were any acceptance criteria impossible to satisfy simultaneously? If you made a judgment call to resolve a conflict, say so explicitly so the user can decide if they agree.
4. **Summary** — List each acceptance criterion with a brief note on how it was satisfied (or why it wasn't, if there was a conflict).
5. **Next steps** — Suggest concrete next actions: open a PR, request review, add follow-up issues, etc.
