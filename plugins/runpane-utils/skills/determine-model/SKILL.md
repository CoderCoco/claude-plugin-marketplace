---
name: determine-model
description: Use whenever you must CHOOSE a model for work you delegate or launch — Pane launches (mcp__pane__agents_start / panels_create, `runpane agents start`, `runpane panes create`), the Agent tool's `model` parameter, Workflow/orchestration scripts (`agent()` opts.model), or any similar spawn of a Claude worker. Returns a model alias (haiku, sonnet, opus, fable) picked from the task's complexity, plus exactly how to apply it for that consumer. Pair with determine-effort.
---

# Determine Model

Pick the cheapest model that reliably finishes the delegated task, then apply it the way the consumer expects. The routing tables live in `references/` (single source of truth) — do not restate them from memory.

## Step 1 — Honor an explicit choice

If the user (or the repo/CLAUDE.md instructions) named a model for this work, use exactly that. It always wins. Route only what they left unspecified, and skip to Step 4.

## Step 2 — Read the references

`Read` these (use the first path that exists for each):

- `${CLAUDE_PLUGIN_ROOT}/references/model-routing.md` (fallback `${CLAUDE_SKILL_DIR}/../../references/model-routing.md`)
- `${CLAUDE_PLUGIN_ROOT}/references/task-signals.md` (fallback `${CLAUDE_SKILL_DIR}/../../references/task-signals.md`)

## Step 3 — Classify and choose

Match the task against the signal table in `task-signals.md`:

| Alias | Use for |
|-------|---------|
| `haiku` | simple, mechanical, well-specified |
| `sonnet` | most work — **default when unsure** |
| `opus` | complex: unclear root cause, many interacting files, review/audit |
| `fable` | most complicated: architecture, security-critical, long-horizon |

Unsure between two → take the cheaper one; escalate on failure. Use the alias, not a full model ID, so it tracks the current generation.

## Step 4 — Apply it for the consumer

| Consumer | How to apply |
|----------|--------------|
| Pane launch (`agents_start`, `panels_create`, `runpane ...`) | Put `--model <alias>` inside the tool command: `claude --model <alias> --effort <level> --session-id "$(uuidgen)"`. Pane has no separate model option, and the runpane-utils hook **denies Claude launches without `--model`**. |
| Agent tool | Set `model: "<alias>"`. Accepted values: `sonnet`, `opus`, `haiku`, `fable`. Omitting it inherits the parent session's model. |
| Workflow / orchestration script | Set `opts.model` on the `agent()` call: `agent(prompt, {model: "<alias>"})`. Omitting it inherits the main-loop model, which is usually right for uniform stages — set it per stage only when the tier genuinely differs (cheap `haiku`/`sonnet` for mechanical stages, `opus`/`fable` for verify/judge). |
| Anything else | Use the consumer's own model option with the alias; if it has none, state the chosen alias in the task prompt so the choice is visible. |

## Step 5 — Fallbacks

- **Fable fails** (consent/credit error, agent never starts): relaunch with `opus` and tell the user. Fable can need a one-time usage-credit consent. If an Agent-tool/Workflow `fable` call errors the same way, retry with `opus`.
- **Alias rejected** by an older harness: drop the override so the call inherits the session model, and say so.
- **Cannot classify** (references unreadable): use `sonnet`.

Return the alias and the ready-to-paste application snippet for the consumer. Then run `/runpane-utils:determine-effort` for the matching effort level.
