import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, MSG_CLI, MSG_MCP, type HookInput } from './check-pane-launch.ts';

type Verdict = 'allow' | 'deny';

/** Registers a test asserting the hook's verdict for a tool call. */
function verdictCase(name: string, want: Verdict, tool: string, toolInput: Record<string, unknown>): void {
  test(name, () => {
    const got: Verdict = evaluate({ tool_name: tool, tool_input: toolInput } as HookInput) ? 'deny' : 'allow';
    expect(got).toBe(want);
  });
}
const bashCase = (name: string, want: Verdict, command: string): void => verdictCase(name, want, 'Bash', { command });

const GOOD = 'claude --model sonnet --effort medium --session-id "$(uuidgen)"';
const BARE = 'runpane panels create --pane 1 --agent claude --yes';
const L = 'runpane panes create --agent claude';
const GOOD_LAUNCH = `runpane panels create --pane 1 --agent claude --tool-command '${GOOD}' --yes`;

// --- Bash: bare launches and correct forms ---
bashCase('bare --agent claude (panes create)', 'deny', 'runpane panes create --repo active --name x --agent claude --yes');
bashCase('bare --agent claude (panels create)', 'deny', BARE);
bashCase('bare --agent claude (agents start)', 'deny', 'runpane agents start --pane 1 --agent claude --prompt hi --yes');
bashCase('--agent=claude form', 'deny', 'runpane panels create --pane 1 --agent=claude --yes');
bashCase('--agent "claude" quoted', 'deny', 'runpane panels create --pane 1 --agent "claude" --yes');
bashCase('--agent Claude (case-insensitive)', 'deny', 'runpane panels create --pane 1 --agent Claude --yes');
bashCase('tool-command without session-id', 'deny', "runpane panels create --pane 1 --agent claude --tool-command 'claude' --yes");
bashCase('skip-permissions in tool-command', 'deny', "runpane panels create --pane 1 --agent claude --tool-command 'claude --dangerously-skip-permissions --session-id x' --yes");
bashCase('claude tool-command, no --agent, no session-id', 'deny', 'runpane panels create --pane 1 --tool-command claude --yes');
bashCase('session-id only in a later argument, not the tool-command', 'deny', "runpane agents start --pane 1 --agent claude --tool-command claude --prompt '--session-id' --yes");
bashCase('piped / chained bare launch', 'deny', 'cd /x && echo go | runpane panels create --pane 1 --agent claude --yes | jq .');
bashCase('multi-line bare launch', 'deny', 'runpane panels create \\\n  --pane 1 \\\n  --agent claude --yes');
bashCase('correct form', 'allow', GOOD_LAUNCH);
bashCase('correct form, double-quoted', 'allow', 'runpane agents start --pane 1 --agent claude --tool-command "claude --model sonnet --effort medium --session-id \\"\\$(uuidgen)\\"" --prompt hi --yes');
bashCase('correct form, --tool-command= syntax', 'allow', `runpane panes create --repo r --name n --agent=claude --tool-command='${GOOD}' --yes`);
bashCase('correct form, piped', 'allow', `${GOOD_LAUNCH} --json | jq .`);
bashCase('codex agent', 'allow', 'runpane panels create --pane 1 --agent codex --yes');
bashCase('cursor agent', 'allow', 'runpane agents start --pane 1 --agent cursor --prompt hi --yes');
bashCase('non-claude tool-command', 'allow', "runpane panels create --pane 1 --tool-command 'bash' --yes");
bashCase('unrelated runpane command', 'allow', 'runpane panes list --json');
bashCase('unrelated Bash', 'allow', 'ls -la && git status');
bashCase('empty command', 'allow', '');

