# Conventional Commits reference (issue-flow plugin)

This file is the single source of truth for the commit-message conventions used by every skill and sub-agent in the `issue-flow` plugin (`work-on`, `open-pr`, `swarm`, and the Navigator / Crewmate / Quartermaster sub-agents). Read it once at the start of any operation that creates a commit; do not re-derive the rules from memory.

The format follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) with project-specific conventions called out below.

## Where to find this file

When a skill or agent dispatched from this plugin needs the reference at runtime, resolve the path in this order:

1. `${CLAUDE_PLUGIN_ROOT}/references/conventional-commits.md` (preferred, if `CLAUDE_PLUGIN_ROOT` is set).
2. `${CLAUDE_SKILL_DIR}/../../references/conventional-commits.md` (works from any skill in this plugin).
3. Search relative to the repository checkout: `plugins/issue-flow/references/conventional-commits.md`.

Any of those resolve to the same file. Use the `Read` tool — no need to `cat` it through Bash.

## Subject line

```
<type>(<scope>): <subject>
```

- **`<type>`** is required. Pick the best fit (see types below).
- **`<scope>`** is optional. Omit it (and drop the parens) when the change spans scopes or there's no obvious one. Match the scopes existing commits in the repo already use.
- **`<subject>`** is a present-tense, imperative description ("add", "fix", "remove" — not "added", "fixed").
- Total subject line **must fit under 72 characters**. Shorten by trimming wording, not by truncating mid-word.
- No trailing period.

## Allowed types

| Type       | Use for                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `feat`     | New user-visible behaviour.                                                                     |
| `fix`      | Bug fix that restores intended behaviour.                                                       |
| `refactor` | Restructuring with no observable behaviour change (and no new tests required).                  |
| `perf`     | Performance improvement (no API change).                                                        |
| `docs`     | Documentation-only changes (README, CLAUDE.md, in-tree comments, plan files).                   |
| `test`     | Adding or updating tests without touching production code.                                      |
| `chore`    | Tooling / config / dependency bumps / version bumps. NOT for behaviour changes.                 |
| `build`    | Build-system or CI configuration changes.                                                       |
| `style`    | Code-style or formatting changes that don't affect behaviour.                                   |

When a change spans multiple types (e.g. a refactor that also adds a feature), pick the type the user will care about most — usually `feat` or `fix`.

## Body

Optional. When present, separated from the subject by a blank line. Use it to explain **why**, not what. The diff already shows what.

Include an issue reference line:

- `Refs #<N>` — for partial work / per-task commits. Does NOT close the issue.
- `Closes #<N>` — only on the commit (or PR body) that completes the issue. GitHub auto-closes the issue when this lands on the default branch via merged PR.

**Per-task commits inside a `/swarm` voyage use `Refs #<N>`**, never `Closes #<N>` — the closing keyword belongs on the PR body so the issue closes exactly once on merge, not partway through.

## Footer (required)

Every commit produced by an issue-flow skill or sub-agent ends with:

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

(Substitute the actual model name and email from the session.)

## Forbidden flags

Never use any of these on a commit produced by this plugin:

- `--no-verify` — bypasses pre-commit hooks; the right move on a hook failure is to fix the underlying problem, not bypass it.
- `--no-gpg-sign` / `-c commit.gpgsign=false` — bypasses signing.
- `--amend` on a commit that has already been pushed.

If a hook or signing failure surfaces, HALT and surface the error to the user. Do not retry blindly.

## File staging discipline

When staging files for a commit:

- Use **explicit filenames**: `git add path/to/file1 path/to/file2`.
- NEVER use `git add .` or `git add -A` — they can silently include `.env`, credentials, scratch files, or state files (`.claude/swarm-state/...`) that shouldn't be in the commit.
- The source of "which files belong in this commit" is:
  - For swarm Crewmate output: `CREW_REPORT.files_changed[].path`.
  - For inline work in `work-on`: the files you actually edited in this step.
  - For `open-pr`: nothing — that skill doesn't create commits, it pushes existing ones.

## Heredoc template

For multi-line commit messages always pass the body via a heredoc so newlines are preserved:

```bash
git commit -m "$(cat <<'COMMITMSG'
<type>(<scope>): <subject>

<optional body explaining why>

Refs #<N>.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
COMMITMSG
)"
```

The single-quoted heredoc delimiter (`'COMMITMSG'`) prevents shell expansion inside the body — important if the body contains `$` or backticks.

## Examples

```
feat(swarm): T2 - implement SecretsStore default backend

Refs #165.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

```
fix(issue-flow): handle empty acceptance criteria in Navigator output

The parser dropped tasks whose `acceptance` field was an empty string.
Treat missing/empty acceptance as a validation error and surface it
instead of silently skipping the task.

Refs #178.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

```
refactor(swarm): extract handoff banner formatting from inline jq

No behaviour change — same ASCII output, same column widths.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

```
chore(issue-flow): bump to 1.5.1

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
