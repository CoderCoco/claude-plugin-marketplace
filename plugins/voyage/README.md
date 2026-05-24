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