// --- review-feedback cases ---
bashCase('wrapper: env FOO=1 claude --dangerously-skip-permissions', 'deny', "runpane panels create --pane 1 --tool-command 'env FOO=1 claude --dangerously-skip-permissions' --yes");
bashCase('wrapper: env claude with session id', 'allow', "runpane panels create --pane 1 --tool-command 'env FOO=1 claude --model sonnet --effort medium --session-id abc' --yes");
bashCase('split-quoted skip flag', 'deny', "runpane panels create --pane 1 --agent claude --tool-command 'claude --dangerously-skip\"-\"permissions --session-id x' --yes");
bashCase('adopt without --launch', 'allow', 'runpane panes adopt --repo r --path /p --name n --agent claude --yes');
bashCase('adopt --launch, bare claude', 'deny', 'runpane panes adopt --repo r --path /p --name n --agent claude --launch --yes');
bashCase('adopt --launch, correct form', 'allow', `runpane panes adopt --repo r --path /p --name n --agent claude --tool-command '${GOOD}' --launch --yes`);
bashCase('chained: bare first, good second (;)', 'deny', `${BARE}; runpane panels create --pane 1 --agent claude --tool-command 'claude --model sonnet --effort medium --session-id x' --yes`);
bashCase('chained: bare second (&&)', 'deny', `${GOOD_LAUNCH} && runpane panels create --pane 2 --agent claude --yes`);
bashCase('chained: both good', 'allow', `${GOOD_LAUNCH}; runpane panels create --pane 2 --agent claude --tool-command '${GOOD}' --yes`);

// --- Text that merely MENTIONS a launch is not inspected ---
bashCase('mention: heredoc body', 'allow', `cat <<EOF\n${BARE}\nEOF`);
bashCase('mention: quoted heredoc body', 'allow', `cat <<'EOF'\n${BARE}\nEOF`);
bashCase('mention: <<- heredoc body', 'allow', `cat <<-EOF\n\t${BARE}\n\tEOF`);
bashCase('mention: python heredoc + other cmds', 'allow', `python3 - <<'PY'\ntests = ["${BARE}"]\nfor c in tests:\n    print("runpane agents start --agent claude --tool-command '$c'")\nPY\nls`);
bashCase('mention: echo', 'allow', `echo "${BARE}"`);
bashCase('mention: printf', 'allow', `printf '%s\\n' '${BARE}'`);
bashCase('mention: git commit -m', 'allow', 'git commit -m "fix: stop denying runpane agents start --agent claude"');
bashCase('mention: gh pr create --body heredoc', 'allow', `gh pr create --title t --body "$(cat <<'EOF'\nExample (do not run): ${BARE}\nunbalanced ) paren\nEOF\n)"`);
bashCase('mention: gh pr create unquoted heredoc', 'allow', `gh pr create --body "$(cat <<EOF\nExample: ${BARE}\nEOF\n)"`);
bashCase('mention: comment', 'allow', `ls # ${BARE}`);
bashCase('mention: full-line comment then cmd', 'allow', `# ${BARE}\nls`);
bashCase('mention: grep pattern', 'allow', `grep '${BARE}' file`);
bashCase('mention: git log --grep', 'allow', "git log --grep='runpane agents start --agent claude'");
bashCase('mention: runpane in a path', 'allow', 'cat docs/runpane-notes.md | head');
bashCase('mention: python -c string', 'allow', `python3 -c 'print("${BARE}")'`);
bashCase('mention: cd into a directory named runpane', 'allow', 'cd /x/runpane && ls');
bashCase('mention: ${#var} is not a comment', 'allow', 'x=abc; echo ${#x}');
bashCase('mention: here-string to cat', 'allow', `cat <<< '${BARE}'`);

