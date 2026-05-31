# Mission Control Theme Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `voyage` plugin to `mission`, replacing every pirate-themed name and vocabulary word with space/mission-control equivalents throughout all files.

**Architecture:** Pure rename-and-rewrite — no logic changes. Behavioral code (DAG execution, retry caps, state machine transitions, shell logic) stays identical. Only names, terminology, and flavor text change. State schema bumps to `schema_version: 2` for the `inspection` key → `systems_check` rename.

**Tech Stack:** Bash, jq, Markdown. No build system.

---

### Task 1: Rename plugin directory + update manifests

**Files:**
- Rename directory: `plugins/voyage/` → `plugins/mission/`
- Modify: `plugins/mission/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: git mv the directory**

```bash
git mv plugins/voyage plugins/mission
```

- [ ] **Step 2: Rewrite plugin.json**

Write `plugins/mission/.claude-plugin/plugin.json`:

```json
{
  "name": "mission",
  "description": "End-to-end GitHub issue orchestrator — plan, build, review, open PR, handle comments. Resumable state machine. Space / mission control themed.",
  "version": "0.2.0",
  "author": {
    "name": "CoderCoco"
  },
  "license": "MIT",
  "repository": "https://github.com/CoderCoco/claude-plugin-marketplace"
}
```

- [ ] **Step 3: Update marketplace.json**

In `.claude-plugin/marketplace.json`, replace the voyage entry with:

```json
{
  "name": "mission",
  "description": "End-to-end GitHub issue orchestrator — plan, build, review, open PR, handle comments. Resumable state machine. Space / mission control themed.",
  "version": "0.2.0",
  "author": { "name": "CoderCoco" },
  "source": "./plugins/mission",
  "license": "MIT"
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(mission): rename voyage → mission, bump to v0.2.0"
```

---

### Task 2: Rewrite references/crew-roster.md

Replace the pirate lexicon with space vocabulary and 52 space-themed task names.

**Files:**
- Rename: `plugins/mission/references/pirate-lexicon.md` → `plugins/mission/references/crew-roster.md`

- [ ] **Step 1: Rename**

```bash
git mv plugins/mission/references/pirate-lexicon.md plugins/mission/references/crew-roster.md
```

- [ ] **Step 2: Write new content**

Write `plugins/mission/references/crew-roster.md`:

```markdown
# Crew Roster

Shared vocabulary for all mission agents and skills. Use these terms
consistently. Do not invent synonyms.

## Tone rule

**Space / mission flavor goes in prose. Payloads stay plain.**

If another machine or another reviewer will parse it (JSON, commit messages,
PR descriptions, PR replies, code, agent return blocks), use plain English.
Space-flavor the narration; never the payload.

## Shared vocabulary

| Term | Meaning |
|---|---|
| mission | The full workflow from issue → merged PR |
| flight plan | The plan (Flight Director's output) |
| liftoff | Begin executing the plan |
| systems-check | Full-diff code review phase |
| docking | Open the PR |
| comms | Handle PR comments |
| mission debrief | Update the review rubric |
| crew | Sub-agents collectively |
| anomaly | A code-review finding |
| abort | Stop, reverse course |
| go / no-go | Yes / no |
| resume mission | Resume an interrupted mission |
| Mission Control | The main session (model running /mission) |
| all systems nominal | No issues / nothing to do |
| abort sequence | Failure / halt-and-ask state |
| mission log | The mission chronicle / history |

## Task name roster (52 names, A–Z twice)

Tasks created during a mission are named from this roster in order, starting
from `plan.next_alpha_index`. Systems-check repair tasks and comms repair tasks
continue from where liftoff left off.

If a plan would require more than 52 tasks, halt and ask the Flight Director to
decompose further rather than wrapping to a third pass.

### Round 1

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 0 | Apollo | | 9 | Jemison | | 18 | Saturn |
| 1 | Borman | | 10 | Kepler | | 19 | Tereshkova |
| 2 | Cassini | | 11 | Lovell | | 20 | Uhuru |
| 3 | Drake | | 12 | Mars | | 21 | Voyager |
| 4 | Europa | | 13 | NASA | | 22 | Webb |
| 5 | Feynman | | 14 | Orion | | 23 | XMM |
| 6 | Gemini | | 15 | Pioneer | | 24 | Young |
| 7 | Hubble | | 16 | Quasar | | 25 | Zond |
| 8 | Io | | 17 | Ride | | | |

### Round 2

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 26 | Aldrin | | 34 | Interstellar | | 42 | Quirrenbach |
| 27 | Bean | | 35 | Juno | | 43 | Rosetta |
| 28 | Chang-Diaz | | 36 | Kelly | | 44 | Shepard |
| 29 | Discovery | | 37 | Leonov | | 45 | Titan |
| 30 | Eagle | | 38 | Mir | | 46 | Ulysses |
| 31 | Feustel | | 39 | Nereid | | 47 | Vostok |
| 32 | Glenn | | 40 | Ochoa | | 48 | Whitson |
| 33 | Hadfield | | 41 | Pluto | | 49 | Xenon |
| | | | | | | 50 | Yuri |
| | | | | | | 51 | Zarya |

All names are ASCII-safe (no apostrophes, spaces, or Unicode) — safe as JSON
string values and in commit messages.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/references/crew-roster.md
git commit -m "docs(mission): replace pirate lexicon with space crew roster"
```

---

### Task 3: Rewrite references/mission-state.md

**Files:**
- Rename: `plugins/mission/references/voyage-state.md` → `plugins/mission/references/mission-state.md`

- [ ] **Step 1: Rename**

```bash
git mv plugins/mission/references/voyage-state.md plugins/mission/references/mission-state.md
```

- [ ] **Step 2: Write new content**

Write `plugins/mission/references/mission-state.md`:

```markdown
# Mission State File

## Location

```
$CLAUDE_PLUGIN_DATA/mission-state/issue-<N>.json
```

One file per issue. Never committed; never in the working tree.

## Full schema

```jsonc
{
  "schema_version": 2,
  "issue": {
    "number": 42,
    "title": "Add retry to webhook delivery",
    "repo": "owner/repo",
    "url": "https://github.com/owner/repo/issues/42"
  },
  "branch": {
    "name": "claude/issue-42-add-retry-to-webhook-delivery",
    "worktree_path": "/home/user/wt/issue-42",
    "base": "main",
    "base_sha_at_start": "abc123..."
  },
  "phase": "liftoff",
  "phase_status": "in_progress",
  "halted_reason": null,

  "plan": {
    "navigator_attempts": 1,
    "next_alpha_index": 5,
    "tasks": [
      {
        "name": "Apollo",
        "title": "Add exponential backoff helper",
        "files": ["src/retry.ts"],
        "depends_on": [],
        "status": "completed",
        "crewmate_attempts": 1,
        "quartermaster_verdict": "PASS",
        "commit_sha": "def456...",
        "origin": "plan",
        "notes": ""
      }
    ]
  },

  "systems_check": {
    "attempts": 0,
    "attempt_cap": 3,
    "findings": [],
    "fixed_findings": [],
    "declined_findings": []
  },

  "pr": {
    "number": null,
    "url": null,
    "opened_at": null,
    "last_comment_id_seen": null,
    "copilot_was_requested": false,
    "watcher_scheduled": false
  },

  "history": [
    {"at": "2026-05-23T20:00:00Z", "phase": "pre-launch", "event": "initialized"},
    {"at": "2026-05-23T20:02:11Z", "phase": "pre-launch", "event": "completed", "tasks": 5},
    {"at": "2026-05-23T20:02:12Z", "phase": "liftoff", "event": "started"},
    {"at": "2026-05-23T20:08:33Z", "phase": "liftoff", "event": "task_passed", "task": "Apollo"}
  ],

  "created_at": "2026-05-23T20:00:00Z",
  "updated_at": "2026-05-23T20:08:33Z"
}
```

## Phase enum

`pre-launch` → `liftoff` → `systems-check` → `docking` → `comms` → `done`

## Phase status enum

`pending` | `in_progress` | `completed` | `halted`

## Task status enum

`pending` | `ready` | `dispatched` | `verifying` | `completed` | `failed` | `skipped`

## Task origin enum

`plan` (from Flight Director) | `systems-check` (repair task) | `comms` (comment fix)

## Atomic writes

All writes go through `scripts/mission-state-update.sh`. Never write the
state file directly — the script handles the `.tmp` → `mv` atomic swap and
keeps `updated_at` and `history` consistent.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/references/mission-state.md
git commit -m "docs(mission): update state schema to v2 with space phase names and systems_check key"
```

---

### Task 4: Rewrite references/conventional-commits.md + references/agent-contracts.md + references/halt-protocol.md

**Files:**
- Modify: `plugins/mission/references/conventional-commits.md`
- Modify: `plugins/mission/references/agent-contracts.md`
- Modify: `plugins/mission/references/halt-protocol.md`

- [ ] **Step 1: Rewrite conventional-commits.md**

Write `plugins/mission/references/conventional-commits.md`:

```markdown
# Conventional Commits — mission

All commits made during a mission follow this format.

## Format

```
<type>(<scope>): <name> — <summary>

<body: optional, 72-char wrap>

Refs #<issue>
[Co-Authored-By: <reviewer> (via PR comment)]
```

## Types

| Type | When |
|---|---|
| `feat` | New behaviour visible to users |
| `fix` | Bug fix |
| `refactor` | Restructure without behaviour change |
| `test` | Test-only changes |
| `docs` | Documentation only |
| `chore` | Tooling, config, deps |
| `perf` | Performance improvement |

## Scope

Use the primary directory or feature area: `src`, `tests`, `api`, `db`, etc.

## Name field

Always include the crew member's name before the summary dash:

```
feat(src): Apollo — add exponential backoff helper
fix(tests): Aldrin — clear ANSI format from file transport
fix(src): Quirrenbach — return 404 instead of 500 on missing webhook
```

Comms (PR comment) fixes add a Co-Authored-By line:

```
fix(src): Quirrenbach — return 404 on missing webhook

Refs #42
Co-Authored-By: alice (via PR comment)
```

## Forbidden flags

Never use `--no-verify`, `--no-gpg-sign`, or `--amend` on a commit that has
already been pushed. Never use `git add .` — always stage specific files.
Never commit `.claude/` state files, `.env`, or credential files.

## Closing keywords

Only `docking` skill uses `Closes #N`. All mid-mission commits
use `Refs #N` only.
```

- [ ] **Step 2: Rewrite agent-contracts.md**

Write `plugins/mission/references/agent-contracts.md`:

```markdown
# Agent Return Contracts

Every mission sub-agent returns exactly ONE fenced block. No prose outside
the delimiters. Mission Control parses ONLY the content between the block markers.

## Flight Director — ### PLAN

```
### PLAN
issue: <number>
revision: <integer, starts at 1>
summary: <one sentence>
next_alpha_index: <integer>
tasks:
  - name: Apollo
    title: <one-line description>
    files: [path/to/file.ts, path/to/other.ts]
    acceptance: <how the Astronaut knows it is done>
    depends_on: []
  - name: Borman
    title: ...
    files: [...]
    acceptance: ...
    depends_on: [Apollo]
open_questions: []
constraints: []
### END PLAN
```

Rules:
- Task names come from the crew roster in `references/crew-roster.md`,
  assigned in alphabetical order starting from the current `plan.next_alpha_index`.
- `depends_on` contains task NAMES (not ids). Declare only genuine dependencies.
- Tasks with `depends_on: []` may run concurrently with other zero-dep tasks.

## Astronaut — ### CREW_REPORT

```
### CREW_REPORT
task: <crew member name>
status: completed | plan_problem
files_changed:
  - path: src/retry.ts
    action: created | modified | deleted
    summary: add exponential backoff with jitter
notes: <assumptions, edge cases skipped — or omit if none>
plan_problem: <only if status=plan_problem>
### END CREW_REPORT
```

## Flight Controller — ### VERDICT

```
### VERDICT
task: <crew member name>
verdict: PASS | FAIL
checks:
  - name: tests
    result: pass | fail | skipped
    output: |
      <first 30 + last 30 lines if long>
    reason: <if skipped>
  - name: lint
    result: pass | fail | skipped
    output: |
      <relevant lines>
  - name: typecheck
    result: pass | fail | skipped
    output: |
      <relevant lines>
  - name: build
    result: pass | fail | skipped
    reason: <if skipped>
  - name: acceptance
    result: pass | fail
    note: <one-line judgement>
fixes_needed:
  - <specific actionable instruction, empty list if PASS>
notes: <optional>
### END VERDICT
```

## Systems Inspector — ### FINDINGS

```
### FINDINGS
language: javascript | python | go | rust | shell | general
findings:
  - file: src/log.ts
    line: 42
    severity: blocker | major | minor | nit
    category: semantic | portability | boundary | hygiene | complexity | test-quality
    summary: ANSI colorize format applied to file transport
    fix_hint: Create separate format objects for console and file transports.
### END FINDINGS
```

If no findings: return the block with `findings: []`.

## CAPCOM — ### TRIAGE

```
### TRIAGE
comments:
  - id: <comment id as integer>
    author: <github username>
    category: actionable | question | approval | nit | ambiguous
    file: src/webhook.ts        # only for actionable/nit
    line: 88                    # only for actionable/nit
    fix_hint: return 404 not 500 for missing webhook id  # only for actionable/nit
    reply_draft: |              # only for question
      The retry uses exponential backoff with jitter...
copilot_present: true | false
### END TRIAGE
```
```

- [ ] **Step 3: Rewrite halt-protocol.md**

Write `plugins/mission/references/halt-protocol.md`:

```markdown
# Halt-and-Ask Protocol

When a phase cannot continue autonomously, print this exact shape and exit.

```
🚨 ABORT SEQUENCE — <phase-name> halted

  Reason: <plain-English explanation — one or two sentences>

  Where we are:
    <one-line state summary, e.g. "Issue #42, liftoff phase, task Drake failed 3 times">

  Your options:
    [1] <plain-English option>          (recommended)
    [2] <plain-English option>
    [3] Abort mission (state preserved — run /mission <N> to resume)

  Enter a number, or describe what you want.
```

Rules:
- The REASON line is plain English. No space jargon in the options.
- Always include an "Abort mission" option as the last numbered option.
- Space flavour is confined to the banner (`🚨 ABORT SEQUENCE`) only.
- Number options so the user can reply with "1" without paraphrasing.
- Do NOT proceed after printing this. Exit the skill and wait for the next
  `/mission <N>` invocation.
- When the user responds, resume by updating state appropriately
  (e.g., `phase_status=pending` to retry, or `task.status=skipped` to skip a task) before re-running.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/references/conventional-commits.md \
        plugins/mission/references/agent-contracts.md \
        plugins/mission/references/halt-protocol.md
git commit -m "docs(mission): update reference docs to space/mission vocabulary"
```

---

### Task 5: Update references/review-rubric.md

Minor updates — replace "First Mate" with "Systems Inspector" and "/mark-the-charts" with "/mission-debrief".

**Files:**
- Modify: `plugins/mission/references/review-rubric.md`

- [ ] **Step 1: Edit the file header**

Find and replace these strings in `plugins/mission/references/review-rubric.md`:

| Find | Replace |
|------|---------|
| `First Mate's Review Rubric` | `Systems Inspector's Review Rubric` |
| `This file is the First Mate's living checklist.` | `This file is the Systems Inspector's living checklist.` |
| `` `/mark-the-charts` `` | `` `/mission-debrief` `` |
| `First Mate` (all occurrences) | `Systems Inspector` |

- [ ] **Step 2: Verify**

```bash
grep -n "First Mate\|mark-the-charts\|pirate" plugins/mission/references/review-rubric.md
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add plugins/mission/references/review-rubric.md
git commit -m "docs(mission): update review rubric agent names"
```

---

### Task 6: Rename + rewrite agent files

Rename all 5 agent files and replace pirate voice with mission-control voice throughout.

**Files:**
- Rename: `agents/navigator.md` → `agents/flight-director.md`
- Rename: `agents/crewmate.md` → `agents/astronaut.md`
- Rename: `agents/quartermaster.md` → `agents/flight-controller.md`
- Rename: `agents/first-mate.md` → `agents/systems-inspector.md`
- Rename: `agents/bosun.md` → `agents/capcom.md`

- [ ] **Step 1: Rename all agent files**

```bash
cd plugins/mission/agents
git mv navigator.md flight-director.md
git mv crewmate.md astronaut.md
git mv quartermaster.md flight-controller.md
git mv first-mate.md systems-inspector.md
git mv bosun.md capcom.md
```

- [ ] **Step 2: Write flight-director.md**

Write `plugins/mission/agents/flight-director.md`:

```markdown
---
name: flight-director
description: Use as the Flight Director in the mission crew. Produces a DAG implementation plan for a GitHub issue — explores the repo, lists discrete tasks each small enough for one Astronaut, assigns crew names, declares file dependencies, and states acceptance criteria. Invoke when Mission Control needs a fresh flight plan, when a revision is required after a constraint is discovered mid-mission, or whenever the user explicitly asks for planning before any code is written.
tools: Read, Grep, Glob, Bash, WebFetch
model: opus
color: blue
---

You are the Flight Director for Mission Control. You plot the flight plan — nothing more, nothing less. Mission Control hands you an issue and a starting name index. You read the issue, scout the repo, and chart the mission. You do NOT write code. You do NOT run tests. You plan.

## What you do

1. Read the full issue body Mission Control provides — title, description, every `- [ ]` checkbox, every acceptance criterion in prose.
2. Scan the repo for context:
   - Relevant source files (`Grep`, `Glob`, `Read`)
   - Test framework and test-file conventions
   - Lint/coverage/build scripts in `package.json`, `pyproject.toml`, `Makefile`, etc.
   - Existing patterns to mirror
3. Decompose the work into **atomic tasks**. Each task is small enough for a single Astronaut — roughly one logical change, one file or a tight cluster of files. Split any task that touches 3+ unrelated files.
4. Assign a crew name to each task in alphabetical order, starting from the `next_alpha_index` Mission Control provides. Load `references/crew-roster.md` for the roster.
5. Declare `depends_on` using task NAMES (not indices). Only declare a genuine dependency — one where the dependent task genuinely needs the prior task's output. Tasks with `depends_on: []` may run concurrently.
6. State the acceptance criterion for each task. "How does the Astronaut know it is done?"
7. Flag constraints and open questions.

## What you do NOT do

- Write code. Not one line.
- Run tests. The Flight Controller handles that.
- Make architectural choices the issue didn't authorise — flag in `open_questions`.
- Pad the plan with ceremony. A two-line typo fix is one task, not five.
- Exceed 52 tasks. If you need more, halt and tell Mission Control to decompose the issue further.

## Return format (strict)

Load `references/agent-contracts.md` for the exact PLAN block format. Your reply MUST contain a single `### PLAN` / `### END PLAN` block. Anything outside is your narration to Mission Control.

```
### PLAN
issue: <number>
revision: <integer, starts at 1>
summary: <one sentence>
next_alpha_index: <integer — the next unused index after this plan's last task>
tasks:
  - name: Apollo
    title: <one-line description of what this task accomplishes>
    files: [path/one, path/two]
    acceptance: <how the Astronaut knows it is done>
    depends_on: []
  - name: Borman
    title: ...
    files: [...]
    acceptance: ...
    depends_on: [Apollo]
open_questions: []
constraints: []
### END PLAN
```

Before returning, sanity-check:
- Every task has at least one file OR a reason it doesn't.
- Every task has an `acceptance` line.
- `depends_on` uses task NAMES, not indices.
- `next_alpha_index` = current `next_alpha_index` + number of tasks in this plan.
- No two tasks edit the same file region (split them if they do).
- Total tasks ≤ 52.
```

- [ ] **Step 3: Write astronaut.md**

Write `plugins/mission/agents/astronaut.md`:

```markdown
---
name: astronaut
description: Use as an Astronaut in the mission crew. Implements exactly ONE task from a Flight Director's plan — no more, no less. Edits the files named in the task, follows the acceptance criterion, and reports back. Invoke once per plan task. Also invoke to re-implement a task when the Flight Controller has rejected an earlier attempt and provided fix instructions.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
color: yellow
---

You are an Astronaut in the mission crew. Mission Control hands you ONE task from the Flight Director's plan. You do that task. You do not freelance, you do not gold-plate, you do not skip ahead to the next task.

## What you do

1. Read the task Mission Control hands you: `name`, `title`, `files`, `acceptance`.
2. Read the named files. If the task lacks files, read whatever the title points at.
3. Make the smallest change that satisfies the acceptance criterion. Match the surrounding code style.
4. If the Flight Controller rejected a prior attempt, Mission Control includes their `fixes_needed` list. Address every item — don't argue, just fix.
5. Run a quick sanity check on your edits (syntax, obvious type errors) — but do NOT claim victory on the full test suite. That is the Flight Controller's job.

## What you do NOT do

- Touch files outside the task's `files` list unless absolutely necessary; flag it in your return if you do.
- Skip ahead to the next task. One Astronaut dispatch = one task.
- Write tests unless the task explicitly asks for tests.
- Self-certify the work as done. Your return is "I made these changes." The Flight Controller decides correctness.
- Refactor adjacent code while you're there. Stay in your lane.

## If you discover the plan is wrong

If the task is impossible as specified (file doesn't exist, dependency missing, contradictory acceptance) — STOP. Don't improvise. Set `plan_problem` in your return. Mission Control will route it to the Flight Director.

## Return format (strict)

Load `references/agent-contracts.md` for the exact CREW_REPORT block format. Your reply MUST contain a single `### CREW_REPORT` / `### END CREW_REPORT` block.

```
### CREW_REPORT
task: <crew member name, e.g. Apollo>
status: completed | plan_problem
files_changed:
  - path: src/retry.ts
    action: created | modified | deleted
    summary: <one-line description of the change>
notes: <assumptions, edge cases skipped — omit section if none>
plan_problem: <only if status=plan_problem>
### END CREW_REPORT
```

Before returning, sanity-check:
- Every file you actually edited appears in `files_changed`.
- `summary` describes what changed, not just the filename.
- Any assumption you made is in `notes`.
```

- [ ] **Step 4: Write flight-controller.md**

Write `plugins/mission/agents/flight-controller.md`:

```markdown
---
name: flight-controller
description: Use as the Flight Controller in the mission crew. Reviews an Astronaut's just-completed task — reads the diff, runs tests/lint/build, and emits a PASS or FAIL verdict with concrete fixes when failing. Invoke after every Astronaut task. Also invoke as a final sweep once all plan tasks complete.
tools: Read, Grep, Glob, Bash
model: sonnet
color: red
---

You are the Flight Controller — keeper of standards in the mission crew. The Astronaut has just finished a task. Your job: verify it. No mercy, no malice — just truth.

## What you do

1. Read the Astronaut's `CREW_REPORT` and the task spec Mission Control hands you.
2. Inspect the diff for the files the Astronaut touched (`git diff --stat`, then `git diff <file>`).
3. Confirm the acceptance criterion is actually met by the diff — not "the file was edited" but "does the edit DO what was promised?"
4. Run the project's quality gates in order:
   - **Tests** — `npm test`, `pytest`, `cargo test`, or whatever the repo uses. Discover the command from `package.json`, `pyproject.toml`, `Makefile`, or CI config.
   - **Lint** — `npm run lint`, `ruff check`, `cargo clippy`, etc.
   - **Type check** — `tsc --noEmit`, `mypy`, `pyright`, etc.
   - **Build** — only if the repo has a build step that catches errors the above miss.
5. If a quality gate doesn't exist for this repo, say so — don't invent one, don't mark it failing.

## What you do NOT do

- Edit code. Ever. Write `fixes_needed` and let the Astronaut fix it.
- Re-run flaky tests until they pass. If a test fails, it failed.
- Hand-wave a failing test. These rationalisations are FORBIDDEN:
  - "The edge case doesn't really come up in practice."
  - "The test was overspecified."
  - "The other tests pass, so the core feature works."
  - "Marking the test skip is basically the same as fixing it."
  - "This is a pre-existing failure, not from this change."

If a test fails, verdict is `FAIL`. Period.

## Return format (strict)

Load `references/agent-contracts.md` for the exact VERDICT block format.

```
### VERDICT
task: <crew member name>
verdict: PASS | FAIL
checks:
  - name: tests
    result: pass | fail | skipped
    output: |
      <first 30 + last 30 lines if long>
    reason: <if skipped, why>
  - name: lint
    result: pass | fail | skipped
    output: |
      <relevant output>
  - name: typecheck
    result: pass | fail | skipped
    output: |
      <relevant output>
  - name: build
    result: pass | fail | skipped
    reason: <if skipped, why>
  - name: acceptance
    result: pass | fail
    note: <one-line judgement>
fixes_needed:
  - <specific actionable instruction — empty list [] if PASS>
notes: <optional context>
### END VERDICT
```

`PASS` iff every check that ran is `pass` AND `acceptance.result: pass`. One `fail` anywhere = `FAIL`. If `FAIL`, `fixes_needed` must be non-empty and each item must be concrete enough to act on without asking clarifying questions.
```

- [ ] **Step 5: Write systems-inspector.md**

Write `plugins/mission/agents/systems-inspector.md`:

```markdown
---
name: systems-inspector
description: Use as the Systems Inspector in the mission crew. Reviews the diff for a specific language bucket against the living review rubric, surfacing semantic and quality issues the Flight Controller's mechanical checks cannot catch. Invoke in parallel — one Systems Inspector per language bucket — after liftoff completes and before docking.
tools: Read, Grep, Glob, Bash
model: opus
color: green
---

You are the Systems Inspector in the mission crew. The build passed the Flight Controller's checks — tests, lint, types, build are all green. Now your job: read the diff with a thinking eye and surface semantic and quality problems that no machine check catches.

## What you do

1. Read the diff bundle Mission Control hands you (for your language bucket only).
2. Load `references/review-rubric.md` and work through EVERY category in it.
3. For each finding:
   - Cite the exact `file:line`.
   - Assign severity: `blocker` (PR cannot ship), `major` (should fix), `minor` (improves quality), `nit` (style only).
   - Assign category from the rubric.
   - State the problem in one sentence.
   - Suggest a fix in ≤ 2 sentences. Do NOT write the patch.
4. Check `declined_findings` — if a finding you are about to raise appears there, DO NOT raise it. Period. Honour what was previously declined.
5. If you find nothing ≥ minor, return `findings: []`.

## What you do NOT do

- Re-flag things the Flight Controller already checked: test failures, lint errors, type errors, build failures.
- Write code or patches.
- Raise a finding that appears in `declined_findings`.
- Pad your return with "looks good" commentary. Either there is a finding or there isn't.
- Flag things below `nit` severity. If it doesn't reach nit, don't mention it.

## Language buckets

You are dispatched for ONE bucket only. Ignore files outside your bucket:

| Bucket | Extensions |
|---|---|
| javascript | .ts .tsx .js .jsx .mts .cts .mjs .cjs |
| python | .py .pyw |
| go | .go |
| rust | .rs |
| shell | .sh .bash .zsh |
| general | everything else (yaml, json, markdown, etc.) |

## Return format (strict)

Load `references/agent-contracts.md` for the exact FINDINGS block format. Your reply MUST contain a single `### FINDINGS` / `### END FINDINGS` block.

```
### FINDINGS
language: <bucket name>
findings:
  - file: src/log.ts
    line: 42
    severity: blocker | major | minor | nit
    category: semantic | portability | boundary | hygiene | complexity | test-quality
    summary: <one sentence describing the problem>
    fix_hint: <one or two sentences on how to fix it — no patch code>
### END FINDINGS
```

If no findings: `findings: []` in the block.

Before returning, sanity-check:
- Every finding has a `file:line` reference.
- No finding appears in `declined_findings`.
- Severity is honest — do not soften `blocker` to `major` to avoid causing a repair round.
```

- [ ] **Step 6: Write capcom.md**

Write `plugins/mission/agents/capcom.md`:

```markdown
---
name: capcom
description: Use as CAPCOM in the mission crew. Categorises incoming PR comments so Mission Control knows which to act on, which to answer, and which to ignore. Invoke once per comms round with the new comments since the last visit.
tools: Read, Bash
model: sonnet
color: purple
---

You are CAPCOM — you talk to the outside world so Mission Control doesn't have to. PR comments have come in. Your job: sort them cleanly so Mission Control knows what to do with each one.

## What you do

For every comment in the list Mission Control gives you, assign exactly ONE category:

- **actionable** — A concrete change request. The reviewer clearly says "do X" or "X is wrong, change it to Y." An Astronaut can implement this.
  - Must identify `file` and `line` if the comment is on a specific line.
  - Must provide a `fix_hint` (one sentence).

- **question** — The reviewer is asking how or why something works. Needs a written reply, not a code change.
  - Draft a `reply_draft` in plain English. Mission Control will approve before posting.

- **approval** — "LGTM", "👍", "Looks good to me", ":+1:", inline approval comments. No action needed.

- **nit** — Style-only comment (whitespace, quote style, rename suggestion with no semantic impact). No action unless Mission Control opts in.

- **ambiguous** — Could be a request OR a question — you genuinely cannot tell. Flag it and halt. Do NOT guess intent.

## Copilot detection

Set `copilot_present: true` if ANY of the following are true:
- A review is authored by a user whose login contains `copilot` (case-insensitive).
- A review is authored by `github-actions[bot]` with a body mentioning "Copilot".

## What you do NOT do

- Guess at ambiguous comments. Mark them `ambiguous` and let Mission Control sort it out.
- Write code or patches.
- Reply to comments yourself. Draft the reply and wait for Mission Control's approval.
- Mark architectural pushback (e.g., "this whole approach is wrong") as `actionable`. That is `ambiguous` — it needs Mission Control.

## Return format (strict)

Load `references/agent-contracts.md` for the exact TRIAGE block format. Your reply MUST contain a single `### TRIAGE` / `### END TRIAGE` block.

```
### TRIAGE
comments:
  - id: 123456789
    author: alice
    category: actionable | question | approval | nit | ambiguous
    file: src/webhook.ts        # only for actionable or nit
    line: 88                    # only for actionable or nit
    fix_hint: return 404 not 500 when webhook id is not found
    reply_draft: |              # only for question
      The retry uses exponential backoff with full jitter.
      Maximum delay is capped at 30 seconds after 5 attempts.
copilot_present: true | false
### END TRIAGE
```

Before returning, sanity-check:
- Every comment in the input has exactly one entry in the output.
- `actionable` comments have `fix_hint` set.
- `question` comments have `reply_draft` set, in plain English.
- No comment is both `actionable` and `ambiguous`.
```

- [ ] **Step 7: Commit**

```bash
git add plugins/mission/agents/
git commit -m "feat(mission): rename and rewrite all 5 agent files to mission control theme"
```

---

### Task 7: Rename + rewrite shell scripts (init + read)

**Files:**
- Rename: `scripts/voyage-state-init.sh` → `scripts/mission-state-init.sh`
- Rename: `scripts/voyage-state-read.sh` → `scripts/mission-state-read.sh`

- [ ] **Step 1: Rename**

```bash
cd plugins/mission/scripts
git mv voyage-state-init.sh mission-state-init.sh
git mv voyage-state-read.sh mission-state-read.sh
```

- [ ] **Step 2: Write mission-state-init.sh**

Write `plugins/mission/scripts/mission-state-init.sh`:

```bash
#!/usr/bin/env bash
# mission-state-init.sh <issue_num> <title> <repo> <branch> <worktree> <base> <base_sha>
# Creates $CLAUDE_PLUGIN_DATA/mission-state/issue-<N>.json
# Idempotent: exits 0 immediately if file already exists.
set -euo pipefail

ISSUE_NUMBER="$1"
ISSUE_TITLE="$2"
REPO="$3"
BRANCH_NAME="$4"
WORKTREE_PATH="$5"
BASE_BRANCH="$6"
BASE_SHA="$7"

STATE_DIR="${CLAUDE_PLUGIN_DATA}/mission-state"
STATE_FILE="${STATE_DIR}/issue-${ISSUE_NUMBER}.json"

[ -f "$STATE_FILE" ] && exit 0

mkdir -p "$STATE_DIR"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP="${STATE_FILE}.tmp"

jq -n \
  --argjson num "$ISSUE_NUMBER" \
  --arg title "$ISSUE_TITLE" \
  --arg repo "$REPO" \
  --arg branch "$BRANCH_NAME" \
  --arg worktree "$WORKTREE_PATH" \
  --arg base "$BASE_BRANCH" \
  --arg sha "$BASE_SHA" \
  --arg now "$NOW" \
'{
  schema_version: 2,
  issue: {
    number: $num,
    title: $title,
    repo: $repo,
    url: ("https://github.com/" + $repo + "/issues/" + ($num | tostring))
  },
  branch: {
    name: $branch,
    worktree_path: $worktree,
    base: $base,
    base_sha_at_start: $sha
  },
  phase: "pre-launch",
  phase_status: "pending",
  halted_reason: null,
  plan: {
    navigator_attempts: 0,
    next_alpha_index: 0,
    tasks: []
  },
  systems_check: {
    attempts: 0,
    attempt_cap: 3,
    findings: [],
    fixed_findings: [],
    declined_findings: []
  },
  pr: {
    number: null,
    url: null,
    opened_at: null,
    last_comment_id_seen: null,
    copilot_was_requested: false,
    watcher_scheduled: false
  },
  history: [{at: $now, phase: "pre-launch", event: "initialized"}],
  created_at: $now,
  updated_at: $now
}' > "$TMP"

mv "$TMP" "$STATE_FILE"
```

- [ ] **Step 3: Write mission-state-read.sh**

Write `plugins/mission/scripts/mission-state-read.sh`:

```bash
#!/usr/bin/env bash
# mission-state-read.sh <issue_number>
# Prints full state JSON to stdout. Exits 1 if file does not exist.
set -euo pipefail

ISSUE_NUMBER="$1"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUMBER}.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: No mission state found for issue #${ISSUE_NUMBER}" >&2
  exit 1
fi

cat "$STATE_FILE"
```

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/scripts/mission-state-init.sh plugins/mission/scripts/mission-state-read.sh
git commit -m "feat(mission): rename and update state init/read scripts to mission-state"
```

---

### Task 8: Rename + rewrite mission-state-update.sh + mission-print-log.sh

**Files:**
- Rename: `scripts/voyage-state-update.sh` → `scripts/mission-state-update.sh`
- Rename: `scripts/voyage-print-log.sh` → `scripts/mission-print-log.sh`

- [ ] **Step 1: Rename**

```bash
cd plugins/mission/scripts
git mv voyage-state-update.sh mission-state-update.sh
git mv voyage-print-log.sh mission-print-log.sh
```

- [ ] **Step 2: Write mission-state-update.sh**

Write `plugins/mission/scripts/mission-state-update.sh`:

```bash
#!/usr/bin/env bash
# mission-state-update.sh <issue_number> <key> <value>
#
# Keys:
#   phase               <phase-name>
#   phase_status        pending|in_progress|completed|halted
#   halted_reason       <string>
#   pr_number           <integer as string>
#   pr_url              <url string>
#   pr_last_comment     <integer as string>
#   pr_copilot          true|false
#   pr_watcher          true|false
#   plan_next_alpha     <integer as string>
#   plan_tasks_replace  <json array string>
#   plan_task_status    <name>:<status>
#   plan_task_verdict   <name>:PASS|FAIL
#   plan_task_commit    <name>:<sha>
#   plan_task_attempts_inc <name>
#   history_append      <json object string>
#   systems_check_attempts_inc  (value ignored)
set -euo pipefail

ISSUE_NUMBER="$1"
KEY="$2"
VALUE="${3:-}"

STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUMBER}.json"
TMP="${STATE_FILE}.tmp"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: No state file for issue #${ISSUE_NUMBER}" >&2
  exit 1
fi

case "$KEY" in
  phase)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.phase = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  phase_status)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.phase_status = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  halted_reason)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.halted_reason = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_number)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.number = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_url)
    jq --arg v "$VALUE" --arg now "$NOW" \
      '.pr.url = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_last_comment)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.last_comment_id_seen = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_copilot)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.copilot_was_requested = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  pr_watcher)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.pr.watcher_scheduled = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  plan_next_alpha)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.plan.next_alpha_index = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  plan_tasks_replace)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.plan.tasks = $v | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  plan_task_status)
    NAME="${VALUE%%:*}"; STATUS="${VALUE#*:}"
    jq --arg name "$NAME" --arg status "$STATUS" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .status) = $status | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  plan_task_verdict)
    NAME="${VALUE%%:*}"; VERDICT="${VALUE#*:}"
    jq --arg name "$NAME" --arg v "$VERDICT" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .quartermaster_verdict) = $v | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  plan_task_commit)
    NAME="${VALUE%%:*}"; SHA="${VALUE#*:}"
    jq --arg name "$NAME" --arg sha "$SHA" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .commit_sha) = $sha | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  plan_task_attempts_inc)
    jq --arg name "$VALUE" --arg now "$NOW" \
      '(.plan.tasks[] | select(.name == $name) | .crewmate_attempts) += 1 | .updated_at = $now' \
      "$STATE_FILE" > "$TMP" ;;
  history_append)
    jq --argjson v "$VALUE" --arg now "$NOW" \
      '.history += [$v] | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  systems_check_attempts_inc)
    jq --arg now "$NOW" \
      '.systems_check.attempts += 1 | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  *)
    echo "ERROR: Unknown key: $KEY" >&2; exit 1 ;;
esac

mv "$TMP" "$STATE_FILE"
```

- [ ] **Step 3: Write mission-print-log.sh**

Write `plugins/mission/scripts/mission-print-log.sh`:

```bash
#!/usr/bin/env bash
# mission-print-log.sh <issue_number>
# Prints ASCII summary and markdown chronicle from state history.
set -euo pipefail

ISSUE_NUMBER="$1"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUMBER}.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "No mission state for issue #${ISSUE_NUMBER}" >&2; exit 1
fi

S=$(cat "$STATE_FILE")

TITLE=$(echo "$S" | jq -r '.issue.title')
PR_NUM=$(echo "$S" | jq -r '.pr.number // "—"')

# Phase completion check: look for completed event in history
phase_done() {
  echo "$S" | jq -e --arg p "$1" \
    '[.history[] | select(.phase == $p and .event == "completed")] | length > 0' \
    > /dev/null 2>&1 && echo "✓" || echo "·"
}

PLAN_COUNT=$(echo "$S" | jq '[.plan.tasks[] | select(.origin == "plan" or .origin == null)] | length')
PLAN_PASS=$(echo "$S" | jq '[.plan.tasks[] | select((.origin == "plan" or .origin == null) and .status == "completed")] | length')
INSPECT_COUNT=$(echo "$S" | jq '[.plan.tasks[] | select(.origin == "systems-check")] | length')
COMMS_COUNT=$(echo "$S" | jq '[.history[] | select(.phase == "comms" and .event == "round_complete")] | length')
TOTAL_COMMITS=$(echo "$S" | jq '[.plan.tasks[] | select(.commit_sha != null)] | length')

echo "═══════════════════════════════════════════════════════"
printf "  MISSION  🚀  issue #%s — %s\n" "$ISSUE_NUMBER" "$TITLE"
echo "═══════════════════════════════════════════════════════"
printf "  pre-launch      %s  (%s tasks planned)\n"        "$(phase_done pre-launch)" "$PLAN_COUNT"
printf "  liftoff         %s  (%s/%s passed)\n"            "$(phase_done liftoff)" "$PLAN_PASS" "$PLAN_COUNT"
printf "  systems-check   %s  (%s repairs)\n"              "$(phase_done systems-check)" "$INSPECT_COUNT"
printf "  docking         %s  (PR #%s)\n"                  "$(phase_done docking)" "$PR_NUM"
printf "  comms           %s  (%s rounds)\n"               "$(phase_done comms)" "$COMMS_COUNT"
echo "═══════════════════════════════════════════════════════"
printf "  Total: %s commits\n" "$TOTAL_COMMITS"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "## 🚀 Mission log — issue #${ISSUE_NUMBER}"
echo ""
echo "$S" | jq -r '
  .history[] |
  "- \(.at | split("T")[1] | split("Z")[0])  [\(.phase)]  \(.event)" +
  (if .task then "  task=\(.task)" else "" end) +
  (if .tasks then "  tasks=\(.tasks)" else "" end)
'
```

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/scripts/mission-state-update.sh plugins/mission/scripts/mission-print-log.sh
git commit -m "feat(mission): rename and update state update/print-log scripts"
```

---

### Task 9: Update test scripts + verify tests pass

**Files:**
- Modify: `plugins/mission/scripts/test/test-state-init.sh`
- Modify: `plugins/mission/scripts/test/test-state-update.sh`

- [ ] **Step 1: Write test-state-init.sh**

Write `plugins/mission/scripts/test/test-state-init.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR=$(mktemp -d)
export CLAUDE_PLUGIN_DATA="$TMPDIR"

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== test-state-init.sh ==="

# --- Test 1: creates state file ---
"$SCRIPT_DIR/mission-state-init.sh" 42 "Add retry" "owner/repo" \
  "claude/issue-42-add-retry" "$TMPDIR/wt" "main" "abc123"
[ -f "$TMPDIR/mission-state/issue-42.json" ] \
  && ok "creates state file" || fail "creates state file"

# --- Test 2: correct schema_version ---
jq -e '.schema_version == 2' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "schema_version == 2" || fail "schema_version == 2"

# --- Test 3: correct issue number (integer, not string) ---
jq -e '.issue.number == 42' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "issue.number == 42" || fail "issue.number == 42"

# --- Test 4: initial phase is pre-launch ---
jq -e '.phase == "pre-launch"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "phase == pre-launch" || fail "phase == pre-launch"

# --- Test 5: initial phase_status is pending ---
jq -e '.phase_status == "pending"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "phase_status == pending" || fail "phase_status == pending"

# --- Test 6: plan.tasks is empty array ---
jq -e '.plan.tasks == []' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "plan.tasks == []" || fail "plan.tasks == []"

# --- Test 7: plan.next_alpha_index is 0 ---
jq -e '.plan.next_alpha_index == 0' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "plan.next_alpha_index == 0" || fail "plan.next_alpha_index == 0"

# --- Test 8: idempotency — second call does not overwrite ---
"$SCRIPT_DIR/mission-state-init.sh" 42 "Different title" "owner/repo" \
  "claude/issue-42-add-retry" "$TMPDIR/wt" "main" "abc123"
TITLE=$(jq -r '.issue.title' "$TMPDIR/mission-state/issue-42.json")
[ "$TITLE" = "Add retry" ] \
  && ok "idempotent (title not overwritten)" || fail "idempotent (title not overwritten)"

# --- Test 9: different issues get separate files ---
"$SCRIPT_DIR/mission-state-init.sh" 99 "Other issue" "owner/repo" \
  "claude/issue-99-other" "$TMPDIR/wt2" "main" "def456"
[ -f "$TMPDIR/mission-state/issue-99.json" ] \
  && ok "separate file for issue 99" || fail "separate file for issue 99"
[ -f "$TMPDIR/mission-state/issue-42.json" ] \
  && ok "issue 42 file still exists" || fail "issue 42 file still exists"

echo ""
echo "Results: $PASS passed, $FAIL failed"
rm -rf "$TMPDIR"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Write test-state-update.sh**

Write `plugins/mission/scripts/test/test-state-update.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR=$(mktemp -d)
export CLAUDE_PLUGIN_DATA="$TMPDIR"

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== test-state-update.sh ==="

# Seed a state file
"$SCRIPT_DIR/mission-state-init.sh" 42 "Test issue" "owner/repo" \
  "claude/issue-42-test" "$TMPDIR/wt" "main" "abc123"

# --- Test: mission-state-read.sh returns valid JSON ---
JSON=$("$SCRIPT_DIR/mission-state-read.sh" 42)
echo "$JSON" | jq -e '.phase == "pre-launch"' > /dev/null \
  && ok "read returns valid state JSON" || fail "read returns valid state JSON"

# --- Test: read on missing file exits 1 ---
"$SCRIPT_DIR/mission-state-read.sh" 999 2>/dev/null && fail "should exit 1 for missing" \
  || ok "read exits 1 for missing state file"

# --- Test: update phase ---
"$SCRIPT_DIR/mission-state-update.sh" 42 phase "liftoff"
jq -e '.phase == "liftoff"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "update phase" || fail "update phase"

# --- Test: update phase_status ---
"$SCRIPT_DIR/mission-state-update.sh" 42 phase_status "in_progress"
jq -e '.phase_status == "in_progress"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "update phase_status" || fail "update phase_status"

# --- Test: update pr_number (integer) ---
"$SCRIPT_DIR/mission-state-update.sh" 42 pr_number "128"
jq -e '.pr.number == 128' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "update pr_number as integer" || fail "update pr_number as integer"

# --- Test: update pr_url (string) ---
"$SCRIPT_DIR/mission-state-update.sh" 42 pr_url "https://github.com/owner/repo/pull/128"
jq -e '.pr.url == "https://github.com/owner/repo/pull/128"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "update pr_url" || fail "update pr_url"

# --- Test: update plan_next_alpha ---
"$SCRIPT_DIR/mission-state-update.sh" 42 plan_next_alpha "5"
jq -e '.plan.next_alpha_index == 5' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "update plan_next_alpha" || fail "update plan_next_alpha"

# --- Test: plan_tasks_replace ---
TASKS='[{"name":"Apollo","title":"test task","files":["src/a.ts"],"depends_on":[],"status":"pending","crewmate_attempts":0,"quartermaster_verdict":null,"commit_sha":null,"origin":"plan","notes":""}]'
"$SCRIPT_DIR/mission-state-update.sh" 42 plan_tasks_replace "$TASKS"
jq -e '.plan.tasks | length == 1' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "plan_tasks_replace sets tasks" || fail "plan_tasks_replace sets tasks"
jq -e '.plan.tasks[0].name == "Apollo"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "plan_tasks_replace task name is Apollo" || fail "plan_tasks_replace task name is Apollo"

# --- Test: plan_task_status ---
"$SCRIPT_DIR/mission-state-update.sh" 42 plan_task_status "Apollo:completed"
jq -e '.plan.tasks[0].status == "completed"' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "plan_task_status update" || fail "plan_task_status update"

# --- Test: history_append ---
EVENT='{"at":"2026-05-23T21:00:00Z","phase":"liftoff","event":"task_passed","task":"Apollo"}'
"$SCRIPT_DIR/mission-state-update.sh" 42 history_append "$EVENT"
jq -e '.history | length == 2' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "history_append adds entry" || fail "history_append adds entry"

# --- Test: updated_at is refreshed on every update ---
OLD_TS=$(jq -r '.updated_at' "$TMPDIR/mission-state/issue-42.json")
sleep 1
"$SCRIPT_DIR/mission-state-update.sh" 42 phase "systems-check"
NEW_TS=$(jq -r '.updated_at' "$TMPDIR/mission-state/issue-42.json")
[ "$OLD_TS" != "$NEW_TS" ] \
  && ok "updated_at refreshed on update" || fail "updated_at refreshed on update"

# --- Test: systems_check_attempts_inc ---
"$SCRIPT_DIR/mission-state-update.sh" 42 systems_check_attempts_inc ""
jq -e '.systems_check.attempts == 1' "$TMPDIR/mission-state/issue-42.json" > /dev/null \
  && ok "systems_check_attempts_inc" || fail "systems_check_attempts_inc"

# --- Test: atomic write (no partial state file on error) ---
ls "$TMPDIR/mission-state/"*.tmp 2>/dev/null && fail "stale .tmp file found" \
  || ok "no stale .tmp files"

echo ""
echo "Results: $PASS passed, $FAIL failed"
rm -rf "$TMPDIR"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 3: Run both tests**

```bash
bash plugins/mission/scripts/test/test-state-init.sh
bash plugins/mission/scripts/test/test-state-update.sh
```

Expected: all tests pass, 0 failed for both.

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/scripts/test/
git commit -m "test(mission): update state tests for mission-state scripts and space names"
```

---

### Task 10: Rename + rewrite pre-launch and liftoff skills

**Files:**
- Rename: `skills/chart-course/SKILL.md` → `skills/pre-launch/SKILL.md`
- Rename: `skills/set-sail/SKILL.md` → `skills/liftoff/SKILL.md`

- [ ] **Step 1: Rename skill directories**

```bash
cd plugins/mission/skills
git mv chart-course pre-launch
git mv set-sail liftoff
```

- [ ] **Step 2: Write pre-launch/SKILL.md**

Write `plugins/mission/skills/pre-launch/SKILL.md`:

```markdown
---
name: pre-launch
description: Use when the user wants to start planning an issue in the mission workflow, or when /mission dispatches the pre-launch phase. Trigger on "pre-launch <N>", "/pre-launch", or when mission state shows phase=pre-launch and phase_status=pending. Reads the GitHub issue, creates a worktree, dispatches Flight Director, writes the flight plan to state, and asks for confirmation before liftoff.
---

# Phase 1 — Pre-Launch

Read issue #N, create a worktree, dispatch the Flight Director, write the
flight plan to the mission state file, and confirm with the user before liftoff.

## Step 1: Resolve issue number and repo

```bash
# Prefer argument, then branch name, then ask
ISSUE_NUM="${ARGS:-}"
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi
# If still empty, ask the user: "Which issue number?"
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

## Step 2: Read the issue

```bash
ISSUE_JSON=$(gh issue view "$ISSUE_NUM" --repo "$REPO" \
  --json number,title,body,labels,milestone)
ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
```

## Step 3: Create branch and worktree

If a branch `claude/issue-<N>-*` already exists locally or remotely, check
it out. Otherwise create it:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null | sed 's|^origin/||')
BASE=${BASE:-main}
git fetch origin "$BASE"
BASE_SHA=$(git rev-parse "origin/$BASE")

SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | \
  sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-50 | sed 's/-$//')
BRANCH="claude/issue-${ISSUE_NUM}-${SLUG}"
WORKTREE_PATH="${HOME}/wt/issue-${ISSUE_NUM}"

# Create branch from base if it doesn't exist
git show-ref --verify --quiet "refs/heads/$BRANCH" || \
  git branch "$BRANCH" "origin/$BASE"

# Create worktree if it doesn't exist
[ -d "$WORKTREE_PATH" ] || \
  git worktree add "$WORKTREE_PATH" "$BRANCH"
```

## Step 4: Initialise state file

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
bash "$SCRIPT_DIR/mission-state-init.sh" \
  "$ISSUE_NUM" "$ISSUE_TITLE" "$REPO" \
  "$BRANCH" "$WORKTREE_PATH" "$BASE" "$BASE_SHA"
```

If init returned without error (idempotent), read current state to check
if this phase was already completed:

```bash
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
if [ "$PHASE" != "pre-launch" ] || [ "$PHASE_STATUS" = "completed" ]; then
  echo "Pre-launch already complete. Run /liftoff $ISSUE_NUM to continue."
  exit 0
fi
```

## Step 5: Move project board card to In Progress

```bash
PROJECT_ID=$(gh issue view "$ISSUE_NUM" --repo "$REPO" \
  --json projectItems --jq '.projectItems[0].id // empty')
if [ -n "$PROJECT_ID" ]; then
  gh issue edit "$ISSUE_NUM" --repo "$REPO" 2>/dev/null || true
fi
```

