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
