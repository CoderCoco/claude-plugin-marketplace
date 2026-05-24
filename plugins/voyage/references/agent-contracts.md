# Agent Return Contracts

Every voyage sub-agent returns exactly ONE fenced block. No prose outside
the delimiters. Captain parses ONLY the content between the block markers.

## Navigator — ### PLAN

```
### PLAN
issue: <number>
revision: <integer, starts at 1>
summary: <one sentence>
next_alpha_index: <integer>
tasks:
  - name: Anne
    title: <one-line description>
    files: [path/to/file.ts, path/to/other.ts]
    acceptance: <how the Crewmate knows it is done>
    depends_on: []
  - name: Blackbeard
    title: ...
    files: [...]
    acceptance: ...
    depends_on: [Anne]
open_questions: []
constraints: []
### END PLAN
```

Rules:
- Task names come from the pirate roster in `references/pirate-lexicon.md`,
  assigned in alphabetical order starting from the current `plan.next_alpha_index`.
- `depends_on` contains task NAMES (not ids). Declare only genuine dependencies.
- Tasks with `depends_on: []` may run concurrently with other zero-dep tasks.

## Crewmate — ### CREW_REPORT

```
### CREW_REPORT
task: <pirate name>
status: completed | plan_problem
files_changed:
  - path: src/retry.ts
    action: created | modified | deleted
    summary: add exponential backoff with jitter
notes: <assumptions, edge cases skipped — or omit if none>
plan_problem: <only if status=plan_problem>
### END CREW_REPORT
```

## Quartermaster — ### VERDICT

```
### VERDICT
task: <pirate name>
verdict: PASS | FAIL
checks:
  - name: tests
    result: pass | fail | skipped
    output: |
      <first 30 + last 30 lines if long>
    reason: <if skipped>
  - name: lint
    result: pass | fail | skipped
    output: |
      <relevant lines>
  - name: typecheck
    result: pass | fail | skipped
    output: |
      <relevant lines>
  - name: build
    result: pass | fail | skipped
    reason: <if skipped>
  - name: acceptance
    result: pass | fail
    note: <one-line judgement>
fixes_needed:
  - <specific actionable instruction, empty list if PASS>
notes: <optional>
### END VERDICT
```

## First Mate — ### FINDINGS

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

## Bosun — ### TRIAGE

```
### TRIAGE
comments:
  - id: <comment id as integer>
    author: <github username>
    category: actionable | question | approval | nit | ambiguous
    file: src/webhook.ts        # only for actionable/nit
    line: 88                    # only for actionable/nit
    fix_hint: return 404 not 500 for missing webhook id  # only for actionable/nit
    reply_draft: |              # only for question
      The retry uses exponential backoff with jitter...
copilot_present: true | false
### END TRIAGE
```
