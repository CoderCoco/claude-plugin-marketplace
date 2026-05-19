#!/usr/bin/env bash
# Print an ASCII handoff banner to stdout.
# Usage: print-handoff.sh <FROM> <TO> <CTX>
# Pure ASCII, no emoji.
set -euo pipefail

FROM="${1:-?}"
TO="${2:-?}"
CTX="${3:-}"

LINE1="HANDOFF  ${FROM}  -->  ${TO}"
LINE2="ctx: ${CTX}"

# Compute width as the max of the two lines, padded.
W1=${#LINE1}
W2=${#LINE2}
WIDTH=$(( W1 > W2 ? W1 : W2 ))
WIDTH=$(( WIDTH + 4 ))  # padding

# Build the horizontal rule.
RULE=""
i=0
while [ "$i" -lt "$WIDTH" ]; do
  RULE="${RULE}-"
  i=$((i + 1))
done

printf '+%s+\n' "$RULE"
printf '| %-*s |\n' $((WIDTH - 2)) "$LINE1"
printf '| %-*s |\n' $((WIDTH - 2)) "$LINE2"
printf '+%s+\n' "$RULE"
