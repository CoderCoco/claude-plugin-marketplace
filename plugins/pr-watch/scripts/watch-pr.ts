/**
 * Polls a GitHub PR and prints ONE line per change to stdout (new comment/review,
 * check result, review-decision change, merge/close). Intended to run under the
 * `Monitor` tool. Comment text is untrusted: snippets are sanitized and length-capped.
 *
 * Usage: bun run watch-pr.ts <pr-number | pr-url> [--repo owner/name] [--interval <sec>] [--max-backoff <sec>]
 *
 *   <pr-number|pr-url>  PR number, or a full https://github.com/<owner>/<repo>/pull/<n> URL
 *                       (a URL also supplies --repo).
 *   --repo owner/name   Repository to query. Defaults to the repo of the current directory.
 *   --interval <sec>    Seconds between polls (default 60).
 *   --max-backoff <sec> Cap on the retry delay after fetch failures (default 300).
 *
 * Exit codes: 0 PR merged or closed, 1 gave up after repeated fetch failures, 2 usage error.
 */

/** Point-in-time view of a PR, reduced to what the watcher reports on. */
export interface Snapshot {
  /** PR state: OPEN, MERGED, CLOSED (or UNKNOWN when gh omits it). */
  state: string;
  /** Merge timestamp, or null if not merged. */
  mergedAt: string | null;
  /** Review decision (APPROVED, CHANGES_REQUESTED, ...); empty string when none. */
  reviewDecision: string;
  /** check key (type + workflow + name) -> conclusion, or status/state when not yet concluded */
  checks: Record<string, string>;
  /** check key -> readable `workflow/name` label */
  checkLabels: Record<string, string>;
  /** dedupe key -> printable line */
  items: Record<string, string>;
}

/** Maximum length of any untrusted text echoed to stdout. */
const SNIPPET_MAX = 120;

/**
 * Makes untrusted text safe to print as a single line: strips control chars,
 * line/paragraph separators and zero-width/bidi format chars, collapses
 * whitespace, and caps the length.
 * @param text Any value; null/undefined become an empty string.
 * @returns A trimmed one-line string of at most SNIPPET_MAX characters.
 */
export function snippet(text: unknown): string {
  const s = String(text ?? '')
    // Also drop zero-width and bidi-override format chars (Cf subset) that can spoof or hide text.
    .replace(/[\p{Cc}\p{Zl}\p{Zp}​-‏‪-‮⁠-⁩﻿]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > SNIPPET_MAX ? `${s.slice(0, SNIPPET_MAX - 1)}…` : s;
}

/** GitHub user as returned by gh; only the login is used. */
interface Author {
  login?: string;
}

/** One entry of `statusCheckRollup`: either a CheckRun or a legacy StatusContext. */
interface CheckRun {
  __typename?: string;
  /** Workflow name (CheckRun only). */
  workflowName?: string;
  /** Check name (CheckRun). */
  name?: string;
  /** Status name (StatusContext). */
  context?: string;
  /** Run status while in flight, e.g. IN_PROGRESS. */
  status?: string;
  /** Final result once complete, e.g. SUCCESS. */
  conclusion?: string;
  /** StatusContext state, e.g. PENDING or SUCCESS. */
  state?: string;
}

/** Subset of `gh pr view --json ...` output that the watcher reads. */
interface PrView {
  state?: string;
  mergedAt?: string | null;
  reviewDecision?: string | null;
  statusCheckRollup?: CheckRun[];
  /** Top-level PR conversation comments. */
  comments?: Array<{ id?: string; author?: Author; body?: string }>;
  /** Submitted reviews (the review body, not its inline comments). */
  reviews?: Array<{ id?: string; author?: Author; body?: string; state?: string }>;
}

/** Inline (diff-line) review comment from the REST pulls/comments endpoint. */
export interface InlineComment {
  id?: number;
  user?: Author;
  body?: string;
  path?: string;
}

/**
 * Builds a snapshot from raw gh output. Pure.
 * @param view Parsed `gh pr view --json` output.
 * @param inline Inline review comments from the REST API.
 * @returns A normalized Snapshot.
 */
export function buildSnapshot(view: PrView, inline: InlineComment[]): Snapshot {
  const checks: Record<string, string> = {};
  const checkLabels: Record<string, string> = {};

  for (const c of view.statusCheckRollup ?? []) {
    const name = snippet(c.name ?? c.context ?? 'unknown');
    const workflow = snippet(c.workflowName);

    // The workflow is part of the key because different workflows commonly reuse
    // a job name (e.g. "changes"); without it they would overwrite each other.
    // StatusContexts have no workflow.
    const key =
      c.__typename === 'StatusContext'
        ? `StatusContext:${name}`
        : `${c.__typename ?? 'Check'}:${workflow}:${name}`;

    // Prefer the final result; fall back to in-flight state, then PENDING.
    checks[key] = c.conclusion || c.state || c.status || 'PENDING';
    checkLabels[key] = workflow ? `${workflow}/${name}` : name;
  }

  const items: Record<string, string> = {};

  for (const c of view.comments ?? []) {
    items[`c:${c.id}`] = `comment by ${snippet(c.author?.login)}: ${snippet(c.body)}`;
  }

  for (const r of view.reviews ?? []) {
    items[`r:${r.id}`] = `review (${snippet(r.state)}) by ${snippet(r.author?.login)}: ${snippet(r.body)}`;
  }

  for (const c of inline) {
    items[`i:${c.id}`] = `inline comment by ${snippet(c.user?.login)} on ${snippet(c.path)}: ${snippet(c.body)}`;
  }

  return {
    state: view.state ?? 'UNKNOWN',
    mergedAt: view.mergedAt ?? null,
    reviewDecision: view.reviewDecision ?? '',
    checks,
    checkLabels,
    items,
  };
}

/** Check results that mean "not finished yet"; transitions into these are not reported. */
const PENDING = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'EXPECTED', '']);

