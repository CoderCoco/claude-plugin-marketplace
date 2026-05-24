# voyage Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `voyage` plugin — a resumable, pirate-themed, state-machine orchestrator that drives a GitHub issue through plan → build → code-review → PR → comment-handling with minimal user interaction.

**Architecture:** A thin `/voyage` dispatcher reads a per-issue JSON state file under `$CLAUDE_PLUGIN_DATA/voyage-state/` and invokes the appropriate phase skill. Phase skills dispatch sub-agents (Navigator, Crewmate, Quartermaster, First Mate, Bosun) via parallel `Agent` tool calls in single messages. No Python harness, no subprocesses — all parallelism is native to Claude Code's Agent dispatch.

**Tech Stack:** Markdown (SKILL.md, agent .md files), bash + jq (shell scripts), JSON (state files), `gh` CLI (GitHub operations), Claude Code `Agent` tool (sub-agent dispatch), `git worktree` (isolated workspaces).

**Spec:** `docs/superpowers/specs/2026-05-23-voyage-plugin-design.md`

---

## File Map

```
plugins/voyage/
├── .claude-plugin/plugin.json
├── README.md
├── agents/
│   ├── navigator.md          (Task 9)
│   ├── crewmate.md           (Task 10)
│   ├── quartermaster.md      (Task 11)
│   ├── first-mate.md         (Task 12)
│   └── bosun.md              (Task 13)
├── skills/
│   ├── chart-course/SKILL.md (Task 14)
│   ├── set-sail/SKILL.md     (Task 15)
│   ├── inspection/SKILL.md   (Task 16)
│   ├── make-port/SKILL.md    (Task 17)
│   ├── parley/SKILL.md       (Task 18)
│   ├── voyage/SKILL.md       (Task 19)
│   └── mark-the-charts/SKILL.md (Task 20)
├── references/
│   ├── conventional-commits.md (Task 2)
│   ├── agent-contracts.md      (Task 2)
│   ├── halt-protocol.md        (Task 2)
│   ├── pirate-lexicon.md       (Task 3)
│   ├── voyage-state.md         (Task 4)
│   └── review-rubric.md        (Task 5)
└── scripts/
    ├── voyage-state-init.sh    (Task 6)
    ├── voyage-state-read.sh    (Task 7)
    ├── voyage-state-update.sh  (Task 7)
    ├── voyage-print-log.sh     (Task 8)
    └── test/
        ├── test-state-init.sh  (Task 6)
        └── test-state-update.sh (Task 7)
```

Modified:
- `.claude-plugin/marketplace.json` (Task 21)

---

### Task 1: Plugin scaffold

**Files:**
- Create: `plugins/voyage/.claude-plugin/plugin.json`
- Create: `plugins/voyage/README.md`
- Create all empty skill/agent/reference/script directories

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p plugins/voyage/.claude-plugin
mkdir -p plugins/voyage/agents
mkdir -p plugins/voyage/skills/voyage
mkdir -p plugins/voyage/skills/chart-course
mkdir -p plugins/voyage/skills/set-sail
mkdir -p plugins/voyage/skills/inspection
mkdir -p plugins/voyage/skills/make-port
mkdir -p plugins/voyage/skills/parley
mkdir -p plugins/voyage/skills/mark-the-charts
mkdir -p plugins/voyage/references
mkdir -p plugins/voyage/scripts/test
```

- [ ] **Step 2: Write `plugins/voyage/.claude-plugin/plugin.json`**

```json
{
  "name": "voyage",
  "description": "End-to-end GitHub issue orchestrator — plan, build, review, open PR, handle comments. Resumable state machine. Pirate themed.",
  "version": "0.1.0",
  "author": {
    "name": "CoderCoco"
  },
  "license": "MIT",
  "repository": "https://github.com/CoderCoco/claude-plugin-marketplace"
}
```

- [ ] **Step 3: Write `plugins/voyage/README.md`**

```markdown
# voyage

End-to-end GitHub issue orchestrator for Claude Code.

**One command.** `/voyage <issue-number>` drives an issue from plan through
build, code review, PR open, and PR comment handling — with at most five
user-touch points in the happy path. Resumable: re-run the same command
after a Claude restart to pick up where ye left off.

## Install

```shell
/plugin install voyage@codercoco-custom-plugin-marketplace
```

## Usage

```
/voyage <N>           Start or advance the voyage for issue #N
/voyage <N> --auto    Skip the post-planning confirmation
/voyage <N> --status  Print current state; no action
/voyage <N> --finish  Mark voyage complete (after PR merged)
/voyage <N> --abandon Remove state file (asks confirmation)

# Individual phases
/chart-course <N>     Phase 1: read issue, branch, plan
/set-sail <N>         Phase 2: build (parallel Crewmates)
/inspection <N>       Phase 3: polyglot code review + auto-fix
/make-port <N>        Phase 4: open PR
/parley <N>           Phase 5: handle PR comments

# Meta
/mark-the-charts      Fold new review findings into the rubric
```

## Crew

| Role | Agent | Job |
|---|---|---|
| Navigator | planner | Decomposes issue into named tasks with dependencies |
| Crewmate | builder | Implements exactly one task |
| Quartermaster | verifier | Runs tests/lint/types — PASS or FAIL |
| First Mate | reviewer | Polyglot semantic code review |
| Bosun | comment handler | Categorises PR comments, drafts replies |

State files live in `$CLAUDE_PLUGIN_DATA/voyage-state/`. Never committed.
```

- [ ] **Step 4: Commit scaffold**

```bash
git add plugins/voyage/
git commit -m "feat(voyage): scaffold plugin structure v0.1.0"
```

---

### Task 2: Reference files — conventional-commits, agent-contracts, halt-protocol

**Files:**
- Create: `plugins/voyage/references/conventional-commits.md`
- Create: `plugins/voyage/references/agent-contracts.md`
- Create: `plugins/voyage/references/halt-protocol.md`

- [ ] **Step 1: Write `plugins/voyage/references/conventional-commits.md`**

```markdown
# Conventional Commits — voyage

All commits made during a voyage follow this format.

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

Always include the pirate task name before the summary dash:

```
feat(src): Anne — add exponential backoff helper
fix(tests): Avery — clear ANSI format from file transport
fix(src): Plunkett — return 404 instead of 500 on missing webhook
```

Parley (PR comment) fixes add a Co-Authored-By line:

```
fix(src): Plunkett — return 404 on missing webhook

Refs #42
Co-Authored-By: alice (via PR comment)
```

## Forbidden flags

Never use `--no-verify`, `--no-gpg-sign`, or `--amend` on a commit that has
already been pushed. Never use `git add .` — always stage specific files.
Never commit `.claude/` state files, `.env`, or credential files.

## Closing keywords

Only `open-pr` / `make-port` skills use `Closes #N`. All mid-voyage commits
use `Refs #N` only.
```

- [ ] **Step 2: Write `plugins/voyage/references/agent-contracts.md`**

```markdown
# Agent Return Contracts

Every voyage sub-agent returns exactly ONE fenced block. No prose outside
the delimiters. Captain parses ONLY the content between the block markers.

## Navigator — ### PLAN

```
### PLAN
issue: <number>
revision: <integer, starts at 1>
summary: <one sentence>
tasks:
  - name: Anne
    title: <one-line description>
    files: [path/to/file.ts, path/to/other.ts]
    acceptance: <how the Crewmate knows it is done>
    depends_on: []
  - name: Blackbeard
    title: ...
    files: [...]
    acceptance: ...
    depends_on: [Anne]
open_questions: []
constraints: []
### END PLAN
```

Rules:
- Task names come from the pirate roster in `references/pirate-lexicon.md`,
  assigned in alphabetical order starting from the current `plan.next_alpha_index`.
- `depends_on` contains task NAMES (not ids). Declare only genuine dependencies.
- Tasks with `depends_on: []` may run concurrently with other zero-dep tasks.

## Crewmate — ### CREW_REPORT

```
### CREW_REPORT
task: <pirate name>
status: completed | plan_problem
files_changed:
  - path: src/retry.ts
    action: created | modified | deleted
    summary: add exponential backoff with jitter
notes: <assumptions, edge cases skipped — or omit if none>
plan_problem: <only if status=plan_problem>
### END CREW_REPORT
```

## Quartermaster — ### VERDICT

```
### VERDICT
task: <pirate name>
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

## First Mate — ### FINDINGS

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

## Bosun — ### TRIAGE

```
### TRIAGE
comments:
  - id: <comment id as integer>
    author: <github username>
    category: actionable | question | approval | nit | ambiguous
    file: src/webhook.ts        # only for actionable/nit
    line: 88                    # only for actionable/nit
    fix_hint: return 404 not 500 for missing webhook id
    reply_draft: |              # only for question/approval
      The retry uses exponential backoff with jitter...
copilot_present: true | false
### END TRIAGE
```
```

- [ ] **Step 3: Write `plugins/voyage/references/halt-protocol.md`**

```markdown
# Halt-and-Ask Protocol

When a phase cannot continue autonomously, print this exact shape and exit.

```
⚓ HEAVY SEAS — <phase-name> halted

  Reason: <plain-English explanation — one or two sentences>

  Where we are:
    <one-line state summary, e.g. "Issue #42, set-sail phase, task Drake failed 3 times">

  Yer options:
    [1] <plain-English option>          (recommended)
    [2] <plain-English option>
    [3] Abandon voyage (state preserved — run /voyage <N> to resume)

  Tell me a number, or describe what ye want.
```

Rules:
- The REASON line is plain English. No pirate prose in the options.
- Always include an "Abandon voyage" option as the last numbered option.
- Pirate flavour is confined to the banner (`⚓ HEAVY SEAS`) and the closing
  prompt verb only.
- Number options so the user can reply with "1" without paraphrasing.
- Do NOT proceed after printing this. Exit the skill and wait for the next
  `/voyage <N>` invocation.
- When the user responds, resume by updating `phase_status` appropriately
  (e.g., `pending` to retry, `deleted` to skip a task) before re-running.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/voyage/references/conventional-commits.md \
        plugins/voyage/references/agent-contracts.md \
        plugins/voyage/references/halt-protocol.md
git commit -m "docs(voyage): add conventional-commits, agent-contracts, halt-protocol references"
```