// --- Executed: must be denied ---
bashCase('exec: plain bare launch', 'deny', BARE);
bashCase('exec: bash -c', 'deny', `bash -c '${BARE}'`);
bashCase('exec: bash -lc', 'deny', `bash -lc "${BARE}"`);
bashCase('exec: sh -c', 'deny', `sh -c '${BARE}'`);
bashCase('exec: eval quoted', 'deny', `eval "${BARE}"`);
bashCase('exec: eval unquoted', 'deny', `eval ${BARE}`);
bashCase('exec: $(...) substitution', 'deny', `echo $(${BARE})`);
bashCase('exec: backticks', 'deny', `echo \`${BARE}\``);
bashCase('exec: $(...) inside double quotes', 'deny', `echo "id: $(${BARE})"`);
bashCase('exec: assignment from $(...)', 'deny', `x=$(${BARE})`);
bashCase('exec: env X=1 prefix', 'deny', `env X=1 ${BARE}`);
bashCase('exec: VAR=val prefix', 'deny', `X=1 ${BARE}`);
bashCase('exec: sudo prefix', 'deny', `sudo ${BARE}`);
bashCase('exec: nohup prefix', 'deny', `nohup ${BARE}`);
bashCase('exec: npx runpane', 'deny', 'npx runpane panels create --pane 1 --agent claude --yes');
bashCase('exec: pnpm dlx runpane', 'deny', 'pnpm dlx runpane panels create --pane 1 --agent claude --yes');
bashCase('exec: xargs runpane', 'deny', `echo 1 | xargs -I{} ${BARE}`);
bashCase('exec: chained echo && launch', 'deny', `echo hi && ${BARE}`);
bashCase('exec: after heredoc terminator', 'deny', `cat <<EOF\nnotes\nEOF\n${BARE}`);
bashCase('exec: after quoted heredoc terminator', 'deny', `cat <<'EOF'\nnotes\nEOF\n${BARE}`);
bashCase('exec: path-qualified runpane', 'deny', '/usr/bin/runpane panels create --pane 1 --agent claude --yes');
bashCase('exec: launch inside unquoted heredoc $()', 'deny', `cat <<EOF\n$(${BARE})\nEOF`);
bashCase('exec: heredoc to bash', 'deny', `bash <<EOF\n${BARE}\nEOF`);
bashCase('exec: cat heredoc | sh', 'deny', `cat <<'EOF' | sh\n${BARE}\nEOF`);
bashCase('exec: echo | bash', 'deny', `echo '${BARE}' | bash`);
bashCase('exec: here-string to bash', 'deny', `bash <<< '${BARE}'`);
bashCase('exec: subshell', 'deny', `( ${BARE} )`);
bashCase('exec: for loop body', 'deny', `for p in 1 2; do ${BARE}; done`);
bashCase('exec: if condition', 'deny', `if ${BARE}; then ls; fi`);
bashCase('exec: unterminated heredoc (fail closed)', 'deny', `cat <<EOF\n${BARE}`);
bashCase('exec: quote-split command word', 'deny', 'ru""npane panels create --pane 1 --agent claude --yes');
bashCase('exec: backslash command word', 'deny', '\\runpane panels create --pane 1 --agent claude --yes');
bashCase('exec: launch after a comment line', 'deny', `# note\n${BARE}`);
bashCase('exec: launch after # inside word', 'deny', `echo a#b; ${BARE}`);
bashCase('exec: redirect then launch', 'deny', `ls > /dev/null 2>&1; ${BARE}`);

// --- Executed but correct: allowed ---
bashCase('exec ok: bash -c, correct form', 'allow', String.raw`bash -c "runpane panels create --pane 1 --agent claude --tool-command 'claude --model sonnet --effort medium --session-id \"\$(uuidgen)\"' --yes"`);
bashCase('exec ok: env prefix, correct form', 'allow', `env X=1 ${GOOD_LAUNCH}`);
bashCase('exec ok: $(...) correct form', 'allow', `id=$(${GOOD_LAUNCH} --json)`);
bashCase('exec ok: heredoc mention + correct launch', 'allow', `cat <<EOF\n${BARE}\nEOF\n${GOOD_LAUNCH}`);

