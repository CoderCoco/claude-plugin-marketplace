---
name: pane-launch
description: Use whenever launching Claude agents, panes, or panels through Pane — `runpane panes create`, `runpane panels create`, `runpane panes adopt --launch`, `runpane agents start`, or the mcp__pane__agents_start / mcp__pane__panels_create tools. Ensures Claude workers start with an explicit --tool-command and session id instead of the built-in template that skips permission prompts.
---

# Pane Agent Launch

## Step 1 — Never use bare `--agent claude`

Pane's built-in `--agent claude` template runs `claude --dangerously-skip-permissions`, silently disabling all permission prompts. Never rely on it.

## Step 2 — Launch with an explicit tool command

    --agent claude --tool-command 'claude --session-id "$(uuidgen)"'

Applies to `runpane panes create`, `runpane panels create`, `runpane panes adopt --launch`, `runpane agents start`, and the `mcp__pane__agents_start` / `mcp__pane__panels_create` tools (MCP fields: `agent: "claude"`, `toolCommand: 'claude --session-id "$(uuidgen)"'`).

## Step 3 — Mind the caveats

- `{sessionId}` is NOT expanded by `--tool-command`; it is only a placeholder in the resume templates of a saved custom command in Pane's UI. Generate the id in the shell with `$(uuidgen)` — the command runs in the Pane shell, so the substitution happens there.
- Keep `--agent claude` alongside `--tool-command` so Pane still treats the panel as Claude Code and `--wait-ready` works.
- The CLI has no flag for resume templates. If resume (`claude --resume <id>`) matters, ask the user to launch from their saved shortcut in the Pane UI.
- Codex and Cursor launches are unaffected.

## Step 4 — Expect the guard hook

This plugin's PreToolUse hook denies Claude launches that lack `--tool-command` or `--session-id`, or that pass `--dangerously-skip-permissions`. If denied, rewrite the launch per Step 2 and retry.
