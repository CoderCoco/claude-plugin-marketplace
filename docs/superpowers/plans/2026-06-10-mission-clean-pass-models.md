# Mission Plugin Clean Pass + Model Selection (v0.7.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the mission plugin on the workflow architecture (phase skills become thin workflow wrappers), delete the obsolete state-machine path, and add per-invocation model selection with a `/mission:setup` walkthrough.

**Architecture:** `/mission` orchestrates four phase skills via the Skill tool; each phase skill wraps one workflow file. State lives in `${CLAUDE_PLUGIN_DATA}/mission-runs/issue-<N>/` (`plan.json` + runids + comms-state). Models resolve flag > `.claude/mission.local.md` > defaults and flow into workflows via `args.models`.

**Tech Stack:** Claude Code plugin (Markdown skills, JS workflow scripts, JSON manifests). No build system; verification is `node --check` + greps.

**Spec:** `docs/superpowers/specs/2026-06-10-mission-clean-pass-models-design.md`

**Conventions for this plan:**
- All paths relative to repo root `/home/chris/GitHub/claude-plugin-marketplace`.
- This repo has no test suite; each task ends with its own verification step.
- Run all git commands from the repo root.

---

## Shared content blocks

Two blocks repeated across tasks. They are spelled out in full in every task that uses them (tasks may be executed out of order); this section is the canonical reference.

**SHARED-MODELS-STEP** — the "Resolve models" markdown step inserted into skills:

```markdown
## Step R: Resolve models

Built-in defaults: `director=fable`, `astronaut=sonnet`, `controller=sonnet`, `inspector=fable`, `capcom=sonnet`, `docking=sonnet`, `utility=haiku`.

1. If `.claude/mission.local.md` exists at the repo root, Read it and take any entries under `models:` in its YAML frontmatter.
2. If the invocation included `--models role=value,...`, apply those entries on top.
3. Valid roles: `director`, `astronaut`, `controller`, `inspector`, `capcom`, `docking`, `utility`. Valid values: `haiku`, `sonnet`, `opus`, `fable`. Warn about and ignore any invalid entry — never abort over one.

The merged result is `MODELS`. Use `MODELS.director` for Flight Director Agent calls and pass the full object to workflows as `args.models`. Run `/mission:setup` to change the persistent defaults.
```

**SHARED-WORKFLOW-MODELS** — the JS block inserted into each workflow right after the `const _a = …` args parse:

```js
const MODEL_DEFAULTS = { astronaut: 'sonnet', controller: 'sonnet', inspector: 'fable', capcom: 'sonnet', docking: 'sonnet', utility: 'haiku' }
const M = Object.assign({}, MODEL_DEFAULTS, _a.models || {})
const pluginRoot = _a.plugin_root || ''
```

---

### Task 1: Delete obsolete files

**Files:**
- Delete: `plugins/mission/workflows/mission-workflow.js`
- Delete: `plugins/mission/scripts/mission-state-init.sh`
- Delete: `plugins/mission/scripts/mission-state-read.sh`
- Delete: `plugins/mission/scripts/mission-state-update.sh`
- Delete: `plugins/mission/scripts/mission-print-log.sh`
- Delete: `plugins/mission/scripts/test/test-state-init.sh`
- Delete: `plugins/mission/scripts/test/test-state-update.sh`
- Delete: `plugins/mission/references/mission-state.md`
- Delete: `plugins/mission/references/comms-queries.md`
- Delete: `plugins/mission/references/agent-contracts.md`

- [ ] **Step 1: Remove the files**

```bash
git rm plugins/mission/workflows/mission-workflow.js \
  plugins/mission/scripts/mission-state-init.sh \
  plugins/mission/scripts/mission-state-read.sh \
  plugins/mission/scripts/mission-state-update.sh \
  plugins/mission/scripts/mission-print-log.sh \
  plugins/mission/scripts/test/test-state-init.sh \
  plugins/mission/scripts/test/test-state-update.sh \
  plugins/mission/references/mission-state.md \
  plugins/mission/references/comms-queries.md \
  plugins/mission/references/agent-contracts.md
rmdir plugins/mission/scripts/test plugins/mission/scripts 2>/dev/null || true
```

