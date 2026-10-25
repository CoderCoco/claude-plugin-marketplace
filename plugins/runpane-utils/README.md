# runpane-utils

Guardrails for launching Claude workers through [Pane](https://runpane.com) (`runpane` CLI and `mcp__pane__*` tools).

Pane's built-in `--agent claude` template expands to `claude --dangerously-skip-permissions`, silently disabling permission prompts. This plugin blocks that and teaches the safe form.

## Install

```shell
/plugin marketplace add CoderCoco/claude-plugin-marketplace
/plugin install runpane-utils@codercoco-custom-plugin-marketplace
```

Requires `jq` on `PATH`.

## What's included

| Piece | Purpose |
|-------|---------|
| `skills/pane-launch` | Guidance that triggers whenever Claude launches Pane agents/panes/panels |
| `hooks/check-pane-launch.sh` | PreToolUse hook (`Bash`, `mcp__pane__agents_start`, `mcp__pane__panels_create`) that denies unsafe Claude launches |
| `tests/test-check-pane-launch.sh` | Plain-shell test suite for the hook |

## The required launch form

```shell
--agent claude --tool-command 'claude --session-id "$(uuidgen)"'
```

## What the hook blocks

Only Claude launches are inspected; Codex/Cursor and unrelated commands pass through.

- `runpane panes create|adopt`, `runpane panels create`, `runpane agents start` with `--agent claude` (also `--agent=claude`, quoted) and no `--tool-command`.
- A `--tool-command` for Claude without `--session-id`, or containing `--dangerously-skip-permissions`.
- `--tool-command claude ...` without `--agent` (still a Claude launch).
- `mcp__pane__agents_start` / `mcp__pane__panels_create` with `agent: "claude"` and no `toolCommand` (or one lacking `--session-id`). MCP field names are the CLI flags camelCased, so `--tool-command` is `toolCommand`.
- Commands are checked across pipes, `&&` chains, and multi-line input.

Not covered: `--from-json` launches (the payload is not inspected).

## Caveats

- `{sessionId}` is **not** expanded by `--tool-command`. It is only a placeholder in the resume templates of a saved custom command in Pane's UI. Use `$(uuidgen)`, evaluated by the Pane shell.
- Keep `--agent claude` next to `--tool-command` so Pane treats the panel as Claude Code and `--wait-ready` works.
- The Pane CLI has no flag for resume templates; if `claude --resume <id>` matters, launch from a saved shortcut in the Pane UI.

## Tests

```shell
plugins/runpane-utils/tests/test-check-pane-launch.sh
```
