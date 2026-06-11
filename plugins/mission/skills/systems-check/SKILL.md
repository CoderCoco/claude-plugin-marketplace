---
name: systems-check
description: Use when the user wants the mission code review phase, or when /mission dispatches it. Trigger on "systems-check <N>" or "/systems-check". Thin wrapper around systems-check-workflow.js — language-bucketed Systems Inspectors review the full branch diff, repair Astronauts fix actionable findings; on exhausted rounds asks the user whether to continue, skip, or stop. Requires a plan from /pre-launch.
---

# Systems Check — Review and Repair

Run the systems-check workflow, looping interactively when repair rounds are exhausted.

## Step 1: Locate the plan

```bash
ISSUE_NUM=…   # first non-flag argument; if omitted, infer from branch: claude/issue-<N>-*
STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}"
[ -f "$STATE_DIR/plan.json" ] || { echo "No flight plan for issue #${ISSUE_NUM} — run /pre-launch ${ISSUE_NUM} first."; exit 1; }
PLAN=$(cat "$STATE_DIR/plan.json")
WORKTREE_PATH=$(echo "$PLAN" | jq -r '.worktree_path')
REPO=$(echo "$PLAN" | jq -r '.repo')
```

## Step 2: Resolve models

Built-in defaults: `director=fable`, `astronaut=sonnet`, `controller=sonnet`, `inspector=fable`, `capcom=sonnet`, `docking=sonnet`, `utility=haiku`.

1. If `.claude/mission.local.md` exists at the repo root, Read it and take any entries under `models:` in its YAML frontmatter.
2. If the invocation included `--models role=value,...`, apply those entries on top.
3. Valid roles: `director`, `astronaut`, `controller`, `inspector`, `capcom`, `docking`, `utility`. Valid values: `haiku`, `sonnet`, `opus`, `fable`. Warn about and ignore any invalid entry — never abort over one.

The merged result is `MODELS`, passed to the workflow as `args.models`.

## Step 3: Enter the worktree

```bash
[ -d "$WORKTREE_PATH" ] || { echo "Worktree missing at $WORKTREE_PATH — re-run /pre-launch ${ISSUE_NUM}."; exit 1; }
```

Call `EnterWorktree` with `path: $WORKTREE_PATH`.

## Step 4: Inspection loop

Initialize: `SC_DEFERRED = []` (accumulates low-confidence findings), `SC_MAX_ROUNDS = 3`.

**Loop:**

1. ```bash
   PRIOR=$(cat "$STATE_DIR/sc.runid" 2>/dev/null || echo "")
   ```
   Call the Workflow tool with:
   - `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/systems-check-workflow.js` (expand the env var — do NOT use import() or cat)
   - `resumeFromRunId`: `PRIOR` if non-empty (resumes an interrupted run), otherwise omit
   - `args`: `{ issue_number: <ISSUE_NUM>, repo: "<REPO>", plan: <plan.json object>, initial_deferred: <SC_DEFERRED>, max_rounds: <SC_MAX_ROUNDS>, models: <MODELS>, plugin_root: "<value of $CLAUDE_PLUGIN_ROOT>" }`

   Save the returned `runId` while the workflow runs, and clear it once the run completes (each loop iteration must start fresh):
   ```bash
   echo "<runId>" > "$STATE_DIR/sc.runid"     # before/while running
   rm -f "$STATE_DIR/sc.runid"                 # after the run returns
   ```

   If the workflow throws, present the error using the banner shape in references/halt-protocol.md — options: [1] fix the stated problem and re-run /systems-check <N>, [2] /pre-launch <N> --replan if the plan itself is wrong.

2. If `result.status === 'clean'`: break.

3. If `result.status === 'exhausted'`:
   - Summarise `result.open_findings`: `[<severity>] <file>:<line> — <summary> (<confidence>% confident)`
   - AskUserQuestion: **Try more rounds** / **Skip and continue** / **Stop**.
   - Try more rounds → ask how many (default 3), set `SC_MAX_ROUNDS`, append `result.low_confidence_findings` into `SC_DEFERRED` (dedup by file+summary), loop.
   - Skip and continue → break; note the open findings need manual attention.
   - Stop → report the open findings and exit without advancing.

## Step 5: Report

```
Systems check complete for issue #<N>.
Next: /docking <N>  (or /mission <N> drives it automatically)
```

If the final result carried `low_confidence_findings`, list them:
```
Low-confidence findings not auto-fixed (<N>) — review manually:
  [<severity>] <file>:<line> — <summary> (<confidence>% confident)
```
