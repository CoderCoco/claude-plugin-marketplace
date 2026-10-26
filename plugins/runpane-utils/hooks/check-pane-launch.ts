/**
 * PreToolUse hook: deny Pane launches of Claude that would run the built-in template
 * (`claude --dangerously-skip-permissions`) instead of an explicit `--tool-command`
 * carrying `--session-id`.
 *
 * Covers:
 *   Bash                          runpane (panes|panels) create, panes adopt --launch, agents start
 *   mcp__pane__agents_start       tool_input.agent / tool_input.toolCommand
 *   mcp__pane__panels_create      (MCP field names are the CLI flags camelCased:
 *                                  --tool-command -> toolCommand)
 *
 * Bash commands are tokenized by a small shell parser (see {@link Parser}) so that text which
 * merely MENTIONS a launch (heredoc bodies, echo/grep/git-commit arguments, comments) is never
 * inspected, while code that executes (`$(...)`, backticks, `bash -c`, `eval`, shells reading
 * stdin) is. Variables, aliases and functions as the command word cannot be resolved statically.
 *
 * Fails closed: unparseable input is denied, and so is an internal error or a pathologically
 * complex command when the call mentions Pane.
 *
 * Invoked through check-pane-launch.sh, which denies Pane calls when bun is missing.
 */

/** Hook stdin, reduced to the fields this guard reads. */
export interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/** A deny verdict with the reason shown to Claude. */
export interface Decision {
  reason: string;
}

/** Deny reason for the Bash/CLI form: flag syntax. */
export const MSG_CLI = String.raw`Pane Claude launches must not use the bare --agent claude template (it runs claude --dangerously-skip-permissions and disables permission prompts). Launch with: --agent claude --tool-command 'claude --model sonnet --effort medium --session-id "$(uuidgen)"' (pick model/effort per task, see /runpane-utils:determine-model and /runpane-utils:determine-effort). Keep --agent claude alongside --tool-command so Pane still treats the panel as Claude Code. Note: {sessionId} is NOT expanded by --tool-command; use $(uuidgen), which the Pane shell evaluates.`;

/** Deny reason for the mcp__pane__* form: exact camelCase params, since the CLI flag syntax does not map 1:1. */
export const MSG_MCP = String.raw`Pane Claude launches must not use the bare agent: "claude" template (it runs claude --dangerously-skip-permissions and disables permission prompts). Pass BOTH params, camelCase, exactly: agent: "claude", toolCommand: "claude --model sonnet --effort medium --session-id \"$(uuidgen)\"" (pick model/effort per task, see /runpane-utils:determine-model and /runpane-utils:determine-effort). Also pass yes: true (JSON boolean, not the string "true"). New Pane (agents_start): {repo: "<id or name from mcp__pane__repos_list>", name: "<kebab-name>", agent: "claude", toolCommand: "claude --model sonnet --effort medium --session-id \"$(uuidgen)\"", yes: true, prompt: "<task>"}. Agent tab in an existing Pane: use pane: "<pane-id>" instead of repo and name. Param names are camelCase (toolCommand, baseBranch), never tool-command. {sessionId} is NOT expanded by toolCommand; use $(uuidgen), which the Pane shell evaluates.`;

const MSG_COMPLEX = 'runpane-utils guard could not fully analyze this command (too deeply nested or too large); simplify it or split it into several calls.';
const MSG_PARSE = 'runpane-utils guard could not parse the hook input; blocking the call.';

/** Upper bound on tokenizer steps per call; exceeding it denies instead of hanging. */
const WORK_LIMIT = 500_000;
/** Upper bound on nested eval / `bash -c` / substitution scans. */
const MAX_DEPTH = 40;

