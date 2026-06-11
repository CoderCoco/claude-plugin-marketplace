# Mission Plugin: Clean Pass + Per-Invocation Model Selection (v0.7.0)

**Date:** 2026-06-10
**Status:** Approved by user
**Plugin:** `plugins/mission` (currently v0.6.6)

## Goals

1. Remove obsolete items and fix inconsistencies left over from the plugin's
   evolution (voyage/pirate → mission/space theme; monolithic workflow → three
   focused workflows).
2. Let the user choose which model each agent role uses, per invocation, with
   sensible persistent defaults.

## Part 1 — Cleanup

### 1.1 Deletions

- `workflows/mission-workflow.js` — deprecated stub containing only a comment;
  superseded by liftoff/systems-check/docking workflows.
- `references/comms-queries.md` — orphaned GraphQL queries, superseded by the
  REST-based `comms-workflow.js`. Referenced nowhere.

### 1.2 State bug fix

`skills/systems-check/SKILL.md` calls
`mission-state-update.sh <issue> systems_check_findings <json>`, but
`scripts/mission-state-update.sh` has no handler for that key, so the call
fails. Add a `systems_check_findings` case that writes the JSON array to
`.systems_check.findings` (matching the schema in `references/mission-state.md`
line ~54). Add a corresponding test in `scripts/test/test-state-update.sh`.

### 1.3 Comms skill workflow invocation

`skills/comms/SKILL.md` still uses the old pattern: `cat` the workflow file and
pass it as `script:`. Migrate to `scriptPath:
${CLAUDE_PLUGIN_ROOT}/workflows/comms-workflow.js`, matching the other four
skills (this pattern was adopted repo-wide in v0.6.5, commit 2b386c3).

### 1.4 Legacy field renames (state schema change)

Rename pirate-era field names to mission-themed equivalents everywhere they
appear:

| Old | New |
|---|---|
| `navigator_attempts` | `director_attempts` |
| `quartermaster_verdict` | `controller_verdict` |

Files affected: `scripts/mission-state-init.sh`, `scripts/mission-state-update.sh`
(including the `plan_task_verdict` handler's target field),
`skills/pre-launch/SKILL.md`, `references/mission-state.md`, and the tests under
`scripts/test/`. **Breaking:** any in-flight mission state file becomes
unreadable for these fields; acceptable per user (no mission mid-run).

### 1.5 Wire in conventional-commits.md

The commit-step micro-agents in `liftoff-workflow.js`, `systems-check-workflow.js`,
and `comms-workflow.js` get a short prompt addition: follow Conventional Commits
(`type(scope): subject`, imperative mood), with a pointer to
`references/conventional-commits.md` for the full rules. Keep the inline portion
to 1–2 lines — workflow scripts cannot read files, so the prompt carries the
essentials and the file path carries the rest (agents can Read it).

### 1.6 README touch-up

- Fix the `/mission` description: it runs the Flight Director **in the current
  conversation** (via the Agent tool) rather than dispatching the /pre-launch
  skill.
- Document the new model-selection feature (flag syntax, settings file, roles,
  defaults) and the `/mission:setup` interactive walkthrough.

## Part 2 — Per-invocation model selection

### Roles and defaults

Six knobs, valid values `haiku` | `sonnet` | `opus` | `fable`:

| Role | Maps to | Default |
|---|---|---|
| `director` | Flight Director (Agent-tool call in /mission and /pre-launch) | `fable` |
| `astronaut` | Astronaut build agents (liftoff, systems-check repairs) | `sonnet` |
| `controller` | Flight Controller verify agents | `sonnet` |
| `inspector` | Systems Inspector review agents | `fable` |
| `capcom` | CAPCOM triage agent (comms) | `sonnet` |
| `utility` | Micro-agents: commit, push, resolve, reply, scout, summary | `haiku` |

Defaults exactly preserve current behavior.

### Resolution order

`--models` flag > `.claude/mission.local.md` settings file > built-in defaults.
Merging is per-role (setting one role leaves the others at the next layer down).

### Flag syntax

`/mission 42 --models director=opus,inspector=opus`

Accepted by `/mission`, `/pre-launch`, `/liftoff`, `/systems-check`, `/docking`,
and `/comms`. Unknown role names or model values: the skill warns and ignores
that entry (does not abort the mission).

### Settings file

`.claude/mission.local.md` in the project root (standard plugin-settings
pattern), YAML frontmatter:

```yaml
---
models:
  director: opus
  inspector: opus
---
```

Skills read it if present; absence is not an error.

### Mechanics

1. Each skill gains a "Resolve models" step early on: parse `--models` from the
   invocation args, read the settings file if present, merge over defaults,
   producing a `models` object.
2. `/mission` and `/pre-launch` pass `model: <models.director>` on the
   Agent-tool call that dispatches the Flight Director.
3. Every Workflow invocation includes `models` in `args`.
4. Each workflow declares its defaults and merges:
   `const M = { ...DEFAULTS, ...(_a.models || {}) }`, then every hardcoded
   `model: 'sonnet'` / `model: 'haiku'` becomes the matching `M.<role>`.
   (Defaults are duplicated per workflow file by necessity — workflow scripts
   are self-contained and cannot import.)
5. Agent frontmatter (`agents/*.md`) keeps its current `model:` values as the
   fallback for any invocation outside these workflows.

### Setup skill

New skill `skills/setup/SKILL.md` (invoked as `/mission:setup`, triggers:
"mission setup", "configure mission models") that creates or updates the
settings file interactively:

1. If `.claude/mission.local.md` exists, read it and present current values
   (setup doubles as reconfigure).
2. Ask model choices via AskUserQuestion: one question for `director`, one for
   `inspector`, one grouped for `astronaut`/`controller`/`capcom`, one for
   `utility`. Options haiku/sonnet/opus/fable, current effective value marked.
3. Write `.claude/mission.local.md` with YAML frontmatter plus a short body
   documenting the roles and valid values. Only roles that differ from the
   built-in defaults are written, keeping the file minimal.
4. If `.gitignore` does not cover the file, offer to add `.claude/*.local.md`.

The file's frontmatter is structured to allow future settings beyond `models`
(e.g., attempt caps) without format changes, but setup only handles models for
now.

### State

The resolved `models` object is **not** persisted to mission state — it is
per-invocation by design. Resuming a mission re-resolves from flag/file/defaults.

## Versioning

Single minor bump to **0.7.0** in `plugins/mission/.claude-plugin/plugin.json`
covering both parts.

## Testing

- Run `scripts/test/test-state-init.sh` and `test-state-update.sh` after the
  rename + new-key changes; extend them to cover `systems_check_findings` and
  the renamed fields.
- Syntax-check each modified workflow file with `node --check`.
- Grep verification: no remaining `navigator_attempts` / `quartermaster_verdict`
  occurrences; no remaining hardcoded `model: 'sonnet'|'haiku'` in workflows.

## Out of scope

- No changes to crew naming, phase structure, or the comms polling cadence.
- No new agent roles.
- `references/agent-contracts.md` under-referencing noted but left as-is.
