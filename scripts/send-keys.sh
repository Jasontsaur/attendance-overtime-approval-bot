#!/bin/bash
# Send a SendKeys-syntax keystroke string to the foreground window.
# Usage: send-keys.sh '^d'          (Ctrl+D)
#        send-keys.sh '^a'          (Ctrl+A, select all)
#        send-keys.sh '^v'          (Ctrl+V, paste)
#        send-keys.sh '{ENTER}'
#        send-keys.sh '{TAB}'
# Only use this for control keystrokes / plain ASCII digits, not for text
# containing JS/HTML special characters ({}, (), +, ^, %, ~) or CJK text —
# use set-clipboard.sh + send-keys.sh '^v' for those instead.
set -euo pipefail
KEYS="${1:?usage: send-keys.sh '<SendKeys-syntax string>'}"

/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait('$KEYS')
Start-Sleep -Milliseconds 100
"
