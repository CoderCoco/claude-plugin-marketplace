#!/usr/bin/env bash
# Plain-shell tests for hooks/check-pane-launch.sh. Usage: tests/test-check-pane-launch.sh
set -u
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hooks/check-pane-launch.sh"
pass=0 fail=0

# run_case <name> <allow|deny> <tool_name> <tool_input-json>
run_case() {
  local name=$1 want=$2 tool=$3 ti=$4 out got
  out=$(jq -nc --arg t "$tool" --argjson i "$ti" '{tool_name:$t,tool_input:$i}' | "$HOOK")
  if jq -e '.hookSpecificOutput.permissionDecision == "deny"' <<<"$out" >/dev/null 2>&1; then got=deny; else got=allow; fi
  if [[ $got == "$want" ]]; then pass=$((pass+1)); printf 'ok   %s\n' "$name"
  else fail=$((fail+1)); printf 'FAIL %s (want %s, got %s)\n' "$name" "$want" "$got"; fi
}
bash_case() { run_case "$1" "$2" Bash "$(jq -nc --arg c "$3" '{command:$c}')"; }

GOOD='claude --session-id "$(uuidgen)"'

# --- Bash ---
bash_case "bare --agent claude (panes create)"   deny  'runpane panes create --repo active --name x --agent claude --yes'
bash_case "bare --agent claude (panels create)"  deny  'runpane panels create --pane 1 --agent claude --yes'
bash_case "bare --agent claude (agents start)"   deny  'runpane agents start --pane 1 --agent claude --prompt hi --yes'
bash_case "--agent=claude form"                  deny  'runpane panels create --pane 1 --agent=claude --yes'
bash_case "--agent \"claude\" quoted"            deny  'runpane panels create --pane 1 --agent "claude" --yes'
bash_case "tool-command without session-id"      deny  "runpane panels create --pane 1 --agent claude --tool-command 'claude' --yes"
bash_case "skip-permissions in tool-command"     deny  "runpane panels create --pane 1 --agent claude --tool-command 'claude --dangerously-skip-permissions --session-id x' --yes"
bash_case "claude tool-command, no --agent, no session-id" deny "runpane panels create --pane 1 --tool-command claude --yes"
bash_case "piped / chained bare launch"          deny  'cd /x && echo go | runpane panels create --pane 1 --agent claude --yes | jq .'
bash_case "multi-line bare launch"               deny  $'runpane panels create \\\n  --pane 1 \\\n  --agent claude --yes'
bash_case "correct form"                         allow "runpane panels create --pane 1 --agent claude --tool-command '$GOOD' --yes"
bash_case "correct form, double-quoted"          allow "runpane agents start --pane 1 --agent claude --tool-command \"claude --session-id \\\"\\\$(uuidgen)\\\"\" --prompt hi --yes"
bash_case "correct form, --tool-command= syntax" allow "runpane panes create --repo r --name n --agent=claude --tool-command='$GOOD' --yes"
bash_case "correct form, piped"                  allow "runpane panels create --pane 1 --agent claude --tool-command '$GOOD' --yes --json | jq ."
bash_case "codex agent"                          allow 'runpane panels create --pane 1 --agent codex --yes'
bash_case "cursor agent"                         allow 'runpane agents start --pane 1 --agent cursor --prompt hi --yes'
bash_case "non-claude tool-command"              allow "runpane panels create --pane 1 --tool-command 'bash' --yes"
bash_case "unrelated runpane command"            allow 'runpane panes list --json'
bash_case "unrelated Bash"                       allow 'ls -la && git status'

# --- MCP: mcp__pane__agents_start / mcp__pane__panels_create ---
for t in mcp__pane__agents_start mcp__pane__panels_create; do
  run_case "$t claude, no toolCommand"           deny  "$t" '{"agent":"claude","pane":"1"}'
  run_case "$t claude, toolCommand w/o session"  deny  "$t" '{"agent":"claude","toolCommand":"claude"}'
  run_case "$t claude, skip-permissions"         deny  "$t" '{"agent":"claude","toolCommand":"claude --dangerously-skip-permissions --session-id x"}'
  run_case "$t claude, toolCommand w/ session"   allow "$t" "$(jq -nc --arg c "$GOOD" '{agent:"claude",toolCommand:$c}')"
  run_case "$t codex, no toolCommand"            allow "$t" '{"agent":"codex","pane":"1"}'
  run_case "$t no agent, non-claude toolCommand" allow "$t" '{"toolCommand":"bash"}'
done
run_case "other pane MCP tool" allow mcp__pane__panes_list '{"agent":"claude"}'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
((fail == 0))
