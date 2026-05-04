---
name: open-pr
description: Use when the user is ready to put up a pull request for an issue they've been implementing — typically work started via the issue-flow:work-on skill. Trigger whenever the user says "open the PR", "raise a PR", "ship it", "/open-pr", "create a PR for this issue", or otherwise signals that implementation is done and the next step is a pull request. Verifies the issue's checklist is actually complete, discovers any PR conventions present in the current repo (templates, CLAUDE.md notes, sibling PR skills), opens a ready-for-review PR that uses the right closing keyword so GitHub auto-closes the issue on merge, and moves the project card to "In Review" when that column exists. Use proactively whenever a user wraps up work on an issue branch.
---

# Open PR

When the user is ready to put up a pull request for an issue they've been working on (typically via the `work-on` skill in this plugin), follow the steps below. The goal is to verify the work is actually done, build a PR body that fits the host repo's conventions, and link the PR back to the issue so GitHub auto-closes it on merge.

This skill is designed to run in **any repo**, not just the marketplace it ships from. Don't hard-code conventions — discover them per-run from the working directory.

## Step 1: Identify the issue and branch

The issue number can come from three places, in order of preference:

1. **The current branch.** `work-on` creates branches named `claude/issue-<N>-<slug>`. Match that pattern first.
   ```bash
   BRANCH=$(git branch --show-current)
   ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
   ```
2. **The conversation context.** If the branch name doesn't carry a number, scan recent messages — the issue you've been implementing in this session is almost certainly the one to close.
3. **Ask the user.** Only if the first two fail: "Which issue does this PR close?"

Also capture the base branch — the branch you'll target on the PR:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null | sed 's|^origin/||')
BASE=${BASE:-main}
```

If you're operating inside a worktree at `.worktrees/...`, that's expected — stay there.

## Step 2: Verify the work is actually done

A PR is a public artifact and a request for someone else's time, so don't open one if the issue says the work isn't finished. Check both the issue checklist and the local git state.

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
gh issue view "$ISSUE_NUM" --repo "$REPO" --json title,body,projectItems
```

