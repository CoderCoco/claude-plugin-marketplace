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
