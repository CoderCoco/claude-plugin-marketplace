export const meta = {
  name: 'comms-workflow',
  description: 'Single-pass PR comment processor — fetch new comments, triage, fix actionable ones, reply to questions, re-request Copilot review. Invoke repeatedly via /loop for continuous watching.',
  phases: [
    { title: 'Fetch',  detail: 'Check PR status and new comments since last poll' },
    { title: 'Triage', detail: 'CAPCOM categorises: actionable / question / ignore / ambiguous' },
    { title: 'Fix',    detail: 'Astronauts implement fixes; FC verifies; push on PASS' },
  ],
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const PR_STATUS_SCHEMA = {
  type: 'object',
  required: ['merged', 'all_threads_resolved', 'ci_passing', 'new_comments', 'thread_map', 'max_comment_at'],
  properties: {
    merged:               { type: 'boolean' },
    approved:             { type: 'boolean' },
    all_threads_resolved: { type: 'boolean' },
    ci_passing:           { type: 'boolean' },
    changes_requested_by: {
      type: 'array',
      items: { type: 'string' },
      description: 'Logins of reviewers whose latest review state is CHANGES_REQUESTED',
    },
    max_comment_at: {
      type: 'string',
      description: 'ISO timestamp of the newest comment in new_comments, or empty string if none',
    },
    new_comments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'author', 'body', 'timestamp', 'type'],
        properties: {
          id:             { type: 'string' },
          node_id:        { type: 'string' },
          author:         { type: 'string' },
          body:           { type: 'string' },
          url:            { type: 'string' },
          timestamp:      { type: 'string' },
          type:           { type: 'string', enum: ['pr_comment', 'review_body', 'inline_comment'] },
          in_reply_to_id: { type: 'string' },
          file:           { type: 'string' },
          line:           { type: 'number' },
        },
      },
    },
    thread_map: {
      type: 'object',
      description: 'Maps comment id (string) → { thread_id: string, is_resolved: boolean }',
    },
  },
}

const TRIAGE_SCHEMA = {
  type: 'object',
  required: ['comments'],
  properties: {
    comments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'category'],
        properties: {
          id:             { type: 'string' },
          category:       { type: 'string', enum: ['actionable', 'question', 'ignore', 'ambiguous'] },
          author:         { type: 'string' },
          body_summary:   { type: 'string' },
          type:           { type: 'string', enum: ['pr_comment', 'review_body', 'inline_comment'] },
          file:           { type: 'string' },
          line:           { type: 'number' },
          in_reply_to_id: { type: 'string' },
          fix_hint:       { type: 'string', description: 'For actionable: what needs to change' },
          reply_draft:    { type: 'string', description: 'For question: auto-generated answer' },
        },
      },
    },
  },
}

const FIX_REPORT_SCHEMA = {
  type: 'object',
  required: ['comment_id', 'status', 'files_modified', 'summary'],
  properties: {
    comment_id:        { type: 'string' },
    status:            { type: 'string', enum: ['done', 'cannot_fix'] },
    files_modified:    { type: 'array', items: { type: 'string' } },
    summary:           { type: 'string' },
    cannot_fix_reason: { type: 'string' },
  },
}

const COMMS_VERDICT_SCHEMA = {
  type: 'object',
  required: ['comment_id', 'verdict'],
  properties: {
    comment_id:   { type: 'string' },
    verdict:      { type: 'string', enum: ['PASS', 'FAIL'] },
    fixes_needed: { type: 'array', items: { type: 'string' } },
  },
}

// ── Args ───────────────────────────────────────────────────────────────────────

const _a = typeof args === 'string' ? JSON.parse(args) : (args || {})

const issueNum     = _a.issue_number
const repo         = _a.repo
const prNum        = _a.pr_number
const branch       = _a.branch
const worktreePath = _a.worktree_path
const lastSeenAt   = _a.last_seen_at || '1970-01-01T00:00:00Z'

if (!issueNum || !repo || !prNum || !branch || !worktreePath) {
  throw new Error('args must include issue_number, repo, pr_number, branch, worktree_path')
}

log(`PR #${prNum} — fetching comments newer than ${lastSeenAt}`)

// ── Fetch PR status + new comments ────────────────────────────────────────────

phase('Fetch')

