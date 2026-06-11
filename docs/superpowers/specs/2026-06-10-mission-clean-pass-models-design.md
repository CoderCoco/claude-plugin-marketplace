# Mission Plugin: Clean Pass + Per-Invocation Model Selection (v0.7.0)

**Date:** 2026-06-10 (rev 2 — architecture unification added after user approval)
**Status:** Approved by user
**Plugin:** `plugins/mission` (currently v0.6.6)

## Goals

1. Remove obsolete items and unify the plugin on a single architecture — the
   plugin currently carries two parallel implementations (old direct-Agent
   state-machine skills vs new workflow files), and the duplication is the main
   source of drift and bugs.
2. Let the user choose which model each agent role uses, per invocation, with
   persistent per-project defaults and an interactive `/mission:setup`.

## Part 1 — Architecture unification

### Current state (two parallel paths)

- **New path:** `/mission` runs the Flight Director inline (Agent tool +
  structured output), then drives `liftoff-workflow.js`,
  `systems-check-workflow.js`, `docking-workflow.js` via `scriptPath`. State =
  runIds under `mission-runs/issue-<N>/`. The plan is never persisted.
- **Old path:** standalone `/pre-launch`, `/liftoff`, `/systems-check`,
  `/docking` skills dispatch Astronauts/Inspectors directly via the Agent tool
  and depend on `mission-state-{init,read,update}.sh` + the
  `mission-state/issue-<N>.json` schema. They never touch the workflow files.
  This path also carries known bugs (`systems_check_findings` key unsupported,
  pirate-era field names) and the text-block agent contracts
  (`### PLAN` / `### CREW_REPORT` / …) that the workflow path replaced with
  structured-output schemas.

### Target state (one path)

`/mission` becomes a thin orchestrator that invokes the four phase skills in
sequence; each phase skill is a thin wrapper around its workflow. Standalone
phase invocation keeps working — both entry styles share one implementation.

```
/mission N
  └─ Skill mission:pre-launch   — interactive FD planning → writes plan.json
  └─ Skill mission:liftoff      — Workflow(liftoff-workflow.js)
  └─ Skill mission:systems-check — Workflow(systems-check-workflow.js) + exhaustion loop
  └─ Skill mission:docking      — Workflow(docking-workflow.js) + watcher offer
/comms N                         — Workflow(comms-workflow.js)  (single pass)
```

### State directory (single home)

`${CLAUDE_PLUGIN_DATA}/mission-runs/issue-<N>/` containing:

- `plan.json` — persisted flight plan:
  `{ issue_number, repo, issue_title, branch, worktree_path, tasks: [{name,
  title, files, depends_on, acceptance}], created_at }`. Written by pre-launch;
  read by the three phase wrappers. Doubles as the planning resume point —
  `/mission` no longer re-runs the Flight Director when a plan already exists.
- `liftoff.runid`, `sc.runid`, `docking.runid` — workflow resume handles.
- `comms-state.json` — comms `last_seen_at` (moved from
  `mission-runs/issue-<N>-comms-state.json`).

`/mission N --abandon` removes the whole directory.

### Skill responsibilities

- **pre-launch (rewrite):** parse args/models → if `plan.json` exists and no
  `--replan`, show it and stop → dispatch Flight Director via Agent tool
  (`subagent_type: mission:flight-director`, `model: <models.director>`,
  structured-output plan schema; FD prompt creates branch + worktree
  idempotently) → open_questions loop with the user → write `plan.json` →
  present plan table → "Ready for liftoff? [Y/n]". Never auto-advances; both
  `/mission` and standalone use it. The FD prompt template moves here from the
  mission skill (single copy).
- **liftoff (rewrite):** read `plan.json` (error → "run /pre-launch N") →
  `EnterWorktree` → Workflow `scriptPath` liftoff-workflow.js with
  `resumeFromRunId` from `liftoff.runid`, args
  `{issue_number, repo, plan, models, plugin_root}` → save runId → report →
  suggest `/systems-check N`.
- **systems-check (rewrite):** same wrapper shape; owns the interactive
  exhaustion loop (deferred-findings accumulation, AskUserQuestion on
  `status: 'exhausted'` — Try more rounds / Skip and open PR / Stop) that
  currently lives in the mission skill. Reports deferred low-confidence
  findings at the end.
- **docking (rewrite):** wrapper → docking workflow → report PR → offer the
  comms watcher (`/loop 5m /comms N` or `/schedule`).
- **mission (update):** parse args → `--status` / `--abandon` → invoke the four
  phase skills via the Skill tool in order → final report. The FD prompt, plan
  schema, and SC loop move out into the phase skills.
- **comms (update):** migrate `script:`+`cat` to `scriptPath:`; add models;
  state path moves into the per-issue directory.
- **setup (new):** see Part 2.
- **mission-debrief:** unchanged.

### Deletions

| File | Why |
|---|---|
| `workflows/mission-workflow.js` | deprecated comment-only stub |
| `scripts/mission-state-init.sh`, `mission-state-read.sh`, `mission-state-update.sh`, `mission-print-log.sh` | old-path state machinery; no consumers after unification |
| `scripts/test/test-state-init.sh`, `test-state-update.sh` | test the deleted scripts |
| `references/mission-state.md` | schema of the deleted state file |
| `references/comms-queries.md` | orphaned GraphQL queries, superseded by REST comms workflow |
| `references/agent-contracts.md` | text-block contracts superseded by structured-output schemas |

