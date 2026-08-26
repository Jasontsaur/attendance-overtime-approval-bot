#!/bin/bash
# Print the Windows clipboard's text content (UTF-8, no length limit unlike
# get-title.sh's ~512-char window-title buffer). Companion to set-clipboard.sh.
set -euo pipefail

TMP_WIN='C:\Users\Tsao\clip_temp.txt'
TMP_WSL='/mnt/c/Users/Tsao/clip_temp.txt'

/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
[System.IO.File]::WriteAllText('$TMP_WIN', (Get-Clipboard -Raw), [System.Text.Encoding]::UTF8)
"
tail -c +4 "$TMP_WSL" 2>/dev/null || cat "$TMP_WSL"
rm -f "$TMP_WSL"
