---
name: docking
description: Use when the mission branch is ready for a pull request, or when /mission dispatches the PR phase. Trigger on "docking <N>" or "/docking". Thin wrapper around docking-workflow.js — pushes the branch, opens a PR with Closes #N, moves the project board card, then offers a comms watcher. Requires a plan from /pre-launch.
---

# Docking — Open the PR

Run the docking workflow, then offer comment watching.

## Step 1: Locate the plan

```bash
ISSUE_NUM=…   # first non-flag argument; if omitted, infer from branch: claude/issue-<N>-*
STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}"
[ -f "$STATE_DIR/plan.json" ] || { echo "No flight plan for issue #${ISSUE_NUM} — run /pre-launch ${ISSUE_NUM} first."; exit 1; }
PLAN=$(cat "$STATE_DIR/plan.json")
REPO=$(echo "$PLAN" | jq -r '.repo')
```

## Step 2: Resolve models

Built-in defaults: `director=fable`, `astronaut=sonnet`, `controller=sonnet`, `inspector=fable`, `capcom=sonnet`, `docking=sonnet`, `utility=haiku`.

1. If `.claude/mission.local.md` exists at the repo root, Read it and take any entries under `models:` in its YAML frontmatter.
2. If the invocation included `--models role=value,...`, apply those entries on top.
3. Valid roles: `director`, `astronaut`, `controller`, `inspector`, `capcom`, `docking`, `utility`. Valid values: `haiku`, `sonnet`, `opus`, `fable`. Warn about and ignore any invalid entry — never abort over one.
4. **Fable fallback.** Fable is unavailable in some environments (e.g. headless or cron runs), where spawning an agent with it hard-errors. Before launching, for any role whose resolved value is `fable`, confirm Fable is among this session's available models. If you cannot confirm it, downgrade that role — `director`→`opus`, `inspector`→`sonnet`, every other role→`sonnet` — and tell the user which roles were downgraded. Never pass `fable` to an agent you cannot confirm supports it.

The merged result is `MODELS`, passed to the workflow as `args.models`.

## Step 3: Run the workflow

```bash
PRIOR=$(cat "$STATE_DIR/docking.runid" 2>/dev/null || echo "")
```

Call the Workflow tool with:
- `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/docking-workflow.js` (expand the env var — do NOT use import() or cat)
- `resumeFromRunId`: `PRIOR` if non-empty, otherwise omit
- `args`: `{ issue_number: <ISSUE_NUM>, repo: "<REPO>", plan: <plan.json object>, models: <MODELS>, plugin_root: "<value of $CLAUDE_PLUGIN_ROOT>" }`

Save the returned `runId`, and persist the PR so the rest of the mission flow
(`/mission --status`, `/comms`) knows it:
```bash
echo "<runId>" > "$STATE_DIR/docking.runid"
echo "{\"pr_number\":<pr_number>,\"pr_url\":\"<pr_url>\"}" > "$STATE_DIR/pr.json"
```

If the workflow throws (push conflict, gh auth), present the error using the banner shape in `references/halt-protocol.md` with options: [1] fix the stated problem and re-run `/docking <N>`, [2] open the PR manually then re-run.

## Step 4: Report and offer the watcher

```
🚀 Docking complete! PR #<pr_number> is open: <pr_url>

Want me to watch for PR comments automatically?
  /loop 5m /comms <pr_number>              — poll every 5 minutes in this session
  /schedule "Run /comms <pr_number>" --every 30m — scheduled background check
Or just run /comms <pr_number> manually when reviews arrive.
```
