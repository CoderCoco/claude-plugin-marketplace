export const meta = {
  name: 'systems-check-workflow',
  description: 'Review the full diff with language-bucketed inspectors and repair actionable findings. Returns status so the skill can ask the user what to do if rounds are exhausted.',
  phases: [
    { title: 'Review', detail: 'Scout diff, spawn language inspectors and specialists' },
    { title: 'Fix',    detail: 'Repair Astronauts address actionable findings; Flight Controllers verify' },
    { title: 'Commit', detail: 'Commit PASSed repairs to the worktree' },
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
        required: ['file', 'severity', 'confidence', 'summary'],
        properties: {
          file:       { type: 'string' },
          line:       { type: 'number' },
          severity:   { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100, description: 'How confident you are this is a real issue, 0–100. Be honest — uncertain findings should score low.' },
          summary:    { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
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
          label:  { type: 'string' },
          prompt: { type: 'string' },
        },
      },
    },
  },
}

// ── Args ───────────────────────────────────────────────────────────────────────

const _a = typeof args === 'string' ? JSON.parse(args) : (args || {})

const issueNum       = _a.issue_number
const repo           = _a.repo
const plan           = _a.plan
if (!issueNum || !repo || !plan) throw new Error('args must include issue_number, repo, and plan')

// Optional: previously deferred low-confidence findings from a prior SC run.
// Fed back into inspector prompts so they don't re-flag the same uncertain items.
const seedDeferred   = Array.isArray(_a.initial_deferred) ? _a.initial_deferred : []
const maxRounds      = typeof _a.max_rounds === 'number' ? _a.max_rounds : 3

// ── Systems Check ──────────────────────────────────────────────────────────────

const LANGUAGE_BUCKET_EXTS = {
  javascript: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'],
  python:     ['.py'],
  go:         ['.go'],
  rust:       ['.rs'],
  shell:      ['.sh', '.bash', '.zsh'],
}

phase('Review')
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
  { label: 'scout', phase: 'Review', schema: SCOUT_SCHEMA, model: 'haiku' }
)

const activeBucketNames = new Set(scout ? scout.active_buckets : [])
const focusByBucket = {}
if (scout && scout.focus_areas) scout.focus_areas.forEach(fa => { focusByBucket[fa.bucket] = fa })
const specialistDefs = (scout && scout.specialist_agents) || []

log(`Active buckets: ${[...activeBucketNames].join(', ') || 'none'} | Specialists: ${specialistDefs.map(s => s.label).join(', ') || 'none'}`)

// Seed the deferred accumulator from a prior SC run passed via args.
const deferredFindings = seedDeferred.slice()
const deferredKeys = new Set(seedDeferred.map(f => `${f.file}::${f.summary}`))

let scAttempts = 0

while (true) {
  phase('Review')
  log(`Inspection round ${scAttempts + 1}${scAttempts > 0 ? ' (re-inspecting after repairs)' : ''}…`)

  const deferredCtx = deferredFindings.length > 0
    ? `\n\nPreviously deferred low-confidence findings — do NOT re-report these unless your confidence is now above 50%:\n${deferredFindings.map(f => `  [${f.file}${f.line ? `:${f.line}` : ''}] ${f.summary} (was ${f.confidence}% confident)`).join('\n')}`
    : ''

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
Classify each finding: blocker | major | minor | nit
For each finding, assign a confidence score (0–100): how certain are you this is a real issue? Be honest — uncertain or style-preference findings should score low.${deferredCtx}`,
      {
        label: `inspector:${lang}:r${scAttempts}`,
        phase: 'Review',
        schema: FINDINGS_SCHEMA,
        agentType: 'mission:systems-inspector',
        model: 'sonnet',
      }
    )
  })

  const specialistInspectors = specialistDefs.map(s => () =>
    agent(`${s.prompt}\n\nFor each finding, assign a confidence score (0–100). Be honest — uncertain findings should score low.${deferredCtx}`, {
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
  const actionable  = significant.filter(f => (f.confidence ?? 100) > 50)
  const newDeferred = significant.filter(f => (f.confidence ?? 100) <= 50)

  for (const f of newDeferred) {
    const key = `${f.file}::${f.summary}`
    if (!deferredKeys.has(key)) {
      deferredKeys.add(key)
      deferredFindings.push(f)
    }
  }

  log(`Round ${scAttempts + 1}: ${actionable.length} actionable, ${newDeferred.length} new deferred (≤50% confidence), ${allFindings.length - significant.length} nit(s)`)

  // ── Clean — return success ─────────────────────────────────────────────────

  if (actionable.length === 0) {
    log(`Systems check clean${deferredFindings.length > 0 ? ` (${deferredFindings.length} low-confidence finding(s) deferred to user)` : ''}`)
    return { status: 'clean', open_findings: [], low_confidence_findings: deferredFindings }
  }

  // ── Rounds exhausted — return for skill to handle interactively ────────────

  if (scAttempts >= maxRounds) {
    log(`Rounds exhausted (${maxRounds}) — ${actionable.length} actionable finding(s) remain`)
    return { status: 'exhausted', open_findings: actionable, low_confidence_findings: deferredFindings }
  }

  // ── Repair Astronauts (parallel — actionable findings only) ───────────────

  phase('Fix')
  log(`Dispatching ${actionable.length} repair(s) (round ${scAttempts + 1} of ${maxRounds})…`)

  const repairs = await parallel(actionable.map((finding, idx) => () =>
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
        phase: 'Fix',
        schema: CREW_REPORT_SCHEMA,
        model: 'sonnet',
      }
    )
  ))

  // ── Repair Flight Controllers (parallel) ───────────────────────────────────

  // Intentionally not filtering so indices stay aligned with actionable[].
  const repairVerdicts = await parallel(
    repairs.map((repair, idx) => () =>
      repair
        ? agent(
            `You are the Flight Controller verifying a repair for mission issue #${issueNum}.

Finding: ${JSON.stringify(actionable[idx])}
Crew report: ${JSON.stringify(repair)}
Worktree: ${plan.worktree_path}

Run checks as appropriate. PASS only if the finding is resolved and all checks pass. FAIL with fixes_needed otherwise.`,
            {
              label: `fc-repair:r${scAttempts}:${idx}`,
              phase: 'Fix',
              schema: VERDICT_SCHEMA,
              agentType: 'mission:flight-controller',
              model: 'sonnet',
            }
          )
        : Promise.resolve(null)
    )
  )

  // ── Commit PASSed repairs (sequential) ────────────────────────────────────

  phase('Commit')
  let repairsPassed = 0
  for (let idx = 0; idx < repairs.length; idx++) {
    const verdict = repairVerdicts[idx]
    const repair = repairs[idx]
    if (!verdict || !repair || verdict.verdict !== 'PASS') continue
    const finding = actionable[idx]
    await agent(
      `Commit the repair for "${finding.summary.slice(0, 60)}" in worktree ${plan.worktree_path}.

  git -C ${plan.worktree_path} add ${repair.files_modified.join(' ')}
  git -C ${plan.worktree_path} commit -m "fix: ${finding.summary.slice(0, 72)}\\n\\nRefs #${issueNum}"`,
      { label: `commit-repair:r${scAttempts}:${idx}`, phase: 'Commit', model: 'haiku' }
    )
    repairsPassed++
  }

  log(`Repairs: ${repairsPassed}/${actionable.length} committed — re-inspecting`)
  scAttempts++
}
