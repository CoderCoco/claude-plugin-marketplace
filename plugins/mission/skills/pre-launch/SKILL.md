---
name: pre-launch
description: Use when the user wants to plan a GitHub issue in the mission workflow, or when /mission dispatches planning. Trigger on "pre-launch <N>", "/pre-launch", or "replan issue N". Dispatches the Flight Director (branch and worktree are created during planning), which resolves ordinary ambiguity autonomously and persists the flight plan to plan.json without waiting for confirmation. Only halts — without persisting a plan — when the Flight Director reports a genuine blocker, surfaced in detail so Mission Control's human operator can resolve it before re-running. Never auto-advances — /mission or the user runs /liftoff next.
---

# Pre-Launch — Autonomous Planning

Run the Flight Director in the current conversation, let it resolve ordinary ambiguity itself, and persist the flight plan for the phase wrappers without waiting on a confirmation round-trip. Only stop and surface a banner when the Flight Director reports a genuine blocker.

## Step 1: Parse arguments

Supported invocations:
- `/pre-launch 42` — plan issue #42 (no-op if a plan already exists)
- `/pre-launch 42 --replan` — discard the existing plan and re-plan
- `/pre-launch 42 --models director=opus` — model overrides for this run

```bash
ISSUE_NUM=…   # first non-flag argument; if omitted, infer from branch: claude/issue-<N>-*
[ -n "$ISSUE_NUM" ] || { echo "Usage: /pre-launch <issue_number> [--replan] [--models …]"; exit 1; }
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}"
mkdir -p "$STATE_DIR"
```

## Step 2: Resolve models

Built-in defaults: `director=fable`, `astronaut=sonnet`, `controller=sonnet`, `inspector=fable`, `capcom=sonnet`, `docking=sonnet`, `utility=haiku`.

1. If `.claude/mission.local.md` exists at the repo root, Read it and take any entries under `models:` in its YAML frontmatter.
2. If the invocation included `--models role=value,...`, apply those entries on top.
3. Valid roles: `director`, `astronaut`, `controller`, `inspector`, `capcom`, `docking`, `utility`. Valid values: `haiku`, `sonnet`, `opus`, `fable`. Warn about and ignore any invalid entry — never abort over one.
4. **Fable fallback.** Fable is unavailable in some environments (e.g. headless or cron runs), where spawning an agent with it hard-errors. Before launching, for any role whose resolved value is `fable`, confirm Fable is among this session's available models. If you cannot confirm it, downgrade that role — `director`→`opus`, `inspector`→`sonnet`, every other role→`sonnet` — and tell the user which roles were downgraded. Never pass `fable` to an agent you cannot confirm supports it.

The merged result is `MODELS`. Run `/mission:setup` to change the persistent defaults.

## Step 3: Existing-plan check

```bash
if [ -f "$STATE_DIR/plan.json" ]; then
  jq -r '"Existing plan: \(.tasks|length) task(s) on \(.branch)"' "$STATE_DIR/plan.json"
fi
```

If a plan exists and `--replan` was NOT passed: show the task table (Step 5 format) and stop with:
`Plan already exists — run /liftoff <N> (or /mission <N>) to continue, or /pre-launch <N> --replan to start over.`

If `--replan` WAS passed: a new plan invalidates old workflow resume points —
```bash
rm -f "$STATE_DIR/plan.json" "$STATE_DIR"/*.runid
```

## Step 4: Dispatch the Flight Director

Call the **Agent tool** (runs in this conversation so any blocker is visible immediately) with:
- `subagent_type`: `"mission:flight-director"`
- `model`: the value of `MODELS.director`
- `prompt`: the template below (substitute `ISSUE_NUM` and `REPO`; `<ANSWERS_CTX>` starts empty)

If the Agent call fails because the model is unavailable (e.g. `MODELS.director` was `fable` in an environment without it), re-dispatch once with `model: opus` and note the downgrade to the user. Do not abort planning over a model-availability error.

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
     If the worktree already exists, verify it is on $BRANCH (git -C "$WORKTREE" branch --show-current); if it is on a different branch, STOP — report the conflict in open_questions instead of proceeding.
