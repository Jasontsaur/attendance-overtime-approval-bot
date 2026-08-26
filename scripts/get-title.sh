#!/bin/bash
# Print the foreground window's title text. Used to read data that a
# bookmarklet has written into document.title, as a cheap (no screenshot,
# no vision tokens) alternative to screenshotting the browser to read state.
#
# Note: Edge appends stuff like " 和其他 N 個頁面 - 個人 - Microsoft Edge"
# after the active tab's title when multiple tabs/windows are open. Callers
# should have the bookmarklet wrap its payload with a known prefix (e.g.
# "LIST:") and a terminator character (e.g. "◆") so the payload can be
# reliably extracted regardless of whatever Edge appends after it.
set -euo pipefail

TMP_WIN='C:\Users\Tsao\title_temp.txt'
TMP_WSL='/mnt/c/Users/Tsao/title_temp.txt'

/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
Add-Type -Name Win32 -Namespace Native -MemberDefinition '
[DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern IntPtr GetForegroundWindow();
[DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder text, int count);
'
\$hwnd = [Native.Win32]::GetForegroundWindow()
\$sb = New-Object System.Text.StringBuilder 512
[Native.Win32]::GetWindowTextW(\$hwnd, \$sb, 512) | Out-Null
[System.IO.File]::WriteAllText('$TMP_WIN', \$sb.ToString(), [System.Text.Encoding]::UTF8)
"
# Strip the UTF-8 BOM that WriteAllText prepends, then print.
tail -c +4 "$TMP_WSL" 2>/dev/null || cat "$TMP_WSL"
rm -f "$TMP_WSL"
