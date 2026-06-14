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

// ── Caps ─────────────────────────────────────────────────────────────────────

// How many times an Astronaut may be re-run for a *real* FAIL before we abort.
const TASK_ATTEMPT_CAP = 3
// How many times we re-spawn ONLY the Flight Controller, back-to-back, within a
// single Verify phase when the spawn returns null (transient infra/spawn flake).
const VERIFIER_RETRY_TRIES = 3
// How many *rounds* a task may miss a verdict (verifier persistently unreachable,
// spaced across rounds) before we stop waiting and fall back gracefully. This is
// an infrastructure budget, kept entirely separate from TASK_ATTEMPT_CAP so a
// flaky verifier never burns the Astronaut's implementation-retry budget.
const VERIFIER_MISS_CAP = 2

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

// Re-spawn ONLY the Flight Controller (never the Astronaut) up to `tries` times
// when the spawn returns null. A null return is an infrastructure failure to
// obtain a verdict — not a real FAIL — so it must not feed back into the task's
// implementation-retry budget. Returns the verdict, or null if every spawn flaked.
async function verdictWithRetry(task, report, attempt, tries = VERIFIER_RETRY_TRIES) {
  for (let i = 0; i < tries; i++) {
    const v = await agent(
      `You are the Flight Controller reviewing task ${task.name} for mission issue #${issueNum}.

Task spec: ${JSON.stringify(task)}
Crew report: ${JSON.stringify(report)}
Worktree: ${plan.worktree_path}
Attempt: ${attempt} of ${TASK_ATTEMPT_CAP}

Run the project's tests, lint, and type checks inside the worktree.
PASS only if the implementation satisfies the acceptance criterion and all checks pass.
FAIL with specific, actionable fixes_needed otherwise.
Set task_name to exactly "${task.name}".`,
      {
        label: `FC:${task.name}:${attempt}.${i + 1}`,
        phase: 'Verify',
        schema: VERDICT_SCHEMA,
        agentType: 'mission:flight-controller',
        model: M.controller,
      }
    )
    if (v) return v
    log(`FC:${task.name} spawn returned null (verifier try ${i + 1}/${tries})`)
  }
  return null
}

// Commit a task's files in the worktree. Used both for PASSed tasks and for the
// commit-with-warning fallback when the verifier is persistently unreachable.
async function commitTask(task) {
  return agent(
    `Commit task ${task.name} in worktree ${plan.worktree_path}.

  git -C ${plan.worktree_path} add ${task.files.join(' ')}
  git -C ${plan.worktree_path} commit -m "feat: ${task.name} — ${task.title}\\n\\nRefs #${issueNum}"

The message must follow Conventional Commits (imperative subject, ≤72 chars).${pluginRoot ? `\nFull rules: read ${pluginRoot}/references/conventional-commits.md` : ''}
Return the commit SHA.`,
    { label: `commit:${task.name}`, phase: 'Commit', model: M.utility }
  )
}

// ── Args ───────────────────────────────────────────────────────────────────────

const _a = typeof args === 'string' ? JSON.parse(args) : (args || {})

const issueNum = _a.issue_number
const repo     = _a.repo
const plan     = _a.plan
if (!issueNum || !repo || !plan) throw new Error('args must include issue_number, repo, and plan')

const MODEL_DEFAULTS = { astronaut: 'sonnet', controller: 'sonnet', inspector: 'fable', capcom: 'sonnet', docking: 'sonnet', utility: 'haiku' }
const M = Object.assign({}, MODEL_DEFAULTS, _a.models || {})
const pluginRoot = _a.plugin_root || ''

log(`${plan.tasks.length} tasks on ${plan.branch}:`)
plan.tasks.forEach(t => log(`  ${t.name}: ${t.title} [${t.files.join(', ')}]`))

// ── Liftoff ────────────────────────────────────────────────────────────────────

const rounds = computeRounds(plan.tasks)
log(`${plan.tasks.length} tasks across ${rounds.length} round(s)`)

