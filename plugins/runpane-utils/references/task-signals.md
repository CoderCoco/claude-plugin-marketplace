# Task signals

**This table is our own judgment.** No Anthropic doc gives complexity signals for Claude Code tasks. Treat it as a starting heuristic and let the user's explicit choice and observed failures override it.

## Signal table

| Signals in the task | Route (`--model` / `--effort`) |
|---------------------|-------------------------------|
| Typo, rename, formatting, version bump, copy edit, single-file mechanical change | `haiku` / `medium` |
| One feature, bugfix with a known cause, writing tests, PR/review feedback, docs, small refactor in one area | `sonnet` / `medium` (default) |
| Same, but touching several files or needing careful reading | `sonnet` / `high` |
| Multi-file refactor, debugging with unclear root cause, code review, audit, migration planning | `opus` / `high` |
| Opus-class task expected to run long (>30 min agentic) | `opus` / `xhigh` |
| Architecture, security-critical change, long-horizon multi-phase delivery, ambiguous spec needing design decisions | `fable` / `xhigh` |
| Substantive multi-phase work that wants orchestrated sub-agents | `opus` or `fable` / `ultracode` |

Unsure between two rows → take the cheaper one, and rely on escalate-on-failure.

## Worked examples

| Prompt | Route |
|--------|-------|
| "Fix the typo in the README heading" | haiku / medium |
| "Bump the plugin version and update the changelog" | haiku / medium |
| "Add a `--dry-run` flag to the deploy script" | sonnet / medium |
| "Write unit tests for the parser module" | sonnet / medium |
| "Address the CodeRabbit comments on PR 42" | sonnet / medium |
| "Rename `UserCtx` to `SessionCtx` across the service and fix call sites" | sonnet / high |
| "Tests fail intermittently in CI, find the root cause" | opus / high |
| "Review this PR for correctness and security" | opus / high |
| "Migrate the whole API layer from Express to Fastify" | opus / xhigh |
| "Design and build the new auth system end to end, with review passes" | fable / ultracode |
