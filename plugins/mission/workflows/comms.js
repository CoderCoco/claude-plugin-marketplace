export const meta = {
  name: 'comms',
  description: 'Watch a PR for new review comments, address actionable ones, auto-reply to questions — loops until merged',
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
  required: ['comments', 'copilot_present'],
  properties: {
    copilot_present: { type: 'boolean' },
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

const issueNum    = args.issue_number
const repo        = args.repo
const prNum       = args.pr_number
const branch      = args.branch
const worktreePath = args.worktree_path

if (!issueNum || !repo || !prNum || !branch || !worktreePath) {
  throw new Error('args must include issue_number, repo, pr_number, branch, worktree_path')
}

const POLL_SECS = args.poll_interval || 300  // default 5 minutes
const MAX_ROUNDS = args.max_rounds || 24     // default ~2 hours at 5-min polls

let lastSeenAt = args.last_seen_at || '1970-01-01T00:00:00Z'
let roundsDone = 0

log(`Watching PR #${prNum} for issue #${issueNum} — polling every ${POLL_SECS}s, up to ${MAX_ROUNDS} rounds`)

// ── Main polling loop ──────────────────────────────────────────────────────────

while (roundsDone < MAX_ROUNDS) {
  log(`Poll ${roundsDone + 1}/${MAX_ROUNDS} — new since ${lastSeenAt}`)

  // ── Fetch PR status + new comments ────────────────────────────────────────

  phase('Fetch')

  const status = await agent(
    `Fetch the current status of PR #${prNum} in ${repo} and all comments newer than ${lastSeenAt}.

Run these four queries:

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

4. Review thread map (for resolving threads later):
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

5. PR merge/approval and CI status:
   gh pr view ${prNum} --repo ${repo} --json state,reviewDecision,statusCheckRollup \\
     | jq '{
         merged: (.state == "MERGED"),
         approved: (.reviewDecision == "APPROVED"),
         ci_passing: ([.statusCheckRollup[]?.conclusion] | all(. == "SUCCESS") or length == 0)
       }'

6. All-threads-resolved check:
   gh api graphql \\
     -f query='query($owner:String!,$name:String!,$number:Int!){
       repository(owner:$owner,name:$name){
         pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}
       }
     }' \\
     -f owner="$OWNER" -f name="$REPO_NAME" -F number=${prNum} \\
     | jq '.data.repository.pullRequest.reviewThreads.nodes | length == 0 or all(.isResolved)'

Merge all comment arrays, deduplicate by id, sort by timestamp.
Return max_comment_at as the ISO timestamp of the newest comment (empty string if none).`,
    {
      label: `fetch:r${roundsDone}`,
      phase: 'Fetch',
      schema: PR_STATUS_SCHEMA,
    }
  )

  if (!status) {
    log(`Poll ${roundsDone + 1}: fetch failed — will retry next round`)
    await agent(`run: sleep ${POLL_SECS}`, { label: `sleep:r${roundsDone}` })
    roundsDone++
    continue
  }

  // Advance lastSeenAt so the next round only fetches newer comments
  if (status.max_comment_at && status.max_comment_at > lastSeenAt) {
    lastSeenAt = status.max_comment_at
  }

  // ── Exit conditions ────────────────────────────────────────────────────────

  if (status.merged) {
    log('PR merged — comms complete')
    break
  }

  if (status.all_threads_resolved && status.ci_passing) {
    log('All threads resolved and CI green — comms complete')
    break
  }

  // ── No new comments — just sleep ───────────────────────────────────────────

  if (status.new_comments.length === 0) {
    log(`No new comments — sleeping ${POLL_SECS}s`)
    await agent(`run: sleep ${POLL_SECS}`, { label: `sleep:r${roundsDone}` })
    roundsDone++
    continue
  }

  log(`${status.new_comments.length} new comment(s) — triaging`)

  // ── Triage ─────────────────────────────────────────────────────────────────

  phase('Triage')

  const triage = await agent(
    `You are CAPCOM for mission issue #${issueNum}, PR #${prNum} in ${repo}.

Categorise each of the following ${status.new_comments.length} new comment(s):
${JSON.stringify(status.new_comments, null, 2)}

Categories:
- actionable: reviewer is asking for a code change → set fix_hint to a one-sentence description of what to change
- question:   reviewer is asking a question → set reply_draft to a helpful answer
- ignore:     praise, thanks, already-resolved thread, bot noise, or a comment we already replied to (in_reply_to_id is set and the parent is our own comment)
- ambiguous:  genuinely unclear — you cannot classify confidently

Set copilot_present=true if any comment author contains "copilot" or "github-advanced-security".
Filter out comments where in_reply_to_id refers to a comment we wrote (avoid reply loops).`,
    {
      label: `triage:r${roundsDone}`,
      phase: 'Triage',
      schema: TRIAGE_SCHEMA,
      agentType: 'mission:capcom',
    }
  )

  if (!triage) {
    log(`Triage failed — sleeping and retrying next round`)
    await agent(`run: sleep ${POLL_SECS}`, { label: `sleep:r${roundsDone}` })
    roundsDone++
    continue
  }

  const actionable = triage.comments.filter(c => c.category === 'actionable')
  const questions  = triage.comments.filter(c => c.category === 'question')
  const ambiguous  = triage.comments.filter(c => c.category === 'ambiguous')

  log(`Triage: ${actionable.length} actionable, ${questions.length} question(s), ${ambiguous.length} ambiguous, ${triage.comments.filter(c => c.category === 'ignore').length} ignored`)
  if (ambiguous.length > 0) {
    log(`Ambiguous comment(s) skipped — address manually: ${ambiguous.map(c => `"${c.body_summary}"`).join(', ')}`)
  }

  // ── Fix actionable comments ────────────────────────────────────────────────

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
          label: `fix:r${roundsDone}:${comment.id}`,
          phase: 'Fix',
          schema: FIX_REPORT_SCHEMA,
          agentType: 'mission:astronaut',
        }
      )
    ))

    // Index by comment_id for safe cross-agent lookup
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
            label: `fc:r${roundsDone}:${comment.id}`,
            phase: 'Fix',
            schema: COMMS_VERDICT_SCHEMA,
            agentType: 'mission:flight-controller',
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
          log(`Fix for comment ${comment.id} FAILED: ${v.fixes_needed.join('; ')}`)
        }
        continue
      }

      const scope = comment.file ? comment.file.replace(/.*\//, '').replace(/\.[^.]+$/, '') : 'pr'
      await agent(
        `Commit the fix for comment ${comment.id} in worktree ${worktreePath}.

  git -C ${worktreePath} add ${report.files_modified.join(' ')}
  git -C ${worktreePath} commit -m "fix(${scope}): ${report.summary.slice(0, 60)}\\n\\nRefs #${issueNum}\\nCo-Authored-By: ${comment.author} (via PR comment)"

Return the commit SHA.`,
        { label: `commit:r${roundsDone}:${comment.id}`, phase: 'Fix' }
      )
      passedComments.push(comment)
      log(`Fix for comment by ${comment.author}: committed`)
    }

    if (passedComments.length > 0) {
      // Push all fixes in one push
      await agent(
        `Push the branch in worktree ${worktreePath}: git -C ${worktreePath} push origin ${branch}`,
        { label: `push:r${roundsDone}`, phase: 'Fix' }
      )

      // Resolve inline comment threads
      for (const comment of passedComments.filter(c => c.type === 'inline_comment')) {
        const threadInfo = (status.thread_map || {})[comment.id]
        if (threadInfo && threadInfo.thread_id && !threadInfo.is_resolved) {
          await agent(
            `Resolve this review thread via the GitHub GraphQL API:

  gh api graphql \\
    -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \\
    -f tid="${threadInfo.thread_id}"`,
            { label: `resolve:r${roundsDone}:${comment.id}`, phase: 'Fix' }
          )
        }
      }

      // Re-request Copilot review if Copilot was a reviewer
      if (triage.copilot_present) {
        await agent(
          `Re-request Copilot review on PR #${prNum} in ${repo}:
  gh pr edit ${prNum} --repo ${repo} --add-reviewer Copilot 2>/dev/null || echo "Copilot re-request skipped"`,
          { label: `copilot:r${roundsDone}`, phase: 'Fix' }
        )
      }

      log(`Round ${roundsDone + 1}: ${passedComments.length}/${actionable.length} fix(es) pushed`)
    }
  }

  // ── Auto-post replies to questions ─────────────────────────────────────────

  for (const q of questions.filter(q => q.reply_draft)) {
    const isInline = q.type === 'inline_comment'
    await agent(
      `Post a reply to ${q.author}'s ${isInline ? 'inline' : 'PR'} comment on PR #${prNum} in ${repo}.

Reply text: "${q.reply_draft}"

${isInline
  ? `Use inline reply (in-thread):\n  gh api "repos/${repo}/pulls/${prNum}/comments" -X POST -f body="${q.reply_draft}" -F in_reply_to=${q.id}`
  : `Use PR comment:\n  gh pr comment ${prNum} --repo ${repo} --body "${q.reply_draft}"`
}

${isInline
  ? `Then resolve the thread:\n  gh api graphql -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' -f tid="${(status.thread_map || {})[q.id]?.thread_id || ''}"`
  : ''
}`,
      { label: `reply:r${roundsDone}:${q.id}` }
    )
    log(`Replied to ${q.author}'s question`)
  }

  // ── Sleep before next poll ─────────────────────────────────────────────────

  log(`Round ${roundsDone + 1} complete — sleeping ${POLL_SECS}s`)
  await agent(`run: sleep ${POLL_SECS}`, { label: `sleep:r${roundsDone}` })
  roundsDone++
}

if (roundsDone >= MAX_ROUNDS) {
  log(`Max rounds (${MAX_ROUNDS}) reached — re-run /comms ${issueNum} to continue watching`)
}

return {
  issue_number:    issueNum,
  rounds_completed: roundsDone,
  last_seen_at:    lastSeenAt,
}
