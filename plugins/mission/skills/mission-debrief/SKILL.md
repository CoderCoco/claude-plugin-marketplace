---
name: mission-debrief
description: Use when the user wants to add new code-review findings to the Systems Inspector's rubric, has review feedback to record, pastes a postmortem of issues a reviewer caught, or mentions "mission debrief", "add to rubric", "the Systems Inspector missed these", "update the review checklist". Takes free-form findings input and folds them into references/review-rubric.md with classification, dedup, and a confirmation gate.
---

# /mission-debrief — Update the Review Rubric

> **Standalone utility** — this skill has no mission state interaction and dispatches no sub-agents. It can be invoked at any time, independently of any active mission.

Take external findings (review comments, postmortem notes, pasted writeups)
and fold them into `references/review-rubric.md`.

## Step 1: Gather input

Input can come from any of:
1. **Arguments:** pasted text provided directly after the command.
2. **File:** `/mission-debrief < findings.md` — read from file.
3. **PR:** `/mission-debrief --pr <N>` — fetch review comments via
   `gh pr view <N> --json reviews,comments`.
4. **Interactive:** no args — ask:
   "Paste your findings below. When done, end with a line containing only `---` and send."

## Step 2: Read current rubric

```bash
[ -n "$CLAUDE_PLUGIN_ROOT" ] || {
  echo "ERROR: CLAUDE_PLUGIN_ROOT is not set. Ensure the mission plugin is installed correctly."
  exit 1
}
RUBRIC_PATH="${CLAUDE_PLUGIN_ROOT}/references/review-rubric.md"
[ -f "$RUBRIC_PATH" ] || {
  echo "ERROR: Cannot find review-rubric.md at: $RUBRIC_PATH"
  exit 1
}
```

Extract:
- Existing categories (headers starting with `## `)
- Existing entries under each category
- Existing declined entries

## Step 3: Parse and classify each finding

For each finding in the input:

1. **Extract:** title/summary, optional file:line, optional severity hint.
2. **Match to category:** derive the available categories dynamically from the
   rubric's section headers:
   ```bash
   CATEGORIES=$(grep '^## [0-9]' "$RUBRIC_PATH" | sed 's/^## [0-9]*\. //')
   ```
   Match the finding to the closest category name from `$CATEGORIES`.
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

If all findings are marked `duplicate` or `declined`, print:
"No new findings — rubric is already up-to-date." and exit 0.

On `edit N`: let the user change row N's category or action. Re-display.
On `abort`: print "Debrief aborted — rubric unchanged." and exit 0.

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
# cd to plugin root — ensures commit lands on the plugin repo, not a mission worktree branch.
cd "$CLAUDE_PLUGIN_ROOT"
git add "$RUBRIC_PATH"
git diff --cached --quiet && {
  echo "Nothing to commit — rubric already up-to-date."
  exit 0
}
COUNT=$(git diff --cached "$RUBRIC_PATH" | grep '^+[^+]' | grep -c '^' || true)
git commit -m "docs(mission): add $COUNT new entries to review rubric via /mission-debrief"
```

Print: "Mission debrief complete. The Systems Inspector will check for these on the next mission."
