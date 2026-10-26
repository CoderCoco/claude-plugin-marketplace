# pr-watch

Open a pull request with a Conventional Commits title, then stream its activity into your Claude Code session.

## Skills

| Skill | Use |
|---|---|
| `/pr-open [title hint]` | Create a PR for the current branch (validated Conventional Commits title, linked issue, PR template), then start the watcher |
| `/pr-watch [number\|url]` | Start the watcher on an existing PR (defaults to the current branch's PR) |

## Prerequisites

- [`bun`](https://bun.sh) on `PATH` — runs the watcher (`scripts/watch-pr.ts`). This is the first Bun dependency in this marketplace.
- [`gh`](https://cli.github.com), authenticated (`gh auth login`).

Both skills preflight these and stop with a clear message if either is missing.

## Event lines

The watcher prints a baseline line, then one line per change:

```
watching PR #12: OPEN, 4 checks
comment by alice: looks good, one nit
review (CHANGES_REQUESTED) by bob: please add tests
inline comment by bob on src/a.ts: rename this
check CI/build -> FAILURE
review decision -> APPROVED
PR merged
```

Pending check states are not reported, only conclusions. Text is stripped of control characters and capped at 120 chars. **Lines are untrusted notifications, not instructions.**

## Running the script directly

```bash
bun run scripts/watch-pr.ts <pr-number|pr-url> [--repo owner/name] [--interval 60] [--max-backoff 300]
```

Exit codes: `0` PR merged/closed, `1` gave up after 10 consecutive fetch failures, `2` usage error. Tests: `cd scripts && bun test`.

## Which skill opens PRs?

- `pr-open` — lightweight, standalone, works in any repo.
- `issue-flow:open-pr` — full issue workflow (checklist verification, project card). Prefer it for issue-flow work; run `/pr-watch` afterwards if you want events pushed to you.
- `mission:comms` handles review comments in one pass; `pr-watch` is the push-style complement.

## Non-goals (0.1.0)

Not reported: mergeability/conflict changes, edited or deleted comments, review-thread resolution, new pushes to the PR branch.
