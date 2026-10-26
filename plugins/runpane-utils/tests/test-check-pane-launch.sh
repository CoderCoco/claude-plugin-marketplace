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

GOOD='claude --model sonnet --effort medium --session-id "$(uuidgen)"'

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
bash_case "correct form, double-quoted"          allow "runpane agents start --pane 1 --agent claude --tool-command \"claude --model sonnet --effort medium --session-id \\\"\\\$(uuidgen)\\\"\" --prompt hi --yes"
bash_case "correct form, --tool-command= syntax" allow "runpane panes create --repo r --name n --agent=claude --tool-command='$GOOD' --yes"
bash_case "correct form, piped"                  allow "runpane panels create --pane 1 --agent claude --tool-command '$GOOD' --yes --json | jq ."
bash_case "codex agent"                          allow 'runpane panels create --pane 1 --agent codex --yes'
bash_case "cursor agent"                         allow 'runpane agents start --pane 1 --agent cursor --prompt hi --yes'
bash_case "non-claude tool-command"              allow "runpane panels create --pane 1 --tool-command 'bash' --yes"
bash_case "unrelated runpane command"            allow 'runpane panes list --json'
bash_case "unrelated Bash"                       allow 'ls -la && git status'

# --- review-feedback cases ---
bash_case "wrapper: env FOO=1 claude --dangerously-skip-permissions" deny "runpane panels create --pane 1 --tool-command 'env FOO=1 claude --dangerously-skip-permissions' --yes"
bash_case "wrapper: env claude with session id"  allow "runpane panels create --pane 1 --tool-command 'env FOO=1 claude --model sonnet --effort medium --session-id abc' --yes"
bash_case "split-quoted skip flag"               deny  "runpane panels create --pane 1 --agent claude --tool-command 'claude --dangerously-skip\"-\"permissions --session-id x' --yes"
bash_case "adopt without --launch"               allow 'runpane panes adopt --repo r --path /p --name n --agent claude --yes'
bash_case "adopt --launch, bare claude"          deny  'runpane panes adopt --repo r --path /p --name n --agent claude --launch --yes'
bash_case "adopt --launch, correct form"         allow "runpane panes adopt --repo r --path /p --name n --agent claude --tool-command '$GOOD' --launch --yes"
bash_case "chained: bare first, good second (;)" deny  "runpane panels create --pane 1 --agent claude --yes; runpane panels create --pane 1 --agent claude --tool-command 'claude --model sonnet --effort medium --session-id x' --yes"
bash_case "chained: bare second (&&)"            deny  "runpane panels create --pane 1 --agent claude --tool-command '$GOOD' --yes && runpane panels create --pane 2 --agent claude --yes"
bash_case "chained: both good"                   allow "runpane panels create --pane 1 --agent claude --tool-command '$GOOD' --yes; runpane panels create --pane 2 --agent claude --tool-command '$GOOD' --yes"

# jq missing: Pane calls denied, unrelated calls allowed
nojq_dir=$(mktemp -d); for b in bash grep cat tr sed; do ln -s "$(command -v $b)" "$nojq_dir/$b"; done
nojq() { PATH=$nojq_dir "$BASH" "$HOOK" <<<"$1"; }
if nojq '{"tool_name":"Bash","tool_input":{"command":"runpane panels create --agent claude"}}' | grep -q '"deny"'; then pass=$((pass+1)); echo "ok   no jq: pane call denied"; else fail=$((fail+1)); echo "FAIL no jq: pane call denied"; fi
if [[ -z $(nojq '{"tool_name":"Bash","tool_input":{"command":"ls"}}') ]]; then pass=$((pass+1)); echo "ok   no jq: unrelated call allowed"; else fail=$((fail+1)); echo "FAIL no jq: unrelated call allowed"; fi
rm -rf "$nojq_dir"

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