// --- Evasions found by adversarial review ---
bashCase('redirect after bash: echo | bash 2>&1', 'deny', `echo '${L}' | bash 2>&1`);
bashCase('redirect after bash: heredoc with 2>/dev/null', 'deny', `bash 2>/dev/null <<'EOF'\n${L}\nEOF`);
bashCase('redirect after bash: fd-prefixed heredoc', 'deny', `bash 0<<'EOF'\n${L}\nEOF`);
bashCase('redirect after bash: >log heredoc', 'deny', `bash >log <<EOF\n${L}\nEOF`);
bashCase('leading redirect: >/dev/null', 'deny', `>/dev/null ${L}`);
bashCase('leading redirect: </dev/null', 'deny', `</dev/null ${L}`);
bashCase('leading redirect: 2>&1', 'deny', `2>&1 ${L}`);
bashCase('redirect mid-command: 2>&1 before flags', 'deny', 'runpane panes create 2>&1 --agent claude');
bashCase('redirect mid-command: &>/dev/null before flags', 'deny', 'runpane panes create &>/dev/null --agent claude');
bashCase('redirect mid-command: >(cat) before flags', 'deny', 'runpane panes create >(cat) --agent claude');
bashCase('unquoted echo | bash', 'deny', `echo ${L} | bash`);
bashCase('bash -c "$(cat <<EOF)"', 'deny', `bash -c "$(cat <<'EOF'\n${L}\nEOF\n)"`);
bashCase('eval "$(cat <<EOF)"', 'deny', `eval "$(cat <<'EOF'\n${L}\nEOF\n)"`);
bashCase('$(cat <<EOF) as command word', 'deny', `$(cat <<'EOF'\n${L}\nEOF\n)`);
bashCase("$'runpane' command word", 'deny', `$'runpane' panes create --agent claude`);
bashCase("$''runpane command word", 'deny', `$''runpane panes create --agent claude`);
bashCase('$"runpane" command word', 'deny', `$"runpane" panes create --agent claude`);
bashCase("--agent $'claude'", 'deny', `runpane panes create --agent $'claude'`);
bashCase("ANSI-C hex escapes: $'run\\x70ane'", 'deny', `$'run\\x70ane' panes create --agent claude`);
bashCase('time -p', 'deny', `time -p ${L}`);
bashCase('/usr/bin/time', 'deny', `/usr/bin/time ${L}`);
bashCase('coproc', 'deny', `coproc ${L}`);
bashCase('function definition then call', 'deny', `function f { ${L}; }; f`);
bashCase('find -exec', 'deny', `find . -exec ${L} \\;`);
bashCase('watch with a string', 'deny', `watch '${L}'`);
bashCase("env -S 'script'", 'deny', `env -S '${L}'`);
bashCase('su -c', 'deny', `su -c '${L}' user`);
bashCase('case pattern inside $()', 'deny', `echo "$(case a in a) ${L};; esac)"`);
bashCase('case pattern inside unquoted heredoc $()', 'deny', `cat <<EOF\n$(case a in a) ${L};; esac)\nEOF`);
bashCase('<< inside (( )) is arithmetic, not a heredoc', 'deny', `((x=1<<y))\n${L}\ny`);
bashCase('<< inside $(( )) is arithmetic, not a heredoc', 'deny', `echo $((1<<2))\n${L}\n2`);
bashCase('# after a space inside ${...}', 'deny', `echo \${x:- #}; ${L}`);
bashCase('nested escaped backticks', 'deny', `echo \`echo \\\`${L}\\\`\``);
bashCase('bash -c -- script', 'deny', `bash -c -- '${L}'`);
bashCase('bash <(echo ...)', 'deny', `bash <(echo '${L}')`);
bashCase('bash < <(echo ...)', 'deny', `bash < <(echo '${L}')`);
bashCase('source <(echo ...)', 'deny', `source <(echo '${L}')`);
bashCase('source /dev/stdin <<<', 'deny', `source /dev/stdin <<<'${L}'`);
bashCase('nested stdin shells', 'deny', `bash <<'A'\nbash <<'B'\n${L}\nB\nA`);
bashCase("echo 'echo L | bash' | bash", 'deny', `echo 'echo "${L}" | bash' | bash`);
bashCase('brace expansion {runpane,}', 'deny', `{runpane,} panes create --agent claude`);
bashCase('zsh =runpane', 'deny', `=runpane panes create --agent claude`);
bashCase('zsh noglob', 'deny', `noglob ${L}`);
bashCase('zsh nocorrect', 'deny', `nocorrect ${L}`);
bashCase('zsh repeat', 'deny', `repeat 1 ${L}`);
bashCase('fish -c', 'deny', `fish -c '${L}'`);

// --- Review-found false positives that must stay allowed ---
bashCase('command -v bash is not a stdin shell', 'allow', `command -v bash && git commit -m '${L}'`);
bashCase('bash script.sh with a mention elsewhere', 'allow', `bash script.sh; echo "${L}"`);
bashCase('bash with a file operand and redirect', 'allow', `bash script.sh 2>&1; echo "${L}"`);