## Step 6: Dispatch Flight Director

Read current `plan.next_alpha_index` from state (0 for a fresh mission).
Dispatch the Flight Director sub-agent:

```
Agent(flight-director, context={
  issue_number: ISSUE_NUM,
  issue_body: ISSUE_JSON.body,
  issue_title: ISSUE_TITLE,
  repo: REPO,
  worktree_path: WORKTREE_PATH,
  next_alpha_index: 0,
  instructions: "Load references/agent-contracts.md for the PLAN block format.
                 Load references/crew-roster.md for the task name roster.
                 Start naming tasks from index 0."
})
```

Parse the `### PLAN` / `### END PLAN` block from the Flight Director's response.
If the Flight Director returns an `open_questions` list, surface them to the user
before proceeding.

## Step 7: Write flight plan to state

Convert the Flight Director's tasks into the state-file task schema and write:

```bash
# Build tasks JSON array from PLAN block
TASKS_JSON=$(echo "$PLAN_BLOCK" | python3 -c "
import sys, json, yaml
plan = yaml.safe_load(sys.stdin)
tasks = []
for t in plan['tasks']:
    tasks.append({
        'name': t['name'],
        'title': t['title'],
        'files': t['files'],
        'depends_on': t.get('depends_on', []),
        'status': 'pending',
        'crewmate_attempts': 0,
        'quartermaster_verdict': None,
        'commit_sha': None,
        'origin': 'plan',
        'notes': ''
    })
print(json.dumps(tasks))
")

bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_tasks_replace "$TASKS_JSON"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_next_alpha \
  "$(echo "$PLAN_BLOCK" | grep '^next_alpha_index:' | awk '{print $2}')"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"pre-launch\",\"event\":\"completed\",\"tasks\":$(echo "$TASKS_JSON" | jq length)}"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
```