/** Commands whose arguments are data: a `runpane` word after them is a mention, not a launch. */
const MENTION_COMMANDS = new Set([
  'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'git', 'gh', 'cat', 'jq', 'sed', 'awk',
  'head', 'tail', 'less', 'more', 'ls', 'cd', 'wc', 'sort', 'uniq', 'diff', 'cp', 'mv', 'rm', 'mkdir',
  'touch', 'tee', 'tr', 'cut', 'which', 'type', 'whereis', 'man', 'test', '[', '[[', 'read', 'true',
  'false', 'export', 'unset', 'set', 'alias', 'hash', 'tree', 'stat', 'file', 'basename', 'dirname',
  'realpath', 'readlink', 'pwd', 'date', 'sleep', 'mktemp', 'chmod', 'chown', 'ln', 'tar', 'curl', 'wget',
]);

/** Shells whose `-c` operand, or stdin, is executed as a script. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);

/** Reserved words that can precede the command word. */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', '}']);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/** Thrown when a command executes an unsafe Claude launch. */
class LaunchDenied extends Error {}
// A LaunchDenied with a message overrides the default tool-aware deny reason.
/** Thrown when a command exceeds the analysis budget. */
class TooComplex extends Error {}

/** @returns the last path component of a word (`/usr/bin/runpane` -> `runpane`). */
const baseName = (word: string): string => word.slice(word.lastIndexOf('/') + 1);