/** Check results that mean the check did not pass. */
const FAILING = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

/**
 * Lines for checks that are already failing in the first snapshot, so a red PR is
 * never mistaken for a green one just because the watcher started late. Pure.
 * @param snap First snapshot taken by the watcher.
 * @returns One line per failing check.
 */
export function startupFailures(snap: Snapshot): string[] {
  return Object.entries(snap.checks)
    .filter(([, result]) => FAILING.has(result))
    .map(([key, result]) => `check ${snap.checkLabels[key] ?? key} -> ${result} (already failing at startup)`);
}

/**
 * Lines describing changes from prev to next. Pure.
 * @param prev Earlier snapshot.
 * @param next Later snapshot.
 * @returns One printable line per change, in a stable order: new items, concluded
 *   checks, review-decision change, state change.
 */
export function diffSnapshots(prev: Snapshot, next: Snapshot): string[] {
  const lines: string[] = [];

  // New comments/reviews (anything whose dedupe key wasn't seen before).
  for (const [key, line] of Object.entries(next.items)) {
    if (!(key in prev.items)) lines.push(line);
  }

  // Checks that changed and have actually concluded.
  for (const [key, result] of Object.entries(next.checks)) {
    const changed = prev.checks[key] !== result;
    if (changed && !PENDING.has(result)) {
      lines.push(`check ${next.checkLabels[key] ?? key} -> ${result}`);
    }
  }

  if (next.reviewDecision !== prev.reviewDecision) {
    lines.push(`review decision -> ${next.reviewDecision || 'NONE'}`);
  }

  if (next.state !== prev.state) {
    lines.push(next.mergedAt ? 'PR merged' : `PR ${next.state.toLowerCase()}`);
  }

  return lines;
}

/** Consecutive fetch failures after which the watcher repeats its warning. */
export const WARN_AFTER = 5;

/** Consecutive fetch failures after which the watcher gives up and exits 1. */
export const GIVE_UP_AFTER = 10;

/**
 * Decides what to print and whether to exit after the `failures`-th consecutive fetch failure. Pure.
 * Reports on the 1st failure, the WARN_AFTER-th, and every one from GIVE_UP_AFTER on.
 * @param failures Count of consecutive failures so far (1-based).
 * @param err The error thrown by the fetch; sanitized via snippet().
 * @returns `message` to print (null to stay quiet) and whether to `exit`.
 */
export function failureAction(failures: number, err: unknown): { message: string | null; exit: boolean } {
  const report = failures === 1 || failures === WARN_AFTER || failures >= GIVE_UP_AFTER;
  const message = report ? `watcher error: ${snippet(err instanceof Error ? err.message : err)}` : null;
  return { message, exit: failures >= GIVE_UP_AFTER };
}

/**
 * Whether the PR has reached a terminal state, ending the watch.
 * @param s Snapshot to inspect.
 */
export const isDone = (s: Snapshot): boolean => s.state === 'MERGED' || s.state === 'CLOSED';

/** Parsed command-line options. */
export interface Options {
  /** PR number as a string. */
  pr: string;
  /** owner/name, or null to let gh infer it from the current directory. */
  repo: string | null;
  /** Seconds between polls. */
  intervalSec: number;
  /** Cap, in seconds, on the retry delay after failures. */
  maxBackoffSec: number;
}

/** Matches a PR URL; group 1 is owner/name, group 2 the PR number. */
const PR_URL = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
/** Matches a plain owner/name repo slug. */
const REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * Parses CLI args (without node/script prefix). Pure.
 * @param argv Arguments after the script name.
 * @returns Parsed Options, or `{ error }` describing the usage problem.
 */