## Step 8: Present flight plan and confirm

Print the flight plan in a readable table:

```
Flight plan ready for issue #N:

  Name          Title                                    Files
  ──────────────────────────────────────────────────────────────
  Apollo        Add exponential backoff helper           src/retry.ts
  Borman        Wire retry into webhook sender           src/webhook.ts  [->Apollo]
  Cassini       Add tests for retry logic                src/retry.test.ts

Ready for liftoff? [Y/n]  (or pass --auto to skip this confirmation)
```

If the user says `n` or provides feedback, re-dispatch the Flight Director with
the user's feedback as revision instructions, and repeat from Step 6.

If the user says `y` (or `--auto` was passed), print:

```
All systems go — mission is ready for liftoff on issue #N. Run /liftoff N (or /mission N) to build.
```

The phase is already marked `completed` in state. `/mission N` will advance
to `liftoff` on the next invocation.
```

- [ ] **Step 3: Write liftoff/SKILL.md**

Write `plugins/mission/skills/liftoff/SKILL.md`:

```markdown
---
name: liftoff
description: Use when the mission is in liftoff phase, or when /mission dispatches the liftoff phase. Executes the Flight Director's plan by dispatching Astronauts in parallel for ready tasks and verifying with the Flight Controller. Trigger on "liftoff <N>" or when mission state shows phase=liftoff.
---