/** Single-quotes a word unless it is plain, so a rejoined command tokenizes back into the same words. */
const shellQuote = (word: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;

/** Strips quotes and backslashes so quote-split spellings (`--dangerously-skip"-"permissions`) compare equal. */
const norm = (s: string): string => s.replace(/["'\\]/g, '');

/**
 * Expands the static brace groups of a word (`{runpane,}` -> `runpane`, ``), capped at 64 results.
 * @param word A shell word after quote removal.
 */
function expandBraces(word: string): string[] {
  let out = [word];
  for (let i = 0; i < 6; i++) {
    const next: string[] = [];
    let changed = false;
    for (const w of out) {
      const m = /\{([^{}]*,[^{}]*)\}/.exec(w);
      if (!m) {
        next.push(w);
        continue;
      }
      changed = true;
      for (const alt of m[1].split(',')) next.push(w.slice(0, m.index) + alt + w.slice(m.index + m[0].length));
    }
    out = next.slice(0, 64);
    if (!changed) break;
  }
  return out;
}

/** @returns true when the word names the runpane binary (path-qualified, brace-expanded, or zsh `=runpane`). */
function isRunpane(word: string): boolean {
  const w = word.startsWith('=') ? word.slice(1) : word;
  return expandBraces(w).some((x) => baseName(x) === 'runpane');
}

/**
 * Decodes the body of a `$'...'` string (\n, \xHH, \NNN, \uHHHH, ...).
 * @param raw Text between the quotes, escapes intact.
 */
function decodeAnsiC(raw: string): string {
  return raw.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/gs, (_m, e: string) => {
    switch (e[0]) {
      case 'x': case 'u': case 'U': return String.fromCodePoint(parseInt(e.slice(1), 16));
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'e': case 'E': return '\x1b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'v': return '\v';
      case 'c': return e.length > 1 ? String.fromCharCode(e.charCodeAt(1) & 0x1f) : 'c';
      default:
        return /[0-7]/.test(e[0]) ? String.fromCharCode(parseInt(e, 8) & 0xff) : e;
    }
  });
}

/**
 * Applies the launch policy to a Claude launch.
 * @param agent Value of `--agent` / `agent` ('' when absent).
 * @param toolCommand Value of `--tool-command` / `toolCommand` ('' when absent).
 * @throws LaunchDenied for a Claude launch without an explicit session id, or with a permission bypass.
 */
export function checkLaunch(agent: string, toolCommand: string, mcp = false): void {
  const tc = norm(toolCommand);
  // `claude` as a command word anywhere, so wrappers like `env FOO=1 claude` or /usr/bin/claude count.
  const isClaude = agent.toLowerCase() === 'claude' || /(^|[^A-Za-z0-9_.-])claude([^A-Za-z0-9_-]|$)/.test(tc);
  if (!isClaude) return;
  if (!tc) throw new LaunchDenied();
  if (tc.includes('--dangerously-skip-permissions')) throw new LaunchDenied();
  if (!tc.includes('--session-id')) throw new LaunchDenied();
  checkRouting(tc, mcp);
}

/**
 * Requires both `--model` and `--effort` in a Claude tool command (`--flag=value` counts).
 * @param tc Quote-stripped tool command of a Claude launch.
 * @param mcp True for the mcp__pane__* tools, which get the camelCase example.
 * @throws LaunchDenied naming the missing flag(s) and the determine-model / determine-effort skills.
 */
function checkRouting(tc: string, mcp: boolean): void {
  const missing = [/--model(\s|=|$)/.test(tc) ? '' : '--model', /--effort(\s|=|$)/.test(tc) ? '' : '--effort'].filter(Boolean);
  if (!missing.length) return;
  const example = mcp
    ? String.raw`toolCommand: "claude --model sonnet --effort medium --session-id \"$(uuidgen)\""`
    : String.raw`--tool-command 'claude --model sonnet --effort medium --session-id "$(uuidgen)"'`;
  throw new LaunchDenied(
    `Pane Claude launches must carry both --model and --effort inside the tool command; missing: ${missing.join(' ')}. Choose them per task: consult the skills /runpane-utils:determine-model and /runpane-utils:determine-effort (fallback: Read references/model-routing.md and references/effort-levels.md in the runpane-utils plugin). A model or effort the user named explicitly always wins. Safe fallback if unsure: ${example}. Keep --session-id; --dangerously-skip-permissions stays forbidden.`,
  );
}

/**
 * Validates one runpane invocation.
 * @param words The runpane word followed by its arguments (quotes already removed by the tokenizer).
 * @throws LaunchDenied for an unsafe Claude launch.
 */
export function validateLaunch(words: string[]): void {
  const args = words.slice(1).map(norm);
  const joined = args.join(' ').replace(/\n/g, ' ');
  if (!/((panes|panels)\s+create|panes\s+adopt|agents\s+start)/.test(joined)) return;
  // `panes adopt` only launches an agent with --launch.
  if (/panes\s+adopt/.test(joined) && !/--launch/.test(joined)) return;
  let agent = '';
  const toolCommands: string[] = [];
  args.forEach((a, i) => {
    if (a === '--agent' && args[i + 1]?.toLowerCase() === 'claude') agent = 'claude';
    else if (a.toLowerCase() === '--agent=claude') agent = 'claude';
    else if (a === '--tool-command') toolCommands.push(args[i + 1] ?? '');
    else if (a.startsWith('--tool-command=')) toolCommands.push(a.slice('--tool-command='.length));
  });
  if (agent && toolCommands.length === 0) throw new LaunchDenied();
  for (const tc of toolCommands) checkLaunch(agent, tc);
}

/** Owns the analysis budget and the cross-command state shared by every nested {@link Parser}. */
class Scanner {
  private work = 0;
  /** A shell reads stdin, or an executed substitution feeds a script: rescan captured text as scripts. */
  needRescan = false;
  /** False while rescanning: text that feeds a shell is executed even after `echo`. */
  mentionSkip = true;
  /** Every simple command, word and heredoc/here-string body seen, for the rescan. */
  strings: string[] = [];
  private scanned = new Set<string>();

  /** Charges one tokenizer step. @throws TooComplex when the budget is spent. */
  tick(): void {
    if (++this.work > WORK_LIMIT) throw new TooComplex();
  }

  /** Tokenizes `src` as a script, validating every simple command found. */
  scan(src: string, depth = 0): void {
    if (depth > MAX_DEPTH) throw new TooComplex();
    new Parser(this, src, depth).parseList('top');
  }

  /** Scans a whole Bash command, then rescans captured text if something executes it. */
  run(command: string): void {
    this.scanned.add(command);
    this.scan(command);
    for (let round = 0; round < 4 && this.needRescan; round++) {
      this.needRescan = false;
      this.mentionSkip = false;
      for (const s of [...this.strings]) {
        if (this.scanned.has(s)) continue;
        this.scanned.add(s);
        this.scan(s, 1);
      }
    }
  }

  /** Flags a script argument whose text comes from a substitution, since heredoc bodies inside it execute. */
  private noteSubstitution(script: string): void {
    if (/\$\(|`|<\(/.test(script)) this.needRescan = true;
  }

  /**
   * Inspects one simple command: validates any runpane word, and follows shells, eval, `env -S`,
   * `watch`, `su -c` into the script they execute.
   * @param w The command's words (redirections already removed).
   * @param depth Current nesting depth.
   */
  checkWords(w: string[], depth: number): void {
    let p = 0;
    while (p < w.length && (KEYWORDS.has(w[p]) || ASSIGNMENT.test(w[p]))) p++;
    if (p >= w.length) return;
    const cw = baseName(w[p]);
    if (this.mentionSkip && MENTION_COMMANDS.has(cw)) return;
    // The command word itself is produced by a substitution: its output runs.
    if (/^(\$\(|`|<\()/.test(w[p])) this.needRescan = true;
    for (let q = p; q < w.length; q++) {
      if (isRunpane(w[q])) validateLaunch(w.slice(q));
    }
    if (cw === 'command' && /^-[vV]/.test(w[p + 1] ?? '')) return;
    this.followScripts(w, p, cw, depth);
  }

  private followScripts(w: string[], p: number, cw: string, depth: number): void {
    const run = (script: string): void => {
      this.noteSubstitution(script);
      this.scan(script, depth + 1);
    };
    if (cw === 'watch') {
      for (let q = p + 1; q < w.length; q++) if (/\s/.test(w[q])) run(w[q]);
    }
    if (cw === 'env') {
      for (let q = p + 1; q < w.length; q++) {
        if (w[q] === '-S' || w[q] === '--split-string') run(w[q + 1] ?? '');
        else if (/^-S./.test(w[q])) run(w[q].slice(2));
        else if (w[q].startsWith('--split-string=')) run(w[q].slice('--split-string='.length));
      }
    }
    if (cw === 'su') {
      for (let q = p + 1; q < w.length; q++) if (w[q] === '-c' || w[q] === '--command') run(w[q + 1] ?? '');
    }
    for (let q = p; q < w.length; q++) {
      const b = baseName(w[q]);
      if (b === 'eval') {
        run(w.slice(q + 1).join(' '));
        return;
      }
      if (SHELLS.has(b)) {
        this.followShell(w, q, run);
        return;
      }
      if (b === 'source' || b === '.') {
        const operand = w[q + 1];
        if (operand === '/dev/stdin' || operand?.startsWith('<(')) this.needRescan = true;
        return;
      }
    }
  }

  /** `sh -c 'script'` scans the script; a shell with no script file reads stdin, so captured text is rescanned. */
  private followShell(w: string[], q: number, run: (script: string) => void): void {
    for (let r = q + 1; r < w.length; r++) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(w[r])) {
        run(w[r + 1] === '--' ? (w[r + 2] ?? '') : (w[r + 1] ?? ''));
        return;
      }
    }
    let hasFile = false;
    let stdin = false;
    for (let r = q + 1; r < w.length; r++) {
      const a = w[r];
      if (a === '-s' || a === '-' || a === '/dev/stdin' || a.startsWith('<(')) stdin = true;
      else if (!a.startsWith('-')) hasFile = true;
    }
    if (stdin || !hasFile) this.needRescan = true;
  }
}

/** A heredoc whose body starts at the next newline. */
interface PendingHeredoc {
  delimiter: string;
  /** Quoted delimiter: the body is literal, nothing in it expands. */
  quoted: boolean;
  /** `<<-`: leading tabs are stripped before comparing against the delimiter. */
  stripTabs: boolean;
}

/**
 * Tokenizer over one script. Walks the text respecting quotes, comments, redirections, heredocs,
 * `$(...)`, backticks and arithmetic, and hands each finished simple command to the Scanner.
 * Command substitutions and backticks are parsed in place, so their contents are validated too.
 */
class Parser {
  pos = 0;

  constructor(private sc: Scanner, private s: string, private depth: number) {}

  /**
   * Tokenizes from `pos`. `paren` mode returns after the `)` closing a `$(...)`.
   * @param mode `top` for a whole script, `paren` for the inside of `$(...)` / `<(...)`.
   */
  parseList(mode: 'top' | 'paren'): void {
    const { s, sc } = this;
    let cur = '';
    let inWord = false;
    let hereString = false; // next word is a here-string: stdin text, kept for the rescan
    let redirTarget = false; // next word is a redirection target: not an argument
    let parenDepth = 0;
    let caseDepth = 0; // inside `case ... esac`, a `)` ends a pattern rather than the substitution
    let words: string[] = [];
    const pending: PendingHeredoc[] = [];

    const endWord = (): void => {
      if (!inWord) return;
      if (hereString) sc.strings.push(cur);
      else if (!redirTarget) words.push(cur);
      hereString = false;
      redirTarget = false;
      cur = '';
      inWord = false;
    };
    const endCmd = (): void => {
      endWord();
      redirTarget = false;
      if (!words.length) return;
      if (words[0] === 'case') caseDepth++;
      else if (words[0] === 'esac') caseDepth--;
      sc.strings.push(words.map(shellQuote).join(' '), ...words);
      const done = words;
      words = [];
      sc.checkWords(done, this.depth);
    };

    while (this.pos < s.length) {
      sc.tick();
      const c = s[this.pos];
      switch (c) {
        case ' ': case '\t':
          endWord();
          this.pos++;
          break;
        case '\n':
          endCmd();
          this.pos++;
          this.readHeredocs(pending);
          break;
        case ';': case '|':
          endCmd();
          this.pos++;
          break;
        case '&':
          if (s[this.pos + 1] === '>') { // &> and &>> redirect both streams
            endWord();
            this.pos += s[this.pos + 2] === '>' ? 3 : 2;
            redirTarget = true;
          } else {
            endCmd();
            this.pos++;
          }
          break;
        case '(': {
          if (!inWord && words.length === 0 && s[this.pos + 1] === '(') {
            const end = this.arithmeticEnd(this.pos);
            if (end !== null) { // ((...)) is arithmetic: opaque
              this.pos = end;
              break;
            }
          }
          endCmd();
          parenDepth++;
          this.pos++;
          break;
        }
        case ')':
          endCmd();
          this.pos++;
          if (parenDepth > 0) parenDepth--;
          else if (caseDepth > 0) { /* end of a case pattern */ }
          else if (mode === 'paren') return;
          break;
        case '`':
          cur += this.backtick();
          inWord = true;
          break;
        case '#':
          if (inWord) {
            cur += c;
            this.pos++;
          } else {
            const nl = s.indexOf('\n', this.pos);
            this.pos = nl < 0 ? s.length : nl;
          }
          break;
        case "'": {
          const close = s.indexOf("'", this.pos + 1);
          cur += s.slice(this.pos + 1, close < 0 ? s.length : close);
          this.pos = close < 0 ? s.length : close + 1;
          inWord = true;
          break;
        }
        case '"':
          this.pos++;
          cur += this.readDoubleQuoted(true);
          inWord = true;
          break;
        case '\\': {
          const next = s[this.pos + 1];
          this.pos += 2;
          if (next !== undefined && next !== '\n') {
            cur += next;
            inWord = true;
          }
          break;
        }
        case '$':
          cur += this.readDollar(false);
          inWord = true;
          break;
        case '<': case '>': {
          // A bare number before the operator is a file descriptor (2>&1), not an argument.
          if (inWord && /^[0-9]+$/.test(cur)) { cur = ''; inWord = false; } else endWord();
          const two = s.slice(this.pos, this.pos + 2);
          if (s.startsWith('<<<', this.pos)) {
            hereString = true;
            this.pos += 3;
          } else if (two === '<<') {
            this.pos += 2;
            this.readHeredocOperator(pending);
          } else if (two === '<(' || two === '>(') { // process substitution: an argument whose inside runs
            const start = this.pos;
            this.pos += 2;
            this.parseList('paren');
            cur += s.slice(start, this.pos);
            inWord = true;
          } else {
            this.pos += ['>>', '>&', '>|', '<&', '<>'].includes(two) ? 2 : 1;
            redirTarget = true;
          }
          break;
        }
        default:
          cur += c;
          inWord = true;
          this.pos++;
      }
    }
    endCmd();
  }

  /** Reads inside "..." (`untilQuote`) or an unquoted heredoc body, recursing into `$(...)` and backticks. */
  readDoubleQuoted(untilQuote: boolean): string {
    const { s } = this;
    let out = '';
    while (this.pos < s.length) {
      this.sc.tick();
      const c = s[this.pos];
      if (c === '"') {
        this.pos++;
        if (untilQuote) return out;
        out += c;
      } else if (c === '\\') {
        const next = s[this.pos + 1];
        this.pos += 2;
        if (next === '$' || next === '`' || next === '"' || next === '\\') out += next;
        else if (next !== '\n') out += `\\${next ?? ''}`;
      } else if (c === '$') {
        out += this.readDollar(true);
      } else if (c === '`') {
        out += this.backtick();
      } else {
        out += c;
        this.pos++;
      }
    }
    return out;
  }

  /** Reads a `$...` construct at `pos`; returns the text it contributes to the current word. */
  private readDollar(inDoubleQuotes: boolean): string {
    const { s } = this;
    const start = this.pos;
    const next = s[start + 1];
    if (next === '(') {
      if (s[start + 2] === '(') {
        const end = this.arithmeticEnd(start + 1);
        if (end !== null) {
          this.pos = end;
          return s.slice(start, end);
        }
      }
      this.pos += 2;
      this.parseList('paren');
      return s.slice(start, this.pos);
    }
    if (!inDoubleQuotes && next === "'") { // $'...' ANSI-C quoting
      let i = start + 2;
      while (i < s.length && s[i] !== "'") i += s[i] === '\\' ? 2 : 1;
      this.pos = Math.min(i + 1, s.length);
      return decodeAnsiC(s.slice(start + 2, i));
    }
    if (!inDoubleQuotes && next === '"') { // $"..." locale quoting
      this.pos += 2;
      return this.readDoubleQuoted(true);
    }
    if (next === '{') return this.readParameterExpansion();
    this.pos++;
    return '$';
  }

  /** Reads `${...}` as one opaque span (a `#` or `<<` inside it is not a comment or heredoc). */
  private readParameterExpansion(): string {
    const { s } = this;
    const start = this.pos;
    this.pos += 2;
    let depth = 1;
    while (this.pos < s.length && depth > 0) {
      this.sc.tick();
      const c = s[this.pos];
      if (c === '\\') this.pos += 2;
      else if (c === "'") {
        const close = s.indexOf("'", this.pos + 1);
        this.pos = close < 0 ? s.length : close + 1;
      } else if (c === '"') {
        this.pos++;
        this.readDoubleQuoted(true);
      } else if (c === '`') this.backtick();
      else if (c === '$' && s[this.pos + 1] === '(') this.readDollar(false);
      else if (c === '$' && s[this.pos + 1] === '{') { depth++; this.pos += 2; }
      else {
        if (c === '}') depth--;
        this.pos++;
      }
    }
    return s.slice(start, this.pos);
  }

  /** Reads a backtick substitution at `pos`, scans its (unescaped) contents, returns the raw text. */
  private backtick(): string {
    const { s } = this;
    const start = this.pos;
    let i = start + 1;
    while (i < s.length && s[i] !== '`') i += s[i] === '\\' ? 2 : 1;
    const end = Math.min(i, s.length);
    this.pos = Math.min(i + 1, s.length);
    this.sc.scan(s.slice(start + 1, end).replace(/\\([`\\$])/g, '$1'), this.depth + 1);
    return s.slice(start, this.pos);
  }

  /** @returns the index after the `))` matching the `((` at `from`, or null when it is not arithmetic. */
  private arithmeticEnd(from: number): number | null {
    const { s } = this;
    let d = 0;
    for (let i = from; i < s.length; i++) {
      this.sc.tick();
      if (s[i] === '(') d++;
      else if (s[i] === ')') {
        d--;
        if (d === 0) return s[i - 1] === ')' ? i + 1 : null;
      }
    }
    return null;
  }

  /** After `<<` / `<<-`: reads the delimiter word and queues the heredoc. */
  private readHeredocOperator(pending: PendingHeredoc[]): void {
    const { s } = this;
    let stripTabs = false;
    let quoted = false;
    let delimiter = '';
    if (s[this.pos] === '-') {
      stripTabs = true;
      this.pos++;
    }
    while (s[this.pos] === ' ' || s[this.pos] === '\t') this.pos++;
    while (this.pos < s.length) {
      const c = s[this.pos];
      if (' \t\n;&|<>()'.includes(c)) break;
      if (c === "'") {
        quoted = true;
        const close = s.indexOf("'", this.pos + 1);
        delimiter += s.slice(this.pos + 1, close < 0 ? s.length : close);
        this.pos = close < 0 ? s.length : close + 1;
      } else if (c === '"') {
        quoted = true;
        const close = s.indexOf('"', this.pos + 1);
        delimiter += s.slice(this.pos + 1, close < 0 ? s.length : close);
        this.pos = close < 0 ? s.length : close + 1;
      } else if (c === '\\') {
        quoted = true;
        delimiter += s[this.pos + 1] ?? '';
        this.pos += 2;
      } else {
        delimiter += c;
        this.pos++;
      }
    }
    pending.push({ delimiter, quoted, stripTabs });
  }

  /**
   * At a newline: consumes the bodies of queued heredocs. Bodies are skipped, but an unquoted body
   * still has its `$(...)` scanned. An unterminated heredoc is scanned as a script (fail closed).
   */
  private readHeredocs(pending: PendingHeredoc[]): void {
    const { s } = this;
    for (const h of pending) {
      let i = this.pos;
      let body = '';
      let found = false;
      while (i < s.length) {
        this.sc.tick();
        const nl = s.indexOf('\n', i);
        const line = s.slice(i, nl < 0 ? s.length : nl);
        i = nl < 0 ? s.length : nl + 1;
        const compare = h.stripTabs ? line.replace(/^\t+/, '') : line;
        if (compare === h.delimiter) {
          found = true;
          break;
        }
        body += `${line}\n`;
      }
      this.pos = i;
      this.sc.strings.push(body);
      if (!found) this.sc.scan(body, this.depth + 1);
      else if (!h.quoted) new Parser(this.sc, body, this.depth + 1).readDoubleQuoted(false);
    }
    pending.length = 0;
  }
}

/**
 * Validates a Bash command: only simple commands that execute runpane are checked.
 * @throws LaunchDenied for an unsafe Claude launch, TooComplex when the command is too large to analyze.
 */
export function scanCommand(command: string): void {
  new Scanner().run(command);
}

/**
 * Decides whether a tool call may proceed.
 * @param input Parsed PreToolUse stdin.
 * @returns A deny decision, or null to allow.
 */
export function evaluate(input: HookInput): Decision | null {
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  const message = tool.startsWith('mcp__pane__') ? MSG_MCP : MSG_CLI;
  try {
    if (tool === 'Bash') {
      scanCommand(String(ti.command ?? ''));
    } else if (tool === 'mcp__pane__agents_start' || tool === 'mcp__pane__panels_create') {
      checkLaunch(String(ti.agent ?? ''), String(ti.toolCommand ?? ti.tool_command ?? ''), true);
    }
  } catch (e) {
    if (e instanceof LaunchDenied) return { reason: e.message || message };
    if (e instanceof TooComplex) return { reason: MSG_COMPLEX };
    // Unexpected guard bug: block only calls that touch Pane, so unrelated tools are unaffected.
    if (/runpane|mcp__pane__/.test(JSON.stringify(input))) {
      return { reason: `runpane-utils guard hit an internal error (${String(e)}); blocking the call.` };
    }
  }
  return null;
}

/** Prints a PreToolUse deny decision to stdout. */
function emitDeny(reason: string): void {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

if (import.meta.main) {
  let input: HookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as HookInput;
  } catch {
    emitDeny(MSG_PARSE);
    process.exit(0);
  }
  const decision = evaluate(input);
  if (decision) emitDeny(decision.reason);
}