for (let r = 0; r < rounds.length; r++) {
  const batch = rounds[r]
  log(`Round ${r + 1}: ${batch.map(t => t.name).join(', ')}`)

  // attempts        — real-FAIL implementation retries (gated by TASK_ATTEMPT_CAP)
  // verifierMisses  — rounds the verifier was unreachable (gated by VERIFIER_MISS_CAP)
  // report          — the Astronaut's latest crew report (reused across re-verifies)
  // needsBuild      — whether the Astronaut must run this round (false ⇒ verify-only)
  const taskState = {}
  batch.forEach(t => {
    taskState[t.name] = { attempts: 0, fixes: [], verifierMisses: 0, report: null, needsBuild: true }
  })
  let pending = batch.slice()
  const deferredUnverified = []

  while (pending.length > 0) {
    // Abort only on genuine, repeated implementation FAIL — never on infra flake.
    for (const task of pending) {
      if (taskState[task.name].attempts >= TASK_ATTEMPT_CAP) {
        const fixes = taskState[task.name].fixes.join('; ')
        const doneUncommitted = pending
          .filter(t => taskState[t.name].report && taskState[t.name].report.status === 'done')
          .map(t => t.name)
        throw new Error(
          `Task ${task.name} failed ${TASK_ATTEMPT_CAP} times.\nLast fixes needed: ${fixes}\n` +
          (doneUncommitted.length
            ? `Done-but-uncommitted edits remain in the worktree for: ${doneUncommitted.join(', ')} — commit or review them before re-running.\n`
            : '') +
          `\nResolve manually then re-run /mission ${issueNum}.`
        )
      }
    }

    // ── Astronauts (parallel) — only tasks that still need building ─────────────

    const toBuild = pending.filter(t => taskState[t.name].needsBuild)
    if (toBuild.length > 0) {
      phase('Build')
      const crewReports = await parallel(toBuild.map(task => () => {
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

Return a crew report whose task_name is exactly "${task.name}", plus status, files_modified, and a summary.`,
          {
            label: `Astronaut:${task.name}:${s.attempts + 1}`,
            phase: 'Build',
            schema: CREW_REPORT_SCHEMA,
            agentType: 'mission:astronaut',
            model: M.astronaut,
          }
        )
      }))

      // parallel() preserves input order, so crewReports[i] is toBuild[i]'s report.
      // Normalise task_name to the canonical crew name — the schema can't pin it to
      // a per-task constant, and the model frequently echoes the task *title* here,
      // which would make every taskState[...] lookup undefined and crash the round.
      crewReports.forEach((rep, i) => { if (rep) rep.task_name = toBuild[i].name })

      const planProblems = crewReports.filter(rep => rep && rep.status === 'plan_problem')
      if (planProblems.length > 0) {
        throw new Error(
          `Plan problem(s) in round ${r + 1}:\n${planProblems.map(rep => `  ${rep.task_name}: ${rep.plan_problem_description}`).join('\n')}\nRevise the flight plan and re-run.`
        )
      }

      crewReports.filter(Boolean).forEach(rep => {
        taskState[rep.task_name].report = rep
        taskState[rep.task_name].needsBuild = false
      })
    }

    // ── Flight Controllers (parallel, each with its own spawn-retry budget) ─────

    phase('Verify')
    const verdicts = await parallel(
      pending.map(task => () => {
        const report = taskState[task.name].report
        if (!report) return Promise.resolve(null)
        const attempt = taskState[task.name].attempts + 1
        return verdictWithRetry(task, report, attempt)
      })
    )

    // Same positional guarantee: verdicts[i] is pending[i]'s verdict. The Flight
    // Controller shares the unconstrained task_name schema and can likewise echo
    // the task title, so match by index rather than trusting the returned name.
    const verdictsByName = {}
    verdicts.forEach((v, i) => { if (v) verdictsByName[pending[i].name] = v })

    // ── Commit PASSed / queue FAILed (sequential to avoid git lock race) ───────

    phase('Commit')
    const nextPending = []
    for (const task of pending) {
      const state   = taskState[task.name]
      const report  = state.report
      const verdict = verdictsByName[task.name]

      // No usable report — the Astronaut spawn itself flaked. Treat as a build
      // retry (this DOES consume the implementation budget; the work never ran).
      if (!report) {
        state.attempts++
        state.fixes = ['Astronaut produced no report — re-running']
        state.needsBuild = true
        nextPending.push(task)
        log(`${task.name}: no astronaut report (attempt ${state.attempts}) — re-running`)
        continue
      }

      // Infrastructure miss — verifier unreachable even after in-phase retries.
      // Do NOT touch `attempts` and do NOT re-run the Astronaut; the edits already
      // succeeded. Spread waits across rounds (a crude backoff) up to the cap.
      if (!verdict) {
        state.verifierMisses++
        const misses = state.verifierMisses

        if (misses < VERIFIER_MISS_CAP) {
          state.needsBuild = false   // verify-only next round
          nextPending.push(task)
          log(`${task.name}: no verdict (verifier miss ${misses}/${VERIFIER_MISS_CAP}) — re-verifying only, astronaut not re-run`)
          continue
        }

        // Persistently unreachable verifier → graceful fallback, never abort.
        if (report.status === 'done') {
          await commitTask(task)
          log(`${task.name}: COMMITTED WITHOUT FC VERDICT after ${misses} verifier miss(es) — verify in systems-check`)
        } else {
          deferredUnverified.push(task.name)
          log(`${task.name}: DEFERRED unverified — verifier unreachable after ${misses} miss(es) and report not done`)
        }
        continue
      }

      // Real verdict — the verifier responded. Reset the infra counter and let a
      // genuine FAIL consume the implementation-retry budget.
      state.verifierMisses = 0
      state.attempts++

      if (verdict.verdict === 'PASS') {
        await commitTask(task)
        log(`${task.name}: PASSED on attempt ${state.attempts}`)
      } else {
        state.fixes = verdict.fixes_needed && verdict.fixes_needed.length > 0
          ? verdict.fixes_needed
          : ['No specific fixes given — inspect the implementation']
        state.needsBuild = true
        nextPending.push(task)
        log(`${task.name}: FAILED attempt ${state.attempts} — ${state.fixes.length} fix(es) needed, retrying`)
      }
    }

    pending = nextPending
  }

  if (deferredUnverified.length > 0) {
    log(`Round ${r + 1}: ${deferredUnverified.length} task(s) deferred unverified (verifier unreachable): ${deferredUnverified.join(', ')} — review these manually or rely on systems-check.`)
  }
}

log('All tasks complete — liftoff successful')
return { issue_number: issueNum }