# Phase 2 — Liftoff

Execute the Flight Director's plan. Dispatch Astronauts in parallel for tasks
whose dependencies are satisfied, verify with the Flight Controller, commit
on PASS, and loop until all tasks are complete.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')

[ "$PHASE" = "liftoff" ] || { echo "Not in liftoff phase (current: $PHASE)"; exit 1; }
[ "$PHASE_STATUS" != "halted" ] || {
  echo "Mission halted. Resolve the halt condition first."
  echo "Halted reason: $(echo "$STATE" | jq -r '.halted_reason')"
  exit 1
}

cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
```

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"liftoff\",\"event\":\"started\"}"
```

## Step 3: Round dispatch loop

Repeat until all tasks are `completed` or a halt condition is triggered.

**Computing the ready batch:** A task is ready if:
1. `status == "pending"`, AND
2. all tasks in `depends_on` have `status == "completed"`, AND
3. no other ready task in this batch shares a file in `files`.

The third condition serialises tasks that touch the same file even when
they have no explicit dependency — prevents Astronauts from racing on the
same file.

If the ready batch is empty and any task is still `pending`, a deadlock
or unresolvable dependency exists: halt with reason.

**Dispatch (parallel — ALL in ONE message):**

For each task in the ready batch, send one `Agent` call to the Astronaut.
All calls in a single message so they execute concurrently:

```
Agent(astronaut, context={task: Apollo, files: [...], acceptance: "...", ...})
Agent(astronaut, context={task: Borman, ...})
Agent(astronaut, context={task: Cassini, ...})
```

Collect all CREW_REPORTs. If any has `status: plan_problem`, halt with the
plan problem description and ask user whether to re-plan, skip, or abort.

**Verify (parallel — ALL in ONE message):**

For each completed CREW_REPORT, dispatch one Flight Controller:

```
Agent(flight-controller, context={task: Apollo, crew_report: ..., ...})
Agent(flight-controller, context={task: Borman, crew_report: ..., ...})
```

**Process verdicts:**

For each VERDICT:
- `PASS`:
  1. Stage and commit (sequential, one commit per task):
     ```bash
     cd "$WORKTREE_PATH"
     git add <files from CREW_REPORT>
     git commit -m "feat(<scope>): <name> — <title>

     Refs #$ISSUE_NUM"
     ```
  2. Record commit SHA:
     ```bash
     SHA=$(git rev-parse HEAD)
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_commit "<name>:$SHA"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:completed"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
       "{\"at\":\"...\",\"phase\":\"liftoff\",\"event\":\"task_passed\",\"task\":\"<name>\"}"
     ```
- `FAIL`:
  1. Increment attempt counter:
     ```bash
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_attempts_inc "<name>"
     bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:pending"
     ```
  2. If `crewmate_attempts < 3`: task re-enters the queue with `fixes_needed` attached.
  3. If `crewmate_attempts == 3`: halt.

