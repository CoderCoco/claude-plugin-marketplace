---
name: mission
description: Use when the user wants to start or advance the full end-to-end mission workflow for a GitHub issue. Trigger on "/mission <N>", "mission issue N", "continue mission", "/mission --status", or any signal that the user wants to orchestrate an issue through plan→build→review→PR. This is the top-level orchestrator — it runs the Flight Director interactively (asking the user any questions before committing), then hands a complete plan to the mission workflow.
---

# /mission — Interactive Planner + Workflow Dispatcher

Run the Flight Director in the current conversation (so open questions can be answered interactively), then invoke the mission workflow with a confirmed plan.

## Step 1: Parse arguments

Supported invocations:
- `/mission 42` — start or resume
- `/mission 42 --status` — show run ID and progress link
- `/mission 42 --abandon` — clear saved run ID

```bash
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"

# FLAG may be in ARG1 position (e.g. /mission --status when on a mission branch)
if [ -z "$ISSUE_NUM" ] || [[ "$ISSUE_NUM" == --* ]]; then
  FLAG="${ISSUE_NUM:-$FLAG}"
  ISSUE_NUM=""
fi

# Infer from branch name if not provided
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi

[ -n "$ISSUE_NUM" ] || { echo "Usage: /mission <issue_number> [--status|--abandon]"; exit 1; }
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

## Step 2: Handle --status

If `$FLAG == "--status"`:

```bash
RUN_ID_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}.runid"
if [ -f "$RUN_ID_FILE" ]; then
  RUN_ID=$(cat "$RUN_ID_FILE")
  echo "Mission #${ISSUE_NUM} — workflow run: ${RUN_ID}"
  echo "To resume: /mission ${ISSUE_NUM}"
  echo "View live progress with: /workflows"
else
  echo "No mission run found for issue #${ISSUE_NUM}. Run /mission ${ISSUE_NUM} to start."
fi
exit 0
```

## Step 3: Handle --abandon

If `$FLAG == "--abandon"`:

Ask: "This will clear the saved run ID for issue #${ISSUE_NUM}. The workflow journal
is preserved (you can still resume manually). Type `yes` to confirm."

On `yes`:
```bash
RUN_ID_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}.runid"
rm -f "$RUN_ID_FILE"
echo "Mission run cleared for issue #${ISSUE_NUM}."
exit 0
```

## Step 4: Look up prior run ID

```bash
mkdir -p "${CLAUDE_PLUGIN_DATA}/mission-runs"
RUN_ID_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}.runid"
PRIOR_RUN_ID=""
[ -f "$RUN_ID_FILE" ] && PRIOR_RUN_ID=$(cat "$RUN_ID_FILE")
```

## Step 5: Run the Flight Director interactively

Use the **Agent tool** (not the Workflow tool) to call the Flight Director. This runs in the current conversation context so any open questions can be answered by the user immediately.

Call the Agent tool with:
- `subagent_type`: `"mission:flight-director"`
- `prompt`: the Flight Director prompt below, substituting `ISSUE_NUM` and `REPO`

**Flight Director prompt template:**
```
You are the Flight Director. Plan the implementation for issue #<ISSUE_NUM> in repo <REPO>.

Steps:
1. Read the issue:
     gh issue view <ISSUE_NUM> --repo <REPO> --json number,title,body,labels | tr -d '\000-\010\013\014\016-\037'
2. Determine the default branch:
     BASE=$(gh repo view <REPO> --json defaultBranchRef --jq '.defaultBranchRef.name')
3. Create a branch:
     SLUG=$(echo "<issue title>" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-50 | sed 's/-$//')
     BRANCH="claude/issue-<ISSUE_NUM>-$SLUG"
     REPO_ROOT=$(git rev-parse --show-toplevel)
     git fetch origin "$BASE"
     git show-ref --verify --quiet "refs/heads/$BRANCH" || git branch "$BRANCH" "origin/$BASE"
4. Create a worktree (idempotent):
     WORKTREE="$REPO_ROOT/.claude/worktrees/issue-<ISSUE_NUM>-$SLUG"
     [ -d "$WORKTREE" ] || git worktree add "$WORKTREE" "$BRANCH"
5. Break the issue into ordered, file-scoped tasks. Assign NATO phonetic names (Alpha, Bravo…).
   Express dependencies by name in depends_on. Each task needs a one-sentence acceptance criterion.
   If anything is ambiguous, list it in open_questions instead of guessing.<ANSWERS_CTX>

Return the full structured plan including issue_title, branch, worktree_path, and tasks.
```

Use this schema for the Agent tool call:
```json
{
  "type": "object",
  "required": ["issue_title", "branch", "worktree_path", "tasks"],
  "properties": {
    "issue_title":    { "type": "string" },
    "branch":         { "type": "string" },
    "worktree_path":  { "type": "string" },
    "open_questions": { "type": "array", "items": { "type": "string" } },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "title", "files", "depends_on", "acceptance"],
        "properties": {
          "name":       { "type": "string" },
          "title":      { "type": "string" },
          "files":      { "type": "array", "items": { "type": "string" } },
          "depends_on": { "type": "array", "items": { "type": "string" } },
          "acceptance": { "type": "string" }
        }
      }
    }
  }
}
```

### Handle open_questions interactively

If the Flight Director returns `open_questions` (non-empty array):

1. Present the questions to the user. Use **AskUserQuestion** for up to 4 questions; for more, list them as a numbered message and ask for answers.
2. Wait for the user's answers.
3. Re-run the Flight Director Agent call, appending this to the prompt (replacing `<ANSWERS_CTX>`):
   ```
   
   The user has answered your open questions:
   <user's answers here>
   Proceed with the full plan — do not return any open_questions.
   ```
4. Repeat until the plan has no `open_questions`.

Once the plan is clean, present a brief summary to the user:
```
Flight plan ready — <N> tasks on <branch>:
  Alpha: <title>
  Bravo: <title>
  …
Launching mission workflow…
```

## Step 6: Invoke the mission workflow

Read the workflow script and call the Workflow tool with the confirmed plan.
Using `script:` (not `scriptPath:`) is required for `args` to be passed correctly.

```bash
WORKFLOW_SCRIPT=$(cat "${CLAUDE_PLUGIN_ROOT}/workflows/mission-workflow.js")
```

```
Workflow({
  script: "<WORKFLOW_SCRIPT>",
  resumeFromRunId: <PRIOR_RUN_ID if non-empty, otherwise omit>,
  args: {
    issue_number: <ISSUE_NUM as integer>,
    repo: "<REPO>",
    plan: <the plan object returned by the Flight Director>
  }
})
```

This call returns a `runId` (e.g. `wf_abc123`) in the tool result alongside the
workflow output. Save it immediately for future resume:

```bash
echo "<runId>" > "$RUN_ID_FILE"
```

## Step 7: Report completion

If the workflow returns successfully, print:

```
Mission complete!
  Issue: #<issue_number>
  PR: #<pr_number> — <pr_url>

Run /comms <issue_number> when PR reviews arrive.
```

Then check `low_confidence_findings` in the result. If it is non-empty, list them for the user:

```
⚠ Low-confidence findings not auto-fixed (<N> total) — review manually:

  [<severity>] <file>:<line> — <summary> (<confidence>% confident)
  …

These were skipped because the inspector was ≤50% confident they are real issues.
```

If the workflow throws an error, the error message explains what failed. The run ID
is already saved — re-run `/mission <N>` to resume from where it stopped.