export function parseArgs(argv: string[]): Options | { error: string } {
  let target: string | null = null;
  let repo: string | null = null;
  let intervalSec = 60;
  let maxBackoffSec = 300;

  // Returns the number, or an error message string when v isn't a positive integer.
  const positiveInt = (flag: string, v: string | undefined): number | string => {
    const valid = v !== undefined && /^\d+$/.test(v) && Number(v) > 0;
    return valid ? Number(v) : `${flag} needs a positive integer`;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const takesValue = a === '--repo' || a === '--interval' || a === '--max-backoff';

    if (takesValue) {
      const v = argv[++i]; // consume the flag's value
      if (a === '--repo') {
        if (!v || !REPO.test(v)) return { error: '--repo needs owner/name' };
        repo = v;
      } else {
        const n = positiveInt(a, v);
        if (typeof n === 'string') return { error: n };
        if (a === '--interval') intervalSec = n;
        else maxBackoffSec = n;
      }
    } else if (a.startsWith('--')) {
      // Any other flag-shaped arg is a typo; fail loudly rather than ignore it.
      return { error: `unknown flag ${a}` };
    } else if (target === null) {
      target = a;
    } else {
      return { error: `unexpected argument ${a}` };
    }
  }

  if (!target) return { error: 'missing <pr-number|pr-url>' };

  // A URL supplies the repo too, but an explicit --repo wins.
  const m = PR_URL.exec(target);
  if (m) return { pr: m[2]!, repo: repo ?? m[1]!, intervalSec, maxBackoffSec };
  if (!/^\d+$/.test(target)) return { error: `not a PR number or URL: ${snippet(target)}` };
  return { pr: target, repo, intervalSec, maxBackoffSec };
}

/**
 * Runs `gh` with the given args.
 * @param args Arguments after `gh`.
 * @returns Captured stdout.
 * @throws Error carrying gh's stderr (or exit code) on non-zero exit.
 */
async function gh(args: string[]): Promise<string> {
  const p = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);

  if (code !== 0) throw new Error(err.trim() || `gh exited ${code}`);
  return out;
}

/**
 * Fetches the PR's current state (view + inline comments) in parallel and normalizes it.
 * @param o Parsed options identifying the PR.
 * @returns A fresh Snapshot.
 * @throws If either gh call fails or returns invalid JSON.
 */
async function fetchSnapshot(o: Options): Promise<Snapshot> {
  const repoFlag = o.repo ? ['-R', o.repo] : [];
  // gh expands the {owner}/{repo} placeholders from the current directory.
  const apiRepo = o.repo ?? '{owner}/{repo}';

  const [view, inline] = await Promise.all([
    gh(['pr', 'view', o.pr, ...repoFlag, '--json', 'state,mergedAt,reviewDecision,statusCheckRollup,comments,reviews']),
    gh(['api', '--paginate', '--slurp', `repos/${apiRepo}/pulls/${o.pr}/comments`]),
  ]);

  // --slurp wraps each page in an outer array, so flatten the pages.
  return buildSnapshot(JSON.parse(view), (JSON.parse(inline) as InlineComment[][]).flat());
}

/**
 * Entry point: polls until the PR is merged/closed (exit 0), gives up after
 * repeated failures (exit 1), or rejects bad usage (exit 2).
 */
async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if ('error' in opts) {
    console.error(
      `${opts.error}\nusage: watch-pr.ts <pr-number|pr-url> [--repo owner/name] [--interval <sec>] [--max-backoff <sec>]`,
    );
    process.exit(2);
  }

  const pollMs = opts.intervalSec * 1000;
  const maxBackoffMs = opts.maxBackoffSec * 1000;
  let prev: Snapshot | null = null;
  let failures = 0;

  for (;;) {
    let delay = pollMs;

    try {
      const next = await fetchSnapshot(opts);
      failures = 0;

      if (!prev) {
        // First poll: announce and flag failing checks; existing comments aren't replayed.
        console.log(`watching PR #${opts.pr}: ${next.state}, ${Object.keys(next.checks).length} checks`);
        for (const line of startupFailures(next)) console.log(line);
      } else {
        for (const line of diffSnapshots(prev, next)) console.log(line);
      }

      prev = next;
      if (isDone(next)) process.exit(0);
    } catch (err) {
      failures++;
      const { message, exit } = failureAction(failures, err);
      if (message) console.log(message);
      if (exit) process.exit(1);

      // Back off exponentially (interval * 2^failures, capped), but never retry faster than the normal poll interval.
      delay = Math.max(pollMs, Math.min(pollMs * 2 ** failures, maxBackoffMs));
    }

    await Bun.sleep(delay);
  }
}

if (import.meta.main) await main();
