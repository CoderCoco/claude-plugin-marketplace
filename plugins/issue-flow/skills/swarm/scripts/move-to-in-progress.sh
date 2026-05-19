#!/usr/bin/env bash
# Thin wrapper that delegates to the work-on skill's move-to-in-progress.sh,
# so swarm reuses the same project-board logic as work-on without symlinks.
# Usage: move-to-in-progress.sh <ITEM_ID> <PROJECT_NUMBER> <OWNER>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DELEGATE="${SCRIPT_DIR}/../../work-on/scripts/move-to-in-progress.sh"

if [ ! -f "$DELEGATE" ]; then
  echo "Sister skill work-on/scripts/move-to-in-progress.sh not found at $DELEGATE — cannot move project card. The issue-flow plugin appears to be incomplete (work-on skill missing). Exit 0 is reserved for 'no board / no In Progress column'; this is a different failure mode." >&2
  exit 1
fi

exec bash "$DELEGATE" "$@"