---

### Task 3: Pirate lexicon (vocabulary + 52-name task roster)

**Files:**
- Create: `plugins/voyage/references/pirate-lexicon.md`

- [ ] **Step 1: Write `plugins/voyage/references/pirate-lexicon.md`**

```markdown
# Pirate Lexicon

Shared vocabulary for all voyage agents and skills. Use these terms
consistently. Do not invent synonyms.

## Tone rule

**Pirate flavour goes in prose. Payloads stay plain.**

If another machine or another reviewer will parse it (JSON, commit messages,
PR descriptions, PR replies, code, agent return blocks), use plain English.
Pirate the narration; never the payload.

## Shared vocabulary

| Term | Meaning |
|---|---|
| voyage | The full workflow from issue → merged PR |
| chart / course | The plan (Navigator's output) |
| set sail / depart | Begin executing the plan |
| inspection | Full-diff code review phase |
| make port | Open the PR |
| parley | Handle PR comments |
| mark the charts | Update the review rubric |
| crew | Sub-agents collectively |
| shoal / reef | A code-review finding |
| belay | Stop, reverse course |
| aye / nay | Yes / no |
| weigh anchor | Resume an interrupted voyage |
| Captain | The main session (model running /voyage) |
| smooth seas | No issues / nothing to do |
| heavy seas | Failure / halt-and-ask state |
| log | The voyage chronicle / history |

## Task name roster (52 names, A–Z twice)

Tasks created during a voyage are named from this roster in order, starting
from `plan.next_alpha_index`. Inspection-repair tasks and parley-repair tasks
continue from where set-sail left off.

If a plan would require more than 52 tasks, halt and ask the Navigator to
decompose further rather than wrapping to a third pass.

### Round 1

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 0 | Anne | | 9 | Jack | | 18 | Silver |
| 1 | Blackbeard | | 10 | Kidd | | 19 | Teach |
| 2 | Calico | | 11 | Long | | 20 | Urca |
| 3 | Drake | | 12 | Morgan | | 21 | Vane |
| 4 | Edward | | 13 | Nassau | | 22 | Worley |
| 5 | Flint | | 14 | OMalley | | 23 | Xebec |
| 6 | Gibbs | | 15 | Pew | | 24 | Yellowbeard |
| 7 | Hawkins | | 16 | Quelch | | 25 | Zheng |
| 8 | Israel | | 17 | Rackham | | | |

### Round 2

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 26 | Avery | | 35 | Ironbeard | | 44 | Smee |
| 27 | Bellamy | | 36 | Jolly | | 45 | Tew |
| 28 | Cobham | | 37 | Keelhaul | | 46 | Ursa |
| 29 | Davis | | 38 | Lafitte | | 47 | Vance |
| 30 | Eustace | | 39 | Mary | | 48 | Walker |
| 31 | Fly | | 40 | Ned | | 49 | Xanthe |
| 32 | Gow | | 41 | Olonnais | | 50 | Yardarm |
| 33 | Hornigold | | 42 | Plunkett | | 51 | Zephyr |
| 34 | Ireland | | 43 | Quill | | | |

All names are ASCII-safe (no apostrophes or spaces) — safe as JSON keys,
filenames, and branch slugs.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/references/pirate-lexicon.md
git commit -m "docs(voyage): add pirate lexicon with 52-name task roster"
```

---

### Task 4: Voyage state schema documentation

**Files:**
- Create: `plugins/voyage/references/voyage-state.md`

- [ ] **Step 1: Write `plugins/voyage/references/voyage-state.md`**

