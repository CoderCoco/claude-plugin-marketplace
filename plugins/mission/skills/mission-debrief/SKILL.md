---
name: mission-debrief
description: Use when the user wants to add new code-review findings to the Systems Inspector's rubric, has review feedback to record, pastes a postmortem of issues a reviewer caught, or mentions "mission debrief", "add to rubric", "the Systems Inspector missed these", "update the review checklist". Takes free-form findings input and folds them into references/review-rubric.md with classification, dedup, and a confirmation gate.
---

# /mission-debrief — Update the Review Rubric

Take external findings (review comments, postmortem notes, pasted writeups)
and fold them into `references/review-rubric.md`.

## Step 1: Gather input

Input can come from any of:
1. **Arguments:** pasted text provided directly after the command.
2. **File:** `/mission-debrief < findings.md` — read from file.
3. **PR:** `/mission-debrief --pr <N>` — fetch review comments via
   `gh pr view <N> --json reviews,comments`.
4. **Interactive:** no args — ask "Paste your findings below, then send."

## Step 2: Read current rubric

```bash
RUBRIC_PATH="${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md"
RUBRIC=$(cat "$RUBRIC_PATH")
```

Extract:
- Existing categories (headers starting with `## `)
- Existing entries under each category
- Existing declined entries

## Step 3: Parse and classify each finding

For each finding in the input:

1. **Extract:** title/summary, optional file:line, optional severity hint.
2. **Match to category:** does it fit an existing rubric category
   (semantic correctness, portability, boundary, hygiene, complexity,
   test quality)?
3. **Dedup check:** is there already an entry in the rubric that covers
   the same concern? If yes → mark as `duplicate`.
4. **Declined check:** does it appear in the `## Declined / Out-of-scope`
   section? If yes → mark as `declined` (already declined, skip).
5. **New category:** if it fits none of the existing categories, propose
   a new `## N. <name>` section.

## Step 4: Present summary table

```
Findings ready for debrief:

  # | Finding (summary)                          | Category         | Action
  ──────────────────────────────────────────────────────────────────────────────
  1 | ANSI format leaking to file transport      | semantic         | append to §1
  2 | path.join() not used in tests              | portability      | append to §2
  3 | Vitest hoisting concern                    | (declined)       | skip (already declined)
  4 | useEffect missing cleanup for subscription | (NEW) lifecycle  | create §7

Apply these changes? [Y / edit N / abort]
```

On `edit N`: let the user change row N's category or action. Re-display.
On `abort`: exit without writing.

## Step 5: Write updates to rubric

For each `append` action: add a bullet point under the matching `## N.` section.
For each `create` action: append a new `## N. <name>` section with the entry.

Format for each new entry:
```markdown
- <one-sentence rule description>. Example: <one-sentence concrete example>.
```

Never remove existing entries. This skill is append-only.

## Step 6: Confirm and commit

Show a diff of the rubric changes and ask: "Does this look right? [Y/n]"

On Y:
```bash
git add "$RUBRIC_PATH"
git commit -m "docs(mission): update review rubric with N pitfalls via /mission-debrief"
```

Print: "Mission debrief complete. The Systems Inspector will check for these on the next mission."
