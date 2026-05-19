#!/usr/bin/env bash
# Print the full voyage log table from a swarm state file.
# Usage: print-voyage-log.sh <STATE_FILE>
# Pure ASCII, no emoji. Column widths auto-fit.
set -euo pipefail

STATE_FILE="${1:-}"

if [ -z "$STATE_FILE" ] || [ ! -f "$STATE_FILE" ]; then
  echo "Usage: print-voyage-log.sh <STATE_FILE>" >&2
  exit 1
fi

ISSUE=$(jq -r '.issue' "$STATE_FILE")
PHASE=$(jq -r '.phase' "$STATE_FILE")
COUNT=$(jq -r '.handoff_log | length' "$STATE_FILE")

echo
echo "Voyage log for issue #${ISSUE}:"
echo

if [ "$COUNT" = "0" ]; then
  echo "  (no handoffs recorded)"
  echo
  echo "Final state: ${PHASE}."
  echo "State file:  ${STATE_FILE}"
  exit 0
fi

# Pull rows: idx, hh:mm:ss, from, to, ctx, outcome.
# Time is the HH:MM:SS portion of the ISO timestamp.
ROWS_TSV=$(jq -r '
  .handoff_log
  | to_entries
  | map([
      (.key + 1 | tostring),
      (.value.ts | split("T")[1] | split("Z")[0]),
      .value.from,
      .value.to,
      .value.ctx,
      .value.outcome
    ] | @tsv)
  | .[]
' "$STATE_FILE")

# Compute column widths.
HDR_NUM="#"
HDR_TIME="Time"
HDR_FROM="From"
HDR_TO="To"
HDR_CTX="Context"
HDR_OUTCOME="Outcome"

W_NUM=${#HDR_NUM}
W_TIME=${#HDR_TIME}
W_FROM=${#HDR_FROM}
W_TO=${#HDR_TO}
W_CTX=${#HDR_CTX}
W_OUTCOME=${#HDR_OUTCOME}

while IFS=$'\t' read -r num time from to ctx outcome; do
  [ ${#num} -gt $W_NUM ] && W_NUM=${#num}
  [ ${#time} -gt $W_TIME ] && W_TIME=${#time}
  [ ${#from} -gt $W_FROM ] && W_FROM=${#from}
  [ ${#to} -gt $W_TO ] && W_TO=${#to}
  [ ${#ctx} -gt $W_CTX ] && W_CTX=${#ctx}
  [ ${#outcome} -gt $W_OUTCOME ] && W_OUTCOME=${#outcome}
done <<< "$ROWS_TSV"

# Cap Context at 60 characters; truncate longer strings with an ellipsis.
if [ $W_CTX -gt 60 ]; then
  W_CTX=60
fi

FMT="  %-${W_NUM}s  %-${W_TIME}s  %-${W_FROM}s  %-${W_TO}s  %-${W_CTX}s  %-${W_OUTCOME}s\n"

# Header.
printf "$FMT" "$HDR_NUM" "$HDR_TIME" "$HDR_FROM" "$HDR_TO" "$HDR_CTX" "$HDR_OUTCOME"

# Underline.
underline() {
  local n=$1
  local s=""
  local i=0
  while [ $i -lt $n ]; do s="${s}-"; i=$((i+1)); done
  printf '%s' "$s"
}
printf "$FMT" "$(underline $W_NUM)" "$(underline $W_TIME)" "$(underline $W_FROM)" "$(underline $W_TO)" "$(underline $W_CTX)" "$(underline $W_OUTCOME)"

# Rows.
while IFS=$'\t' read -r num time from to ctx outcome; do
  # Truncate ctx if needed.
  if [ ${#ctx} -gt $W_CTX ]; then
    ctx="${ctx:0:$((W_CTX - 3))}..."
  fi
  printf "$FMT" "$num" "$time" "$from" "$to" "$ctx" "$outcome"
done <<< "$ROWS_TSV"

echo
echo "Final state: ${PHASE}."
echo "State file:  ${STATE_FILE}"
