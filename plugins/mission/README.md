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
