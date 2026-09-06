#!/bin/bash
# Wrapper for Windows Task Scheduler (wsl.exe invokes this directly, not
# through .bashrc, so nvm/node must be sourced explicitly here — same
# pattern as playwright/scheduled-check.sh). Runs the bot in the foreground
# forever; Task Scheduler's restart-on-failure settings bring it back if it
# ever exits.
set -uo pipefail
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

mkdir -p logs
exec node index.js >> logs/bot.log 2>&1