- [ ] **Step 2: Verify nothing else remains in scripts/**

Run: `ls plugins/mission/scripts 2>&1`
Expected: `No such file or directory`

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(mission): delete state-machine scripts and superseded references

The phase skills move onto the workflow architecture; the mission-state
shell machinery, its tests, the deprecated mission-workflow stub, the
GraphQL comms queries, and the text-block agent contracts have no
remaining consumers."
```

(Note: skills still referencing the deleted files are rewritten in Tasks 7–12; the plugin is intentionally mid-transition between commits.)

---

### Task 2: Models in liftoff-workflow.js

**Files:**
- Modify: `plugins/mission/workflows/liftoff-workflow.js`

- [ ] **Step 1: Insert SHARED-WORKFLOW-MODELS**

After the existing args block ending `if (!issueNum || !repo || !plan) throw new Error(...)` (~line 74), insert:

```js
const MODEL_DEFAULTS = { astronaut: 'sonnet', controller: 'sonnet', inspector: 'fable', capcom: 'sonnet', docking: 'sonnet', utility: 'haiku' }
const M = Object.assign({}, MODEL_DEFAULTS, _a.models || {})
const pluginRoot = _a.plugin_root || ''
```

- [ ] **Step 2: Replace hardcoded models**

- Astronaut call (~line 129): `model: 'sonnet',` → `model: M.astronaut,`
- Flight Controller call (~line 168): `model: 'sonnet',` → `model: M.controller,`
- Commit call (~line 202): `model: 'haiku'` → `model: M.utility`

- [ ] **Step 3: Wire Conventional Commits into the commit agent**

Replace the commit agent prompt (currently ending `Return the commit SHA.`):

```js
        await agent(
          `Commit task ${task.name} in worktree ${plan.worktree_path}.

  git -C ${plan.worktree_path} add ${task.files.join(' ')}
  git -C ${plan.worktree_path} commit -m "feat: ${task.name} — ${task.title}\\n\\nRefs #${issueNum}"

The message must follow Conventional Commits (imperative subject, ≤72 chars).${pluginRoot ? `\nFull rules: read ${pluginRoot}/references/conventional-commits.md` : ''}
Return the commit SHA.`,
          { label: `commit:${task.name}`, phase: 'Commit', model: M.utility }
        )
```

- [ ] **Step 4: Verify**

Run: `node --check plugins/mission/workflows/liftoff-workflow.js && grep -c "model: '" plugins/mission/workflows/liftoff-workflow.js`
Expected: syntax OK; grep count `0` (grep exits 1 — that is the pass condition).

- [ ] **Step 5: Commit**

```bash
git add plugins/mission/workflows/liftoff-workflow.js
git commit -m "feat(mission): configurable models in liftoff workflow"
```

---

### Task 3: Models + phase fix in systems-check-workflow.js

**Files:**
- Modify: `plugins/mission/workflows/systems-check-workflow.js`

- [ ] **Step 1: Insert SHARED-WORKFLOW-MODELS** after the args/`maxRounds` block (~line 104), same three lines as Task 2.

- [ ] **Step 2: Replace hardcoded models**

- scout (~line 142): `model: 'haiku'` → `model: M.utility`
- language inspector (~line 187): `model: 'sonnet',` → `model: M.inspector,`
- specialist inspector (~line 198): `model: 'sonnet',` → `model: M.inspector,`
- repair Astronaut (~line 256): `model: 'sonnet',` → `model: M.astronaut,`
- repair Flight Controller (~line 280): `model: 'sonnet',` → `model: M.controller,`
- commit-repair (~line 301): `model: 'haiku'` → `model: M.utility`

(The inspector default `fable` restores the agent-frontmatter intent that the hardcoded `'sonnet'` silently overrode.)

- [ ] **Step 3: Fix the specialist phase label**

Specialist inspector options (~line 195): `phase: 'Systems Check',` → `phase: 'Review',` (must match a declared meta phase).

- [ ] **Step 4: Wire Conventional Commits into commit-repair**

Replace the commit-repair agent prompt:

```js
    await agent(
      `Commit the repair for "${finding.summary.slice(0, 60)}" in worktree ${plan.worktree_path}.

  git -C ${plan.worktree_path} add ${repair.files_modified.join(' ')}
  git -C ${plan.worktree_path} commit -m "fix: ${finding.summary.slice(0, 72)}\\n\\nRefs #${issueNum}"

The message must follow Conventional Commits (imperative subject, ≤72 chars).${pluginRoot ? `\nFull rules: read ${pluginRoot}/references/conventional-commits.md` : ''}`,
      { label: `commit-repair:r${scAttempts}:${idx}`, phase: 'Commit', model: M.utility }
    )
```

- [ ] **Step 5: Verify**

Run: `node --check plugins/mission/workflows/systems-check-workflow.js && grep -n "Systems Check'" plugins/mission/workflows/systems-check-workflow.js`
Expected: syntax OK; grep finds nothing (exit 1).

- [ ] **Step 6: Commit**

```bash
git add plugins/mission/workflows/systems-check-workflow.js
git commit -m "feat(mission): configurable models in systems-check workflow, fix specialist phase label"
```

---

### Task 4: Models in docking + comms workflows

**Files:**
- Modify: `plugins/mission/workflows/docking-workflow.js`
- Modify: `plugins/mission/workflows/comms-workflow.js`

- [ ] **Step 1: docking-workflow.js** — insert SHARED-WORKFLOW-MODELS after the args check (~line 27); PR agent (~line 59): `model: 'sonnet',` → `model: M.docking,`.

- [ ] **Step 2: comms-workflow.js** — insert SHARED-WORKFLOW-MODELS after the args check (~line 117); replace:

- fetch (~line 203): `model: 'sonnet',` → `model: M.capcom,`
- triage (~line 254): `model: 'sonnet',` → `model: M.capcom,`
- fix Astronaut (~line 297): `model: 'sonnet',` → `model: M.astronaut,`
- fix Flight Controller (~line 324): `model: 'sonnet',` → `model: M.controller,`
- commit (~line 353), push (~line 365), resolve (~line 377), summary-comment (~line 389), re-request-review (~line 398), reply (~line 425): `model: 'haiku'` → `model: M.utility`

- [ ] **Step 3: Wire Conventional Commits into the comms commit agent**

In the commit prompt (~line 347), after the `git -C … commit -m …` line and before `Return the commit SHA.`, add:

```
The message must follow Conventional Commits (imperative subject, ≤72 chars).${pluginRoot ? `\nFull rules: read ${pluginRoot}/references/conventional-commits.md` : ''}
```

- [ ] **Step 4: Verify**

Run: `node --check plugins/mission/workflows/docking-workflow.js && node --check plugins/mission/workflows/comms-workflow.js && grep -rn "model: '" plugins/mission/workflows/`
Expected: both syntax OK; grep finds nothing (exit 1).

- [ ] **Step 5: Commit**

```bash
git add plugins/mission/workflows/docking-workflow.js plugins/mission/workflows/comms-workflow.js
git commit -m "feat(mission): configurable models in docking and comms workflows"
```

---

### Task 5: Drop agent-contracts mandates from agents

**Files:**
- Modify: `plugins/mission/agents/astronaut.md:33`
- Modify: `plugins/mission/agents/capcom.md:57`
- Modify: `plugins/mission/agents/flight-controller.md:62`
- Modify: `plugins/mission/agents/flight-director.md:35`
- Modify: `plugins/mission/agents/systems-inspector.md:47`

- [ ] **Step 1: Replace each contracts line**

In each file, Read the paragraph containing `references/agent-contracts.md` and replace the whole paragraph (it mandates a `### BLOCK` text format) with the matching line below. Frontmatter stays untouched.

- astronaut.md: `Mission Control supplies a structured-output schema with your dispatch. Return your crew report through it: task_name, status, files_modified, summary — and plan_problem_description when status is plan_problem.`
- capcom.md: `Mission Control supplies a structured-output schema with your dispatch. Return your triage through it: one entry per comment with id, category, and the category-specific fields (fix_hint, reply_draft).`
- flight-controller.md: `Mission Control supplies a structured-output schema with your dispatch. Return your verdict through it: task_name, verdict (PASS or FAIL), and fixes_needed when failing.`
- flight-director.md: `Mission Control supplies a structured-output schema with your dispatch. Return the full plan through it: issue_title, branch, worktree_path, tasks, and open_questions when anything is ambiguous. Anything outside the schema is your narration to Mission Control.`
- systems-inspector.md: `Mission Control supplies a structured-output schema with your dispatch. Return your findings through it: file, line, severity, confidence (0–100), summary, suggestion.`

- [ ] **Step 2: Verify**

Run: `grep -rn "agent-contracts" plugins/mission/`
Expected: no matches (exit 1).

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/agents/
git commit -m "refactor(mission): agents return via structured-output schemas, not text blocks"
```

---

### Task 6: New /mission:setup skill

**Files:**
- Create: `plugins/mission/skills/setup/SKILL.md`

- [ ] **Step 1: Write the skill**

````markdown
---
name: setup
description: Use when the user wants to configure which models the mission crew uses. Trigger on "mission setup", "configure mission models", "mission config", or "/setup" in a mission context. Interactive walkthrough that writes .claude/mission.local.md with per-role model defaults consumed by all mission skills; doubles as reconfigure when the file already exists.
---

# Mission Setup — Model Configuration

Walk the user through choosing a model per crew role and persist the choices to `.claude/mission.local.md` at the repo root. Every mission skill reads this file; `--models role=value` on any invocation overrides it for that run.

## Step 1: Read current configuration

Built-in defaults:

| Role | Used by | Default |
|---|---|---|
| `director` | Flight Director (planning) | `fable` |
| `inspector` | Systems Inspectors (code review) | `fable` |
| `astronaut` | Build agents (tasks, repairs, comment fixes) | `sonnet` |
| `controller` | Flight Controllers (verification) | `sonnet` |
| `capcom` | Comms fetch + triage | `sonnet` |
| `docking` | PR-opening agent | `sonnet` |
| `utility` | Micro-agents (scout, commit, push, replies) | `haiku` |

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
SETTINGS="$REPO_ROOT/.claude/mission.local.md"
```

If `$SETTINGS` exists, Read it. The **effective value** per role = file value if present, else the default. Show the user the current effective configuration before asking anything.

## Step 2: Ask for choices

Use AskUserQuestion with four questions in one call. Mark each role's current effective value with "(current)" and make it the first option. Valid models everywhere: `haiku`, `sonnet`, `opus`, `fable`.

1. **Director** — "Which model should the Flight Director (planning) use?"
2. **Inspector** — "Which model should the Systems Inspectors (code review) use?"
3. **Workers** — "Which model for the worker roles (astronaut, controller, capcom, docking)?" — one tier applied to all four; mention the user can pick "Other" and give per-role values like `astronaut=sonnet controller=haiku`.
4. **Utility** — "Which model for utility micro-agents (commits, pushes, replies)?"

## Step 3: Write the settings file

Build the `models:` map from the answers, **keeping only roles whose value differs from the built-in default**. Then:

- If the map is empty: report "all choices match the defaults" — delete `$SETTINGS` if it exists and contains only a `models:` block, otherwise just remove its `models:` entries. Skip to Step 4.
- Otherwise `mkdir -p "$REPO_ROOT/.claude"` and Write `$SETTINGS`:

```markdown
---
models:
  director: opus
  inspector: opus
---

# Mission plugin settings

Local (per-machine) settings for the mission plugin — not committed.

- `models:` — per-role model overrides. Roles: director, inspector, astronaut,
  controller, capcom, docking, utility. Values: haiku, sonnet, opus, fable.
  Roles omitted here use the plugin's built-in defaults.
- Override per invocation with `--models role=value,...` on any mission skill.
- Re-run `/mission:setup` to change these interactively.
```

(`models:` entries above are an example — write the user's actual non-default choices. If the file already existed, preserve any frontmatter keys other than `models` and any custom body text.)

## Step 4: Check .gitignore

```bash
grep -qE '(^|/)\.claude/\*\.local\.md|mission\.local\.md|^\.claude/?$' "$REPO_ROOT/.gitignore" 2>/dev/null && echo covered || echo not-covered
```

If not covered, ask the user: "Add `.claude/*.local.md` to .gitignore so local settings stay uncommitted?" On yes, append that line to `.gitignore`.

## Step 5: Confirm

Print the final effective configuration (all seven roles, marking which come from the file vs defaults) and remind: `--models role=value` overrides per invocation.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/mission/skills/setup/
git commit -m "feat(mission): /mission:setup interactive model configuration"
```

---

### Task 7: Rewrite pre-launch as the single interactive planner

**Files:**
- Rewrite: `plugins/mission/skills/pre-launch/SKILL.md`

- [ ] **Step 1: Replace the full file with:**

````markdown
---
name: pre-launch
description: Use when the user wants to plan a GitHub issue in the mission workflow, or when /mission dispatches planning. Trigger on "pre-launch <N>", "/pre-launch", or "replan issue N". Dispatches the Flight Director interactively (branch and worktree are created during planning), answers open questions with the user, persists the flight plan to plan.json, and confirms readiness. Never auto-advances — /mission or the user runs /liftoff next.
---

# Pre-Launch — Interactive Planning

Run the Flight Director in the current conversation so open questions can be answered immediately, then persist the flight plan for the phase wrappers.

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

The merged result is `MODELS`. Run `/mission:setup` to change the persistent defaults.

## Step 3: Existing-plan check

```bash
if [ -f "$STATE_DIR/plan.json" ]; then
  jq -r '"Existing plan: \(.tasks|length) task(s) on \(.branch)"' "$STATE_DIR/plan.json"
fi
```

If a plan exists and `--replan` was NOT passed: show the task table (Step 6 format) and stop with:
`Plan already exists — run /liftoff <N> (or /mission <N>) to continue, or /pre-launch <N> --replan to start over.`

If `--replan` WAS passed: a new plan invalidates old workflow resume points —
```bash
rm -f "$STATE_DIR/plan.json" "$STATE_DIR"/*.runid
```

## Step 4: Dispatch the Flight Director

Call the **Agent tool** (runs in this conversation so the user can answer questions) with:
- `subagent_type`: `"mission:flight-director"`
- `model`: the value of `MODELS.director`
- `prompt`: the template below (substitute `ISSUE_NUM` and `REPO`; `<ANSWERS_CTX>` starts empty)

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

If the Flight Director returns a non-empty `open_questions`:
1. Present them to the user — AskUserQuestion for up to 4; a numbered list beyond that.
2. Wait for answers.
3. Re-run the Agent call with `<ANSWERS_CTX>` replaced by:
   ```

   The user has answered your open questions:
   <user's answers>
   Proceed with the full plan — do not return any open_questions.
   ```
4. Repeat until the plan has no open_questions.

## Step 5: Persist the plan

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

## Step 6: Present and confirm

```
Flight plan ready for issue #<N> — <count> task(s) on <branch>:

  Name          Title                                    Files
  ──────────────────────────────────────────────────────────────
  Apollo        <title>                                  src/retry.ts
  Borman        <title>                                  src/webhook.ts  [->Apollo]

Ready for liftoff? [Y/n]
```

- Feedback / `n` → re-dispatch the Flight Director (Step 4) with the user's feedback appended as revision instructions, then rewrite `plan.json` (Step 5) and re-confirm.
- `y` → print: `All systems go — /mission <N> continues automatically, or run /liftoff <N> yourself.` and finish. Do NOT invoke other skills — the orchestrator (or the user) drives the next phase.
````

- [ ] **Step 2: Verify**

Run: `grep -n "mission-state\|agent-contracts\|PLAN_BLOCK\|PyYAML" plugins/mission/skills/pre-launch/SKILL.md`
Expected: no matches (exit 1).

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/skills/pre-launch/SKILL.md
git commit -m "refactor(mission): pre-launch is the single interactive planner persisting plan.json"
```

---

### Task 8: Rewrite liftoff as a workflow wrapper

**Files:**
- Rewrite: `plugins/mission/skills/liftoff/SKILL.md`

- [ ] **Step 1: Replace the full file with:**

````markdown
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
````

- [ ] **Step 2: Verify**

Run: `grep -n "mission-state\|Agent(astronaut\|halt-protocol" plugins/mission/skills/liftoff/SKILL.md`
Expected: only the single intentional `halt-protocol.md` reference in Step 4.

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/skills/liftoff/SKILL.md
git commit -m "refactor(mission): liftoff skill wraps liftoff-workflow"
```

---

### Task 9: Rewrite systems-check as wrapper + exhaustion loop

**Files:**
- Rewrite: `plugins/mission/skills/systems-check/SKILL.md`

- [ ] **Step 1: Replace the full file with:**

````markdown
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
````

- [ ] **Step 2: Verify**

Run: `grep -n "mission-state\|systems_check_findings\|RUBRIC=" plugins/mission/skills/systems-check/SKILL.md`
Expected: no matches (exit 1).

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/skills/systems-check/SKILL.md
git commit -m "refactor(mission): systems-check skill wraps workflow, owns exhaustion loop"
```

---

### Task 10: Rewrite docking as a workflow wrapper

**Files:**
- Rewrite: `plugins/mission/skills/docking/SKILL.md`

- [ ] **Step 1: Replace the full file with:**

````markdown
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

The merged result is `MODELS`, passed to the workflow as `args.models`.

## Step 3: Run the workflow

```bash
PRIOR=$(cat "$STATE_DIR/docking.runid" 2>/dev/null || echo "")
```

Call the Workflow tool with:
- `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/docking-workflow.js` (expand the env var — do NOT use import() or cat)
- `resumeFromRunId`: `PRIOR` if non-empty, otherwise omit
- `args`: `{ issue_number: <ISSUE_NUM>, repo: "<REPO>", plan: <plan.json object>, models: <MODELS>, plugin_root: "<value of $CLAUDE_PLUGIN_ROOT>" }`

Save the returned `runId`:
```bash
echo "<runId>" > "$STATE_DIR/docking.runid"
```

If the workflow throws (push conflict, gh auth), present the error using the banner shape in `references/halt-protocol.md` with options: [1] fix the stated problem and re-run `/docking <N>`, [2] open the PR manually then re-run.

## Step 4: Report and offer the watcher

```
🚀 Docking complete! PR #<pr_number> is open: <pr_url>

Want me to watch for PR comments automatically?
  /loop 5m /comms <N>              — poll every 5 minutes in this session
  /schedule "Run /comms <N>" --every 30m — scheduled background check
Or just run /comms <N> manually when reviews arrive.
```
````

- [ ] **Step 2: Verify**

Run: `grep -n "mission-state\|mission-print-log\|pr_watcher" plugins/mission/skills/docking/SKILL.md`
Expected: no matches (exit 1).

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/skills/docking/SKILL.md
git commit -m "refactor(mission): docking skill wraps docking-workflow"
```

---

### Task 11: Update comms skill (scriptPath, models, state path)

**Files:**
- Modify: `plugins/mission/skills/comms/SKILL.md`

- [ ] **Step 1: State path into the per-issue dir** — in Step 1's code block, replace:

```bash
mkdir -p "${CLAUDE_PLUGIN_DATA}/mission-runs"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}-comms-state.json"
```
with:
```bash
STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-runs/issue-${ISSUE_NUM}"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/comms-state.json"
```

Also extend the supported-invocations list with `/comms 42 --models capcom=opus` — model overrides for this run.

- [ ] **Step 2: Add a models step** — insert after Step 1 as `## Step 1b: Resolve models`, with the same SHARED-MODELS-STEP text used in Task 8 Step 2 (defaults line + the 3 numbered resolution rules + "The merged result is `MODELS`, passed to the workflow as `args.models`.").

- [ ] **Step 3: scriptPath migration** — in Step 6, delete the `WORKFLOW_SCRIPT=$(cat …)` bash block entirely and replace the Workflow call with:

```
Call the Workflow tool with:
- `scriptPath`: the literal string `${CLAUDE_PLUGIN_ROOT}/workflows/comms-workflow.js` (expand the env var — do NOT use import() or cat)
- `args`: {
    issue_number:  <ISSUE_NUM as integer>,
    repo:          "<REPO>",
    pr_number:     <PR_NUM as integer>,
    branch:        "<BRANCH>",
    worktree_path: "<WORKTREE_PATH>",
    last_seen_at:  "<LAST_SEEN_AT>",
    models:        <MODELS>,
    plugin_root:   "<value of $CLAUDE_PLUGIN_ROOT>"
  }
```

Keep the existing "Do not pass `resumeFromRunId`" note and the result-saving line.

- [ ] **Step 4: Fix the dead `--finish` reference** — in Step 7's merged-status message, replace `Run /mission <N> --finish to clean up the worktree.` with:

```
Clean up when ready:  git worktree remove <worktree_path>
```

- [ ] **Step 5: Verify**

Run: `grep -n "script:\|WORKFLOW_SCRIPT\|--finish" plugins/mission/skills/comms/SKILL.md`
Expected: no matches (exit 1).

- [ ] **Step 6: Commit**

```bash
git add plugins/mission/skills/comms/SKILL.md
git commit -m "refactor(mission): comms uses scriptPath, per-issue state dir, models"
```

---

### Task 12: Rewrite mission skill as thin orchestrator

**Files:**
- Rewrite: `plugins/mission/skills/mission/SKILL.md`

- [ ] **Step 1: Replace the full file with:**

````markdown
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

Run /comms <issue_number> when PR reviews arrive.
```

Relay any low-confidence or user-skipped findings the systems-check phase reported.
````

- [ ] **Step 2: Verify**

Run: `grep -n "Flight Director prompt\|scriptPath\|SC_DEFERRED" plugins/mission/skills/mission/SKILL.md`
Expected: no matches (exit 1) — the FD prompt and SC loop now live only in the phase skills.

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/skills/mission/SKILL.md
git commit -m "refactor(mission): /mission orchestrates phase skills, each owning its workflow"
```

---

### Task 13: README rewrite + version bump

**Files:**
- Rewrite: `plugins/mission/README.md`
- Modify: `plugins/mission/.claude-plugin/plugin.json`

- [ ] **Step 1: Replace README.md with:**

````markdown
# mission

End-to-end GitHub issue orchestrator for Claude Code.

**One command.** `/mission <issue-number>` drives an issue from plan through
build, code review, and PR open — with at most five user-touch points in the
happy path. Fully resumable: planning persists a flight plan, each build phase
persists a workflow runId; re-run the same command after a restart to pick up
where you left off.

## Install

```shell
/plugin install mission@codercoco-custom-plugin-marketplace
```

## Usage

```
/mission <N>             Start or resume the mission for issue #N
/mission <N> --status    Show saved state; no action
/mission <N> --replan    Discard the plan and re-plan
/mission <N> --abandon   Clear all saved state (asks confirmation)

# Individual phases (same implementations /mission drives)
/pre-launch <N>          Plan: Flight Director decomposes the issue (interactive)
/liftoff <N>             Build: parallel Astronauts + Flight Controllers
/systems-check <N>       Review: polyglot inspectors + auto-repair
/docking <N>             PR: push branch, open pull request
/comms <N>               Handle PR review comments (single pass; loop with /loop 5m /comms <N>)

# Configuration & meta
/mission:setup           Interactive model configuration
/mission-debrief         Fold new review findings into the rubric
```

## Choosing models

Each crew role's model is configurable. Resolution: `--models` flag →
`.claude/mission.local.md` → built-in defaults.

| Role | Used by | Default |
|---|---|---|
| `director` | Flight Director (planning) | `fable` |
| `inspector` | Systems Inspectors (review) | `fable` |
| `astronaut` | Build agents | `sonnet` |
| `controller` | Flight Controllers (verification) | `sonnet` |
| `capcom` | Comms fetch + triage | `sonnet` |
| `docking` | PR-opening agent | `sonnet` |
| `utility` | Micro-agents (commits, pushes, replies) | `haiku` |

Per invocation:

```
/mission 42 --models director=opus,inspector=opus
```

Persistently — run `/mission:setup`, or write `.claude/mission.local.md`:

```markdown
---
models:
  director: opus
  inspector: opus
---
```

## Crew

| Role | Job |
|---|---|
| Flight Director | Decomposes the issue into named tasks with dependencies |
| Astronaut | Implements exactly one task |
| Flight Controller | Runs tests/lint/types — PASS or FAIL |
| Systems Inspector | Polyglot semantic code review |
| CAPCOM | Categorises PR comments, drafts replies |

## Architecture

`/mission` orchestrates four phase skills; each wraps one workflow script in
`workflows/`. State lives in `$CLAUDE_PLUGIN_DATA/mission-runs/issue-<N>/`
(`plan.json`, workflow runIds, comms state). Never committed.
````

- [ ] **Step 2: Bump the version** — in `plugins/mission/.claude-plugin/plugin.json`: `"version": "0.6.6"` → `"version": "0.7.0"`.

- [ ] **Step 3: Verify**

Run: `jq -r .version plugins/mission/.claude-plugin/plugin.json && grep -n "auto\|--finish" plugins/mission/README.md`
Expected: `0.7.0`; grep finds nothing (exit 1).

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/README.md plugins/mission/.claude-plugin/plugin.json
git commit -m "docs(mission): README for unified architecture + models, bump to 0.7.0"
```

---

### Task 14: Final verification sweep

- [ ] **Step 1: No references to deleted machinery**

```bash
grep -rn "mission-state\|agent-contracts\|mission-print-log\|comms-queries\|mission-workflow.js" plugins/mission/
```
Expected: no matches (exit 1).

- [ ] **Step 2: No hardcoded workflow models, no script-embedding**

```bash
grep -rn "model: '" plugins/mission/workflows/ ; grep -rn "WORKFLOW_SCRIPT" plugins/mission/skills/
```
Expected: no matches from either (both exit 1).

- [ ] **Step 3: Workflows parse**

```bash
for f in plugins/mission/workflows/*.js; do node --check "$f" || echo "FAIL: $f"; done
```
Expected: no FAIL lines.

- [ ] **Step 4: Every skill/agent references only files that exist**

```bash
grep -rhoE "references/[a-z-]+\.md" plugins/mission/skills plugins/mission/agents | sort -u | while read -r f; do
  [ -f "plugins/mission/$f" ] || echo "DEAD: $f"
done
```
Expected: no DEAD lines.

- [ ] **Step 5: Fix anything found, amend the relevant commit or add a `fix(mission):` commit.**