# --- Deny message is tool-aware ---
# reason_case <name> <tool_name> <tool_input-json> <must-contain|must-not-contain> <fixed string>
reason_case() {
  local name=$1 tool=$2 ti=$3 mode=$4 needle=$5 reason found=no
  reason=$(jq -nc --arg t "$tool" --argjson i "$ti" '{tool_name:$t,tool_input:$i}' | "$HOOK" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')
  [[ $reason == *"$needle"* ]] && found=yes
  if [[ ($mode == must-contain && $found == yes) || ($mode == must-not-contain && $found == no) ]]; then
    pass=$((pass+1)); printf 'ok   %s\n' "$name"
  else fail=$((fail+1)); printf 'FAIL %s (%s %s)\n' "$name" "$mode" "$needle"; fi
}
MCP_TC='toolCommand: "claude --model sonnet --effort medium --session-id \"$(uuidgen)\""'
for t in mcp__pane__agents_start mcp__pane__panels_create; do
  reason_case "$t msg shows agent param"       "$t" '{"agent":"claude"}' must-contain 'agent: "claude"'
  reason_case "$t msg shows toolCommand param" "$t" '{"agent":"claude"}' must-contain "$MCP_TC"
  reason_case "$t msg says yes: true boolean"  "$t" '{"agent":"claude"}' must-contain 'yes: true'
  reason_case "$t msg says camelCase"          "$t" '{"agent":"claude"}' must-contain 'camelCase'
  reason_case "$t msg is not CLI flag form"    "$t" '{"agent":"claude"}' must-not-contain "--tool-command '"
done
cli_ti=$(jq -nc --arg c 'runpane panels create --pane 1 --agent claude --yes' '{command:$c}')
reason_case "Bash msg shows CLI flag form"     Bash "$cli_ti" must-contain "--tool-command 'claude --model sonnet --effort medium --session-id"
reason_case "Bash msg has no MCP param form"   Bash "$cli_ti" must-not-contain 'toolCommand'

# --- Model/effort routing flags are allowed; unsafe flags still denied ---
ROUTED='claude --model opus --effort high --session-id "$(uuidgen)"'
bash_case "routed: --model/--effort + session-id"   allow "runpane agents start --pane 1 --agent claude --tool-command '$ROUTED' --prompt hi --yes"
bash_case "routed: --effort ultracode"              allow "runpane agents start --pane 1 --agent claude --tool-command 'claude --model fable --effort ultracode --session-id x' --prompt hi --yes"
bash_case "routed: --model haiku --effort medium"   allow "runpane panels create --pane 1 --agent claude --tool-command 'claude --model haiku --effort medium --session-id x' --yes"
bash_case "routed: no session-id"                   deny  "runpane panels create --pane 1 --agent claude --tool-command 'claude --model opus --effort high' --yes"
bash_case "routed: skip-permissions alongside --model" deny "runpane panels create --pane 1 --agent claude --tool-command 'claude --model opus --effort high --dangerously-skip-permissions --session-id x' --yes"
for t in mcp__pane__agents_start mcp__pane__panels_create; do
  run_case "$t routed toolCommand"                  allow "$t" "$(jq -nc --arg c "$ROUTED" '{agent:"claude",toolCommand:$c}')"
  run_case "$t routed ultracode"                    allow "$t" '{"agent":"claude","toolCommand":"claude --model opus --effort ultracode --session-id x"}'
  run_case "$t routed, skip-permissions"            deny  "$t" '{"agent":"claude","toolCommand":"claude --model opus --effort high --dangerously-skip-permissions --session-id x"}'
  run_case "$t routed, no session-id"               deny  "$t" '{"agent":"claude","toolCommand":"claude --model opus --effort high"}'
done

# --- Model/effort enforcement: both --model and --effort are required ---
ONLY_MODEL='claude --model opus --session-id x'
ONLY_EFFORT='claude --effort high --session-id x'
NEITHER='claude --session-id "$(uuidgen)"'
bash_case "enforce: only --model"                deny  "runpane agents start --pane 1 --agent claude --tool-command '$ONLY_MODEL' --prompt hi --yes"
bash_case "enforce: only --effort"               deny  "runpane agents start --pane 1 --agent claude --tool-command '$ONLY_EFFORT' --prompt hi --yes"
bash_case "enforce: neither flag"                deny  "runpane agents start --pane 1 --agent claude --tool-command '$NEITHER' --prompt hi --yes"
bash_case "enforce: neither, panels create"      deny  "runpane panels create --pane 1 --agent claude --tool-command '$NEITHER' --yes"
bash_case "enforce: neither, wrapper command"    deny  "runpane panels create --pane 1 --tool-command 'env FOO=1 claude --session-id x' --yes"
bash_case "enforce: neither, adopt --launch"     deny  "runpane panes adopt --repo r --path /p --name n --agent claude --tool-command '$NEITHER' --launch --yes"
bash_case "enforce: adopt without --launch"      allow 'runpane panes adopt --repo r --path /p --name n --agent claude --yes'
bash_case "enforce: second chained launch unrouted" deny "runpane panels create --pane 1 --agent claude --tool-command '$GOOD' --yes && runpane panels create --pane 2 --agent claude --tool-command '$NEITHER' --yes"
bash_case "enforce: --model=opus --effort=high"  allow "runpane agents start --pane 1 --agent claude --tool-command 'claude --model=opus --effort=high --session-id x' --prompt hi --yes"
bash_case "enforce: --model=opus, --effort ultracode" allow "runpane agents start --pane 1 --agent claude --tool-command 'claude --model=opus --effort ultracode --session-id x' --prompt hi --yes"
bash_case "enforce: quoted --model=\"opus\""     allow "runpane agents start --pane 1 --agent claude --tool-command 'claude --model=\"opus\" --effort high --session-id x' --prompt hi --yes"
bash_case "enforce: flags after --session-id"    allow "runpane agents start --pane 1 --agent claude --tool-command 'claude --session-id x --effort high --model opus' --prompt hi --yes"
bash_case "enforce: lookalike --model-x/--effort-y" deny "runpane agents start --pane 1 --agent claude --tool-command 'claude --model-x a --effort-y b --session-id x' --prompt hi --yes"
bash_case "enforce: codex needs no routing"      allow 'runpane agents start --pane 1 --agent codex --prompt hi --yes'
for t in mcp__pane__agents_start mcp__pane__panels_create; do
  run_case "$t enforce: only --model"            deny  "$t" "$(jq -nc --arg c "$ONLY_MODEL" '{agent:"claude",toolCommand:$c}')"
  run_case "$t enforce: only --effort"           deny  "$t" "$(jq -nc --arg c "$ONLY_EFFORT" '{agent:"claude",toolCommand:$c}')"
  run_case "$t enforce: neither flag"            deny  "$t" "$(jq -nc --arg c "$NEITHER" '{agent:"claude",toolCommand:$c}')"
  run_case "$t enforce: neither, no agent param" deny  "$t" '{"toolCommand":"claude --session-id x"}'
  run_case "$t enforce: both flags"              allow "$t" "$(jq -nc --arg c "$GOOD" '{agent:"claude",toolCommand:$c}')"
  run_case "$t enforce: --model=opus"            allow "$t" '{"agent":"claude","toolCommand":"claude --model=opus --effort=high --session-id x"}'
  run_case "$t enforce: --effort ultracode"      allow "$t" '{"agent":"claude","toolCommand":"claude --model fable --effort ultracode --session-id x"}'
  run_case "$t enforce: codex unaffected"        allow "$t" '{"agent":"codex","toolCommand":"codex"}'
done

# Routing deny message: names the missing flag(s), points at both skills, shows sonnet/medium fallback,
# says explicit user choice wins, and stays tool-aware.
SKILL_MODEL='/runpane-utils:determine-model'
SKILL_EFFORT='/runpane-utils:determine-effort'
mcp_only_model=$(jq -nc --arg c "$ONLY_MODEL" '{agent:"claude",toolCommand:$c}')
mcp_only_effort=$(jq -nc --arg c "$ONLY_EFFORT" '{agent:"claude",toolCommand:$c}')
mcp_neither=$(jq -nc --arg c "$NEITHER" '{agent:"claude",toolCommand:$c}')
cli_only_model=$(jq -nc --arg c "runpane agents start --pane 1 --agent claude --tool-command '$ONLY_MODEL' --yes" '{command:$c}')
cli_neither=$(jq -nc --arg c "runpane agents start --pane 1 --agent claude --tool-command '$NEITHER' --yes" '{command:$c}')
for t in mcp__pane__agents_start mcp__pane__panels_create; do
  reason_case "$t routing msg names determine-model"  "$t" "$mcp_neither" must-contain "$SKILL_MODEL"
  reason_case "$t routing msg names determine-effort" "$t" "$mcp_neither" must-contain "$SKILL_EFFORT"
  reason_case "$t routing msg: neither lists both"    "$t" "$mcp_neither" must-contain 'missing: --model --effort'
  reason_case "$t routing msg: only --model given"    "$t" "$mcp_only_model" must-contain 'missing: --effort'
  reason_case "$t routing msg: only --effort given"   "$t" "$mcp_only_effort" must-contain 'missing: --model'
  reason_case "$t routing msg: --model not flagged when given" "$t" "$mcp_only_model" must-not-contain 'missing: --model'
  reason_case "$t routing msg: sonnet/medium fallback" "$t" "$mcp_neither" must-contain 'toolCommand: "claude --model sonnet --effort medium --session-id'
  reason_case "$t routing msg: user choice wins"      "$t" "$mcp_neither" must-contain 'named explicitly always wins'
  reason_case "$t routing msg is not CLI flag form"   "$t" "$mcp_neither" must-not-contain "--tool-command '"
done
reason_case "Bash routing msg names determine-model"  Bash "$cli_neither" must-contain "$SKILL_MODEL"
reason_case "Bash routing msg names determine-effort" Bash "$cli_neither" must-contain "$SKILL_EFFORT"
reason_case "Bash routing msg: only --model given"    Bash "$cli_only_model" must-contain 'missing: --effort'
reason_case "Bash routing msg: sonnet/medium fallback" Bash "$cli_neither" must-contain "--tool-command 'claude --model sonnet --effort medium --session-id"
reason_case "Bash routing msg: user choice wins"      Bash "$cli_neither" must-contain 'named explicitly always wins'
reason_case "Bash routing msg has no MCP param form"  Bash "$cli_neither" must-not-contain 'toolCommand'
# A launch with routing flags but no --session-id is still denied for the session-id reason, not routing
reason_case "no session-id is not a routing deny" Bash "$(jq -nc --arg c "runpane agents start --pane 1 --agent claude --tool-command 'claude --model opus --effort high' --yes" '{command:$c}')" must-not-contain 'missing:'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
((fail == 0))
