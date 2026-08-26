#!/bin/bash
# Set the Windows clipboard to the given text (read from stdin), for pasting
# into fields via Ctrl+V instead of typing (avoids SendKeys escaping issues
# with JS special characters).
# Usage: echo "some text" | set-clipboard.sh
set -euo pipefail

TMP_WIN='C:\Users\Tsao\clipboard_temp.txt'
TMP_WSL="/mnt/c/Users/Tsao/clipboard_temp.txt"

cat > "$TMP_WSL"

/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
\$text = [System.IO.File]::ReadAllText('$TMP_WIN', [System.Text.Encoding]::UTF8)
Set-Clipboard -Value \$text
"
rm -f "$TMP_WSL"
