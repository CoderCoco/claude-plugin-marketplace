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