5. Break the issue into ordered, file-scoped tasks. Assign crew names from the 52-name roster in
   references/crew-roster.md (Apollo, Borman, Cassini…), starting at index 0.
   List tasks in execution order — first every task with depends_on: [], then tasks whose
   dependencies all appear earlier in the list — and assign roster names in that listed order,
   so tasks that launch in parallel hold consecutive names.
   Express dependencies by name in depends_on. Each task needs a one-sentence acceptance criterion.
   Resolve ordinary ambiguity yourself — pick the most conservative, reversible interpretation and
   record it in that task's `ambiguity_note` field. Only use open_questions for a genuine blocker: something that makes the
   plan impossible to execute at all (a prerequisite the issue assumes already exists but doesn't,
   conflicting repo/worktree state, directly contradictory instructions). Do not guess past a
   genuine blocker, and do not raise open_questions for anything short of one.<ANSWERS_CTX>

Return the full structured plan including issue_title, branch, worktree_path, and tasks.
```

Use this schema for the Agent call:
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
          "name":            { "type": "string" },
          "title":           { "type": "string" },
          "files":           { "type": "array", "items": { "type": "string" } },
          "depends_on":      { "type": "array", "items": { "type": "string" } },
          "acceptance":      { "type": "string" },
          "ambiguity_note":  { "type": "string", "description": "One-sentence note recording the conservative interpretation chosen when this task involved ordinary ambiguity. Omit or leave empty when nothing was ambiguous." }
        }
      }
    }
  }
}
```

### Handle a genuine blocker

Because the Flight Director only returns `open_questions` for something that makes the plan
impossible to execute at all (see Step 4), do NOT try to resolve it interactively with
`AskUserQuestion` and do NOT wait for a response mid-run. A blocker means there is nothing safe
to guess — surface it, don't stall on it.

If the Flight Director returns a non-empty `open_questions`:
1. Do NOT persist `plan.json`.
2. Present the halt using the banner shape in `references/halt-protocol.md`:
   - Reason: the blocker(s) verbatim, in plain English — concrete enough that the human operator
     can resolve it in one reply without needing to re-derive context.
   - Where we are: `"Issue #<N>, planning phase — no plan persisted"`.
   - Options: `[1]` the most likely path forward (e.g. re-scope, wait on a dependency, supply a
     missing decision), `[2]` an alternative path if one exists, `[3]` abort mission (always last).
3. Exit the skill. Do not loop, do not re-dispatch the Flight Director, do not wait for input —
   the surrounding conversation (or a fresh `/pre-launch <N>` / `/pre-launch <N> --replan` once the
   blocker is resolved) picks this back up.

## Step 5: Present the plan

Print the plan for visibility, then continue immediately — do not wait for confirmation:

```
Flight plan ready for issue #<N> — <count> task(s) on <branch>:

  Name          Title                                    Files
  ──────────────────────────────────────────────────────────────
  Apollo        <title>                                  src/retry.ts
  Borman        <title>                                  src/webhook.ts  [->Apollo]

Proceeding to persist the plan — reply with feedback any time before /liftoff starts to revise it.
```

If the user gives feedback in reply before the plan is acted on, re-dispatch the Flight Director
(Step 4) with the feedback appended as revision instructions, then re-present (Step 5). Otherwise
proceed straight to Step 6 — the plan is a starting point the user can still redirect, not a gate
to wait behind.

## Step 6: Persist the plan

Write `$STATE_DIR/plan.json` (Write tool; resolve `$STATE_DIR` to its absolute path first):

```json
{
  "issue_number": <ISSUE_NUM as integer>,
  "repo": "<REPO>",
  "issue_title": "<plan.issue_title>",
  "branch": "<plan.branch>",
  "worktree_path": "<plan.worktree_path>",
  "created_at": "<date -u +%Y-%m-%dT%H:%M:%SZ>",
  "tasks": [ …the Flight Director's tasks array verbatim… ]
}
```

Then print: `All systems go — /mission <N> continues automatically, or run /liftoff <N> yourself.` and finish. Do NOT invoke other skills — the orchestrator (or the user) drives the next phase.
