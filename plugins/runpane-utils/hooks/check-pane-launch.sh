#!/usr/bin/env bash
# PreToolUse: deny Pane launches of Claude that would run the built-in template
# (`claude --dangerously-skip-permissions`) instead of an explicit
# --tool-command carrying --session-id.
#
# Covers:
#   Bash                          runpane (panes|panels) create, panes adopt --launch, agents start
#   mcp__pane__agents_start       tool_input.agent / tool_input.toolCommand
#   mcp__pane__panels_create      (MCP field names are the CLI flags camelCased:
#                                  --tool-command -> toolCommand)
#
# Fails closed: if jq is missing or the input is unparseable, Pane-related calls are denied.
# Flag checks run on a quote/backslash-stripped copy of the command, so `--dangerously-skip"-"permissions`
# is still caught. Shell expansion beyond that (variables, eval) cannot be validated statically.
set -u
input=$(cat)

# Bash/CLI form: flag syntax.
MSG_CLI='Pane Claude launches must not use the bare --agent claude template (it runs claude --dangerously-skip-permissions and disables permission prompts). Launch with: --agent claude --tool-command '\''claude --session-id "$(uuidgen)"'\''. Keep --agent claude alongside --tool-command so Pane still treats the panel as Claude Code. Note: {sessionId} is NOT expanded by --tool-command; use $(uuidgen), which the Pane shell evaluates.'

# mcp__pane__* form: exact camelCase params, since the CLI flag syntax does not map 1:1 and guessing caused repeated failures.
MSG_MCP='Pane Claude launches must not use the bare agent: "claude" template (it runs claude --dangerously-skip-permissions and disables permission prompts). Pass BOTH params, camelCase, exactly: agent: "claude", toolCommand: "claude --session-id \"$(uuidgen)\"". Also pass yes: true (JSON boolean, not the string "true"). New Pane (agents_start): {repo: "<id or name from mcp__pane__repos_list>", name: "<kebab-name>", agent: "claude", toolCommand: "claude --session-id \"$(uuidgen)\"", yes: true, prompt: "<task>"}. Agent tab in an existing Pane: use pane: "<pane-id>" instead of repo and name. Param names are camelCase (toolCommand, baseBranch), never tool-command. {sessionId} is NOT expanded by toolCommand; use $(uuidgen), which the Pane shell evaluates.'

MSG=$MSG_CLI

deny_with() {
  # Hand-built JSON so this works without jq; $1 must contain no quotes or backslashes.
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

if ! command -v jq >/dev/null 2>&1; then
  grep -Eq 'runpane|mcp__pane__' <<<"$input" || exit 0
  deny_with 'runpane-utils guard needs jq on PATH to validate Pane launches; install jq and retry.'
fi
jq -e . >/dev/null 2>&1 <<<"$input" || deny_with 'runpane-utils guard could not parse the hook input; blocking the call.'

tool=$(jq -r '.tool_name // ""' <<<"$input")
[[ "$tool" == mcp__pane__* ]] && MSG=$MSG_MCP

deny() {
  jq -n --arg r "$MSG" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# Strip quotes and backslashes so quoted/escaped flag spellings compare equal.
norm() { tr -d '"'\''\\' <<<"$1"; }

# Args: $1 = agent name (may be empty), $2 = tool command (may be empty).
# Denies unless a Claude launch has an explicit session id and no permission bypass.
check_launch() {
  local agent=$1 tc is_claude=0
  tc=$(norm "$2")
  [[ "${agent,,}" == claude ]] && is_claude=1
  # `claude` as a command word anywhere, so wrappers like `env FOO=1 claude` or /usr/bin/claude count.
  [[ "$tc" =~ (^|[^[:alnum:]_.-])claude([^[:alnum:]_-]|$) ]] && is_claude=1
  ((is_claude)) || return 0
  [[ -n "$tc" ]] || deny
  [[ "$tc" == *--dangerously-skip-permissions* ]] && deny
  [[ "$tc" == *--session-id* ]] || deny
  return 0
}

case "$tool" in
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
    # Join line continuations, then split into simple commands on ; && || | and newlines
    # so every runpane invocation is validated on its own.
    segments=$(sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n/ /g' <<<"$cmd" | sed -E 's/(&&|\|\||[;|&])/\n/g')
    while IFS= read -r seg; do
      n=$(norm "$seg")
      grep -Eq 'runpane.*((panes|panels)[[:space:]]+create|panes[[:space:]]+adopt|agents[[:space:]]+start)' <<<"$n" || continue
      # `panes adopt` only launches an agent with --launch.
      if grep -Eq 'panes[[:space:]]+adopt' <<<"$n"; then
        grep -Eq -- '--launch' <<<"$n" || continue
      fi
      agent=""
      grep -Eq -- '--agent([[:space:]]+|=)claude' <<<"$n" && agent=claude
      tc=""
      if grep -Eq -- '--tool-command([[:space:]]+|=)' <<<"$n"; then
        tc=$(sed -E 's/.*--tool-command([[:space:]]+|=)//' <<<"$n")
      fi
      if [[ -n "$agent" && -z "$tc" ]]; then deny; fi
      check_launch "$agent" "$tc"
    done <<<"$segments"
    ;;
  mcp__pane__agents_start|mcp__pane__panels_create)
    agent=$(jq -r '.tool_input.agent // ""' <<<"$input")
    tc=$(jq -r '.tool_input.toolCommand // .tool_input.tool_command // ""' <<<"$input")
    check_launch "$agent" "$tc"
    ;;
esac
exit 0