Capture the title, the project item ID and project number (you'll need them in Step 6), and count remaining unchecked items:

```bash
REMAINING=$(gh issue view "$ISSUE_NUM" --repo "$REPO" --json body --jq '.body' | grep -c '^- \[ \]' || true)
```

Then check the working tree:

```bash
git status --porcelain
```

If the only entries are filemode flips (e.g., `100644 → 100755`), that's WSL/Windows-mount noise rather than a real edit — it's safe to ignore (or run `git config core.fileMode false` on the repo) and treat the tree as clean. Anything else counts as dirty.

**If `REMAINING > 0` or there are real uncommitted changes, stop and tell the user how to proceed.** Do not silently commit, do not auto-tick boxes, and do not push. Surface the situation plainly and ask which path forward they want — for example:

> Issue #N still has 3 unchecked items:
> - [ ] Add error handling for empty input
> - [ ] Update README with usage example
> - [ ] Add tests for the retry path
>
> And there are uncommitted changes in `src/foo.ts`, `tests/foo.test.ts`.
>
> How would you like to proceed?
> 1. Finish the remaining items first (recommended).
> 2. Move them to a follow-up issue and open this PR now.
> 3. Open the PR anyway with a "known follow-ups" section in the body.
>
> If you want me to commit the staged changes first, say so explicitly — I won't commit without confirmation.

Wait for direction. Don't proceed until the user picks an option, because guessing here usually creates more cleanup than it saves.

## Step 3: Discover this repo's PR conventions

The skill might run in any repository, so prefer what already exists over imposing a template. Look in this order and use the **first** match as the source of structure:

1. **GitHub PR template files**, in order:
   - `.github/PULL_REQUEST_TEMPLATE.md`
   - `.github/pull_request_template.md`
   - `.github/PULL_REQUEST_TEMPLATE/*.md` (if there are multiple, ask which to use)
   - `docs/PULL_REQUEST_TEMPLATE.md`
2. **Project memory.** Skim `CLAUDE.md` and any `.claude/CLAUDE.md` for a section like "PR style", "Pull request format", or "How we write PRs".
3. **Sibling skills.** Check the skills already available in the current session for one that documents PR creation (names like `commit-and-pr`, `finishing-a-development-branch`, `commit-push-pr` are common). If a relevant one exists, borrow its body structure — don't delegate to it; this skill has extra responsibilities (issue verification, closing keyword, project board move) that those skills don't cover.
4. **Recent PR history.** As a last signal, peek at the last few merged PRs to see how they're structured:
   ```bash
   gh pr list --state merged --limit 3 --json title,body
   ```
   If they share a clear pattern, mirror it. If they don't, move on.
5. **Fallback.** If nothing matches, use the default body in Step 5.

When you pick a source, mention it in one line so the user can override before you push.

## Step 4: Push the branch

```bash
git push -u origin "$BRANCH"
```

If push fails because of upstream divergence, hooks, or auth, surface the error verbatim and stop. Don't `--force` and don't bypass hooks unless the user explicitly asks — these failures usually mean something real is wrong.

## Step 5: Open the PR

Build the title from the issue title. Trim to under 70 characters; drop any noisy `[area]` prefix only if the host repo's recent PRs don't use that style.

For the body, fill the convention discovered in Step 3. If you fell through to the fallback, use:

```markdown
## Summary
<2–4 bullets describing the change at a meaningful level — not a file-by-file diff>

## Linked issue
Closes #<N>

## Implementation notes
<Anything a reviewer would want to know that isn't obvious from the diff: trade-offs taken, follow-ups deferred, decisions made when checklist items conflicted.>

## Test plan
- [ ] <How a reviewer can verify the change works>
- [ ] <Any manual steps needed>
```

**Always include a closing keyword** that links the PR to the issue — `Closes #N`, `Fixes #N`, or `Resolves #N`. Pick whichever one the repo's recent PRs use; if there's no clear preference, use `Closes`. This is what makes GitHub auto-close the issue when the PR merges — without it, the link is decorative.

Open ready-for-review (no `--draft`) by default:

```bash
gh pr create \
  --base "$BASE" \
  --head "$BRANCH" \
  --title "$TITLE" \
  --body "$(cat <<'EOF'
<filled body>
EOF
)"
```

Capture the PR URL from the command output — you'll cite it in the summary.

## Step 6: Move the project card to "In Review"

Mirror the field-discovery pattern from `work-on` Step 4. Reuse the item ID and project number captured in Step 2.

```bash
ITEM_ID=<from projectItems[0].id>
PROJECT_NUMBER=<from projectItems[0].project.number>
REPO_OWNER=$(gh repo view --json owner --jq '.owner.login')

FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json)
STATUS_FIELD_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .id')
IN_REVIEW_ID=$(echo "$FIELD_JSON" | jq -r '.fields[] | select(.name == "Status") | .options[] | select(.name == "In Review") | .id')

if [ -n "$IN_REVIEW_ID" ]; then
  gh project item-edit \
    --id "$ITEM_ID" \
    --project-id "$PROJECT_NUMBER" \
    --field-id "$STATUS_FIELD_ID" \
    --single-select-option-id "$IN_REVIEW_ID"
fi
```

If `IN_REVIEW_ID` is empty (the board has no such column) or the issue isn't on a project board at all, mention that you skipped the move and continue. Don't invent a column or fall back to a different status without telling the user.

## Step 7: Summarize

Tell the user, in order:

1. PR URL.
2. Issue number and the closing keyword used (so they can confirm it'll auto-close on merge).
3. Project board move — "In Review", or skipped if the column wasn't present.
4. Any follow-up items the user opted to defer in Step 2, with links if you opened them as new issues.

Keep it short — four lines is plenty. The PR itself is the artifact; this is just the receipt.