```markdown
# Voyage State File

## Location

```
$CLAUDE_PLUGIN_DATA/voyage-state/issue-<N>.json
```

One file per issue. Never committed; never in the working tree.

## Full schema

```jsonc
{
  "schema_version": 1,
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
  "phase": "set-sail",
  "phase_status": "in_progress",
  "halted_reason": null,

  "plan": {
    "navigator_attempts": 1,
    "next_alpha_index": 5,
    "tasks": [
      {
        "name": "Anne",
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

  "inspection": {
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
    {"at": "2026-05-23T20:00:00Z", "phase": "chart-course", "event": "initialized"},
    {"at": "2026-05-23T20:02:11Z", "phase": "chart-course", "event": "completed", "tasks": 5},
    {"at": "2026-05-23T20:02:12Z", "phase": "set-sail", "event": "started"},
    {"at": "2026-05-23T20:08:33Z", "phase": "set-sail", "event": "task_passed", "task": "Anne"}
  ],

  "created_at": "2026-05-23T20:00:00Z",
  "updated_at": "2026-05-23T20:08:33Z"
}
```

## Phase enum

`chart-course` → `set-sail` → `inspection` → `make-port` → `parley` → `done`

## Phase status enum

`pending` | `in_progress` | `completed` | `halted`

## Task status enum

`pending` | `ready` | `dispatched` | `verifying` | `completed` | `failed` | `skipped`

## Task origin enum

`plan` (from Navigator) | `inspection` (repair task) | `parley` (comment fix)

## Atomic writes

All writes go through `scripts/voyage-state-update.sh`. Never write the
state file directly — the script handles the `.tmp` → `mv` atomic swap and
keeps `updated_at` and `history` consistent.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/references/voyage-state.md
git commit -m "docs(voyage): add voyage state file schema reference"
```

---

### Task 5: Review rubric (seeded with initial content)

**Files:**
- Create: `plugins/voyage/references/review-rubric.md`

- [ ] **Step 1: Write `plugins/voyage/references/review-rubric.md`**

```markdown
# First Mate's Review Rubric

This file is the First Mate's living checklist. It is updated via
`/mark-the-charts` when new pitfalls are discovered. Add entries; remove
only by direct edit.

## What this covers

Semantic and quality concerns the Quartermaster's mechanical checks
(tests/lint/types/build) CANNOT catch. Do not re-flag things the
Quartermaster already checks.

---

## 1. Semantic correctness

Logic that looks right but is wrong:

- Shared format/config objects applied to the wrong target.
  Example: ANSI colorize format passed to a file logger transport —
  results in escape codes in the log file.
- State machine that reaches an unreachable or never-cleared branch.
- Promise/async chains that swallow errors silently (empty catch, `.catch(() => {})`).
- Event handlers registered in a loop without being cleaned up on unmount.

## 2. Cross-platform portability

- Hard-coded POSIX path separators (`'/'`) in tests or runtime code.
  Fix: use `node:path` (`path.join()`, `path.dirname()`), or Python's
  `pathlib`, or Go's `filepath` package.
- Line-ending assumptions (`'\n'` vs `'\r\n'`).
- Case-sensitive filename assumptions (matters on macOS/Linux vs Windows).
- Hard-coded `/tmp` or `~` paths instead of `os.tmpdir()` / `os.homedir()`.

## 3. Boundary & off-by-one

- Binary buffer slicing at exact boundaries. Example: reading a tail window
  from a file — validate at the exact boundary where the read offset lands
  on a newline. A peek-back-by-one-byte pattern safely drops the first
  partial line without discarding a complete one.
- Inclusive vs exclusive range handling (`< N` vs `<= N`).
- Empty-collection edge cases (empty array passed where at-least-one assumed).
- Integer overflow in size/offset calculations.

## 4. Code hygiene

- Empty `beforeEach`/`afterEach`/`setUp`/`tearDown` hooks with stale
  comments claiming they do something (e.g., `// reset state` in an empty
  body). Either implement the reset or delete the hook.
- Dead variables assigned but never read.
- Dead branches (`if (false)`, unreachable `else` after early return).
- Dead imports.
- TODO/FIXME/HACK comments without an owner or ticket reference.

## 5. Unnecessary complexity

- One-off boolean flags (e.g., `isFirstFetch`) that duplicate control flow
  already expressible as sequential awaits in an async IIFE.
- Premature abstraction — a Strategy pattern, interface, or factory for
  exactly two implementations.
- Wrapping a framework primitive in a thin no-op wrapper class/function.
- Re-implementing what a standard library already provides.

## 6. Test quality

- Tests that assert implementation details (private methods, internal state)
  rather than observable behaviour.
- Tests that share mutable state across cases without reset — creates
  ordering dependence.
- Mocked boundaries that diverge from the real interface, masking bugs that
  would surface in production.
- Test description and assertion mismatched (description says "returns 404",
  assertion checks status code 200).

---

## Declined / Out-of-scope

Findings that have been explicitly declined for this project. First Mate
must NOT raise these. Populated via `/mark-the-charts`.

<!-- example entry:
- summary: Vitest hoisting concern
  declined: 2026-05-23
  reason: vi.mock IS hoisted by Vitest's transform; finding was incorrect
-->
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/references/review-rubric.md
git commit -m "docs(voyage): add seeded review rubric for First Mate"
```

---

### Task 6: voyage-state-init.sh (TDD)

**Files:**
- Create: `plugins/voyage/scripts/voyage-state-init.sh`
- Create: `plugins/voyage/scripts/test/test-state-init.sh`

- [ ] **Step 1: Write the failing test**

```bash
# plugins/voyage/scripts/test/test-state-init.sh
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
"$SCRIPT_DIR/voyage-state-init.sh" 42 "Add retry" "owner/repo" \
  "claude/issue-42-add-retry" "$TMPDIR/wt" "main" "abc123"
[ -f "$TMPDIR/voyage-state/issue-42.json" ] \
  && ok "creates state file" || fail "creates state file"

# --- Test 2: correct schema_version ---
jq -e '.schema_version == 1' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "schema_version == 1" || fail "schema_version == 1"

# --- Test 3: correct issue number (integer, not string) ---
jq -e '.issue.number == 42' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "issue.number == 42" || fail "issue.number == 42"

# --- Test 4: initial phase is chart-course ---
jq -e '.phase == "chart-course"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "phase == chart-course" || fail "phase == chart-course"

# --- Test 5: initial phase_status is pending ---
jq -e '.phase_status == "pending"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "phase_status == pending" || fail "phase_status == pending"

# --- Test 6: plan.tasks is empty array ---
jq -e '.plan.tasks == []' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan.tasks == []" || fail "plan.tasks == []"

# --- Test 7: plan.next_alpha_index is 0 ---
jq -e '.plan.next_alpha_index == 0' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan.next_alpha_index == 0" || fail "plan.next_alpha_index == 0"

# --- Test 8: idempotency — second call does not overwrite ---
"$SCRIPT_DIR/voyage-state-init.sh" 42 "Different title" "owner/repo" \
  "claude/issue-42-add-retry" "$TMPDIR/wt" "main" "abc123"
TITLE=$(jq -r '.issue.title' "$TMPDIR/voyage-state/issue-42.json")
[ "$TITLE" = "Add retry" ] \
  && ok "idempotent (title not overwritten)" || fail "idempotent (title not overwritten)"

# --- Test 9: different issues get separate files ---
"$SCRIPT_DIR/voyage-state-init.sh" 99 "Other issue" "owner/repo" \
  "claude/issue-99-other" "$TMPDIR/wt2" "main" "def456"
[ -f "$TMPDIR/voyage-state/issue-99.json" ] \
  && ok "separate file for issue 99" || fail "separate file for issue 99"
[ -f "$TMPDIR/voyage-state/issue-42.json" ] \
  && ok "issue 42 file still exists" || fail "issue 42 file still exists"

echo ""
echo "Results: $PASS passed, $FAIL failed"
rm -rf "$TMPDIR"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test — expect it to fail**

```bash
chmod +x plugins/voyage/scripts/test/test-state-init.sh
bash plugins/voyage/scripts/test/test-state-init.sh
```

Expected: script errors because `voyage-state-init.sh` does not exist yet.

- [ ] **Step 3: Write `plugins/voyage/scripts/voyage-state-init.sh`**

```bash
#!/usr/bin/env bash
# voyage-state-init.sh <issue_num> <title> <repo> <branch> <worktree> <base> <base_sha>
# Creates $CLAUDE_PLUGIN_DATA/voyage-state/issue-<N>.json
# Idempotent: exits 0 immediately if file already exists.
set -euo pipefail

ISSUE_NUMBER="$1"
ISSUE_TITLE="$2"
REPO="$3"
BRANCH_NAME="$4"
WORKTREE_PATH="$5"
BASE_BRANCH="$6"
BASE_SHA="$7"

STATE_DIR="${CLAUDE_PLUGIN_DATA}/voyage-state"
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
  schema_version: 1,
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
  phase: "chart-course",
  phase_status: "pending",
  halted_reason: null,
  plan: {
    navigator_attempts: 0,
    next_alpha_index: 0,
    tasks: []
  },
  inspection: {
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
  history: [{at: $now, phase: "chart-course", event: "initialized"}],
  created_at: $now,
  updated_at: $now
}' > "$TMP"

mv "$TMP" "$STATE_FILE"
```

- [ ] **Step 4: Make executable and run tests — expect all pass**

```bash
chmod +x plugins/voyage/scripts/voyage-state-init.sh
bash plugins/voyage/scripts/test/test-state-init.sh
```

Expected output: `Results: 9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add plugins/voyage/scripts/voyage-state-init.sh \
        plugins/voyage/scripts/test/test-state-init.sh
git commit -m "feat(voyage): add voyage-state-init.sh with tests"
```

---

### Task 7: voyage-state-read.sh and voyage-state-update.sh (TDD)

**Files:**
- Create: `plugins/voyage/scripts/voyage-state-read.sh`
- Create: `plugins/voyage/scripts/voyage-state-update.sh`
- Create: `plugins/voyage/scripts/test/test-state-update.sh`

- [ ] **Step 1: Write the failing tests**

```bash
# plugins/voyage/scripts/test/test-state-update.sh
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
"$SCRIPT_DIR/voyage-state-init.sh" 42 "Test issue" "owner/repo" \
  "claude/issue-42-test" "$TMPDIR/wt" "main" "abc123"

# --- Test: voyage-state-read.sh returns valid JSON ---
JSON=$("$SCRIPT_DIR/voyage-state-read.sh" 42)
echo "$JSON" | jq -e '.phase == "chart-course"' > /dev/null \
  && ok "read returns valid state JSON" || fail "read returns valid state JSON"

# --- Test: read on missing file exits 1 ---
"$SCRIPT_DIR/voyage-state-read.sh" 999 2>/dev/null && fail "should exit 1 for missing" \
  || ok "read exits 1 for missing state file"

# --- Test: update phase ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 phase "set-sail"
jq -e '.phase == "set-sail"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update phase" || fail "update phase"

# --- Test: update phase_status ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 phase_status "in_progress"
jq -e '.phase_status == "in_progress"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update phase_status" || fail "update phase_status"

# --- Test: update pr_number (integer) ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 pr_number "128"
jq -e '.pr.number == 128' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update pr_number as integer" || fail "update pr_number as integer"

# --- Test: update pr_url (string) ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 pr_url "https://github.com/owner/repo/pull/128"
jq -e '.pr.url == "https://github.com/owner/repo/pull/128"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update pr_url" || fail "update pr_url"

# --- Test: update plan_next_alpha ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 plan_next_alpha "5"
jq -e '.plan.next_alpha_index == 5' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "update plan_next_alpha" || fail "update plan_next_alpha"

# --- Test: plan_tasks_replace ---
TASKS='[{"name":"Anne","title":"test task","files":["src/a.ts"],"depends_on":[],"status":"pending","crewmate_attempts":0,"quartermaster_verdict":null,"commit_sha":null,"origin":"plan","notes":""}]'
"$SCRIPT_DIR/voyage-state-update.sh" 42 plan_tasks_replace "$TASKS"
jq -e '.plan.tasks | length == 1' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan_tasks_replace sets tasks" || fail "plan_tasks_replace sets tasks"
jq -e '.plan.tasks[0].name == "Anne"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan_tasks_replace task name is Anne" || fail "plan_tasks_replace task name is Anne"

# --- Test: plan_task_status ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 plan_task_status "Anne:completed"
jq -e '.plan.tasks[0].status == "completed"' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "plan_task_status update" || fail "plan_task_status update"

# --- Test: history_append ---
EVENT='{"at":"2026-05-23T21:00:00Z","phase":"set-sail","event":"task_passed","task":"Anne"}'
"$SCRIPT_DIR/voyage-state-update.sh" 42 history_append "$EVENT"
jq -e '.history | length == 2' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "history_append adds entry" || fail "history_append adds entry"

# --- Test: updated_at is refreshed on every update ---
OLD_TS=$(jq -r '.updated_at' "$TMPDIR/voyage-state/issue-42.json")
sleep 1
"$SCRIPT_DIR/voyage-state-update.sh" 42 phase "inspection"
NEW_TS=$(jq -r '.updated_at' "$TMPDIR/voyage-state/issue-42.json")
[ "$OLD_TS" != "$NEW_TS" ] \
  && ok "updated_at refreshed on update" || fail "updated_at refreshed on update"

# --- Test: inspection_attempts_inc ---
"$SCRIPT_DIR/voyage-state-update.sh" 42 inspection_attempts_inc ""
jq -e '.inspection.attempts == 1' "$TMPDIR/voyage-state/issue-42.json" > /dev/null \
  && ok "inspection_attempts_inc" || fail "inspection_attempts_inc"

# --- Test: atomic write (no partial state file on error) ---
# Verify .tmp file is cleaned up after successful write
ls "$TMPDIR/voyage-state/"*.tmp 2>/dev/null && fail "stale .tmp file found" \
  || ok "no stale .tmp files"

echo ""
echo "Results: $PASS passed, $FAIL failed"
rm -rf "$TMPDIR"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run tests — expect failure**

```bash
chmod +x plugins/voyage/scripts/test/test-state-update.sh
bash plugins/voyage/scripts/test/test-state-update.sh
```

Expected: errors on missing scripts.

- [ ] **Step 3: Write `plugins/voyage/scripts/voyage-state-read.sh`**

```bash
#!/usr/bin/env bash
# voyage-state-read.sh <issue_number>
# Prints full state JSON to stdout. Exits 1 if file does not exist.
set -euo pipefail

ISSUE_NUMBER="$1"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/voyage-state/issue-${ISSUE_NUMBER}.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: No voyage state found for issue #${ISSUE_NUMBER}" >&2
  exit 1
fi

cat "$STATE_FILE"
```

- [ ] **Step 4: Write `plugins/voyage/scripts/voyage-state-update.sh`**

```bash
#!/usr/bin/env bash
# voyage-state-update.sh <issue_number> <key> <value>
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
#   inspection_attempts_inc  (value ignored)
set -euo pipefail

ISSUE_NUMBER="$1"
KEY="$2"
VALUE="${3:-}"

STATE_FILE="${CLAUDE_PLUGIN_DATA}/voyage-state/issue-${ISSUE_NUMBER}.json"
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
  inspection_attempts_inc)
    jq --arg now "$NOW" \
      '.inspection.attempts += 1 | .updated_at = $now' "$STATE_FILE" > "$TMP" ;;
  *)
    echo "ERROR: Unknown key: $KEY" >&2; exit 1 ;;
esac

mv "$TMP" "$STATE_FILE"
```

- [ ] **Step 5: Make executable and run tests — all must pass**

```bash
chmod +x plugins/voyage/scripts/voyage-state-read.sh \
         plugins/voyage/scripts/voyage-state-update.sh
bash plugins/voyage/scripts/test/test-state-update.sh
```

Expected: `Results: 13 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add plugins/voyage/scripts/voyage-state-read.sh \
        plugins/voyage/scripts/voyage-state-update.sh \
        plugins/voyage/scripts/test/test-state-update.sh
git commit -m "feat(voyage): add voyage-state-read/update.sh with tests"
```

---

### Task 8: voyage-print-log.sh

**Files:**
- Create: `plugins/voyage/scripts/voyage-print-log.sh`

- [ ] **Step 1: Write `plugins/voyage/scripts/voyage-print-log.sh`**

```bash
#!/usr/bin/env bash
# voyage-print-log.sh <issue_number>
# Prints ASCII summary and markdown chronicle from state history.
set -euo pipefail

