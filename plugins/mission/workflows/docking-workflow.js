export const meta = {
  name: 'docking-workflow',
  description: 'Push the branch and open a pull request for a completed mission issue',
  phases: [
    { title: 'Docking', detail: 'Push branch, open PR, move project board card' },
  ],
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const PR_SCHEMA = {
  type: 'object',
  required: ['pr_number', 'pr_url'],
  properties: {
    pr_number: { type: 'number' },
    pr_url:    { type: 'string' },
  },
}

// ── Args ───────────────────────────────────────────────────────────────────────

const _a = typeof args === 'string' ? JSON.parse(args) : (args || {})

const issueNum = _a.issue_number
const repo     = _a.repo
const plan     = _a.plan
if (!issueNum || !repo || !plan) throw new Error('args must include issue_number, repo, and plan')

// ── Docking ────────────────────────────────────────────────────────────────────

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

log(`Docked — PR #${pr.pr_number}: ${pr.pr_url}`)
return { pr_number: pr.pr_number, pr_url: pr.pr_url }
