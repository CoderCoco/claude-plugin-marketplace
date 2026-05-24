# voyage plugin design spec

**Date:** 2026-05-23
**Status:** proposed
**Plugin:** `voyage` (new — alongside existing `issue-flow`, which remains untouched)

## Problem

The existing `issue-flow` plugin handles GitHub-issue → PR-open via three skills (`/work-on`, `/swarm`, `/open-pr`) and three sub-agents (Navigator, Crewmate, Quartermaster). Coverage stops at PR-open: there is no automated code-review step before the PR ships, no handler for incoming PR comments, no Copilot re-request after fixes, and no orchestrator chaining the phases together. Quartermaster's mechanical checks (tests, lint, types, build) catch a real but narrow class of defects; recent reviews surfaced semantic, cross-platform, and hygiene issues that passed the gate.

The user wants an end-to-end, mostly-hands-off workflow that takes an issue and drives it through plan → build → review → PR → comment-handling → re-review until merged, with strong pirate theming preserved and the option to run individual phases manually.

## Goals

1. **End-to-end orchestration** — one command (`/voyage <N>`) drives issue → merged PR with at most five user-touch points in the happy path.
2. **Composability** — each phase is also an independently invocable skill, so power users (and the orchestrator's own resume logic) can run a single phase.
3. **Resumability** — voyages survive Claude restarts. A per-issue state file is the source of truth; re-running `/voyage <N>` advances exactly one phase.
4. **Parallelism baked in** — independent tasks (build, code review, comment fixes) dispatch as parallel sub-agents from a single message. No threads, no subprocesses.
5. **Multi-language code review** — a polyglot First-Mate agent reviews the full diff before PR open, with an auto-fix loop that promotes findings to repair tasks.
6. **PR comment handling** — a Bosun agent categorises incoming comments, dispatches Crewmate fixes for actionable items, drafts replies for questions, and re-requests Copilot review after pushing fixes.
7. **Living review knowledge** — `/mark-the-charts` skill folds new pitfalls into the First-Mate's rubric so the next voyage's review is sharper than the last.
8. **Pirate theming preserved** — the crew metaphor extends to two new agents; tone discipline keeps pirate prose out of payloads (commits, PR text, replies, JSON).

## Non-goals

- Replacing `issue-flow`. It stays installed and unchanged; `voyage` is opt-in.
- Cross-plugin invocation. `voyage` does not call `issue-flow` skills; it ships its own copies of Navigator/Crewmate/Quartermaster (lightly adapted) so it is self-contained.
- Long-running daemon processes. Each `/voyage` invocation runs one phase and exits. Polling for PR comments is opt-in via `/schedule` (covered in §6).
- Cross-plugin shared state. Voyage state lives under `$CLAUDE_PLUGIN_DATA/voyage-state/` and never leaks to the working tree.
- Automatic permanent decline of review findings. A declined finding is per-voyage by default; permanent decline is an explicit `/mark-the-charts` action.
- General-purpose multi-issue orchestration. Each voyage tracks one issue. Concurrent voyages on different issues are supported via separate state files; coordination between them is the user's job.

## Background

The current `issue-flow` user journey:

```
1. /work-on <N>  or  /swarm <N>          # solo edits OR crew-driven plan/build/verify
2. /open-pr                              # verifies checklist, pushes, opens PR
3. (manual) human reviews PR
4. (manual) human applies fixes
5. (manual) re-request reviewers
6. (manual) merge
```

The deleted `/swarm-exec` skill (commit `7d4e338`, removed) attempted resumability via a Python subprocess harness. It was abandoned due to fragility (subprocess state-file races, sub-process boundary debugging, IPC complexity). **Voyage takes the lessons but a different mechanism:** all parallelism stays inside Claude Code's native Agent-dispatch (one assistant message, N tool calls). No Python harness; no subprocesses.

The user shared a postmortem from a different project where post-PR code review surfaced 5 of 6 valid bugs that Quartermaster-style mechanical checks missed: ANSI format leaking to a file transport, POSIX-only path separators in tests, off-by-one in binary buffer reads, dead empty `beforeEach` with stale comment, and an unnecessary `isFirstFetch` state variable. These five categories seed the First-Mate's rubric (§4 and `references/review-rubric.md`).

## Architecture overview

```
plugins/voyage/
├── .claude-plugin/plugin.json    name: voyage, version: 0.1.0
├── README.md
│
├── agents/
│   ├── navigator.md              PLANNER  (adapted from issue-flow)
│   ├── crewmate.md               BUILDER  (adapted from issue-flow)
│   ├── quartermaster.md          VERIFIER (adapted from issue-flow)
│   ├── first-mate.md             REVIEWER (NEW)
│   └── bosun.md                  COMMENT HANDLER (NEW)
│
├── skills/
│   ├── voyage/                   ENTRY — state-machine dispatcher
│   ├── chart-course/             PHASE 1 — read issue, branch, plan
│   ├── set-sail/                 PHASE 2 — build (parallel Crewmates)
│   ├── inspection/               PHASE 3 — polyglot code review + auto-fix loop
│   ├── make-port/                PHASE 4 — open PR
│   ├── parley/                   PHASE 5 — handle PR comments
│   └── mark-the-charts/          META    — fold findings into rubric
│
├── references/
│   ├── conventional-commits.md   commit-message rules
│   ├── voyage-state.md           state-file schema documentation
│   ├── pirate-lexicon.md         shared vocabulary
│   ├── review-rubric.md          First Mate's living checklist
│   ├── agent-contracts.md        wire-format of structured returns
│   └── halt-protocol.md          standardised halt-and-ask format
│
└── scripts/
    ├── voyage-state-init.sh
    ├── voyage-state-read.sh
    ├── voyage-state-update.sh
    └── voyage-print-log.sh
```

The model: **`/voyage <N>` is a thin state-machine dispatcher**. It reads `$CLAUDE_PLUGIN_DATA/voyage-state/issue-<N>.json`, decides which phase comes next, invokes that phase's skill, and exits. Each phase skill mutates the state file via the helper scripts and exits when its work is done. Re-running `/voyage <N>` advances one phase. All parallelism is achieved via parallel `Agent` tool calls in a single assistant message — no harness, no threads, no subprocess.

## Section 1 — Components & responsibilities

### 1.1 Skills

| Skill | Role |
|---|---|
| **`/voyage <N>`** | State-machine dispatcher. Reads state, runs next phase, exits. The canonical entry point users learn. |
| **`/chart-course <N>`** | Phase 1. Reads issue, creates branch and worktree, dispatches Navigator → writes plan to state. On exit, marks `phase_status = completed` so the next `/voyage <N>` advances to `set-sail`. |
| **`/set-sail <N>`** | Phase 2. Walks the plan, dispatching Crewmates in parallel where `depends_on` and file-conflict heuristic allow, with Quartermaster verification per task. Commits per task. On exit, marks `phase_status = completed` so the next dispatch advances to `inspection`. |
| **`/inspection <N>`** | Phase 3. Dispatches First Mates in parallel by language bucket on the full branch diff. Loops: Crewmate fixes → Quartermaster verifies → First Mate re-reviews. Caps at `inspection.attempt_cap`. On clean exit, marks `phase_status = completed` so the next dispatch advances to `make-port`. |
| **`/make-port <N>`** | Phase 4. Pushes branch, opens PR with `Closes #N`, moves project-board card, asks one-time about scheduling a watcher. Writes `pr.number`, `pr.url`. Marks `phase_status = completed` so the next dispatch advances to `parley`. |
| **`/parley <N>`** | Phase 5. Reads PR comments since `last_comment_id_seen`. Dispatches Bosun to categorise. For actionable items: parallel Crewmate fixes → Quartermaster → push. Posts approved replies. Re-requests Copilot review if applicable. Stays in `phase = parley` (idempotent) — advancement to `done` is explicit via `/voyage --finish` or detected merge. |
| **`/mark-the-charts`** | Meta. Takes external findings (review comments, postmortem notes, pasted writeups) and folds them into `references/review-rubric.md` with classification, dedup, and a confirmation gate. Add-only — removals via manual edit. |

### 1.2 Agents

| Agent | Role | Voice |
|---|---|---|
| **Navigator** | Decomposes issue into a DAG of named, file-tagged tasks with `depends_on`. Returns `### PLAN` block. | Strong pirate |
| **Crewmate** | Implements exactly one task. Forbidden from freelancing beyond `files`. Returns `### CREW_REPORT` block. | Strong pirate |
| **Quartermaster** | Mechanical verification only (tests, lint, types, build). Returns `### VERDICT` block (PASS / FAIL). | Strong pirate |
| **First Mate** (NEW) | Polyglot semantic reviewer. Reads diff for a language bucket, applies `references/review-rubric.md`. Returns `### FINDINGS` block. | Strong pirate prose; JSON payload |
| **Bosun** (NEW) | Categorises PR comments. Returns `### TRIAGE` block with category per comment and optional reply drafts. | Strong pirate prose; JSON payload |

**Captain is *not* a sub-agent.** Captain is the main session — the model running `/voyage`. The crew above are the sub-agents Captain dispatches via the `Agent` tool.

### 1.3 The pirate-name task roster

Tasks are identified by alphabetical pirate names from a 52-entry roster (two passes through A–Z), stored in `references/pirate-lexicon.md`:

```
Round 1:  Anne, Blackbeard, Calico, Drake, Edward, Flint, Gibbs, Hawkins,
          Israel, Jack, Kidd, Long, Morgan, Nassau, OMalley, Pew, Quelch,
          Rackham, Silver, Teach, Urca, Vane, Worley, Xebec, Yellowbeard, Zheng

Round 2:  Avery, Bellamy, Cobham, Davis, Eustace, Fly, Gow, Hornigold,
          Ironbeard, Jolly, Keelhaul, Lafitte, Mary, Ned, Olonnais, Plunkett,
          Quill, Roberts, Smee, Tew, Ursa, Vance, Walker, Xanthe, Yardarm, Zephyr
```

Names are ASCII (no apostrophes, e.g. `O'Malley` → `OMalley`) so they are safe as JSON keys, filenames, and branch fragments. Inspection-phase repair tasks continue the alphabet from where set-sail left off. A plan exceeding 52 tasks halts with a "decompose further" prompt rather than wrapping a third time.

## Section 2 — State file & phase transitions

### 2.1 Location and lifecycle

```
$CLAUDE_PLUGIN_DATA/voyage-state/issue-<N>.json
```

- One file per issue. Concurrent voyages on different issues are independent.
- Never committed; never written to the working tree.
- Schema-versioned for forward migration.
- Atomic writes only: helper scripts write to `<file>.tmp`, fsync, then `mv`.

### 2.2 Schema

```jsonc
{
  "schema_version": 1,
  "issue": {
    "number": 42,
    "title": "Add retry to webhook delivery",
    "repo": "owner/repo",
    "url": "https://github.com/owner/repo/issues/42"
  },
  "branch": {
    "name": "claude/issue-42-add-retry-to-webhook-delivery",
    "worktree_path": "/home/chris/wt/issue-42",
    "base": "main",
    "base_sha_at_start": "abc123..."
  },
  "phase": "set-sail",                   // chart-course|set-sail|inspection|make-port|parley|done
  "phase_status": "in_progress",         // pending|in_progress|completed|halted
  "halted_reason": null,

  "plan": {
    "navigator_attempts": 1,
    "next_alpha_index": 5,               // pointer into the 52-name roster
    "tasks": [
      {
        "name": "Anne",
        "title": "Add exponential backoff helper",
        "files": ["src/retry.ts"],
        "depends_on": [],
        "status": "completed",           // pending|ready|dispatched|verifying|completed|failed|skipped
        "crewmate_attempts": 1,
        "quartermaster_verdict": "PASS",
        "commit_sha": "def456...",
        "origin": "plan",                // plan|inspection|parley
        "notes": []
      }
    ]
  },

  "inspection": {
    "attempts": 0,
    "attempt_cap": 3,
    "findings": [],                      // open
    "fixed_findings": [],                // resolved (with commit_sha)
    "declined_findings": [               // per-voyage decline list
      {
        "summary": "Vitest hoisting concern",
        "raised_at": "...",
        "declined_at": "...",
        "declined_reason": "vi.mock IS hoisted; finding was incorrect"
      }
    ]
  },

  "pr": {
    "number": null,
    "url": null,
    "opened_at": null,
    "last_comment_id_seen": null,
    "copilot_was_requested": false,
    "watcher_scheduled": false
  },

  "history": [
    {"at": "...", "phase": "chart-course", "event": "started"},
    {"at": "...", "phase": "chart-course", "event": "completed", "tasks": 5},
    {"at": "...", "phase": "set-sail",     "event": "task_passed", "task": "Anne"}
  ],

  "created_at": "...",
  "updated_at": "..."
}
```

### 2.3 Phase rules

```
chart-course → set-sail → inspection → make-port → parley
                              ↑             ↑           |
                              └─ findings ──┘           |
                                  fixed                 ↓
                                                  (re-run parley on new comments)
                                                        ↓
                                                       done
```

| Phase | Entry requires | Exit writes |
|---|---|---|
| `chart-course` | `issue.number`, branch detected or creatable | `plan.tasks[]`, `branch.*`, advance to `set-sail` |
| `set-sail` | `plan.tasks[]` non-empty | every task `status: completed`, one commit per task, advance to `inspection` |
| `inspection` | branch has commits since `base_sha_at_start` | no findings ≥ minor (or all addressed via repair tasks), advance to `make-port`. On re-loop: dispatches Crewmate for findings, increments `inspection.attempts`, halts at `attempt_cap` |
| `make-port` | no open findings, clean working tree | `pr.number`, `pr.url`, board moved to "In Review", advance to `parley` |
| `parley` | `pr.number` set | New comments addressed, replies posted, Copilot re-requested if applicable, `pr.last_comment_id_seen` updated. Stays at `parley` (idempotent). Advances to `done` only via `/voyage --finish` or detected merge |

### 2.4 Idempotency rules

- Re-running a phase mid-completion is safe. Each skill checks state on entry; if all sub-work is already done, it short-circuits to `completed` and advances.
- Per-task granularity. `set-sail` tracks every task's `status` independently — an interrupted round re-dispatches only un-`completed` tasks.
- Only Captain writes state. Sub-agents return structured blocks; Captain merges and writes atomically via `voyage-state-update.sh`.
- All updates pass through the helper script so `updated_at` and `history` stay consistent.

### 2.5 Existing-branch recovery

If the user runs `/voyage <N>` and a `claude/issue-<N>-*` branch exists locally without a state file, `/voyage` offers to adopt it: inspects commits since the merge-base with the default branch to infer which phase to resume at. Conservative default: enter `inspection` (treat existing work as set-sail output). User can decline and start fresh.

### 2.6 User-touch points in the happy path

| When | What the user sees | Skippable? |
|---|---|---|
| After `chart-course` | Plan summary + `Set sail? [Y/n]` | Yes (`--auto`) |
| Mid `set-sail` | Halt after 3 failed attempts on one task | No (real failure) |
| Mid `inspection` | Halt at attempt-cap, or finding to classify | No (real ambiguity) |
| End of `make-port` | PR URL + `Schedule a watcher? [y/N]` | Yes (`--no-watcher-prompt`) |
| Mid `parley` | Ambiguous comment, architectural pushback, force-push needed, or reply drafts to approve | No (trust-critical) |

Everything else: autonomous.

## Section 3 — Parallelism & agent dispatch

### 3.1 Parallelism primitive

**One assistant message containing N `Agent` tool calls.** The harness fans them out concurrently and returns all results before the next message. No threads, no subprocess. This is the single mechanism used everywhere parallelism appears.

```
Captain emits:
  message {
    Agent(crewmate, task=Anne)
    Agent(crewmate, task=Blackbeard)
    Agent(crewmate, task=Drake)
  }
→ harness runs three sub-agents concurrently
→ all three results returned together
→ Captain processes them in the next message
```

### 3.2 Ready-task computation (set-sail and repair rounds)

A task `T` is **ready** iff:

1. `T.status == "pending"`, AND
2. every task in `T.depends_on` has `status == "completed"`, AND
3. no other currently-dispatched task touches a file in `T.files`.

The file-conflict check is conservative — two tasks sharing a file run in different rounds even if their `depends_on` is empty. This prevents two parallel Crewmates from racing on the same file.

### 3.3 The set-sail round loop

```
loop:
  state = read_state()
  batch = select_ready_batch(state.plan)
  if batch is empty:
    if all tasks completed → exit phase, advance
    else → deadlock (cycles, all blocked) → halt-and-ask

  # ROUND DISPATCH — one message, N Crewmate calls
  results = parallel_dispatch([Agent(crewmate, task=t) for t in batch])

  # ROUND VERIFY — one message, N Quartermaster calls
  verdicts = parallel_dispatch([
    Agent(quartermaster, task=t, crew_report=results[t]) for t in batch
  ])

  for t in batch:
    if verdicts[t] == PASS:
      commit_task(t)                # one commit per task, sequential, conventional
      mark_completed(t)
    else:
      t.crewmate_attempts += 1
      if t.crewmate_attempts < 3:
        mark_for_retry(t)           # picked up next round
      else:
        halt_phase(f"task {t.name} failed 3x")
        return

  update_state()
```

Per-task cap = 3 attempts (matches existing `/swarm`). Independent from `inspection.attempt_cap`.

Commits are sequential even though Crewmates ran in parallel — staged file-by-file in batch order and committed one at a time to keep history linear and bisectable.

### 3.4 Inspection parallelism

```
1. diff = git diff <base_sha_at_start>...HEAD
2. buckets = bucket_by_language(diff)        # .ts/.tsx/.js/.jsx → javascript;
                                              # .py → python; .go → go; .rs → rust;
                                              # .sh → shell; else → general
3. findings = parallel_dispatch([
     Agent(first-mate, language=b, files=[...], rubric=..., declined=...) for b in buckets
   ])
4. findings = dedupe(findings)               # by (file, line, summary)
5. if no findings >= "minor": mark completed; advance phase
6. Promote findings >= minor → repair tasks (names from roster continuation)
7. Run set-sail-style round on repair tasks
8. Loop: re-bucket diff, re-dispatch First Mates, repeat
9. On attempt_cap reached: halt-and-ask
```

Severity tiers: `blocker` (PR cannot ship), `major` (should fix), `minor` (improves), `nit` (style only — reported once, never triggers a repair round).

### 3.5 Parley parallelism

```
1. comments = gh pr view <N> --json comments,reviews,reviewRequests
2. new = filter(comments, id > state.pr.last_comment_id_seen)
3. triage = Agent(bosun, comments=new, pr=state.pr)
4. if any c.category == "ambiguous": halt-and-ask (Bosun does not guess)
5. actionable = [c for c in triage if c.category == "actionable"]
6. if actionable:
     repair_tasks = promote_to_tasks(actionable)   # origin="parley"
     run_round(repair_tasks)                       # parallel Crewmate → Quartermaster → commits
     git push
7. questions = [c for c in triage if c.category == "question"]
   for q in questions: show q.reply_draft to user, get approval, post
8. if copilot_present AND commits_pushed_this_round:
     gh pr edit <N> --add-reviewer Copilot
9. Resolve threads on now-fixed comments via gh api
10. Update last_comment_id_seen; stay in parley
```

### 3.6 Guardrails

| Concern | Guardrail |
|---|---|
| Rate limits / context cost | `max_parallel = 5` per round. Larger batches split into sequential rounds. Configurable via `plugin.json`. |
| One bad agent fails the round | Each agent runs in its own context. Failure is captured per-task; siblings complete normally. |
| File conflicts between parallel Crewmates | `select_ready_batch` excludes overlapping `files`. |
| Quartermaster sees stale state | Quartermaster runs after the round, against the committed tree, in sequential commit order. |
| State-file races | Only Captain writes state. Sub-agents return structured data only. Atomic writes via helper script. |
| Cycles in `depends_on` | `chart-course` runs topological sort; cycles → halt-and-replan before `set-sail` starts. |

### 3.7 Agent return contracts

Every sub-agent returns exactly one fenced block. No prose outside the block. Documented in `references/agent-contracts.md`.

```
### CREW_REPORT (Crewmate)
task: <Name>
status: completed | failed
files_changed: [src/a.ts, src/b.ts]
summary: <one or two sentences>
notes: <optional>

### VERDICT (Quartermaster)
task: <Name>
verdict: PASS | FAIL
checks: { tests: pass, lint: pass, types: pass, build: pass }
issues: [<one per failed check>]

### FINDINGS (First Mate)
language: <bucket>
findings:
  - { file, line, severity, category, summary, fix_hint }

### TRIAGE (Bosun)
comments:
  - { id, author, category, file?, line?, fix_hint?, reply_draft? }
copilot_present: true | false

### PLAN (Navigator)
tasks:
  - { name, title, files, depends_on }
```

## Section 4 — Inspection loop & Parley loop (in detail)

### 4.1 First Mate system prompt skeleton

```
You are the First Mate aboard the voyage. Read the diff handed to ye and
surface SEMANTIC problems the Quartermaster's mechanical checks canna catch.

Quartermaster already checked (DO NOT re-flag):
  - Tests pass, lint passes, types check, build succeeds.

YOU look for (load references/review-rubric.md and apply every rule):
  - Semantic correctness    (logic looks right, but is wrong)
  - Cross-platform          (POSIX-only path/EOL/case)
  - Boundary / off-by-one   (especially binary buffers, ranges)
  - Code hygiene            (dead code, stale comments, empty hooks)
  - Unnecessary complexity  (one-off flags, premature abstraction)
  - Test quality            (implementation details, shared state, divergent mocks)
  - Any new categories added via /mark-the-charts

Discipline:
  - One finding per real concern. No filler.
  - Severity: blocker | major | minor | nit.
  - Cite file:line for every finding.
  - Suggest a fix in <= 2 sentences. Do NOT write the patch.
  - If a finding appears in `declined_findings`, DO NOT raise it again. Period.

Return ONE fenced block (see references/agent-contracts.md):
  ### FINDINGS ...

Pirate voice goes in prose only. The fenced block is plain JSON.
```

### 4.2 Initial review-rubric.md content

```markdown
# First Mate's Review Rubric

## 1. Semantic correctness
- Shared format/config objects applied to the wrong target
  (e.g. ANSI colorize format passed to a file logger transport)
- State machine reaches an unreachable or never-cleared branch
- Promise/async chains that swallow errors silently

## 2. Cross-platform portability
- Hard-coded POSIX path separators ('/') in tests or runtime code
- Use of node:path required for path manipulation
- Line-ending assumptions ('\n' vs '\r\n')
- Case-sensitive filename assumptions

## 3. Boundary & off-by-one
- Binary buffer slicing at exact boundaries (e.g. peek-back-by-one for
  partial-line handling in readTail)
- Inclusive vs exclusive range handling
- Empty-collection edge cases

## 4. Code hygiene
- Empty beforeEach/afterEach hooks with stale comments claiming they do work
- Dead variables, dead branches, dead imports
- TODO comments without owner or ticket reference

## 5. Unnecessary complexity
- One-off boolean flags (e.g. `isFirstFetch`) that duplicate control flow
  already expressible via await sequences or useEffect deps
- Premature abstraction (Strategy pattern for 2 cases)
- Wrapping framework primitives in thin no-op wrappers

## 6. Test quality
- Tests that assert implementation details, not behavior
- Tests that share mutable state across cases
- Mocked boundaries that diverge from the real interface

## Declined / Out-of-scope
(empty at v0.1 — populated via /mark-the-charts)
```

### 4.3 Declined-finding protocol

Per-voyage decline:
1. During halt at attempt-cap, user can mark findings as `declined` with a one-line reason.
2. `/voyage` writes them to `state.inspection.declined_findings`.
3. Future First Mate dispatches receive this list in context with instruction "do not raise these again."

Permanent decline (across voyages): user runs `/mark-the-charts` to append to the rubric's `## Declined / Out-of-scope` section. The rubric is the only long-term source of review knowledge; per-voyage state is deterministic and short-lived.

### 4.4 Bosun system prompt skeleton

```
You are the Bosun. Comments have come aboard the PR. Categorise each one so
the Captain knows what to do.

For every comment, classify:
  - actionable    Concrete change request — fixable by a Crewmate.
  - question      Reviewer asking how/why — needs a reply, not a code change.
  - approval      "LGTM", "👍" — no-op; record approver.
  - nit           Style-only — optional fix; deferred unless user opts in.
  - ambiguous     Could be a request OR a question — halt-and-ask. Do not guess.

For actionable comments, identify:
  - The file:line being commented on
  - A one-sentence fix_hint
  - Whether other actionable comments overlap (same file region)

Detect Copilot:
  - copilot_present = true if any review is from github-actions[bot] matching
    Copilot patterns, OR a user named `Copilot`.

Return ONE fenced block (see references/agent-contracts.md):
  ### TRIAGE ...

Pirate voice in prose only. The fenced block is plain JSON.
```

### 4.5 Parley halt cases

The Bosun does not guess intent. Halts on:

| Trigger | Reason | User options |
|---|---|---|
| Ambiguous comment | Could be question OR request | Reclassify / write a reply / ignore |
| Architectural pushback ("this whole approach is wrong") | Beyond repair-task scope | Re-plan / push back with reply / abandon PR |
| Merge conflict on push after fixes | Base branch advanced | Pull + replay / let user resolve / halt |
| Force-push needed | Destructive | Always asks; never force-pushes silently |
| Copilot re-request API error | External service | Reports, continues; user re-requests manually |

### 4.6 Comment reply protocol

Bosun-drafted replies follow a fixed template:

```
Addressed in <SHA> — <one-line summary>.
```

For questions:

```
<direct answer, plain English, no pirate slang>

Let me know if that disnae cover it.
```

Replies are always shown to the user for approval before posting via `gh pr comment --reply-to <id>`. This is trust-critical: silent automated comment-posting could damage reviewer relationships.

### 4.7 Optional parley → inspection loop-back

If parley generates ≥ 3 fix commits in one round, the orchestrator offers a one-time inspection re-run: `"We pushed three fixes. Want the First Mate to give them a once-over before the next reviewer cycle? [y/N]"`. Default no.

## Section 5 — Pirate tone & user-facing surface

### 5.1 Tone-zone map

| Zone | Voice | Why |
|---|---|---|
| Agent prose (Navigator, Crewmate, Quartermaster, First Mate, Bosun monologues) | Strong pirate | Identity, character |
| Voyage log narration | Strong pirate | It is a story |
| Halt-and-ask framing | Mild pirate | User must understand options clearly |
| Captain prose to user | Mild pirate | Light flair only; plain English for instructions and status |
| Commit messages | Plain English (Conventional Commits) | Bisectable, scannable |
| PR description / replies | Plain English | External readers; never pirate |
| Code, tests, docstrings, source comments | Plain English | Work product is normal |
| JSON, state file, agent contract blocks | Plain English | Machine-readable |
| Error messages and stack traces | Plain English | Debuggability |
| Skill descriptions in /help | Mild pirate | Still must be searchable |

Enforcement principle, documented in `references/pirate-lexicon.md`:

> **Pirate flavour goes in prose. Payloads stay plain.** If another machine or another reviewer will parse it, plain English.

### 5.2 Shared lexicon

Stored in `references/pirate-lexicon.md`. Used consistently across all agents to prevent drift:

| Term | Meaning |
|---|---|
| voyage | The full workflow from issue → merged PR |
| chart / course | The plan (Navigator's output) |
| set sail / depart | Begin executing the plan |
| inspection | Full-diff code review phase |
| make port | Open the PR |
| parley | Handle PR comments |
| mark the charts | Update the review rubric |
| crew | Sub-agents collectively |
| shoal / reef | A code-review finding |
| belay | Stop, reverse course |
| aye / nay | Yes / no |
| weigh anchor | Resume an interrupted voyage |
| Captain | The main session |
| smooth seas | No issues / nothing to do |
| heavy seas | Failure / halt-and-ask state |
| log | The voyage chronicle |

### 5.3 Command surface

```
/voyage <N>              Start or advance the voyage for issue #N
/voyage <N> --auto       Skip the post-chart-course confirmation
/voyage <N> --status     Print current voyage state; take no action
/voyage <N> --finish     Mark voyage as done (e.g. after PR merged)
/voyage <N> --abandon    Halt and remove state file (asks confirmation)

# Individual phases (advanced — re-run a single phase manually)
/chart-course <N>
/set-sail <N>
/inspection <N>
/make-port <N>
/parley <N>

# Meta
/mark-the-charts
```

All commands infer `<N>` from the current branch (`claude/issue-<N>-*`) when omitted.

### 5.4 Voyage log

Two formats generated by `scripts/voyage-print-log.sh` from `state.history`. Printed at end of `make-port` and on `--status`.

ASCII summary example:

```
═══════════════════════════════════════════════════════
  VOYAGE  ⚓  issue #42 — Add retry to webhook delivery
═══════════════════════════════════════════════════════
  chart-course   ✓  (5 tasks plotted)
  set-sail       ✓  (5/5 passed, 1 retry on Drake)
  inspection     ✓  (3 findings raised, all repaired)
                    Crew Avery, Bellamy, Cobham
  make-port      ✓  PR #128 opened
  parley         ◌  1 round so far (2 comments addressed)
═══════════════════════════════════════════════════════
  Total: 8 commits  ·  12 agent dispatches  ·  ~14 minutes
═══════════════════════════════════════════════════════
```

Markdown chronicle (full long form, embedded in the PR description as a `<details>` block).

### 5.5 Halt-and-ask format

```
⚓ HEAVY SEAS — <phase> halted

  Reason: <plain-English reason>

  Where we are:
    <one-line state summary>

  Yer options:
    [1] <plain-English option>          (recommended)
    [2] <plain-English option>
    [3] Abandon voyage (state preserved)

  Tell me a number, or describe what ye want.
```

Numbered options so the user can answer with "1" instead of paraphrasing.

### 5.6 Commit message format

Same Conventional Commits as `issue-flow` (the rubric file `references/conventional-commits.md` is near-copy). Voyage additions:

```
# Set-sail tasks (per-task commit, sequential within a round)
feat(<area>): Anne — add exponential backoff helper

Refs #42

# Inspection repairs
fix(<area>): Avery — clear ANSI format from file transport

Refs #42

# Parley fixes
fix(<area>): Plunkett — return 404 instead of 500 on missing webhook

Refs #42
Co-Authored-By: <reviewer-github-handle> (via PR comment)
```

### 5.7 PR description template

```markdown
## Summary
<1–3 bullets, plain English>

## Changes
<bulleted file-by-file summary>

## Test plan
- [x] Unit tests pass (<command>)
- [x] Lint passes (<command>)
- [x] Types pass (<command>)
- [ ] Manual verification: <issue acceptance criteria>

## Closes
Closes #42

<details>
<summary>⚓ Voyage log</summary>

<markdown chronicle from §5.4>

</details>

🤖 Generated via /voyage
```

## Acceptance criteria for voyage v0.1

To call v0.1 shippable:

1. `/voyage <N>` happy path runs end-to-end on a real GitHub issue with at most five user-touch points.
2. Each phase skill is independently invocable and idempotent.
3. State file survives Claude restart: kill mid-set-sail, re-run `/voyage <N>`, voyage resumes at the right task.
4. Parallel-Crewmate dispatch verified on a plan with at least one parallelisable pair (e.g. Anne + Blackbeard touching different files).
5. Inspection auto-fix loop verified: First Mate raises a finding, repair task lands, First Mate confirms clean on re-review.
6. `/mark-the-charts` accepts a pasted findings block and appends to `references/review-rubric.md`, classifying into existing categories or creating new ones.
7. Parley round on a real PR: addresses one actionable comment, drafts a reply for one question, re-requests Copilot if it was a reviewer.
8. Pirate-tone discipline holds: no pirate prose in commit messages, PR descriptions, PR replies, JSON, or code.
9. All five new components (the two new agents and three meta files — `review-rubric.md`, `pirate-lexicon.md`, `agent-contracts.md`) ship complete.
10. Plugin registered in `.claude-plugin/marketplace.json`.

## Track 2 — separate spec

**Title:** Parallel task execution in existing `issue-flow:/swarm`.

Out of scope for this design doc. Will get its own spec under `docs/superpowers/specs/`. The parallelism mechanism designed in §3 (one-message-multiple-Agent-calls, ready-task computation with file-conflict heuristic, per-task cap) is the pattern to retrofit. Existing `/swarm`'s state file (under `$CLAUDE_PLUGIN_DATA/swarm-state/`) and Navigator/Crewmate/Quartermaster agents are reused; only the dispatch loop in `swarm/SKILL.md` changes.

## Out of scope for v0.1

- Long-running daemon watcher (covered by opt-in `/schedule` setup; not a voyage-owned process).
- Cross-repo voyages.
- Branching strategy choices beyond `claude/issue-<N>-*`.
- LLM-inferred decline (learning declined-finding patterns automatically). Manual `/mark-the-charts` only at v0.1.
- Automatic PR merge. Voyage ends at `parley` indefinitely; merge is human.
- Per-language First Mate specialists. Single polyglot agent at v0.1; specialisation deferred.
- Renaming or removing the `Captain` concept. Captain is the main session — non-negotiable.
- Reusing voyage state for `/work-on` or `/swarm` flows in `issue-flow`. Separate state lives.

## Open questions

These are flagged for the implementation plan, not blockers for the design:

1. **Copilot re-request mechanism.** `gh pr edit --add-reviewer Copilot` may not work in all repos depending on Copilot's installation status. Implementation should detect and degrade gracefully (report inability, continue).
2. **Project-board column names.** `make-port` moves the card to "In Review". If the board has a different column name, the script should fall back to `gh project field-value` discovery (matches `issue-flow`'s existing pattern).
3. **`max_parallel = 5` default.** May need tuning based on real-world rate-limit and context-cost observations.
4. **Worktree base directory.** `$HOME/wt/` is the implicit default from `issue-flow`. Voyage should probably honour the same env var or config setting.
5. **Schema migrations.** v0.1 ships `schema_version: 1`. A `voyage-state-migrate.sh` script is deferred until a v2 exists.

## References

- Existing plugin: `plugins/issue-flow/` (Navigator, Crewmate, Quartermaster, work-on, swarm, open-pr, references/conventional-commits.md)
- Deleted prior art: `2026-05-20-swarm-exec-design.md` (lessons: avoid Python subprocess harness; keep all parallelism native to Claude Code's `Agent` dispatch)
- User's seed pitfalls (postmortem from a separate project): five real bugs that Quartermaster-style checks missed — see §4.2 review-rubric.md initial content
- Brainstorming skill (superpowers:brainstorming) was used to produce this spec
- Pirate name roster: 52 names, two passes through A–Z, ASCII-safe