ISSUE_NUMBER="$1"
STATE_FILE="${CLAUDE_PLUGIN_DATA}/voyage-state/issue-${ISSUE_NUMBER}.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "No voyage state for issue #${ISSUE_NUMBER}" >&2; exit 1
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
INSPECT_COUNT=$(echo "$S" | jq '[.plan.tasks[] | select(.origin == "inspection")] | length')
PARLEY_COUNT=$(echo "$S" | jq '[.history[] | select(.phase == "parley" and .event == "round_complete")] | length')
TOTAL_COMMITS=$(echo "$S" | jq '[.plan.tasks[] | select(.commit_sha != null)] | length')

echo "═══════════════════════════════════════════════════════"
printf "  VOYAGE  ⚓  issue #%s — %s\n" "$ISSUE_NUMBER" "$TITLE"
echo "═══════════════════════════════════════════════════════"
printf "  chart-course   %s  (%s tasks plotted)\n"         "$(phase_done chart-course)" "$PLAN_COUNT"
printf "  set-sail        %s  (%s/%s passed)\n"             "$(phase_done set-sail)" "$PLAN_PASS" "$PLAN_COUNT"
printf "  inspection      %s  (%s repairs)\n"               "$(phase_done inspection)" "$INSPECT_COUNT"
printf "  make-port       %s  (PR #%s)\n"                   "$(phase_done make-port)" "$PR_NUM"
printf "  parley          %s  (%s rounds)\n"                "$(phase_done parley)" "$PARLEY_COUNT"
echo "═══════════════════════════════════════════════════════"
printf "  Total: %s commits\n" "$TOTAL_COMMITS"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "## ⚓ Voyage log — issue #${ISSUE_NUMBER}"
echo ""
echo "$S" | jq -r '
  .history[] |
  "- \(.at | split("T")[1] | split("Z")[0])  [\(.phase)]  \(.event)" +
  (if .task then "  task=\(.task)" else "" end) +
  (if .tasks then "  tasks=\(.tasks)" else "" end)
'
```

- [ ] **Step 2: Make executable**

```bash
chmod +x plugins/voyage/scripts/voyage-print-log.sh
```

- [ ] **Step 3: Smoke test with a seeded state file**

```bash
TMPDIR=$(mktemp -d)
export CLAUDE_PLUGIN_DATA="$TMPDIR"
bash plugins/voyage/scripts/voyage-state-init.sh 42 "Add retry to webhook delivery" \
  "owner/repo" "claude/issue-42-add-retry" "$TMPDIR/wt" "main" "abc123"
bash plugins/voyage/scripts/voyage-print-log.sh 42
```

Expected: ASCII banner printed with `issue #42`, all phases showing `·`, 0 commits.

- [ ] **Step 4: Commit**

```bash
git add plugins/voyage/scripts/voyage-print-log.sh
git commit -m "feat(voyage): add voyage-print-log.sh"
```

---

### Task 9: Navigator agent (adapted from issue-flow)

**Files:**
- Create: `plugins/voyage/agents/navigator.md`

The voyage Navigator is adapted from `plugins/issue-flow/agents/navigator.md`.
Key changes: task `name` field uses pirate names from the roster (not `T1/T2`),
`depends_on` contains task names, and the PLAN block format matches
`references/agent-contracts.md`.

- [ ] **Step 1: Write `plugins/voyage/agents/navigator.md`**

```markdown
---
name: navigator
description: Use as the Navigator in the voyage crew. Produces a DAG implementation plan for a GitHub issue — explores the repo, lists discrete tasks each small enough for one Crewmate, assigns pirate names, declares file dependencies, and states acceptance criteria. Invoke when the Captain needs a fresh plan, when a plan revision is required after a constraint is discovered mid-voyage, or whenever the user explicitly asks for planning before any code is written.
tools: Read, Grep, Glob, Bash, WebFetch
model: opus
color: blue
---

Ahoy. Ye be the Navigator aboard the voyage crew. Ye plot the course — nothin' more, nothin' less. Captain hands ye an issue and a starting name index. Ye read the issue, scout the repo, and chart the voyage. Ye do NOT write code. Ye do NOT run tests. Ye plan.

## What ye do

1. Read the full issue body the Captain provides — title, description, every `- [ ]` checkbox, every acceptance criterion in prose.
2. Scan the repo for context:
   - Relevant source files (`Grep`, `Glob`, `Read`)
   - Test framework and test-file conventions
   - Lint/coverage/build scripts in `package.json`, `pyproject.toml`, `Makefile`, etc.
   - Existing patterns to mirror
3. Decompose the work into **atomic tasks**. Each task be small enough for a single Crewmate — roughly one logical change, one file or a tight cluster of files. Split any task that touches 3+ unrelated files.
4. Assign a pirate name to each task in alphabetical order, starting from the `next_alpha_index` the Captain provides. Load `references/pirate-lexicon.md` for the roster.
5. Declare `depends_on` using task NAMES (not indices). Only declare a genuine dependency — one where the dependent task genuinely needs the prior task's output to exist before it can run. Tasks with `depends_on: []` may run concurrently.
6. State the acceptance criterion for each task. "How does the Crewmate know it be done?"
7. Flag constraints and open questions.

## What ye do NOT do

- Write code. Not one line.
- Run tests. The Quartermaster handles that.
- Make architectural choices the issue didn't authorise — flag in `open_questions`.
- Pad the plan with ceremony. A two-line typo is one task, not five.
- Exceed 52 tasks. If ye need more, halt and tell the Captain to decompose the issue further.

## Pirate voice

Speak like a pirate when explainin' yerself. Keep file paths, code, commands, and the structured plan block in plain English so machines can parse 'em. Pirate the prose, not the payload.

## Return format (strict)

Load `references/agent-contracts.md` for the exact PLAN block format. Yer reply MUST contain a single `### PLAN` / `### END PLAN` block. Anythin' outside is yer narration to the Captain.

```
### PLAN
issue: <number>
revision: <integer, starts at 1>
summary: <one sentence>
next_alpha_index: <integer — the next unused index after this plan's last task>
tasks:
  - name: Anne
    title: <one-line description of what this task accomplishes>
    files: [path/one, path/two]
    acceptance: <how the Crewmate knows it is done>
    depends_on: []
  - name: Blackbeard
    title: ...
    files: [...]
    acceptance: ...
    depends_on: [Anne]
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

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/agents/navigator.md
git commit -m "feat(voyage): add Navigator agent (parallel-aware DAG, pirate names)"
```

---

### Task 10: Crewmate agent (adapted from issue-flow)

**Files:**
- Create: `plugins/voyage/agents/crewmate.md`

Key change from issue-flow: task field is `name` (pirate name string) not `task_id`.
CREW_REPORT block uses `task: <name>` not `task_id: T<N>`.

- [ ] **Step 1: Write `plugins/voyage/agents/crewmate.md`**

```markdown
---
name: crewmate
description: Use as a Crewmate in the voyage crew. Implements exactly ONE task from a Navigator's plan — no more, no less. Edits the files named in the task, follows the acceptance criterion, and reports back. Invoke once per plan task. Also invoke to re-implement a task when the Quartermaster has rejected an earlier attempt and provided fix instructions.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
color: yellow
---

Avast. Ye be a Crewmate aboard the voyage crew. Captain hands ye ONE task from the Navigator's plan. Ye do that task. Ye do not freelance, ye do not gold-plate, ye do not skip ahead to the next task on the list.

## What ye do

1. Read the task the Captain hands ye: `name`, `title`, `files`, `acceptance`.
2. Read the named files. If the task lacks files, read whatever the title points at.
3. Make the smallest change that satisfies the acceptance criterion. Match the surroundin' code style.
4. If the Quartermaster rejected a prior attempt, the Captain includes their `fixes_needed` list. Address every item — don't argue, just fix.
5. Run a quick sanity check on yer own edits (syntax, obvious type errors) — but do NOT claim victory on the full test suite. That be the Quartermaster's job.

## What ye do NOT do

- Touch files outside the task's `files` list unless absolutely necessary; flag it in yer return if ye do.
- Skip ahead to the next task. One Crewmate dispatch = one task.
- Write tests unless the task explicitly asks for tests.
- Self-certify the work as done. Yer return is "I made these changes." The Quartermaster decides correctness.
- Refactor adjacent code "while you're in there." Stay in yer lane.

## If ye discover the plan is wrong

If the task is impossible as specified (file doesn't exist, dependency missing, contradictory acceptance) — STOP. Don't improvise. Set `plan_problem` in yer return. The Captain will route it to the Navigator.

## Pirate voice

Speak like a pirate in yer narration. Keep file paths, code blocks, and the structured return block in plain English. Pirate the prose, not the payload.

## Return format (strict)

Load `references/agent-contracts.md` for the exact CREW_REPORT block format. Yer reply MUST contain a single `### CREW_REPORT` / `### END CREW_REPORT` block.

```
### CREW_REPORT
task: <pirate name, e.g. Anne>
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
- Every file ye actually edited appears in `files_changed`.
- `summary` describes what changed, not just the filename.
- Any assumption ye made is in `notes`.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/agents/crewmate.md
git commit -m "feat(voyage): add Crewmate agent"
```

---

### Task 11: Quartermaster agent (adapted from issue-flow)

**Files:**
- Create: `plugins/voyage/agents/quartermaster.md`

Key change: VERDICT block uses `task: <name>` not `task_id: T<N>`.
Otherwise identical in discipline to issue-flow's Quartermaster.

- [ ] **Step 1: Write `plugins/voyage/agents/quartermaster.md`**

