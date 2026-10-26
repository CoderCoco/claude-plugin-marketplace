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

export interface Snapshot {
  state: string;
  mergedAt: string | null;
  reviewDecision: string;
  /** check key (type + workflow + name) -> conclusion, or status/state when not yet concluded */
  checks: Record<string, string>;
  /** check key -> readable `workflow/name` label */
  checkLabels: Record<string, string>;
  /** dedupe key -> printable line */
  items: Record<string, string>;
}

const SNIPPET_MAX = 120;

/** Strips control chars/newlines, collapses whitespace, caps length. */
export function snippet(text: unknown): string {
  const s = String(text ?? '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > SNIPPET_MAX ? `${s.slice(0, SNIPPET_MAX - 1)}…` : s;
}

interface Author { login?: string }
interface PrView {
  state?: string;
  mergedAt?: string | null;
  reviewDecision?: string | null;
  statusCheckRollup?: Array<{ __typename?: string; workflowName?: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string }>;
  comments?: Array<{ id?: string; author?: Author; body?: string }>;
  reviews?: Array<{ id?: string; author?: Author; body?: string; state?: string }>;
}
export interface InlineComment { id?: number; user?: Author; body?: string; path?: string }

/** Builds a snapshot from raw gh output. Pure. */
export function buildSnapshot(view: PrView, inline: InlineComment[]): Snapshot {
  const checks: Record<string, string> = {};
  const checkLabels: Record<string, string> = {};
  for (const c of view.statusCheckRollup ?? []) {
    const name = snippet(c.name ?? c.context ?? 'unknown');
    const workflow = snippet(c.workflowName);
    const key =
      c.__typename === 'StatusContext' ? `StatusContext:${name}` : `${c.__typename ?? 'Check'}:${workflow}:${name}`;
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

const PENDING = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'EXPECTED', '']);

/** Lines describing changes from prev to next. Pure. */
export function diffSnapshots(prev: Snapshot, next: Snapshot): string[] {
  const lines: string[] = [];
  for (const [key, line] of Object.entries(next.items)) {
    if (!(key in prev.items)) lines.push(line);
  }
  for (const [key, result] of Object.entries(next.checks)) {
    if (prev.checks[key] !== result && !PENDING.has(result)) lines.push(`check ${next.checkLabels[key] ?? key} -> ${result}`);
  }
  if (next.reviewDecision !== prev.reviewDecision) {
    lines.push(`review decision -> ${next.reviewDecision || 'NONE'}`);
  }
  if (next.state !== prev.state) {
    lines.push(next.mergedAt ? 'PR merged' : `PR ${next.state.toLowerCase()}`);
  }
  return lines;
}

/** Consecutive fetch failures after which the watcher repeats its warning, and after which it gives up. */
export const WARN_AFTER = 5;
export const GIVE_UP_AFTER = 10;

/** Decides what to print and whether to exit after the `failures`-th consecutive fetch failure. Pure. */
export function failureAction(failures: number, err: unknown): { message: string | null; exit: boolean } {
  const report = failures === 1 || failures === WARN_AFTER || failures >= GIVE_UP_AFTER;
  const message = report ? `watcher error: ${snippet(err instanceof Error ? err.message : err)}` : null;
  return { message, exit: failures >= GIVE_UP_AFTER };
}

export const isDone = (s: Snapshot): boolean => s.state === 'MERGED' || s.state === 'CLOSED';

export interface Options { pr: string; repo: string | null; intervalSec: number; maxBackoffSec: number }

const PR_URL = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;

/** Parses CLI args (without node/script prefix). Returns an error string on bad usage. Pure. */
export function parseArgs(argv: string[]): Options | { error: string } {
  let target: string | null = null;
  let repo: string | null = null;
  let intervalSec = 60;
  let maxBackoffSec = 300;
  const positiveInt = (flag: string, v: string | undefined): number | string =>
    v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : `${flag} needs a positive integer`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--repo' || a === '--interval' || a === '--max-backoff') {
      const v = argv[++i];
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
      return { error: `unknown flag ${a}` };
    } else if (target === null) {
      target = a;
    } else {
      return { error: `unexpected argument ${a}` };
    }
  }
  if (!target) return { error: 'missing <pr-number|pr-url>' };
  const m = PR_URL.exec(target);
  if (m) return { pr: m[2]!, repo: repo ?? m[1]!, intervalSec, maxBackoffSec };
  if (!/^\d+$/.test(target)) return { error: `not a PR number or URL: ${snippet(target)}` };
  return { pr: target, repo, intervalSec, maxBackoffSec };
}

async function gh(args: string[]): Promise<string> {
  const p = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(err.trim() || `gh exited ${code}`);
  return out;
}

async function fetchSnapshot(o: Options): Promise<Snapshot> {
  const repoFlag = o.repo ? ['-R', o.repo] : [];
  const apiRepo = o.repo ?? '{owner}/{repo}';
  const [view, inline] = await Promise.all([
    gh(['pr', 'view', o.pr, ...repoFlag, '--json', 'state,mergedAt,reviewDecision,statusCheckRollup,comments,reviews']),
    gh(['api', '--paginate', '--slurp', `repos/${apiRepo}/pulls/${o.pr}/comments`]),
  ]);
  return buildSnapshot(JSON.parse(view), (JSON.parse(inline) as InlineComment[][]).flat());
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if ('error' in opts) {
    console.error(`${opts.error}\nusage: watch-pr.ts <pr-number|pr-url> [--repo owner/name] [--interval <sec>] [--max-backoff <sec>]`);
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
        console.log(`watching PR #${opts.pr}: ${next.state}, ${Object.keys(next.checks).length} checks`);
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
      delay = Math.min(pollMs * 2 ** failures, maxBackoffMs);
    }
    await Bun.sleep(delay);
  }
}

if (import.meta.main) await main();
