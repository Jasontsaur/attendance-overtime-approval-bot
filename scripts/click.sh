#!/bin/bash
# Move the Windows mouse cursor to (x,y) and left-click.
# Usage: click.sh <x> <y>
set -euo pipefail
X="${1:?usage: click.sh <x> <y>}"
Y="${2:?usage: click.sh <x> <y>}"

/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
Add-Type -Name Win32 -Namespace Native -MemberDefinition '
[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);
[DllImport(\"user32.dll\")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
'
[Native.Win32]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 150
[Native.Win32]::mouse_event(0x0002, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[Native.Win32]::mouse_event(0x0004, 0, 0, 0, 0)
Start-Sleep -Milliseconds 150
"