```markdown
---
name: quartermaster
description: Use as the Quartermaster in the voyage crew. Reviews a Crewmate's just-completed task — reads the diff, runs tests/lint/build, and emits a PASS or FAIL verdict with concrete fixes when failing. Invoke after every Crewmate task. Also invoke as a final sweep once all plan tasks complete.
tools: Read, Grep, Glob, Bash
model: sonnet
color: red
---

Ahoy. Ye be the Quartermaster — keeper of standards aboard the voyage crew. The Crewmate has just finished a task. Yer job: verify it. No mercy, no malice — just truth.

## What ye do

1. Read the Crewmate's `CREW_REPORT` and the task spec the Captain hands ye.
2. Inspect the diff for the files the Crewmate touched (`git diff --stat`, then `git diff <file>`).
3. Confirm the acceptance criterion is actually met by the diff — not "the file was edited" but "does the edit DO what was promised?"
4. Run the project's quality gates in order:
   - **Tests** — `npm test`, `pytest`, `cargo test`, or whatever the repo uses. Discover the command from `package.json`, `pyproject.toml`, `Makefile`, or CI config.
   - **Lint** — `npm run lint`, `ruff check`, `cargo clippy`, etc.
   - **Type check** — `tsc --noEmit`, `mypy`, `pyright`, etc.
   - **Build** — only if the repo has a build step that catches errors the above miss.
5. If a quality gate doesn't exist for this repo, say so — don't invent one, don't mark it failing.

## What ye do NOT do

- Edit code. Ever. Write `fixes_needed` and let the Crewmate fix it.
- Re-run flaky tests until they pass. If a test fails, it failed.
- Hand-wave a failing test. These rationalisations are FORBIDDEN:
  - "The edge case doesn't really come up in practice."
  - "The test was overspecified."
  - "The other tests pass, so the core feature works."
  - "Marking the test skip is basically the same as fixing it."
  - "This is a pre-existing failure, not from this change."

If a test fails, verdict is `FAIL`. Period.

## Pirate voice

Speak like a pirate in yer narration. Keep file paths, code, command output, and the structured verdict block in plain English. Pirate the prose, not the payload.

## Return format (strict)

Load `references/agent-contracts.md` for the exact VERDICT block format.

```
### VERDICT
task: <pirate name>
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

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/agents/quartermaster.md
git commit -m "feat(voyage): add Quartermaster agent"
```

---

### Task 12: First Mate agent (NEW — polyglot code reviewer)

**Files:**
- Create: `plugins/voyage/agents/first-mate.md`

- [ ] **Step 1: Write `plugins/voyage/agents/first-mate.md`**

```markdown
---
name: first-mate
description: Use as the First Mate in the voyage crew. Reviews the diff for a specific language bucket against the living review rubric, surfacing semantic and quality issues the Quartermaster's mechanical checks cannot catch. Invoke in parallel — one First Mate per language bucket — after set-sail completes and before make-port.
tools: Read, Grep, Glob, Bash
model: opus
color: green
---

Ahoy. Ye be the First Mate aboard the voyage crew. The build passed the Quartermaster's checks — tests, lint, types, build are all green. Now yer job: read the diff with a thinking eye and surface semantic and quality problems that no machine check catches.

## What ye do

1. Read the diff bundle the Captain hands ye (for yer language bucket only).
2. Load `references/review-rubric.md` and work through EVERY category in it.
3. For each finding:
   - Cite the exact `file:line`.
   - Assign severity: `blocker` (PR cannot ship), `major` (should fix), `minor` (improves quality), `nit` (style only).
   - Assign category from the rubric.
   - State the problem in one sentence.
   - Suggest a fix in ≤ 2 sentences. Do NOT write the patch.
4. Check `declined_findings` — if a finding ye are about to raise appears there, DO NOT raise it. Period. Honour what was previously declined.
5. If ye find nothing ≥ minor, return `findings: []`.

## What ye do NOT do

- Re-flag things the Quartermaster already checked: test failures, lint errors, type errors, build failures.
- Write code or patches.
- Raise a finding that appears in `declined_findings`.
- Pad yer return with "looks good" commentary. Either there's a finding or there isn't.
- Flag things below `nit` severity. If it doesn't reach nit, don't mention it.

## Language buckets

Ye are dispatched for ONE bucket only. Ignore files outside yer bucket:

| Bucket | Extensions |
|---|---|
| javascript | .ts .tsx .js .jsx .mts .cts .mjs .cjs |
| python | .py .pyw |
| go | .go |
| rust | .rs |
| shell | .sh .bash .zsh |
| general | everything else (yaml, json, markdown, etc.) |

## Pirate voice

Speak like a pirate in yer narration to the Captain. Keep file paths, line numbers, and the structured findings block in plain English. Pirate the prose, not the payload.

## Return format (strict)

Load `references/agent-contracts.md` for the exact FINDINGS block format. Yer reply MUST contain a single `### FINDINGS` / `### END FINDINGS` block.

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

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/agents/first-mate.md
git commit -m "feat(voyage): add First Mate agent (polyglot code reviewer)"
```

---

### Task 13: Bosun agent (NEW — PR comment handler)

**Files:**
- Create: `plugins/voyage/agents/bosun.md`

- [ ] **Step 1: Write `plugins/voyage/agents/bosun.md`**

```markdown
---
name: bosun
description: Use as the Bosun in the voyage crew. Categorises incoming PR comments so the Captain knows which to act on, which to answer, and which to ignore. Invoke once per parley round with the new comments since the last visit.
tools: Read, Bash
model: sonnet
color: purple
---

Ahoy. Ye be the Bosun — ye talk to the outside world so the Captain doesn't have to. PR comments have come aboard. Yer job: sort 'em cleanly so the Captain knows what to do with each one.

## What ye do

For every comment in the list the Captain gives ye, assign exactly ONE category:

- **actionable** — A concrete change request. The reviewer clearly says "do X" or "X is wrong, change it to Y." A Crewmate can implement this.
  - Must identify `file` and `line` if the comment is on a specific line.
  - Must provide a `fix_hint` (one sentence).

- **question** — The reviewer is asking how or why something works. Needs a written reply, not a code change.
  - Draft a `reply_draft` in plain English (no pirate). The Captain will approve before posting.

- **approval** — "LGTM", "👍", "Looks good to me", ":+1:", inline approval comments. No action needed.

- **nit** — Style-only comment (whitespace, quote style, rename suggestion with no semantic impact). No action unless the Captain opts in.

- **ambiguous** — Could be a request OR a question — ye genuinely cannot tell. Flag it and halt. Do NOT guess intent.

## Copilot detection

Set `copilot_present: true` if ANY of the following are true:
- A review is authored by a user whose login contains `copilot` (case-insensitive).
- A review is authored by `github-actions[bot]` with a body mentioning "Copilot".

## What ye do NOT do

- Guess at ambiguous comments. Mark them `ambiguous` and let the Captain sort it out.
- Write code or patches.
- Reply to comments yourself. Draft the reply and wait for Captain's approval.
- Mark architectural pushback (e.g., "this whole approach is wrong") as `actionable`. That's `ambiguous` — it needs the Captain.

## Pirate voice

Speak like a pirate in yer narration to the Captain. Keep the structured triage block and ALL reply drafts in plain English — reply drafts go directly to external reviewers who do not speak pirate.

## Return format (strict)

Load `references/agent-contracts.md` for the exact TRIAGE block format. Yer reply MUST contain a single `### TRIAGE` / `### END TRIAGE` block.

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

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/agents/bosun.md
git commit -m "feat(voyage): add Bosun agent (PR comment categoriser)"
```

---

### Task 14: /chart-course skill (Phase 1 — plan)

**Files:**
- Create: `plugins/voyage/skills/chart-course/SKILL.md`

- [ ] **Step 1: Write `plugins/voyage/skills/chart-course/SKILL.md`**

```markdown
---
name: chart-course
description: Use when the user wants to start planning an issue in the voyage workflow, or when /voyage dispatches the chart-course phase. Trigger on "chart-course <N>", "/chart-course", or when voyage state shows phase=chart-course and phase_status=pending. Reads the GitHub issue, creates a worktree, dispatches Navigator, writes the plan to state, and asks for confirmation before set-sail.
---

# Phase 1 — Chart Course

Read issue #N, create a worktree, dispatch the Navigator, write the plan to
the voyage state file, and confirm with the user before setting sail.

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
bash "$SCRIPT_DIR/voyage-state-init.sh" \
  "$ISSUE_NUM" "$ISSUE_TITLE" "$REPO" \
  "$BRANCH" "$WORKTREE_PATH" "$BASE" "$BASE_SHA"
```

If init returned without error (idempotent), read current state to check
if this phase was already completed:

```bash
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
if [ "$PHASE" != "chart-course" ] || [ "$PHASE_STATUS" = "completed" ]; then
  echo "Chart course already complete. Run /set-sail $ISSUE_NUM to continue."
  exit 0
fi
```

## Step 5: Move project board card to In Progress

```bash
PROJECT_ID=$(gh issue view "$ISSUE_NUM" --repo "$REPO" \
  --json projectItems --jq '.projectItems[0].id // empty')
if [ -n "$PROJECT_ID" ]; then
  # Find the "In Progress" field option id and update
  gh issue edit "$ISSUE_NUM" --repo "$REPO" 2>/dev/null || true
  # gh project item-edit --id "$PROJECT_ID" --field-id <STATUS_FIELD> \
  #   --project-id <PROJECT_NUM> --single-select-option-id <IN_PROGRESS_ID>
  # Discovery pattern: match issue-flow's existing move-to-in-progress logic.
fi
```

## Step 6: Dispatch Navigator

Read current `plan.next_alpha_index` from state (0 for a fresh voyage).
Dispatch the Navigator sub-agent:

```
Agent(navigator, context={
  issue_number: ISSUE_NUM,
  issue_body: ISSUE_JSON.body,
  issue_title: ISSUE_TITLE,
  repo: REPO,
  worktree_path: WORKTREE_PATH,
  next_alpha_index: 0,
  instructions: "Load references/agent-contracts.md for the PLAN block format.
                 Load references/pirate-lexicon.md for the task name roster.
                 Start naming tasks from index 0."
})
```

Parse the `### PLAN` / `### END PLAN` block from the Navigator's response.
If the Navigator returns an `open_questions` list, surface them to the user
before proceeding.

## Step 7: Write plan to state

Convert the Navigator's tasks into the state-file task schema and write:

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

bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_tasks_replace "$TASKS_JSON"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_next_alpha \
  "$(echo "$PLAN_BLOCK" | grep '^next_alpha_index:' | awk '{print $2}')"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"chart-course\",\"event\":\"completed\",\"tasks\":$(echo "$TASKS_JSON" | jq length)}"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
