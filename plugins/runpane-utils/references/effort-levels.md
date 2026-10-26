# Effort levels

Always pass `--effort` explicitly. Defaults differ between sources (Sonnet 5.5 is `medium` in Claude Code but `high` in the API docs), so an unstated effort is unpredictable.

Sources: [effort](https://platform.claude.com/docs/en/build-with-claude/effort), [model-config](https://code.claude.com/docs/en/model-config).

## Levels

| Level | Use for | Notes |
|-------|---------|-------|
| `low` | Trivial, mechanical edits; batch first pass | **Never on haiku** — at `low` Haiku skips verification checks. Use `medium`+. |
| `medium` | Routine implementation, bugfixes, tests | Claude Code default for Opus/Sonnet/Haiku 5.5. Our default. |
| `high` | Multi-file work, debugging, review, audit | Escalation target when `low`/`medium` fails. |
| `xhigh` | Agentic work expected to run >30 min; hardest tasks | Required base for `ultracode`. |
| `max` | Rarely. Absolute ceiling | Tends to overthink; session-only (rejected as `effortLevel` in settings). Avoid unless the user asks. |
| `ultracode` | Substantive multi-phase, orchestrated work | See below. |

## Starting matrix (model x effort)

| Model | Typical starting effort |
|-------|-------------------------|
| haiku | medium (never low) |
| sonnet | medium; high for multi-file |
| opus | high; xhigh for long-running |
| fable | high; xhigh for long-horizon |

## `ultracode`

`--effort ultracode` = `xhigh` + dynamic workflows (the agent may orchestrate sub-agents). Documented in model-config (v2.1.203+) but **not shown in local `claude --help`** — treat as docs-only; if the launch errors on the flag, fall back to `--effort xhigh`.

Use only when the task is substantive, multi-phase, and benefits from orchestration (e.g. "implement this spec end to end across several modules, with review passes"). Needs an xhigh-capable model: **opus or fable**, not haiku or sonnet.

## Precedence

Environment (`CLAUDE_CODE_EFFORT_LEVEL`) > `--effort` flag > settings `effortLevel`. If the Pane shell exports the env var, the flag is overridden; mention it if routing seems ignored.
