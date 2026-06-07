export const meta = {
  name: 'mission-workflow',
  description: 'Implement, review, and open a PR for a pre-planned GitHub issue — receives a complete Flight Director plan from the skill',
  phases: [
    { title: 'Liftoff',       detail: 'Astronauts implement tasks; FC verifies each round' },
    { title: 'Systems Check', detail: 'Language-bucketed inspectors review full diff' },
    { title: 'Docking',       detail: 'Push branch, open PR, move project board card' },
  ],
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const CREW_REPORT_SCHEMA = {
  type: 'object',
  required: ['task_name', 'status', 'files_modified', 'summary'],
  properties: {
    task_name:                { type: 'string' },
    status:                   { type: 'string', enum: ['done', 'plan_problem'] },
    files_modified:           { type: 'array', items: { type: 'string' } },
    summary:                  { type: 'string' },
    plan_problem_description: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['task_name', 'verdict'],
  properties: {
    task_name:    { type: 'string' },
    verdict:      { type: 'string', enum: ['PASS', 'FAIL'] },
    fixes_needed: { type: 'array', items: { type: 'string' } },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'severity', 'summary'],
        properties: {
          file:       { type: 'string' },
          line:       { type: 'number' },
          severity:   { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          summary:    { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
}

const PR_SCHEMA = {
  type: 'object',
  required: ['pr_number', 'pr_url'],
  properties: {
    pr_number: { type: 'number' },
    pr_url:    { type: 'string' },
  },
}

const SCOUT_SCHEMA = {
  type: 'object',
  required: ['active_buckets', 'focus_areas'],
  properties: {
    active_buckets: {
      type: 'array',
      items: { type: 'string', enum: ['javascript', 'python', 'go', 'rust', 'shell', 'general'] },
      description: 'Language buckets that have changed files in the diff',
    },
    focus_areas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['bucket', 'files', 'focus'],
        properties: {
          bucket: { type: 'string' },
          files:  { type: 'array', items: { type: 'string' } },
          focus:  { type: 'string', description: 'What the inspector should pay special attention to' },
        },
      },
    },
    specialist_agents: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'prompt'],
        properties: {
          label:  { type: 'string', description: 'Short display label, e.g. "security", "perf", "api-contract"' },
          prompt: { type: 'string', description: 'Full inspection prompt for this specialist' },
        },
      },
      description: 'Additional targeted inspectors beyond language buckets (security, performance, API contract, migration safety, etc.)',
    },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Returns an ordered array of batches. Each batch contains tasks whose deps are
// all satisfied by prior batches, with no shared files within a batch (prevents
// parallel-write conflicts in the worktree).
function computeRounds(tasks) {
  const done = new Set()
  const rounds = []
  let remaining = tasks.slice()

  while (remaining.length > 0) {
    const ready = remaining.filter(t => t.depends_on.every(dep => done.has(dep)))
    if (ready.length === 0) {
      log(`WARNING: ${remaining.length} task(s) have unsatisfied deps — skipping: ${remaining.map(t => t.name).join(', ')}`)
      break
    }
    const batch = []
    const usedFiles = new Set()
    for (const t of ready) {
      if (batch.length >= 5) break
      if (t.files.every(f => !usedFiles.has(f))) {
        batch.push(t)
        t.files.forEach(f => usedFiles.add(f))
      }
    }
    rounds.push(batch)
    batch.forEach(t => done.add(t.name))
    remaining = remaining.filter(t => !batch.find(b => b.name === t.name))
  }
  return rounds
}

// ── Args ───────────────────────────────────────────────────────────────────────

const _a = typeof args === 'string' ? JSON.parse(args) : (args || {})

const issueNum = _a.issue_number
const repo = _a.repo
const plan = _a.plan
if (!issueNum || !repo || !plan) throw new Error('args must include issue_number, repo, and plan (produced by the Flight Director in the /mission skill)')

log(`${plan.tasks.length} tasks on ${plan.branch}:`)
plan.tasks.forEach(t => log(`  ${t.name}: ${t.title} [${t.files.join(', ')}]`))

// ── Phase 2: Liftoff ───────────────────────────────────────────────────────────

phase('Liftoff')

const TASK_ATTEMPT_CAP = 3
const rounds = computeRounds(plan.tasks)
log(`${plan.tasks.length} tasks across ${rounds.length} round(s)`)

for (let r = 0; r < rounds.length; r++) {
  const batch = rounds[r]
  log(`Round ${r + 1}: ${batch.map(t => t.name).join(', ')}`)

  // Per-task retry state. Keyed by task name to survive null agents.
  const taskState = {}
  batch.forEach(t => { taskState[t.name] = { attempts: 0, fixes: [] } })
  let pendingTasks = batch.slice()

  while (pendingTasks.length > 0) {
    // Bail before dispatching any agent whose cap is already reached
    for (const task of pendingTasks) {
      if (taskState[task.name].attempts >= TASK_ATTEMPT_CAP) {
        const fixes = taskState[task.name].fixes.join('; ')
        throw new Error(
          `Task ${task.name} failed ${TASK_ATTEMPT_CAP} times.\nLast fixes needed: ${fixes}\n\nResolve manually then re-run /mission ${issueNum}.`
        )
      }
    }

    // ── Astronauts (parallel) ──────────────────────────────────────────────────

    const crewReports = await parallel(pendingTasks.map(task => () => {
      const s = taskState[task.name]
      const retryCtx = s.fixes.length > 0
        ? `\n\nPrevious attempt failed. Apply these fixes before re-implementing:\n${s.fixes.map(f => `- ${f}`).join('\n')}`
        : ''
      return agent(
        `You are Astronaut ${task.name} implementing a task for mission issue #${issueNum}.

Task: ${task.title}
Files: ${task.files.join(', ')}
Acceptance criterion: ${task.acceptance}
Worktree: ${plan.worktree_path}

Implement this task exactly — no more, no less.
Use absolute paths or git -C for all file and git operations.
Do NOT run git add or git commit — the Flight Controller handles that.${retryCtx}

Return a crew report with task_name, status, files_modified, and a summary.`,
        {
          label: `Astronaut:${task.name}:${s.attempts + 1}`,
          phase: 'Liftoff',
          schema: CREW_REPORT_SCHEMA,
          agentType: 'mission:astronaut',
          model: 'sonnet',
        }
      )
    }))

    // Plan problems can't be retried — surface immediately
    const planProblems = crewReports.filter(r => r && r.status === 'plan_problem')
    if (planProblems.length > 0) {
      throw new Error(
        `Plan problem(s) in round ${r + 1}:\n${planProblems.map(r => `  ${r.task_name}: ${r.plan_problem_description}`).join('\n')}\nRevise the flight plan and re-run.`
      )
    }

    // Index by task_name for safe lookup (guards against null / misnamed reports)
    const reportsByName = {}
    crewReports.filter(Boolean).forEach(rep => { reportsByName[rep.task_name] = rep })

    // ── Flight Controllers (parallel) ──────────────────────────────────────────

    const verdicts = await parallel(
      pendingTasks.map(task => () => {
        const report = reportsByName[task.name]
        if (!report) return Promise.resolve(null)
        const attempt = taskState[task.name].attempts + 1
        return agent(
          `You are the Flight Controller reviewing task ${task.name} for mission issue #${issueNum}.

Task spec: ${JSON.stringify(task)}
Crew report: ${JSON.stringify(report)}
Worktree: ${plan.worktree_path}
Attempt: ${attempt} of ${TASK_ATTEMPT_CAP}

Run the project's tests, lint, and type checks inside the worktree.
PASS only if the implementation satisfies the acceptance criterion and all checks pass.
FAIL with specific, actionable fixes_needed otherwise.`,
          {
            label: `FC:${task.name}:${attempt}`,
            phase: 'Liftoff',
            schema: VERDICT_SCHEMA,
            agentType: 'mission:flight-controller',
            model: 'sonnet',
          }
        )
      })
    )

    const verdictsByName = {}
    verdicts.filter(Boolean).forEach(v => { verdictsByName[v.task_name] = v })

    // ── Commit PASSed / queue FAILed (sequential commit avoids git lock race) ──

    const nextPending = []
    for (const task of pendingTasks) {
      const verdict = verdictsByName[task.name]

      if (!verdict) {
        // Agent returned null — count as attempt, retry
        taskState[task.name].attempts++
        taskState[task.name].fixes = ['Agent did not respond — retrying']
        nextPending.push(task)
        log(`${task.name}: no verdict (attempt ${taskState[task.name].attempts}) — will retry`)
        continue
      }

      taskState[task.name].attempts++

      if (verdict.verdict === 'PASS') {
        await agent(
          `Commit task ${task.name} in worktree ${plan.worktree_path}.

  git -C ${plan.worktree_path} add ${task.files.join(' ')}
  git -C ${plan.worktree_path} commit -m "feat: ${task.name} — ${task.title}\\n\\nRefs #${issueNum}"

Return the commit SHA.`,
          { label: `commit:${task.name}`, phase: 'Liftoff', model: 'haiku' }
        )
        log(`${task.name}: PASSED on attempt ${taskState[task.name].attempts}`)
      } else {
        taskState[task.name].fixes = verdict.fixes_needed && verdict.fixes_needed.length > 0
          ? verdict.fixes_needed
          : ['No specific fixes given — inspect the implementation']
        nextPending.push(task)
        log(`${task.name}: FAILED attempt ${taskState[task.name].attempts} — ${taskState[task.name].fixes.length} fix(es) needed, retrying`)
      }
    }

    pendingTasks = nextPending
  }
}

log('All tasks complete — liftoff successful')

// ── Phase 3: Systems Check ─────────────────────────────────────────────────────

phase('Systems Check')

const LANGUAGE_BUCKET_EXTS = {
  javascript: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'],
  python:     ['.py'],
  go:         ['.go'],
  rust:       ['.rs'],
  shell:      ['.sh', '.bash', '.zsh'],
}

// Haiku scout reads the full diff and decides which language inspectors to activate,
// what each should focus on, and whether any specialist agents are warranted.
log('Scouting diff…')
const scout = await agent(
  `You are a triage agent for mission issue #${issueNum}. Read the full diff and decide what inspection is needed.

1. Get the diff:
   git -C ${plan.worktree_path} diff origin/main...HEAD

2. Identify which language buckets have changed files:
   - javascript: .ts .tsx .js .jsx .mts .cts
   - python: .py
   - go: .go
   - rust: .rs
   - shell: .sh .bash .zsh
   - general: everything else (yaml, json, sql, config, markdown, etc.)

3. For each active bucket, list the specific changed files and write a focused inspection directive (what patterns, risks, or invariants the inspector should pay special attention to given what actually changed — not generic advice).

4. Decide if any specialist agents are warranted beyond the language inspectors. Only add specialists when genuinely needed — e.g.:
   - "security": auth, crypto, permissions, secrets, injection-risk code changed
   - "perf": hot paths, query patterns, memory allocation changed
   - "api-contract": public API signatures, protocol definitions, or schema changed
   - "migration-safety": database migrations or destructive schema changes
   For each specialist, write a full, targeted inspection prompt (include the worktree path ${plan.worktree_path} and issue number #${issueNum}).

Return active_buckets, focus_areas, and specialist_agents (omit specialist_agents or leave it empty if none are needed).`,
  { label: 'scout', phase: 'Systems Check', schema: SCOUT_SCHEMA, model: 'haiku' }
)

const activeBucketNames = new Set(scout ? scout.active_buckets : [])
const focusByBucket = {}
if (scout && scout.focus_areas) scout.focus_areas.forEach(fa => { focusByBucket[fa.bucket] = fa })
const specialistDefs = (scout && scout.specialist_agents) || []

log(`Active buckets: ${[...activeBucketNames].join(', ') || 'none'} | Specialists: ${specialistDefs.map(s => s.label).join(', ') || 'none'}`)

const SC_ATTEMPT_CAP = 3
let scAttempts = 0 // counts completed repair rounds; inspections = scAttempts + 1

while (true) {
  log(`Inspection round ${scAttempts + 1}${scAttempts > 0 ? ' (re-inspecting after repairs)' : ''}…`)

  // ── Language inspectors + specialists (parallel) ───────────────────────────

  const langInspectors = [...activeBucketNames].map(lang => () => {
    const focus = focusByBucket[lang]
    const extList = LANGUAGE_BUCKET_EXTS[lang] ? LANGUAGE_BUCKET_EXTS[lang].join(' ') : 'yaml, json, sql, config, and other non-language files'
    const filesCtx = focus ? `\nChanged files in this bucket: ${focus.files.join(', ')}\nFocus especially on: ${focus.focus}` : ''
    return agent(
      `You are the ${lang} Systems Inspector for mission issue #${issueNum}, inspection round ${scAttempts + 1}.

Review the ${lang} changes in worktree ${plan.worktree_path}:
  git -C ${plan.worktree_path} diff origin/main...HEAD

Focus exclusively on ${lang} files (${extList}).${filesCtx}
If no matching files were modified, return an empty findings array.
Classify each finding: blocker | major | minor | nit`,
      {
        label: `inspector:${lang}:r${scAttempts}`,
        phase: 'Systems Check',
        schema: FINDINGS_SCHEMA,
        agentType: 'mission:systems-inspector',
        model: 'sonnet',
      }
    )
  })

  const specialistInspectors = specialistDefs.map(s => () =>
    agent(s.prompt, {
      label: `specialist:${s.label}:r${scAttempts}`,
      phase: 'Systems Check',
      schema: FINDINGS_SCHEMA,
      agentType: 'mission:systems-inspector',
      model: 'sonnet',
    })
  )

  const inspections = await parallel([...langInspectors, ...specialistInspectors])

  const allFindings = inspections
    .filter(Boolean)
    .flatMap(r => r.findings)
    .filter((f, i, arr) => arr.findIndex(f2 => f2.file === f.file && f2.summary === f.summary) === i)

  const significant = allFindings.filter(f => ['blocker', 'major', 'minor'].includes(f.severity))
  log(`Round ${scAttempts + 1}: ${significant.length} significant finding(s), ${allFindings.length - significant.length} nit(s)`)

  // ── Clean — advance to docking ─────────────────────────────────────────────

  if (significant.length === 0) {
    log('Systems check clean')
    break
  }

  // ── Attempt cap exhausted — surface and halt ───────────────────────────────

  if (scAttempts >= SC_ATTEMPT_CAP) {
    const summary = significant
      .map(f => `  [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.summary}`)
      .join('\n')
    throw new Error(
      `Systems check: ${SC_ATTEMPT_CAP} repair round(s) exhausted with findings still open:\n${summary}\n\nFix manually then re-run /mission ${issueNum}, or abandon with /mission ${issueNum} --abandon.`
    )
  }

  // ── Repair Astronauts (parallel) ───────────────────────────────────────────

  log(`Dispatching ${significant.length} repair(s) (round ${scAttempts + 1} of ${SC_ATTEMPT_CAP})…`)

  const repairs = await parallel(significant.map((finding, idx) => () =>
    agent(
      `Fix this finding in worktree ${plan.worktree_path}:
File: ${finding.file}${finding.line ? `, line ${finding.line}` : ''}
Severity: ${finding.severity}
Issue: ${finding.summary}
${finding.suggestion ? `Suggestion: ${finding.suggestion}` : ''}

Do NOT commit — the Flight Controller will verify.
Return a crew report with task_name="${finding.summary.slice(0, 40)}", status, files_modified, and summary.`,
      {
        label: `repair:r${scAttempts}:${idx}`,
        phase: 'Systems Check',
        schema: CREW_REPORT_SCHEMA,
        model: 'sonnet',
      }
    )
  ))

  // ── Repair Flight Controllers (parallel) ───────────────────────────────────

  // Intentionally not filtering repairs so indices stay aligned with significant[].
  const repairVerdicts = await parallel(
    repairs.map((repair, idx) => () =>
      repair
        ? agent(
            `You are the Flight Controller verifying a repair for mission issue #${issueNum}.

Finding: ${JSON.stringify(significant[idx])}
Crew report: ${JSON.stringify(repair)}
Worktree: ${plan.worktree_path}

Run checks as appropriate. PASS only if the finding is resolved and all checks pass. FAIL with fixes_needed otherwise.`,
            {
              label: `fc-repair:r${scAttempts}:${idx}`,
              phase: 'Systems Check',
              schema: VERDICT_SCHEMA,
              agentType: 'mission:flight-controller',
              model: 'sonnet',
            }
          )
        : Promise.resolve(null)
    )
  )

  // ── Commit PASSed repairs (sequential) ────────────────────────────────────

  let repairsPassed = 0
  for (let idx = 0; idx < repairs.length; idx++) {
    const verdict = repairVerdicts[idx]
    const repair = repairs[idx]
    if (!verdict || !repair || verdict.verdict !== 'PASS') continue
    const finding = significant[idx]
    await agent(
      `Commit the repair for "${finding.summary.slice(0, 60)}" in worktree ${plan.worktree_path}.

  git -C ${plan.worktree_path} add ${repair.files_modified.join(' ')}
  git -C ${plan.worktree_path} commit -m "fix: ${finding.summary.slice(0, 72)}\\n\\nRefs #${issueNum}"`,
      { label: `commit-repair:r${scAttempts}:${idx}`, phase: 'Systems Check', model: 'haiku' }
    )
    repairsPassed++
  }

  log(`Repairs: ${repairsPassed}/${significant.length} committed — re-inspecting`)
  scAttempts++
}

// ── Phase 4: Docking ───────────────────────────────────────────────────────────

phase('Docking')
log(`Pushing ${plan.branch} and opening PR…`)

const pr = await agent(
  `Open a pull request for issue #${issueNum} in ${repo}.

Branch: ${plan.branch}
Worktree: ${plan.worktree_path}
Issue title: ${plan.issue_title}

Steps:
1. git -C ${plan.worktree_path} push -u origin ${plan.branch}
2. Discover PR conventions: check .github/PULL_REQUEST_TEMPLATE.md, then skim 3 recent PRs via:
     gh pr list --repo ${repo} --limit 3 --json title,body --state merged
3. Build the PR body — include:
   - ## Summary (2–3 bullets from commits since base)
   - ## Changes (git -C ${plan.worktree_path} diff --stat origin/main...HEAD)
   - ## Test plan (checklist derived from acceptance criteria)
   - Closes #${issueNum}
4. gh pr create --repo ${repo} --title "${plan.issue_title}" --body "…" --base main --head ${plan.branch}
5. If issue #${issueNum} has a GitHub project card, move it to "In Review":
     gh issue view ${issueNum} --repo ${repo} --json projectItems

Return pr_number and pr_url.`,
  {
    label: 'Docking',
    phase: 'Docking',
    schema: PR_SCHEMA,
    model: 'sonnet',
  }
)

log(`Mission complete — PR #${pr.pr_number}: ${pr.pr_url}`)

return {
  issue_number: issueNum,
  pr_number:    pr.pr_number,
  pr_url:       pr.pr_url,
}
