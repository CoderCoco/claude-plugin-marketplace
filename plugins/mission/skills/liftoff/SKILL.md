---
name: liftoff
description: Use when the user wants to build the planned tasks for a mission issue, or when /mission dispatches the build phase. Trigger on "liftoff <N>" or "/liftoff". Thin wrapper around liftoff-workflow.js — Astronauts implement tasks in dependency rounds, Flight Controllers verify, commits land in the worktree. Requires a plan from /pre-launch.
---

# Liftoff — Build

Run the liftoff workflow against the persisted flight plan.

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

## Step 4: Run the workflow

```bash
PRIOR=$(cat "$STATE_DIR/liftoff.runid" 2>/dev/null || echo "")
```

Call the Workflow tool with:
- `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/liftoff-workflow.js` (expand the env var — do NOT use import() or cat)
- `resumeFromRunId`: value of `PRIOR` if non-empty, otherwise omit the field entirely
- `args`: `{ issue_number: <ISSUE_NUM>, repo: "<REPO>", plan: <plan.json object>, models: <MODELS>, plugin_root: "<value of $CLAUDE_PLUGIN_ROOT>" }`

Save the returned `runId`:
```bash
echo "<runId>" > "$STATE_DIR/liftoff.runid"
```

If the workflow throws, present the error using the banner shape in `references/halt-protocol.md` — reason from the error message, where-we-are = "issue #N, liftoff", options: [1] fix the stated problem and re-run `/liftoff <N>` (resumes from the saved runId), [2] `/pre-launch <N> --replan` if the plan itself is wrong.

## Step 5: Report

```
All tasks committed — liftoff complete for issue #<N>.
Next: /systems-check <N>  (or /mission <N> drives it automatically)
```
