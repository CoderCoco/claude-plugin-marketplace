---
name: pane-launch
description: Use whenever launching Claude agents, panes, or panels through Pane — `runpane panes create`, `runpane panels create`, `runpane panes adopt --launch`, `runpane agents start`, or the mcp__pane__agents_start / mcp__pane__panels_create tools. Gives copy-pasteable call templates (MCP and CLI), a required-parameters checklist, a common-errors table, and recovery steps, and ensures Claude workers start with an explicit --tool-command and session id instead of the built-in template that skips permission prompts.
---

# Pane Agent Launch

Copy the templates below verbatim and fill in the `<placeholders>`. Do not improvise parameter names — every guess costs a failed call.

## Step 1 — Never use bare `--agent claude`

Pane's built-in `--agent claude` template runs `claude --dangerously-skip-permissions`, silently disabling all permission prompts. Never rely on it. Always pass `agent: "claude"` **together with** an explicit `toolCommand` (MCP) / `--tool-command` (CLI) carrying `--session-id`.

## Step 2 — Before launching: look for an existing Pane

1 feature = 1 worktree = 1 branch = 1 Pane. Creating a Pane builds a worktree, so only create one when the work has no Pane yet. Check all three:

    mcp__pane__panes_list                 (or: runpane panes list --json)
    git worktree list
    git branch --list '*<task-keyword>*'

- **Pane match in `panes_list`** → reuse it with template B (agent tab, `pane: "<pane-id>"`). Never create a duplicate Pane.
- **Matching worktree without a Pane** → adopt it with the `panes adopt ... --launch` command in template D. Do not use template B without a Pane ID.
- **Branch-only match without a Pane** → resolve the associated worktree or Pane first (`git worktree list`, `panes_list`), then pick one of the two rows above.
- **No match** → use template A (new Pane).

## Step 3 — Required parameters checklist

Before every call, confirm:

- [ ] `agent: "claude"` AND `toolCommand: "claude --session-id \"$(uuidgen)\""` are both present (never one without the other).
- [ ] Param names are **camelCase** in MCP: `toolCommand`, `baseBranch`. The hyphenated `tool-command` is rejected as an unknown argument. (CLI flags stay hyphenated: `--tool-command`, `--base-branch`.)
- [ ] `yes: true` is a JSON **boolean**, not the string `"true"`.
- [ ] New Pane: `repo` is an id or name returned by `mcp__pane__repos_list` (never an absolute path) **and** `name` is a kebab-case string.
- [ ] Existing Pane: `pane: "<pane-id>"` from `panes_list`, and **no** `repo` / `name`.
- [ ] `prompt` is set for `agents_start` (the task for the agent).

## Step 4 — Copy-paste call templates

### A. MCP — new Pane + agent (`agents_start`)

First list repos and take an `id` or `name` from the output:

    mcp__pane__repos_list {}

Then:

    mcp__pane__agents_start {
      "repo": "<id or name from repos_list>",
      "name": "<kebab-case-pane-name>",
      "agent": "claude",
      "toolCommand": "claude --session-id \"$(uuidgen)\"",
      "yes": true,
      "prompt": "<full task prompt for the agent>"
    }

`baseBranch` (CLI: `--base-branch`) is optional and omitted above: add `"baseBranch": "<branch>"` only when the user chose a base branch that exists in the repo; otherwise Pane uses the repo default. Creating a Pane can take over a minute (worktree install/build) — see Step 5 if it times out.

### B. MCP — agent tab in an existing Pane (`agents_start` with `pane`)

    mcp__pane__agents_start {
      "pane": "<pane-id from panes_list>",
      "agent": "claude",
      "toolCommand": "claude --session-id \"$(uuidgen)\"",
      "yes": true,
      "prompt": "<full task prompt for the agent>"
    }

### C. MCP — extra terminal/agent tab without a prompt (`panels_create`)

    mcp__pane__panels_create {
      "pane": "<pane-id>",
      "agent": "claude",
      "toolCommand": "claude --session-id \"$(uuidgen)\"",
      "yes": true
    }

### D. CLI equivalents

New Pane + agent:

    runpane agents start --repo "<id-or-name>" --name "<kebab-name>" \
      --agent claude --tool-command 'claude --session-id "$(uuidgen)"' \
      --prompt "<task>" --yes

Agent tab in an existing Pane:

    runpane agents start --pane "<pane-id>" \
      --agent claude --tool-command 'claude --session-id "$(uuidgen)"' \
      --prompt "<task>" --yes

New Pane only (no prompt):

    runpane panes create --repo "<id-or-name>" --name "<kebab-name>" \
      --agent claude --tool-command 'claude --session-id "$(uuidgen)"' --yes