Kept: `references/crew-roster.md` (FD prompt), `references/review-rubric.md`
(+ mission-debrief), `references/halt-protocol.md` (phase wrappers use the
banner shape when a workflow throws), `references/conventional-commits.md`
(now wired into commit agents).

This also moots the planned pirate-era field renames (`navigator_attempts`,
`crewmate_attempts`, `quartermaster_verdict`) — those fields die with the
state scripts.

### Agent file cleanup

In all five `agents/*.md`, replace the closing "Load
`references/agent-contracts.md` for the exact … block format" mandate with a
structured-output instruction ("Mission Control supplies a structured-output
schema; return your report through it"). Frontmatter (tools, model, color)
unchanged.

### Workflow fixes (beyond models)

- `systems-check-workflow.js`: specialist inspectors use `phase: 'Systems
  Check'`, which matches no declared phase — change to `'Review'`.
- Commit-step agents in liftoff/systems-check/comms workflows: prompts gain a
  one-line Conventional Commits rule plus "full rules:
  `<plugin_root>/references/conventional-commits.md`" (workflows receive
  `plugin_root` via args since they cannot read env vars).

### README rewrite

Document the unified architecture: usage (drop the unimplemented `--auto` and
`--finish` flags), the phase skills as workflow wrappers, `/mission:setup`,
model roles/flag/settings file, state location `$CLAUDE_PLUGIN_DATA/mission-runs/`.

## Part 2 — Per-invocation model selection

### Roles and defaults

Seven knobs, valid values `haiku` | `sonnet` | `opus` | `fable`:

| Role | Maps to | Default |
|---|---|---|
| `director` | Flight Director (Agent-tool call in pre-launch) | `fable` |
| `astronaut` | Build agents (liftoff tasks, SC repairs, comms fixes) | `sonnet` |
| `controller` | Flight Controller verify agents | `sonnet` |
| `inspector` | Systems Inspector review agents (language + specialist) | `fable` |
| `capcom` | Comms fetch + triage agents | `sonnet` |
| `docking` | PR-opening agent | `sonnet` |
| `utility` | Micro-agents: scout, commit, push, resolve, reply, summary, re-request | `haiku` |

Note: today's systems-check workflow hardcodes `model: 'sonnet'` on inspectors,
silently overriding the `fable` agent frontmatter; the `fable` default restores
the intended behavior.

### Resolution order

`--models` flag > `.claude/mission.local.md` settings file > built-in defaults.
Merging is per-role. Unknown role names or model values: warn and ignore that
entry (do not abort).

### Flag syntax

`/mission 42 --models director=opus,inspector=opus` — accepted by `/mission`,
`/pre-launch`, `/liftoff`, `/systems-check`, `/docking`, `/comms`.

### Settings file

`.claude/mission.local.md` in the repo root, YAML frontmatter:

```yaml
---
models:
  director: opus
  inspector: opus
---
```

Skills Read it if present; absence is not an error. Frontmatter is structured
to allow future settings beyond `models` without format changes.

### Setup skill

New skill `skills/setup/SKILL.md` (`/mission:setup`, triggers: "mission setup",
"configure mission models") — interactive walkthrough:

1. If `.claude/mission.local.md` exists, read it and present current values
   (setup doubles as reconfigure).
2. Ask model choices via AskUserQuestion: one question for `director`, one for
   `inspector`, one grouped for `astronaut`/`controller`/`capcom`/`docking`,
   one for `utility`. Options haiku/sonnet/opus/fable, current effective value
   marked.
3. Write `.claude/mission.local.md` (frontmatter + short body documenting roles
   and valid values). Only roles differing from built-in defaults are written.
4. If `.gitignore` does not cover it, offer to add `.claude/*.local.md`.

### Mechanics

1. Each skill gains a "Resolve models" step: Read the settings file if present,
   apply `--models` entries over it, fall back to defaults per role.
2. Pre-launch passes `model: <models.director>` on the Flight Director Agent
   call.
3. Every Workflow invocation includes `models` (and `plugin_root`) in `args`.
4. Each workflow merges:
   `const M = Object.assign({}, MODEL_DEFAULTS, _a.models || {})` and every
   hardcoded `model: 'sonnet'` / `'haiku'` becomes the matching `M.<role>`.
   (Defaults duplicated per workflow file by necessity — workflow scripts are
   self-contained.)
5. Agent frontmatter keeps its `model:` values as fallback for invocations
   outside these workflows.
6. Models are **not** persisted to mission state — per-invocation by design.

## Versioning

Single minor bump to **0.7.0** in `plugins/mission/.claude-plugin/plugin.json`.

## Testing

- `node --check` on every modified workflow file.
- Grep verification: no `mission-state-` / `agent-contracts` / `mark-the-charts`
  references remain outside git history; no hardcoded `model: 'sonnet'|'haiku'`
  in workflows; no `script:`+`cat` workflow invocation in skills.
- README usage block matches the implemented flags.

## Out of scope

- No changes to crew naming, phase structure inside workflows, or comms cadence.
- mission-debrief and the review rubric unchanged.