const status = await agent(
  `Fetch the current status of PR #${prNum} in ${repo} and all comments newer than ${lastSeenAt}.

Run these queries:

1. PR-level comments:
   gh api "repos/${repo}/issues/${prNum}/comments" --paginate \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[.[] | select(.created_at > "${lastSeenAt}") | {
         id: (.id | tostring), node_id, author: .user.login, body,
         url: .html_url, timestamp: .created_at,
         type: "pr_comment", in_reply_to_id: null, file: null, line: null
       }]'

2. Review summary bodies (Copilot posts here):
   gh api "repos/${repo}/pulls/${prNum}/reviews" --paginate \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[.[] | select((.submitted_at // .created_at) > "${lastSeenAt}" and .body != "" and .body != null) | {
         id: (.id | tostring), node_id, author: .user.login, body,
         url: .html_url, timestamp: (.submitted_at // .created_at),
         type: "review_body", in_reply_to_id: null, file: null, line: null
       }]'

3. Inline review comments:
   gh api "repos/${repo}/pulls/${prNum}/comments" --paginate \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[.[] | select(.created_at > "${lastSeenAt}") | {
         id: (.id | tostring), node_id, author: .user.login, body,
         url: .html_url, timestamp: .created_at,
         type: "inline_comment",
         in_reply_to_id: (.in_reply_to_id | tostring? // null),
         file: .path, line: (.line // .original_line)
       }]'

4. Review thread map:
   OWNER=$(echo "${repo}" | cut -d/ -f1)
   REPO_NAME=$(echo "${repo}" | cut -d/ -f2)
   gh api graphql \\
     -f query='query($owner:String!,$name:String!,$number:Int!){
       repository(owner:$owner,name:$name){
         pullRequest(number:$number){
           reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}
         }
       }
     }' \\
     -f owner="$OWNER" -f name="$REPO_NAME" -F number=${prNum} \\
     | jq '.data.repository.pullRequest.reviewThreads.nodes |
           map({key: (.comments.nodes[0].databaseId | tostring),
                value: {thread_id: .id, is_resolved: .isResolved}}) | from_entries'

5. PR state, approval, CI, all-threads check, and reviewers who want changes:
   OWNER=$(echo "${repo}" | cut -d/ -f1)
   REPO_NAME=$(echo "${repo}" | cut -d/ -f2)
   PR_STATE=$(gh pr view ${prNum} --repo ${repo} --json state,reviewDecision,statusCheckRollup)
   THREADS=$(gh api graphql \\
     -f query='query($owner:String!,$name:String!,$number:Int!){
       repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}
     }' \\
     -f owner="$OWNER" -f name="$REPO_NAME" -F number=${prNum} \\
     | jq '.data.repository.pullRequest.reviewThreads.nodes')
   # Get latest review state per reviewer (most recent review per user wins)
   REVIEWS=$(gh api "repos/${repo}/pulls/${prNum}/reviews" --paginate \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[group_by(.user.login)[] | sort_by(.submitted_at) | last | {login: .user.login, state: .state}]')
   echo "$PR_STATE" | jq --argjson threads "$THREADS" --argjson reviews "$REVIEWS" '{
     merged: (.state == "MERGED"),
     approved: (.reviewDecision == "APPROVED"),
     ci_passing: ([.statusCheckRollup[]?.conclusion] | all(. == "SUCCESS") or length == 0),
     all_threads_resolved: ($threads | length == 0 or all(.isResolved)),
     changes_requested_by: [$reviews[] | select(.state == "CHANGES_REQUESTED") | .login]
   }'

Merge all comment arrays, deduplicate by id, sort by timestamp.
Return max_comment_at as the ISO timestamp of the newest comment (empty string if none).`,
  {
    label: 'fetch',
    phase: 'Fetch',
    schema: PR_STATUS_SCHEMA,
    model: 'sonnet',
  }
)

if (!status) {
  return { status: 'fetch_failed', last_seen_at: lastSeenAt, items_fixed: 0, items_replied: 0, open_items: [] }
}

const newLastSeenAt = (status.max_comment_at && status.max_comment_at > lastSeenAt)
  ? status.max_comment_at
  : lastSeenAt

// ── Exit conditions ────────────────────────────────────────────────────────────

if (status.merged) {
  log('PR merged — comms complete')
  return { status: 'merged', last_seen_at: newLastSeenAt, items_fixed: 0, items_replied: 0, open_items: [] }
}

if (status.all_threads_resolved && status.ci_passing) {
  log('All threads resolved and CI green')
  return { status: 'resolved', last_seen_at: newLastSeenAt, items_fixed: 0, items_replied: 0, open_items: [] }
}

