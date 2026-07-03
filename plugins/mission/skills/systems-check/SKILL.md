---
name: systems-check
description: Use when the user wants the mission code review phase, or when /mission dispatches it. Trigger on "systems-check <N>" or "/systems-check". Thin wrapper around systems-check-workflow.js — language-bucketed Systems Inspectors review the full branch diff, repair Astronauts fix actionable findings; on exhausted rounds gives repair one bounded extra attempt autonomously, then defers remaining findings and continues without waiting on the user. Requires a plan from /pre-launch.
---

# Systems Check — Review and Repair

Run the systems-check workflow, deciding autonomously (no user prompt) when repair rounds are exhausted — one bounded extra attempt for `blocker`/`major` findings, otherwise defer and continue.

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
4. **Fable fallback.** Fable is unavailable in some environments (e.g. headless or cron runs), where spawning an agent with it hard-errors. Before launching, for any role whose resolved value is `fable`, confirm Fable is among this session's available models. If you cannot confirm it, downgrade that role — `director`→`opus`, `inspector`→`sonnet`, every other role→`sonnet` — and tell the user which roles were downgraded. Never pass `fable` to an agent you cannot confirm supports it.

The merged result is `MODELS`, passed to the workflow as `args.models`.

## Step 3: Enter the worktree

```bash
[ -d "$WORKTREE_PATH" ] || { echo "Worktree missing at $WORKTREE_PATH — re-run /pre-launch ${ISSUE_NUM}."; exit 1; }
```

Call `EnterWorktree` with `path: $WORKTREE_PATH`.

## Step 4: Inspection loop

Initialize: `SC_DEFERRED = []` (accumulates low-confidence findings), `SC_MAX_ROUNDS = 3`,
`SC_EXTENSION_USED = false`.

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

2. Reap test-runner orphans — run after every workflow return (clean, exhausted, or thrown). A killed agent shell (e.g. a Bash-tool timeout firing mid-test-run) strands the runner's fork workers as memory-eating orphans:
   ```bash
   for pid in $(pgrep -f '[v]itest|[v]ite-node|[p]laywright|[j]est' 2>/dev/null); do
     case "$(readlink /proc/$pid/cwd 2>/dev/null)" in
       "$WORKTREE_PATH"*) kill "$pid" 2>/dev/null && echo "Reaped orphaned test process $pid" ;;
     esac
   done
   ```
   Only processes rooted in this mission's worktree are killed; other sessions are untouched.

3. If `result.status === 'clean'`: break.

4. If `result.status === 'exhausted'`:
   - Summarise `result.open_findings`: `[<severity>] <file>:<line> — <summary> (<confidence>% confident)`
   - Append `result.low_confidence_findings` into `SC_DEFERRED` (dedup by file+summary).
   - Decide autonomously — no `AskUserQuestion`, no waiting:
     - If `SC_EXTENSION_USED` is `false` AND any open finding has severity `blocker` or `major`:
       give repair one bounded extra attempt. Set `SC_EXTENSION_USED = true`, `SC_MAX_ROUNDS = 3`,
       and loop.
     - Otherwise (the extension was already used, or every remaining finding is `minor`/`nit`):
       append `result.open_findings` into `SC_DEFERRED` (dedup by file+summary) and break — do not
       loop again.

   This mirrors the halt-protocol philosophy (references/halt-protocol.md): exhaustion on
   ordinary review findings is not a genuine blocker with no safe default — deferring `minor`/`nit`
   items and giving `blocker`/`major` items exactly one extra bounded attempt is the reasonable
   default. It only becomes a real halt (Step 4.1's thrown-error path) when the workflow itself
   cannot run at all.

## Step 5: Report

```
Systems check complete for issue #<N>.
Next: /docking <N>  (or /mission <N> drives it automatically)
```

If `SC_DEFERRED` is non-empty (low-confidence findings, plus anything deferred by the autonomous
exhaustion decision in Step 4), list it:
```
Findings not auto-fixed (<N>) — review manually:
  [<severity>] <file>:<line> — <summary> (<confidence>% confident)
```
