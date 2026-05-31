# Mission Control Theme — Voyage Plugin Rename

**Date:** 2026-05-31
**Status:** Approved
**Scope:** Full rename of the `voyage` plugin from pirate theme to space / mission control theme

## Motivation

The pirate theme's vocabulary (`chart-course`, `set-sail`, `make-port`, `parley`, Bosun, First Mate) was
opaque to developers unfamiliar with sailing. Phase names did not signal their purpose at a glance. The
space / mission control theme preserves named tasks and playful flavor while using vocabulary developers
find intuitive: launch, liftoff, docking, systems check, CAPCOM.

## Scope

Every named element changes: plugin name, top-level command, phase skill names, agent role names,
vocabulary file, task name roster, halt banner, and flavor strings. No behavioral changes — only naming.

## Plugin and Command

| Old | New |
|-----|-----|
| plugin directory `plugins/voyage/` | `plugins/mission/` |
| top-level command `/voyage` | `/mission` |
| state directory `voyage-state/` | `mission-state/` |

## Phase Skills

| Old skill name | New skill name | Role |
|----------------|----------------|------|
| `chart-course` | `pre-launch` | Plan the issue — dispatch Flight Director, write flight plan |
| `set-sail` | `liftoff` | Execute the plan — dispatch Astronauts in parallel |
| `inspection` | `systems-check` | Full-diff code review — dispatch Systems Inspectors by language |
| `make-port` | `docking` | Push branch, open PR |
| `parley` | `comms` | Handle incoming PR comments |
| `mark-the-charts` | `mission-debrief` | Update the review rubric |

## Agent Roles

| Old role | New role | Responsibility |
|----------|----------|----------------|
| Navigator | Flight Director | Owns the flight plan; assigns tasks from the crew roster |
| Crewmate | Astronaut | Implements exactly one task |
| Quartermaster | Flight Controller | Verifies the Astronaut's work; issues Go/No-Go verdict |
| First Mate | Systems Inspector | Language-bucket code review; returns anomaly findings |
| Bosun | CAPCOM | Categorises PR comments; drafts replies to reviewers |

## 52-Name Crew Roster

Two A–Z passes over the space culture mix. Used in order for task assignment.

**Round 1 (indices 0–25):**
Apollo, Borman, Cassini, Drake, Europa, Feynman, Gemini, Hubble, Io, Jemison,
Kepler, Lovell, Mars, NASA, Orion, Pioneer, Quasar, Ride, Saturn, Tereshkova,
Uhuru, Voyager, Webb, XMM, Young, Zond

**Round 2 (indices 26–51):**
Aldrin, Bean, Chang-Diaz, Discovery, Eagle, Feustel, Glenn, Hadfield, Interstellar,
Juno, Kelly, Leonov, Mir, Nereid, Ochoa, Pluto, Quirrenbach, Rosetta, Shepard,
Titan, Ulysses, Vostok, Whitson, Xenon, Yuri, Zarya

All names are ASCII-safe (no apostrophes, spaces, or diacritics) to be safe in
commit messages and shell variables.

## Vocabulary

| Old term | New term |
|----------|----------|
| voyage (the workflow) | mission |
| chart / course | flight plan |
| shoal / reef (a code-review finding) | anomaly |
| belay (stop) | abort |
| aye / nay | go / no-go |
| Captain (main session) | Mission Control |
| crew (sub-agents collectively) | crew |
| weigh anchor (resume) | resume mission |
| "Smooth seas — no new comments" | "All systems nominal — no new comments" |
| ⚓ HEAVY SEAS — `<phase>` halted | 🚨 ABORT SEQUENCE — `<phase>` halted |

## Key Files Renamed

| Old path | New path |
|----------|---------|
| `plugins/voyage/` | `plugins/mission/` |
| `references/pirate-lexicon.md` | `references/crew-roster.md` |
| `scripts/voyage-state-init.sh` | `scripts/mission-state-init.sh` |
| `scripts/voyage-state-read.sh` | `scripts/mission-state-read.sh` |
| `scripts/voyage-state-update.sh` | `scripts/mission-state-update.sh` |
| `scripts/voyage-print-log.sh` | `scripts/mission-print-log.sh` |
| `agents/navigator.md` | `agents/flight-director.md` |
| `agents/crewmate.md` | `agents/astronaut.md` |
| `agents/quartermaster.md` | `agents/flight-controller.md` |
| `agents/first-mate.md` | `agents/systems-inspector.md` |
| `agents/bosun.md` | `agents/capcom.md` |
| `skills/chart-course/` | `skills/pre-launch/` |
| `skills/set-sail/` | `skills/liftoff/` |
| `skills/inspection/` | `skills/systems-check/` |
| `skills/make-port/` | `skills/docking/` |
| `skills/parley/` | `skills/comms/` |
| `skills/voyage/` | `skills/mission/` |
| `skills/mark-the-charts/` | `skills/mission-debrief/` |

## State File Changes

- State directory: `$CLAUDE_PLUGIN_DATA/mission-state/issue-<N>.json`
- `schema_version` bumped to 2
- `phase` enum values updated: `chart-course → pre-launch`, `set-sail → liftoff`,
  `inspection → systems-check`, `make-port → docking`, `parley → comms`
- `plan.next_alpha_index` remains; crew names drawn from `crew-roster.md`
- `inspection` key renamed to `systems_check` in state JSON

## Marketplace Entry

Plugin renamed from `voyage` to `mission` in both `plugin.json` and `marketplace.json`.
Version bumped to `0.2.0`.

## Out of Scope

- No behavioral changes (logic, flow, retry caps, parallelism rules, state machine transitions)
- No new features
- Tests updated only where they reference renamed paths or strings