if (status.new_comments.length === 0) {
  log('No new comments this pass')
  return { status: 'pending', last_seen_at: newLastSeenAt, items_fixed: 0, items_replied: 0, open_items: [] }
}

log(`${status.new_comments.length} new comment(s) — triaging`)

// ── Triage ─────────────────────────────────────────────────────────────────────

phase('Triage')

const triage = await agent(
  `You are CAPCOM for mission issue #${issueNum}, PR #${prNum} in ${repo}.

Categorise each of the following ${status.new_comments.length} new comment(s):
${JSON.stringify(status.new_comments, null, 2)}

Categories:
- actionable: reviewer is asking for a code change → set fix_hint to a one-sentence description of what to change
- question:   reviewer is asking a question → set reply_draft to a helpful answer
- ignore:     praise, thanks, already-resolved thread, bot noise, or a reply to our own comment (avoid reply loops)
- ambiguous:  genuinely unclear — you cannot classify confidently`,
  {
    label: 'triage',
    phase: 'Triage',
    schema: TRIAGE_SCHEMA,
    agentType: 'mission:capcom',
    model: 'sonnet',
  }
)

if (!triage) {
  return { status: 'triage_failed', last_seen_at: newLastSeenAt, items_fixed: 0, items_replied: 0, open_items: [] }
}

const actionable = triage.comments.filter(c => c.category === 'actionable')
const questions  = triage.comments.filter(c => c.category === 'question')
const ambiguous  = triage.comments.filter(c => c.category === 'ambiguous')

log(`Triage: ${actionable.length} actionable, ${questions.length} question(s), ${ambiguous.length} ambiguous, ${triage.comments.filter(c => c.category === 'ignore').length} ignored`)
if (ambiguous.length > 0) {
  log(`Ambiguous (manual attention needed): ${ambiguous.map(c => `"${c.body_summary}"`).join(', ')}`)
}

let itemsFixed = 0
let itemsReplied = 0

// ── Fix actionable comments ────────────────────────────────────────────────────

