export const meta = {
  name: 'comms-workflow',
  description: 'Single-pass PR comment processor — fetch new comments, triage, fix actionable ones, reply to questions, re-request review from all reviewers. Invoke repeatedly via /loop for continuous watching.',
  phases: [
    { title: 'Fetch',    detail: 'Check PR status and new comments since last poll' },
    { title: 'Triage',   detail: 'CAPCOM categorises: actionable / question / ignore / ambiguous' },
    { title: 'Fix',      detail: 'Astronauts implement fixes; FC verifies; commit on PASS' },
    { title: 'Downlink', detail: 'Push, resolve threads, summary comment, re-request review, reply to questions' },
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
    reviewed_by: {
      type: 'array',
      items: { type: 'string' },
      description: 'Logins of everyone who submitted a review (any state)',
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
      description: 'Maps thread-root comment databaseId (string) → { thread_id: string, is_resolved: boolean, last_author: string }',
    },
    thread_comments: {
      type: 'object',
      description: 'Maps review-thread node id (string) → ordered array of { author, body } for the whole thread conversation',
    },
    viewer_login: {
      type: 'string',
      description: 'Login of the authenticated gh user (us) — used to detect our own replies',
    },
    open_threads: {
      type: 'array',
      description: 'Every review thread with isResolved=false, regardless of timestamp — so a long-open thread is reconsidered every pass',
      items: {
        type: 'object',
        required: ['id', 'thread_id', 'author', 'body'],
        properties: {
          id:          { type: 'string', description: 'thread-root comment databaseId' },
          thread_id:   { type: 'string', description: 'GraphQL review thread node id' },
          author:      { type: 'string' },
          body:        { type: 'string' },
          url:         { type: 'string' },
          file:        { type: 'string' },
          line:        { type: 'number' },
          last_author: { type: 'string', description: 'login of the most recent commenter in the thread' },
        },
      },
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
          category:       { type: 'string', enum: ['actionable', 'question', 'acknowledge', 'ignore', 'ambiguous'] },
          author:         { type: 'string' },
          body_summary:   { type: 'string' },
          type:           { type: 'string', enum: ['pr_comment', 'review_body', 'inline_comment'] },
          file:           { type: 'string' },
          line:           { type: 'number' },
          in_reply_to_id: { type: 'string' },
          fix_hint:       { type: 'string', description: 'For actionable: what needs to change' },
          reply_draft:    { type: 'string', description: 'For question/acknowledge: auto-generated reply' },
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

const MODEL_DEFAULTS = { astronaut: 'sonnet', controller: 'sonnet', inspector: 'fable', capcom: 'sonnet', docking: 'sonnet', utility: 'haiku' }
const M = Object.assign({}, MODEL_DEFAULTS, _a.models || {})
const pluginRoot = _a.plugin_root || ''

log(`PR #${prNum} — fetching comments newer than ${lastSeenAt}`)

// ── Fetch PR status + new comments ────────────────────────────────────────────

phase('Fetch')

const status = await agent(
  `Fetch the current status of PR #${prNum} in ${repo} and all comments newer than ${lastSeenAt}.

Run these queries:

1. PR-level comments (key off the later of created_at / updated_at so EDITED comments re-surface):
   gh api "repos/${repo}/issues/${prNum}/comments" --paginate \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[.[] | select((.updated_at // .created_at) > "${lastSeenAt}") | {
         id: (.id | tostring), node_id, author: .user.login, body,
         url: .html_url, timestamp: (.updated_at // .created_at),
         type: "pr_comment", in_reply_to_id: null, file: null, line: null
       }]'

2. Review summary bodies (the top-level body of any review — human or bot). Fetch via
   GraphQL and key off lastEditedAt so EDITED review bodies re-surface (the REST reviews
   endpoint has no updated_at, so an edited review body would otherwise be missed forever):
   OWNER=$(echo "${repo}" | cut -d/ -f1)
   REPO_NAME=$(echo "${repo}" | cut -d/ -f2)
   gh api graphql \\
     -f query='query($owner:String!,$name:String!,$number:Int!){
       repository(owner:$owner,name:$name){
         pullRequest(number:$number){
           reviews(first:100){nodes{ databaseId author{login} body url submittedAt lastEditedAt }}
         }
       }
     }' \\
     -f owner="$OWNER" -f name="$REPO_NAME" -F number=${prNum} \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[.data.repository.pullRequest.reviews.nodes[]
         | select((.lastEditedAt // .submittedAt) > "${lastSeenAt}" and .body != "" and .body != null) | {
             id: (.databaseId | tostring), node_id: null, author: (.author.login // ""), body,
             url: .url, timestamp: (.lastEditedAt // .submittedAt),
             type: "review_body", in_reply_to_id: null, file: null, line: null
           }]'

3. Inline review comments (key off the later of created_at / updated_at so EDITED comments re-surface):
   gh api "repos/${repo}/pulls/${prNum}/comments" --paginate \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[.[] | select((.updated_at // .created_at) > "${lastSeenAt}") | {
         id: (.id | tostring), node_id, author: .user.login, body,
         url: .html_url, timestamp: (.updated_at // .created_at),
         type: "inline_comment",
         in_reply_to_id: (.in_reply_to_id | tostring? // null),
         file: .path, line: (.line // .original_line)
       }]'

4. Review threads — run the query ONCE, then derive both thread_map and open_threads:
   OWNER=$(echo "${repo}" | cut -d/ -f1)
   REPO_NAME=$(echo "${repo}" | cut -d/ -f2)
   THREADS_JSON=$(gh api graphql \\
     -f query='query($owner:String!,$name:String!,$number:Int!){
       repository(owner:$owner,name:$name){
         pullRequest(number:$number){
           reviewThreads(first:100){nodes{
             id isResolved
             root: comments(first:1){nodes{databaseId author{login} body path line}}
             all: comments(first:100){nodes{author{login} body}}
             last: comments(last:1){nodes{author{login}}}
           }}
         }
       }
     }' \\
     -f owner="$OWNER" -f name="$REPO_NAME" -F number=${prNum} \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037')

   # thread_map: root databaseId → { thread_id, is_resolved, last_author }
   echo "$THREADS_JSON" | jq '.data.repository.pullRequest.reviewThreads.nodes |
     map({key: (.root.nodes[0].databaseId | tostring),
          value: {thread_id: .id, is_resolved: .isResolved,
                  last_author: (.last.nodes[0].author.login // "")}}) | from_entries'

   # open_threads: every unresolved thread, regardless of timestamp
   echo "$THREADS_JSON" | jq '[.data.repository.pullRequest.reviewThreads.nodes[]
     | select(.isResolved | not) | {
         id: (.root.nodes[0].databaseId | tostring),
         thread_id: .id,
         author: (.root.nodes[0].author.login // ""),
         body: (.root.nodes[0].body // ""),
         file: (.root.nodes[0].path // null),
         line: (.root.nodes[0].line // null),
         last_author: (.last.nodes[0].author.login // "")
       }]'

   # thread_comments: thread_id → ordered conversation [{author, body}], so triage can
   # read a comment in the context of the whole linked thread, not just one message.
   echo "$THREADS_JSON" | jq '.data.repository.pullRequest.reviewThreads.nodes |
     map({key: .id,
          value: (.all.nodes | map({author: (.author.login // ""), body: .body}))}) | from_entries'

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
   # Unique logins of everyone who submitted any review
   REVIEWS=$(gh api "repos/${repo}/pulls/${prNum}/reviews" --paginate \\
     | tr -d '\\000-\\010\\013\\014\\016-\\037' \\
     | jq '[.[].user.login] | unique')
   echo "$PR_STATE" | jq --argjson threads "$THREADS" --argjson reviews "$REVIEWS" '{
     merged: (.state == "MERGED"),
     approved: (.reviewDecision == "APPROVED"),
     ci_passing: ([.statusCheckRollup[]?.conclusion] | all(. == "SUCCESS") or length == 0),
     all_threads_resolved: ($threads | length == 0 or all(.isResolved)),
     reviewed_by: $reviews
   }'

6. Authenticated user (us): gh api user --jq '.login'  → return as viewer_login

Merge the three comment arrays (queries 1–3), deduplicate by id, sort by timestamp.
Return max_comment_at as the ISO timestamp of the newest comment activity (max timestamp; empty string if none).
Return thread_map, open_threads, and thread_comments (query 4) and viewer_login (query 6) as well.`,
  {
    label: 'fetch',
    phase: 'Fetch',
    schema: PR_STATUS_SCHEMA,
    model: M.capcom,
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

// ── Build the candidate set (deterministic — resolution is NOT an LLM decision) ──

const viewerLogin    = status.viewer_login || ''
const threadMap      = status.thread_map || {}
const openThreads    = status.open_threads || []
const threadComments = status.thread_comments || {}

// Enrich a comment with its thread's resolution state (join by thread-root id) and
// the full thread conversation (so triage reads it in context of any linked replies).
const enrich = (c) => {
  if (c.type !== 'inline_comment') {
    return { ...c, is_resolved: null, thread_id: null, thread_last_author: null, thread_context: null }
  }
  const t = threadMap[c.in_reply_to_id || c.id] || {}
  return {
    ...c,
    is_resolved:        !!t.is_resolved,
    thread_id:          t.thread_id || null,
    thread_last_author: t.last_author || null,
    thread_context:     (t.thread_id && threadComments[t.thread_id]) || null,
  }
}

// Open threads (timestamp-independent) mapped into comment shape, so a long-open
// thread is reconsidered every pass instead of being excluded by last_seen_at.
const openThreadComments = openThreads.map(t => ({
  id: t.id, node_id: null, author: t.author, body: t.body,
  url: t.url || null, timestamp: '', type: 'inline_comment',
  in_reply_to_id: null, file: t.file || null, line: t.line || null,
  is_resolved: false, thread_id: t.thread_id || null, thread_last_author: t.last_author || null,
  thread_context: (t.thread_id && threadComments[t.thread_id]) || null,
}))

// Union of time-windowed comments and open threads, deduped by id; resolved inline
// threads never reach triage.
const byId = {}
for (const c of status.new_comments.map(enrich)) byId[c.id] = c
for (const c of openThreadComments) if (!byId[c.id]) byId[c.id] = c
const candidates = Object.values(byId).filter(c => !(c.type === 'inline_comment' && c.is_resolved))

if (candidates.length === 0) {
  log('No actionable comments or open threads this pass')
  return { status: 'pending', last_seen_at: newLastSeenAt, items_fixed: 0, items_replied: 0, open_items: [] }
}

log(`${candidates.length} comment(s)/open thread(s) — triaging`)

// ── Triage ─────────────────────────────────────────────────────────────────────

phase('Triage')

const triage = await agent(
  `You are CAPCOM for mission issue #${issueNum}, PR #${prNum} in ${repo}. We are "${viewerLogin}".

Each comment below carries is_resolved/thread_id (already resolved threads have been removed —
everything you see on an inline thread is UNRESOLVED). Inline comments also carry thread_context:
the full ordered conversation on that thread — read each comment in that context, since a reviewer's
ask is often spread across linked replies. A comment may also be an EDIT of one seen earlier (it
re-surfaces when its text changes); categorise it on its CURRENT text, not any prior wording.
Categorise each of the ${candidates.length}:
${JSON.stringify(candidates, null, 2)}

Categories:
- actionable:  reviewer wants a code change that is NOT yet made → set fix_hint (one sentence)
- question:    reviewer is asking a question → set reply_draft to a helpful answer
- acknowledge: reviewer's point is valid but the branch ALREADY addresses it → set reply_draft
               confirming it's fixed (it will be posted and the thread resolved, no code change)
- ignore:      praise, thanks, emoji, bot noise, or our own comment (author "${viewerLogin}")
- ambiguous:   genuinely unclear, or architectural pushback with no concrete ask

HARD RULE: a comment on an UNRESOLVED inline thread (is_resolved: false) is NEVER ignore.
If it's already handled in the branch, use acknowledge; otherwise actionable/question/ambiguous.`,
  {
    label: 'triage',
    phase: 'Triage',
    schema: TRIAGE_SCHEMA,
    agentType: 'mission:capcom',
    model: M.capcom,
  }
)

if (!triage) {
  return { status: 'triage_failed', last_seen_at: newLastSeenAt, items_fixed: 0, items_replied: 0, open_items: [] }
}

const actionable   = triage.comments.filter(c => c.category === 'actionable')
const questions    = triage.comments.filter(c => c.category === 'question')
const acknowledged = triage.comments.filter(c => c.category === 'acknowledge')
const ambiguous    = triage.comments.filter(c => c.category === 'ambiguous')
const ignored      = triage.comments.filter(c => c.category === 'ignore')

// Recover the enriched thread data triage doesn't echo (thread_id, thread_last_author).
const candById = {}
candidates.forEach(c => { candById[c.id] = c })
const threadIdOf = (id) => (candById[id] || {}).thread_id || null

log(`Triage: ${actionable.length} actionable, ${questions.length} question(s), ${acknowledged.length} acknowledge, ${ambiguous.length} ambiguous, ${ignored.length} ignored`)
if (ambiguous.length > 0) {
  log(`Ambiguous (manual attention needed): ${ambiguous.map(c => `"${c.body_summary}"`).join(', ')}`)
}
// Surface ignored items so silent drops are visible.
ignored.forEach(c => log(`Ignored ${c.type} by ${c.author}: "${c.body_summary || ''}"`))

let itemsFixed = 0
let itemsReplied = 0
const repliedIds  = new Set()   // comment ids we replied to this pass (anti double-reply)
const resolvedIds = new Set()   // thread-root ids we resolved this pass

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
        model: M.astronaut,
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
          model: M.controller,
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

The message must follow Conventional Commits (imperative subject, ≤72 chars).${pluginRoot ? `\nFull rules: read ${pluginRoot}/references/conventional-commits.md` : ''}
Return the commit SHA.`,
      { label: `commit:${comment.id}`, phase: 'Fix', model: M.utility }
    )
    passedComments.push(comment)
    itemsFixed++
    log(`Fixed comment by ${comment.author}: committed`)
  }

  if (passedComments.length > 0) {
    phase('Downlink')

    // Push all fixes
    await agent(
      `Push the branch in worktree ${worktreePath}:
  git -C ${worktreePath} push origin ${branch}`,
      { label: 'push', phase: 'Downlink', model: M.utility }
    )

    // Resolve inline comment threads
    for (const comment of passedComments.filter(c => c.type === 'inline_comment')) {
      const tid = threadIdOf(comment.id)
      if (tid) {
        await agent(
          `Resolve this review thread:
  gh api graphql \\
    -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' \\
    -f tid="${tid}"`,
          { label: `resolve:${comment.id}`, phase: 'Downlink', model: M.utility }
        )
        resolvedIds.add(comment.id)
      }
    }

    // Post a summary reply on the PR so reviewers know what was addressed
    const fixedSummary = passedComments
      .map(c => `- ${c.file ? `\`${c.file}${c.line ? `:${c.line}` : ''}\` — ` : ''}${c.body_summary}`)
      .join('\n')
    await agent(
      `Post a PR comment on PR #${prNum} in ${repo} summarising what was addressed:
  gh pr comment ${prNum} --repo ${repo} --body "I've addressed the following feedback:\n\n${fixedSummary}\n\nPlease re-review when you get a chance."`,
      { label: 'summary-comment', phase: 'Downlink', model: M.utility }
    )

    // Re-request review from everyone who reviewed — includes Copilot if it reviewed
    const reviewers = (status.reviewed_by || []).filter(Boolean)
    if (reviewers.length > 0) {
      await agent(
        `Re-request review on PR #${prNum} in ${repo} from all prior reviewers: ${reviewers.join(', ')}
  gh pr edit ${prNum} --repo ${repo} --add-reviewer "${reviewers.join(',')}" 2>/dev/null || true`,
        { label: 're-request-review', phase: 'Downlink', model: M.utility }
      )
      log(`Re-requested review from: ${reviewers.join(', ')}`)
    }

    log(`${passedComments.length}/${actionable.length} fix(es) pushed`)
  }
}

// ── Reply to questions / acknowledgements, then guarantee a terminal action ─────

const stillOpen = (c) => c.type === 'inline_comment' && c.thread_id && !resolvedIds.has(c.id) && !repliedIds.has(c.id)
const needsDownlink = questions.some(q => q.reply_draft) || acknowledged.some(a => a.reply_draft)
  || candidates.some(stillOpen)
if (needsDownlink) phase('Downlink')

// Post a reply to a comment/thread, optionally resolving it. Records tracking sets.
const replyTo = async (c, body, { resolve }) => {
  const isInline = c.type === 'inline_comment'
  const tid = isInline ? threadIdOf(c.id) : null
  await agent(
    `Post a reply to ${c.author}'s ${isInline ? 'inline' : 'PR'} comment on PR #${prNum} in ${repo}.

Reply text: "${body}"

${isInline
  ? `gh api "repos/${repo}/pulls/${prNum}/comments" -X POST -f body="${body}" -F in_reply_to=${c.id}`
  : `gh pr comment ${prNum} --repo ${repo} --body "${body}"`
}${resolve && tid
  ? `\nThen resolve the thread:\n  gh api graphql -f query='mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{isResolved}}}' -f tid="${tid}"`
  : ''
}`,
    { label: `reply:${c.id}`, phase: 'Downlink', model: M.utility }
  )
  repliedIds.add(c.id)
  if (resolve && tid) resolvedIds.add(c.id)
  itemsReplied++
}

for (const q of questions.filter(q => q.reply_draft)) {
  await replyTo(q, q.reply_draft, { resolve: true })
  log(`Replied to ${q.author}'s question`)
}

for (const a of acknowledged.filter(a => a.reply_draft)) {
  await replyTo(a, a.reply_draft, { resolve: true })
  log(`Acknowledged & resolved ${a.author}'s thread`)
}

// Terminal-action guarantee: every unresolved thread that got no reply this pass
// gets one — but only if a REVIEWER spoke last. If we already replied on a prior
// pass (we're the last commenter), don't re-reply; it's surfaced in open_items.
for (const c of candidates.filter(stillOpen)) {
  if (c.thread_last_author && c.thread_last_author === viewerLogin) continue
  await replyTo(c, "Acknowledged — we're tracking this and will follow up. Leaving the thread open for now.", { resolve: false })
  log(`Acknowledged open thread by ${c.author} (no auto-fix this pass)`)
}

// ── Honest reporting: every unresolved thread + any ambiguous comment ───────────

const triageById = {}
triage.comments.forEach(t => { triageById[t.id] = t })
const openItems = []
const seenOpen = new Set()
const addOpen = (c) => {
  if (!c || seenOpen.has(c.id)) return
  seenOpen.add(c.id)
  const summary = (triageById[c.id] && triageById[c.id].body_summary) || (c.body || '').slice(0, 140)
  openItems.push({ id: c.id, author: c.author, path: c.file || null, summary })
}
candidates
  .filter(c => c.type === 'inline_comment' && c.thread_id && !resolvedIds.has(c.id))
  .forEach(addOpen)
ambiguous.forEach(c => addOpen(candById[c.id] || c))

return {
  status:        'pending',
  pr_merged:     status.merged,
  all_resolved:  status.all_threads_resolved,
  last_seen_at:  newLastSeenAt,
  items_fixed:   itemsFixed,
  items_replied: itemsReplied,
  open_items:    openItems,
}
