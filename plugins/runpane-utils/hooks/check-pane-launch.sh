#!/usr/bin/env bash
# PreToolUse: deny Pane launches of Claude that would run the built-in template
# (`claude --dangerously-skip-permissions`) instead of an explicit
# --tool-command carrying --session-id.
#
# Covers:
#   Bash                          runpane (panes|panels) create, panes adopt, agents start
#   mcp__pane__agents_start       tool_input.agent / tool_input.toolCommand
#   mcp__pane__panels_create      (MCP field names are the CLI flags camelCased:
#                                  --tool-command -> toolCommand)
set -u
input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")

MSG='Pane Claude launches must not use the bare --agent claude template (it runs claude --dangerously-skip-permissions and disables permission prompts). Launch with: --agent claude --tool-command '\''claude --session-id "$(uuidgen)"'\''. Keep --agent claude alongside --tool-command so Pane still treats the panel as Claude Code. Note: {sessionId} is NOT expanded by --tool-command; use $(uuidgen), which the Pane shell evaluates.'

deny() {
  jq -n --arg r "$MSG" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# Args: $1 = agent name (may be empty), $2 = tool command (may be empty).
# Denies unless a Claude launch has an explicit session id and no permission bypass.
check_launch() {
  local agent=$1 tc=$2 is_claude=0
  [[ "${agent,,}" == claude ]] && is_claude=1
  [[ "$tc" =~ ^[[:space:]\"\']*([^[:space:]]*/)?claude([[:space:]\"\']|$) ]] && is_claude=1
  ((is_claude)) || return 0
  [[ -n "$tc" ]] || deny
  [[ "$tc" == *--dangerously-skip-permissions* ]] && deny
  [[ "$tc" == *--session-id* ]] || deny
  return 0
}

case "$tool" in
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$input" | tr '\n' ' ')
    grep -Eq 'runpane.*((panes|panels)[[:space:]]+(create|adopt)|agents[[:space:]]+start)' <<<"$cmd" || exit 0
    agent=""
    grep -Eq -- '--agent([[:space:]]+|=)["'\'']?claude' <<<"$cmd" && agent=claude
    tc=""
    if grep -Eq -- '--tool-command([[:space:]]+|=)' <<<"$cmd"; then
      # Everything after the flag stands in for its value; --session-id must be in it.
      tc=$(sed -E 's/.*--tool-command([[:space:]]+|=)//' <<<"$cmd")
    fi
    # Claude flagged via --agent and/or a claude tool command, but no --tool-command at all.
    if [[ -n "$agent" && -z "$tc" ]]; then deny; fi
    check_launch "$agent" "$tc"
    ;;
  mcp__pane__agents_start|mcp__pane__panels_create)
    agent=$(jq -r '.tool_input.agent // ""' <<<"$input")
    tc=$(jq -r '.tool_input.toolCommand // .tool_input.tool_command // ""' <<<"$input")
    check_launch "$agent" "$tc"
    ;;
esac
exit 0