**Halt format (load `references/halt-protocol.md`):**
```
🚨 ABORT SEQUENCE — liftoff halted

  Reason: Task <name> failed 3 times. Last Flight Controller fixes_needed:
    - <fix 1>
    - <fix 2>

  Where we are:
    Issue #<N>, liftoff phase. <X>/<total> tasks completed.

  Your options:
    [1] Re-dispatch Astronaut with the fixes above (recommended)
    [2] Skip this task and continue
    [3] Re-plan (re-dispatch Flight Director with current constraints)
    [4] Abort mission (state preserved)
```

## Step 4: All tasks complete — advance phase

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"liftoff\",\"event\":\"completed\"}"
echo "All crew reported in — liftoff complete. Run /systems-check $ISSUE_NUM (or /mission $ISSUE_NUM) to review."
```

## Parallelism cap

Dispatch at most **5 Astronauts per round** and at most **5 Flight Controllers per round**. If the ready batch exceeds 5, dispatch the first 5, collect verdicts, commit PASSed tasks, then compute the next ready batch for the next round.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/skills/pre-launch/ plugins/mission/skills/liftoff/
git commit -m "feat(mission): rename and rewrite pre-launch and liftoff phase skills"
```

---

### Task 11: Rename + rewrite systems-check and docking skills

**Files:**
- Rename: `skills/inspection/SKILL.md` → `skills/systems-check/SKILL.md`
- Rename: `skills/make-port/SKILL.md` → `skills/docking/SKILL.md`

- [ ] **Step 1: Rename skill directories**

```bash
cd plugins/mission/skills
git mv inspection systems-check
git mv make-port docking
```

- [ ] **Step 2: Write systems-check/SKILL.md**

Write `plugins/mission/skills/systems-check/SKILL.md`:

```markdown
---
name: systems-check
description: Use when the mission is in systems-check phase, or when /mission dispatches systems-check. Dispatches Systems Inspectors in parallel by language bucket on the full branch diff, promotes findings to repair tasks, loops Astronaut fixes until clean or attempt cap. Trigger on "systems-check <N>" or when mission state shows phase=systems-check.
---

# Phase 3 — Systems Check

Dispatch polyglot Systems Inspectors on the full branch diff. Findings become
repair tasks executed by Astronauts. Loop until clean or cap reached.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "systems-check" ] || { echo "Not in systems-check phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
BASE_SHA=$(echo "$STATE" | jq -r '.branch.base_sha_at_start')
ATTEMPT_CAP=$(echo "$STATE" | jq -r '.systems_check.attempt_cap')
DECLINED=$(echo "$STATE" | jq '.systems_check.declined_findings')
RUBRIC=$(cat "${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md")
```

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"systems-check\",\"event\":\"started\"}"
```

## Step 3: Systems check loop

Repeat until clean or cap reached.

**3a. Compute diff and bucket by language:**

```bash
DIFF=$(git diff "$BASE_SHA"...HEAD)
JS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(ts|tsx|js|jsx|mts|cts)$' || true)
PY_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.py$' || true)
GO_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.go$' || true)
RS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.rs$' || true)
SH_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(sh|bash|zsh)$' || true)
OTHER_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | \
  grep -Ev '\.(ts|tsx|js|jsx|mts|cts|py|go|rs|sh|bash|zsh)$' || true)
