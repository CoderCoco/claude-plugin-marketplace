# Agent Return Contracts

Every mission sub-agent returns exactly ONE fenced block. No prose outside
the delimiters. Mission Control parses ONLY the content between the block markers.

## Flight Director — ### PLAN

```
### PLAN
issue: <number>
revision: <integer, starts at 1>
summary: <one sentence>
next_alpha_index: <integer>
tasks:
  - name: Apollo
    title: <one-line description>
    files: [path/to/file.ts, path/to/other.ts]
    acceptance: <how the Astronaut knows it is done>
    depends_on: []
  - name: Borman
    title: ...
    files: [...]
    acceptance: ...
    depends_on: [Apollo]
open_questions: []
constraints: []
### END PLAN
```

Rules:
- Task names come from the crew roster in `references/crew-roster.md`,
  assigned in alphabetical order starting from the current `plan.next_alpha_index`.
- `depends_on` contains task NAMES (not ids). Declare only genuine dependencies.
- Tasks with `depends_on: []` may run concurrently with other zero-dep tasks.

## Astronaut — ### CREW_REPORT

```
### CREW_REPORT
task: <crew member name>
status: completed | plan_problem
files_changed:
  - path: src/retry.ts
    action: created | modified | deleted
    summary: add exponential backoff with jitter
notes: <assumptions, edge cases skipped — or omit if none>
plan_problem: <only if status=plan_problem>
### END CREW_REPORT
```

## Flight Controller — ### VERDICT

One entry per CI/local check discovered, in CI execution order. Check names come from the CI step name where available, otherwise a descriptive label. The `acceptance` check is always last.

```
### VERDICT
task: <crew member name>
verdict: PASS | FAIL
checks:
  - name: <CI step name or label — e.g. "Run tests", "tsc --noEmit", "ESLint">
    source: github-actions | circleci | local-discovery
    result: pass | fail | skipped
    output: |
      <first 30 + last 30 lines if long>
    reason: <if skipped — e.g. "requires secrets", "deploy step">
  - name: acceptance
    source: mission-control
    result: pass | fail
    note: <one-line judgement>
fixes_needed:
  - <specific actionable instruction, empty list if PASS>
notes: <optional>
### END VERDICT
```

## Systems Inspector — ### FINDINGS

```
### FINDINGS
language: javascript | python | go | rust | shell | general
findings:
  - file: src/log.ts
    line: 42
    severity: blocker | major | minor | nit
    category: semantic | portability | boundary | hygiene | complexity | test-quality
    summary: ANSI colorize format applied to file transport
    fix_hint: Create separate format objects for console and file transports.
### END FINDINGS
```

If no findings: return the block with `findings: []`.

## CAPCOM — ### TRIAGE

```
### TRIAGE
comments:
  - id: <comment id as integer>
    author: <github username>
    category: actionable | question | approval | nit | ambiguous | duplicate
    file: src/webhook.ts        # only for actionable/nit
    line: 88                    # only for actionable/nit
    fix_hint: return 404 not 500 for missing webhook id  # only for actionable/nit
    reply_draft: |              # only for question
      The retry uses exponential backoff with jitter...
    duplicate_of: <primary comment id>  # only for category=duplicate
copilot_present: true | false
### END TRIAGE
```

`duplicate`: identical body on the same file as a primary comment. One fix is
applied to the primary; duplicates get `category: duplicate` with `duplicate_of`
pointing to the primary id — no separate fix, no separate reply.
