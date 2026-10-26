# runpane-utils

Guardrails for launching Claude workers through [Pane](https://runpane.com) (`runpane` CLI and `mcp__pane__*` tools).

Pane's built-in `--agent claude` template expands to `claude --dangerously-skip-permissions`, silently disabling permission prompts. This plugin blocks that and teaches the safe form.

## Install

```shell
/plugin marketplace add CoderCoco/claude-plugin-marketplace
/plugin install runpane-utils@codercoco-custom-plugin-marketplace
```

Requires [`bun`](https://bun.sh) on `PATH` (runs the hook, as in the `pr-watch` plugin). Without it, Pane-related calls are denied with an install hint.

## What's included

| Piece | Purpose |
|-------|---------|
| `skills/pane-launch` | Guidance that triggers whenever Claude launches Pane agents/panes/panels |
| `skills/determine-model` | `/runpane-utils:determine-model`: picks a model alias for any delegated work (Pane launch, Agent tool, Workflow) and says how to apply it |
| `skills/determine-effort` | `/runpane-utils:determine-effort`: picks an effort level for any delegated work and says how to apply it |
| `references/` | Single source of truth for routing: `model-routing.md`, `effort-levels.md`, `task-signals.md` |
| `hooks/check-pane-launch.ts` | PreToolUse hook (`Bash`, `mcp__pane__agents_start`, `mcp__pane__panels_create`) that denies unsafe Claude launches |
| `hooks/check-pane-launch.sh` | Thin shim `hooks.json` calls: runs the `.ts` with bun, or fails closed for Pane calls if bun is missing |
| `hooks/check-pane-launch.test.ts` | `bun:test` suite for the hook and the shim |

## The required launch form

```shell
--agent claude --tool-command 'claude --model <alias> --effort <level> --session-id "$(uuidgen)"'
```

`--model` and `--effort` are mandatory (see [Model routing](#model-routing)). Safe default: `--model sonnet --effort medium`.

## What the hook blocks

Only Claude launches are inspected; Codex/Cursor and unrelated commands pass through.

- `runpane panes create`, `runpane panels create`, `runpane agents start`, and `runpane panes adopt --launch` with `--agent claude` (also `--agent=claude`, quoted) and no `--tool-command`.
- A `--tool-command` for Claude without `--session-id`, or containing `--dangerously-skip-permissions`.
- A Claude launch whose tool command lacks `--model` and/or `--effort` (`--model=opus` forms count). See [Enforcement](#enforcement).
- `--tool-command claude ...` without `--agent` (still a Claude launch).
- `mcp__pane__agents_start` / `mcp__pane__panels_create` with `agent: "claude"` and no `toolCommand` (or one lacking `--session-id`). MCP field names are the CLI flags camelCased, so `--tool-command` is `toolCommand`.
- Wrapped commands such as `--tool-command 'env FOO=1 claude ...'`.
- Quote-split flags (`--dangerously-skip"-"permissions`) are caught by stripping quotes and backslashes before checking.
- Fail closed: unparseable hook input is denied; if `bun` is missing, any call mentioning `runpane` or `mcp__pane__` is denied (other calls pass); a command too large or deeply nested to analyze is denied.

### Command-aware inspection (Bash)

Claude Code gives hooks only the raw `tool_input.command` string (no parsed structure), so `check-pane-launch.ts` tokenizes the command like a small shell parser and validates only commands that **execute** `runpane`. Text that merely mentions a launch is ignored.

Inspected (these execute):

- Each simple command, split on `;`, `&&`, `||`, `|`, `&`, newlines and `(`/`)`. Quotes are respected, so a `;` inside a quoted string does not split. Redirections (`2>&1`, `&>f`, `>(cmd)`) are removed from the argument list.
- Any command carrying a `runpane` word as the command word or after wrappers and prefixes: `VAR=val`, `env`, `sudo`, `nohup`, `time`, `xargs`, `find -exec`, `npx runpane`, `pnpm dlx runpane`, path-qualified `/usr/bin/runpane`, `{runpane,}`, zsh `=runpane`. Commands that only take data (`echo`, `printf`, `grep`, `git`, `gh`, `cat`, `jq`, `cd`, ...) are skipped.
- `$(...)`, backticks and `<(...)` anywhere, including inside double quotes and unquoted heredoc bodies; `$'...'` / `$"..."` are decoded.
- `bash|sh|zsh|dash|ksh|fish -c '...'`, `eval ...`, `env -S '...'`, `watch '...'`, `su -c '...'`.
- Text fed to a shell: `bash <<EOF`, `bash <<< '...'`, `echo '...' | sh`, `bash <(...)`, `source /dev/stdin`, and `bash -c "$(cat <<EOF ...)"`. When one appears, every captured command, word and heredoc body is rescanned as a script (with `echo` etc. no longer skipped).
- An unterminated heredoc is scanned as a script rather than skipped.

Not inspected (mentions, not launches): heredoc bodies, arguments of data-only commands (`echo`, `grep`, `git commit -m`, `gh pr create --body`), single-quoted strings, comments.

The policy reads the `--tool-command` **value** only, so `--tool-command claude --prompt '--session-id'` is denied. `--agent` matching is case-insensitive.

### Not covered

- `--from-json` launches (the payload is not inspected).
- Anything that cannot be resolved statically: variables, aliases or functions as the command word (`$RP panels create ...`, `f(){ runpane "$@"; }`), scripts invoked by file (`bash launch.sh`), `python -c` / `node -e` calling `runpane`, `ssh host '...'`, globs, `${IFS}` tricks, zsh `${:-runpane}`.
- Loose matching can over-deny: any non-data command with a bare `runpane` word is validated, and when a shell reads stdin anywhere in the command, every string in the command is rescanned, so `git commit -m '<launch text>'; echo hi | bash` is denied.
- Commands over about 500k tokenizer steps or 40 nested scans are denied rather than analyzed.

## Model routing

Two standalone skills choose a model and an effort level for any work you delegate, not just Pane launches:

| Skill | Returns | Applied as |
|-------|---------|------------|
| `/runpane-utils:determine-model` | `haiku` / `sonnet` / `opus` / `fable` | Pane: `--model <alias>` in the tool command. Agent tool: `model: "<alias>"`. Workflow `agent()`: `{model: "<alias>"}` |
| `/runpane-utils:determine-effort` | `low` / `medium` / `high` / `xhigh` / `max` / `ultracode` | Pane: `--effort <level>`. Agent tool: `effort`. Workflow `agent()`: `{effort}` |

- haiku = simple, sonnet = most (default `sonnet`/`medium`), opus = complex, fable = most complicated.
- A model/effort named by the user always wins.
- `ultracode` (substantive multi-phase orchestrated work, opus/fable) is valid only for Pane/CLI launches (`--effort ultracode`); the Agent tool and Workflow accept `low`–`max`, so use `xhigh` there.
- The `pane-launch` skill (Step 3b) delegates to these skills and splices the result into the tool command, since Pane has no model/effort option:

```shell
claude --model <alias> --effort <level> --session-id "$(uuidgen)"
```

- The task-signal table is our own judgment, not an Anthropic taxonomy.

References (read by the skills; the only place the tables live): `references/model-routing.md`, `references/effort-levels.md`, `references/task-signals.md`.

## Enforcement

The hook denies every Claude launch (Bash/CLI, `mcp__pane__agents_start`, `mcp__pane__panels_create`) whose tool command lacks `--model` or `--effort`. **User-visible consequence:** a launch with only `claude --session-id ...` is refused with a message that names the missing flag(s), points at `/runpane-utils:determine-model` and `/runpane-utils:determine-effort`, and offers `sonnet`/`medium` as a safe fallback; the model then relaunches with routed flags. An explicit model/effort from the user still wins. `--session-id` and `--dangerously-skip-permissions` rules are unchanged. The check is a textual match on the same quote-stripped command used for the other flags, so it confirms the flags are present, not that their values are valid.

## Caveats

- `{sessionId}` is **not** expanded by `--tool-command`. It is only a placeholder in the resume templates of a saved custom command in Pane's UI. Use `$(uuidgen)`, evaluated by the Pane shell.
- Keep `--agent claude` next to `--tool-command` so Pane treats the panel as Claude Code and `--wait-ready` works.
- The Pane CLI has no flag for resume templates; if `claude --resume <id>` matters, launch from a saved shortcut in the Pane UI.

## Troubleshooting

MCP param names are camelCase (`toolCommand`, `baseBranch`), `yes` must be the boolean `true`, and `agent: "claude"` always goes together with `toolCommand`, which carries `--model`, `--effort` and `--session-id`. The `pane-launch` skill has ready-to-copy templates.

| Error | Fix |
|-------|-----|
| `runpane agents start needs --pane <id> ... or --repo and --name` | Pass `pane: "<id>"` (existing Pane) or `repo` + `name` (new Pane). |
| `runpane panes create requires --agent or --tool-command in non-interactive shells.` | Pass `agent: "claude"` and `toolCommand: "claude --model sonnet --effort medium --session-id \"$(uuidgen)\""`. |
| Hook deny (MCP): `must not use the bare agent: "claude" template` | Add `toolCommand: "claude --model sonnet --effort medium --session-id \"$(uuidgen)\""` next to `agent: "claude"` (route model/effort per task). |
| Hook deny (Bash/CLI): `must not use the bare --agent claude template` | Add `--tool-command 'claude --model sonnet --effort medium --session-id "$(uuidgen)"'` next to `--agent claude`. |
| Hook deny: `must carry both --model and --effort ... missing: ...` | Run `/runpane-utils:determine-model` and `/runpane-utils:determine-effort`, add the missing flag(s). Unsure → `--model sonnet --effort medium`. |
| `Unknown argument(s) for agents_start: tool-command` | Use camelCase `toolCommand`. |
| `yes` string vs boolean | Pass `yes: true`, not `"true"`. |
| `ERR_RUNPANE_REPO_NOT_FOUND` | `repo` must be an id/name from `mcp__pane__repos_list`, not a path. |
| `Timed out waiting for Pane <id> setup. Pane <id> was created before the failure and was kept` | Don't retry with `repo`/`name`. `panes_list` for the id, then `agents_start` with `pane: "<id>"` + `agent` + `toolCommand` + `yes: true`. |
| `Panel ... is a explorer panel, not a terminal panel` | Same orphaned `initializing` Pane: add the agent tab via `pane: "<id>"`. |
| `Permission denied` on `check-pane-launch.sh` | Update to >= 0.1.2. `hooks.json` invokes it via `bash "${CLAUDE_PLUGIN_ROOT}/hooks/check-pane-launch.sh"` on purpose, so the exec bit isn't required. |

## Tests

```shell
cd plugins/runpane-utils/hooks && bun test
```