// --- Budget: pathological nesting is denied (fail closed), not hung ---
test('eval chain is denied by the work budget, quickly', () => {
  const t0 = Date.now();
  const verdict = evaluate({ tool_name: 'Bash', tool_input: { command: `${'eval '.repeat(800)}${L}` } });
  expect(verdict).not.toBeNull();
  expect(Date.now() - t0).toBeLessThan(5000);
});
test('command eval chain is denied by the work budget, quickly', () => {
  const t0 = Date.now();
  const verdict = evaluate({ tool_name: 'Bash', tool_input: { command: `${'command eval '.repeat(18)}true; ${L}` } });
  expect(verdict).not.toBeNull();
  expect(Date.now() - t0).toBeLessThan(5000);
});
test('26KB ordinary command is analyzed quickly and allowed', () => {
  const t0 = Date.now();
  const verdict = evaluate({ tool_name: 'Bash', tool_input: { command: Array.from({ length: 1500 }, (_, i) => `echo "line ${i}"`).join('; ') } });
  expect(verdict).toBeNull();
  expect(Date.now() - t0).toBeLessThan(2000);
});

// --- MCP: mcp__pane__agents_start / mcp__pane__panels_create ---
for (const t of ['mcp__pane__agents_start', 'mcp__pane__panels_create']) {
  verdictCase(`${t} claude, no toolCommand`, 'deny', t, { agent: 'claude', pane: '1' });
  verdictCase(`${t} claude, toolCommand w/o session`, 'deny', t, { agent: 'claude', toolCommand: 'claude' });
  verdictCase(`${t} claude, skip-permissions`, 'deny', t, { agent: 'claude', toolCommand: 'claude --dangerously-skip-permissions --session-id x' });
  verdictCase(`${t} claude, toolCommand w/ session`, 'allow', t, { agent: 'claude', toolCommand: GOOD });
  verdictCase(`${t} codex, no toolCommand`, 'allow', t, { agent: 'codex', pane: '1' });
  verdictCase(`${t} no agent, non-claude toolCommand`, 'allow', t, { toolCommand: 'bash' });
}
verdictCase('other pane MCP tool', 'allow', 'mcp__pane__panes_list', { agent: 'claude' });
verdictCase('unrelated tool', 'allow', 'Read', { file_path: '/x' });

// --- Model/effort routing flags are allowed; unsafe flags still denied ---
const ROUTED = 'claude --model opus --effort high --session-id "$(uuidgen)"';
bashCase('routed: --model/--effort + session-id', 'allow', `runpane agents start --pane 1 --agent claude --tool-command '${ROUTED}' --prompt hi --yes`);
bashCase('routed: --effort ultracode', 'allow', "runpane agents start --pane 1 --agent claude --tool-command 'claude --model fable --effort ultracode --session-id x' --prompt hi --yes");
bashCase('routed: --model haiku --effort medium', 'allow', "runpane panels create --pane 1 --agent claude --tool-command 'claude --model haiku --effort medium --session-id x' --yes");
bashCase('routed: no session-id', 'deny', "runpane panels create --pane 1 --agent claude --tool-command 'claude --model opus --effort high' --yes");
bashCase('routed: skip-permissions alongside --model', 'deny', "runpane panels create --pane 1 --agent claude --tool-command 'claude --model opus --effort high --dangerously-skip-permissions --session-id x' --yes");
for (const t of ['mcp__pane__agents_start', 'mcp__pane__panels_create']) {
  verdictCase(`${t} routed toolCommand`, 'allow', t, { agent: 'claude', toolCommand: ROUTED });
  verdictCase(`${t} routed ultracode`, 'allow', t, { agent: 'claude', toolCommand: 'claude --model opus --effort ultracode --session-id x' });
  verdictCase(`${t} routed, skip-permissions`, 'deny', t, { agent: 'claude', toolCommand: 'claude --model opus --effort high --dangerously-skip-permissions --session-id x' });
  verdictCase(`${t} routed, no session-id`, 'deny', t, { agent: 'claude', toolCommand: 'claude --model opus --effort high' });
}

