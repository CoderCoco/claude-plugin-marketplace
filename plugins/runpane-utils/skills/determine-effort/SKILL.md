---
name: determine-effort
description: Use whenever you must CHOOSE a reasoning-effort level for work you delegate or launch — Pane launches (mcp__pane__agents_start / panels_create, `runpane agents start`, `runpane panes create`), the Agent tool's `effort` parameter, Workflow/orchestration scripts (`agent()` opts.effort), or any similar spawn of a Claude worker. Returns an effort level (low, medium, high, xhigh, max, or ultracode for Pane/CLI launches) picked from the task's difficulty and the chosen model, plus exactly how to apply it for that consumer. Pair with determine-model.
---

# Determine Effort

Choose how hard the delegated worker should think, then apply it the way the consumer expects. Effort levels and the model x effort matrix live in `references/` — do not restate them from memory.

## Step 1 — Honor an explicit choice

If the user (or the repo/CLAUDE.md instructions) named an effort level for this work, use exactly that. It always wins. Route only what they left unspecified, and skip to Step 4.

## Step 2 — Read the references

`Read` these (use the first path that exists for each):

- `${CLAUDE_PLUGIN_ROOT}/references/effort-levels.md` (fallback `${CLAUDE_SKILL_DIR}/../../references/effort-levels.md`)
- `${CLAUDE_PLUGIN_ROOT}/references/task-signals.md` (fallback `${CLAUDE_SKILL_DIR}/../../references/task-signals.md`)

Know the model first (`/runpane-utils:determine-model`); the starting effort depends on it.

## Step 3 — Classify and choose

Use the starting matrix in `effort-levels.md` and the signal table in `task-signals.md`:

- Default: **`medium`**. Routine implementation, bugfixes, tests.
- `high`: multi-file work, debugging, review, audit; escalation target when `medium` fails.
- `xhigh`: agentic work expected to run >30 min; hardest tasks.
- `low`: trivial mechanical edits only — **never on haiku** (use `medium`+).
- `max`: avoid unless the user asks (overthinks; session-only).
- `ultracode`: see caveats below.

Tune effort before switching to a bigger model.

## Step 4 — Apply it for the consumer

| Consumer | How to apply |
|----------|--------------|
| Pane launch (`agents_start`, `panels_create`, `runpane ...`) | Put `--effort <level>` inside the tool command: `claude --model <alias> --effort <level> --session-id "$(uuidgen)"`. Pane has no separate effort option, and the runpane-utils hook **denies Claude launches without `--effort`**. `ultracode` is valid here. |
| Agent tool | Set `effort: "<level>"`. Accepted values: `low`, `medium`, `high`, `xhigh`, `max`. **`ultracode` is not accepted** — use `xhigh`. Omitting it inherits the session effort. The tool's own guidance says to set it only when the user or a skill/instruction explicitly asks for effort routing; this skill is such an instruction when the user has installed it, but don't set it speculatively for trivial spawns. |
| Workflow / orchestration script | Set `opts.effort` on the `agent()` call: `agent(prompt, {effort: "<level>"})`. Accepted values: `low`, `medium`, `high`, `xhigh`, `max` (no `ultracode`). Omit to inherit. Use `low` for cheap mechanical stages and higher tiers only for the hardest verify/judge stages. |
| Anything else | Use the consumer's own effort option if it has one. If it has none, effort cannot be set there; say so rather than inventing a flag. |

## Step 5 — `ultracode` and other caveats

- `--effort ultracode` = `xhigh` + dynamic workflows. Only for substantive, multi-phase, orchestrated work, and only on an xhigh-capable model (`opus` or `fable`, never `haiku`/`sonnet`).
- It is documented (model-config, v2.1.203+) but absent from some local `claude --help` output. If a Pane/CLI launch errors on it, relaunch with `--effort xhigh`.
- It exists only for Pane/CLI launches. For the Agent tool and Workflow scripts, translate to `xhigh`.
- The `CLAUDE_CODE_EFFORT_LEVEL` environment variable overrides `--effort`. If routing seems ignored in a Pane shell, check for it.
- **Cannot classify** (references unreadable): use `medium`.

Return the level and the ready-to-paste application snippet for the consumer.
