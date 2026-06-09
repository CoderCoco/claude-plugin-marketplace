export const meta = {
  name: 'liftoff-workflow',
  description: 'Implement all planned tasks for a GitHub issue — Astronauts build, Flight Controllers verify, commits land in the worktree',
  phases: [
    { title: 'Build',  detail: 'Astronauts implement tasks in dependency rounds' },
    { title: 'Verify', detail: 'Flight Controllers run tests/lint/build per task' },
    { title: 'Commit', detail: 'Commit PASSed tasks to the worktree' },
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
const repo     = _a.repo
const plan     = _a.plan
if (!issueNum || !repo || !plan) throw new Error('args must include issue_number, repo, and plan')

log(`${plan.tasks.length} tasks on ${plan.branch}:`)
plan.tasks.forEach(t => log(`  ${t.name}: ${t.title} [${t.files.join(', ')}]`))

// ── Liftoff ────────────────────────────────────────────────────────────────────

const TASK_ATTEMPT_CAP = 3
const rounds = computeRounds(plan.tasks)
log(`${plan.tasks.length} tasks across ${rounds.length} round(s)`)

for (let r = 0; r < rounds.length; r++) {
  const batch = rounds[r]
  log(`Round ${r + 1}: ${batch.map(t => t.name).join(', ')}`)

  const taskState = {}
  batch.forEach(t => { taskState[t.name] = { attempts: 0, fixes: [] } })
  let pendingTasks = batch.slice()

  while (pendingTasks.length > 0) {
    for (const task of pendingTasks) {
      if (taskState[task.name].attempts >= TASK_ATTEMPT_CAP) {
        const fixes = taskState[task.name].fixes.join('; ')
        throw new Error(
          `Task ${task.name} failed ${TASK_ATTEMPT_CAP} times.\nLast fixes needed: ${fixes}\n\nResolve manually then re-run /mission ${issueNum}.`
        )
      }
    }

    // ── Astronauts (parallel) ──────────────────────────────────────────────────

    phase('Build')
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
          phase: 'Build',
          schema: CREW_REPORT_SCHEMA,
          agentType: 'mission:astronaut',
          model: 'sonnet',
        }
      )
    }))

    const planProblems = crewReports.filter(r => r && r.status === 'plan_problem')
    if (planProblems.length > 0) {
      throw new Error(
        `Plan problem(s) in round ${r + 1}:\n${planProblems.map(r => `  ${r.task_name}: ${r.plan_problem_description}`).join('\n')}\nRevise the flight plan and re-run.`
      )
    }

    const reportsByName = {}
    crewReports.filter(Boolean).forEach(rep => { reportsByName[rep.task_name] = rep })

    // ── Flight Controllers (parallel) ──────────────────────────────────────────

    phase('Verify')
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
            phase: 'Verify',
            schema: VERDICT_SCHEMA,
            agentType: 'mission:flight-controller',
            model: 'sonnet',
          }
        )
      })
    )

    const verdictsByName = {}
    verdicts.filter(Boolean).forEach(v => { verdictsByName[v.task_name] = v })

    // ── Commit PASSed / queue FAILed (sequential to avoid git lock race) ───────

    phase('Commit')
    const nextPending = []
    for (const task of pendingTasks) {
      const verdict = verdictsByName[task.name]

      if (!verdict) {
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
          { label: `commit:${task.name}`, phase: 'Commit', model: 'haiku' }
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
return { issue_number: issueNum }