// --- Deny message is tool-aware ---
const MCP_TC = 'toolCommand: "claude --model sonnet --effort medium --session-id \\"$(uuidgen)\\""';
for (const t of ['mcp__pane__agents_start', 'mcp__pane__panels_create']) {
  const reason = evaluate({ tool_name: t, tool_input: { agent: 'claude' } })?.reason ?? '';
  test(`${t} msg shows agent param`, () => expect(reason).toContain('agent: "claude"'));
  test(`${t} msg shows toolCommand param`, () => expect(reason).toContain(MCP_TC));
  test(`${t} msg says yes: true boolean`, () => expect(reason).toContain('yes: true'));
  test(`${t} msg says camelCase`, () => expect(reason).toContain('camelCase'));
  test(`${t} msg is not CLI flag form`, () => expect(reason).not.toContain("--tool-command '"));
  test(`${t} msg is MSG_MCP`, () => expect(reason).toBe(MSG_MCP));
}
test('Bash msg shows CLI flag form', () => {
  const reason = evaluate({ tool_name: 'Bash', tool_input: { command: BARE } })?.reason ?? '';
  expect(reason).toBe(MSG_CLI);
  expect(reason).toContain(`--tool-command 'claude --model sonnet --effort medium --session-id`);
  expect(reason).not.toContain('toolCommand');
});

// --- Shim (check-pane-launch.sh): fail closed without bun, delegate to bun otherwise ---
const SHIM = join(import.meta.dir, 'check-pane-launch.sh');

