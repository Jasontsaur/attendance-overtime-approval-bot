#!/bin/bash
# Wrapper for unattended runs via Windows Task Scheduler (wsl.exe invokes this
# directly, not through .bashrc, so nvm/node must be sourced explicitly here).
set -uo pipefail
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOGFILE="$LOG_DIR/scheduled-run.log"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') ====="
  OUTPUT="$(node check-queues.js 2>&1)"
  echo "$OUTPUT"
  # An expired session usually surfaces as SESSION_EXPIRED, but the overnight
  # timeout instead serves a login page with no sidebar, which check-queues.js
  # reports as FATAL (timeout waiting for the queue link). Re-login and retry
  # on either — a retry after a genuine non-session failure just fails again
  # and is logged.
  if echo "$OUTPUT" | grep -qE '"error":"(SESSION_EXPIRED|FATAL)"'; then
    echo "-- session expired or unreachable, attempting auto-login --"
    node auto-login.js 2>&1
    echo "-- retrying check --"
    node check-queues.js 2>&1
  fi
  echo ""
} >> "$LOGFILE" 2>&1
