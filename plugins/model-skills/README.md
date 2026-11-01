# model-skills

Pick the model and reasoning-effort level for work you delegate to Claude workers, and get the exact snippet to apply the choice. Tool-agnostic: works with the Agent tool, Workflow scripts, wmux, and the plain `claude` CLI.

## Install

```shell
/plugin marketplace add CoderCoco/claude-plugin-marketplace
/plugin install model-skills@codercoco-custom-plugin-marketplace
```

## Skills

| Skill | Returns | Applied as |
|-------|---------|------------|
| `/model-skills:determine-model` | `haiku` / `sonnet` / `opus` / `fable` | see consumer table |
| `/model-skills:determine-effort` | `low` / `medium` / `high` / `xhigh` / `max` / `ultracode` | see consumer table |

References (the only place the routing tables live): `references/model-routing.md`, `references/effort-levels.md`, `references/task-signals.md`.

## Consumers

| Consumer | Model | Effort |
|----------|-------|--------|
| Agent tool | `model: "<alias>"` | `effort: "<level>"` (no `ultracode`; use `xhigh`) |
| Workflow `agent()` | `{model: "<alias>"}` | `{effort: "<level>"}` (no `ultracode`) |
| wmux `fanout_start` | `agents: [{agent: "claude", model, effort}]`, one per task | same entry; `ultracode` ok with `agent: "claude"`. `roles`/`preset` pick from operator bindings instead |
| wmux `remote_spawn` | cannot be set (remote PC's default applies) | cannot be set (remote PC's default applies) |
| `claude` CLI | `--model <alias>` | `--effort <level>` (`ultracode` ok) |

## Defaults

- haiku = simple, sonnet = most (default `sonnet`/`medium`), opus = complex, fable = most complicated.
- A model/effort named by the user always wins.
- `ultracode` (substantive multi-phase orchestrated work, opus/fable) works only for CLI launches and wmux `fanout_start`; elsewhere use `xhigh`.
- The task-signal table is our own judgment, not an Anthropic taxonomy.