/** Runs the shim with the given stdin; `PATH` is replaced when `path` is given. */
function runShim(stdin: string, path?: string): { stdout: string; status: number } {
  const r = Bun.spawnSync(['bash', SHIM], { stdin: new TextEncoder().encode(stdin), env: { ...process.env, ...(path ? { PATH: path } : {}) } });
  return { stdout: r.stdout.toString(), status: r.exitCode };
}
const payload = (command: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

test('shim end-to-end with bun: bare launch denied, correct form and mention allowed', () => {
  expect(runShim(payload(BARE)).stdout).toContain('"permissionDecision":"deny"');
  expect(runShim(payload(GOOD_LAUNCH)).stdout).toBe('');
  expect(runShim(payload(`echo "${BARE}"`)).stdout).toBe('');
});
test('shim: unparseable input is denied', () => {
  expect(runShim('not json').stdout).toContain('could not parse');
});
test('shim without bun on PATH: Pane calls denied, unrelated calls allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nobun-'));
  try {
    for (const b of ['bash', 'grep', 'cat']) {
      const real = Bun.which(b);
      if (real) symlinkSync(real, join(dir, b));
    }
    chmodSync(dir, 0o755);
    const pane = runShim(payload('runpane panels create --agent claude'), dir);
    expect(pane.stdout).toContain('"permissionDecision":"deny"');
    expect(pane.stdout).toContain('bun');
    expect(runShim(JSON.stringify({ tool_name: 'mcp__pane__agents_start', tool_input: {} }), dir).stdout).toContain('"deny"');
    expect(runShim(payload('ls'), dir).stdout).toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Model/effort enforcement: both --model and --effort are required (#18) ---
const ONLY_MODEL = 'claude --model opus --session-id x';
const ONLY_EFFORT = 'claude --effort high --session-id x';
const NEITHER = 'claude --session-id "$(uuidgen)"';
const launchWith = (verb: string, tc: string, extra = ''): string => `runpane ${verb} --pane 1 --agent claude --tool-command '${tc}' ${extra}--yes`;
bashCase('enforce: only --model', 'deny', launchWith('agents start', ONLY_MODEL, '--prompt hi '));
bashCase('enforce: only --effort', 'deny', launchWith('agents start', ONLY_EFFORT, '--prompt hi '));
bashCase('enforce: neither flag', 'deny', launchWith('agents start', NEITHER, '--prompt hi '));
bashCase('enforce: neither, panels create', 'deny', launchWith('panels create', NEITHER));
bashCase('enforce: neither, wrapper command', 'deny', "runpane panels create --pane 1 --tool-command 'env FOO=1 claude --session-id x' --yes");
bashCase('enforce: neither, adopt --launch', 'deny', `runpane panes adopt --repo r --path /p --name n --agent claude --tool-command '${NEITHER}' --launch --yes`);
bashCase('enforce: adopt without --launch', 'allow', 'runpane panes adopt --repo r --path /p --name n --agent claude --yes');
bashCase('enforce: second chained launch unrouted', 'deny', `${GOOD_LAUNCH} && ${launchWith('panels create', NEITHER)}`);
bashCase('enforce: --model=opus --effort=high', 'allow', launchWith('agents start', 'claude --model=opus --effort=high --session-id x', '--prompt hi '));
bashCase('enforce: --model=opus, --effort ultracode', 'allow', launchWith('agents start', 'claude --model=opus --effort ultracode --session-id x', '--prompt hi '));
bashCase('enforce: quoted --model="opus"', 'allow', launchWith('agents start', 'claude --model="opus" --effort high --session-id x', '--prompt hi '));
bashCase('enforce: flags after --session-id', 'allow', launchWith('agents start', 'claude --session-id x --effort high --model opus', '--prompt hi '));
bashCase('enforce: lookalike --model-x/--effort-y', 'deny', launchWith('agents start', 'claude --model-x a --effort-y b --session-id x', '--prompt hi '));
bashCase('enforce: codex needs no routing', 'allow', 'runpane agents start --pane 1 --agent codex --prompt hi --yes');
for (const t of ['mcp__pane__agents_start', 'mcp__pane__panels_create']) {
  verdictCase(`${t} enforce: only --model`, 'deny', t, { agent: 'claude', toolCommand: ONLY_MODEL });
  verdictCase(`${t} enforce: only --effort`, 'deny', t, { agent: 'claude', toolCommand: ONLY_EFFORT });
  verdictCase(`${t} enforce: neither flag`, 'deny', t, { agent: 'claude', toolCommand: NEITHER });
  verdictCase(`${t} enforce: neither, no agent param`, 'deny', t, { toolCommand: 'claude --session-id x' });
  verdictCase(`${t} enforce: both flags`, 'allow', t, { agent: 'claude', toolCommand: GOOD });
  verdictCase(`${t} enforce: --model=opus`, 'allow', t, { agent: 'claude', toolCommand: 'claude --model=opus --effort=high --session-id x' });
  verdictCase(`${t} enforce: codex unaffected`, 'allow', t, { agent: 'codex', toolCommand: 'codex' });
}

// Routing deny message: names the missing flag(s), points at both skills, shows the sonnet/medium
// fallback, says an explicit user choice wins, and stays tool-aware.
const reasonOf = (tool: string, toolInput: Record<string, unknown>): string => evaluate({ tool_name: tool, tool_input: toolInput })?.reason ?? '';
const cliReason = (tc: string): string => reasonOf('Bash', { command: launchWith('agents start', tc) });
for (const t of ['mcp__pane__agents_start', 'mcp__pane__panels_create']) {
  const neither = reasonOf(t, { agent: 'claude', toolCommand: NEITHER });
  const onlyModel = reasonOf(t, { agent: 'claude', toolCommand: ONLY_MODEL });
  const onlyEffort = reasonOf(t, { agent: 'claude', toolCommand: ONLY_EFFORT });
  test(`${t} routing msg names both skills`, () => {
    expect(neither).toContain('/runpane-utils:determine-model');
    expect(neither).toContain('/runpane-utils:determine-effort');
  });
  test(`${t} routing msg lists missing flags`, () => {
    expect(neither).toContain('missing: --model --effort');
    expect(onlyModel).toContain('missing: --effort');
    expect(onlyEffort).toContain('missing: --model');
    expect(onlyModel).not.toContain('missing: --model');
  });
  test(`${t} routing msg: fallback, user choice wins, camelCase form`, () => {
    expect(neither).toContain('toolCommand: "claude --model sonnet --effort medium --session-id');
    expect(neither).toContain('named explicitly always wins');
    expect(neither).not.toContain("--tool-command '");
  });
}
test('Bash routing msg: skills, fallback, user choice wins, no MCP form', () => {
  const neither = cliReason(NEITHER);
  expect(neither).toContain('/runpane-utils:determine-model');
  expect(neither).toContain('/runpane-utils:determine-effort');
  expect(neither).toContain("--tool-command 'claude --model sonnet --effort medium --session-id");
  expect(neither).toContain('named explicitly always wins');
  expect(neither).not.toContain('toolCommand');
  expect(cliReason(ONLY_MODEL)).toContain('missing: --effort');
});
test('no session-id is a session-id deny, not a routing deny', () => {
  expect(cliReason('claude --model opus --effort high')).not.toContain('missing:');
});
