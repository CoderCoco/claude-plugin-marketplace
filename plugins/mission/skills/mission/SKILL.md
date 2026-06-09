---
name: mission
description: Use when the user wants to start or advance the full end-to-end mission workflow for a GitHub issue. Trigger on "/mission <N>", "mission issue N", "continue mission", "/mission --status", or any signal that the user wants to orchestrate an issue through plan→build→review→PR. This is the top-level orchestrator — it runs the Flight Director interactively (asking the user any questions before committing), then drives three focused workflows (Liftoff, Systems Check, Docking) with interactive pauses between phases where needed.
---

# /mission — Interactive Orchestrator

Run the Flight Director in the current conversation so open questions can be answered interactively, then drive three focused workflows to completion. Each workflow does one job and returns — the skill owns all user interaction between phases.

## Step 1: Parse arguments

Supported invocations:
- `/mission 42` — start or resume
- `/mission 42 --status` — show phase run IDs and current position
- `/mission 42 --abandon` — clear all saved state for this issue

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
mkdir -p "${CLAUDE_PLUGIN_DATA}/mission-runs"
STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}"
mkdir -p "$STATE_DIR"
```

## Step 2: Handle --status

If `$FLAG == "--status"`:

```bash
echo "Mission #${ISSUE_NUM} phases:"
for phase in liftoff sc docking; do
  FILE="$STATE_DIR/${phase}.runid"
  [ -f "$FILE" ] && echo "  ${phase}: $(cat $FILE)" || echo "  ${phase}: not started"
done
```
Exit.

## Step 3: Handle --abandon

If `$FLAG == "--abandon"`:

Ask: "This will clear all saved state for issue #${ISSUE_NUM}. Type `yes` to confirm."

On `yes`:
```bash
rm -rf "$STATE_DIR"
echo "Mission state cleared for issue #${ISSUE_NUM}."
```
Exit.

## Step 4: Run the Flight Director interactively

Use the **Agent tool** (not the Workflow tool) to call the Flight Director. This runs in the current conversation context so any open questions can be answered by the user immediately.

Call the Agent tool with:
- `subagent_type`: `"mission:flight-director"`
- `prompt`: the Flight Director prompt below (substitute `ISSUE_NUM` and `REPO`)

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
5. Break the issue into ordered, file-scoped tasks. Assign crew names from the 52-name roster in
   references/crew-roster.md (Apollo, Borman, Cassini…), starting at index 0.
   List tasks in execution order — first every task with depends_on: [], then tasks whose
   dependencies all appear earlier in the list — and assign roster names in that listed order,
   so tasks that launch in parallel hold consecutive names.
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

1. Present the questions to the user. Use **AskUserQuestion** for up to 4 questions; for more, list them as a numbered message.
2. Wait for the user's answers.
3. Re-run the Flight Director Agent call, appending to the prompt (replacing `<ANSWERS_CTX>`):
   ```
   
   The user has answered your open questions:
   <user's answers>
   Proceed with the full plan — do not return any open_questions.
   ```
4. Repeat until the plan has no `open_questions`.

Once clean, show the user a brief summary:
```
Flight plan ready — <N> tasks on <branch>:
  Apollo: <title>
  Borman: <title>
  …
```

## Step 5: Liftoff workflow

```bash
PRIOR_LIFTOFF=$(cat "$STATE_DIR/liftoff.runid" 2>/dev/null || echo "")
```

Call the Workflow tool with:
- `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/liftoff-workflow.js` (expand the env var — do NOT use import() or cat)
- `resumeFromRunId`: value of `PRIOR_LIFTOFF` if non-empty, otherwise omit the field entirely
- `args`: `{ issue_number: <ISSUE_NUM>, repo: "<REPO>", plan: <plan object> }`

Save the returned `runId`:
```bash
echo "<runId>" > "$STATE_DIR/liftoff.runid"
```

## Step 6: Systems Check workflow — with interactive pause on exhaustion

Run the Systems Check workflow and handle the result interactively. Repeat until the user is satisfied or the check comes back clean.

Initialize before the loop:
- `SC_DEFERRED = []` — accumulates low-confidence findings across SC runs
- `SC_MAX_ROUNDS = 3`

**Loop:**

1. Invoke the Systems Check workflow using the Workflow tool with:
   - `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/systems-check-workflow.js` (expand the env var — do NOT use import() or cat)
   - `resumeFromRunId`: prior SC runId if it exists, otherwise omit
   - `args`: `{ issue_number: <ISSUE_NUM>, repo: "<REPO>", plan: <plan object>, initial_deferred: <SC_DEFERRED>, max_rounds: <SC_MAX_ROUNDS> }`
   Save the returned `runId`:
   ```bash
   echo "<runId>" > "$STATE_DIR/sc.runid"
   ```
   Clear the prior SC runId after use (next iteration needs a fresh run):
   ```bash
   rm -f "$STATE_DIR/sc.runid"
   ```

2. If `result.status === 'clean'`: break out of the loop.

3. If `result.status === 'exhausted'`:
   - Format a summary of `result.open_findings`:
     ```
     [<severity>] <file>:<line> — <summary> (<confidence>% confident)
     ```
   - Use **AskUserQuestion** to ask the user what to do:
     - **"Try more rounds"** — attempt additional repair rounds
     - **"Skip and open PR"** — accept the open findings and proceed to Docking
     - **"Stop"** — abandon the mission without opening a PR

   - If **Try more rounds**: ask how many additional rounds (default 3). Set `SC_MAX_ROUNDS = <answer>`. Append `result.low_confidence_findings` into `SC_DEFERRED` (dedup by file+summary). Loop back to step 1 with a fresh SC invocation.
   - If **Skip and open PR**: break out of the loop. Note to the user that the open findings will need manual attention after the PR is opened.
   - If **Stop**: report the open findings and exit without opening a PR.

After the loop, collect all deferred low-confidence findings from the final SC result.

## Step 7: Docking workflow

```bash
PRIOR_DOCKING=$(cat "$STATE_DIR/docking.runid" 2>/dev/null || echo "")
```

Call the Workflow tool with:
- `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/docking-workflow.js` (expand the env var — do NOT use import() or cat)
- `resumeFromRunId`: value of `PRIOR_DOCKING` if non-empty, otherwise omit the field entirely
- `args`: `{ issue_number: <ISSUE_NUM>, repo: "<REPO>", plan: <plan object> }`

Save the returned `runId`:
```bash
echo "<runId>" > "$STATE_DIR/docking.runid"
```

## Step 8: Report completion

Print:
```
Mission complete!
  Issue:  #<issue_number>
  Branch: <branch>
  PR:     #<pr_number> — <pr_url>

Run /comms <issue_number> when PR reviews arrive.
```

If there are low-confidence findings that were deferred, list them:
```
Low-confidence findings not auto-fixed (<N> total) — review manually:

  [<severity>] <file>:<line> — <summary> (<confidence>% confident)
  …

These were skipped because the inspector was ≤50% confident they are real issues.
```

If any open findings were skipped by user choice, list those separately:
```
Open findings skipped at your request — address manually or in a follow-up PR:

  [<severity>] <file>:<line> — <summary> (<confidence>% confident)
  …
```
