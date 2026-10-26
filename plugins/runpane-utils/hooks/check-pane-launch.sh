#!/usr/bin/env bash
# PreToolUse shim for check-pane-launch.ts. The logic lives in TypeScript (run with bun);
# this wrapper exists so a missing bun fails CLOSED for Pane calls: a bare `bun run ...`
# hook command would exit 127, which Claude Code treats as non-blocking, silently turning
# the guard off.
set -u
if command -v bun >/dev/null 2>&1; then
  exec bun run "${BASH_SOURCE[0]%/*}/check-pane-launch.ts"
fi
input=$(cat)
grep -Eq 'runpane|mcp__pane__' <<<"$input" || exit 0
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"runpane-utils guard needs bun on PATH to validate Pane launches; install bun (https://bun.sh) and retry."}}'
