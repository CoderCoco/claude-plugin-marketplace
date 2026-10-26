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

- `runpane panes create`, `runpane panels create`, `runpane agents start`, and `runpane panes adopt --launch` with `--agent claude` (also `--agent=claude`, quoted) and no `--tool-command`.
- A `--tool-command` for Claude without `--session-id`, or containing `--dangerously-skip-permissions`.
- `--tool-command claude ...` without `--agent` (still a Claude launch).
- `mcp__pane__agents_start` / `mcp__pane__panels_create` with `agent: "claude"` and no `toolCommand` (or one lacking `--session-id`). MCP field names are the CLI flags camelCased, so `--tool-command` is `toolCommand`.
- Wrapped commands such as `--tool-command 'env FOO=1 claude ...'`.
- Commands are split on `;`, `&&`, `||`, `|` and newlines, and every `runpane` launch is validated on its own.
- Quote-split flags (`--dangerously-skip"-"permissions`) are caught by stripping quotes and backslashes before checking.
- If `jq` is missing, Pane-related calls are denied (fail closed); other calls pass.

Not covered: `--from-json` launches (the payload is not inspected) and shell expansion beyond quote stripping (variables, `eval`).

## Model routing

The `pane-launch` skill (Step 3b) picks a model and effort per task and splices them into the tool command, since Pane has no model/effort option:

```shell
claude --model <haiku|sonnet|opus|fable> --effort <low|medium|high|xhigh|max|ultracode> --session-id "$(uuidgen)"
```

- haiku = simple, sonnet = most (default `sonnet`/`medium`), opus = complex, fable = most complicated; `ultracode` for substantive multi-phase orchestrated work.
- A model/effort named by the user always wins. `--effort` is always passed explicitly.
- The hook needs no changes: extra flags pass, `--session-id` is still required, `--dangerously-skip-permissions` is still denied.
- The task-signal table is our own judgment, not an Anthropic taxonomy.

References (read by the skill): `references/model-routing.md`, `references/effort-levels.md`, `references/task-signals.md`.

## Caveats

- `{sessionId}` is **not** expanded by `--tool-command`. It is only a placeholder in the resume templates of a saved custom command in Pane's UI. Use `$(uuidgen)`, evaluated by the Pane shell.
- Keep `--agent claude` next to `--tool-command` so Pane treats the panel as Claude Code and `--wait-ready` works.
- The Pane CLI has no flag for resume templates; if `claude --resume <id>` matters, launch from a saved shortcut in the Pane UI.

## Troubleshooting

MCP param names are camelCase (`toolCommand`, `baseBranch`), `yes` must be the boolean `true`, and `agent: "claude"` always goes together with `toolCommand`. The `pane-launch` skill has ready-to-copy templates.

| Error | Fix |
|-------|-----|
| `runpane agents start needs --pane <id> ... or --repo and --name` | Pass `pane: "<id>"` (existing Pane) or `repo` + `name` (new Pane). |
| `runpane panes create requires --agent or --tool-command in non-interactive shells.` | Pass `agent: "claude"` and `toolCommand: "claude --session-id \"$(uuidgen)\""`. |
| Hook deny (MCP): `must not use the bare agent: "claude" template` | Add `toolCommand: "claude --session-id \"$(uuidgen)\""` next to `agent: "claude"`. |
| Hook deny (Bash/CLI): `must not use the bare --agent claude template` | Add `--tool-command 'claude --session-id "$(uuidgen)"'` next to `--agent claude`. |
| `Unknown argument(s) for agents_start: tool-command` | Use camelCase `toolCommand`. |
| `yes` string vs boolean | Pass `yes: true`, not `"true"`. |
| `ERR_RUNPANE_REPO_NOT_FOUND` | `repo` must be an id/name from `mcp__pane__repos_list`, not a path. |
| `Timed out waiting for Pane <id> setup. Pane <id> was created before the failure and was kept` | Don't retry with `repo`/`name`. `panes_list` for the id, then `agents_start` with `pane: "<id>"` + `agent` + `toolCommand` + `yes: true`. |
| `Panel ... is a explorer panel, not a terminal panel` | Same orphaned `initializing` Pane: add the agent tab via `pane: "<id>"`. |
| `Permission denied` on `check-pane-launch.sh` | Update to >= 0.1.2. `hooks.json` invokes it via `bash "${CLAUDE_PLUGIN_ROOT}/hooks/check-pane-launch.sh"` on purpose, so the exec bit isn't required. |

## Tests

```shell
plugins/runpane-utils/tests/test-check-pane-launch.sh
```
