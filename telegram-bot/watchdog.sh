#!/bin/bash
# Safety net on top of Task Scheduler's own restart-on-failure: the bot
# process has been observed exiting with STATUS_CONTROL_C_EXIT (0xC000013A,
# "killed by a CTRL+C/close-style signal" — consistent with the whole WSL
# session getting torn down), and Task Scheduler's restart-on-failure does
# not reliably bring it back afterwards (seen staying down for 27+ hours).
# This script just checks "is it running, if not start it" and is meant to
# be run every few minutes by a separate Scheduled Task — a short-lived
# check, not a persistent process itself.
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p logs

# flock serializes concurrent watchdog runs (e.g. an overlapping manual run
# during testing) so two can't both decide "not running" and double-spawn.
exec 9>logs/.watchdog.lock
flock -n 9 || exit 0

# A PID file (not pgrep -f "node index.js") because the live process's argv
# is the short relative "node index.js" (run.sh execs it after cd'ing into
# this dir) — matching that against a longer/absolute pgrep pattern silently
# never matches and makes this restart on every tick. Still verify the PID
# is actually a node process (not just alive) in case it got reused for an
# unrelated process after a crash.
PID_FILE=logs/bot.pid
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null \
   && grep -q node "/proc/$(cat "$PID_FILE")/comm" 2>/dev/null; then
  exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') watchdog: bot not running, restarting" >> logs/watchdog.log
nohup ./run.sh > /dev/null 2>&1 &
disown
