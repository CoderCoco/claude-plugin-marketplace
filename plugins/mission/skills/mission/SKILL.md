---
name: mission
description: Use when the user wants to start or advance the full end-to-end mission workflow for a GitHub issue. Trigger on "/mission <N>", "mission issue N", "continue mission", "/mission --status", or any signal that the user wants to orchestrate an issue through plan→build→review→PR. Top-level orchestrator — invokes the pre-launch, liftoff, systems-check, and docking skills in order; each phase skill owns its own user interaction and workflow.
---

# /mission — Orchestrator

Drive the four phase skills in order. Each phase is resumable: planning persists `plan.json`; the build/review/PR workflows persist runIds. Re-running `/mission <N>` after an interruption picks up where it left off.

## Step 1: Parse arguments

Supported invocations:
- `/mission 42` — start or resume
- `/mission 42 --status` — show saved state; no action
- `/mission 42 --abandon` — clear all saved state for this issue
- `/mission 42 --replan` — passed through to pre-launch
- `/mission 42 --models director=opus,inspector=opus` — model overrides, passed through to every phase

```bash
ISSUE_NUM=…   # first non-flag argument; if omitted, infer from branch: claude/issue-<N>-*
[ -n "$ISSUE_NUM" ] || { echo "Usage: /mission <issue_number> [--status|--abandon|--replan] [--models …]"; exit 1; }
STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}"
mkdir -p "$STATE_DIR"
```

## Step 2: Handle --status

```bash
echo "Mission #${ISSUE_NUM}:"
[ -f "$STATE_DIR/plan.json" ] \
  && jq -r '"  plan: \(.tasks|length) task(s) on \(.branch)"' "$STATE_DIR/plan.json" \
  || echo "  plan: not created (run /pre-launch ${ISSUE_NUM})"
for phase in liftoff sc docking; do
  FILE="$STATE_DIR/${phase}.runid"
  [ -f "$FILE" ] && echo "  ${phase}: $(cat "$FILE")" || echo "  ${phase}: not started"
done
[ -f "$STATE_DIR/pr.json" ] \
  && jq -r '"  PR: #\(.pr_number) — \(.pr_url)"' "$STATE_DIR/pr.json"
[ -f "$STATE_DIR/comms-state.json" ] \
  && echo "  comms last seen: $(jq -r '.last_seen_at' "$STATE_DIR/comms-state.json")"
```
Exit.

## Step 3: Handle --abandon

Ask: "This will clear all saved state for issue #${ISSUE_NUM} (plan, workflow resume points, comms history). Type `yes` to confirm."

On `yes`:
```bash
rm -rf "$STATE_DIR"
echo "Mission state cleared for issue #${ISSUE_NUM}."
```
Exit.

## Step 4: Plan

Invoke the **Skill tool** with `skill: "mission:pre-launch"` and args `"<ISSUE_NUM>"` plus any `--replan` / `--models …` flags from this invocation. Pre-launch is a no-op when a confirmed plan already exists.

When it returns, confirm the plan landed:
```bash
[ -f "$STATE_DIR/plan.json" ] || { echo "Planning did not complete — mission paused."; exit 0; }
```

## Step 5: Build

Invoke the **Skill tool** with `skill: "mission:liftoff"` and args `"<ISSUE_NUM>"` plus any `--models …` flags.

## Step 6: Review

Invoke the **Skill tool** with `skill: "mission:systems-check"` and args `"<ISSUE_NUM>"` plus any `--models …` flags. If the user chose **Stop** during its exhaustion prompt, end the mission here and report what remains open.

## Step 7: Open the PR

Invoke the **Skill tool** with `skill: "mission:docking"` and args `"<ISSUE_NUM>"` plus any `--models …` flags.

## Step 8: Report completion

```
Mission complete!
  Issue:  #<issue_number>
  Branch: <branch from plan.json>
  PR:     #<pr_number> — <pr_url>

Run /comms <pr_number> when PR reviews arrive.
```

Relay any low-confidence or user-skipped findings the systems-check phase reported.
