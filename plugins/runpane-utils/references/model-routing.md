# Model routing

Pick the cheapest model that reliably finishes the task. Consumed by the `determine-model` and `determine-effort` skills, which also say how to apply the choice per consumer. For Pane launches, which have no model option, the choice is spliced into the tool command:

    claude --model <alias> --effort <level> --session-id "$(uuidgen)"

Sources: [model-config](https://code.claude.com/docs/en/model-config), [optimizing cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence).

## Tiers

| Alias | Resolves to | Model ID | Role | $/MTok in / out |
|-------|-------------|----------|------|-----------------|
| `haiku` | Haiku 5.5 | `claude-haiku-5-5` | Simple, mechanical, well-specified tasks | 0.10 / 0.50 |
| `sonnet` | Sonnet 5.5 | `claude-sonnet-5-5` | Most work. **Default.** | 2 / 10 |
| `opus` | Opus 5.5 | `claude-opus-5-5` | Complex tasks: unclear root cause, many interacting files | 4 / 20 |
| `fable` | Fable 5.1 | `claude-fable-5-1` | Most complicated: architecture, security-critical, long-horizon | 10 / 50 |

Prefer the alias over the full ID so launches track the current generation.

## Decision procedure

1. **User named a model and/or effort** → use exactly that. It always wins over routing. Route only the part they left unspecified.
2. Classify the task with `task-signals.md` (our own judgment, not an Anthropic taxonomy).
3. Not sure → **sonnet / medium**.
4. Choose effort per `effort-levels.md`.
5. Splice `--model <alias> --effort <level>` into the tool command before `--session-id`.

## Tie-breakers

- **Effort before model.** Anthropic's guidance: tune effort first, switch model only if the right effort on the cheaper model still fails.
- **Escalate on failure.** For batches, run at low effort first and rerun only the failures at high. Don't pay the high-effort price for every item.
- **Price the tail.** One failed Fable-class task that has to be redone costs more than the Opus run that would have succeeded; one needless Fable run costs 2.5x Opus. Weigh the cost of failure, not just the sticker price.
- Don't upgrade a dev task just because the research step used a bigger model; tiers are per task.

## Fable fallback

Fable may need a one-time usage-credit consent in the user's account. If a Fable launch fails (agent panel never starts, consent/credit error), relaunch the same task with `--model opus --effort xhigh` and tell the user.