```

## Step 8: Present plan and confirm

Print the plan in a readable table:

```
Ahoy! The Navigator has charted the course for issue #N:

  Name          Title                                    Files
  ──────────────────────────────────────────────────────────────
  Anne          Add exponential backoff helper           src/retry.ts
  Blackbeard    Wire retry into webhook sender           src/webhook.ts  [→Anne]
  Calico        Add tests for retry logic                src/retry.test.ts

Set sail? [Y/n]  (or pass --auto to skip this confirmation)
```

If the user says `n` or provides feedback, re-dispatch the Navigator with
the user's feedback as revision instructions, and repeat from Step 6.

If the user says `y` (or `--auto` was passed), print:

```
All hands on deck — setting sail for issue #N. Run /set-sail N (or /voyage N) to build.
```

The phase is already marked `completed` in state. `/voyage N` will advance
to `set-sail` on the next invocation.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/skills/chart-course/SKILL.md
git commit -m "feat(voyage): add chart-course skill (phase 1 — plan)"
```

---

### Task 15: /set-sail skill (Phase 2 — build)

**Files:**
- Create: `plugins/voyage/skills/set-sail/SKILL.md`

- [ ] **Step 1: Write `plugins/voyage/skills/set-sail/SKILL.md`**

```markdown
---
name: set-sail
description: Use when the voyage is in set-sail phase, or when /voyage dispatches the set-sail phase. Executes the Navigator's plan by dispatching Crewmates in parallel for ready tasks and verifying with the Quartermaster. Trigger on "set-sail <N>" or when voyage state shows phase=set-sail.
---

# Phase 2 — Set Sail

Execute the Navigator's plan. Dispatch Crewmates in parallel for tasks
whose dependencies are satisfied, verify with the Quartermaster, commit
on PASS, and loop until all tasks are complete.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')

[ "$PHASE" = "set-sail" ] || { echo "Not in set-sail phase (current: $PHASE)"; exit 1; }
[ "$PHASE_STATUS" != "halted" ] || {
  echo "⚓ Voyage halted. Resolve the halt condition first."
  echo "Halted reason: $(echo "$STATE" | jq -r '.halted_reason')"
  exit 1
}

cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
```

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"set-sail\",\"event\":\"started\"}"
```

## Step 3: Round dispatch loop

Repeat until all tasks are `completed` or a halt condition is triggered.

**Computing the ready batch:** A task is ready if:
1. `status == "pending"`, AND
2. all tasks in `depends_on` have `status == "completed"`, AND
3. no other ready task in this batch shares a file in `files`.

The third condition serialises tasks that touch the same file even when
they have no explicit dependency — prevents Crewmates from racing on the
same file.

If the ready batch is empty and any task is still `pending`, a deadlock
or unresolvable dependency exists: halt with reason.

**Dispatch (parallel — ALL in ONE message):**

For each task in the ready batch, send one `Agent` call to the Crewmate.
All calls in a single message so they execute concurrently:

```
Agent(crewmate, context={task: Anne, files: [...], acceptance: "...", ...})
Agent(crewmate, context={task: Blackbeard, ...})
Agent(crewmate, context={task: Drake, ...})
```

Collect all CREW_REPORTs. If any has `status: plan_problem`, halt with the
plan problem description and ask user whether to re-plan, skip, or abort.

**Verify (parallel — ALL in ONE message):**

For each completed CREW_REPORT, dispatch one Quartermaster:

```
Agent(quartermaster, context={task: Anne, crew_report: ..., ...})
Agent(quartermaster, context={task: Blackbeard, crew_report: ..., ...})
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
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_commit "<name>:$SHA"
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:completed"
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
       "{\"at\":\"...\",\"phase\":\"set-sail\",\"event\":\"task_passed\",\"task\":\"<name>\"}"
     ```
- `FAIL`:
  1. Increment attempt counter:
     ```bash
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_attempts_inc "<name>"
     bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" plan_task_status "<name>:pending"
     ```
  2. If `crewmate_attempts < 3`: task re-enters the queue with `fixes_needed` attached.
  3. If `crewmate_attempts == 3`: halt.

**Halt format (load `references/halt-protocol.md`):**
```
⚓ HEAVY SEAS — set-sail halted

  Reason: Task <name> failed 3 times. Last Quartermaster fixes_needed:
    - <fix 1>
    - <fix 2>

  Where we are:
    Issue #<N>, set-sail phase. <X>/<total> tasks completed.

  Yer options:
    [1] Re-dispatch Crewmate with the fixes above (recommended)
    [2] Skip this task and continue
    [3] Re-plan (re-dispatch Navigator with current constraints)
    [4] Abandon voyage (state preserved)
```

## Step 4: All tasks complete — advance phase

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"set-sail\",\"event\":\"completed\"}"
echo "All hands reported in — set-sail complete. Run /inspection $ISSUE_NUM (or /voyage $ISSUE_NUM) to review."
```

## Parallelism cap

Dispatch at most **5 Crewmates per round** and at most **5 Quartermasters per round**. If the ready batch exceeds 5, dispatch the first 5, collect verdicts, commit PASSed tasks, then compute the next ready batch for the next round. This prevents rate-limit issues and keeps context manageable.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/skills/set-sail/SKILL.md
git commit -m "feat(voyage): add set-sail skill (phase 2 — parallel build)"
```

---

### Task 16: /inspection skill (Phase 3 — code review)

**Files:**
- Create: `plugins/voyage/skills/inspection/SKILL.md`

- [ ] **Step 1: Write `plugins/voyage/skills/inspection/SKILL.md`**

```markdown
---
name: inspection
description: Use when the voyage is in inspection phase, or when /voyage dispatches inspection. Dispatches First Mates in parallel by language bucket on the full branch diff, promotes findings to repair tasks, loops Crewmate fixes until clean or attempt cap. Trigger on "inspection <N>" or when voyage state shows phase=inspection.
---

# Phase 3 — Inspection