if (actionable.length > 0) {
  phase('Fix')

  // Astronauts implement fixes in parallel
  const fixReports = await parallel(actionable.map(comment => () =>
    agent(
      `You are an Astronaut fixing a PR review comment for mission issue #${issueNum}.

Comment by ${comment.author}${comment.file ? ` on ${comment.file}${comment.line ? `:${comment.line}` : ''}` : ''}:
"${comment.body_summary}"

Fix needed: ${comment.fix_hint}
Worktree: ${worktreePath}

Apply the fix exactly. Do NOT commit — the Flight Controller verifies first.
Return comment_id: "${comment.id}" in your report.`,
      {
        label: `fix:${comment.id}`,
        phase: 'Fix',
        schema: FIX_REPORT_SCHEMA,
        agentType: 'mission:astronaut',
        model: 'sonnet',
      }
    )
  ))

  const fixById = {}
  fixReports.filter(Boolean).forEach(r => { fixById[r.comment_id] = r })

  // Flight Controllers verify in parallel
  const verdicts = await parallel(
    actionable.map(comment => () => {
      const report = fixById[comment.id]
      if (!report || report.status !== 'done') return Promise.resolve(null)
      return agent(
        `You are the Flight Controller verifying a comms fix for mission issue #${issueNum}.

Comment: ${JSON.stringify(comment)}
Fix report: ${JSON.stringify(report)}
Worktree: ${worktreePath}

Run checks as appropriate. PASS only if the fix satisfies the reviewer's intent and all checks pass.
FAIL with specific fixes_needed otherwise. Return comment_id: "${comment.id}".`,
        {
          label: `fc:${comment.id}`,
          phase: 'Fix',
          schema: COMMS_VERDICT_SCHEMA,
          agentType: 'mission:flight-controller',
          model: 'sonnet',
        }
      )
    })
  )

  const verdictById = {}
  verdicts.filter(Boolean).forEach(v => { verdictById[v.comment_id] = v })

  // Commit PASSed fixes sequentially (avoids git lock contention)
  const passedComments = []
  for (const comment of actionable) {
    const v = verdictById[comment.id]
    const report = fixById[comment.id]
    if (!v || v.verdict !== 'PASS' || !report) {
      if (v && v.verdict === 'FAIL') {
        log(`Fix for ${comment.id} FAILED: ${v.fixes_needed.join('; ')}`)
      }
      continue
    }

    const scope = comment.file ? comment.file.replace(/.*\//, '').replace(/\.[^.]+$/, '') : 'pr'
    await agent(
      `Commit the fix for comment ${comment.id} in worktree ${worktreePath}.

  git -C ${worktreePath} add ${report.files_modified.join(' ')}
  git -C ${worktreePath} commit -m "fix(${scope}): ${report.summary.slice(0, 60)}\\n\\nRefs #${issueNum}\\nCo-Authored-By: ${comment.author} (via PR comment)"

Return the commit SHA.`,
      { label: `commit:${comment.id}`, phase: 'Fix', model: 'haiku' }
    )
    passedComments.push(comment)
    itemsFixed++
    log(`Fixed comment by ${comment.author}: committed`)
  }

  if (passedComments.length > 0) {
    // Push all fixes
    await agent(
      `Push the branch in worktree ${worktreePath}:
  git -C ${worktreePath} push origin ${branch}`,
      { label: 'push', phase: 'Fix', model: 'haiku' }
    )

    // Resolve inline comment threads
    for (const comment of passedComments.filter(c => c.type === 'inline_comment')) {
      const threadInfo = (status.thread_map || {})[comment.id]
      if (threadInfo && threadInfo.thread_id && !threadInfo.is_resolved) {
        await agent(
          `Resolve this review thread:
  gh api graphql \\
    -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \\
    -f tid="${threadInfo.thread_id}"`,
          { label: `resolve:${comment.id}`, phase: 'Fix', model: 'haiku' }
        )
      }
    }

    // Post a summary reply on the PR so reviewers know what was addressed
    const fixedSummary = passedComments
      .map(c => `- ${c.file ? `\`${c.file}${c.line ? `:${c.line}` : ''}\` — ` : ''}${c.body_summary}`)
      .join('\n')
    await agent(
      `Post a PR comment on PR #${prNum} in ${repo} summarising what was addressed:
  gh pr comment ${prNum} --repo ${repo} --body "I've addressed the following feedback:\n\n${fixedSummary}\n\nPlease re-review when you get a chance."`,
      { label: 'summary-comment', phase: 'Fix', model: 'haiku' }
    )

    // Re-request review from anyone who had CHANGES_REQUESTED
    const requestChangesReviewers = (status.changes_requested_by || []).filter(Boolean)
    if (requestChangesReviewers.length > 0) {
      await agent(
        `Re-request review on PR #${prNum} in ${repo} from: ${requestChangesReviewers.join(', ')}
  gh pr edit ${prNum} --repo ${repo} --add-reviewer "${requestChangesReviewers.join(',')}" 2>/dev/null || true`,
        { label: 're-request-review', phase: 'Fix', model: 'haiku' }
      )
      log(`Re-requested review from: ${requestChangesReviewers.join(', ')}`)
    }

    // Always re-request Copilot review so it sees the updated code
    await agent(
      `Re-request Copilot review on PR #${prNum} in ${repo}:
  gh pr edit ${prNum} --repo ${repo} --add-reviewer "Copilot" 2>/dev/null || true`,
      { label: 'copilot-rereview', phase: 'Fix', model: 'haiku' }
    )

    log(`${passedComments.length}/${actionable.length} fix(es) pushed — review re-requested`)
  }
}

// ── Auto-post replies to questions ─────────────────────────────────────────────

for (const q of questions.filter(q => q.reply_draft)) {
  const isInline = q.type === 'inline_comment'
  const threadInfo = (status.thread_map || {})[q.id]
  await agent(
    `Post a reply to ${q.author}'s ${isInline ? 'inline' : 'PR'} comment on PR #${prNum} in ${repo}.

Reply text: "${q.reply_draft}"

${isInline
  ? `gh api "repos/${repo}/pulls/${prNum}/comments" -X POST -f body="${q.reply_draft}" -F in_reply_to=${q.id}`
  : `gh pr comment ${prNum} --repo ${repo} --body "${q.reply_draft}"`
}
${isInline && threadInfo && threadInfo.thread_id
  ? `\nThen resolve the thread:\n  gh api graphql -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' -f tid="${threadInfo.thread_id}"`
  : ''
}`,
    { label: `reply:${q.id}`, phase: 'Fix', model: 'haiku' }
  )
  itemsReplied++
  log(`Replied to ${q.author}'s question`)
}

return {
  status:        'pending',
  pr_merged:     status.merged,
  all_resolved:  status.all_threads_resolved,
  last_seen_at:  newLastSeenAt,
  items_fixed:   itemsFixed,
  items_replied: itemsReplied,
  open_items:    ambiguous.map(c => ({ id: c.id, author: c.author, summary: c.body_summary })),
}