Extra panel in an existing Pane:

    runpane panels create --pane "<pane-id>" \
      --agent claude --tool-command 'claude --session-id "$(uuidgen)"' --yes

Adopt an existing worktree and launch an agent in it (`--launch` is what starts the agent):

    runpane panes adopt --repo "<id-or-name>" --path "<worktree-path>" --name "<kebab-name>" \
      --agent claude --tool-command 'claude --session-id "$(uuidgen)"' --launch --yes

## Step 5 — If `agents_start` times out or fails

Symptom: the call runs >120s, gets backgrounded, then fails with `Timed out waiting for Pane <id> setup. Pane <id> was created before the failure and was kept`. The Pane exists in status `initializing` with only explorer / diff / dock-terminal panels and **no agent panel**. (`agents_status` on it errors with `Panel ... is a explorer panel, not a terminal panel`.)

1. **Do not retry template A** — that creates a duplicate Pane.
2. Run `mcp__pane__panes_list` and find the Pane id from the error (or by name).
3. Add the agent with template B (`pane: "<that id>"`, `agent`, `toolCommand`, `yes: true`, `prompt`). Never retry with `repo` / `name` (CLI: `--pane`, never `--repo`/`--name`).
4. Verify with `mcp__pane__agents_status` using the returned panel id.

## Step 6 — Common errors → fix

| Error text | Cause | Exact fix |
|---|---|---|
| `runpane agents start needs --pane <id> ... or --repo and --name` | Called with only `prompt` | Add `pane: "<id>"` (existing Pane) or `repo` + `name` (new Pane). |
| `runpane panes create requires --agent or --tool-command in non-interactive shells.` | No agent given | Add `agent: "claude"` **and** `toolCommand: "claude --session-id \"$(uuidgen)\""`. |
| Hook deny (MCP tool): `Pane Claude launches must not use the bare agent: "claude" template...` | `agent: "claude"` without `toolCommand` | Add `toolCommand: "claude --session-id \"$(uuidgen)\""` (camelCase), keep `agent: "claude"`. |
| Hook deny (Bash/CLI): `Pane Claude launches must not use the bare --agent claude template...` | `--agent claude` without `--tool-command` | Add `--tool-command 'claude --session-id "$(uuidgen)"'` next to `--agent claude`. |
| `Unknown argument(s) for agents_start: tool-command` | Hyphenated MCP param name | Use camelCase `toolCommand`. Don't send both spellings. |
| `yes` ignored / call refused without confirmation | `yes: "true"` (string) or missing | Pass the boolean `yes: true`. |
| `ERR_RUNPANE_REPO_NOT_FOUND` | `repo` was an absolute path or guessed name | Call `mcp__pane__repos_list` and pass an `id` or `name` from it. |
| `Timed out waiting for Pane <id> setup. Pane <id> was created before the failure and was kept` | Worktree setup exceeded the timeout | Step 5: `panes_list` → template B with `pane: "<id>"`. Never a new Pane. |
| `Panel ... is a explorer panel, not a terminal panel` (from `agents_status`) | Pane has no agent panel (orphaned `initializing` Pane) | Step 5: add the agent with template B, then use the new panel id. |
| `Permission denied` running `check-pane-launch.sh` | Hook script not executable | Update the plugin (>= 0.1.2). `hooks.json` runs it as `bash "${CLAUDE_PLUGIN_ROOT}/hooks/check-pane-launch.sh"` deliberately, so the exec bit isn't required — do not "simplify" it to a bare path. |

## Step 7 — Mind the caveats

- `{sessionId}` is NOT expanded by `--tool-command` / `toolCommand`; it is only a placeholder in the resume templates of a saved custom command in Pane's UI. Generate the id in the shell with `$(uuidgen)` — the command runs in the Pane shell, so the substitution happens there.
- Keep `agent: "claude"` / `--agent claude` alongside the tool command so Pane still treats the panel as Claude Code and `--wait-ready` works.
- The CLI has no flag for resume templates. If resume (`claude --resume <id>`) matters, ask the user to launch from their saved shortcut in the Pane UI.
- Codex and Cursor launches are unaffected.
- Only pass `yes: true` when the user asked for the change.

## Step 8 — Expect the guard hook

This plugin's PreToolUse hook denies Claude launches that lack `toolCommand` / `--tool-command` or `--session-id`, or that pass `--dangerously-skip-permissions`. For `mcp__pane__*` tools the denial shows the exact MCP params; for Bash it shows the CLI flags. If denied, rewrite the launch per Step 4 and retry.
