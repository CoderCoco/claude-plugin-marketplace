import { expect, test } from 'bun:test';
import { buildSnapshot, diffSnapshots, failureAction, parseArgs, snippet } from './watch-pr.ts';

// snippet: sanitizes untrusted text before it reaches stdout.
test('snippet strips control chars and caps length', () => {
  expect(snippet('a\nb\x1bc\td')).toBe('a b c d');
  expect(snippet('x'.repeat(500)).length).toBe(120);
});

// First snapshot has a pending check and one comment; the second adds a comment,
// an inline comment, a concluded check, and a merge.
test('diff reports only new items, concluded checks, and merge', () => {
  const a = buildSnapshot(
    { state: 'OPEN', statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }], comments: [{ id: '1', author: { login: 'u' }, body: 'hi' }] },
    [],
  );
  const b = buildSnapshot(
    {
      state: 'MERGED',
      mergedAt: 'now',
      statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
      comments: [
        { id: '1', author: { login: 'u' }, body: 'hi' },
        { id: '2', author: { login: 'v' }, body: 'yo\nthere' },
      ],
    },
    [{ id: 9, user: { login: 'w' }, path: 'f.ts', body: 'nit' }],
  );

  // The pre-existing comment is not repeated; identical snapshots yield nothing.
  expect(diffSnapshots(a, b)).toEqual([
    'comment by v: yo there',
    'inline comment by w on f.ts: nit',
    'check ci -> SUCCESS',
    'PR merged',
  ]);
  expect(diffSnapshots(b, b)).toEqual([]);
});

// Check keys include the workflow, so identical job names don't collide.
test('same-named checks in different workflows are keyed separately and labelled', () => {
  const a = buildSnapshot({ state: 'OPEN', statusCheckRollup: [
    { __typename: 'CheckRun', workflowName: 'CI', name: 'changes', status: 'IN_PROGRESS' },
    { __typename: 'CheckRun', workflowName: 'Docs', name: 'changes', status: 'IN_PROGRESS' },
    { __typename: 'StatusContext', context: 'cr', state: 'PENDING' },
  ] }, []);
  const b = buildSnapshot({ state: 'OPEN', statusCheckRollup: [
    { __typename: 'CheckRun', workflowName: 'CI', name: 'changes', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', workflowName: 'Docs', name: 'changes', conclusion: 'FAILURE' },
    { __typename: 'StatusContext', context: 'cr', state: 'SUCCESS' },
  ] }, []);
  expect(Object.keys(b.checks).length).toBe(3);
  expect(diffSnapshots(a, b)).toEqual(['check CI/changes -> SUCCESS', 'check Docs/changes -> FAILURE', 'check cr -> SUCCESS']);
});

// Quiet between the 1st and 5th failure; exit at the 10th.
test('failureAction warns on 1st and 5th failure, exits at 10th', () => {
  expect(failureAction(1, new Error('boom\nx')).message).toBe('watcher error: boom x');
  expect(failureAction(2, 'e')).toEqual({ message: null, exit: false });
  expect(failureAction(5, 'e').message).not.toBeNull();
  expect(failureAction(10, 'e').exit).toBe(true);
});

// '' and null both mean "no decision" and render as NONE.
test('diff reports reviewDecision changes, including clearing to NONE', () => {
  const a = buildSnapshot({ state: 'OPEN', reviewDecision: '' }, []);
  const b = buildSnapshot({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }, []);
  const c = buildSnapshot({ state: 'OPEN', reviewDecision: null }, []);
  expect(diffSnapshots(a, b)).toEqual(['review decision -> CHANGES_REQUESTED']);
  expect(diffSnapshots(b, c)).toEqual(['review decision -> NONE']);
  expect(diffSnapshots(a, c)).toEqual([]);
});

test('parseArgs: bare number uses defaults', () => {
  expect(parseArgs(['42'])).toEqual({ pr: '42', repo: null, intervalSec: 60, maxBackoffSec: 300 });
});

test('parseArgs: URL supplies repo and number; --repo overrides URL repo', () => {
  expect(parseArgs(['https://github.com/o/r/pull/7/files'])).toEqual({ pr: '7', repo: 'o/r', intervalSec: 60, maxBackoffSec: 300 });
  expect(parseArgs(['https://github.com/o/r/pull/7', '--repo', 'x/y'])).toMatchObject({ pr: '7', repo: 'x/y' });
});

test('parseArgs: flags in any order', () => {
  expect(parseArgs(['--interval', '10', '5', '--repo', 'o/r', '--max-backoff', '30'])).toEqual({
    pr: '5', repo: 'o/r', intervalSec: 10, maxBackoffSec: 30,
  });
});

// Missing/unknown/duplicate args, malformed repo, and non-positive or non-numeric values.
test('parseArgs: rejects bad input', () => {
  for (const argv of [[], ['abc'], ['1', '2'], ['1', '--bogus'], ['1', '--repo'], ['1', '--repo', 'nope'], ['1', '--interval', '0'], ['1', '--interval', 'x'], ['1', '--max-backoff']]) {
    expect(parseArgs(argv)).toHaveProperty('error');
  }
});