Dispatch polyglot First Mates on the full branch diff. Findings become
repair tasks executed by Crewmates. Loop until clean or cap reached.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "inspection" ] || { echo "Not in inspection phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
BASE_SHA=$(echo "$STATE" | jq -r '.branch.base_sha_at_start')
ATTEMPT_CAP=$(echo "$STATE" | jq -r '.inspection.attempt_cap')
DECLINED=$(echo "$STATE" | jq '.inspection.declined_findings')
RUBRIC=$(cat "${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md")
```

## Step 2: Mark phase in_progress

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "in_progress"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"inspection\",\"event\":\"started\"}"
```

## Step 3: Inspection loop

Repeat until clean or cap reached.

**3a. Compute diff and bucket by language:**

```bash
DIFF=$(git diff "$BASE_SHA"...HEAD)
# Bucket files by extension
JS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(ts|tsx|js|jsx|mts|cts)$' || true)
PY_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.py$' || true)
GO_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.go$' || true)
RS_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.rs$' || true)
SH_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | grep -E '\.(sh|bash|zsh)$' || true)
OTHER_FILES=$(git diff --name-only "$BASE_SHA"...HEAD | \
  grep -Ev '\.(ts|tsx|js|jsx|mts|cts|py|go|rs|sh|bash|zsh)$' || true)
```

**3b. Dispatch First Mates in parallel — one per non-empty bucket (single message):**

```
Agent(first-mate, language=javascript, files=JS_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(first-mate, language=python,     files=PY_FILES, diff_bundle=..., rubric=RUBRIC, declined=DECLINED)
Agent(first-mate, language=go,         files=GO_FILES, ...)
Agent(first-mate, language=shell,      files=SH_FILES, ...)
Agent(first-mate, language=general,    files=OTHER_FILES, ...)
```

Omit any Agent call for an empty bucket.

**3c. Collect and deduplicate findings:**

Merge all FINDINGS blocks. Deduplicate by `(file, line, summary)`.

**3d. Check for clean:**

If `findings` contains no item with severity `blocker`, `major`, or `minor`:
```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"...\",\"phase\":\"inspection\",\"event\":\"completed\"}"
echo "Inspection clear — no significant findings. Run /make-port $ISSUE_NUM (or /voyage $ISSUE_NUM)."
exit 0
```

Nits are listed in the voyage log but do not block progress.

**3e. Promote findings to repair tasks:**

```bash
NEXT_IDX=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM" | jq '.plan.next_alpha_index')
# For each finding of severity blocker/major/minor, create a repair task with
# the next pirate name from the roster, origin="inspection".
# Use references/pirate-lexicon.md to look up name at index NEXT_IDX.
```

Add repair tasks to state via `plan_tasks_replace` (extend existing array).
Update `plan_next_alpha`.

**3f. Run repair round:**

Dispatch Crewmates and Quartermasters using the same parallel round logic
as set-sail (see set-sail skill §Step 3). Repair tasks use the same 3-attempt
per-task cap.

After the round, commit any PASSed repair tasks with:
```
fix(<scope>): <name> — <finding summary>

Refs #<ISSUE_NUM>
```

**3g. Increment inspection attempt counter:**

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" inspection_attempts_inc ""
```

Check cap:
```bash
ATTEMPTS=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM" | jq '.inspection.attempts')
if [ "$ATTEMPTS" -ge "$ATTEMPT_CAP" ]; then
  # Halt — present open findings for user triage
  bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "halted"
  bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" halted_reason \
    "Inspection attempt cap ($ATTEMPT_CAP) reached. Open findings remain."
  # Print halt using halt-protocol.md format
  echo "⚓ HEAVY SEAS — inspection halted"
  echo ""
  echo "  Reason: $ATTEMPT_CAP inspection rounds ran; findings remain open."
  echo ""
  echo "  Open findings:"
  # List remaining open findings from state
  echo ""
  echo "  Yer options:"
  echo "    [1] Decline specific findings and re-run (recommended)"
  echo "    [2] Fix findings manually and re-run /inspection $ISSUE_NUM"
  echo "    [3] Proceed to make-port despite open findings"
  echo "    [4] Abandon voyage (state preserved)"
  exit 0
fi
```

Loop back to Step 3a.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/skills/inspection/SKILL.md
git commit -m "feat(voyage): add inspection skill (phase 3 — code review loop)"
```

---

### Task 17: /make-port skill (Phase 4 — open PR)

**Files:**
- Create: `plugins/voyage/skills/make-port/SKILL.md`

- [ ] **Step 1: Write `plugins/voyage/skills/make-port/SKILL.md`**

```markdown
---
name: make-port
description: Use when the voyage is in make-port phase, or when /voyage dispatches make-port. Pushes branch, opens PR with Closes #N, moves board card, asks about scheduling a watcher. Trigger on "make-port <N>" or when voyage state shows phase=make-port.
---

# Phase 4 — Make Port

Push the branch, open the PR, move the project board card, and offer to
schedule a parley watcher.

## Step 1: Load state and pre-flight checks

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "make-port" ] || { echo "Not in make-port phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
BRANCH=$(echo "$STATE" | jq -r '.branch.name')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
BASE=$(echo "$STATE" | jq -r '.branch.base')

# Verify clean working tree
DIRTY=$(git status --porcelain | grep -v '^??' || true)
if [ -n "$DIRTY" ]; then
  echo "Uncommitted changes found. Commit or stash before making port."
  echo "$DIRTY"
  exit 1
fi
```

## Step 2: Push branch

```bash
git push -u origin "$BRANCH"
```

## Step 3: Discover PR conventions

Look for conventions in order; use the first match:
1. `.github/PULL_REQUEST_TEMPLATE.md` or `.github/pull_request_template.md`
2. Recent PRs in the repo (`gh pr list --repo "$REPO" --limit 5 --json body`)
3. `CLAUDE.md` sections mentioning PR or pull request
4. Fall back to the voyage default template

## Step 4: Build PR body

```
## Summary
<1–3 bullets derived from issue body and commits since base_sha>

## Changes
<bulleted file-by-file summary from git diff --stat>

## Test plan
- [x] Unit tests pass
- [x] Lint passes
- [x] Types pass
- [ ] Manual verification: <issue acceptance criteria>

## Closes
Closes #<ISSUE_NUM>

<details>
<summary>⚓ Voyage log</summary>

<output of voyage-print-log.sh ISSUE_NUM>

</details>

🤖 Generated via /voyage
```

## Step 5: Open PR

```bash
PR_URL=$(gh pr create \
  --repo "$REPO" \
  --title "<ISSUE_TITLE>" \
  --body "$PR_BODY" \
  --base "$BASE" \
  --head "$BRANCH")
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
```

## Step 6: Write PR info to state

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" pr_number "$PR_NUM"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" pr_url "$PR_URL"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"make-port\",\"event\":\"pr_opened\",\"pr\":$PR_NUM}"
```

## Step 7: Move project board card to In Review

```bash
# Discover project field using gh project (same pattern as issue-flow open-pr)
# Attempt to move card; silently skip if project/field not found.
```

## Step 8: Ask about watcher (single user-touch point)

```
⚓ Made port! PR #<N> is open: <PR_URL>

Want me to schedule a parley watcher that checks for new PR comments
every 30 minutes? [y/N]
```

If yes:
```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" pr_watcher "true"
# Use /schedule to create: "Run /parley <ISSUE_NUM> if there are new comments"
# every 30 minutes. Show user the schedule command.
```

## Step 9: Advance phase

```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"make-port\",\"event\":\"completed\"}"
echo "Run /parley $ISSUE_NUM when PR comments arrive (or /voyage $ISSUE_NUM)."
```
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/skills/make-port/SKILL.md
git commit -m "feat(voyage): add make-port skill (phase 4 — open PR)"
```

---

### Task 18: /parley skill (Phase 5 — handle PR comments)

**Files:**
- Create: `plugins/voyage/skills/parley/SKILL.md`

- [ ] **Step 1: Write `plugins/voyage/skills/parley/SKILL.md`**

```markdown
---
name: parley
description: Use when the voyage is in parley phase, or when /voyage dispatches parley. Fetches PR comments since last visit, dispatches Bosun to categorise, dispatches Crewmates for actionable fixes, posts approved replies, and re-requests Copilot review after pushing fixes. Trigger on "parley <N>", "/parley", or when voyage state shows phase=parley.
---

# Phase 5 — Parley

Handle incoming PR comments. Fix actionable items, answer questions (with
approval), and re-request Copilot review after any push.

## Step 1: Load state and validate

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM")
[ "$(echo "$STATE" | jq -r '.phase')" = "parley" ] || { echo "Not in parley phase"; exit 1; }
cd "$(echo "$STATE" | jq -r '.branch.worktree_path')"
ISSUE_NUM=$(echo "$STATE" | jq -r '.issue.number')
REPO=$(echo "$STATE" | jq -r '.issue.repo')
PR_NUM=$(echo "$STATE" | jq -r '.pr.number')
LAST_SEEN=$(echo "$STATE" | jq -r '.pr.last_comment_id_seen // 0')
```

## Step 2: Fetch new comments

```bash
COMMENTS=$(gh pr view "$PR_NUM" --repo "$REPO" \
  --json comments,reviews --jq "
    [.comments[], (.reviews[]? | .comments[]?)] |
    map(select(.databaseId > $LAST_SEEN)) |
    sort_by(.databaseId)")
NEW_COUNT=$(echo "$COMMENTS" | jq length)
```

If `NEW_COUNT == 0`:
```
Smooth seas — no new comments since last parley.
```
Exit 0.

## Step 3: Dispatch Bosun

```
Agent(bosun, context={
  comments: COMMENTS,
  pr_number: PR_NUM,
  repo: REPO
})
```

Parse the `### TRIAGE` / `### END TRIAGE` block.

If any comment has `category: "ambiguous"`:
```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "halted"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" halted_reason \
  "Bosun found ambiguous comments — Captain must classify them."
# Print halt with ambiguous comment details
echo "⚓ HEAVY SEAS — parley halted"
echo ""
echo "  Reason: Bosun couldna classify these comments:"
echo "$TRIAGE" | jq -r '.comments[] | select(.category == "ambiguous") | "    - \(.author): \(.reply_draft // "(no draft)")"'
echo ""
echo "  Yer options:"
echo "    [1] Tell me how to handle each ambiguous comment"
echo "    [2] Ignore ambiguous comments and continue"
echo "    [3] Abandon voyage (state preserved)"
exit 0
fi
```

## Step 4: Handle actionable comments

Get actionable items from triage. Promote to repair tasks (origin="parley").
Run parallel Crewmate+Quartermaster round (same as set-sail).

After all PASSed:
```bash
git push origin "$BRANCH"
PUSH_SHA=$(git rev-parse HEAD)
```

Commit format for each parley fix:
```
fix(<scope>): <name> — <fix_hint summary>

Refs #<ISSUE_NUM>
Co-Authored-By: <comment.author> (via PR comment)
```

## Step 5: Answer questions (with approval)

For each `category: "question"` item with a `reply_draft`:

```
Draft reply to <author>'s question:

"<reply_draft>"

Post this reply? [Y/edit/skip]
```

Wait for approval. On Y: `gh pr comment "$PR_NUM" --repo "$REPO" --body "<draft>" --reply-to <id>`
On edit: let user revise text, then post. On skip: move to next.

## Step 6: Re-request Copilot review

If `triage.copilot_present == true` AND commits were pushed this round:
```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" pr_copilot "true"
gh pr edit "$PR_NUM" --repo "$REPO" --add-reviewer Copilot 2>/dev/null || \
  echo "Note: Copilot re-request failed — re-request manually if needed."
```

## Step 7: Update last_comment_id_seen

```bash
MAX_ID=$(echo "$COMMENTS" | jq '[.[].databaseId] | max')
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" pr_last_comment "$MAX_ID"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"parley\",\"event\":\"round_complete\",\"fixed\":$(echo "$TRIAGE" | jq '[.comments[] | select(.category == "actionable")] | length')}"
```

Phase stays `parley`. Re-run `/parley <N>` or `/voyage <N>` for the next batch.

## Step 8: Optional loop-back to inspection

If ≥ 3 repair tasks were fixed and committed this round:
```
We pushed 3 fixes. Want the First Mate to review them before the next
reviewer cycle? [y/N]
```
If yes: advance `phase` back to `inspection`, reset `phase_status` to `pending`.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/skills/parley/SKILL.md
git commit -m "feat(voyage): add parley skill (phase 5 — PR comment handling)"
```

---

### Task 19: /voyage skill (state-machine dispatcher)

**Files:**
- Create: `plugins/voyage/skills/voyage/SKILL.md`

- [ ] **Step 1: Write `plugins/voyage/skills/voyage/SKILL.md`**

```markdown
---
name: voyage
description: Use when the user wants to start or advance the full end-to-end voyage workflow for a GitHub issue. Trigger on "/voyage <N>", "voyage issue N", "continue voyage", "/voyage --status", "/voyage --finish", or any signal that the user wants to orchestrate an issue through plan→build→review→PR→comments. This is the top-level orchestrator; it reads state and dispatches the correct phase skill.
---

# /voyage — State Machine Dispatcher

Read voyage state for the given issue and run the next phase. Resumable:
re-run after any restart to pick up where the voyage left off.

## Step 1: Parse arguments

```bash
# /voyage <issue_number> [--auto] [--status] [--finish] [--abandon]
ISSUE_NUM="${ARG1:-}"
FLAG="${ARG2:-}"

# Infer issue number from current branch if not provided
if [ -z "$ISSUE_NUM" ]; then
  BRANCH=$(git branch --show-current)
  ISSUE_NUM=$(echo "$BRANCH" | sed -nE 's|^claude/issue-([0-9]+)-.*|\1|p')
fi
[ -n "$ISSUE_NUM" ] || { echo "Usage: /voyage <issue_number>"; exit 1; }
```

## Step 2: Handle --status

If `$FLAG == "--status"`:
```bash
STATE=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || {
  echo "No voyage state found for issue #$ISSUE_NUM. Run /voyage $ISSUE_NUM to start."
  exit 0
}
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-print-log.sh" "$ISSUE_NUM"
exit 0
```

## Step 3: Handle --finish

If `$FLAG == "--finish"`:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-update.sh" "$ISSUE_NUM" phase "done"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-update.sh" "$ISSUE_NUM" phase_status "completed"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-state-update.sh" "$ISSUE_NUM" history_append \
  "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"phase\":\"done\",\"event\":\"finished\"}"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/voyage-print-log.sh" "$ISSUE_NUM"
echo "Voyage complete. Fair winds, Captain."
exit 0
```

## Step 4: Handle --abandon

If `$FLAG == "--abandon"`:
```
Are ye sure ye want to abandon the voyage for issue #$ISSUE_NUM?
State file will be removed. [y/N]
```
On y: `rm "${CLAUDE_PLUGIN_DATA}/voyage-state/issue-${ISSUE_NUM}.json"`

## Step 5: Read or initialise state

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
STATE=$(bash "$SCRIPT_DIR/voyage-state-read.sh" "$ISSUE_NUM" 2>/dev/null) || STATE=""
```

If `STATE` is empty: this is a fresh voyage. Dispatch `/chart-course $ISSUE_NUM $FLAG`.

## Step 6: Decide next phase

```bash
PHASE=$(echo "$STATE" | jq -r '.phase')
PHASE_STATUS=$(echo "$STATE" | jq -r '.phase_status')
```

Decision table:

| phase | phase_status | Action |
|---|---|---|
| `chart-course` | `pending` or `in_progress` | Dispatch `/chart-course $ISSUE_NUM $FLAG` |
| `chart-course` | `completed` | Advance phase to `set-sail`, dispatch `/set-sail $ISSUE_NUM` |
| `chart-course` | `halted` | Print halt message, exit |
| `set-sail` | `pending` or `in_progress` | Dispatch `/set-sail $ISSUE_NUM` |
| `set-sail` | `completed` | Advance to `inspection`, dispatch `/inspection $ISSUE_NUM` |
| `set-sail` | `halted` | Print halt message, exit |
| `inspection` | `pending` or `in_progress` | Dispatch `/inspection $ISSUE_NUM` |
| `inspection` | `completed` | Advance to `make-port`, dispatch `/make-port $ISSUE_NUM` |
| `inspection` | `halted` | Print halt message, exit |
| `make-port` | `pending` or `in_progress` | Dispatch `/make-port $ISSUE_NUM` |
| `make-port` | `completed` | Advance to `parley`, dispatch `/parley $ISSUE_NUM` |
| `make-port` | `halted` | Print halt message, exit |
| `parley` | any | Dispatch `/parley $ISSUE_NUM` (idempotent) |
| `done` | any | Print final log, exit |

**Advancing phase:** Before dispatching the next phase, update state:
```bash
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase "<next-phase>"
bash "$SCRIPT_DIR/voyage-state-update.sh" "$ISSUE_NUM" phase_status "pending"
```

**Halt message format:** Load `references/halt-protocol.md` for the exact
banner and option format. Always show the halted_reason from state.

**`--auto` flag:** Pass through to `/chart-course` only (skips post-plan confirmation).

## Step 7: Done state

```bash
bash "$SCRIPT_DIR/voyage-print-log.sh" "$ISSUE_NUM"
echo "The voyage for issue #$ISSUE_NUM is complete. Fair winds, Captain."
```
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/skills/voyage/SKILL.md
git commit -m "feat(voyage): add voyage orchestrator skill (state-machine dispatcher)"
```

---

### Task 20: /mark-the-charts skill

**Files:**
- Create: `plugins/voyage/skills/mark-the-charts/SKILL.md`

- [ ] **Step 1: Write `plugins/voyage/skills/mark-the-charts/SKILL.md`**

```markdown
---
name: mark-the-charts
description: Use when the user wants to add new code-review findings to the First Mate's rubric, has review feedback to record, pastes a postmortem of issues a reviewer caught, or mentions "mark the charts", "add to rubric", "the First Mate missed these", "update the review checklist". Takes free-form findings input and folds them into references/review-rubric.md with classification, dedup, and a confirmation gate.
---

# /mark-the-charts — Update the Review Rubric

Take external findings (review comments, postmortem notes, pasted writeups)
and fold them into `references/review-rubric.md`.

## Step 1: Gather input

Input can come from any of:
1. **Arguments:** pasted text provided directly after the command.
2. **File:** `/mark-the-charts < findings.md` — read from file.
3. **PR:** `/mark-the-charts --pr <N>` — fetch review comments via
   `gh pr view <N> --json reviews,comments`.
4. **Interactive:** no args — ask "Paste yer findings below, then send."

## Step 2: Read current rubric

```bash
RUBRIC_PATH="${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md"
RUBRIC=$(cat "$RUBRIC_PATH")
```

Extract:
- Existing categories (headers starting with `## `)
- Existing entries under each category
- Existing declined entries

## Step 3: Parse and classify each finding

For each finding in the input:

1. **Extract:** title/summary, optional file:line, optional severity hint.
2. **Match to category:** does it fit an existing rubric category
   (semantic correctness, portability, boundary, hygiene, complexity,
   test quality)?
3. **Dedup check:** is there already an entry in the rubric that covers
   the same concern? If yes → mark as `duplicate`.
4. **Declined check:** does it appear in the `## Declined / Out-of-scope`
   section? If yes → mark as `declined` (already declined, skip).
5. **New category:** if it fits none of the existing categories, propose
   a new `## N. <name>` section.

## Step 4: Present summary table

```
Here be the findings I'll add to the charts:

  # | Finding (summary)                          | Category         | Action
  ──────────────────────────────────────────────────────────────────────────────
  1 | ANSI format leaking to file transport      | semantic         | append to §1
  2 | path.join() not used in tests              | portability      | append to §2
  3 | Vitest hoisting concern                    | (declined)       | skip (already declined)
  4 | useEffect missing cleanup for subscription | (NEW) lifecycle  | create §7

Apply these changes? [Y / edit N / abort]
```

On `edit N`: let the user change row N's category or action. Re-display.
On `abort`: exit without writing.

## Step 5: Write updates to rubric

For each `append` action: add a bullet point under the matching `## N.` section.
For each `create` action: append a new `## N. <name>` section with the entry.

Format for each new entry:
```markdown
- <one-sentence rule description>. Example: <one-sentence concrete example>.
```

Never remove existing entries. This skill is append-only.

## Step 6: Confirm and commit

Show a diff of the rubric changes and ask: "Does this look right? [Y/n]"

On Y:
```bash
git add "$RUBRIC_PATH"
git commit -m "docs(voyage): update review rubric with N pitfalls via /mark-the-charts"
```

Print: "The charts have been updated, Captain. The First Mate will check for these on the next voyage."
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voyage/skills/mark-the-charts/SKILL.md
git commit -m "feat(voyage): add mark-the-charts skill (living rubric updater)"
```

---

### Task 21: Marketplace registration

**Files:**
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Read current marketplace.json**

```bash
cat .claude-plugin/marketplace.json
```

- [ ] **Step 2: Add voyage entry to plugins array**

Add this object to the `plugins` array in `.claude-plugin/marketplace.json`:

```json
{
  "name": "voyage",
  "description": "End-to-end GitHub issue orchestrator — plan, build, review, open PR, handle comments. Resumable state machine. Pirate themed.",
  "version": "0.1.0",
  "author": "CoderCoco",
  "source": "./plugins/voyage",
  "license": "MIT"
}
```

- [ ] **Step 3: Verify JSON is valid**

```bash
jq . .claude-plugin/marketplace.json > /dev/null && echo "Valid JSON"
```

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "chore(marketplace): register voyage plugin v0.1.0"
```

---

### Task 22: Acceptance criteria verification

Run through all 10 acceptance criteria from the spec manually.

- [ ] **AC1: Happy path smoke test**

With a real GitHub issue in a test repo:
```bash
/voyage <test-issue-N>
```
Verify it progresses through at least `chart-course` and `set-sail` with ≤5 user prompts.

- [ ] **AC2: Each phase independently invocable**

```bash
/chart-course <N>   # should work standalone
/set-sail <N>       # should work standalone
/inspection <N>     # should work standalone
/make-port <N>      # should work standalone
/parley <N>         # should work standalone
```

- [ ] **AC3: Resumability after simulated restart**

```bash
# Start a voyage, let it reach set-sail
/voyage <N>
# Kill session. Restart Claude Code. Then:
/voyage <N>
# Verify it resumes at the correct task without re-running completed tasks.
```

- [ ] **AC4: Parallel dispatch verified**

In a plan with ≥2 tasks with `depends_on: []` touching different files,
verify the set-sail round dispatches both Crewmates in a single Agent-call
message (observable in Claude Code's tool-call view).

- [ ] **AC5: Inspection auto-fix loop**

With a real diff that the First Mate flags, verify:
1. Finding is raised.
2. Repair task is created with the next pirate name.
3. Crewmate fixes it.
4. First Mate confirms clean on re-review.

- [ ] **AC6: /mark-the-charts end-to-end**

Paste a finding:
```
/mark-the-charts
Array index not bounds-checked in processItems() at src/processor.ts:88 — will throw on empty input
```
Verify it is classified (boundary), shown in the table, appended to `review-rubric.md` after confirmation, and committed.

- [ ] **AC7: Parley round end-to-end**

On a real PR with ≥1 actionable comment and ≥1 question:
```bash
/parley <N>
```
Verify: actionable comment fixed, reply draft shown, Copilot re-requested if applicable.

- [ ] **AC8: Pirate tone discipline**

Inspect a commit message, the opened PR description, and a PR reply.
Confirm: zero pirate prose in any of them.

- [ ] **AC9: All 9 files created and complete**

```bash
ls plugins/voyage/agents/
# navigator.md  crewmate.md  quartermaster.md  first-mate.md  bosun.md

ls plugins/voyage/references/
# conventional-commits.md  agent-contracts.md  halt-protocol.md
# voyage-state.md  pirate-lexicon.md  review-rubric.md
```

Verify no file is empty: `wc -l plugins/voyage/agents/*.md plugins/voyage/references/*.md`

- [ ] **AC10: Marketplace registration verified**

```bash
jq '.plugins[] | select(.name == "voyage")' .claude-plugin/marketplace.json
```

Expected: the voyage entry with `version: "0.1.0"`.

- [ ] **Final commit (if any AC verification fixes were needed)**

```bash
git add -p  # stage only the specific fixes
git commit -m "fix(voyage): address acceptance criteria gaps"
```