```

**3b. Dispatch Systems Inspectors in parallel — one per non-empty bucket (single message):**

```
Agent(systems-inspector, language=javascript, files=JS_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(systems-inspector, language=python,     files=PY_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(systems-inspector, language=go,         files=GO_FILES, ...)
Agent(systems-inspector, language=rust,       files=RS_FILES, ...)
Agent(systems-inspector, language=shell,      files=SH_FILES, ...)
Agent(systems-inspector, language=general,    files=OTHER_FILES, ...)
```

Omit any Agent call for an empty bucket.

**3c. Collect and deduplicate findings:**

Merge all FINDINGS blocks. Deduplicate by `(file, line, summary)`.

**3d. Check for clean:**

If `findings` contains no item with severity `blocker`, `major`, or `minor`:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"...\",\"phase\":\"systems-check\",\"event\":\"completed\"}"
echo "Systems check clear — no significant findings. Run /docking $ISSUE_NUM (or /mission $ISSUE_NUM)."
exit 0
```

Nits are listed in the mission log but do not block progress.

**3e. Promote findings to repair tasks:**

```bash
NEXT_IDX=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" | jq '.plan.next_alpha_index')
# For each finding of severity blocker/major/minor, create a repair task with
# the next crew name from the roster, origin="systems-check".
# Use references/crew-roster.md to look up name at index NEXT_IDX.
```

Add repair tasks to state via `plan_tasks_replace` (extend existing array).
Update `plan_next_alpha`.

**3f. Run repair round:**

Dispatch Astronauts and Flight Controllers using the same parallel round logic
as liftoff (see liftoff skill §Step 3). Repair tasks use the same 3-attempt
per-task cap.

After the round, commit any PASSed repair tasks with:
```
fix(<scope>): <name> — <finding summary>

Refs #<ISSUE_NUM>
```

**3g. Increment systems-check attempt counter:**

```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" systems_check_attempts_inc ""
```

Check cap:
```bash
ATTEMPTS=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" | jq '.systems_check.attempts')
if [ "$ATTEMPTS" -ge "$ATTEMPT_CAP" ]; then
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" halted_reason \
    "Systems check attempt cap ($ATTEMPT_CAP) reached. Open findings remain."
  echo "🚨 ABORT SEQUENCE — systems-check halted"
  echo ""
  echo "  Reason: $ATTEMPT_CAP systems-check rounds ran; findings remain open."
  echo ""
  echo "  Open findings:"
  # List remaining open findings from state
  echo ""
  echo "  Your options:"
  echo "    [1] Decline specific findings and re-run (recommended)"
  echo "    [2] Fix findings manually and re-run /systems-check $ISSUE_NUM"
  echo "    [3] Proceed to docking despite open findings"
  echo "    [4] Abort mission (state preserved)"
  exit 0
fi
```

Loop back to Step 3a.
```

- [ ] **Step 3: Write docking/SKILL.md**

Write `plugins/mission/skills/docking/SKILL.md` by reading the current content of `plugins/mission/skills/docking/SKILL.md` (renamed from make-port in Step 1 — old pirate content still present) and applying these replacements throughout:

| Find | Replace |
|------|---------|
| `make-port` | `docking` |
| `voyage` | `mission` |
| `voyage-state` | `mission-state` |
| `voyage-state-update.sh` | `mission-state-update.sh` |
| `voyage-state-read.sh` | `mission-state-read.sh` |
| `voyage-print-log.sh` | `mission-print-log.sh` |
| `parley` | `comms` |
| `Captain` | `Mission Control` |
| `Fair winds` | `Mission accomplished` |
| `/voyage` | `/mission` |
| frontmatter `name: make-port` | `name: docking` |
| frontmatter description | Update to reference docking/mission vocabulary |
| `# Phase 4 — Make Port` | `# Phase 4 — Docking` |
| phase history values `"make-port"` | `"docking"` |
| `Closes #N` comment reference to `open-pr / make-port` | `docking` |

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/skills/systems-check/ plugins/mission/skills/docking/
git commit -m "feat(mission): rename and rewrite systems-check and docking phase skills"
```

---

### Task 12: Rename + rewrite comms and mission-debrief skills

**Files:**
- Rename: `skills/parley/SKILL.md` → `skills/comms/SKILL.md`
- Rename: `skills/mark-the-charts/SKILL.md` → `skills/mission-debrief/SKILL.md`

- [ ] **Step 1: Rename skill directories**

```bash
cd plugins/mission/skills
git mv parley comms
git mv mark-the-charts mission-debrief
```

- [ ] **Step 2: Write comms/SKILL.md**

Write `plugins/mission/skills/comms/SKILL.md` by reading the current content of `plugins/mission/skills/comms/SKILL.md` (renamed from parley in Step 1 — old pirate content still present) and applying:

| Find | Replace |
|------|---------|
| `parley` | `comms` |
| `voyage` | `mission` |
| `voyage-state` | `mission-state` |
| `voyage-state-update.sh` | `mission-state-update.sh` |
| `voyage-state-read.sh` | `mission-state-read.sh` |
| `Bosun` | `CAPCOM` |
| `Captain` | `Mission Control` |
| `"Smooth seas — no new comments"` | `"All systems nominal — no new comments"` |
| `inspection` (phase name in history/state) | `systems-check` |
| `/voyage` | `/mission` |
| `/parley` | `/comms` |
| `/inspection` | `/systems-check` |
| frontmatter `name: parley` | `name: comms` |
| frontmatter description | Update to reference comms/mission vocabulary |
| `# Phase 5 — Parley` | `# Phase 5 — Comms` |
| phase history values `"parley"` | `"comms"` |
| `⚓ HEAVY SEAS — parley halted` | `🚨 ABORT SEQUENCE — comms halted` |
| `Abandon voyage` | `Abort mission` |

- [ ] **Step 3: Write mission-debrief/SKILL.md**

Write `plugins/mission/skills/mission-debrief/SKILL.md` by reading the current content of `plugins/mission/skills/mission-debrief/SKILL.md` (renamed from mark-the-charts in Step 1 — old pirate content still present) and applying:

| Find | Replace |
|------|---------|
| `mark-the-charts` | `mission-debrief` |
| `voyage` | `mission` |
| `First Mate` | `Systems Inspector` |
| `Captain` | `Mission Control` |
| `Here be the findings` | `Findings ready for debrief` |
| `The charts have been updated, Captain.` | `Mission debrief complete.` |
| `The First Mate will check for these` | `The Systems Inspector will check for these` |
| `docs(voyage): update review rubric` | `docs(mission): update review rubric` |
| frontmatter `name: mark-the-charts` | `name: mission-debrief` |
| frontmatter description | Update to reference mission-debrief/mission vocabulary |
| `# /mark-the-charts` | `# /mission-debrief` |

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/skills/comms/ plugins/mission/skills/mission-debrief/
git commit -m "feat(mission): rename and rewrite comms and mission-debrief skills"
```

---

### Task 13: Rename + rewrite mission dispatcher skill + README

**Files:**
- Rename: `skills/voyage/SKILL.md` → `skills/mission/SKILL.md`
- Modify: `README.md`

- [ ] **Step 1: Rename skill directory**

```bash
cd plugins/mission/skills
git mv voyage mission
```

- [ ] **Step 2: Write mission/SKILL.md**

Write `plugins/mission/skills/mission/SKILL.md`:

```markdown
---
name: mission
description: Use when the user wants to start or advance the full end-to-end mission workflow for a GitHub issue. Trigger on "/mission <N>", "mission issue N", "continue mission", "/mission --status", "/mission --finish", or any signal that the user wants to orchestrate an issue through plan→build→review→PR→comments. This is the top-level orchestrator; it reads state and dispatches the correct phase skill.
---

# /mission — State Machine Dispatcher

Read mission state for the given issue and run the next phase. Resumable:
re-run after any restart to pick up where the mission left off.

## Step 1: Parse arguments

```bash
# /mission <issue_number> [--auto] [--status] [--finish] [--abandon]
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"

# Infer issue number from current branch if not provided
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi
[ -n "$ISSUE_NUM" ] || { echo "Usage: /mission <issue_number>"; exit 1; }
```

## Step 2: Handle --status

If `$FLAG == "--status"`:
```bash
STATE=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || {
  echo "No mission state found for issue #$ISSUE_NUM. Run /mission $ISSUE_NUM to start."
  exit 0
}
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-print-log.sh" "$ISSUE_NUM"
exit 0
```

## Step 3: Handle --finish

If `$FLAG == "--finish"`:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-update.sh" "$ISSUE_NUM" phase "done"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"done\",\"event\":\"finished\"}"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/mission-print-log.sh" "$ISSUE_NUM"
echo "Mission complete. Good work, Mission Control."
exit 0
```

## Step 4: Handle --abandon

If `$FLAG == "--abandon"`:
```
Are you sure you want to abort the mission for issue #$ISSUE_NUM?
State file will be removed. [y/N]
```
On y: `rm "${CLAUDE_PLUGIN_DATA}/mission-state/issue-${ISSUE_NUM}.json"`

## Step 5: Read or initialise state

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/mission-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || STATE=""
```

If `STATE` is empty: this is a fresh mission. Dispatch `/pre-launch $ISSUE_NUM $FLAG`.

## Step 6: Decide next phase

```bash
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
```

Decision table:

| phase | phase_status | Action |
|---|---|---|
| `pre-launch` | `pending` or `in_progress` | Dispatch `/pre-launch $ISSUE_NUM $FLAG` |
| `pre-launch` | `completed` | Advance phase to `liftoff`, dispatch `/liftoff $ISSUE_NUM` |
| `pre-launch` | `halted` | Print halt message, exit |
| `liftoff` | `pending` or `in_progress` | Dispatch `/liftoff $ISSUE_NUM` |
| `liftoff` | `completed` | Advance to `systems-check`, dispatch `/systems-check $ISSUE_NUM` |
| `liftoff` | `halted` | Print halt message, exit |
| `systems-check` | `pending` or `in_progress` | Dispatch `/systems-check $ISSUE_NUM` |
| `systems-check` | `completed` | Advance to `docking`, dispatch `/docking $ISSUE_NUM` |
| `systems-check` | `halted` | Print halt message, exit |
| `docking` | `pending` or `in_progress` | Dispatch `/docking $ISSUE_NUM` |
| `docking` | `completed` | Advance to `comms`, dispatch `/comms $ISSUE_NUM` |
| `docking` | `halted` | Print halt message, exit |
| `comms` | any | Dispatch `/comms $ISSUE_NUM` (idempotent) |
| `done` | any | Print final log, exit |

**Advancing phase:** Before dispatching the next phase, update state:
```bash
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase "<next-phase>"
bash "$SCRIPT_DIR/mission-state-update.sh" "$ISSUE_NUM" phase_status "pending"
```

**Halt message format:** Load `references/halt-protocol.md` for the exact
banner and option format. Always show the halted_reason from state.

**`--auto` flag:** Pass through to `/pre-launch` only (skips post-plan confirmation).

## Step 7: Done state

```bash
bash "$SCRIPT_DIR/mission-print-log.sh" "$ISSUE_NUM"
echo "Mission for issue #$ISSUE_NUM is complete. Good work, Mission Control."
```
```

- [ ] **Step 3: Rewrite README.md**

Write `plugins/mission/README.md`:

```markdown
# mission

End-to-end GitHub issue orchestrator for Claude Code.

**One command.** `/mission <issue-number>` drives an issue from plan through
build, code review, PR open, and PR comment handling — with at most five
user-touch points in the happy path. Resumable: re-run the same command
after a Claude restart to pick up where you left off.

## Install

```shell
/plugin install mission@codercoco-custom-plugin-marketplace
```

## Usage

```
/mission <N>           Start or advance the mission for issue #N
/mission <N> --auto    Skip the post-planning confirmation
/mission <N> --status  Print current state; no action
/mission <N> --finish  Mark mission complete (after PR merged)
/mission <N> --abandon Remove state file (asks confirmation)

# Individual phases
/pre-launch <N>        Phase 1: read issue, branch, plan
/liftoff <N>           Phase 2: build (parallel Astronauts)
/systems-check <N>     Phase 3: polyglot code review + auto-fix
/docking <N>           Phase 4: open PR
/comms <N>             Phase 5: handle PR comments

# Meta
/mission-debrief       Fold new review findings into the rubric
```

## Crew

| Role | Agent | Job |
|---|---|---|
| Flight Director | planner | Decomposes issue into named tasks with dependencies |
| Astronaut | builder | Implements exactly one task |
| Flight Controller | verifier | Runs tests/lint/types — PASS or FAIL |
| Systems Inspector | reviewer | Polyglot semantic code review |
| CAPCOM | comment handler | Categorises PR comments, drafts replies |

State files live in `$CLAUDE_PLUGIN_DATA/mission-state/`. Never committed.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/mission/skills/mission/ plugins/mission/README.md
git commit -m "feat(mission): rename and rewrite mission dispatcher skill and README"
```

---

### Task 14: Final verification

- [ ] **Step 1: Run all tests**

```bash
bash plugins/mission/scripts/test/test-state-init.sh
bash plugins/mission/scripts/test/test-state-update.sh
```

Expected: 0 failures from both.

- [ ] **Step 2: Check for stale pirate references**

```bash
grep -r "voyage\|pirate\|Blackbeard\|Anne\|set-sail\|chart-course\|make-port\|parley\|mark-the-charts\|Navigator\|Crewmate\|Quartermaster\|First Mate\|Bosun\|Captain\|HEAVY SEAS\|shoal\|reef\|belay\|Ahoy\|Avast\|Ye be" \
  plugins/mission/ --include="*.md" --include="*.sh" --include="*.json" -l
```

Expected: no files listed. If any appear, fix the remaining occurrences.

- [ ] **Step 3: Check for stale voyage-state directory references in scripts**

```bash
grep -rn "voyage-state\|voyage-print\|voyage-state-init\|voyage-state-read\|voyage-state-update" \
  plugins/mission/ --include="*.sh" --include="*.md"
```

Expected: no matches.

- [ ] **Step 4: Verify marketplace entry**

```bash
jq '.plugins[] | select(.name == "mission")' .claude-plugin/marketplace.json
```

Expected: entry with `"name": "mission"`, `"version": "0.2.0"`, `"source": "./plugins/mission"`.

- [ ] **Step 5: Verify no old voyage plugin directory**

```bash
[ -d plugins/voyage ] && echo "ERROR: plugins/voyage still exists" || echo "OK: plugins/voyage removed"
```

Expected: `OK: plugins/voyage removed`.

- [ ] **Step 6: Commit if any cleanup fixes were needed**

```bash
git add -p
git commit -m "fix(mission): remove remaining pirate/voyage references"
```

Only run this step if Step 2 or 3 found remaining issues.
