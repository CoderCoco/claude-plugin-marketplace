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
