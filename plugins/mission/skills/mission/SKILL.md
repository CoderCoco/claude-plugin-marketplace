---
name: mission
description: Use when the user wants to start or advance the full end-to-end mission workflow for a GitHub issue. Trigger on "/mission <N>", "mission issue N", "continue mission", "/mission --status", or any signal that the user wants to orchestrate an issue through plan→build→review→PR. This is the top-level orchestrator — it resolves the issue number, looks up any prior run ID for resumability, and invokes the mission workflow.
---

# /mission — Workflow Dispatcher

Resolve the issue number, find any prior run, and invoke (or resume) the mission
workflow. The workflow runs start-to-finish and produces a valid PR.

## Step 1: Parse arguments

Supported invocations:
- `/mission 42` — start or resume
- `/mission 42 --status` — show run ID and progress link
- `/mission 42 --abandon` — clear saved run ID
- `/mission 42 --answers "answer 1; answer 2"` — re-run with answers to Flight Director questions

```bash
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"
ANSWERS="${ARG3:-}"

# FLAG may be in ARG1 position (e.g. /mission --status when on a mission branch)
if [ -z "$ISSUE_NUM" ] || [[ "$ISSUE_NUM" == --* ]]; then
  FLAG="${ISSUE_NUM:-$FLAG}"
  ISSUE_NUM=""
fi

# --answers "..." may be the only extra arg: /mission 42 --answers "..."
if [[ "$FLAG" == --answers ]]; then
  ANSWERS="$ANSWERS"  # ARG3 already holds the value
elif [[ "$FLAG" == --answers=* ]]; then
  ANSWERS="${FLAG#--answers=}"
  FLAG=""
fi

# Infer from branch name if not provided
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi

[ -n "$ISSUE_NUM" ] || { echo "Usage: /mission <issue_number> [--status|--abandon|--answers \"...\"]"; exit 1; }
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

## Step 5: Invoke the mission workflow

Read the workflow script and call the Workflow tool with it inline.
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
    answers: "<ANSWERS if non-empty, otherwise omit>"
  }
})
```

**When to omit `resumeFromRunId`:** If `--answers` was passed and a prior run ID
exists, still resume — the changed FD prompt causes a cache miss on that agent
alone, so the Flight Director re-runs with the answers while all other completed
agents return instantly from cache.

This call returns a `runId` (e.g. `wf_abc123`) in the tool result alongside the
workflow output. Save it immediately for future resume:

```bash
echo "<runId>" > "$RUN_ID_FILE"
```

## Step 6: Report completion

If the workflow returns successfully, print:

```
Mission complete!
  Issue: #<issue_number>
  PR: #<pr_number> — <pr_url>

Run /comms <issue_number> when PR reviews arrive.
```

If the workflow throws an error, the error message explains what failed. The run ID
is already saved — re-run `/mission <N>` to resume from where it stopped.
