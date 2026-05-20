---
name: swarm-exec
description: Harness-driven alternative to /swarm. A Python executor drives the Navigator→Crewmate→Quartermaster loop via claude -p subprocesses, keeping the main agent context flat. Same triggers as /swarm — use when token cost or reliability is a concern. Trigger on "swarm-exec issue #N", "/swarm-exec N", "harness swarm N".
allowed-tools: Bash(git:*) Bash(gh:*) Bash(bash *swarm/scripts/*) Bash(bash *swarm-exec/scripts/*) Bash(python3 *) Read
---

# Swarm-Exec

The Captain bootstraps the voyage, then Python drives the crew. The main agent's context stays flat — all orchestration happens in the executor subprocess.

## Environment

OWNER: !`gh repo view --json owner | jq -r .owner.login`
REPO: !`gh repo view --json name | jq -r .name`

`CLAUDE_SKILL_DIR` points at this skill's directory (`skills/swarm-exec/`).
Shared bash helpers live at `${CLAUDE_SKILL_DIR}/../swarm/scripts/`.

## Step 0: Find the issue number

Argument to the skill is the issue number. Strip any `#` or `gh-` prefix. If no argument:

1. Check the current branch — if it matches `claude/issue-<N>-`, use that N.
2. Else ask the user: "Which issue should the crew set sail on?"

Stop here if ye still don't have a number.

## Step 1: Read the issue

Prefer the GitHub MCP if available:

- Call `mcp__plugin_github_github__issue_read` with `method: "get"`, `owner`, `repo`, and `issue_number`.

CLI fallback:

```bash
gh issue view <N> --repo "$OWNER/$REPO" --json number,title,body,labels,projectItems
```

Capture `projectItems[0].id` and `projectItems[0].project.number` for Step 3. Save the issue body to a file:

```bash
BODY_FILE="${CLAUDE_PLUGIN_DATA}/swarm/${OWNER}/${REPO}/issue-${N}-body.txt"
mkdir -p "$(dirname "$BODY_FILE")"
gh issue view <N> --repo "$OWNER/$REPO" --json body --jq '.body' > "$BODY_FILE"
```

## Step 2: Create the worktree (off fresh origin default branch)

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null | sed 's|^origin/||')
```

If `$DEFAULT_BRANCH` is empty, HALT and surface the same error message as `/swarm` Step 2.

```bash
git fetch origin "$DEFAULT_BRANCH"
SLUG="<derived 3-5 word lowercase hyphenated slug from issue title>"
BRANCH="claude/issue-<N>-${SLUG}"
WORKTREE_PATH=".claude/worktrees/${BRANCH}"

if git show-ref --quiet "refs/heads/$BRANCH"; then
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  git worktree add -b "$BRANCH" "$WORKTREE_PATH" "origin/$DEFAULT_BRANCH"
fi
```

Note: no `EnterWorktree` call — the Python executor runs agents with `cwd=worktree_path` directly.

## Step 3: Move the issue to "In Progress"

```bash
bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/move-to-in-progress.sh" "$ITEM_ID" "$PROJECT_NUMBER" "$OWNER"
```

Same exit code semantics as `/swarm` Step 3.

## Step 4: Initialise state

```bash
STATE=$(bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/init-state.sh" \
  <N> "$OWNER/$REPO" "<issue title>" "$BRANCH")
```

Exit code 2 means the state file already exists — resume flow. Read `$STATE` and tell the user: "Resumin' voyage on issue #N. Phase: <phase>."

## Step 5: Launch the executor

```bash
SWARM_SCRIPTS="${CLAUDE_SKILL_DIR}/../swarm/scripts"
python3 "${CLAUDE_SKILL_DIR}/scripts/swarm_executor.py" \
  --state "$STATE" \
  --worktree "$WORKTREE_PATH" \
  --owner "$OWNER" \
  --repo "$REPO" \
  --issue <N> \
  --swarm-scripts "$SWARM_SCRIPTS" \
  --issue-body-file "$BODY_FILE"
```

Block on this call. Do not interact with the executor unless it prompts you (open questions, escalation). When it exits 0, proceed to Step 6.

On non-zero exit: surface stderr verbatim and stop. Do not retry automatically.

## Step 6: Print the voyage log

```bash
bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/print-voyage-log.sh" "$STATE"
```

Then grab the markdown version and paste it verbatim in your reply:

```bash
bash "${CLAUDE_SKILL_DIR}/../swarm/scripts/print-voyage-log.sh" --md "$STATE"
```

After the table, tell the user what to do next — typically `/open-pr` to ship.
