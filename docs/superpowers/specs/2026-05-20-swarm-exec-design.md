# swarm-exec design spec

**Date:** 2026-05-20
**Status:** approved
**Skill:** `issue-flow:swarm-exec` (new, alongside existing `issue-flow:swarm`)

## Problem

The existing `/swarm` skill runs the full Navigator → Crewmate → Quartermaster orchestration loop inside the main Claude Code agent's context window. Every handoff, plan parse, retry decision, and commit accumulates in that context. For non-trivial issues (5–10 tasks, multiple retries) the Captain's context grows large, increasing token cost and making it easier for the model to rationalize past its own iron rules (skip the Quartermaster, silently dispatch a 4th attempt, etc.).

## Goals

1. **Token cost** — the main agent's context stays flat after setup; the loop never touches it.
2. **Reliability** — orchestration logic lives in Python code, not in model working memory. The retry cap, phase transitions, and commit-on-pass are enforced by the interpreter, not by the Captain re-reading its own instructions.
3. **Testability** — the state machine, structured block parser, and dependency scheduler can be unit-tested without running real agents.

## Non-goals

- Replacing `/swarm`. The new skill runs alongside it until proven stable.
- Building a general-purpose agent orchestration framework.
- Handling cases where `claude` CLI is not installed.

## Architecture

Two hard layers with a single boundary:

### Layer 1 — Skill (`SKILL.md`)

Runs in the main CC agent context. Performs the cheap CC-specific bootstrap (Steps 0–4 from `/swarm`):

- Resolve issue number (arg, branch name, or user prompt)
- Read issue via GitHub MCP or `gh issue view`
- Create git worktree off fresh `origin/<default-branch>` via bash
- Move project board card to "In Progress"
- Initialise state file via `init-state.sh`

Then blocks on one bash call:

```bash
SWARM_SCRIPTS="${CLAUDE_SKILL_DIR}/../swarm/scripts"
python3 "${CLAUDE_SKILL_DIR}/scripts/swarm_executor.py" \
  --state "$STATE_FILE" \
  --worktree "$WORKTREE_PATH" \
  --owner "$OWNER" \
  --repo "$REPO" \
  --issue "$N" \
  --swarm-scripts "$SWARM_SCRIPTS"
```

`CLAUDE_SKILL_DIR` points at `swarm-exec/`, so the shared bash helpers under `swarm/scripts/` are reached via the `../swarm/scripts` sibling path. The executor calls those scripts via `subprocess.run(["bash", script_path, ...])` using the passed `--swarm-scripts` directory.

When Python exits 0 the skill reads state and prints the voyage log (ASCII + markdown inline). On non-zero exit it surfaces stderr verbatim.

**allowed-tools:** `Bash(git:*)`, `Bash(gh:*)`, `Bash(bash *swarm/scripts/*)`, `Bash(python3 *)`, `Read`

### Layer 2 — Executor (`scripts/swarm_executor.py`)

Pure Python (~400 lines). No CC agent involvement in the loop. Owns:

- State machine execution
- Agent dispatch via `claude -p` subprocesses
- Structured block parsing
- Dependency graph scheduling (parallel tasks)
- Git commits
- User escalation (stdin)

## State machine

```
planning
  └─(Navigator)──▶ building
                      └─ tick loop:
                           compute ready set (depends_on satisfied)
                           dispatch ready tasks concurrently (ThreadPoolExecutor)
                           each task: Crewmate ──▶ Quartermaster
                             PASS   ──▶ commit, mark completed
                             FAIL <3 ──▶ re-dispatch Crewmate with fixes_needed
                             FAIL =3 ──▶ escalate to user (skip / re-plan / hand off)
                             plan_problem ──▶ re-dispatch Navigator with context
                           all tasks completed ──▶ phase = done ──▶ exit 0
```

On startup the executor reads the state file. If `phase == "building"`, any tasks with status `in_progress` are reset to `pending` and the ready set is recomputed from scratch. This handles interrupted parallel runs cleanly — no attempt to rejoin in-flight threads, just restart from the last committed boundary.

## Parallelism

The plan task schema gains one field:

```json
{
  "id": "T2",
  "desc": "...",
  "files": ["..."],
  "acceptance": "...",
  "depends_on": ["T1"]
}
```

Tasks with `"depends_on": []` are eligible to run immediately. At each tick Python computes the ready set (all tasks whose `depends_on` ids are `completed`) and dispatches them concurrently via `ThreadPoolExecutor`.

**Concurrency rules:**
- Each thread runs its own Crewmate → Quartermaster → commit cycle.
- State file writes are serialised via a `threading.Lock` (wrapping `update-state.sh` and `append-handoff.sh` calls).
- Git `add` + `commit` pairs are serialised via a separate `threading.Lock` to prevent interleaved commits.
- Circular dependencies are detected at plan-load time (topological sort); executor halts with a clear error before any agent is dispatched.

**Parallel FAIL handling:**
- One task fails all 3 attempts, user picks "skip" → other in-flight tasks continue.
- One task fails all 3 attempts, user picks "re-plan" → wait for all in-flight tasks to finish, then dispatch Navigator with failure context.

## Agent dispatch

```python
result = subprocess.run(
    ["claude", "-p", prompt, "--allowedTools", tools],
    capture_output=True, text=True, timeout=timeout_secs,
    cwd=worktree_path   # sets working directory for the claude subprocess
)
```

Default timeout: 300 seconds per call, configurable via `--timeout` CLI arg.

**Prompt construction:** The executor reads the existing agent definition files (`plugins/issue-flow/agents/navigator.md`, `crewmate.md`, `quartermaster.md`), strips YAML frontmatter, and appends task-specific context (issue body, task spec, `fixes_needed`, previous plan, etc.) as a trailing block. One source of truth for agent instructions — edits to agent files benefit both `/swarm` and `/swarm-exec`.

**Allowed tools per agent:**

| Agent | Tools |
|---|---|
| Navigator | `Read,Grep,Glob,Bash,WebFetch` |
| Crewmate | `Read,Write,Edit,Bash,Grep,Glob` |
| Quartermaster | `Read,Grep,Glob,Bash` |

## Structured block parsing

```python
match = re.search(r'### PLAN\n(.*?)\n### END PLAN', output, re.DOTALL)
```

Same patterns for `### CREW_REPORT ... ### END CREW_REPORT` and `### VERDICT ... ### END VERDICT`.

On miss: retry `claude -p` once with a "missing required block" suffix appended to the prompt. After two misses on the same agent call: halt and escalate to user.

## Git commits

On Quartermaster PASS, while holding the git lock:

```python
subprocess.run(["git", "add"] + files_changed, cwd=worktree_path, check=True)
subprocess.run(["git", "commit", "-m", commit_msg], cwd=worktree_path, check=True)
```

Commit message format: same Conventional Commits shape as `/swarm` (`<type>(<scope>): T<N> - <desc>`, `Refs #<ISSUE>`, `Co-Authored-By` footer). Commit failure halts immediately — no retry, no hook bypass.

## Error handling

| Failure | Response |
|---|---|
| `claude -p` exits non-zero | Log stderr to handoff log, retry once, then halt non-zero |
| Structured block missing | Retry once with "missing block" suffix; after 2 misses escalate |
| Git commit fails | Halt immediately, surface verbatim stderr, exit non-zero |
| Circular dependency in plan | Detect at plan-load, print cycle, exit non-zero before any dispatch |
| `claude -p` timeout | Treated as non-zero exit |

## File layout

```
plugins/issue-flow/skills/swarm-exec/
  SKILL.md                          ← bootstrap + python call + voyage log
  scripts/
    swarm_executor.py               ← state machine (~400 lines)

# Reused, not duplicated:
plugins/issue-flow/skills/swarm/scripts/   ← all existing bash helpers
plugins/issue-flow/agents/                 ← navigator.md, crewmate.md, quartermaster.md
```

## Navigator prompt update

The Navigator agent prompt (`agents/navigator.md`) must be updated to include `depends_on` in its required task output schema. Tasks with no dependencies emit `"depends_on": []`. The Navigator is instructed to declare dependencies conservatively — only when a task genuinely requires a prior task's output.

## Open questions

None. All design decisions resolved.
