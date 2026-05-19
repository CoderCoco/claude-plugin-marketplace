# Navigator plan template

The Navigator MUST return exactly this block — nothing else between the delimiters. Pirate banter is welcome OUTSIDE the block but the parser ignores it.

```
### PLAN
issue: <number>
revision: 1
summary: <one sentence describing the voyage>
tasks:
  - id: T1
    desc: <one-line description>
    files: [path/one, path/two]
    acceptance: <how the Crewmate knows it's done>
  - id: T2
    desc: ...
    files: [...]
    acceptance: ...
open_questions: []
constraints: []
### END PLAN
```

## Conventions

- Task ids are `T1`, `T2`, ... in execution order.
- When re-planning, increment `revision`. Insert tasks between existing ones with ids like `T2a`, `T2b` rather than renumbering — the state file already references the old ids.
- `files` may be `[]` only if the task is genuinely fileless (e.g., "run database migration command"). In that case the `desc` must explain.
- `acceptance` is one sentence. Not a checklist. The Quartermaster turns it into checks.
- `open_questions` and `constraints` may be empty lists but the keys must be present.
